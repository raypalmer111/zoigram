'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApp}=require('../src/app.cjs'),{openStore,identity,session,hash,random}=require('../src/store.cjs');
const origin='https://zoigram.example',steamOwner='76561198000000001';
async function fixture(t,{configured=true,legacyOwner=false}={}){
 const db=openStore(':memory:'),owner=identity(db,'steam',steamOwner),player=identity(db,'local','creator-test-player'),viewer=identity(db,'local','creator-test-viewer');
 db.prepare('UPDATE profiles SET username=?,display_name=? WHERE id=?').run('raypalmer','Ray Palmer',owner.id);
 const users=[owner,player,viewer].map(p=>({...p,...session(db,p.id)})),errors=[];
 const options={db,origin,ownerProfileId:configured?owner.id:'',ownerSteamId:legacyOwner?steamOwner:'',onError:error=>errors.push(error)},app=createApp(options);
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await app.close();db.close();assert.deepEqual(errors,[])});
 const base='http://127.0.0.1:'+app.server.address().port;
 async function call(method,route,body,user=users[2],headers={}){const res=await fetch(base+route,{method,headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json()}}
 async function get(route,user){const result=await call('GET',route,undefined,user);assert.equal(result.status,200,route);return result.body}
 const adminToken=random();db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(crypto.randomUUID(),hash(adminToken),owner.id,Date.now()+3600000);const cookie='__Host-zoigram_admin='+adminToken;
 const adminState=await get('/admin/api/session',users[0],{Cookie:cookie});
 // Admin cookie authentication is deliberately separate from the game bearer.
 const admin=async(method,route,body)=>{const state=await call('GET','/admin/api/session',undefined,users[0],{Cookie:cookie});return call(method,route,body,users[0],{Cookie:cookie,Origin:origin,'X-CSRF-Token':state.body.csrfToken||''})};
 const post=user=>Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(user.id,random(),'fixture','Creator badge fixture',Date.now(),64,64,Buffer.from('image'),Buffer.from('thumb'),10).lastInsertRowid);
 return {app,db,options,owner:users[0],player:users[1],viewer:users[2],get,call,admin,post};
}
function flag(profile,value){assert.equal(profile.creator,value);assert.equal(typeof profile.creator,'boolean');assert.equal(typeof profile.verified,'boolean')}

test('Creator is exclusive to configured OWNER_PROFILE_ID and is independent of normal verification',async t=>{
 const f=await fixture(t);flag((await f.get('/api/me',f.owner)).profile,true);flag((await f.get('/api/profiles/'+f.owner.id)).profile,true);flag((await f.get('/api/profiles/'+f.player.id)).profile,false);
 assert.equal((await f.admin('POST','/admin/api/actions',{action:'set-verified',targetId:f.player.id,verified:true,expectedRevision:0,reason:'Verification is independent'})).status,200);
 const player=(await f.get('/api/profiles/'+f.player.id)).profile;flag(player,false);assert.equal(player.verified,true);assert.equal((await f.get('/api/profiles/'+f.owner.id)).profile.verified,false);
 const adminOwner=(await f.admin('GET','/admin/api/profiles/'+f.owner.id)).body;flag(adminOwner,true);assert.equal(adminOwner.isOwner,true);flag((await f.admin('GET','/admin/api/profiles/'+f.player.id)).body,false);
 const state=(await f.admin('GET','/admin/api/session')).body;assert.equal(state.owner.creator,true);
 assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,10);
});

