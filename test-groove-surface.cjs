// node test-groove-surface.cjs: the disc shader's groove surface (static/groove-surface-worker.js)
const assert=require('assert'),GS=require('./static/groove-surface-worker.js');
const TAU=Math.PI*2;
const m={disc_radius_mm:90,label_radius_mm:27,thickness_mm:2.5,r_start_mm:86,pitch_mm:2,amp_mm:.3,groove_width_mm:.8,groove_depth_mm:.45,
 rpm_cut:45,lead_in_turns:.35,lead_out_turns:.5,duration_sec:4,sample_rate:16000,height_scale_mm:2.55,height_polarity:'inverted',image_size:1536};
const fs=m.sample_rate,N=m.duration_sec*fs,x=new Float32Array(N);for(let i=0;i<N;i++){const t=i/fs;x[i]=.8*Math.sin(TAU*3*t)+.15*Math.sin(TAU*41*t);}
const vc=GS.vectorCentre(m,x),lead=m.lead_in_turns,rpm=m.rpm_cut;
// half floats round-trip
for(const v of [0,.3,-.3,1e-4,-2.5,65000])assert.ok(Math.abs(GS.fromHalf(GS.toHalf(v))-v)<=Math.abs(v)*1e-3+1e-7,'half '+v);
// the Cutter's centre: x(t)*amp at turns = lead + t*rpm/60, nothing before or after the music
assert.ok(Math.abs(vc(lead+1*rpm/60)-m.amp_mm*x[fs])<1e-6);assert.equal(vc(.1),0);assert.equal(vc(GS.turnsTotal(m)-.1),0);
// a height map drawn with the Cutter's equation; its pixel centroid gives the same centre back
const n=m.image_size,R=m.disc_radius_mm,k=(n-1)/(2*R),hw=m.groove_width_mm/2,end=GS.turnsTotal(m),samples=new Uint16Array(n*n);
for(let r=0;r<n;r++)for(let c=0;c<n;c++){const X=c/k-R,Y=r/k-R,rr=Math.hypot(X,Y);let a=Math.atan2(Y,X)/TAU;if(a<0)a+=1;
 const q=(m.r_start_mm-rr)/m.pitch_mm;let depth=0;for(let kk=Math.floor(q-a)-1;kk<=Math.floor(q-a)+2;kk++){const tau=kk+a;if(tau<0||tau>end)continue;
  const d=rr-(m.r_start_mm-m.pitch_mm*tau+vc(tau));depth=Math.max(depth,m.groove_depth_mm*Math.max(0,1-Math.abs(d)/hw));}
 samples[r*n+c]=65535-Math.round((m.thickness_mm-depth)/m.height_scale_mm*65535);} // inverted polarity
const pc=GS.pngCentre(m,{samples,size:n}),px=2*R/(n-1);let e=0,cnt=0;
for(let tau=.6;tau<end-.6;tau+=.0123){e+=(pc(tau)-vc(tau))**2;cnt++;}
assert.ok(Math.sqrt(e/cnt)<px/4,`PNG centroid = the Cutter's centre (rms ${(Math.sqrt(e/cnt)).toFixed(4)} mm, pixel ${px.toFixed(3)})`);
// the moments texture: level 0 means, spread and slope; the mip chain halves exactly; packed beside it
const p=GS.plan(m,4096);assert.equal(p.A,4096);assert.equal(p.T,Math.ceil(end));assert.equal(p.bytes,p.A*2*p.T*8);
assert.equal(GS.plan(m,2048).A,2048,'never wider than the GPU allows');
const tex=GS.build(m,vc,p,4),A=p.A,T=p.T,get=(row,col,q)=>GS.fromHalf(tex.data[((row)*A+col)*4+q]);
assert.equal(tex.width,A);assert.equal(tex.height,2*T);assert.equal(tex.levels,Math.log2(A)+1);
{const kk=2,j=1234,tau=kk+(j+.5)/A;assert.ok(Math.abs(get(kk,j,0)-vc(tau))<2e-4,'level 0: the centre');
 assert.ok(get(kk,j,1)>=get(kk,j,0)**2*(1-2e-3)-1e-6,'E[c²] >= E[c]²');
 const r0=m.r_start_mm-m.pitch_mm*tau,ds=TAU*r0/A,slope=(vc(tau+.5/A)-vc(tau-.5/A))/ds;assert.ok(Math.abs(get(kk,j,2)-slope)<Math.abs(slope)*.05+1e-4,'level 0: dc/ds along the groove');}
{const kk=2,lev1=j=>get(T+kk,j,0),l0=j=>get(kk,j,0);for(const j of [0,77,2047])assert.ok(Math.abs(lev1(j)-.5*(l0(2*j)+l0(2*j+1)))<3e-4,'level 1 = pairs of level 0');
 const L=Math.log2(A),off=A*(1-2**(1-L));let mean=0;for(let j=0;j<A;j++)mean+=l0(j)/A;assert.ok(Math.abs(get(T+kk,off,0)-mean)<5e-4,'the last level: the turn\'s mean');
 let v2=0;for(let j=0;j<A;j++)v2+=get(kk,j,3)/A;assert.ok(Math.abs(get(T+kk,off,3)-v2)<v2*3e-3+1e-6,'slope energy kept up the chain (roughness far off)');}
// the shader's surface (CPU mirror) is the map's surface: depth at map pixels, inside the music
{let err=0,c=0,mx=0,inGroove=0;for(let r=0;r<n;r+=3)for(let col=0;col<n;col+=3){const X=col/k-R,Y=r/k-R,rr=Math.hypot(X,Y);if(rr<m.r_start_mm-m.pitch_mm*(end-.5)||rr>m.r_start_mm-m.pitch_mm*.5)continue;
  let a=Math.atan2(Y,X)/TAU;if(a<0)a+=1;const h=GS.heightAt(m,tex,rr,a),pix=m.thickness_mm-(65535-samples[r*n+col])/65535*m.height_scale_mm;err+=(h-pix)**2;c++;if(pix>.05)inGroove++;mx=Math.max(mx,Math.abs(h-pix));}
 assert.ok(inGroove>2000&&Math.sqrt(err/c)<.005,`surface = map depth (rms ${Math.sqrt(err/c).toFixed(4)} mm over ${c} pixels, ${inGroove} in the groove, max ${mx.toFixed(3)})`);console.log(`  surface vs map: rms ${Math.sqrt(err/c).toFixed(4)} mm, max ${mx.toFixed(3)} mm, ${inGroove} groove pixels`);}
// playback -> displacement puts the presence shelf back (identity without one)
{const y=GS.displacement(x,fs,{...m});assert.ok(y.every((v,i)=>v===x[i]));const z=GS.displacement(x,fs,{...m,preemphasis:'presence-shelf-v1'});assert.ok(z.some((v,i)=>Math.abs(v-x[i])>1e-4));}
console.log('groove surface: ok');
