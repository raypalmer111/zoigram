'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('InzoiSocial/ui/OnlineBridge/photos.js','utf8'),MiB=1024*1024;
function photos(extra={}){
 const context={window:{},Uint8Array,ArrayBuffer,Promise,Error,Number,Array,setTimeout,clearTimeout,atob:text=>Buffer.from(text,'base64').toString('binary'),...extra};
 vm.runInNewContext(source,context);return context.window.ZoigramPhotos;
}
test('unsupported canvas preserves the original bytes up to the 25 MiB resumable limit',async()=>{
 const input=new ArrayBuffer(25*MiB),view=new Uint8Array(input);view[0]=0x89;view[view.length-1]=0xaa;
 const result=await photos().prepare(input,25*MiB);
 assert.equal(result.buffer,input);assert.equal(result.bytes,25*MiB);assert.equal(result.originalBytes,25*MiB);assert.equal(result.compressed,false);assert.equal(view[0],0x89);assert.equal(view[view.length-1],0xaa);
});
test('unsupported canvas rejects an oversized fallback immediately instead of retrying forever',async()=>{
 const input=new ArrayBuffer(25*MiB+1);
 await assert.rejects(()=>photos().prepare(input,25*MiB),error=>error.photoCode==='photo_size'&&error.imageBytes===input.byteLength&&error.local===true);
});
test('the 64 MiB source guard runs before image decoding or object URL allocation',async()=>{
 let touched=false;const p=photos({document:{createElement(){touched=true;throw Error('unexpected');}},Image:function(){touched=true;},Blob,URL:{createObjectURL(){touched=true;}}});
 await assert.rejects(()=>p.prepare(new ArrayBuffer(64*MiB+1),25*MiB),error=>error.photoCode==='photo_size'&&error.imageBytes===64*MiB+1);assert.equal(touched,false);
});
test('a runtime without a usable canvas falls back once and reports preparation failure above its fallback limit',async()=>{
 let decoded=0,revoked=0;
 class Image{set src(value){if(value){decoded++;this.naturalWidth=2560;this.naturalHeight=1440;queueMicrotask(()=>this.onload());}}}
 const p=photos({Image,Blob,document:{createElement:()=>({getContext:()=>null})},URL:{createObjectURL:()=> 'blob:synthetic-local-photo',revokeObjectURL:()=>{revoked++;}}});
 const small=new ArrayBuffer(9*MiB);assert.equal((await p.prepare(small,25*MiB)).buffer,small);
 await assert.rejects(()=>p.prepare(new ArrayBuffer(25*MiB+1),25*MiB),error=>error.photoCode==='photo_prepare'&&error.local===true);assert.equal(decoded,2);assert.equal(revoked,2);
});
test('empty input is rejected and upload base64 preserves all byte values across chunk boundaries',async()=>{
 const p=photos();await assert.rejects(()=>p.prepare(new ArrayBuffer(0),25*MiB),error=>error.photoCode==='photo_read');
 for(const length of [1,2,3,256,12289,65537]){const input=Uint8Array.from({length},(_,i)=>i%256);assert.deepEqual(Buffer.from(p.base64(input.buffer),'base64'),Buffer.from(input));}
});
function pngHeader(width,height,size=24){const buffer=Buffer.alloc(size);Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]).copy(buffer);buffer.writeUInt32BE(width,16);buffer.writeUInt32BE(height,20);return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);}
function canvasRuntime(width,height,jpeg,{unsupported=false}={}){
 let canvases=0;
 class Image{set src(value){if(value){this.naturalWidth=width;this.naturalHeight=height;queueMicrotask(()=>this.onload());}}}
 return {extra:{Image,Blob,URL:{createObjectURL:()=> 'blob:test-photo',revokeObjectURL:()=>{}},document:{createElement:()=>{canvases++;return {getContext:()=>unsupported?null:{fillRect(){},drawImage(){}},toDataURL:()=> 'data:image/jpeg;base64,'+jpeg.toString('base64')};}}},canvases:()=>canvases};
}
test('resizing selects the prepared JPEG even when a simple PNG original takes fewer bytes',async()=>{
 for(const [width,height]of [[3000,2000],[6000,6000]]){
  const input=pngHeader(width,height,64),before=Buffer.from(input),jpeg=Buffer.alloc(512,7),runtime=canvasRuntime(width,height,jpeg);
  const result=await photos(runtime.extra).prepare(input,25*MiB);
  assert(result.bytes>input.byteLength);assert.equal(result.compressed,true);assert.deepEqual(Buffer.from(result.buffer),jpeg);assert.deepEqual(Buffer.from(input),before);
 }
});
test('already-small originals can stay unchanged when their JPEG would be larger',async()=>{
 const input=pngHeader(1024,1024,64),runtime=canvasRuntime(1024,1024,Buffer.alloc(512));const result=await photos(runtime.extra).prepare(input,25*MiB);assert.equal(result.buffer,input);assert.equal(result.compressed,false);
});
test('PNG fallback respects the server pixel limit whether canvas is missing or unusable',async()=>{
 const accepted=pngHeader(8000,4000),oversized=pngHeader(6000,6000);
 assert.equal((await photos().prepare(accepted,25*MiB)).buffer,accepted);
 await assert.rejects(()=>photos().prepare(oversized,25*MiB),error=>error.photoCode==='photo_prepare'&&error.local===true);
 const runtime=canvasRuntime(6000,6000,Buffer.alloc(32),{unsupported:true});await assert.rejects(()=>photos(runtime.extra).prepare(oversized,25*MiB),error=>error.photoCode==='photo_prepare');assert.equal(runtime.canvases(),1);
});
test('PNG pixel counts above 64 MP are rejected before browser allocation despite a tiny file',async()=>{
 const runtime=canvasRuntime(10000,10000,Buffer.alloc(32));await assert.rejects(()=>photos(runtime.extra).prepare(pngHeader(10000,10000),25*MiB),error=>error.photoCode==='photo_prepare');assert.equal(runtime.canvases(),0);
});
test('a resize above the byte limit never falls back to a source the server cannot decode',async()=>{
 const runtime=canvasRuntime(6000,6000,Buffer.alloc(1024));await assert.rejects(()=>photos(runtime.extra).prepare(pngHeader(6000,6000),512),error=>error.photoCode==='photo_prepare');
});
