'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../src/app.cjs');const {identity,session,openStore,hash}=require('../src/store.cjs');
async function fixture(t,extra={}){
 const app=createApp({database:':memory:',origin:'http://127.0.0.1',secret:Buffer.alloc(32,9),...extra});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const url='http://127.0.0.1:'+app.server.address().port;const users=['Alice','Bob','Carol'].map(name=>{const p=identity(app.db,'test',name);app.db.prepare('UPDATE profiles SET display_name=? WHERE id=?').run(name,p.id);return {...p,...session(app.db,p.id)}});
 async function call(method,p,body,user=users[0]){const headers={'Accept-Language':'ru'};if(user)headers.Authorization='Bearer '+user.token;if(body!==undefined)headers['Content-Type']='application/json';const res=await fetch(url+p,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=(res.headers.get('content-type')||'').includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer());return {status:res.status,data,headers:res.headers}}
 const image=await sharp({create:{width:128,height:96,channels:3,background:'#eb3093'}}).png().toBuffer();return {app,users,url,call,image,post:(caption='Первый кадр')=>({requestId:crypto.randomUUID(),caption,imageBase64:image.toString('base64')})};
}
test('real accounts share posts, reactions, discussions and following feeds',async t=>{
 const {call,users,post}=await fixture(t);const [a,b]=users;
 assert.equal((await call('GET','/api/feed',undefined,null)).status,401);
 const created=await call('POST','/api/posts',post());assert.equal(created.status,201);const p=created.data.post;assert.equal(p.author.id,a.id);assert.equal(p.likes,0);assert.equal(p.width,128);
 assert.equal((await call('GET','/api/feed',undefined,b)).data.posts[0].id,p.id);
 assert.equal((await call('GET','/api/feed?scope=following',undefined,b)).data.posts.length,0);
 assert.equal((await call('PUT','/api/profiles/'+a.id+'/follow',{},b)).data.profile.followers,1);
 await call('PUT','/api/profiles/'+a.id+'/follow',{},b);assert.equal((await call('GET','/api/profiles/'+a.id,undefined,b)).data.profile.followers,1);
 assert.equal((await call('GET','/api/feed?scope=following',undefined,b)).data.posts[0].id,p.id);
 assert.equal((await call('PUT','/api/posts/'+p.id+'/like',{},b)).data.post.likes,1);assert.equal((await call('PUT','/api/posts/'+p.id+'/like',{},b)).data.post.likes,1);
 const comment={requestId:crypto.randomUUID(),text:'Красивый кадр!'};assert.equal((await call('POST','/api/posts/'+p.id+'/comments',comment,b)).status,201);assert.equal((await call('POST','/api/posts/'+p.id+'/comments',comment,b)).data.repeated,true);
 const comments=(await call('GET','/api/posts/'+p.id+'/comments')).data;assert.equal(comments.comments.length,1);assert.equal(comments.comments[0].author.id,b.id);assert.equal(comments.post.comments,1);
 assert.equal((await call('DELETE','/api/posts/'+p.id,undefined,b)).status,403);assert.equal((await call('DELETE','/api/comments/'+comments.comments[0].id)).status,403);
 assert.equal((await call('DELETE','/api/posts/'+p.id+'/like',undefined,b)).data.post.likes,0);
 await call('DELETE','/api/profiles/'+a.id+'/follow',undefined,b);assert.equal((await call('GET','/api/feed?scope=following',undefined,b)).data.posts.length,0);
 assert.equal((await call('DELETE','/api/posts/'+p.id)).status,200);assert.equal((await call('GET','/api/posts/'+p.id+'/comments')).status,404);
});
test('uploads are idempotent, decoded and validated; private media respects logout',async t=>{
 const {call,post,users}=await fixture(t);const body=post('Подпись 🌆');const [first,second]=await Promise.all([call('POST','/api/posts',body),call('POST','/api/posts',body)]);assert.equal(first.data.post.id,second.data.post.id);assert.equal((await call('GET','/api/feed')).data.posts.length,1);
 assert.equal((await call('POST','/api/posts',{...body,caption:'changed'})).status,409);
 assert.equal((await call('POST','/api/posts',{...post(),imageBase64:'<svg onload="evil"/>'})).status,400);
 const corrupt=post();corrupt.imageBase64=Buffer.alloc(100).toString('base64');assert.equal((await call('POST','/api/posts',corrupt)).status,400);
 assert.equal((await call('POST','/api/posts',post('a'.repeat(2201)))).status,400);
 const pathOf=url=>new URL(url).pathname+new URL(url).search;const media=await call('GET',pathOf(first.data.post.imageUrl),undefined,null);assert.equal(media.status,200);assert.equal((await sharp(media.data).metadata()).format,'jpeg');assert.equal((await sharp(media.data).metadata()).exif,undefined);
 assert.equal((await call('GET','/api/media/'+first.data.post.id,undefined,null)).status,403);
 assert.equal((await call('GET',pathOf(first.data.post.imageUrl)+'tampered',undefined,null)).status,403);
 await call('DELETE','/api/session');assert.equal((await call('GET','/api/me')).status,401);assert.equal((await call('GET',pathOf(first.data.post.imageUrl),undefined,null)).status,403);
 assert.equal((await call('GET','/api/me',undefined,users[1])).status,200);
});
test('blocks remove relationships and access, reports do not delete content',async t=>{
 const {call,users,post}=await fixture(t);const [a,b,c]=users;const created=(await call('POST','/api/posts',post())).data.post;
 await call('PUT','/api/profiles/'+a.id+'/follow',{},b);await call('PUT','/api/profiles/'+b.id+'/follow',{},a);
 assert.equal((await call('POST','/api/reports',{kind:'post',targetId:created.id,reason:'Спам'},b)).status,201);assert.equal((await call('GET','/api/posts/'+created.id,undefined,c)).status,200);
 const url=(await call('GET','/api/posts/'+created.id,undefined,b)).data.post.imageUrl;
 await call('PUT','/api/profiles/'+a.id+'/block',{},b);assert.equal((await call('GET','/api/feed',undefined,b)).data.posts.length,0);assert.equal((await call('GET','/api/posts/'+created.id,undefined,b)).status,404);assert.equal((await call('GET','/api/profiles/'+b.id,undefined,a)).status,404);
 assert.equal((await call('GET',new URL(url).pathname+new URL(url).search,undefined,null)).status,404);
 assert.equal((await call('GET','/api/me',undefined,b)).data.profile.following,0);assert.equal((await call('GET','/api/blocks',undefined,b)).data.profiles[0].id,a.id);
 await call('DELETE','/api/profiles/'+a.id+'/block',undefined,b);assert.equal((await call('GET','/api/feed',undefined,b)).data.posts.length,1);
});
test('public IDs follow display names while identity and direct ID edits stay protected',async t=>{
 const {call,users,app}=await fixture(t);const a=users[0],b=users[1];assert.equal(identity(app.db,'test','Alice').id,a.id);assert.match(a.username,/^player_[a-f0-9]{12}$/);
 const before=(await call('GET','/api/me')).data.profile;
 for(const fields of [{username:'changed'},{username:null},{id:b.id},{profileId:b.id},{provider:'steam'},{subject:'different'},{username:'admin',isAdmin:true,role:'moderator'}]){
  const result=await call('PATCH','/api/me',{displayName:'Must not change',bio:'Must not change',...fields});assert.equal(result.status,403);assert.match(result.data.error,/автоматически/);assert.deepEqual((await call('GET','/api/me')).data.profile,before);
 }
 const saved=await call('PATCH','/api/me',{displayName:'Алиса',bio:'Мои кадры'});assert.equal(saved.status,200);assert.equal(saved.data.profile.username,'алиса');assert.equal(saved.data.profile.id,a.id);assert.equal(saved.data.profile.displayName,'Алиса');assert.equal(saved.data.profile.bio,'Мои кадры');
 // An older client can submit the same ID, but cannot rename it.
 assert.equal((await call('PATCH','/api/me',{username:saved.data.profile.username,displayName:'Алиса',bio:'Новые кадры'})).status,200);
 assert.equal((await call('PATCH','/api/me',{username:a.username,displayName:'Боб'},b)).status,403);
 const {setPublicId}=require('../src/moderation.cjs');setPublicId(app.db,a.id,'approved_id','Owner approved');
 assert.equal((await call('GET','/api/me')).data.profile.username,'approved_id');assert.equal((await call('PATCH','/api/me',{username:a.username,displayName:'Stale client'})).status,403);
 const renamed=await call('PATCH','/api/me',{displayName:'После модерации',bio:''});assert.equal(renamed.status,200);assert.equal(renamed.data.profile.username,'после_модерации');assert.equal(identity(app.db,'test','Alice').id,a.id);
 assert.equal((await call('PUT','/api/profiles/'+a.id+'/follow',{})).status,400);
 app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(a.id);assert.equal((await call('GET','/api/me')).status,401);assert.equal((await call('GET','/api/profiles/'+a.id,undefined,b)).status,404);
});

