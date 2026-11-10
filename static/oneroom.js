/* The Room: everything in one scene. This script handles what is not 3D — files
   coming in (drop anywhere, the blank stack, O), cutting on the bench lathe, saving,
   paper tags, the fading control strip and the keys. Playback stays in player.js and
   the scene in view.js; they talk through window.vinyl and a few window events:
     vinyl-open   (the blank stack was clicked)      -> open the file picker
     vinyl-save   {id} (post tray / a sleeve on it)   -> save that record
     vinyl-lathe  {state, fraction}  (sent from here) -> the lathe lamp, groove and head */
(() => {
const $=id=>document.getElementById(id),V=()=>window.vinyl,body=document.body;
const stem=n=>n.replace(/\.[^.]+$/,''),safeName=n=>(String(n||'').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').replace(/^\.+/,'').slice(0,120))||'record';
const lathe=(state,fraction=0)=>window.dispatchEvent(new CustomEvent('vinyl-lathe',{detail:{state,fraction,shelve:true}})); // finished cuts are filed on the shelf

/* ---------- paper tags ---------- */
function tag(text,{kind='info',actions=[],ttl=actions.length?0:7000}={}){
 const li=document.createElement('li');li.className='tag '+kind;const p=document.createElement('p');p.style.margin='0';p.textContent=text;li.append(p);
 const close=document.createElement('button');close.className='close';close.type='button';close.setAttribute('aria-label','Dismiss');close.textContent='×';close.onclick=()=>li.remove();li.append(close);
 if(actions.length){const row=document.createElement('div');row.className='actions';
  for(const a of actions){const b=document.createElement('button');b.type='button';b.textContent=a.label;if(a.primary)b.className='primary';b.onclick=()=>{li.remove();a.run();};row.append(b);}li.append(row);}
 $('tags').append(li);while($('tags').children.length>3)$('tags').firstElementChild.remove();
 if(ttl)setTimeout(()=>li.remove(),ttl);wake();return li;
}

/* ---------- the strip fades while you are not using it ---------- */
let idleTimer=0;const hud=$('hud');
function wake(){body.classList.remove('idle');clearTimeout(idleTimer);idleTimer=setTimeout(sleep,3200);}
function sleep(){
 const busy=hud.matches(':hover')||hud.contains(document.activeElement)||!$('help').hidden||body.dataset.drag||$('tags').children.length||V()?.busy;
 if(busy){wake();return;}body.classList.add('idle');
}
for(const ev of ['pointermove','pointerdown','keydown','wheel','touchstart'])window.addEventListener(ev,wake,{passive:true});
// a status line that has been read fades with the strip; a new one shows at once
// One-off messages ("Record open. Needle lifted…") fade after a few seconds, and at once when the needle changes state.
const line=$('status'),fade=()=>line.classList.add('stale');
new MutationObserver(()=>{line.classList.remove('stale');clearTimeout(line._t);line._t=setTimeout(fade,5000);wake();}).observe(line,{childList:true,characterData:true,subtree:true});
let needleWas=$('needleState').textContent;
new MutationObserver(()=>{const now=$('needleState').textContent;if(now!==needleWas&&!/scratch|stopped/i.test(now+needleWas))fade();needleWas=now;}).observe($('needleState'),{childList:true,characterData:true,subtree:true});

/* ---------- files in: drop anywhere, the blank stack, the + button, O ---------- */
// A record's own groove master (name.groove.wav) is part of a record, never a song to cut.
const isAudio=f=>!/\.groove\.wav$/i.test(f.name)&&(/^audio\//.test(f.type)||/\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|aif|aiff)$/i.test(f.name));
const isImage=f=>/^image\/(jpeg|png|webp)$/.test(f.type)||/\.(jpe?g|png|webp)$/i.test(f.name);
const pick=()=>$('roomFile').click();
$('open').onclick=pick;window.addEventListener('vinyl-open',pick);
$('roomFile').onchange=e=>{const list=[...e.target.files];e.target.value='';if(list.length)intake(list);};
let dragDepth=0;
const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
window.addEventListener('dragenter',e=>{if(!hasFiles(e))return;e.preventDefault();if(dragDepth++===0){body.dataset.drag='1';if(!cutting)lathe('ready');}},true);
window.addEventListener('dragover',e=>{if(hasFiles(e)){e.preventDefault();e.dataTransfer.dropEffect='copy';}},true);
window.addEventListener('dragleave',e=>{if(!hasFiles(e))return;if(--dragDepth<=0){dragDepth=0;delete body.dataset.drag;if(!cutting)lathe('idle');}},true);
window.addEventListener('drop',e=>{if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();dragDepth=0;delete body.dataset.drag;if(!cutting)lathe('idle');intake([...e.dataTransfer.files]);},true);

const kept=new Map(); // record id -> what Save can write: {kind:'server',base} | {kind:'blobs',png,groove,json} | {kind:'file'}
async function intake(list){
 const audio=list.find(isAudio);
 if(audio){const picture=list.find(f=>isImage(f));return cut(audio,picture||null);}
 const records=list.filter(f=>/\.png$/i.test(f.name));
 if(records.length){
  if(records.length>1){tag('Open records one at a time: one PNG, with its .groove.wav and .json if you have them.');return;}
  const data=await V().openFiles(list,{play:false});if(data)kept.set(data.id??data.base,{kind:'file'});return;
 }
 if(list.some(isImage))tag('A picture on its own has nothing to go on. Drop it together with a song and it becomes the cover.');
 else tag(`“${list[0].name}” is not a song or a record. Drop an MP3, WAV, FLAC or M4A to cut it, or a record PNG to play it.`,{kind:'error'});
}

/* ---------- cutting on the lathe ---------- */
let cutting=false;
async function cut(audio,picture){
 if(cutting){tag('The lathe is still cutting. Drop the next song when this one is done.');return;}
 cutting=true;lathe('cutting',0);V().say(`Cutting “${audio.name}”…`,'busy');
 let found={tags:{},cover:null};
 try{
  const t=window.VinylTags.readTags(await audio.slice(0,Math.min(audio.size,64*1024*1024)).arrayBuffer()),{picture:embedded,...words}=t;found.tags=words;
  found.cover=picture?await window.VinylTags.normaliseCover(picture):embedded?await window.VinylTags.normaliseCover(embedded.bytes,embedded.mime):null;
 }catch{}
 const label=window.VinylTags.displayName(found.tags,stem(audio.name));
 try{
  let data;
  if(await V().localApi())data=await cutOnServer(audio,found);
  else data=await cutInBrowser(audio,found,label);
  if(!data)throw Error('The cut did not finish.');
  if(data.metadata?.source_truncated)tag('The song ran past 4:30, so only its first 4:30 is on this record.');
  tag(`“${label}” is cut and filed in the crate. Drag it to the gramophone to play it.`,{actions:[{label:'Save now',primary:true,run:()=>save(data.id??data.base)},{label:'Later',run:()=>{}}]});
 }catch(e){lathe('failed');tag(e.message,{kind:'error'});V().say('The lathe stopped.','error');}
 finally{cutting=false;}
}
// Local server: the real pipeline stages drive the lathe (received -> cutting -> tracing -> proofing).
const STAGE_AT={received:.06,cutting:.12,tracing:.82,proofing:.94,done:1};
async function cutOnServer(audio,found){
 const job=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const form=new FormData();form.append('file',audio);form.append('size','4096');
 if(found.cover)form.append('cover',await (await fetch(found.cover)).blob(),'cover.jpg');if(Object.keys(found.tags).length)form.append('tags',JSON.stringify(found.tags));
 let stage='received',stageAt=performance.now();
 const poll=setInterval(async()=>{try{const p=await (await fetch('api/progress?job='+job)).json();if(p.stage&&p.stage!==stage&&p.stage in STAGE_AT){stage=p.stage;stageAt=performance.now();}
   // within a stage the head creeps on towards the next checkpoint, never past it
   const next={received:.12,cutting:.8,tracing:.93,proofing:.99}[stage]??1,from=STAGE_AT[stage]??0,s=(performance.now()-stageAt)/1000;
   lathe('cutting',from+(next-from)*(1-Math.exp(-s/(stage==='cutting'?14:5))));}catch{}},400);
 try{
  const data=await new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('POST','api/encode');x.setRequestHeader('X-Job',job);x.responseType='json';
   x.upload.onprogress=e=>{if(e.lengthComputable)lathe('cutting',.06*e.loaded/e.total);};
   x.onload=()=>{const d=x.response||{};x.status>=200&&x.status<300?resolve(d):reject(Error(d.error||'The local server said '+x.status));};
   x.onerror=()=>reject(Error('The local server did not answer. Is serve.py still running?'));x.send(form);});
  clearInterval(poll);lathe('done');
  data.heightmapFile={arrayBuffer:()=>fetch(data.base+'heightmap.png').then(r=>r.arrayBuffer())}; // lets Inspect show the real relief
  const label=window.VinylTags.displayName(data.tags||found.tags,stem(audio.name));
  const ok=await V().loadCut(data,label,{play:false});if(!ok)throw Error('The new record could not be filed.');
  kept.set(data.id??data.base,{kind:'server',base:data.base});return data;
 }finally{clearInterval(poll);}
}
// No server (GitHub Pages): the same cut runs in a worker, then the record is put on.
async function cutInBrowser(audio,found,label){
 const span={cutting:[.04,.8],tracing:[.8,.93],proofing:[.93,.99]};
 const r=await window.VinylBrowser.cut(await audio.arrayBuffer(),4096,(stage,f)=>{const [a,b]=span[stage]||[0,0];lathe('cutting',a+(b-a)*f);},{cover:found.cover,tags:found.tags});
 lathe('done');
 const png=new File([r.png],safeName(label)+'.png',{type:'image/png'}),groove=new Blob([r.groove],{type:'audio/wav'}),json=new Blob([r.json],{type:'application/json'});
 const data=await V().openParts({png,vector:groove,json},label,{play:false});if(!data)throw Error('The new record could not be filed.');
 kept.set(data.id??data.base,{kind:'blobs',png,groove,json});return data;
}

/* ---------- saving: S, the Save key, the post tray ---------- */
window.addEventListener('vinyl-save',e=>save(e.detail?.id??null));
$('saveRecord').onclick=()=>save(null);
async function save(id){
 id=id??V().currentId;let what=kept.get(id);const label=(V().record&&id===V().currentId?V().record.label:null)||V().sleeves().find(x=>x.id===id)?.label||'record',name=safeName(label);
 if(!what||what.kind==='file'){const f=await V().filesFor?.(id);if(f?.png)what={kind:'blobs',png:f.png,groove:f.groove,json:f.json};} // kept on the shelf from an earlier visit
 if(!what){tag(id&&String(id).startsWith('demo')?'The demo tune has no record file. Drop a song to cut one of your own.':'Nothing to save for this one.');return;}
 if(what.kind==='file'){tag('This record is already a file on your computer.');return;}
 try{
  let files;
  if(what.kind==='server'){const get=async(f,optional)=>{const r=await fetch(what.base+f);if(!r.ok){if(optional)return null;throw Error('Missing '+f);}return r.blob();};
   files=[[name+'.png',await get('heightmap.png')],[name+'.groove.wav',await get('heightmap.groove.wav',true)],[name+'.json',await get('heightmap.json')]].filter(x=>x[1]);}
  else files=[[name+'.png',what.png],[name+'.groove.wav',what.groove],[name+'.json',what.json]];
  if('showDirectoryPicker' in window){
   const dir=await showDirectoryPicker({id:'vinyl-cuts',mode:'readwrite',startIn:'downloads'});
   for(const [n,b] of files){const h=await dir.getFileHandle(n,{create:true}),w=await h.createWritable();await w.write(b);await w.close();}
   tag(`Saved ${files.length} files to “${dir.name}”: the record PNG, its groove WAV and JSON.`);
  }else{for(const [n,b] of files){const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);}
   tag(`${files.length} files sent to your downloads.`);}
 }catch(e){if(e.name!=='AbortError')tag('Could not save: '+e.message,{kind:'error'});}
}

/* ---------- the shelf remembers ---------- */
let told=false;try{told=localStorage.getItem('vinyl-shelf-told')==='1';}catch{}
window.addEventListener('vinyl-shelved',e=>{if(told)return;told=true;try{localStorage.setItem('vinyl-shelf-told','1');}catch{}
 tag(`“${e.detail.label}” is on the shelf. Records you cut or open stay in the crate between visits (kept in this browser). Hover one and press Delete to take it off.`,{ttl:12000});});
async function forget(id){
 if(!id||String(id).startsWith('demo')){tag('The demo tune lives with the app; it cannot be taken off the shelf.');return;}
 if(!(await V().isShelved?.(id))){tag('That record is not kept on the shelf.');return;}
 const label=V().sleeves().find(x=>x.id===id)?.label||(id===V().currentId?V().record?.label:null)||'this record';
 tag(`Take “${label}” off the shelf for good? Save it first if you want the files.`,{actions:[{label:'Take it off',primary:true,run:()=>V().forget(id).then(()=>tag(`“${label}” is off the shelf.`))},{label:'Keep it',run:()=>{}}]});
}

/* ---------- keys ---------- */
const help=$('help');
function toggleHelp(on=help.hidden){help.hidden=!on;$('helpButton').setAttribute('aria-expanded',String(on));if(on)wake();}
$('helpButton').onclick=()=>toggleHelp();
function seekBy(s){const v=V(),d=v.record?.metadata.duration_sec;if(!d)return;const seek=$('seek');seek.value=String(Math.max(0,Math.min(1000,(v.time()+s)/d*1000)));seek.dispatchEvent(new Event('input'));seek.dispatchEvent(new Event('change'));}
window.addEventListener('keydown',e=>{
 if(e.ctrlKey||e.metaKey||e.altKey)return;const t=e.target;if(t&&(t.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))&&!(t.type==='radio'&&e.key===' '))return;
 const v=V(),k=e.key;let used=true;
 if(k===' '){if(!$('needle').disabled)$('needle').click();}
 else if(k==='1'||k==='2'||k==='3'){const r=document.querySelectorAll('input[name=rpmPreset]')[Number(k)-1];if(r&&!r.disabled){r.checked=true;r.dispatchEvent(new Event('change'));}}
 else if(k==='['||k===']'){if(v.record)v.setSpeed(Math.max(10,Math.min(100,v.rpm+(k===']'?1:-1))));}
 else if(k==='ArrowUp'||k==='ArrowDown')v.setVolume(v.volume+(k==='ArrowUp'?.05:-.05));
 else if(k==='ArrowLeft'||k==='ArrowRight')seekBy(k==='ArrowRight'?5:-5);
 else if(k==='v'||k==='V'){if(v.sources?.both)v.setSource(v.source==='vector'?'png':'vector');}
 else if(k==='i'||k==='I'){if(!$('inspectRecord').disabled)$('inspectRecord').click();}
 else if(k==='n'||k==='N')$('needleView')?.click();
 else if(k==='o'||k==='O')pick();
 else if(k==='s'||k==='S')save(null);
 else if(k==='Home')$('resetView').click();
 else if(k==='Delete'||k==='Backspace')forget(window.vinylView?.hoverId??v.currentId);
 else if(k==='?'||k==='h'||k==='H')toggleHelp();
 else if(k==='Escape'&&!help.hidden)toggleHelp(false);
 else used=false;
 if(used)e.preventDefault();
});
// The demo has no files behind it; say how to begin once it is on.
setTimeout(()=>{if(!kept.size)V()?.say?.('Drop a song anywhere to cut a record, or click the blanks on the bench. Press ? for keys.');},2500);
wake();
})();
