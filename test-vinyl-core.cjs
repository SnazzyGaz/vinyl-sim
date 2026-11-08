// In-browser pipeline (static/vinyl-core.js) against the Python reference. Node 18+.
// Uses output/sample.{png,groove.wav,json} if present, else cuts samples/original.wav
// with encode.py at 2048 into a temp folder. Python (numpy/scipy/Pillow) is used only as the reference.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const C=require('./static/vinyl-core.js');
const ROOT=__dirname,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vinyl-core-'));
const py=code=>execFileSync('python3',['-c',code],{cwd:ROOT,encoding:'utf8',maxBuffer:1<<26});
const readF64=f=>{const b=fs.readFileSync(f);return new Float64Array(b.buffer,b.byteOffset,b.length/8);};
function pearson(a,b,skip=800){const n=Math.min(a.length,b.length)-skip;let sa=0,sb=0;for(let i=skip;i<n;i++){sa+=a[i];sb+=b[i];}const ma=sa/(n-skip),mb=sb/(n-skip);
 let ab=0,aa=0,bb=0;for(let i=skip;i<n;i++){const x=a[i]-ma,y=b[i]-mb;ab+=x*y;aa+=x*x;bb+=y*y;}return ab/Math.sqrt(aa*bb);}
const finite=a=>a.every(Number.isFinite);
(async()=>{
 try{
  // 1. A Python-cut record
  let base=path.join(ROOT,'output','sample');
  if(!['.png','.groove.wav','.json'].every(e=>fs.existsSync(base+e))){
   base=path.join(tmp,'py');py(`from encode import encode;encode('samples/original.wav',${JSON.stringify(base+'.png')},2048)`);}
  py(`import numpy as np
from decode import decode,decode_record
v,m,o=decode_record(${JSON.stringify(base+'.png')});assert o=='vector'
p,_=decode(${JSON.stringify(base+'.png')})
np.asarray(v,'<f8').tofile(${JSON.stringify(path.join(tmp,'py-vector.f64'))});np.asarray(p,'<f8').tofile(${JSON.stringify(path.join(tmp,'py-png.f64'))})`);
  const pyVec=readF64(path.join(tmp,'py-vector.f64')),pyPng=readF64(path.join(tmp,'py-png.f64'));
  const png=fs.readFileSync(base+'.png'),groove=fs.readFileSync(base+'.groove.wav'),json=fs.readFileSync(base+'.json','utf8');

  // 2. JS import of the Python PNG + vector
  const both=await C.importRecord({png,vector:groove,json});
  assert.equal(both.has_vector,true);assert.equal(both.playback_source,'vector');
  assert.equal(both.metadata.encoding_version,'vinyl-heightmap-lateral-v2');assert.equal(both.metadata.height_polarity,'inverted');
  assert.equal(both.metadata.vector_master.format,'pcm16-mono-displacement-v1');
  assert.ok(finite(both.playback.vector)&&finite(both.playback.png));
  // expected playback = Python's decoded audio through serve.write_playback (int16 truncation)
  const expectV=C.pcmToFloat(C.playbackPcm(pyVec)),expectP=C.pcmToFloat(C.playbackPcm(pyPng));
  let maxV=0;for(let i=0;i<expectV.length;i++)maxV=Math.max(maxV,Math.abs(expectV[i]-both.playback.vector[i]));
  assert.equal(both.playback.vector.length,pyVec.length);assert.ok(maxV<=1/32768+1e-9,'vector path matches Python: '+maxV);
  const rPng=pearson(both.playback.png,expectP);assert.ok(rPng>.999,'PNG trace correlates with Python: '+rPng);
  const preview=await C.decodePng(both.preview);assert.equal(preview.colorType,2);assert.equal(preview.width,1024);

  // 3. JS cut of samples/original.wav at 2048, then JS import
  const wav=C.wavToMono(fs.readFileSync(path.join(ROOT,'samples/original.wav')));
  const stages=[];const t0=Date.now();
  const cut=await C.encodeRecord(wav.samples,wav.sampleRate,2048,s=>{if(stages.at(-1)!==s)stages.push(s);});
  assert.deepEqual(stages,['cutting','tracing','proofing']);
  const m=cut.metadata;assert.equal(m.image_size,2048);assert.equal(m.height_polarity,'inverted');assert.equal(m.outside_value,32768);
  assert.ok(Math.abs(m.duration_sec-11.6347)<.01,'duration '+m.duration_sec);
  const head=await C.decodePng(cut.png);assert.equal(head.colorType,0);assert.equal(head.bitDepth,16);assert.equal(head.width,2048);
  assert.deepEqual(JSON.parse(head.text.vinyl),m,'vinyl iTXt metadata');assert.deepEqual(JSON.parse(cut.json),m,'sidecar JSON');
  assert.equal(head.samples[0],32768,'outside the disc is mid-grey');
  await C.readVector(cut.groove,m); // throws on checksum / format mismatch
  const mine=await C.importRecord({png:cut.png,vector:cut.groove,json:cut.json});
  assert.equal(mine.has_vector,true);assert.equal(mine.playback.vector.length,Math.round(m.duration_sec*16000));
  assert.ok(finite(mine.playback.vector)&&finite(mine.playback.png));
  const rSelf=pearson(mine.playback.png,mine.playback.vector);assert.ok(rSelf>.9,'PNG trace vs vector of the JS cut: '+rSelf);
  // the JS cut is a real record for Python too, and close to Python's own cut (resampler differs from ffmpeg)
  const jsBase=path.join(tmp,'js');fs.writeFileSync(jsBase+'.png',cut.png);fs.writeFileSync(jsBase+'.groove.wav',cut.groove);fs.writeFileSync(jsBase+'.json',cut.json);
  const pyCheck=py(`import numpy as np
from PIL import Image
from decode import decode_record
v,m,o=decode_record(${JSON.stringify(jsBase+'.png')});print(o,Image.open(${JSON.stringify(jsBase+'.png')}).mode,len(v))`).trim();
  assert.equal(pyCheck,`vector I;16 ${mine.playback.vector.length}`);
  const rCross=pearson(mine.playback.vector,expectV);
  if(pyVec.length===mine.playback.vector.length)assert.ok(rCross>.98,'JS cut vs Python cut: '+rCross);
  const tamper=Uint8Array.from(cut.groove);tamper[100]^=1;
  await assert.rejects(C.readVector(tamper,m),/checksum/);

  // 4. PNG-only import; RGB/preview refused
  const only=await C.importRecord({png:cut.png});
  assert.equal(only.has_vector,false);assert.equal(only.playback_source,'png');assert.equal(only.playback.vector,null);assert.ok(finite(only.playback.png));
  await assert.rejects(C.importRecord({png:fs.readFileSync(path.join(ROOT,'demo/preview.png'))}),/square 2048 or 4096/);
  const rgb=await C.encodePng({width:2048,height:2048,colorType:2,bitDepth:8,data:new Uint8Array(2048*2048*3),text:{vinyl:cut.json}});
  await assert.rejects(C.importRecord({png:rgb}),/16-bit grayscale height map, not an RGB preview/);
  const bare=await C.encodePng({width:2048,height:2048,colorType:0,bitDepth:16,samples:head.samples});
  await assert.rejects(C.importRecord({png:bare}),/No vinyl metadata/);
  assert.equal((await C.importRecord({png:bare,json:cut.json})).metadata.image_size,2048,'sidecar JSON used when the PNG has no text chunk');
  // legacy v1 map (Butterworth postprocess path)
  const legacy=await C.importRecord({png:fs.readFileSync(path.join(ROOT,'samples/legacy-2048.png'))});assert.ok(finite(legacy.playback.png));
  assert.equal(await C.sha256Hex(new Uint8Array([97,98,99])),C.sha256Fallback(new Uint8Array([97,98,99])));
  console.log(`PASS: JS import of Python record (vector max diff ${maxV.toExponential(1)}, PNG trace r=${rPng.toFixed(5)}); JS cut at 2048 in ${Date.now()-t0} ms (16-bit grey PNG + vinyl iTXt, ${m.duration_sec.toFixed(2)} s, inverted, checksum verified, Python reads it; vs Python cut r=${rCross.toFixed(4)}); PNG-only import, legacy v1 map, RGB/preview/no-metadata refused.`);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
