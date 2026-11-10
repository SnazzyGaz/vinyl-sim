/* The player's disc shading: the record's own groove surface, as a small texture the vinyl shader
   reads (view.js). It does not store heights. The cut is one V groove of the metadata's depth and
   width round a spiral, so the surface is fixed by where the groove's centre sits at each point
   along it. That is stored per turn (rows) and per 1/A of a revolution (columns), as four moments
   over each texel's stretch of groove:
     r  E[c]    c  = the centre's offset from the nominal spiral, mm (+ toward the rim)
     g  E[c²]      (its spread inside the texel: the groove wanders across a pixel)
     b  E[c']   c' = dc/ds, ds = mm along the groove (how far the walls turn toward the tangent)
     a  E[c'²]
   plus a 1-D mip chain of the same moments per turn (box pairs; moments average exactly), packed
   beside it, so the shader filters to any pixel footprint without moire.
   Where c comes from, best first:
     'png'      the 16-bit height map's own pixels: the depth-weighted centroid across the groove at
                each point (what the PNG decoder reads), so the shading follows the stored pixels
     'vector'   the groove master (heightmap.groove.wav, checked against the metadata's sha256):
                the Cutter's equation, centre = r_start - pitch*turns + x(t)*amp_mm
     'playback' neither carried (the bundled demo): the playback audio taken back through the
                Cutter's presence shelf to displacement, then the same equation; a rebuild
   Plain functions; also run by test-groove-surface.cjs in Node. */
