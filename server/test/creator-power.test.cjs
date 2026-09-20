'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../src/app.cjs'),{openStore,identity,session,hash,random}=require('../src/store.cjs');
const {act}=require('../src/admin-actions.cjs');
async function fixture(t){
 const db=openStore(':memory:'),[owner,creator,player]=['owner','creator','player'].map(name=>{const p=identity(db,'local','creator-power-'+name);return {...p,...session(db,p.id)}}),errors=[];
 const app=createApp({db,origin:'https://zoigram.example',ownerProfileId:owner.id,onError:e=>errors.push(e)});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();db.close();assert.deepEqual(errors,[])});
 const base='http://127.0.0.1:'+app.server.address().port;
 async function call(route='/api/me/creator-power',user=creator,method='GET',body){
  const r=await fetch(base+route,{method,headers:{...(user?{Authorization:'Bearer '+user.token}:{}),'Content-Type':'application/json','Accept-Language':'en'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),headers:r.headers};
 }
 function grant(value,expectedRevision=0){return act(db,{action:'set-creator',targetId:creator.id,creator:value,expectedRevision,reason:'Creator permission test'},{id:owner.id},'',owner.id)}
 return {db,owner,creator,player,call,grant};
}
const envelope=user=>({ability:'filming_learning',profileId:user.id,multiplier:1.1,durationGameMinutes:60});

test('power permission is a fixed envelope for owner and explicitly granted Creator',async t=>{
 const f=await fixture(t),owner=await f.call(undefined,f.owner);assert.equal(owner.status,200);assert.deepEqual(owner.body,envelope(f.owner));assert.equal(owner.headers.get('cache-control'),'no-store');
 assert.equal((await f.call()).status,403);f.grant(true);
 const granted=await f.call();assert.equal(granted.status,200);assert.deepEqual(granted.body,envelope(f.creator));
 assert.equal((await f.call(undefined,f.player)).status,403);
 const info=await f.call('/api/info');assert.equal(info.status,200);assert.equal(info.body.features.creatorPower,true);
});

test('power checks current grants on every request and rejects expired, revoked or banned sessions',async t=>{
 const f=await fixture(t);f.grant(true);assert.equal((await f.call()).status,200);f.grant(false,1);assert.equal((await f.call()).status,403);f.grant(true,2);assert.equal((await f.call()).status,200);
 f.db.prepare('UPDATE sessions SET expires_at=1 WHERE token_hash=?').run(hash(f.creator.token));assert.equal((await f.call()).status,401);
 const fresh={...f.creator,...session(f.db,f.creator.id)};assert.equal((await f.call(undefined,fresh)).status,200);
 f.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(f.creator.id);assert.equal((await f.call(undefined,fresh)).status,401);f.db.prepare('UPDATE profiles SET banned=0 WHERE id=?').run(f.creator.id);
 f.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(fresh.token));assert.equal((await f.call(undefined,fresh)).status,401);assert.equal((await f.call(undefined,null)).status,401);
});

test('client inputs cannot forge Creator permissions or select another ability, player or amount',async t=>{
 const f=await fixture(t);
 const forged=await f.call('/api/me',f.player,'PATCH',{displayName:'Power Player',bio:'No grant',creator:true,creatorSource:'owner',creatorRevision:999,isOwner:true,ownerProfileId:f.player.id});assert.equal(forged.status,200);assert.equal(forged.body.profile.creator,false);
 assert.equal((await f.call(undefined,f.player)).status,403);
 f.grant(true);
 for(const query of ['?profileId='+f.player.id,'?ability=money','?multiplier=100','?durationGameMinutes=99999','?command=arbitrary','?buffId=untrusted'])assert.equal((await f.call('/api/me/creator-power'+query)).status,400);
 for(const method of ['POST','PATCH','PUT','DELETE'])assert.equal((await f.call('/api/me/creator-power',f.creator,method,{ability:'money',multiplier:999,profileId:f.player.id})).status,404);
 assert.deepEqual((await f.call()).body,envelope(f.creator));
});

test('successful power permission reads neither mutate community data nor consume counters or cooldowns',async t=>{
 const f=await fixture(t);f.grant(true);
 f.db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.creator.id,random(),'fixture','Power does not affect publishing',Date.now(),64,64,Buffer.from('image'),Buffer.from('thumbnail'),14);
 const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(t=>t.name);
 const snapshot=()=>Object.fromEntries(tables.map(name=>[name,f.db.prepare('SELECT * FROM "'+name.replace(/"/g,'""')+'" ORDER BY rowid').all()]));
 const before=snapshot();for(let i=0;i<3;i++)assert.deepEqual((await f.call()).body,envelope(f.creator));assert.deepEqual(snapshot(),before);
});
