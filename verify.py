"""Reproducible vector/PNG verification. Writes report.json in this project only."""
import json, math, time, tempfile, shutil
from pathlib import Path
import numpy as np
from scipy.signal import butter,sosfiltfilt,correlate,correlation_lags
from scipy.io import wavfile
from encode import encode,load_audio,prepare_audio,parameters,rasterize
from audio_filters import postprocess,presence,radius_cutoff
from PIL import Image,PngImagePlugin
from serve import finish
from decode import decode,read_map,decode_record
from vector import companion,read_vector,decode_vector
ROOT=Path(__file__).resolve().parent

def quality(reference,estimate,fs):
    # Ignore filter start/end transients; search a small explicit lag window.
    skip=max(50,int(.05*fs));r=reference[skip:-skip];e=estimate[skip:-skip]
    maxlag=int(.01*fs);lags=range(-maxlag,maxlag+1)
    lag=max(lags,key=lambda l:np.dot(r[maxlag:-maxlag],np.roll(e,l)[maxlag:-maxlag]))
    r=r[maxlag:-maxlag];e=np.roll(e,lag)[maxlag:-maxlag]
    g=np.dot(r,e)/max(np.dot(e,e),1e-30)
    return dict(pearson=float(np.corrcoef(r,e)[0,1]),gain_aligned_snr_db=float(10*np.log10(np.dot(r,r)/max(np.sum((r-g*e)**2),1e-30))),alignment_lag_samples=int(lag),gain=float(g))

