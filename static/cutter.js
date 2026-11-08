/* Cutter room. Sends audio to the existing Python encode path, then fetches the
   cut files as blobs so the user chooses where they are saved. No playback here. */
(() => {
const $=id=>document.getElementById(id);
let cut=null;          // server record {id, base, metadata, has_vector}
let files=[];          // [{key, name, label, note, blob, checked}]
let busy=false;
const FS_DIR='showDirectoryPicker' in window, FS_FILE='showSaveFilePicker' in window;

/* ---------- states ---------- */
function setState(s){document.body.dataset.state=s;$('lamp').dataset.state={idle:'off',cutting:'busy',done:'on',error:'error'}[s]||'off';}
function say(text){$('status').textContent=text;}
function fault(text){$('fault').textContent=text;$('fault').hidden=false;setState('error');say('Stopped.');}
function clearFault(){$('fault').hidden=true;}

/* ---------- source selection ---------- */
function sourceMode(){return document.querySelector('input[name=src]:checked').value;}
function refreshSource(){
 const f=$('audioFile').files[0],mode=sourceMode();
 $('fileName').textContent=f?f.name:'No file chosen';
 $('choose').disabled=busy||mode!=='file';
 $('cut').disabled=busy||(mode==='file'&&!f);
 for(const r of document.querySelectorAll('input[name=size]')){r.disabled=busy||mode==='sample';if(mode==='sample'&&r.value==='4096')r.checked=true;}
 $('sizeNote').textContent=mode==='sample'?'The original tune is always cut at 4096.':'4096 follows the groove radius for bandwidth; 2048 is lighter and duller.';
 if(!$('recordName').dataset.touched)$('recordName').value=mode==='sample'?'original-tune':(f?stem(f.name):'');
}
function stem(n){return n.replace(/\.[^.]+$/,'');}
function safeName(n){n=(n||'').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'-').replace(/\s+/g,' ').replace(/^\.+/,'');return n.slice(0,120)||'record';}
$('choose').onclick=()=>$('audioFile').click();
$('audioFile').onchange=()=>{document.querySelector('input[name=src][value=file]').checked=true;refreshSource();};
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
function startTraverse(id,word){
 started=performance.now();traverse(0,word);
 $('traverseWrap').hidden=true;
 revealTimer=setTimeout(()=>{$('traverseWrap').hidden=false;},2000);
 pollTimer=setInterval(async()=>{
  const secs=((performance.now()-started)/1000).toFixed(0);$('elapsed').textContent=secs+' s';
  try{const r=await fetch('/api/progress?job='+id);const p=await r.json();
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
 const mode=sourceMode(),f=$('audioFile').files[0];
 if(mode==='file'&&!f){fault('Choose an audio file first, or pick the original 11-second tune.');return;}
 const id=job();lock(true);setState('cutting');cut=null;files=[];renderFiles();showProof(null);
 say(mode==='sample'?'Cutting the original tune…':'Sending audio to the lathe…');
 startTraverse(id,mode==='sample'?STAGE_TEXT.cutting:'Sending audio');
 try{
  let data;
  if(mode==='sample'){traverse(STAGE_AT.cutting,STAGE_TEXT.cutting);data=await post('/api/sample',null,id);}
  else{const form=new FormData();form.append('file',f);form.append('size',document.querySelector('input[name=size]:checked').value);
   data=await post('/api/encode',form,id,p=>{traverse(p*.14,p<1?`Sending audio ${Math.round(p*100)}%`:STAGE_TEXT.cutting);if(p>=1)say('Cutting the groove…');});}
  traverse(.96,'Collecting the cut');say('Collecting the cut files…');
  cut=data;await collect(data);
  traverse(1,STAGE_TEXT.done);setState('done');
  const m=data.metadata;
  say(`Cut complete. ${m.image_size} map · ${Math.round(m.disc_radius_mm*2)} mm at ${m.rpm_cut<40?'33⅓':Math.round(m.rpm_cut)} RPM · ${m.duration_sec.toFixed(1)} s. Choose where to save it.`);
  showProof(data.base+'preview.png');
 }catch(e){console.error(e);fault(e.message);}
 finally{stopTraverse();lock(false);}
};
async function blob(url){const r=await fetch(url);if(!r.ok)throw Error('Missing cut file: '+url.split('/').pop());return r.blob();}
async function collect(d){
 const list=[['png','heightmap.png','.png','16-bit height-map PNG','The record. Opens in the Player.',true]];
 if(d.has_vector)list.push(['wav','heightmap.groove.wav','.groove.wav','Groove master WAV','Vector master; keep with the PNG.',true]);
 list.push(['json','heightmap.json','.json','Spiral metadata JSON','Pairs the groove WAV with the PNG.',true]);
 list.push(['preview','preview.png','.preview.png','Viewing picture','8-bit, not a playable record.',false]);
 files=[];
 for(const [key,src,ext,label,note,checked] of list)files.push({key,ext,label,note,checked,blob:await blob(d.base+src),mime:src.endsWith('.png')?'image/png':src.endsWith('.json')?'application/json':'audio/wav'});
 renderFiles();
}
function showProof(url){const img=$('proof');if(url){img.src=url;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}}

/* ---------- mesh (secondary export) ---------- */
$('build').onclick=async()=>{
 if(busy||!cut)return;clearFault();const id=job();lock(true);setState('cutting');say('Building the 3D relief mesh…');startTraverse(id,'Building mesh');
 try{traverse(.3,'Building mesh');const m=await post('/api/build',JSON.stringify({id:cut.id}),id);
  for(const [key,src,ext,label,note] of [['glb','disc.glb','.glb','3D mesh GLB','Millimetre units; not used for playback.'],['stl','disc.stl','.stl','3D mesh STL','Millimetre units; not used for playback.']])
   if(!files.some(f=>f.key===key))files.push({key,ext,label,note,checked:true,blob:await blob(cut.base+src),mime:key==='glb'?'model/gltf-binary':'model/stl'});
  traverse(1,'Mesh built');setState('done');renderFiles();
  say(`Mesh built: ${m.triangles.toLocaleString('en-GB')} triangles, watertight: ${m.watertight?'yes':'no'}. ${m.warning||''}`);
 }catch(e){console.error(e);fault(e.message);}finally{stopTraverse();lock(false);}
};

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
 $('saveSet').disabled=busy||!any;$('build').disabled=busy||!cut||files.some(f=>f.key==='glb');
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