test('storage quota is enforced atomically and data survives reopening',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-server-')),filename=path.join(directory,'db.sqlite');t.after(()=>{assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-server-'));fs.rmSync(directory,{recursive:true,force:true})});
 const f=await fixture(t,{database:filename,storageBytes:100});assert.equal((await f.call('POST','/api/posts',f.post())).status,507);assert.equal((await f.call('GET','/api/feed')).data.posts.length,0);
 const id=f.users[0].id;await f.app.close();const reopened=openStore(filename);assert.equal(identity(reopened,'test','Alice').id,id);reopened.close();
});

test('following pagination filters blocked accounts before choosing its cursor',async t=>{
 const {app,call,users}=await fixture(t);const [viewer,owner]=users;
 const ids=[];for(let i=0;i<45;i++){const p=identity(app.db,'test','page-'+i);ids.push(p.id);app.db.prepare('INSERT INTO follows VALUES(?,?,?)').run(owner.id,p.id,Date.now());}ids.sort();
 for(const id of ids.slice(0,25))app.db.prepare('INSERT INTO blocks VALUES(?,?)').run(viewer.id,id);
 const result=await call('GET','/api/profiles/'+owner.id+'/following');assert.equal(result.status,200);assert.deepEqual(result.data.profiles.map(p=>p.id),ids.slice(25));assert.equal(result.data.nextCursor,null);
});
test('noncanonical image encoding is rejected without running a large recursive regexp',async t=>{
 const {call,post}=await fixture(t);const data=post();data.imageBase64='A'.repeat(4*1024*1024)+'====';assert.equal((await call('POST','/api/posts',data)).status,400);
});

