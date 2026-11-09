// Song tags and cover art: read from MP3 (ID3v2.3/2.4), FLAC and M4A in the browser
// reader, carried inside the record PNG by both cutters, and read back by both importers.
// Needs FFmpeg (to make tagged fixtures) and Python with the project's requirements.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const T=require('./static/tags.js'),C=require('./static/vinyl-core.js');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vinyl-tags-')),f=n=>path.join(tmp,n);
const ff=(...a)=>execFileSync('ffmpeg',['-v','error','-y',...a]);
const py=code=>execFileSync('python3',['-c',code],{cwd:__dirname,encoding:'utf8'});
(async()=>{
 try{
  py(`from PIL import Image\nImage.new('RGB',(700,500),(40,90,160)).save(${JSON.stringify(f('cover.jpg'))},quality=90)`);
  ff('-f','lavfi','-i','sine=frequency=330:duration=2','-ac','1',f('tone.wav'));
  const tag=(out,...codec)=>ff('-i',f('tone.wav'),'-i',f('cover.jpg'),'-map','0','-map','1',...codec,'-metadata','title=Raster Serenade','-metadata','artist=The Pixel Quartet','-c:v','copy','-disposition:v','attached_pic',f(out));
  tag('a23.mp3','-c:a','libmp3lame','-id3v2_version','3');tag('a24.mp3','-c:a','libmp3lame','-id3v2_version','4');tag('a.flac','-c:a','flac');tag('a.m4a','-c:a','aac');
  const cover=fs.readFileSync(f('cover.jpg'));
  for(const n of ['a23.mp3','a24.mp3','a.flac','a.m4a']){const t=T.readTags(fs.readFileSync(f(n)));
   assert.equal(t.title,'Raster Serenade',n);assert.equal(t.artist,'The Pixel Quartet',n);assert.ok(t.picture&&Buffer.from(t.picture.bytes).equals(cover),n+': exact embedded picture');}
  assert.deepEqual(T.readTags(fs.readFileSync(f('tone.wav'))),{},'untagged audio: nothing invented');
  assert.equal(T.displayName({title:'X',artist:'Y'},'f'),'Y — X');assert.equal(T.displayName({},'file'),'file');

  // Browser cutter: tags + cover ride in the PNG; the browser importer and Python both read them back.
  const coverUrl='data:image/jpeg;base64,'+cover.toString('base64'),samples=new Float32Array(16000).map((_,i)=>Math.sin(i*.05)*.3);
  const cut=await C.encodeRecord(samples,16000,2048,()=>{},{cover:coverUrl,tags:{title:'Raster Serenade',artist:'The Pixel Quartet',junk:'x'}});
  assert.equal(cut.cover,coverUrl);assert.deepEqual(cut.tags,{title:'Raster Serenade',artist:'The Pixel Quartet'},'only known tags kept');
  fs.writeFileSync(f('js.png'),cut.png);
  const back=await C.importRecord({png:cut.png});assert.equal(back.cover,coverUrl);assert.equal(back.tags.artist,'The Pixel Quartet');
  const pyRead=JSON.parse(py(`import json,encode\nc,t=encode.read_extras(${JSON.stringify(f('js.png'))})\nprint(json.dumps({'n':len(c or b''),'t':t}))`));
  assert.equal(pyRead.n,cover.length);assert.equal(pyRead.t.title,'Raster Serenade');
  // A bad cover (not a JPEG data URL) is dropped, not embedded.
  const bad=await C.encodeRecord(samples,16000,2048,()=>{},{cover:'javascript:alert(1)',tags:null});assert.equal(bad.cover,null);assert.equal(bad.tags,null);

  // Python cutter: FFmpeg finds tags and cover in the MP3 itself; the browser importer reads them.
  py(`import encode\nencode.encode(${JSON.stringify(f('a23.mp3'))},${JSON.stringify(f('py.png'))},2048)`);
  const pyCut=await C.importRecord({png:fs.readFileSync(f('py.png'))});
  assert.ok(pyCut.cover&&pyCut.cover.startsWith('data:image/jpeg;base64,'),'Python embeds a JPEG cover');assert.equal(pyCut.tags.title,'Raster Serenade');
  const w=py(`from PIL import Image\nimport io,base64,encode\nc,_=encode.read_extras(${JSON.stringify(f('py.png'))})\nprint(Image.open(io.BytesIO(c)).size)`).trim();assert.equal(w,'(600, 429)','cover scaled to 600 px wide');
  // The title is pressed into the label as greyscale relief, and the sound is untouched.
  ff('-i',f('a23.mp3'),'-map','0:a','-map_metadata','-1','-c','copy',f('bare.mp3'));
  const pr=JSON.parse(py(`import json,numpy as np,encode
from decode import decode
from PIL import Image
encode.encode(${JSON.stringify(f('bare.mp3'))},${JSON.stringify(f('bare.png'))},2048)
a=np.asarray(Image.open(${JSON.stringify(f('py.png'))})).astype(int);b=np.asarray(Image.open(${JSON.stringify(f('bare.png'))})).astype(int)
ya,_=decode(${JSON.stringify(f('py.png'))});yb,_=decode(${JSON.stringify(f('bare.png'))})
n=a.shape[0];line=np.linspace(-90,90,n);rr=np.hypot(line[None,:],line[:,None]);d=a!=b
print(json.dumps({'same':bool(np.array_equal(ya,yb)),'changed':int(d.sum()),'outside_label':int((d&(rr>=27)).sum()),'mode':Image.open(${JSON.stringify(f('py.png'))}).mode}))`));
  assert.equal(pr.same,true,'PNG trace identical with and without the pressed title');assert.ok(pr.changed>5000,'title pressed into the label');assert.equal(pr.outside_label,0,'nothing pressed outside the label');assert.match(pr.mode,/^I/,'still 16-bit greyscale');
  // Untagged audio cuts cleanly with no extras.
  py(`import encode\nencode.encode(${JSON.stringify(f('tone.wav'))},${JSON.stringify(f('plain.png'))},2048)`);
  const plain=await C.importRecord({png:fs.readFileSync(f('plain.png'))});assert.equal(plain.cover,null);assert.equal(plain.tags,null);
  console.log('PASS: title pressed into the 16-bit label (sound identical, nothing outside the label); tags + cover from MP3 (ID3 2.3/2.4), FLAC and M4A; carried inside the record PNG by the browser and Python cutters, read back by both importers; bad covers dropped; untagged audio stays clean.');
 }catch(e){console.error(e);process.exitCode=1;}
 finally{fs.rmSync(tmp,{recursive:true,force:true});}
})();
