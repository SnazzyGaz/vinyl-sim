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
/* The readout's scratch wording is cosmetic and lags on purpose: a hand on the record shows
   "scratching" until it has been still for SCRATCH_SETTLE_MS, so the brief pauses and reversals
   inside one scratch don't flash "record stopped". The sound itself still stops and starts at once. */
const SCRATCH_SETTLE_MS=350; let lastScratchMotion=-1e9;
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
/* The clock keeps the width of this record's longest reading (its duration, twice) so the bar
   around it never shifts as the time ticks or a scratch runs it back. Measured once per record
   and font load, while the clock is on screen. */
function reserveClock(cl){
 if(!cl?.style||typeof cl.getBoundingClientRect!=='function')return;const key=duration()+'|'+(document.fonts?.status||'');if(cl.dataset.reserved===key)return;
 const full=`${clock(duration())} / ${clock(duration())}`;cl.style.minWidth='';cl.textContent=full;const w=cl.getBoundingClientRect().width;
 if(w>0){cl.style.minWidth=Math.ceil(w)+'px';cl.dataset.reserved=key;}
}
function renderStatus(){if(!record)return;const t=time();const src=record.playback_source==='vector'?'Vector groove master':'PNG-traced groove';
 const hold=state.grabbed?(performance.now()-lastScratchMotion<SCRATCH_SETTLE_MS?'Hold — scratching':'Hold — record stopped'):(down?'Needle down — playing':'Needle lifted — silent');
 $('needleState').textContent=hold;
 $('needleSource').textContent=src;
 reserveClock($('clock'));$('clock').textContent=`${clock(t)} / ${clock(duration())}`;
 $('ratio').textContent=`${(rpm/record.metadata.rpm_cut).toFixed(3)}× cut speed`;
 if($('fault').hidden)setLamp(state.grabbed?'busy':(down?'on':'off'));
 $('seek').value=t/duration()*1000;
 $('seek').setAttribute('aria-valuetext',`${clock(t)} of ${clock(duration())}`);
 const nb=$('needle'); if(nb){const lifting=down;const label=nb.querySelector?.('.now')||nb;label.textContent=lifting?'Lift needle':'Drop needle';nb.setAttribute('aria-pressed',String(lifting));}
 window.vinylNeedle?.wake?.();} // the needle view, if it is on, redraws from the same state
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
 const wasPlaying=down;position=time();silence();ensureAudio();

 if(!down)seekToXY(x,y);
 down=true;state.grabbed=true;state.dragging=true;
 lastGrabAngle=Math.atan2(y,x);lastGrabTime=performance.now();scratchAbsRate=0;lastScratchMotion=wasPlaying?lastGrabTime:-1e9; // catching a spinning record reads as a scratch
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
 if(Math.abs(dth)>1e-3)lastScratchMotion=now; // any real hand movement, even too slow to sound
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
/* Records opened or cut in the browser need IDs that stay unique across visits: they
   key the shelf in IndexedDB. A per-page counter restarted at browser-1 on every visit
   and overwrote the first stored record. Old browser-N records still load under their
   own IDs; new ones never take that form. */
