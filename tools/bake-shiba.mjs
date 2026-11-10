// Bakes the "Shiba in Clogs" toy (an SDF dog by Garyck Arntzen) into static/shiba.bin
// for the player's cabinet: the page loads these meshes instead of running the
// surface-nets build at start-up. Run from the repo root: node tools/bake-shiba.mjs [bodyStep=0.028] [clogStep=0.011]
// The SDF, paint and clog code below is the original page's, unchanged.
import * as T from '../static/vendor/three/three.module.min.js';
import fs from 'node:fs';
T.ColorManagement.enabled=false; // paint mixes raw sRGB values, exactly as the r128 original did
const STEP=+(process.argv[2]||0.028), CLOG_STEP=+(process.argv[3]||0.011);
const smooth = (a,b,x)=>{const t=Math.min(Math.max((x-a)/(b-a),0),1);return t*t*(3-2*t);};
const lerp = (a,b,t)=>a+(b-a)*t;
const pl = (x,p)=>{ if(x<=p[0][0])return p[0][1]; for(let i=1;i<p.length;i++) if(x<=p[i][0]){const t=(x-p[i-1][0])/(p[i][0]-p[i-1][0]);return lerp(p[i-1][1],p[i][1],t);} return p[p.length-1][1]; };
const hash3=(i,j,k)=>{const n=Math.sin(i*127.1+j*311.7+k*74.7)*43758.5453;return n-Math.floor(n);};
function vnoise(x,y,z){
  const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z),fx=x-i,fy=y-j,fz=z-k;
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),w=fz*fz*(3-2*fz);
  return lerp(lerp(lerp(hash3(i,j,k),hash3(i+1,j,k),u),lerp(hash3(i,j+1,k),hash3(i+1,j+1,k),u),v),
              lerp(lerp(hash3(i,j,k+1),hash3(i+1,j,k+1),u),lerp(hash3(i,j+1,k+1),hash3(i+1,j+1,k+1),u),v),w);
}

// ---------- SDF primitives ----------
function ell(x,y,z,cx,cy,cz,rx,ry,rz){
  const ax=(x-cx)/rx,ay=(y-cy)/ry,az=(z-cz)/rz, k0=Math.sqrt(ax*ax+ay*ay+az*az);
  if(k0<1e-6) return -Math.min(rx,ry,rz);
  const bx=ax/rx,by=ay/ry,bz=az/rz; return k0*(k0-1)/Math.sqrt(bx*bx+by*by+bz*bz);
}
function rc(px,py,pz, ax,ay,az, bx,by,bz, r1,r2){   // round cone a(r1) -> b(r2)
  const bax=bx-ax,bay=by-ay,baz=bz-az, l2=bax*bax+bay*bay+baz*baz, rr=r1-r2, a2=l2-rr*rr, il2=1/l2;
  const pax=px-ax,pay=py-ay,paz=pz-az, y=pax*bax+pay*bay+paz*baz, z=y-l2;
  const qx=pax*l2-bax*y,qy=pay*l2-bay*y,qz=paz*l2-baz*y, x2=qx*qx+qy*qy+qz*qz, y2=y*y*l2, z2=z*z*l2;
  const k=Math.sign(rr)*rr*rr*x2;
  if(Math.sign(z)*a2*z2>k) return Math.sqrt(x2+z2)*il2-r2;
  if(Math.sign(y)*a2*y2<k) return Math.sqrt(x2+y2)*il2-r1;
  return (Math.sqrt(x2*a2*il2)+y*rr)*il2-r1;
}
const smin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*0.25;};
const smax=(a,b,k)=>-smin(-a,-b,k);

