import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildParlor} from './room.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const view=document.getElementById('view');
const scene=new THREE.Scene();scene.background=new THREE.Color('#141310'); // piano-black well
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));view.replaceChildren(renderer.domElement);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const camera=new THREE.PerspectiveCamera(42,1,.1,4500);camera.position.set(0,-220,300);camera.lookAt(0,0,0);
camera.up.set(0,0,1);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,2.5);controls.enableDamping=true;controls.enablePan=false;controls.maxPolarAngle=Math.PI*.47;controls.touches={ONE:null,TWO:THREE.TOUCH.DOLLY_ROTATE};controls.mouseButtons={LEFT:null,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};
/* Fixed-ish view: orbit only round the front of the machine, a little zoom, no pan. */
const inspect={active:false,phase:'idle',elapsed:0,drag:null};
const ORBIT_SWING=1.2;controls.minPolarAngle=Math.PI*.2;
function resetView(){if(inspect.active){returnRecord();return;}camera.up.set(0,0,1);controls.enablePan=false;controls.zoomToCursor=false;controls.minPolarAngle=Math.PI*.2;controls.maxPolarAngle=Math.PI*.47;const damping=controls.enableDamping;controls.enableDamping=false;controls.minAzimuthAngle=-Infinity;controls.maxAzimuthAngle=Infinity;controls.minDistance=0;controls.maxDistance=Infinity;controls.update();
 camera.position.set(R*1.02,-R*6.0,R*2.35);controls.target.set(-R*.4,R*.25,R*.42);controls.update(); // same distance/angle as before, framed a touch left to include the sleeve rack
 const az=controls.getAzimuthalAngle();controls.minAzimuthAngle=az-ORBIT_SWING;controls.maxAzimuthAngle=az+ORBIT_SWING;
 controls.minDistance=R*3.5;controls.maxDistance=R*7.5;controls.update();controls.enableDamping=damping;}
document.getElementById('resetView').addEventListener('click',resetView);
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
scene.add(new THREE.HemisphereLight(0xe2ecff,0x403026,1.05));
const key=new THREE.DirectionalLight(0xffefda,2.6);key.name='window-key';key.position.set(-360,500,570);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-480,right:480,top:480,bottom:-480,near:10,far:1800});key.shadow.bias=-.00025;key.shadow.normalBias=.35;key.shadow.camera.updateProjectionMatrix();scene.add(key);
const frontFill=new THREE.DirectionalLight(0xffdcb0,.65);frontFill.position.set(-180,-320,240);scene.add(frontFill);
const rake=new THREE.DirectionalLight(0xfff2d8,.8);rake.position.set(260,30,28);scene.add(rake);
// groove light: a low warm graze from behind-left; its specular glances off the bumped groove walls toward the front camera
const graze=new THREE.DirectionalLight(0xffe2b0,1.1);graze.name='groove-graze';graze.position.set(-140,300,26);scene.add(graze);
const grazeFront=new THREE.DirectionalLight(0xd8e4ff,.4);grazeFront.name='groove-rim';grazeFront.position.set(-260,-120,20);scene.add(grazeFront);
const inspectRake=new THREE.DirectionalLight(0xdbe9ff,1.6);inspectRake.name='inspect-rake';inspectRake.visible=false;scene.add(inspectRake,inspectRake.target);
const inspectSoft=new THREE.DirectionalLight(0xfff2da,1.8);inspectSoft.name='inspect-softbox';inspectSoft.visible=false;scene.add(inspectSoft,inspectSoft.target);
const disc=new THREE.Group();scene.add(disc);
function metal(color,metalness=.7,roughness=.32){return new THREE.MeshStandardMaterial({color,metalness,roughness});}
const tonearm=new THREE.Group();tonearm.visible=false;scene.add(tonearm);
/* Phonograph reproducer arm: a rigid lever of constant length on a fixed pivot
   at the back-right of the cabinet. It never scales or stretches. To follow the
   groove it yaws (sweeps) about the pivot so the needle lies on the circle of
   the current groove radius, and it tilts on a small hinge to lift/drop.
   frame() and the playback model are unchanged: the disc still turns under a
   needle at state.angle; the arm tip sits on the same groove turn a little
   further round the circle (radius corrected by pitch so it stays in-groove). */
