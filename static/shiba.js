/* Garyck Arntzen's SDF shiba as a cabinet toy, beside the hula girl.
   The meshes are baked offline (tools/bake-shiba.mjs -> static/shiba.bin), so start-up
   runs no surface nets; the file is fetched after the first frame. Shell fur: one base
   shell plus a few offset shells of the same mesh, each a MeshStandardMaterial patched
   for the strand pattern, so the fur takes the room's own key light, shadows and
   reflections. The music drives a damped spring at the seam where the hind legs meet
   the bum (uWob, see update()). The bum itself is a softer material than the body: a
   jelly that rings at its own low stiffness and damping, kicked by the seam's jolts, and
   its motion travels out from each leg seam as a decaying wave (see jelly below), so
   ripples start at the legs and spread over the cheeks instead of the whole region
   being tugged about. Legs, feet and clogs never move. */
export function createShiba(THREE,{url,shells=10,query=null}={}){
 const S={data:null,loading:null,holder:null,group:null,base:null,uWob:{value:new THREE.Vector3()},vel:new THREE.Vector3(),
  fast:0,slow:0,peak:.02,since:1,side:1,beats:0,armed:true,drive:0,phase:0,period:.5,amp:0,pick:null,mats:null,
  // jelly: the seam source's recent past (newest first, one sample per HSTEP), the jelly's own state, and shader uniforms
  uHist:{value:Array.from({length:32},()=>new THREE.Vector3())},uSeam:{value:[new THREE.Vector3(),new THREE.Vector3()]},uJel:{value:new THREE.Vector4(5.5,1.5,.35,0)},
  jel:new THREE.Vector3(),jelV:new THREE.Vector3(),src:new THREE.Vector3(),lastV:new THREE.Vector3(),acc:0,motion:0};
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
  body.setAttribute('aSoft',new THREE.BufferAttribute(softMask(body),1));
  body.computeBoundingSphere();body.computeBoundingBox();
  // the seams: the back of each hind leg's top, where leg turns into bum (from the clog positions the bake placed)
  h.clogs.forEach((c,i)=>{if(i<2)S.uSeam.value[i].set(c.p[0]+.35,1.1,c.p[2]);});
  const clog=geo('clog'),ao=arr('clog.ao'),c=new Float32Array(ao.length*3);
  // the original fed these grey AO values straight to its sRGB output: linearise them for ours
  for(let i=0;i<ao.length;i++)c[i*3]=c[i*3+1]=c[i*3+2]=srgb(ao[i]/255);
  clog.setAttribute('color',new THREE.BufferAttribute(c,3));clog.computeBoundingSphere();
  return {h,body,clog};
 }
 /* the soft part: the baked wobble weight, narrowed to the cheeks and the undercarriage behind
    the legs (the bake's cheek ellipsoids), so the back and flanks stay body-stiff */
 function softMask(g){
  const P=g.attributes.position,W=g.attributes.aWob,out=new Float32Array(P.count),C=1,Sn=0; // the bake's cheeks: level, mirrored about z=0
  const ss=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  for(let i=0;i<P.count;i++){const x=P.getX(i),y=P.getY(i),z=P.getZ(i),yl=(y-1.66)*C+z*Sn,zl=Math.abs(z*C-(y-1.66)*Sn);
   out[i]=W.getX(i)*ss(1.75,1.1,Math.hypot((x-1.27)/.6,yl/.68,(zl-.35)/.45))*ss(2.6,2.2,y);}
  return out;
 }
 /* ---------- jelly: ripples that start at the leg seams ----------
    uHist holds the seam source (the music spring plus the jelly's own ringing) for the last
    ~0.5 s. A point at distance d from a seam shows that source as it was d/speed ago, scaled
    by its softness and exp(-(d-0.5)/decay) past the first half unit: the wave leaves the
    seam, travels over the bum and dies out, and later kicks overlap earlier ones. Both seams add, so their rings cross. The wave
    moves the surface along with the source and pushes it away from the seam (a smooth
    direction, so the hard crease between the cheeks never folds); the slope of the wave
    tilts the normal so the ripple catches the light. */
 const HSTEP=1/60,HN=32;
 const JELLY_GLSL=`attribute float aSoft;uniform vec3 uHist[32];uniform vec3 uSeam[2];uniform vec4 uJel;
vec3 jelHist(float tau,out vec3 dv){float f=clamp(tau/${HSTEP.toFixed(8)}-uJel.w,0.0,30.999);int i=int(f);float a=f-float(i);
 vec3 h0=uHist[i],h1=uHist[i+1];dv=(h0-h1)/${HSTEP.toFixed(8)};return mix(h0,h1,a);}
vec3 jelly(vec3 p,vec3 n,inout vec3 nn){vec3 o=vec3(0.0);if(aSoft<=0.0)return o;vec3 g=vec3(0.0);
 for(int s=0;s<2;s++){vec3 r=p-uSeam[s];float d=max(length(r),1e-3);vec3 rh=r/d,dv;vec3 H=jelHist(d/uJel.x,dv);
  float e=0.65*aSoft*exp(-max(d-0.5,0.0)/uJel.y),b=dot(H,rh),rn=dot(rh,n);o+=e*(H+uJel.z*b*rh);
  g+=e*(-(dot(dv,n)+uJel.z*dot(dv,rh)*rn)/uJel.x-step(0.5,d)*(dot(H,n)+uJel.z*b*rn)/uJel.y)*(rh-n*rn);}
 nn=normalize(n-g);return o;}
`;
 /* ---------- fur: patched standard material per shell ---------- */
 const FUR_VS_HEAD=`attribute vec3 aCol;attribute vec2 aFx;uniform float uH,uLen;
varying vec3 vBase,vFurCol;varying vec2 vFx;
vec3 furLin(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
`+JELLY_GLSL;
 const FUR_FS_HEAD=`uniform float uH,uDens,uRim;varying vec3 vBase,vFurCol;varying vec2 vFx;
float furHash(vec3 p){p=fract(p*0.3183099+vec3(0.1,0.2,0.3));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float furVn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(furHash(i),furHash(i+vec3(1,0,0)),f.x),mix(furHash(i+vec3(0,1,0)),furHash(i+vec3(1,1,0)),f.x),f.y),
  mix(mix(furHash(i+vec3(0,0,1)),furHash(i+vec3(1,0,1)),f.x),mix(furHash(i+vec3(0,1,1)),furHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
 function furMaterial(h,furLen,shellCount){
  const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.92,metalness:0,alphaToCoverage:h>0});
  const u={uH:{value:h},uLen:{value:furLen},uDens:{value:120},uRim:{value:.5},uHist:S.uHist,uSeam:S.uSeam,uJel:S.uJel};
  m.onBeforeCompile=sh=>{Object.assign(sh.uniforms,u);
   sh.vertexShader=FUR_VS_HEAD+sh.vertexShader
    .replace('#include <beginnormal_vertex>',`vec3 furN=normalize(normal);vec3 comb=vec3(0.35,-1.0,0.0);comb-=furN*dot(comb,furN); // fur lies down and back
