'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../src/app.cjs'),{identity,session,random,openStore}=require('../src/store.cjs');
async function fixture(t){
 const app=createApp({database:':memory:',origin:'https://zoigram.example'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const db=app.db;
 const people=['owner','viewer','other'].map(x=>{const p=identity(db,'test',x);return {...p,...session(db,p.id)}}),[owner,viewer,other]=people;
 const post=(who=owner)=>Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(who.id,random(),'hash','A photo',1,100,100,Buffer.from('photo'),Buffer.from('thumb'),10).lastInsertRowid);
 const call=async(route,{method='GET',body,user=owner,modern=true}={})=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method,headers:{'Content-Type':'application/json','Accept-Language':'en',...(user?{Authorization:'Bearer '+user.token}:{}),...(modern?{'X-Zoigram-Features':'comment-notifications'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers}};
 return {db,owner,viewer,other,post,call};
}
test('bookmarks are private, idempotent and removed with their posts',async t=>{
 const f=await fixture(t),id=f.post(),route='/api/posts/'+id+'/save';
 assert.equal((await f.call(route,{method:'PUT',body:{},user:null})).status,401);
 for(let i=0;i<2;i++){const r=await f.call(route,{method:'PUT',body:{},user:f.viewer});assert.equal(r.status,200);assert.equal(r.data.post.saved,true)}
 assert.equal(f.db.prepare('SELECT count(*) n FROM bookmarks').get().n,1);
 assert.equal((await f.call('/api/saved')).data.posts.length,0);assert.equal((await f.call('/api/posts/'+id)).data.post.saved,false);
 assert.equal((await f.call('/api/saved',{user:f.viewer})).data.posts[0].id,id);
 assert.equal((await f.call('/api/posts/'+id,{user:f.viewer})).data.post.saved,true);
 for(let i=0;i<2;i++)assert.equal((await f.call(route,{method:'DELETE',user:f.viewer})).data.post.saved,false);
 await f.call(route,{method:'PUT',body:{},user:f.viewer});await f.call('/api/posts/'+id,{method:'DELETE'});
 assert.equal(f.db.prepare('SELECT count(*) n FROM bookmarks').get().n,0);assert.equal((await f.call(route,{method:'PUT',body:{},user:f.viewer})).status,404);
});
test('saved pagination orders by bookmark time and filters both block directions and bans before slicing',async t=>{
 const f=await fixture(t),expected=[];
 for(let i=0;i<23;i++){const id=f.post();expected.unshift(id);f.db.prepare('INSERT INTO bookmarks(profile_id,post_id,created_at) VALUES(?,?,?)').run(f.viewer.id,id,1)}
 // A newer bookmark of an older post must be first, independently of its post ID.
 await f.call('/api/posts/'+expected.at(-1)+'/save',{method:'DELETE',user:f.viewer});await f.call('/api/posts/'+expected.at(-1)+'/save',{method:'PUT',body:{},user:f.viewer});expected.unshift(expected.pop());
 for(let i=0;i<3;i++){const p=identity(f.db,'test','hidden'+i);for(let j=0;j<15;j++)f.db.prepare('INSERT INTO bookmarks(profile_id,post_id,created_at) VALUES(?,?,?)').run(f.viewer.id,f.post(p),1);if(i===0)f.db.prepare('INSERT INTO blocks VALUES(?,?)').run(p.id,f.viewer.id);if(i===1)f.db.prepare('INSERT INTO blocks VALUES(?,?)').run(f.viewer.id,p.id);if(i===2)f.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(p.id)}
 const found=[];let cursor;do{const r=await f.call('/api/saved'+(cursor?'?before='+cursor:''),{user:f.viewer});assert.equal(r.status,200);found.push(...r.data.posts.map(p=>p.id));cursor=r.data.nextCursor}while(cursor);
 assert.deepEqual(found,expected);assert.equal(new Set(found).size,23);assert.equal((await f.call('/api/saved?before=bad',{user:f.viewer})).status,400);
});
test('comments notify only the author once and old clients cannot see or mark those alerts read',async t=>{
 const f=await fixture(t),id=f.post(),route='/api/posts/'+id+'/comments',body={requestId:random(),text:'Beautiful!'};
 assert.equal((await f.call(route,{method:'POST',body,user:f.viewer})).status,201);assert.equal((await f.call(route,{method:'POST',body,user:f.viewer})).data.repeated,true);
 await f.call(route,{method:'POST',body:{requestId:random(),text:'My own comment'}});
 assert.equal(f.db.prepare('SELECT count(*) n FROM notifications').get().n,1);
 const note=(await f.call('/api/notifications')).data.notifications[0];assert.equal(note.kind,'comment');assert.equal(note.actor.id,f.viewer.id);assert.equal(note.postId,id);
 assert.equal((await f.call('/api/activity')).data.unreadNotifications,1);
 assert.equal((await f.call('/api/activity',{modern:false})).data.unreadNotifications,0);
 assert.deepEqual((await f.call('/api/notifications',{modern:false})).data.notifications,[]);
 await f.call('/api/notifications/read',{method:'PUT',body:{through:note.id},modern:false});assert.equal(f.db.prepare('SELECT read_at FROM notifications').get().read_at,null);
 assert.equal((await f.call('/api/notifications',{user:f.other})).data.notifications.length,0);
 await f.call('/api/notifications/read',{method:'PUT',body:{through:note.id}});assert.equal((await f.call('/api/activity')).data.unreadNotifications,0);assert.equal((await f.call('/api/notifications')).data.notifications[0].isRead,true);
 const comment=f.db.prepare('SELECT id FROM comments WHERE profile_id=?').get(f.viewer.id);await f.call('/api/comments/'+comment.id,{method:'DELETE',user:f.viewer});assert.equal(f.db.prepare('SELECT count(*) n FROM notifications').get().n,0);
});
test('comment alerts respect bans, blocks and deletion; legacy pagination is not exhausted by hidden comments',async t=>{
 const f=await fixture(t),id=f.post();await f.call('/api/posts/'+id+'/like',{method:'PUT',body:{},user:f.viewer});
 for(let i=0;i<24;i++){const cid=Number(f.db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(f.viewer.id,id,random(),'Comment '+i,1).lastInsertRowid);f.db.prepare('INSERT INTO notifications(profile_id,actor_id,kind,post_id,created_at,comment_id) VALUES(?,?,?,?,?,?)').run(f.owner.id,f.viewer.id,'comment',id,1,cid)}
 const legacy=(await f.call('/api/notifications',{modern:false})).data;assert.equal(legacy.notifications.length,1);assert.equal(legacy.notifications[0].kind,'like');assert.equal(legacy.nextCursor,null);
 assert.equal((await f.call('/api/activity')).data.unreadNotifications,25);
 f.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(f.viewer.id);assert.equal((await f.call('/api/activity')).data.unreadNotifications,0);f.db.prepare('UPDATE profiles SET banned=0 WHERE id=?').run(f.viewer.id);
 for(const [a,b]of [[f.owner,f.viewer],[f.viewer,f.owner]]){f.db.prepare('INSERT INTO blocks VALUES(?,?)').run(a.id,b.id);assert.equal((await f.call('/api/notifications')).data.notifications.length,0);f.db.prepare('DELETE FROM blocks').run()}
 await f.call('/api/posts/'+id,{method:'DELETE'});assert.equal((await f.call('/api/notifications')).data.notifications.length,0);
});
test('schema 6 migration retains IDs, read states and monotonic notification cursors',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-migration-')),file=path.join(dir,'db.sqlite');t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-migration-'));fs.rmSync(dir,{recursive:true,force:true})});
 let db=openStore(file);const a=identity(db,'test','a'),b=identity(db,'test','b');
 db.exec("DROP TABLE notifications;CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('like','follow')),post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,read_at INTEGER,CHECK((kind='like' AND post_id IS NOT NULL) OR (kind='follow' AND post_id IS NULL)));PRAGMA user_version=6;");
 db.prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?,?)").run(42,a.id,b.id,'follow',null,1,3);db.prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?,?)").run(100,b.id,a.id,'follow',null,2,null);db.prepare('DELETE FROM notifications WHERE id=100').run();
 const before=db.prepare('SELECT * FROM notifications').all();db.close();db=openStore(file);
 try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,10);assert.deepEqual(db.prepare('SELECT id,profile_id,actor_id,kind,post_id,created_at,read_at FROM notifications').all(),before);assert.equal(identity(db,'test','a').id,a.id);const next=db.prepare("INSERT INTO notifications(profile_id,actor_id,kind,created_at) VALUES(?,?,?,?)").run(b.id,a.id,'follow',5).lastInsertRowid;assert(next>100,'Do not reuse deleted IDs already acknowledged by clients');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])}finally{db.close()}
 db=openStore(file);assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n,2);db.close();
});
