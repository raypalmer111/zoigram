'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApp}=require('../src/app.cjs'),{openStore,identity,session,hash,random}=require('../src/store.cjs');
const Metadata=require('../src/social-metadata.cjs');
const origin='https://zoigram.example';

async function fixture(t){
 const db=openStore(':memory:'),profiles=['owner','creator','player'].map(name=>identity(db,'local','creator-grants-'+name)),errors=[];
 const users=profiles.map(p=>({...p,...session(db,p.id)})),[owner,creator,player]=users;
 const options={db,origin,ownerProfileId:owner.id,onError:e=>errors.push(e)},app=createApp(options);
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await app.close();db.close();assert.deepEqual(errors,[])});
 const base='http://127.0.0.1:'+app.server.address().port;
 async function call(method,route,body,user=player,headers={}){
  const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 }
 async function adminSession(user){
  const token=random(),id=crypto.randomUUID();db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(id,hash(token),user.id,Date.now()+3600000);
  const cookie='__Host-zoigram_admin='+token,state=await call('GET','/admin/api/session',undefined,user,{Cookie:cookie});
  return {id,cookie,headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':state.body.csrfToken||''},state:state.body};
 }
 const admin=await adminSession(owner);
 const action=(body,headers={})=>call('POST','/admin/api/actions',body,owner,{...admin.headers,...headers});
 const set=(value,expectedRevision,target=creator.id)=>({action:'set-creator',targetId:target,creator:value,expectedRevision,reason:'Creator role decision'});
 const profile=async id=>{const r=await call('GET','/admin/api/profiles/'+id,undefined,owner,admin.headers);assert.equal(r.status,200);return r.body};
 return {db,app,options,owner,creator,player,admin,adminSession,call,action,set,profile};
}

test('owner grants and revokes Creator by immutable UUID, with revisions and audited idempotence',async t=>{
 const f=await fixture(t),owner=await f.profile(f.owner.id);
 assert.deepEqual({creator:owner.creator,creatorRevision:owner.creatorRevision,creatorSource:owner.creatorSource},{creator:true,creatorRevision:0,creatorSource:'owner'});
 assert.equal(f.admin.state.canManageCreators,true);
 assert.deepEqual((await f.action(f.set(true,0))).body,{ok:true,changed:true});
 let p=await f.profile(f.creator.id);assert.equal(p.creator,true);assert.equal(p.creatorSource,'grant');assert.equal(p.creatorRevision,1);assert.equal(p.verified,false);assert.equal(p.isOwner,false);
 assert.deepEqual((await f.action(f.set(true,1))).body,{ok:true,changed:false});
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM moderation WHERE action='set-creator'").get().n,1);
 const before=f.db.prepare("SELECT * FROM moderation WHERE action='set-creator'").get(),audit=JSON.parse(before.reason);
 assert.equal(audit.actorId,f.owner.id);assert.equal(audit.details.creator,true);assert.equal(audit.details.previous,false);assert.equal(audit.details.revision,1);
 const publicProfile=await f.call('GET','/api/profiles/'+f.creator.id);assert.equal(publicProfile.status,200);assert.equal(publicProfile.body.profile.creator,true);
 const renamed=await f.call('PATCH','/api/me',{displayName:'Chosen Creator Name',bio:'Role stays on this account'},f.creator);assert.equal(renamed.status,200);assert.equal(renamed.body.profile.creator,true);
 assert.equal((await f.action(f.set(false,1))).status,200);
 p=await f.profile(f.creator.id);assert.equal(p.creator,false);assert.equal(p.creatorRevision,2);assert.equal(p.creatorSource,null);
 assert.equal((await f.call('GET','/api/me',undefined,f.creator)).body.profile.creator,false);
 assert.deepEqual((await f.action(f.set(false,2))).body,{ok:true,changed:false});
 assert.equal((await f.action(f.set(true,1))).status,409);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM moderation WHERE action='set-creator'").get().n,2);
 assert.equal((await f.action(f.set(true,2))).status,200);assert.equal((await f.profile(f.creator.id)).creatorRevision,3);
});

