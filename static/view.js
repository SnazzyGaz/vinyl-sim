import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildParlor} from './room.js';
import {createLook,disposeTree} from './materials.js';
import {createPost} from './post.js';
import {createShiba} from './shiba.js';
/* Player 3D view: a photographed parlour phonograph.
   Physically based materials painted procedurally (materials.js), image-based
   lighting baked from the room, one shadowed window key, and tiered post
   (post.js). Frames are drawn on demand: nothing moving => nothing rendered.
   The camera is the viewer's: swapping records, inspecting and returning never
   reset it; only Reset view does, and every move is eased. */
const view=document.getElementById('view');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x1b1611);
const reduce=()=>!!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}
catch(e){const p=document.getElementById('viewFallback');if(p)p.textContent='The 3D turntable needs WebGL, which this browser has turned off. Playback still works from the controls.';throw e;}
view.replaceChildren(renderer.domElement);
renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=.92;renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
performance.mark?.('vv:start');const look=createLook(THREE,renderer);
const camera=new THREE.PerspectiveCamera(38,1,2,7000);camera.up.set(0,0,1);camera.position.set(0,-220,300);camera.lookAt(0,0,0);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,2.5);controls.enableDamping=true;controls.dampingFactor=.075;controls.rotateSpeed=.7;controls.enablePan=false;
controls.touches={ONE:null,TWO:THREE.TOUCH.DOLLY_ROTATE};controls.mouseButtons={LEFT:null,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
const V3=THREE.Vector3;
const inspect={active:false,phase:'idle',elapsed:0,drag:null};
const ORBIT_SWING=1.2;
let R=90,drag=false,version=0,builds=0;

/* ---------- draw-on-demand bookkeeping ---------- */
let dirty=3;
function invalidate(frames=2){dirty=Math.max(dirty,frames);}
const post=createPost(renderer,scene,camera,{onChange:s=>{syncQualityUI(s);invalidate(3);}});

/* ---------- camera: eased flights, persistent viewer pose ---------- */
const ease=t=>t*t*(3-2*t),easeInOut=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,easeOut=t=>1-Math.pow(1-t,3);
// One-room mode (room.html): the bench and lathe stand to the right, so the default seat widens to take them in.
const ROOM=typeof document!=='undefined'&&document.body?.dataset?.mode==='room';
function defaultPose(r=R){return ROOM?{pos:new V3(r*1.2,-r*7.3,r*2.9),target:new V3(r*.5,r*.1,r*.3)}:{pos:new V3(r*1.02,-r*6.0,r*2.35),target:new V3(-r*.4,r*.25,r*.42)};}
const upQuat=new THREE.Quaternion();
function azimuthOf(pos,target){upQuat.setFromUnitVectors(camera.up,new V3(0,1,0));const o=pos.clone().sub(target).applyQuaternion(upQuat);return Math.atan2(o.x,o.z);}
function stopControlMomentum(){controls._sphericalDelta?.set(0,0,0);controls._panOffset?.set(0,0,0);if('_scale' in controls)controls._scale=1;zoom.goal=null;zoom.vel=0;}
function machineClamps(){
 controls.enablePan=false;controls.zoomToCursor=false;controls.minPolarAngle=Math.PI*.2;controls.maxPolarAngle=Math.PI*.47;
 const d=defaultPose(),az=azimuthOf(d.pos,d.target);controls.minAzimuthAngle=az-ORBIT_SWING;controls.maxAzimuthAngle=az+ORBIT_SWING;
 controls.minDistance=R*3.5;controls.maxDistance=R*(ROOM?8.5:7.5);
}
let camTween=null;
function flyTo(pos,target,dur=.85,done){
 stopControlMomentum();
 camTween={p0:camera.position.clone(),t0:controls.target.clone(),p1:pos.clone(),t1:target.clone(),e:0,dur:reduce()?0:dur,done};invalidate();
}
function updateCamTween(dt){
 if(!camTween)return false;const c=camTween;c.e+=dt;const t=c.dur?Math.min(1,c.e/c.dur):1,k=easeInOut(t);
 controls.target.lerpVectors(c.t0,c.t1,k);
 const o0=c.p0.clone().sub(c.t0),o1=c.p1.clone().sub(c.t1),len=o0.length()+(o1.length()-o0.length())*k;
 const q=new THREE.Quaternion().setFromUnitVectors(o0.clone().normalize(),o1.clone().normalize()),qk=new THREE.Quaternion().slerp(q,k);
 camera.position.copy(controls.target).addScaledVector(o0.normalize().applyQuaternion(qk),len);camera.lookAt(controls.target);
 if(t>=1){camTween=null;camera.position.copy(c.p1);controls.target.copy(c.t1);camera.lookAt(controls.target);stopControlMomentum();c.done?.();}
 return true;
}
/* The room is a fixed size but the camera scales with the record (R=150 for long
   songs), so a zoomed-out orbit could rise through the ceiling or back through a
   wall. Keep the viewer inside every face, with a margin so the near plane never
   shows plaster. Soft-blend so the clamp eases rather than snaps. */
const ROOM_GAP=50,CEILING_GAP=40;const roomOff=new V3(),roomSafe=new V3();
// Inner faces of the parlor (room.js): walls centred at x=±1200 / y=-1200 / y=540,
// each 18 mm thick, ceiling underside at room-local z=ceilingZ, floor at z=0.
function roomBounds(){
 const z0=room.position.z,H=room.userData.ceilingZ??880;
 return {x:1200-9-ROOM_GAP,y0:-1200+9+ROOM_GAP,y1:540-9-ROOM_GAP,z0:z0+ROOM_GAP*.4,z1:z0+H-CEILING_GAP};
}
function keepInRoom(){
 const b=roomBounds(),t=controls.target,c=camera.position;
 let hit=false;
 roomSafe.copy(c);
 if(roomSafe.x<-b.x){roomSafe.x=-b.x;hit=true;}else if(roomSafe.x>b.x){roomSafe.x=b.x;hit=true;}
 if(roomSafe.y<b.y0){roomSafe.y=b.y0;hit=true;}else if(roomSafe.y>b.y1){roomSafe.y=b.y1;hit=true;}
 if(roomSafe.z<b.z0){roomSafe.z=b.z0;hit=true;}
 // Ceiling: preserve look distance and swing, only drop elevation (same idea as before).
 if(c.z>b.z1+1e-3){
  roomOff.copy(c).sub(t);const d=roomOff.length(),oz=Math.max(-d,Math.min(d,b.z1-t.z)),hz=Math.hypot(roomOff.x,roomOff.y),h=Math.sqrt(Math.max(0,d*d-oz*oz));
  if(hz>1e-6)roomSafe.set(t.x+roomOff.x/hz*h,t.y+roomOff.y/hz*h,t.z+oz);else roomSafe.z=b.z1;
  // re-apply wall limits after the ceiling swing
  roomSafe.x=Math.max(-b.x,Math.min(b.x,roomSafe.x));roomSafe.y=Math.max(b.y0,Math.min(b.y1,roomSafe.y));
  hit=true;const sd=controls._sphericalDelta;if(sd&&sd.phi<0)sd.phi=0;
 }
 if(!hit)return false;
 // Soft blend toward the safe seat; snap the last millimetres so it never stays outside.
 const k=Math.min(1,Math.max(.2,(frameDt||1/60)*10));
 c.lerp(roomSafe,k);
 if(c.x<-b.x||c.x>b.x||c.y<b.y0||c.y>b.y1||c.z>b.z1||c.z<b.z0)c.copy(roomSafe);
 camera.lookAt(t);return true;
}
const keepBelowCeiling=keepInRoom; // alias kept for older callers
function resetView(){
 if(inspect.active){returnRecord();return;}
 machineClamps();const d=defaultPose();flyTo(d.pos,d.target,.9);
}
function snapToDefault(){machineClamps();const d=defaultPose();camera.position.copy(d.pos);controls.target.copy(d.target);camera.lookAt(d.target);stopControlMomentum();}
document.getElementById('resetView')?.addEventListener('click',resetView);
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
// Cancel a flight the moment the viewer takes the camera.
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button!==0&&camTween&&!inspect.active){camTween=null;}},{capture:true});
/* Smooth wheel zoom. Each notch sets a new target distance (a fixed 11% per notch, so it is
   repeatable: five notches in and five out lands exactly where you started); the camera then
   glides there on a critically damped spring in log-distance, so notches in quick succession
   blend into one continuous, floaty sweep with no jump at the start and no overshoot at the end.
   Trackpads (small deltas) move the target proportionally. */
const ZOOM_NOTCH=Math.log(1.11),ZOOM_W=11; // per 100 px of wheel; spring rate (settles in ~0.4 s)
const zoom={goal:null,vel:0,x:0,y:0};
const camDist=()=>camera.position.distanceTo(controls.target);
controls._handleMouseWheel=function(e){
 if(camTween&&!inspect.active)camTween=null;
 const lo=Math.log(controls.minDistance),hi=Math.log(controls.maxDistance);
 if(zoom.goal===null){zoom.goal=Math.log(camDist());zoom.vel=0;}
 zoom.goal=Math.max(lo,Math.min(hi,zoom.goal+Math.sign(e.deltaY)*Math.min(3,Math.abs(e.deltaY)/100)*ZOOM_NOTCH));
 zoom.x=e.clientX;zoom.y=e.clientY;invalidate();
};
function applyZoom(dt){
 if(zoom.goal===null)return false;
 const d0=camDist();if(!(d0>0)){zoom.goal=null;return false;}
 let x=Math.log(d0),v=zoom.vel;const n=Math.max(1,Math.ceil(dt*240)),h=dt/n;
 for(let i=0;i<n;i++){v+=(-ZOOM_W*ZOOM_W*(x-zoom.goal)-2*ZOOM_W*v)*h;x+=v*h;}
 if(Math.abs(x-zoom.goal)<2e-4&&Math.abs(v)<2e-3){x=zoom.goal;zoom.goal=null;v=0;}
 zoom.vel=v;
 if(controls.zoomToCursor)controls._updateZoomParameters?.(zoom.x,zoom.y);
 controls._scale=(controls._scale??1)*Math.exp(x-Math.log(d0));return true; // applied by the frame's one controls.update()
}
controls.addEventListener('change',()=>invalidate());

/* ---------- lighting ---------- */
scene.add(new THREE.HemisphereLight(0xdfe8f5,0x3a2a1e,.18));
const key=new THREE.DirectionalLight(0xfff0dc,2.7);key.name='window-key';key.position.set(-330,640,560);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-340,right:340,top:340,bottom:-340,near:200,far:1900});key.shadow.bias=-.0002;key.shadow.normalBias=.6;key.shadow.radius=3;key.shadow.camera.updateProjectionMatrix();scene.add(key,key.target);
// Low raking glance so the groove sheen reads from the default seat.
// Bounce from the room in front of the machine (fixed, unshadowed).
const frontFill=new THREE.DirectionalLight(0xffe2c0,.35);frontFill.name='room-bounce';frontFill.position.set(-200,-520,260);scene.add(frontFill);
const graze=new THREE.DirectionalLight(0xffe6c0,.55);graze.name='groove-graze';graze.position.set(-160,300,40);scene.add(graze);
/* The light set never changes after start-up: adding, removing or hiding a light
   recompiles every shader in the scene (a visible hitch), and an extra light for
   inspection would also relight the room as the record turns. Inspection relies
   on the window, the room reflection and a stronger reflection on the vinyl only. */

/* ---------- record ---------- */
const disc=new THREE.Group();disc.name='disc';scene.add(disc);
const outgoing=new THREE.Group();outgoing.name='outgoing-records';scene.add(outgoing);
const tonearm=new THREE.Group();tonearm.visible=false;scene.add(tonearm);
/* Reproducer arm: a rigid lever of constant length on a fixed pivot at the
   back-right of the cabinet. It never scales or stretches. It yaws (sweeps)
   about the pivot so the needle lies on the circle of the current groove
   radius, and tilts on a small hinge to lift/drop. */
const HINGE_Z=24;
const armRig=new THREE.Group(),armTilt=new THREE.Group();armRig.add(armTilt);tonearm.add(armRig);
let armL=0,armHz=0,armBeta=0,armPivotX=0,armPivotY=0,frameDt=1/60;
const armParts=[];
function armPivot(R){return [R*1.12,R*.45];}
function armLength(R){const [x,y]=armPivot(R);return Math.hypot(x,y)-R*.26;}
function buildArm(R,thickness){
 for(const o of armParts){armTilt.remove(o);disposeTree(o);}armParts.length=0;
 [armPivotX,armPivotY]=armPivot(R);armL=armLength(R);armHz=HINGE_Z-(thickness-.25);
 armRig.position.set(armPivotX,armPivotY,HINGE_Z);
 const brassM=look.brass({rough:.42}),nickelM=look.nickel({rough:.24}),micaM=look.mica();
 const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0,name='')=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.name=name;m.castShadow=true;m.receiveShadow=true;armTilt.add(m);armParts.push(m);return m;};
 const boxZ=-armHz+10.5; // soundbox centre height (relative to hinge)
 add(new THREE.CylinderGeometry(4.2,4.2,9,32),brassM,0,0,0,0,0,0,'arm-knuckle');                                   // 0 hinge knuckle
 const neck=new V3(armL-4.5,0,boxZ+6.2);
 const curve=new THREE.CatmullRomCurve3([new V3(0,0,0),new V3(armL*.45,0,(neck.z)*.32),new V3(armL-16,0,neck.z+3.4),new V3(armL-8.5,0,neck.z+1.2),neck]);
 add(new THREE.TubeGeometry(curve,64,2.25,20,false),brassM,0,0,0,0,0,0,'arm-tube');                                   // 1 gooseneck tube
 add(new THREE.TorusGeometry(7,1.15,18,64),nickelM,armL,0,boxZ,0,Math.PI/2,0,'soundbox-rim');                          // 2 soundbox rim
 add(new THREE.CylinderGeometry(7,7,2.2,64),nickelM,armL-1.1,0,boxZ,0,0,Math.PI/2,'soundbox-back');                  // 3 back plate
 add(new THREE.CylinderGeometry(5.9,5.9,.35,64),micaM,armL+1.05,0,boxZ,0,0,Math.PI/2,'reproducer');                  // 4 mica diaphragm
 for(let k=0;k<5;k++){const a=k/5*Math.PI*2;                                                                           // 5-9 spider
  const s=add(new THREE.BoxGeometry(.5,.55,5.4),nickelM,armL+1.45,Math.sin(a)*2.7,boxZ+Math.cos(a)*2.7,-a,0,0,'spider');s.castShadow=false;}
 add(new THREE.CylinderGeometry(1.3,1.3,1.2,24),nickelM,armL+1.8,0,boxZ,0,0,Math.PI/2,'spider-hub');                 // 10 hub
 add(new THREE.CylinderGeometry(1.6,1.6,3,24),brassM,armL-3.2,0,neck.z-.6,0,0,Math.PI/2,'neck-ferrule');              // 11 ferrule
 add(new THREE.BoxGeometry(1.3,1.3,2.6),nickelM,armL,0,-armHz+2.6+1.3,0,0,0,'needle-bar');                            // 12 needle bar
 add(new THREE.ConeGeometry(.35,2.6,12),look.nickel({rough:.15}),armL,0,-armHz+1.3,-Math.PI/2,0,0,'needle');          // last: stylus
}
function wrapPi(d){while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d;}
function placeTonearm(tipX,tipY,tipZ,down){
 const m=window.vinyl?.record?.metadata;
 if(!armL||(m&&Math.abs(armHz-(HINGE_Z-(m.thickness_mm-.25)))>1e-6))buildArm(R,m?.thickness_mm??2.5);
 const rad=Math.hypot(tipX,tipY),ang=Math.atan2(tipY,tipX),pitch=m?.pitch_mm||0;
 const Dp=Math.hypot(armPivotX,armPivotY),thP=Math.atan2(armPivotY,armPivotX);
 let r=rad,phi=ang;
 for(let i=0;i<4;i++){
  const c=Math.max(-1,Math.min(1,(r*r+Dp*Dp-armL*armL)/(2*Math.max(r,1e-3)*Dp)));
  phi=thP+Math.acos(c);
  r=rad+pitch*wrapPi(phi-ang)/(2*Math.PI);
 }
 const tx=r*Math.cos(phi),ty=r*Math.sin(phi);
 armRig.rotation.z=Math.atan2(ty-armPivotY,tx-armPivotX);
 const want=Math.asin(Math.max(-1,Math.min(1,(tipZ-(m?.thickness_mm??2.5)+.25)/Math.hypot(armL,armHz))));
 armBeta=reduce()?want:armBeta+(want-armBeta)*(1-Math.exp(-frameDt*13));
 if(Math.abs(want-armBeta)<1e-5)armBeta=want;
 armTilt.rotation.y=-armBeta;
}
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
function clearDisc(){while(disc.children.length){const c=disc.children[0];disc.remove(c);disposeTree(c);}}

