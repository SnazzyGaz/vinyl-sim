/* Needle view: a small engraved close-up of the stylus sitting in the groove, top right.
   It reads the same groove the player is playing, at the player's own read head
   (window.vinyl.time()), so it stops, lifts and runs backwards with the record. Nothing
   here touches the audio.

   What it draws is the record itself, not a picture rebuilt from the sound:
     PNG source    the 16-bit height map's own pixels (decoded losslessly in a worker). Every
                   depth drawn is one stored pixel (nearest; the pixel grid shows as steps),
                   and the stylus sits where the PNG decoder reads it: the depth-weighted
                   centroid across the groove (vinyl-core decodeTrace before its whole-record
                   DC removal and filtering).
     Vector source the groove master (heightmap.groove.wav, checked against the metadata's
                   sha256) through the Cutter's own equation, point-exact:
                     turns = k + φ/2π,  centre = r_start - pitch*turns + x(t)*amp_mm,
                     depth = groove_depth * max(0, 1 - |r - centre| / (groove_width/2)).
   Where the record carries neither (the bundled demo), the view falls back to the old
   reconstruction from the playback audio and says so in its label.
   Seen by a flea: a pinhole eye standing on the record just behind the stylus, looking up the
   groove. Section: the record cut through the tip, the picture plane, so a true cross-section;
   field: the real surface beyond it in true perspective, the groove's walls, the neighbouring
   turns and the lands receding 6 mm upstream (straight rows of the record plane, so the
   spiral's own curvature shows). The stylus is a real one at true scale (0.7 mil / 17.8 µm
   tip, 24° flanks) and rests on that section as a whole, at the lowest height that clears
   every sample. Each frame is one exposure: the real surface
   averaged over the instants since the last frame, so fast play reads as a steady blur and a
   held record as the exact groove. True scale, the same both ways; nothing is exaggerated.
   Costs nothing while hidden: nothing is read, decoded or drawn until it is shown. */
