/* Inspection only: reuse the existing lossless PNG reader off the UI thread.
   Keep the 16-bit samples until conversion to a linear float GPU texture. */
importScripts('vinyl-core.js');
self.onmessage=async e=>{
 try{
  const map=await VinylCore.decodePng(e.data);
  if(!map.samples)throw Error('Not a 16-bit height map');
  const step=Math.max(1,Math.ceil(Math.max(map.width,map.height)/4096));
  const width=Math.ceil(map.width/step),height=Math.ceil(map.height/step),data=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=map.samples[(y*step)*map.width+x*step]/65535;
  self.postMessage({width,height,data},[data.buffer]);
 }catch(e){self.postMessage({error:e.message});}
};
