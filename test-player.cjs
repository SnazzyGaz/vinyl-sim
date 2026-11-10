// Lightweight control-logic test of static/player.js; NOT a real WebGL/browser/audio audition.
const assert=require('node:assert/strict');
const ids={};
const element=id=>ids[id]??=({id,value:'0',disabled:false,hidden:true,files:[],textContent:'',dataset:{},attrs:{},
 setAttribute(k,v){this.attrs[k]=v;},replaceChildren(){},append(){},addEventListener(){},click(){},querySelector(){return null;},contains(){return false;}});
element('volume').value='.7';element('rpm').value='45';
const radio=(name,value,checked=false)=>({name,value,checked,disabled:false,onchange:null});
const groups={source:[radio('source','vector'),radio('source','png')],rpmPreset:[radio('rpmPreset','33.333333'),radio('rpmPreset','45',true),radio('rpmPreset','78')]};
global.document={body:{dataset:{}},getElementById:element,querySelectorAll(sel){const m=/name=(\w+)/.exec(sel);return m?groups[m[1]]:[];},createElement(){return{};}};
global.window=global;const intervals=[];global.setInterval=f=>{intervals.push(f);};const events=[];global.dispatchEvent=e=>{events.push(e);};global.CustomEvent=class{constructor(name,obj){this.type=name;this.detail=obj.detail;}};
const params=names=>Object.fromEntries(names.split(' ').map(k=>[k,{value:0}]));
const node=extra=>({...extra,connect(to){this.connected=to;}});
let context;const sources=[];class AudioContext{
 constructor(){this.currentTime=0;context=this;this.destination={};this.listener=params('positionX positionY positionZ forwardX forwardY forwardZ upX upY upZ');}
 createGain(){return this.gain=node({gain:{value:1}});}
 createPanner(){return this.panner=node(params('positionX positionY positionZ'));}
 async resume(){}
 async decodeAudioData(){return {sampleRate:16000,length:160000,duration:10,numberOfChannels:1,getChannelData(){return new Float32Array(160000);}};}
 createBuffer(){return {getChannelData(){return new Float32Array(160000);},duration:10};}
 createBufferSource(){const s={playbackRate:{value:1},connect(to){this.connected=to;},start(when,position){this.offset=position;},stop(){this.stopped=true;}};sources.push(s);return s;}
}global.AudioContext=AudioContext;
const record={id:'0'.repeat(32),base:'/output/'+'0'.repeat(32)+'/',has_vector:true,playback_source:'vector',metadata:{duration_sec:10,rpm_cut:45,sample_rate:16000,bandlimit_hz:1415,r_start_mm:86,pitch_mm:5,label_radius_mm:27,disc_radius_mm:90,amp_mm:.3,lead_in_turns:.35}};
const record2={...record,id:'1'.repeat(32),base:'/output/'+'1'.repeat(32)+'/',has_vector:false,playback_source:'png',metadata:{...record.metadata,rpm_cut:78,disc_radius_mm:100}};
let nextImport=record;const requests=[];const apiPosts=()=>requests.filter(u=>u==='/api/import');
// serve.py answers the api/progress probe, so the Python /api/import path is the one under test.
global.fetch=async(url,opt)=>{requests.push(url);if(String(url).includes('api/progress'))return{ok:true,json:async()=>({stage:'unknown',index:-1,total:4})};if(String(url).includes('demo/record.json'))return{ok:false,status:404,json:async()=>({}),arrayBuffer:async()=>new ArrayBuffer(0)};return{ok:true,json:async()=>nextImport,arrayBuffer:async()=>new ArrayBuffer(0)};};
require('./static/player.js');
const tick=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
 vinyl.setListener();assert.equal(context,undefined,'spatial updates before audio are a no-op');
 assert.equal(element('needle').disabled,true,'needle disabled before a record');
 // A groove WAV alone is not a record here.
 element('recordFile').onchange({target:{files:[{name:'a.groove.wav'}],value:''}});await tick();
 assert.equal(element('fault').hidden,false);assert.equal(apiPosts().length,0);
 element('recordFile').onchange({target:{files:[{name:'tune.png'},{name:'tune.groove.wav'},{name:'tune.json'}],value:''}});await tick();await tick();
 assert.equal(apiPosts()[0],'/api/import');assert.equal(vinyl.record,record);assert.equal(vinyl.down,false);assert.equal(vinyl.record.label,'tune');
 assert.equal(element('needleState').textContent,'Needle lifted — silent');
 assert.equal(context.gain.connected,context.panner);assert.equal(context.panner.connected,context.destination);
 assert.equal(context.panner.panningModel,'HRTF');assert.equal(context.panner.distanceModel,'inverse');assert.equal(context.panner.rolloffFactor,.5);
 assert.equal(context.panner.coneInnerAngle,360);assert.equal(context.panner.coneOuterAngle,360);
 const pos={x:100,y:-500,z:200},mouth={x:-20,y:30,z:120},forward={x:0,y:1,z:0},up={x:0,y:0,z:1};
 vinyl.setListener(pos,forward,up,mouth,600);
 assert.deepEqual(['positionX','positionY','positionZ'].map(k=>context.panner[k].value),[-.02,.12,-.03]);
 assert.deepEqual(['positionX','positionY','positionZ'].map(k=>context.listener[k].value),[.1,.2,.5]);
 assert.equal(context.panner.refDistance,.6);
 assert.deepEqual(['forwardX','forwardY','forwardZ','upX','upY','upZ'].map(k=>context.listener[k].value),[0,0,-1,0,1,-0]);
 const modern=context.listener,legacy={setPosition(...p){this.position=p;},setOrientation(...p){this.orientation=p;}};context.listener=legacy;
 vinyl.setListener(pos,forward,up,mouth,600);assert.deepEqual(legacy.position,[.1,.2,.5]);assert.deepEqual(legacy.orientation,[0,0,-1,0,1,-0]);context.listener=modern;
 assert.equal(groups.source[0].checked,true);assert.equal(groups.source[1].disabled,false);
 await element('needle').onclick();await tick();assert.equal(vinyl.down,true);assert.equal(element('needle').textContent,'Lift needle');
 assert.equal(sources.at(-1).connected,context.gain,'playback feeds shared spatial path');
 vinyl.grabStart(50,0);vinyl.grabMove(49,5);assert.equal(sources.at(-1).connected,context.gain,'scratch feeds shared spatial path');vinyl.grabEnd();await tick();await vinyl.drop(0);
 context.currentTime=2;assert.equal(vinyl.time(),2);
 groups.rpmPreset[2].checked=true;groups.rpmPreset[2].onchange({target:groups.rpmPreset[2]});await tick();assert.equal(sources.at(-1).playbackRate.value,78/45);
 element('needle').onclick();const lifted=vinyl.time();context.currentTime=9;assert.equal(vinyl.time(),lifted);assert.equal(vinyl.down,false);
 // Seek while lifted does not drop the needle.
 element('seek').oninput({target:{value:'500'}});element('seek').onchange();await tick();assert.equal(vinyl.down,false);assert.equal(vinyl.time(),5);
 // Needle down: seek updates position and resumes.
 element('needle').onclick();await tick();element('seek').oninput({target:{value:'200'}});element('seek').onchange();await tick();assert.equal(vinyl.down,true);assert.equal(sources.at(-1).offset,2);
 // Hold the disc: stops; release resumes from there.
 vinyl.grabStart(50,0);assert.equal(vinyl.state.grabbed,true);vinyl.grabEnd();await tick();assert.equal(vinyl.state.grabbed,false);assert.equal(vinyl.down,true);
 {// A scratch keeps one steady readout: fast forward, a slow jittery drag, quick reversals and short pauses all read
  // "scratching" (the sound still cuts out at once in a pause); only a hand held still for a moment reads "record stopped".
  // Release, a needle lift or a deliberate stop change the readout at once. The needle key keeps its wording throughout.
  const realNow=performance.now.bind(performance);let T=realNow();performance.now=()=>T;
  const label=()=>element('needleState').textContent,key=()=>element('needle').textContent,refresh=()=>intervals.forEach(f=>f());
  let a=0;const at=()=>[50*Math.cos(a),50*Math.sin(a)],move=(da,ms)=>{T+=ms;a+=da;vinyl.grabMove(...at());},seen=new Set();
  await vinyl.drop(0);assert.equal(label(),'Needle down — playing');
  vinyl.grabStart(...at());seen.add(label());assert.equal(label(),'Hold — scratching','catching the spinning record reads as a scratch, not a stop');
  for(let i=0;i<20;i++){move(.05,16);seen.add(label());seen.add(key());}                                  // fast forward
  for(let i=0;i<8;i++){move(.012,70);seen.add(label());T+=0;}                                             // slow, jittery drag
  for(let c=0;c<6;c++){for(let i=0;i<3;i++)move(-.04,16);for(let i=0;i<3;i++)move(.04,16);seen.add(label());} // back and forth
  const voice=sources.at(-1);T+=60;vinyl.grabTick();assert.equal(voice.stopped,true,'a pause cuts the scratch sound at once');
  T+=100;refresh();seen.add(label());move(-.05,16);seen.add(label());                                      // a short pause inside the scratch
  assert.deepEqual([...seen].sort(),['Hold — scratching','Lift needle'].sort(),'one label and one key wording for the whole scratch');
  T+=200;refresh();assert.equal(label(),'Hold — scratching','still a scratch 200 ms after the last move');
  T+=200;refresh();assert.equal(label(),'Hold — record stopped','held still: the record reads stopped');assert.equal(key(),'Lift needle');
  move(.05,16);assert.equal(label(),'Hold — scratching','moving again reads as a scratch at once');
  vinyl.grabEnd();await tick();assert.equal(label(),'Needle down — playing','release plays at once');assert.equal(vinyl.down,true);
  vinyl.grabStart(...at());move(.05,16);await element('needle').onclick();assert.equal(vinyl.down,false,'the needle key lifts even mid-scratch');assert.equal(vinyl.state.grabbed,false);
  assert.equal(label(),'Needle lifted — silent','a lift reads at once');assert.equal(key(),'Drop needle');vinyl.grabMove(...at());vinyl.grabEnd();assert.equal(vinyl.down,false,'the hand coming off after a lift does not drop the needle');
  vinyl.grabStart(...at());assert.equal(label(),'Hold — record stopped','a hand on a still record is not a scratch');vinyl.grabEnd();await tick();vinyl.lift();
  performance.now=realNow;}
 // Source plate switches buffers without dropping a lifted needle.
 vinyl.lift();groups.source[1].checked=true;groups.source[1].onchange({target:groups.source[1]});assert.equal(vinyl.record.playback_source,'png');assert.equal(vinyl.down,false);

 // Library + sleeves: opening a second record sleeves the first, keeps its buffers; swapTo needs no re-import.
 const firstBuffer=vinyl.buffer;nextImport=record2;const posts=()=>apiPosts().length;
 element('recordFile').onchange({target:{files:[{name:'b.png'}],value:''}});await tick();await tick();
 assert.equal(posts(),2);assert.equal(vinyl.record,record2);assert.equal(vinyl.rpm,78);assert.equal(element('recordName').textContent,'b');assert.equal(vinyl.record.label,'b');assert.equal(vinyl.libraryCount,2);
 let sl=events.filter(e=>e.type==='vinyl-sleeves').at(-1).detail;assert.equal(sl.current,record2.id);assert.deepEqual(sl.sleeves.map(s=>[s.id,s.label,s.cover]),[[record.id,'tune',record.base+'preview.png']]);
 assert.equal(vinyl.sources.both,false);
 const fetchesBefore=requests.length;element('needle').onclick();await tick();assert.equal(vinyl.down,true);
 assert.equal(vinyl.swapTo(record.id),true);assert.equal(requests.length,fetchesBefore,'swap re-uses decoded buffers: no fetch, no /api/import');
 assert.equal(vinyl.record,record);assert.equal(vinyl.down,false,'needle lifted on swap');assert.equal(vinyl.time(),0);assert.equal(vinyl.rpm,45);assert.equal(element('recordName').textContent,'tune');assert.equal(vinyl.record.label,'tune');
 assert.equal(vinyl.record.playback_source,'png','source choice remembered per record');assert.equal(vinyl.buffer,firstBuffer);
 assert.equal(events.filter(e=>e.type==='vinyl-record').at(-1).detail,record);
 sl=events.filter(e=>e.type==='vinyl-sleeves').at(-1).detail;assert.deepEqual(sl.sleeves.map(s=>s.id),[record2.id]);
 assert.equal(vinyl.swapTo(record.id),false,'already on the platter');assert.equal(vinyl.swapTo('nope'),false);
 // 3D cabinet setters share the HTML paths.
 vinyl.setVolume(.4);assert.equal(element('volume').value,'0.4');assert.equal(element('volumeValue').textContent,40);
 vinyl.setSpeed(78);assert.equal(element('rpm').value,78);assert.equal(groups.rpmPreset[2].checked,true);
 vinyl.setSource('vector');assert.equal(vinyl.record.playback_source,'vector');assert.equal(groups.source[0].checked,true);
 // Inspection is an audio safety interlock, including a drop queued before pickup.
 await vinyl.drop(0);assert.equal(vinyl.down,true);const queued=vinyl.drop(0);vinyl.setInspecting(true);await queued;
 assert.equal(vinyl.inspecting,true);assert.equal(vinyl.down,false);assert.equal(element('needle').disabled,true);
 const count=sources.length;await vinyl.drop(1);vinyl.grabStart(50,0);assert.equal(sources.length,count);assert.equal(vinyl.state.grabbed,false);
 vinyl.setVolume(.6);assert.equal(context.gain.gain.value,.6);vinyl.setInspecting(false);assert.equal(element('needle').disabled,false);
 await vinyl.drop(0);assert.equal(vinyl.down,true);vinyl.lift();
 // Two PNGs in one drop still refused.
 element('recordFile').onchange({target:{files:[{name:'x.png'},{name:'y.png'}],value:''}});await tick();assert.equal(element('fault').hidden,false);assert.match(element('fault').textContent,/one at a time/);
 console.log('PASS: record library + sleeves event, swapTo without re-import (needle lifted, t=0, rpm from cut), 3D setters for volume/speed/source, one PNG per drop; PNG-required open, vector/PNG source plate, drop/lift single button, 78 preset speed ratio, lifted seek does not drop, down seek resumes, hold/release resumes, one steady scratch readout (no stop flashes in pauses or reversals; lift and release read at once). Mocked DOM/audio, not a browser test.');
})().catch(e=>{console.error(e);process.exitCode=1;});