(() => {
const TAU=Math.PI*2;

/* ---------- pure maths (also run by test-needle-pip.cjs in Node) ---------- */
function shelfCoefficients(fs,frequency=1500,gainDb=6){ // = vinyl-core.js / audio_filters.py
 const A=10**(gainDb/40),w=TAU*frequency/fs,c=Math.cos(w),alpha=Math.sin(w)/2*Math.sqrt(2),k=2*Math.sqrt(A)*alpha;
 const b=[A*((A+1)+(A-1)*c+k),-2*A*((A-1)+(A+1)*c),A*((A+1)+(A-1)*c-k)];
 const a=[(A+1)-(A-1)*c+k,2*((A-1)-(A+1)*c),(A+1)-(A-1)*c-k];
 return {b:b.map(v=>v/a[0]),a:a.map(v=>v/a[0])};
}
// Playback samples (any rate) -> lateral displacement at the cut's sample rate, in units of amp_mm.
function displacement(samples,fsIn,m){
 const fs=m.sample_rate||16000;let x;
 if(Math.abs(fsIn-fs)<1e-6)x=Float32Array.from(samples);
 else{ // decoded WAVs come back at the audio context's rate; the signal is band-limited well below 8 kHz
  const n=Math.max(1,Math.floor(samples.length*fs/fsIn)),r=fsIn/fs,last=samples.length-1;x=new Float32Array(n);
  for(let i=0;i<n;i++){const p=i*r,j=Math.floor(p),f=p-j;x[i]=j>=last?samples[last]:samples[j]+(samples[j+1]-samples[j])*f;}
 }
 if(m.preemphasis==='presence-shelf-v1'){
  const p=m.presence_shelf||{},{b,a}=shelfCoefficients(fs,p.frequency_hz??1500,p.gain_db??6);
  let z0=0,z1=0;for(let i=0;i<x.length;i++){const xi=x[i],yi=b[0]*xi+z0;z0=b[1]*xi-a[1]*yi+z1;z1=b[2]*xi-a[2]*yi;x[i]=yi;}
 }
 return x;
}
function makeModel(m,x){
 const fs=m.sample_rate||16000,rpm=m.rpm_cut,lead=m.lead_in_turns||0,start=m.r_start_mm,pitch=m.pitch_mm,amp=m.amp_mm;
 const hw=m.groove_width_mm/2,depth=m.groove_depth_mm,N=x.length,last=N-1,rev=60/rpm;
 const end=lead+m.duration_sec*rpm/60+(m.lead_out_turns||0);
 const xs=tp=>{const idx=tp*fs;if(!(idx>=0&&idx<=last))return 0;const j=Math.floor(idx);return j===last?x[last]:x[j]+(x[j+1]-x[j])*(idx-j);};xs.x=x;xs.n=N;
 const turnsAt=t=>lead+t*rpm/60, radius=t=>start-pitch*turnsAt(t), speed=t=>TAU*radius(t)*rpm/60; // mm of groove per program second
 // Centre of turn k (0 = under the stylus, +1 = next turn in, toward the label), u mm upstream,
 // in the stylus frame: w across the record (+ toward the rim), 0 = this turn's nominal radius.
 function centre(k,u,t){const Rc=radius(t),turns=turnsAt(t)+k+u/(TAU*Rc);if(turns<0||turns>end)return null;
  return -k*pitch+amp*xs(t+k*rev+u/speed(t))-u*u/(2*Rc);}
 // A real stylus at true scale: a conical diamond with a 0.7 mil (17.8 µm) spherical tip, the usual LP tip,
 // its flanks 24° off the vertical, tangent to the tip. It rests on the real section as a whole (tip and flanks).
 const tip={rho:.0178,half:24*Math.PI/180,height:.8*depth+.3*hw};
 function stylus(t){return amp*xs(t);}
 return {m,fs,amp,hw,depth,pitch,rev,end,xs,turnsAt,radius,speed,centre,tip,stylus};
}
/* ---------- surfaces: the groove as the record itself holds it ----------
   depth(X,Y): mm below the land at a point of the record plane (X = r cos θ, Y = r sin θ, θ the
   spiral's own angle, so turns = θ/2π); lateral(t): where the stylus centre sits at program time t,
   in mm from the nominal spiral. */
function rint(v){const f=Math.floor(v),d=v-f;if(d<.5)return f;if(d>.5)return f+1;return f%2===0?f:f+1;}
// Vector master: the Cutter's own definition (vinyl-core rasterize), point-exact, without its 2x2 pixel average.
function vectorSurface(model,kind='vector'){
 const {m,amp,hw,depth,xs,end}=model,start=m.r_start_mm,pitch=m.pitch_mm,lead=m.lead_in_turns||0,spr=60/m.rpm_cut;
 function depthAt(X,Y){const rr=Math.sqrt(X*X+Y*Y);let phi=Math.atan2(Y,X);if(phi<0)phi+=TAU;
  const k=rint((start-rr)/pitch-phi/TAU),turns=k+phi/TAU;if(!(turns>=0&&turns<=end))return 0;
  const delta=rr-(start-pitch*turns+xs((turns-lead)*spr)*amp);return depth*Math.max(0,1-Math.abs(delta)/hw);}
 // A row of the tip's frame at one instant f, u mm upstream, at radial offsets ws[o..o+n): adds weight*depth
 // into out[p..]. Same equation; the angle of each point is the instant's own plus atan(u/r) (|u/r| < .2:
 // the odd series to z^9 is exact to ~1e-11 rad), so there is no atan2 per sample.
 const N=xs.n,X=xs.x,fs=model.fs,last=N-1;
 function addRow(f,u,ws,o,n,out,p,weight){const tt0=f.turns;
  for(let j=0;j<n;j++){const r=f.rs+ws[o+j],z=u/r,z2=z*z,rr=u?r*Math.sqrt(1+z2):r,tt=tt0+(u?z*(1-z2*(1/3-z2*(1/5-z2*(1/7-z2/9))))/TAU:0);
   const k=rint((start-rr)/pitch-tt),turns=k+tt;if(!(turns>=0&&turns<=end))continue;
   const idx=(turns-lead)*spr*fs;let v=0;if(idx>=0&&idx<=last){const i=Math.floor(idx);v=i===last?X[last]:X[i]+(X[i+1]-X[i])*(idx-i);}
   const a=1-Math.abs(rr-(start-pitch*turns+v*amp))/hw;if(a>0)out[p+j]+=weight*depth*a;}}
 return {kind,depthAt,addRow,lateral:t=>amp*xs(t),pixelMm:0};
}
// PNG pixels: the 16-bit map itself. Depth is the nearest pixel's own value (each pixel is the Cutter's
// 2x2 sub-sample average); the stylus sits where the PNG decoder reads it: the depth-weighted centroid
// of 65 bilinear samples across the groove at the nominal radius (vinyl-core decodeTrace, before its
// whole-record DC removal and filtering).
function pngSurface(model,map){
 const {m}=model,n=map.size,st=map.samples,R=m.disc_radius_mm,k=(n-1)/(2*R),hi=n-1,inv=(m.height_polarity??'standard')==='inverted';
 const hs=m.height_scale_mm,thick=m.thickness_mm,span=model.amp+model.hw,px=2*R/(n-1);
 const val=i=>inv?65535-st[i]:st[i],mm=v=>thick-v/65535*hs;
 function depthAt(X,Y){const c=Math.round((X+R)*k),r=Math.round((Y+R)*k);if(c<0||r<0||c>hi||r>hi)return 0;return mm(val(r*n+c));}
 function bil(py,pxl){const y0=Math.floor(py),x0=Math.floor(pxl),fy=py-y0,fx=pxl-x0,ya=Math.min(hi,Math.max(0,y0)),yb=Math.min(hi,Math.max(0,y0+1)),xa=Math.min(hi,Math.max(0,x0)),xb=Math.min(hi,Math.max(0,x0+1));
  return (1-fy)*((1-fx)*val(ya*n+xa)+fx*val(ya*n+xb))+fy*((1-fx)*val(yb*n+xa)+fx*val(yb*n+xb));}
 function lateral(t){const th=TAU*model.turnsAt(t),r0=model.radius(t),c=Math.cos(th),s=Math.sin(th);let num=0,den=0;
  for(let j=0;j<65;j++){const off=-span+2*span*j/64,r=r0+off,d=Math.max(0,mm(bil((R+r*s)*k,(r*c+R)*k)));num+=d*off;den+=d;}
  return num/Math.max(den,1e-9);}
 function addRow(f,u,ws,o,count,out,p,weight){const bx=-u*f.s,by=u*f.c;
  for(let j=0;j<count;j++){const r=f.rs+ws[o+j],c=Math.round((r*f.c+bx+R)*k),q=Math.round((r*f.s+by+R)*k);if(c<0||q<0||c>hi||q>hi)continue;out[p+j]+=weight*mm(val(q*n+c));}}
 return {kind:'png',depthAt,addRow,lateral,pixelMm:px};
}
/* One exposure in the stylus frame: for each instant from t0 to t1 (the program time since the last frame),
   place the frame on the stylus as it was then (radial w, upstream u along the tangent) and read the real
   surface; average. Zero span = the exact instant. Same instants either way, so scratching back shows the
   same picture as playing forward. */
function instants(model,surf,t0,t1,max){
 const a=Math.min(t0,t1),b=Math.max(t0,t1),n=Math.max(1,Math.min(max,Math.floor((b-a)*model.fs)+1)),out=[];
 for(let i=0;i<n;i++){const t=n===1?(a+b)/2:a+(b-a)*i/(n-1),th=TAU*model.turnsAt(t);out.push({t,turns:model.turnsAt(t),c:Math.cos(th),s:Math.sin(th),rs:model.radius(t)+surf.lateral(t)});}
 return out;
}
// The stylus's underside, relative to its tip centre, at lateral offset w: the spherical tip out to where the
// flanks leave it tangentially, then the cone (half angle `half`) up to its top `height` above the tip centre.
function underside(tip,w){const a=Math.abs(w),{rho,half}=tip,e=rho*Math.cos(half);
 if(a<=e)return -Math.sqrt(rho*rho-a*a);const z=-rho*Math.sin(half)+(a-e)/Math.tan(half);return z<=tip.height?z:Infinity;}
// Rest the stylus on a sampled section (w ascending, y = -depth): the lowest tip-centre height that clears every
// sample, and the sample(s) it touches on each side. tip: {rho, half, height} (a bare number = a ball of that radius).
function rest(sec,tip){if(typeof tip==='number')tip={rho:tip,half:1e-9,height:tip};
 let best=-Infinity,L=null,Rt=null,yl=-Infinity,yr=-Infinity;
 for(const [w,y] of sec){const z=underside(tip,w);if(z===Infinity)continue;const h=y-z;if(w<=0){if(h>yl){yl=h;L=[w,y];}}else if(h>yr){yr=h;Rt=[w,y];}if(h>best)best=h;}
 const tol=Math.max(tip.rho*.04,1e-5),contacts=[];if(L&&yl>=best-tol)contacts.push(L);if(Rt&&yr>=best-tol)contacts.push(Rt);
 return {yc:best,contacts};}
// Screen layout for a W x H panel (CSS px): true scale both ways, fitted to this record's groove.
function layout(model,W,H){
 const {pitch,hw,depth}=model,Wv=pitch*.75+hw;
 // the tip's contact sits in the middle of the panel; the hatched cut face runs down to a base line kept
 // above the bottom labels
 const S=Math.min(W/(2*Wv),H*.22/depth),base=H-16,sy0=Math.min(H*.5-.55*depth*S,base-depth*S-6),hzn=7,P=sy0-hzn;
 // A flea's eye: a pinhole camera standing on the record just behind the cut, looking straight along the
 // groove. The picture plane is the cut face (u = 0), so the front section is a true cross-section at S px/mm
 // both ways, and everything upstream is in true perspective: the eye is P/S mm above the land (its horizon
 // near the top of the panel), a fifth of the panel off toward the rim (the groove runs away up and to the
 // right of the stylus), and W/2S mm behind the cut (90° across the panel). The field reaches 6 mm upstream.
 const eh=P/S,ew=W*.2/S,Dp=W/(2*S),ox=ew/Dp,oy=eh/Dp,L=6,gEnd=Dp/(Dp+L);
 const rows=Math.max(24,Math.min(48,Math.round(P*(1-gEnd)/1.5))); // land rows ~1.5 px apart on screen
 const steps=[.05,.1,.2,.25,.5,1,2,5];let bar=steps[0];for(const s of steps)if(s*S<=W*.32)bar=s;
 return {W,H,S,cx:W*.5,sy0,hzn,P,Dp,L,ox,oy,eye:{w:ew,h:eh,d:Dp},gEnd,rows,base,half:W/S,bar};
}
// = the pinhole: eye at (w, u, y) = (eye.w, -eye.d, eye.h), picture plane u = 0 at S px/mm
function project(L,w,u,y){const g=1/(1+u/L.Dp);return [L.cx+L.S*g*(w+u*L.ox),L.sy0-L.S*g*(y+u*L.oy)];}

/* ---------- drawing: cream and brass line engraving on a dark panel ---------- */
const INK='#eadfc6',BRASS='#c4a15a',DIM='rgba(234,223,198,.2)',BG='#16100b';
// the field's tones, dark cut to lit wall, packed for a little-endian RGBA image (every browser this runs on)
const TONE32=new Uint32Array(256);for(let i=0;i<256;i++){const f=i/255,mix=(a,b)=>Math.round(a+(b-a)*f);TONE32[i]=(255<<24|mix(7,70)<<16|mix(10,98)<<8|mix(14,118))>>>0;}
const BG32=(255<<24|0x0b<<16|0x10<<8|0x16)>>>0; // = BG
const images=new WeakMap();
function imageFor(c,w,h){if(!c.createImageData)return null;let e=images.get(c);
 if(!e||e.w!==w||e.h!==h){const data=c.createImageData(w,h);if(!data?.data)return null;e={w,h,data,px:new Uint32Array(data.data.buffer)};images.set(c,e);}return e;}
// One column of image pixels at a time, from the tip outwards: each row of the field paints only what rises
// above everything nearer (a ridge hides the groove behind it), shaded between its row and the one before.
function rasterField(px,Wi,Hi,grid,shade,us,NR,NC,dx,L){
 for(let X=0;X<Wi;X++){const fj=(X+.5+8)/dx,j0=Math.max(0,Math.min(NC-2,Math.floor(fj))),f=fj-j0,g0=1-f;
  let ymin=Hi,py0=0,pv0=0;
  for(let i=0;i<=NR;i++){const q=i*NC+j0,sg=L.S/(1+us[i]/L.Dp),y=L.sy0-sg*(us[i]*L.oy-(grid[q]*g0+grid[q+1]*f))-.5,v=(shade[q]*g0+shade[q+1]*f)*255;
   if(i===0){const top=Math.max(0,Math.ceil(y)),c=TONE32[v|0];for(let yy=top;yy<ymin;yy++)px[yy*Wi+X]=c;ymin=top;}
   else if(y<ymin){const top=Math.max(0,Math.ceil(y)),inv=py0-y>1e-6?1/(py0-y):0,dv=pv0-v;
    for(let yy=top;yy<ymin;yy++){const k=(yy-y)*inv;px[yy*Wi+X]=TONE32[(v+dv*(k<1?k:1))|0];}ymin=top;}
   py0=y;pv0=v;}
  for(let yy=0;yy<ymin;yy++)px[yy*Wi+X]=BG32;}
}
// The stylus in screen px: tip centre (tx,ty), tip radius r, diamond height h above the tip centre.
// A few paths and gradients a frame; dark outlines so it reads crisply on the field.
const EDGE='#0d0906';
function grad(c,x0,y0,x1,y1,stops){const g=c.createLinearGradient(x0,y0,x1,y1);for(const [o,col] of stops)g.addColorStop(o,col);return g;}
function drawStylus(c,L,tx,ty,r,h,half=24*Math.PI/180){
 const sn=Math.sin(half),cs=Math.cos(half),tn=Math.tan(half);
 const ey=ty-r*sn,top=ty-Math.max(h,3*r),wt=r*cs+tn*(ey-top); // the cone's sides touch the tip circle at (±r cos, -r sin)
 // collar: a short brass sleeve holding the diamond
 const cH=Math.max(5,Math.min(9,r*1.6)),cw0=wt*1.18,cw1=wt*.95,cy1=top-cH;
 // The panel looks along the groove, so the cantilever runs straight into the screen: it is drawn end-on, as
 // the round section of its tube in a brass ring, with the diamond's shank plunging vertically from it to the
 // collar. Nothing leans: the whole stylus stands on the vertical through the tip.
 const tr=Math.max(4,Math.min(11,cw0*1.25)),tR=tr*1.32,sh=Math.max(4,Math.min(10,r*1.2)),sw=Math.max(1.2,cw1*.42);
 const ccy=cy1-sh-tR; // the tube's centre (lifted, it rises off the top of the panel)
 // shank: a short square-cut stem, lit from the left like the collar
 c.beginPath();c.rect(tx-sw,ccy,2*sw,cy1-ccy+.5);
 c.fillStyle=grad(c,tx-sw,0,tx+sw,0,[[0,'#6f6552'],[.35,'#efe7d2'],[1,'#5a5243']]);c.fill();c.strokeStyle=EDGE;c.lineWidth=1;c.stroke();
 // brass ring round the tube end, then the tube wall, then its dark bore (a hollow aluminium tube)
 const ell=(rx,ry)=>{c.beginPath();c.ellipse(tx,ccy,rx,ry,0,0,TAU);};
 ell(tR,tR*.92);c.fillStyle=grad(c,tx-tR,ccy-tR,tx+tR,ccy+tR,[[0,'#e9cf8a'],[.45,'#c4a15a'],[1,'#4f3a14']]);c.fill();c.strokeStyle=EDGE;c.lineWidth=1;c.stroke();
 ell(tr,tr*.92);c.fillStyle=grad(c,tx-tr,ccy-tr,tx+tr,ccy+tr,[[0,'#f4eedd'],[.4,'#cfc5ab'],[1,'#5a5243']]);c.fill();c.strokeStyle=EDGE;c.lineWidth=.8;c.stroke();
 ell(tr*.52,tr*.48);c.fillStyle='#0b0805';c.fill();
 c.strokeStyle='rgba(255,250,235,.65)';c.lineWidth=.7;c.beginPath();c.ellipse(tx,ccy,tr*.78,tr*.72,0,Math.PI*1.05,Math.PI*1.55);c.stroke(); // the rim's highlight
 c.beginPath();c.moveTo(tx-cw1,cy1);c.lineTo(tx+cw1,cy1);c.lineTo(tx+cw0,top);c.lineTo(tx-cw0,top);c.closePath();
 c.fillStyle=grad(c,tx-cw0,0,tx+cw0,0,[[0,'#5e4518'],[.3,'#e9cf8a'],[.55,'#c4a15a'],[1,'#4f3a14']]);c.fill();c.strokeStyle=EDGE;c.lineWidth=1;c.stroke();
 c.strokeStyle='rgba(255,236,190,.7)';c.lineWidth=.7;c.beginPath();c.moveTo(tx-cw1+1,cy1+1.2);c.lineTo(tx+cw1-1,cy1+1.2);c.stroke();
 // diamond: three facets (shadowed left, lit face, cooler right) down to the rounded tip
 const ex=r*cs,fl=tx-wt*.28,fr=tx+wt*.36;
 c.beginPath();c.moveTo(tx-wt,top);c.lineTo(tx-ex,ey);c.arc(tx,ty,r,Math.PI+half,-half,true);c.lineTo(tx+wt,top);c.closePath();
 c.fillStyle=grad(c,tx-wt,0,tx+wt,0,[[0,'#7d735f'],[.3,'#d8ccb0'],[.42,'#fbf5e6'],[.62,'#e9dfc8'],[1,'#a59879']]);c.fill();
 c.save();c.clip();
 c.fillStyle='rgba(20,14,8,.18)';c.beginPath();c.moveTo(tx-wt,top);c.lineTo(fl,top);c.lineTo(tx-r*.3,ty);c.lineTo(tx-ex-2,ey);c.closePath();c.fill();
 c.fillStyle='rgba(60,70,80,.12)';c.beginPath();c.moveTo(fr,top);c.lineTo(tx+wt,top);c.lineTo(tx+ex+2,ey);c.lineTo(tx+r*.3,ty);c.closePath();c.fill();
 c.strokeStyle='rgba(40,28,16,.35)';c.lineWidth=.6;c.beginPath();c.moveTo(fl,top);c.lineTo(tx-r*.3,ty);c.moveTo(fr,top);c.lineTo(tx+r*.3,ty);c.stroke();
 const gl=c.createRadialGradient(tx-r*.35,ty-r*.3,0,tx-r*.35,ty-r*.3,r*1.1);gl.addColorStop(0,'rgba(255,255,250,.95)');gl.addColorStop(.35,'rgba(255,250,235,.35)');gl.addColorStop(1,'rgba(255,250,235,0)');
 c.fillStyle=gl;c.fillRect(tx-r*1.5,ty-r*1.5,r*3,r*3); // the tip's own glint
 c.strokeStyle='rgba(255,255,250,.6)';c.lineWidth=.8;c.beginPath();c.moveTo(tx-wt*.08,top+1);c.lineTo(tx-r*.15,ey-1);c.stroke(); // the lit facet's edge
 c.restore();
 c.beginPath();c.moveTo(tx-wt,top);c.lineTo(tx-ex,ey);c.arc(tx,ty,r,Math.PI+half,-half,true);c.lineTo(tx+wt,top);c.closePath();c.strokeStyle=EDGE;c.lineWidth=1.1;c.stroke();
}
function path(c,pts){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));}
/* The groove as it is: one exposure of the real surface around the stylus (field), the record cut away
   through the tip (section, same samples), and the stylus resting on that section.
   s: {t, prev (program time at the last frame), down, scratch (a canvas for the field image), rows?, colPx?, instants?} */
