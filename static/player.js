/* Player room. Opens 16-bit PNG records (optionally with their groove WAV + JSON)
   and plays them. No cutting here. Imports go to serve.py's /api/import when the
   local app is running, or run in the browser (vinyl-client.js) on static hosting. The needle / scratch / seek / speed mechanics
   below are carried over unchanged from the original lab app.js; only the
   bindings to the new cabinet controls and the status wording differ. */
(() => {
const $=id=>document.getElementById(id);
let record=null, ctx=null, buffer=null, vectorBuffer=null, pngBuffer=null, reverseBuffer=null, source=null, gain=null, panner=null, down=false;
let position=0, audioAnchor=0, rpm=45, busy=false, inspecting=false;
let lastGrabAngle=0, lastGrabTime=0, scratchUsingReverse=false, scratchStart=0, scratchAbsRate=0;
const state={angle:Math.PI*.2,rotation:0,dragging:false,grabbed:false};

/* ---------- cabinet indicator + messages (presentation only) ---------- */
function status(s,kind='info'){
 const line=$('status'),err=$('fault');
 if(kind==='error'){err.textContent=s;err.hidden=false;line.textContent='';setLamp('error');$('needleState').textContent='Fault';}
 else{err.hidden=true;line.textContent=s;if(kind==='busy')setLamp('busy');else if(!record)setLamp('off');}
}
function setLamp(s){$('lamp').dataset.state=s;}
function clock(t){t=Math.max(0,t);const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(1);}

function duration(){return record?.metadata.duration_sec||0;}
function clampTime(t){return Math.max(0,Math.min(duration()-.005,t));}
function time(){
 if(!record)return 0;
 if(state.grabbed)return position;
 return Math.min(duration(),position+(down&&ctx?(ctx.currentTime-audioAnchor)*rpm/record.metadata.rpm_cut:0));
}
function silence(){if(source){source.onended=null;try{source.stop();}catch{}source=null;}scratchAbsRate=0;}
function lift(){position=time();silence();down=false;state.grabbed=false;state.dragging=false;renderStatus();}
async function ensureAudio(resume=true){if(!ctx){
 ctx=new (window.AudioContext||window.webkitAudioContext)();gain=ctx.createGain();gain.gain.value=Number($('volume').value);
 panner=ctx.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.rolloffFactor=.5;
 panner.coneInnerAngle=360;panner.coneOuterAngle=360;
 gain.connect(panner);panner.connect(ctx.destination);
 }if(resume)await ctx.resume();}
// Scene vectors are Z-up millimetres; Web Audio is Y-up metres. No tone/EQ stage.
function setListener(position,forward,up,mouth,refDistance){
 if(!ctx)return;
 const scale=.001,listener=ctx.listener;
 const setPosition=(node,v)=>{const x=v.x*scale,y=v.z*scale,z=-v.y*scale;
  if(node.positionX){node.positionX.value=x;node.positionY.value=y;node.positionZ.value=z;}else node.setPosition(x,y,z);};
 setPosition(listener,position);setPosition(panner,mouth);panner.refDistance=refDistance*scale;
 if(listener.forwardX){
  listener.forwardX.value=forward.x;listener.forwardY.value=forward.z;listener.forwardZ.value=-forward.y;
  listener.upX.value=up.x;listener.upY.value=up.z;listener.upZ.value=-up.y;
 }else listener.setOrientation(forward.x,forward.z,-forward.y,up.x,up.z,-up.y);
}
function reversed(){
 if(!reverseBuffer&&buffer){
  reverseBuffer=ctx.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
  for(let c=0;c<buffer.numberOfChannels;c++){
   const src=buffer.getChannelData(c),dst=reverseBuffer.getChannelData(c);
   for(let i=0,j=src.length-1;i<src.length;i++,j--)dst[i]=src[j];
  }
 }
 return reverseBuffer;
}
async function drop(t=position){
 if(!record||!buffer||state.grabbed||inspecting)return; await ensureAudio();if(inspecting)return;silence();
 position=clampTime(t);
 source=ctx.createBufferSource();source.buffer=buffer;source.playbackRate.value=rpm/record.metadata.rpm_cut;source.connect(gain);
 audioAnchor=ctx.currentTime;down=true;source.start(0,position);
 source.onended=()=>{if(state.grabbed)return;position=duration();down=false;source=null;renderStatus();};renderStatus();
}
function scratchVoice(rate){
 if(!record||!buffer||!ctx)return;
 if(Math.abs(rate)<0.04){silence();return;}
 const wantRev=rate<0, abs=Math.min(8,Math.abs(rate));
 const predicted=source?scratchStart+(scratchUsingReverse?-1:1)*scratchAbsRate*(ctx.currentTime-audioAnchor):position;
 if(source&&scratchUsingReverse===wantRev&&Math.abs(predicted-position)<0.045){
  scratchAbsRate=abs;source.playbackRate.value=abs;return;
 }
 silence();
 scratchUsingReverse=wantRev;scratchAbsRate=abs;scratchStart=position;
 source=ctx.createBufferSource();
 source.buffer=wantRev?reversed():buffer;
 source.playbackRate.value=abs;source.connect(gain);
 const off=wantRev?Math.max(0,duration()-position):position;
 audioAnchor=ctx.currentTime;
 try{source.start(0,Math.min(off,Math.max(0,source.buffer.duration-.01)));}catch{source=null;return;}
 source.onended=()=>{source=null;};
}
function renderStatus(){if(!record)return;const t=time();const src=record.playback_source==='vector'?'Vector groove master':'PNG-traced groove';
 const hold=state.grabbed?(Math.abs(scratchAbsRate)>0.04?'Hold — scratching':'Hold — record stopped'):(down?'Needle down — playing':'Needle lifted — silent');
 $('needleState').textContent=hold;
 $('needleSource').textContent=src;
 $('clock').textContent=`${clock(t)} / ${clock(duration())}`;
 $('ratio').textContent=`${(rpm/record.metadata.rpm_cut).toFixed(3)}× cut speed`;
 if($('fault').hidden)setLamp(state.grabbed?'busy':(down?'on':'off'));
 $('seek').value=t/duration()*1000;
 $('seek').setAttribute('aria-valuetext',`${clock(t)} of ${clock(duration())}`);
 const nb=$('needle'); if(nb){const lifting=down&&!state.grabbed;nb.textContent=lifting?'Lift needle':'Drop needle';nb.setAttribute('aria-pressed',String(lifting));}}
function sourceRadios(){return [...document.querySelectorAll('input[name=source]')];}
function applySource(mode, resume=true){
 const next=mode==='vector'?vectorBuffer:pngBuffer;
 if(!record||!next)return;
 const wasDown=down&&!state.grabbed;position=time();silence();down=false;state.grabbed=false;
 buffer=next;reverseBuffer=null;record.playback_source=mode;for(const r of sourceRadios())r.checked=r.value===mode;
 $('origin').textContent=mode==='vector'?'Playing the vector groove master.':'Playing the PNG-traced groove.';
 if(resume&&wasDown)drop(position);else renderStatus();
}
function seekToXY(x,y){
 const m=record.metadata,r=Math.hypot(x,y);
 if(r>m.r_start_mm+1||r<m.label_radius_mm)return false;
 const angle=Math.atan2(y,x)-state.rotation,phi=((-angle)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
 const k=Math.round((m.r_start_mm-r)/m.pitch_mm-phi/(2*Math.PI));
 const t=(k+phi/(2*Math.PI)-m.lead_in_turns)*60/m.rpm_cut;
 position=clampTime(t);state.angle=Math.atan2(y,x);return true;
}
function wrapAngle(d){while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d;}
function grabStart(x,y){
 if(!record||inspecting)return;
 const r=Math.hypot(x,y),m=record.metadata;
 if(r>m.disc_radius_mm+1)return;
 position=time();silence();ensureAudio();

 if(!down)seekToXY(x,y);
 down=true;state.grabbed=true;state.dragging=true;
 lastGrabAngle=Math.atan2(y,x);lastGrabTime=performance.now();scratchAbsRate=0;
 renderStatus();
}
function grabMove(x,y){
 if(!record||!state.grabbed)return;
 const now=performance.now(),ang=Math.atan2(y,x);
 const dth=wrapAngle(ang-lastGrabAngle);
 const realDt=Math.max((now-lastGrabTime)/1000,1e-4);
 lastGrabAngle=ang;lastGrabTime=now;
 const dt=dth/(Math.PI*2)*60/record.metadata.rpm_cut;
 position=clampTime(position+dt);
 state.rotation+=dth;
 scratchVoice(dt/realDt);
 renderStatus();
}
function grabTick(){
 if(!state.grabbed)return;
 if(performance.now()-lastGrabTime>50){scratchAbsRate=0;silence();}
}
function grabEnd(){
 if(!record||!state.grabbed)return;
 state.grabbed=false;state.dragging=false;scratchAbsRate=0;
 drop(position).catch(e=>status(e.message,'error'));
}

/* ---------- opening a record ---------- */
/* serve.py answers api/progress; GitHub Pages and other static hosts do not. Relative
   URL so it resolves to /api/progress locally and under /vinyl-sim/ on Pages.
   With the API: Python /api/import as always. Without: import in the browser. */
let apiProbe=null;
function localApi(){return apiProbe??=fetch('api/progress?job='+'0'.repeat(32),{cache:'no-store'})
 .then(async r=>{if(!r.ok)return false;const d=await r.json();return !!d&&typeof d==='object'&&'stage' in d;}).catch(()=>false);}
let browserImports=0;
async function importInBrowser(parts){
 let r;try{r=await window.VinylBrowser.open(parts,stage=>status(stage==='proofing'?'Pulling a proof…':'Tracing the groove…','busy'));}
 catch(e){throw Error(/height map|metadata|polarity/i.test(e.message)?'That PNG is not a record from the Cutter. '+e.message:e.message);}
 return {id:'browser-'+(++browserImports),metadata:r.metadata,playback_source:r.playback_source,has_vector:r.has_vector,has_png:true,audio_origin:r.audio_origin,
  base:'',previewUrl:URL.createObjectURL(new Blob([r.preview],{type:'image/png'})),playback:r.playback};
}
async function request(url,body){
 const offline='The local server did not answer. Is serve.py still running?';
 let res;try{res=await fetch(url,{method:'POST',body});}catch{throw Error(offline);}
 let data={};try{data=await res.json();}catch{throw Error(offline);}
 if(!res.ok)throw Error(/height map|metadata|polarity/i.test(data.error||'')?'That PNG is not a record from the Cutter. '+data.error:(data.error||offline));
 return data;
}
function enableControls(){
 $('open').disabled=false;$('resetView').disabled=false;
 for(const id of ['needle','seek','rpm'])$(id).disabled=!record||(id==='needle'&&inspecting);
 $('volume').disabled=false;
 for(const r of document.querySelectorAll('input[name=rpmPreset]'))r.disabled=!record;
 const both=!!(record&&vectorBuffer&&pngBuffer);
 for(const r of sourceRadios())r.disabled=!both||(r.value==='vector'?!vectorBuffer:!pngBuffer);
 $('sourcePlate').dataset.both=String(both);
}
async function task(fn){if(busy)return;busy=true;$('open').disabled=true;$('needle').disabled=true;try{await fn();}catch(e){console.error(e);status(e.message,'error');}finally{busy=false;enableControls();}}
function presetFor(v){for(const r of document.querySelectorAll('input[name=rpmPreset]'))r.checked=Math.abs(Number(r.value)-v)<.05;}
/* ---------- record library: every opened record keeps its decoded buffers ---------- */
const library=new Map();let currentId=null,useCounter=0;
function preview(data){return data.previewUrl||data.base+'preview.png';}
function sleeveList(){
 return [...library.values()].filter(e=>e.id!==currentId).sort((a,b)=>b.used-a.used)
  .map(e=>({id:e.id,label:e.label,cover:preview(e.data),facts:factsFor(e.data.metadata)}));
}
function emitSleeves(){window.dispatchEvent(new CustomEvent('vinyl-sleeves',{detail:{current:currentId,count:library.size,sleeves:sleeveList()}}));}
function factsFor(m){return `${Math.round(m.disc_radius_mm*2)} mm · cut at ${m.rpm_cut<40?'33⅓':Math.round(m.rpm_cut)} RPM · ${clock(m.duration_sec)}`;}
function mount(entry,message){
 inspecting=false;
 silence();down=false;state.grabbed=false;state.dragging=false;scratchAbsRate=0;
 const prev=currentId?library.get(currentId):null;if(prev)prev.used=++useCounter; // previous record goes back into its sleeve, front of the pile
 record=entry.data;record.label=entry.label;pngBuffer=entry.pngBuffer;vectorBuffer=entry.vectorBuffer;buffer=null;reverseBuffer=null;currentId=entry.id;entry.used=++useCounter;
 position=0;state.rotation=0;
 rpm=record.metadata.rpm_cut;$('rpm').value=rpm;$('rpmValue').textContent=rpm.toFixed(1);presetFor(rpm);
 $('metadata').textContent=JSON.stringify(record.metadata,null,2);
 $('recordName').textContent=entry.label||'Record';
 $('recordFacts').textContent=factsFor(record.metadata);
 document.body.dataset.record='open';
 window.dispatchEvent(new CustomEvent('vinyl-record',{detail:record}));
 const mode=(vectorBuffer&&(record.playback_source||'vector')==='vector')?'vector':'png';
 applySource(mode,false);
 status(message||(vectorBuffer&&pngBuffer?'Record open. Needle lifted. Both grooves are available — switch Source to compare.':(vectorBuffer?'Record open. Needle lifted. Playing from the vector master.':'Record open. Needle lifted. PNG trace only — expect a lo-fi groove.')));
 enableControls();emitSleeves();
}
async function load(data,label){
 lift();
 status('Tracing the groove…','busy');await ensureAudio(false);
 // decode into locals first: if this fails, the record already on the platter stays put
 let png=null,vec=null;
 if(data.playback){
  // in-browser import: samples already traced/decoded at 16 kHz in the worker
  const make=f=>{const b=ctx.createBuffer(1,f.length,16000);b.getChannelData(0).set(f);return b;};
  png=make(data.playback.png);if(data.has_vector&&data.playback.vector)vec=make(data.playback.vector);
  delete data.playback;
 }else{
  const fallback=await fetch(data.base+'playback.wav');if(!fallback.ok)throw Error('Decoded audio missing.');
  const fallbackBuf=await ctx.decodeAudioData(await fallback.arrayBuffer());
  const pngRes=await fetch(data.base+'playback-png.wav');
  if(pngRes.ok)png=await ctx.decodeAudioData(await pngRes.arrayBuffer());
  if(data.has_vector){const vecRes=await fetch(data.base+'playback-vector.wav');if(vecRes.ok)vec=await ctx.decodeAudioData(await vecRes.arrayBuffer());}
  if(!png)png=data.has_vector?null:fallbackBuf;
  if(!vec&&data.has_vector)vec=fallbackBuf;
 }
 const id=data.id||data.base;
 const entry={id,label:label||'Record',data,pngBuffer:png,vectorBuffer:vec,used:0};
 library.delete(id);library.set(id,entry);
 mount(entry);
}
/* Hot-swap to a record already in the library (dragged sleeve). No re-import, no re-decode. */
function swapTo(id){
 if(busy)return false;
 const entry=library.get(id);if(!entry||id===currentId)return false;
 lift();$('fault').hidden=true;
 mount(entry,`Swapped to “${entry.label}”. Needle lifted — drop it to play.`);
 return true;
}
function classify(files){
 let png=null,vector=null,json=null;
 for(const f of files){
  const n=f.name.toLowerCase();
  if(n.endsWith('.png')){if(png)throw Error('Open records one at a time: pick a single PNG (plus its .groove.wav and .json if you have them). Each one you open waits in a sleeve.');png=f;}
  else if(n.endsWith('.wav'))vector=f;
  else if(n.endsWith('.json'))json=f;
  else throw Error(`“${f.name}” is not part of a record. Open the 16-bit PNG, optionally with its .groove.wav and .json.`);
 }
 if(!png)throw Error('Open the record’s 16-bit PNG. A groove WAV or JSON on its own is not a record here.');
 if(/\.preview\.png$/i.test(png.name))throw Error('That is the 8-bit viewing picture, not the record. Open the 16-bit height-map PNG.');
 return {png,vector,json};
}
function openFiles(list){return task(async()=>{
 const {png,vector,json}=classify([...list]);
 lift();status(vector?'Opening the record and its groove master…':'Opening the record…','busy');
 const label=png.name.replace(/\.png$/i,'');
 if(!(await localApi())){const data=await importInBrowser({png,vector,json});data.heightmapFile=png;await load(data,label);return;}
 const data=new FormData();data.append('file',png);if(vector)data.append('vector',vector);if(json)data.append('metadata',json);
 const opened=await request('/api/import',data);opened.heightmapFile=png;await load(opened,label);
});}
$('open').onclick=()=>$('recordFile').click();
$('recordFile').onchange=e=>{if(e.target.files.length)openFiles(e.target.files);e.target.value='';};
const well=$('well');
well.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();well.dataset.drop='1';}});
well.addEventListener('dragleave',e=>{if(e.target===well||!well.contains(e.relatedTarget))delete well.dataset.drop;});
well.addEventListener('drop',e=>{e.preventDefault();delete well.dataset.drop;if(e.dataTransfer.files.length)openFiles(e.dataTransfer.files);});

