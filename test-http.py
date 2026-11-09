"""Optional actual HTTP regression; loopback-only server always shuts down."""
import threading, json, urllib.request, urllib.error, uuid, shutil
from pathlib import Path
from http.server import ThreadingHTTPServer
import serve


def ensure_sample():
    # output/ is git-ignored: cut the reference record on a fresh clone.
    if not all((serve.ROOT/('output/sample'+e)).exists() for e in ('.png','.groove.wav','.json')):
        from encode import encode
        encode(serve.ROOT/'samples/original.wav',serve.ROOT/'output/sample.png')


def run():
    ensure_sample()
    server=ThreadingHTTPServer(('127.0.0.1',0),serve.Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base='http://127.0.0.1:'+str(server.server_port);folders=[]
    def post(route,fields):
        boundary=uuid.uuid4().hex;body=b''
        for name,value in fields.items():
            body+=('--'+boundary+'\r\nContent-Disposition: form-data; name="'+name+'"\r\n\r\n').encode()+value+b'\r\n'
        body+=('--'+boundary+'--\r\n').encode()
        request=urllib.request.Request(base+route,body,{'Content-Type':'multipart/form-data; boundary='+boundary,'Origin':base},method='POST')
        with urllib.request.urlopen(request,timeout=60) as response:return json.load(response)
    try:
        with urllib.request.urlopen(base) as response:home=response.read().lower();assert b'href="cutter.html"' in home and b'href="player.html"' in home and b'href="room.html"' in home
        for page,marker in (('/cutter',b'id="saveset"'),('/cutter/',b'id="saveset"'),('/player',b'right-drag'),('/player/',b'right-drag')):
            with urllib.request.urlopen(base+page) as response:assert marker in response.read().lower(),page
        with urllib.request.urlopen(base+'/api/progress?job='+'0'*32) as response:assert json.load(response)['stage']=='unknown'
        try:urllib.request.urlopen(urllib.request.Request(base+'/index.html',headers={'Host':'evil.example'}));raise AssertionError('Foreign Host served')
        except urllib.error.HTTPError as e:assert e.code==403
        with urllib.request.urlopen(base+'/static/view.js') as response:assert response.headers['Content-Type']=='text/javascript'
        imported=post('/api/import',{'file':(serve.ROOT/'output/sample.png').read_bytes()});folders.append(serve.OUTPUT/imported['id'])
        assert imported['playback_source']=='png' and not imported['has_vector']
        assert imported['metadata']['height_polarity']=='inverted' and imported['metadata']['sample_rate']==16000
        with urllib.request.urlopen(base+imported['base']+'playback.wav') as response:assert response.read(4)==b'RIFF'
        vector_blob=(serve.ROOT/'output/sample.groove.wav').read_bytes();metadata_blob=(serve.ROOT/'output/sample.json').read_bytes()
        paired=post('/api/import',{'file':(serve.ROOT/'output/sample.png').read_bytes(),'vector':vector_blob});folders.append(serve.OUTPUT/paired['id'])
        assert paired['playback_source']=='vector' and paired['has_vector']
        isolated=post('/api/import',{'vector':vector_blob,'metadata':metadata_blob});folders.append(serve.OUTPUT/isolated['id'])
        assert isolated['playback_source']=='vector' and (folders[-1]/'heightmap.png').exists()
        assert (folders[-1]/'decoded.wav').read_bytes()==(folders[-2]/'decoded.wav').read_bytes()
        with urllib.request.urlopen(base+paired['base']+'heightmap.groove.wav') as response:
            assert response.read()==vector_blob and response.headers['Cache-Control']=='no-store'
        cut=post('/api/encode',{'file':(serve.ROOT/'samples/original.wav').read_bytes(),'size':b'2048'});folders.append(serve.OUTPUT/cut['id'])
        assert cut['metadata']['image_size']==2048 and cut['metadata']['height_polarity']=='inverted'
        assert cut['playback_source']=='vector' and cut['has_vector']
        assert not (folders[-1]/'source-upload').exists()
        # A tagged MP3: FFmpeg finds the title and cover; the record serves cover.jpg.
        import subprocess,tempfile,io
        from PIL import Image
        with tempfile.TemporaryDirectory() as td:
            td=Path(td);Image.new('RGB',(300,300),(20,80,150)).save(td/'c.jpg')
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(serve.ROOT/'samples/original.wav'),'-i',str(td/'c.jpg'),'-map','0','-map','1','-c:a','libmp3lame','-id3v2_version','3','-metadata','title=Raster Serenade','-metadata','artist=The Pixel Quartet','-c:v','copy','-disposition:v','attached_pic',str(td/'s.mp3')],check=True)
            tagged=post('/api/encode',{'file':(td/'s.mp3').read_bytes(),'size':b'2048'});folders.append(serve.OUTPUT/tagged['id'])
        assert tagged['tags']=={'title':'Raster Serenade','artist':'The Pixel Quartet'} and tagged['cover'].endswith('/cover.jpg')
        with urllib.request.urlopen(base+tagged['cover']) as response:assert Image.open(io.BytesIO(response.read())).size==(300,300)
        # A cover chosen in the browser (sent with the upload) wins over the file's own.
        buf=io.BytesIO();Image.new('RGB',(900,600),(200,40,30)).save(buf,'PNG')
        chosen=post('/api/encode',{'file':(serve.ROOT/'samples/original.wav').read_bytes(),'size':b'2048','cover':buf.getvalue(),'tags':b'{"title":"Chosen"}'});folders.append(serve.OUTPUT/chosen['id'])
        assert chosen['tags']=={'title':'Chosen'}
        with urllib.request.urlopen(base+chosen['cover']) as response:assert Image.open(io.BytesIO(response.read())).size==(600,400)
        result=dict(cover_and_tags_from_mp3=True,chosen_cover_wins=True,foreign_host_refused=True,js_mime_pinned=True,loopback_page=True,three_pages=True,png_only_http_import=True,new_2048_http_encode=True,vector_plus_png_import=True,vector_json_only_import=True,vector_download_and_no_store=True,playback_wav_get=True,upload_deleted=True)
    finally:
        server.shutdown();server.server_close();thread.join()
        for folder in folders:shutil.rmtree(folder)
    result['server_stopped']=True
    report=serve.ROOT/'report.json'
    if report.exists():
        r=json.loads(report.read_text());r['http_verification']=result;report.write_text(json.dumps(r,indent=2))
    print(json.dumps(result))

if __name__=='__main__':run()
