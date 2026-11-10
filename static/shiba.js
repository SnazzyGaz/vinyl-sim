/* "Shiba in Clogs": Garyck Arntzen's SDF shiba as a cabinet toy, beside the hula girl.
   The meshes are baked offline (tools/bake-shiba.mjs -> static/shiba.bin), so start-up
   runs no surface nets; the file is fetched after the first frame. Shell fur: one base
   shell plus a few offset shells of the same mesh, each a MeshStandardMaterial patched
   for the strand pattern, so the fur takes the room's own key light, shadows and
   reflections. The butt rides a damped spring (uWob x the baked aWob weights) that the
   record's bass pokes on the beat: mostly side to side, with a little bounce. */
export function createShiba(THREE,{url,shells=10}={}){
 const S={data:null,loading:null,holder:null,group:null,base:null,uWob:{value:new THREE.Vector3()},vel:new THREE.Vector3(),
  fast:0,slow:0,peak:.02,since:1,side:1,beats:0,armed:true,amp:0,pick:null,mats:null};
 const srgb=x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);
 function decode(buf){
  const dv=new DataView(buf);if(String.fromCharCode(...new Uint8Array(buf,0,4))!=='SHB1')throw new Error('not a shiba bake');
  const hl=dv.getUint32(4,true),h=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,8,hl))),base=8+hl;
  const arr=n=>{const l=h.layout[n];return new globalThis[l.type](buf,base+l.offset,l.length);};
  const geo=name=>{const m=h.meshes[name],q=arr(name+'.pos'),nq=arr(name+'.nor'),p=new Float32Array(q.length),n=new Float32Array(nq.length);
   for(let i=0;i<q.length;i++){const a=i%3;p[i]=m.min[a]+q[i]/65535*(m.max[a]-m.min[a]);n[i]=nq[i]/127;}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('normal',new THREE.BufferAttribute(n,3));
   g.setIndex(new THREE.BufferAttribute(arr(name+'.idx').slice(),1));return g;};
  const body=geo('body');
  body.setAttribute('aCol',new THREE.BufferAttribute(arr('body.col').slice(),3,true));
  body.setAttribute('aFx',new THREE.BufferAttribute(arr('body.fx').slice(),2,true));
  body.setAttribute('aWob',new THREE.BufferAttribute(arr('body.wob').slice(),1,true));
  body.computeBoundingSphere();body.computeBoundingBox();
  const clog=geo('clog'),ao=arr('clog.ao'),c=new Float32Array(ao.length*3);
  // the original fed these grey AO values straight to its sRGB output: linearise them for ours
  for(let i=0;i<ao.length;i++)c[i*3]=c[i*3+1]=c[i*3+2]=srgb(ao[i]/255);
  clog.setAttribute('color',new THREE.BufferAttribute(c,3));clog.computeBoundingSphere();
  return {h,body,clog};
 }
 /* ---------- fur: patched standard material per shell ---------- */
 const FUR_VS_HEAD=`attribute vec3 aCol;attribute vec2 aFx;attribute float aWob;uniform float uH,uLen;uniform vec3 uWob;
varying vec3 vBase,vFurCol;varying vec2 vFx;
vec3 furLin(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
`;
 const FUR_FS_HEAD=`uniform float uH,uDens,uRim;varying vec3 vBase,vFurCol;varying vec2 vFx;
float furHash(vec3 p){p=fract(p*0.3183099+vec3(0.1,0.2,0.3));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float furVn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(furHash(i),furHash(i+vec3(1,0,0)),f.x),mix(furHash(i+vec3(0,1,0)),furHash(i+vec3(1,1,0)),f.x),f.y),
  mix(mix(furHash(i+vec3(0,0,1)),furHash(i+vec3(1,0,1)),f.x),mix(furHash(i+vec3(0,1,1)),furHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
 function furMaterial(h,furLen,shellCount){
  const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.92,metalness:0,alphaToCoverage:h>0});
  const u={uH:{value:h},uLen:{value:furLen},uDens:{value:120},uRim:{value:.5},uWob:S.uWob};
  m.onBeforeCompile=sh=>{Object.assign(sh.uniforms,u);
   sh.vertexShader=FUR_VS_HEAD+sh.vertexShader
    .replace('#include <beginnormal_vertex>',`vec3 furN=normalize(normal);vec3 comb=vec3(0.35,-1.0,0.0);comb-=furN*dot(comb,furN); // fur lies down and back
vec3 objectNormal=normalize(furN+comb*0.4*uH);`)
    .replace('#include <begin_vertex>',`float furL=uLen*aFx.x;vec3 transformed=position+(furN*uH+comb*0.5*uH*uH)*furL+aWob*uWob;