function browserId(){
 try{if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return 'browser-'+crypto.randomUUID();}catch{}
 return 'browser-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
}
async function importInBrowser(parts){
 let r;try{r=await window.VinylBrowser.open(parts,stage=>status(stage==='proofing'?'Pulling a proof…':'Tracing the groove…','busy'));}
 catch(e){throw Error(/height map|metadata|polarity/i.test(e.message)?'That PNG is not a record from the Cutter. '+e.message:e.message);}
 return {id:browserId(),metadata:r.metadata,playback_source:r.playback_source,has_vector:r.has_vector,has_png:true,audio_origin:r.audio_origin,
  base:'',previewUrl:URL.createObjectURL(new Blob([r.preview],{type:'image/png'})),playback:r.playback,cover:r.cover||null,tags:r.tags||null};
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
/* ---------- the shelf: records kept in this browser between visits ----------
   Every record you cut or open is stored (PNG, groove WAV, JSON, a preview) in
   IndexedDB. On the next visit they come back as sleeves on the shelf, and are only
   traced again when you actually put one on. No IndexedDB (tests, private modes): the
   shelf simply forgets, as before. */
const shelf={
 db:null,
 open(){return this.db??=new Promise(res=>{try{const q=indexedDB.open('vinyl-sim',1);q.onupgradeneeded=()=>q.result.createObjectStore('shelf',{keyPath:'id'});q.onsuccess=()=>res(q.result);q.onerror=()=>res(null);}catch{res(null);}});},
 async run(mode,fn){const db=await this.open();if(!db)return null;return new Promise(res=>{try{const t=db.transaction('shelf',mode),st=t.objectStore('shelf'),q=fn(st);t.oncomplete=()=>res(q?.result??true);t.onerror=t.onabort=()=>res(null);}catch{res(null);}});},
 put(rec){return this.run('readwrite',st=>st.put(rec));},
 all(){return this.run('readonly',st=>st.getAll()).then(r=>r||[]);},
 get(id){return this.run('readonly',st=>st.get(id));},
 del(id){return this.run('readwrite',st=>st.delete(id));}
};
async function blobAt(url){try{const r=await fetch(url);return r.ok?await r.blob():null;}catch{return null;}}
async function keepOnShelf(id,label,data,{png,groove,json}){
 if(typeof indexedDB==='undefined'||!png||String(id).startsWith('demo'))return;
 const previewBlob=data.cover?null:await blobAt(preview(data));
 const ok=await shelf.put({id,label,tags:data.tags||null,cover:data.cover&&data.cover.startsWith('data:')?data.cover:null,coverBlob:data.cover&&!data.cover.startsWith('data:')?await blobAt(data.cover):null,metadata:data.metadata,png,groove:groove||null,json:json||null,preview:previewBlob,added:Date.now()});
 if(ok){try{navigator.storage?.persist?.();}catch{}window.dispatchEvent?.(new CustomEvent('vinyl-shelved',{detail:{id,label}}));}
}
async function restoreShelf(){
 if(typeof indexedDB==='undefined')return;
 const all=(await shelf.all()).sort((a,b)=>a.added-b.added);let n=0;
 for(const r of all){if(library.has(r.id))continue;
  const data={id:r.id,metadata:r.metadata,base:'',cover:r.cover||(r.coverBlob?URL.createObjectURL(r.coverBlob):null),tags:r.tags,previewUrl:r.preview?URL.createObjectURL(r.preview):''};
  library.set(r.id,{id:r.id,label:r.label,data,stub:{png:new File([r.png],(r.label||'record')+'.png',{type:'image/png'}),vector:r.groove,json:r.json},used:-all.length+(n++)});}
 if(n)emitSleeves();
}
/* ---------- record library: every opened record keeps its decoded buffers ---------- */
const library=new Map();let currentId=null,useCounter=0;
function preview(data){return data.previewUrl||data.base+'preview.png';}
// The song's own name when the cut carried its tags, else the file name.
function titleFor(data,fallback){const t=data.tags;return t?.title?(t.artist?`${t.artist} — ${t.title}`:t.title):fallback;}
function sleeveList(){
 return [...library.values()].filter(e=>e.id!==currentId).sort((a,b)=>b.used-a.used)
  .map(sleeveOf);
}
function sleeveOf(e){return {id:e.id,label:e.label,cover:e.data.cover||preview(e.data),art:!!e.data.cover,facts:factsFor(e.data.metadata)};}
function currentSleeve(){const e=currentId!=null?library.get(currentId):null;return e?sleeveOf(e):null;}
function emitSleeves(){window.dispatchEvent(new CustomEvent('vinyl-sleeves',{detail:{current:currentId,count:library.size,sleeves:sleeveList(),currentSleeve:currentSleeve()}}));}
// The 3D view's one-line hints (e.g. while a sleeve is offered to the platter).
let hintBefore=null;
window.addEventListener?.('vinyl-hint',e=>{const t=e.detail?.text||'';const line=$('status');
 if(t){if(hintBefore===null)hintBefore=line.textContent;line.textContent=t;}else if(hintBefore!==null){line.textContent=hintBefore;hintBefore=null;}});
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
async function load(data,label,keepId,{play=true}={}){
 if(play)lift(); // filing a record on the shelf leaves what is playing alone
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
 const id=keepId||data.id||data.base;
 const entry={id,label:titleFor(data,label||'Record'),data,pngBuffer:png,vectorBuffer:vec,used:0};
 library.delete(id);library.set(id,entry);
 if(!play){entry.used=++useCounter;status(`“${entry.label}” is on the shelf.`);emitSleeves();return;} // filed on the shelf, front of the crate; what is playing stays on
 mount(entry);
}
/* Hot-swap to a record already in the library (dragged sleeve). No re-import, no re-decode. */
function swapTo(id){
 if(busy)return false;
 const entry=library.get(id);if(!entry||id===currentId)return false;
 lift();$('fault').hidden=true;
 if(entry.stub){task(async()=>{await openParts(entry.stub,entry.label,id);});return true;} // off the shelf: traced now
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
async function openParts({png,vector,json},label,keepId,opts){
 if(opts?.play!==false)lift();status(keepId?'Taking it off the shelf: tracing the groove…':vector?'Opening the record and its groove master…':'Opening the record…','busy');
 label=label||(png.name||'record').replace(/\.png$/i,'');
 let data;
 if(!(await localApi())){data=await importInBrowser({png,vector,json});data.heightmapFile=png;await load(data,label,keepId,opts);}
 else{const form=new FormData();form.append('file',png);if(vector)form.append('vector',vector);if(json)form.append('metadata',json);
  data=await request('/api/import',form);data.heightmapFile=png;await load(data,label,keepId,opts);}
 if(!keepId)keepOnShelf(data.id||data.base,library.get(data.id||data.base)?.label||label,data,{png,groove:vector,json});
 return data;
}
// A finished server cut: its files are fetched once and kept on the shelf.
async function shelveServerCut(data,label){
 const id=data.id||data.base,[png,groove,json]=await Promise.all(['heightmap.png','heightmap.groove.wav','heightmap.json'].map(f=>blobAt(data.base+f)));
 await keepOnShelf(id,library.get(id)?.label||label,data,{png,groove,json});
}
// Take a record off the shelf for good (it stays on the platter if it is playing).
async function forget(id){await shelf.del(id);if(id!==currentId){const e=library.get(id);if(e?.data?.previewUrl?.startsWith('blob:'))URL.revokeObjectURL(e.data.previewUrl);library.delete(id);}emitSleeves();}
async function filesFor(id){const r=await shelf.get(id);return r?{png:r.png,groove:r.groove,json:r.json}:null;}
function openFiles(list){return task(async()=>{await openParts(classify([...list]));});}
// For the one-room page: open records and hand over finished cuts; each resolves to the record's data, or null if it failed (the error is shown).
async function guarded(fn){let out=null;await task(async()=>{out=await fn();});return out;}
$('open').onclick=()=>$('recordFile').click();
$('recordFile').onchange=e=>{if(e.target.files.length)openFiles(e.target.files);e.target.value='';};
const well=$('well');
well.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();well.dataset.drop='1';}});
well.addEventListener('dragleave',e=>{if(e.target===well||!well.contains(e.relatedTarget))delete well.dataset.drop;});
well.addEventListener('drop',e=>{e.preventDefault();delete well.dataset.drop;if(e.dataTransfer.files.length)openFiles(e.dataTransfer.files);});

/* ---------- cabinet controls → the unchanged mechanics ---------- */
$('needle').onclick=()=>{$('fault').hidden=true;if(down)lift();else drop().catch(e=>status(e.message,'error'));};
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
 swapTo,sleeves:sleeveList,currentSleeve,get currentId(){return currentId;},
 openFiles:(list,opts)=>guarded(()=>openParts(classify([...list]),undefined,undefined,opts)),openParts:(parts,label,opts)=>guarded(()=>openParts(parts,label,undefined,opts)),
 loadCut:(data,label,opts)=>guarded(async()=>{await load(data,label,undefined,opts);shelveServerCut(data,label);return data;}),forget,filesFor,isShelved:id=>shelf.get(id).then(r=>!!r),say:(text,kind)=>status(text,kind),get busy(){return busy;},localApi,get libraryCount(){return library.size;}
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
 try{await restoreShelf();}catch{}
})();
})();
