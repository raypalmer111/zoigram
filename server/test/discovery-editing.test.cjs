'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../src/app.cjs'),{identity,session,random}=require('../src/store.cjs');
async function fixture(t){
 const app=createApp({database:':memory:',origin:'https://zoigram.example'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const db=app.db,owner=identity(db,'local','owner'),viewer=identity(db,'local','viewer');
 const access=session(db,owner.id),viewerAccess=session(db,viewer.id),base='http://127.0.0.1:'+app.server.address().port;
 const request=async(route,{method='GET',body,token=access.token}={})=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json','Accept-Language':'en',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 const post=Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner.id,random(),'original-payload','Original caption',1,800,600,Buffer.from('original-image'),Buffer.from('original-thumb'),28).lastInsertRowid);
 return {app,db,owner,viewer,access,viewerAccess,request,post};
}
test('search finds Unicode names and literal public IDs, decorates verification, and never searches private logins',async t=>{
 const f=await fixture(t);f.db.prepare('UPDATE profiles SET username=?,display_name=? WHERE id=?').run('mina_park','МИНА 박민아 Élodie',f.viewer.id);
 f.db.prepare('INSERT INTO profile_verifications VALUES(?,?,?,?)').run(f.viewer.id,1,1,1);
 f.db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?,?)').run(f.viewer.id,'private-secret-login','hash','recovery',1,1);
 for(const q of ['@MINA_PARK','мина','박민아','éLODIE','mina_']){const r=await f.request('/api/profiles/search?q='+encodeURIComponent(q));assert.equal(r.status,200);assert.equal(r.body.profiles.length,1);assert.equal(r.body.profiles[0].id,f.viewer.id);assert.equal(r.body.profiles[0].verified,true);for(const key of ['login','subject','provider','recovery_hash','password_hash','verificationRevision'])assert(!Object.hasOwn(r.body.profiles[0],key))}
 for(const q of ['%','private-secret-login',"' OR 1=1 --",'absent'])assert.equal((await f.request('/api/profiles/search?q='+encodeURIComponent(q))).body.profiles.length,0);
 assert.equal((await f.request('/api/profiles/search?q=mina',{token:null})).status,401);
});
test('search respects both block directions and bans, validates input, and paginates without repeats',async t=>{
 const f=await fixture(t);const ids=[];
 for(let i=0;i<25;i++){const p=identity(f.db,'local','result'+i);f.db.prepare('UPDATE profiles SET display_name=? WHERE id=?').run('Search group '+i,p.id);ids.push(p.id)}
 f.db.prepare('INSERT INTO blocks VALUES(?,?)').run(f.owner.id,ids[0]);f.db.prepare('INSERT INTO blocks VALUES(?,?)').run(ids[1],f.owner.id);f.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(ids[2]);
 const one=(await f.request('/api/profiles/search?q=group')).body;assert.equal(one.profiles.length,20);assert(one.nextCursor);
 const two=(await f.request('/api/profiles/search?q=group&after='+one.nextCursor)).body;assert.equal(two.profiles.length,2);assert.equal(two.nextCursor,null);
 const found=[...one.profiles,...two.profiles].map(p=>p.id);assert.equal(new Set(found).size,22);for(const id of ids.slice(0,3))assert(!found.includes(id));
 assert.equal((await f.request('/api/profiles/search?q='+('a'.repeat(81)))).status,400);assert.equal((await f.request('/api/profiles/search?q=group&after=bad')).status,400);
 for(const q of ['', '@', '   '])assert.deepEqual((await f.request('/api/profiles/search?q='+encodeURIComponent(q))).body,{profiles:[],nextCursor:null});
});
test('only the author can edit captions and all post media, identity and reactions stay intact',async t=>{
 const f=await fixture(t);f.db.prepare('INSERT INTO likes VALUES(?,?)').run(f.viewer.id,f.post);f.db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(f.viewer.id,f.post,random(),'Nice',2);f.db.prepare('INSERT INTO post_like_bonuses VALUES(?,?,?,?)').run(f.post,5,1,1);
 const before=f.db.prepare('SELECT * FROM posts WHERE id=?').get(f.post),body={caption:'New caption 🌆\n새 사진',expectedCaption:before.caption};
 assert.equal((await f.request('/api/posts/'+f.post,{method:'PATCH',body,token:f.viewerAccess.token})).status,403);assert.equal((await f.request('/api/posts/'+f.post,{method:'PATCH',body,token:null})).status,401);
 const r=await f.request('/api/posts/'+f.post,{method:'PATCH',body});assert.equal(r.status,200);assert.equal(r.body.post.caption,body.caption);assert.equal(r.body.post.likes,6);assert.equal(r.body.post.comments,1);
 const after=f.db.prepare('SELECT * FROM posts WHERE id=?').get(f.post);for(const k of Object.keys(before))if(k!=='caption')assert.deepEqual(after[k],before[k],k);
 assert.equal((await f.request('/api/feed')).body.posts[0].caption,body.caption);assert.equal((await f.request('/api/posts/'+f.post+'/comments')).body.post.caption,body.caption);
});
test('caption edits validate text, safely retry, reject stale updates and missing posts',async t=>{
 const f=await fixture(t),route='/api/posts/'+f.post;
 for(const body of [{caption:'a'},{caption:7,expectedCaption:'Original caption'},{caption:'x'.repeat(2201),expectedCaption:'Original caption'},{caption:'bad\u0000',expectedCaption:'Original caption'},{caption:'x',expectedCaption:'Original caption',imageBase64:'new'}])assert.equal((await f.request(route,{method:'PATCH',body})).status,400);
 const body={caption:'First edit',expectedCaption:'Original caption'};assert.equal((await f.request(route,{method:'PATCH',body})).status,200);assert.equal((await f.request(route,{method:'PATCH',body})).status,200);
 assert.equal((await f.request(route,{method:'PATCH',body:{...body,caption:'Stale edit'}})).status,409);
 assert.equal((await f.request(route,{method:'PATCH',body:{caption:'',expectedCaption:'First edit'}})).status,200);assert.equal((await f.request(route)).body.post.caption,'');
 f.db.prepare('DELETE FROM posts WHERE id=?').run(f.post);assert.equal((await f.request(route,{method:'PATCH',body})).status,404);
});
test('simultaneous different caption edits cannot silently overwrite one another',async t=>{
 const f=await fixture(t);const results=await Promise.all(['one','two'].map(caption=>f.request('/api/posts/'+f.post,{method:'PATCH',body:{caption,expectedCaption:'Original caption'}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