(function(root){
const TAU=Math.PI*2;
const f32=new Float32Array(1),u32=new Uint32Array(f32.buffer);
function toHalf(v){ // float32 -> float16 bits, round to nearest, signed
 f32[0]=v;const x=u32[0],sgn=(x>>>16)&0x8000,e=((x>>>23)&255)-112,m=x&0x7fffff;
 if(e<=0){if(e<-10)return sgn;const mm=(m|0x800000)>>(1-e);return sgn|((mm+0x1000)>>13);}
 return sgn|Math.min(0x7bff,(e<<10)+((m+0x1000)>>13));
}
function fromHalf(h){const s=h&0x8000?-1:1,e=(h>>10)&31,m=h&1023;return e===0?s*m*2**-24:s*(1+m/1024)*2**(e-15);}
function turnsTotal(m){return (m.lead_in_turns||0)+m.duration_sec*m.rpm_cut/60+(m.lead_out_turns||0);}
// Angular samples per turn: about one per 0.1 mm of the outer turn (the finest a close view needs),
// a power of two, at most 8192 and what the GPU's widest texture allows.
function plan(m,maxTex=8192){
 const T=Math.max(1,Math.ceil(turnsTotal(m))),want=TAU*m.r_start_mm/.1;let A=1024;
 while(A<want&&A<8192)A*=2;while(A>maxTex)A/=2;
 return {T,A,width:A,height:2*T,bytes:A*2*T*8};
}
// Playback samples (any rate) -> lateral displacement (units of amp_mm) at the cut's rate: as
// needle-pip.js displacement(), the presence shelf put back.
function displacement(samples,fsIn,m){
 const fs=m.sample_rate||16000;let x;
 if(Math.abs(fsIn-fs)<1e-6)x=Float32Array.from(samples);
 else{const n=Math.max(1,Math.floor(samples.length*fs/fsIn)),r=fsIn/fs,last=samples.length-1;x=new Float32Array(n);
  for(let i=0;i<n;i++){const p=i*r,j=Math.floor(p),f=p-j;x[i]=j>=last?samples[last]:samples[j]+(samples[j+1]-samples[j])*f;}}
 if(m.preemphasis==='presence-shelf-v1'){
  const p=m.presence_shelf||{},A=10**((p.gain_db??6)/40),w=TAU*(p.frequency_hz??1500)/fs,c=Math.cos(w),al=Math.sin(w)/2*Math.sqrt(2),k=2*Math.sqrt(A)*al;
  const b=[A*((A+1)+(A-1)*c+k),-2*A*((A-1)+(A+1)*c),A*((A+1)+(A-1)*c-k)],a=[(A+1)-(A-1)*c+k,2*((A-1)-(A+1)*c),(A+1)-(A-1)*c-k];
  const b0=b[0]/a[0],b1=b[1]/a[0],b2=b[2]/a[0],a1=a[1]/a[0],a2=a[2]/a[0];let z0=0,z1=0;
  for(let i=0;i<x.length;i++){const xi=x[i],yi=b0*xi+z0;z0=b1*xi-a1*yi+z1;z1=b2*xi-a2*yi;x[i]=yi;}
 }
 return x;
}
// c(turns) from a displacement series x (vector master or playback rebuild)
function vectorCentre(m,x){
 const fs=m.sample_rate||16000,lead=m.lead_in_turns||0,rpm=m.rpm_cut,amp=m.amp_mm,last=x.length-1;
 return tau=>{const idx=(tau-lead)*60/rpm*fs;if(!(idx>=0&&idx<=last))return 0;const j=Math.floor(idx);return amp*(j===last?x[last]:x[j]+(x[j+1]-x[j])*(idx-j));};
}
// c(turns) from the height map's pixels: the depth-weighted centroid across the groove (bilinear,
// 2 samples a pixel over the groove's whole reach), as needle-pip.js pngSurface().lateral
function pngCentre(m,map){
 const n=map.size,st=map.samples,R=m.disc_radius_mm,k=(n-1)/(2*R),hi=n-1,inv=(m.height_polarity??'standard')==='inverted';
 const hs=m.height_scale_mm,thick=m.thickness_mm,hw=m.groove_width_mm/2,span=m.amp_mm+hw,px=2*R/(n-1),N=Math.max(9,2*Math.ceil(span/px*2)+1);
 const val=i=>inv?65535-st[i]:st[i];
 function bil(py,pxl){const y0=Math.floor(py),x0=Math.floor(pxl),fy=py-y0,fx=pxl-x0,ya=Math.min(hi,Math.max(0,y0)),yb=Math.min(hi,Math.max(0,y0+1)),xa=Math.min(hi,Math.max(0,x0)),xb=Math.min(hi,Math.max(0,x0+1));
  return (1-fy)*((1-fx)*val(ya*n+xa)+fx*val(ya*n+xb))+fy*((1-fx)*val(yb*n+xa)+fx*val(yb*n+xb));}
 return tau=>{const th=TAU*tau,r0=m.r_start_mm-m.pitch_mm*tau,c=Math.cos(th),s=Math.sin(th);let num=0,den=0;
  for(let j=0;j<N;j++){const off=-span+2*span*j/(N-1),r=r0+off,d=Math.max(0,thick-bil((R+r*s)*k,(r*c+R)*k)/65535*hs);num+=d*off;den+=d;}
  return den>1e-9?num/den:0;};
}
// The moments texture. S sub-samples per texel, read in one continuous pass along the spiral.
// (The glints along the walls close up are the music: the cut's modulation, up to its band limit,
// tilting the walls; the PNG's own trace carries less of it than the master, never more.)
function build(m,centre,{A,T},S=4){
 const t0=Date.now(),n=A*S,tot=T*n,c=new Float32Array(tot+1),rAt=tau=>Math.max(1,m.r_start_mm-m.pitch_mm*tau);
 for(let i=0;i<=tot;i++)c[i]=centre((i-.5)/n);
 const lv=[new Float32Array(A*T*4)],L0=lv[0];
 for(let k=0;k<T;k++){
  for(let j=0;j<A;j++){let s1=0,s2=0,d1=0,d2=0;
   for(let s=0;s<S;s++){const i=(k*A+j)*S+s+1,tau=(i-.5)/n,v=c[i],g=(v-c[i-1])/(TAU*rAt(tau)/n);s1+=v;s2+=v*v;d1+=g;d2+=g*g;}
   const o=(k*A+j)*4;L0[o]=s1/S;L0[o+1]=s2/S;L0[o+2]=d1/S;L0[o+3]=d2/S;}
 }
 for(let w=A;w>1;w>>=1){const a=lv[lv.length-1],h=w>>1,b=new Float32Array(h*T*4);
  for(let k=0;k<T;k++)for(let j=0;j<h;j++)for(let q=0;q<4;q++)b[(k*h+j)*4+q]=.5*(a[(k*w+2*j)*4+q]+a[(k*w+2*j+1)*4+q]);lv.push(b);}
 // pack: level 0 in rows 0..T-1; level L>=1 in rows T..2T-1 from x = A*(1-2^(1-L)), A>>L wide
 const data=new Uint16Array(A*2*T*4);
 for(let L=0;L<lv.length;L++){const w=A>>L,off=L?A*(1-2**(1-L)):0,row0=L?T:0,src=lv[L];
  for(let k=0;k<T;k++)for(let j=0;j<w;j++){const o=((row0+k)*A+off+j)*4,i=(k*w+j)*4;for(let q=0;q<4;q++)data[o+q]=toHalf(src[i+q]);}}
 return {data,width:A,height:2*T,A,T,levels:lv.length,ms:Date.now()-t0};
}
// CPU mirror of the shader's level-0 surface (tests, stills): depth below the land in mm at disc
// polar point (r, turn fraction a), point-sampled.
function heightAt(m,tex,r,a){
 const {A,T,data}=tex,hw=m.groove_width_mm/2,D=m.groove_depth_mm,p=m.pitch_mm,q=(m.r_start_mm-r)/p;
 const mom=k=>{if(k<0||k>=T)return 0;const x=Math.min(A-1,Math.max(0,a*A-.5)),j=Math.floor(x),f=x-j,j1=Math.min(A-1,j+1);
  return (1-f)*fromHalf(data[(k*A+j)*4])+f*fromHalf(data[(k*A+j1)*4]);};
 let best=0;for(const k of [Math.floor(q-a+.5)-1,Math.floor(q-a+.5),Math.floor(q-a+.5)+1]){if(k<0||k+a>turnsTotal(m))continue;const d=p*(k+a-q)-mom(k);best=Math.max(best,D*Math.max(0,1-Math.abs(d)/hw));}
 return best;
}
const api={toHalf,fromHalf,turnsTotal,plan,displacement,vectorCentre,pngCentre,build,heightAt};
if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
root.GrooveSurface=api;
if(typeof importScripts==='function'&&typeof document==='undefined'){
 importScripts('vinyl-core.js');
 root.onmessage=async e=>{const {kind,bytes,samples,sampleRate,metadata:m,maxTex}=e.data,t0=Date.now();
  try{const p=plan(m,maxTex);let centre,S=4;
   if(kind==='png'){const map=await VinylCore.decodePng(new Uint8Array(bytes));
    if(!map.samples)throw Error('Not a 16-bit grey height map.');if(map.width!==map.height||map.width!==m.image_size)throw Error('Map size does not match its metadata.');
    centre=pngCentre(m,{samples:map.samples,size:map.width});S=2;}
   else if(kind==='vector'){const {x}=await VinylCore.readVector(new Uint8Array(bytes),m);centre=vectorCentre(m,x);}
   else centre=vectorCentre(m,displacement(samples,sampleRate,m));
   const out=build(m,centre,p,S);
   root.postMessage({ok:true,kind,...out,bytes:p.bytes,totalMs:Date.now()-t0},[out.data.buffer]);
  }catch(err){root.postMessage({ok:false,kind,error:String(err&&err.message||err)});}
 };
}
})(typeof self!=='undefined'?self:this);