test('all shared public profile shapes carry the creator flag, including login and social lists',async t=>{
 const f=await fixture(t),ownerPost=f.post(f.owner),playerPost=f.post(f.player);
 f.db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(f.owner.id,playerPost,random(),'Creator comment',Date.now());
 f.db.prepare('INSERT INTO notifications(profile_id,actor_id,kind,created_at) VALUES(?,?,?,?)').run(f.viewer.id,f.owner.id,'follow',Date.now());
 f.db.prepare('INSERT INTO direct_messages(sender_id,recipient_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(f.owner.id,f.viewer.id,random(),'Creator message',Date.now());
 f.db.prepare('INSERT INTO follows VALUES(?,?,?)').run(f.viewer.id,f.owner.id,Date.now());
 f.db.prepare('INSERT INTO bookmarks(profile_id,post_id,created_at) VALUES(?,?,?)').run(f.viewer.id,ownerPost,Date.now());
 const feed=await f.get('/api/feed');flag(feed.posts.find(p=>p.id===ownerPost).author,true);flag(feed.posts.find(p=>p.id===playerPost).author,false);
 flag((await f.get('/api/feed?scope=following')).posts[0].author,true);flag((await f.get('/api/posts/'+ownerPost)).post.author,true);flag((await f.get('/api/saved')).posts[0].author,true);
 const comments=await f.get('/api/posts/'+playerPost+'/comments');flag(comments.comments[0].author,true);flag(comments.post.author,false);
 flag((await f.get('/api/notifications')).notifications[0].actor,true);flag((await f.get('/api/conversations')).conversations[0].participant,true);flag((await f.get('/api/conversations/'+f.owner.id+'/messages')).participant,true);
 flag((await f.get('/api/profiles/search?q=raypalmer')).profiles[0],true);flag((await f.get('/api/profiles/'+f.viewer.id+'/following')).profiles[0],true);
 const deviceToken=random();f.db.prepare('INSERT INTO devices(secret_hash,user_code,expires_at,profile_id,consumed) VALUES(?,?,?,?,0)').run(hash(deviceToken),'ABC123DEF4',Date.now()+60000,f.owner.id);
 const poll=await f.call('POST','/api/auth/poll',{deviceToken});assert.equal(poll.status,200);flag(poll.body.profile,true);
 assert.equal((await f.call('PUT','/api/profiles/'+f.owner.id+'/block',{})).status,200);flag((await f.get('/api/blocks')).profiles[0],true);
});

test('Creator survives a public ID rename and cannot move to a matching username or client-supplied flag',async t=>{
 const f=await fixture(t);
 assert.equal((await f.admin('POST','/admin/api/actions',{action:'set-id',targetId:f.owner.id,expectedPublicId:'raypalmer',publicId:'renamed_author',reason:'Rename keeps immutable identity'})).status,200);
 assert.equal((await f.admin('POST','/admin/api/actions',{action:'set-id',targetId:f.player.id,expectedPublicId:f.player.username,publicId:'raypalmer',reason:'Username does not confer creator role'})).status,200);
 flag((await f.get('/api/profiles/'+f.owner.id)).profile,true);const player=(await f.get('/api/profiles/'+f.player.id)).profile;flag(player,false);assert.equal(player.username,'raypalmer');
 const forged=await f.call('PATCH','/api/me',{displayName:'Creator of Zoigram',bio:'Test',creator:true,isCreator:true,ownerProfileId:f.player.id},f.player);assert.equal(forged.status,200);flag(forged.body.profile,false);
 const hidden=await f.call('PATCH','/api/me',{displayName:'Owner',bio:'Test',creator:false},f.owner);assert.equal(hidden.status,200);flag(hidden.body.profile,true);
 assert.equal((await f.admin('POST','/admin/api/actions',{action:'set-creator',targetId:f.player.id,creator:true,reason:'Unsupported arbitrary assignment'})).status,400);
 f.options.ownerProfileId=f.player.id;flag((await f.get('/api/profiles/'+f.owner.id)).profile,true);flag((await f.get('/api/profiles/'+f.player.id)).profile,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM profile_verifications').get().n,0);
});

for(const legacyOwner of [false,true])test('missing OWNER_PROFILE_ID grants no Creator badge'+(legacyOwner?' even to a legacy Steam moderator':''),async t=>{
 const f=await fixture(t,{configured:false,legacyOwner});flag((await f.get('/api/me',f.owner)).profile,false);flag((await f.get('/api/profiles/'+f.player.id)).profile,false);flag((await f.get('/api/profiles/search?q=raypalmer')).profiles[0],false);
 if(legacyOwner){const profile=(await f.admin('GET','/admin/api/profiles/'+f.owner.id)).body;assert.equal(profile.isOwner,true);flag(profile,false);assert.equal((await f.admin('GET','/admin/api/session')).body.owner.creator,false)}
});
