"""Optional actual HTTP regression; loopback-only server always shuts down."""
import threading, json, urllib.request, uuid, shutil
from pathlib import Path
from http.server import ThreadingHTTPServer
import serve


def run():
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
        with urllib.request.urlopen(base) as response:home=response.read().lower();assert b'href="cutter.html"' in home and b'href="player.html"' in home
        for page,marker in (('/cutter',b'id="saveset"'),('/cutter/',b'id="saveset"'),('/player',b'right-drag'),('/player/',b'right-drag')):
            with urllib.request.urlopen(base+page) as response:assert marker in response.read().lower(),page
        with urllib.request.urlopen(base+'/api/progress?job='+'0'*32) as response:assert json.load(response)['stage']=='unknown'
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
        result=dict(loopback_page=True,three_pages=True,png_only_http_import=True,new_2048_http_encode=True,vector_plus_png_import=True,vector_json_only_import=True,vector_download_and_no_store=True,playback_wav_get=True,upload_deleted=True)
    finally:
        server.shutdown();server.server_close();thread.join()
        for folder in folders:shutil.rmtree(folder)
    result['server_stopped']=True
    report=serve.ROOT/'report.json'
    if report.exists():
        r=json.loads(report.read_text());r['http_verification']=result;report.write_text(json.dumps(r,indent=2))
    print(json.dumps(result))

if __name__=='__main__':run()
