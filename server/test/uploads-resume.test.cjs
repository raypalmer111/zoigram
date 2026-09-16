'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../src/app.cjs'),{identity,session}=require('../src/store.cjs'),Albums=require('../src/albums.cjs'),{MAX_INPUT,TTL}=require('../src/uploads.cjs');
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
async function fixture(t,options={}){
 let app=createApp({database:':memory:',origin:'http://127.0.0.1',...options});
 const listen=async()=>new Promise(r=>app.server.listen(0,'127.0.0.1',r));await listen();t.after(()=>app.close());
 const users=['author','viewer'].map(n=>{const p=identity(app.db,'test',n);return {...p,...session(app.db,p.id)}});
 const photos=await Promise.all(['#bb2244','#2244bb','#44bb22'].map((color,i)=>sharp({create:{width:96+i*8,height:80+i*8,channels:3,background:color}}).png().toBuffer()));
 async function call(method,route,body,user=users[0],headers={}){const u=new URL(route,'http://localhost');const r=await fetch('http://127.0.0.1:'+app.server.address().port+u.pathname+u.search,{method,headers:{...(user?{Authorization:'Bearer '+user.token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});return {status:r.status,body:(r.headers.get('content-type')||'').includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}}
 const start=(count=3,requestId=crypto.randomUUID(),user=users[0],caption='Ordered album')=>call('POST','/api/uploads',{requestId,count,caption},user);
 const put=(id,index,photo=photos[index],user=users[0])=>call('PUT','/api/uploads/'+id+'/'+index,{imageBase64:photo.toString('base64')},user);
 const done=(id,user=users[0])=>call('POST','/api/uploads/'+id+'/complete',{},user);
 return {get app(){return app},users,photos,call,start,put,done,async restart(){await app.close();app=createApp({origin:'http://127.0.0.1',...options});await listen()}};
}
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-resume-'))}
test('resumable uploads retain only missing positions across a server restart and publish atomically once',async t=>{
 const dir=temporary(),f=await fixture(t,{database:path.join(dir,'zoigram.sqlite')}),id=crypto.randomUUID();t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-resume-'));fs.rmSync(dir,{recursive:true,force:true})});assert.equal((await f.start(3,id)).status,200);
 assert.equal((await f.put(id,0)).status,200);assert.equal((await f.put(id,2)).status,200);assert.equal((await f.done(id)).status,409);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,0);
 await f.restart();let status=await f.call('GET','/api/uploads/'+id);assert.deepEqual(status.body.received,[0,2]);assert.equal((await f.start(3,id)).status,200);
 assert.equal((await f.put(id,1)).status,200);const done=await Promise.all([f.done(id),f.done(id)]);assert.deepEqual(done.map(x=>x.status),[200,200]);assert.equal(done[0].body.post.id,done[1].body.post.id);assert.equal(done[0].body.post.photos.length,3);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,1);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM post_photos').get().n,2);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);
 status=await f.call('GET','/api/uploads/'+id);assert.equal(status.body.post.id,done[0].body.post.id);assert.equal((await f.call('GET','/api/posts/request/'+id)).body.post.id,done[0].body.post.id);
 for(let i=0;i<3;i++){const image=await f.call('GET',done[0].body.post.photos[i].imageUrl,undefined,null);assert.equal(image.status,200);assert.equal((await sharp(image.body).metadata()).width,96+i*8)}
 assert.equal((await f.put(id,0)).status,409);assert.equal((await f.call('DELETE','/api/uploads/'+id)).status,409);
});
test('upload identity and repeated parts are bound to owner, caption, count, and exact image content',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();await f.start(2,id);const race=await Promise.all([f.put(id,0),f.put(id,0)]);assert.deepEqual(race.map(x=>x.status),[200,200]);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,1);
 assert.equal((await f.put(id,0,f.photos[1])).status,409);assert.equal((await f.start(3,id)).status,409);assert.equal((await f.start(2,id,f.users[0],'changed')).status,409);
 for(const [method,url,body]of [['GET','/api/uploads/'+id],['DELETE','/api/uploads/'+id],['PUT','/api/uploads/'+id+'/0',{imageBase64:f.photos[0].toString('base64')}],['POST','/api/uploads/'+id+'/complete',{}]])assert.equal((await f.call(method,url,body,f.users[1])).status,410);
 assert.equal((await f.start(1,id,f.users[1])).status,200);assert.equal((await f.put(id,0,f.photos[1],f.users[1])).status,200);assert.equal((await f.done(id,f.users[1])).status,200);assert.equal((await f.call('GET','/api/uploads/'+id)).body.post,undefined);
 assert.equal((await f.call('GET','/api/uploads/'+id,undefined,null)).status,401);
});
test('valid photos over the old 8 MiB limit are accepted, while input above 25 MiB is rejected before decoding',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();await f.start(1,id);const large=await sharp({create:{width:1800,height:1800,channels:3,background:'#43aa88'}}).png({compressionLevel:0,adaptiveFiltering:false}).toBuffer();assert(large.length>8*1024*1024);assert(large.length<MAX_INPUT);
 assert.equal((await f.put(id,0,large)).status,200);const stored=f.app.db.prepare('SELECT input_bytes,bytes FROM upload_parts').get();assert.equal(stored.input_bytes,large.length);assert(stored.bytes<large.length);assert.equal((await f.done(id)).status,200);
 const next=crypto.randomUUID();await f.start(1,next);assert.equal((await f.put(next,0,Buffer.alloc(MAX_INPUT+1))).status,413);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);assert.equal((await f.call('GET','/api/info')).body.limits.uploadImageBytes,MAX_INPUT);
});
test('malformed sessions and image input never create a post or partial image',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();for(const count of [0,6,1.5,'2',null])assert.equal((await f.start(count)).status,400);assert.equal((await f.start(1,'short')).status,400);await f.start(1,id);
 for(const imageBase64 of [null,{},'abcd=', 'a'.repeat(16)+'====',Buffer.alloc(100).toString('base64')])assert.equal((await f.call('PUT','/api/uploads/'+id+'/0',{imageBase64})).status,400);
 assert.equal((await f.put(id,1,f.photos[0])).status,400);assert.equal((await f.call('PUT','/api/uploads/'+id+'/0',{},f.users[0],{'Content-Type':'text/plain'})).status,415);assert.equal((await f.done(id)).status,409);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);
});
test('expiry and cancellation release staged bytes, and active sessions have per-owner and global bounds',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();await f.start(1,id);await f.put(id,0);const row=f.app.db.prepare('SELECT * FROM upload_sessions').get();assert(Math.abs(row.expires_at-row.created_at-TTL)<10);f.app.db.prepare('UPDATE upload_sessions SET expires_at=1').run();assert.equal((await f.call('GET','/api/uploads/'+id)).status,410);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);
 const ids=Array.from({length:3},()=>crypto.randomUUID());for(const next of ids)assert.equal((await f.start(1,next)).status,200);assert.equal((await f.start(1)).status,429);await f.put(ids[0],0);assert.equal((await f.call('DELETE','/api/uploads/'+ids[0])).status,200);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);assert.equal((await f.start(1)).status,200);
 const insert=f.app.db.prepare('INSERT INTO upload_sessions(profile_id,request_id,caption,photo_count,created_at,expires_at) VALUES(?,?,?,?,?,?)');for(let i=3;i<300;i++)insert.run(f.users[1].id,'bound_session_'+i,'',1,Date.now(),Date.now()+TTL);
 const third=identity(f.app.db,'test','fresh'),access={...third,...session(f.app.db,third.id)};assert.equal((await f.start(1,crypto.randomUUID(),access)).status,503);
});
test('staged quota is atomic and legacy publications cannot consume reserved media capacity',async t=>{
 const f=await fixture(t,{storageBytes:1024*1024}),id=crypto.randomUUID();await f.start(2,id);const photo=(await Albums.convert([f.photos[0]],fail))[0];
 const seed=Number(f.app.db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.users[1].id,'existing_photo','hash','Existing',Date.now(),64,64,Buffer.from('i'),Buffer.from('t'),1024*1024-photo.bytes).lastInsertRowid);
 assert.equal((await f.put(id,0)).status,200);assert.equal((await f.put(id,1)).status,507);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,1);
 assert.equal((await f.call('POST','/api/posts',{requestId:crypto.randomUUID(),caption:'Do not consume staged reservation',imageBase64:f.photos[0].toString('base64')})).status,507);
 f.app.db.prepare('DELETE FROM posts WHERE id=?').run(seed);assert.equal((await f.put(id,1)).status,200);assert.equal((await f.done(id)).status,200);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);
 const g=await fixture(t,{storageBytes:photo.bytes*3});const small=crypto.randomUUID();await g.start(1,small);assert.equal((await g.put(small,0)).status,507);assert.equal(g.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);
});
test('the shared photo gate bounds concurrent request bodies and recovers after aborted uploads',async t=>{
 const http=require('node:http'),f=await fixture(t),id=crypto.randomUUID(),held=[];await f.start(3,id);
 async function hold(index){const route='/api/uploads/'+id+'/'+index;await new Promise(resolve=>{
  const incoming=req=>{if(req.url===route){f.app.server.off('request',incoming);resolve()}};f.app.server.on('request',incoming);
  const req=http.request({host:'127.0.0.1',port:f.app.server.address().port,path:route,method:'PUT',headers:{Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json','Content-Length':5000}});req.on('error',()=>{});req.on('response',res=>res.resume());held.push(req);req.write('{');
 })}
 try{await hold(0);await hold(1);assert.equal((await f.put(id,2)).status,503);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0)}finally{held.forEach(req=>req.destroy())}
 await new Promise(r=>setTimeout(r,30));assert.equal((await f.put(id,2)).status,200);
});
test('legacy and resumable uploads cannot claim the same pending request identifier',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();await f.start(1,id);await f.put(id,0);const body={requestId:id,caption:'Ordered album',imageBase64:f.photos[0].toString('base64')};
 assert.equal((await f.call('POST','/api/posts',body)).status,409);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,0);assert.equal((await f.done(id)).status,200);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,1);
 const legacyId=crypto.randomUUID();assert.equal((await f.call('POST','/api/posts',{...body,requestId:legacyId})).status,201);assert.equal((await f.start(1,legacyId)).status,409);
});
test('legacy completion rechecks an identifier reserved while image conversion was in flight',async t=>{
 const f=await fixture(t),id=crypto.randomUUID(),convert=Albums.convert;let release,started;
 const entered=new Promise(r=>started=r),continueConversion=new Promise(r=>release=r);Albums.convert=async(...args)=>{started();await continueConversion;return convert(...args)};
 let pending;try{
  pending=f.call('POST','/api/posts',{requestId:id,caption:'Ordered album',imageBase64:f.photos[0].toString('base64')});await entered;assert.equal((await f.start(1,id)).status,200);release();assert.equal((await pending).status,409);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,0);
 }finally{release();Albums.convert=convert;if(pending)await pending}
 assert.equal((await f.put(id,0)).status,200);assert.equal((await f.done(id)).status,200);
});
test('an old photo conversion cannot write into a cancelled and recreated smaller album',async t=>{
 const f=await fixture(t),id=crypto.randomUUID(),convert=Albums.convert;await f.start(2,id);let release,started;
 const entered=new Promise(r=>started=r),continueConversion=new Promise(r=>release=r);Albums.convert=async(...args)=>{started();await continueConversion;return convert(...args)};
 let pending;try{
  pending=f.put(id,1);await entered;assert.equal((await f.call('DELETE','/api/uploads/'+id)).status,200);assert.equal((await f.start(1,id)).status,200);
  release();assert.equal((await pending).status,409);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,0);assert.deepEqual((await f.call('GET','/api/uploads/'+id)).body.received,[]);
 }finally{release();Albums.convert=convert;if(pending)await pending}
 assert.equal((await f.put(id,0)).status,200);const result=await f.done(id);assert.equal(result.status,200);assert.equal(result.body.post.photos.length,1);
});
test('an old completion body cannot publish a cancelled and recreated upload with the same identifier',async t=>{
 const http=require('node:http'),f=await fixture(t),id=crypto.randomUUID(),route='/api/uploads/'+id+'/complete';await f.start(1,id);await f.put(id,0);
 let incomingResolve,client;const incoming=new Promise(r=>incomingResolve=r),onRequest=req=>{if(req.url===route){f.app.server.off('request',onRequest);incomingResolve(req)}};f.app.server.on('request',onRequest);
 const pending=new Promise((resolve,reject)=>{
  client=http.request({host:'127.0.0.1',port:f.app.server.address().port,path:route,method:'POST',headers:{Authorization:'Bearer '+f.users[0].token,'Content-Type':'application/json','Content-Length':2}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}))});
  client.on('error',reject);client.setTimeout(5000,()=>client.destroy(Error('Completion test timed out')));client.write('{');
 });
 try{
  const oldRequest=await incoming;assert.equal((await f.call('GET','/api/uploads/'+id)).status,200);assert.equal(oldRequest.complete,false);assert(oldRequest.listenerCount('readable')>0,'the old handler is waiting for the remaining JSON body');
  assert.equal((await f.call('DELETE','/api/uploads/'+id)).status,200);assert.equal((await f.start(1,id)).status,200);assert.equal((await f.put(id,0,f.photos[1])).status,200);
  client.end('}');assert.equal((await pending).status,409);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n,1);
  const result=await f.done(id);assert.equal(result.status,200);assert.equal(result.body.post.width,104);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,1);
 }finally{f.app.server.off('request',onRequest);client.destroy();await pending.catch(()=>{})}
});
