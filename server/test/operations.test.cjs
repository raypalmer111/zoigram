'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../src/app.cjs'),{identity,session,random,hash,openStore}=require('../src/store.cjs'),{createOperations}=require('../src/operations.cjs'),{createAnnouncements}=require('../src/announcements.cjs');
const origin='https://zoigram.example',fail=(status,message)=>{throw Object.assign(Error(message),{status})};
async function fixture(t){
 const ownerId=crypto.randomUUID(),app=createApp({database:':memory:',origin,ownerProfileId:ownerId,secret:Buffer.alloc(32,7)});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 app.db.prepare('INSERT INTO profiles(id,provider,subject,username,display_name,created_at) VALUES(?,?,?,?,?,?)').run(ownerId,'test','owner','owner','Owner',Date.now());const player=identity(app.db,'test','player'),access=session(app.db,player.id),token=random(),adminId=crypto.randomUUID();app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(adminId,hash(token),ownerId,Date.now()+3600000);
 const base='http://127.0.0.1:'+app.server.address().port,cookie='__Host-zoigram_admin='+token;
 const request=(url,o={})=>fetch(base+url,{...o,headers:{...o.headers}});const csrf=(await(await request('/admin/api/session',{headers:{Cookie:cookie}})).json()).csrfToken;
 async function admin(url,body,headers={}){const r=await request(url,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),headers:r.headers}}
 async function game(url,body,headers={}){const r=await request(url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+access.token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
 return {app,ownerId,player,access,admin,game,request,cookie};
}
const announcement=(extra={})=>({title:'Service update',body:'Photo uploads are improved.',kind:'update',active:true,...extra});
test('operations, errors and announcements require a current owner admin cookie; writes also require origin and CSRF',async t=>{
 const f=await fixture(t),wrong=random();f.app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(random(),hash(wrong),f.player.id,Date.now()+60000);
 for(const route of ['/admin/api/operations','/admin/api/errors','/admin/api/announcements']){
  for(const headers of [{Cookie:''},{Cookie:'',Authorization:'Bearer '+f.access.token},{Cookie:'__Host-zoigram_admin='+wrong}])assert.equal((await f.admin(route,undefined,headers)).status,401);
  const good=await f.admin(route);assert.equal(good.status,200);assert.equal(good.headers.get('access-control-allow-origin'),null);assert.equal((await f.admin(route,undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
 }
 for(const headers of [{'X-CSRF-Token':''},{'X-CSRF-Token':random()},{Origin:''},{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.admin('/admin/api/announcements',announcement(),headers)).status,403);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM announcements').get().n,0);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,0);
 f.app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(f.ownerId);assert.equal((await f.admin('/admin/api/operations')).status,401);
});
test('diagnostics accept only fixed codes and persist no submitted paths, secrets or raw error text',async t=>{
 const f=await fixture(t),secret='sensitive-password-token-value',raw={code:'photo_read',message:secret,path:'C:/Users/private/name.png',route:'/api/auth/'+secret,imageBytes:9300000};
 assert.equal((await f.game('/api/diagnostics',raw,{'X-Zoigram-Version':'0.8.0'})).status,202);assert.equal((await f.game('/api/diagnostics',{...raw,code:secret})).status,400);
 assert.equal((await f.game('/api/diagnostics',{code:'photo_size',imageBytes:2**40},{'X-Zoigram-Version':secret})).status,202);
 assert.equal((await f.game('/api/uploads',{requestId:secret,count:6,caption:secret},{'X-Zoigram-Version':secret})).status,400);
 const rows=(await f.admin('/admin/api/errors')).body.items;assert.equal(rows.length,3);assert(!JSON.stringify(rows).includes(secret));assert(!JSON.stringify(rows).includes('C:/Users'));assert.equal(rows[0].source,'server');assert.equal(rows[0].route,'upload');assert.equal(rows[0].client_version,'unknown');assert.equal(rows[1].image_bytes,null);assert.equal(rows[2].image_bytes,9300000);assert.equal(rows[2].client_version,'0.8.0');assert.equal(rows[2].profile_id,f.player.id);
 const filtered=(await f.admin('/admin/api/errors?source=client')).body.items;assert.equal(filtered.length,2);assert(filtered.every(r=>r.source==='client'));
 const unauthenticated=await f.request('/api/diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(raw)});assert.equal(unauthenticated.status,401);
});
test('error history paginates without gaps and cleans both age and total count',t=>{
 const db=openStore(':memory:');t.after(()=>db.close());let now=20*86400000;const ops=createOperations({db,budget:100000,gate:{active:0},clock:()=>now});
 for(let i=0;i<63;i++)ops.record({source:'client',code:'network',clientVersion:'0.8.0'});const first=ops.list(new URLSearchParams()),second=ops.list(new URLSearchParams({before:first.nextCursor}));assert.equal(first.items.length,50);assert.equal(second.items.length,13);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,63);assert.equal(second.nextCursor,null);
 now+=15*86400000;ops.clean();assert.equal(db.prepare('SELECT COUNT(*) n FROM operational_errors').get().n,0);
 db.exec('BEGIN');const insert=db.prepare('INSERT INTO operational_errors(created_at,source,code,status,client_version,route) VALUES(?,?,?,?,?,?)');for(let i=0;i<5051;i++)insert.run(now,'server','busy',503,'unknown','upload');db.exec('COMMIT');ops.clean();assert.equal(db.prepare('SELECT COUNT(*) n FROM operational_errors').get().n,5000);
});
test('operations expose committed and staged storage separately, bounded active work and backup freshness',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-operations-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-operations-'));fs.rmSync(dir,{recursive:true,force:true})});
 const db=openStore(':memory:');t.after(()=>db.close());const p=identity(db,'test','usage');db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id,'usage_post','hash','',1,64,64,Buffer.from('a'),Buffer.from('b'),700);
 db.prepare('INSERT INTO upload_sessions(profile_id,request_id,caption,photo_count,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(p.id,'usage_upload','',1,1,99999999);db.prepare('INSERT INTO upload_parts VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id,'usage_upload',0,'digest',500,64,64,Buffer.from('a'),Buffer.from('b'),150);
 let now=10000000;const ops=createOperations({db,budget:1000,gate:{active:1},clock:()=>now,dataDirectory:dir,backupDirectory:dir});let snapshot=ops.snapshot();assert.equal(snapshot.storage.media,700);assert.equal(snapshot.storage.staged,150);assert.equal(snapshot.storage.quota,1000);assert.equal(snapshot.uploads.active,1);assert.equal(snapshot.uploads.maximum,2);assert.equal(snapshot.uploads.pending,1);assert(snapshot.warnings.includes('media_quota'));assert(snapshot.warnings.includes('backup_attention'));assert(snapshot.disk.total>0);
 const status={format:'zoigram-backup-status-v1',lastSuccessAt:now,intervalSeconds:3600,lastError:null,lastRestoreTest:{ok:true,at:now}};fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify(status));snapshot=ops.snapshot();assert.equal(snapshot.backups.available,true);assert.equal(snapshot.backups.stale,false);assert(!snapshot.warnings.includes('backup_attention'));assert(!snapshot.warnings.includes('restore_attention'));
 now+=9*86400000;snapshot=ops.snapshot();assert(snapshot.warnings.includes('backup_attention'));assert(snapshot.warnings.includes('restore_attention'));fs.writeFileSync(path.join(dir,'status.json'),'broken');assert.equal(ops.snapshot().backups.available,false);
});
test('announcement schedules, expiration, hiding and revision conflicts are atomic and retain audit history',t=>{
 const db=openStore(':memory:');t.after(()=>db.close());let now=10000000;const api=createAnnouncements({db,fail,clock:()=>now}),owner='owner-test';
 const live=api.save(announcement({startsAt:now-100,endsAt:now+100}),owner),future=api.save(announcement({title:'Later',startsAt:now+100,endsAt:now+200}),owner);api.save(announcement({title:'Hidden',active:false}),owner);assert.deepEqual(api.live().map(x=>x.id),[live.id]);
 now+=100;assert.deepEqual(api.live().map(x=>x.id),[future.id]);const edited=api.save(announcement({id:future.id,expectedRevision:1,title:'Revised',startsAt:now,endsAt:now+100}),owner);assert.equal(edited.revision,2);assert.throws(()=>api.save(announcement({id:future.id,expectedRevision:1}),owner),{status:409});assert.equal(db.prepare('SELECT COUNT(*) n FROM moderation').get().n,4);
 now+=100;assert.deepEqual(api.live(),[]);const hidden=api.save(announcement({id:future.id,expectedRevision:2,active:false}),owner);assert.equal(hidden.revision,3);assert.deepEqual(api.live(),[]);const audit=db.prepare('SELECT * FROM moderation ORDER BY id DESC LIMIT 1').get();assert.equal(audit.action,'announcement');assert.equal(JSON.parse(audit.reason).actorId,owner);
});
test('owner announcements reach authenticated feed as plain content, and invalid edits leave no audit entry',async t=>{
 const f=await fixture(t),body=announcement({title:'<img src=x onerror=alert(1)>',body:'First line\n<script>doNotRun()</script>'}),saved=await f.admin('/admin/api/announcements',body);assert.equal(saved.status,200);assert.equal(saved.body.title,body.title);assert.equal(saved.body.body,body.body);
 const live=await f.game('/api/announcements');assert.equal(live.status,200);assert.equal(live.body.announcements[0].id,saved.body.id);const feed=await f.game('/api/feed');assert.equal(feed.body.announcements[0].id,saved.body.id);
 for(const patch of [{title:''},{body:'x'.repeat(1201)},{kind:'html'},{active:'true'},{startsAt:1,endsAt:1},{title:'bad\u0000'}])assert.equal((await f.admin('/admin/api/announcements',{...body,...patch})).status,400);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM announcements').get().n,1);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM moderation').get().n,1);
});
test('announcement list is bounded, with the newest three active entries shown and existing entries still editable',t=>{
 const db=openStore(':memory:');t.after(()=>db.close());let now=10000000;const api=createAnnouncements({db,fail,clock:()=>now});let first;
 for(let i=0;i<100;i++){const item=api.save(announcement({title:'Announcement '+i}), 'owner');first??=item;now++}
 assert.deepEqual(api.live().map(x=>x.title),['Announcement 99','Announcement 98','Announcement 97']);assert.equal(api.list().items.length,100);assert.throws(()=>api.save(announcement(),'owner'),{status:409});
 const revised=api.save(announcement({id:first.id,expectedRevision:1,title:'First announcement revised'}),'owner');assert.equal(revised.revision,2);assert.equal(api.live()[0].id,first.id);assert.equal(api.list().items.length,100);
});
