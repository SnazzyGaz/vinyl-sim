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
  // upstream groove arrives at the stylus u/speed later
  const u=1.5,ahead=g.centre(0,u,t),later=g.stylus(t+u/g.speed(t));if(ahead!==null)assert.ok(Math.abs(ahead+u*u/(2*g.radius(t))-later)<1e-9,'the groove ahead is the sound to come');
 }
 // one frame of reference: the tip. Its own groove at the contact never moves; the rest is measured from it
 for(const [t0,t1] of [[1.2,1.2],[1.2,1.2+1/60],[1.2+1/60,1.2]]){const e=g.exposure(0,0,t0,t1);assert.ok(Math.abs(e.lo)<1e-12&&Math.abs(e.hi)<1e-12,'the V under the tip is fixed');}
 for(const k of [0,1,-1])for(const u of [.3,1.1]){const snap=g.exposure(k,u,1.5,1.5),c=g.centre(k,u,1.5);if(c===null)continue;
  assert.ok(Math.abs(snap.mean-(c-g.stylus(1.5)))<1e-12&&snap.lo===snap.hi,'no exposure: the exact groove, relative to the tip');
  const e=g.exposure(k,u,1.5-1/60,1.5),r=g.exposure(k,u,1.5,1.5-1/60);
  assert.ok(e.lo<=e.mean&&e.mean<=e.hi&&e.hi-e.lo>0,'one frame of travel: a range round an average');
  assert.ok(Math.abs(e.lo-r.lo)<1e-9&&Math.abs(e.hi-r.hi)<1e-9,'played back or scratched back over the same span: the same picture');}
 // ideal contact: both contact points on the V walls, tip above the floor
 const tp=g.tip,wall=-g.depth+(g.depth/g.hw)*tp.contactDelta;
 assert.ok(Math.abs(wall-tp.contactY)<1e-12&&tp.centreY-tp.rho>-g.depth,'sphere rests on both walls');
 // scratching back sweeps the same groove
 assert.deepEqual(g.swept(1.2,1.25),g.swept(1.25,1.2));const [lo,hi]=g.swept(1.2,1.25);
 assert.ok(lo<=g.stylus(1.22)&&hi>=g.stylus(1.22)&&lo<hi,'swept range covers the frame');
 // past the end there is no sound: the groove runs straight
 assert.equal(g.stylus(seconds+1),0);
 // the picture fits the panel at both sizes, true scale (same S both ways)
 for(const [W,H] of [[242,150],[170,106]]){const L=P.layout(g,W,H);
  assert.ok(L.sy0+g.depth*L.S<=L.base&&L.base<H&&L.sy0>L.hzn,'section fits');
  assert.ok(L.bar*L.S>=10&&L.bar*L.S<=W*.32,'scale bar is a sensible length');
  const ctx=recorder();P.draw(ctx,g,L,{t:1,prev:1-1/60,down:true,png:false,swept:[lo,hi]});P.draw(ctx,g,L,{t:1,prev:1+1/60,down:true,png:true,swept:[lo,hi]});P.draw(ctx,g,L,{t:1,down:false,png:true});
  assert.ok(ctx.calls>200&&ctx.bad===0,'draws without NaN');}
}
function recorder(){const c={calls:0,bad:0};return new Proxy(c,{get(o,k){if(k in o)return o[k];return (...a)=>{o.calls++;if(a.some(v=>typeof v==='number'&&!Number.isFinite(v)))o.bad++;return {addColorStop(){}};};},set(o,k,v){o[k]=v;return true;}});}

// ---------- the panel in a page: hidden costs nothing, the switch is kept ----------
function page({stored=null,width=1400}={}){
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
 const vinyl={record:{metadata:m,label:'Original tune',tags:null},buffer,down:false,state:{grabbed:false},inspecting:false,source:'vector',time:()=>.5};
 const win={document:doc,innerWidth:width,innerHeight:900,devicePixelRatio:1,vinyl,localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v;}},
  addEventListener(t,f){(winL[t]??=[]).push(f);},requestAnimationFrame(f){frames.push(f);return frames.length;},cancelAnimationFrame(){},matchMedia:()=>({matches:false}),setTimeout:(f)=>{frames.push(f);return 99;},clearTimeout(){}};
 const src=require('node:fs').readFileSync(__dirname+'/static/needle-pip.js','utf8');
 new Function('window','document','localStorage','innerWidth','innerHeight','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout','module',src)
  (win,doc,win.localStorage,win.innerWidth,win.innerHeight,win.requestAnimationFrame,win.cancelAnimationFrame,win.setTimeout,win.clearTimeout,undefined);
 const run=()=>{let n=0;while(frames.length&&n<50){frames.shift()();n++;}return n;};
 return {win,els,store,frames,run,reads:()=>reads,vinyl,panel:doc.body.child};
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
console.log('needle view: ok');
