/* Runs the in-browser cut / import off the main thread (GitHub Pages only).
   Messages: {id,type:'encode',size, wav?:ArrayBuffer | samples?:Float32Array, sampleRate?}
             {id,type:'import',png:ArrayBuffer, vector?:ArrayBuffer, json?:string}
   Replies:  {id,stage,fraction} while working, then {id,result} or {id,error}. */
importScripts('vinyl-core.js');
self.onmessage=async e=>{
 const {id,type}=e.data,stage=(s,f)=>self.postMessage({id,stage:s,fraction:f});
 try{
  let result,transfer=[];
  if(type==='encode'){
   let {samples,sampleRate}=e.data;
   if(e.data.wav){const w=VinylCore.wavToMono(e.data.wav);samples=w.samples;sampleRate=w.sampleRate;}
   result=await VinylCore.encodeRecord(samples,sampleRate,Number(e.data.size)||4096,stage,e.data.extras||null);
   transfer=[result.png.buffer,result.groove.buffer,result.preview.buffer];
  }else if(type==='import'){
   result=await VinylCore.importRecord(e.data,stage);
   transfer=[result.preview.buffer,result.playback.png.buffer];if(result.playback.vector)transfer.push(result.playback.vector.buffer);
  }else throw Error('Unknown task: '+type);
  self.postMessage({id,result},transfer);
 }catch(err){self.postMessage({id,error:err&&err.message||String(err)});}
};
