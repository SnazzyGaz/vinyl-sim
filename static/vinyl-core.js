/* Vinyl Sim in-browser pipeline: a faithful JavaScript port of encode.py,
   audio_filters.py, vector.py, decode.py and serve.py's preview/playback writers.
   No DOM: runs in a Web Worker (importScripts) or Node (require). Used only when
   the page has no Python server (GitHub Pages); the local app keeps serve.py. */
(function(root){
'use strict';
const MAX_SECONDS=480, FS=16000, TAU=2*Math.PI;
const VECTOR_FORMAT='pcm16-mono-displacement-v1';

/* ---------- numeric helpers matching numpy ---------- */
function rint(v){const f=Math.floor(v),d=v-f;if(d<.5)return f;if(d>.5)return f+1;return f%2===0?f:f+1;} // half to even
function linspace(a,b,n){const out=new Float64Array(n);if(n===1){out[0]=a;return out;}const step=(b-a)/(n-1);for(let i=0;i<n;i++)out[i]=i*step+a;out[n-1]=b;return out;}
function mean(x){let s=0;for(let i=0;i<x.length;i++)s+=x[i];return s/x.length;}
function isNum(v){return typeof v==='number'&&Number.isFinite(v);}

/* ---------- audio_filters.py ---------- */
function shelfCoefficients(fs,frequency=1500,gainDb=6){
 const A=10**(gainDb/40),w=TAU*frequency/fs,c=Math.cos(w),alpha=Math.sin(w)/2*Math.sqrt(2),k=2*Math.sqrt(A)*alpha;
 const b=[A*((A+1)+(A-1)*c+k),-2*A*((A-1)+(A+1)*c),A*((A+1)+(A-1)*c-k)];
 const a=[(A+1)-(A-1)*c+k,2*((A-1)-(A+1)*c),(A+1)-(A-1)*c-k];
 return {b:b.map(v=>v/a[0]),a:a.map(v=>v/a[0])};
}
// scipy.signal.lfilter for a biquad, zero initial state (direct form II transposed).
function lfilter(b,a,x,zi){
 const a0=a[0],b0=b[0]/a0,b1=b[1]/a0,b2=b[2]/a0,a1=a[1]/a0,a2=a[2]/a0;
 let z0=zi?zi[0]:0,z1=zi?zi[1]:0;const y=new Float64Array(x.length);
 for(let i=0;i<x.length;i++){const xi=x[i],yi=b0*xi+z0;z0=b1*xi-a1*yi+z1;z1=b2*xi-a2*yi;y[i]=yi;}
 return y;
}
function presence(x,fs,m,inverse=false){
 if(m.preemphasis!=='presence-shelf-v1')return Float64Array.from(x);
 const p=m.presence_shelf,{b,a}=shelfCoefficients(fs,p.frequency_hz,p.gain_db);
 return inverse?lfilter(a,b,x):lfilter(b,a,x);
}
function radiusCutoff(t,m){
 const radius=m.r_start_mm-m.pitch_mm*(m.lead_in_turns+t*m.rpm_cut/60);
 const pixel=2*m.disc_radius_mm/(m.image_size-1);
 const cap=m.bandlimit_cap_hz??6500;
 return Math.min(cap,TAU*radius/pixel*m.rpm_cut/60*.44);
}
// In-place iterative radix-2 complex FFT.
function fftTables(n){const rev=new Uint32Array(n),bits=Math.log2(n);for(let i=0;i<n;i++){let r=0;for(let b=0;b<bits;b++)r|=((i>>b)&1)<<(bits-1-b);rev[i]=r;}
 const cos=new Float64Array(n/2),sin=new Float64Array(n/2);for(let i=0;i<n/2;i++){cos[i]=Math.cos(TAU*i/n);sin[i]=Math.sin(TAU*i/n);}return {n,rev,cos,sin};}
function fft(re,im,T,inverse){
 const n=T.n,rev=T.rev;
 for(let i=0;i<n;i++){const j=rev[i];if(j>i){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
 const sgn=inverse?1:-1;
 for(let size=2;size<=n;size<<=1){const half=size>>1,step=n/size;
  for(let s=0;s<n;s+=size)for(let k=0;k<half;k++){const wr=T.cos[k*step],wi=sgn*T.sin[k*step],i=s+k,j=i+half;
   const tr=re[j]*wr-im[j]*wi,ti=re[j]*wi+im[j]*wr;re[j]=re[i]-tr;im[j]=im[i]-ti;re[i]+=tr;im[i]+=ti;}}
 if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
/* scipy stft(hann, nperseg=n, noverlap=n-hop, boundary='zeros', padded=True), per-frame
   6th-order magnitude rolloff, istft(boundary=True). Linear, so stft/istft scale factors cancel. */
function adaptiveBandlimit(x,fs,m){
 const N=x.length,n=Math.min(m.filter_window_samples||1024,N),hop=Math.max(1,Math.floor(n/4));
 if((n&(n-1))!==0)throw Error('Filter window must be a power of two.');
 const half=Math.floor(n/2),L=N+2*half,nadd=((((-(L-n))%hop)+hop)%hop)%n,Lp=L+nadd,nseg=(Lp-n)/hop+1;
 const xp=new Float64Array(Lp);xp.set(x,half);
 const win=new Float64Array(n);for(let j=0;j<n;j++)win[j]=.5-.5*Math.cos(TAU*j/n); // periodic Hann
 const out=new Float64Array(Lp),norm=new Float64Array(Lp),T=fftTables(n),re=new Float64Array(n),im=new Float64Array(n),g=new Float64Array(half+1);
 for(let s=0;s<nseg;s++){
  const t=(half+s*hop)/fs-half/fs,cutoff=Math.max(Math.min(radiusCutoff(t,m),fs*.44),1);
  for(let k=0;k<=half;k++){const f=k*fs/n;g[k]=1/Math.sqrt(1+(f/cutoff)**12);}
  const o=s*hop;for(let j=0;j<n;j++){re[j]=xp[o+j]*win[j];im[j]=0;}
  fft(re,im,T,false);
  for(let k=0;k<n;k++){const gk=g[k<=half?k:n-k];re[k]*=gk;im[k]*=gk;}
  im[0]=0;im[half]=0;
  fft(re,im,T,true);
  for(let j=0;j<n;j++){out[o+j]+=re[j]*win[j];norm[o+j]+=win[j]*win[j];}
 }
 const y=new Float64Array(N);
 for(let i=0;i<N;i++){const k=i+half,nv=norm[k];y[i]=out[k]/(nv>1e-10?nv:1);}
 return y;
}
// scipy butter(N, fc, fs=fs, output='sos') lowpass, as conjugate-pole biquads with unity DC gain.
function butterLowpassSos(order,fc,fs){
 const wn=2*fc/fs,warped=4*Math.tan(Math.PI*wn/2),sos=[];
 const poles=[];for(let mm=-order+1;mm<order;mm+=2){const ang=Math.PI*mm/(2*order);poles.push([-Math.cos(ang)*warped,-Math.sin(ang)*warped]);}
 const dig=poles.map(([pr,pi])=>{const nr=4+pr,ni=pi,dr=4-pr,di=-pi,den=dr*dr+di*di;return [(nr*dr+ni*di)/den,(ni*dr-nr*di)/den];});
 const used=new Array(dig.length).fill(false);
 for(let i=0;i<dig.length;i++){if(used[i])continue;used[i]=true;const [r,im]=dig[i];
  if(Math.abs(im)<1e-12){let j=dig.findIndex((p,k)=>!used[k]&&Math.abs(p[1])<1e-12);
   if(j>=0){used[j]=true;const a=[1,-(r+dig[j][0]),r*dig[j][0]];const gain=(1+a[1]+a[2])/4;sos.push({b:[gain,2*gain,gain],a});}
   else{const a=[1,-r,0];const gain=(1+a[1])/2;sos.push({b:[gain,gain,0],a});}continue;}
  const j=dig.findIndex((p,k)=>!used[k]&&Math.abs(p[0]-r)<1e-9&&Math.abs(p[1]+im)<1e-9);if(j>=0)used[j]=true;
  const a=[1,-2*r,r*r+im*im],gain=(1+a[1]+a[2])/4;sos.push({b:[gain,2*gain,gain],a});}
 return sos;
}
function lfilterZi(b,a){const B0=b[1]-a[1]*b[0],B1=b[2]-a[2]*b[0];const z0=(B0+B1)/((1+a[1])+a[2]);return [z0,(1+a[1])*z0-B0];}
function sosfilt(sos,x,zi,scale){let y=x;for(let s=0;s<sos.length;s++)y=lfilter(sos[s].b,sos[s].a,y,[zi[s][0]*scale,zi[s][1]*scale]);return y;}
function sosfiltfilt(sos,x){
 const zeros=Math.min(sos.filter(s=>s.b[2]===0).length,sos.filter(s=>s.a[2]===0).length);
 const padlen=Math.min(3*(2*sos.length+1-zeros),x.length-1),N=x.length,ext=new Float64Array(N+2*padlen);
 for(let i=0;i<padlen;i++){ext[i]=2*x[0]-x[padlen-i];ext[padlen+N+i]=2*x[N-1]-x[N-2-i];}
 ext.set(x,padlen);
 const zi=[];let sc=1;for(const s of sos){const z=lfilterZi(s.b,s.a);zi.push([z[0]*sc,z[1]*sc]);sc*=(s.b[0]+s.b[1]+s.b[2])/(s.a[0]+s.a[1]+s.a[2]);}
 let y=sosfilt(sos,ext,zi,ext[0]);y.reverse();y=sosfilt(sos,y,zi,y[0]);y.reverse();
 return y.slice(padlen,padlen+N);
}
function postprocess(x,fs,m){
 if(m.bandlimit_mode==='radius-following-v1')return presence(adaptiveBandlimit(x,fs,m),fs,m,true);
 return presence(sosfiltfilt(butterLowpassSos(4,Math.min(m.bandlimit_hz,fs*.42),fs),x),fs,m,true);
}

/* ---------- encode.py ---------- */
function parameters(duration,size=4096){
 const radius=duration<=40?90:150,label=radius===90?27:43,rpm=duration<=120?45:33.3333333333,start=radius-4,lead=.35;
 const turns=duration*rpm/60,fitted=(start-label-3)/(turns+lead+.5),pitch=Math.min(fitted,2),fs=FS;
 const m={encoding_version:'vinyl-heightmap-lateral-v2',rpm_cut:rpm,pitch_mm:pitch,r_start_mm:start,disc_radius_mm:radius,
  label_radius_mm:label,amp_mm:Math.min(.30,pitch*.16),groove_width_mm:Math.min(.8,pitch*.50),groove_depth_mm:.45,
  thickness_mm:2.5,sample_rate:fs,duration_sec:duration,lead_in_turns:lead,lead_out_turns:.5,image_size:size,height_scale_mm:2.55,
  audio_storage:'Explicit prepared-displacement vector master + PNG depth export; never the original upload.',
  riaa:'none (custom reversible presence shelf, not RIAA)',max_duration_sec:MAX_SECONDS,
  warning:'Raster-limited lo-fi mono. Files over 8 min are truncated. Not a physical stylus simulator.'};
 Object.assign(m,{packing_mode:'outer-band-if-room-v1',height_polarity:'inverted',bandlimit_mode:'radius-following-v1',bandlimit_cap_hz:6500,
  filter_window_samples:1024,filter_hop_samples:256,raster_subsamples:4,preemphasis:'presence-shelf-v1',
  presence_shelf:{frequency_hz:1500,gain_db:6,slope:1},outside_value:32768,outside_fill:'mid-grey'});
 m.bandlimit_hz=radiusCutoff(duration,m);m.bandlimit_outer_hz=radiusCutoff(0,m);
 const {b,a}=shelfCoefficients(fs);Object.assign(m.presence_shelf,{b,a,coefficient_sample_rate:fs});
 return m;
}
function prepareAudio(x,fs,m){
 const mu=mean(x);let y=new Float64Array(x.length);for(let i=0;i<x.length;i++)y[i]=x[i]-mu;
 if(m.bandlimit_mode==='radius-following-v1')y=adaptiveBandlimit(presence(y,fs,m),fs,m);
 else y=sosfiltfilt(butterLowpassSos(6,m.bandlimit_hz,fs),y);
 let peak=0;for(let i=0;i<y.length;i++)peak=Math.max(peak,Math.abs(y[i]));
 if(peak>1e-9){const g=.90/peak;for(let i=0;i<y.length;i++)y[i]*=g;}
 return y;
}
// load_audio semantics on already-decoded mono samples: 16 kHz, max 480 s, min 0.1 s, NaN -> 0.
function loadAudio(samples,fs=FS){
 if(fs!==FS)samples=resample(samples,fs,FS);
 const n=Math.min(samples.length,MAX_SECONDS*FS),x=new Float64Array(n);
 for(let i=0;i<n;i++){const v=samples[i];x[i]=Number.isNaN(v)?0:(v===Infinity?Number.MAX_VALUE:(v===-Infinity?-Number.MAX_VALUE:v));}
 if(x.length<1600)throw Error('Audio must be at least 0.1 seconds long.');
 return x;
}
/* Rasterize an already prepared (quantized) vector; never re-filter it.
   2x2 physical subpixel average, inverted polarity, outside_value outside the disc. */
function rasterize(x,fs,m,onRow){
 const n=m.image_size|0,R=m.disc_radius_mm,start=m.r_start_mm,pitch=m.pitch_mm,scale=2*R/(n-1),line=linspace(-R,R,n);
 const result=new Uint16Array(n*n),end=m.lead_in_turns+m.duration_sec*m.rpm_cut/60+m.lead_out_turns;
 const lead=m.lead_in_turns,rpm=m.rpm_cut,amp=m.amp_mm,hw=m.groove_width_mm/2,depth=m.groove_depth_mm,thick=m.thickness_mm,hs=m.height_scale_mm;
 const inverted=(m.height_polarity||'standard')==='inverted',bg=(m.outside_value|0),N=x.length,last=N-1,offs=[-.25,.25];
 const xs=[new Float64Array(n),new Float64Array(n)];for(let c=0;c<n;c++){xs[0][c]=line[c]+offs[0]*scale;xs[1][c]=line[c]+offs[1]*scale;}
 for(let row=0;row<n;row++){
  const yrow=line[row],y0=-yrow-offs[0]*scale,y1=-yrow-offs[1]*scale,base=row*n;
  for(let col=0;col<n;col++){
   const lc=line[col];
   if(Math.sqrt(lc*lc+yrow*yrow)>R){result[base+col]=bg;continue;}
   let acc=0;
   for(let oy=0;oy<2;oy++){const yy=oy?y1:y0;
    for(let ox=0;ox<2;ox++){const xx=xs[ox][col];
     const rr=Math.sqrt(xx*xx+yy*yy);let phi=-Math.atan2(yy,xx);if(phi<0)phi+=TAU;
     const k=rint((start-rr)/pitch-phi/TAU),turns=k+phi/TAU,idx=(turns-lead)*60/rpm*fs;
     let v=0;if(idx>=0&&idx<=last){const j=Math.floor(idx);v=j===last?x[last]:(x[j+1]-x[j])*(idx-j)+x[j];}
     const delta=rr-(start-pitch*turns+v*amp);
     let valley=Math.max(0,1-Math.abs(delta)/hw);if(!(turns>=0&&turns<=end))valley=0;
     acc+=(thick-depth*valley)/4;
    }}
   const phys=acc/hs*65535,stored=inverted?65535-phys:phys;
   result[base+col]=rint(Math.min(65535,Math.max(0,stored)));
  }
  if(onRow&&(row&63)===63)onRow((row+1)/n);
 }
 return result;
}

/* ---------- vector.py ---------- */
function quantizeVector(x){const pcm=new Int16Array(x.length);for(let i=0;i<x.length;i++)pcm[i]=rint(Math.min(32767/32768,Math.max(-1,x[i]))*32768);return pcm;}
function pcmBytesLE(pcm){const b=new Uint8Array(pcm.length*2),dv=new DataView(b.buffer);for(let i=0;i<pcm.length;i++)dv.setInt16(i*2,pcm[i],true);return b;}
async function writeVector(x,m){
 const pcm=quantizeVector(x);
 m.vector_master={format:VECTOR_FORMAT,sample_count:pcm.length,sha256:await sha256Hex(pcmBytesLE(pcm)),
  meaning:'Prepared lateral displacement / amp_mm; adaptive-filtered, presence-emphasized, peak-normalized. Not the original upload.'};
 const xq=new Float64Array(pcm.length);for(let i=0;i<pcm.length;i++)xq[i]=pcm[i]/32768;
 return {pcm,x:xq,wav:writeWav16(pcm,m.sample_rate)};
}
async function readVector(wavBytes,m){
 if(!m)throw Error('Vector requires matching spiral JSON metadata.');
 validateMetadata(m);
 const v=m.vector_master||{};if(v.format!==VECTOR_FORMAT)throw Error('Not a declared groove displacement master.');
 const w=parseWav(wavBytes),expected=rint(m.duration_sec*m.sample_rate);
 if(w.format!=='int16'||w.channels!==1||w.sampleRate!==m.sample_rate||w.length!==expected||w.length!==v.sample_count)
  throw Error('Vector must be PCM16 mono with the declared sample rate and duration.');
 const pcm=w.data[0];
 if(await sha256Hex(pcmBytesLE(pcm))!==v.sha256)throw Error('Vector does not match the PNG/JSON metadata (checksum mismatch).');
 const x=new Float64Array(pcm.length);for(let i=0;i<pcm.length;i++)x[i]=pcm[i]/32768;
 return {x,m};
}
async function decodeVector(wavBytes,m){const r=await readVector(wavBytes,m);return {signal:presence(r.x,r.m.sample_rate|0,r.m,true),m:r.m};}

/* ---------- decode.py ---------- */
function validateMetadata(m,size){
 if(!m||typeof m!=='object')throw Error('No vinyl metadata. Use an app-exported PNG (keep its metadata).');
 size=size===undefined?m.image_size:size;
 if(size!==2048&&size!==4096)throw Error('Expected 2048 or 4096 map dimensions.');
 if(!['vinyl-heightmap-lateral-v1','vinyl-heightmap-lateral-v2'].includes(m.encoding_version))throw Error('Unsupported map encoding.');
 for(const k of ['rpm_cut','pitch_mm','r_start_mm','disc_radius_mm','label_radius_mm','amp_mm','groove_width_mm','groove_depth_mm','thickness_mm','sample_rate','duration_sec','lead_in_turns','bandlimit_hz','height_scale_mm'])
  if(!isNum(m[k])||m[k]<=0)throw Error('Invalid metadata: '+k);
 if(!(.1<=m.duration_sec&&m.duration_sec<=480&&800<=m.sample_rate&&m.sample_rate<=16000&&1<=m.rpm_cut&&m.rpm_cut<=100&&m.groove_width_mm<m.pitch_mm&&m.amp_mm<m.pitch_mm*.3&&m.image_size===size))
  throw Error('Out-of-range groove metadata.');
 const polarity=m.height_polarity??'standard';if(polarity!=='standard'&&polarity!=='inverted')throw Error('Unsupported height polarity.');
 if(m.preemphasis!=null&&m.preemphasis!=='presence-shelf-v1')throw Error('Unsupported preemphasis.');
 if(m.bandlimit_mode!=null&&m.bandlimit_mode!=='radius-following-v1')throw Error('Unsupported bandlimit mode.');
 if(!(0<m.bandlimit_hz&&m.bandlimit_hz<m.sample_rate/2))throw Error('Invalid cutoff.');
 if(m.preemphasis){const p=m.presence_shelf||{};
  if(!(0<(p.frequency_hz??0)&&(p.frequency_hz??0)<m.sample_rate*.45&&0<=(p.gain_db??-1)&&(p.gain_db??-1)<=12&&(p.slope??1)===1))throw Error('Invalid shelf.');}
 if(m.bandlimit_mode){const outer=m.bandlimit_outer_hz??0,cap=m.bandlimit_cap_hz??0;
  if(!(m.bandlimit_hz<=outer&&outer<=6500&&0<cap&&cap<=6500&&m.filter_window_samples===1024&&m.filter_hop_samples===256))throw Error('Invalid adaptive bandwidth.');}
 return m;
}
// read_map: square 2048/4096, 16-bit greyscale only, vinyl text chunk or sidecar JSON.
async function readMap(pngBytes,sidecarText){
 const png=await decodePng(pngBytes);
 if(png.width!==png.height||(png.width!==2048&&png.width!==4096))throw Error('Expected a square 2048 or 4096 app height map.');
 if(png.colorType!==0||png.bitDepth!==16)throw Error('Expected a 16-bit grayscale height map, not an RGB preview.');
 let raw=png.text.vinyl;
 if(!raw){if(!sidecarText)throw Error('No vinyl metadata. Use an app-exported PNG (keep its metadata).');raw=sidecarText;}
 const m=JSON.parse(raw);validateMetadata(m,png.width);
 const n=png.width,stored=png.samples,image=new Float32Array(n*n);
 if((m.height_polarity??'standard')==='inverted'){
  const R=m.disc_radius_mm,line=linspace(-R,R,n);
  for(let r=0;r<n;r++){const ly=line[r];for(let c=0;c<n;c++){const lx=line[c],i=r*n+c;image[i]=Math.sqrt(lx*lx+ly*ly)<=R?65535-stored[i]:0;}}
 }else image.set(stored);
 return {image,m,stored,size:n};
}
// map_coordinates(order=1, mode='nearest') on a float32 image, output float32.
function decodeTrace(image,m,onProgress){
 const n=Math.round(Math.sqrt(image.length)),fs=m.sample_rate|0,count=Math.trunc(m.duration_sec*fs),signal=new Float64Array(count);
 const span=m.amp_mm+m.groove_width_mm/2,offsets=linspace(-span,span,65),R=m.disc_radius_mm,k=(n-1)/(2*R),hi=n-1;
 const thick=Math.fround(m.thickness_mm),hs=Math.fround(m.height_scale_mm),amp=m.amp_mm,depth=new Float64Array(65);
 const sample=(py,px)=>{const y0=Math.floor(py),x0=Math.floor(px),fy=py-y0,fx=px-x0;
  const ya=Math.min(hi,Math.max(0,y0)),yb=Math.min(hi,Math.max(0,y0+1)),xa=Math.min(hi,Math.max(0,x0)),xb=Math.min(hi,Math.max(0,x0+1));
  return (1-fy)*((1-fx)*image[ya*n+xa]+fx*image[ya*n+xb])+fy*((1-fx)*image[yb*n+xa]+fx*image[yb*n+xb]);};
 for(let i=0;i<count;i++){
  const t=i/fs,theta=TAU*(m.lead_in_turns+t*m.rpm_cut/60),nominal=m.r_start_mm-m.pitch_mm*theta/TAU,c=Math.cos(-theta),s=Math.sin(-theta);
  let num=0,den=0;
  for(let j=0;j<65;j++){const r=nominal+offsets[j],px=(r*c+R)*(n-1)/(2*R),py=(R-r*s)*(n-1)/(2*R);
   const v=Math.fround(sample(py,px));
   const d=Math.fround(Math.max(0,Math.fround(thick-Math.fround(Math.fround(v/65535)*hs))));
   num+=d*offsets[j];den+=d;}
  signal[i]=num/Math.max(Math.fround(den),1e-9)/amp;
  if(onProgress&&(i&16383)===16383)onProgress(i/count);
 }
 const mu=mean(signal);for(let i=0;i<count;i++)signal[i]-=mu;
 return postprocess(signal,fs,m);
}

/* ---------- serve.py helpers ---------- */
// write_playback at 16 kHz: clip, *32767, truncate to int16; returned as the float a WAV decoder sees.
function playbackPcm(audio){const pcm=new Int16Array(audio.length);for(let i=0;i<audio.length;i++)pcm[i]=Math.trunc(Math.min(1,Math.max(-1,audio[i]))*32767);return pcm;}
function pcmToFloat(pcm){const f=new Float32Array(pcm.length);for(let i=0;i<pcm.length;i++)f[i]=pcm[i]/32768;return f;}
// Pillow-style separable bicubic (a=-0.5) resample with antialias support, uint8 between passes.
function resampleCoeffs(inSize,outSize){
 const scale=inSize/outSize,fscale=Math.max(scale,1),support=2*fscale,ss=1/fscale,out=[];
 const cubic=x=>{x=Math.abs(x);const a=-.5;if(x<1)return((a+2)*x-(a+3))*x*x+1;if(x<2)return(((x-5)*x+8)*x-4)*a;return 0;};
 for(let xx=0;xx<outSize;xx++){const center=(xx+.5)*scale;let xmin=Math.trunc(center-support+.5);if(xmin<0)xmin=0;let xmax=Math.trunc(center+support+.5);if(xmax>inSize)xmax=inSize;xmax-=xmin;
  const w=new Float64Array(xmax);let ww=0;for(let x=0;x<xmax;x++){w[x]=cubic((x+xmin-center+.5)*ss);ww+=w[x];}if(ww!==0)for(let x=0;x<xmax;x++)w[x]/=ww;out.push({xmin,w});}
 return out;
}
const clip8=v=>{v=Math.round(v);return v<0?0:v>255?255:v;};
function resizeChannel(src,n,size){
 const cs=resampleCoeffs(n,size),mid=new Uint8Array(size*n),dst=new Uint8Array(size*size);
 for(let r=0;r<n;r++){const row=r*n;for(let c=0;c<size;c++){const {xmin,w}=cs[c];let s=0;for(let k=0;k<w.length;k++)s+=src[row+xmin+k]*w[k];mid[r*size+c]=clip8(s);}}
 for(let r=0;r<size;r++){const {xmin,w}=cs[r];for(let c=0;c<size;c++){let s=0;for(let k=0;k<w.length;k++)s+=mid[(xmin+k)*size+c]*w[k];dst[r*size+c]=clip8(s);}}
 return dst;
}
// write_preview: grey = stored/257, red paper label (196,36,32), resized to 1024².
async function writePreview(stored,n,m,size=1024){
 const R=m.disc_radius_mm,label=m.label_radius_mm,line=linspace(-R,R,n),ch=[new Uint8Array(n*n),new Uint8Array(n*n),new Uint8Array(n*n)];
 for(let r=0;r<n;r++){const ly=line[r];for(let c=0;c<n;c++){const i=r*n+c,lx=line[c],g=Math.trunc(stored[i]/257);
  if(Math.sqrt(lx*lx+ly*ly)<=label){ch[0][i]=196;ch[1][i]=36;ch[2][i]=32;}else{ch[0][i]=ch[1][i]=ch[2][i]=g;}}}
 const small=ch.map(c=>resizeChannel(c,n,size)),rgb=new Uint8Array(size*size*3);
 for(let i=0;i<size*size;i++){rgb[i*3]=small[0][i];rgb[i*3+1]=small[1][i];rgb[i*3+2]=small[2][i];}
 return encodePng({width:size,height:size,colorType:2,bitDepth:8,data:rgb});
}

/* ---------- WAV ---------- */
function writeWav16(pcm,fs){
 const b=new Uint8Array(44+pcm.length*2),dv=new DataView(b.buffer),str=(o,s)=>{for(let i=0;i<s.length;i++)b[o+i]=s.charCodeAt(i);};
 str(0,'RIFF');dv.setUint32(4,36+pcm.length*2,true);str(8,'WAVE');str(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
 dv.setUint32(24,fs,true);dv.setUint32(28,fs*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);str(36,'data');dv.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++)dv.setInt16(44+i*2,pcm[i],true);
 return b;
}
function isWav(bytes){const b=toU8(bytes);return b.length>12&&String.fromCharCode(...b.subarray(0,4))==='RIFF'&&String.fromCharCode(...b.subarray(8,12))==='WAVE';}
function parseWav(bytes){
 const b=toU8(bytes),dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(!isWav(b))throw Error('Not a WAV file.');
 let fmt=null,data=null,o=12;
 while(o+8<=b.length){const id=String.fromCharCode(...b.subarray(o,o+4)),size=dv.getUint32(o+4,true),body=o+8;
  if(id==='fmt ')fmt={tag:dv.getUint16(body,true),channels:dv.getUint16(body+2,true),sampleRate:dv.getUint32(body+4,true),bits:dv.getUint16(body+14,true),sub:size>=26?dv.getUint16(body+24,true):0};
  else if(id==='data'){data=[body,Math.min(size,b.length-body)];break;}
  o=body+size+(size&1);}
 if(!fmt||!data)throw Error('Unreadable WAV file.');
 const tag=fmt.tag===0xFFFE?fmt.sub:fmt.tag,ch=fmt.channels,bps=fmt.bits/8,frames=Math.floor(data[1]/(bps*ch));
 if(!(tag===1&&[8,16,24,32].includes(fmt.bits))&&!(tag===3&&[32,64].includes(fmt.bits)))throw Error('Unsupported WAV encoding.');
 const format=tag===3?'float':(fmt.bits===16?'int16':'int'+fmt.bits),out=[];
 for(let c=0;c<ch;c++)out.push(fmt.bits===16&&tag===1?new Int16Array(frames):new Float64Array(frames));
 for(let i=0;i<frames;i++)for(let c=0;c<ch;c++){const p=data[0]+(i*ch+c)*bps;let v;
  if(tag===3)v=fmt.bits===32?dv.getFloat32(p,true):dv.getFloat64(p,true);
  else if(fmt.bits===8)v=(b[p]-128)/128;
  else if(fmt.bits===16)v=dv.getInt16(p,true);
  else if(fmt.bits===24){let s=b[p]|(b[p+1]<<8)|(b[p+2]<<16);if(s&0x800000)s|=~0xFFFFFF;v=s/8388608;}
  else v=dv.getInt32(p,true)/2147483648;
  out[c][i]=v;}
 return {sampleRate:fmt.sampleRate,channels:ch,length:frames,format,data:out};
}
// WAV upload -> mono at its own rate (like ffmpeg -ac 1), truncated at 480 s before resampling.
function wavToMono(bytes){
 const w=parseWav(bytes),n=Math.min(w.length,MAX_SECONDS*w.sampleRate),x=new Float32Array(n),div=w.format==='int16'?32768:1;
 for(let i=0;i<n;i++){let s=0;for(let c=0;c<w.channels;c++)s+=w.data[c][i]/div;x[i]=s/w.channels;}
 return {samples:x,sampleRate:w.sampleRate};
}
// Polyphase windowed-sinc resampler (Kaiser, 32 zero crossings). Not bit-identical to ffmpeg.
function resample(x,fsIn,fsOut){
 if(fsIn===fsOut)return Float64Array.from(x);
 const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(fsIn,fsOut),up=fsOut/g,down=fsIn/g;
 const ratio=fsOut/fsIn,cut=.97*Math.min(1,ratio),zc=32,half=Math.ceil(zc/cut),beta=8.6;
 const i0=v=>{let s=1,t=1;for(let k=1;k<30;k++){t*=(v/(2*k))**2;s+=t;}return s;},ib=i0(beta);
 const kern=d=>{if(Math.abs(d)>=half)return 0;const w=i0(beta*Math.sqrt(1-(d/half)**2))/ib,a=Math.PI*cut*d;return cut*(a===0?1:Math.sin(a)/a)*w;};
 const outLen=Math.round(x.length*up/down),y=new Float64Array(outLen),taps=2*half,phases=up<=4096?up:0,table=new Map();
 const coeffs=frac=>{const w=new Float64Array(taps);let s=0;for(let k=0;k<taps;k++){w[k]=kern(k-half+1-frac);s+=w[k];}for(let k=0;k<taps;k++)w[k]/=s;return w;};
 for(let mIdx=0;mIdx<outLen;mIdx++){
  const num=mIdx*down,base=Math.floor(num/up),ph=num-base*up,frac=ph/up;
  let w=phases?table.get(ph):null;if(!w){w=coeffs(frac);if(phases)table.set(ph,w);}
  let s=0;const start=base-half+1;
  for(let k=0;k<taps;k++){const j=start+k;if(j>=0&&j<x.length)s+=x[j]*w[k];}
  y[mIdx]=s;
 }
 return y;
}

/* ---------- PNG (16-bit greyscale preserved; samples big-endian) ---------- */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(parts){let c=0xFFFFFFFF;for(const p of parts)for(let i=0;i<p.length;i++)c=CRC[(c^p[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function toU8(x){return x instanceof Uint8Array?x:(ArrayBuffer.isView(x)?new Uint8Array(x.buffer,x.byteOffset,x.byteLength):new Uint8Array(x));}
async function streamBytes(bytes,transform){return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());}
const deflate=b=>streamBytes(b,new CompressionStream('deflate'));
const inflate=b=>streamBytes(b,new DecompressionStream('deflate'));
const utf8=s=>new TextEncoder().encode(s);
function chunk(type,data){const out=new Uint8Array(12+data.length),dv=new DataView(out.buffer),t=utf8(type);dv.setUint32(0,data.length);out.set(t,4);out.set(data,8);dv.setUint32(8+data.length,crc32([t,data]));return out;}
function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:(pb<=pc?b:c);}
/* encodePng({width,height,colorType:0|2,bitDepth:8|16,data:Uint8Array big-endian bytes or samples:Uint16Array,text:{key:value}}) */
async function encodePng(img){
 const {width,height,colorType,bitDepth}=img,chans=colorType===2?3:1,bpp=chans*bitDepth/8,stride=width*bpp;
 let raw=img.data;
 if(!raw){raw=new Uint8Array(width*height*2);const s=img.samples;for(let i=0;i<s.length;i++){raw[2*i]=s[i]>>8;raw[2*i+1]=s[i]&255;}}
 const filtered=new Uint8Array(height*(stride+1)),cand=[0,1,2,3,4].map(()=>new Uint8Array(stride)),zero=new Uint8Array(stride);
 for(let y=0;y<height;y++){
  const cur=raw.subarray(y*stride,(y+1)*stride),prev=y?raw.subarray((y-1)*stride,y*stride):zero;let best=0,bestSum=Infinity;
  for(let f=0;f<5;f++){const o=cand[f];let sum=0;
   for(let i=0;i<stride;i++){const a=i>=bpp?cur[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0;
    const p=f===0?0:f===1?a:f===2?b:f===3?((a+b)>>1):paeth(a,b,c);const v=(cur[i]-p)&255;o[i]=v;sum+=v<128?v:256-v;if(sum>=bestSum)break;}
   if(sum<bestSum){bestSum=sum;best=f;}}
  // recompute the winner fully (the scan above may have stopped early)
  const o=filtered.subarray(y*(stride+1)+1,(y+1)*(stride+1));filtered[y*(stride+1)]=best;
  for(let i=0;i<stride;i++){const a=i>=bpp?cur[i-bpp]:0,b=prev[i],c=i>=bpp?prev[i-bpp]:0;
   const p=best===0?0:best===1?a:best===2?b:best===3?((a+b)>>1):paeth(a,b,c);o[i]=(cur[i]-p)&255;}
 }
 const ihdr=new Uint8Array(13),dv=new DataView(ihdr.buffer);dv.setUint32(0,width);dv.setUint32(4,height);ihdr[8]=bitDepth;ihdr[9]=colorType;
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr)];
 for(const [k,v] of Object.entries(img.text||{})){const kb=utf8(k),vb=utf8(v),d=new Uint8Array(kb.length+5+vb.length);d.set(kb,0);d.set(vb,kb.length+5);parts.push(chunk('iTXt',d));}
 parts.push(chunk('IDAT',await deflate(filtered)),chunk('IEND',new Uint8Array(0)));
 const total=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(total);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
 return out;
}
async function decodePng(bytes){
 const b=toU8(bytes),sig=[137,80,78,71,13,10,26,10];
 if(b.length<8||sig.some((v,i)=>b[i]!==v))throw Error('Not a PNG file.');
 const dv=new DataView(b.buffer,b.byteOffset,b.byteLength),idat=[],text={},latin=d=>String.fromCharCode(...d),dec=new TextDecoder();
 let o=8,hdr=null;
 while(o+8<=b.length){const len=dv.getUint32(o),type=latin(b.subarray(o+4,o+8)),d=b.subarray(o+8,o+8+len);o+=12+len;
  if(type==='IHDR')hdr={width:dv.getUint32(16),height:dv.getUint32(20),bitDepth:d[8],colorType:d[9],interlace:d[12]};
  else if(type==='IDAT')idat.push(d);
  else if(type==='tEXt'){const z=d.indexOf(0);text[latin(d.subarray(0,z))]=Array.from(d.subarray(z+1),c=>String.fromCharCode(c)).join('');}
  else if(type==='zTXt'){const z=d.indexOf(0);text[latin(d.subarray(0,z))]=Array.from(await inflate(d.subarray(z+2)),c=>String.fromCharCode(c)).join('');}
  else if(type==='iTXt'){const z=d.indexOf(0),key=latin(d.subarray(0,z)),comp=d[z+1];let p=z+3;p=d.indexOf(0,p)+1;p=d.indexOf(0,p)+1;
   const body=d.subarray(p);text[key]=dec.decode(comp?await inflate(body):body);}
  else if(type==='IEND')break;}
 if(!hdr)throw Error('Not a PNG file.');
 const info={...hdr,text};
 // Header-only checks come first so a big RGB preview is refused without inflating it.
 if(hdr.colorType!==0||hdr.bitDepth!==16)return Object.assign(info,{samples:null});
 if(hdr.interlace)throw Error('Interlaced PNGs are not supported; use an app-exported PNG.');
 const all=new Uint8Array(idat.reduce((s,d)=>s+d.length,0));{let p=0;for(const d of idat){all.set(d,p);p+=d.length;}}
 const raw=await inflate(all),w=hdr.width,h=hdr.height,bpp=2,stride=w*bpp;
 if(raw.length<h*(stride+1))throw Error('Truncated PNG data.');
 const cur=new Uint8Array(stride),prev=new Uint8Array(stride),samples=new Uint16Array(w*h);
 for(let y=0;y<h;y++){const f=raw[y*(stride+1)],src=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
  for(let i=0;i<stride;i++){const a=i>=bpp?cur[i-bpp]:0,bb=prev[i],c=i>=bpp?prev[i-bpp]:0;
   const p=f===0?0:f===1?a:f===2?bb:f===3?((a+bb)>>1):f===4?paeth(a,bb,c):-1;if(p<0)throw Error('Bad PNG filter.');cur[i]=(src[i]+p)&255;}
  for(let x=0;x<w;x++)samples[y*w+x]=(cur[2*x]<<8)|cur[2*x+1];
  prev.set(cur);}
 return Object.assign(info,{samples});
}

/* ---------- sha256 (WebCrypto when present, else a small pure-JS fallback) ---------- */
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
async function sha256Hex(bytes){
 const s=(typeof crypto!=='undefined'&&crypto.subtle)?crypto.subtle:null;
 if(s){try{return hex(await s.digest('SHA-256',bytes));}catch{}}
 return sha256Fallback(toU8(bytes));
}
function sha256Fallback(m){
 const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
 const H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
 const len=m.length,padded=new Uint8Array(((len+9+63)>>6)<<6);padded.set(m);padded[len]=0x80;const dv=new DataView(padded.buffer);
 dv.setUint32(padded.length-8,Math.floor(len/0x20000000));dv.setUint32(padded.length-4,(len<<3)>>>0);
 const W=new Uint32Array(64),r=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let o=0;o<padded.length;o+=64){
  for(let i=0;i<16;i++)W[i]=dv.getUint32(o+i*4);
  for(let i=16;i<64;i++){const a=W[i-15],b=W[i-2];W[i]=(W[i-16]+(r(a,7)^r(a,18)^(a>>>3))+W[i-7]+(r(b,17)^r(b,19)^(b>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,h]=H;
  for(let i=0;i<64;i++){const t1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+W[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  H[0]+=a;H[1]+=b;H[2]+=c;H[3]+=d;H[4]+=e;H[5]+=f;H[6]+=g;H[7]+=h;}
 return Array.from(H,v=>v.toString(16).padStart(8,'0')).join('');
}

/* ---------- full pipelines (what serve.py's /api/encode and /api/import do) ---------- */
// samples: mono Float32/64 at sampleRate. Returns the delivery set as bytes.
async function encodeRecord(samples,sampleRate,size=4096,onStage=()=>{}){
 if(size!==2048&&size!==4096)throw Error('Choose a 2048 or 4096 map.');
 onStage('cutting',0);
 const x0=loadAudio(samples,sampleRate),m=parameters(x0.length/FS,size),prepared=prepareAudio(x0,FS,m);
 const vec=await writeVector(prepared,m);
 const stored=rasterize(vec.x,FS,m,f=>onStage('cutting',f));
 const png=await encodePng({width:size,height:size,colorType:0,bitDepth:16,samples:stored,text:{vinyl:JSON.stringify(m)}});
 onStage('tracing',0);
 // read the cut back the way the Player will: PNG + metadata + checksummed groove master
 const back=await readMap(png);await readVector(vec.wav,back.m);
 onStage('proofing',0);
 const preview=await writePreview(stored,size,m);
 return {metadata:back.m,png,groove:vec.wav,json:JSON.stringify(back.m,null,2),preview,has_vector:true,playback_source:'vector'};
}
async function importRecord({png,vector,json},onStage=()=>{}){
 if(!png)throw Error('Pick a PNG, or a vector WAV plus matching JSON.');
 onStage('tracing',0);
 const map=await readMap(png,json||null);let m=map.m,vectorAudio=null,origin='png';
 if(vector){const v=await decodeVector(vector,m);m=v.m;vectorAudio=v.signal;origin='vector';}
 const pngAudio=decodeTrace(map.image,m,f=>onStage('tracing',f));
 onStage('proofing',0);
 const preview=await writePreview(map.stored,map.size,m);
 const has=!!vector;
 return {metadata:m,playback_source:origin,has_vector:has,has_png:true,
  audio_origin:has?'Both sources ready: use Playback to hear the vector master or the PNG trace. Never the original upload.':'PNG-only: traced from heightmap.png pixels; no vector or original upload is used.',
  playback:{png:pcmToFloat(playbackPcm(pngAudio)),vector:vectorAudio?pcmToFloat(playbackPcm(vectorAudio)):null},preview};
}

const api={MAX_SECONDS,VECTOR_FORMAT,rint,linspace,shelfCoefficients,lfilter,presence,radiusCutoff,adaptiveBandlimit,butterLowpassSos,sosfiltfilt,postprocess,
 parameters,prepareAudio,loadAudio,rasterize,quantizeVector,writeVector,readVector,decodeVector,validateMetadata,readMap,decodeTrace,
 playbackPcm,pcmToFloat,writePreview,writeWav16,parseWav,isWav,wavToMono,resample,encodePng,decodePng,sha256Hex,sha256Fallback,encodeRecord,importRecord};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VinylCore=api;
})(typeof self!=='undefined'?self:this);
