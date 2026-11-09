/* Inspection only: decode the 16-bit PNG losslessly off the UI thread, box-filter
   it to at most 2048 px (a 4096 map would be a 64 MB float upload for detail the
   screen cannot show) and hand back half floats: an 8 MB R16F texture whose
   ~11-bit mantissa keeps the groove relief well below a micron. */
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
  const width=Math.ceil(map.width/step),height=Math.ceil(map.height/step),data=new Uint16Array(width*height),W=map.width,H=map.height,s=map.samples;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let sum=0,n=0;for(let dy=0;dy<step;dy++){const yy=y*step+dy;if(yy>=H)break;for(let dx=0;dx<step;dx++){const xx=x*step+dx;if(xx>=W)break;sum+=s[yy*W+xx];n++;}}
   data[y*width+x]=toHalf(sum/n/65535);
  }
  self.postMessage({width,height,data,half:true},[data.buffer]);
 }catch(e){self.postMessage({error:e.message});}
};
