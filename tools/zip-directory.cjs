'use strict';
// Standard ZIP: UTF-8 names, deflate, CRC32. No executables or nested archives are added.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0}
function zipDirectory(directory,zip){
 const root=path.resolve(directory),output=path.resolve(zip),files=[];
 if(output.startsWith(root+path.sep))throw Error('ZIP output cannot be inside its source directory');
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink in ZIP input');if(e.isDirectory())walk(file);else if(e.isFile())files.push(file);else throw Error('Unsupported ZIP input')}}walk(root);
 if(files.length>65535)throw Error('ZIP64 not supported');
 const local=[],central=[];let offset=0;
 for(const file of files){
  const name=Buffer.from(path.relative(root,file).replaceAll('\\','/'),'utf8'),data=fs.readFileSync(file),compressed=zlib.deflateRawSync(data,{level:9}),crc=crc32(data);
  if(data.length>=0xffffffff||compressed.length>=0xffffffff||name.length>65535)throw Error('ZIP entry too large');
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
  local.push(h,name,compressed);central.push(c,name);offset+=h.length+name.length+compressed.length;if(offset>=0xffffffff)throw Error('ZIP64 not supported');
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);fs.writeFileSync(output,Buffer.concat([...local,index,end]),{flag:'wx'});
}
module.exports={zipDirectory,crc32};