const HINGE_Z=24;                       // hinge height above the platter (mm)
const armRig=new THREE.Group();          // at the pivot; yaws about z
const armTilt=new THREE.Group();         // hinge; tilts about local y
armRig.add(armTilt);tonearm.add(armRig);
let armL=0,armHz=0,armBeta=0,armPivotX=0,armPivotY=0;
const armParts=[];
function armPivot(R){return [R*1.12,R*.45];}
function armLength(R){const [x,y]=armPivot(R);return Math.hypot(x,y)-R*.26;} // reaches in to 0.26R
function buildArm(R,thickness){
 for(const o of armParts){armTilt.remove(o);o.geometry.dispose();o.material.dispose();}armParts.length=0;
 [armPivotX,armPivotY]=armPivot(R);armL=armLength(R);armHz=HINGE_Z-(thickness-.25);
 armRig.position.set(armPivotX,armPivotY,HINGE_Z);
 const brassM=metal(0xc4a15a,.72,.28),nickelM=metal(0xb9b6ad,.78,.3);
 if(envMap){brassM.envMap=nickelM.envMap=envMap;}
 const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;armTilt.add(m);armParts.push(m);return m;};
 // hinge knuckle at the pivot
 add(new THREE.CylinderGeometry(4.2,4.2,9,24),brassM,0,0,0,0,0,0);
 // the lever: one fixed-length tapered tube from the hinge to the reproducer neck
 const neckX=armL-2,neckZ=-armHz+14;
 const len=Math.hypot(neckX,neckZ),tilt=Math.atan2(neckZ,neckX);
 const tube=new THREE.CylinderGeometry(1.9,2.6,len,20);tube.rotateZ(-Math.PI/2);tube.translate(len/2,0,0); // along +x from the hinge
 add(tube,brassM,0,0,0,0,-tilt,0);
 // reproducer (soundbox), face across the arm, needle bar and stylus
 add(new THREE.CylinderGeometry(7,7,3.6,40,1,true),nickelM,armL,0,-armHz+10.5,0,0,Math.PI/2);
 add(new THREE.CylinderGeometry(5.6,5.6,3.2,40),metal(0x2a2620,.2,.5),armL,0,-armHz+10.5,0,0,Math.PI/2);
 add(new THREE.BoxGeometry(1.3,1.3,2.6),nickelM,armL,0,-armHz+2.6+1.3);
 add(new THREE.ConeGeometry(.35,2.6,10),metal(0xf0ebe3,.88,.16),armL,0,-armHz+1.3,-Math.PI/2);
}
function wrapPi(d){while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return d;}
function placeTonearm(tipX,tipY,tipZ,down){
 const m=window.vinyl?.record?.metadata;
 if(!armL||(m&&Math.abs(armHz-(HINGE_Z-(m.thickness_mm-.25)))>1e-6))buildArm(R,m?.thickness_mm??2.5);
 const rad=Math.hypot(tipX,tipY),ang=Math.atan2(tipY,tipX),pitch=m?.pitch_mm||0;
 const Dp=Math.hypot(armPivotX,armPivotY),thP=Math.atan2(armPivotY,armPivotX);
 // Needle on the arc: intersect the arm's reach circle with the groove circle.
 let r=rad,phi=ang;
 for(let i=0;i<4;i++){
  const c=Math.max(-1,Math.min(1,(r*r+Dp*Dp-armL*armL)/(2*Math.max(r,1e-3)*Dp)));
  phi=thP+Math.acos(c);
  r=rad+pitch*wrapPi(phi-ang)/(2*Math.PI); // same groove turn at that angle
 }
 const tx=r*Math.cos(phi),ty=r*Math.sin(phi);
 armRig.rotation.z=Math.atan2(ty-armPivotY,tx-armPivotX); // sweep only; length is fixed
 // lift: rotate on the hinge so the needle rises to tipZ
 const want=Math.asin(Math.max(-1,Math.min(1,(tipZ-(m?.thickness_mm??2.5)+.25)/Math.hypot(armL,armHz))));
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
 armBeta=reduce?want:armBeta+(want-armBeta)*.35;
 armTilt.rotation.y=-armBeta;
}
let R=90,drag=false,version=0,bumpTex=null;
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
function clearDisc(){while(disc.children.length){const c=disc.children[0];disc.remove(c);c.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const mat of (Array.isArray(o.material)?o.material:[o.material])){if(mat.map)mat.map.dispose();mat.dispose();}}});}}
function vinylMaterial(texture=null){return new THREE.MeshPhysicalMaterial({color:0x141416,roughness:.34,metalness:.04,clearcoat:.65,clearcoatRoughness:.22,envMapIntensity:.4,vertexColors:false,side:THREE.FrontSide,bumpMap:texture||null,bumpScale:texture?-1.7:0,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});}
function labelPrint(title,m){
 if(typeof document.createElement!=='function')return null;
 try{
  const N=1024,c=document.createElement('canvas');c.width=c.height=N;const g=c.getContext('2d');if(!g)return null;
  g.fillStyle='#c42420';g.fillRect(0,0,N,N);g.strokeStyle='#ddc799';g.lineWidth=2;
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
  // Very long filenames get two concentric title arcs, not one compressed stamp.
  if(name.length>46){let cut=name.lastIndexOf(' ',Math.ceil(name.length/2)+8);if(cut<name.length*.3)cut=Math.ceil(name.length/2);
   arc(name.slice(0,cut).trim(),N*.365,N*.061,2.75);arc(name.slice(cut).trim(),N*.265,N*.052,2.75);
  }else arc(name,N*.34,N*.088,2.65);
  const sec=Math.max(0,Math.floor(m.duration_sec||0)),time=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
  arc(`${Math.abs(m.rpm_cut-100/3)<.05?'33⅓':Math.round(m.rpm_cut*10)/10} RPM  ·  ${Math.round(m.disc_radius_mm*2)} MM  ·  ${time}`,N*.31,N*.038,2.6,true);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities?.getMaxAnisotropy?.()||1;return t;
 }catch{return null;}
}
function addLabel(m,title){
 const holeR=3.6; // ~7.2 mm spindle hole, like a real LP
 const print=labelPrint(title,m);
 const label=new THREE.Mesh(new THREE.RingGeometry(holeR,m.label_radius_mm,128),new THREE.MeshStandardMaterial({color:print?0xffffff:0xc42420,map:print,roughness:.8,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));label.userData.title=title||'Record';
 label.name='vinyl-label';label.position.z=m.thickness_mm+.08;disc.add(label);
}
function buildRecord(m,title){
 const top=new THREE.Mesh(new THREE.RingGeometry(m.label_radius_mm,R,256),vinylMaterial());top.name='vinyl-grooves';top.position.z=m.thickness_mm;disc.add(top);
 const pvc=vinylMaterial();pvc.polygonOffset=false;
 const rim=new THREE.Mesh(new THREE.CylinderGeometry(R,R,m.thickness_mm,256,1,true),pvc);rim.name='vinyl-edge';rim.rotation.x=Math.PI/2;rim.position.z=m.thickness_mm/2;disc.add(rim);
 const back=new THREE.Mesh(new THREE.RingGeometry(3.6,R,256),pvc);back.name='vinyl-underside';back.rotation.x=Math.PI;disc.add(back);
 const hole=new THREE.Mesh(new THREE.CylinderGeometry(3.6,3.6,m.thickness_mm,32,1,true),new THREE.MeshPhysicalMaterial({color:0x141416,roughness:.4,side:THREE.BackSide}));hole.rotation.x=Math.PI/2;hole.position.z=m.thickness_mm/2;hole.name='spindle-hole';disc.add(hole);
 addLabel(m,title);disc.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
}
function enhanceBump(tex){
 const img=tex.image,c=document.createElement('canvas');
 c.width=img.width;c.height=img.height;
 const g=c.getContext('2d');g.drawImage(img,0,0);
 const pix=g.getImageData(0,0,c.width,c.height),d=pix.data;
 let lo=255,hi=0;
 for(let i=0;i<d.length;i+=4){
  const r=d[i],gv=d[i+1],b=d[i+2];
  if(r>140&&r>gv*1.8)continue;
  if(gv>100)continue;
  if(gv<lo)lo=gv;if(gv>hi)hi=gv;
 }
 const span=Math.max(8,hi-lo);
 for(let i=0;i<d.length;i+=4){
  const r=d[i],gv=d[i+1];
  if((r>140&&r>gv*1.8)||gv>100){d[i]=d[i+1]=d[i+2]=128;continue;}
  const y=Math.max(0,Math.min(255,Math.round((gv-lo)/span*255)));
  d[i]=d[i+1]=d[i+2]=y;
 }
 g.putImageData(pix,0,0);
 const out=new THREE.CanvasTexture(c);
 out.colorSpace=THREE.NoColorSpace;
 out.anisotropy=renderer.capabilities.getMaxAnisotropy();
 tex.dispose();
 return out;
}
function loadBump(url,done){
 new THREE.TextureLoader().load(url,tex=>{
  tex.colorSpace=THREE.NoColorSpace;
  done(enhanceBump(tex));
 },undefined,()=>done(null));
}
// Empty platter: a blank black disc with an ivory and brass label. Only shown
// before a record is opened; a loaded record's own label colour is untouched.
function addPlaceholder(){
 const blank=new THREE.Mesh(new THREE.RingGeometry(27,90,256),vinylMaterial(null));blank.position.z=2.5;blank.name='placeholder-disc';
 const card=new THREE.Mesh(new THREE.RingGeometry(3.6,27,96),new THREE.MeshStandardMaterial({color:0xe7e1d4,roughness:.85,metalness:0,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));card.position.z=2.8;
 const rule=new THREE.Mesh(new THREE.RingGeometry(22,23,96),new THREE.MeshStandardMaterial({color:0xc4a15a,roughness:.35,metalness:.6,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));rule.position.z=2.85;
 disc.add(blank,card,rule);
}

/* ---------- External-horn phonograph (presentation only) ----------
   Stylised lacquered mahogany cabinet with turned columns and a moulded plinth,
   brass morning-glory horn from a back-right bracket, side crank, nickel
   platter. Sized from the disc radius R; rebuilt when R changes. */
const phonograph=new THREE.Group();phonograph.name='phonograph';scene.add(phonograph);
const room=buildParlor(THREE);scene.add(room);
let envMap=null;
function bakeRoomEnvironment(){try{const pm=new THREE.PMREMGenerator(renderer),interior=new THREE.Scene();interior.background=new THREE.Color(0x34362f);interior.add(room.clone(true),key.clone(),new THREE.HemisphereLight(0xe2ecff,0x403026,1.05));
 try{envMap=pm.fromScene(interior,.04,.1,4500).texture;}catch{envMap=pm.fromScene(new RoomEnvironment(),.04).texture;}pm.dispose();scene.environment=envMap;}catch{envMap=null;}}
function lacquer(color,rough=.3){const m=new THREE.MeshPhysicalMaterial({color,roughness:rough,metalness:0,clearcoat:1,clearcoatRoughness:.12,envMapIntensity:.3});if(envMap){m.envMap=envMap;m.envMapIntensity=.3;}return m;}
function shiny(color,metalness=.85,roughness=.26,side=THREE.FrontSide){const m=new THREE.MeshStandardMaterial({color,metalness,roughness,side});if(envMap){m.envMap=envMap;m.envMapIntensity=1;}return m;}

function slab(w,d,h,bevel,mat){ // a moulded slab: rounded-edge box, centred, z from 0 to h
 const sh=new THREE.Shape();const x=w/2-bevel,y=d/2-bevel;sh.moveTo(-x,-y);sh.lineTo(x,-y);sh.lineTo(x,y);sh.lineTo(-x,y);sh.closePath();
 const g=new THREE.ExtrudeGeometry(sh,{depth:Math.max(.01,h-2*bevel),bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,curveSegments:4});
 g.translate(0,0,bevel);return new THREE.Mesh(g,mat);
}
function turnedColumn(h,r,mat){ // lathe profile, axis z
 const P=[[0,0],[1,0],[1,.05],[.78,.08],[.78,.12],[.95,.16],[.7,.24],[.55,.3],[.62,.36],[.92,.5],[.62,.64],[.55,.7],[.7,.76],[.95,.84],[.78,.88],[.78,.92],[1,.95],[1,1],[0,1]];
 const g=new THREE.LatheGeometry(P.map(([a,b])=>new THREE.Vector2(a*r,b*h)),28);g.rotateX(Math.PI/2);return new THREE.Mesh(g,mat);
}
function hornGeometry(curve,r0,r1,petals=8,seg=150,radial=128){
 const frames={tangents:[],normals:[],binormals:[]},pos=[],idx=[],rim=[];
 { // rotation-minimising frames (no twist along the neck)
  let n=new THREE.Vector3(0,1,0);
  for(let i=0;i<=seg;i++){const T=curve.getTangentAt(i/seg).normalize();n=n.sub(T.clone().multiplyScalar(n.dot(T))).normalize();frames.tangents.push(T);frames.normals.push(n.clone());frames.binormals.push(new THREE.Vector3().crossVectors(T,n));}
 }
 for(let i=0;i<=seg;i++){
  const t=i/seg,P=curve.getPointAt(t),N=frames.normals[i],B=frames.binormals[i];
  const flare=r0*Math.pow(r1/r0,Math.pow(t,1.9)); // exponential neck opening into a wide bell
  for(let j=0;j<=radial;j++){
   const th=j/radial*Math.PI*2,c=Math.cos(petals*th);
   const petal=1+.07*Math.pow(t,5)*c;                      // scalloped morning-glory panels
   const seam=1+.018*Math.pow(t,1.2)*Math.pow(Math.max(0,-c),60); // raised seam between panels
   const r=flare*petal*seam;
   const lip=0;                    // petal tips lean forward
   const v=new THREE.Vector3().copy(P).addScaledVector(N,Math.cos(th)*r).addScaledVector(B,Math.sin(th)*r).addScaledVector(frames.tangents[i],lip);
   pos.push(v.x,v.y,v.z);if(i===seg&&j<radial)rim.push(v);
  }
 }
 for(let i=0;i<seg;i++)for(let j=0;j<radial;j++){const a=i*(radial+1)+j,b=a+radial+1;idx.push(a,b,a+1,b,b+1,a+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
 return {geometry:g,rim};
}
/* ---------- Spring-mounted dashboard hula girl (presentation only) ----------
   Stylised toy on a felt-and-wood puck glued to the front-left of the lid. A
   damped spring (two sway angles plus a little bounce) is driven by a smoothed
   loudness envelope of the playing audio; needle up => no drive, she settles. */
class Helix extends THREE.Curve{constructor(r,h,turns){super();this.r=r;this.h=h;this.turns=turns;}getPoint(t,o=new THREE.Vector3()){const a=t*this.turns*Math.PI*2;return o.set(this.r*Math.cos(a),this.r*Math.sin(a),t*this.h);}}
function toon(color,rough=.62){return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:0,flatShading:true});}
const hula={group:null,spring:null,dancer:null,hips:null,torso:null,arms:[],springH:0,baseTop:0,ax:0,ay:0,vx:0,vy:0,bz:0,vz:0,env:0,prev:0,phase:0,last:0};
function buildHula(R,top,W,D){
 const s=R/90*1.3,g=new THREE.Group();g.name='hula-girl';g.position.set(-W*.8,-D*.8,top);
 const add=(parent,geo,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);parent.add(m);return m;};
 const skin=toon(0xc8875a,.55),grass=toon(0x6f8f2c,.8),grass2=toon(0x9bb04a,.8),straw=toon(0xd8b25a,.7),lei=toon(0xff5c8a,.6),red=toon(0xc42420,.6),hair=toon(0x1a1210,.5),wood=lacquer(0x7a4a24,.45),felt=toon(0x2d4a30,.95);
 const nickelS=shiny(0xc9c6bd,.9,.25);
 add(g,new THREE.CylinderGeometry(7.2*s,7.2*s,.6*s,28),felt,0,0,.3*s,Math.PI/2);            // felt pad on the lacquer
 add(g,new THREE.CylinderGeometry(6.2*s,6.8*s,2.4*s,28),wood,0,0,.6*s+1.2*s,Math.PI/2);       // wooden puck
 hula.baseTop=3*s;hula.springH=7*s;
 const spring=add(g,new THREE.TubeGeometry(new Helix(2.1*s,hula.springH,6),160,.32*s,6),nickelS,0,0,hula.baseTop);hula.spring=spring;
 const dancer=new THREE.Group();dancer.name='hula-dancer';g.add(dancer);hula.dancer=dancer;
 add(dancer,new THREE.CylinderGeometry(2.6*s,2.6*s,.8*s,20),shiny(0xc9a75e,.85,.3),0,0,.4*s,Math.PI/2); // little brass foot-plate
 const hips=new THREE.Group();hips.position.z=.8*s;dancer.add(hips);hula.hips=hips;
 for(const sx of [-1,1])add(hips,new THREE.CylinderGeometry(.75*s,.9*s,7*s,8),skin,sx*1.05*s,0,3.5*s,Math.PI/2);
 add(hips,new THREE.CylinderGeometry(2.4*s,4.3*s,6.2*s,22,1,true),grass,0,0,4.9*s,Math.PI/2);  // grass skirt
 add(hips,new THREE.CylinderGeometry(2.3*s,3.6*s,4.2*s,11,1,true),grass2,0,0,6*s,Math.PI/2,.15);
 add(hips,new THREE.TorusGeometry(2.35*s,.45*s,6,20),straw,0,0,8*s);                             // waistband
 const torso=new THREE.Group();torso.position.z=8.3*s;hips.add(torso);hula.torso=torso;
 const chest=add(torso,new THREE.SphereGeometry(2.2*s,12,10),skin,0,0,2.4*s);chest.scale.set(1,.78,1.45);
 add(torso,new THREE.CylinderGeometry(2.05*s,2.05*s,1.1*s,14),red,0,0,3.1*s,Math.PI/2);           // top
 add(torso,new THREE.TorusGeometry(2.1*s,.6*s,6,18),lei,0,-.15*s,4.6*s,.25);                       // lei
 add(torso,new THREE.CylinderGeometry(.6*s,.7*s,1.2*s,8),skin,0,0,5.4*s,Math.PI/2);                // neck
 add(torso,new THREE.SphereGeometry(2.15*s,14,12),skin,0,0,7.4*s);                                 // head
 const hairCap=add(torso,new THREE.SphereGeometry(2.3*s,14,12,0,Math.PI*2,0,Math.PI*.6),hair,0,.35*s,7.6*s,Math.PI/2+.35);hairCap.scale.set(1,1,1.05);
 add(torso,new THREE.SphereGeometry(1.1*s,10,8),hair,0,1.9*s,6.2*s);                                // hair falling behind
 add(torso,new THREE.SphereGeometry(.75*s,8,6),toon(0xff8a2a,.6),1.7*s,-.6*s,8.4*s);                // hibiscus
 for(const sx of [-1,1])add(torso,new THREE.SphereGeometry(.28*s,6,5),hair,sx*.75*s,-1.95*s,7.7*s); // eyes
 hula.arms=[];
 for(const sx of [-1,1]){const arm=new THREE.Group();arm.position.set(sx*1.9*s,0,4.1*s);torso.add(arm);
  add(arm,new THREE.CylinderGeometry(.5*s,.55*s,5.6*s,8),skin,sx*2.8*s,0,.7*s,0,0,-sx*(Math.PI/2-.25)); // outstretched, a touch raised
  add(arm,new THREE.SphereGeometry(.65*s,8,6),skin,sx*5.5*s,0,1.45*s);arm.userData.sx=sx;hula.arms.push(arm);}
 hula.group=g;return g;
}
function updateHula(energy){
 if(!hula.group)return;
 const now=typeof performance!=='undefined'?performance.now():Date.now(),dt=Math.min(.05,Math.max(.001,hula.last?(now-hula.last)/1000:1/60));hula.last=now;
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
 // envelope follower: quick attack, slow release
 hula.env+=(energy-hula.env)*Math.min(1,dt*(energy>hula.env?18:3));
 const drive=Math.min(1,hula.env*5),onset=Math.max(0,hula.env-hula.prev);hula.prev=hula.env;
 if(reduce){hula.ax=hula.ay=hula.bz=hula.vx=hula.vy=hula.vz=0;}
 else{
  hula.phase+=dt*Math.PI*2*1.6;
  const kick=onset*40*(Math.sin(hula.phase*3.7)>0?1:-1);
  hula.vx+=(-60*hula.ax-1.8*hula.vx+drive*10*Math.sin(hula.phase))*dt+kick*dt*10;hula.ax+=hula.vx*dt;
  hula.vy+=(-70*hula.ay-1.8*hula.vy+drive*5*Math.sin(hula.phase*.5+1))*dt+kick*dt*4;hula.ay+=hula.vy*dt;
  hula.vz+=(-200*hula.bz-7*hula.vz-drive*28*(.5+.5*Math.sin(hula.phase*2)))*dt-onset*60*dt*10;hula.bz+=hula.vz*dt;
  hula.ax=Math.max(-.5,Math.min(.5,hula.ax));hula.ay=Math.max(-.4,Math.min(.4,hula.ay));hula.bz=Math.max(-.35,Math.min(.25,hula.bz));
 }
 const sp=hula.spring;sp.rotation.set(-hula.ay*.5,hula.ax*.5,0);sp.scale.z=1+hula.bz;
 const tip=new THREE.Vector3(0,0,hula.springH*(1+hula.bz)).applyEuler(sp.rotation);
 hula.dancer.position.set(tip.x,tip.y,hula.baseTop+tip.z);hula.dancer.rotation.set(-hula.ay,hula.ax,0);
 hula.hips.rotation.y=hula.ax*.5;hula.torso.rotation.y=-hula.ax*1.3;
 for(const a of hula.arms)a.rotation.x=(reduce?0:Math.sin(hula.phase+a.userData.sx)*drive*.35);
}

function engrave(text,w,h,color='#d9bd7a'){
 if(typeof document.createElement!=='function')return null;
 try{const c=document.createElement('canvas');c.width=512;c.height=Math.round(512*h/w);const g=c.getContext('2d');if(!g)return null;
  g.fillStyle=color;g.font=`500 ${Math.round(c.height*.62)}px Georgia, serif`;g.textAlign='center';g.textBaseline='middle';
  if('letterSpacing' in g)g.letterSpacing='6px';g.fillText(text,c.width/2,c.height/2);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false}));m.rotation.x=Math.PI/2;return m;}catch{return null;}
}
/* ---------- Record sleeves: every loaded record that is not on the platter ---------- */
const sleeves=new THREE.Group();sleeves.name='sleeves';scene.add(sleeves);
let sleeveData=[],tableZ=-95,cabW=117,cabD=117,sleeveDrag=null;const coverCache=new Map(),MAX_SLEEVES=6,SLEEVE_YAW=.62;
function disposeSleeves(){sleeves.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(m.map&&!m.userData.cached)m.map.dispose();m.dispose();}}});sleeves.clear();}
function jacketFront(entry,S,front){
 // fallback Deco front: ivory card, brass frame, red label disc and the title
 const deco=new THREE.Group();deco.name='sleeve-deco';
 const fr=new THREE.Shape();fr.moveTo(-S*.46,-S*.46);fr.lineTo(S*.46,-S*.46);fr.lineTo(S*.46,S*.46);fr.lineTo(-S*.46,S*.46);fr.closePath();
 const hole=new THREE.Path();hole.moveTo(-S*.43,-S*.43);hole.lineTo(-S*.43,S*.43);hole.lineTo(S*.43,S*.43);hole.lineTo(S*.43,-S*.43);hole.closePath();fr.holes.push(hole);
 const off={polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2};
 deco.add(new THREE.Mesh(new THREE.ShapeGeometry(fr),new THREE.MeshStandardMaterial({color:0xc4a15a,metalness:.6,roughness:.35,...off})));
 const lab=new THREE.Mesh(new THREE.CircleGeometry(S*.17,64),new THREE.MeshStandardMaterial({color:0xc42420,roughness:.8,...off}));lab.name='sleeve-label';deco.add(lab);
 const ring=new THREE.Mesh(new THREE.RingGeometry(S*.3,S*.31,96),new THREE.MeshStandardMaterial({color:0xc4a15a,metalness:.6,roughness:.35,...off}));deco.add(ring);
 const title=engrave(String(entry.label||'Record').slice(0,28).toUpperCase(),S*.8,S*.08,'#2a1a10');
 if(title){title.rotation.x=0;title.position.y=-S*.38;deco.add(title);}
 deco.position.z=.6;front.add(deco);
 return deco;
}
function makeJacket(entry,S,T){
 const j=new THREE.Group();j.name='sleeve';j.userData={pick:'sleeve',sleeveId:entry.id};
 const kraft=new THREE.MeshStandardMaterial({color:0xcdb488,roughness:.92,metalness:0});
 const body=new THREE.Mesh(new THREE.BoxGeometry(S,T,S),kraft);body.position.z=S/2;j.add(body);
 const front=new THREE.Group();front.position.set(0,-T/2-.7,S/2);front.rotation.x=Math.PI/2;j.add(front);
 const coverMat=new THREE.MeshStandardMaterial({color:0xe7e1d4,roughness:.85,metalness:0});
 front.add(new THREE.Mesh(new THREE.PlaneGeometry(S*.985,S*.985),coverMat));
 const deco=jacketFront(entry,S,front);
 const apply=tex=>{coverMat.map=tex;coverMat.userData.cached=true;coverMat.color.set(0xffffff);coverMat.needsUpdate=true;deco.visible=false;};
 const key=entry.cover+'|'+entry.label,cached=coverCache.get(key);
 if(cached instanceof THREE.Texture)apply(cached);
 else if(cached!=='fail'&&entry.cover){new THREE.TextureLoader().load(entry.cover,tex=>{const art=coverArt(tex,entry.label);coverCache.set(key,art);if(j.parent)apply(art);},undefined,()=>coverCache.set(key,'fail'));}
 return j;
}
/* Jacket art: the record's own preview.png as a disc on an ivory Deco card with a brass frame and title. */
function coverArt(tex,label){
 tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=renderer.capabilities?.getMaxAnisotropy?.()||1;
 if(typeof document.createElement!=='function'||!tex.image)return tex;
 try{const N=1024,c=document.createElement('canvas');c.width=c.height=N;const g=c.getContext('2d');
  g.fillStyle='#e7e1d4';g.fillRect(0,0,N,N);
  g.strokeStyle='#b8954e';g.lineWidth=14;g.strokeRect(34,34,N-68,N-68);g.lineWidth=4;g.strokeRect(62,62,N-124,N-124);
  for(let i=0;i<9;i++){g.beginPath();g.moveTo(N/2,N*.47);g.lineTo(N*.1+i*N*.1,N*.1);g.lineWidth=2;g.stroke();} // sunburst
  g.save();g.beginPath();g.arc(N/2,N*.47,N*.34,0,Math.PI*2);g.clip();g.drawImage(tex.image,N*.16,N*.13,N*.68,N*.68);g.restore();
  g.beginPath();g.arc(N/2,N*.47,N*.345,0,Math.PI*2);g.lineWidth=6;g.strokeStyle='#b8954e';g.stroke();
  g.fillStyle='#2a1a10';g.font='500 54px Georgia, serif';g.textAlign='center';g.textBaseline='middle';if('letterSpacing' in g)g.letterSpacing='8px';
  g.fillText(String(label||'Record').slice(0,24).toUpperCase(),N/2,N*.89);
  const out=new THREE.CanvasTexture(c);out.colorSpace=THREE.SRGBColorSpace;out.anisotropy=tex.anisotropy;tex.dispose();return out;}catch{return tex;}
}
function sleeveHome(i,n){
 const S=2*R*1.04,step=n>1?Math.min(R*.22,R*1.0/(n-1)):0;
 const yaw=SLEEVE_YAW,rx=-(cabW+R*.22)-S/2*Math.cos(yaw),ry=-cabD*.05-S/2*Math.sin(yaw);                    // brass rack on the table, left of the plinth
 const lx=-i*step*.6,ly=i*R*.07;
 const p=new THREE.Vector3(rx+lx*Math.cos(yaw)-ly*Math.sin(yaw),ry+lx*Math.sin(yaw)+ly*Math.cos(yaw),tableZ+R*.03);
 const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.17,0,yaw+i*.03,'ZXY'));
 return {p,q};
}
function buildSleeves(){
 disposeSleeves();sleeveDrag=null;
 const list=sleeveData.slice(0,MAX_SLEEVES),n=list.length,S=2*R*1.04,T=R*.028;
 if(n){ // little brass rack the jackets lean in
  const brassR=shiny(0xc9a75e,.85,.3),{p}=sleeveHome(0,1),yaw=SLEEVE_YAW;const rack=new THREE.Group();rack.name='sleeve-rack';rack.position.set(p.x-S*.0,p.y,tableZ);rack.rotation.z=yaw;
  const fan=(n-1)*Math.min(R*.22,R*1.0/Math.max(1,n-1))*.6,len=S+fan+R*.1,cx=-fan/2,railY=(n-1)*R*.07+T+R*.55*Math.tan(.17)+R*.015;
  const base=new THREE.Mesh(new THREE.BoxGeometry(len,railY+R*.1,R*.03),brassR);base.position.set(cx,railY/2,R*.015);rack.add(base);
  const rail=new THREE.Mesh(new THREE.CylinderGeometry(R*.012,R*.012,len,12),brassR);rail.rotation.z=Math.PI/2;rail.position.set(cx,railY,R*.55);rack.add(rail);
  for(const sx of [-1,1]){const post=new THREE.Mesh(new THREE.CylinderGeometry(R*.012,R*.012,R*.55,10),brassR);post.rotation.x=Math.PI/2;post.position.set(cx+sx*len/2,railY,R*.275);rack.add(post);}
  sleeves.add(rack);
 }
 list.forEach((e,i)=>{const j=makeJacket(e,S,T),{p,q}=sleeveHome(i,n);j.position.copy(p);j.quaternion.copy(q);j.userData.home={p,q};j.renderOrder=n-i;sleeves.add(j);});
}
window.addEventListener('vinyl-sleeves',e=>{sleeveData=(e.detail?.sleeves||[]).slice();buildSleeves();});
function updateSleeves(){
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,k=reduce?1:.22;
 for(const j of sleeves.children){if(!j.userData.home)continue;
  const tgt=sleeveDrag?.jacket===j?sleeveDrag.pose:j.userData.home;
  j.position.lerp(tgt.p,k);j.quaternion.slerp(tgt.q,k);}
}
/* ---------- Pick up, turn in your hands, return to the spindle ---------- */
let heightTex=null,heightWorker=null,heightTimeout=null,heightOwner=null;
const inspectButton=document.getElementById('inspectRecord');
function syncInspectUI(){if(!inspectButton)return;inspectButton.disabled=!window.vinyl.record;inspectButton.textContent=inspect.active?'Put record back':'Inspect record';inspectButton.setAttribute('aria-pressed',String(inspect.active));}
function clearHeightDetail(){heightWorker?.terminate();heightWorker=null;clearTimeout(heightTimeout);heightTex?.dispose();heightTex=null;heightOwner=null;}
function setDetail(on){
 const top=disc.getObjectByName('vinyl-grooves'),m=window.vinyl.record?.metadata;if(!top||!m)return;
 top.geometry.dispose();top.geometry=new THREE.RingGeometry(m.label_radius_mm,R,on?1024:256,on?128:1);
 const mat=top.material,tex=on?(heightTex||bumpTex):bumpTex;
 mat.bumpMap=tex;mat.bumpScale=tex?(on&&heightTex?(m.height_polarity==='inverted'?-1:1)*m.height_scale_mm:-1.7):0;
 mat.displacementMap=on?tex:null;
 mat.displacementScale=on&&tex?(heightTex?(m.height_polarity==='inverted'?-1:1)*m.height_scale_mm:-.28):0;
 mat.displacementBias=on&&heightTex?(m.height_polarity==='inverted'?m.height_scale_mm-m.thickness_mm:-m.thickness_mm):0;
 mat.needsUpdate=true;
}
async function requestHeightDetail(){
 const record=window.vinyl.record;if(heightTex||heightWorker||!record)return;
 // Bundled demo has only its preview. Never guess/fetch a giant demo height map.
 const file=record.heightmapFile;if(!file?.arrayBuffer)return;
 const owner=record;heightOwner=owner;
 try{
  const bytes=await file.arrayBuffer();if(!inspect.active||window.vinyl.record!==owner)return;
  const worker=heightWorker=new Worker(new URL('./inspect-height-worker.js',import.meta.url));
  const finish=()=>{worker.terminate();if(heightWorker===worker)heightWorker=null;clearTimeout(heightTimeout);};
  heightTimeout=setTimeout(finish,30000);
  worker.onmessage=e=>{finish();if(e.data.error||window.vinyl.record!==owner||heightOwner!==owner)return;
   const {data,width,height}=e.data;const t=new THREE.DataTexture(data,width,height,THREE.RedFormat,THREE.FloatType);t.flipY=true;t.colorSpace=THREE.NoColorSpace;t.minFilter=t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;t.needsUpdate=true;heightTex=t;
   if(inspect.active)setDetail(true);
  };worker.onerror=finish;worker.postMessage(bytes,[bytes]);
 }catch{heightWorker?.terminate();heightWorker=null;} // preview remains a working fallback
}
function beginInspection(){
 const v=window.vinyl;if(!v.record||inspect.active||!disc.getObjectByName('vinyl-grooves'))return;
 v.setInspecting(true);drag=false;armHold=null;sleeveDrag=null;
 inspect.active=true;inspect.phase='out';inspect.elapsed=0;inspect.drag=null;
 inspect.from=disc.position.clone();inspect.qFrom=disc.quaternion.clone();inspect.cameraFrom=camera.position.clone();inspect.targetFrom=controls.target.clone();
 inspect.held=new THREE.Vector3(-R*.35,-R*2.8,R*1.6);
 inspect.eye=inspect.held.clone().add(new THREE.Vector3(R*.15,-R*2.9,R*1.7));
 inspect.qHeld=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),inspect.eye.clone().sub(inspect.held).normalize());
 inspect.qHeld.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.48));
 loosenInspectCamera();controls.enabled=false;setDetail(true);requestHeightDetail();inspectRake.visible=inspectSoft.visible=true;syncInspectUI();
}
function loosenInspectCamera(){
 controls.minAzimuthAngle=-Infinity;controls.maxAzimuthAngle=Infinity;controls.minPolarAngle=.02;controls.maxPolarAngle=Math.PI-.02;
 controls.minDistance=R*.65;controls.maxDistance=R*5;controls.enablePan=true;controls.zoomToCursor=true;controls.enabled=true;controls.update();
}
function returnRecord(){
 if(!inspect.active||inspect.phase==='back')return;
 inspect.phase='back';inspect.elapsed=0;inspect.drag=null;inspect.from=disc.position.clone();inspect.qFrom=disc.quaternion.clone();inspect.cameraFrom=camera.position.clone();inspect.targetFrom=controls.target.clone();controls.enabled=false;
}
function finishInspection(replacing=false){
 if(!inspect.active)return;
 inspect.active=false;inspect.phase='idle';inspect.drag=null;disc.position.set(0,0,0);disc.rotation.set(0,0,window.vinyl.state.rotation);inspectRake.visible=inspectSoft.visible=false;controls.enabled=true;
 if(!replacing)setDetail(false);
 window.vinyl.setInspecting(false);syncInspectUI();resetView();
}
const ease=t=>t*t*(3-2*t);
function updateInspection(dt){
 if(!inspect.active)return;
 if(inspect.phase!=='held'){
  const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  inspect.elapsed+=dt;const t=reduce?1:Math.min(1,inspect.elapsed/.65),a=ease(Math.min(1,t/.28)),b=ease(Math.max(0,(t-.28)/.72));
  const lifted=new THREE.Vector3(0,0,R*.85);
  if(inspect.phase==='out'){
   disc.position.lerpVectors(inspect.from,lifted,a);if(t>.28)disc.position.lerpVectors(lifted,inspect.held,b);
   disc.quaternion.slerpQuaternions(inspect.qFrom,inspect.qHeld,b);
   camera.position.lerpVectors(inspect.cameraFrom,inspect.eye,ease(t));controls.target.lerpVectors(inspect.targetFrom,inspect.held,ease(t));
   if(t===1){inspect.phase='held';loosenInspectCamera();}
  }else{
   const a=ease(Math.min(1,t/.72)),b=ease(Math.max(0,(t-.72)/.28));disc.position.lerpVectors(inspect.from,lifted,a);if(t>.72)disc.position.lerpVectors(lifted,new THREE.Vector3(),b);
   disc.quaternion.slerpQuaternions(inspect.qFrom,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),window.vinyl.state.rotation),a);
   camera.position.lerpVectors(inspect.cameraFrom,new THREE.Vector3(R*1.02,-R*6,R*2.35),ease(t));controls.target.lerpVectors(inspect.targetFrom,new THREE.Vector3(-R*.4,R*.25,R*.42),ease(t));
   if(t===1){finishInspection();return;}
  }
  camera.lookAt(controls.target);
 }
 // Raking light follows the face, not the camera: turning the vinyl moves highlights.
 const normal=new THREE.Vector3(0,0,1).applyQuaternion(disc.quaternion),across=new THREE.Vector3(1,0,0).applyQuaternion(disc.quaternion);
 inspectRake.target.position.copy(disc.position);inspectRake.position.copy(disc.position).addScaledVector(across,R*3).addScaledVector(normal,R*.55);
 inspectSoft.target.position.copy(disc.position);inspectSoft.position.copy(camera.position).addScaledVector(new THREE.Vector3(1,0,0).transformDirection(camera.matrixWorld),R*1.2);
}
inspectButton?.addEventListener('click',()=>inspect.active?returnRecord():beginInspection());
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&inspect.active){e.preventDefault();returnRecord();}});
let builtFor=0;
function buildPhonograph(R){
 if(builtFor===R)return;builtFor=R;armL=0;
 phonograph.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});phonograph.clear();
 const mahogany=lacquer(0x5a1a0e,.34),panel=lacquer(0x45140a,.3),dark=lacquer(0x260b05,.38);
 const brass=shiny(0xc9a75e,.9,.24,THREE.DoubleSide),nickel=shiny(0xb9b6ad,.85,.28),bakelite=lacquer(0x15100d,.4);
 const W=R*1.3,D=R*1.3,H=R*.78,top=-4; // half-widths and body height (mm)
 const lid=R*.08,plA=R*.07,plB=R*.06;
 // platter (nickel) and a black vinyl edge below the disc surface
 const platter=new THREE.Mesh(new THREE.CylinderGeometry(R*1.02,R*1.02,4,96),nickel);platter.rotation.x=Math.PI/2;platter.position.z=top+2;phonograph.add(platter);
 const edge=new THREE.Mesh(new THREE.CylinderGeometry(R*.999,R*.999,2.4,128,1,true),new THREE.MeshStandardMaterial({color:0x141416,roughness:.4,side:THREE.DoubleSide}));edge.rotation.x=Math.PI/2;edge.position.z=1.2;phonograph.add(edge);
 const spindle=new THREE.Mesh(new THREE.CylinderGeometry(3.2,3.2,8,24),nickel);spindle.name='spindle';spindle.rotation.x=Math.PI/2;spindle.position.z=5;phonograph.add(spindle);
 // lid moulding, body, plinth
 const lidM=slab(2*W+R*.1,2*D+R*.1,lid,lid*.35,mahogany);lidM.position.z=top-lid;phonograph.add(lidM);
 const lidBead=slab(2*W+R*.02,2*D+R*.02,R*.025,R*.01,dark);lidBead.position.z=top-lid-R*.025;phonograph.add(lidBead);
 const bodyTop=top-lid-R*.025,bodyBot=bodyTop-H;
 const body=slab(2*W-R*.08,2*D-R*.08,H,R*.01,mahogany);body.position.z=bodyBot;phonograph.add(body);
 // raised fielded panels on front and both sides
 const pf=slab(2*W-R*.5,R*.04,H-R*.22,R*.012,panel);pf.position.set(0,-D+R*.04,bodyBot+R*.11);phonograph.add(pf);
 for(const sx of [-1,1]){const ps=slab(R*.04,2*D-R*.5,H-R*.22,R*.012,panel);ps.position.set(sx*(W-R*.04),0,bodyBot+R*.11);phonograph.add(ps);}
 const pb=pf.clone();pb.position.y=D-R*.04;phonograph.add(pb);
 // turned columns at the four corners
 for(const sx of [-1,1])for(const sy of [-1,1]){const c=turnedColumn(H,R*.075,dark);c.position.set(sx*(W-R*.045),sy*(D-R*.045),bodyBot);phonograph.add(c);}
 const plinth1=slab(2*W+R*.12,2*D+R*.12,plA,plA*.3,mahogany);plinth1.position.z=bodyBot-plA;phonograph.add(plinth1);
 const plinth2=slab(2*W+R*.26,2*D+R*.26,plB,plB*.45,dark);plinth2.position.z=bodyBot-plA-plB;phonograph.add(plinth2);
 // side crank on the right-hand side, towards the front
 const crank=new THREE.Group();crank.position.set(W+R*.02,-D*.38,bodyBot+H*.55);
 const bezel=new THREE.Mesh(new THREE.CylinderGeometry(R*.05,R*.05,R*.02,32),brass);bezel.rotation.z=Math.PI/2;bezel.position.x=R*.01;crank.add(bezel);
 const shaft=new THREE.Mesh(new THREE.CylinderGeometry(R*.014,R*.014,R*.16,16),nickel);shaft.rotation.z=Math.PI/2;shaft.position.x=R*.08;crank.add(shaft);
 const arm=new THREE.Mesh(new THREE.BoxGeometry(R*.025,R*.03,R*.3),nickel);arm.position.set(R*.16,0,-R*.13);crank.add(arm);
 const knob=new THREE.Mesh(new THREE.CylinderGeometry(R*.03,R*.03,R*.13,20),bakelite);knob.rotation.z=Math.PI/2;knob.position.set(R*.23,0,-R*.27);crank.add(knob);
 phonograph.add(crank);
 // horn bracket: a brass upright from the back-right of the cabinet to the horn neck
 const [px,py]=armPivot(R),neck0=new THREE.Vector3(px,py,HINGE_Z+5);
 const post=new THREE.Mesh(new THREE.CylinderGeometry(4.6,5.6,HINGE_Z-top-4.5,24),brass);post.rotation.x=Math.PI/2;post.position.set(px,py,(top+HINGE_Z-4.5)/2);phonograph.add(post); // fixed pivot post
 const strut=new THREE.Mesh(new THREE.BoxGeometry(R*.05,R*.03,R*.62),brass);strut.position.set(px+R*.05,py+R*.2,top+R*.31);phonograph.add(strut); // horn bracket
 // morning-glory horn: neck rises from the arm pivot, arches back and over, bell opens up-left
 const curve=new THREE.CatmullRomCurve3([
  neck0,
  new THREE.Vector3(px,py+R*.06,HINGE_Z+5+R*.28),
  new THREE.Vector3(px-R*.06,py+R*.3,R*.62),
  new THREE.Vector3(px-R*.34,py+R*.5,R*.98),
  new THREE.Vector3(px-R*.74,py+R*.36,R*1.22),
  new THREE.Vector3(px-R*1.32,py-R*.18,R*1.38)],false,'centripetal');
 const {geometry,rim}=hornGeometry(curve,5,R*.86);
 const horn=new THREE.Mesh(geometry,brass);horn.name='horn';horn.userData.mouth=curve.points.at(-1).clone();phonograph.add(horn);
 const bead=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim,true),256,R*.012,8,true),brass);phonograph.add(bead);
 const collar=new THREE.Mesh(new THREE.CylinderGeometry(7,7,8,24),brass);collar.rotation.x=Math.PI/2;collar.position.set(px,py,HINGE_Z+6);phonograph.add(collar);
 // table level (underside of the plinth) and the dashboard hula girl
 tableZ=bodyBot-plA-plB;cabW=W;cabD=D;room.position.z=tableZ;
 phonograph.add(buildHula(R,top,W,D));
 phonograph.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
}
buildPhonograph(R);bakeRoomEnvironment();
addPlaceholder();resetView();
function mountRecord(record){version++;const v=version;finishInspection(true);clearDisc();clearHeightDetail();bumpTex?.dispose();bumpTex=null;
 const oldR=R;R=record.metadata.disc_radius_mm;buildPhonograph(R);if(oldR!==R)buildSleeves();
 resetView();tonearm.visible=true;armHold=null;buildRecord(record.metadata,record.label);syncInspectUI();
 loadBump(record.previewUrl||record.base+'preview.png',texture=>{
  if(v!==version){texture?.dispose();return;}
  bumpTex=texture;const top=disc.getObjectByName('vinyl-grooves');if(!top)return;
  top.material.bumpMap=texture;top.material.bumpScale=texture?-1.7:0;top.material.needsUpdate=true;
  if(inspect.active)setDetail(true);
 });
}
window.addEventListener('vinyl-record',e=>mountRecord(e.detail));
function setRay(event){const b=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-b.left)/b.width*2-1,-(event.clientY-b.top)/b.height*2+1);ray.setFromCamera(pointer,camera);}
function hitPlane(event,z){setRay(event);const p=new THREE.Vector3();return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-z),p)?p:null;}
function hit(event){return hitPlane(event,window.vinyl.record?.metadata.thickness_mm||2.5);}
function pickIn(objects){if(!objects.length)return null;const h=ray.intersectObjects(objects,true).find(i=>i.object.visible!==false);if(!h)return null;let o=h.object;while(o&&!o.userData?.pick)o=o.parent;return o?{obj:o,kind:o.userData.pick,point:h.point}:{obj:h.object,kind:null,point:h.point};}
function visibleChain(o){for(;o;o=o.parent)if(!o.visible)return false;return true;}
/* Pointer priority: tonearm, sleeves, then the disc (scratch). */
let armHold=null;
function pickAt(e){
 const v=window.vinyl;setRay(e);
 if(v.record&&tonearm.visible){const a=ray.intersectObjects(armParts,false)[0];if(a)return {kind:'arm'};}
 const sl=pickIn(sleeves.children.filter(o=>o.userData.pick==='sleeve'));
 if(sl&&sl.kind==='sleeve')return sl;
 return null;
}
renderer.domElement.addEventListener('pointerdown',e=>{
 if(e.button!==0)return;const v=window.vinyl;
 if(inspect.active){
  if(inspect.phase!=='held')return;setRay(e);
  if(ray.intersectObject(disc,true).length){inspect.drag={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture?.(e.pointerId);}
  else{const p=hitPlane(e,0);if(p&&Math.hypot(p.x,p.y)<R*1.05)returnRecord();}
  return;
 }
 const p0=pickAt(e);
 if(p0){
  renderer.domElement.setPointerCapture?.(e.pointerId);
  if(p0.kind==='arm'){const up=!v.down||v.state.grabbed;armHold={x:e.clientX,y:e.clientY,start:up?1:0,value:up?1:0,moved:false};return;}
  if(p0.kind==='sleeve'){const j=p0.obj;const hz=(v.record?.metadata.thickness_mm||2.5)+R*.35;const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2+.18,0,0));
   sleeveDrag={jacket:j,id:j.userData.sleeveId,z:hz,pose:{p:j.position.clone(),q},over:false};moveSleeve(e);return;}
 }
 if(!v.record)return;const p=hit(e);if(!p||Math.hypot(p.x,p.y)>R+1)return;if(!v.down){beginInspection();return;}drag=true;renderer.domElement.setPointerCapture(e.pointerId);v.grabStart(p.x,p.y);
});
function moveSleeve(e){const p=hitPlane(e,sleeveDrag.z);if(!p)return;const S=2*R*1.04;
 // jacket centre follows the pointer, lying cover-up over the table
 sleeveDrag.pose.p.set(p.x,p.y-S/2*Math.cos(.18),sleeveDrag.z-S/2*Math.sin(.18));sleeveDrag.over=Math.hypot(p.x,p.y)<R*1.05;sleeveDrag.center=p;}
