#!/usr/bin/env python3
"""Local-only tech demo. No Flask or Node required."""
import argparse, json, mimetypes, shutil, threading, time, traceback, uuid
from email.parser import BytesParser
from email.policy import default
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import numpy as np
from PIL import Image
from encode import encode, rasterize, read_extras
from decode import decode, decode_record, read_map
from vector import read_vector, companion, decode_vector

ROOT=Path(__file__).resolve().parent
OUTPUT=ROOT/'output'; OUTPUT.mkdir(exist_ok=True)
# Windows reads MIME types from the registry, where .js is often text/plain;
# browsers then refuse view.js as a module. Pin the types the app serves.
TYPES={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8',
    '.json':'application/json','.png':'image/png','.wav':'audio/wav','.woff2':'font/woff2','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'}
LOCAL_HOSTS=('localhost','127.0.0.1')
KEEP_DAYS=7.0
LOCK=threading.Semaphore(1)
MAX_UPLOAD=150*1024*1024
PAGES={'/':'index.html','/cutter':'cutter.html','/player':'player.html','/room':'room.html'}
# Stage-level progress for long cuts. The browser sends X-Job (32 hex) with a POST
# and polls GET /api/progress?job=... from another thread. Stages are real
# checkpoints in the existing pipeline, not a timer.
STAGES=('received','cutting','tracing','proofing','done')
PROGRESS={};PROGRESS_LOCK=threading.Lock()

def set_stage(job,stage,**extra):
    if not job:return
    with PROGRESS_LOCK:
        entry=PROGRESS.setdefault(job,dict(started=time.time()))
        entry.update(stage=stage,index=STAGES.index(stage) if stage in STAGES else -1,total=len(STAGES)-1,**extra)
        for k in [k for k,v in PROGRESS.items() if time.time()-v['started']>3600]:PROGRESS.pop(k,None)

def valid_id(ident):
    return isinstance(ident,str) and len(ident)==32 and all(c in '0123456789abcdef' for c in ident)

