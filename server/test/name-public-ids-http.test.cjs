'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp');
const {createApp}=require('../src/app.cjs'),{identity,session}=require('../src/store.cjs'),{setPublicId}=require('../src/moderation.cjs');
async function fixture(t){
 const app=createApp({database:':memory:',origin:'http://127.0.0.1'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const people=['a','b','viewer'].map(name=>{const p=identity(app.db,'test',name);return {...p,...session(app.db,p.id)}}),base='http://127.0.0.1:'+app.server.address().port;
 async function call(who,method,path,body){const res=await fetch(base+path,{method,headers:{Authorization:'Bearer '+who.token,'Content-Type':'application/json','X-Zoigram-Features':'mention-notifications'},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,body:await res.json()};}
 const rename=(who,name,bio='')=>call(who,'PATCH','/api/me',{displayName:name,bio});
 return {app,people,call,rename};
}
test('HTTP profile names produce Unicode handles, atomic collision suffixes, and searchable former IDs',async t=>{
 const f=await fixture(t),[a,b,viewer]=f.people;
 const changes=await Promise.all([f.rename(a,'Élise Lee ✨'),f.rename(b,'Élise Lee ✨')]);
 for(const response of changes)assert.equal(response.status,200);
 assert.deepEqual(changes.map(r=>r.body.profile.username).sort(),['élise_lee','élise_lee_2']);
 assert.equal(changes[0].body.profile.id,a.id);assert.equal(changes[1].body.profile.id,b.id);
 const renamed=await f.rename(a,'Анна Ли ♥');assert.equal(renamed.body.profile.username,'анна_ли');
 for(const old of [a.username,changes[0].body.profile.username]){
  const found=await f.call(viewer,'GET','/api/profiles/search?q='+encodeURIComponent('@'+old));assert.equal(found.status,200);assert(found.body.profiles.some(p=>p.id===a.id&&p.username==='анна_ли'));
 }
 const other=await f.rename(viewer,'Élise Lee ✨');assert(!changes.map(r=>r.body.profile.username).includes(other.body.profile.username),'A retired ID cannot move to another account');
 const features=(await f.call(a,'GET','/api/info')).body.features;assert.equal(features.nameBasedIds,true);assert.equal(features.creatorGrants,true);assert.equal(features.creatorPower,true);
});
test('bio-only saves keep moderator overrides and a changed name keeps the same account, posts and messages',async t=>{
 const f=await fixture(t),[a,b]=f.people;await f.rename(a,'Alice');setPublicId(f.app.db,a.id,'Chosen Handle','Requested by member');
 const image=await sharp({create:{width:64,height:64,channels:3,background:'#abc'}}).png().toBuffer();
 const post=await f.call(a,'POST','/api/posts',{requestId:crypto.randomUUID(),caption:'Keep me',imageBase64:image.toString('base64')});assert.equal(post.status,201);
 await f.call(a,'POST','/api/conversations/'+b.id+'/messages',{requestId:crypto.randomUUID(),text:'Keep this thread'});
 const bio=await f.rename(a,'Alice','Updated biography');assert.equal(bio.body.profile.username,'chosen_handle');
 const changed=await f.rename(a,'한 별!');assert.equal(changed.status,200);assert.equal(changed.body.profile.username,'한_별');assert.equal(changed.body.profile.id,a.id);
 const saved=(await f.call(b,'GET','/api/posts/'+post.body.post.id)).body.post;assert.equal(saved.author.id,a.id);assert.equal(saved.author.username,'한_별');
 const messages=(await f.call(b,'GET','/api/conversations/'+a.id+'/messages')).body;assert.equal(messages.messages[0].text,'Keep this thread');assert.equal(messages.participant.username,'한_별');
 const forged=await f.call(a,'PATCH','/api/me',{displayName:'Changed',username:'somebody_else'});assert.equal(forged.status,403);
 assert.equal((await f.call(a,'GET','/api/me')).body.profile.username,'한_별');
});
test('old and new Unicode mentions reach one immutable account, and alias search respects blocks and bans',async t=>{
 const f=await fixture(t),[target,author,viewer]=f.people;await f.rename(target,'小 明');await f.rename(target,'李');
 const image=await sharp({create:{width:64,height:64,channels:3,background:'#cba'}}).png().toBuffer();
 const post=await f.call(author,'POST','/api/posts',{requestId:crypto.randomUUID(),caption:'@小_明 @李 @'+target.username,imageBase64:image.toString('base64')});assert.equal(post.status,201);
 const inbox=await f.call(target,'GET','/api/notifications');assert.equal(inbox.body.notifications.length,1);assert.equal(inbox.body.notifications[0].kind,'mention');
 await f.call(viewer,'PUT','/api/profiles/'+target.id+'/block',{});
 assert.equal((await f.call(viewer,'GET','/api/profiles/search?q='+encodeURIComponent('@小_明'))).body.profiles.length,0);
 f.app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(target.id);
 assert.equal((await f.call(author,'GET','/api/profiles/search?q='+target.username)).body.profiles.length,0);
});
