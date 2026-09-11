'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApp}=require('../src/app.cjs'),{identity,session,random,hash}=require('../src/store.cjs');
const origin='https://zoigram.example';
async function fixture(t){
 const app=createApp({database:':memory:',origin,ownerSteamId:'76561198000000001'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const owner=identity(app.db,'steam','76561198000000001'),player=identity(app.db,'local','player'),viewer=identity(app.db,'local','viewer'),access=session(app.db,viewer.id),playerAccess=session(app.db,player.id),token=random();app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(crypto.randomUUID(),hash(token),owner.id,Date.now()+3600000);
 const cookie='__Host-zoigram_admin='+token,base='http://127.0.0.1:'+app.server.address().port,request=(p,o={})=>fetch(base+p,{...o,headers:{'Accept-Language':'en',...o.headers}}),csrf=(await(await request('/admin/api/session',{headers:{Cookie:cookie}})).json()).csrfToken;
 const call=(body,headers={})=>request('/admin/api/actions',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json',...headers},body:JSON.stringify({reason:'Owner test decision',...body})});
 const pub=async p=>{const r=await request(p,{headers:{Authorization:'Bearer '+access.token}});assert.equal(r.status,200);return r.json()};
 const post=Number(app.db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(player.id,random(),'test','Photo',Date.now(),16,16,Buffer.from('image'),Buffer.from('thumb'),10).lastInsertRowid);
 return {app,owner,player,viewer,access,playerAccess,request,call,pub,post,cookie};
}
function privateFieldsAbsent(data){const text=JSON.stringify(data);for(const key of ['bonusLikes','realLikes','likeBonusRevision','verificationRevision','actorId'])assert(!text.includes('"'+key+'"'),key+' leaked to players')}
test('only owner can grant verification, revoke it and audit the real actor without changing identity',async t=>{
 const f=await fixture(t),body={action:'set-verified',targetId:f.player.id,verified:true,expectedRevision:0,actorId:f.player.id};
 assert.equal((await f.pub('/api/profiles/'+f.player.id)).profile.verified,false);
 for(const headers of [{Cookie:''},{Cookie:'',Authorization:'Bearer '+f.playerAccess.token},{Origin:'https://evil.example'},{'X-CSRF-Token':''}])assert([401,403].includes((await f.call(body,headers)).status));
 assert.equal((await f.call(body)).status,200);let p=(await f.pub('/api/profiles/'+f.player.id)).profile;assert.equal(p.verified,true);assert.equal(p.username,f.player.username);privateFieldsAbsent(p);
 const feed=await f.pub('/api/feed');assert.equal(feed.posts[0].author.verified,true);privateFieldsAbsent(feed);
 assert.equal((await f.call(body)).status,409);assert.equal((await f.call({...body,verified:false,expectedRevision:1})).status,200);assert.equal((await f.pub('/api/profiles/'+f.player.id)).profile.verified,false);
 const rows=f.app.db.prepare('SELECT * FROM moderation ORDER BY id').all();assert.equal(rows.length,2);assert.equal(JSON.parse(rows[0].reason).actorId,f.owner.id);
 const forged=await f.request('/api/me',{method:'PATCH',headers:{Authorization:'Bearer '+f.playerAccess.token,'Content-Type':'application/json'},body:JSON.stringify({displayName:'Own name',bio:'',verified:true,verificationRevision:99})});assert([200,400,403].includes(forged.status));assert.equal((await f.pub('/api/profiles/'+f.player.id)).profile.verified,false);
});
test('five owner likes add to actual reactions, cannot be double-applied, and never invent people or notifications',async t=>{
 const f=await fixture(t),db=f.app.db;db.prepare('INSERT INTO likes VALUES(?,?)').run(f.viewer.id,f.post);db.prepare('INSERT INTO likes VALUES(?,?)').run(f.owner.id,f.post);
 const profiles=db.prepare('SELECT count(*) n FROM profiles').get().n,body={action:'set-like-bonus',targetId:f.post,bonusLikes:5,expectedRevision:0};
 assert.equal((await f.call(body,{Cookie:'',Authorization:'Bearer '+f.access.token})).status,401);assert.equal((await f.call(body)).status,200);assert.equal((await f.call(body)).status,409);
 let post=(await f.pub('/api/posts/'+f.post)).post;assert.equal(post.likes,7);assert.equal(post.liked,true);privateFieldsAbsent(post);assert.equal(db.prepare('SELECT count(*) n FROM likes').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM profiles').get().n,profiles);
 const unlike=await f.request('/api/posts/'+f.post+'/like',{method:'DELETE',headers:{Authorization:'Bearer '+f.access.token}});assert.equal(unlike.status,200);post=(await unlike.json()).post;assert.equal(post.likes,6);assert.equal(post.liked,false);privateFieldsAbsent(post);
 assert.equal((await f.call({...body,bonusLikes:0,expectedRevision:1})).status,200);assert.equal((await f.pub('/api/posts/'+f.post)).post.likes,1);assert.equal(db.prepare('SELECT count(*) n FROM likes').get().n,1);
 const admin=await(await f.request('/admin/api/posts/'+f.post,{headers:{Cookie:f.cookie}})).json();assert.equal(admin.bonusLikes,0);assert.equal(admin.realLikes,1);assert.equal(admin.likeBonusRevision,2);
 const audit=JSON.parse(db.prepare("SELECT reason FROM moderation WHERE action='set-like-bonus' ORDER BY id LIMIT 1").get().reason);assert.deepEqual(audit.details,{previous:0,bonusLikes:5,delta:5});
});
test('validation and concurrent owner requests prevent stale or invalid assignments',async t=>{
 const f=await fixture(t),body={action:'set-like-bonus',targetId:f.post,bonusLikes:5,expectedRevision:0};
 for(const bonusLikes of [-1,1.5,1000001,'5',null,true])assert.equal((await f.call({...body,bonusLikes})).status,400);
 for(const expectedRevision of [-1,0.5,'0',null])assert.equal((await f.call({...body,expectedRevision})).status,400);
 assert.equal((await f.call({...body,reason:''})).status,400);assert.equal((await f.call({...body,targetId:999999})).status,404);
 assert.equal((await f.call({action:'set-verified',targetId:f.player.id,verified:'true',expectedRevision:0})).status,400);
 const results=await Promise.all([f.call(body),f.call({...body,bonusLikes:10})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert([5,10].includes((await f.pub('/api/posts/'+f.post)).post.likes));assert.equal(f.app.db.prepare('SELECT count(*) n FROM moderation').get().n,1);
});
test('metadata follows deletion and banned reactions are excluded from the displayed total',async t=>{
 const f=await fixture(t),db=f.app.db;db.prepare('INSERT INTO likes VALUES(?,?)').run(f.viewer.id,f.post);await f.call({action:'set-like-bonus',targetId:f.post,bonusLikes:5,expectedRevision:0});
 db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(f.viewer.id);const other=session(db,f.owner.id),r=await f.request('/api/posts/'+f.post,{headers:{Authorization:'Bearer '+other.token}});assert.equal((await r.json()).post.likes,5);
 await f.call({action:'delete-post',targetId:f.post});assert.equal(db.prepare('SELECT count(*) n FROM post_like_bonuses').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM likes').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM moderation').get().n,2);
});
