// Needle view (static/needle-pip.js): the groove maths, the drawing, and that it costs nothing while hidden. Node 18+.
const assert=require('node:assert/strict');
const C=require('./static/vinyl-core.js'),P=require('./static/needle-pip.js');
const fs=16000,TAU=Math.PI*2;
function program(m,seconds){const n=Math.round(seconds*fs),x=new Float64Array(n);
 for(let i=0;i<n;i++){const t=i/fs;x[i]=.55*Math.sin(TAU*220*t)+.25*Math.sin(TAU*1900*t+1)+.08*Math.sin(TAU*5100*t);}return x;}
for(const seconds of [11.6,200]){
 const m=C.parameters(seconds),x=program(m,seconds);
 // what the player plays: the vector master with the presence shelf taken off, as 16-bit PCM
 const audio=C.pcmToFloat(C.playbackPcm(C.presence(x,fs,m,true)));
 const d=P.displacement(audio,fs,m);
 let err=0;for(let i=0;i<x.length;i++)err=Math.max(err,Math.abs(d[i]-x[i]));
 assert.ok(err<2e-3,`vector source gives the groove master back (max error ${err})`);
 // decoded WAVs arrive at the audio context's rate
 const up=new Float32Array(audio.length*3);for(let i=0;i<up.length;i++){const p=i/3,j=Math.floor(p),f=p-j;up[i]=j+1<audio.length?audio[j]*(1-f)+audio[j+1]*f:audio[audio.length-1];}
 const d48=P.displacement(up,48000,m);assert.equal(d48.length,d.length);
 let e48=0;for(let i=0;i<d.length;i++)e48=Math.max(e48,Math.abs(d48[i]-d[i]));assert.ok(e48<1e-6,'48 kHz decode reads the same');
 const g=P.makeModel(m,d);
 for(const t of [0,.5,1.234,seconds/2,seconds-.01]){
  assert.ok(Math.abs(g.stylus(t)-g.centre(0,0,t))<1e-12,'the stylus sits on the centre of the groove under it');
  assert.ok(Math.abs(g.stylus(t)-m.amp_mm*d[Math.round(t*fs)])<m.amp_mm*.2,'at the read head\'s own sample');
  const inner=g.centre(1,0,t);if(inner!==null)assert.ok(Math.abs(inner-(-m.pitch_mm+m.amp_mm*g.xs(t+60/m.rpm_cut)))<1e-9,'the next turn in is one revolution later, one pitch in');
 }
 assert.equal(g.stylus(seconds+1),0,'past the end there is no sound: the groove runs straight');
 // the picture fits the panel at both sizes, true scale (same S both ways)
 for(const [W,H] of [[242,150],[170,106]]){const L=P.layout(g,W,H);
  assert.ok(L.sy0+g.depth*L.S<=L.base&&L.base<H&&L.sy0>L.hzn,'section fits');
  assert.ok(L.bar*L.S>=10&&L.bar*L.S<=W*.32,'scale bar is a sensible length');}
}

