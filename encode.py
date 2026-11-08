"""Prepare a vector groove master and rasterize its portable 16-bit depth PNG."""
import argparse, json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.signal import butter, sosfiltfilt
from audio_filters import adaptive_bandlimit, presence, radius_cutoff, shelf_coefficients
from vector import write_vector, companion

MAX_SECONDS = 480

def load_audio(path):
    p = subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(path),'-t',str(MAX_SECONDS),'-f','f32le','-ac','1','-ar','16000','pipe:1'], capture_output=True, check=True, timeout=120)
    x = np.frombuffer(p.stdout, '<f4').astype(float)
    if len(x) < 1600: raise ValueError('Audio must be at least 0.1 seconds long.')
    x = np.nan_to_num(x)
    return x, 16000

def parameters(duration, size=4096):
    radius = 90.0 if duration <= 40 else 150.0
    label = 27.0 if radius == 90 else 43.0
    rpm = 45.0 if duration <= 120 else 33.3333333333
    start = radius - 4
    lead = .35
    turns = duration * rpm / 60
    fitted_pitch = (start - label - 3) / (turns + lead + .5)
    # Spare radial room on short clips is better left unused near the label.
    # A 2 mm pitch retains the full .3 mm swing/.8 mm groove width; long
    # recordings keep their tighter fitted pitch and still fit in full.
    pitch = min(fitted_pitch, 2.0)
    fs = 16000
    m = dict(encoding_version='vinyl-heightmap-lateral-v2', rpm_cut=rpm,
        pitch_mm=pitch, r_start_mm=start, disc_radius_mm=radius,
        label_radius_mm=label, amp_mm=min(.30, pitch*.16),
        groove_width_mm=min(.8,pitch*.50), groove_depth_mm=.45,
        thickness_mm=2.5, sample_rate=fs, duration_sec=duration,
        lead_in_turns=lead, lead_out_turns=.5, image_size=size,
        height_scale_mm=2.55,
        audio_storage='Explicit prepared-displacement vector master + PNG depth export; never the original upload.',
        riaa='none (custom reversible presence shelf, not RIAA)', max_duration_sec=MAX_SECONDS,
        warning='Raster-limited lo-fi mono. Files over 8 min are truncated. Not a physical stylus simulator.')

    m.update(packing_mode='outer-band-if-room-v1', height_polarity='inverted', bandlimit_mode='radius-following-v1', bandlimit_cap_hz=6500.,
        filter_window_samples=1024, filter_hop_samples=256, raster_subsamples=4,
        preemphasis='presence-shelf-v1', presence_shelf=dict(frequency_hz=1500.,gain_db=6.,slope=1.),
        outside_value=32768, outside_fill='mid-grey')
    m['bandlimit_hz']=float(radius_cutoff(duration,m))
    m['bandlimit_outer_hz']=float(radius_cutoff(0,m))
    b,a=shelf_coefficients(fs);m['presence_shelf'].update(b=b.tolist(),a=a.tolist(),coefficient_sample_rate=fs)
    return m

def prepare_audio(x, fs, m):
    x = x - np.mean(x)
    if m.get('bandlimit_mode') == 'radius-following-v1':
        x = adaptive_bandlimit(presence(x,fs,m),fs,m)
    else:
        x = sosfiltfilt(butter(6, m['bandlimit_hz'], fs=fs, output='sos'), x)
    peak = np.max(np.abs(x))
    if peak > 1e-9: x *= .90 / peak
    return x

def encode(path, out, size=4096):
    if size not in (2048,4096): raise ValueError('Choose a 2048 or 4096 map.')
    x, fs = load_audio(path)
    m = parameters(len(x)/fs, size)
    x = prepare_audio(x, fs, m)
    out=Path(out);out.parent.mkdir(parents=True,exist_ok=True)
    x=write_vector(companion(out),x,m)
    rasterize(x,fs,m,out)
    return m

def rasterize(x, fs, m, out):
    """Export an already prepared vector to PNG; never re-filter it."""
    size=int(m['image_size'])
    # Raster evaluated analytically in row chunks; no audio stored in metadata.
    n=size; R=m['disc_radius_mm']; start=m['r_start_mm']; pitch=m['pitch_mm']
    scale=2*R/(n-1); line=np.linspace(-R,R,n)
    result=np.zeros((n,n),dtype=np.uint16)
    end=m['lead_in_turns']+m['duration_sec']*m['rpm_cut']/60 + m['lead_out_turns']
    samples=np.arange(len(x))
    for row in range(0,n,64):
        accum=np.zeros((min(64,n-row),n))
        # 2x2 physical subpixel average, before quantization.
        for oy in (-.25,.25):
            for ox in (-.25,.25):
                xx=line[None,:]+ox*scale; yy=-line[row:row+64,None]-oy*scale
                rr=np.hypot(xx,yy)
                phi=np.mod(-np.arctan2(yy,xx),2*np.pi)
                k=np.rint((start-rr)/pitch-phi/(2*np.pi))
                turns=k+phi/(2*np.pi)
                t=(turns-m['lead_in_turns'])*60/m['rpm_cut']
                disp=np.interp(t*fs,samples,x,left=0,right=0)*m['amp_mm']
                delta=rr-(start-pitch*turns+disp)
                valley=np.maximum(0,1-np.abs(delta)/(m['groove_width_mm']/2))
                valley *= (turns>=0)&(turns<=end)
                z=m['thickness_mm']-m['groove_depth_mm']*valley
                accum+=z/4
        rr=np.hypot(line[None,:],line[row:row+64,None])
        physical_u16=accum/m['height_scale_mm']*65535
        stored=65535-physical_u16 if m.get('height_polarity','standard')=='inverted' else physical_u16
        bg=int(m.get('outside_value',0))
        result[row:row+64]=np.where(rr<=R,np.rint(np.clip(stored,0,65535)),bg).astype(np.uint16)
    info=PngImagePlugin.PngInfo(); info.add_itxt('vinyl',json.dumps(m))
    out=Path(out); out.parent.mkdir(parents=True,exist_ok=True)
    Image.fromarray(result).save(out,pnginfo=info)
    out.with_suffix('.json').write_text(json.dumps(m,indent=2))
    return m

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('audio'); p.add_argument('png'); p.add_argument('--size',type=int,default=4096)
    a=p.parse_args(); print(json.dumps(encode(a.audio,a.png,a.size),indent=2))
