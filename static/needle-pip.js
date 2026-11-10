/* Needle view: a small engraved close-up of the stylus sitting in the groove, top right.
   It reads the same groove the player is playing: the active source's samples at the
   player's own read head (window.vinyl.time()), so it stops, lifts and runs backwards
   with the record. Nothing here touches the audio.

   Groove (the Cutter's equation, same as the needle-demo prototype):
     turns(t)  = lead_in + t * rpm/60
     centre    = r_start - pitch*turns + x(t)*amp_mm       (x = lateral displacement, +rim)
     depth     = groove_depth * max(0, 1 - |r - centre| / (groove_width/2))   (V profile)
   x comes from the playback buffer with the Cutter's presence shelf put back on, which
   undoes the player's de-emphasis: for the vector source that is the groove master again;
   for the PNG source it is the trace read from the pixels (so both views show what that
   source's stylus reads). Ideal contact, mono: a spherical tip resting on both walls.
   Drawn at true scale, the same both ways; nothing is exaggerated.
   Costs nothing while hidden: no samples prepared, no frames drawn. */
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
 const xs=tp=>{const idx=tp*fs;if(!(idx>=0&&idx<=last))return 0;const j=Math.floor(idx);return j===last?x[last]:x[j]+(x[j+1]-x[j])*(idx-j);};
 const turnsAt=t=>lead+t*rpm/60, radius=t=>start-pitch*turnsAt(t), speed=t=>TAU*radius(t)*rpm/60; // mm of groove per program second
 // Centre of turn k (0 = under the stylus, +1 = next turn in, toward the label), u mm upstream,
 // in the stylus frame: w across the record (+ toward the rim), 0 = this turn's nominal radius.
 function centre(k,u,t){const Rc=radius(t),turns=turnsAt(t)+k+u/(TAU*Rc);if(turns<0||turns>end)return null;
  return -k*pitch+amp*xs(t+k*rev+u/speed(t))-u*u/(2*Rc);}
 const rho=hw*.25,slope=depth/hw,sec=Math.sqrt(1+slope*slope);
 const tip={rho,centreY:-depth+rho*sec,contactDelta:rho*slope/sec,contactY:-depth+rho*slope*slope/sec};
 function stylus(t){return amp*xs(t);}
 function swept(t0,t1){const a=Math.min(t0,t1)*fs,b=Math.max(t0,t1)*fs;let lo=Math.min(xs(t0),xs(t1)),hi=Math.max(xs(t0),xs(t1));
  for(let i=Math.ceil(a);i<=Math.floor(b)&&i-a<200000;i++){const v=i>=0&&i<=last?x[i]:0;if(v<lo)lo=v;if(v>hi)hi=v;}return [lo*amp,hi*amp];}
 // Where turn k sits relative to the stylus tip, u mm upstream, over one exposure (program time t0..t1, the
 // span since the last frame): lo/hi = the range it covered, mean = its average. Zero span = the instant.
 const eb=new Float64Array(49);let ek='';
 function exposure(k,u,t0,t1){const c1=centre(k,u,t1);if(c1===null)return null;
  const a=Math.min(t0,t1),b=Math.max(t0,t1),tm=(a+b)/2,off=k*rev+u/speed(tm),bend=-k*pitch-u*u/(2*radius(tm));
  const n=Math.min(48,Math.floor((b-a)*fs)); // 48 instants per exposure: enough for a steady range and average
  if(n<1){const v=c1-stylus(t1);return {lo:v,hi:v,mean:v};}
  if(ek!==a+'|'+b+'|'+n){ek=a+'|'+b+'|'+n;for(let i=0;i<=n;i++)eb[i]=xs(a+(b-a)*i/n);} // the tip's own path, once per frame
  let lo=Infinity,hi=-Infinity,sum=0;for(let i=0;i<=n;i++){const v=bend+amp*(xs(a+(b-a)*i/n+off)-eb[i]);if(v<lo)lo=v;if(v>hi)hi=v;sum+=v;}
  return {lo,hi,mean:sum/(n+1)};}
 function profile(w,t,offs){let best=0;for(let k=-2;k<=2;k++){const c=offs?offs[k+2]:centre(k,0,t);if(c===null||c===undefined)continue;const v=1-Math.abs(w-c)/hw;if(v>best)best=v;}return -depth*best;}
 return {m,fs,amp,hw,depth,pitch,rev,end,xs,turnsAt,radius,speed,centre,exposure,tip,stylus,swept,profile,pixelMm:2*m.disc_radius_mm/((m.image_size||4096)-1)};
}
// Screen layout for a W x H panel (CSS px): true scale both ways, fitted to this record's groove.
function layout(model,W,H){
 const {pitch,hw,depth}=model,Wv=pitch*.75+hw;
 const S=Math.min(W/(2*Wv),H*.3/depth),base=H-15,sy0=Math.min(H*.62,base-depth*S-6),hzn=6,P=sy0-hzn;
 // seen from the front left and above: the groove runs off up and to the right, with a little perspective
 const ox=.62,oy=.95,Dp=2.2*P/(S*oy),L=P/(S*oy-P/Dp)*1.05;
 const steps=[.05,.1,.2,.25,.5,1,2,5];let bar=steps[0];for(const s of steps)if(s*S<=W*.32)bar=s;
 return {W,H,S,cx:W*.36,sy0,hzn,P,Dp,L,ox,oy,base,half:W/S,bar};
}
function project(L,w,u,y){const g=1/(1+u/L.Dp);return [L.cx+L.S*g*(w+u*L.ox),L.sy0-L.S*g*(y+u*L.oy)];}