function draw(c,model,surf,L,s){
 const {W,H,S}=L,t=s.t,hw=model.hw,D=model.depth;
 const ins=instants(model,surf,s.prev??t,t,s.instants||8);
 c.fillStyle=BG;c.fillRect(0,0,W,H);
 // Field: rows from the cut out to L.L mm upstream, evenly spaced on screen (even steps of the perspective
 // factor g), columns spread evenly across the screen in each row. Every vertex is the mean of 8 samples of the
 // real surface over its own footprint (a box filter: what one screen pixel there can show), so a far groove
 // narrower than a column does not alias: across the row, the column's width; along the groove, the row's
 // depth while held, or the instants of the exposure while playing (the record's own motion covers it).
 const NR=s.rows||L.rows,dx=s.colPx||3,NC=Math.ceil((W+16)/dx)+1,grid=new Float32Array((NR+1)*NC),ws=new Float32Array((NR+1)*NC),us=new Float32Array(NR+1);
 const K=8,sub=Math.max(1,Math.floor(K/ins.length)),gOf=i=>1-(1-L.gEnd)*i/NR,rowU=i=>L.Dp*(1/gOf(i)-1),wk=new Float64Array(NC);
 for(let i=0;i<=NR;i++){const u=rowU(i),g=gOf(i),du=(rowU(Math.min(NR,i+1))-rowU(Math.max(0,i-1)))/2,cw=dx/(L.S*g);us[i]=u;
  for(let j=0;j<NC;j++)ws[i*NC+j]=(-8+j*dx-L.cx)/(L.S*g)-u*L.ox;
  const n=sub*ins.length,wt=1/n;
  for(let k=0;k<n;k++){const f=ins[k%ins.length],uk=sub===1?u:Math.max(0,u+du*((k+.5)/n-.5)),ow=i?cw*((k*.6180339887+.5/n)%1-.5):0;
   for(let j=0;j<NC;j++)wk[j]=ws[i*NC+j]+ow;surf.addRow(f,uk,wk,0,NC,grid,i*NC,wt);}}
 // Shade at every vertex: lit from the left by the wall's slope (a full V's slope = one step), darker with depth,
 // dimmer with distance, and dimmest at the far end of the field, which so fades out rather than stops.
 const lift=D/hw,shade=new Float32Array(grid.length);
 for(let i=0;i<=NR;i++){const fade=(.55+.45*gOf(i))*(.3+.7*Math.min(1,(NR-i)/(NR*.3)));for(let j=0;j<NC;j++){const q=i*NC+j,l=j?q-1:q,r=j<NC-1?q+1:q,slope=(grid[l]-grid[r])/Math.max(1e-9,ws[r]-ws[l]);
  shade[q]=fade*Math.max(0,Math.min(1,.62+.3*Math.max(-1,Math.min(1,slope/lift))-.3*grid[q]/D));}}
 // Height-field raster (rasterField) at CSS-pixel resolution into a scratch canvas, then scaled onto the panel:
 // smooth, seamless, one upload however busy the groove is. The section and the tip stay crisp vector on top.
 const sc=s.scratch,Hi=Math.min(H,Math.ceil(L.sy0+D*S)+2);
 if(sc&&sc.getContext){if(sc.width!==W||sc.height!==Hi){sc.width=W;sc.height=Hi;}const sx=sc.getContext('2d'),img=imageFor(sx,W,Hi);
  if(img){rasterField(img.px,W,Hi,grid,shade,us,NR,NC,dx,L);sx.putImageData(img.data,0,0);c.imageSmoothingEnabled=true;c.drawImage(sc,0,0,W,Hi);}}
 // the record cut away through the stylus: the same exposure, one sample per screen pixel, hatched below
 const tip=model.tip,rho=tip.rho,sec=[];
 const sw=[];for(let x=-2;x<=W+2;x++){const w=(x-L.cx)/S;if(Math.abs(w)>=rho)sw.push(w);}
 for(let i=-48;i<=48;i++)sw.push(rho*i/48*.9999); // finer under the tip, where it rests (true scale: under a pixel)
 sw.sort((a,b)=>a-b);const swa=Float64Array.from(sw),sd=new Float64Array(sw.length);for(const f of ins)surf.addRow(f,0,swa,0,sw.length,sd,0,1/ins.length);
 for(let j=0;j<sw.length;j++)sec.push([sw[j],-sd[j]]);
 const top=sec.map(([w,y])=>project(L,w,0,y));
 c.save();path(c,top.concat([[W+2,L.base],[-2,L.base]]));c.closePath();c.fillStyle='#120d09';c.fill();c.clip();
 c.strokeStyle=DIM;c.lineWidth=.7;for(let x=-H;x<W+H;x+=5){c.beginPath();c.moveTo(x,L.base);c.lineTo(x+H,L.base-H);c.stroke();}
 c.restore();
 c.strokeStyle=INK;c.lineWidth=1.2;path(c,top);c.stroke();
 c.strokeStyle='rgba(196,161,90,.6)';c.lineWidth=.8;c.beginPath();c.moveTo(0,L.base+.5);c.lineTo(W,L.base+.5);c.stroke();
 // stylus, resting on the section drawn: a faceted diamond cone on its round tip, both at true scale, set
 // in a brass collar on a shank from the cantilever, seen end-on
 const res=rest(sec,tip);
 const yc=s.down&&isFinite(res.yc)?res.yc:rho+Math.max(.12,.35*D);
 const [tx,ty]=project(L,0,0,yc),r=Math.max(.6,rho*S);
 drawStylus(c,L,tx,ty,r,tip.height*S,tip.half);
 // the tip and the points where it actually touches the walls: solid, ringed dark, a soft glow while it plays
 const contacts=s.down?res.contacts:[];
 if(contacts.length){const lo=contacts.reduce((p,q)=>q[1]<p[1]?q:p),[gx,gy]=project(L,lo[0],0,lo[1]),gl=c.createRadialGradient(gx,gy,0,gx,gy,12);gl.addColorStop(0,'rgba(255,236,190,.5)');gl.addColorStop(1,'rgba(255,236,190,0)');c.fillStyle=gl;c.fillRect(gx-12,gy-12,24,24);}
 for(const [w,y] of contacts){const [gx,gy]=project(L,w,0,y);c.beginPath();c.arc(gx,gy,2,0,TAU);c.fillStyle='#e4d09a';c.fill();c.strokeStyle='#0d0906';c.lineWidth=.8;c.stroke();}
 // on the base line, like a gauge: how far the record moved sideways under the tip during this exposure
 if(s.down&&ins.length>1){let lo=Infinity,hi=-Infinity;const now=surf.lateral(t);for(const f of ins){const v=f.rs-model.radius(f.t)-now;if(v<lo)lo=v;if(v>hi)hi=v;}
  const [a]=project(L,-hi,0,0),[b]=project(L,-lo,0,0);if(b-a>1.5){c.fillStyle='rgba(228,208,154,.9)';c.fillRect(a,L.base-1.5,b-a,2.5);}}
 // scale and what is shown, engraved small
 c.font='500 8.5px Jost, Futura, sans-serif';c.textBaseline='alphabetic';
 const bl=L.bar*S,by=H-5;c.fillStyle=INK;c.fillRect(8,by-3,bl,1.2);c.fillRect(8,by-5,1,4);c.fillRect(8+bl-1,by-5,1,4);
 const lab=t=>t.toUpperCase().split('').join('\u200a');
 c.fillText(lab(`${L.bar} mm`),12+bl,by);
 let tag=labelFor(surf,W<200);const room=W-8-(12+bl+(c.measureText?.(lab(`${L.bar} mm`))?.width||0))-10;if((c.measureText?.(lab(tag))?.width||0)>room)tag=labelFor(surf,true);c.textAlign='right';c.fillStyle='rgba(234,223,198,.7)';c.fillText(lab(tag),W-8,by);
 if(!s.down){c.textAlign='right';c.fillText(lab('Lifted'),W-8,14);}
 c.textAlign='left';
 return {section:sec,rest:res,yc,instants:ins.length,field:{grid,ws,us,NR,NC,dx}};
}
function labelFor(surf,short){
 switch(surf.kind){
  case 'png':return short?'PNG pixels':`PNG pixels · ${surf.pixelMm.toFixed(3)} mm`;
  case 'vector':return 'Vector master';
  case 'png-trace':return short?'PNG trace':'PNG trace · no 16-bit map';
  default:return short?'Vector · rebuilt':'Vector · rebuilt from playback';
 }
}

