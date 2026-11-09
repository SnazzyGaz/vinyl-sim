// Real pinned Three.js camera/ray math + OrbitControls; mocked DOM/renderer,
// NOT a real browser/WebGL/audio audition. Uses the vendored three.js in static/vendor (offline).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'vinyl-view-'));
try {
  const vendor=new URL('./static/vendor/three/',import.meta.url);
  const threeFile=path.join(tmp,'three.mjs');await fs.copyFile(new URL('three.module.min.js',vendor),threeFile);
  const controlFile=path.join(tmp,'OrbitControls.mjs');await fs.writeFile(controlFile,(await fs.readFile(new URL('addons/controls/OrbitControls.js',vendor),'utf8')).replace("from 'three'",`from '${pathToFileURL(threeFile).href}'`));
  const real=await import(pathToFileURL(threeFile));const {OrbitControls}=await import(pathToFileURL(controlFile));
  const asModule=async f=>import('data:text/javascript;base64,'+Buffer.from(await fs.readFile(new URL(f,import.meta.url),'utf8')).toString('base64'));
  const {buildParlor}=await asModule('./static/room.js');const {createLook,disposeTree}=await asModule('./static/materials.js');
  let draws=0;const createPost=(renderer,scene,camera)=>({render(){draws++;renderer.render(scene,camera);},resize(w,h){renderer.setSize(w,h,false);},setMode(){},state(){return {mode:'auto',tier:'low',dpr:1};},idle(){}});
  class RoomEnvironment{}
  class Element {
    constructor(){this.listeners={};this.style={};this.clientWidth=800;this.clientHeight=600;}
    addEventListener(k,fn){(this.listeners[k]??=new Set()).add(fn);}
    removeEventListener(k,fn){this.listeners[k]?.delete(fn);}
    emit(k,e={}){for(const fn of [...(this.listeners[k]||[])])fn({preventDefault(){},stopPropagation(){},...e});}
    setAttribute(k,v){this[k]=v;}
    getRootNode(){return root;} setPointerCapture(){} releasePointerCapture(){}
    getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
    replaceChildren(el){this.child=el;}
  }
  const root=new Element(),view=new Element(),reset=new Element(),inspectButton=new Element();let tick;
  const THREE={...real,WebGLRenderer:class{constructor(){this.domElement=new Element();this.shadowMap={};}setPixelRatio(){}setSize(){}render(scene,camera){scene.updateMatrixWorld();camera.updateMatrixWorld();}},TextureLoader:class{load(url,onLoad,onProgress,onError){onError?.(new Error('no texture in test'));}}};
  let spatial;let lifts=0,drops=0;const placements=[],swaps=[],vols=[],speeds=[],srcs=[];const vinyl={inspecting:false,setInspecting(value){this.inspecting=value;if(value)this.lift();},setListener(position,forward,up,mouth,refDistance){spatial={position:position.clone(),forward:forward.clone(),up:up.clone(),mouth:mouth.clone(),refDistance};},record:null,down:true,buffer:null,volume:.7,rpm:45,source:'vector',sources:{vector:true,png:true,both:true},swapTo(id){swaps.push(id);return true;},setVolume(v){vols.push(v);this.volume=v;},setSpeed(v){speeds.push(v);this.rpm=v;},setSource(m){srcs.push(m);this.source=m;},drop(){drops++;this.down=true;return Promise.resolve();},state:{rotation:0,dragging:false,angle:0},time(){return 0;},lift(){lifts++;this.down=false;},place(x,y,release){placements.push({x,y,release});},grabStart(x,y){placements.push({x,y,release:false});},grabMove(x,y){placements.push({x,y,release:false});},grabEnd(){placements.push({...placements.at(-1),release:true});},grabTick(){}};
  const win=new Element();win.vinyl=vinyl;
  const context={THREE,OrbitControls,buildParlor,createLook,disposeTree,createPost,RoomEnvironment,clearTimeout,setTimeout,document:{getElementById:id=>({view,resetView:reset,inspectRecord:inspectButton,status:root}[id])},window:win,devicePixelRatio:1,performance:{now:(()=>{let t=0;return ()=>(t+=16.7);})()},requestAnimationFrame:fn=>{tick=fn;},ResizeObserver:class{constructor(cb){this.cb=cb;}observe(){this.cb();}},console};
  vm.createContext(context);
  const source=(await fs.readFile(new URL('./static/view.js',import.meta.url),'utf8')).replace(/^import .*;$/mg,'').replaceAll('import.meta.url',JSON.stringify(new URL('./static/view.js',import.meta.url).href));
  vm.runInContext(source+'\nglobalThis.api={sleeveRest,jacketCenter,floorPose,getTableZ:()=>tableZ,camera,controls,renderer,disc,scene,placeTonearm,armRig,armParts,getArm:()=>({armL,armPivotX,armPivotY}),phonograph,sleeves,hula,tonearm,getR:()=>R,inspect,beginInspection,returnRecord,labelPrint,keepInRoom,roomBounds,armSwapFromSleeve,captureExtract,getDropIn:()=>dropIn,getPendingExtract:()=>pendingExtract};',context);
  const {camera,controls,renderer,disc,scene}=context.api,canvas=renderer.domElement;
  // Empty platter before any record; dark parlour behind the machine.
  assert.equal(scene.background.getHex(),0x1b1611);assert.ok(disc.getObjectByName('placeholder-disc'));
  {const {phonograph,sleeves}=context.api;assert.ok(phonograph.getObjectByName('hula-girl'),'hula girl built with the cabinet');assert.ok(phonograph.getObjectByName('hula-dancer'));assert.equal(sleeves.name,'sleeves');assert.ok(scene.getObjectByName('sleeves'));
   for(const n of ['volume-knob','speed-lever','source-switch'])assert.equal(phonograph.getObjectByName(n),undefined,n+' removed');}
  const metadata={disc_radius_mm:90,label_radius_mm:27,thickness_mm:2.5,r_start_mm:86,pitch_mm:5,lead_in_turns:.35,rpm_cut:45,amp_mm:.3};
  vinyl.record={label:'Original tune',metadata,base:'/unused/'};const seatBefore=camera.position.clone();win.emit('vinyl-record',{detail:vinyl.record});tick();
  assert.ok(camera.position.distanceTo(seatBefore)<1e-7,'mounting a record never moves the camera');for(let i=0;i<60;i++)tick();
  {// the first record arrives in front of the machine, never inside the horn bell
   let low=Infinity;const v3=new real.Vector3();const horn=context.api.phonograph.getObjectByName('horn');horn.geometry.computeBoundingBox();const hb=horn.geometry.boundingBox;
   vinyl.record={...vinyl.record,label:'Original tune'};win.emit('vinyl-record',{detail:vinyl.record});
   for(let i=0;i<70;i++){tick();scene.updateMatrixWorld(true);disc.getWorldPosition(v3);if(v3.z>hb.min.z&&v3.x>hb.min.x&&v3.x<hb.max.x&&v3.y>hb.min.y&&v3.y<hb.max.y)low=Math.min(low,v3.z);}
   assert.equal(low,Infinity,'record centre never enters the horn bell box');}
  assert.ok(disc.position.length()<1e-9,'the record settles onto the spindle');
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
  const assertBlack=mat=>{assert.ok(mat.color.getHex()<=0x202020,'black pressing (no paint in Node)');assert.equal(mat.metalness,0);assert.ok(mat.anisotropy>0,'anisotropic groove sheen');assert.ok(mat.userData.groove.uPitch.value===metadata.pitch_mm,'groove band from the spiral metadata');assert.equal(mat.vertexColors,false);assert.equal(mat.map,null);assert.equal(mat.roughnessMap??null,null,'no rotating roughness detail under the highlight');assert.ok(mat.bumpMap&&mat.bumpScale===0,'constant bump slot, flat at rest');};
  assertBlack(disc.children[0].material);
  const label=disc.getObjectByName('vinyl-label');
  assert.equal(label.userData.title,'Original tune');assert.equal(label.material.color.getHex(),0xc42420); // loaded record keeps the red paper label
  assert.ok(label.position.z>metadata.thickness_mm);
  assert.equal(label.geometry.type,'RingGeometry');
  assert.ok(Math.abs(label.geometry.parameters.innerRadius-3.6)<1e-6,'spindle hole through the red label');
  assert.equal(label.geometry.parameters.outerRadius,metadata.label_radius_mm);
  assert.equal(renderer.toneMapping,real.NeutralToneMapping);assert.equal(renderer.shadowMap.enabled,true);assert.ok(scene.getObjectByName('window-key').castShadow);assert.ok(scene.getObjectByName('deco-parlor'));assert.ok(scene.getObjectByName('floor').receiveShadow);
  assert.equal(disc.children[0].material.type,'MeshPhysicalMaterial');for(const name of ['vinyl-edge','vinyl-underside','spindle-hole'])assert.ok(disc.getObjectByName(name));
  const event=(x,y,button)=>({pointerId:1,pointerType:'mouse',button,clientX:x,clientY:y,pageX:x,pageY:y,ctrlKey:false,metaKey:false,shiftKey:false});
  const initial=camera.position.clone();canvas.emit('pointerdown',event(400,300,2));canvas.emit('pointermove',event(520,350,2));canvas.emit('pointerup',event(520,350,2));
  for(let i=0;i<80;i++)tick();assert.ok(camera.position.distanceTo(initial)>1);assert.equal(lifts,0);assert.equal(placements.length,0);assert.equal(vinyl.down,true);close(spatial.position,camera.position);
  const middleBefore=camera.position.distanceTo(controls.target);canvas.emit('pointerdown',event(400,300,1));canvas.emit('pointermove',event(400,380,1));canvas.emit('pointerup',event(400,380,1));tick();assert.notEqual(camera.position.distanceTo(controls.target),middleBefore);assert.equal(lifts,0);assert.equal(placements.length,0);
  const before=camera.position.distanceTo(controls.target);canvas.emit('wheel',{deltaY:-100,deltaMode:0,clientX:400,clientY:300});tick();assert.ok(camera.position.distanceTo(controls.target)<before);
  {// smooth and repeatable: a notch glides (no jump on the first frame), and 4 in + 4 out lands back exactly
   for(let i=0;i<200;i++)tick();const d0=camera.position.distanceTo(controls.target);
   canvas.emit('wheel',{deltaY:-100,deltaMode:0,clientX:400,clientY:300});tick();const d1=camera.position.distanceTo(controls.target);
   assert.ok(d1<d0&&d0/d1<1.04,`first frame of a notch moves only a little (${(d0/d1).toFixed(3)})`);
   for(let i=0;i<120;i++)tick();assert.ok(Math.abs(d0/camera.position.distanceTo(controls.target)-1.11)<1e-3,'one notch settles at exactly 11% closer');
   for(let k=0;k<3;k++){canvas.emit('wheel',{deltaY:-100,deltaMode:0,clientX:400,clientY:300});tick();tick();}
   for(let k=0;k<4;k++){canvas.emit('wheel',{deltaY:100,deltaMode:0,clientX:400,clientY:300});tick();tick();}
   for(let i=0;i<150;i++)tick();assert.ok(Math.abs(camera.position.distanceTo(controls.target)/d0-1)<1e-3,'four in and four out returns to the same distance');}
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
  reset.emit('click');tick();assert.ok(camera.position.distanceTo(initial)>1e-3,'reset glides, it does not jump');for(let i=0;i<80;i++)tick();assert.ok(camera.position.distanceTo(initial)<1e-7);
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
   assert.equal(controls.enablePan,false);reset.emit('click');for(let i=0;i<80;i++)tick();}
  // Room walls: a camera pushed past a wall is eased back inside with a near-plane margin.
  {const b=context.api.roomBounds();camera.position.set(b.x+120,b.y0-80,b.z1+60);controls.target.set(0,0,40);camera.lookAt(controls.target);
   let hit=false;for(let i=0;i<40;i++){if(context.api.keepInRoom())hit=true;}
   assert.ok(hit,'keepInRoom engages when the camera is outside');
   assert.ok(camera.position.x<=b.x+1e-6&&camera.position.x>=-b.x-1e-6,'inside left/right walls');
   assert.ok(camera.position.y>=b.y0-1e-6&&camera.position.y<=b.y1+1e-6,'inside front/back walls');
   assert.ok(camera.position.z<=b.z1+1e-6,'under the ceiling');
   reset.emit('click');for(let i=0;i<80;i++)tick();}
  scene.updateMatrixWorld(true);
  const toScreen=v3=>{const n=v3.clone().project(camera);return [(n.x+1)*400,(1-n.y)*300];};
  const tapObj=(o,dx=0,dy=0)=>{const w=new real.Vector3();o.getWorldPosition(w);const [x,y]=toScreen(w);canvas.emit('pointerdown',event(x,y,0));canvas.emit('pointermove',event(x+dx,y+dy,0));canvas.emit('pointerup',event(x+dx,y+dy,0));tick();};
  // Machine-clearance probe: the closest any horn/arm/cabinet/hula vertex comes to a moving record (disc) or sleeve (box).
  const machineGap=(obj,kind)=>{scene.updateMatrixWorld(true);const inv=new real.Matrix4().copy(obj.matrixWorld).invert(),v=new real.Vector3(),Rr=context.api.getR(),S=2*Rr*1.04,T=Rr*.028;let g=Infinity,what='';
   const test=(o)=>{if(!o.isMesh||!o.geometry?.attributes?.position||/platter|contact-shadow/.test(o.name)||o.name==='spindle'||o.name==='platter-felt')return;const pos=o.geometry.attributes.position;
    for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);let d;
     if(kind==='disc'){const r=Math.hypot(v.x,v.y);if(r<3.7||r>Rr+.5)continue;d=v.z<0?-v.z:v.z>metadata.thickness_mm?v.z-metadata.thickness_mm:-1;}
     else{if(Math.abs(v.x)>S/2+.5||v.z<-.5||v.z>S+.5)continue;d=Math.abs(v.y)-T/2;}
     if(d<g){g=d;what=o.name||o.parent?.name||'part';}}};
   context.api.phonograph.traverse(test);context.api.tonearm.traverse(test);return {g,what};};
  // Sleeve drag: off the platter it eases home; onto the platter it calls vinyl.swapTo(id).
  {const before=placements.length;const j=context.api.sleeves.children.find(o=>o.name==='sleeve');const c=new real.Vector3(0,0,j.geometry?0:0);
   const mid=new real.Vector3();j.children[0].getWorldPosition(mid);const [sx,sy]=toScreen(mid);
   canvas.emit('pointerdown',event(sx,sy,0));canvas.emit('pointermove',event(sx+5,sy+5,0));canvas.emit('pointerup',event(sx+5,sy+5,0));for(let i=0;i<60;i++)tick();
   assert.equal(swaps.length,0,'dropped off the platter: no swap');assert.equal(placements.length,before,'sleeve pick never scratches');
   assert.ok(j.position.distanceTo(j.userData.home.p)<1,'jacket eased back to its slot');
   const hz=metadata.thickness_mm+context.api.getR()*.35,[px,py]=toScreen(new real.Vector3(0,0,hz));
   canvas.emit('pointerdown',event(sx,sy,0));canvas.emit('pointermove',event((sx+px)/2,(sy+py)/2,0));canvas.emit('pointermove',event(px,py,0));canvas.emit('pointerup',event(px,py,0));tick();
   assert.deepEqual(swaps,[j.userData.sleeveId],'dropped on the platter: vinyl.swapTo(id)');assert.equal(placements.length,before);
   // Put down anywhere: carried to the floor in front-right, it stays there lying flat, cover up.
   const j2=context.api.sleeves.children.find(o=>o.name==='sleeve'&&o!==j),Rr=context.api.getR();j2.getWorldPosition(mid);const [ax,ay]=toScreen(mid);
   const spot=new real.Vector3(Rr*2.3,-Rr*2.7,context.api.getTableZ()+2*Rr*1.04*.62),[fx,fy]=toScreen(spot);
   canvas.emit('pointerdown',event(ax,ay,0));for(let k=1;k<=6;k++)canvas.emit('pointermove',event(ax+(fx-ax)*k/6,ay+(fy-ay)*k/6,0));canvas.emit('pointerup',event(fx,fy,0));for(let i=0;i<90;i++)tick();
   assert.ok(context.api.sleeveRest.has(j2.userData.sleeveId),'a sleeve put down on the floor keeps its place');
   const up=new real.Vector3(0,-1,0).applyQuaternion(j2.quaternion);assert.ok(up.z>.95,'it lies flat, cover up');
   const cen=context.api.jacketCenter({p:j2.position,q:j2.quaternion});assert.ok(Math.hypot(cen.x-spot.x,cen.y-spot.y)<Rr*.3,'where it was let go');
   // Let go hard against the cabinet side: the sleeve is laid down clear of the plinth.
   {j2.getWorldPosition(mid);const [cx,cy]=toScreen(mid),[hx,hy]=toScreen(new real.Vector3(Rr*1.75,-Rr*.2,context.api.getTableZ()+2*Rr*1.04*.62));
    canvas.emit('pointerdown',event(cx,cy,0));for(let k=1;k<=6;k++)canvas.emit('pointermove',event(cx+(hx-cx)*k/6,cy+(hy-cy)*k/6,0));canvas.emit('pointerup',event(hx,hy,0));for(let i=0;i<90;i++)tick();
    const gap=machineGap(j2,'box');assert.ok(gap.g>.5,`a sleeve dropped against the cabinet lies clear of it (closest ${gap.g.toFixed(2)} mm to ${gap.what})`);}
   win.emit('vinyl-sleeves',{detail:{current:'a',sleeves:[{id:'b',label:'Second'},{id:'c',label:'Third'}]}});tick();
   const again=context.api.sleeves.children.find(o=>o.userData.sleeveId===j2.userData.sleeveId);assert.ok(again.position.distanceTo(j2.position)<1e-6,'and survives a rebuild of the sleeves');
   // Offered to the platter: the sleeve stays at its home (crate/floor), the record peeks out and the rim glows.
   again.getWorldPosition(mid);const [bx,by]=toScreen(mid),[tx,ty]=toScreen(new real.Vector3(Rr*.3,Rr*.2,-4));
   const homeBefore=again.userData.home.p.clone();
   canvas.emit('pointerdown',event(bx,by,0));for(let k=1;k<=6;k++)canvas.emit('pointermove',event(bx+(tx-bx)*k/6,by+(ty-by)*k/6,0));for(let i=0;i<60;i++)tick();
   assert.ok(again.userData.peek>.9&&scene.getObjectByName('drop-ring').visible,'offered: record peeks, platter rim lit');
   assert.ok(again.position.distanceTo(homeBefore)<Rr*.35,'offered sleeve stays near its home (does not leap in front of the camera)');
   const jg=machineGap(again,'box');assert.ok(jg.g>.5,`offered sleeve clears the machine (closest ${jg.g.toFixed(2)} mm to ${jg.what})`);
   canvas.emit('pointerup',event(tx,ty,0));tick();assert.equal(swaps.at(-1),again.userData.sleeveId,'let go while offered: swap');assert.ok(!context.api.sleeveRest.has(again.userData.sleeveId),'its empty sleeve goes back on the shelf, even if it had been left out');
   // ...and the record slides out of that sleeve along its open edge, then onto the spindle without teleporting or clipping the cardboard.
   let worst=Infinity,who='';vinyl.down=false; /* the real swapTo lifts the needle first */
   const armed=context.api.getPendingExtract();assert.ok(armed,'swap armed an extract path from the sleeve');
   const ex0={inside:armed.inside.clone(),clear:armed.clear.clone(),origin:armed.origin.clone(),axis:armed.axis.clone().normalize(),S:armed.S};
   // Path continuity: dense samples along the extract segment stay on the axis and never jump.
   {let prev=ex0.inside.clone(),maxEdge=0;for(let i=1;i<=40;i++){const u=i/40,p=ex0.inside.clone().lerp(ex0.clear,u);const edge=p.distanceTo(prev);maxEdge=Math.max(maxEdge,edge);prev.copy(p);
     const z=p.clone().sub(ex0.origin).dot(ex0.axis),on=ex0.origin.clone().addScaledVector(ex0.axis,z);assert.ok(p.distanceTo(on)<1e-6,'extract samples lie on the sleeve axis');}
    assert.ok(maxEdge<ex0.inside.distanceTo(ex0.clear)/39*1.01+1e-6,'extract samples are evenly spaced');}
   win.emit('vinyl-record',{detail:{...vinyl.record,id:'swap-test',label:'From the sleeve'}});
   assert.ok(context.api.getDropIn()?.extract,'dropIn carries the extract path');
   close(disc.position,ex0.inside);
   let prev=disc.position.clone(),maxStep=0,zPrev=-Infinity,sawExtract=false,sawFly=false,clearances=[];
   // Longer path (~2.8 s + delay): allow more ticks
   for(let i=0;i<320;i++){
    tick();const r=machineGap(disc,"disc");if(r.g<worst){worst=r.g;who=r.what;}
    const step=disc.position.distanceTo(prev);maxStep=Math.max(maxStep,step);prev.copy(disc.position);
    const di=context.api.getDropIn();if(!di)continue;
    if(di.e<=di.delay){assert.ok(disc.position.distanceTo(ex0.inside)<1e-6,'holds inside the sleeve during the hand-off delay');continue;}
    const te=di.e-di.delay,ed=di.extractDur||1.25;
    const z=disc.position.clone().sub(ex0.origin).dot(ex0.axis);
    const onAxis=ex0.origin.clone().addScaledVector(ex0.axis,z),off=disc.position.distanceTo(onAxis);
    if(te<ed){sawExtract=true;assert.ok(off<3,`extract stays on the sleeve axis (off ${off.toFixed(2)} mm)`);assert.ok(z+1e-3>=zPrev-1e-3,'extract z is non-decreasing');zPrev=Math.max(zPrev,z);clearances.push({te,off,z});}
    else sawFly=true;
   }
   assert.ok(sawExtract&&sawFly,'extract phase then flight');
   assert.ok(maxStep<context.api.getR()*2.5,`no sleeve-wall teleport (max step ${maxStep.toFixed(2)} mm)`);
   assert.ok(clearances.length>5,'tracked per-frame extract clearance');
   assert.ok(clearances.every(c=>c.off<3),'every extract frame clears the sleeve walls (on-axis slide)');
   assert.ok(worst>.5,`record from the offered sleeve clears the machine (closest ${worst.toFixed(2)} mm to ${who})`);
   close(disc.position,new real.Vector3());assert.ok(Math.abs(disc.rotation.x)<1e-9,'and lands flat');}
  assert.equal(lifts,0);assert.equal(swaps.length,2);
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
   vinyl.record={label:'Second pressing',metadata:{...metadata,disc_radius_mm:100},base:'/unused2/'};win.emit('vinyl-record',{detail:vinyl.record});tick();
   assert.ok(context.api.scene.getObjectByName('outgoing-records').children.length===1,'the old record glides off to the rack');for(let i=0;i<90;i++)tick();
   assert.equal(context.api.scene.getObjectByName('outgoing-records').children.length,0,'and is freed once it arrives');
   assert.ok(context.api.phonograph.getObjectByName('hula-girl'),'hula girl survives a vinyl-record rebuild');assert.equal(context.api.getR(),100);assert.equal(disc.getObjectByName('vinyl-label').userData.title,'Second pressing');close(spatial.mouth,new real.Vector3(-20,27,138));assert.ok(Math.abs(spatial.refDistance-camera.position.distanceTo(spatial.mouth))<1e-7);
   assert.ok(context.api.sleeves.children.some(o=>o.name==='sleeve'),'sleeves rebuilt at the new size');vinyl.buffer=null;}
  // Needle-up pickup is inspection, never scratch. Playback stays locked until landing.
  {vinyl.down=false;const {inspect}=context.api;const before=placements.length;reset.emit('click');for(let i=0;i<80;i++)tick();
   // the viewer's own seat (orbited away from default) must survive inspection
   canvas.emit('pointerdown',event(400,300,2));canvas.emit('pointermove',event(470,320,2));canvas.emit('pointerup',event(470,320,2));for(let i=0;i<200;i++)tick();
   const seat=camera.position.clone(),seatTarget=controls.target.clone();
   const point=new real.Vector3(45,0,2.5).project(camera),px=(point.x+1)*400,py=(1-point.y)*300;
   const countLights=()=>{let n=0;scene.traverseVisible(o=>{if(o.isLight)n++;});return n;},lightsBefore=countLights(),heldGeo=disc.children[0].geometry;
   // The record must never pass through the horn, its bracket, the arm or the hula girl on the way out or back.
   let obstacles=[];const gather=()=>{obstacles=[];const ph=context.api.phonograph;scene.updateMatrixWorld(true);
    const take=o=>{if(!o.isMesh||!o.geometry?.attributes?.position||/platter|contact-shadow/.test(o.name))return;const pos=o.geometry.attributes.position,name=o.name||o.parent?.name||'part';
     for(let i=0;i<pos.count;i+=1)obstacles.push({v:new real.Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld),name});};
    ph.traverse(o=>{if(o.name!=='spindle'&&o.name!=='platter-felt')take(o);});context.api.tonearm.traverse(take);};
   const inv=new real.Matrix4(),loc=new real.Vector3();let worst=Infinity,hitName='';
   const clearance=(rec=disc)=>{gather();inv.copy(rec.matrixWorld).invert();const Rr=context.api.getR(),th=metadata.thickness_mm;
    for(const o of obstacles){loc.copy(o.v).applyMatrix4(inv);const r=Math.hypot(loc.x,loc.y);if(r<3.7||r>Rr+.5)continue;
     const gap=loc.z<0?-loc.z:loc.z>th?loc.z-th:-1;if(gap<worst){worst=gap;hitName=o.name+` @(${o.v.x.toFixed(0)},${o.v.y.toFixed(0)},${o.v.z.toFixed(0)}) disc(${disc.position.x.toFixed(0)},${disc.position.y.toFixed(0)},${disc.position.z.toFixed(0)}) phase ${inspect.phase} e=${inspect.elapsed.toFixed(2)}`;}}};
   canvas.emit('pointerdown',event(px,py,0));assert.equal(inspect.active,true);assert.equal(vinyl.inspecting,true);
   for(let i=0;i<100;i++){tick();if(inspect.phase==='out')clearance();}assert.ok(worst>.5,`lift-out clears the machine (closest ${worst.toFixed(2)} mm to ${hitName})`);assert.equal(inspect.phase,'held');assert.ok(disc.position.length()>100);assert.equal(placements.length,before);
   assert.equal(controls.minAzimuthAngle,-Infinity);assert.ok(controls.minDistance<90);assert.ok(controls.maxPolarAngle>Math.PI*.9);
   assert.equal(disc.children[0].geometry,heldGeo,'inspection never rebuilds the record mesh');assert.equal(lightsBefore,countLights(),'no light is added or toggled for inspection');
   assert.ok(disc.children[0].material.envMapIntensity>.5,'held vinyl carries a stronger room reflection instead');
   const n=disc.position.clone().project(camera),sx=(n.x+1)*400,sy=(1-n.y)*300,q=disc.quaternion.clone();
   // Pick an actual point on the face rather than the spindle hole.
   const face=disc.localToWorld(new real.Vector3(40,0,2.5)).project(camera),fx=(face.x+1)*400,fy=(1-face.y)*300;
   canvas.emit('pointerdown',event(fx,fy,0));canvas.emit('pointermove',event(fx+40,fy+20,0));canvas.emit('pointerup',event(fx+40,fy+20,0));tick();assert.ok(q.angleTo(disc.quaternion)>.1);assert.equal(placements.length,before);
   worst=Infinity;win.emit('keydown',{key:'Escape'});for(let i=0;i<100;i++){tick();if(inspect.active)clearance();}assert.ok(worst>.5,`put-back clears the machine (closest ${worst.toFixed(2)} mm to ${hitName})`);assert.equal(inspect.active,false);
   assert.ok(camera.position.distanceTo(seat)<1e-3&&controls.target.distanceTo(seatTarget)<1e-3,'put back returns to the viewer’s seat, not the default');assert.equal(vinyl.inspecting,false);close(disc.position,new real.Vector3());assert.ok(Math.abs(disc.quaternion.x)+Math.abs(disc.quaternion.y)<1e-7);assert.equal(controls.minDistance,350);assert.equal(controls.maxDistance,750);assert.ok(controls.maxAzimuthAngle-controls.minAzimuthAngle<2.401);
   // New record/swap cancels even an in-flight inspection and leaves no held transforms.
   context.api.beginInspection();tick();win.emit('vinyl-record',{detail:vinyl.record});tick();assert.equal(inspect.active,false);assert.equal(vinyl.inspecting,false);for(let i=0;i<90;i++)tick();close(disc.position,new real.Vector3());
   assert.ok(camera.position.distanceTo(seat)<1e-3,'a swap mid-inspection still returns to the viewer’s seat');
   // Swapping a same-size record leaves the camera exactly where it is, and neither record passes through the machine.
   // The outgoing record goes into its own sleeve wherever it lies, round the cabinet if needed.
   {win.emit('vinyl-record',{detail:{...vinyl.record,id:'p1',label:'P1'}});for(let i=0;i<120;i++)tick();const Rr=context.api.getR();
    for(const [x,y] of [[Rr*2.6,Rr*.4],[-Rr*2.2,-Rr*3.0]]){context.api.sleeveRest.set('p1',context.api.floorPose(new real.Vector3(x,y,0),.3,1));worst=Infinity;
     win.emit('vinyl-record',{detail:{...vinyl.record,id:'p2',label:'P2'}});
     for(let i=0;i<120;i++){tick();const og=scene.getObjectByName('outgoing-records').children[0];if(og)clearance(og);}
     assert.ok(worst>.5,`record into a sleeve at (${(x/Rr).toFixed(1)}R,${(y/Rr).toFixed(1)}R) clears the machine (closest ${worst.toFixed(2)} mm to ${hitName})`);
     win.emit('vinyl-record',{detail:{...vinyl.record,id:'p1',label:'P1'}});for(let i=0;i<120;i++)tick();}}
   const still=camera.position.clone();worst=Infinity;win.emit('vinyl-record',{detail:{...vinyl.record,label:'Third pressing'}});
   for(let i=0;i<90;i++){tick();clearance(disc);const og=scene.getObjectByName('outgoing-records').children[0];if(og)clearance(og);}
   assert.ok(worst>.5,`swap clears the machine (closest ${worst.toFixed(2)} mm to ${hitName})`);assert.ok(camera.position.distanceTo(still)<1e-9,'swap keeps the view');
   // Draw on demand: an idle, needle-up scene stops drawing.
   vinyl.down=false;for(let i=0;i<120;i++)tick();const d0=draws;for(let i=0;i<60;i++)tick();assert.equal(draws,d0,'idle scene draws nothing');
   // Shadows: a still scene never re-renders its shadow map; a change does (it used to freeze after the first render).
   renderer.shadowMap.needsUpdate=false;for(let i=0;i<30;i++)tick();assert.equal(renderer.shadowMap.needsUpdate,false,'still scene: shadow map left alone');
   canvas.emit('pointerdown',event(400,300,2));canvas.emit('pointermove',event(430,300,2));canvas.emit('pointerup',event(430,300,2));tick();assert.ok(draws>d0,'any movement draws again');
   win.emit('vinyl-record',{detail:{...vinyl.record,id:'shadow-test',label:'Shadow test'}});for(let i=0;i<5;i++)tick();assert.equal(renderer.shadowMap.needsUpdate,true,'a moving record re-renders the shadow map');
  }
  // Curved print uses individual tangent glyphs, never a stretched horizontal title.
  {const glyphs=[],angles=[],positions=[];const pen={fillRect(){},beginPath(){},arc(){},stroke(){},measureText(t){return {width:t.length*35};},save(){},restore(){},translate(x,y){positions.push([x,y]);},rotate(a){angles.push(a);},fillText(t){glyphs.push(t);}};
   context.document.createElement=()=>({getContext:()=>pen});const texture=context.api.labelPrint('Original tune',metadata);
   assert.ok(texture);assert.ok(glyphs.join('').startsWith('ORIGINAL TUNE'));assert.ok(glyphs.every(s=>Array.from(s).length===1));
   assert.ok(angles.slice(0,13).some(a=>a<-.1)&&angles.slice(0,13).some(a=>a>.1),'glyphs follow both halves of the title arc');
   for(const [x,y] of positions.slice(0,13))assert.ok(Math.abs(Math.hypot(x-512,y-512)-1024*.34)<1e-6);texture.dispose();}
  // Slow Three/module fetch: the demo and sleeve event can predate the 3D listener.
  {const earlyWin=new Element(),earlyView=new Element(),earlyReset=new Element(),earlyInspect=new Element();
   earlyWin.vinyl={...vinyl,record:{label:'Loaded before Three',metadata,base:'/unused/'},sleeves:()=>[{id:'prior',label:'Earlier pressing'}]};
   const early={THREE,OrbitControls,buildParlor,createLook,disposeTree,createPost,RoomEnvironment,clearTimeout,setTimeout,document:{getElementById:id=>({view:earlyView,resetView:earlyReset,inspectRecord:earlyInspect,status:root}[id])},window:earlyWin,devicePixelRatio:1,performance:{now:()=>0},requestAnimationFrame(){},ResizeObserver:class{constructor(cb){this.cb=cb;}observe(){this.cb();}},console};
   vm.createContext(early);vm.runInContext(source+'\nglobalThis.loaded={disc,sleeves};',early);
   assert.equal(early.loaded.disc.getObjectByName('placeholder-disc'),undefined);assert.equal(early.loaded.disc.getObjectByName('vinyl-label').userData.title,'Loaded before Three');assert.ok(early.loaded.sleeves.children.some(o=>o.userData.sleeveId==='prior'));}
  // The Room: a cut leaves the bench lathe and travels to the platter without touching the machine or the bench.
  {const rWin=new Element(),rView=new Element(),rReset=new Element(),rInspect=new Element();let rTick;
   rWin.vinyl={...vinyl,down:false,record:null,sleeves:()=>[]};
   const rc={THREE,OrbitControls,buildParlor,createLook,disposeTree,createPost,RoomEnvironment,clearTimeout,setTimeout,document:{body:{dataset:{mode:'room'}},getElementById:id=>({view:rView,resetView:rReset,inspectRecord:rInspect,status:root}[id])},window:rWin,devicePixelRatio:1,performance:{now:(()=>{let t=0;return ()=>(t+=16.7);})()},requestAnimationFrame:fn=>{rTick=fn;},ResizeObserver:class{constructor(cb){this.cb=cb;}observe(){this.cb();}},console};
   vm.createContext(rc);vm.runInContext(source+'\nglobalThis.room={disc,phonograph,tonearm,scene,bench,camera,controls,getR:()=>R};',rc);
   const {disc:rd,phonograph:rp,tonearm:rt,scene:rs,bench:b}=rc.room;
   rWin.vinyl.record={label:'Demo',metadata,base:'/unused/',id:'demo'};rWin.emit('vinyl-record',{detail:rWin.vinyl.record});for(let i=0;i<80;i++)rTick();
   assert.ok(rp.getObjectByName('bench')&&rp.getObjectByName('lathe-blank')&&rp.getObjectByName('blank-stack')&&rp.getObjectByName('post-tray'),'room mode builds the bench: lathe, blanks, post tray');
   {const ctr=new real.Vector3();rp.getObjectByName('bench-top').getWorldPosition(ctr);ctr.project(rc.room.camera);assert.ok(Math.abs(ctr.x)<1&&Math.abs(ctr.y)<1,'the bench is in the default view');}
   const car=b.carriage,x0=car.position.x;
   rWin.emit('vinyl-lathe',{detail:{state:'cutting',fraction:.5}});for(let i=0;i<120;i++)rTick();
   assert.ok(car.position.x<x0-5,'cutting moves the head in across the blank');assert.equal(b.blank.visible,true);
   rWin.emit('vinyl-lathe',{detail:{state:'done'}});for(let i=0;i<30;i++)rTick();
   // clearance against everything on the machine and bench except the two platters the record rests on
   const obs=[];rs.updateMatrixWorld(true);const take=o=>{if(!o.isMesh||!o.visible||!o.geometry?.attributes?.position||/platter|contact-shadow|lathe-blank/.test(o.name)||o.name==='spindle')return;let p=o;while(p){if(!p.visible)return;p=p.parent;}
    const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i++)obs.push({v:new real.Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld),name:o.name||o.parent?.name||'part'});};
   rp.traverse(take);const fixed=obs.length;
   const inv=new real.Matrix4(),l=new real.Vector3(),Rr=rc.room.getR();let worst=Infinity,who='';
   rWin.vinyl.record={label:'Fresh cut',metadata,base:'/unused/',id:'cut1'};rWin.emit('vinyl-record',{detail:rWin.vinyl.record});
   assert.equal(b.blank.visible,false,'the blank leaves the lathe as the record');const start=new real.Vector3();rd.getWorldPosition(start);
   assert.ok(Math.hypot(start.x-b.center.x,start.y-b.center.y)<1,'it starts on the lathe platter');
   for(let i=0;i<140;i++){rTick();rs.updateMatrixWorld(true);obs.length=fixed;rt.traverse(take);inv.copy(rd.matrixWorld).invert();
    for(const o of obs){l.copy(o.v).applyMatrix4(inv);const r=Math.hypot(l.x,l.y);if(r<3.7||r>Rr+.5)continue;const g=l.z<0?-l.z:l.z>metadata.thickness_mm?l.z-metadata.thickness_mm:-1;if(g<worst){worst=g;who=o.name;}}}
   assert.ok(worst>.5,`lathe to platter clears the machine and the bench (closest ${worst.toFixed(2)} mm to ${who})`);
   assert.ok(rd.position.length()<1e-6,'and settles on the spindle');
   // In the Room a finished cut is filed in the crate instead: lathe -> its sleeve, clear of everything, the platter untouched.
   {rWin.emit('vinyl-lathe',{detail:{state:'cutting',fraction:.9}});for(let i=0;i<60;i++)rTick();
    rWin.emit('vinyl-lathe',{detail:{state:'done',shelve:true}});for(let i=0;i<10;i++)rTick();
    const onPlatter=rc.room.disc.children.length;
    rWin.emit('vinyl-sleeves',{detail:{current:'cut1',currentSleeve:{id:'cut1',label:'Fresh cut'},sleeves:[{id:'cut2',label:'Filed'},{id:'demo',label:'Demo'}]}});
    const og=rs.getObjectByName('outgoing-records');assert.equal(og.children.length,1,'the new record leaves the lathe');assert.equal(b.blank.visible,false);
    const fobs=[];rs.updateMatrixWorld(true);const takeF=o=>{if(!o.isMesh||!o.visible||!o.geometry?.attributes?.position||/platter|contact-shadow|lathe-blank|^sleeve|crate|peek/.test(o.name+'|'+(o.parent?.name||'')))return;let q=o;while(q){if(!q.visible)return;if(q.name==='sleeves'||q.name==='outgoing-records')return;q=q.parent;}
     const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i++)fobs.push({v:new real.Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld),name:o.name||o.parent?.name||'part'});};
    rs.traverse(takeF);let fw=Infinity,fwho='';
    for(let i=0;i<200&&og.children.length;i++){rTick();const g=og.children[0];if(!g)break;rs.updateMatrixWorld(true);inv.copy(g.matrixWorld).invert();const ph=g.userData.anim.e/g.userData.anim.dur;if(ph>.9)continue; // the last stretch is inside its own sleeve
     for(const o of fobs){l.copy(o.v).applyMatrix4(inv);const r=Math.hypot(l.x,l.y);if(r<3.7||r>Rr+.5)continue;const gg=l.z<0?-l.z:l.z>2.5?l.z-2.5:-1;if(gg<fw){fw=gg;fwho=o.name;}}}
    assert.equal(og.children.length,0,'filed away');assert.ok(fw>.5,`lathe to crate clears the machine and the bench (closest ${fw.toFixed(2)} mm to ${fwho})`);
    assert.equal(b.blank.visible,true,'a fresh blank is back on the lathe');assert.equal(rc.room.disc.children.length,onPlatter,'the record on the platter is untouched');}}
  console.log('PASS: room mode: bench and lathe built in view, the head cuts in, a fresh cut travels lathe to platter (or is filed lathe to crate) clear of everything; sleeves put down anywhere stay put (flat, cover up, across rebuilds); an offered sleeve stands clear of the machine with the record peeking and the rim lit; records never pass through the horn, arm, spindle or hula girl when lifted out, put back, swapped or first loaded; persistent camera across mount/swap/inspection with eased reset; outgoing record glides off and is freed; draw-on-demand idles; early-demo/module race caught; curved title tangent glyphs; inspection pickup/rotation/Escape/reload interlock, solid PVC, room/shadows/neutral tone mapping; horn/camera world vectors, unity reset distance, transformed horn and radius rebuild; clamped front-only orbit and zoom, room-wall/ceiling soft clamp, sleeve slide-out extract, sleeves (fallback Deco front, drag-off eases home, drag-onto-platter → swapTo), 3D volume/speed/source controls, tonearm lift/drop switch, hula girl envelope + rebuild survival; real OrbitControls right-drag orbit, wheel/distance clamps, reset, left grab → grabStart/grabEnd at the raycast point after a moved camera, orbit does not lift playback; preview ring/label separation, window light and finished room, empty-platter placeholder removed on load, red label kept for loaded records, rigid constant-length tonearm sweeping on a fixed pivot. Mocked renderer/DOM, not WebGL.');
} finally {await fs.rm(tmp,{recursive:true,force:true});}
