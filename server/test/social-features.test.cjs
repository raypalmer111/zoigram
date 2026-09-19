'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {createApp}=require('../src/app.cjs'),{openStore,identity,session,random}=require('../src/store.cjs'),{mentionNames,createSocial}=require('../src/social-features.cjs');
const modern='comment-notifications,mention-notifications,pinned-posts';
async function fixture(t){
 const app=createApp({database:':memory:',origin:'http://127.0.0.1'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const actors={};for(const name of ['alice','bobby','charlie','donna','edward']){const p=identity(app.db,'local',name);app.db.prepare('UPDATE profiles SET username=? WHERE id=?').run(name,p.id);actors[name]={...p,username:name,...session(app.db,p.id)}}
 const base='http://127.0.0.1:'+app.server.address().port;
 async function call(actor,route,{method='GET',body,features=modern,status=200}={}){const r=await fetch(base+route,{method,headers:{'Accept-Language':'en',...(actor?{Authorization:'Bearer '+actors[actor].token}:{}),'X-Zoigram-Features':features,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();assert.equal(r.status,status,route+': '+JSON.stringify(value));return {body:value,response:r}}
 const seed=(actor='alice',caption='Photo')=>Number(app.db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(actors[actor].id,random(),'fixture',caption,Date.now(),16,16,Buffer.from('image'),Buffer.from('thumbnail'),14).lastInsertRowid);
 return {app,db:app.db,actors,base,call,seed};
}
const tiny=()=>sharp({create:{width:64,height:64,channels:3,background:'#b67a4d'}}).jpeg().toBuffer();
const inbox=async(f,actor='bobby',features=modern)=>(await f.call(actor,'/api/notifications',{features})).body;

test('mention parsing respects full ASCII public IDs, punctuation, Unicode boundaries and email addresses',()=>{
 const max='a'.repeat(24);
 assert.deepEqual(mentionNames('Hello @Bobby, @bobby!\n(@charlie) @'+max),['bobby','charlie',max]);
 assert.deepEqual(mentionNames('x@bobby x.@bobby x+@bobby @@bobby é@bobby _@bobby @bo @'+max+'a @bobbyé'),[]);
 assert.deepEqual(mentionNames('@bobby @charlie.'),['bobby','charlie']);
});

test('new legacy posts create one notification per mentioned person and retries do not duplicate it',async t=>{
 const f=await fixture(t),body={requestId:random(),caption:'Hi @Bobby and @bobby, @alice, missing @nobody.',imageBase64:(await tiny()).toString('base64')};
 const post=(await f.call('alice','/api/posts',{method:'POST',body,status:201})).body.post;
 assert.equal((await inbox(f)).notifications[0].postId,post.id);assert.equal((await inbox(f)).notifications[0].kind,'mention');assert.equal((await inbox(f)).notifications[0].commentId,null);
 assert.equal((await inbox(f,'alice')).unread,0);
 const repeated=await f.call('alice','/api/posts',{method:'POST',body});assert.equal(repeated.body.post.id,post.id);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='mention'").get().n,1);
 assert.equal((await inbox(f,'bobby','comment-notifications')).notifications.length,0);
 assert.equal((await f.call('bobby','/api/activity',{features:''})).body.unreadNotifications,0);
 await f.call('bobby','/api/notifications/read',{method:'PUT',body:{through:999},features:'comment-notifications'});assert.equal((await inbox(f)).unread,1);
 await f.call('bobby','/api/notifications/read',{method:'PUT',body:{through:999}});assert.equal((await inbox(f)).unread,0);
});

test('resumable publication creates mentions once, inside completion, never at draft start',async t=>{
 const f=await fixture(t),requestId=random();
 await f.call('alice','/api/uploads',{method:'POST',body:{requestId,caption:'For @bobby',count:1}});assert.equal((await inbox(f)).unread,0);
 await f.call('alice','/api/uploads/'+requestId+'/0',{method:'PUT',body:{imageBase64:(await tiny()).toString('base64')}});
 const first=await f.call('alice','/api/uploads/'+requestId+'/complete',{method:'POST',body:{}}),second=await f.call('alice','/api/uploads/'+requestId+'/complete',{method:'POST',body:{}});
 assert.equal(first.body.post.id,second.body.post.id);assert.equal((await inbox(f)).unread,1);
});

test('caption edits reconcile recipients while preserving unchanged IDs and read state',async t=>{
 const f=await fixture(t),id=f.seed(),edit=(caption,expectedCaption,status=200)=>f.call('alice','/api/posts/'+id,{method:'PATCH',body:{caption,expectedCaption},status});
 await edit('Hi @bobby','Photo');const original=(await inbox(f)).notifications[0];await f.call('bobby','/api/notifications/read',{method:'PUT',body:{through:original.id}});
 await edit('Hi @BOBBY and @charlie','Hi @bobby');const existing=(await inbox(f)).notifications[0];assert.equal(existing.id,original.id);assert.equal(existing.isRead,true);assert.equal((await inbox(f,'charlie')).unread,1);
 await edit('Hi @charlie','Hi @BOBBY and @charlie');assert.equal((await inbox(f)).notifications.length,0);
 const charlieId=(await inbox(f,'charlie')).notifications[0].id;await edit('Hi @charlie','stale');assert.equal((await inbox(f,'charlie')).notifications[0].id,charlieId);
 await edit('Wrong @bobby','stale',409);assert.equal((await inbox(f)).notifications.length,0);
 await edit('No mentions','Hi @charlie');assert.equal((await inbox(f,'charlie')).unread,0);
});

test('comment mentions expose a comment destination, deduplicate owner alerts and preserve legacy comment notifications',async t=>{
 const f=await fixture(t),id=f.seed('bobby'),body={requestId:random(),text:'Hello @bobby @CHARLIE @charlie @alice'};
 const c=(await f.call('alice','/api/posts/'+id+'/comments',{method:'POST',body,status:201})).body.id;
 await f.call('alice','/api/posts/'+id+'/comments',{method:'POST',body});
 const owner=await inbox(f),other=await inbox(f,'charlie');assert.equal(owner.notifications.length,1);assert.equal(owner.notifications[0].kind,'mention');assert.equal(owner.notifications[0].commentId,c);assert.equal(other.unread,1);assert.equal((await inbox(f,'alice')).unread,0);
 const legacy=await inbox(f,'bobby','comment-notifications');assert.equal(legacy.notifications.length,1);assert.equal(legacy.notifications[0].kind,'comment');assert.equal((await inbox(f,'bobby','')).unread,0);
 await f.call('bobby','/api/notifications/read',{method:'PUT',body:{through:owner.notifications[0].id}});assert.equal((await inbox(f,'bobby','comment-notifications')).unread,0);
 const jump=(await f.call('charlie','/api/posts/'+id+'/comments?after='+(c-1))).body;assert.equal(jump.comments[0].id,c);
 await f.call('alice','/api/comments/'+c,{method:'DELETE'});assert.equal((await inbox(f)).notifications.length,0);assert.equal((await inbox(f,'charlie')).unread,0);
});

test('mentions exclude blocked, banned and missing recipients, including blocks with a comment post owner',async t=>{
 const f=await fixture(t),id=f.seed('donna');
 f.db.prepare('INSERT INTO blocks VALUES(?,?)').run(f.actors.bobby.id,f.actors.alice.id);f.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(f.actors.charlie.id);f.db.prepare('INSERT INTO blocks VALUES(?,?)').run(f.actors.edward.id,f.actors.donna.id);
 await f.call('alice','/api/posts/'+id+'/comments',{method:'POST',body:{requestId:random(),text:'@bobby @charlie @edward @missing @alice'},status:201});
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='mention'").get().n,0);
});

test('notification pagination filters unsupported kinds before applying its cursor and page limit',async t=>{
 const f=await fixture(t),social=createSocial({db:f.db});
 for(let i=0;i<25;i++){const post=f.seed('alice','@bobby');social.syncMentions(post,f.actors.alice.id,'@bobby');f.db.prepare("INSERT INTO notifications(profile_id,actor_id,kind,post_id,created_at) VALUES(?,?,'like',?,?)").run(f.actors.bobby.id,f.actors.alice.id,post,Date.now())}
 async function pages(features){const found=[];let before='';do{const page=(await f.call('bobby','/api/notifications'+(before?'?before='+before:''),{features})).body;found.push(...page.notifications);before=page.nextCursor}while(before);assert.equal(found.length,new Set(found.map(n=>n.id)).size);return found}
 const old=await pages('comment-notifications'),current=await pages(modern);assert.equal(old.length,25);assert(old.every(n=>n.kind==='like'));assert.equal(current.length,50);assert.equal(current.filter(n=>n.kind==='mention').length,25);
});

test('inbox and unread visibility react to post-owner blocks and bans, and hidden notifications are not marked read',async t=>{
 const f=await fixture(t),id=f.seed('donna');await f.call('alice','/api/posts/'+id+'/comments',{method:'POST',body:{requestId:random(),text:'For @bobby'},status:201});const n=(await inbox(f)).notifications[0];
 await f.call('bobby','/api/profiles/'+f.actors.donna.id+'/block',{method:'PUT'});assert.equal((await inbox(f)).unread,0);assert.equal((await inbox(f)).notifications.length,0);await f.call('bobby','/api/notifications/read',{method:'PUT',body:{through:n.id}});assert.equal(f.db.prepare('SELECT read_at FROM notifications WHERE id=?').get(n.id).read_at,null);
 await f.call('bobby','/api/profiles/'+f.actors.donna.id+'/block',{method:'DELETE'});assert.equal((await inbox(f)).unread,1);
 f.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(f.actors.donna.id);assert.equal((await inbox(f)).unread,0);f.db.prepare('UPDATE profiles SET banned=0 WHERE id=?').run(f.actors.donna.id);
 f.db.prepare('DELETE FROM posts WHERE id=?').run(id);assert.equal((await inbox(f)).unread,0);assert.equal(f.db.prepare('SELECT 1 FROM notifications WHERE id=?').get(n.id),undefined);
});

test('pin actions require the post owner, enforce three atomically and are idempotent',async t=>{
 const f=await fixture(t),posts=Array.from({length:4},()=>f.seed()),pin=(actor,id,method='PUT',status=200)=>f.call(actor,'/api/posts/'+id+'/pin',{method,status});
 await pin(null,posts[0],'PUT',401);await pin('bobby',posts[0],'PUT',403);await pin('bobby',posts[0],'DELETE',403);
 const first=(await pin('alice',posts[0])).body.post;assert.equal(first.pinned,true);assert(Number.isSafeInteger(first.pinnedAt));assert.equal((await pin('alice',posts[0])).body.post.pinnedAt,first.pinnedAt);
 await pin('alice',posts[1]);const outcomes=await Promise.all(posts.slice(2).map(id=>fetch(f.base+'/api/posts/'+id+'/pin',{method:'PUT',headers:{Authorization:'Bearer '+f.actors.alice.token}})));assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);const full=await(await Promise.resolve(outcomes.find(r=>r.status===409))).json();assert.equal(full.code,'pin_limit');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM pinned_posts').get().n,3);
 assert.equal((await pin('alice',posts[0],'DELETE')).body.post.pinned,false);assert.equal((await pin('alice',posts[0],'DELETE')).body.post.pinnedAt,null);
 const orphan=posts.find(id=>f.db.prepare('SELECT 1 FROM pinned_posts WHERE post_id=?').get(id));await f.call('alice','/api/posts/'+orphan,{method:'DELETE'});assert.equal(f.db.prepare('SELECT 1 FROM pinned_posts WHERE post_id=?').get(orphan),undefined);
});

test('profile pins are separate from paginated posts while feed and old clients remain chronological',async t=>{
 const f=await fixture(t),ids=Array.from({length:27},()=>f.seed());for(const id of [ids[0],ids[13],ids[26]])await f.call('alice','/api/posts/'+id+'/pin',{method:'PUT'});
 const route='/api/feed?profile='+f.actors.alice.id,first=(await f.call('bobby',route)).body;assert.equal(first.pinnedPosts.length,3);assert.equal(first.posts.length,10);assert(first.posts.every(p=>!p.pinned));
 const collected=[...first.pinnedPosts,...first.posts];let next=first.nextCursor;
 while(next){const page=(await f.call('bobby',route+'&before='+next)).body;assert.deepEqual(page.pinnedPosts,[]);assert(page.posts.every(p=>!p.pinned));collected.push(...page.posts);next=page.nextCursor}
 assert.equal(collected.length,27);assert.equal(new Set(collected.map(p=>p.id)).size,27);
 const feed=(await f.call('bobby','/api/feed')).body,old=(await f.call('bobby',route,{features:''})).body;assert.equal(feed.pinnedPosts,undefined);assert.deepEqual(feed.posts.map(p=>p.id),ids.slice(-10).reverse());assert.equal(old.pinnedPosts,undefined);assert.deepEqual(old.posts.map(p=>p.id),feed.posts.map(p=>p.id));
 await f.call('bobby','/api/profiles/'+f.actors.alice.id+'/block',{method:'PUT'});await f.call('bobby',route,{status:404});await f.call('bobby','/api/posts/'+ids[0]+'/pin',{method:'PUT',status:404});
});

test('media refresh requires a session, bounds requests, deduplicates IDs and never exposes unavailable media',async t=>{
 const f=await fixture(t),id=f.seed();await f.call(null,'/api/media/refresh',{method:'POST',body:{postIds:[id]},status:401});
 for(const body of [{postIds:[-1]},{profileIds:['wrong']},{postIds:Array(31).fill(id)},{postIds:'1'}])await f.call('bobby','/api/media/refresh',{method:'POST',body,status:400});
 const body=(await f.call('bobby','/api/media/refresh',{method:'POST',body:{postIds:[id,id,9999],profileIds:[f.actors.alice.id]}})).body;assert.equal(body.posts.length,1);assert.equal(body.profiles.length,1);assert.deepEqual(body.unavailablePostIds,[9999]);
 const dto=body.posts[0],grant=new URL(dto.imageUrl).searchParams.get('grant'),payload=JSON.parse(Buffer.from(grant.split('.')[0],'base64url'));assert.equal(payload.e,dto.mediaExpiresAt);assert(dto.mediaExpiresAt>Date.now());assert(Number.isSafeInteger(body.serverTime));assert(Math.abs(Date.now()-body.serverTime)<5000);assert(body.serverTime<dto.mediaExpiresAt);
 await f.call('bobby','/api/profiles/'+f.actors.alice.id+'/block',{method:'PUT'});const blocked=(await f.call('bobby','/api/media/refresh',{method:'POST',body:{postIds:[id],profileIds:[f.actors.alice.id]}})).body;assert.deepEqual(blocked.posts,[]);assert.deepEqual(blocked.profiles,[]);assert.deepEqual(blocked.unavailablePostIds,[id]);assert.deepEqual(blocked.unavailableProfileIds,[f.actors.alice.id]);
});

test('v9 migration preserves notification rows, IDs, read states, high-water sequence and foreign keys across restarts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-social-migration-')),filename=path.join(dir,'fixture.sqlite');let db;
 try{
  db=openStore(filename);const owner=identity(db,'local','owner'),actor=identity(db,'local','actor');
  const post=Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner.id,random(),'test','Old post',1,16,16,Buffer.from('image'),Buffer.from('thumb'),10).lastInsertRowid);
  const comment=Number(db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(actor.id,post,random(),'Old comment',2).lastInsertRowid);
  db.exec(`DROP TABLE notifications;CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('like','follow','comment')),post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,read_at INTEGER,comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,CHECK((kind='like' AND post_id IS NOT NULL AND comment_id IS NULL) OR (kind='follow' AND post_id IS NULL AND comment_id IS NULL) OR (kind='comment' AND post_id IS NOT NULL AND comment_id IS NOT NULL)));DROP TABLE pinned_posts;ALTER TABLE operational_errors DROP COLUMN stage;PRAGMA user_version=9;`);
  const insert=db.prepare('INSERT INTO notifications(id,profile_id,actor_id,kind,post_id,created_at,read_at,comment_id) VALUES(?,?,?,?,?,?,?,?)');insert.run(11,owner.id,actor.id,'like',post,3,4,null);insert.run(12,owner.id,actor.id,'comment',post,5,null,comment);insert.run(999,owner.id,actor.id,'follow',null,6,null,null);db.prepare('DELETE FROM notifications WHERE id=999').run();const before=db.prepare('SELECT * FROM notifications ORDER BY id').all();db.close();
  db=openStore(filename);assert.equal(db.prepare('PRAGMA user_version').get().user_version,10);assert.deepEqual(db.prepare('SELECT * FROM notifications ORDER BY id').all(),before);assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='notifications'").get().seq,999);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert(db.prepare('PRAGMA table_info(operational_errors)').all().some(c=>c.name==='stage'));
  db.prepare('UPDATE profiles SET username=? WHERE id=?').run('owner',owner.id);createSocial({db}).syncMentions(post,actor.id,'@owner',comment);assert.equal(db.prepare("SELECT id FROM notifications WHERE kind='mention'").get().id,1000);db.close();db=openStore(filename);assert.equal(db.prepare("SELECT id FROM notifications WHERE kind='mention'").get().id,1000);db.prepare('DELETE FROM comments WHERE id=?').run(comment);assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind IN ('mention','comment')").get().n,0);
 }finally{try{db?.close()}catch{}assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-social-migration-'));fs.rmSync(dir,{recursive:true,force:true})}
});
