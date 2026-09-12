'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {createApp}=require('../src/app.cjs'),{identity,session,random}=require('../src/store.cjs');
test('unread inbox filters before pagination, honors blocks and bans, and disappears after reading',async t=>{
 const app=createApp({database:':memory:',origin:'https://example.test'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const db=app.db,owner=identity(db,'test','owner'),token=session(db,owner.id).token,base='http://127.0.0.1:'+app.server.address().port;
 const call=async(p,method='GET')=>{const r=await fetch(base+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='PUT'?{body:'{}'}:{})});return {status:r.status,body:await r.json()}};
 const expected=[];for(let i=0;i<65;i++){const peer=identity(db,'test','peer'+i),unread=i<25;db.prepare('INSERT INTO direct_messages(sender_id,recipient_id,request_id,text,created_at,read_at) VALUES(?,?,?,?,?,?)').run(peer.id,owner.id,random(),'hello',1,unread?null:2);if(unread)expected.unshift(peer.id)}
 // The last message can be outgoing while earlier incoming messages are unread.
 db.prepare('INSERT INTO direct_messages(sender_id,recipient_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(owner.id,expected.at(-1),random(),'reply',3);expected.unshift(expected.pop());
 db.prepare('INSERT INTO blocks VALUES(?,?)').run(owner.id,expected[1]);db.prepare('INSERT INTO blocks VALUES(?,?)').run(expected[2],owner.id);db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(expected[3]);const visible=expected.filter((_,i)=>![1,2,3].includes(i));
 let cursor;const found=[];do{const r=await call('/api/conversations?filter=unread'+(cursor?'&before='+cursor:''));assert.equal(r.status,200);assert(r.body.conversations.every(x=>x.unread>0));found.push(...r.body.conversations.map(x=>x.participant.id));cursor=r.body.nextCursor}while(cursor);assert.deepEqual(found,visible);assert.equal(found.length,22);
 await call('/api/conversations/'+visible[0]+'/read','PUT');const after=await call('/api/conversations?filter=unread');assert(!after.body.conversations.some(x=>x.participant.id===visible[0]));
 assert.deepEqual((await call('/api/conversations')).body,(await call('/api/conversations?filter=all')).body);
 assert.equal((await call('/api/conversations?filter=unknown')).status,400);assert.equal((await call('/api/conversations?filter=unread&before=bad')).status,400);
});
