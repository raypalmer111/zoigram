'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {createApp}=require('../src/app.cjs'),{identity,session,random,hash}=require('../src/store.cjs');
const OWNER='76561198000000001',OTHER='76561198000000002',origin='https://zoigram.example';
async function fixture(t,options={}){
 const app=createApp({database:':memory:',origin,secret:Buffer.alloc(32,7),ownerSteamId:OWNER,...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const owner=identity(app.db,'steam',OWNER),other=identity(app.db,'steam',OTHER),token=random(),adminId=crypto.randomUUID();app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(adminId,hash(token),owner.id,Date.now()+3600000);const cookie='__Host-zoigram_admin='+token;
 const request=(p,options={})=>fetch('http://127.0.0.1:'+app.server.address().port+p,{redirect:'manual',...options});const bootstrap=await(await request('/admin/api/session',{headers:{Cookie:cookie}})).json();
 async function call(p,{body,headers={},method=body?'POST':'GET'}={}){const r=await request(p,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':bootstrap.csrfToken||'',...headers},body:body?JSON.stringify(body):undefined});const data=(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.text();return {status:r.status,data,headers:r.headers}}
 function post(p=other){return Number(app.db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id,random(),'digest','<script>alert(1)</script> 🌆',Date.now(),64,64,Buffer.from('photo'),Buffer.from('thumbnail'),14).lastInsertRowid)}
 return {app,owner,other,cookie,request,call,post,adminId};
}
test('private data never accepts anonymous, game Bearer tokens or other accounts',async t=>{
 const f=await fixture(t),id=f.post(),game=session(f.app.db,f.owner.id);for(const p of ['/admin/api/zoimeet','/admin/api/summary','/admin/api/profiles','/admin/api/posts','/admin/api/comments','/admin/api/reports','/admin/api/audit','/admin/api/media/'+id]){const r=await f.request(p,{headers:{Authorization:'Bearer '+game.token}});assert.equal(r.status,401,p);assert.equal(r.headers.get('access-control-allow-origin'),null);assert(!(await r.text()).includes(f.other.username))}
 const wrong=random();f.app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(random(),hash(wrong),f.other.id,Date.now()+3600000);assert.equal((await f.call('/admin/api/summary',{headers:{Cookie:'__Host-zoigram_admin='+wrong}})).status,401);
 f.app.db.prepare('UPDATE admin_sessions SET expires_at=1 WHERE id=?').run(f.adminId);assert.equal((await f.call('/admin/api/summary')).status,401);
});
test('owner access is explicit, checked on every request and disabled by default',async t=>{
 const f=await fixture(t,{ownerSteamId:''});assert.equal((await f.call('/admin/api/summary')).status,401);assert.equal((await f.request('/admin/auth/password',{method:'POST',headers:{Origin:origin}})).status,503);
 const g=await fixture(t);g.app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(g.owner.id);assert.equal((await g.call('/admin/api/summary')).status,401);
 const h=await fixture(t);h.app.db.prepare('UPDATE profiles SET subject=? WHERE id=?').run('76561198000000009',h.owner.id);assert.equal((await h.call('/admin/api/summary')).status,401);
});
test('CSRF and cross-origin checks prevent mutations and logout does not end the game session',async t=>{
 const f=await fixture(t),game=session(f.app.db,f.owner.id),body={action:'ban',targetId:f.other.id,reason:'Spam'};
 for(const headers of [{'X-CSRF-Token':''},{'X-CSRF-Token':random()},{Origin:'https://evil.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.call('/admin/api/actions',{body,headers})).status,403);
 assert.equal(f.app.db.prepare('SELECT banned FROM profiles WHERE id=?').get(f.other.id).banned,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,0);
 assert.equal((await f.request('/admin/auth/password',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
 const out=await f.call('/admin/api/logout',{method:'POST'});assert.equal(out.status,200);assert.equal((await f.call('/admin/api/summary')).status,401);assert(f.app.db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash(game.token)));
});
test('rename preserves identity and sessions, records the owner, and rejects stale changes',async t=>{
 const f=await fixture(t),game=session(f.app.db,f.other.id),body={action:'set-id',targetId:f.other.id,expectedPublicId:f.other.username,publicId:'new_public_id',reason:'Requested by player',actorId:'forged'};const changed=await f.call('/admin/api/actions',{body});assert.equal(changed.status,200);assert.equal(changed.data.publicId,'new_public_id');assert(f.app.db.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(hash(game.token)));const audit=(await f.call('/admin/api/audit')).data.items[0];assert.equal(audit.actor.id,f.owner.id);assert.equal(audit.details.previousId,f.other.username);assert.equal(audit.reason,body.reason);
 assert.equal((await f.call('/admin/api/actions',{body:{...body,publicId:'another'}})).status,409);assert.equal((await f.call('/admin/api/actions',{body:{...body,expectedPublicId:'new_public_id',publicId:'with space'}})).status,400);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,1);
 assert.equal((await f.call('/admin/api/actions',{body:{action:'ban',targetId:f.owner.id,reason:'Mistake'}})).status,403);
});
test('ban revokes game access and unban restores visibility; unchanged actions do not duplicate audit',async t=>{
 const f=await fixture(t),game=session(f.app.db,f.other.id);f.post();const body={action:'ban',targetId:f.other.id,reason:'Repeated spam'};assert.equal((await f.call('/admin/api/actions',{body})).status,200);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM sessions WHERE profile_id=?').get(f.other.id).n,0);assert.equal((await f.call('/admin/api/actions',{body})).data.changed,false);assert.equal((await f.request('/api/me',{headers:{Authorization:'Bearer '+game.token}})).status,401);
 assert.equal((await f.call('/admin/api/profiles?status=banned')).data.items.length,1);assert.equal((await f.call('/admin/api/actions',{body:{...body,action:'unban'}})).status,200);assert.equal((await f.call('/admin/api/profiles?status=banned')).data.items.length,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,2);
});
test('deleting reported content is atomic, removes media and reactions, and retains audit context',async t=>{
 const f=await fixture(t),id=f.post(),otherPost=f.post();const db=f.app.db;const cid=Number(db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(f.owner.id,id,random(),'A comment',Date.now()).lastInsertRowid);db.prepare('INSERT INTO likes VALUES(?,?)').run(f.owner.id,id);const rid=Number(db.prepare('INSERT INTO reports(profile_id,kind,target_id,reason,created_at) VALUES(?,?,?,?,?)').run(f.owner.id,'post',String(id),'Spam',Date.now()).lastInsertRowid);const body={action:'delete-post',targetId:id,reportId:rid,reason:'Spam confirmed'};
 assert.equal((await f.call('/admin/api/actions',{body:{...body,targetId:otherPost}})).status,409);assert(db.prepare('SELECT 1 FROM posts WHERE id=?').get(otherPost));assert.equal(db.prepare('SELECT COUNT(*) n FROM moderation').get().n,0);
 assert.equal((await f.call('/admin/api/actions',{body})).status,200);assert(!db.prepare('SELECT 1 FROM posts WHERE id=?').get(id));assert(!db.prepare('SELECT 1 FROM comments WHERE id=?').get(cid));assert.equal(db.prepare('SELECT COUNT(*) n FROM likes').get().n,0);assert.equal(db.prepare('SELECT resolved FROM reports WHERE id=?').get(rid).resolved,1);assert.equal((await f.call('/admin/api/media/'+id)).status,404);
 const report=(await f.call('/admin/api/reports?status=closed')).data.items[0];assert.equal(report.target,null);const audit=(await f.call('/admin/api/audit')).data.items[0];assert.equal(audit.details.details.reportId,rid);assert.equal(audit.details.details.profile_id,f.other.id);assert.equal(audit.actor.id,f.owner.id);
 for(const reason of ['', ' ', 'x'.repeat(1001),'two\nlines'])assert.equal((await f.call('/admin/api/actions',{body:{action:'delete-post',targetId:otherPost,reason}})).status,400);assert(db.prepare('SELECT 1 FROM posts WHERE id=?').get(otherPost));
});
test('reports can close and reopen, and lists paginate without dropping equal timestamps',async t=>{
 const f=await fixture(t);for(let i=0;i<28;i++){const p=identity(f.app.db,'test','profile-'+i);f.app.db.prepare('UPDATE profiles SET created_at=1000 WHERE id=?').run(p.id)}const first=(await f.call('/admin/api/profiles')).data;assert.equal(first.items.length,24);assert(first.nextCursor);const second=(await f.call('/admin/api/profiles?before='+first.nextCursor)).data;assert.equal(second.items.length,6);assert.equal(new Set([...first.items,...second.items].map(p=>p.id)).size,30);assert.equal((await f.call('/admin/api/profiles?before=bad')).status,400);
 assert.equal((await f.call('/admin/api/profiles?q='+encodeURIComponent("' OR 1=1 --"))).data.items.length,0);
 const rid=Number(f.app.db.prepare('INSERT INTO reports(profile_id,kind,target_id,reason,created_at) VALUES(?,?,?,?,?)').run(f.owner.id,'profile',f.other.id,'Check account',Date.now()).lastInsertRowid);const body={action:'resolve',targetId:rid,reason:'No violation'};assert.equal((await f.call('/admin/api/actions',{body})).status,200);assert.equal((await f.call('/admin/api/actions',{body})).data.changed,false);assert.equal((await f.call('/admin/api/reports')).data.items.length,0);assert.equal((await f.call('/admin/api/actions',{body:{...body,action:'reopen',reason:'Review again'}})).status,200);assert.equal((await f.call('/admin/api/reports')).data.items.length,1);
});
test('web assets have restrictive CSP and community strings are rendered as text',async t=>{
 const f=await fixture(t);const page=await f.request('/admin/');assert.equal(page.status,200);assert.equal(page.headers.get('x-frame-options'),'DENY');assert(page.headers.get('content-security-policy').includes("script-src 'self'"));assert.equal(page.headers.get('access-control-allow-origin'),null);const source=fs.readFileSync(require('node:path').join(__dirname,'../admin/app.js'),'utf8');new vm.Script(source);assert(!/innerHTML|outerHTML|insertAdjacentHTML|localStorage|document\.cookie|eval\(/.test(source));assert(source.includes('document.createTextNode'));assert(source.includes('node.textContent'));
});


test('ZoiMeet monitor uses owner session, rejects cross-origin access and never mutates community data',async t=>{
 let calls=0;const snapshot={service:'ZoiMeet',serverTime:1000,summary:{online:2},devices:{items:[{code:'ABCDE23456'}]},requests:{items:[]}};
 const f=await fixture(t,{zoimeetMonitor:async query=>{calls++;assert.equal(query.get('q'),'ABCDE');return snapshot;}});
 assert.equal((await f.request('/admin/api/zoimeet?q=ABCDE')).status,401);assert.equal(calls,0);
 const result=await f.call('/admin/api/zoimeet?q=ABCDE');assert.equal(result.status,200);assert.deepEqual(result.data,snapshot);assert.equal(result.headers.get('access-control-allow-origin'),null);
 assert.equal((await f.call('/admin/api/zoimeet?q=ABCDE',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);assert.equal(calls,1);
 assert.equal((await f.call('/admin/api/zoimeet',{method:'POST',body:{action:'delete'}})).status,404);assert.equal(calls,1);assert.equal(f.app.db.prepare('SELECT count(*) n FROM moderation').get().n,0);
});
test('unavailable ZoiMeet does not break the rest of moderation',async t=>{
 const f=await fixture(t,{zoimeetMonitor:async()=>{throw Object.assign(Error('ZoiMeet недоступен'),{status:503});}});assert.equal((await f.call('/admin/api/zoimeet')).status,503);assert.equal((await f.call('/admin/api/summary')).status,200);
});

for(const route of ['/admin/api/actions','/admin/api/announcements']){
 test('a buffered '+route+' request cannot mutate after the moderator session was revoked',async t=>{
  const http=require('node:http'),f=await fixture(t),state=await(await f.request('/admin/api/session',{headers:{Cookie:f.cookie}})).json();
  const data=Buffer.from(JSON.stringify(route.endsWith('/actions')?{action:'ban',targetId:f.other.id,reason:'Stale request'}:{title:'Stale notice',body:'Must not be saved',kind:'info',active:true}));
  let client,entered;const incoming=new Promise(resolve=>entered=resolve),listener=req=>{if(req.url===route){f.app.server.off('request',listener);entered(req)}};f.app.server.on('request',listener);
  const response=new Promise((resolve,reject)=>{client=http.request({host:'127.0.0.1',port:f.app.server.address().port,path:route,method:'POST',headers:{Cookie:f.cookie,Origin:origin,'Content-Type':'application/json','Content-Length':data.length,'X-CSRF-Token':state.csrfToken}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',reject)});client.on('error',reject);client.setTimeout(4000,()=>client.destroy(Error('Admin stale-body test timeout')));client.write(data.subarray(0,data.length-1))});
  try{const old=await incoming;assert.equal(old.complete,false);assert.equal((await f.call('/admin/api/logout',{method:'POST'})).status,200);client.end(data.subarray(data.length-1));assert.equal(await response,401);
   assert.equal(f.app.db.prepare('SELECT banned FROM profiles WHERE id=?').get(f.other.id).banned,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM announcements').get().n,0);
  }finally{f.app.server.off('request',listener);client.destroy();await response.catch(()=>{})}
 });
}
test('banning a player revokes approved device logins as well as existing sessions',async t=>{
 const f=await fixture(t),deviceToken=random(),deviceHash=hash(deviceToken),flowToken=random();
 f.app.db.prepare('INSERT INTO devices(secret_hash,user_code,expires_at,profile_id,consumed) VALUES(?,?,?,?,0)').run(deviceHash,'A12345B678',Date.now()+60000,f.other.id);
 f.app.db.prepare('INSERT INTO account_flows VALUES(?,?,?,?,?)').run(hash(flowToken),'device',deviceHash,null,Date.now()+60000);
 const body={action:'ban',targetId:f.other.id,reason:'Revoke all sign-in permissions'};assert.equal((await f.call('/admin/api/actions',{body})).status,200);
 assert.equal((await f.call('/admin/api/actions',{body:{...body,action:'unban'}})).status,200);
 const poll=await f.request('/api/auth/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceToken})});assert.equal(poll.status,410);await poll.arrayBuffer();
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM devices WHERE secret_hash=?').get(deviceHash).n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM account_flows WHERE token_hash=?').get(hash(flowToken)).n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM sessions WHERE profile_id=?').get(f.other.id).n,0);
});
