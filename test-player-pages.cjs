// Player on static hosting (no serve.py): the api/progress probe 404s, so records import
// in the browser (window.VinylBrowser) and play from decoded samples. Mocked DOM/audio.
const assert=require('node:assert/strict');
const ids={};
const element=id=>ids[id]??=({id,value:'0',disabled:false,hidden:true,files:[],textContent:'',dataset:{},attrs:{},
 setAttribute(k,v){this.attrs[k]=v;},replaceChildren(){},append(){},addEventListener(){},click(){},querySelector(){return null;},contains(){return false;}});
element('volume').value='.7';element('rpm').value='45';
const radio=(name,value,checked=false)=>({name,value,checked,disabled:false,onchange:null});
const groups={source:[radio('source','vector'),radio('source','png')],rpmPreset:[radio('rpmPreset','33.333333'),radio('rpmPreset','45',true),radio('rpmPreset','78')]};
global.document={body:{dataset:{}},getElementById:element,querySelectorAll(sel){const m=/name=(\w+)/.exec(sel);return m?groups[m[1]]:[];},createElement(){return{};}};
global.window=global;global.setInterval=()=>{};const events=[];global.dispatchEvent=e=>{events.push(e);};global.CustomEvent=class{constructor(name,obj){this.type=name;this.detail=obj.detail;}};
const made=[];class AudioContext{constructor(){this.currentTime=0;this.destination={};}createGain(){return {gain:{value:1},connect(){}};}async resume(){}
 createBuffer(ch,len,rate){const d=new Float32Array(len);const b={length:len,sampleRate:rate,duration:len/rate,numberOfChannels:ch,getChannelData(){return d;}};made.push(b);return b;}
 createBufferSource(){return {playbackRate:{value:1},connect(){},start(){},stop(){}};}}
global.AudioContext=AudioContext;
URL.createObjectURL=()=>'blob:preview-1';
const requests=[];global.fetch=async url=>{requests.push(String(url));return {ok:false,status:404,json:async()=>{throw Error('not json');}};};
const metadata={duration_sec:2,rpm_cut:45,sample_rate:16000,r_start_mm:86,pitch_mm:2,label_radius_mm:27,disc_radius_mm:90,amp_mm:.3,lead_in_turns:.35,thickness_mm:2.5};
const opened=[];global.VinylBrowser={async open(parts,onStage){opened.push(parts);onStage('tracing',0);
 if(parts.png.name==='bad.png')throw Error('Expected a 16-bit grayscale height map, not an RGB preview.');
 return {metadata,playback_source:parts.vector?'vector':'png',has_vector:!!parts.vector,audio_origin:'x',preview:new Uint8Array(4),
  playback:{png:new Float32Array(32000).fill(.25),vector:parts.vector?new Float32Array(32000).fill(.5):null}};}};
require('./static/player.js');
const tick=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
 await tick();
 element('recordFile').onchange({target:{files:[{name:'tune.png'},{name:'tune.groove.wav'},{name:'tune.json'}],value:''}});for(let i=0;i<5;i++)await tick();
 assert.ok(requests.some(u=>u.startsWith('api/progress?job=')),'relative probe');assert.ok(!requests.some(u=>u.includes('/api/import')),'no Python import on Pages');
 assert.equal(opened.length,1);assert.equal(opened[0].vector.name,'tune.groove.wav');assert.equal(opened[0].json.name,'tune.json');
 assert.equal(vinyl.record.metadata,metadata);assert.equal(vinyl.record.previewUrl,'blob:preview-1');assert.equal(vinyl.sources.both,true);
 assert.equal(vinyl.buffer.getChannelData(0)[0],.5,'vector buffer from decoded samples');assert.equal(vinyl.buffer.sampleRate,16000);
 assert.equal(events.filter(e=>e.type==='vinyl-record').at(-1).detail.previewUrl,'blob:preview-1');
 element('recordFile').onchange({target:{files:[{name:'second.png'}],value:''}});for(let i=0;i<5;i++)await tick();
 assert.equal(vinyl.sources.both,false);assert.equal(vinyl.buffer.getChannelData(0)[0],.25);
 assert.deepEqual(vinyl.sleeves().map(s=>s.cover),['blob:preview-1'],'sleeve cover uses the blob preview');
 element('recordFile').onchange({target:{files:[{name:'bad.png'}],value:''}});for(let i=0;i<5;i++)await tick();
 assert.equal(element('fault').hidden,false);assert.match(element('fault').textContent,/not a record from the Cutter/);
 assert.equal(requests.filter(u=>u.startsWith('api/progress')).length,1,'probe cached');
 console.log('PASS: Pages player — relative api/progress probe (cached), in-browser import with PNG+groove+JSON, no /api/import, AudioBuffers from decoded samples, blob preview for disc and sleeve, non-record PNG refused. Mocked DOM/audio.');
})().catch(e=>{console.error(e);process.exitCode=1;});