vec3 jelN=furN,jelO=jelly(position,furN,jelN);
vec3 objectNormal=normalize(jelN+comb*0.4*uH);`)
    .replace('#include <begin_vertex>',`float furL=uLen*aFx.x;vec3 transformed=position+(furN*uH+comb*0.5*uH*uH)*furL+jelO;
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
  m.onBeforeCompile=sh=>{Object.assign(sh.uniforms,{uHist:S.uHist,uSeam:S.uSeam,uJel:S.uJel});sh.vertexShader=JELLY_GLSL+sh.vertexShader.replace('#include <begin_vertex>','vec3 jelN=normalize(normal);vec3 transformed=position+jelly(position,jelN,jelN);');};
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
 /* ---------- what the record is doing under the needle ----------
    features(buffer,t) reads the decoded record signal itself in a ±35 ms window around
    the playhead (filters warmed up over the 105 ms before) and returns band levels:
    sub (<120 Hz, kicks), bass (120-320 Hz, the bass line), mid (320 Hz-2.2 kHz),
    high (>2.2 kHz, snare crack, claps, hats), low (sub+bass), plus a bass pitch estimate
    (zero crossings of the low band, Hz) and the left/right balance of the lows (stereo only). */
 function features(b,t){
  if(!b||!(t>=0))return null;
  const sr=b.sampleRate,L=b.getChannelData(0),st=b.numberOfChannels>1,R=st?b.getChannelData(1):L;
  const c=Math.floor(t*sr),n=Math.floor(sr*.035),i0=Math.max(0,c-3*n),i1=Math.min(L.length,c+n),iw=Math.max(i0,c-n);
  if(i1<=iw)return null;
  const k=f=>1-Math.exp(-2*Math.PI*f/sr),a1=k(120),a2=k(320),a3=k(2200);
  let p1=0,q1=0,p2=0,q2=0,p3=0,q3=0,pl=0,ql=0,pr=0,qr=0,eS=0,eB=0,eM=0,eH=0,eL=0,eR=0,m=0,zc=0,prev=0;
  for(let i=i0;i<i1;i++){
   const l=L[i],r=R[i],x=st?(l+r)*.5:l;
   p1+=a1*(x-p1);q1+=a1*(p1-q1);p2+=a2*(x-p2);q2+=a2*(p2-q2);p3+=a3*(x-p3);q3+=a3*(p3-q3);
   if(st){pl+=a2*(l-pl);ql+=a2*(pl-ql);pr+=a2*(r-pr);qr+=a2*(pr-qr);}
   if(i>=iw){const bb=q2-q1,mm=q3-q2,hh=x-q3;eS+=q1*q1;eB+=bb*bb;eM+=mm*mm;eH+=hh*hh;if(st){eL+=ql*ql;eR+=qr*qr;}
    if(m&&(q2>0)!==(prev>0))zc++;prev=q2;m++;}
  }
  const rm=v=>Math.sqrt(v/m),gl=Math.sqrt(eL),gr=Math.sqrt(eR);
  return {sub:rm(eS),bass:rm(eB),mid:rm(eM),high:rm(eH),low:rm(eS+eB),bal:st?(gr-gl)/(gr+gl+1e-9):0,pitch:zc*sr/(2*m)};
 }
 /* Wobble tuning (live-editable via .params, and from the URL: ?shibaAmp=1.6&shibaUD=0&shibaLR=1 ...)
    amp   overall strength            lr   side-to-side weight       ud   up-down weight
    mode  'react' (default) the music shapes the motion, see updateReact
          'fig8'  the earlier beat-locked figure-8 plus alternating kicks
          'alt'   alternating kicks only   'beat' every beat pokes both axes at once
    fig   sway strength: the slow lean that follows sustained bass ('react'), or the
          figure-8 drive between beats ('fig8')
    clamp largest offset (dog units)  chaos random shoves and looser damping (0..1)
    The soft bum (jelly):
    jelly  strength of the ripples (0 = a rigid bum)   seam  how much of the seam spring's own
           travel the wave carries (the rest of the look is the jelly ringing)
    hz     the jelly's ringing frequency (lower = softer)   damp  its damping ratio (lower = rings longer)
    speed  how fast ripples travel from the leg seam (dog units/s; 3.2..12)
    decay  how far they get before dying out (dog units)    bulge  how much each ripple swells the surface
    resist how firmly the bum pushes back against the seam spring's swing (extra damping, 0..1):
           0 is the earlier floaty feel, higher settles quicker with less overshoot */
 const DEFAULTS={amp:1.35,lr:1,ud:.85,mode:'react',fig:1,clamp:.55,chaos:0,jelly:1,seam:.65,hz:6,damp:.38,speed:5.5,decay:1.5,bulge:.35,resist:.5};
 const MODES=['react','fig8','alt','beat'];
 const P=Object.assign({},DEFAULTS);
 function setParams(o={}){for(const [k,v] of Object.entries(o)){if(!(k in DEFAULTS)||v==null||v==='')continue;P[k]=k==='mode'?String(v):Math.max(0,Number(v)||0);}
  if(!MODES.includes(P.mode))P.mode=DEFAULTS.mode;P.clamp=Math.min(1,Math.max(.05,P.clamp));P.chaos=Math.min(1,P.chaos);
  const lim=(k,a,b)=>{P[k]=Math.min(b,Math.max(a,P[k]));};lim('jelly',0,3);lim('seam',0,1);lim('hz',1,12);lim('damp',.02,1);lim('speed',3.2,12);lim('decay',.2,3);lim('resist',0,1);lim('bulge',0,1.5);
  S.uJel.value.set(P.speed,P.decay,P.bulge,S.uJel.value.w);return P;}
 // ?shibaAmp=1.6&shibaLR=0&shibaUD=1.6&shibaMode=beat ... (key case doesn't matter)
 function paramsFromQuery(q){const o={};if(!q)return o;for(const [key,v] of q){const m=/^shiba(.+)$/i.exec(key);if(!m)continue;const k=Object.keys(DEFAULTS).find(d=>d.toLowerCase()===m[1].toLowerCase());if(k)o[k]=v;}return o;}
 const tmpT=new THREE.Vector3();
 const env=(o,x,dt,up,down)=>o+(x-o)*Math.min(1,dt*(x>o?up:down));
 const BANDS=['sub','bass','mid','high'];
 const band=()=>({fast:0,med:0,slow:0,valley:0,peak:.004,flux:0,lvl:0,armed:true,since:1});
 function resetReact(){S.rx={sub:band(),bass:band(),mid:band(),high:band(),tot:0,totPeak:.006,act:0,rate:0,bal:0,pf:0,pmean:0,pprev:0,side:1,since0:0};}
 resetReact();
 // integrate the butt spring toward target T with per-axis stiffness K and damping C, soft stop at the clamp
 function spring(dt,T,Kx,Ky,Kz,Cx,Cy,Cz){
  const w=S.uWob.value,v=S.vel;
  for(let i=0;i<2;i++){const h=Math.min(dt,.05)/2;
   v.x+=(-Kx*(w.x-T.x)-Cx*v.x)*h;v.y+=(-Ky*(w.y-T.y)-Cy*v.y)*h;v.z+=(-Kz*(w.z-T.z)-Cz*v.z)*h;
   w.addScaledVector(v,h);
   if(w.length()>P.clamp){w.setLength(P.clamp);const nx=w.x/P.clamp,ny=w.y/P.clamp,nz=w.z/P.clamp,vn=v.x*nx+v.y*ny+v.z*nz;if(vn>0){v.x-=1.6*vn*nx;v.y-=1.6*vn*ny;v.z-=1.6*vn*nz;}}
   if(w.y<-.6){w.y=-.6;if(v.y<0)v.y*=-.3;} // the butt never sinks onto the felt puck, even at a big clamp
  }
 }
 /* 'react': no clock and no canned pattern; every move comes from the signal.
    - Each band has a fast and a slow envelope; a sharp rise of the fast one over its recent
      valley is a hit, and the hit's size sets the shove. Kicks (sub) jolt him up,
      snare/clap/hat crack (high) whips the butt sideways, mid hits nudge it back and sideways,
      and a new bass-line note pushes toward where the pitch moved (higher note: one side, lower: the other).
    - Sustained bass leans the butt: sideways by how far the bass pitch sits above or below
      its recent average (and toward the louder channel on stereo records), up or down as the
      low end swells or fades.
    - The spring itself follows the music: a busy, hit-heavy passage stiffens it (quick snaps),
      long held notes soften it (slow sway), and quiet passages raise the damping so he settles. */
 function updateReact(dt,f){
  const w=S.uWob.value,v=S.vel,X=S.rx,amp=P.amp,lr=P.lr,ud=P.ud,chaos=P.chaos,rnd=()=>Math.random()-.5;
  const playing=!!f&&(f.low+f.mid+f.high)>1e-5;
  for(const k of BANDS){const b=X[k],x=playing?f[k]:0;
   b.fast=env(b.fast,x,dt,45,12);b.med=env(b.med,x,dt,6,3);b.slow=env(b.slow,x,dt,.8,.8);
   b.valley=b.fast<b.valley?b.fast:b.valley+(b.fast-b.valley)*Math.min(1,dt*5);
   b.peak=Math.max(b.fast,b.peak*Math.exp(-dt/8),.004);
   b.flux=(b.fast-b.valley)/b.peak;b.lvl=b.fast/b.peak;b.since+=dt;if(b.flux<.03)b.armed=true;
  }
  const tot=Math.hypot(X.sub.med,X.bass.med,X.mid.med,X.high.med);X.totPeak=Math.max(tot,X.totPeak*Math.exp(-dt/10),.006);
  X.act=env(X.act,playing?Math.min(1,1.6*tot/X.totPeak):0,dt,4,1.6);   // relative loudness: quiet passages ~0
  X.rate*=Math.exp(-dt/1.5);X.bal=env(X.bal,playing?f.bal:0,dt,3,3);
  const hit=(b,thr,min)=>{if(b.armed&&b.flux>thr&&b.lvl>min&&b.since>.1){b.armed=false;b.since=0;X.rate++;S.beats++;return Math.min(1.5,.35+b.flux*2.2)*(.45+.55*Math.min(1,b.lvl));}return 0;};
  const across=()=>Math.abs(X.bal)>.12?Math.sign(X.bal):(Math.abs(w.z)>.02?-Math.sign(w.z):(X.side=-X.side));
  let s;
  if((s=hit(X.sub,.09,.25)))poke(.6*s*amp,6*s*amp*ud,1.4*s*amp*lr*(Math.sign(v.z||w.z)||X.side));              // kick: jolt up
  if((s=hit(X.high,.12,.25)))poke(.3*s*amp*rnd(),-.6*s*amp*ud,5.8*s*amp*lr*across());                            // crack: whip sideways
  if((s=hit(X.mid,.12,.3)))poke(1.1*s*amp,.8*s*amp*ud,2.8*s*amp*lr*across());                                     // mid hit: back and across
  // bass-line pitch: track it only while the low end is clearly sounding
  const lowLvl=(X.sub.lvl+X.bass.lvl)*.5;
  if(playing&&lowLvl>.25&&f.pitch>20&&f.pitch<500){X.pf=X.pf?env(X.pf,f.pitch,dt,10,10):f.pitch;X.pmean=X.pmean?env(X.pmean,X.pf,dt,.35,.35):X.pf;}
  if((s=hit(X.bass,.1,.3))){const d=X.pf-X.pprev,dir=Math.abs(d)>X.pf*.04?Math.sign(d):across();poke(.5*s*amp,2.2*s*amp*ud,3.2*s*amp*lr*dir);X.pprev=X.pf;}
  if(chaos>0&&X.since0!==S.beats){X.since0=S.beats;const a=amp*chaos;poke(3*a*rnd(),3.5*a*rnd(),5*a*rnd());}
  // sustained lean
  const sus=Math.min(1,.5*X.sub.med/X.sub.peak+.7*X.bass.med/X.bass.peak),pdev=X.pmean?Math.log2(X.pf/X.pmean):0;
  const g=P.fig*amp*X.act;
  tmpT.set(.06*g*(X.mid.med-X.mid.slow)/X.mid.peak,
   .14*g*X.act*ud*Math.max(-1,Math.min(1,2.5*(X.sub.med-X.sub.slow)/X.sub.peak+1.5*(X.bass.med-X.bass.slow)/X.bass.peak)),
   .26*g*lr*sus*Math.tanh(3*pdev+1.5*X.bal));
  // the spring follows the music: hit-heavy = stiff and snappy, held notes = soft and slow, quiet = damped
  const tr=Math.min(1,X.rate/3),zeta=(.2+.75*(1-X.act))*(1-.5*chaos)+.2*P.resist;
  const Kx=110+130*tr,Ky=150+220*tr,Kz=60+180*tr;
  spring(dt,tmpT,Kx,Ky,Kz,2*zeta*Math.sqrt(Kx),2*zeta*Math.sqrt(Ky),2*zeta*Math.sqrt(Kz));
  S.drive=X.act;S.amp=Math.max(S.amp*Math.exp(-dt*2),w.length());
  if(!playing&&X.act<1e-3&&w.lengthSq()+v.lengthSq()*.01<1e-9){w.set(0,0,0);v.set(0,0,0);}
  return w.lengthSq()+v.lengthSq()>0;
 }
 // the earlier beat-driven modes ('fig8', 'alt', 'beat'), driven by the low-band level alone
 function updateBeat(dt,bass){
  const w=S.uWob.value,v=S.vel;
  S.fast+=(bass-S.fast)*Math.min(1,dt*(bass>S.fast?40:10));
  // valley: drops with the envelope at once, climbs back slowly, so (fast - valley) is a note's attack
  S.slow=S.fast<S.slow?S.fast:S.slow+(S.fast-S.slow)*Math.min(1,dt*5);
  S.peak=Math.max(S.fast,S.peak*Math.exp(-dt/6),.004);
  const level=S.fast/S.peak,flux=(S.fast-S.slow)/S.peak;S.since+=dt;
  const playing=bass>1e-5,chaos=P.chaos,rnd=()=>Math.random()-.5;
  S.drive+=((playing?Math.min(1,level*1.3):0)-S.drive)*Math.min(1,dt*(playing?8:5));
  if(flux<.03)S.armed=true; // re-arm once the attack is over: one poke per note
  if(S.armed&&flux>.07&&level>.2&&S.since>.12){S.armed=false;
   if(S.since<1.2)S.period+=(Math.min(1,Math.max(.22,S.since))-S.period)*.35; // beat spacing, for the figure-8 tempo
   const a=Math.min(1.3,.5+flux*2)*P.amp,k=S.beats++;S.since=0;
   if(P.mode==='beat'){S.side=-S.side;poke(.35*a*S.side*P.lr,3.2*a*P.ud,4.4*a*S.side*P.lr);}
   else if(k%2===0)poke(.25*a*rnd()*P.lr,3.8*a*P.ud,.6*a*S.side*P.lr);              // kick: up-down bounce
   else{S.side=-S.side;poke(.45*a*S.side*P.lr,.7*a*P.ud,4.8*a*S.side*P.lr);}         // off-beat: side twerk
   if(chaos>0)poke(3*a*chaos*rnd(),3.5*a*chaos*rnd(),5*a*chaos*rnd());
   if(P.mode==='fig8')S.phase+=(Math.round(S.phase/Math.PI)*Math.PI-S.phase)*.5;   // lock the figure-8 to the beat
  }
  // figure-8 (Lissajous 1:2): one side lobe and one bounce per beat, scaled by the bass level
  S.phase+=dt*Math.PI/Math.max(.22,S.period);
  const f=P.mode==='fig8'?S.drive*P.amp*P.fig:0;
  tmpT.set(0,.13*f*P.ud*Math.sin(2*S.phase),.2*f*P.lr*Math.sin(S.phase));
  const damp=(1-.55*chaos)*(1+.6*P.resist);
  spring(dt,tmpT,260,330,200,7*damp,7*damp,6*damp);
  S.amp=Math.max(S.amp*Math.exp(-dt*2),w.length());
  if(!playing&&S.drive<1e-3&&w.lengthSq()+v.lengthSq()*.01<1e-9){w.set(0,0,0);v.set(0,0,0);}
  return w.lengthSq()+v.lengthSq()>0;
 }
 /* The soft bum, stepped after the seam spring each frame. The jelly is a much softer spring
    (hz, damp) carried by the seam: a jolt of the seam leaves it behind (its inertia), so it
    overshoots and rings on its own. The source sent down the wave is part of the seam's travel
    plus that ringing, its speed limited so a ripple's slope stays under 0.75 where the two seams'
    waves stack (a slope of 1 would fold the surface), sampled at a
    fixed 60 Hz into uHist; uJel.w is the time since the newest sample, so the wave glides
    between samples at any frame rate. */
 const tmpJ=new THREE.Vector3();
 function jellyStep(dt){
  const j=S.jel,jv=S.jelV,src=S.src,H=S.uHist.value,v=S.vel,w=S.uWob.value,g=P.jelly;
  tmpJ.subVectors(v,S.lastV);S.lastV.copy(v);jv.addScaledVector(tmpJ,-.24*g);   // the seam jolts, the soft mass lags
  const om=2*Math.PI*P.hz,K=om*om,C=2*P.damp*om,n=Math.max(1,Math.ceil(dt/.004)),h=dt/n,jmax=.1*Math.max(g,.01);
  for(let i=0;i<n;i++){jv.x+=(-K*j.x-C*jv.x)*h;jv.y+=(-K*j.y-C*jv.y)*h;jv.z+=(-K*j.z-C*jv.z)*h;j.addScaledVector(jv,h);}
  if(j.length()>jmax){j.setLength(jmax);}
  S.acc+=dt;
  while(S.acc>=HSTEP){S.acc-=HSTEP;
   tmpJ.copy(w).multiplyScalar(P.seam*g).add(j).sub(src);const vmax=.75*P.speed*HSTEP/(1.3*(1+P.bulge));if(tmpJ.length()>vmax)tmpJ.setLength(vmax);src.add(tmpJ);const cap=.51/(1+P.bulge);if(src.length()>cap)src.setLength(cap);
   const last=H[HN-1];for(let i=HN-1;i>0;i--)H[i]=H[i-1];H[0]=last.copy(src);}
  S.uJel.value.w=S.acc/HSTEP;
  let m=0;for(const x of H)m+=x.lengthSq();S.motion=Math.sqrt(m)+j.length()*3+jv.length()*.01;
  if(S.motion<2e-5&&w.lengthSq()<1e-12){jellyRest();return false;}
  return true;
 }
 // the same field as JELLY_GLSL, on the CPU (tests, and anything that needs where a bum point is now)
 function jellyAt(p,n,soft,out=new THREE.Vector3()){
  out.set(0,0,0);if(!(soft>0))return out;const H=S.uHist.value,J=S.uJel.value;
  for(const sm of S.uSeam.value){const rx=p.x-sm.x,ry=p.y-sm.y,rz=p.z-sm.z,d=Math.max(Math.hypot(rx,ry,rz),1e-3);
   const f=Math.min(30.999,Math.max(0,d/J.x/HSTEP-J.w)),i=Math.floor(f),a=f-i,h0=H[i],h1=H[i+1];
   const hx=h0.x+(h1.x-h0.x)*a,hy=h0.y+(h1.y-h0.y)*a,hz=h0.z+(h1.z-h0.z)*a,e=.65*soft*Math.exp(-Math.max(d-.5,0)/J.y),b=(hx*rx+hy*ry+hz*rz)/d;
   out.x+=e*(hx+J.z*b*rx/d);out.y+=e*(hy+J.z*b*ry/d);out.z+=e*(hz+J.z*b*rz/d);}
  return out;
 }
 function jellyRest(){S.jel.set(0,0,0);S.jelV.set(0,0,0);S.src.set(0,0,0);S.lastV.copy(S.vel);for(const x of S.uHist.value)x.set(0,0,0);S.motion=0;S.acc=0;S.uJel.value.w=0;}
 /* update(dt, music, still): music is features(...) (or null when the needle is up),
    or a bare low-band level number for the beat modes. */
 function update(dt,music,still){
  const w=S.uWob.value,v=S.vel;
  if(still){w.set(0,0,0);v.set(0,0,0);S.fast=S.slow=S.drive=0;resetReact();jellyRest();return false;}
  const f=typeof music==='number'?{low:music,sub:music,bass:0,mid:0,high:0,bal:0,pitch:0}:music;
  const seam=P.mode==='react'?updateReact(dt,f):updateBeat(dt,f?f.low:0);
  return jellyStep(dt)||seam;
 }
 function fromBuffer(buf){S.data=decode(buf);S.loading=Promise.resolve(true);return attach();}
 setParams(paramsFromQuery(query));
 return {load,fromBuffer,mount,update,features,poke,attach,detail,setParams,get params(){return P;},defaults:DEFAULTS,get state(){return S;},get wob(){return S.uWob.value;},get motion(){return S.motion;},jellyAt,get ripple(){const H=S.uHist.value;return S.motion?H[0].x*3+H[0].y*5+H[0].z*7+H[6].x*11+H[6].y*13+H[6].z*17+H[14].x*19+H[14].y*23+H[14].z*29+S.uJel.value.w*.01:0;},get pickMesh(){return S.pick;},get loaded(){return !!S.data;}};
}
