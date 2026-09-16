'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),sharp=require('sharp');
const {createApp}=require('../src/app.cjs'),{identity,session}=require('../src/store.cjs'),Albums=require('../src/albums.cjs');
const barrier=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
async function until(predicate){const end=Date.now()+2000;while(!predicate()){assert(Date.now()<end,'request did not reach expected phase');await new Promise(r=>setTimeout(r,5))}}
async function fixture(t,transport={}){
 const app=createApp({database:':memory:',origin:'http://127.0.0.1',uploadTransport:{idleMs:2000,totalMs:5000,queueMs:1000,...transport}}),clients=[];
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const port=app.server.address().port,base='http://127.0.0.1:'+port;
 t.after(async()=>{clients.forEach(c=>c.destroy());app.server.closeAllConnections();await app.close()});
 const users=[0,1].map(i=>{const p=identity(app.db,'avatar-transport',String(i));return{...p,...session(app.db,p.id)}});
 const image=(await sharp({create:{width:96,height:96,channels:3,background:'#825be0'}}).png().toBuffer()).toString('base64');
 async function call(method,route,body,auth='Bearer '+users[0].token){const res=await fetch(base+route,{method,headers:{Authorization:auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,body:await res.json(),headers:res.headers}}
 const ticket=async()=>{const result=await call('POST','/api/me/avatar-upload',{});assert.equal(result.status,201);return 'Avatar '+new URL(result.body.uploadUrl).hash.slice(1)};
 function stream(method,route,body,auth){const incoming=barrier(),outcome=barrier(),id=crypto.randomUUID(),bytes=Buffer.from(JSON.stringify(body));
  const listener=req=>{if(req.headers['x-test-request']===id){app.server.off('request',listener);incoming.resolve(req)}};app.server.on('request',listener);
  const client=http.request({host:'127.0.0.1',port,path:route,method,headers:{Authorization:auth,'Content-Type':'application/json','Content-Length':bytes.length,'X-Test-Request':id}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>outcome.resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));res.on('error',error=>outcome.resolve({error}))});
  client.on('error',error=>outcome.resolve({error}));clients.push(client);client.write(bytes.subarray(0,1));return{client,bytes,incoming:incoming.promise,outcome:outcome.promise};
 }
 return{app,users,image,call,ticket,stream};
}
test('avatar bodies share bounded admission with post uploads instead of bypassing the memory cap',async t=>{
 const f=await fixture(t,{maxInFlight:1}),auth=await f.ticket(),body={requestId:crypto.randomUUID(),caption:'',imageBase64:f.image},held=f.stream('POST','/api/posts',body,'Bearer '+f.users[1].token),incoming=await held.incoming;
 await until(()=>incoming.zoigramUpload);
 const result=await f.call('PUT','/api/avatar-upload',{imageBase64:f.image},auth);
 assert.equal(result.status,503);assert.equal(result.headers.get('retry-after'),'5');assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM avatars').get().n,0);
 held.client.destroy();await until(()=>incoming.destroyed);await new Promise(r=>setImmediate(r));
 assert.equal((await f.call('PUT','/api/avatar-upload',{imageBase64:f.image},auth)).status,200);
});
test('avatar processing waits for the same bounded converter used by posts',async t=>{
 const f=await fixture(t,{maxProcessing:1,maxInFlight:2}),auth=await f.ticket(),original=Albums.convert,started=barrier(),release=barrier();let pending,avatar;
 Albums.convert=async(...args)=>{started.resolve();await release.promise;return original(...args)};
 try{
  pending=f.call('POST','/api/posts',{requestId:crypto.randomUUID(),caption:'',imageBase64:f.image},'Bearer '+f.users[1].token);await started.promise;
  const held=f.stream('PUT','/api/avatar-upload',{imageBase64:f.image},auth),incoming=await held.incoming;held.client.end(held.bytes.subarray(1));avatar=held.outcome;
  await until(()=>incoming.zoigramUploadPhase==='waiting'||f.app.db.prepare('SELECT COUNT(*) n FROM avatars').get().n>0);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM avatars').get().n,0,'avatar conversion bypassed the busy shared worker');
  release.resolve();assert.equal((await pending).status,201);assert.equal((await avatar).status,200);
 }finally{release.resolve();if(pending)await pending;if(avatar)await avatar;Albums.convert=original}
});
test('disconnect during avatar conversion leaves the existing avatar and its ticket unchanged',async t=>{
 const f=await fixture(t),auth=await f.ticket(),original=sharp.prototype.toBuffer,started=barrier(),release=barrier();let incoming;
 sharp.prototype.toBuffer=function(...args){started.resolve();return release.promise.then(()=>original.apply(this,args))};
 try{
  const held=f.stream('PUT','/api/avatar-upload',{imageBase64:f.image},auth);incoming=await held.incoming;held.client.end(held.bytes.subarray(1));await started.promise;
  const closed=barrier();incoming.socket.once('close',closed.resolve);held.client.destroy();await closed.promise;release.resolve();
  await until(()=>f.app.db.prepare('SELECT COUNT(*) n FROM operational_errors WHERE status=499').get().n>0||f.app.db.prepare('SELECT COUNT(*) n FROM avatars').get().n>0);
  assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM avatars').get().n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM avatar_uploads').get().n,1);
 }finally{release.resolve();sharp.prototype.toBuffer=original}
 assert.equal((await f.call('PUT','/api/avatar-upload',{imageBase64:f.image},auth)).status,200);
});
