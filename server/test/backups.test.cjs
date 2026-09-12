'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {openStore,identity,session,hash}=require('../src/store.cjs');
const {createBackup,verifyBackup,restoreBackup}=require('../src/backups.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-backup-')),data=path.join(root,'data'),copies=path.join(root,'backups');fs.mkdirSync(data);
 const db=openStore(path.join(data,'zoigram.sqlite'));fs.writeFileSync(path.join(data,'media.key'),crypto.randomBytes(32));
 const owner=identity(db,'test','backup-owner'),follower=identity(db,'test','backup-follower'),access=session(db,owner.id);
 db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?,?)').run(owner.id,'backup_private_login','synthetic-hash','synthetic-recovery-hash',Date.now(),Date.now());
 const image=Buffer.from('image-data'),thumbnail=Buffer.from('thumbnail-data');
 db.prepare('INSERT INTO avatars VALUES(?,?,?,?,?)').run(owner.id,Buffer.from('avatar-data'),11,'backup-avatar-revision',Date.now());
 const post=Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner.id,'backup-request','hash','Кадр 🌆',Date.now(),64,64,image,thumbnail,image.length+thumbnail.length).lastInsertRowid);
 db.prepare('INSERT INTO profile_verifications VALUES(?,?,?,?)').run(owner.id,1,1,Date.now());db.prepare('INSERT INTO post_like_bonuses VALUES(?,?,?,?)').run(post,5,1,Date.now());
 db.prepare('INSERT INTO follows VALUES(?,?,?)').run(follower.id,owner.id,Date.now());db.prepare('INSERT INTO likes VALUES(?,?)').run(follower.id,post);
 db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(follower.id,post,'comment-request','Красиво',Date.now());
 t.after(()=>{db.close();assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-backup-'));fs.rmSync(root,{recursive:true,force:true})});
 return {root,data,copies,db,owner,access,image,thumbnail,post};
}
test('a live WAL database restores IDs, media, sessions and relationships into a separate empty directory',async t=>{
 const f=fixture(t),made=await createBackup(f.data,f.copies),verified=await verifyBackup(made.directory);
 assert.equal(verified.database.counts.avatars,1);assert.equal(verified.database.counts.posts,1);assert.equal(verified.database.counts.likes,1);
 const target=path.join(f.root,'restored');await restoreBackup(made.directory,target);assert.deepEqual(fs.readFileSync(path.join(target,'media.key')),fs.readFileSync(path.join(f.data,'media.key')));
 const restored=new DatabaseSync(path.join(target,'zoigram.sqlite'));
 try{assert.deepEqual(restored.prepare('SELECT * FROM profiles WHERE id=?').get(f.owner.id),f.owner);assert.equal(restored.prepare('SELECT profile_id FROM sessions WHERE token_hash=?').get(hash(f.access.token)).profile_id,f.owner.id);const post=restored.prepare('SELECT * FROM posts WHERE id=?').get(f.post);const avatar=restored.prepare('SELECT * FROM avatars WHERE profile_id=?').get(f.owner.id);assert.equal(restored.prepare('SELECT verified FROM profile_verifications WHERE profile_id=?').get(f.owner.id).verified,1);assert.equal(restored.prepare('SELECT amount FROM post_like_bonuses WHERE post_id=?').get(f.post).amount,5);assert.equal(avatar.revision,'backup-avatar-revision');assert.equal(Buffer.from(avatar.image).toString(),'avatar-data');assert.equal(post.caption,'Кадр 🌆');assert.deepEqual(Buffer.from(post.image),f.image);assert.deepEqual(Buffer.from(post.thumbnail),f.thumbnail);assert.equal(restored.prepare('SELECT COUNT(*) n FROM comments').get().n,1);assert.equal(restored.prepare('SELECT COUNT(*) n FROM follows').get().n,1)}finally{restored.close()}
 const credentials=new DatabaseSync(path.join(target,'zoigram.sqlite'));try{assert.deepEqual(credentials.prepare('SELECT * FROM account_credentials WHERE profile_id=?').get(f.owner.id),f.db.prepare('SELECT * FROM account_credentials WHERE profile_id=?').get(f.owner.id))}finally{credentials.close()}
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM posts').get().n,1);
});
test('a pre-0.14 snapshot verifies and migrates without inventing tables in its signed manifest',async t=>{
 const f=fixture(t);f.db.exec('DROP TABLE profile_verifications; DROP TABLE post_like_bonuses; DROP TABLE account_credentials; DROP TABLE account_links; DROP TABLE account_flows; DROP TABLE avatars; DROP TABLE avatar_uploads; DROP TABLE notifications; DROP TABLE direct_messages; PRAGMA user_version=2');
 const made=await createBackup(f.data,f.copies),verified=await verifyBackup(made.directory);assert.equal(verified.database.schemaVersion,2);assert(!Object.hasOwn(verified.database.counts,'notifications'));assert(!Object.hasOwn(verified.database.counts,'direct_messages'));
 const target=path.join(f.root,'legacy-restored');await restoreBackup(made.directory,target);const migrated=openStore(path.join(target,'zoigram.sqlite'));try{assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,7);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM notifications').get().n,0);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM direct_messages').get().n,0);assert.equal(migrated.prepare('SELECT COUNT(*) n FROM posts').get().n,1)}finally{migrated.close()}
});
test('corrupted files cannot restore and a nonempty destination is never overwritten',async t=>{
 const f=fixture(t),made=await createBackup(f.data,f.copies);await assert.rejects(()=>restoreBackup(made.directory,f.data),/empty directory/);
 const key=path.join(made.directory,'media.key');fs.writeFileSync(key,Buffer.alloc(32,1));await assert.rejects(()=>verifyBackup(made.directory),/checksum mismatch/);
 const target=path.join(f.root,'bad-restore');await assert.rejects(()=>restoreBackup(made.directory,target),/checksum mismatch/);assert(!fs.existsSync(target));
});
test('retention removes only complete known snapshots after a successful new backup',async t=>{
 const f=fixture(t);fs.mkdirSync(f.copies);fs.writeFileSync(path.join(f.copies,'old-manual.sqlite'),'preserve');fs.mkdirSync(path.join(f.copies,'.partial-interrupted'));fs.writeFileSync(path.join(f.copies,'.partial-interrupted','keep'),'preserve');
 const first=await createBackup(f.data,f.copies,{keep:2});await new Promise(r=>setTimeout(r,5));await createBackup(f.data,f.copies,{keep:2});await new Promise(r=>setTimeout(r,5));const last=await createBackup(f.data,f.copies,{keep:2});assert.equal(last.removed.length,1);assert(!fs.existsSync(first.directory));assert(fs.existsSync(path.join(f.copies,'old-manual.sqlite')));assert(fs.existsSync(path.join(f.copies,'.partial-interrupted','keep')));
 const before=fs.readdirSync(f.copies).sort();fs.unlinkSync(path.join(f.data,'media.key'));await assert.rejects(()=>createBackup(f.data,f.copies,{keep:2}));assert.deepEqual(fs.readdirSync(f.copies).sort(),before);
});
test('missing source database is refused without creating an empty replacement',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-backup-'));t.after(()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-backup-'));fs.rmSync(root,{recursive:true,force:true})});
 await assert.rejects(()=>createBackup(path.join(root,'missing'),path.join(root,'backups')));assert(!fs.existsSync(path.join(root,'missing')));
});
