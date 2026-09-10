'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {openStore,identity,session,hash}=require('../src/store.cjs');
const {setPublicId}=require('../src/moderation.cjs');

test('moderator changes the public ID, preserves ownership and sessions, and records both IDs',t=>{
 const db=openStore(':memory:');t.after(()=>db.close());const a=identity(db,'test','owner'),b=identity(db,'test','follower'),access=session(db,a.id);
 const postId=db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(a.id,'request-1','hash','A photo',Date.now(),64,64,Buffer.from('photo'),Buffer.from('thumb'),10).lastInsertRowid;
 db.prepare('INSERT INTO follows VALUES(?,?,?)').run(b.id,a.id,Date.now());db.prepare('INSERT INTO likes VALUES(?,?)').run(b.id,postId);
 const result=setPublicId(db,'@'+a.username.toUpperCase(),' New_ID ','По просьбе владельца');assert.equal(result.changed,true);assert.equal(result.publicId,'new_id');
 const after=identity(db,'test','owner');assert.deepEqual({...after,username:a.username},{...a});assert.equal(after.id,a.id);assert.equal(after.username,'new_id');
 assert.equal(db.prepare('SELECT profile_id FROM posts WHERE id=?').get(postId).profile_id,a.id);assert.equal(db.prepare('SELECT following_id FROM follows').get().following_id,a.id);assert.equal(db.prepare('SELECT COUNT(*) n FROM likes').get().n,1);
 assert.equal(db.prepare('SELECT profile_id FROM sessions WHERE token_hash=?').get(hash(access.token)).profile_id,a.id);
 const audit=db.prepare('SELECT * FROM moderation').get();assert.equal(audit.action,'set-id');assert.equal(audit.target_id,a.id);assert.deepEqual(JSON.parse(audit.reason),{reason:'По просьбе владельца',previousId:a.username,publicId:'new_id'});
 assert.equal(setPublicId(db,a.id,'new_id','Already assigned').changed,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM moderation').get().n,1);
});

test('invalid, missing and conflicting IDs leave both profile and audit unchanged',t=>{
 const db=openStore(':memory:');t.after(()=>db.close());const a=identity(db,'test','a'),b=identity(db,'test','b');
 for(const newId of ['', 'ab','a'.repeat(25),'имя','with space','with-dash','@name'])assert.throws(()=>setPublicId(db,a.id,newId,'Reason'),/ID:/);
 assert.throws(()=>setPublicId(db,a.id,'valid',' '),/причину/);assert.throws(()=>setPublicId(db,a.id,'valid','a'.repeat(1001)),/причину/);
 assert.throws(()=>setPublicId(db,'@missing','valid','Reason'),/не найден/);assert.throws(()=>setPublicId(db,a.id,b.username.toUpperCase(),'Reason'),/занят/);
 assert.deepEqual(identity(db,'test','a'),a);assert.equal(db.prepare('SELECT COUNT(*) n FROM moderation').get().n,0);
});

test('owner CLI lists IDs and performs a persistent audited change in an isolated database',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-admin-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-admin-'));fs.rmSync(dir,{recursive:true,force:true})});
 const filename=path.join(dir,'zoigram.sqlite'),db=openStore(filename),a=identity(db,'test','cli');db.close();
 const run=(...args)=>cp.spawnSync(process.execPath,[path.resolve(__dirname,'../tools/admin.cjs'),...args],{env:{...process.env,DATA_DIR:dir},encoding:'utf8',windowsHide:true});
 const listing=run('profiles','@'+a.username);assert.equal(listing.status,0,listing.stderr);assert.equal(JSON.parse(listing.stdout)[0].id,a.id);
 const change=run('set-id','@'+a.username,'creator','Approved by owner');assert.equal(change.status,0,change.stderr);assert.equal(JSON.parse(change.stdout).publicId,'creator');
 const missingReason=run('set-id',a.id,'other');assert.equal(missingReason.status,1);
 const reopened=openStore(filename);try{assert.equal(identity(reopened,'test','cli').username,'creator');assert.equal(JSON.parse(reopened.prepare('SELECT reason FROM moderation').get().reason).reason,'Approved by owner')}finally{reopened.close()}
});