test('a granted Creator remains a player and cannot grant roles or enter the owner panel',async t=>{
 const f=await fixture(t);assert.equal((await f.action(f.set(true,0))).status,200);
 const own=await f.adminSession(f.creator),other=await f.adminSession(f.player);
 assert.equal(own.state.authenticated,false);assert.equal(other.state.authenticated,false);
 for(const user of [f.creator,f.player]){
  const forged=await f.call('POST','/admin/api/actions',{...f.set(true,0,f.player.id),actorId:f.owner.id,ownerProfileId:f.owner.id},user,{Origin:origin});assert.equal(forged.status,401);
 }
 for(const access of [own,other]){
  assert.equal((await f.call('GET','/admin/api/profiles',undefined,f.creator,access.headers)).status,401);
  assert.equal((await f.call('POST','/admin/api/actions',f.set(true,0,f.player.id),f.creator,access.headers)).status,401);
 }
 const forged=await f.call('PATCH','/api/me',{displayName:'Forged creator',bio:'No grant',creator:true,isCreator:true,creatorRevision:100,creatorSource:'owner',isOwner:true,ownerProfileId:f.player.id},f.player);
 assert.equal(forged.status,200);assert.equal(forged.body.profile.creator,false);assert.equal(Metadata.creator(f.db,f.player.id,f.owner.id).creator,false);
 const ownRevoke=await f.call('PATCH','/api/me',{displayName:'Chosen Creator',bio:'Cannot self-edit role',creator:false,creatorRevision:0,creatorSource:null},f.creator);
 assert.equal(ownRevoke.status,200);assert.equal(ownRevoke.body.profile.creator,true);
 assert.equal((await f.action({action:'set-verified',targetId:f.player.id,verified:true,expectedRevision:0,reason:'Independent verification'})).status,200);
 const player=await f.profile(f.player.id);assert.equal(player.verified,true);assert.equal(player.creator,false);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM moderation WHERE action='set-creator'").get().n,1);
});

test('Creator changes require owner CSRF, a current revision and valid explicit status',async t=>{
 const f=await fixture(t),body=f.set(true,0);
 for(const headers of [{'X-CSRF-Token':''},{'X-CSRF-Token':random()},{Origin:'https://wrong.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.action(body,headers)).status,403);
 for(const change of [{creator:1},{creator:'true'},{expectedRevision:-1},{expectedRevision:'0'},{expectedRevision:undefined},{reason:''},{reason:'a\nb'},{targetId:'not-a-uuid'}])assert.equal((await f.action({...body,...change})).status,400);
 assert.equal((await f.action({...body,targetId:crypto.randomUUID()})).status,404);
 for(const value of [true,false])assert.equal((await f.action(f.set(value,0,f.owner.id))).status,403);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM creator_grants').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,0);
 f.db.prepare('DELETE FROM admin_sessions WHERE id=?').run(f.admin.id);
 assert.equal((await f.action(body)).status,401);assert.equal(Metadata.creator(f.db,f.creator.id,f.owner.id).creator,false);
});

test('concurrent stale grant and revoke submissions cannot overwrite a newer decision',async t=>{
 const f=await fixture(t);
 let result=await Promise.all([f.action(f.set(true,0)),f.action(f.set(true,0))]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 result=await Promise.all([f.action(f.set(false,1)),f.action(f.set(false,1))]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 assert.deepEqual(Metadata.creator(f.db,f.creator.id,f.owner.id),{creator:false,creatorRevision:2,creatorSource:null});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,2);
});

test('the captured owner UUID cannot be replaced with a request body or mutable options object',async t=>{
 const f=await fixture(t);f.options.ownerProfileId=f.player.id;
 assert.equal((await f.action({...f.set(true,0),ownerProfileId:f.creator.id,actorId:f.player.id})).status,200);
 assert.equal((await f.profile(f.owner.id)).isOwner,true);assert.equal((await f.profile(f.owner.id)).creatorSource,'owner');
 assert.equal((await f.profile(f.creator.id)).creatorSource,'grant');assert.equal((await f.profile(f.player.id)).isOwner,false);
});
