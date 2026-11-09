// Inspection worker must preserve 16-bit detail (not use the browser's 8-bit PNG decoder).
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('./static/vinyl-core.js');
(async()=>{
 let result;const self={postMessage(value){result=value;}};
 const context={self,VinylCore:core,importScripts(){},Float32Array,Math};vm.createContext(context);
 vm.runInContext(fs.readFileSync('static/inspect-height-worker.js','utf8'),context);
 const samples=new Uint16Array([0,1,256,32767,32768,65400,65534,65535]);
 const png=await core.encodePng({width:4,height:2,colorType:0,bitDepth:16,samples});
 await self.onmessage({data:png});assert.equal(result.width,4);assert.equal(result.height,2);
 for(let i=0;i<samples.length;i++)assert.ok(Math.abs(result.data[i]-samples[i]/65535)<1e-7);
 const preview=await core.encodePng({width:1,height:1,colorType:2,bitDepth:8,data:new Uint8Array([30,30,30])});
 await self.onmessage({data:preview});assert.match(result.error,/16-bit/);
 console.log('PASS: inspection worker preserves 16-bit samples in linear float texture data; rejects an RGB preview.');
})().catch(e=>{console.error(e);process.exitCode=1;});
