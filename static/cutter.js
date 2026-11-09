/* Cutter room. With the local app (serve.py) it sends audio to the Python encode
   path and fetches the cut files as blobs. On static hosting (GitHub Pages) there
   is no API, so the same cut runs in the browser (vinyl-client.js → Web Worker).
   Either way the user chooses where the files are saved. No playback here. */
(() => {
const $=id=>document.getElementById(id);
let cut=null;          // cut record {metadata, has_vector} (+ id/base from serve.py)
let files=[];          // [{key, name, label, note, blob, checked}]
let busy=false;
let audio=null,picture=null,found={tags:{},cover:null,from:''},readToken=0; // chosen audio, optional picture, what we read from them
const FS_DIR='showDirectoryPicker' in window, FS_FILE='showSaveFilePicker' in window;
/* serve.py answers api/progress; GitHub Pages and other static hosts do not. Relative
   URL so it resolves to /api/progress locally and under /vinyl-sim/ on Pages. */
let apiProbe=null;
function localApi(){return apiProbe??=fetch('api/progress?job='+'0'.repeat(32),{cache:'no-store'})
 .then(async r=>{if(!r.ok)return false;const d=await r.json();return !!d&&typeof d==='object'&&'stage' in d;}).catch(()=>false);}

/* ---------- states ---------- */
function setState(s){document.body.dataset.state=s;$('lamp').dataset.state={idle:'off',cutting:'busy',done:'on',error:'error'}[s]||'off';}
function say(text){$('status').textContent=text;}
function fault(text){$('fault').textContent=text;$('fault').hidden=false;setState('error');say('Stopped.');}
function clearFault(){$('fault').hidden=true;}

/* ---------- source selection ---------- */
function sourceMode(){return document.querySelector('input[name=src]:checked').value;}
function refreshSource(){
 const f=audio,mode=sourceMode();
 $('fileName').textContent=f?f.name:'No file chosen';
 $('choose').disabled=busy||mode!=='file';
 $('cut').disabled=busy||(mode==='file'&&!f);
 for(const r of document.querySelectorAll('input[name=size]')){r.disabled=busy||mode==='sample';if(mode==='sample'&&r.value==='4096')r.checked=true;}
 $('sizeNote').textContent=mode==='sample'?'The original tune is always cut at 4096.':'4096 follows the groove radius for bandwidth; 2048 is lighter and duller.';
 if(!$('recordName').dataset.touched)$('recordName').value=mode==='sample'?'original-tune':(f?safeName(found.tags.title?window.VinylTags.displayName(found.tags,stem(f.name)).replace(' — ',' - '):stem(f.name)):'');
 renderArt();
}
function stem(n){return n.replace(/\.[^.]+$/,'');}
function safeName(n){n=(n||'').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').replace(/^\.+/,'');return n.slice(0,120)||'record';}
$('choose').onclick=()=>$('audioFile').click();
/* Pick the audio, optionally with a picture: the first image chosen becomes the cover.
   Otherwise the cover and title come from the audio file's own tags. */
let artUrl=null;
function renderArt(){
 const row=$('artRow'),on=sourceMode()==='file'&&audio&&(found.cover||found.tags.title);row.hidden=!on;if(!on)return;
 const img=$('artThumb');if(found.cover){img.src=found.cover;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}
 const t=found.tags,name=t.title?window.VinylTags.displayName(t,''):'';
 $('artNote').textContent=[name,found.cover?(found.from==='picture'?'Cover from '+picture.name:'Cover from the file’s tags'):'No cover in the file — the sleeve gets the Deco card'].filter(Boolean).join(' · ');
}
async function readSource(){
 const token=++readToken;found={tags:{},cover:null,from:''};refreshSource();if(!audio)return;
 try{
  const tags=window.VinylTags.readTags(await audio.slice(0,Math.min(audio.size,64*1024*1024)).arrayBuffer());if(token!==readToken)return;
  const {picture:embedded,...words}=tags;found.tags=words;
  if(picture){found.cover=await window.VinylTags.normaliseCover(picture);found.from='picture';}
  else if(embedded){found.cover=await window.VinylTags.normaliseCover(embedded.bytes,embedded.mime);found.from='tags';}
 }catch{}
 if(token===readToken)refreshSource();
}
$('audioFile').onchange=()=>{
 const list=[...$('audioFile').files];if(!list.length)return;
 const a=list.find(f=>/^audio\//.test(f.type)||/\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|aif|aiff)$/i.test(f.name)),p=list.find(f=>/^image\//.test(f.type));
 if(a){audio=a;picture=p||null;}else if(p){picture=p;} // a picture on its own just replaces the cover
 document.querySelector('input[name=src][value=file]').checked=true;$('audioFile').value='';readSource();
};
for(const r of document.querySelectorAll('input[name=src]'))r.onchange=refreshSource;
$('recordName').oninput=()=>{$('recordName').dataset.touched='1';renderFiles();};

/* ---------- traverse (progress) ---------- */
const STAGE_TEXT={received:'Audio received',cutting:'Cutting the groove',tracing:'Tracing it back',proofing:'Pulling a proof',done:'Cut complete'};
const STAGE_AT={received:.14,cutting:.14,tracing:.72,proofing:.88,done:1};
let revealTimer=null,pollTimer=null,started=0;
function job(){return [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function traverse(f,label){
 const bar=$('traverse');bar.style.setProperty('--f',Math.max(0,Math.min(1,f)));
 bar.setAttribute('aria-valuenow',Math.round(f*100));bar.setAttribute('aria-valuetext',label);
 $('traverseText').textContent=label;
}
function startTraverse(id,word,poll=true){
 started=performance.now();traverse(0,word);
 $('traverseWrap').hidden=true;
 revealTimer=setTimeout(()=>{$('traverseWrap').hidden=false;},2000);
 pollTimer=setInterval(async()=>{
  const secs=((performance.now()-started)/1000).toFixed(0);$('elapsed').textContent=secs+' s';
  if(!poll)return; // in-browser cuts report their stages straight from the worker
  try{const r=await fetch('api/progress?job='+id);const p=await r.json();
   if(p.stage in STAGE_AT&&p.stage!=='received')traverse(STAGE_AT[p.stage],STAGE_TEXT[p.stage]);}catch{}
 },500);
}
function stopTraverse(){clearTimeout(revealTimer);clearInterval(pollTimer);revealTimer=pollTimer=null;}

function post(url,body,id,onUpload){return new Promise((resolve,reject)=>{
 const x=new XMLHttpRequest();x.open('POST',url);x.setRequestHeader('X-Job',id);x.responseType='json';
 if(onUpload)x.upload.onprogress=e=>{if(e.lengthComputable)onUpload(e.loaded/e.total);};
 x.onload=()=>{const d=x.response||{};if(x.status>=200&&x.status<300)resolve(d);else reject(Error(d.error||('Server replied '+x.status)));};
 x.onerror=()=>reject(Error('The local server did not answer. Is serve.py still running?'));
 x.send(body);
});}

/* ---------- cutting ---------- */
function lock(on){busy=on;document.body.toggleAttribute('data-busy',on);
 for(const el of document.querySelectorAll('#desk button, #desk input'))if(on)el.disabled=true;
 if(!on){for(const el of document.querySelectorAll('#desk input'))el.disabled=false;refreshSource();renderFiles();}}
$('cut').onclick=async()=>{
 if(busy)return;clearFault();
 const mode=sourceMode(),f=audio;
 if(mode==='file'&&!f){fault('Choose an audio file first, or pick the original 11-second tune.');return;}
 const id=job();lock(true);setState('cutting');cut=null;files=[];renderFiles();showProof(null);
 try{
  const local=await localApi();
  say(mode==='sample'?'Cutting the original tune…':(local?'Sending audio to the lathe…':'Cutting in your browser…'));
  startTraverse(id,mode==='sample'||!local?STAGE_TEXT.cutting:'Sending audio',local);
  let data;
  if(!local)data=await cutInBrowser(mode,f);
  else{
   if(mode==='sample'){traverse(STAGE_AT.cutting,STAGE_TEXT.cutting);data=await post('api/sample',null,id);}
   else{const form=new FormData();form.append('file',f);form.append('size',document.querySelector('input[name=size]:checked').value);
    if(found.cover)form.append('cover',await (await fetch(found.cover)).blob(),'cover.jpg');if(Object.keys(found.tags).length)form.append('tags',JSON.stringify(found.tags));
    data=await post('api/encode',form,id,p=>{traverse(p*.14,p<1?`Sending audio ${Math.round(p*100)}%`:STAGE_TEXT.cutting);if(p>=1)say('Cutting the groove…');});}
   traverse(.96,'Collecting the cut');say('Collecting the cut files…');
   await collect(data);
  }
  cut=data;
  traverse(1,STAGE_TEXT.done);setState('done');
  const m=data.metadata;
  say(`Cut complete.${m.source_truncated?' The song ran past 4:30, so only its first 4:30 is on the record.':''} ${m.image_size} map · ${Math.round(m.disc_radius_mm*2)} mm at ${m.rpm_cut<40?'33⅓':Math.round(m.rpm_cut)} RPM · ${m.duration_sec.toFixed(1)} s. Choose where to save it.`);
  showProof(data.previewUrl||data.base+'preview.png');
 }catch(e){console.error(e);fault(e.message);}
 finally{stopTraverse();lock(false);}
};
async function blob(url){const r=await fetch(url);if(!r.ok)throw Error('Missing cut file: '+url.split('/').pop());return r.blob();}
const DELIVERY=[['png','heightmap.png','.png','16-bit height-map PNG','The record. Opens in the Player.',true],
 ['wav','heightmap.groove.wav','.groove.wav','Groove master WAV','Vector master; keep with the PNG.',true],
 ['json','heightmap.json','.json','Spiral metadata JSON','Pairs the groove WAV with the PNG.',true],
 ['preview','preview.png','.preview.png','Viewing picture','8-bit, not a playable record.',false]];
async function collect(d){
 const list=DELIVERY.filter(e=>e[0]!=='wav'||d.has_vector);
 files=[];
 for(const [key,src,ext,label,note,checked] of list)files.push({key,ext,label,note,checked,blob:await blob(d.base+src),mime:src.endsWith('.png')?'image/png':src.endsWith('.json')?'application/json':'audio/wav'});
 renderFiles();
}
/* ---------- in-browser cut (static hosting: no serve.py) ---------- */
async function cutInBrowser(mode,f){
 let bytes,size=document.querySelector('input[name=size]:checked').value;
 if(mode==='sample'){const r=await fetch('samples/original.wav');if(!r.ok)throw Error('Could not fetch the original tune.');bytes=await r.arrayBuffer();size='4096';}
 else bytes=await f.arrayBuffer();
 const span={cutting:[STAGE_AT.cutting,STAGE_AT.tracing],tracing:[STAGE_AT.tracing,STAGE_AT.proofing],proofing:[STAGE_AT.proofing,.96]};
 const extras=mode==='file'?{cover:found.cover,tags:found.tags}:null;
 const r=await window.VinylBrowser.cut(bytes,Number(size),(stage,fr)=>{const [a,b]=span[stage]||[0,0];traverse(a+(b-a)*fr,STAGE_TEXT[stage]||stage);},extras);
 traverse(.96,'Collecting the cut');
 const make=(key,data,mime)=>({key,blob:new Blob([data],{type:mime})});
 const set=[make('png',r.png,'image/png'),make('wav',r.groove,'audio/wav'),make('json',r.json,'application/json'),make('preview',r.preview,'image/png')];
 files=DELIVERY.filter(d=>d[0]!=='wav'||r.has_vector).map(([key,,ext,label,note,checked])=>{const s=set.find(x=>x.key===key);return {key,ext,label,note,checked,blob:s.blob,mime:s.blob.type};});
 renderFiles();
 return {metadata:r.metadata,has_vector:r.has_vector,previewUrl:objectUrl(set[3].blob)};
}
let proofUrl=null;
function objectUrl(b){if(proofUrl)URL.revokeObjectURL(proofUrl);return proofUrl=URL.createObjectURL(b);}
function showProof(url){const img=$('proof');if(url){img.src=url;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}}

/* ---------- delivery ---------- */
function size(n){return n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
function fileName(f){return safeName($('recordName').value)+f.ext;}
function renderFiles(){
 const ul=$('files');ul.replaceChildren();
 $('emptyFiles').hidden=files.length>0;
 for(const f of files){
  const li=document.createElement('li');
  const id='file-'+f.key;
  li.innerHTML=`<input type="checkbox" id="${id}"><label for="${id}"><span class="fname figures"></span><span class="fnote"></span></label><span class="fsize figures"></span><button type="button" class="btn small">Save as…</button>`;
  const box=li.querySelector('input');box.checked=f.checked;box.disabled=busy;box.onchange=()=>{f.checked=box.checked;renderFiles();};
  li.querySelector('.fname').textContent=fileName(f);
  li.querySelector('.fnote').textContent=`${f.label} — ${f.note}`;
  li.querySelector('.fsize').textContent=size(f.blob.size);
  const b=li.querySelector('button');b.disabled=busy;b.setAttribute('aria-label','Save '+fileName(f)+' as');b.onclick=()=>saveOne(f);
  ul.append(li);
 }
 const any=files.some(f=>f.checked);
 $('saveSet').disabled=busy||!any;
 $('recordName').disabled=busy||!files.length;
}
function download(f){const a=document.createElement('a');a.href=URL.createObjectURL(f.blob);a.download=fileName(f);document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);}
async function write(handle,b){const w=await handle.createWritable();await w.write(b);await w.close();}
async function saveOne(f){
 clearFault();
 if(!FS_FILE){download(f);say(`${fileName(f)} sent to your browser’s downloads.`);return;}
 try{
  const h=await showSaveFilePicker({id:'vinyl-cuts',startIn:'downloads',suggestedName:fileName(f),types:[{description:f.label,accept:{[f.mime]:[f.ext.slice(f.ext.lastIndexOf('.'))]}}]});
  await write(h,f.blob);say(`Saved ${h.name}.`);
  if(f.key==='png'&&files.some(o=>o.checked&&o.key!=='png'))say(`Saved ${h.name}. Keep the groove WAV and JSON beside it with the same name — Save set to folder does that in one go.`);
 }catch(e){if(e.name==='AbortError')say('Save cancelled.');else fault('Could not save: '+e.message);}
}
$('saveSet').onclick=async()=>{
 clearFault();const chosen=files.filter(f=>f.checked);if(!chosen.length)return;
 if(!FS_DIR){for(const f of chosen)download(f);say(`${chosen.length} file${chosen.length>1?'s':''} sent to your browser’s downloads.`);return;}
 try{
  const dir=await showDirectoryPicker({id:'vinyl-cuts',mode:'readwrite',startIn:'downloads'});
  const clash=[];for(const f of chosen){try{await dir.getFileHandle(fileName(f));clash.push(fileName(f));}catch{}}
  if(clash.length&&!confirm(`${dir.name} already has:\n${clash.join('\n')}\n\nReplace them?`)){say('Nothing saved; choose another name or folder.');return;}
  for(const f of chosen)await write(await dir.getFileHandle(fileName(f),{create:true}),f.blob);
  say(`Saved ${chosen.length} file${chosen.length>1?'s':''} to “${dir.name}”: ${chosen.map(fileName).join(', ')}.`);
 }catch(e){if(e.name==='AbortError')say('Save cancelled.');else fault('Could not save: '+e.message);}
};
if(!FS_DIR){$('saveSet').textContent='Download set';$('saveHint').textContent='This browser cannot open a folder picker, so the files go to its downloads folder. Chrome or Edge let you choose the folder.';}

setState('idle');refreshSource();renderFiles();
})();