// ---------- Head frame: turned slightly toward its left (+z) and nodding down ----------
const HEAD_YAW=0.5, HEAD_PITCH=0.18, HS=0.93;
const HC = new T.Vector3(-0.06,3.32,0);
const cyw=Math.cos(HEAD_YAW), syw=Math.sin(HEAD_YAW), cpt=Math.cos(HEAD_PITCH), spt=Math.sin(HEAD_PITCH);
let hx=0,hy=0,hz=0;
function toHead(x,y,z,dir){ if(!dir){x=(x-HC.x)/HS;y=(y-HC.y)/HS;z=(z-HC.z)/HS;} const x1=x*cyw-z*syw; hz=x*syw+z*cyw; hx=x1*cpt+y*spt; hy=-x1*spt+y*cpt; }
function fromHead(x,y,z,dir){ const x1=x*cpt-y*spt, y1=x*spt+y*cpt; const v=new T.Vector3(x1*cyw+z*syw, y1, -x1*syw+z*cyw); return dir?v:v.multiplyScalar(HS).add(HC); }
// ear frame (head-local, mirrored through |z|)
const EB=new T.Vector3(0.1,0.3,0.37), EV=new T.Vector3(-0.06,1,0.16).normalize();
const EW=new T.Vector3(-0.75,0,0.66); EW.addScaledVector(EV,-EW.dot(EV)).normalize();
const EU=new T.Vector3().crossVectors(EV,EW);
const EAR_W=0.175, EAR_H=0.31, EAR_HYP=Math.hypot(EAR_W,EAR_H);

// ---------- Body SDF (dog faces -x, y up) ----------
const HIP_ROLL=0.36, HIP_C=Math.cos(HIP_ROLL), HIP_S=Math.sin(HIP_ROLL);
const LEG_X = [0.53, 0.27];             // near (+z) leg, far (-z) leg
let gT=9,gArm=9,gLeg=9,gHead=9,gEar=9,gEu=0,gEv=0,gEw=0;
function sdBody(x,y,z){
  const az=Math.abs(z);
  let d=rc(x,y,z, 0,1.45,0, 0.05,2.85,0, 0.7,0.59);                       // upright tube, tapering to the neck
  d=smin(d, ell(x,y,z,-0.05,1.55,0, 0.68,0.82,0.69),0.2);                 // belly
  if(x>-0.3 && y<3.0){
    d=smin(d, ell(x,y,z,0.7,1.6,0, 0.64,0.8,0.68),0.3);                   // hip bridge (arched back dips above this)
    const yl=(y-1.66)*HIP_C+z*HIP_S, zl=Math.abs(z*HIP_C-(y-1.66)*HIP_S);
    d=smin(d, ell(x,yl,zl,1.27,0,0.35, 0.6,0.68,0.45),0.22);              // butt cheeks, hips rolled, hard crease between
  }
  gT=d;
  gLeg=9;
  if(y<1.6){ const lx=z>0?LEG_X[0]:LEG_X[1]; gLeg=rc(x,y,az, lx+0.03,1.12,0.32, lx,0.22,0.32, 0.2,0.11); d=smin(d,gLeg,0.1); }
  gArm=9;
  if(y>0.8 && y<2.4 && az>0.3){
    let a=rc(x,y,az, 0.0,2.0,0.63, 0.04,1.55,0.77, 0.11,0.09);
    a=smin(a, rc(x,y,az, 0.04,1.55,0.77, -0.05,1.17,0.8, 0.088,0.075),0.03);
    a=smin(a, ell(x,y,az,-0.09,1.08,0.8, 0.1,0.085,0.09),0.04);
    for(let t=-1;t<=1;t++) a=smin(a, ell(x,y,az,-0.165-0.01*(1-Math.abs(t)),1.035,0.8+t*0.052, 0.045,0.04,0.034),0.012);
    gArm=a; d=smin(d,a,0.05);
  }
  gHead=9; gEar=9;
  if(y>2.3){
    toHead(x,y,z); const haz=Math.abs(hz);
    let h=ell(hx,hy,hz, 0,0,0, 0.6,0.57,0.6);
    h=smin(h, ell(hx,hy,hz,-0.4,-0.04,0, 0.3,0.22,0.3),0.1);              // stop / bridge
    h=smin(h, ell(hx,hy,hz,-0.62,-0.17,0, 0.42,0.21,0.25),0.1);             // muzzle
    h=smin(h, ell(hx,hy,hz,-0.56,-0.32,0, 0.33,0.11,0.2),0.05);           // lower jaw
    h=smin(h, ell(hx,hy,haz,-0.2,-0.24,0.36, 0.36,0.32,0.3),0.15);       // fluffy cheeks
    const qx=hx-EB.x,qy=hy-EB.y,qz=haz-EB.z;
    gEu=qx*EU.x+qy*EU.y+qz*EU.z; gEv=qx*EV.x+qy*EV.y+qz*EV.z; gEw=qx*EW.x+qy*EW.y+qz*EW.z;
    const tri=Math.max((Math.abs(gEu)*EAR_H+gEv*EAR_W-EAR_W*EAR_H)/EAR_HYP, -gEv-0.12);
    let e=smax(tri+0.02, Math.abs(gEw)-0.012, 0.03)-0.045;
    e=smax(e, -ell(gEu,gEv,gEw, 0,0.14,0.075, 0.1,0.18,0.055), 0.025);     // scooped front
    gEar=e*HS; gHead=smin(h,e,0.06)*HS;
    d=smin(d,gHead,0.22);
  }
  return d;
}