def run(long=False):
    out=ROOT/'output';out.mkdir(exist_ok=True)
    start=time.monotonic();m=encode(ROOT/'samples/original.wav',out/'sample.png');y,_=decode(out/'sample.png',out/'sample-png-decoded.wav')
    vy,vm,origin=decode_record(out/'sample.png',out/'sample-decoded.wav');assert origin=='vector'
    x,fs=load_audio(ROOT/'samples/original.wav');t=np.arange(len(y))/m['sample_rate']
    # Identical adaptive analysis + shelf and decode-side inverse/cleanup on the
    # reference isolate raster loss; also report full-band loss separately.
    prepared=prepare_audio(x,fs,m)
    ref=postprocess(np.interp(t,np.arange(len(x))/fs,prepared),m['sample_rate'],m)
    from scipy.signal import resample_poly
    gcd=math.gcd(int(m['sample_rate']),fs)
    yup=resample_poly(y,fs//gcd,int(m['sample_rate'])//gcd);full=x[:min(len(x),len(yup))];yup=yup[:len(full)]
    wavfile.write(out/'sample-bandlimited-reference.wav',int(m['sample_rate']),(np.clip(ref,-1,1)*32767).astype(np.int16))
    q=quality(ref,y,int(m['sample_rate']));assert q['pearson']>.97,q
    vref=presence(prepared,int(m['sample_rate']),m,inverse=True)[:len(vy)]
    vq=quality(vref,vy,int(m['sample_rate']));pq=quality(vref[:len(y)],y,int(m['sample_rate']))
    assert vq['gain_aligned_snr_db']>85 and vq['pearson']>pq['pearson']
    checks={}
    with tempfile.TemporaryDirectory() as temp:
        temp=Path(temp);copy=temp/'heightmap.png';shutil.copyfile(out/'sample.png',copy)
        py,pm,po=decode_record(copy);assert po=='png' and np.array_equal(y,py)
        checks['png_only_reimport_exact']=True
        physical,_=read_map(copy)
        # Standard and inverted encodings must produce identical physical height.
        sm=dict(m,height_polarity='standard');info=PngImagePlugin.PngInfo();info.add_itxt('vinyl',json.dumps(sm))
        Image.fromarray(physical.astype(np.uint16)).save(temp/'standard.png',pnginfo=info)
        sy,_=decode(temp/'standard.png');assert np.array_equal(y,sy)
        checks['standard_inverted_audio_exact']=True
        # Exercise the same finish() used by both import and upload endpoints.
        png_result=finish(temp);assert png_result['playback_source']=='png'
        shutil.copyfile(companion(out/'sample.png'),companion(copy))
        vector_result=finish(temp);assert vector_result['playback_source']=='vector'
        checks['vector_preferred_when_present']=True
        checks['vector_not_double_filtered']=bool(np.max(np.abs(vy-vref))<2e-5)
        assert checks['vector_not_double_filtered']
        pair=temp/'vector-only';pair.mkdir();shutil.copyfile(companion(copy),pair/'only.groove.wav');(pair/'only.json').write_text(json.dumps(m))
        isolated,_,vo=decode_record(pair/'only.groove.wav');assert vo=='vector' and np.array_equal(isolated,vy)
        raw_vector,_=read_vector(pair/'only.groove.wav');rasterize(raw_vector,int(m['sample_rate']),m,pair/'rebuilt.png')
        rebuilt,_=read_map(pair/'rebuilt.png');assert np.array_equal(physical,rebuilt)
        checks['vector_json_only_import_and_png_rebuild_exact']=True
        rasterize(raw_vector,int(m['sample_rate']),sm,pair/'standard-rebuilt.png')
        standard_rebuilt,_=read_map(pair/'standard-rebuilt.png');assert np.max(np.abs(standard_rebuilt-physical))<=1
        checks['vector_standard_polarity_rebuild']=True
        rate,pcm=wavfile.read(companion(copy));pcm[20]+=1;wavfile.write(temp/'wrong.groove.wav',rate,pcm)
        try:read_vector(temp/'wrong.groove.wav',m)
        except ValueError:checks['mismatched_vector_rejected']=True
        else:raise AssertionError('Mismatched vector accepted')
        with Image.open(temp/'preview.png') as im:
            preview=np.asarray(im);checks['preview_max_8bit']=int(preview.max());assert preview.max()<=28
        try: read_map(temp/'preview.png')
        except ValueError: checks['preview_import_rejected']=True
        else: raise AssertionError('Preview was importable')
        shutil.copyfile(temp/'preview.png',out/'sample-preview.png');shutil.copyfile(temp/'playback.wav',out/'sample-playback.wav')
        # Unknown polarity must fail, never silently play upside-down grooves.
        bad=dict(m,height_polarity='unsupported');info=PngImagePlugin.PngInfo();info.add_itxt('vinyl',json.dumps(bad))
        with Image.open(copy) as im: im.save(temp/'bad.png',pnginfo=info)
        try:read_map(temp/'bad.png')
        except ValueError:checks['unknown_polarity_rejected']=True
        else:raise AssertionError('Unsupported polarity accepted')
    with Image.open(out/'sample.png') as im:
        raw=np.asarray(im);checks['stored_surface_16bit']=int(raw[im.height//2,im.width//2]);checks['stored_max_16bit']=int(raw.max())
        bg=int(m.get('outside_value',0)); R=m['disc_radius_mm']; line=np.linspace(-R,R,im.width)
        inside=np.hypot(line[None,:],line[:,None])<=R
        checks['stored_outside_16bit']=int(raw[0,0]); checks['stored_disc_max_16bit']=int(raw[inside].max())
        assert bg==32768 and raw[0,0]==bg and (raw[~inside]==bg).all() and raw[inside].max()<16384
    rng=np.random.default_rng(42);noise=rng.normal(size=16000)
    err=np.max(np.abs(presence(presence(noise,16000,m),16000,m,inverse=True)-noise))
    checks['inverse_shelf_max_error']=float(err);assert err<1e-12
    # An actual old app export, without polarity or preemphasis fields.
    ly,lm=decode(ROOT/'samples/legacy-2048.png')
    assert lm['sample_rate']<=8000 and 'preemphasis' not in lm and 'height_polarity' not in lm
    lr=np.interp(np.arange(len(ly))/lm['sample_rate'],np.arange(len(x))/fs,prepare_audio(x,fs,lm))
    checks['legacy_2048_quality']=quality(lr,ly,lm['sample_rate']);assert checks['legacy_2048_quality']['pearson']>.9
    # Packing never trades away long-song duration for a larger inner radius.
    for size in (2048,4096):
        for duration in (.1,11.63475,40,41,120,121,480):
            mm=parameters(duration,size)
            end=mm['r_start_mm']-mm['pitch_mm']*(mm['lead_in_turns']+duration*mm['rpm_cut']/60+mm['lead_out_turns'])
            assert end>=mm['label_radius_mm']+2.99
            assert mm['bandlimit_hz']<=mm['bandlimit_outer_hz']<mm['sample_rate']/2
            fitted=(mm['r_start_mm']-mm['label_radius_mm']-3)/(duration*mm['rpm_cut']/60+mm['lead_in_turns']+mm['lead_out_turns'])
            assert abs(mm['pitch_mm']-min(2.,fitted))<1e-10
    checks['2048_4096_duration_packing']=True
    rep=dict(project=str(ROOT),run='python3 serve.py --port 8765',url='http://127.0.0.1:8765/',sample_metadata=m,
        quality_vs_bandlimited_original=q,quality_vs_fullband_original=quality(full,yup,fs),
        vector_vs_prepared_deemphasized_reference=vq,png_vs_same_vector_reference=pq,vector_vs_fullband_original=quality(x[:len(vy)],vy,fs),
        reference_definitions=dict(vector='Prepared mono -> inverse presence shelf only; PCM16 quantization error, no second lowpass.',png_same_vector='PNG-traced output compared with that same de-emphasized prepared reference; includes raster and cleanup changes.',png_raster_only='Prepared reference also receives PNG-side adaptive cleanup and inverse shelf; isolates raster loss.',fullband='Original mono, no cut preparation; gain-fitted comparison. Instrumental test only, not vocals.'),
        vector_format='PCM16 mono WAV of prepared displacement; r = r_nominal + amp_mm * (PCM / 32768), paired JSON metadata and SHA256. Inverse shelf only during vector playback, no second lowpass.',
        quality_definition='Legacy-named quality_vs_bandlimited_original and quality_vs_fullband_original are PNG-trace metrics. Mono source -> +6 dB minimum-phase shelf -> radius-following Hann STFT filtering -> peak normalization -> groove sample times -> identical decode-side adaptive cleanup and inverse shelf. This measures raster/centroid loss, not full-band fidelity. Gain-aligned SNR and +/-10 ms lag search exclude edge transients. Full-band comparison is separately reported.',
        checks=checks,verification_seconds=time.monotonic()-start,
        visual_fix=dict(preview='RingGeometry with label-radius hole; explicit black albedo 0x141416, roughness .42, metalness 0; dark texture used only for bump, not albedo.',label='Separate brown label at thickness + 0.3 mm with polygonOffset; no coplanar preview overlap.',lights='Hemisphere .45, key .85'),
        browser_tested=False,browser_note='Node mocked renderer/DOM tests exercise real pinned OrbitControls and Three.js camera math, including moved-camera raycast. JS syntax checked. No real browser, WebGL or listening audition; manual visual check remains.',
        caveats=['Vector avoids raster/grid loss but retains the existing adaptive preparation (~3.2–4 kHz on this sample). It cannot recover frequencies already filtered out. Still lo-fi mono.',
            '2x2 subpixel raster averaging reduces grid beating but cannot eliminate all alias/laser artifacts at 4096, especially tight long-track grooves.',
            'Custom presence shelf is not RIAA. Inverse shelf is exact digitally, but raster loss is not reversible.',
            '16-bit PNG stores physical surface heights in inverted visual polarity plus spiral/filter metadata, never hidden PCM/MP3.',
            'Playback prefers the explicit prepared vector master; PNG-only imports trace 65-point radial centroids. Neither path uses the original upload.',
            'New exports use v2 because old v1 decoders silently ignored polarity; this decoder reads both v1 and v2.',
            'Pinned three.js/OrbitControls CDN needs internet; local Python processing and audio are local.',
            '8 minutes maximum, 150 MB uploads; 2048 option has lower bandwidth and long recordings have subpixel features.'],
        files={name:str(out/name) for name in ['sample.png','sample.json','sample.groove.wav','sample-decoded.wav','sample-png-decoded.wav','sample-bandlimited-reference.wav','sample-preview.png','sample-playback.wav']})
    if long:
        rawfs,raw=wavfile.read(ROOT/'samples/original.wav'); raw=raw[::3];rawfs//=3
        ext=np.tile(raw,int(np.ceil(180*rawfs/len(raw))))[:180*rawfs]
        wavfile.write(out/'long-test.wav',rawfs,ext)
        tick=time.monotonic();lm=encode(out/'long-test.wav',out/'long-test.png');ly,_=decode(out/'long-test.png',out/'long-test-decoded.wav')
        lx,lfs=load_audio(out/'long-test.wav');lr=postprocess(np.interp(np.arange(len(ly))/lm['sample_rate'],np.arange(len(lx))/lfs,prepare_audio(lx,lfs,lm)),lm['sample_rate'],lm)
        rep['three_minute_stress_test']=dict(metadata=lm,quality=quality(lr,ly,int(lm['sample_rate'])),seconds=time.monotonic()-tick,source='Original instrumental demo slowed 3x then tiled to 180 seconds; not a vocal benchmark.')
    (ROOT/'report.json').write_text(json.dumps(rep,indent=2))
    print(json.dumps({k:v for k,v in rep.items() if k in ('quality_vs_bandlimited_original','quality_vs_fullband_original','vector_vs_prepared_deemphasized_reference','png_vs_same_vector_reference','vector_vs_fullband_original','checks','three_minute_stress_test')},indent=2))
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--long',action='store_true');a=p.parse_args();run(a.long)
