'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {createApp}=require('../src/app.cjs'),{identity,session}=require('../src/store.cjs');
test('a malformed absolute request URL returns 400 without terminating the server',async t=>{
 const script=`const {createApp}=require(${JSON.stringify(require.resolve('../src/app.cjs'))});const app=createApp({database:':memory:',origin:'http://127.0.0.1'});app.server.listen(0,'127.0.0.1',()=>process.send(app.server.address().port));`;
 const child=spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',b=>stderr+=b);
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done}});
 const port=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(Error(stderr)))});
 const result=await new Promise(resolve=>{const req=http.request({host:'127.0.0.1',port,path:'http://[',method:'GET'},res=>{res.resume();res.once('end',()=>resolve({status:res.statusCode}))});req.once('error',error=>resolve({error:error.code}));req.setTimeout(3000,()=>req.destroy());req.end()});
 assert.equal(result.status,400,'Malformed URL must be rejected, not crash the process: '+JSON.stringify(result)+' '+stderr);
 const health=await fetch('http://127.0.0.1:'+port+'/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
});
test('media links reject Unicode signatures and record distinct safe failure reasons',async t=>{
 const errors=[],secret=Buffer.alloc(32,19),app=createApp({database:':memory:',origin:'http://127.0.0.1',secret,onError:e=>errors.push(e)});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;
 const user=identity(app.db,'test','media'),access=session(app.db,user.id),sid=app.db.prepare('SELECT id FROM sessions WHERE profile_id=?').get(user.id).id;
 const grant=values=>{const payload=Buffer.from(JSON.stringify({p:1,s:sid,e:Date.now()+60000,...values})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url')};
 const request=async value=>{const r=await fetch(base+'/api/media/1?grant='+encodeURIComponent(value));await r.text();return r.status};
 const valid=grant({});assert.equal(await request(valid.split('.')[0]+'.'+'é'.repeat(43)),403);assert.deepEqual(errors,[]);
 assert.equal(await request(grant({e:Date.now()-1})),403);
 app.db.prepare('DELETE FROM sessions WHERE profile_id=?').run(user.id);assert.equal(await request(valid),403);
 assert.deepEqual(app.db.prepare('SELECT code FROM operational_errors ORDER BY id').all().map(r=>r.code),['media_invalid','media_expired','media_session_ended']);
 assert.deepEqual(errors,[]);assert.equal(access.token.length,43);
});