// ---------- Surface nets (positions + normals + index) ----------
function surfaceNets(f, min, max, h){
  const nx=Math.ceil((max[0]-min[0])/h)+1, ny=Math.ceil((max[1]-min[1])/h)+1, nz=Math.ceil((max[2]-min[2])/h)+1;
  const V=new Float32Array(nx*ny*nz), I=(i,j,k)=>i+nx*(j+ny*k);
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++) V[I(i,j,k)]=f(min[0]+i*h,min[1]+j*h,min[2]+k*h);
  const vid=new Int32Array(nx*ny*nz).fill(-1), pos=[], nor=[], idx=[];
  const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const e=1e-3, d=new Float32Array(8);
  for(let k=0;k<nz-1;k++)for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    let neg=0; for(let c=0;c<8;c++){ d[c]=V[I(i+corners[c][0],j+corners[c][1],k+corners[c][2])]; if(d[c]<0) neg++; }
    if(neg===0||neg===8) continue;
    let sx=0,sy=0,sz=0,n=0;
    for(const [a,b] of edges){ if((d[a]<0)!==(d[b]<0)){ const t=d[a]/(d[a]-d[b]);
      sx+=corners[a][0]+t*(corners[b][0]-corners[a][0]); sy+=corners[a][1]+t*(corners[b][1]-corners[a][1]); sz+=corners[a][2]+t*(corners[b][2]-corners[a][2]); n++; } }
    const x=min[0]+(i+sx/n)*h, y=min[1]+(j+sy/n)*h, z=min[2]+(k+sz/n)*h;
    vid[I(i,j,k)]=pos.length/3; pos.push(x,y,z);
    const gx=f(x+e,y,z)-f(x-e,y,z), gy=f(x,y+e,z)-f(x,y-e,z), gz=f(x,y,z+e)-f(x,y,z-e), L=Math.hypot(gx,gy,gz)||1;
    nor.push(gx/L,gy/L,gz/L);
  }
  const quad=(a,b,c,d,flip)=>{ if(a<0||b<0||c<0||d<0)return; flip?idx.push(a,c,b,a,d,c):idx.push(a,b,c,a,c,d); };
  for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++)for(let i=1;i<nx-1;i++){
    const in0=V[I(i,j,k)]<0;
    if(in0!==(V[I(i+1,j,k)]<0)) quad(vid[I(i,j-1,k-1)],vid[I(i,j,k-1)],vid[I(i,j,k)],vid[I(i,j-1,k)],!in0);
    if(in0!==(V[I(i,j+1,k)]<0)) quad(vid[I(i-1,j,k-1)],vid[I(i-1,j,k)],vid[I(i,j,k)],vid[I(i,j,k-1)],!in0);
    if(in0!==(V[I(i,j,k+1)]<0)) quad(vid[I(i-1,j-1,k)],vid[I(i,j-1,k)],vid[I(i,j,k)],vid[I(i-1,j,k)],!in0);
  }
  return {pos:new Float32Array(pos),nor:new Float32Array(nor),idx};
}
// crease darkening baked from the field itself
function bakeAO(f,x,y,z,nx,ny,nz){
  let o=0; const D=[0.05,0.13,0.28], W=[0.4,0.35,0.25];
  for(let i=0;i<3;i++){ const d=D[i]; o+=W[i]*Math.max(0,d-f(x+nx*d,y+ny*d,z+nz*d))/d; }
  return 1-0.85*Math.min(1,o);
}
const sdGrad=(p,e=1e-3)=>new T.Vector3(sdBody(p.x+e,p.y,p.z)-sdBody(p.x-e,p.y,p.z),sdBody(p.x,p.y+e,p.z)-sdBody(p.x,p.y-e,p.z),sdBody(p.x,p.y,p.z+e)-sdBody(p.x,p.y,p.z-e)).normalize();
function hit(o,d){ d=d.clone().normalize(); const p=o.clone(); for(let t=0;t<3;t+=0.002){ p.copy(o).addScaledVector(d,t); if(sdBody(p.x,p.y,p.z)>0) break; } return [p,sdGrad(p)]; }
function stick(mesh,o,d,inset=0){ const [p,n]=hit(o,d); mesh.position.copy(p).addScaledVector(n,-inset); mesh.lookAt(p.clone().add(n)); return [p,n]; }