// ---------- the groove as the record holds it: a real map cut by vinyl-core's own rasterizer ----------
{
 const seconds=11.6,m={...C.parameters(seconds),image_size:1024},raw=program(m,seconds);
 const pcm=C.quantizeVector(raw),x=Float32Array.from(pcm,v=>v/32768); // the groove master, as the WAV holds it
 const map={samples:C.rasterize(x,fs,m),size:m.image_size},n=map.size,R=m.disc_radius_mm,sc=2*R/(n-1),lsb=m.height_scale_mm/65535;
 const g=P.makeModel(m,x),V=P.vectorSurface(g),G=P.pngSurface(g,map),hw=g.hw,D=g.depth;
 const stored=(col,row)=>{const v=map.samples[row*n+col];return m.thickness_mm-(65535-v)/65535*m.height_scale_mm;}; // inverted polarity
 // PNG: every depth is one stored pixel, the whole pixel square
 let rnd=7;const rand=()=>((rnd=(rnd*1103515245+12345)%2147483648)/2147483648);
 for(let i=0;i<4000;i++){const r=40+rand()*45,th=rand()*TAU,col=Math.round((r*Math.cos(th)+R)/sc),row=Math.round((r*Math.sin(th)+R)/sc);
  const X=-R+col*sc,Y=-R+row*sc,want=stored(col,row);
  assert.equal(G.depthAt(X,Y),want,'PNG depth is the stored pixel');
  assert.equal(G.depthAt(X+(rand()-.5)*.98*sc,Y+(rand()-.5)*.98*sc),want,'anywhere inside that pixel');
  // vector: the Cutter's definition, point by point: its 2x2 sub-sample average is the pixel the Cutter stored
  let acc=0;for(const ox of[-.25,.25])for(const oy of[-.25,.25])acc+=V.depthAt(X+ox*sc,Y+oy*sc)/4;
  assert.ok(Math.abs((m.thickness_mm-acc)-(m.thickness_mm-want))<=lsb*.5+1e-12,`vector master reproduces the map to half an LSB (${(acc-want)/lsb} LSB)`);}
 // PNG stylus: the pixels' own centroid, within half a pixel of the master it was cut from
 // (a wiggle near the pixel pitch is blurred by the pixels themselves: that is what the PNG source plays, so it is shown)
 let ss=0,k=0;for(let t=.3;t<seconds-.3;t+=.0731){ss+=(G.lateral(t)-V.lateral(t))**2;k++;}
 assert.ok(Math.sqrt(ss/k)<g.amp*.25,'PNG centroid follows the cut groove');
 {const slow=Float32Array.from(C.quantizeVector(raw.map((_,i)=>.7*Math.sin(TAU*90*i/fs))),v=>v/32768),gs=P.makeModel(m,slow);
  const Gs=P.pngSurface(gs,{samples:C.rasterize(slow,fs,m),size:n}),Vs=P.vectorSurface(gs);let worst=0;
  for(let t=.3;t<seconds-.3;t+=.0731)worst=Math.max(worst,Math.abs(Gs.lateral(t)-Vs.lateral(t)));
  assert.ok(worst<sc*.25,`a wiggle well above the pixel pitch: within a quarter pixel (worst ${worst.toFixed(4)} mm)`);}
 const frame=(surf,t)=>{const th=TAU*g.turnsAt(t);return {t,turns:g.turnsAt(t),c:Math.cos(th),s:Math.sin(th),rs:g.radius(t)+surf.lateral(t)};};
 const L=P.layout(g,248,156),ctx=recorder();
 for(const t of [1.7,5.25,9.9]){
  // held: the section drawn is exactly the surface under the tip, sample by sample
  const rv=P.draw(ctx,g,V,L,{t,down:true}),rg=P.draw(ctx,g,G,L,{t,down:true});
  for(const [surf,res] of [[V,rv],[G,rg]]){const f=frame(surf,t);
   for(const [w,y] of res.section){const r=f.rs+w,want=-surf.depthAt(r*f.c,r*f.s);
    if(surf===G)assert.equal(y,want,'PNG section = the stored pixels, bit for bit');else assert.ok(Math.abs(y-want)<1e-9,'vector section = the Cutter equation');}
   // and the field rows upstream (straight lines in the record plane, so the groove's own curvature shows)
   const fi={...f,t,turns:g.turnsAt(t)},row=Float64Array.from({length:41},(_,j)=>-.6+j*.03);
   for(const u of [.4,2.5,7]){const out=new Float64Array(row.length);surf.addRow(fi,u,row,0,row.length,out,0,1);
    row.forEach((w,j)=>{const r=f.rs+w,want=surf.depthAt(r*f.c-u*f.s,r*f.s+u*f.c);
     if(surf===G)assert.equal(out[j],want,'PNG field = the stored pixels');else assert.ok(Math.abs(out[j]-want)<1e-9,'vector field = the Cutter equation');});}
   // the stylus rests on it, the whole diamond (round tip, then the cone tangent to it): no sample inside it,
   // at least one touching it, and the contacts drawn are real samples on its outline. Checked against the cone
   // through its own apex (rho/sin(half) below the tip centre), not the view's own underside().
   const {rho,half,height}=g.tip,inside=(w,y)=>{const dz=y-res.yc,a=Math.abs(w);if(dz>height)return -1;
    const ball=rho-Math.hypot(w,dz),cone=dz>=-rho*Math.sin(half)?((dz+rho/Math.sin(half))*Math.tan(half)-a)*Math.cos(half):-1;return Math.max(ball,cone);};
   let close=-Infinity;for(const [w,y] of res.section){const d=inside(w,y);close=Math.max(close,d);assert.ok(d<=1e-9,'the stylus never goes into the wall');}
   assert.ok(close>=-1e-6,'and touches it');assert.ok(res.rest.contacts.length>=1);
   for(const [w,y] of res.rest.contacts)assert.ok(res.section.some(([a,b])=>a===w&&b===y)&&Math.abs(inside(w,y))<1e-5,'contact points sit on the section, on the stylus');}
  // vector, held: the V under the tip is the Cutter's V, centred on the tip, both walls touched
  for(const [w,y] of rv.section)if(Math.abs(w)<hw*.98)assert.ok(Math.abs(y+D*(1-Math.abs(w)/hw))<1e-9,'the master V, exactly');
  assert.equal(rv.rest.contacts.length,2,'a centred V: both walls');
  // PNG, held: the pixel grid shows: the section is flat steps, no more distinct depths than pixels crossed
  const near=rg.section.filter(([w])=>Math.abs(w)<hw);assert.ok(new Set(near.map(p=>p[1])).size<=Math.ceil(2*hw/sc)*2+2,'PNG section is pixel steps');
  // one frame of play: the average of the real surface over the frame's instants; scratched back, the same picture
  const t0=t-1/60,a=P.draw(ctx,g,G,L,{t,prev:t0,down:true}),b=P.draw(ctx,g,G,L,{t:t0,prev:t,down:true});
  assert.equal(a.instants,8);
  const ins=[];for(let i=0;i<8;i++){const ti=t0+(t-t0)*i/7;ins.push(frame(G,ti));}
  a.section.forEach(([w,y],i)=>{let sum=0;for(const f of ins){const r=f.rs+w;sum+=G.depthAt(r*f.c,r*f.s);}assert.ok(Math.abs(y+sum/8)<1e-12,'exposure = mean of the true surface');});
  assert.deepEqual(a.section.map(p=>p[1]),P.draw(ctx,g,G,L,{t,prev:t0,down:true}).section.map(p=>p[1]),'same frame, same picture');
  const back=P.instants(g,G,t,t0,8).map(f=>f.t),fwd=P.instants(g,G,t0,t,8).map(f=>f.t);assert.deepEqual(back,fwd,'played back or scratched back over the same span: the same instants');
 }
 assert.ok(ctx.calls>500&&ctx.bad===0,'draws without NaN');
 // the field image: every pixel painted, once per frame, onto the panel
 {let put=0,drawn=0,img=null;const sx={createImageData:(w,h)=>(img={data:new Uint8ClampedArray(w*h*4),width:w,height:h}),putImageData:()=>{put++;}};
  const scratch={width:0,height:0,getContext:()=>sx},c=recorder();c.drawImage=(...a)=>{drawn++;assert.equal(a[0],scratch);};
  P.draw(c,g,G,L,{t:3,prev:3-1/60,down:true,scratch});P.draw(c,g,V,L,{t:3,down:true,scratch});
  assert.equal(put,2);assert.equal(drawn,2);assert.equal(scratch.width,L.W);
  const a=new Uint32Array(img.data.buffer);assert.ok(a.every(v=>v>>>24===255),'no pixel left unpainted');
  // occlusion: a ridge near the tip hides a deep pit right behind it; with the near row low, what lies behind shows
  const NR=2,NC=3,us=Float32Array.of(0,.5,1),sh=new Float32Array(9).fill(1),px=new Uint32Array(3*60),Lr={...L,S:20,sy0:30,Dp:1e9,oy:1};
  P.rasterField(px,3,60,Float32Array.of(0,0,0, 2,2,2, 0,0,0),sh,us,NR,NC,1e3,Lr);
  const col=y=>px[y*3];assert.equal(col(29),col(25),'one surface down the column');
  const top=[...Array(60).keys()].find(y=>col(y)===col(29));assert.equal(top,10,'the far land shows above the pit, at its own height');}
 // the flea's eye: a true pinhole whose picture plane is the cut, the field 6 mm upstream, rows even on screen,
 // and every row the record's own surface there (the 8 samples of its footprint, read from the record plane)
 {const E=L.eye;assert.equal(L.L,6);assert.ok(E.h>0&&E.d>0&&E.w>0);
  for(const [w,u,y] of [[0,0,0],[.3,0,-.2],[-.8,1.5,-.45],[.2,5.5,0]]){const [x,yy]=P.project(L,w,u,y),k=E.d/(E.d+u);
   assert.ok(Math.abs(x-(L.cx+L.S*(E.w+(w-E.w)*k)))<1e-9&&Math.abs(yy-(L.sy0-L.S*(E.h+(y-E.h)*k)))<1e-9,'project() is the pinhole');}
  const [x0,y0]=P.project(L,.37,0,-.21);assert.ok(Math.abs(x0-(L.cx+.37*L.S))<1e-9&&Math.abs(y0-(L.sy0+.21*L.S))<1e-9,'the cut face: true scale, both ways');
  for(const surf of [V,G]){const t=6.2,r=P.draw(ctx,g,surf,L,{t,down:true}),{grid,ws,us,NR,NC,dx}=r.field,f=frame(surf,t);
   assert.equal(us[0],0);assert.ok(Math.abs(us[NR]-6)<1e-5,'the field reaches 6 mm upstream');
   const ly=us.map(u=>P.project(L,0,u,0)[1]),st=ly.slice(1).map((y,i)=>ly[i]-y);assert.ok(Math.max(...st)-Math.min(...st)<1e-3,'rows evenly spaced on screen');
   for(const i of [0,Math.round(NR/4),Math.round(NR*.6),NR]){const u=us[i],gg=1/(1+u/L.Dp),cw=dx/(L.S*gg),du=(us[Math.min(NR,i+1)]-us[Math.max(0,i-1)])/2;
    for(let j=0;j<NC;j+=7){let a=0;for(let k=0;k<8;k++){const uk=Math.max(0,u+du*((k+.5)/8-.5)),ow=i?cw*((k*.6180339887+.5/8)%1-.5):0,rr=f.rs+ws[i*NC+j]+ow;a+=surf.depthAt(rr*f.c-uk*f.s,rr*f.s+uk*f.c)/8;}
     assert.ok(Math.abs(grid[i*NC+j]-a)<1e-6,`field row at ${u.toFixed(2)} mm = the record there`);}}}}
 // what is shown is said
 assert.equal(P.labelFor(V,false),'Vector master');assert.equal(P.labelFor(G,false),`PNG pixels · ${sc.toFixed(3)} mm`);
 assert.match(P.labelFor(P.vectorSurface(g,'vector-rebuilt'),false),/rebuilt from playback/);assert.match(P.labelFor(P.vectorSurface(g,'png-trace'),false),/no 16-bit map/);
 // lifted: off the record, whatever the surface
 const up=P.draw(ctx,g,G,L,{t:2,down:false});assert.ok(up.yc>g.tip.rho,'lifted clear of the land');
}
function recorder(){const c={calls:0,bad:0};return new Proxy(c,{get(o,k){if(k in o)return o[k];return (...a)=>{o.calls++;if(a.some(v=>typeof v==='number'&&!Number.isFinite(v)))o.bad++;return {addColorStop(){}};};},set(o,k,v){o[k]=v;return true;}});}

