"""Prepare a vector groove master and rasterize its portable 16-bit depth PNG."""
import argparse, base64, io, json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.signal import butter, sosfiltfilt
from audio_filters import adaptive_bandlimit, presence, radius_cutoff, shelf_coefficients
from vector import write_vector, companion

# 4:30 keeps each groove's sideways swing at about 1.45 px or more on a 4096 map;
# longer cuts pack the spiral so tight the PNG trace turns to buzz.
MAX_SECONDS = 270

def load_audio(path, info=None):
    # -protocol_whitelist stops playlist-style inputs (HLS/concat) reaching
    # other files or the network; only the uploaded file itself is read.
    cmd=['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',str(path),'-t',str(MAX_SECONDS+1),'-f','f32le','-ac','1','-ar','16000','pipe:1']
    try:
        p = subprocess.run(cmd, capture_output=True, check=True, timeout=300)
    except FileNotFoundError:
        raise ValueError('FFmpeg was not found. Install it and make sure "ffmpeg" runs from a terminal (it must be on PATH).') from None
    except subprocess.TimeoutExpired:
        raise ValueError('FFmpeg took too long to read that file.') from None
    except subprocess.CalledProcessError as e:
        detail=(e.stderr or b'').decode('utf-8','replace').strip().splitlines()
        raise ValueError('FFmpeg could not read that audio file'+(': '+detail[-1] if detail else '.')) from None
    x = np.frombuffer(p.stdout, '<f4').astype(float)
    truncated = len(x) > MAX_SECONDS*16000
    x = x[:MAX_SECONDS*16000]
    if info is not None: info['truncated'] = bool(truncated)
    if len(x) < 1600: raise ValueError('Audio must be at least 0.1 seconds long.')
    x = np.nan_to_num(x, nan=0.0, posinf=1.0, neginf=-1.0)
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
        warning='Raster-limited lo-fi mono. Audio past 4:30 is left off. Not a physical stylus simulator.')

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

COVER_PREFIX='data:image/jpeg;base64,'
TAG_KEYS=('title','artist','album','year')

def clean_tags(tags):
    out={}
    if isinstance(tags,dict):
        for k in TAG_KEYS:
            v=tags.get(k)
            if isinstance(v,str) and v.strip(): out[k]=' '.join(v.split())[:200]
    return out

