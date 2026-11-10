/* Inspection only: decode the 16-bit PNG losslessly off the UI thread, box-filter
   it to at most 2048 px (a 4096 map would be a 64 MB float upload for detail the
   screen cannot show) and hand back half floats: an 8 MB R16F texture whose
   ~11-bit mantissa keeps the groove relief well below a micron, plus its mip
   chain (a third more) so the receding disc is filtered, not aliased. */
importScripts('vinyl-core.js');
const f32=new Float32Array(1),u32=new Uint32Array(f32.buffer);
function toHalf(v){ // round-to-nearest float32 -> float16 for 0..1 inputs
 f32[0]=v;const x=u32[0],e=((x>>>23)&255)-112,m=x&0x7fffff;
 if(e<=0){if(e<-10)return 0;const mm=(m|0x800000)>>(1-e);return (mm+0x1000)>>13;}
 return Math.min(0x7bff,(e<<10)+((m+0x1000)>>13));
}
self.onmessage=async e=>{
 try{
  const map=await VinylCore.decodePng(e.data);
  if(!map.samples)throw Error('Not a 16-bit height map');
  const step=Math.max(1,Math.ceil(Math.max(map.width,map.height)/2048));
  const width=Math.ceil(map.width/step),height=Math.ceil(map.height/step),W=map.width,H=map.height,s=map.samples;
  let level=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let sum=0,n=0;for(let dy=0;dy<step;dy++){const yy=y*step+dy;if(yy>=H)break;for(let dx=0;dx<step;dx++){const xx=x*step+dx;if(xx>=W)break;sum+=s[yy*W+xx];n++;}}
   level[y*width+x]=sum/n/65535;
  }
  const halves=l=>{const o=new Uint16Array(l.length);for(let i=0;i<l.length;i++)o[i]=toHalf(l[i]);return o;};
  const data=halves(level),mips=[],buffers=[data.buffer];
  // Full mip chain, each level the 2x2 average of the one above (in float, before
  // rounding to half): a receding record then samples relief averaged over the
  // pixel's footprint instead of point-picking grooves, which is what drew moire.
  for(let w=width,h=height;w>1||h>1;){
   const nw=Math.max(1,w>>1),nh=Math.max(1,h>>1),next=new Float32Array(nw*nh);
   for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){
    let sum=0,n=0;for(let dy=0;dy<2;dy++){const yy=y*2+dy;if(yy>=h)break;for(let dx=0;dx<2;dx++){const xx=x*2+dx;if(xx>=w)break;sum+=level[yy*w+xx];n++;}}
    next[y*nw+x]=sum/n;
   }
   const d=halves(next);mips.push({data:d,width:nw,height:nh});buffers.push(d.buffer);level=next;w=nw;h=nh;
  }
  self.postMessage({width,height,data,half:true,mips},buffers);
 }catch(e){self.postMessage({error:e.message});}
};
