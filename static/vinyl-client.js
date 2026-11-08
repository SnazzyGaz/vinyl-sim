/* In-browser cutting and importing for static hosting (GitHub Pages), where there
   is no serve.py. Runs vinyl-core.js in a Web Worker; falls back to the page
   thread only if the browser refuses workers (e.g. some file:// opens). */
(() => {
const here=(document.currentScript&&document.currentScript.src)||location.href;
let worker=null,seq=0,replied=false,core=null;const pending=new Map();
function fail(message){for(const [id,p] of pending){pending.delete(id);p.reject(Error(message));}}
function getWorker(){
 if(worker!==null)return worker;
 try{
  worker=new Worker(new URL('vinyl-worker.js',here));
  worker.onmessage=e=>{replied=true;const {id,stage,fraction,result,error}=e.data,p=pending.get(id);if(!p)return;
   if(stage){p.onStage&&p.onStage(stage,fraction||0);return;}
   pending.delete(id);error?p.reject(Error(error)):p.resolve(result);};
  worker.onerror=e=>{e.preventDefault&&e.preventDefault();
   if(!replied){worker.terminate();worker=false;const retry=[...pending.values()];pending.clear();for(const p of retry)inline(p.msg,p.onStage).then(p.resolve,p.reject);}
   else fail('The in-browser cutter stopped: '+(e.message||'worker error'));};
 }catch{worker=false;}
 return worker;
}
function loadCore(){return core??=new Promise((resolve,reject)=>{if(window.VinylCore)return resolve(window.VinylCore);
 const s=document.createElement('script');s.src=new URL('vinyl-core.js',here).href;s.onload=()=>resolve(window.VinylCore);s.onerror=()=>reject(Error('Could not load the in-browser cutter.'));document.head.append(s);});}
async function inline(msg,onStage){const C=await loadCore();
 if(msg.type==='encode'){let {samples,sampleRate}=msg;if(msg.wav){const w=C.wavToMono(msg.wav);samples=w.samples;sampleRate=w.sampleRate;}return C.encodeRecord(samples,sampleRate,Number(msg.size)||4096,onStage);}
 return C.importRecord(msg,onStage);}
function run(msg,transfer,onStage){
 const w=getWorker();if(!w)return inline(msg,onStage);
 return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject,onStage,msg});w.postMessage({...msg,id},transfer||[]);});
}
function plainWav(buf){
 const b=new Uint8Array(buf),dv=new DataView(buf),tag=s=>String.fromCharCode(...b.subarray(s,s+4));
 if(b.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')return false;
 for(let o=12;o+8<=b.length;){const id=tag(o),size=dv.getUint32(o+4,true);
  if(id==='fmt '){const f=dv.getUint16(o+8,true),bits=dv.getUint16(o+22,true),sub=size>=26?dv.getUint16(o+32,true):0,t=f===0xFFFE?sub:f;
   return (t===1&&[8,16,24,32].includes(bits))||(t===3&&[32,64].includes(bits));}
  o+=8+size+(size&1);}
 return false;
}
// Anything the browser can decode (MP3, AAC, OGG, FLAC…): mono, resampled to 16 kHz by the browser, 480 s max.
async function decode16k(buf){
 const Ctx=window.OfflineAudioContext||window.webkitOfflineAudioContext;
 let audio;try{audio=await new Ctx(1,1,16000).decodeAudioData(buf);}catch{throw Error('This browser could not read that audio file. Try a WAV or MP3.');}
 const n=Math.min(audio.length,480*16000),out=new Float32Array(n);
 for(let c=0;c<audio.numberOfChannels;c++){const d=audio.getChannelData(c);for(let i=0;i<n;i++)out[i]+=d[i]/audio.numberOfChannels;}
 return out;
}
async function cut(buf,size,onStage){
 if(plainWav(buf))return run({type:'encode',wav:buf,size},[],onStage);
 const samples=await decode16k(buf.slice(0));
 return run({type:'encode',samples,sampleRate:16000,size},[],onStage);
}
async function open({png,vector,json},onStage){
 const msg={type:'import',png:await png.arrayBuffer()};
 if(vector)msg.vector=await vector.arrayBuffer();
 if(json)msg.json=await json.text();
 return run(msg,[],onStage); // copied, not transferred, so a page-thread retry still has the bytes
}
window.VinylBrowser={cut,open};
})();