def probe_tags(path):
    """Title/artist/album/year from any container FFmpeg reads (ffmetadata dump)."""
    try:
        p=subprocess.run(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',str(path),'-f','ffmetadata','pipe:1'],capture_output=True,timeout=60)
    except (OSError,subprocess.TimeoutExpired): return {}
    found={}
    for line in p.stdout.decode('utf-8','replace').splitlines():
        if '=' not in line or line.startswith((';','[')): continue
        k,v=line.split('=',1);k=k.strip().lower();v=v.replace('\\=','=').replace('\\;',';').replace('\\#','#')
        key={'title':'title','artist':'artist','album_artist':None,'album':'album','date':'year','year':'year'}.get(k)
        if key and key not in found: found[key]=v[:4] if key=='year' else v
    return clean_tags(found)

def probe_cover(path):
    """The embedded front cover (an attached-picture stream), if the file has one."""
    try:
        p=subprocess.run(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',str(path),'-an','-map','0:v:0','-frames:v','1','-c:v','mjpeg','-f','image2pipe','pipe:1'],capture_output=True,timeout=60)
    except (OSError,subprocess.TimeoutExpired): return None
    return p.stdout if p.returncode==0 and len(p.stdout)>64 else None

def normalise_cover(data):
    """Any image -> JPEG no wider than 600 px, as a data URL; re-encoding also sanitises uploads."""
    if not data or len(data)>20*1024*1024: return None
    try:
        with Image.open(io.BytesIO(data)) as im:
            im=im.convert('RGB');im.thumbnail((600,600))
            buf=io.BytesIO();im.save(buf,'JPEG',quality=82,optimize=True);return COVER_PREFIX+base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None

def source_extras(path, cover=None, tags=None):
    """Tags and cover for the record: what the browser sent, else what FFmpeg finds in the file."""
    tags=clean_tags(tags) if tags else probe_tags(path)
    cover_url=normalise_cover(cover) if cover else normalise_cover(probe_cover(path))
    extras={}
    if tags: extras['vinyl-tags']=json.dumps(tags)
    if cover_url: extras['vinyl-cover']=cover_url
    return extras

LABEL_DEPTH_MM=.45  # the title is cut as deep as the groove, so it reads at the same grey
def label_relief(m, tags, n):
    """The record's title, artist and rings pressed into the label area as greyscale relief:
    an n x n coverage mask (0..1), or None without a title. The label lies inside the
    run-out, which the decoder never samples, so the sound is untouched."""
    title=(tags or {}).get('title')
    if not title: return None
    from PIL import ImageDraw, ImageFont
    R=m['disc_radius_mm'];L=m['label_radius_mm']-.6;ppm=(n-1)/(2*R);Lp=L*ppm;S=int(2*Lp)+4;c=S/2
    def font(px):
        for name in ('DejaVuSerif.ttf','georgia.ttf','Georgia.ttf','DejaVuSans.ttf'):
            try: return ImageFont.truetype(name,max(8,int(px)))
            except OSError: pass
        try: return ImageFont.load_default(size=max(8,int(px)))
        except TypeError: return ImageFont.load_default()
    img=Image.new('L',(S,S),0);d=ImageDraw.Draw(img);w=max(1,int(Lp*.014))
    for r in (.96,.9,.24): d.ellipse([c-Lp*r,c-Lp*r,c+Lp*r,c+Lp*r],outline=255,width=w)
    def fit(text,px,width):
        f=font(px)
        while px>8 and d.textlength(text,font=f)>width: px*=.92;f=font(px)
        return f
    def wrap(text,px,width):
        words=text.split();lines=[];cur=''
        for wd in words:
            trial=(cur+' '+wd).strip()
            if cur and d.textlength(trial,font=font(px))>width: lines.append(cur);cur=wd
            else: cur=trial
        lines.append(cur);return lines[:2]
    up=title.upper();lines=wrap(up,Lp*.17,Lp*1.3)
    y=c-Lp*.6
    for ln in lines:
        f=fit(ln,Lp*.17,Lp*1.4);d.text((c,y),ln,fill=255,font=f,anchor='mm');y+=Lp*.2
    artist=(tags or {}).get('artist')
    if artist: d.text((c,c+Lp*.48),artist.upper()[:40],fill=255,font=fit(artist.upper()[:40],Lp*.1,Lp*1.3),anchor='mm')
    rpm=m['rpm_cut'];sec=int(m['duration_sec'])
    small=f"{'33 1/3' if abs(rpm-100/3)<.05 else round(rpm)} RPM  ·  {sec//60}:{sec%60:02d}"
    d.text((c,c+Lp*.68),small,fill=255,font=fit(small,Lp*.075,Lp*1.0),anchor='mm')
    mask=np.zeros((n,n),dtype=np.float32);a=np.asarray(img,dtype=np.float32)/255
    o=int(round((n-1)/2-c));y0=max(0,o);x0=max(0,o)
    mask[y0:y0+S,x0:x0+S]=a[y0-o:y0-o+min(S,n-y0),x0-o:x0-o+min(S,n-x0)][:n-y0,:n-x0]
    line=np.linspace(-R,R,n);rr=np.hypot(line[None,:],line[:,None])
    mask*=(rr<L)&(rr>4.2) # never past the label edge, never into the spindle hole
    return mask

def read_extras(png):
    """(cover JPEG bytes or None, tags dict or None) from a record PNG."""
    with Image.open(png) as im: info=dict(im.info)
    cover=None;url=info.get('vinyl-cover')
    if isinstance(url,str) and url.startswith(COVER_PREFIX):
        try: cover=base64.b64decode(url[len(COVER_PREFIX):],validate=True)
        except Exception: cover=None
    try: tags=clean_tags(json.loads(info['vinyl-tags'])) if info.get('vinyl-tags') else None
    except Exception: tags=None
    return cover,(tags or None)

def encode(path, out, size=4096, cover=None, tags=None):
    if size not in (2048,4096): raise ValueError('Choose a 2048 or 4096 map.')
    info = {}
    x, fs = load_audio(path, info)
    m = parameters(len(x)/fs, size)
    m['source_truncated'] = info.get('truncated', False)
    x = prepare_audio(x, fs, m)
    out=Path(out);out.parent.mkdir(parents=True,exist_ok=True)
    x=write_vector(companion(out),x,m)
    rasterize(x,fs,m,out,source_extras(path,cover,tags))
    return m

def rasterize(x, fs, m, out, extras=None):
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
    tags=json.loads((extras or {}).get('vinyl-tags') or '{}')
    relief=label_relief(m,tags,n)
    if relief is not None:
        dv=relief*(LABEL_DEPTH_MM/m['height_scale_mm']*65535)  # deeper = higher stored value when inverted
        res=result.astype(np.float64)+(dv if m.get('height_polarity','standard')=='inverted' else -dv)
        result=np.rint(np.clip(res,0,65535)).astype(np.uint16)
    info=PngImagePlugin.PngInfo(); info.add_itxt('vinyl',json.dumps(m))
    for k,v in (extras or {}).items(): info.add_itxt(k,v)
    out=Path(out); out.parent.mkdir(parents=True,exist_ok=True)
    Image.fromarray(result).save(out,pnginfo=info)
    out.with_suffix('.json').write_text(json.dumps(m,indent=2))
    return m

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('audio'); p.add_argument('png'); p.add_argument('--size',type=int,default=4096)
    a=p.parse_args(); print(json.dumps(encode(a.audio,a.png,a.size),indent=2))
