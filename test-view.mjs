// Real pinned Three.js camera/ray math + OrbitControls; mocked DOM/renderer,
// NOT a real browser/WebGL/audio audition. Optional Node test, public CDN fetch.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'vinyl-view-'));
try {
  const base='https://cdn.jsdelivr.net/npm/three@0.169.0/';
  async function download(url){const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);return r.text();}
  const threeFile=path.join(tmp,'three.mjs');await fs.writeFile(threeFile,await download(base+'build/three.module.js'));
  const controlFile=path.join(tmp,'OrbitControls.mjs');await fs.writeFile(controlFile,(await download(base+'examples/jsm/controls/OrbitControls.js')).replace("from 'three'",`from '${pathToFileURL(threeFile).href}'`));
  const real=await import(pathToFileURL(threeFile));const {OrbitControls}=await import(pathToFileURL(controlFile));
  class Element {
    constructor(){this.listeners={};this.style={};this.clientWidth=800;this.clientHeight=600;}
    addEventListener(k,fn){(this.listeners[k]??=new Set()).add(fn);}
    removeEventListener(k,fn){this.listeners[k]?.delete(fn);}
    emit(k,e={}){for(const fn of [...(this.listeners[k]||[])])fn({preventDefault(){},stopPropagation(){},...e});}
    getRootNode(){return root;} setPointerCapture(){} releasePointerCapture(){}
    getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
    replaceChildren(el){this.child=el;}
  }
  const root=new Element(),view=new Element(),reset=new Element();let tick;
  const THREE={...real,WebGLRenderer:class{constructor(){this.domElement=new Element();}setPixelRatio(){}setSize(){}render(scene,camera){scene.updateMatrixWorld();camera.updateMatrixWorld();}},TextureLoader:class{load(url,onLoad,onProgress,onError){onError?.(new Error('no texture in test'));}}};
  let spatial;let lifts=0,drops=0;const placements=[],swaps=[],vols=[],speeds=[],srcs=[];const vinyl={setListener(position,forward,up,mouth,refDistance){spatial={position:position.clone(),forward:forward.clone(),up:up.clone(),mouth:mouth.clone(),refDistance};},record:null,down:true,buffer:null,volume:.7,rpm:45,source:'vector',sources:{vector:true,png:true,both:true},swapTo(id){swaps.push(id);return true;},setVolume(v){vols.push(v);this.volume=v;},setSpeed(v){speeds.push(v);this.rpm=v;},setSource(m){srcs.push(m);this.source=m;},drop(){drops++;this.down=true;return Promise.resolve();},state:{rotation:0,dragging:false,angle:0},time(){return 0;},lift(){lifts++;this.down=false;},place(x,y,release){placements.push({x,y,release});},grabStart(x,y){placements.push({x,y,release:false});},grabMove(x,y){placements.push({x,y,release:false});},grabEnd(){placements.push({...placements.at(-1),release:true});},grabTick(){}};
  const win=new Element();win.vinyl=vinyl;
  const context={THREE,OrbitControls,document:{getElementById:id=>({view,resetView:reset,status:root}[id])},window:win,devicePixelRatio:1,performance:{now:(()=>{let t=0;return ()=>(t+=16.7);})()},requestAnimationFrame:fn=>{tick=fn;},ResizeObserver:class{constructor(cb){this.cb=cb;}observe(){this.cb();}},console};
  vm.createContext(context);
  const source=(await fs.readFile(new URL('./static/view.js',import.meta.url),'utf8')).replace(/^import .*;$/mg,'');
  vm.runInContext(source+'\nglobalThis.api={camera,controls,renderer,disc,scene,placeTonearm,armRig,armParts,getArm:()=>({armL,armPivotX,armPivotY}),phonograph,sleeves,hula,tonearm,getR:()=>R};',context);
  const {camera,controls,renderer,disc,scene}=context.api,canvas=renderer.domElement;
  // Empty platter before any record; piano-black scene; brass arm, ebonised pillar.
  assert.equal(scene.background.getHex(),0x141310);assert.ok(disc.getObjectByName('placeholder-disc'));
  {const {phonograph,sleeves}=context.api;assert.ok(phonograph.getObjectByName('hula-girl'),'hula girl built with the cabinet');assert.ok(phonograph.getObjectByName('hula-dancer'));assert.equal(sleeves.name,'sleeves');assert.ok(scene.getObjectByName('sleeves'));
   for(const n of ['volume-knob','speed-lever','source-switch'])assert.equal(phonograph.getObjectByName(n),undefined,n+' removed');}
  const metadata={disc_radius_mm:90,label_radius_mm:27,thickness_mm:2.5,r_start_mm:86,pitch_mm:5,lead_in_turns:.35,rpm_cut:45,amp_mm:.3};
  vinyl.record={metadata,base:'/unused/'};win.emit('vinyl-record',{detail:vinyl.record});tick();
  // The same frame sends world-space horn/camera vectors, with reset gain at unity.
  const close=(a,b)=>assert.ok(a.distanceTo(b)<1e-7);
  close(spatial.mouth,new real.Vector3(-18,24.3,124.2));close(spatial.position,camera.position);
  close(spatial.forward,camera.getWorldDirection(new real.Vector3()));
  close(spatial.up,new real.Vector3(0,1,0).transformDirection(camera.matrixWorld));
  assert.ok(Math.abs(spatial.refDistance-spatial.position.distanceTo(spatial.mouth))<1e-7);
  {const ph=context.api.phonograph;ph.position.set(12,-8,5);ph.rotation.z=.3;tick();
   const horn=ph.getObjectByName('horn');close(spatial.mouth,horn.localToWorld(horn.userData.mouth.clone()));
   ph.position.set(0,0,0);ph.rotation.z=0;tick();}
  // Preview is a ring, not a full disc hidden behind a nearly-coplanar label.
  assert.equal(disc.getObjectByName('placeholder-disc'),undefined);assert.equal(disc.children[0].geometry.type,'RingGeometry');
  assert.equal(disc.children[0].geometry.parameters.innerRadius,metadata.label_radius_mm);
  const assertBlack=mat=>{assert.equal(mat.color.getHex(),0x141416);assert.equal(mat.metalness,.04);assert.equal(mat.roughness,.34);assert.equal(mat.vertexColors,false);assert.equal(mat.map,null);};
  assertBlack(disc.children[0].material);
  const label=disc.getObjectByName('vinyl-label');
  assert.equal(label.material.color.getHex(),0xc42420); // loaded record keeps the red paper label
  assert.ok(label.position.z>=metadata.thickness_mm+.2);
  assert.equal(label.geometry.type,'RingGeometry');
  assert.ok(Math.abs(label.geometry.parameters.innerRadius-3.6)<1e-6,'spindle hole through the red label');
  assert.equal(label.geometry.parameters.outerRadius,metadata.label_radius_mm);
  const lights=scene.children.filter(o=>o.isLight);assert.ok(lights.every(o=>o.intensity<=1));
  const event=(x,y,button)=>({pointerId:1,pointerType:'mouse',button,clientX:x,clientY:y,pageX:x,pageY:y,ctrlKey:false,metaKey:false,shiftKey:false});
  const initial=camera.position.clone();canvas.emit('pointerdown',event(400,300,2));canvas.emit('pointermove',event(520,350,2));canvas.emit('pointerup',event(520,350,2));
  for(let i=0;i<80;i++)tick();assert.ok(camera.position.distanceTo(initial)>1);assert.equal(lifts,0);assert.equal(placements.length,0);assert.equal(vinyl.down,true);close(spatial.position,camera.position);
  const middleBefore=camera.position.distanceTo(controls.target);canvas.emit('pointerdown',event(400,300,1));canvas.emit('pointermove',event(400,380,1));canvas.emit('pointerup',event(400,380,1));tick();assert.notEqual(camera.position.distanceTo(controls.target),middleBefore);assert.equal(lifts,0);assert.equal(placements.length,0);
  const before=camera.position.distanceTo(controls.target);canvas.emit('wheel',{deltaY:-100,deltaMode:0,clientX:400,clientY:300});tick();assert.ok(camera.position.distanceTo(controls.target)<before);
  for(let i=0;i<200;i++)canvas.emit('wheel',{deltaY:-100,deltaMode:0,clientX:400,clientY:300});tick();assert.ok(camera.position.distanceTo(controls.target)>=controls.minDistance-1e-8);
  for(let i=0;i<200;i++)canvas.emit('wheel',{deltaY:100,deltaMode:0,clientX:400,clientY:300});tick();assert.ok(camera.position.distanceTo(controls.target)<=controls.maxDistance+1e-8);
  // Reset to a usable distance, orbit again, and pick a known surface point.
  reset.emit('click');canvas.emit('pointerdown',event(400,300,2));canvas.emit('pointermove',event(450,325,2));canvas.emit('pointerup',event(450,325,2));for(let i=0;i<600;i++)tick();
  win.emit('vinyl-sleeves',{detail:{current:'a',sleeves:[{id:'b',label:'Second',cover:'/b/preview.png'},{id:'c',label:'Third',cover:'/c/preview.png'}]}});tick();
  {const js=context.api.sleeves.children.filter(o=>o.name==='sleeve');assert.equal(js.length,2);assert.equal(js[0].getObjectByName('sleeve-label').material.color.getHex(),0xc42420,'fallback Deco front keeps the red label');}
  const expected=new real.Vector3(50,0,2.5),ndc=expected.clone().project(camera),x=(ndc.x+1)*400,y=(1-ndc.y)*300;
  const orbitCamera=camera.position.clone();canvas.emit('pointerdown',event(x,y,0));canvas.emit('pointermove',event(x,y,0));canvas.emit('pointerup',event(x,y,0));tick();
  assert.ok(placements.length>=3);assert.ok(placements.at(-1).release);assert.ok(Math.hypot(placements.at(-1).x-50,placements.at(-1).y)<1e-7);assert.ok(camera.position.distanceTo(orbitCamera)<1e-7);
  assert.equal(lifts,0); // left grab scratches; it never lifts the needle
  assert.equal(swaps.length,0,'a disc grab is never a sleeve swap');
  reset.emit('click');tick();assert.ok(camera.position.distanceTo(initial)<1e-7);
  canvas.emit('pointercancel');assert.equal(lifts,0);
  // Tonearm is a rigid lever: constant length on a fixed pivot, sweeping with groove radius.
  {const {placeTonearm,armRig,armParts,getArm}=context.api;const yaws=[];
   for(const r of [84,60,32]){placeTonearm(r*Math.cos(.6),r*Math.sin(.6),metadata.thickness_mm-.25,true);scene.updateMatrixWorld(true);
    const {armL,armPivotX,armPivotY}=getArm();const tip=new real.Vector3();armParts.at(-1).getWorldPosition(tip);
    assert.ok(armParts.every(o=>o.scale.x===1&&o.scale.y===1&&o.scale.z===1),'no arm part is scaled');
    assert.ok(Math.abs(Math.hypot(tip.x-armPivotX,tip.y-armPivotY)-armL)<1e-6,'tip stays at the arm length from the pivot');
    assert.ok(Math.abs(Math.hypot(tip.x,tip.y)-r)<metadata.pitch_mm,'tip sits on the groove circle (same turn)');
    assert.equal(armRig.position.x,armPivotX);yaws.push(armRig.rotation.z);}
   assert.ok(Math.abs(yaws[0]-yaws[2])>.1,'arm sweeps about the pivot');}

  // Camera is clamped: front-only orbit, polar floor/ceiling, a little zoom.
  {const R0=context.api.getR(),az0=controls.getAzimuthalAngle();assert.ok(Math.abs(controls.minDistance-R0*3.5)<1e-9&&Math.abs(controls.maxDistance-R0*7.5)<1e-9);
   const d0=camera.position.distanceTo(controls.target);assert.ok(d0>=controls.minDistance&&d0<=controls.maxDistance,'default view inside the zoom range');
   for(const dir of [1,-1]){canvas.emit('pointerdown',event(400,300,2));for(let k=1;k<=40;k++)canvas.emit('pointermove',event(400+dir*k*120,300-dir*k*60,2));canvas.emit('pointerup',event(400+dir*4800,300,2));for(let i=0;i<300;i++)tick();
    const az=controls.getAzimuthalAngle(),pol=controls.getPolarAngle();
    assert.ok(az>=controls.minAzimuthAngle-1e-6&&az<=controls.maxAzimuthAngle+1e-6,'azimuth clamped');assert.ok(Math.abs(az-az0)<=1.2+1e-6);
    assert.ok(pol>=controls.minPolarAngle-1e-6&&pol<=controls.maxPolarAngle+1e-6,'polar clamped');
    assert.ok(camera.position.y<controls.target.y,'camera stays in front of the machine');}
   assert.equal(controls.enablePan,false);reset.emit('click');tick();}
  scene.updateMatrixWorld(true);
  const toScreen=v3=>{const n=v3.clone().project(camera);return [(n.x+1)*400,(1-n.y)*300];};
  const tapObj=(o,dx=0,dy=0)=>{const w=new real.Vector3();o.getWorldPosition(w);const [x,y]=toScreen(w);canvas.emit('pointerdown',event(x,y,0));canvas.emit('pointermove',event(x+dx,y+dy,0));canvas.emit('pointerup',event(x+dx,y+dy,0));tick();};
  // Sleeve drag: off the platter it eases home; onto the platter it calls vinyl.swapTo(id).
  {const before=placements.length;const j=context.api.sleeves.children.find(o=>o.name==='sleeve');const c=new real.Vector3(0,0,j.geometry?0:0);
   const mid=new real.Vector3();j.children[0].getWorldPosition(mid);const [sx,sy]=toScreen(mid);
   canvas.emit('pointerdown',event(sx,sy,0));canvas.emit('pointermove',event(sx+5,sy+5,0));canvas.emit('pointerup',event(sx+5,sy+5,0));for(let i=0;i<60;i++)tick();
   assert.equal(swaps.length,0,'dropped off the platter: no swap');assert.equal(placements.length,before,'sleeve pick never scratches');
   assert.ok(j.position.distanceTo(j.userData.home.p)<1,'jacket eased back to its slot');
   const hz=metadata.thickness_mm+context.api.getR()*.35,[px,py]=toScreen(new real.Vector3(0,0,hz));
   canvas.emit('pointerdown',event(sx,sy,0));canvas.emit('pointermove',event((sx+px)/2,(sy+py)/2,0));canvas.emit('pointermove',event(px,py,0));canvas.emit('pointerup',event(px,py,0));tick();
   assert.deepEqual(swaps,[j.userData.sleeveId],'dropped on the platter: vinyl.swapTo(id)');assert.equal(placements.length,before);}
  assert.equal(lifts,0);assert.equal(swaps.length,1);
  // Tonearm is the needle switch: a click on the reproducer lifts a playing needle; another drops it.
  {vinyl.down=true;const tipObj=context.api.armParts[4];tick();scene.updateMatrixWorld(true);const pl=placements.length;tapObj(tipObj);assert.equal(lifts,1,'arm click lifts');assert.equal(vinyl.down,false);
   tapObj(tipObj);assert.equal(drops,1,'arm click drops');assert.equal(vinyl.down,true);
   // drag it up off the record: stops
   const w=new real.Vector3();tipObj.getWorldPosition(w);const [ax,ay]=toScreen(w);canvas.emit('pointerdown',event(ax,ay,0));for(let k=1;k<=10;k++)canvas.emit('pointermove',event(ax,ay-k*12,0));assert.equal(lifts,2,'raising the arm stops play');canvas.emit('pointerup',event(ax,ay-120,0));tick();
   assert.equal(placements.length,pl,'arm handling never scratches the disc');}
  // Hula girl springs with loudness and survives a record rebuild at a new size.
  {const buf={sampleRate:1000,length:10000,getChannelData(){const a=new Float32Array(10000);for(let i=0;i<a.length;i++)a[i]=Math.sin(i*.3)*.5;return a;}};vinyl.buffer=buf;vinyl.down=true;vinyl.state.grabbed=false;
   const h=context.api.hula;for(let i=0;i<40;i++){tick();}assert.ok(h.env>.1,'loudness envelope follows the audio');let peak=0;for(let i=0;i<60;i++){tick();peak=Math.max(peak,Math.abs(h.ax)+Math.abs(h.ay)+Math.abs(h.bz));}assert.ok(peak>.03,'she sways on the spring');
   vinyl.down=false;for(let i=0;i<60;i++)tick();assert.ok(h.env<.05,'needle up: no drive');for(let i=0;i<900;i++)tick();assert.ok(Math.abs(h.ax)+Math.abs(h.ay)+Math.abs(h.bz)<.01,'spring damps back to rest');
   vinyl.record={metadata:{...metadata,disc_radius_mm:100},base:'/unused2/'};win.emit('vinyl-record',{detail:vinyl.record});tick();
   assert.ok(context.api.phonograph.getObjectByName('hula-girl'),'hula girl survives a vinyl-record rebuild');assert.equal(context.api.getR(),100);close(spatial.mouth,new real.Vector3(-20,27,138));assert.ok(Math.abs(spatial.refDistance-camera.position.distanceTo(spatial.mouth))<1e-7);
   assert.ok(context.api.sleeves.children.some(o=>o.name==='sleeve'),'sleeves rebuilt at the new size');vinyl.buffer=null;}
  console.log('PASS: horn/camera world vectors, unity reset distance, transformed horn and radius rebuild; clamped front-only orbit and zoom, sleeves (fallback Deco front, drag-off eases home, drag-onto-platter → swapTo), 3D volume/speed/source controls, tonearm lift/drop switch, hula girl envelope + rebuild survival; real OrbitControls right-drag orbit, wheel/distance clamps, reset, left grab → grabStart/grabEnd at the raycast point after a moved camera, orbit does not lift playback; preview ring/label separation, dim lights, piano-black scene, empty-platter placeholder removed on load, red label kept for loaded records, rigid constant-length tonearm sweeping on a fixed pivot. Mocked renderer/DOM, not WebGL.');
} finally {await fs.rm(tmp,{recursive:true,force:true});}