def write_playback(audio, fs, dest):
    from scipy.io import wavfile
    fs=int(fs)
    if fs!=16000:  # legacy maps (e.g. 8 kHz); new cuts are already 16 kHz
        import math
        from scipy.signal import resample_poly
        g=math.gcd(fs,16000);audio=resample_poly(audio,16000//g,fs//g)
    wavfile.write(dest,16000,(np.clip(audio,-1,1)*32767).astype(np.int16))

def purge_output(keep_days=None):
    """Delete job folders older than KEEP_DAYS (0 disables). Never touches
    loose files in output/ (verify.py's sample.* lives there)."""
    days=KEEP_DAYS if keep_days is None else keep_days
    if days<=0:return 0
    cutoff=time.time()-days*86400;removed=0
    for folder in OUTPUT.iterdir():
        try:
            if folder.is_dir() and valid_id(folder.name) and folder.stat().st_mtime<cutoff:
                shutil.rmtree(folder,ignore_errors=True);removed+=1
        except OSError:pass
    return removed


def write_preview(png, dest, m):
    """8-bit viewing picture: stored heights as grey, classic red paper label."""
    with Image.open(png) as im:
        stored=np.asarray(im,dtype=np.uint16)
    if stored.ndim==3:
        stored=stored[...,1]
    grey=(stored/257).astype(np.uint8)
    rgb=np.stack([grey,grey,grey],axis=-1)
    R=float(m['disc_radius_mm']); label=float(m['label_radius_mm']); n=grey.shape[0]
    line=np.linspace(-R,R,n)
    rgb[np.hypot(line[None,:],line[:,None])<=label]=(196,36,32)
    Image.fromarray(rgb).resize((1024,1024)).save(dest)

def finish(folder, step=lambda stage:None):
    png=folder/'heightmap.png'
    step('tracing')
    audio,m,origin=decode_record(png,folder/'decoded.wav')
    (folder/'heightmap.json').write_text(json.dumps(m,indent=2))
    fs=int(m['sample_rate'])
    write_playback(audio,fs,folder/'playback.wav')
    has_vector=companion(png).exists()
    if origin=='vector' or has_vector:
        write_playback(audio,fs,folder/'playback-vector.wav')
        png_audio,_=decode(png,folder/'decoded-png.wav')
        write_playback(png_audio,fs,folder/'playback-png.wav')
    else:
        write_playback(audio,fs,folder/'playback-png.wav')
    step('proofing')
    # Every displayed pixel derives from the input PNG; this is an 8-bit preview,
    # not the portable data file. Do not re-import it as if it were a height map.
    write_preview(png, folder/'preview.png', m)
    cover,tags=read_extras(png)
    if cover:(folder/'cover.jpg').write_bytes(cover)
    meta=dict(id=folder.name,metadata=m,base='/output/'+folder.name+'/',cover=('/output/'+folder.name+'/cover.jpg') if cover else None,tags=tags,playback_source=origin,has_vector=has_vector,has_png=True,audio_origin=('Both sources ready: use Playback to hear the vector master or the PNG trace. Never the original upload.' if has_vector else 'PNG-only: traced from heightmap.png pixels; no vector or original upload is used.'))
    (folder/'record.json').write_text(json.dumps(meta,indent=2));return meta

class Handler(BaseHTTPRequestHandler):
    def local_host(self):
        # Blocks DNS-rebinding pages from reading records through this server.
        host=self.headers.get('Host','')
        return host.rsplit(':',1)[0] if ':' in host else host
    def reply(self,body,status=200):
        data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.local_host() not in LOCAL_HOSTS:self.send_error(403);return
        url=urlparse(self.path);route=url.path
        if route=='/api/progress':
            job=parse_qs(url.query).get('job',[''])[0]
            with PROGRESS_LOCK:entry=dict(PROGRESS.get(job) or {})
            if not entry:self.reply({'stage':'unknown','index':-1,'total':len(STAGES)-1});return
            entry['elapsed']=round(time.time()-entry.pop('started'),2);self.reply(entry);return
        page=route.rstrip('/') or '/'
        if page in ('/player', '/cutter', '/room'):
            self.send_response(302)
            self.send_header('Location', page + '.html')
            self.end_headers()
            return
        if page == '/' or route == '/index.html':
            path = ROOT / 'index.html'
        elif route in ('/player.html', '/cutter.html', '/room.html'):
            path = ROOT / route.lstrip('/')
        elif route.startswith('/static/') or route.startswith('/output/') or route.startswith('/demo/'):
            path = ROOT / route.lstrip('/')
        elif route == '/samples/original.wav':
            path = ROOT / 'samples/original.wav'
        else:
            self.send_error(404)
            return
        path=path.resolve()
        if not path.is_relative_to(ROOT) or not path.is_file():self.send_error(404);return
        content=TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path)[0] or 'application/octet-stream'
        self.send_response(200);self.send_header('Cache-Control','no-store');self.send_header('Content-Type',content);self.send_header('Content-Length',str(path.stat().st_size));self.end_headers()
        try:
            with path.open('rb') as f:
                while data:=f.read(1024*1024):self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_POST(self):
        # Local process only. Reject cross-origin writes / DNS-rebinding hosts.
        host=self.local_host()
        origin=self.headers.get('Origin')
        route=urlparse(self.path).path
        if route not in ('/api/encode','/api/import','/api/sample'):self.reply({'error':'Unknown endpoint'},404);return
        if host not in LOCAL_HOSTS or (origin and origin not in ('http://'+self.headers.get('Host',''),)):
            self.reply({'error':'Local same-origin requests only.'},403);return
        if not LOCK.acquire(blocking=False):self.reply({'error':'Already processing a record. Please wait.'},429);return
        folder=None;job=None
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length>MAX_UPLOAD or length<0:raise ValueError('Upload limit: 150 MB.')
            job=self.headers.get('X-Job','')
            if not valid_id(job):job=None
            data=self.rfile.read(length)
            set_stage(job,'received')
            folder=OUTPUT/uuid.uuid4().hex;folder.mkdir()
            set_stage(job,'cutting')
            if route=='/api/sample':encode(ROOT/'samples/original.wav',folder/'heightmap.png')
            else:
                ctype=self.headers.get('Content-Type','')
                if not ctype.startswith('multipart/form-data;'):raise ValueError('Use a multipart file upload.')
                form=BytesParser(policy=default).parsebytes(('Content-Type: '+ctype+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+data)
                fields={part.get_param('name',header='content-disposition'):part.get_payload(decode=True) for part in form.iter_parts()}
                blob=fields.get('file')
                if route=='/api/encode':
                    if not blob:raise ValueError('Pick audio first.')
                    source=folder/'source-upload';source.write_bytes(blob)
                    # tags/cover the browser already read from the file (or a picture the user
                    # chose); missing ones are probed from the upload by FFmpeg
                    try:tags=json.loads(fields['tags']) if fields.get('tags') else None
                    except ValueError:tags=None
                    try:encode(source,folder/'heightmap.png',int(fields.get('size',b'4096')),cover=fields.get('cover') or None,tags=tags)
                    finally:source.unlink(missing_ok=True)
                else:
                    vector=fields.get('vector')
                    metadata=fields.get('metadata')
                    if blob:
                        (folder/'heightmap.png').write_bytes(blob)
                        if metadata:(folder/'heightmap.json').write_bytes(metadata)
                        if vector:companion(folder/'heightmap.png').write_bytes(vector)
                    elif vector and metadata:
                        m=json.loads(metadata)
                        master=companion(folder/'heightmap.png');master.write_bytes(vector)
                        x,m=read_vector(master,m)
                        rasterize(x,int(m['sample_rate']),m,folder/'heightmap.png')
                    else:raise ValueError('Pick a PNG, or a vector WAV plus matching JSON.')
            result=finish(folder,lambda stage:set_stage(job,stage))
            set_stage(job,'done');self.reply(result)
        except Exception as e:
            # A failed job leaves nothing behind in output/.
            if folder is not None:shutil.rmtree(folder,ignore_errors=True)
            set_stage(job,'error',error=str(e))
            traceback.print_exc();self.reply({'error':str(e)},400)
        finally:
            LOCK.release()
            try:purge_output()
            except Exception:pass

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8765)
    p.add_argument('--keep-days',type=float,default=KEEP_DAYS,help='delete output/ job folders older than this (0 keeps everything)')
    a=p.parse_args();KEEP_DAYS=a.keep_days
    removed=purge_output()
    base=f'http://127.0.0.1:{a.port}'
    if removed:print(f'Cleared {removed} old job folder(s) from output/.',flush=True)
    print(f'Vinyl Sim (Ctrl+C to stop):\n  Home    {base}/\n  Cutter  {base}/cutter\n  Player  {base}/player\n  Room    {base}/room',flush=True)
    ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
