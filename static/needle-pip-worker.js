/* Needle view only: fetch nothing, just read the record's own geometry off the UI thread.
   'vector': the groove master WAV, checked by vinyl-core readVector against the record's
   metadata (format, rate, length, sha256 of the PCM) -> x as the Cutter used it.
   'png': the 16-bit height map, decoded losslessly -> its raw stored pixels.
   Anything that does not check out is refused, and the view says it is showing a rebuild. */
importScripts('vinyl-core.js');
self.onmessage=async e=>{
 const {kind,bytes,metadata:m}=e.data;
 try{
  if(kind==='vector'){const {x}=await VinylCore.readVector(new Uint8Array(bytes),m);const f=Float32Array.from(x);self.postMessage({ok:true,x:f},[f.buffer]);return;}
  const map=await VinylCore.decodePng(bytes);
  if(!map.samples)throw Error('Not a 16-bit grey height map.');
  if(map.width!==map.height||map.width!==m.image_size)throw Error('Map size does not match its metadata.');
  self.postMessage({ok:true,samples:map.samples,size:map.width},[map.samples.buffer]);
 }catch(err){self.postMessage({ok:false,error:String(err&&err.message||err)});}
};