const core={shelfCoefficients,displacement,makeModel,vectorSurface,pngSurface,instants,underside,rest,rasterField,layout,project,draw,labelFor};
if(typeof module!=='undefined'&&module.exports)module.exports=core;
if(typeof document==='undefined'||typeof window==='undefined'||!document.getElementById)return;

/* ---------- the panel ---------- */
const KEY='vinyl-needle-view',$=id=>document.getElementById(id),btn=$('needleView');
if(!btn)return;
const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)');
let on;try{const s=localStorage.getItem(KEY);on=s?s==='on':null;}catch{on=null;}
if(on===null)on=innerWidth>=760&&innerHeight>=520; // phones start without it; the choice, once made, is kept
const host=document.querySelector('#well .core')||document.body;
const panel=document.createElement('figure');panel.className='needle-pip';panel.hidden=true;
panel.innerHTML='<canvas role="img" aria-label="Needle view"></canvas><div class="needle-card" aria-hidden="true"><img alt="" hidden><div><b></b><span class="who"></span><span class="facts figures"></span></div></div>';
if(host===document.body&&$('tags'))host.insertBefore(panel,$('tags'));else host.appendChild(panel); // the Room's cut tags stay on top of it
const canvas=panel.querySelector('canvas'),c2d=canvas.getContext('2d'),card=panel.querySelector('.needle-card');
const cache=new WeakMap();let model=null,modelFor=null,raf=0,timer=0,last=null,lastT=null,cardTimer=0,cardWanted=false,size=[0,0],label='';
function V(){return window.vinyl;}
function shown(){const v=V();return on&&!!v?.record&&!!v.buffer&&!v.inspecting&&!document.hidden;}
function sync(){btn.setAttribute('aria-pressed',String(on));const vis=shown();if(panel.hidden===vis)panel.hidden=!vis;if(!vis){cancel();hideCard();}return vis;}
function cancel(){if(raf)cancelAnimationFrame(raf);clearTimeout(timer);raf=0;timer=0;}
const SCRIPT=document.currentScript?.src||'static/needle-pip.js',workerUrl=()=>new URL('needle-pip-worker.js',new URL(SCRIPT,location.href)).href;
// The current record's own geometry, read once it is wanted (panel shown, that source playing) and
// dropped with the record: {state:'loading'|'ok'|'none', x (vector) | map (png)}.
let truth={rec:null,vector:null,png:null},scratch=null;
async function bytesOf(rec,file,name){
 if(rec[file])return await rec[file].arrayBuffer();
 if(!rec.base||rec.base==='demo/')return null; // imported without the file, or the bundled demo (audio and preview only): nothing to fetch
 const r=await fetch(rec.base+name);return r.ok?await r.arrayBuffer():null;
}
function want(kind,rec){
 if(truth.rec!==rec)truth={rec,vector:null,png:null};
 if(truth[kind])return truth[kind];
 const slot=truth[kind]={state:'loading'},done=v=>{if(truth[kind]!==slot)return;Object.assign(slot,v||{state:'none'});model=null;last=null;wake();};
 (async()=>{
  const bytes=await bytesOf(rec,kind==='vector'?'grooveFile':'heightmapFile',kind==='vector'?'heightmap.groove.wav':'heightmap.png');
  if(!bytes)return null;
  return await new Promise(res=>{const w=new Worker(workerUrl());w.onmessage=e=>{w.terminate();const d=e.data;
    res(!d.ok?null:kind==='vector'?{state:'ok',x:d.x}:{state:'ok',map:{samples:d.samples,size:d.size}});};
   w.onerror=()=>{w.terminate();res(null);};w.postMessage({kind,bytes,metadata:rec.metadata},[bytes]);});
 })().then(done,()=>done(null));
 return slot;
}
function modelNow(v){
 const b=v.buffer,rec=v.record,m=rec.metadata,png=v.source==='png',slot=want(png?'png':'vector',rec);
 const key=b.length+'|'+png+'|'+slot.state;if(modelFor===rec&&model&&model.key===key)return model;
 let x=cache.get(b);if(!x){x=displacement(b.getChannelData(0),b.sampleRate,m);cache.set(b,x);}
 let mdl,surf;
 if(!png){mdl=makeModel(m,slot.state==='ok'?slot.x:x);surf=vectorSurface(mdl,slot.state==='ok'?'vector':'vector-rebuilt');}
 else{mdl=makeModel(m,x);surf=slot.state==='ok'?pngSurface(mdl,slot.map):vectorSurface(mdl,'png-trace');}
 model={mdl,surf,key,loading:slot.state==='loading'};modelFor=rec;lastT=null;return model;
}
function fit(){const w=canvas.clientWidth,h=canvas.clientHeight,d=Math.min(2,window.devicePixelRatio||1);
 if(w!==size[0]||h!==size[1]||canvas.width!==Math.round(w*d)){size=[w,h];canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);last=null;}return d;}
