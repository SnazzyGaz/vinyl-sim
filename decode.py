"""Decode explicit vector masters or trace PNG groove pixels; never source uploads."""
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from scipy.io import wavfile
from audio_filters import postprocess

def validate_metadata(m, size=None):
    size=m.get("image_size") if size is None else size
    if size not in (2048,4096): raise ValueError("Expected 2048 or 4096 map dimensions.")
    if m.get('encoding_version') not in ('vinyl-heightmap-lateral-v1','vinyl-heightmap-lateral-v2'): raise ValueError('Unsupported map encoding.')
    keys=['rpm_cut','pitch_mm','r_start_mm','disc_radius_mm','label_radius_mm','amp_mm','groove_width_mm','groove_depth_mm','thickness_mm','sample_rate','duration_sec','lead_in_turns','bandlimit_hz','height_scale_mm']
    for k in keys:
        if not isinstance(m.get(k),(int,float)) or not np.isfinite(m[k]) or m[k]<=0: raise ValueError('Invalid metadata: '+k)
    if not (0.1<=m['duration_sec']<=480 and 800<=m['sample_rate']<=16000 and 1<=m['rpm_cut']<=100 and m['groove_width_mm']<m['pitch_mm'] and m['amp_mm']<m['pitch_mm']*.3 and m['image_size']==size):
        raise ValueError('Out-of-range groove metadata.')
    polarity=m.get('height_polarity','standard')
    if polarity not in ('standard','inverted'): raise ValueError('Unsupported height polarity.')
    if m.get('preemphasis') not in (None,'presence-shelf-v1'): raise ValueError('Unsupported preemphasis.')
    if m.get('bandlimit_mode') not in (None,'radius-following-v1'): raise ValueError('Unsupported bandlimit mode.')
    if not (0<m['bandlimit_hz']<m['sample_rate']/2): raise ValueError('Invalid cutoff.')
    if m.get('preemphasis'):
        p=m.get('presence_shelf',{})
        if not (0<p.get('frequency_hz',0)<m['sample_rate']*.45 and 0<=p.get('gain_db',-1)<=12 and p.get('slope',1)==1): raise ValueError('Invalid shelf.')
    if m.get('bandlimit_mode'):
        if not (m['bandlimit_hz']<=m.get('bandlimit_outer_hz',0)<=6500 and 0<m.get('bandlimit_cap_hz',0)<=6500 and m.get('filter_window_samples')==1024 and m.get('filter_hop_samples')==256): raise ValueError('Invalid adaptive bandwidth.')
    return m

def read_map(path):
    with Image.open(path) as im:
        if im.width != im.height or im.width not in (2048,4096):
            raise ValueError('Expected a square 2048 or 4096 app height map.')
        if im.mode not in ('I;16','I;16B','I'):
            raise ValueError('Expected a 16-bit grayscale height map, not an RGB preview.')
        raw=im.info.get('vinyl')
        if not raw:
            side=Path(path).with_suffix('.json')
            if not side.exists(): raise ValueError('No vinyl metadata. Use an app-exported PNG (keep its metadata).')
            raw=side.read_text()
        m=json.loads(raw)
        validate_metadata(m,im.width)
        polarity=m.get('height_polarity','standard')
        image=np.array(im,dtype=np.float32)
        if polarity=='inverted':
            R=m['disc_radius_mm'];line=np.linspace(-R,R,im.width)
            for row in range(0,im.height,64):
                inside=np.hypot(line[None,:],line[row:row+64,None])<=R
                image[row:row+64]=np.where(inside,65535-image[row:row+64],0)
        return image,m

def decode(path, out=None):
    image,m=read_map(path); n=image.shape[0]
    fs=int(m['sample_rate']); count=int(m['duration_sec']*fs)
    signal=np.empty(count)
    # Integrate physical depth across a radial slice to locate the V valley centroid.
    # The neighboring groove is excluded; subpixel interpolation estimates its
    # center rather than selecting a quantized darkest pixel.
    span=m['amp_mm']+m['groove_width_mm']/2
    offsets=np.linspace(-span,span,65)
    for lo in range(0,count,4096):
        t=np.arange(lo,min(count,lo+4096))/fs
        theta=2*np.pi*(m['lead_in_turns']+t*m['rpm_cut']/60)
        nominal=m['r_start_mm']-m['pitch_mm']*theta/(2*np.pi)
        r=nominal[:,None]+offsets
        px=(r*np.cos(-theta[:,None])+m['disc_radius_mm'])*(n-1)/(2*m['disc_radius_mm'])
        py=(m['disc_radius_mm']-r*np.sin(-theta[:,None]))*(n-1)/(2*m['disc_radius_mm'])
        v=map_coordinates(image,[py.ravel(),px.ravel()],order=1,mode='nearest').reshape(r.shape)
        depth=np.maximum(0,m['thickness_mm']-v/65535*m['height_scale_mm'])
        signal[lo:lo+len(t)]=(depth@offsets)/np.maximum(depth.sum(axis=1),1e-9)/m['amp_mm']
    signal-=np.mean(signal)
    # Same declared raster bandwidth, not a source waveform enhancement.
    signal=postprocess(signal,fs,m)
    if out: wavfile.write(out,fs,(np.clip(signal,-1,1)*32767).astype(np.int16))
    return signal,m

def decode_record(path, out=None, vector=None):
    """Prefer a declared vector companion; PNG-only imports still trace pixels."""
    from vector import read_vector, decode_vector, companion
    path=Path(path)
    if path.suffix.lower()=='.wav':
        signal,m=decode_vector(path)
        origin='vector'
    else:
        _,m=read_map(path)
        candidate=Path(vector) if vector else companion(path)
        if candidate.exists():
            signal,m=decode_vector(candidate,m);origin='vector'
        else:
            signal,m=decode(path);origin='png'
    if out: wavfile.write(out,int(m['sample_rate']),(np.clip(signal,-1,1)*32767).astype(np.int16))
    return signal,m,origin

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('record');p.add_argument('wav');p.add_argument('--png-only',action='store_true');a=p.parse_args()
    if a.png_only:s,m=decode(a.record,a.wav);origin='png'
    else:s,m,origin=decode_record(a.record,a.wav)
    print(f"Decoded {len(s)} samples at {m['sample_rate']} Hz FROM {origin}")