vBase=position;vFurCol=furLin(aCol);vFx=aFx;`);
   sh.fragmentShader=FUR_FS_HEAD+sh.fragmentShader
    .replace('#include <color_fragment>',`#include <color_fragment>
{vec3 q=vBase*uDens,c=floor(q),f=fract(q)-0.5;float r1=furHash(c),r2=furHash(c+17.3),clump=furVn(vBase*11.0),a=1.0;
 if(uH>0.0){float hmax=(0.3+0.7*r1)*(0.7+0.6*clump);if(uH>hmax||vFx.x<0.02)discard;
  float rad=0.68*(1.0-0.65*uH/hmax);a=1.0-smoothstep(rad-0.28,rad,length(f));if(a<0.04)discard;}
 diffuseColor.rgb=vFurCol*(0.93+0.14*r2)*(0.93+0.14*clump)*mix(0.8,1.0,uH)*mix(vFx.y,1.0,uH*0.25);diffuseColor.a=a;}`)
    .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
totalEmissiveRadiance+=diffuseColor.rgb*pow(1.0-max(dot(normal,normalize(vViewPosition)),0.0),3.0)*0.16*uH*uRim;`);
  };
  m.customProgramCacheKey=()=>'shiba-fur';m.userData.shared=true;m.userData.uniforms=u;return m;
 }
 function depthMaterial(){
  const m=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  m.onBeforeCompile=sh=>{sh.uniforms.uWob=S.uWob;sh.vertexShader='attribute float aWob;uniform vec3 uWob;\n'+sh.vertexShader.replace('#include <begin_vertex>','vec3 transformed=position+aWob*uWob;');};
  m.customProgramCacheKey=()=>'shiba-depth';m.userData.shared=true;return m;
 }
 function materials(h){
  if(S.mats)return S.mats;
  const std=(c,r,extra={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:r,...extra});m.userData.shared=true;return m;};
  const fur=[];for(let i=0;i<=shells;i++)fur.push(furMaterial(i/shells,h.furLen,shells));
  return S.mats={fur,depth:depthMaterial(),black:std(0x0c0908,.42),lip:std(0x1a100c,.7),claw:std(0x2a211c,.5),
   shoe:std(0x2cbf5f,.5,{vertexColors:true}),strap:std(0x2cbf5f,.5),rivet:std(0x3b3b40,.35,{metalness:.4}),rivetCap:std(0xc9c9cf,.3,{metalness:.5})};
 }
 /* ---------- assemble one dog (dog-local units: y up, faces -x) ---------- */
 function buildDog(){
  const {h,body,clog}=S.data,M=materials(h),dog=new THREE.Group();dog.name='shiba-dog';
  const add=(mesh,parent=dog)=>{mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  for(let i=0;i<=shells;i++){const m=new THREE.Mesh(body,M.fur[i]);m.name=i?'shiba-fur':'shiba-body';m.renderOrder=i;m.castShadow=i===0;m.receiveShadow=true;
   if(i===0){m.customDepthMaterial=M.depth;S.pick=m;}dog.add(m);}
  const sphere=new THREE.SphereGeometry(1,24,16);
  for(const p of h.parts){const m=add(new THREE.Mesh(p.kind==='nose'?new THREE.SphereGeometry(.1,28,20):sphere,M.black));m.position.fromArray(p.p);m.quaternion.fromArray(p.q);m.scale.fromArray(p.s);}
  for(const t of h.tubes){const pts=[];for(let i=0;i<t.pts.length;i+=3)pts.push(new THREE.Vector3(t.pts[i],t.pts[i+1],t.pts[i+2]));
   add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),t.seg,t.r,8,false),M.lip));}
  const clawG=new THREE.ConeGeometry(.014,.06,8);
  for(const c of h.claws){const m=add(new THREE.Mesh(clawG,M.claw));m.position.fromArray(c);m.rotation.z=2.2;}
  const strapCurve=new THREE.CatmullRomCurve3([[.02,.19,.212],[.17,.27,.19],[.3,.31,.1],[.335,.32,0],[.3,.31,-.1],[.17,.27,-.19],[.02,.19,-.212]].map(a=>new THREE.Vector3(...a)));
  const strapG=new THREE.TubeGeometry(strapCurve,48,.027,10,false),rivG=new THREE.CylinderGeometry(.04,.04,.02,24),capG=new THREE.CylinderGeometry(.022,.022,.026,20);
  for(const c of h.clogs){const g=new THREE.Group();add(new THREE.Mesh(clog,M.shoe),g);add(new THREE.Mesh(strapG,M.strap),g);
   for(const s of [1,-1]){const r=add(new THREE.Mesh(rivG,M.rivet),g);r.position.set(.02,.19,.232*s);r.rotation.x=Math.PI/2;const k=add(new THREE.Mesh(capG,M.rivetCap),g);k.position.copy(r.position);k.rotation.x=Math.PI/2;}
   g.scale.setScalar(c.scale);g.position.fromArray(c.p);g.rotation.y=c.ry;dog.add(g);}
  return dog;
 }
 /* holder: an empty group on the cabinet lid; the dog drops in once the bake arrives.
    scale = mm per dog unit; yaw turns the dog's side-on 3/4 view toward the seat. */
 function mount(holder,{scale,yaw,base}={}){
  S.holder=holder;S.scale=scale;S.yaw=yaw;S.baseMat=base;
  if(S.data)attach();
  return holder;
 }
 function attach(){
  const holder=S.holder;if(!holder||!S.data||holder.getObjectByName('shiba-dog'))return false;
  const outer=new THREE.Group();outer.name='shiba-yaw';outer.rotation.z=S.yaw||0;
  const up=new THREE.Group();up.rotation.x=Math.PI/2;up.scale.setScalar(S.scale||1);outer.add(up);up.add(buildDog());
  if(S.baseMat){ // a thin oval felt puck, like the hula girl's, so the clogs stand on something
   const b=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,48),S.baseMat);b.name='shiba-puck';b.scale.set(1.05*S.scale,.1*S.scale,.74*S.scale);b.rotation.x=Math.PI/2;b.position.set(.25*S.scale,0,.05*S.scale);
   b.castShadow=b.receiveShadow=true;outer.add(b);up.position.z=.1*S.scale;}
  holder.add(outer);S.group=outer;S.step=0;return true;
 }
 function load(){
  if(S.loading)return S.loading;
  if(typeof fetch!=='function'||!url||/^file:/.test(url))return S.loading=Promise.resolve(!!S.data);
  return S.loading=fetch(url).then(r=>{if(!r.ok)throw new Error('shiba '+r.status);return r.arrayBuffer();}).then(b=>{S.data=decode(b);return attach();})
   .catch(e=>{console.warn?.('shiba toy skipped',e);return false;});
 }
 /* Fur detail by on-screen size: from the default seat he is ~60 px tall and every
    other shell is invisible anyway, so far away only shells 0,3,6,9 draw (a third of
    the triangles); all ten come back once he is big on screen. */
 const tmpP=new THREE.Vector3();
 function detail(camera,viewPx){
  const g=S.group;if(!g||!camera)return false;
  g.getWorldPosition(tmpP);const d=camera.position.distanceTo(tmpP),f=Math.tan((camera.fov||38)*Math.PI/360)*2;
  const px=(S.scale||1)*4.3/Math.max(1e-3,d*f)*(viewPx||720),step=px<160?3:px<320?2:1;
  if(step===S.step)return false;S.step=step;S.px=px;
  g.traverse(o=>{if(o.name==='shiba-fur'){const i=Math.round(o.material.userData.uniforms.uH.value*shells);o.visible=i%step===0;}});
  return true;
 }
 function poke(x,y,z){S.vel.x+=x;S.vel.y+=y;S.vel.z+=z;}
 /* bass: RMS of the low-passed record signal near the needle (0 when lifted).
    A beat is a sharp rise of the bass envelope over its recent valley, scaled by a
    slowly decaying peak so quiet and loud records both jiggle. */
 function update(dt,bass,still){
  const w=S.uWob.value,v=S.vel;
  if(still){w.set(0,0,0);v.set(0,0,0);S.fast=S.slow=0;return false;}
  S.fast+=(bass-S.fast)*Math.min(1,dt*(bass>S.fast?40:10));
  // valley: drops with the envelope at once, climbs back slowly, so (fast - valley) is a note's attack
  S.slow=S.fast<S.slow?S.fast:S.slow+(S.fast-S.slow)*Math.min(1,dt*5);
  S.peak=Math.max(S.fast,S.peak*Math.exp(-dt/6),.004);
  const level=S.fast/S.peak,flux=(S.fast-S.slow)/S.peak;S.since+=dt;
  if(flux<.03)S.armed=true; // re-arm once the attack is over: one poke per note
  if(S.armed&&flux>.07&&level>.2&&S.since>.12){S.armed=false;
   const a=Math.min(1.3,.5+flux*2);S.side=-S.side;S.beats++;S.since=0;
   poke(.5*a*S.side,1.2*a,2.4*a*S.side); // mostly side to side, a little bounce and shove
  }
  // sustained bass keeps a small sway going between beats
  v.z+=S.side*level*Math.min(1,S.fast*40)*6*dt;
  for(let i=0;i<2;i++){const h=Math.min(dt,.05)/2;
   v.x+=(-260*w.x-7*v.x)*h;v.y+=(-330*w.y-7*v.y)*h;v.z+=(-200*w.z-6*v.z)*h;
   w.addScaledVector(v,h);w.clampLength(0,.3);}
  S.amp=Math.max(S.amp*Math.exp(-dt*2),w.length());
  if(bass<1e-5&&w.lengthSq()+v.lengthSq()*.01<1e-9){w.set(0,0,0);v.set(0,0,0);}
  return w.lengthSq()+v.lengthSq()>0;
 }
 function fromBuffer(buf){S.data=decode(buf);S.loading=Promise.resolve(true);return attach();}
 return {load,fromBuffer,mount,update,poke,attach,detail,get state(){return S;},get wob(){return S.uWob.value;},get pickMesh(){return S.pick;},get loaded(){return !!S.data;}};
}
