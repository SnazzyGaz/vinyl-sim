/* Song tags and cover art from the audio file itself, read in the browser before
   the cut: ID3v2.2–2.4 (MP3), FLAC metadata blocks and MP4/M4A atoms. Returns
   {title, artist, album, year, picture:{mime, bytes}} with whatever was found.
   Other formats return {} here; the local server's FFmpeg then has a go.
   normaliseCover() turns any picture into a JPEG data URL no wider than 600 px,
   small enough to ride inside the record PNG. Classic script: window.VinylTags. */
(function(root){
'use strict';
const latin=(b)=>{let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return s;};
const utf8=(b)=>new TextDecoder('utf-8').decode(b);
const clean=s=>String(s||'').replace(/\u0000+$/g,'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,200);
function u16(b,le){let s='',i=0;if(b.length>=2&&((b[0]===0xFF&&b[1]===0xFE)||(b[0]===0xFE&&b[1]===0xFF))){le=b[0]===0xFF;i=2;}
 for(;i+1<b.length;i+=2){const c=le?b[i]|(b[i+1]<<8):(b[i]<<8)|b[i+1];if(!c)break;s+=String.fromCharCode(c);}return s;}
function decodeText(enc,b){return enc===0?latin(b):enc===1?u16(b,true):enc===2?u16(b,false):utf8(b);}
function nullEnd(b,from,enc){ // index of the terminator for this text encoding
 if(enc===1||enc===2){for(let i=from;i+1<b.length;i+=2)if(!b[i]&&!b[i+1])return i;return b.length;}
 const i=b.indexOf(0,from);return i<0?b.length:i;}
const syncsafe=(b,o)=>(b[o]&127)<<21|(b[o+1]&127)<<14|(b[o+2]&127)<<7|(b[o+3]&127);
const be32=(b,o)=>((b[o]<<24)>>>0)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3];
const le32=(b,o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16))+(b[o+3]<<24>>>0);
function unsync(b){const out=[];for(let i=0;i<b.length;i++){out.push(b[i]);if(b[i]===0xFF&&b[i+1]===0)i++;}return Uint8Array.from(out);}

function id3(b){
 if(b.length<10||latin(b.subarray(0,3))!=='ID3')return null;
 const ver=b[3],flags=b[5],size=syncsafe(b,6);let tag=b.subarray(10,Math.min(b.length,10+size));
 if(ver<4&&(flags&0x80))tag=unsync(tag);
 let p=0;if(flags&0x40)p=ver===4?syncsafe(tag,0):be32(tag,0)+4;
 const out={},pics=[],idLen=ver===2?3:4,hdr=ver===2?6:10;
 const names=ver===2?{TT2:'title',TP1:'artist',TAL:'album',TYE:'year'}:{TIT2:'title',TPE1:'artist',TALB:'album',TYER:'year',TDRC:'year'};
 while(p+hdr<=tag.length){
  const id=latin(tag.subarray(p,p+idLen));if(!/^[A-Z0-9]+$/.test(id))break;
  const len=ver===2?(tag[p+3]<<16|tag[p+4]<<8|tag[p+5]):ver===4?syncsafe(tag,p+4):be32(tag,p+4);
  const fflags=ver===2?0:tag[p+9];let d=tag.subarray(p+hdr,p+hdr+len);p+=hdr+len;if(!len||p>tag.length+hdr)break;
  if(ver===4&&(fflags&0x02))d=unsync(d);
  if(ver===4&&(fflags&0x01))d=d.subarray(4); // data-length indicator
  if(names[id]&&d.length>1){const v=clean(decodeText(d[0],d.subarray(1)));if(v&&!out[names[id]])out[names[id]]=names[id]==='year'?v.slice(0,4):v;}
  else if(id==='APIC'&&d.length>4){const enc=d[0],m=d.indexOf(0,1),mime=latin(d.subarray(1,m))||'image/jpeg',type=d[m+1],e=nullEnd(d,m+2,enc),start=e+((enc===1||enc===2)?2:1);
   pics.push({type,mime:mime.includes('/')?mime:'image/'+mime.toLowerCase(),bytes:d.subarray(start)});}
  else if(id==='PIC'&&d.length>6){const enc=d[0],fmt=latin(d.subarray(1,4)).toLowerCase(),type=d[4],e=nullEnd(d,5,enc),start=e+((enc===1||enc===2)?2:1);
   pics.push({type,mime:fmt==='png'?'image/png':'image/jpeg',bytes:d.subarray(start)});}
 }
 const pic=pics.find(x=>x.type===3)||pics[0];if(pic&&pic.bytes.length>64)out.picture={mime:pic.mime,bytes:pic.bytes};
 return out;
}
function flac(b){
 if(b.length<8||latin(b.subarray(0,4))!=='fLaC')return null;
 const out={},pics=[];let p=4,last=false;
 while(!last&&p+4<=b.length){
  last=!!(b[p]&128);const type=b[p]&127,len=b[p+1]<<16|b[p+2]<<8|b[p+3],d=b.subarray(p+4,p+4+len);p+=4+len;
  if(type===4){let q=le32(d,0)+4;const n=le32(d,q);q+=4;
   for(let i=0;i<n&&q+4<=d.length;i++){const l=le32(d,q),s=utf8(d.subarray(q+4,q+4+l));q+=4+l;const k=s.indexOf('=');if(k<0)continue;
    const key=s.slice(0,k).toUpperCase(),v=clean(s.slice(k+1)),map={TITLE:'title',ARTIST:'artist',ALBUM:'album',DATE:'year'};if(map[key]&&v&&!out[map[key]])out[map[key]]=map[key]==='year'?v.slice(0,4):v;}}
  else if(type===6){let q=0;const ptype=be32(d,q);q+=4;const ml=be32(d,q);const mime=latin(d.subarray(q+4,q+4+ml));q+=4+ml;const dl=be32(d,q);q+=4+dl+16;const n=be32(d,q);
   pics.push({type:ptype,mime,bytes:d.subarray(q+4,q+4+n)});}
 }
 const pic=pics.find(x=>x.type===3)||pics[0];if(pic)out.picture={mime:pic.mime,bytes:pic.bytes};
 return out;
}
function mp4(b){
 if(b.length<12||latin(b.subarray(4,8))!=='ftyp')return null;
 const out={};
 const atoms=(s,e,fn)=>{let p=s;while(p+8<=e){let size=be32(b,p),hdr=8;const type=latin(b.subarray(p+4,p+8));
  if(size===1){size=be32(b,p+12)+be32(b,p+8)*4294967296;hdr=16;}else if(size===0)size=e-p;if(size<hdr||p+size>e)break;fn(type,p+hdr,p+size);p+=size;}};
 const keys={'©nam':'title','©ART':'artist','©alb':'album','©day':'year'};
 atoms(0,b.length,(t,s,e)=>{if(t!=='moov')return;atoms(s,e,(t,s,e)=>{if(t!=='udta')return;atoms(s,e,(t,s,e)=>{if(t!=='meta')return;atoms(s+4,e,(t,s,e)=>{if(t!=='ilst')return;
  atoms(s,e,(item,s,e)=>atoms(s,e,(t,ds,de)=>{if(t!=='data')return;const kind=be32(b,ds),payload=b.subarray(ds+8,de);
   if(item==='covr'&&!out.picture)out.picture={mime:kind===14?'image/png':'image/jpeg',bytes:payload};
   else if(keys[item]&&!out[keys[item]]){const v=clean(utf8(payload));if(v)out[keys[item]]=keys[item]==='year'?v.slice(0,4):v;}}));});});});});
 return out;
}
function readTags(buffer){
 try{const b=new Uint8Array(buffer);return id3(b)||flac(b)||mp4(b)||{};}catch{return {};}
}
/* Any picture -> JPEG data URL, at most 600 px on its longer side. */
async function normaliseCover(source,mime='image/jpeg'){
 if(!source)return null;
 const blob=source instanceof Blob?source:new Blob([source],{type:mime});
 try{
  const bmp=await createImageBitmap(blob);const k=Math.min(1,600/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*k)),h=Math.max(1,Math.round(bmp.height*k));
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.drawImage(bmp,0,0,w,h);bmp.close?.();
  const url=c.toDataURL('image/jpeg',.86);return url.startsWith('data:image/jpeg')?url:null;
 }catch{return null;}
}
function displayName(tags,fallback){
 if(tags?.title&&tags?.artist)return `${tags.artist} — ${tags.title}`;
 return tags?.title||fallback||'Record';
}
const api={readTags,normaliseCover,displayName};
if(typeof module==='object'&&module.exports)module.exports=api;else root.VinylTags=api;
})(typeof self!=='undefined'?self:this);