// ---------- Face anchor points (needed by the paint pass) ----------
const MC = fromHead(-0.62,-0.17,0);
const eyeDir = s=>fromHead(-0.76,0.15,0.5*s,true);
const eyeP = [1,-1].map(s=>hit(HC,eyeDir(s))[0]);
const noseP = hit(MC,fromHead(-1,0.1,0,true))[0];

// ---------- Coat colours (sRGB, fed straight to the fur shader) ----------
const K = h=>new T.Color(h);
const TAN=K(0xd49651), DEEP=K(0xb56c2c), CREAM=K(0xfbe6d3), BEIGE=K(0xcfa782), SOCK=K(0xeccdae), DARK=K(0x24160f), PINK=K(0xa98a88), GREY=K(0xa89c94), LIGHTTAN=K(0xe0a868);
const tmpC=new T.Color();
function paint(v,n){          // -> [colour, furLength, wobbleWeight]
  sdBody(v.x,v.y,v.z);
  const tT=gT,tArm=gArm,tLeg=gLeg,tHead=gHead,tEar=gEar,eu=gEu,ev=gEv;
  const n1=vnoise(v.x*4.5,v.y*4.5,v.z*4.5)-0.5, n2=vnoise(v.x*13,v.y*13,v.z*13)-0.5;
  const az=Math.abs(v.z);
  // --- body ---
  const phi=Math.atan2(az,-v.x);                                   // 0 = chest, pi = spine
  const phi0=pl(v.y,[[1.0,2.0],[1.5,1.72],[2.2,1.32],[2.85,1.1]]);
  let cream=smooth(phi0+0.2,phi0-0.2,phi+n1*0.45);
  cream=Math.max(cream, smooth(-0.25,-0.8,n.y)*smooth(0.8,0.4,v.x)*smooth(1.35,1.0,v.y));
  const c=TAN.clone();
  c.lerp(DEEP, 0.7*smooth(1.9,2.8,phi)*smooth(1.7,2.3,v.y));       // richer saddle down the back of the neck
  const rump=smooth(0.85,1.5,v.x);
  c.lerp(BEIGE, 0.72*rump+0.2*rump*n1);
  c.lerp(CREAM, 0.45*smooth(0.32,0.05,Math.hypot(v.x-1.6,v.y-1.72,v.z-0.5)));
  c.lerp(CREAM, cream);
  let len=lerp(1.0,0.85,rump);
  if(tLeg<0.05 && v.y<1.1){ const w=smooth(1.1,0.9,v.y); c.lerp(tmpC.copy(TAN).lerp(DEEP,0.35+n1*0.3),w); len=lerp(len,0.45,w); }
  if(tArm<0.04){
    const w=smooth(0.04,0.0,tArm);
    c.lerp(tmpC.copy(TAN).lerp(SOCK, smooth(1.75,1.3,v.y+n1*0.15)), w);
    len=lerp(len, lerp(0.55,0.22,smooth(1.4,1.1,v.y)), w);
  }
  // --- head ---
  const wH=smooth(0.1,-0.06,tHead-tT);
  if(wH>0){
    toHead(v.x,v.y,v.z); const lx=hx,ly=hy,lz=hz,alz=Math.abs(lz);
    toHead(n.x,n.y,n.z,true); const nlx=hx,nly=hy,nlz=hz*Math.sign(lz||1);
    const hc=TAN.clone();
    hc.lerp(DEEP,0.3*smooth(0.15,0.5,ly)*smooth(0.45,0.1,alz));                       // darker crown stripe
    hc.lerp(LIGHTTAN,0.5*smooth(-0.4,-0.7,lx)*smooth(-0.1,0.05,ly));                // paler nose bridge
    const yb=pl(lx,[[-1.0,-0.13],[-0.5,-0.09],[-0.33,0.0],[-0.05,-0.08],[0.3,-0.5]]);
    let fc=smooth(yb+0.07,yb-0.07,ly+n1*0.1)*smooth(0.45,0.2,lx);
    fc=Math.max(fc, 0.22*smooth(0.09,0.04,Math.hypot(lx+0.5,(ly-0.3)*1.3,alz-0.2)));  // faint brow spots
    hc.lerp(CREAM,fc);
    hc.lerp(GREY,0.55*smooth(-0.72,-0.95,lx)*smooth(-0.08,-0.2,ly));                   // whisker pad
    let hl=lerp(0.6,0.95,smooth(-0.05,-0.25,ly)*smooth(-0.5,-0.3,lx));                // fluffier cheeks
    hl=lerp(hl,0.2,smooth(-0.38,-0.6,lx));                                           // short muzzle fur
    for(const p of eyeP){
      toHead(v.x-p.x,v.y-p.y,v.z-p.z,true); const de=Math.hypot(hx*0.7,hy*1.7,hz*0.7);
      hc.lerp(DARK,0.9*smooth(0.115,0.07,de)); hl*=smooth(0.06,0.16,de);
    }
    const dn=v.distanceTo(noseP); hc.lerp(DARK,smooth(0.16,0.1,dn)); hl*=smooth(0.09,0.2,dn);
    if(tEar<0.05){
      const w=smooth(0.05,0.0,tEar), inner=smooth(0.15,0.5,nlx*EW.x+nly*EW.y+nlz*EW.z)*smooth(0.0,0.08,ev)*smooth(EAR_W*0.95,EAR_W*0.4,Math.abs(eu)+ev*0.35);
      hc.lerp(tmpC.copy(TAN).lerp(DEEP,0.35).lerp(PINK,inner).lerp(DARK,inner*0.25*smooth(0.2,0.05,ev)), w);
      hl=lerp(hl,lerp(0.3,0.1,inner),w);
    }
    c.lerp(hc,wH); len=lerp(len,hl,wH);
  }
  c.multiplyScalar(1+n2*0.1+n1*0.06);
  const wob=smooth(0.7,1.35,v.x)*smooth(0.85,1.15,v.y)*smooth(0.0,0.08,tLeg);
  return [c,len,wob];
}

