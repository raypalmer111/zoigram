'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),sharp=require('sharp');
const {createApp}=require('../src/app.cjs'),{identity,session}=require('../src/store.cjs');
async function fixture(t){
 const errors=[],app=createApp({database:':memory:',origin:'http://127.0.0.1',onError:e=>errors.push(e)}),held=[];
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{for(const req of held)req.destroy();app.server.closeAllConnections();await app.close()});
 const port=app.server.address().port,users=['alice','bob'].map(n=>{const p=identity(app.db,'test',n);return {...p,...session(app.db,p.id)}});
 async function call(method,route,body,user=users[0]){const r=await fetch('http://127.0.0.1:'+port+route,{method,headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
 async function pause(method,route,body,user=users[0]){
  const id=crypto.randomUUID(),bytes=Buffer.from(JSON.stringify(body));let ready,finish;
  const incoming=new Promise(r=>ready=r),outcome=new Promise(r=>finish=r);
  const listener=req=>{if(req.headers['x-test-id']===id){app.server.off('request',listener);if(req.listenerCount('data'))setImmediate(ready);else{const attached=event=>{if(event==='data'){req.off('newListener',attached);setImmediate(ready)}};req.on('newListener',attached);}}};app.server.on('request',listener);
  const req=http.request({host:'127.0.0.1',port,method,path:route,headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json','Content-Length':bytes.length,'X-Test-Id':id}},res=>{let text='';res.setEncoding('utf8');res.on('data',s=>text+=s);res.on('end',()=>finish({status:res.statusCode,body:JSON.parse(text)}));});
  held.push(req);req.on('error',error=>finish({error}));req.setTimeout(3000,()=>req.destroy(Error('test request timed out')));req.write(bytes.subarray(0,1));await incoming;
  return async()=>{req.end(bytes.subarray(1));return outcome};
 }
 async function post(){const photo=await sharp({create:{width:80,height:80,channels:3,background:'#559988'}}).png().toBuffer();const r=await call('POST','/api/posts',{requestId:crypto.randomUUID(),imageBase64:photo.toString('base64'),caption:'fixture'});assert.equal(r.status,201);return r.body.post;}
 return {app,users,errors,call,pause,post};
}
test('a profile edit held in transit cannot complete after its game session is revoked',async t=>{
 const f=await fixture(t),before=f.app.db.prepare('SELECT display_name FROM profiles WHERE id=?').get(f.users[0].id).display_name;
 const finish=await f.pause('PATCH','/api/me',{displayName:'stale update',bio:''});assert.equal((await f.call('DELETE','/api/session')).status,200);
 assert.equal((await finish()).status,401);assert.equal(f.app.db.prepare('SELECT display_name FROM profiles WHERE id=?').get(f.users[0].id).display_name,before);assert.deepEqual(f.errors,[]);
});
test('a profile edit held in transit cannot complete after its account is banned',async t=>{
 const f=await fixture(t),finish=await f.pause('PATCH','/api/me',{displayName:'stale update',bio:''});f.app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(f.users[0].id);
 assert.equal((await finish()).status,401);assert.notEqual(f.app.db.prepare('SELECT display_name FROM profiles WHERE id=?').get(f.users[0].id).display_name,'stale update');assert.deepEqual(f.errors,[]);
});
for(const change of ['block','ban'])test('a message held in transit respects a recipient '+change,async t=>{
 const f=await fixture(t),[sender,recipient]=f.users,finish=await f.pause('POST','/api/conversations/'+recipient.id+'/messages',{requestId:crypto.randomUUID(),text:'must not arrive'});
 if(change==='block')assert.equal((await f.call('PUT','/api/profiles/'+sender.id+'/block',{},recipient)).status,200);else f.app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(recipient.id);
 assert.equal((await finish()).status,404);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM direct_messages').get().n,0);assert.deepEqual(f.errors,[]);
});
for(const change of ['delete','block'])test('a comment held in transit respects post '+change+' without an internal error',async t=>{
 const f=await fixture(t),post=await f.post(),finish=await f.pause('POST','/api/posts/'+post.id+'/comments',{requestId:crypto.randomUUID(),text:'must not arrive'},f.users[1]);
 if(change==='delete')assert.equal((await f.call('DELETE','/api/posts/'+post.id)).status,200);else assert.equal((await f.call('PUT','/api/profiles/'+f.users[1].id+'/block',{})).status,200);
 assert.equal((await finish()).status,404);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM comments').get().n,0);assert.deepEqual(f.errors,[]);
});
test('a report held in transit cannot complete after logout',async t=>{
 const f=await fixture(t),finish=await f.pause('POST','/api/reports',{kind:'profile',targetId:f.users[1].id,reason:'test'});await f.call('DELETE','/api/session');
 assert.equal((await finish()).status,401);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM reports').get().n,0);assert.deepEqual(f.errors,[]);
});
