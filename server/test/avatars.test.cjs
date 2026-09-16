'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp');
const {createApp}=require('../src/app.cjs'),{identity,session}=require('../src/store.cjs');
async function fixture(t,options={}){
 const app=createApp({database:':memory:',origin:'http://127.0.0.1',secret:Buffer.alloc(32,8),...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port,users=['A','B'].map(name=>{const p=identity(app.db,'test',name);return {...p,...session(app.db,p.id)}});
 async function call(method,url,body,access='Bearer '+users[0].token){
  const u=new URL(url,base),response=await fetch(base+u.pathname+u.search,{method,headers:{...(access?{Authorization:access}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:response.headers.get('content-type').includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer()),headers:response.headers};
 }
 const image=await sharp({create:{width:200,height:120,channels:3,background:'#eb3093'}}).png().toBuffer();
 const begin=async(access)=>{const result=await call('POST','/api/me/avatar-upload',{},access);assert.equal(result.status,201);return new URL(result.body.uploadUrl).hash.slice(1)};
 return {app,users,call,image,begin};
}
test('avatar upload is owner-bound, one-use, circular and visible in profile DTOs; logout revokes media',async t=>{
 const {call,users,image,begin}=await fixture(t),token=await begin();
 const result=await call('PUT','/api/avatar-upload',{imageBase64:image.toString('base64'),profileId:users[1].id},'Avatar '+token);assert.equal(result.status,200);
 assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:image.toString('base64')},'Avatar '+token)).status,403);
 const me=(await call('GET','/api/me')).body.profile;assert.ok(me.avatarUrl);assert.equal(typeof me.avatarVersion,'string');
 const other=(await call('GET','/api/me',undefined,'Bearer '+users[1].token)).body.profile;assert.equal(other.avatarUrl,null);
 const png=await call('GET',me.avatarUrl,undefined,null);assert.equal(png.status,200);const metadata=await sharp(png.body).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert.equal(metadata.format,'png');assert.equal(metadata.exif,undefined);
 const raw=await sharp(png.body).raw().toBuffer({resolveWithObject:true});assert.equal(raw.data[3],0);assert.equal(raw.data[(256*512+256)*4+3],255);
 assert.equal((await call('GET',me.avatarUrl+'x',undefined,null)).status,403);
 assert.equal((await call('GET','/api/avatars/'+me.id,undefined,null)).status,403);
 await call('DELETE','/api/session');assert.equal((await call('GET',me.avatarUrl,undefined,null)).status,403);
});
test('avatar replacement invalidates old grants; blocks, bans and removal protect avatar access',async t=>{
 const {app,call,users,image,begin}=await fixture(t);
 async function upload(){const token=await begin();assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:image.toString('base64')},'Avatar '+token)).status,200)}
 await upload();const a=(await call('GET','/api/me')).body.profile;await upload();assert.equal((await call('GET',a.avatarUrl,undefined,null)).status,404);
 const viewer='Bearer '+users[1].token,b=(await call('GET','/api/profiles/'+a.id,undefined,viewer)).body.profile;
 assert.equal((await call('GET',b.avatarUrl,undefined,null)).status,200);
 await call('PUT','/api/profiles/'+users[1].id+'/block',{});assert.equal((await call('GET',b.avatarUrl,undefined,null)).status,404);
 const own=(await call('GET','/api/me')).body.profile;await call('DELETE','/api/me/avatar');assert.equal((await call('GET',own.avatarUrl,undefined,null)).status,404);
 const token=await begin();app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(users[0].id);assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:image.toString('base64')},'Avatar '+token)).status,403);
});
test('avatar tickets expire and cannot authorize other routes; malformed images and quotas leave data unchanged',async t=>{
 const {app,call,image,begin}=await fixture(t,{storageBytes:100}),token=await begin();
 assert.equal((await call('GET','/api/me',undefined,'Avatar '+token)).status,401);
 assert.equal((await call('POST','/api/me/avatar-upload',{},null)).status,401);
 assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:'not-an-image'},'Avatar '+token)).status,400);
 const svg=Buffer.from('<svg width="100" height="100"></svg>').toString('base64');assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:svg},'Avatar '+token)).status,400);
 assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:image.toString('base64')},'Avatar '+token)).status,507);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM avatars').get().n,0);
 app.db.prepare('UPDATE avatar_uploads SET expires_at=0').run();assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:image.toString('base64')},'Avatar '+token)).status,403);
 const page=await call('GET','/avatar',undefined,null);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert(!page.body.toString().includes(token));
});

test('malformed multibyte avatar signatures reject safely without an internal error',async t=>{
 const errors=[],{call,users}=await fixture(t,{onError:e=>errors.push(e)});
 const result=await call('GET','/api/avatars/'+users[0].id+'?grant=a.'+encodeURIComponent('я'.repeat(43)),undefined,null);
 assert.equal(result.status,403);assert.deepEqual(errors,[]);
});

test('avatar media diagnostics distinguish malformed, expired and revoked-session links without raw tokens',async t=>{
 const {app,call,image,begin}=await fixture(t),token=await begin();assert.equal((await call('PUT','/api/avatar-upload',{imageBase64:image.toString('base64')},'Avatar '+token)).status,200);
 const avatar=(await call('GET','/api/me')).body.profile.avatarUrl,url=new URL(avatar),[original]=url.searchParams.get('grant').split('.'),payload=JSON.parse(Buffer.from(original,'base64url').toString());
 url.searchParams.set('grant','bad.signature');assert.equal((await call('GET',url.toString(),undefined,null)).status,403);
 const expired=Buffer.from(JSON.stringify({...payload,e:1})).toString('base64url'),sig=require('node:crypto').createHmac('sha256',Buffer.alloc(32,8)).update('avatar:'+expired).digest('base64url');url.searchParams.set('grant',expired+'.'+sig);assert.equal((await call('GET',url.toString(),undefined,null)).status,403);
 await call('DELETE','/api/session');assert.equal((await call('GET',avatar,undefined,null)).status,403);
 const rows=app.db.prepare('SELECT code,route,status FROM operational_errors ORDER BY id').all();assert.deepEqual(rows.map(r=>r.code),['media_invalid','media_expired','media_session_ended']);assert(rows.every(r=>r.route==='media'&&r.status===403));assert(!JSON.stringify(rows).includes(token));
});