/* Vinyl: anisotropic PVC whose highlight streaks radially, as on a real record.
   A shader layer adds the groove band (concentric ridges when they are big
   enough to resolve, otherwise a fine anisotropic sheen), glossy lead-in land
   and run-out, all from the record's own spiral metadata. */
function grooveUniforms(m){
 const label=m?.label_radius_mm??27,rStart=m?.r_start_mm??(R-4),pitch=m?.pitch_mm??.6;
 const turns=m?(m.lead_in_turns+m.duration_sec*m.rpm_cut/60+m.lead_out_turns):(rStart-label-6)/pitch;
 return {uRStart:{value:rStart},uREnd:{value:Math.max(label+2,rStart-pitch*turns)},uPitch:{value:pitch},uLabel:{value:label}};
}
// A flat 1x1 height: the vinyl always has a bump slot, so swapping in the real
// 16-bit relief for inspection is a uniform change, never a shader recompile.
const FLAT=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);FLAT.needsUpdate=true;FLAT.userData.shared=true;
const VINYL_ENV=.32,VINYL_ENV_HELD=.6;
/* The anisotropy frame must be the record's own radial/tangential frame. Three
   builds it from the UVs (a fixed direction painted on the disc), which turns with
   the record and swings the highlight round; replace it in the expanded chunk. */