// ---------- Clogs (one-piece moulded shell, also meshed from an SDF) ----------
const DOME=[-0.07,0.06,0, 0.345,0.3,0.205], HOLES=[];
for(const [th,n,spread] of [[0.3,3,0.9],[0.56,4,1.0],[0.82,5,1.05]]) for(let k=0;k<n;k++){
  const a=(k/(n-1)-0.5)*2*spread, d=[-Math.sin(th)*Math.cos(a), Math.cos(th), Math.sin(th)*Math.sin(a)];
  const p=[DOME[0]+d[0]*DOME[3], DOME[1]+d[1]*DOME[4], DOME[2]+d[2]*DOME[5]];
  const nr=new T.Vector3(d[0]/DOME[3],d[1]/DOME[4],d[2]/DOME[5]).normalize();
  HOLES.push([p[0],p[1],p[2],nr.x,nr.y,nr.z]);
}
function sdClog(x,y,z){
  const az=Math.abs(z);
  const wHalf=0.175+0.03*smooth(0.25,-0.25,x), sx=Math.max(-0.21,Math.min(0.2,x));
  const d2=Math.hypot(x-sx,z)-wHalf;
  const top=0.075+0.035*smooth(-0.15,0.3,x);
  const sole=Math.max(d2+0.02, Math.abs(y-top/2)-top/2+0.02)-0.02;
  let up=smin(ell(x,y,z,DOME[0],DOME[1],DOME[2],DOME[3],DOME[4],DOME[5]), ell(x,y,z,0.1,0.06,0, 0.29,0.2,0.2),0.05);
  let sh=Math.max(up, -Math.max(up+0.03, top-0.01-y));                    // hollow shell above the footbed
  sh=smax(sh, -ell(x,y,z,0.2,0.48,0, 0.28,0.3,0.4),0.02);                // foot opening
  sh=Math.max(sh,-y);
  if(y>0.14 && x<0.02 && up>-0.07) for(const h of HOLES){
    const px=x-h[0],py=y-h[1],pz=z-h[2], t=px*h[3]+py*h[4]+pz*h[5];
    if(Math.abs(t)<0.09) sh=smax(sh, 0.021-Math.hypot(px-h[3]*t,py-h[4]*t,pz-h[5]*t),0.008);
  }
  for(const cx of [-0.3,-0.19,-0.08,0.03])                                 // side vents
    sh=smax(sh, -(Math.max(Math.abs(x-cx)-0.022,Math.abs(y-0.137)-0.016,0.1-az)-0.01),0.008);
  let d=smin(sole,sh,0.012);
  d=smin(d, Math.max(ell(x,y,z,DOME[0],DOME[1],DOME[2],DOME[3]+0.012,DOME[4]+0.012,DOME[5]+0.012), Math.abs(y-0.105)-0.012),0.01); // rand
  return d;
}