renderer.domElement.addEventListener('pointermove',e=>{
 const v=window.vinyl;
 if(inspect.active){if(inspect.drag&&inspect.phase==='held'){
  const dx=e.clientX-inspect.drag.x,dy=e.clientY-inspect.drag.y;inspect.drag={x:e.clientX,y:e.clientY};
  const right=new THREE.Vector3(1,0,0).transformDirection(camera.matrixWorld),up=new THREE.Vector3(0,1,0).transformDirection(camera.matrixWorld);
  disc.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up,dx*.008)).premultiply(new THREE.Quaternion().setFromAxisAngle(right,dy*.008));
 }return;}

 if(armHold){const dy=e.clientY-armHold.y;if(Math.abs(dy)>4||Math.abs(e.clientX-armHold.x)>4)armHold.moved=true;armHold.value=Math.max(0,Math.min(1,armHold.start-dy/90));
  // the arm is the switch: raise it off the record to stop, lower it onto the record to play
  if(armHold.moved){if(armHold.value>.6&&v.down&&!v.state.grabbed)v.lift();else if(armHold.value<.15&&!v.down)v.drop()?.catch?.(()=>{});}
  return;}
 if(sleeveDrag){moveSleeve(e);return;}
 if(!drag)return;const p=hit(e);if(p)v.grabMove(p.x,p.y);
});
function endPointer(e,cancel=false){
 if(inspect.active){inspect.drag=null;return true;}
 const v=window.vinyl;
 if(armHold){const h=armHold;armHold=null;
  if(!cancel){if(!h.moved){if(v.down&&!v.state.grabbed)v.lift();else v.drop()?.catch?.(()=>{});}
   else if(h.value>.5&&v.down&&!v.state.grabbed)v.lift();else if(h.value<=.5&&!v.down)v.drop()?.catch?.(()=>{});}
  return true;}
 if(sleeveDrag){const s=sleeveDrag;sleeveDrag=null;if(!cancel&&s.over&&v.swapTo){v.swapTo(s.id);}return true;}  // otherwise it eases home
 return false;
}
renderer.domElement.addEventListener('pointerup',e=>{if(e.button!==0)return;if(endPointer(e))return;if(drag){drag=false;window.vinyl.grabEnd();}});
renderer.domElement.addEventListener('dblclick',e=>{if(e.button!==0||!window.vinyl.record)return;setRay(e);if(ray.intersectObject(disc,true).length){if(inspect.active){if(inspect.phase==='held')returnRecord();}else beginInspection();}});
renderer.domElement.addEventListener('pointercancel',e=>{if(endPointer(e,true))return;if(drag){drag=false;window.vinyl.grabEnd();}});
function resize(){const w=view.clientWidth,h=view.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(view);resize();
function loudness(v,t){
 if(!v.down||v.state.grabbed)return 0;const b=v.buffer||v.grooveBuffer;if(!b)return 0;
 const ch=b.getChannelData(0),sr=b.sampleRate,c=Math.floor(t*sr),n=Math.floor(sr*.035);let s=0,k=0;
 for(let i=Math.max(0,c-n),e=Math.min(ch.length,c+n);i<e;i+=4){s+=ch[i]*ch[i];k++;}
 return k?Math.sqrt(s/k):0;
}
// Reuse vectors; the horn mesh is rebuilt whenever the record radius changes.
const audioPosition=new THREE.Vector3(),audioForward=new THREE.Vector3(),audioUp=new THREE.Vector3(),audioMouth=new THREE.Vector3(),audioReset=new THREE.Vector3();
function updateAudioListener(){
 const horn=phonograph.getObjectByName('horn');if(!horn||!window.vinyl.setListener)return;
 horn.localToWorld(audioMouth.copy(horn.userData.mouth));
 camera.getWorldPosition(audioPosition);camera.getWorldDirection(audioForward);
 audioUp.set(0,1,0).transformDirection(camera.matrixWorld); // camera's actual rolled/pitched up
 audioReset.set(R*1.02,-R*6.0,R*2.35);
 window.vinyl.setListener(audioPosition,audioForward,audioUp,audioMouth,audioReset.distanceTo(audioMouth));
}
// The demo may finish loading while Three.js/room modules are still downloading.
if(window.vinyl.record)mountRecord(window.vinyl.record);
sleeveData=window.vinyl.sleeves?.()||sleeveData;buildSleeves();syncInspectUI();
let lastFrame=performance.now();
function frame(){requestAnimationFrame(frame);const v=window.vinyl,r=v.record;let energy=0;if(r){const m=r.metadata,t=v.time(),th=2*Math.PI*(m.lead_in_turns+t*m.rpm_cut/60);if(!v.state.grabbed) v.state.rotation=v.state.angle+th;if(v.state.grabbed)v.grabTick();if(!inspect.active)disc.rotation.z=v.state.rotation;
 let d=0;const displacement=v.grooveBuffer||v.buffer;if(displacement){const samples=displacement.getChannelData(0);d=samples[Math.min(samples.length-1,Math.floor(t*displacement.sampleRate))]||0;}
 const rad=m.r_start_mm-m.pitch_mm*th/(2*Math.PI)+m.amp_mm*d;
 const tipZ=armHold?m.thickness_mm-.25+armHold.value*13.25:m.thickness_mm+(v.down?-.25:13);
 placeTonearm(rad*Math.cos(v.state.angle),rad*Math.sin(v.state.angle),tipZ,v.down);
 energy=loudness(v,t);
 }else tonearm.visible=false;
 updateHula(energy);updateSleeves();
 const now=performance.now(),dt=Math.min(.05,Math.max(.001,(now-lastFrame)/1000));lastFrame=now;updateInspection(dt);
 controls.update();updateAudioListener();renderer.render(scene,camera);}frame();
