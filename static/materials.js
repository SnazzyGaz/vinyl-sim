/* Procedural surface library for the player scene. Every texture is painted
   once at start-up on a canvas (no downloads) and shared between meshes; shared
   textures are flagged userData.shared so per-mesh disposal never frees them.
   Millimetre scene units. Outside a browser (Node tests) every painter returns
   null and the materials fall back to flat PBR values. */
export function createLook(THREE, renderer){
 const aniso=Math.min(8,renderer?.capabilities?.getMaxAnisotropy?.()||1);
 const cache=new Map();
 const canPaint=(()=>{try{if(typeof document==='undefined'||typeof document.createElement!=='function')return false;
  const c=document.createElement('canvas');const g=c.getContext&&c.getContext('2d');return !!(g&&g.getImageData&&g.createImageData&&g.createLinearGradient);}catch{return false;}})();

 /* ---------- small deterministic noise kit (periodic so tiles are seamless) ---------- */
 function rng(seed){let s=seed>>>0||1;return ()=>{s^=s<<13;s>>>=0;s^=s>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
 function valueNoise(period,seed){
  const r=rng(seed),g=new Float32Array(period*period);for(let i=0;i<g.length;i++)g[i]=r();
  return (x,y)=>{const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
   const x0=((xi%period)+period)%period,y0=((yi%period)+period)%period,x1=(x0+1)%period,y1=(y0+1)%period;
   const a=g[y0*period+x0],b=g[y0*period+x1],c=g[y1*period+x0],d=g[y1*period+x1];
   return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;};
 }
 function fbm(noise,x,y,oct=4){let s=0,a=.5,f=1,n=0;for(let o=0;o<oct;o++){s+=a*noise(x*f,y*f);n+=a;a*=.5;f*=2;}return s/n;}
 function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return [c,c.getContext('2d')];}
 function texture(c,color,repeat=[1,1]){
  const t=new THREE.CanvasTexture(c);t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat[0],repeat[1]);t.anisotropy=aniso;t.userData.shared=true;return t;
 }
 function painted(key,paint){
  if(!canPaint)return null;if(cache.has(key))return cache.get(key);
  let out=null;try{out=paint();}catch(e){console.warn?.('texture '+key+' skipped',e);out=null;}
  cache.set(key,out);return out;
 }
 // Write a per-pixel field (fn(x,y)->[r,g,b] 0..255) into a canvas.
 function field(w,h,fn){
  const [c,g]=canvas(w,h),img=g.createImageData(w,h),d=img.data;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=fn(x,y),i=(y*w+x)*4;d[i]=v[0];d[i+1]=v[1];d[i+2]=v[2];d[i+3]=255;}
  g.putImageData(img,0,0);return c;
 }
 const mix=(a,b,t)=>a+(b-a)*t,clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

 /* ---------- wood: ribbon-figured mahogany for the lacquered cabinet ---------- */
 function woodMaps(kind){
  return painted('wood-'+kind,()=>{
   const N=512,n1=valueNoise(16,kind==='oak'?7:3),n2=valueNoise(64,kind==='oak'?11:5),n3=valueNoise(128,kind==='oak'?17:9);
   const pal=kind==='oak'?[[98,62,34],[150,104,62],[182,134,84]]:[[46,12,6],[92,28,14],[128,48,24]];
   const col=new Float32Array(N*N),pore=new Float32Array(N*N);
   for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const u=x/N,v=y/N,warp=fbm(n1,u*16,v*4,3)*1.6;
    const ribbon=.5+.5*Math.sin((v*(kind==='oak'?18:10)+warp)*Math.PI*2);          // figure across the grain
    const streak=fbm(n2,u*4,v*64,3);                                                     // long fibres along x
    const p=n3(u*128,v*128*.25);                                                          // pores
    col[y*N+x]=clamp(ribbon*(kind==='oak'?.4:.28)+streak*.75-.08);pore[y*N+x]=p;
   }
   const color=field(N,N,(x,y)=>{const t=col[y*N+x],p=pore[y*N+x],k=.86+.14*p;
    const a=t<.5?pal[0]:pal[1],b=t<.5?pal[1]:pal[2],s=t<.5?t*2:(t-.5)*2;
    return [mix(a[0],b[0],s)*k,mix(a[1],b[1],s)*k,mix(a[2],b[2],s)*k];});
   const bump=field(N,N,(x,y)=>{const v=110+col[y*N+x]*40+pore[y*N+x]*70;return [v,v,v];});
   return {color:texture(color,true),bump:texture(bump,false)};
  });
 }
 /* ---------- metal: soft smudges and polishing marks (roughness in G) ---------- */
 function metalRough(){
  return painted('metal-rough',()=>{
   const N=512,[c,g]=canvas(N,N),r=rng(42),n=valueNoise(32,23);
   const base=field(N,N,(x,y)=>{const v=150+fbm(n,x/N*8,y/N*8,4)*50;return [v,v,v];});
   g.drawImage(base,0,0);
   for(let i=0;i<46;i++){const x=r()*N,y=r()*N,rad=8+r()*46,grad=g.createRadialGradient(x,y,0,x,y,rad);
    const v=Math.round(170+r()*70);grad.addColorStop(0,`rgba(${v},${v},${v},.55)`);grad.addColorStop(1,`rgba(${v},${v},${v},0)`);g.fillStyle=grad;g.fillRect(x-rad,y-rad,rad*2,rad*2);}
   // No hairline scratches: sub-pixel glossy lines alias into sparkles under a hard key light.
   return texture(c,false);
  });
 }
 /* ---------- quiet surfaces ---------- */
 function noiseBump(key,scale=1){
  return painted('bump-'+key,()=>{const N=256,n=valueNoise(32,key.length*31+7),m=valueNoise(128,key.length*13+3);
   return texture(field(N,N,(x,y)=>{const v=128+(fbm(n,x/N*32,y/N*32,4)-.5)*120*scale+(m(x/N*128,y/N*128)-.5)*60*scale;return [v,v,v];}),false);});
 }
 function plaster(){
  return painted('plaster',()=>{const N=256,n=valueNoise(8,77),m=valueNoise(64,78); // half-size tile, same detail per mm
   return texture(field(N,N,(x,y)=>{const t=fbm(n,x/N*8,y/N*8,4),s=m(x/N*64,y/N*64);const k=.92+t*.12+s*.03;return [166*k,154*k,134*k];}),true);});
 }
 function paper(){
  return painted('paper',()=>{const N=256,n=valueNoise(64,91);
   return texture(field(N,N,(x,y)=>{const v=200+fbm(n,x/N*64,y/N*64,3)*55;return [v,v,v];}),false);});
 }
 /* ---------- oak floor: staggered boards, seams, grain ----------
    colour at 2048; bump (R) and roughness (G) packed into one 1024 map: bumpMap
    reads .r and roughnessMap reads .g, so one upload serves both. */
 function floorMaps(){
  return painted('floor',()=>{
   const N=2048,M=1024,MM=1200/N,[c,g]=canvas(N,N),[pc,pg]=canvas(M,M),r=rng(1234),k=M/N;
   pg.fillStyle='rgb(138,175,0)';pg.fillRect(0,0,M,M);
   const W=Math.round(70/MM),wrap=(x,L,fn)=>{fn(0);if(x<0)fn(N);if(x+L>N)fn(-N);};
   for(let row=0,y=0;y<N;row++,y+=W){
    let x=-Math.round(r()*900/MM);
    while(x<N){const L=Math.round((520+r()*900)/MM),h=.072+r()*.012,s=.38+r()*.12,l=.27+r()*.1;
     g.fillStyle=`hsl(${h*360},${s*100}%,${l*100}%)`;wrap(x,L,dx=>g.fillRect(x+dx,y,L,W));
     const strokes=[];for(let q=0;q<26;q++){const dark=r()<.65;strokes.push({yy:y+r()*W,amp:1+r()*4,ph:r()*6,dark,a:dark?.10+r()*.18:.05+r()*.08,w:.6+r()*1.6});}
     const knot=r()<.18?{kx:x+r()*L,ky:y+W*(.3+r()*.4)}:null;
     wrap(x,L,dx=>{g.save();g.beginPath();g.rect(x+dx,y,L,W);g.clip();
      for(const t of strokes){g.strokeStyle=t.dark?`rgba(40,22,10,${t.a})`:`rgba(230,190,140,${t.a})`;g.lineWidth=t.w;g.beginPath();
       for(let xx=x;xx<=x+L+24;xx+=24){const yv=t.yy+Math.sin(xx*.012+t.ph)*t.amp+Math.sin(xx*.05+t.ph*2)*t.amp*.3;xx===x?g.moveTo(xx+dx,yv):g.lineTo(xx+dx,yv);}g.stroke();}
      if(knot)for(let q=0;q<5;q++){g.strokeStyle=`rgba(45,25,12,${.25-q*.04})`;g.lineWidth=1.2;g.beginPath();g.ellipse(knot.kx+dx,knot.ky,6+q*5,3+q*2.2,0,0,Math.PI*2);g.stroke();}
      g.restore();});
     const rv=Math.round(150+r()*60);pg.fillStyle=`rgb(138,${rv},0)`;wrap(x,L,dx=>pg.fillRect((x+dx)*k,y*k,L*k,W*k));
     pg.fillStyle='rgb(34,215,0)';wrap(x,2,dx=>pg.fillRect((x+dx)*k,y*k,1.2,W*k));
     g.fillStyle='rgba(20,10,4,.85)';wrap(x,2,dx=>g.fillRect(x+dx,y,2,W));
     x+=L;}
    g.fillStyle='rgba(20,10,4,.9)';g.fillRect(0,y,N,2);pg.fillStyle='rgb(26,220,0)';pg.fillRect(0,y*k,M,1.3);
   }
   const packed=texture(pc,false);
   return {color:texture(c,true),bump:packed,rough:packed,mmPerTile:1200};
  });
 }
 /* ---------- rug: a quiet Deco runner in wool ---------- */
 function rugMap(){
  return painted('rug',()=>{
   const W=1024,H=512,[c,g]=canvas(W,H),n=valueNoise(128,5);
   g.fillStyle='#2c3a33';g.fillRect(0,0,W,H);
   const band=(m,col,w)=>{g.strokeStyle=col;g.lineWidth=w;g.strokeRect(m,m,W-2*m,H-2*m);};
   band(18,'#b9a77c',10);band(40,'#7b2f22',16);band(62,'#b9a77c',4);
   g.save();g.translate(W/2,H/2);
   for(let i=0;i<4;i++){g.rotate(Math.PI/2);g.fillStyle='#7b2f22';g.beginPath();g.moveTo(0,-30);g.lineTo(120,-120);g.lineTo(0,-170);g.lineTo(-120,-120);g.closePath();g.globalAlpha=.85;g.fill();g.globalAlpha=1;}
   g.strokeStyle='#c8b688';g.lineWidth=5;g.beginPath();g.arc(0,0,92,0,Math.PI*2);g.stroke();g.beginPath();g.arc(0,0,58,0,Math.PI*2);g.fillStyle='#b9a77c';g.fill();
   for(let i=0;i<16;i++){g.rotate(Math.PI/8);g.fillStyle='#2c3a33';g.fillRect(-3,-56,6,22);}
   g.restore();
   for(const sx of [-1,1])for(let k=0;k<3;k++){g.fillStyle='#b9a77c';g.beginPath();g.arc(W/2+sx*(260+k*70),H/2,14-k*3,0,Math.PI*2);g.fill();}
   const img=g.getImageData(0,0,W,H),d=img.data;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=.82+.3*n(x/W*128,y/H*64)+.08*Math.sin(x*1.7)*Math.sin(y*1.9),i=(y*W+x)*4;d[i]*=k;d[i+1]*=k;d[i+2]*=k;}
   g.putImageData(img,0,0);
   return texture(c,true);
  });
 }
 /* ---------- window view: soft, out-of-focus garden behind the glass ---------- */
 function gardenMap(){
  return painted('garden',()=>{
   const W=512,H=768,[c,g]=canvas(W,H),r=rng(808);
   const sky=g.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#e8eef3');sky.addColorStop(.78,'#f7f6f0');sky.addColorStop(1,'#d6d9c6');g.fillStyle=sky;g.fillRect(0,0,W,H);
   if('filter' in g)g.filter='blur(18px)';
   for(let i=0;i<16;i++){const x=r()*W,y=H*.78+r()*H*.4,rad=40+r()*120,gr=Math.round(90+r()*60);g.fillStyle=`rgba(${gr+30},${gr+50},${gr+10},${.18+r()*.22})`;g.beginPath();g.arc(x,y,rad,0,Math.PI*2);g.fill();}
   for(let i=0;i<10;i++){const x=r()*W,y=r()*H*.5,rad=30+r()*70;g.fillStyle=`rgba(255,255,248,${.2+r()*.3})`;g.beginPath();g.arc(x,y,rad,0,Math.PI*2);g.fill();}
   if('filter' in g)g.filter='none';
   return texture(c,true);
  });
 }
 /* ---------- vinyl: dust in the colour only ----------
    No roughness smudges: anything non-radial in the specular term rotates with
    the record and makes the highlight shimmer, which real light does not. */
 function vinylSurface(){
  return painted('vinyl-surface',()=>{
   const N=1024,[c,g]=canvas(N,N),r=rng(4711);
   g.fillStyle='rgb(14,14,15)';g.fillRect(0,0,N,N);
   for(let i=0;i<700;i++){const x=r()*N,y=r()*N,s=r()<.92?.7+r()*.8:1.5+r()*2,v=Math.round(60+r()*70);
    g.fillStyle=`rgba(${v},${v},${v-6},${.25+r()*.4})`;g.fillRect(x,y,s,s);}
   const color=texture(c,true);color.wrapS=color.wrapT=THREE.ClampToEdgeWrapping;
   return {color,rough:null};
  });
 }
 /* ---------- soft contact shadow (multiply decal) ---------- */
 function contactShadow(){
  return painted('contact',()=>{const N=256,[c,g]=canvas(N,N),gr=g.createRadialGradient(N/2,N/2,N*.05,N/2,N/2,N*.5);
   gr.addColorStop(0,'rgba(0,0,0,.85)');gr.addColorStop(.55,'rgba(0,0,0,.45)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,N,N);
   const t=texture(c,false);t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;return t;});
 }

 /* ---------- material factories (new material each call; textures shared) ---------- */
 // One clone per (texture, tile size): repeat lives on the texture, so share those too.
 const scaledCache=new Map();
 const scaled=(t,mm)=>{if(!t)return null;const k=t.uuid+'@'+mm;let c=scaledCache.get(k);
  if(!c){c=t.clone();c.userData={shared:true};c.repeat.set(1/mm,1/mm);c.needsUpdate=true;scaledCache.set(k,c);}return c;};
 // Identical materials are created once and shared (fewer state changes, and a
 // rebuild never frees a program another mesh still needs). disposeTree skips them.
 const matCache=new Map();
 const shared=(key,make)=>{let m=matCache.get(key);if(!m){m=make();m.userData.shared=true;matCache.set(key,m);}return m;};
 const std=o=>new THREE.MeshStandardMaterial(o);
 const look={
  canPaint,
  lacquer(tint=0xffffff,{rough=.42,coat=1,grainMM=180,kind='mahogany',lite=false}={}){
   return shared(['lacquer',tint,rough,coat,grainMM,kind,lite].join('|'),()=>{
    const w=woodMaps(kind),maps={map:scaled(w?.color,grainMM),bumpMap:scaled(w?.bump,grainMM),bumpScale:.35};
    // room joinery is seen from afar: plain PBR; the cabinet keeps its clear lacquer coat
    const m=lite?std({color:tint,roughness:rough,metalness:0,...maps})
     :new THREE.MeshPhysicalMaterial({color:tint,roughness:rough,metalness:0,clearcoat:coat*.75,clearcoatRoughness:.06,envMapIntensity:.7,specularIntensity:.25,...maps});
    if(!w)m.color.setHex(kind==='oak'?0x8a5c36:0x4a140a).multiply(new THREE.Color(tint));
    return m;});
  },
  brass({rough=.5,tone=0xd6ac63}={}){
   // isotropic: anisotropic GGX on tightly curved brass sparkles under the window key
   return shared('brass|'+rough+'|'+tone,()=>{const r=metalRough();return std({color:tone,metalness:1,roughness:r?Math.max(rough,.5):.3,roughnessMap:r,side:THREE.DoubleSide});});
  },
  nickel({rough=.3}={}){return shared('nickel|'+rough,()=>{const r=metalRough();return std({color:0xd8d5ce,metalness:1,roughness:r?Math.max(rough,.3):.2,roughnessMap:r});});},
  bakelite(color=0x17110d){return shared('bakelite|'+color,()=>std({color,roughness:.3,metalness:0}));},
  felt(color=0x4a1c1c){return shared('felt|'+color,()=>std({color,roughness:1,metalness:0,bumpMap:noiseBump('felt',1.4),bumpScale:.6}));},
  mica(){return shared('mica',()=>std({color:0x2b241c,roughness:.16,metalness:.2}));},
  plaster(tint=0xffffff){return shared('plaster|'+tint,()=>{const p=plaster();return std({color:p?tint:0x8a8672,map:p?scaled(p,450):null,roughness:.95,bumpMap:scaled(noiseBump('plaster',1),300),bumpScale:.5});});},
  ivory(){return shared('ivory',()=>std({color:0xd6cdb4,roughness:.5,bumpMap:scaled(noiseBump('plaster',.6),400),bumpScale:.2}));},
  paper(color=0xd9c39a){return shared('paper|'+color,()=>std({color,roughness:.88,bumpMap:noiseBump('paper',1),bumpScale:.4}));},
  plastic(color,rough=.42){return shared('plastic|'+color+'|'+rough,()=>std({color,roughness:Math.min(rough,.35),metalness:0}));},
  floor(){return shared('floor',()=>{const f=floorMaps();
   return std({color:f?0xffffff:0x7a5233,map:f?.color??null,bumpMap:f?.bump??null,bumpScale:.6,roughness:f?.95:.6,roughnessMap:f?.rough??null,envMapIntensity:.6});});},
  rug(){return shared('rug',()=>{const t=rugMap();return std({color:t?0xffffff:0x2c3a33,map:t,roughness:1,bumpMap:noiseBump('felt',1.6),bumpScale:.8});});},
  garden(){const t=gardenMap();return new THREE.MeshBasicMaterial({color:t?0xffffff:0xd8e4ea,map:t,toneMapped:true});},
  fabric(color){return shared('fabric|'+color,()=>std({color,roughness:.95,side:THREE.DoubleSide,bumpMap:noiseBump('felt',.8),bumpScale:.4}));},
  contactShadow,
  vinylSurface,
  dispose(){for(const m of matCache.values())m.dispose();matCache.clear();for(const t of scaledCache.values())t.dispose();scaledCache.clear();for(const v of cache.values()){if(!v)continue;if(v.isTexture)v.dispose();else for(const t of Object.values(v))t?.isTexture&&t.dispose();}cache.clear();}
 };
 return look;
}

/* Free a mesh tree's geometry, materials and per-mesh textures; shared textures stay. */
export function disposeTree(root){
 root.traverse(o=>{
  o.geometry?.dispose?.();
  const mats=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
  for(const m of mats){if(m.userData?.shared)continue;for(const k of ['map','bumpMap','roughnessMap','normalMap','displacementMap','emissiveMap','alphaMap','anisotropyMap']){const t=m[k];if(t&&!t.userData?.shared&&!m.userData?.keepMaps)t.dispose?.();}m.dispose?.();}
 });
}
