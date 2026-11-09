/* Frame output for the player: quality tiers, post-processing and adaptive
   resolution. Tiers:
     high     MSAA HDR target -> ground-truth AO -> shallow depth of field -> soft bloom -> tone map -> lens finish
     balanced MSAA HDR target -> soft bloom -> tone map -> lens finish
     low      direct render (renderer MSAA), no post
   'auto' starts at high on capable GPUs and steps down while frames are slow. */
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {BokehPass} from 'three/addons/postprocessing/BokehPass.js';

const TIERS=['low','balanced','high'];
// Gentle vignette and fine grain, applied after tone mapping (display space).
const LensShader={
 uniforms:{tDiffuse:{value:null},uTime:{value:0},uVignette:{value:.32},uGrain:{value:.018}},
 vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime,uVignette,uGrain;varying vec2 vUv;
 float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
 void main(){vec4 c=texture2D(tDiffuse,vUv);vec2 d=vUv-.5;float v=1.-uVignette*smoothstep(.25,.85,dot(d,d)*2.2);
  float g=(h(vUv*vec2(1733.,977.)+fract(uTime))-.5)*uGrain;gl_FragColor=vec4(c.rgb*v+g,c.a);}`
};

const ClampShader={
 uniforms:{tDiffuse:{value:null},uMax:{value:12}},
 vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
 fragmentShader:`uniform sampler2D tDiffuse;uniform float uMax;varying vec2 vUv;
 void main(){vec4 c=texture2D(tDiffuse,vUv);if(any(isnan(c.rgb))||any(isinf(c.rgb)))c.rgb=vec3(0.);
  float m=max(c.r,max(c.g,c.b));if(m>uMax)c.rgb*=uMax/m;gl_FragColor=c;}`
};

export function createPost(renderer,scene,camera,{storageKey='vinyl-quality',onChange}={}){
 const gl=renderer.getContext?.();
 const canFloat=!!(renderer.capabilities?.isWebGL2);
 let mode='auto',tier='high',composer=null,gtao=null,bloom=null,lens=null,dof=null,focusMM=600,w=1,h=1,dprCap=2,dpr=1;
 try{const saved=localStorage.getItem(storageKey);if(saved&&['auto',...TIERS].includes(saved))mode=saved;}catch{}
 // A weak/mobile GPU starts lower; 'auto' adapts from there.
 const weak=/Mali|Adreno [1-5]\d\d|PowerVR|Intel\(R\) (HD|UHD) Graphics [1-6]\d\d\b|SwiftShader|llvmpipe/i.test(debugRenderer());
 tier=mode==='auto'?(weak?'balanced':'high'):mode;
 function debugRenderer(){try{const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):'';}catch{return '';}}
 function build(){
  composer?.dispose?.();gtao?.dispose?.();bloom?.dispose?.();dof?.dispose?.();composer=gtao=bloom=lens=dof=null;
  // Start at <=1.5x (MSAA hides the difference); 'auto' climbs to the cap only if frames are quick.
  dprCap=tier==='high'?2:tier==='balanced'?1.5:1.25;
  dpr=Math.min(devicePixelRatio||1,dprCap,mode==='auto'?1.5:dprCap);renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled=true;
  if(tier==='low'||!canFloat){resize(w,h);return;}
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  composer=new EffectComposer(renderer,target);
  composer.addPass(new RenderPass(scene,camera));
  if(tier==='high'){
   gtao=new GTAOPass(scene,camera,1,1);
   // AO is soft and low-frequency: compute it at half resolution (a quarter of the
   // pixels) and let the denoise + bilinear blend carry it to full size.
   const full=gtao.setSize.bind(gtao);gtao.setSize=(w,h)=>full(Math.max(1,Math.ceil(w/2)),Math.max(1,Math.ceil(h/2)));
   // scene units are millimetres
   gtao.updateGtaoMaterial({radius:55,distanceExponent:1.6,thickness:30,scale:1.25,samples:8,distanceFallOff:1,screenSpaceRadius:false});
   gtao.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:5,rings:2,samples:8});
   gtao.blendIntensity=1;composer.addPass(gtao);
   // a lens focused on the record: the room behind falls gently soft
   dof=new BokehPass(scene,camera,{focus:focusMM,aperture:6e-6,maxblur:.0055});
   // Reuse the depth buffer the AO pass already rendered instead of drawing the whole
   // scene a third time: hardware depth, read with .x (DEPTH_PACKING 0).
   dof.materialBokeh.defines.DEPTH_PACKING=0;dof.materialBokeh.needsUpdate=true;
   dof.renderTargetDepth.dispose();dof.setSize=()=>{};
   const ao=gtao;dof.render=function(r,writeBuffer,readBuffer){
    this.uniforms.tDepth.value=ao.depthTexture;this.uniforms.tColor.value=readBuffer.texture;
    this.uniforms.nearClip.value=this.camera.near;this.uniforms.farClip.value=this.camera.far;this.uniforms.aspect.value=this.camera.aspect;
    r.setRenderTarget(this.renderToScreen?null:writeBuffer);this.fsQuad.render(r);};
   composer.addPass(dof);
  }
  // Clamp HDR fireflies (tiny glancing highlights on anisotropic brass can reach
  // half-float infinity) before bloom spreads them into glowing squares.
  composer.addPass(new ShaderPass(ClampShader));
  bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.14,.45,1.5); // only true light sources bloom, not glints
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  lens=new ShaderPass(LensShader);composer.addPass(lens);
  resize(w,h);
 }
 function resize(width,height){
  w=Math.max(1,width|0);h=Math.max(1,height|0);
  renderer.setSize(w,h,false);
  if(composer){composer.setPixelRatio(dpr);composer.setSize(w,h);}
 }
 // Frame-time tracker: only frames that were actually drawn back-to-back count.
 let samples=[],lastDrawn=0,cool=0;
 function adapt(now){
  if(mode!=='auto'){lastDrawn=now;return;}
  if(lastDrawn&&now-lastDrawn<100)samples.push(now-lastDrawn);lastDrawn=now;
  if(cool>0){cool--;return;}
  if(samples.length<45)return;
  samples.sort((a,b)=>a-b);const med=samples[samples.length>>1];samples=[];
  if(med>24){ // slow: shave resolution first, then drop a tier
   if(dpr>1.01){dpr=Math.max(1,dpr-.25);renderer.setPixelRatio(dpr);resize(w,h);}
   else{const i=TIERS.indexOf(tier);if(i>0){tier=TIERS[i-1];build();onChange?.(state());}}
   cool=20;
  }else if(med<11&&dpr<Math.min(devicePixelRatio||1,dprCap)-.01){dpr=Math.min(dprCap,dpr+.25);renderer.setPixelRatio(dpr);resize(w,h);cool=60;}
 }
 function render(now=performance.now()){
  if(lens)lens.uniforms.uTime.value=(now%10000)/1000;
  if(composer)composer.render();else renderer.render(scene,camera);
  adapt(now);
 }
 function focus(mm){focusMM=mm;if(dof)dof.uniforms.focus.value=mm;}
 function setMode(m){
  if(!['auto',...TIERS].includes(m))return;mode=m;try{localStorage.setItem(storageKey,m);}catch{}
  tier=m==='auto'?(weak?'balanced':'high'):m;samples=[];build();onChange?.(state());
 }
 function state(){return {mode,tier,dpr};}
 // Pause adaptation across idle gaps (render-on-demand leaves long pauses).
 function idle(){lastDrawn=0;}
 build();
 return {render,resize,setMode,state,idle,focus,get tier(){return tier;}};
}