function render(){
 const v=V(),M=modelNow(v),{mdl,surf}=M,d=fit(),[w,h]=size;if(!w||!h)return;
 const t=v.time(),down=!!v.down,grab=!!v.state?.grabbed,key=[t,down,grab,M.key,w,h,d].join('|');
 if(key===last)return;last=key;
 const lastPrev=lastT,run=lastT!==null&&Math.abs(t-lastT)<.25;lastT=t;
 c2d.setTransform(d,0,0,d,0,0);draw(c2d,mdl,surf,layout(mdl,w,h),{t,prev:run?t+Math.max(-.06,Math.min(.06,lastPrev-t)):t,down,scratch:scratch||=document.createElement('canvas')});
 const words=`Needle view, true scale: ${down?(grab?'stylus held in the groove':'stylus in the groove, playing'):'stylus lifted'}; ${labelFor(surf,false)}${M.loading?', loading the record\'s own geometry':''}.`;
 if(words!==label){label=words;canvas.setAttribute('aria-label',words);}
}
function tick(){raf=0;timer=0;if(!sync())return;render();const v=V();
 if(v.down||v.state?.grabbed){if(reduce?.matches)timer=setTimeout(tick,250);else raf=requestAnimationFrame(tick);}
 if(cardWanted)showCard();}
