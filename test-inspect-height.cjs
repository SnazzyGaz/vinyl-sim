// Inspection worker must preserve 16-bit detail (not use the browser's 8-bit PNG decoder).
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('./static/vinyl-core.js');
(async()=>{
 let result;const self={postMessage(value){result=value;}};
 const context={self,VinylCore:core,importScripts(){},Float32Array,Uint16Array,Uint32Array,Math};vm.createContext(context);
 const fromHalf=h=>{const e=(h>>10)&31,m=h&1023;return e===0?m*2**-24:(1+m/1024)*2**(e-15);};
 vm.runInContext(fs.readFileSync('static/inspect-height-worker.js','utf8'),context);
 const samples=new Uint16Array([0,1,256,32767,32768,65400,65534,65535]);
 const png=await core.encodePng({width:4,height:2,colorType:0,bitDepth:16,samples});
 await self.onmessage({data:png});assert.equal(result.width,4);assert.equal(result.height,2);
 assert.equal(result.half,true);assert.ok(result.data instanceof Uint16Array);
 for(let i=0;i<samples.length;i++){const v=samples[i]/65535;assert.ok(Math.abs(fromHalf(result.data[i])-v)<=Math.max(v,6e-5)*2**-11+1e-9,'half-float keeps 11-bit relative precision');}
 // A 4096 map is box-filtered to 2048 (average of each 2x2), not point-sampled.
 const big=new Uint16Array(4096*4096);for(let y=0;y<4096;y++)for(let x=0;x<4096;x++)big[y*4096+x]=((x+y)&1)?60000:20000;
 await self.onmessage({data:await core.encodePng({width:4096,height:4096,colorType:0,bitDepth:16,samples:big})});
 assert.equal(result.width,2048);assert.ok(Math.abs(fromHalf(result.data[12345])-40000/65535)<1e-3,'2x2 average');
 const preview=await core.encodePng({width:1,height:1,colorType:2,bitDepth:8,data:new Uint8Array([30,30,30])});
 await self.onmessage({data:preview});assert.match(result.error,/16-bit/);
 console.log('PASS: inspection worker keeps 16-bit relief as half floats, box-filters 4096 maps to 2048, rejects an RGB preview.');
})().catch(e=>{console.error(e);process.exitCode=1;});