let grooveChunk=null;
function grooveLightsChunk(){
 if(grooveChunk)return grooveChunk;
 let c=THREE.ShaderChunk.lights_physical_fragment;
 const swaps=[['material.anisotropy = length( anisotropyV );','material.anisotropy = length( anisotropyV )*mix(.22,1.,gMask);material.anisotropy = sqrt( min( .9, material.anisotropy*material.anisotropy+gLost ) );'],
  ['material.roughness = min( material.roughness, 1.0 );','material.roughness = sqrt( min( 1.0, pow2( material.roughness )+gKern ) );'],
  ['material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;','material.anisotropyT = gRad;'],
  ['material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;','material.anisotropyB = normalize( cross( normal, gRad ) );']];
 for(const [from,to] of swaps){if(!c.includes(from))console.warn('vinyl shader: anisotropy hook not found',from);c=c.replace(from,to);}
 return grooveChunk=c;
}
function vinylMaterial(m){
 const surf=look.vinylSurface();
 const mat=new THREE.MeshPhysicalMaterial({color:surf?0xffffff:0x0e0e0f,map:surf?.color??null,roughness:.24,metalness:0,envMapIntensity:VINYL_ENV,
  anisotropy:.55,specularIntensity:.7,ior:1.53,vertexColors:false,side:THREE.FrontSide,bumpMap:FLAT,bumpScale:0,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
 const u=grooveUniforms(m);mat.userData.groove=u;
 mat.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,u);
  // The disc's own x/y axes in view space: radial direction is rebuilt per pixel from
  // them, so the highlight is exactly radial at every angle and stays put as it spins.
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vDisc;varying vec3 vAxX,vAxY;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvDisc=position.xy;vAxX=normalMatrix*vec3(1.,0.,0.);vAxY=normalMatrix*vec3(0.,1.,0.);');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
varying vec2 vDisc;varying vec3 vAxX,vAxY;uniform float uRStart,uREnd,uPitch,uLabel;
// running integral of one groove period's height (V cut over 70% of the pitch, depth .35)
float gInt(float x){float c=floor(x),f=x-c;return -.1225*c+(f<.35?-.5*f*f:f<.7?.1225-.7*f+.5*f*f:-.1225);}`)
   .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
    float gR=length(vDisc);
    float gMask=smoothstep(uREnd-.25,uREnd+.25,gR)*(1.-smoothstep(uRStart-.1,uRStart+.5,gR));
    float gPh=(uRStart-gR)/uPitch,gFw=length(vec2(dFdx(gPh),dFdy(gPh)));
    float runout=smoothstep(uLabel+.8,uLabel+1.6,gR)*(1.-smoothstep(uREnd-.6,uREnd-.2,gR));
    float gLine=runout*(1.-smoothstep(0.,.18,abs(gR-(uLabel+(uREnd-uLabel)*.45))));
    roughnessFactor*=mix(.42,1.,gMask);roughnessFactor=mix(roughnessFactor,.55,gLine);`)
   .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
    vec2 gDir=vDisc/max(gR,1e-3);vec3 gRadV=vAxX*gDir.x+vAxY*gDir.y;
    vec3 gRad=normalize(gRadV-normal*dot(gRadV,normal));
    // Specular AA for the relief bump: where a pixel spans more than a texel of it, how
    // fast its normal turns across the pixel becomes extra roughness (Kaplanyan-Hoffman),
    // so sub-pixel relief turns to sheen; close up (texels bigger than pixels) it stays crisp.
    vec3 gNx=dFdx(normal),gNy=dFdy(normal);vec2 gTx=vec2(textureSize(bumpMap,0));
    float gTexel=max(length(dFdx(vBumpMapUv)*gTx),length(dFdy(vBumpMapUv)*gTx));
    float gKern=min(.5*(dot(gNx,gNx)+dot(gNy,gNy)),.12)*smoothstep(1.,3.,gTexel);
    // V-cut groove (70% of the pitch) between flat lands. Its wall slope is tent-filtered
    // over this pixel's footprint (second difference of the profile's running integral),
    // so close up each wall still catches the light as a crisp ring. Rings faded out
    // before they reach the pixel spacing, where any filter here would alias into moire;
    // the slope they lose widens the radial highlight instead: the averaged groove sheen.
    float gW=max(gFw,1e-4),gC=floor(gPh),gX=gPh-gC;
    float gRes=1.-smoothstep(.3,.6,gW);
    float gSlope=(gInt(gX+gW)-2.*gInt(gX)+gInt(gX-gW))/(gW*gW)*gRes;
    float gLost=.13*(1.-gRes*gRes)*gMask;
    normal=normalize(normal-gRad*gSlope*.6*gMask);`)
   .replace('#include <lights_physical_fragment>',grooveLightsChunk());
 };
 mat.customProgramCacheKey=()=>'vinyl-grooves-v5';
 return mat;
}
function pvcMaterial(side=THREE.FrontSide){return new THREE.MeshPhysicalMaterial({color:0x0d0d0e,roughness:.28,metalness:0,ior:1.53,side});}
// Cover-crop an image into a square of side S at (x,y).
function drawCover(g,img,x,y,S){const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,k=Math.max(S/w,S/h);g.drawImage(img,x+(S-w*k)/2,y+(S-h*k)/2,w*k,h*k);}
function labelPrint(title,m,art=null){
 if(typeof document.createElement!=='function')return null;
 try{
  const N=1024,c=document.createElement('canvas');c.width=c.height=N;const g=c.getContext('2d');if(!g)return null;
  g.fillStyle='#c42420';g.fillRect(0,0,N,N);
  if(art){ // a picture label: the song's cover, with a darkened outer band so the printing stays legible
   drawCover(g,art,0,0,N);const band=g.createRadialGradient(N/2,N/2,N*.2,N/2,N/2,N*.5);
   band.addColorStop(0,'rgba(10,6,4,0)');band.addColorStop(.48,'rgba(10,6,4,.12)');band.addColorStop(.62,'rgba(10,6,4,.62)');band.addColorStop(1,'rgba(10,6,4,.72)');g.fillStyle=band;g.fillRect(0,0,N,N);
   if('shadowColor' in g){g.shadowColor='rgba(0,0,0,.6)';g.shadowBlur=6;}
  }
  g.strokeStyle='#ddc799';g.lineWidth=2;
  for(const r of [.458,.438,.165]){g.beginPath();g.arc(N/2,N/2,N*r,0,Math.PI*2);g.stroke();}
  g.fillStyle='#f3dfb6';g.textAlign='center';g.textBaseline='middle';
  // Typeset individual, un-stretched glyphs tangent to a circle, with measured tracking.
  const arc=(text,r,font,maxAngle,bottom=false)=>{
   const chars=Array.from(text);let size=font,tracking=N*.004;
   const measure=()=>{g.font=`500 ${size}px Georgia, serif`;return chars.map(ch=>g.measureText(ch).width+tracking);};
   let widths=measure(),width=widths.reduce((a,b)=>a+b,0);
   while(width/r>maxAngle&&size>8){size-=1;tracking=Math.max(.5,size*.055);widths=measure();width=widths.reduce((a,b)=>a+b,0);}
   let cursor=-width/2;
   for(let i=0;i<chars.length;i++){
    const offset=(cursor+widths[i]/2)/r,theta=bottom?Math.PI/2-offset:-Math.PI/2+offset;
    g.save();g.translate(N/2+Math.cos(theta)*r,N/2+Math.sin(theta)*r);g.rotate(bottom?theta-Math.PI/2:theta+Math.PI/2);g.fillText(chars[i],0,0);g.restore();cursor+=widths[i];
   }
  };
  const name=String(title||'Record').toUpperCase();
  if(name.length>46){let cut=name.lastIndexOf(' ',Math.ceil(name.length/2)+8);if(cut<name.length*.3)cut=Math.ceil(name.length/2);
   arc(name.slice(0,cut).trim(),N*.365,N*.061,2.75);arc(name.slice(cut).trim(),N*.265,N*.052,2.75);
  }else arc(name,N*.34,N*.088,2.65);
  const sec=Math.max(0,Math.floor(m.duration_sec||0)),time=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
  arc(`${Math.abs(m.rpm_cut-100/3)<.05?'33⅓':Math.round(m.rpm_cut*10)/10} RPM  ·  ${Math.round(m.disc_radius_mm*2)} MM  ·  ${time}`,N*.31,N*.038,2.6,true);
  // Paper: faint fibre and ink unevenness so the label reads as printed stock.
  if(g.createRadialGradient){const gr=g.createRadialGradient(N*.42,N*.38,N*.05,N/2,N/2,N*.5);gr.addColorStop(0,'rgba(255,240,220,.06)');gr.addColorStop(1,'rgba(40,10,5,.10)');g.fillStyle=gr;g.fillRect(0,0,N,N);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities?.getMaxAnisotropy?.()||1;return t;
 }catch{return null;}
}
function addLabel(m,title,cover=null){
 const holeR=3.6;const print=labelPrint(title,m);
 const label=new THREE.Mesh(new THREE.RingGeometry(holeR,m.label_radius_mm,128),new THREE.MeshPhysicalMaterial({color:print?0xffffff:0xc42420,map:print,roughness:.74,metalness:0,
  polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));label.userData.title=title||'Record';
 label.name='vinyl-label';label.position.z=m.thickness_mm+.08;disc.add(label);
 // With the song's cover available, reprint as a picture label once it has loaded.
 if(cover&&print&&typeof Image==='function'){const img=new Image();img.decoding='async';img.onload=()=>{if(!label.parent)return;const art=labelPrint(title,m,img);if(!art)return;
  label.material.map?.dispose();label.material.map=art;label.material.needsUpdate=true;label.userData.art=true;invalidate();};img.src=cover;}
}
function buildRecord(m,title,cover=null){
 const top=new THREE.Mesh(new THREE.RingGeometry(m.label_radius_mm,R,256),vinylMaterial(m));top.name='vinyl-grooves';top.position.z=m.thickness_mm;disc.add(top);
 const rim=new THREE.Mesh(new THREE.CylinderGeometry(R,R,m.thickness_mm,256,1,true),pvcMaterial());rim.name='vinyl-edge';rim.rotation.x=Math.PI/2;rim.position.z=m.thickness_mm/2;disc.add(rim);
 // a rounded lip so the edge catches light like a pressed record
 const lip=new THREE.Mesh(new THREE.TorusGeometry(R-.35,.35,8,256),pvcMaterial());lip.name='vinyl-lip';lip.position.z=m.thickness_mm-.05;disc.add(lip);
 const back=new THREE.Mesh(new THREE.RingGeometry(3.6,R,256),pvcMaterial());back.name='vinyl-underside';back.rotation.x=Math.PI;disc.add(back);
 const hole=new THREE.Mesh(new THREE.CylinderGeometry(3.6,3.6,m.thickness_mm,32,1,true),pvcMaterial(THREE.BackSide));hole.rotation.x=Math.PI/2;hole.position.z=m.thickness_mm/2;hole.name='spindle-hole';disc.add(hole);
 addLabel(m,title,cover);disc.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
}
// Empty platter: a blank pressing with an ivory card label, before any record opens.
function addPlaceholder(){
 const blank=new THREE.Mesh(new THREE.RingGeometry(27,90,256),vinylMaterial(null));blank.position.z=2.5;blank.name='placeholder-disc';
 const card=new THREE.Mesh(new THREE.RingGeometry(3.6,27,96),new THREE.MeshStandardMaterial({color:0xe7e1d4,roughness:.85,metalness:0,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));card.position.z=2.8;
 const rule=new THREE.Mesh(new THREE.RingGeometry(22,23,96),new THREE.MeshStandardMaterial({color:0xc4a15a,roughness:.35,metalness:.6,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));rule.position.z=2.85;
 disc.add(blank,card,rule);disc.traverse(o=>{if(o.isMesh)o.receiveShadow=true;});
}

/* ---------- External-horn phonograph ----------
   Lacquered mahogany cabinet with turned columns and moulded plinth, brass
   morning-glory horn from a back-right bracket, felt turntable on a nickel
   rim, side crank. Sized from the disc radius R; rebuilt when R changes. */
const phonograph=new THREE.Group();phonograph.name='phonograph';scene.add(phonograph);
const room=buildParlor(THREE,look);scene.add(room);
room.getObjectByName('daylight-window')?.material?.color?.setScalar(4.5); // overexposed daylight, as a camera sees it
let envMap=null;
/* Image-based light from a cheap stand-in of the room: flat-coloured walls, floor,
   ceiling and wainscot, the bright window with its glazing bars and the warm lamp.
   Reflections are blurred anyway, so this matches the full room at a fraction of
   the cost and adds no shader variants. */
function bakeRoomEnvironment(){
 try{
  const pm=new THREE.PMREMGenerator(renderer),env=new THREE.Scene(),z0=room.position.z,mats=[],geos=[];
  const flat=c=>{const m=new THREE.MeshBasicMaterial({color:c,side:THREE.BackSide});mats.push(m);return m;};
  const quad=(w,h,c,x,y,z,rx,ry,dbl)=>{const g=new THREE.PlaneGeometry(w,h);geos.push(g);const m=flat(c);if(dbl)m.side=THREE.DoubleSide;const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.rotation.set(rx,ry,0);env.add(o);return o;};
  const box=new THREE.BoxGeometry(2400,1740,880);geos.push(box);
  // radiance of the lit room surfaces (the full room as the key and lamp light it)
  const walls=new THREE.Mesh(box,[flat(0x6e604a),flat(0x7a6a52),flat(0x857358),flat(0x5a4c3a),flat(0x9a9080),flat(0x4a3020)]);walls.position.set(0,-330,z0+440);env.add(walls);
  quad(2400,145,0x3a2516,0,529,z0+72,Math.PI/2,0,true);                                   // wainscot
  quad(520,380,0,-330,40,z0+2,0,0,true).material.color.setRGB(1.5,1.12,.78);              // sunlit patch of floor
  quad(900,420,0,0,-1190,z0+520,Math.PI/2,0,true).material.color.setRGB(.95,.9,.82);      // pale front wall, lit by the window
  const glow=new THREE.Color(4.2,4.3,4.4);quad(300,500,0,-360,528,z0+450,Math.PI/2,0,true).material.color.copy(glow);
  for(const [w,h,x,dz] of [[10,500,0,0],[300,9,0,-95],[300,9,0,85]])quad(w,h,0x140e0a,-360+x,526,z0+450+dz,Math.PI/2,0,true);
  quad(80,60,0,530,430,z0+354,Math.PI/2,0,true).material.color.setRGB(2.2,1.6,.9);          // opaline lamp
  envMap=pm.fromScene(env,.02,2,5000).texture;
  pm.dispose();for(const g of geos)g.dispose();for(const m of mats)m.dispose();
  scene.environment=envMap;scene.environmentIntensity=.95;
 }catch{
  try{const pm=new THREE.PMREMGenerator(renderer);envMap=pm.fromScene(new RoomEnvironment(),.04).texture;pm.dispose();scene.environment=envMap;}catch{envMap=null;}
 }
}
function slab(w,d,h,bevel,mat,segs=4){
 const sh=new THREE.Shape();const x=w/2-bevel,y=d/2-bevel;sh.moveTo(-x,-y);sh.lineTo(x,-y);sh.lineTo(x,y);sh.lineTo(-x,y);sh.closePath();
 const g=new THREE.ExtrudeGeometry(sh,{depth:Math.max(.01,h-2*bevel),bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:segs,curveSegments:4});
 g.translate(0,0,bevel);return new THREE.Mesh(g,mat);
}
function turnedColumn(h,r,mat){
 const P=[[0,0],[1,0],[1,.05],[.78,.08],[.78,.12],[.95,.16],[.7,.24],[.55,.3],[.62,.36],[.92,.5],[.62,.64],[.55,.7],[.7,.76],[.95,.84],[.78,.88],[.78,.92],[1,.95],[1,1],[0,1]];
 const g=new THREE.LatheGeometry(P.map(([a,b])=>new THREE.Vector2(a*r,b*h)),40);g.rotateX(Math.PI/2);return new THREE.Mesh(g,mat);
}
function hornGeometry(curve,r0,r1,petals=8,seg=150,radial=128){
 const frames={tangents:[],normals:[],binormals:[]},pos=[],uvs=[],idx=[],rim=[];
 {let n=new THREE.Vector3(0,1,0);
  for(let i=0;i<=seg;i++){const T=curve.getTangentAt(i/seg).normalize();n=n.sub(T.clone().multiplyScalar(n.dot(T))).normalize();frames.tangents.push(T);frames.normals.push(n.clone());frames.binormals.push(new THREE.Vector3().crossVectors(T,n));}}
 for(let i=0;i<=seg;i++){
  const t=i/seg,P=curve.getPointAt(t),N=frames.normals[i],B=frames.binormals[i];
  const flare=r0*Math.pow(r1/r0,Math.pow(t,1.9));
  for(let j=0;j<=radial;j++){
   const th=j/radial*Math.PI*2,c=Math.cos(petals*th);
   const petal=1+.07*Math.pow(t,5)*c,seam=1+.018*Math.pow(t,1.2)*Math.pow(Math.max(0,-c),60),r=flare*petal*seam;
   const v=new THREE.Vector3().copy(P).addScaledVector(N,Math.cos(th)*r).addScaledVector(B,Math.sin(th)*r);
   pos.push(v.x,v.y,v.z);uvs.push(t*3,j/radial*4);if(i===seg&&j<radial)rim.push(v);
  }
 }
 for(let i=0;i<seg;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+radial+1;idx.push(a,b,a+1,b,b+1,a+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(idx);g.computeVertexNormals();
 return {geometry:g,rim,frames};
}
/* ---------- Spring-mounted dashboard hula girl ----------
   Painted-vinyl toy on a felt-and-wood puck at the front-left of the lid. A
   damped spring driven by the playing audio's loudness; needle up => she settles. */
class Helix extends THREE.Curve{constructor(r,h,turns){super();this.r=r;this.h=h;this.turns=turns;}getPoint(t,o=new THREE.Vector3()){const a=t*this.turns*Math.PI*2;return o.set(this.r*Math.cos(a),this.r*Math.sin(a),t*this.h);}}
function toy(color,rough=.42){return look.plastic(color,rough);}
const hula={group:null,spring:null,dancer:null,hips:null,torso:null,arms:[],springH:0,baseTop:0,ax:0,ay:0,vx:0,vy:0,bz:0,vz:0,env:0,prev:0,phase:0,last:0};
function buildHula(R,top,W,D){
 const s=R/90*1.3,g=new THREE.Group();g.name='hula-girl';g.position.set(-W*.8,-D*.8,top);
 const add=(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);parent.add(m);return m;};
 const skin=toy(0xc8875a,.5),grass=look.fabric(0x6f8f2c),grass2=look.fabric(0x9bb04a),straw=toy(0xd8b25a,.6),lei=toy(0xff5c8a,.45),red=toy(0xc42420,.4),hair=toy(0x1a1210,.35),wood=look.lacquer(0xd0a080,{rough:.4,grainMM:60}),felt=look.felt(0x2d4a30);
 const nickelS=look.nickel({rough:.3});
 add(g,new THREE.CylinderGeometry(7.2*s,7.2*s,.6*s,32),felt,0,0,.3*s,Math.PI/2);
 add(g,new THREE.CylinderGeometry(6.2*s,6.8*s,2.4*s,32),wood,0,0,.6*s+1.2*s,Math.PI/2);
 hula.baseTop=3*s;hula.springH=7*s;
 const spring=add(g,new THREE.TubeGeometry(new Helix(2.1*s,hula.springH,6),200,.32*s,8),nickelS,0,0,hula.baseTop);hula.spring=spring;
 const dancer=new THREE.Group();dancer.name='hula-dancer';g.add(dancer);hula.dancer=dancer;
 add(dancer,new THREE.CylinderGeometry(2.6*s,2.6*s,.8*s,24),look.brass({rough:.5}),0,0,.4*s,Math.PI/2);
 const hips=new THREE.Group();hips.position.z=.8*s;dancer.add(hips);hula.hips=hips;
 for(const sx of [-1,1])add(hips,new THREE.CylinderGeometry(.75*s,.9*s,7*s,12),skin,sx*1.05*s,0,3.5*s,Math.PI/2);
 add(hips,new THREE.CylinderGeometry(2.4*s,4.3*s,6.2*s,40,1,true),grass,0,0,4.9*s,Math.PI/2);
 add(hips,new THREE.CylinderGeometry(2.3*s,3.6*s,4.2*s,22,1,true),grass2,0,0,6*s,Math.PI/2,.15);
 add(hips,new THREE.TorusGeometry(2.35*s,.45*s,8,28),straw,0,0,8*s);
 const torso=new THREE.Group();torso.position.z=8.3*s;hips.add(torso);hula.torso=torso;
 const chest=add(torso,new THREE.SphereGeometry(2.2*s,20,16),skin,0,0,2.4*s);chest.scale.set(1,.78,1.45);
 add(torso,new THREE.CylinderGeometry(2.05*s,2.05*s,1.1*s,20),red,0,0,3.1*s,Math.PI/2);
 add(torso,new THREE.TorusGeometry(2.1*s,.6*s,8,24),lei,0,-.15*s,4.6*s,.25);
 add(torso,new THREE.CylinderGeometry(.6*s,.7*s,1.2*s,12),skin,0,0,5.4*s,Math.PI/2);
 add(torso,new THREE.SphereGeometry(2.15*s,24,18),skin,0,0,7.4*s);
 const hairCap=add(torso,new THREE.SphereGeometry(2.3*s,24,18,0,Math.PI*2,0,Math.PI*.6),hair,0,.35*s,7.6*s,Math.PI/2+.35);hairCap.scale.set(1,1,1.05);
 add(torso,new THREE.SphereGeometry(1.1*s,14,10),hair,0,1.9*s,6.2*s);
 add(torso,new THREE.SphereGeometry(.75*s,12,8),toy(0xff8a2a,.5),1.7*s,-.6*s,8.4*s);
 for(const sx of [-1,1])add(torso,new THREE.SphereGeometry(.28*s,8,6),hair,sx*.75*s,-1.95*s,7.7*s);
 hula.arms=[];
 for(const sx of [-1,1]){const arm=new THREE.Group();arm.position.set(sx*1.9*s,0,4.1*s);torso.add(arm);
  add(arm,new THREE.CylinderGeometry(.5*s,.55*s,5.6*s,12),skin,sx*2.8*s,0,.7*s,0,0,-sx*(Math.PI/2-.25));
  add(arm,new THREE.SphereGeometry(.65*s,12,8),skin,sx*5.5*s,0,1.45*s);arm.userData.sx=sx;hula.arms.push(arm);}
 hula.group=g;return g;
}
function updateHula(energy){
 if(!hula.group)return;
 const dt=Math.min(.05,Math.max(.001,frameDt||1/60));hula.last=(typeof performance!=='undefined'?performance.now():Date.now());
 const still=reduce();
 hula.env+=(energy-hula.env)*Math.min(1,dt*(energy>hula.env?18:3));
 const drive=Math.min(1,hula.env*5),onset=Math.max(0,hula.env-hula.prev);hula.prev=hula.env;
 if(still){hula.ax=hula.ay=hula.bz=hula.vx=hula.vy=hula.vz=0;}
 else{
  hula.phase+=dt*Math.PI*2*1.6;
  const kick=onset*40*(Math.sin(hula.phase*3.7)>0?1:-1);
  hula.vx+=(-60*hula.ax-1.8*hula.vx+drive*10*Math.sin(hula.phase))*dt+kick*dt*10;hula.ax+=hula.vx*dt;
  hula.vy+=(-70*hula.ay-1.8*hula.vy+drive*5*Math.sin(hula.phase*.5+1))*dt+kick*dt*4;hula.ay+=hula.vy*dt;
  hula.vz+=(-200*hula.bz-7*hula.vz-drive*28*(.5+.5*Math.sin(hula.phase*2)))*dt-onset*60*dt*10;hula.bz+=hula.vz*dt;
  hula.ax=Math.max(-.5,Math.min(.5,hula.ax));hula.ay=Math.max(-.4,Math.min(.4,hula.ay));hula.bz=Math.max(-.35,Math.min(.25,hula.bz));
  // fully at rest: snap to zero so the idle scene stops drawing
  if(drive<1e-3&&Math.abs(hula.ax)+Math.abs(hula.ay)+Math.abs(hula.bz)+Math.abs(hula.vx)+Math.abs(hula.vy)+Math.abs(hula.vz)<2e-4)hula.ax=hula.ay=hula.bz=hula.vx=hula.vy=hula.vz=0;
 }
 const sp=hula.spring;sp.rotation.set(-hula.ay*.5,hula.ax*.5,0);sp.scale.z=1+hula.bz;
 const tip=new THREE.Vector3(0,0,hula.springH*(1+hula.bz)).applyEuler(sp.rotation);
 hula.dancer.position.set(tip.x,tip.y,hula.baseTop+tip.z);hula.dancer.rotation.set(-hula.ay,hula.ax,0);
 hula.hips.rotation.y=hula.ax*.5;hula.torso.rotation.y=-hula.ax*1.3;
 for(const a of hula.arms)a.rotation.x=(still?0:Math.sin(hula.phase+a.userData.sx)*drive*.35);
}
/* ---------- the shiba (Garyck Arntzen): a cabinet toy ----------
   He stands in the front-left corner (only one toy shows at a time; the hula girl is the
   default and the brass pip on the cabinet front swaps them). He sits side-on to the seat
   so the butt shows; its spring reacts to the record under the needle (hits, bass line,
   loudness; see shiba.js). Tuning: ?shibaAmp=&shibaLR=&shibaUD=
   &shibaMode=react|fig8|alt|beat&shibaFig=&shibaClamp=&shibaChaos= */
const pageQuery=(()=>{try{return new URLSearchParams(location.search);}catch{return null;}})();
const shiba=typeof createShiba==='function'?createShiba(THREE,{url:String(import.meta.url).replace(/[^/]*$/,'shiba.bin'),shells:10,query:pageQuery}):null;
function buildShibaSpot(R,top,W,D){
 const g=new THREE.Group();g.name='shiba-toy';g.position.set(-W*.8,-D*.8,top);
 if(!shiba)return g;
 // dog-local (-.43,·,.9) is the original page's 3/4 camera; after standing him up it is world (-.43,-.9)
 const seat=defaultPose(R).pos,to=Math.atan2(seat.y-g.position.y,seat.x-g.position.x),yaw=to-Math.atan2(-.9,-.43);
 return shiba.mount(g,{scale:R/90*11,yaw,base:look.felt(0x2d4a30)});
}
// what the record is doing under the needle right now (band levels, bass pitch); null when the needle is up
function shibaMusic(v,t){
 if(!shiba||toyChoice!=='shiba'||!v.down||v.state.grabbed)return null;const b=v.buffer||v.grooveBuffer;return b?shiba.features(b,t):null;
}
function updateShiba(music){
 if(!shiba||!shiba.loaded)return false;
 return shiba.update(Math.min(.05,Math.max(.001,frameDt||1/60)),music,reduce());
}
/* ---------- secret toy switch: a small brass pip low on the cabinet front ----------
   Press it to swap the shiba and the hula girl (one shows at a time; shiba by default).
   The old toy shrinks away, the new one pops up with a little overshoot, the pip clicks
   in. The choice is kept in localStorage. */
const TOY_KEY='vinyl-toy',TOYS=['shiba','hula'];
let toyChoice=(()=>{try{return localStorage.getItem(TOY_KEY)==='shiba'?'shiba':'hula';}catch{return 'hula';}})();
const toyAnim={t:1,from:null,to:toyChoice,press:0};
const popIn=u=>{const c1=2.2,c3=c1+1,x=u-1;return 1+c3*x*x*x+c1*x*x;};
function toyObject(name){return name==='hula'?hula.group:phonograph.getObjectByName('shiba-toy');}
function toyScale(name){
 if(toyAnim.t>=1)return name===toyChoice?1:0;const t=toyAnim.t,cut=.38;
 if(name===toyAnim.from)return t<cut?1-ease(t/cut):0;
 if(name===toyAnim.to)return t<cut?0:popIn((t-cut)/(1-cut));
 return 0;
}
function applyToys(){
 for(const name of TOYS){const o=toyObject(name);if(!o)continue;const k=toyScale(name);o.visible=k>1e-3;o.scale.set(Math.max(1e-3,k),Math.max(1e-3,k),Math.max(1e-3,k*(1+.25*Math.max(0,1-k)*(name===toyAnim.to?1:0))));}
 const pip=phonograph.getObjectByName('toy-switch-pip');if(pip)pip.position.y=pip.userData.y0+pip.userData.travel*Math.sin(Math.PI*Math.min(1,toyAnim.press));
}
let clickCtx=null;
function toyClick(){ // a short brass tick: band-passed noise, at the player's volume
 try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;clickCtx=clickCtx||new AC();const c=clickCtx;c.resume?.();
  const n=Math.floor(c.sampleRate*.018),b=c.createBuffer(1,n,c.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,4);
  const src=c.createBufferSource(),bp=c.createBiquadFilter(),g=c.createGain();src.buffer=b;bp.type='bandpass';bp.frequency.value=3200;bp.Q.value=3;g.gain.value=.5*(window.vinyl?.volume??.7);
  src.connect(bp);bp.connect(g);g.connect(c.destination);src.start();}catch{}
}
function swapToy(to){
 const next=to&&TOYS.includes(to)?to:(toyChoice==='shiba'?'hula':'shiba');if(next===toyChoice&&toyAnim.t>=1)return toyChoice;
 toyAnim.from=toyChoice;toyAnim.to=next;toyAnim.t=reduce()?1:0;toyAnim.press=reduce()?1:0;toyChoice=next;
 try{localStorage.setItem(TOY_KEY,next);}catch{}
 toyClick();applyToys();invalidate(3);return next;
}
function updateToys(dt){
 let busy=false;
 if(toyAnim.press<1){toyAnim.press=Math.min(1,toyAnim.press+dt/.16);busy=true;}
 if(toyAnim.t<1){toyAnim.t=Math.min(1,toyAnim.t+dt/.55);busy=true;}
 if(busy)applyToys();return busy;
}
function buildToySwitch(R,W,D,bodyBot,brass){
 const g=new THREE.Group();g.name='toy-switch';g.userData.pick='toy-switch';
 const faceY=-D+R*.02,x=W-R*.2,z=bodyBot+R*.16;g.position.set(x,faceY,z);
 const bezel=new THREE.Mesh(new THREE.TorusGeometry(R*.024,R*.006,10,32),brass);bezel.rotation.x=Math.PI/2;g.add(bezel);
 const pip=new THREE.Mesh(new THREE.SphereGeometry(R*.02,20,12,0,Math.PI*2,0,Math.PI/2),brass);pip.name='toy-switch-pip';pip.rotation.z=Math.PI;pip.scale.set(1,.55,1);
 pip.userData.y0=0;pip.userData.travel=R*.008;g.add(pip);
 // invisible, larger touch target so a 3 mm pip is still easy to hit
 const hitM=new THREE.MeshBasicMaterial({visible:false});hitM.userData.shared=true;
 const hit=new THREE.Mesh(new THREE.SphereGeometry(R*.06,10,8),hitM);hit.name='toy-switch-hit';g.add(hit);
 return g;
}
function engrave(text,w,h,color='#d9bd7a',lit=false){
 if(typeof document.createElement!=='function')return null;
 try{const c=document.createElement('canvas');c.width=512;c.height=Math.round(512*h/w);const g=c.getContext('2d');if(!g)return null;
  g.fillStyle=color;g.font=`500 ${Math.round(c.height*.62)}px Georgia, serif`;g.textAlign='center';g.textBaseline='middle';
  if('letterSpacing' in g)g.letterSpacing='6px';g.fillText(text,c.width/2,c.height/2);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  const mat=lit?new THREE.MeshStandardMaterial({map:t,transparent:true,depthWrite:false,roughness:.6,metalness:0}):new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false});
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);m.rotation.x=Math.PI/2;return m;}catch{return null;}
}
/* ---------- Record sleeves: every loaded record not on the platter ---------- */
const sleeves=new THREE.Group();sleeves.name='sleeves';scene.add(sleeves);
const dropRing=new THREE.Mesh(new THREE.TorusGeometry(1,.012,8,160),new THREE.MeshBasicMaterial({color:new THREE.Color(1.6,1.15,.55),transparent:true,opacity:0,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending}));
dropRing.name='drop-ring';dropRing.visible=false;dropRing.renderOrder=5;scene.add(dropRing);
let pendingFromLathe=false;
let sleeveData=[],tableZ=-95,cabW=117,cabD=117,sleeveDrag=null,sleevePop=null,pendingSwapFrom=null,pendingSwapTilt=0,pendingExtract=null,currentSleeve=null,dropOrder=0,lastRecordId=null;const coverCache=new Map(),MAX_SLEEVES=40,SLEEVE_YAW=.62;let hoverId=null;
/* Capture a sleeve-local slide-out: the disc starts inside the jacket and eases
   out through the open top edge before any flight to the platter, so it never
   teleports through the cardboard. */
function captureExtract(jacket){
 scene.updateMatrixWorld(true);const S=2*R*1.04,q=jacket.quaternion.clone(),origin=jacket.position.clone();
 const axis=new THREE.Vector3(0,0,1).applyQuaternion(q);
 // Platter disc faces +Z; peek record faces along jacket ±Y. Map disc +Z → jacket +Y.
 const qDisc=q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2));
 const curZ=(jacket.userData.peekObj&&jacket.userData.peek>.01)?jacket.userData.peekObj.position.z:S*.5;
 const clearZ=S+R*1.08,insideZ=Math.min(curZ,clearZ-.5);
 const at=z=>origin.clone().addScaledVector(axis,z);
 const inside=at(insideZ),clear=at(clearZ);
 return {inside,clear,q:qDisc,axis:axis.clone(),origin:origin.clone(),S,sleeveId:jacket.userData.sleeveId,extractDur:1.25,flightDur:1.55};
}
function armSwapFromSleeve(jacketOrId,tilt=Math.PI/2-.15){
 const j=typeof jacketOrId==='object'&&jacketOrId?.isObject3D?jacketOrId:sleeves.children.find(o=>o.userData.sleeveId===jacketOrId);
 if(!j||j.userData.empty){pendingExtract=null;pendingSwapFrom=null;pendingSwapTilt=0;return false;}
 // Extract from where the sleeve lives (crate / floor rest), never from a face-on presentPose.
 const home=j.userData.home;if(home){j.position.copy(home.p);j.quaternion.copy(home.q);j.updateMatrixWorld(true);}
 pendingExtract=captureExtract(j);pendingSwapFrom=pendingExtract.clear.clone();pendingSwapTilt=tilt;return true;
}
/* Soft floor on how close the moving disc may get to the camera (keeps it from filling the frame). */
function keepDiscAwayFromCamera(pos){
 const cam=camera.position,platter=controls.target,D=Math.max(R*3.5,cam.distanceTo(platter)*.72);
 const offset=pos.clone().sub(cam),d=offset.length();
 if(d>1e-4&&d<D)pos.copy(cam).addScaledVector(offset.multiplyScalar(1/d),D);
 return pos;
}
/* Sleeves stay where they are put. sleeveRest: id -> {p,q} for a sleeve left lying on
   the floor; an id with no entry stands in the record crate (the shelf). The playing record's own
   sleeve is shown too, empty, wherever it was put down. */
const sleeveRest=new Map();
const LID_Z=-4;
function disposeSleeves(){sleeves.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(m.map&&!m.userData.cached&&!m.map.userData?.shared)m.map.dispose();m.dispose();}}});sleeves.clear();}
function jacketFront(entry,S,front){
 const deco=new THREE.Group();deco.name='sleeve-deco';
 const fr=new THREE.Shape();fr.moveTo(-S*.46,-S*.46);fr.lineTo(S*.46,-S*.46);fr.lineTo(S*.46,S*.46);fr.lineTo(-S*.46,S*.46);fr.closePath();
 const hole=new THREE.Path();hole.moveTo(-S*.43,-S*.43);hole.lineTo(-S*.43,S*.43);hole.lineTo(S*.43,S*.43);hole.lineTo(S*.43,-S*.43);hole.closePath();fr.holes.push(hole);
 const off={polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2};
 deco.add(new THREE.Mesh(new THREE.ShapeGeometry(fr),new THREE.MeshStandardMaterial({color:0xc4a15a,metalness:.6,roughness:.35,...off})));
 const lab=new THREE.Mesh(new THREE.CircleGeometry(S*.17,64),new THREE.MeshStandardMaterial({color:0xc42420,roughness:.8,...off}));lab.name='sleeve-label';deco.add(lab);
 const ring=new THREE.Mesh(new THREE.RingGeometry(S*.3,S*.31,96),new THREE.MeshStandardMaterial({color:0xc4a15a,metalness:.6,roughness:.35,...off}));deco.add(ring);
 const title=engrave(String(entry.label||'Record').slice(0,28).toUpperCase(),S*.8,S*.08,'#2a1a10',true);
 if(title){title.rotation.x=0;title.position.y=-S*.38;deco.add(title);}
 deco.position.z=.6;front.add(deco);return deco;
}
function makeJacket(entry,S,T,empty=false,lazy=false){
 const j=new THREE.Group();j.name='sleeve';j.userData={pick:'sleeve',sleeveId:entry.id,label:entry.label,empty,peek:0};
 if(!empty){ // the record inside: slides out of the top edge while the sleeve is offered to the platter
  const rec=new THREE.Group();rec.name='sleeve-peek';rec.position.z=S/2;rec.visible=false;j.add(rec);
  const d=new THREE.Mesh(new THREE.CylinderGeometry(R*.985,R*.985,T*.45,96),new THREE.MeshStandardMaterial({color:0x0e0e0f,roughness:.3}));rec.add(d);
  for(const sy of [-1,1]){const l=new THREE.Mesh(new THREE.CircleGeometry(R*.3,48),new THREE.MeshStandardMaterial({color:0xc42420,roughness:.7}));l.rotation.x=sy*Math.PI/2;l.position.y=sy*T*.24;rec.add(l);}
  j.userData.peekObj=rec;
 }
 const kraft=look.paper(0xcdb488);
 const body=new THREE.Mesh(new THREE.BoxGeometry(S,T,S),kraft);body.position.z=S/2;body.castShadow=body.receiveShadow=true;j.add(body);
 const front=new THREE.Group();front.position.set(0,-T/2-.7,S/2);front.rotation.x=Math.PI/2;j.add(front);
 const coverMat=new THREE.MeshPhysicalMaterial({color:0xe7e1d4,roughness:.6,metalness:0,clearcoat:.25,clearcoatRoughness:.4});
 front.add(new THREE.Mesh(new THREE.PlaneGeometry(S*.985,S*.985),coverMat));
 const deco=jacketFront(entry,S,front);
 const apply=tex=>{coverMat.map=tex;coverMat.userData.cached=true;coverMat.color.set(0xffffff);coverMat.needsUpdate=true;deco.visible=false;invalidate();};
 const k=entry.cover+'|'+entry.label+'|'+!!entry.art,cached=coverCache.get(k);
 // Sleeves standing behind others in the crate print their cover only when you reach for them.
 const loadCover=()=>{j.userData.loadCover=null;if(cached==='fail'||!entry.cover||coverCache.get(k)==='loading')return;coverCache.set(k,'loading');
  new THREE.TextureLoader().load(entry.cover,tex=>{const art=coverArt(tex,entry.label,!!entry.art);coverCache.set(k,art);for(const o of sleeves.children)if(o.userData.coverKey===k)o.userData.applyCover?.(art);},undefined,()=>coverCache.set(k,'fail'));};
 j.userData.coverKey=k;j.userData.applyCover=apply;
 if(cached instanceof THREE.Texture)apply(cached);else if(lazy)j.userData.loadCover=loadCover;else loadCover();
 return j;
}
function coverArt(tex,label,album=false){
 tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=renderer.capabilities?.getMaxAnisotropy?.()||1;
 if(typeof document.createElement!=='function'||!tex.image)return tex;
 try{const N=1024,c=document.createElement('canvas');c.width=c.height=N;const g=c.getContext('2d');
  if(album){ // the song's own artwork, full bleed, printed on card that has seen a few years on the shelf
   drawCover(g,tex.image,0,0,N);
   g.globalCompositeOperation='multiply';const wear=g.createRadialGradient(N/2,N/2,N*.36,N/2,N/2,N*.78);wear.addColorStop(0,'#ffffff');wear.addColorStop(1,'#d8cbb4');g.fillStyle=wear;g.fillRect(0,0,N,N);
   g.globalCompositeOperation='screen';g.strokeStyle='rgba(255,250,240,.07)';g.lineWidth=10;g.beginPath();g.arc(N/2,N/2,N*.44,0,Math.PI*2);g.stroke();g.globalCompositeOperation='source-over';
   const out=new THREE.CanvasTexture(c);out.colorSpace=THREE.SRGBColorSpace;out.anisotropy=tex.anisotropy;tex.dispose();return out;
  }
  g.fillStyle='#e7e1d4';g.fillRect(0,0,N,N);
  g.strokeStyle='#b8954e';g.lineWidth=14;g.strokeRect(34,34,N-68,N-68);g.lineWidth=4;g.strokeRect(62,62,N-124,N-124);
  for(let i=0;i<9;i++){g.beginPath();g.moveTo(N/2,N*.47);g.lineTo(N*.1+i*N*.1,N*.1);g.lineWidth=2;g.stroke();}
  g.save();g.beginPath();g.arc(N/2,N*.47,N*.34,0,Math.PI*2);g.clip();g.drawImage(tex.image,N*.16,N*.13,N*.68,N*.68);g.restore();
  g.beginPath();g.arc(N/2,N*.47,N*.345,0,Math.PI*2);g.lineWidth=6;g.strokeStyle='#b8954e';g.stroke();
  g.fillStyle='#2a1a10';g.font='500 54px Georgia, serif';g.textAlign='center';g.textBaseline='middle';if('letterSpacing' in g)g.letterSpacing='8px';
  g.fillText(String(label||'Record').slice(0,24).toUpperCase(),N/2,N*.89);
  // shelf wear: a soft ring-wear disc and darker edges, as on a played-out jacket
  g.globalCompositeOperation='multiply';const gr=g.createRadialGradient(N/2,N/2,N*.3,N/2,N/2,N*.75);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(1,'rgba(200,185,160,1)');g.fillStyle=gr;g.fillRect(0,0,N,N);g.globalCompositeOperation='source-over';
  const out=new THREE.CanvasTexture(c);out.colorSpace=THREE.SRGBColorSpace;out.anisotropy=tex.anisotropy;tex.dispose();return out;}catch{return tex;}
}
/* The shelf: an open-topped wooden record crate beside the machine. Sleeves stand in it
   front to back, leaning back a little; the front one shows its cover, the rest their
   top edges. Hover one and it bobs up in the crate; a click slides the record half out
   and holds it; drag that to the platter to play. Sleeves never leave the crate. */
const CRATE_LEAN=.12;
function crateFrame(){
 // back-left of the machine, running away to the left; the covers face the gramophone, so from the
 // seat each sleeve shows a sliver of its cover, like flicking through a bin in a shop
 const S=2*R*1.04,yaw=1.74,o=new THREE.Vector3(-(cabW+R*.45),R*1.3,tableZ);
 return {o,yaw,S,wall:R*.05,pitch:R*.1,front:R*.12};
}
function crateLocal(x,y,z){const f=crateFrame(),c=Math.cos(f.yaw),s=Math.sin(f.yaw);return new THREE.Vector3(f.o.x+x*c-y*s,f.o.y+x*s+y*c,f.o.z+z);}
function crateDepth(n){const f=crateFrame();return f.front+Math.max(n,12)*f.pitch+f.S*Math.sin(CRATE_LEAN)+R*.06;}
function sleeveHome(i,n){
 const f=crateFrame(),p=crateLocal(0,f.front+i*f.pitch,f.wall*.6);
 const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-CRATE_LEAN,0,f.yaw+((i*7)%3-1)*.012,'ZXY'));
 return {p,q};
}
function crateCenter(){return crateLocal(0,crateDepth(sleeveData.length+1)/2,0);}
// A sleeve lying flat must not overlap the cabinet's plinth: push its centre out past
// the plinth by its own (rotated) half-width.
function clearOfCabinet(c,yaw){
 const S=2*R*1.04,half=S/2*(Math.abs(Math.cos(yaw))+Math.abs(Math.sin(yaw))),mx=cabW+R*.2+half,my=cabD+R*.2+half,out=c.clone();
 if(Math.abs(out.x)<mx&&Math.abs(out.y)<my){if(mx-Math.abs(out.x)<my-Math.abs(out.y))out.x=Math.sign(out.x||1)*mx;else out.y=Math.sign(out.y||-1)*my;}
 return outOfBench(out,half);
}
// ...and never under or into the bench: out past its nearest side.
function outOfBench(c,half){
 const b=bench.box;if(!b)return c;const m=half+R*.15,x0=b.x0-m,x1=b.x1+m,y0=b.y0-m,y1=b.y1+m;
 if(c.x>x0&&c.x<x1&&c.y>y0&&c.y<y1){const d=[c.x-x0,x1-c.x,c.y-y0,y1-c.y],i=d.indexOf(Math.min(...d));if(i===0)c.x=x0;else if(i===1)c.x=x1;else if(i===2)c.y=y0;else c.y=y1;}
 return c;
}
function floorPose(c,yaw,order){ // lying flat, cover up, centred on c (floor level)
 const S=2*R*1.04,T=R*.028,q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,yaw,'ZXY'));
 const p=new THREE.Vector3(c.x+Math.sin(yaw)*S/2,c.y-Math.cos(yaw)*S/2,tableZ+T/2+.4+(order%12)*T*1.1);
 return {p,q,center:new THREE.Vector3(c.x,c.y,tableZ+T)};
}
function presentPose(){ // offered to the platter: standing just in front of the cabinet, leaning back a little
 // front-right, turned a touch towards the platter, so the horn and most of the platter stay in view
 const p=new THREE.Vector3(R*.55,-(cabD+R*.2),LID_Z+R*.22),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.15,0,-.22,'ZXY'));
 return {p,q};
}
function jacketCenter(pose,out=new THREE.Vector3()){const S=2*R*1.04;return out.set(0,0,S/2).applyQuaternion(pose.q).add(pose.p);}
function buildSleeves(){
 const keep=new Map();for(const j of sleeves.children)if(j.userData.sleeveId!=null)keep.set(j.userData.sleeveId,{p:j.position.clone(),q:j.quaternion.clone()});
 disposeSleeves();sleeveDrag=null;sleevePop=null;
 const all=sleeveData.slice(0,MAX_SLEEVES).map(e=>({e,empty:false}));if(currentSleeve)all.push({e:currentSleeve,empty:true});
 const racked=all.filter(x=>!sleeveRest.has(x.e.id)),n=racked.length,S=2*R*1.04,T=R*.028;
 {const f=crateFrame(),D=crateDepth(n),W=f.S+R*.12,w=f.wall,wood=look.lacquer(0xb3875a,{rough:.6,grainMM:120,coat:.15});
  const crate=new THREE.Group();crate.name='record-crate';crate.position.copy(f.o);crate.rotation.z=f.yaw;
  const box=(sx,sy,sz,x,y,z,name)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),wood);m.position.set(x,y,z);m.name=name;crate.add(m);return m;};
  const Hs=f.S*.5,Hf=f.S*.3;
  box(W+2*w,D+2*w,w,0,D/2,w/2,'crate-floor');
  box(W+2*w,w,Hf,0,-w/2,Hf/2,'crate-front');box(W+2*w,w,Hs,0,D+w/2,Hs/2,'crate-back');
  for(const sx of [-1,1])box(w,D,Hs,sx*(W/2+w/2),D/2,Hs/2,'crate-side');
  // a hand-hold cut into each side, as on a shop crate: dark inset
  for(const sx of [-1,1]){const h=new THREE.Mesh(new THREE.PlaneGeometry(D*.28,Hs*.16),new THREE.MeshStandardMaterial({color:0x1a0f08,roughness:.9}));h.rotation.set(Math.PI/2,sx*Math.PI/2,0);h.position.set(sx*(W/2+w+.2),D/2,Hs*.78);crate.add(h);}
  crate.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});
  const shadow=contactDecal(W+R*.5,D+R*.5);if(shadow){shadow.position.set(0,D/2,.6);crate.add(shadow);}
  sleeves.add(crate);
 }
 all.forEach(({e,empty})=>{const i=racked.findIndex(x=>x.e.id===e.id),j=makeJacket(e,S,T,empty,i>0),home=i>=0?sleeveHome(i,n):sleeveRest.get(e.id);j.userData.racked=i>=0;
  const was=keep.get(e.id);j.position.copy(was?.p??home.p);j.quaternion.copy(was?.q??home.q);j.userData.home=home;j.renderOrder=i>=0?n-i:0;sleeves.add(j);});
 invalidate();
}
window.addEventListener('vinyl-sleeves',e=>{sleeveData=(e.detail?.sleeves||[]).slice();currentSleeve=e.detail?.currentSleeve||null;buildSleeves();
 if(latheToShelf){const fresh=sleeveData.find(x=>!latheToShelf.known.has(x.id));if(fresh){const from=latheToShelf.from;latheToShelf=null;fileFromLathe(fresh.id,from);}}});
/* A fresh cut leaves the lathe and is filed into its sleeve in the crate: up off the
   platter, out in front of the bench, along the front of the machine, then round and
   down into the sleeve, the same way a record goes back after playing. */
let latheToShelf=null;
function fileFromLathe(id,from){
 const j=sleeves.children.find(o=>o.userData.sleeveId===id);if(!j?.userData.home||reduce()){if(bench.blank){bench.blank.visible=true;}return;}
 const home=j.userData.home,dest=jacketCenter(home),T=2.5;
 const g=new THREE.Group();g.name='filed-record';
 const body=new THREE.Mesh(new THREE.CylinderGeometry(R,R,T,96),new THREE.MeshStandardMaterial({color:0x0e0e0f,roughness:.3})); // same program as the sleeve's peeking record: no compile hitch mid-flightbody.rotation.x=Math.PI/2;body.position.z=T/2;g.add(body);
 for(const z of [-.05,T+.05]){const l=new THREE.Mesh(new THREE.CircleGeometry(R*.3,48),new THREE.MeshStandardMaterial({color:0xc42420,roughness:.7}));l.position.z=z;if(z<0)l.rotation.x=Math.PI;g.add(l);}
 g.traverse(o=>{if(o.isMesh)o.castShadow=true;});g.position.copy(from);
 const lift=from.clone().setZ(from.z+R*.3),ahead=new THREE.Vector3(from.x,-R*2.45,from.z+R*.35); // low: under the lathe lamp, over the carriage rail
 const route=new THREE.CatmullRomCurve3([from,lift,ahead,...routeTo(dest).points],false,'centripetal');
 const q1=home.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
 g.userData.anim={e:0,dur:2.4,q0:new THREE.Quaternion(),route,q1,direct:true};outgoing.add(g);
 if(bench.blank)bench.blank.visible=false;bench.state='idle';bench.target=0;bench.shown=0;setBlankGroove(0);invalidate(4);
}
function clearSleevePop(){if(!sleevePop)return;sleevePop=null;hint('');invalidate(2);}
function updateSleeves(dt=1/60){
 const k=reduce()?1:1-Math.pow(.0005,dt);let moving=false;
 for(const j of sleeves.children){if(!j.userData.home)continue;
  // Jackets always ease back to their crate/floor home — never carried around the room.
  let tgt=j.userData.home;
  const bobbing=j.userData.racked&&(j.userData.sleeveId===hoverId||sleevePop?.id===j.userData.sleeveId)&&!(sleeveDrag?.jacket===j&&sleeveDrag.armed);
  if(bobbing)tgt={p:tgt.p.clone().setZ(tgt.p.z+2*R*1.04*.2),q:tgt.q}; // browsing / held half-out: rises in the crate
  if(j.position.distanceToSquared(tgt.p)>1e-6||j.quaternion.angleTo(tgt.q)>1e-5){j.position.lerp(tgt.p,k);j.quaternion.slerp(tgt.q,k);moving=true;}
  const pk=j.userData.peekObj;if(pk){
   // armed (drag over platter) → fully peeked; click-held pop → half out; else tucked in
   let want=0;
   if(sleeveDrag?.jacket===j&&sleeveDrag.armed)want=1;
   else if(sleevePop?.id===j.userData.sleeveId)want=.5;
   const cur=j.userData.peek;
   if(Math.abs(want-cur)>1e-3){j.userData.peek=cur+(want-cur)*Math.min(1,k*1.3);moving=true;}else j.userData.peek=want;
   pk.visible=j.userData.peek>.01;pk.position.z=(2*R*1.04)*(.5+.32*j.userData.peek);}
 }
 // the platter glows while a sleeve is offered to it
 const armed=!!sleeveDrag?.armed,o=dropRing.material.opacity,want=armed?.55+.25*Math.sin(performance.now()/180):0;
 if(Math.abs(o-want)>.004||armed){dropRing.material.opacity=o+(want-o)*Math.min(1,k*1.5);dropRing.visible=dropRing.material.opacity>.01;moving=true;}
 return moving;
}
function contactDecal(w,d,opacity=.75){
 const t=look.contactShadow();if(!t)return null;
 const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({color:0x000000,alphaMap:null,map:t,transparent:true,opacity,depthWrite:false,toneMapped:false}));
 m.name='contact-shadow';m.renderOrder=-1;m.castShadow=m.receiveShadow=false;return m;
}

/* ---------- Pick up, turn in your hands, put back ---------- */
let heightTex=null,heightWorker=null,heightTimeout=null,heightOwner=null;
const inspectButton=document.getElementById('inspectRecord');
function syncInspectUI(){if(!inspectButton)return;inspectButton.disabled=!window.vinyl.record;inspectButton.textContent=inspect.active?'Put record back':'Inspect record';inspectButton.setAttribute('aria-pressed',String(inspect.active));}
function clearHeightDetail(){heightWorker?.terminate();heightWorker=null;clearTimeout(heightTimeout);heightTex?.dispose();heightTex=null;heightOwner=null;}
/* Held records show the cut's real relief as a bump map (the grooves are 0.45 mm
   deep: invisible in silhouette, so no displaced mesh). Only uniforms change. */
function setDetail(on){
 const top=disc.getObjectByName('vinyl-grooves'),m=window.vinyl.record?.metadata;if(!top||!m)return;
 const mat=top.material;
 if(on&&heightTex){mat.bumpMap=heightTex;mat.bumpScale=(m.height_polarity==='inverted'?-1:1)*m.height_scale_mm;}
 else{mat.bumpMap=FLAT;mat.bumpScale=0;}
 mat.envMapIntensity=on?VINYL_ENV_HELD:VINYL_ENV;invalidate();
}
async function requestHeightDetail(){
 const record=window.vinyl.record;if(heightTex||heightWorker||!record)return;
 const file=record.heightmapFile;if(!file?.arrayBuffer)return; // bundled demo has only its preview
 const owner=record;heightOwner=owner;
 try{
  const bytes=await file.arrayBuffer();if(!inspect.active||window.vinyl.record!==owner)return;
  const worker=heightWorker=new Worker(new URL('./inspect-height-worker.js',import.meta.url));
  const finish=()=>{worker.terminate();if(heightWorker===worker)heightWorker=null;clearTimeout(heightTimeout);};
  heightTimeout=setTimeout(finish,30000);
  worker.onmessage=e=>{finish();if(e.data.error||window.vinyl.record!==owner||heightOwner!==owner)return;
   const {data,width,height,half,mips}=e.data;const t=new THREE.DataTexture(data,width,height,THREE.RedFormat,half?THREE.HalfFloatType:THREE.FloatType);t.flipY=true;t.colorSpace=THREE.NoColorSpace;
   // trilinear + anisotropic over the worker's mip chain: the relief is averaged over
   // each pixel's footprint as the disc recedes or tilts, never point-sampled
   if(mips?.length){t.mipmaps=[{data,width,height},...mips];t.minFilter=THREE.LinearMipmapLinearFilter;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy?.()||1);}else t.minFilter=THREE.LinearFilter;
   t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;t.needsUpdate=true;heightTex=t;
   if(inspect.active)setDetail(true);
  };worker.onerror=finish;worker.postMessage(bytes,[bytes]);
 }catch{heightWorker?.terminate();heightWorker=null;}
}
const INSPECT_IN=1.0,INSPECT_OUT=.95;
function beginInspection(){
 const v=window.vinyl;if(!v.record||inspect.active||!disc.getObjectByName('vinyl-grooves'))return;
 v.setInspecting(true);drag=false;armHold=null;sleeveDrag=null;sleevePop=null;dropIn=null;disc.position.set(0,0,0);
 inspect.active=true;inspect.phase='out';inspect.elapsed=0;inspect.drag=null;
 inspect.saved={pos:camTween?camTween.p1.clone():camera.position.clone(),target:camTween?camTween.t1.clone():controls.target.clone()};
 inspect.from=disc.position.clone();inspect.qFrom=disc.quaternion.clone();
 inspect.held=new THREE.Vector3(-R*.35,-R*2.8,R*1.6);
 inspect.eye=inspect.held.clone().add(new THREE.Vector3(R*.15,-R*2.9,R*1.7));
 inspect.qHeld=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),inspect.eye.clone().sub(inspect.held).normalize());
 inspect.qHeld.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.48));
 controls.enabled=false;
 flyTo(inspect.eye,inspect.held,INSPECT_IN,()=>{if(inspect.active&&inspect.phase==='out'){inspect.phase='held';loosenInspectCamera();}});
 setDetail(true);requestHeightDetail();syncInspectUI();invalidate();
}
function loosenInspectCamera(){
 controls.minAzimuthAngle=-Infinity;controls.maxAzimuthAngle=Infinity;controls.minPolarAngle=.02;controls.maxPolarAngle=Math.PI-.02;
 controls.minDistance=R*.65;controls.maxDistance=R*5;controls.enablePan=true;controls.zoomToCursor=true;controls.enabled=true;stopControlMomentum();controls.update();
}
function returnRecord(){
 if(!inspect.active||inspect.phase==='back')return;
 inspect.phase='back';inspect.elapsed=0;inspect.drag=null;inspect.from=disc.position.clone();inspect.qFrom=disc.quaternion.clone();controls.enabled=false;
 {const back=inspect.saved||defaultPose();flyTo(back.pos,back.target,INSPECT_OUT);}
 invalidate();
}
function finishInspection(replacing=false){
 if(!inspect.active)return;
 inspect.active=false;inspect.phase='idle';inspect.drag=null;disc.position.set(0,0,0);disc.rotation.set(0,0,window.vinyl.state.rotation);controls.enabled=true;
 if(!replacing)setDetail(false);
 machineClamps();
 if(replacing&&inspect.saved){const s=inspect.saved;flyTo(s.pos,s.target,.7);} // new record mid-inspection: still go back to the viewer's seat
 window.vinyl.setInspecting(false);syncInspectUI();invalidate();
}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
// Path from the spindle to the hand: straight up off the spindle (clear of its cap
// but under the raised needle), forward and low out from under the arm and horn,
// then up. u in 0..1, continuous in position and nearly so in speed.
const LIFT_U=.2;
function inspectPath(u,out,held=inspect.held){
 const clearZ=14; // spindle cap tops out near 10.7 mm; the arm swings up to ~26 mm while a record is lifted
 if(u<=LIFT_U)return out.set(0,0,clearZ*smooth(0,1,u/LIFT_U));
 const w=(u-LIFT_U)/(1-LIFT_U),v=1-w;
 // biased right, away from the hula girl on the front-left corner
 const p0=new THREE.Vector3(0,0,clearZ),p1=new THREE.Vector3(R*.45,-R*1.25,clearZ),p2=new THREE.Vector3(R*.2,-R*2.4,R*.5),p3=held;
 return out.set(0,0,0).addScaledVector(p0,v*v*v).addScaledVector(p1,3*v*v*w).addScaledVector(p2,3*v*w*w).addScaledVector(p3,w*w*w);
}
function updateInspection(dt){
 if(!inspect.active)return false;
 if(inspect.phase!=='held'){
  inspect.elapsed+=dt;
  const dur=inspect.phase==='out'?INSPECT_IN:INSPECT_OUT,t=reduce()?1:Math.min(1,inspect.elapsed/dur);
  // The record leaves the way a hand would take it: slid forward off the spindle,
  // flat and low under the raised arm and the horn bell, and only tilted up to the
  // eye once it is clear of the machine. Putting it back retraces the same path.
  const k=easeInOut(t),flat=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),window.vinyl.state.rotation);
  if(inspect.phase==='out'){
   inspectPath(k,disc.position);
   disc.quaternion.slerpQuaternions(inspect.qFrom,inspect.qHeld,smooth(.38,1,k));
   if(t>=1&&!camTween){inspect.phase='held';loosenInspectCamera();}
  }else{
   inspectPath(1-k,disc.position,inspect.from);
   disc.quaternion.slerpQuaternions(inspect.qFrom,flat,smooth(0,.62,k));
   if(t>=1){finishInspection();return true;}
  }
 }
 return inspect.phase!=='held';
}
inspectButton?.addEventListener('click',()=>inspect.active?returnRecord():beginInspection());
window.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(inspect.active){e.preventDefault();returnRecord();return;}if(sleevePop||sleeveDrag){e.preventDefault();sleeveDrag=null;clearSleevePop();setCursor('');}});

/* ---------- The bench (one-room mode): lathe, blank stack, post tray ----------
   Sits to the right of the cabinet at platter height. The lathe's blank shows the
   groove spreading inward and the cutting head travelling as the real cut reports
   its stages; when the cut is done the new record lifts off the lathe, travels in
   front of the machine and settles on the gramophone. Lights never change (that would
   recompile every shader); the lathe lamp is an emissive bulb read by the bloom. */
const bench={group:null,blanks:null,post:null,blank:null,blankMat:null,carriage:null,bulb:null,box:null,center:new THREE.Vector3(),discZ:0,
 state:'idle',target:0,shown:0,glow:0,park:1,rStart:0,rEnd:0};
function buildBench(R,W,D){
 const g=new THREE.Group();g.name='bench';
 const BW=R*3.4,BD=R*2.3,x0=W+R*.45,cx=x0+BW/2,cy=-R*.1,topZ=-R*.2,T=R*.07,floor=tableZ;
 bench.box={x0:x0-R*.05,x1:x0+BW+R*.05,y0:cy-BD/2-R*.05,y1:cy+BD/2+R*.05};
 const wood=look.lacquer(0xb08f80,{rough:.45,grainMM:240,coat:.6}),iron=new THREE.MeshStandardMaterial({color:0x2a2c2e,metalness:.55,roughness:.42}),brass=look.brass(),nickel=look.nickel(),felt=look.felt(0x2b2b2b);
 const add=(o,name='')=>{o.name=o.name||name;g.add(o);return o;};
 const top=slab(BW,BD,T,T*.3,wood,4);top.position.set(cx,cy,topZ-T);add(top,'bench-top');
 for(const sx of [-1,1])for(const sy of [-1,1]){const leg=new THREE.Mesh(new THREE.BoxGeometry(R*.09,R*.09,topZ-T-floor),wood);leg.position.set(cx+sx*(BW/2-R*.12),cy+sy*(BD/2-R*.12),(floor+topZ-T)/2);add(leg,'bench-leg');}
 const apron=new THREE.Mesh(new THREE.BoxGeometry(BW-R*.24,R*.03,R*.16),wood);apron.position.set(cx,cy-BD/2+R*.12,topZ-T-R*.08);add(apron,'bench-apron');
 // lathe: cast-iron bed, nickel platter, the blank, a rail along the front with the cutting carriage
 const lx=x0+R*2.05,ly=cy+R*.05,baseTop=topZ+R*.14;bench.center.set(lx,ly,0);
 const bed=slab(R*2.5,R*2.1,R*.14,R*.03,iron,3);bed.position.set(lx,ly,topZ);add(bed,'lathe-bed');
 const rim=new THREE.Mesh(new THREE.CylinderGeometry(R*1.02,R*1.02,R*.05,96),nickel);rim.rotation.x=Math.PI/2;rim.position.set(lx,ly,baseTop+R*.025);add(rim,'lathe-platter');
 const mat=new THREE.Mesh(new THREE.CylinderGeometry(R,R,.6,96),felt);mat.rotation.x=Math.PI/2;mat.position.set(lx,ly,baseTop+R*.05+.3);add(mat,'lathe-platter-felt');
 const discZ=baseTop+R*.05+.6;bench.discZ=discZ;
 const blank=new THREE.Group();blank.name='lathe-blank';blank.position.set(lx,ly,discZ);
 const bm=vinylMaterial(null);bench.blankMat=bm;bench.rStart=R-4;bench.rEnd=R*.33;
 const face=new THREE.Mesh(new THREE.RingGeometry(3.6,R,192),bm);face.position.z=2.5;face.name='lathe-blank-face';blank.add(face);
 const edgeR=new THREE.Mesh(new THREE.CylinderGeometry(R,R,2.5,128,1,true),pvcMaterial());edgeR.rotation.x=Math.PI/2;edgeR.position.z=1.25;edgeR.name='lathe-blank-edge';blank.add(edgeR);
 add(blank);bench.blank=blank;setBlankGroove(0);
 const railY=ly-R*1.2,railZ=discZ+R*.2;
 const rail=new THREE.Mesh(new THREE.CylinderGeometry(R*.018,R*.018,R*2.7,16),brass);rail.rotation.z=Math.PI/2;rail.position.set(lx,railY,railZ);add(rail,'lathe-rail');
 for(const sx of [-1,1]){const post=new THREE.Mesh(new THREE.CylinderGeometry(R*.03,R*.04,railZ-baseTop,16),brass);post.rotation.x=Math.PI/2;post.position.set(lx+sx*R*1.3,railY,(railZ+baseTop)/2);add(post,'lathe-post');}
 const car=new THREE.Group();car.name='lathe-carriage';car.position.set(lx+R*1.2,railY,railZ);
 const block=new THREE.Mesh(new THREE.BoxGeometry(R*.16,R*.12,R*.1),iron);car.add(block);
 const arm=new THREE.Mesh(new THREE.BoxGeometry(R*.035,R*1.2,R*.035),nickel);arm.position.set(0,R*.6,R*.02);car.add(arm);
 const head=new THREE.Mesh(new THREE.BoxGeometry(R*.08,R*.1,R*.09),iron);head.position.set(0,R*1.2,-R*.02);car.add(head);
 const stylus=new THREE.Mesh(new THREE.ConeGeometry(R*.008,R*.1,10),nickel);stylus.rotation.x=-Math.PI/2;stylus.position.set(0,R*1.2,-R*.11);car.add(stylus);
 add(car);bench.carriage=car;
 // lathe lamp: brass gooseneck over the platter, its bulb the only part that changes
 const lampX=lx+R*1.05,lampY=ly+R*.85;
 const foot=new THREE.Mesh(new THREE.CylinderGeometry(R*.1,R*.12,R*.04,32),brass);foot.rotation.x=Math.PI/2;foot.position.set(lampX,lampY,baseTop+R*.02);add(foot,'lathe-lamp');
 const neck=new THREE.CatmullRomCurve3([new THREE.Vector3(lampX,lampY,baseTop),new THREE.Vector3(lampX,lampY,baseTop+R*.75),new THREE.Vector3(lampX-R*.25,lampY-R*.2,baseTop+R*1.0),new THREE.Vector3(lampX-R*.5,lampY-R*.4,baseTop+R*.9)]);
 add(new THREE.Mesh(new THREE.TubeGeometry(neck,48,R*.015,8),brass),'lathe-lamp');
 const shade=new THREE.Mesh(new THREE.ConeGeometry(R*.12,R*.14,32,1,true),brass);shade.position.copy(neck.points.at(-1)).add(new THREE.Vector3(0,0,-R*.04));shade.rotation.x=Math.PI;add(shade,'lathe-lamp');
 const bulb=new THREE.Mesh(new THREE.SphereGeometry(R*.05,24,16),new THREE.MeshStandardMaterial({color:0xfff1d6,emissive:0xffc77a,emissiveIntensity:.15,roughness:.4}));bulb.position.copy(shade.position).add(new THREE.Vector3(0,0,-R*.06));add(bulb,'lathe-bulb');bench.bulb=bulb;
 // blank stack (opens the file picker) and the post tray (saves a record)
 const blanks=new THREE.Group();blanks.name='blank-stack';blanks.userData.pick='blanks';blanks.position.set(x0+R*.45,cy-R*.45,topZ);
 for(let i=0;i<6;i++){const d=new THREE.Mesh(new THREE.CylinderGeometry(R*.36,R*.36,2.2,64),pvcMaterial());d.rotation.x=Math.PI/2;d.position.set((i%2)*R*.012,(i%3)*R*.01,1.1+i*2.4);blanks.add(d);}
 const card=new THREE.Mesh(new THREE.CircleGeometry(R*.11,32),new THREE.MeshStandardMaterial({color:0xe7e1d4,roughness:.85}));card.position.z=15;blanks.add(card);
 add(blanks);bench.blanks=blanks;
 const post=new THREE.Group();post.name='post-tray';post.userData.pick='post';post.position.set(x0+R*.45,cy+R*.6,topZ);
 const trayBase=new THREE.Mesh(new THREE.BoxGeometry(R*.64,R*.48,R*.02),wood);trayBase.position.z=R*.01;post.add(trayBase); // inset from the brass walls' outer faces: coplanar faces flicker
 for(const [w,d2,x,y] of [[R*.66,R*.02,0,-R*.24],[R*.66,R*.02,0,R*.24],[R*.02,R*.5,-R*.32,0],[R*.02,R*.5,R*.32,0]]){const wall=new THREE.Mesh(new THREE.BoxGeometry(w,d2,R*.08),brass);wall.position.set(x,y,R*.04);post.add(wall);}
 const word=engrave('POST',R*.4,R*.07,'#3a2a12',true);if(word){word.position.set(0,-R*.262,R*.045);word.material.polygonOffset=true;word.material.polygonOffsetFactor=-2;word.material.polygonOffsetUnits=-2;post.add(word);}
 add(post);bench.post=post;
 g.traverse(o=>{if(o.isMesh){o.castShadow=!o.material?.transparent;o.receiveShadow=true;}});
 const sh=contactDecal(BW+R*.6,BD+R*.6,.6);if(sh){sh.position.set(cx,cy,floor+.5);g.add(sh);}
 bench.group=g;bench.carriage.position.x=lx+R*1.2;return g;
}
// The blank's groove band runs from the outer edge in to the cutting head.
function setBlankGroove(f){
 const u=bench.blankMat?.userData.groove;if(!u)return;
 u.uRStart.value=bench.rStart;u.uPitch.value=.45;u.uLabel.value=bench.rEnd-2;u.uREnd.value=bench.rStart-(bench.rStart-bench.rEnd)*f+(f>0?0:1e-3);
}
window.addEventListener?.('vinyl-lathe',e=>{
 const d=e.detail||{};if(!bench.group)return;
 if(d.state==='cutting'){if(bench.state!=='cutting'){bench.shown=0;bench.blank.visible=true;}bench.target=Math.max(bench.target*(bench.state==='cutting'?1:0),Math.min(1,d.fraction||0));}
 if(d.state==='done'){bench.target=1;scene.updateMatrixWorld(true);const at=bench.blank.getWorldPosition(new THREE.Vector3());
  if(d.shelve)latheToShelf={from:at,known:new Set(sleeveData.map(x=>x.id))}; // the new record is filed in the crate
  else{pendingSwapFrom=at;pendingSwapTilt=0;pendingFromLathe=true;}} // ...or handed straight to the platter
 if(d.state==='failed'||d.state==='idle'){bench.target=0;bench.shown=0;setBlankGroove(0);latheToShelf=null;if(pendingFromLathe){pendingSwapFrom=null;pendingFromLathe=false;}}
 bench.state=d.state||'idle';invalidate(3);
});
function updateLathe(dt){
 if(!bench.group)return false;let busy=false;const k=reduce()?1:1-Math.pow(.02,dt);
 const cutting=bench.state==='cutting',glowTo=bench.state==='ready'||cutting?1:0;
 if(Math.abs(bench.glow-glowTo)>.002){bench.glow+=(glowTo-bench.glow)*k;busy=true;}else bench.glow=glowTo;
 bench.bulb.material.emissiveIntensity=.15+3.2*bench.glow;
 if(cutting||bench.state==='done'){const to=bench.target;if(Math.abs(bench.shown-to)>1e-4){bench.shown+=(to-bench.shown)*Math.min(1,dt*2.2);busy=true;}setBlankGroove(bench.shown);}
 // the head rides over the groove while cutting, parks off the disc otherwise
 const headR=cutting?bench.rStart-(bench.rStart-bench.rEnd)*bench.shown:R*1.22,want=bench.center.x+headR,car=bench.carriage;
 if(Math.abs(car.position.x-want)>.01){car.position.x+=(want-car.position.x)*Math.min(1,k*1.4);busy=true;}
 return busy;
}

let builtFor=0;
function buildPhonograph(R){
 if(builtFor===R)return;builtFor=R;armL=0;builds++;
 disposeTree(phonograph);phonograph.clear();
 const mahogany=look.lacquer(0xffffff,{rough:.4}),panel=look.lacquer(0xe0cfc4,{rough:.36,grainMM:140}),dark=look.lacquer(0x7d6158,{rough:.42,grainMM:120});
 const brass=look.brass(),nickel=look.nickel(),bakelite=look.bakelite(),felt=look.felt();
 const W=R*1.3,D=R*1.3,H=R*.78,top=-4;
 const lid=R*.08,plA=R*.07,plB=R*.06;
 // turntable: nickel rim under a felt mat, spindle with a rounded cap
 const rimT=new THREE.Mesh(new THREE.CylinderGeometry(R*1.018,R*1.018,3.4,128),nickel);rimT.name='platter';rimT.rotation.x=Math.PI/2;rimT.position.z=top+1.7;phonograph.add(rimT);
 const mat=new THREE.Mesh(new THREE.CylinderGeometry(R*1.0,R*1.0,.6,128),felt);mat.name='platter-felt';mat.rotation.x=Math.PI/2;mat.position.z=-.3;phonograph.add(mat);
 const spindle=new THREE.Mesh(new THREE.CylinderGeometry(3.2,3.2,8,32),nickel);spindle.name='spindle';spindle.rotation.x=Math.PI/2;spindle.position.z=5;phonograph.add(spindle);
 const cap=new THREE.Mesh(new THREE.SphereGeometry(3.2,24,12,0,Math.PI*2,0,Math.PI/2),nickel);cap.rotation.x=Math.PI/2;cap.scale.set(1,.55,1);cap.position.z=9;phonograph.add(cap);
 // lid moulding, body, plinth
 const lidM=slab(2*W+R*.1,2*D+R*.1,lid,lid*.4,mahogany,6);lidM.position.z=top-lid;phonograph.add(lidM);
 const lidBead=slab(2*W+R*.02,2*D+R*.02,R*.025,R*.011,dark,4);lidBead.position.z=top-lid-R*.025;phonograph.add(lidBead);
 const bodyTop=top-lid-R*.025,bodyBot=bodyTop-H;
 const body=slab(2*W-R*.08,2*D-R*.08,H,R*.01,mahogany);body.position.z=bodyBot;phonograph.add(body);
 const pf=slab(2*W-R*.5,R*.04,H-R*.22,R*.014,panel,4);pf.position.set(0,-D+R*.04,bodyBot+R*.11);phonograph.add(pf);
 for(const sx of [-1,1]){const ps=slab(R*.04,2*D-R*.5,H-R*.22,R*.014,panel,4);ps.position.set(sx*(W-R*.04),0,bodyBot+R*.11);phonograph.add(ps);}
 const pb=pf.clone();pb.position.y=D-R*.04;phonograph.add(pb);
 for(const sx of [-1,1])for(const sy of [-1,1]){const c=turnedColumn(H,R*.075,dark);c.position.set(sx*(W-R*.045),sy*(D-R*.045),bodyBot);phonograph.add(c);}
 const plinth1=slab(2*W+R*.12,2*D+R*.12,plA,plA*.32,mahogany,5);plinth1.position.z=bodyBot-plA;phonograph.add(plinth1);
 const plinth2=slab(2*W+R*.26,2*D+R*.26,plB,plB*.45,dark,5);plinth2.position.z=bodyBot-plA-plB;phonograph.add(plinth2);
 // a small brass maker's plate on the front panel
 const plate=slab(R*.5,R*.016,R*.12,R*.008,brass,3);plate.rotation.x=Math.PI/2;plate.position.set(0,-D-R*.002,bodyBot+H*.62);phonograph.add(plate);
 const mark=engrave('VINYL SIM',R*.44,R*.09,'#3a2a12',true);if(mark){mark.position.set(0,-D-R*.012,bodyBot+H*.62);phonograph.add(mark);}
 // side crank on the right-hand side, towards the front
 const crank=new THREE.Group();crank.name='crank';crank.position.set(W+R*.02,-D*.38,bodyBot+H*.55);
 const bezel=new THREE.Mesh(new THREE.CylinderGeometry(R*.05,R*.05,R*.02,40),brass);bezel.rotation.z=Math.PI/2;bezel.position.x=R*.01;crank.add(bezel);
 const shaft=new THREE.Mesh(new THREE.CylinderGeometry(R*.014,R*.014,R*.16,20),nickel);shaft.rotation.z=Math.PI/2;shaft.position.x=R*.08;crank.add(shaft);
 const arm=new THREE.Mesh(new THREE.BoxGeometry(R*.025,R*.03,R*.3),nickel);arm.position.set(R*.16,0,-R*.13);crank.add(arm);
 const knob=new THREE.Mesh(new THREE.CylinderGeometry(R*.03,R*.03,R*.13,24),bakelite);knob.rotation.z=Math.PI/2;knob.position.set(R*.23,0,-R*.27);crank.add(knob);
 phonograph.add(crank);
 // horn bracket and pivot post
 const [px,py]=armPivot(R),neck0=new THREE.Vector3(px,py,HINGE_Z+5);
 const post=new THREE.Mesh(new THREE.CylinderGeometry(4.6,5.6,HINGE_Z-top-4.5,32),brass);post.rotation.x=Math.PI/2;post.position.set(px,py,(top+HINGE_Z-4.5)/2);phonograph.add(post);
 const foot=new THREE.Mesh(new THREE.CylinderGeometry(9,10,2.2,40),brass);foot.rotation.x=Math.PI/2;foot.position.set(px,py,top+1.1);phonograph.add(foot);
 const strut=slab(R*.05,R*.03,R*.62,R*.008,brass,3);strut.position.set(px+R*.05,py+R*.2,top);phonograph.add(strut);
 // morning-glory horn: neck rises from the arm pivot, arches back and over, bell opens up-left
 const curve=new THREE.CatmullRomCurve3([
  neck0,new THREE.Vector3(px,py+R*.06,HINGE_Z+5+R*.28),new THREE.Vector3(px-R*.06,py+R*.3,R*.62),
  new THREE.Vector3(px-R*.34,py+R*.5,R*.98),new THREE.Vector3(px-R*.74,py+R*.36,R*1.22),new THREE.Vector3(px-R*1.32,py-R*.18,R*1.38)],false,'centripetal');
 const {geometry,rim}=hornGeometry(curve,5,R*.86);
 const horn=new THREE.Mesh(geometry,brass);horn.name='horn';horn.userData.mouth=curve.points.at(-1).clone();phonograph.add(horn);
 const bead=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim,true),256,R*.012,10,true),brass);phonograph.add(bead);
 const collar=new THREE.Mesh(new THREE.CylinderGeometry(7,7,8,32),brass);collar.rotation.x=Math.PI/2;collar.position.set(px,py,HINGE_Z+6);phonograph.add(collar);
 // joint rings along the neck where the horn sections slot together
 for(const t of [.1,.24]){const p=curve.getPointAt(t),tg=curve.getTangentAt(t),r0=5*Math.pow(R*.86/5,Math.pow(t,1.9));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(r0+.6,1.1,12,48),brass);ring.position.copy(p);ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),tg);phonograph.add(ring);}
 tableZ=bodyBot-plA-plB;cabW=W;cabD=D;room.position.z=tableZ;
 phonograph.add(buildHula(R,top,W,D));
 if(ROOM)phonograph.add(buildBench(R,W,D));
 phonograph.traverse(o=>{if(o.isMesh){o.castShadow=!o.material?.transparent;o.receiveShadow=true;}});
 phonograph.add(buildShibaSpot(R,top,W,D)); // after the traverse: the fur shells set their own shadow flags
 {const sw=buildToySwitch(R,W,D,bodyBot,brass);sw.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=o.material.visible!==false;}});phonograph.add(sw);}
 applyToys();
 const shadow=contactDecal(2*W+R*.95,2*D+R*.95,.8);if(shadow){shadow.position.z=tableZ+.4;phonograph.add(shadow);}
 key.target.position.set(0,0,tableZ*.5);dropRing.scale.setScalar(R*1.05);dropRing.position.z=.4;invalidate();
}
performance.mark?.('vv:room');buildPhonograph(R);performance.mark?.('vv:phono');bakeRoomEnvironment();performance.mark?.('vv:env');
addPlaceholder();snapToDefault();

/* ---------- mounting / swapping records ---------- */
let dropIn=null;
function rescaleCamera(oldR,newR){
 if(oldR===newR)return;const s=newR/oldR,p=(camTween?camTween.p1:camera.position).clone().multiplyScalar(s),t=(camTween?camTween.t1:controls.target).clone().multiplyScalar(s);
 machineClamps();flyTo(p,t,.75);
}
function mountRecord(record){
 version++;const v=version;
 const wasInspecting=inspect.active;finishInspection(true);clearHeightDetail();
 const hadRecord=!!disc.getObjectByName('vinyl-grooves');
 if(hadRecord&&!reduce()){ // the outgoing disc lifts and glides off to the sleeve rack
  const g=new THREE.Group();g.position.copy(disc.position);g.quaternion.copy(disc.quaternion);while(disc.children.length)g.add(disc.children[0]);
  const home=(lastRecordId!=null&&sleeveRest.get(lastRecordId))||sleeveHome(0,1),dest=jacketCenter(home);
  const route=routeTo(dest),q1=home.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2)); // into the sleeve's plane
  g.userData.anim={e:0,dur:1.15,q0:g.quaternion.clone(),route,q1};outgoing.add(g);
 }else clearDisc();
 const oldR=R;R=record.metadata.disc_radius_mm;buildPhonograph(R);if(oldR!==R)buildSleeves();
 if(oldR!==R&&!wasInspecting)rescaleCamera(oldR,R);else if(!inspect.active&&!camTween)machineClamps();
 tonearm.visible=true;armHold=null;buildRecord(record.metadata,record.label,record.cover||null);syncInspectUI();
 // the incoming disc arrives from its sleeve (or from above) and settles on the spindle
 // (it waits in front of the machine, never above it: the horn bell hangs over the platter)
 const extract=pendingExtract;pendingExtract=null;
 const from=extract?extract.clear.clone():(pendingSwapFrom?pendingSwapFrom.clone():new THREE.Vector3(R*.5,-R*2.6,R*.7));
 const tilt=extract?0:(pendingSwapFrom?pendingSwapTilt:0);pendingSwapFrom=null;pendingSwapTilt=0;lastRecordId=record.id??null;
 const lathe=pendingFromLathe;pendingFromLathe=false;
 if(lathe&&bench.blank){bench.blank.visible=false;bench.state='idle';bench.target=0;bench.shown=0;setBlankGroove(0);}
 if(!reduce()){
  if(extract&&!extract.flight)extract.flight=buildIncomingFlight(extract.clear);
  const extractDur=extract?extract.extractDur:0,flightDur=extract?extract.flightDur:0;
  const dur=lathe?1.25:(extract?extractDur+flightDur:.95);
  dropIn={e:0,dur,delay:hadRecord?.35:(lathe?.35:0),from,tilt,lathe,extract,extractDur,flightDur};
  if(lathe){disc.position.copy(from);disc.rotation.x=0;}
  else if(extract){disc.position.copy(extract.inside);disc.quaternion.copy(extract.q);}
  else{inspectPath(1,disc.position,from);disc.rotation.x=tilt;}
 }else{dropIn=null;disc.position.set(0,0,0);disc.rotation.set(0,0,0);}
 invalidate(4);
}
/* Records only ever travel in front of the machine. Outgoing: lift off the spindle,
   slide out low under the arm and horn (the inspection route) to a point in front,
   then sweep left along the front into its sleeve. Incoming: the reverse of the
   inspection route from wherever it waits in front. */
const cubic=(out,a,b,c,d,w)=>{const v=1-w;return out.set(0,0,0).addScaledVector(a,v*v*v).addScaledVector(b,3*v*v*w).addScaledVector(c,3*v*w*w).addScaledVector(d,w*w*w);};
const FRONT=()=>new THREE.Vector3(-R*.1,-R*2.55,R*.75);
// From the point in front of the machine to a sleeve anywhere in the room: round the
// front corner when it lies beside or behind the cabinet, then down into it.
function routeTo(dest){
 const pts=[FRONT()];
 if(dest.y>-(cabD+R*1.1)){const sx=(dest.x<0?-1:1)*(cabW+R*1.2);pts.push(new THREE.Vector3(sx,-R*2.5,R*.95),new THREE.Vector3(sx,Math.min(dest.y,R*.6),R*.95));}
 pts.push(new THREE.Vector3(dest.x,dest.y,Math.max(dest.z+R*1.15,tableZ+R*.9)),dest);
 return new THREE.CatmullRomCurve3(pts,false,'centripetal');
}
/* Clear → around the cabinet (reverse of routeTo) → under the horn (inspectPath) → spindle. */
function buildIncomingFlight(clear){
 const toFront=routeTo(clear).getPoints(14).reverse(); // clear … FRONT
 const pts=toFront.map(p=>p.clone());
 const front=FRONT(),tmp=new THREE.Vector3();
 for(let i=9;i>=0;i--){inspectPath(i/10,tmp,front);pts.push(tmp.clone());}
 return new THREE.CatmullRomCurve3(pts,false,'centripetal');
}
function outgoingPath(u,out,route){
 if(u<=.5)return inspectPath(u/.5,out,FRONT());
 return out.copy(route.getPointAt((u-.5)/.5));
}
function updateSwap(dt){
 let busy=false;
 for(const g of [...outgoing.children]){const a=g.userData.anim;a.e+=dt;const t=Math.min(1,a.e/a.dur),k=easeInOut(t);
  if(a.direct)g.position.copy(a.route.getPointAt(k));else outgoingPath(k,g.position,a.route);g.quaternion.slerpQuaternions(a.q0,a.q1,smooth(.5,.9,k));
  g.scale.setScalar(1-.04*smooth(.85,1,k));g.visible=k<.995; // slips into the sleeve
  if(t>=1){outgoing.remove(g);disposeTree(g);if(a.direct&&bench.blank)bench.blank.visible=true;}busy=true;}
 if(dropIn&&!inspect.active){const d=dropIn;
  // Sub-step so a slow frame cannot skip across the extract→flight join and teleport.
  let left=dt;while(left>0){const step=Math.min(left,1/30);left-=step;d.e+=step;
   if(d.e<=d.delay){if(d.extract){disc.position.copy(d.extract.inside);disc.quaternion.copy(d.extract.q);}continue;}
   const te=d.e-d.delay;
   if(d.lathe){const t=Math.max(0,Math.min(1,te/d.dur)),k=easeInOut(t);const up=d.from.clone();up.z+=R*.55;
    if(k<.22)disc.position.copy(d.from).setZ(d.from.z+R*.55*smooth(0,1,k/.22));else inspectPath(1-(k-.22)/.78,disc.position,up);
    if(t>=1){disc.position.set(0,0,0);disc.rotation.set(0,0,0);disc.quaternion.identity();dropIn=null;if(bench.blank)bench.blank.visible=true;break;}
   }else if(d.extract){ // slide out of the sleeve (~1.25 s), then a gentle arc onto the platter (~1.55 s)
    const ed=d.extractDur||1.25,fd=d.flightDur||1.55,flat=new THREE.Quaternion();
    if(te<ed){const u=easeInOut(te/ed);disc.position.lerpVectors(d.extract.inside,d.extract.clear,u);disc.quaternion.copy(d.extract.q);}
    else{const u=easeInOut(Math.min(1,(te-ed)/fd));
     if(d.extract.flight)d.extract.flight.getPoint(u,disc.position);else inspectPath(1-u,disc.position,d.extract.clear);
     keepDiscAwayFromCamera(disc.position);
     disc.quaternion.slerpQuaternions(d.extract.q,flat,smooth(0,.5,u));}
    if(te>=ed+fd){disc.position.set(0,0,0);disc.rotation.set(0,0,0);disc.quaternion.identity();dropIn=null;break;}
   }else{const t=Math.max(0,Math.min(1,te/d.dur)),k=easeInOut(t);
    inspectPath(1-k,disc.position,d.from);disc.rotation.x=d.tilt*(1-smooth(0,.45,k));
    if(t>=1){disc.position.set(0,0,0);disc.rotation.set(0,0,0);disc.quaternion.identity();dropIn=null;break;}
   }
  }busy=true;}
 return busy;
}
window.addEventListener('vinyl-record',e=>mountRecord(e.detail));

/* ---------- pointer handling ---------- */
function setRay(event){const b=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-b.left)/b.width*2-1,-(event.clientY-b.top)/b.height*2+1);ray.setFromCamera(pointer,camera);}
function hitPlane(event,z){setRay(event);const p=new THREE.Vector3();return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-z),p)?p:null;}
function hit(event){return hitPlane(event,window.vinyl.record?.metadata.thickness_mm||2.5);}
function pickIn(objects){if(!objects.length)return null;const h=ray.intersectObjects(objects,true).find(i=>i.object.visible!==false);if(!h)return null;let o=h.object;while(o&&!o.userData?.pick)o=o.parent;return o?{obj:o,kind:o.userData.pick,point:h.point}:{obj:h.object,kind:null,point:h.point};}
let armHold=null;
function pickAt(e){
 const v=window.vinyl;setRay(e);
 if(v.record&&tonearm.visible){const a=ray.intersectObjects(armParts,false)[0];if(a)return {kind:'arm'};}
 {const sw=phonograph.getObjectByName('toy-switch');if(sw&&ray.intersectObject(sw,true).length)return {kind:'toy-switch'};}
 const sl=pickIn(sleeves.children.filter(o=>o.userData.pick==='sleeve'));
 if(sl&&sl.kind==='sleeve')return sl;
 if(bench.group){const b=pickIn([bench.blanks,bench.post].filter(Boolean));if(b&&(b.kind==='blanks'||b.kind==='post'))return b;}
 return null;
}
renderer.domElement.addEventListener('pointerdown',e=>{
 invalidate();if(e.button!==0)return;const v=window.vinyl;
 if(inspect.active){
  if(inspect.phase!=='held')return;setRay(e);
  if(ray.intersectObject(disc,true).length){inspect.drag={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture?.(e.pointerId);}
  else{const p=hitPlane(e,0);if(p&&Math.hypot(p.x,p.y)<R*1.05)returnRecord();}
  return;
 }
 const p0=pickAt(e);
 if(p0){
  renderer.domElement.setPointerCapture?.(e.pointerId);
  if(p0.kind==='toy-switch'){swapToy();return;}
  if(p0.kind==='blanks'){window.dispatchEvent?.(new CustomEvent('vinyl-open'));return;}
  if(p0.kind==='post'){window.dispatchEvent?.(new CustomEvent('vinyl-save',{detail:{id:null}}));return;}
  if(p0.kind==='arm'){const up=!v.down||v.state.grabbed;armHold={x:e.clientX,y:e.clientY,start:up?1:0,value:up?1:0,moved:false};return;}
  if(p0.kind==='sleeve'){const j=p0.obj;j.userData.loadCover?.();if(hoverId&&hoverId!==j.userData.sleeveId){hoverId=null;}
   sleeveDrag={jacket:j,id:j.userData.sleeveId,empty:!!j.userData.empty,pose:{p:j.position.clone(),q:j.quaternion.clone()},armed:false,x0:e.clientX,y0:e.clientY,moved:false,c:null,rack:false,post:false};
   setCursor('grabbing');return;}
 }
 if(shiba?.pickMesh&&toyChoice==='shiba'&&!sleevePop&&ray.intersectObject(shiba.pickMesh,false).length){const s=Math.random()<.5?-1:1;shiba.poke(.4,1.6,1.2*s);invalidate();return;} // a pat on the dog
 // Clicked empty space: tuck any half-out record back into its sleeve.
 if(sleevePop){clearSleevePop();setCursor('');}
 if(!v.record||dropIn)return;const p=hit(e);if(!p||Math.hypot(p.x,p.y)>R+1)return;if(!v.down){beginInspection();return;}drag=true;renderer.domElement.setPointerCapture?.(e.pointerId);v.grabStart(p.x,p.y);
});
/* Click-to-pop sleeves: jackets stay in the crate. Hover raises a sleeve; a click slides
   its record half out and holds it; a second click on it sends it to the platter (a drag
   onto the platter still works too). Esc or a click elsewhere tucks it back. Geometry
   never leaves the crate rails. */
function hint(text){if(typeof CustomEvent==='function')window.dispatchEvent?.(new CustomEvent('vinyl-hint',{detail:{text}}));}
function setCursor(c){if(renderer.domElement.style)renderer.domElement.style.cursor=c;}
const ROOM_X=1080,ROOM_Y0=-1080,ROOM_Y1=420;
function moveSleeve(e){
 const s=sleeveDrag;if(!s.moved&&Math.hypot(e.clientX-s.x0,e.clientY-s.y0)<6)return;s.moved=true;
 const top=hitPlane(e,LID_Z),over=!!top&&Math.abs(top.x)<cabW+R*.12&&Math.abs(top.y)<cabD+R*.12;
 const wasArmed=s.armed;s.armed=over&&!s.empty;
 // Jacket pose stays at home; only arming / peek changes.
 const home=s.jacket.userData.home;s.pose=home?{p:home.p.clone(),q:home.q.clone()}:presentPose();
 s.c=null;s.rack=false;s.post=false;
 if(s.armed!==wasArmed)hint(s.armed?'Let go — it will slide out of its sleeve onto the platter.':(sleevePop?'Click it to play · Esc to put it back':''));
 setCursor(s.armed?'copy':(sleevePop?'grab':'grabbing'));invalidate();
}
renderer.domElement.addEventListener('pointermove',e=>{
 const v=window.vinyl;
 if(!sleeveDrag&&!armHold&&!drag&&!inspect.active&&e.buttons===0){const p=pickAt(e);setCursor(p?'grab':'');
  const j=p?.kind==='sleeve'&&p.obj.userData.racked?p.obj:null,id=j?j.userData.sleeveId:null;
  if(id!==hoverId){hoverId=id;if(j){j.userData.loadCover?.();hint(j.userData.empty?`${j.userData.label||'Record'}: its sleeve (playing now)`:`${j.userData.label||'Record'} — click to slide it half out, click again to play it`);}else if(!sleevePop)hint('');invalidate(2);}}
 if(inspect.active){if(inspect.drag&&inspect.phase==='held'){
  const dx=e.clientX-inspect.drag.x,dy=e.clientY-inspect.drag.y;inspect.drag={x:e.clientX,y:e.clientY};
  const right=new THREE.Vector3(1,0,0).transformDirection(camera.matrixWorld),up=new THREE.Vector3(0,1,0).transformDirection(camera.matrixWorld);
  disc.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up,dx*.008)).premultiply(new THREE.Quaternion().setFromAxisAngle(right,dy*.008));invalidate();
 }return;}
 if(armHold){const dy=e.clientY-armHold.y;if(Math.abs(dy)>4||Math.abs(e.clientX-armHold.x)>4)armHold.moved=true;armHold.value=Math.max(0,Math.min(1,armHold.start-dy/90));
  if(armHold.moved){if(armHold.value>.6&&v.down&&!v.state.grabbed)v.lift();else if(armHold.value<.15&&!v.down)v.drop()?.catch?.(()=>{});}
  invalidate();return;}
 if(sleeveDrag){moveSleeve(e);return;}
 if(!drag)return;const p=hit(e);if(p)v.grabMove(p.x,p.y);
});
const POP_HINT=j=>`${j.userData.label||'Record'} — half out · click it again to play · Esc or click elsewhere to put it back`;
// Send a crate record to the platter: it slides out of its sleeve (which stays in the crate)
// and onto the spindle, the record that was playing going back to its own sleeve. Once only:
// ignored while a swap is already under way.
function sendSleeve(j,id){
 const v=window.vinyl;if(!v.swapTo||dropIn||outgoing.children.length)return false;
 scene.updateMatrixWorld(true);armSwapFromSleeve(j);
 if(j.userData.peekObj){j.userData.peek=0;j.userData.peekObj.visible=false;}
 sleevePop=null;sleeveRest.delete(id);hint('');
 if(!v.swapTo(id)){pendingSwapFrom=null;pendingSwapTilt=0;pendingExtract=null;return false;}
 return true;
}
function endPointer(e,cancel=false){
 if(inspect.active){inspect.drag=null;return true;}
 const v=window.vinyl;
 if(armHold){const h=armHold;armHold=null;
  if(!cancel){if(!h.moved){if(v.down&&!v.state.grabbed)v.lift();else v.drop()?.catch?.(()=>{});}
   else if(h.value>.5&&v.down&&!v.state.grabbed)v.lift();else if(h.value<=.5&&!v.down)v.drop()?.catch?.(()=>{});}
  invalidate();return true;}
 if(sleeveDrag){const s=sleeveDrag;sleeveDrag=null;
  setCursor('');
  if(cancel){clearSleevePop();invalidate();return true;}
  const j=s.jacket;
  if(!s.moved){
   // Click: toggle half-out hold. Empty sleeves (playing now) just show a hint.
   if(s.empty){hint(`${j.userData.label||'Record'}: its sleeve (playing now)`);invalidate();return true;}
   // Second click on the half-out record (or its sleeve) plays it: the same slide-out-and-swap
   // a drag onto the platter does. Until the pop is visibly out, a stray extra click is ignored.
   if(sleevePop?.id===s.id){if((j.userData.peek||0)>=.35)sendSleeve(j,s.id);invalidate(2);return true;}
   sleevePop={id:s.id,jacket:j};j.userData.loadCover?.();hint(POP_HINT(j));
   invalidate(2);return true;
  }
  if(s.armed&&!s.empty&&v.swapTo){
   // Dragged onto the platter: slide out of the crate sleeve onto the spindle.
   sendSleeve(j,s.id);
  }else{
   // Dragged off the platter: keep a prior half-out hold, otherwise tuck back.
   if(sleevePop?.id===s.id)hint(POP_HINT(j));
   else{clearSleevePop();hint('');}
  }
  invalidate();return true;}
 return false;
}
renderer.domElement.addEventListener('pointerup',e=>{if(e.button!==0)return;if(endPointer(e))return;if(drag){drag=false;window.vinyl.grabEnd();}});
renderer.domElement.addEventListener('dblclick',e=>{if(e.button!==0||!window.vinyl.record)return;setRay(e);if(ray.intersectObject(disc,true).length){if(inspect.active){if(inspect.phase==='held')returnRecord();}else beginInspection();}});
renderer.domElement.addEventListener('pointercancel',e=>{if(endPointer(e,true))return;if(drag){drag=false;window.vinyl.grabEnd();}});
// Narrow (portrait) views widen the lens instead of moving the viewer, so the whole machine stays in frame.
const BASE_FOV=38,BASE_ASPECT=1.25;
function resize(){const w=view.clientWidth,h=view.clientHeight;camera.aspect=w/Math.max(1,h);
 camera.fov=camera.aspect>=BASE_ASPECT?BASE_FOV:Math.min(62,2*Math.atan(Math.tan(BASE_FOV*Math.PI/360)*BASE_ASPECT/camera.aspect)*180/Math.PI);
 camera.updateProjectionMatrix();post.resize(w,h);invalidate();} // passes read the updated projection
new ResizeObserver(resize).observe(view);resize();
function loudness(v,t){
 if(!v.down||v.state.grabbed)return 0;const b=v.buffer||v.grooveBuffer;if(!b)return 0;
 const ch=b.getChannelData(0),sr=b.sampleRate,c=Math.floor(t*sr),n=Math.floor(sr*.035);let s=0,k=0;
 for(let i=Math.max(0,c-n),e=Math.min(ch.length,c+n);i<e;i+=4){s+=ch[i]*ch[i];k++;}
 return k?Math.sqrt(s/k):0;
}
const audioPosition=new THREE.Vector3(),audioForward=new THREE.Vector3(),audioUp=new THREE.Vector3(),audioMouth=new THREE.Vector3(),audioReset=new THREE.Vector3();
function updateAudioListener(){
 const horn=phonograph.getObjectByName('horn');if(!horn||!window.vinyl.setListener)return;
 horn.localToWorld(audioMouth.copy(horn.userData.mouth));
 camera.getWorldPosition(audioPosition);camera.getWorldDirection(audioForward);
 audioUp.set(0,1,0).transformDirection(camera.matrixWorld);
 audioReset.copy(defaultPose().pos);
 window.vinyl.setListener(audioPosition,audioForward,audioUp,audioMouth,audioReset.distanceTo(audioMouth));
}
/* ---------- quality control (Auto / High / Balanced / Low) ---------- */
const qualitySelect=document.getElementById('quality');
function syncQualityUI(s=post.state()){if(!qualitySelect)return;qualitySelect.value=s.mode;qualitySelect.title=`Rendering: ${s.tier}${s.mode==='auto'?' (auto)':''}`;const out=document.getElementById('qualityTier');if(out)out.textContent=s.mode==='auto'?s.tier:'';}
qualitySelect?.addEventListener('change',()=>post.setMode(qualitySelect.value));syncQualityUI();
// Screen positions of things, for automated checks (and handy in the console).
function toClient(v){const b=renderer.domElement.getBoundingClientRect(),n=v.clone().project(camera);return {x:b.left+(n.x+1)/2*b.width,y:b.top+(1-n.y)/2*b.height};}
window.vinylView={get toy(){return toyChoice;},toClient:(x,y,z)=>toClient(new THREE.Vector3(x,y,z)),sleevePoints:()=>sleeves.children.filter(j=>j.userData.sleeveId!=null).map(j=>({id:j.userData.sleeveId,empty:!!j.userData.empty,...toClient(jacketCenter({p:j.position,q:j.quaternion}))})),get R(){return R;},get tableZ(){return tableZ;},invalidate,setQuality:m=>post.setMode(m),get quality(){return post.state();},get hoverId(){return hoverId;},get sleevePop(){return sleevePop?{id:sleevePop.id}:null;},get lathe(){return bench?{state:bench.state,shown:bench.shown,target:bench.target}:null;},get info(){const i=renderer.info;return {calls:i.render.calls,triangles:i.render.triangles,geometries:i.memory.geometries,textures:i.memory.textures,programs:i.programs?.length};},keepInRoom,keepBelowCeiling,armSwapFromSleeve,captureExtract,keepDiscAwayFromCamera,roomBounds,presentPose,clearSleevePop};
document.addEventListener?.('visibilitychange',()=>invalidate(2));

// The demo may finish loading while Three.js/room modules are still downloading.
if(window.vinyl.record)mountRecord(window.vinyl.record);
sleeveData=window.vinyl.sleeves?.()||sleeveData;currentSleeve=window.vinyl.currentSleeve?.()||null;buildSleeves();syncInspectUI();
let lastFrame=performance.now(),lastSig=NaN,firstDrawn=false,shadowSig=NaN,shadowAt=-1e9,shadowPending=false;
/* Only shadow casters that move count; the disc's spin does not (its shadow is a
   circle). The arm's audio wobble is quantised away; updates are capped at 30 Hz. */
function shadowSignature(){
 let s=Math.round(armRig.rotation.z*600)*1.7+Math.round(armTilt.rotation.y*600)*2.3+(tonearm.visible?5:0)+builds*101+
  Math.round((hula.ax+hula.ay*1.3+hula.bz*1.7)*400)*.7+(shiba?Math.round((shiba.wob.x+shiba.wob.y*1.3+shiba.wob.z*1.7)*400)*.9+(shiba.loaded?3:0):0)+toyAnim.t*29+(toyChoice==='hula'?11:0)+disc.position.x*.31+disc.position.y*.37+disc.position.z*.41+disc.quaternion.x*53+disc.quaternion.y*59+outgoing.children.length*7;
 for(const j of sleeves.children)s+=j.position.x*.011+j.position.y*.013+j.position.z*.017+sleeves.children.length;
 for(const g of outgoing.children)s+=g.position.x*.019+g.position.z*.023;
 return s;
}
function updateShadows(now){
 const sig=shadowSignature();
 if(!(Math.abs(sig-shadowSig)<=1e-6))shadowPending=true; // written so the first NaN compare counts as a change: otherwise the shadow map froze after its first render
 if(shadowPending&&now-shadowAt>33){renderer.shadowMap.needsUpdate=true;shadowSig=sig;shadowAt=now;shadowPending=false;}
 else if(shadowPending)invalidate(1);
}
const focusPoint=new THREE.Vector3(); // the near half of the record
function signature(){
 const c=camera.position,t=controls.target,q=disc.quaternion,p=disc.position;
 return c.x*1.31+c.y*1.73+c.z*2.11+t.x*.37+t.y*.53+t.z*.71+disc.rotation.z*997+p.x*3.1+p.y*3.7+p.z*4.3+q.x*41+q.y*43+
  armRig.rotation.z*503+armTilt.rotation.y*709+hula.ax*301+hula.ay*307+hula.bz*311+(shiba?shiba.wob.x*313+shiba.wob.y*317+shiba.wob.z*331+(shiba.loaded?17:0):0)+toyAnim.t*337+toyAnim.press*347+(toyChoice==='hula'?19:0)+(tonearm.visible?1:0)+outgoing.children.length*13;
}
function tickScene(dt, nowMs){
 const v=window.vinyl,r=v&&v.record;let energy=0,music=null;
 frameDt=dt;
 if(r){const m=r.metadata,t=v.time(),th=2*Math.PI*(m.lead_in_turns+t*m.rpm_cut/60);if(!v.state.grabbed)v.state.rotation=v.state.angle+th;if(v.state.grabbed)v.grabTick();if(!inspect.active&&!dropIn)disc.rotation.z=v.state.rotation;
  let d=0;const displacement=v.grooveBuffer||v.buffer;if(displacement){const samples=displacement.getChannelData(0);d=samples[Math.min(samples.length-1,Math.floor(t*displacement.sampleRate))]||0;}
  const rad=m.r_start_mm-m.pitch_mm*th/(2*Math.PI)+m.amp_mm*d;
  const moving=inspect.active||dropIn||outgoing.children.length;
  const tipZ=armHold?m.thickness_mm-.25+armHold.value*13.25:m.thickness_mm+(moving?24:v.down?-.25:13);
  placeTonearm(rad*Math.cos(v.state.angle),rad*Math.sin(v.state.angle),tipZ,v.down);
  energy=loudness(v,t);music=shibaMusic(v,t);
 }else tonearm.visible=false;
 updateHula(energy);
 const shibaMoving=updateShiba(music);
 const why=[];
 if(shibaMoving)why.push('shiba');
 if(updateToys(dt))why.push('toy');
 if(updateSleeves(dt))why.push('sleeves');if(updateLathe(dt))why.push('lathe');if(updateInspection(dt))why.push('inspect');if(updateSwap(dt))why.push('swap');
 if(updateCamTween(dt)){zoom.goal=null;zoom.vel=0;why.push('flight');}else{const z=applyZoom(dt);if(controls.update()||z)why.push('controls');}
 if(keepInRoom())why.push('room');
 if(shiba?.detail(camera,renderer.domElement.clientHeight||view.clientHeight))why.push('shiba-detail');
 updateAudioListener();
 const sig=signature();if(!(Math.abs(sig-lastSig)<1e-7)){if(!why.length)why.push('moved:'+(sig-lastSig).toExponential(1));lastSig=sig;}
 let busy=why.length>0;window.vinylView.lastDraw=why.join(',')||(dirty>0?'dirty':'');
 return {busy, why, nowMs};
}
function drawFrame(nowMs){
 updateShadows(nowMs);
 post.focus?.(inspect.active?camera.position.distanceTo(disc.position):camera.position.distanceTo(focusPoint.set(R*.15,0,4)));
 post.render(nowMs);if(dirty>0)dirty--;
 if(!firstDrawn){firstDrawn=true;performance.mark?.('vv:first');renderer.domElement.setAttribute?.('data-ready','');
  shiba?.load().then(ok=>{if(ok){renderer.shadowMap.needsUpdate=true;shadowPending=true;performance.mark?.('vv:shiba');}invalidate(3);});}
}
function frame(){
 requestAnimationFrame(frame);
 const now=performance.now(),raw=Math.max(.001,(now-lastFrame)/1000),dt=Math.min(.25,raw);lastFrame=now;
 const {busy}=tickScene(dt, now);
 if(busy||dirty>0||drag||armHold||sleeveDrag)drawFrame(now);else post.idle();
}
Object.assign(window.vinylView,{
 get camera(){return camera}, get controls(){return controls}, get disc(){return disc},
 get inspect(){return inspect}, get dropIn(){return dropIn}, get outgoing(){return outgoing},
 get sleevesGroup(){return sleeves}, get THREE(){return THREE}, get shiba(){return shiba},
 swapToy, get phonograph(){return phonograph},
 setPendingSwap(from,tilt=0){pendingSwapFrom=from?from.clone():null;pendingSwapTilt=tilt;pendingExtract=null;},
 beginInspection, returnRecord, finishInspection, flyTo, snapToDefault, defaultPose, presentPose,
 keepBelowCeiling, keepInRoom, armSwapFromSleeve, captureExtract, keepDiscAwayFromCamera, roomBounds,
 jacketWorld(id){const j=sleeves.children.find(o=>o.userData.sleeveId===id);if(!j)return null;scene.updateMatrixWorld(true);const peek=j.userData.peekObj;return peek?peek.getWorldPosition(new THREE.Vector3()):jacketCenter(j.userData.home||sleeveHome(0,1));},
 presentFrom(){const p=presentPose();return jacketCenter(p);},
});
// Compile every shader before the first frame, off the main thread where the GPU
// driver allows (KHR_parallel_shader_compile), instead of stalling the first draw.
if(typeof renderer.compileAsync==='function'){
 let started=false;const go=()=>{if(!started){started=true;frame();}};
 renderer.compileAsync(scene,camera).then(go,go);setTimeout(go,4000);
}else frame();