// ---------- Bake ----------
const t0=Date.now();
const body=surfaceNets(sdBody,[-1.2,0.05,-0.95],[2.05,4.1,0.95],STEP);
const NB=body.pos.length/3;
const col=new Uint8Array(NB*3), fx=new Uint8Array(NB*2), wob=new Uint8Array(NB);
{ const v=new T.Vector3(), n=new T.Vector3(), q=x=>Math.max(0,Math.min(255,Math.round(x*255)));
  for(let i=0;i<NB;i++){
    v.fromArray(body.pos,i*3); n.fromArray(body.nor,i*3);
    const [c,len,w]=paint(v,n);
    col[i*3]=q(c.r); col[i*3+1]=q(c.g); col[i*3+2]=q(c.b);
    fx[i*2]=q(len); fx[i*2+1]=q(bakeAO(sdBody,v.x,v.y,v.z,n.x,n.y,n.z)); wob[i]=q(w);
  } }
// face parts: [kind, position, quaternion, scale]
const parts=[];
const pose=(o,kind,mat,extra={})=>parts.push({kind,mat,p:o.position.toArray().map(r6),q:o.quaternion.toArray().map(r6),s:o.scale.toArray().map(r6),...extra});
const r6=x=>Math.round(x*1e6)/1e6;
{ const o=new T.Object3D(); stick(o, MC, fromHead(-1,0.1,0,true), 0.055); o.scale.set(1.15,0.8,0.8); pose(o,'nose','black'); }
[1,-1].forEach(s=>{ const o=new T.Object3D(); stick(o, HC, eyeDir(s), 0.006); o.scale.set(0.088,0.026,0.014); o.rotateZ(0.3*s); pose(o,'eye','black'); });
const tubes=[];
{ const pts=[];
  const at=(t,s)=>{ const a=t*0.95, el=pl(t,[[0,-0.3],[0.55,-0.4],[1,-0.2]]);
    const [p,n]=hit(MC, fromHead(-Math.cos(a)*Math.cos(el), Math.sin(el), s*Math.sin(a)*Math.cos(el), true)); return p.addScaledVector(n,0.004); };
  for(let t=1;t>0;t-=0.1) pts.push(at(t,-1));
  for(let t=0;t<=1.001;t+=0.1) pts.push(at(t,1));
  tubes.push({pts:pts.flatMap(p=>p.toArray().map(r6)),seg:60,r:0.011});
  const [np]=hit(MC, fromHead(-1,-0.12,0,true));
  tubes.push({pts:[noseP.clone(),np,at(0,1)].flatMap(p=>p.toArray().map(r6)),seg:8,r:0.011});
}
const claws=[];
for(const s of [1,-1]) for(let t=-1;t<=1;t++) claws.push([-0.215,1.0,(0.8+t*0.052)*s].map(r6));
const tBody=Date.now()-t0;
const clog=surfaceNets(sdClog,[-0.48,-0.04,-0.27],[0.46,0.44,0.27],CLOG_STEP);
const NC=clog.pos.length/3, ccol=new Uint8Array(NC);
for(let i=0;i<NC;i++){ const p=clog.pos, n=clog.nor;
  const ao=bakeAO(sdClog,p[i*3],p[i*3+1],p[i*3+2],n[i*3],n[i*3+1],n[i*3+2]);
  const k=(0.35+0.65*ao)*(0.9+0.1*smooth(0.0,0.12,p[i*3+1]));
  ccol[i]=Math.round(Math.max(0,Math.min(1,k*k))*255); }
