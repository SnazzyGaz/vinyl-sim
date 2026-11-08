/* Bakelite knob that drives a native <input type=range>. The input keeps the
   value and fires the usual input/change events, so page logic is unchanged.
   Markup: <div class="knob" data-for="inputId" aria-label="..."></div> */
(() => {
const SWEEP=270; // degrees of travel, -135 .. +135
function attach(knob){
 const input=document.getElementById(knob.dataset.for);if(!input)return;
 knob.setAttribute('role','slider');knob.tabIndex=0;
 const min=()=>Number(input.min||0),max=()=>Number(input.max||100),step=()=>Number(input.step||1);
 const unit=knob.dataset.unit||'',pct=knob.dataset.percent!==undefined;
 const text=v=>pct?Math.round(v*100)+' per cent':(Number(v).toFixed(Number(knob.dataset.decimals||0))+unit);
 function paint(){
  const v=Number(input.value),f=(v-min())/(max()-min()||1);
  knob.style.setProperty('--turn',(f*SWEEP-SWEEP/2)+'deg');
  knob.setAttribute('aria-valuemin',min());knob.setAttribute('aria-valuemax',max());knob.setAttribute('aria-valuenow',v);
  knob.setAttribute('aria-valuetext',text(v));
  knob.setAttribute('aria-disabled',input.disabled?'true':'false');knob.tabIndex=input.disabled?-1:0;
 }
 function set(v,commit){
  if(input.disabled)return;
  const s=step(),c=Math.min(max(),Math.max(min(),Math.round((v-min())/s)*s+min()));
  const next=String(Number(c.toFixed(6)));
  if(next!==input.value){input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));}
  if(commit)input.dispatchEvent(new Event('change',{bubbles:true}));
  paint();
 }
 let dragY=null,dragV=0;
 knob.addEventListener('pointerdown',e=>{if(input.disabled||e.button!==0)return;dragY=e.clientY;dragV=Number(input.value);knob.setPointerCapture(e.pointerId);knob.focus();});
 knob.addEventListener('pointermove',e=>{if(dragY===null)return;const range=max()-min();set(dragV+(dragY-e.clientY)/180*range*(e.shiftKey?.2:1),false);});
 const end=()=>{if(dragY===null)return;dragY=null;set(Number(input.value),true);};
 knob.addEventListener('pointerup',end);knob.addEventListener('pointercancel',end);
 knob.addEventListener('wheel',e=>{if(input.disabled)return;e.preventDefault();set(Number(input.value)-Math.sign(e.deltaY)*step()*(e.shiftKey?1:5),true);},{passive:false});
 knob.addEventListener('keydown',e=>{
  const s=step(),big=(max()-min())/10,v=Number(input.value);let n=null;
  if(e.key==='ArrowUp'||e.key==='ArrowRight')n=v+s*(e.shiftKey?10:1);
  else if(e.key==='ArrowDown'||e.key==='ArrowLeft')n=v-s*(e.shiftKey?10:1);
  else if(e.key==='PageUp')n=v+big;else if(e.key==='PageDown')n=v-big;
  else if(e.key==='Home')n=min();else if(e.key==='End')n=max();
  if(n!==null){e.preventDefault();set(n,true);}
 });
 input.addEventListener('input',paint);input.addEventListener('change',paint);
 new MutationObserver(paint).observe(input,{attributes:true,attributeFilter:['disabled','value']});
 // programmatic input.value = ... does not fire events; repaint cheaply
 setInterval(()=>{if(String(knob.getAttribute('aria-valuenow'))!==input.value)paint();},150);
 paint();
}
document.querySelectorAll('.knob[data-for]').forEach(attach);
})();