// ---------- the panel in a page: hidden costs nothing, the switch is kept ----------
function page({stored=null,width=1400,record={},worker=null}={}){
 const els={},store={},frames=[];let reads=0;
 if(stored)store['vinyl-needle-view']=stored;
 const el=(tag)=>{const e={tagName:tag,hidden:false,attrs:{},style:{},classList:{s:new Set(),add(c){this.s.add(c);},remove(c){this.s.delete(c);},contains(c){return this.s.has(c);}},
  listeners:{},clientWidth:242,clientHeight:150,width:0,height:0,
  setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];},
  addEventListener(t,f){(this.listeners[t]??=[]).push(f);},appendChild(ch){this.child=ch;},click(){for(const f of this.listeners.click||[])f();},
  querySelector(s){return (this.q??={})[s]??=el(s);},getContext(){return recorder();},set innerHTML(v){}};return e;};
 els.needleView=el('button');
 const winL={};
 const doc={hidden:false,getElementById:id=>els[id]||null,querySelector:()=>null,body:el('body'),createElement:el,addEventListener(t,f){(winL['doc-'+t]??=[]).push(f);}};
 const buffer={sampleRate:fs,getChannelData(){reads++;return new Float32Array(fs*2);}};
 const m=C.parameters(2);
 const workers=[],fetched=[];
 const vinyl={record:{metadata:m,label:'Original tune',tags:null,...record},buffer,down:false,state:{grabbed:false},inspecting:false,source:'vector',time:()=>.5};
 const win={document:doc,innerWidth:width,innerHeight:900,devicePixelRatio:1,vinyl,localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v;}},
  addEventListener(t,f){(winL[t]??=[]).push(f);},requestAnimationFrame(f){frames.push(f);return frames.length;},cancelAnimationFrame(){},matchMedia:()=>({matches:false}),setTimeout:(f)=>{frames.push(f);return 99;},clearTimeout(){}};
 const src=require('node:fs').readFileSync(__dirname+'/static/needle-pip.js','utf8');
 class Worker{constructor(url){this.url=url;workers.push(this);}postMessage(msg){this.msg=msg;Promise.resolve().then(()=>this.onmessage({data:(worker||(()=>({ok:false})))(msg)}));}terminate(){this.done=true;}}
 const fetch=async u=>{fetched.push(u);return {ok:false};};
 new Function('window','document','localStorage','innerWidth','innerHeight','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','module','Worker','fetch','location',src)
  (win,doc,win.localStorage,win.innerWidth,win.innerHeight,win.requestAnimationFrame,win.cancelAnimationFrame,win.setTimeout,win.clearTimeout,undefined,Worker,fetch,{href:'http://x/player.html'});
 const run=()=>{let n=0;while(frames.length&&n<50){frames.shift()();n++;}return n;};
 return {win,els,store,frames,run,reads:()=>reads,vinyl,panel:doc.body.child,workers,fetched,canvas:doc.body.child.q?.canvas};
}
{const p=page({width:1400});assert.equal(p.els.needleView.attrs['aria-pressed'],'true','on by default on a desktop-sized window');
 p.run();assert.equal(p.reads(),1,'shown: the groove is prepared once');assert.equal(p.panel.hidden,false);
 p.els.needleView.click();assert.equal(p.store['vinyl-needle-view'],'off','an explicit choice is kept');assert.equal(p.panel.hidden,true);
 p.vinyl.down=true;p.win.vinylNeedle.wake();assert.equal(p.run(),0,'hidden: no frames at all');
 p.els.needleView.click();assert.equal(p.store['vinyl-needle-view'],'on');p.vinyl.down=false;p.run();assert.equal(p.panel.hidden,false);
 p.vinyl.inspecting=true;p.win.vinylNeedle.wake();assert.equal(p.panel.hidden,true,'not shown while the record is picked up');}
{const p=page({width:400});assert.equal(p.els.needleView.attrs['aria-pressed'],'false','phones start without it');p.win.vinylNeedle.wake();p.run();assert.equal(p.reads(),0,'never shown, never prepared');}
{const p=page({width:400,stored:'on'});assert.equal(p.els.needleView.attrs['aria-pressed'],'true','a kept choice wins over the default');}
{const p=page();p.run();p.vinyl.down=true;let t=.5;p.vinyl.time=()=>t;p.win.vinylNeedle.wake();
 for(let i=0;i<5;i++){t+=1/60;const f=p.frames.shift();assert.ok(f,'playing: one frame each display frame');f();}
 p.vinyl.down=false;t=.4;const f=p.frames.shift();f();assert.equal(p.frames.length,0,'lifted: the loop stops after the last picture');}