/* ---------- drawing: cream and brass line engraving on a dark panel ---------- */
const INK='#eadfc6',BRASS='#c4a15a',DIM='rgba(234,223,198,.2)',BG='#16100b',CUT='#21180f';
function path(c,pts){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));}
function draw(c,model,L,s){
 const {W,H,S}=L,t=s.t,hw=model.hw,D=model.depth,N=80;
 c.fillStyle=BG;c.fillRect(0,0,W,H);
 // land: lines across the record at even steps back, so the perspective reads
 c.lineWidth=.6;c.strokeStyle='rgba(234,223,198,.1)';
 for(let i=1;i<12;i++){const [,y]=project(L,0,L.L*i/12,0);c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke();}
 // One frame of reference: the stylus. The tip and its V stay put on screen and the record moves under
 // it, by the true samples. Each groove is drawn as one exposure of the time since the last frame: the
 // range it swept (soft) round its average position (the edges), so a fast pass reads as a steady blur
 // rather than a new random snapshot every frame; held or slow, the range shrinks to the exact groove.
 const t0=s.prev??t,us=[];for(let i=0;i<=N;i++)us.push(L.L*(i/N)**1.2);
 const secOff=[];
 for(let k=4;k>=-2;k--){
  { // off the panel whatever it does? then skip it before any sampling
   const m=model.amp*2+hw,a=project(L,-k*model.pitch-m,0,0)[0],bend=L.L*L.L/(2*model.radius(t)),b=project(L,-k*model.pitch+m-bend,L.L,0)[0],b2=project(L,-k*model.pitch-m-bend,L.L,0)[0],a2=project(L,-k*model.pitch+m,0,0)[0];if(Math.max(a,b,a2,b2)<-4||Math.min(a,b,a2,b2)>W+4){if(k>=-2&&k<=2)secOff[k+2]=null;continue;}}
  const run=[];for(const u of us){const e=model.exposure(k,u,t0,t);if(e)run.push([u,e]);}
  if(k>=-2&&k<=2){const e0=model.exposure(k,0,t0,t);secOff[k+2]=e0?e0.mean:null;}
  if(run.length<2)continue;
  const P=(f,y)=>run.map(([u,e])=>project(L,f(e),u,y));
  const left=P(e=>e.mean-hw,0),right=P(e=>e.mean+hw,0),floor=P(e=>e.mean,-D),oL=P(e=>e.lo-hw,0),oR=P(e=>e.hi+hw,0);
  if(Math.max(...oR.map(p=>p[0]))<-4||Math.min(...oL.map(p=>p[0]))>W+4)continue;
  path(c,oL.concat(oR.slice().reverse()));c.closePath();c.fillStyle=CUT;c.fill();c.fillStyle=k?'rgba(234,223,198,.035)':'rgba(234,223,198,.07)';c.fill(); // the range swept, a faint haze
  c.save();path(c,left.concat(right.slice().reverse()));c.closePath();c.fillStyle=CUT;c.fill();c.clip();
  c.strokeStyle=k?'rgba(234,223,198,.12)':'rgba(234,223,198,.26)';c.lineWidth=.6;
  for(let i=0;i<floor.length;i+=2){c.beginPath();c.moveTo(floor[i][0],floor[i][1]);c.lineTo(right[i][0],right[i][1]);c.stroke();}
  c.strokeStyle='rgba(196,161,90,.55)';c.lineWidth=.8;path(c,floor);c.stroke();c.restore();
  c.strokeStyle=INK;c.globalAlpha=k?.35:.85;c.lineWidth=k?.8:1;path(c,left);c.stroke();path(c,right);c.stroke();c.globalAlpha=1;
 }
 // the record cut away through the stylus: V section, hatched (this turn's V is the tip's own, so it never moves)
 const prof=[];
 if(s.png){const px=model.pixelMm,ph=((model.radius(t)+model.stylus(t))/px)%1;for(let j=Math.floor(-L.cx/S/px)-1;j<=Math.ceil((W-L.cx)/S/px)+1;j++){const w=(j-ph)*px;prof.push([w,model.profile(w,t,secOff)]);}}
 else{const step=1/S;for(let w=-L.cx/S-step;w<=(W-L.cx)/S+step;w+=step)prof.push([w,model.profile(w,t,secOff)]);
  for(const cc of secOff)if(cc!=null)prof.push([cc,-D],[cc-hw,0],[cc+hw,0]);prof.sort((a,b)=>a[0]-b[0]);}
 const top=prof.map(([w,y])=>project(L,w,0,y));
 c.save();path(c,top.concat([[W+2,L.base],[-2,L.base]]));c.closePath();c.fillStyle='#120d09';c.fill();c.clip();
 c.strokeStyle=DIM;c.lineWidth=.7;for(let x=-H;x<W+H;x+=5){c.beginPath();c.moveTo(x,L.base);c.lineTo(x+H,L.base-H);c.stroke();}
 c.restore();
 c.strokeStyle=INK;c.lineWidth=1.2;path(c,top);c.stroke();
 c.strokeStyle='rgba(196,161,90,.6)';c.lineWidth=.8;c.beginPath();c.moveTo(0,L.base+.5);c.lineTo(W,L.base+.5);c.stroke();
 const tip=model.tip,wS=0;
 // stylus: a solid, lit diamond cone on its round tip, brass shank, light cantilever; the strongest contrast in the panel
 const yc=s.down?tip.centreY:tip.rho+Math.max(.12,.35*D),rho=tip.rho,half=24*Math.PI/180;
 const [tx,ty]=project(L,wS,0,yc),r=Math.max(2.2,rho*S),ys=yc+rho*Math.sin(half),yTop=yc+Math.max(1.25*D,1.2*hw);
 const wt=rho*Math.cos(half)+Math.tan(half)*(yTop-ys);
 const [lx0,ly0]=project(L,wS-rho*Math.cos(half),0,ys),[rx0]=project(L,wS+rho*Math.cos(half),0,ys);
 const [lx1,ly1]=project(L,wS-wt,0,yTop),[rx1]=project(L,wS+wt,0,yTop);
 const shH=Math.max(5,Math.min(9,ly1*.3)),sx0=lx1+(rx1-lx1)*.18,sx1=rx1-(rx1-lx1)*.18,sy1=ly1-shH,cw=2,mx=(sx0+sx1)/2;
 c.beginPath();c.moveTo(mx-cw,sy1+2);c.lineTo(mx-cw-sy1*.55-6,-2);c.lineTo(mx+cw-sy1*.55+2,-2);c.lineTo(mx+cw,sy1+2);c.closePath();
 c.fillStyle='#bfb397';c.fill();c.strokeStyle='#0d0906';c.lineWidth=1;c.stroke();
 c.beginPath();c.moveTo(lx1,ly1);c.lineTo(lx0,ly0);c.arc(tx,ty,rho*S,Math.PI-half,half,true);c.lineTo(rx0,ly0);c.lineTo(rx1,ly1);c.closePath();
 const lit=c.createLinearGradient(lx1,0,rx1,0);lit.addColorStop(0,'#8c7d60');lit.addColorStop(.45,'#f3e9cf');lit.addColorStop(1,'#b3a27f');
 c.fillStyle=lit;c.fill();c.save();c.clip();
 c.strokeStyle='rgba(40,28,16,.28)';c.lineWidth=.6;for(let i=1;i<5;i++){const f=i/5;c.beginPath();c.moveTo(tx+(f-.5)*r*1.2,ty);c.lineTo(lx1+(rx1-lx1)*f,ly1);c.stroke();}
 c.restore();c.strokeStyle='#0d0906';c.lineWidth=1.2;c.stroke();
 c.fillStyle=BRASS;c.fillRect(sx0,sy1,sx1-sx0,shH);c.save();c.beginPath();c.rect(sx0,sy1,sx1-sx0,shH);c.clip();
 c.strokeStyle='rgba(60,40,15,.5)';c.lineWidth=.7;for(let x=sx0-shH;x<sx1;x+=2.6){c.beginPath();c.moveTo(x,ly1);c.lineTo(x+shH,sy1);c.stroke();}c.restore();
 c.strokeStyle='#0d0906';c.lineWidth=1;c.strokeRect(sx0,sy1,sx1-sx0,shH);
 // the tip itself and where it touches: solid, ringed dark, with a soft glow while it plays
 if(s.down){const [gx,gy]=project(L,0,0,tip.contactY),gl=c.createRadialGradient(gx,gy,0,gx,gy,12);gl.addColorStop(0,'rgba(255,236,190,.5)');gl.addColorStop(1,'rgba(255,236,190,0)');c.fillStyle=gl;c.fillRect(gx-12,gy-12,24,24);}
 c.beginPath();c.arc(tx,ty,r,0,TAU);c.fillStyle='#fff6e0';c.fill();c.strokeStyle='#0d0906';c.lineWidth=1;c.stroke();
 if(s.down)for(const sgn of[-1,1]){const [gx,gy]=project(L,sgn*tip.contactDelta,0,tip.contactY);c.beginPath();c.arc(gx,gy,2,0,TAU);c.fillStyle='#e4d09a';c.fill();c.strokeStyle='#0d0906';c.lineWidth=.8;c.stroke();}
 // on the base line, like a gauge: how far the record moved sideways under the tip since the last frame
 if(s.down&&s.swept){const ws=model.stylus(t),[a]=project(L,ws-s.swept[1],0,0),[b]=project(L,ws-s.swept[0],0,0);if(b-a>1.5){c.fillStyle='rgba(228,208,154,.9)';c.fillRect(a,L.base-1.5,b-a,2.5);}}
 // scale and source, engraved small
 c.font='500 8.5px Jost, Futura, sans-serif';c.textBaseline='alphabetic';
 const bl=L.bar*S,by=H-5;c.fillStyle=INK;c.fillRect(8,by-3,bl,1.2);c.fillRect(8,by-5,1,4);c.fillRect(8+bl-1,by-5,1,4);
 const lab=t=>t.toUpperCase().split('').join('\u200a');
 c.fillText(lab(`${L.bar} mm`),12+bl,by);
 const tag=W<200?(s.png?'PNG pixels':'Vector'):(s.png?`PNG pixels · ${model.pixelMm.toFixed(3)} mm`:'Vector groove');c.textAlign='right';c.fillStyle='rgba(234,223,198,.7)';c.fillText(lab(tag),W-8,by);
 if(!s.down){c.textAlign='left';c.fillText(lab('Lifted'),8,14);}
 c.textAlign='left';
}