/* ---------- cabinet controls → the unchanged mechanics ---------- */
$('needle').onclick=()=>{$('fault').hidden=true;if(down&&!state.grabbed)lift();else drop().catch(e=>status(e.message,'error'));};
for(const r of sourceRadios())r.onchange=e=>{if(e.target.checked)applySource(e.target.value);};
function speed(value){const wasDown=down&&!state.grabbed;position=time();if(!state.grabbed){silence();down=false;}rpm=Number(value);$('rpm').value=rpm;$('rpmValue').textContent=rpm.toFixed(1);presetFor(rpm);if(wasDown)drop(position);renderStatus();}
$('rpm').oninput=e=>speed(e.target.value);
for(const r of document.querySelectorAll('input[name=rpmPreset]'))r.onchange=e=>{if(e.target.checked)speed(e.target.value);};
$('seek').oninput=e=>{if(!record)return;position=duration()*Number(e.target.value)/1000;if(down&&!state.grabbed){silence();if(ctx)audioAnchor=ctx.currentTime;}renderStatus();};
$('seek').onchange=()=>{if(down&&!state.grabbed)drop(position).catch(e=>status(e.message,'error'));else renderStatus();};
function setVolume(v){v=Math.max(0,Math.min(1,Number(v)||0));v=Math.round(v*100)/100;$('volume').value=String(v);if(gain)gain.gain.value=v;$('volumeValue').textContent=Math.round(v*100);}
$('volume').oninput=e=>setVolume(e.target.value);
window.vinyl={get record(){return record;},get state(){return state;},get down(){return down;},get buffer(){return buffer;},time,lift,drop,grabStart,grabMove,grabEnd,grabTick,setListener,
 place(x,y,release=false){if(!record)return;if(release){grabEnd();return;}grabStart(x,y);},
 // cabinet-as-UI setters (the 3D dials call these; the HTML controls share the same paths)
 get inspecting(){return inspecting;},setInspecting(value){if(value&&!inspecting)lift();inspecting=!!value;enableControls();status(inspecting?'Inspecting the record — drag to turn, scroll to study; double-click or press Esc to put it back.':'Record back on the spindle. Needle lifted.');},
 get volume(){return Number($('volume').value);},setVolume,
 get rpm(){return rpm;},setSpeed(v){if(!record)return;speed(v);},
 get sources(){return {vector:!!vectorBuffer,png:!!pngBuffer,both:!!(record&&vectorBuffer&&pngBuffer)};},
 get source(){return record?.playback_source||null;},setSource(mode){if(record&&vectorBuffer&&pngBuffer&&mode!==record.playback_source)applySource(mode==='vector'?'vector':'png');},
 swapTo,sleeves:sleeveList,get currentId(){return currentId;},get libraryCount(){return library.size;}
};
setInterval(()=>{if(record){if(down&&!state.grabbed&&time()>=duration()){lift();}renderStatus();}},100);
enableControls();
(async()=>{
 try{
  const res=await fetch('demo/record.json');
  if(!res.ok)return;
  const data=await res.json();
  if(!data||!data.metadata)return;
  if(!data.base)data.base='demo/';
  await load(data,data.label||'Original tune');
 }catch{}
})();
})();