test('likes and follows create private idempotent notifications with unread state',async t=>{
 const {call,users,post}=await fixture(t);const [a,b]=users;const created=(await call('POST','/api/posts',post())).data.post;
 await call('PUT','/api/posts/'+created.id+'/like',{},b);await call('PUT','/api/posts/'+created.id+'/like',{},b);
 await call('PUT','/api/profiles/'+a.id+'/follow',{},b);await call('PUT','/api/profiles/'+a.id+'/follow',{},b);
 await call('PUT','/api/posts/'+created.id+'/like',{},a);
 assert.deepEqual((await call('GET','/api/activity')).data,{unreadNotifications:2,unreadMessages:0});
 const inbox=await call('GET','/api/notifications');assert.equal(inbox.status,200);assert.equal(inbox.data.notifications.length,2);assert.deepEqual(inbox.data.notifications.map(n=>n.kind),['follow','like']);assert(inbox.data.notifications.every(n=>n.actor.id===b.id&&!n.isRead));assert.equal(inbox.data.notifications.find(n=>n.kind==='like').postId,created.id);
 const through=Math.max(...inbox.data.notifications.map(n=>n.id));assert.equal((await call('PUT','/api/notifications/read',{through})).data.unread,0);assert((await call('GET','/api/notifications')).data.notifications.every(n=>n.isRead));
 await call('DELETE','/api/posts/'+created.id+'/like',undefined,b);assert.deepEqual((await call('GET','/api/notifications')).data.notifications.map(n=>n.kind),['follow']);
 await call('DELETE','/api/profiles/'+a.id+'/follow',undefined,b);assert.equal((await call('GET','/api/notifications')).data.notifications.length,0);
});

test('players exchange private idempotent messages with unread counters and blocking',async t=>{
 const {call,users}=await fixture(t);const [a,b,c]=users,requestId=crypto.randomUUID();
 const first=await call('POST','/api/conversations/'+a.id+'/messages',{requestId,text:'Привет из другого города'},b);assert.equal(first.status,201);assert.equal(first.data.message.outgoing,true);
 const repeated=await call('POST','/api/conversations/'+a.id+'/messages',{requestId,text:'Привет из другого города'},b);assert.equal(repeated.status,200);assert.equal(repeated.data.repeated,true);assert.equal(repeated.data.message.id,first.data.message.id);
 assert.equal((await call('POST','/api/conversations/'+a.id+'/messages',{requestId,text:'Другой текст'},b)).status,409);
 const activity=await call('GET','/api/activity');assert.equal(activity.data.unreadMessages,1);assert.equal(activity.data.unreadNotifications,0);
 const inbox=await call('GET','/api/conversations');assert.equal(inbox.data.conversations.length,1);assert.equal(inbox.data.conversations[0].participant.id,b.id);assert.equal(inbox.data.conversations[0].unread,1);assert.equal(inbox.data.conversations[0].lastMessage.text,'Привет из другого города');assert.equal(inbox.data.conversations[0].lastMessage.outgoing,false);
 const thread=await call('GET','/api/conversations/'+b.id+'/messages');assert.equal(thread.data.messages.length,1);assert.equal(thread.data.messages[0].outgoing,false);assert.equal(thread.data.messages[0].isRead,false);
 assert.equal((await call('PUT','/api/conversations/'+b.id+'/read',{})).data.unread,0);assert.equal((await call('GET','/api/conversations/'+b.id+'/messages')).data.messages[0].isRead,true);
 const answer=await call('POST','/api/conversations/'+b.id+'/messages',{requestId:crypto.randomUUID(),text:'Привет!'},a);assert.equal(answer.status,201);assert.equal((await call('GET','/api/conversations',undefined,b)).data.conversations[0].unread,1);
 assert.equal((await call('POST','/api/conversations/'+a.id+'/messages',{requestId:crypto.randomUUID(),text:'x'.repeat(2001)},b)).status,400);assert.equal((await call('GET','/api/conversations/'+a.id+'/messages',undefined,c)).data.messages.length,0);
 await call('PUT','/api/profiles/'+b.id+'/block',{},a);assert.equal((await call('GET','/api/conversations')).data.conversations.length,0);assert.equal((await call('GET','/api/conversations/'+b.id+'/messages')).status,404);assert.equal((await call('POST','/api/conversations/'+a.id+'/messages',{requestId:crypto.randomUUID(),text:'Не пройдёт'},b)).status,404);assert.equal((await call('GET','/api/conversations/'+a.id+'/messages',undefined,a)).status,400);
});