const core={shelfCoefficients,displacement,makeModel,layout,project,draw};
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
function modelNow(v){
 const b=v.buffer,m=v.record.metadata;if(modelFor===b&&model)return model;
 let x=cache.get(b);if(!x){x=displacement(b.getChannelData(0),b.sampleRate,m);cache.set(b,x);}
 model=makeModel(m,x);modelFor=b;lastT=null;return model;
}
function fit(){const w=canvas.clientWidth,h=canvas.clientHeight,d=Math.min(2,window.devicePixelRatio||1);
 if(w!==size[0]||h!==size[1]||canvas.width!==Math.round(w*d)){size=[w,h];canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);last=null;}return d;}
function render(){
 const v=V(),mdl=modelNow(v),d=fit(),[w,h]=size;if(!w||!h)return;
 const t=v.time(),down=!!v.down,grab=!!v.state?.grabbed,png=v.source==='png',key=[t,down,grab,png,w,h,d].join('|');
 if(key===last)return;last=key;
 const lastPrev=lastT,swept=lastT!==null&&Math.abs(t-lastT)<.25?mdl.swept(lastT,t):null;lastT=t;
 c2d.setTransform(d,0,0,d,0,0);draw(c2d,mdl,layout(mdl,w,h),{t,prev:swept?t+Math.max(-.06,Math.min(.06,lastPrev-t)):t,down,png,swept});
 const words=`Needle view, true scale: ${down?(grab?'stylus held in the groove':'stylus in the groove, playing'):'stylus lifted'}; ${png?'PNG pixel trace':'vector groove'}.`;
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