const clogs=[1,-1].map((s,i)=>({p:[LEG_X[i]-0.15,0,0.32*s].map(r6),ry:-0.05*s,scale:1.22}));

// ---------- Pack: JSON header + 4-byte aligned blocks ----------
const blocks=[], meta={};
function quantPos(pos){ let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];
  for(let i=0;i<pos.length;i++){const a=i%3; mn[a]=Math.min(mn[a],pos[i]); mx[a]=Math.max(mx[a],pos[i]);}
  const q=new Uint16Array(pos.length); for(let i=0;i<pos.length;i++){const a=i%3; q[i]=Math.round((pos[i]-mn[a])/(mx[a]-mn[a]||1)*65535);}
  return {q,min:mn.map(r6),max:mx.map(r6)}; }
const quantNor=nor=>Int8Array.from(nor,x=>Math.round(Math.max(-1,Math.min(1,x))*127));
function add(name,arr){ blocks.push({name,arr}); }
function mesh(name,g,attrs){ const qp=quantPos(g.pos); add(name+'.pos',qp.q); add(name+'.nor',quantNor(g.nor));
  const idx=(g.pos.length/3)>65535?Uint32Array.from(g.idx):Uint16Array.from(g.idx); add(name+'.idx',idx);
  for(const [k,v] of Object.entries(attrs)) add(name+'.'+k,v);
  meta[name]={count:g.pos.length/3,min:qp.min,max:qp.max,index:idx.length}; }
mesh('body',body,{col,fx,wob}); mesh('clog',clog,{ao:ccol});
const layout={}; let off=0;
for(const b of blocks){ off=(off+3)&~3; layout[b.name]={offset:off,type:b.arr.constructor.name,length:b.arr.length}; off+=b.arr.byteLength; }
const header={format:'shiba-toy-v1',step:STEP,clogStep:CLOG_STEP,units:'dog-local (y up, faces -x)',meshes:meta,layout,parts,tubes,claws,clogs,
  furLen:0.042,credit:'Shiba in Clogs, Garyck Arntzen'};
let hj=Buffer.from(JSON.stringify(header)); const pad=(4-((8+hj.length)%4))%4; hj=Buffer.concat([hj,Buffer.alloc(pad,32)]);
const out=Buffer.alloc(8+hj.length+off); out.write('SHB1',0); out.writeUInt32LE(hj.length,4); hj.copy(out,8);
const base=8+hj.length; for(const b of blocks) Buffer.from(b.arr.buffer,b.arr.byteOffset,b.arr.byteLength).copy(out,base+layout[b.name].offset);
fs.writeFileSync(new URL('../static/shiba.bin',import.meta.url),out);
console.log(JSON.stringify({step:STEP,bodyVerts:NB,bodyTris:body.idx.length/3,clogVerts:NC,clogTris:clog.idx.length/3,bytes:out.length,bodyMs:tBody,totalMs:Date.now()-t0}));