function wake(){if(!sync()){return;}if(!raf&&!timer)raf=requestAnimationFrame(tick);}
// a short card from the record's own facts: its title (or file name), tags if it has them, cut speed and length
function clock(t){const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(1);}
function showCard(){
 cardWanted=false;const v=V(),r=v?.record;if(!r)return;const tg=r.tags||{},str=x=>typeof x==='string'&&x.trim()?x.trim():null;
 const title=str(tg.title)||str(r.label);if(!title)return;
 card.querySelector('b').textContent=title;
 const who=[str(tg.artist),str(tg.album),str(tg.year!=null?String(tg.year):null)].filter(Boolean).join(' · ');const ws=card.querySelector('.who');ws.textContent=who;ws.hidden=!who;
 const m=r.metadata;card.querySelector('.facts').textContent=`${m.rpm_cut<40?'33⅓':Math.round(m.rpm_cut)} rpm · ${clock(m.duration_sec)}`;
 const img=card.querySelector('img');if(str(r.cover)){img.src=r.cover;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}
 card.classList.add('on');clearTimeout(cardTimer);cardTimer=setTimeout(hideCard,4600);
}
function hideCard(){clearTimeout(cardTimer);card.classList.remove('on');}
btn.addEventListener('click',()=>{on=!on;try{localStorage.setItem(KEY,on?'on':'off');}catch{}if(on)cardWanted=true;last=null;sync();wake();});
window.addEventListener('vinyl-record',()=>{model=null;modelFor=null;cardWanted=true;last=null;setTimeout(wake,0);});
window.addEventListener('resize',()=>{last=null;wake();});
document.addEventListener('visibilitychange',()=>{last=null;wake();});
window.vinylNeedle={wake,get on(){return on;},get visible(){return !panel.hidden;},core};
sync();wake();
})();