// the record's own geometry: read only once shown, checked in the worker, and the view says what it shows
(async()=>{
 const flush=()=>new Promise(r=>setImmediate(r)),aria=p=>p.panel.querySelector('canvas').attrs['aria-label'];
 {const p=page({width:400,record:{grooveFile:{arrayBuffer:async()=>new ArrayBuffer(8)}}});p.win.vinylNeedle.wake();p.run();await flush();
  assert.equal(p.workers.length,0,'hidden: nothing read or decoded');}
 {const x=new Float32Array(fs*2).fill(.25);
  const p=page({record:{grooveFile:{arrayBuffer:async()=>new ArrayBuffer(8)}},worker:msg=>msg.kind==='vector'?{ok:true,x}:{ok:false}});
  p.run();assert.match(aria(p),/rebuilt from playback, loading/,'until it has loaded: the rebuild, said so');
  await flush();await flush();p.run();
  assert.equal(p.workers.length,1);assert.equal(p.workers[0].url,'http://x/static/needle-pip-worker.js');assert.equal(p.workers[0].msg.kind,'vector');assert.ok(p.workers[0].done);
  assert.match(aria(p),/Vector master\./,'then the master itself');
  p.vinyl.source='png';p.win.vinylNeedle.wake();p.run();await flush();await flush();p.run();
  assert.match(aria(p),/PNG trace · no 16-bit map\./,'a PNG source with no readable map says so');
  p.vinyl.source='vector';p.win.vinylNeedle.wake();p.run();assert.equal(p.workers.length,1,'read once per record; no map file, no decode');assert.match(aria(p),/Vector master/);}
 {const p=page({record:{base:'output/abc/'}});p.run();await flush();await flush();p.run();
  assert.deepEqual(p.fetched,['output/abc/heightmap.groove.wav'],'a served record: its own file is fetched');assert.equal(p.workers.length,0,'missing: no decode');
  assert.match(aria(p),/rebuilt from playback\./);}
 {const p=page({record:{base:''}});p.run();await flush();assert.equal(p.fetched.length,0,'an imported record without the file: nothing fetched');}
 {const p=page({record:{base:'demo/'}});p.run();await flush();p.run();assert.equal(p.fetched.length,0,'the bundled demo has no map or master to fetch');assert.match(aria(p),/rebuilt from playback\./);}
 // the worker itself: the master is accepted only when it matches its metadata; the map comes back as raw pixels
 {const vm=require('node:vm');let got;const self={postMessage(v){got=v;}};
  const cx={self,VinylCore:C,importScripts(){},Float32Array,Uint8Array,Uint16Array,String,Error};vm.createContext(cx);
  vm.runInContext(require('node:fs').readFileSync(__dirname+'/static/needle-pip-worker.js','utf8'),cx);
  const m=C.parameters(1.5,2048),x=program(m,1.5),v=await C.writeVector(x,m),wav=v.wav.buffer.slice(v.wav.byteOffset,v.wav.byteOffset+v.wav.byteLength);
  await self.onmessage({data:{kind:'vector',bytes:wav,metadata:m}});assert.ok(got.ok&&got.x.length===v.pcm.length&&got.x.every((a,i)=>a===v.pcm[i]/32768),'the master, sample for sample');
  const bad=new Uint8Array(wav.slice(0));bad[bad.length-1]^=1;await self.onmessage({data:{kind:'vector',bytes:bad.buffer,metadata:m}});assert.equal(got.ok,false,'a master that fails its checksum is refused');
  const samples=new Uint16Array(2048*2048).map((_,i)=>i*7&65535),png=await C.encodePng({width:2048,height:2048,colorType:0,bitDepth:16,samples});
  await self.onmessage({data:{kind:'png',bytes:png,metadata:m}});assert.ok(got.ok&&got.size===2048&&got.samples.every((a,i)=>a===samples[i]),'the map, pixel for pixel');
  await self.onmessage({data:{kind:'png',bytes:png,metadata:{...m,image_size:4096}}});assert.equal(got.ok,false,'a map that is not this record\'s size is refused');}
 console.log('needle view: ok');
})().catch(e=>{console.error(e);process.exit(1);});
