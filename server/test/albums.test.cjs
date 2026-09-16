'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../src/app.cjs'),{identity,session,hash,openStore}=require('../src/store.cjs');
const {createBackup,restoreBackup}=require('../src/backups.cjs');
async function fixture(t,options={}){
 const app=createApp({database:':memory:',origin:'http://127.0.0.1',...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const url='http://127.0.0.1:'+app.server.address().port,users=['author','viewer','other'].map(n=>{const p=identity(app.db,'test',n);return {...p,...session(app.db,p.id)}});
 const images=await Promise.all(['#ff0044','#0044ff','#44ff00','#ffff00','#00ffff'].map((color,i)=>sharp({create:{width:128+i*10,height:96+i*3,channels:3,background:color}}).png().toBuffer().then(x=>x.toString('base64'))));
 async function call(method,p,body,user=users[0],extra={}){const u=p.startsWith('http')?new URL(p):null;const res=await fetch(url+(u?u.pathname+u.search:p),{method,headers:{...(user?{Authorization:'Bearer '+user.token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},body:body!==undefined?JSON.stringify(body):undefined});return {status:res.status,body:(res.headers.get('content-type')||'').includes('json')?await res.json():Buffer.from(await res.arrayBuffer())}}
 return {app,users,images,call,post:(n=5)=>({requestId:crypto.randomUUID(),caption:'Album 🌆',imagesBase64:images.slice(0,n)})};
}
test('albums preserve ordered images, cover compatibility and atomic concurrent retry identity',async t=>{
 const f=await fixture(t),body=f.post(),replies=await Promise.all([f.call('POST','/api/posts',body),f.call('POST','/api/posts',body)]),p=replies[0].body.post;
 assert.equal(replies[0].status,201);assert.equal(replies[1].body.post.id,p.id);assert.equal(p.photos.length,5);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,1);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM post_photos').get().n,4);
 for(let i=0;i<5;i++){const media=await f.call('GET',p.photos[i].imageUrl,undefined,null);assert.equal(media.status,200);assert.equal((await sharp(media.body).metadata()).width,128+i*10)}
 const cover=await f.call('GET',p.imageUrl,undefined,null);assert.deepEqual(cover.body,(await f.call('GET',p.photos[0].imageUrl,undefined,null)).body);
 const reordered={...body,imagesBase64:[...body.imagesBase64].reverse()};assert.equal((await f.call('POST','/api/posts',reordered)).status,409);
 assert.equal((await f.call('GET','/api/posts/request/'+body.requestId)).body.post.id,p.id);assert.deepEqual((await f.call('GET','/api/posts/request/'+body.requestId,undefined,f.users[1])).body,{found:false});
 assert.equal((await f.call('GET','/api/posts/request/'+body.requestId,undefined,null)).status,401);
});
test('invalid or oversized albums leave no partial publication or photo rows',async t=>{
 const f=await fixture(t);for(const imagesBase64 of [[],[...f.images,f.images[0]],'wrong',[f.images[0],Buffer.alloc(100).toString('base64')]])assert.equal((await f.call('POST','/api/posts',{...f.post(),imagesBase64})).status,400);
 assert.equal((await f.call('POST','/api/posts',{...f.post(),imageBase64:f.images[0]})).status,400);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM post_photos').get().n,0);
});
test('quota counts every image and thumbnail; deleting an album cascades and frees the same bytes',async t=>{
 const f=await fixture(t),p=(await f.call('POST','/api/posts',f.post())).body.post;
 const row=f.app.db.prepare('SELECT * FROM posts WHERE id=?').get(p.id),extras=f.app.db.prepare('SELECT SUM(bytes) n FROM post_photos WHERE post_id=?').get(p.id).n;
 assert.equal(row.bytes,row.image.length+row.thumbnail.length+extras);
 const constrained=await fixture(t,{storageBytes:row.bytes-1});assert.equal((await constrained.call('POST','/api/posts',constrained.post())).status,507);assert.equal(constrained.app.db.prepare('SELECT COUNT(*) n FROM post_photos').get().n,0);
 assert.equal((await constrained.call('POST','/api/posts',constrained.post(1))).status,201);
 assert.equal((await f.call('DELETE','/api/posts/'+p.id)).status,200);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM post_photos').get().n,0);assert.equal((await f.call('GET',p.photos[4].imageUrl,undefined,null)).status,404);
});
test('every album image obeys session expiry and blocks, and rejects invalid image indices',async t=>{
 const f=await fixture(t),p=(await f.call('POST','/api/posts',f.post())).body.post,other=(await f.call('GET','/api/posts/'+p.id,undefined,f.users[1])).body.post;
 assert.equal((await f.call('GET',p.photos[1].imageUrl.replace('photo=1','photo=9'),undefined,null)).status,404);
 assert.equal((await f.call('GET',p.photos[1].imageUrl.replace('photo=1','photo=1%20OR%201'),undefined,null)).status,404);
 await f.call('PUT','/api/profiles/'+f.users[0].id+'/block',{},f.users[1]);for(const photo of other.photos)assert.equal((await f.call('GET',photo.imageUrl,undefined,null)).status,404);
 await f.call('DELETE','/api/session');for(const photo of p.photos)assert.equal((await f.call('GET',photo.imageUrl,undefined,null)).status,403);
});
test('legacy one-photo requests and album requests share retry identity and feed DTOs',async t=>{
 const f=await fixture(t),body=f.post(1);const first=await f.call('POST','/api/posts',{requestId:body.requestId,caption:body.caption,imageBase64:body.imagesBase64[0]});assert.equal(first.status,201);
 const repeat=await f.call('POST','/api/posts',body);assert.equal(repeat.status,200);assert.equal(repeat.body.post.id,first.body.post.id);assert.equal(repeat.body.post.photos.length,1);
 assert.equal((await f.call('GET','/api/info')).body.features.photoAlbums,true);
});
test('schema 7 photos and IDs survive migration; backup restores all album photos',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-albums-')),data=path.join(dir,'data');fs.mkdirSync(data);t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-albums-'));fs.rmSync(dir,{recursive:true,force:true})});
 const dbFile=path.join(data,'zoigram.sqlite'),db=openStore(dbFile),author=identity(db,'test','legacy');db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(author.id,'legacy-request','hash','Keep',Date.now(),64,64,Buffer.from('old-image'),Buffer.from('old-thumb'),18);db.exec('DROP TABLE post_photos; PRAGMA user_version=7');db.close();
 const f=await fixture(t,{database:dbFile});assert.equal(f.app.db.prepare('PRAGMA user_version').get().user_version,8);assert.equal(f.app.db.prepare('SELECT caption FROM posts WHERE id=1').get().caption,'Keep');
 const p=(await f.call('POST','/api/posts',f.post())).body.post;fs.writeFileSync(path.join(data,'media.key'),Buffer.alloc(32,8));const backup=await createBackup(data,path.join(dir,'backups'));assert.equal(backup.counts.post_photos,4);
 await restoreBackup(backup.directory,path.join(dir,'restored'));const restored=openStore(path.join(dir,'restored/zoigram.sqlite'));assert.equal(restored.prepare('SELECT COUNT(*) n FROM post_photos WHERE post_id=?').get(p.id).n,4);assert.equal(restored.prepare('SELECT COUNT(*) n FROM profiles WHERE id=?').get(author.id).n,1);restored.close();await f.app.close();
});
test('owner moderation can inspect every album image while unauthenticated access is denied',async t=>{
 const ownerId=crypto.randomUUID(),f=await fixture(t,{ownerProfileId:ownerId});f.app.db.prepare('INSERT INTO profiles(id,provider,subject,username,display_name,created_at) VALUES(?,?,?,?,?,?)').run(ownerId,'test','admin-owner','owner','Owner',Date.now());
 const token=crypto.randomBytes(32).toString('base64url');f.app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(crypto.randomUUID(),hash(token),ownerId,Date.now()+60000);
 const p=(await f.call('POST','/api/posts',f.post())).body.post,headers={Cookie:'zg_admin='+token};const admin=await f.call('GET','/admin/api/posts/'+p.id,undefined,null,headers);assert.equal(admin.status,200);assert.equal(admin.body.photos.length,5);
 for(const photo of admin.body.photos){assert.equal((await f.call('GET',photo.imageUrl,undefined,null,headers)).status,200);assert.equal((await f.call('GET',photo.imageUrl,undefined,null)).status,401)}
});
