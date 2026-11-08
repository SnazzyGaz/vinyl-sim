// Lightweight control-logic test of static/player.js; NOT a real WebGL/browser/audio audition.
const assert=require('node:assert/strict');
const ids={};
const element=id=>ids[id]??=({id,value:'0',disabled:false,hidden:true,files:[],textContent:'',dataset:{},attrs:{},
 setAttribute(k,v){this.attrs[k]=v;},replaceChildren(){},append(){},addEventListener(){},click(){},querySelector(){return null;},contains(){return false;}});
element('volume').value='.7';element('rpm').value='45';
const radio=(name,value,checked=false)=>({name,value,checked,disabled:false,onchange:null});
const groups={source:[radio('source','vector'),radio('source','png')],rpmPreset:[radio('rpmPreset','33.333333'),radio('rpmPreset','45',true),radio('rpmPreset','78')]};
global.document={body:{dataset:{}},getElementById:element,querySelectorAll(sel){const m=/name=(\w+)/.exec(sel);return m?groups[m[1]]:[];},createElement(){return{};}};
global.window=global;global.setInterval=()=>{};const events=[];global.dispatchEvent=e=>{events.push(e);};global.CustomEvent=class{constructor(name,obj){this.type=name;this.detail=obj.detail;}};
let context;const sources=[];class AudioContext{
 constructor(){this.currentTime=0;context=this;this.destination={};}
 createGain(){return {gain:{value:1},connect(){}};}
 async resume(){}
 async decodeAudioData(){return {sampleRate:16000,length:160000,duration:10,numberOfChannels:1,getChannelData(){return new Float32Array(160000);}};}
 createBuffer(){return {getChannelData(){return new Float32Array(160000);},duration:10};}
 createBufferSource(){const s={playbackRate:{value:1},connect(){},start(when,position){this.offset=position;},stop(){}};sources.push(s);return s;}
}global.AudioContext=AudioContext;
const record={id:'0'.repeat(32),base:'/output/'+'0'.repeat(32)+'/',has_vector:true,playback_source:'vector',metadata:{duration_sec:10,rpm_cut:45,sample_rate:16000,bandlimit_hz:1415,r_start_mm:86,pitch_mm:5,label_radius_mm:27,disc_radius_mm:90,amp_mm:.3,lead_in_turns:.35}};
const record2={...record,id:'1'.repeat(32),base:'/output/'+'1'.repeat(32)+'/',has_vector:false,playback_source:'png',metadata:{...record.metadata,rpm_cut:78,disc_radius_mm:100}};
let nextImport=record;const requests=[];const apiPosts=()=>requests.filter(u=>u==='/api/import');
global.fetch=async(url,opt)=>{requests.push(url);if(String(url).includes('demo/record.json'))return{ok:false,status:404,json:async()=>({}),arrayBuffer:async()=>new ArrayBuffer(0)};return{ok:true,json:async()=>nextImport,arrayBuffer:async()=>new ArrayBuffer(0)};};
require('./static/player.js');
const tick=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
 assert.equal(element('needle').disabled,true,'needle disabled before a record');
 // A groove WAV alone is not a record here.
 element('recordFile').onchange({target:{files:[{name:'a.groove.wav'}],value:''}});await tick();
 assert.equal(element('fault').hidden,false);assert.equal(apiPosts().length,0);
 element('recordFile').onchange({target:{files:[{name:'tune.png'},{name:'tune.groove.wav'},{name:'tune.json'}],value:''}});await tick();await tick();
 assert.equal(apiPosts()[0],'/api/import');assert.equal(vinyl.record,record);assert.equal(vinyl.down,false);
 assert.equal(element('needleState').textContent,'Needle lifted — silent');
 assert.equal(groups.source[0].checked,true);assert.equal(groups.source[1].disabled,false);
 await element('needle').onclick();await tick();assert.equal(vinyl.down,true);assert.equal(element('needle').textContent,'Lift needle');
 context.currentTime=2;assert.equal(vinyl.time(),2);
 groups.rpmPreset[2].checked=true;groups.rpmPreset[2].onchange({target:groups.rpmPreset[2]});await tick();assert.equal(sources.at(-1).playbackRate.value,78/45);
 element('needle').onclick();const lifted=vinyl.time();context.currentTime=9;assert.equal(vinyl.time(),lifted);assert.equal(vinyl.down,false);
 // Seek while lifted does not drop the needle.
 element('seek').oninput({target:{value:'500'}});element('seek').onchange();await tick();assert.equal(vinyl.down,false);assert.equal(vinyl.time(),5);
 // Needle down: seek updates position and resumes.
 element('needle').onclick();await tick();element('seek').oninput({target:{value:'200'}});element('seek').onchange();await tick();assert.equal(vinyl.down,true);assert.equal(sources.at(-1).offset,2);
 // Hold the disc: stops; release resumes from there.
 vinyl.grabStart(50,0);assert.equal(vinyl.state.grabbed,true);vinyl.grabEnd();await tick();assert.equal(vinyl.state.grabbed,false);assert.equal(vinyl.down,true);
 // Source plate switches buffers without dropping a lifted needle.
 vinyl.lift();groups.source[1].checked=true;groups.source[1].onchange({target:groups.source[1]});assert.equal(vinyl.record.playback_source,'png');assert.equal(vinyl.down,false);

 // Library + sleeves: opening a second record sleeves the first, keeps its buffers; swapTo needs no re-import.
 const firstBuffer=vinyl.buffer;nextImport=record2;const posts=()=>apiPosts().length;
 element('recordFile').onchange({target:{files:[{name:'b.png'}],value:''}});await tick();await tick();
 assert.equal(posts(),2);assert.equal(vinyl.record,record2);assert.equal(vinyl.rpm,78);assert.equal(element('recordName').textContent,'b');assert.equal(vinyl.libraryCount,2);
 let sl=events.filter(e=>e.type==='vinyl-sleeves').at(-1).detail;assert.equal(sl.current,record2.id);assert.deepEqual(sl.sleeves.map(s=>[s.id,s.label,s.cover]),[[record.id,'tune',record.base+'preview.png']]);
 assert.equal(vinyl.sources.both,false);
 const fetchesBefore=requests.length;element('needle').onclick();await tick();assert.equal(vinyl.down,true);
 assert.equal(vinyl.swapTo(record.id),true);assert.equal(requests.length,fetchesBefore,'swap re-uses decoded buffers: no fetch, no /api/import');
 assert.equal(vinyl.record,record);assert.equal(vinyl.down,false,'needle lifted on swap');assert.equal(vinyl.time(),0);assert.equal(vinyl.rpm,45);assert.equal(element('recordName').textContent,'tune');
 assert.equal(vinyl.record.playback_source,'png','source choice remembered per record');assert.equal(vinyl.buffer,firstBuffer);
 assert.equal(events.filter(e=>e.type==='vinyl-record').at(-1).detail,record);
 sl=events.filter(e=>e.type==='vinyl-sleeves').at(-1).detail;assert.deepEqual(sl.sleeves.map(s=>s.id),[record2.id]);
 assert.equal(vinyl.swapTo(record.id),false,'already on the platter');assert.equal(vinyl.swapTo('nope'),false);
 // 3D cabinet setters share the HTML paths.
 vinyl.setVolume(.4);assert.equal(element('volume').value,'0.4');assert.equal(element('volumeValue').textContent,40);
 vinyl.setSpeed(78);assert.equal(element('rpm').value,78);assert.equal(groups.rpmPreset[2].checked,true);
 vinyl.setSource('vector');assert.equal(vinyl.record.playback_source,'vector');assert.equal(groups.source[0].checked,true);
 // Two PNGs in one drop still refused.
 element('recordFile').onchange({target:{files:[{name:'x.png'},{name:'y.png'}],value:''}});await tick();assert.equal(element('fault').hidden,false);assert.match(element('fault').textContent,/one at a time/);
 console.log('PASS: record library + sleeves event, swapTo without re-import (needle lifted, t=0, rpm from cut), 3D setters for volume/speed/source, one PNG per drop; PNG-required open, vector/PNG source plate, drop/lift single button, 78 preset speed ratio, lifted seek does not drop, down seek resumes, hold/release resumes. Mocked DOM/audio, not a browser test.');
})().catch(e=>{console.error(e);process.exitCode=1;});
