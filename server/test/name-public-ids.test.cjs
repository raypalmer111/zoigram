'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {openStore,identity,transaction,session,hash}=require('../src/store.cjs');
const {normalizePublicId,resolvePublicId,updateNamePublicId}=require('../src/public-ids.cjs');
const {setPublicId}=require('../src/moderation.cjs');
const {mentionNames,createSocial}=require('../src/social-features.cjs');
function memory(t){const db=openStore(':memory:');t.after(()=>db.close());return db}
function disk(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-name-ids-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-name-ids-'));fs.rmSync(dir,{recursive:true,force:true})});return path.join(dir,'test.sqlite')}
function seed(db,id,name,username=id,created=1){db.prepare('INSERT INTO profiles(id,provider,subject,username,display_name,created_at) VALUES(?,?,?,?,?,?)').run(id,'fixture',id,username,name,created);return db.prepare('SELECT * FROM profiles WHERE id=?').get(id)}
function post(db,owner){return Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(owner,'one','hash','Old caption',1,32,32,Buffer.from('photo'),Buffer.from('thumb'),10).lastInsertRowid)}

test('display names normalize letters, whitespace and compatibility forms without losing supported languages',()=>{
 const cases=[['  Jane   Doe! 📷  ','jane_doe'],['__A___B__','a_b'],['ИВАН Петров ✨','иван_петров'],['김 민수 🎥','김_민수'],['王 小明','王_小明'],['ÉLODIE Müller','élodie_müller'],['ＥＭＭＡ　Ａ','emma_a'],['E\u0301lodie','élodie'],['İPEK','i\u0307pek'],['अनिता','अनिता'],['\u0301A _\u0301B','a_b'],['  👑!💥  ','']];
 for(const [value,expected] of cases)assert.equal(normalizePublicId(value),expected,value);
 const astral='𐐀'.repeat(30);assert.equal(Array.from(normalizePublicId(astral)).length,24);assert.equal(normalizePublicId(astral),'𐐨'.repeat(24));
});

test('name changes automatically replace public IDs while retaining aliases, UUID, credentials and sessions',t=>{
 const db=memory(t),p=identity(db,'local','name-change'),access=session(db,p.id);
 db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?,?)').run(p.id,'private_login','password-hash','recovery-hash',1,1);
 assert.equal(updateNamePublicId(db,p.id,'Jane Doe!'),'jane_doe');
 assert.equal(updateNamePublicId(db,p.id,'Иван Петров'),'иван_петров');
 for(const name of [p.username,'JANE_DOE','@ИВАН_ПЕТРОВ'])assert.equal(resolvePublicId(db,name).id,p.id);
 assert.equal(db.prepare('SELECT display_name FROM profiles WHERE id=?').get(p.id).display_name,'Иван Петров');
 assert.equal(db.prepare('SELECT login FROM account_credentials').get().login,'private_login');
 assert.equal(db.prepare('SELECT profile_id FROM sessions WHERE token_hash=?').get(hash(access.token)).profile_id,p.id);
 assert.equal(identity(db,'local','name-change').id,p.id);
});

test('duplicate names receive bounded suffixes and previous handles cannot be reassigned',t=>{
 const db=memory(t),a=identity(db,'test','a'),b=identity(db,'test','b'),c=identity(db,'test','c'),name='𐐀'.repeat(24);
 const first=updateNamePublicId(db,a.id,name),second=updateNamePublicId(db,b.id,name),third=updateNamePublicId(db,c.id,name);
 assert.equal(first,'𐐨'.repeat(24));assert.equal(second,'𐐨'.repeat(22)+'_2');assert.equal(third,'𐐨'.repeat(22)+'_3');
 assert.equal(Array.from(second).length,24);updateNamePublicId(db,a.id,'Other');
 assert.throws(()=>setPublicId(db,b.id,first,'Cannot take old identity'),/занят/);
 assert.equal(resolvePublicId(db,first).id,a.id);assert.equal(resolvePublicId(db,second).id,b.id);
 updateNamePublicId(db,c.id,'Other');assert.equal(resolvePublicId(db,'other_2').id,c.id);
 assert.equal(updateNamePublicId(db,a.id,name),first);
});

test('empty sanitized names use a stable fallback and single-letter names are valid',t=>{
 const db=memory(t),a=identity(db,'test','symbols'),b=identity(db,'test','short');
 assert.equal(updateNamePublicId(db,a.id,'👑✨'),a.username);
 updateNamePublicId(db,a.id,'Player');assert.equal(updateNamePublicId(db,a.id,'⚡'),a.username);
 assert.equal(updateNamePublicId(db,b.id,'王'),'王');assert.equal(resolvePublicId(db,'王').id,b.id);
});

test('moderator overrides normalize Unicode and persist on identical-name and bio-only saves',t=>{
 const db=memory(t),p=identity(db,'test','override');updateNamePublicId(db,p.id,'Jane Doe');
 assert.equal(setPublicId(db,p.id,' ÉLODIE Müller! ','Requested').publicId,'élodie_müller');
 assert.equal(updateNamePublicId(db,p.id,'Jane Doe'),'élodie_müller');
 transaction(db,()=>{updateNamePublicId(db,p.id,'Jane Doe');db.prepare('UPDATE profiles SET bio=? WHERE id=?').run('New bio',p.id)});
 assert.equal(resolvePublicId(db,'élodie_müller').username,'élodie_müller');
 assert.equal(updateNamePublicId(db,p.id,'Jane DOE'),'jane_doe');
 assert.equal(resolvePublicId(db,'élodie_müller').id,p.id);
 assert.equal(setPublicId(db,'@ÉLODIE_MÜLLER','王','Short handle').publicId,'王');
 assert.throws(()=>setPublicId(db,p.id,'x'.repeat(25),'Too long'),/ID:/);
 assert.throws(()=>setPublicId(db,p.id,'ok','Stale',{expectedPublicId:'élodie_müller'}),error=>error.status===409);
});

test('name and alias changes roll back together with the caller transaction',t=>{
 const db=memory(t),p=identity(db,'test','atomic'),aliases=db.prepare('SELECT * FROM public_id_aliases').all();
 assert.throws(()=>transaction(db,()=>{updateNamePublicId(db,p.id,'Changed Name');throw Error('Abort other profile changes')}),/Abort/);
 assert.deepEqual(db.prepare('SELECT * FROM profiles WHERE id=?').get(p.id),p);
 assert.deepEqual(db.prepare('SELECT * FROM public_id_aliases').all(),aliases);
 assert.equal(resolvePublicId(db,'changed_name'),null);
 transaction(db,()=>{const created=identity(db,'test','created-inside-account-transaction');assert(created.id)});
});

test('Unicode mentions enforce full boundaries, normalize case and accept short actual names',()=>{
 assert.deepEqual(mentionNames('@ИВАН_ПЕТРОВ @王 @김_민수 @E\u0301LODIE @İPEK @अनिता'),['иван_петров','王','김_민수','élodie','i\u0307pek','अनिता']);
 assert.deepEqual(mentionNames('имя@пример.рф email+@name @@王 x_@王 x\u0301@王 @'+ '𐐀'.repeat(25)),[]);
 assert.deepEqual(mentionNames('(@王), @a! @Ａ'),['王','a']);
});

test('old and new mention handles deduplicate by stable account and keep read notification identity',t=>{
 const db=memory(t),author=identity(db,'test','author'),recipient=identity(db,'test','recipient'),id=post(db,author.id),social=createSocial({db,clock:()=>100});
 updateNamePublicId(db,recipient.id,'Иван Петров');social.syncMentions(id,author.id,'@'+recipient.username+' @ИВАН_ПЕТРОВ');
 const original=db.prepare('SELECT * FROM notifications').get();assert.equal(original.profile_id,recipient.id);assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,1);
 db.prepare('UPDATE notifications SET read_at=123 WHERE id=?').run(original.id);updateNamePublicId(db,recipient.id,'王');
 social.syncMentions(id,author.id,'@'+recipient.username+' @иван_петров @王');
 const after=db.prepare('SELECT * FROM notifications').get();assert.equal(after.id,original.id);assert.equal(after.read_at,123);
 db.prepare('INSERT INTO blocks VALUES(?,?)').run(recipient.id,author.id);social.syncMentions(id,author.id,'@王 @иван_петров');assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n,0);
});

test('canonical lookup supports direct legacy fixtures with no alias rows or table',t=>{
 const db=memory(t),p=seed(db,'legacy','Fixture','legacy_name');assert.equal(resolvePublicId(db,'LEGACY_NAME').id,p.id);
 db.exec('DROP TABLE public_id_aliases');assert.equal(resolvePublicId(db,'LEGACY_NAME').id,p.id);
 assert.equal(resolvePublicId(db,'not_present'),null);assert.equal(resolvePublicId(db,'@invalid!'),null);
});

test('schema10 migration is deterministic, reserves all old IDs and leaves placeholder accounts unchanged',t=>{
 const filename=disk(t);let db=openStore(filename);
 seed(db,'b','Same Name','old_b',2);seed(db,'a','Same Name','old_a',1);seed(db,'c','Elsewhere','same_name',3);seed(db,'d','Новый игрок','player_placeholder',0);
 db.exec('DROP TABLE public_id_aliases;DROP TABLE creator_grants;PRAGMA user_version=10');db.close();
 db=openStore(filename);try{
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,11);
  assert.deepEqual(db.prepare('SELECT id,username FROM profiles ORDER BY id').all().map(p=>[p.id,p.username]),[['a','same_name_2'],['b','same_name_3'],['c','elsewhere'],['d','player_placeholder']]);
  for(const [name,id] of [['old_a','a'],['old_b','b'],['same_name','c'],['player_placeholder','d']])assert.equal(resolvePublicId(db,name).id,id);
  assert.equal(updateNamePublicId(db,'d','Actual Name'),'actual_name');
  setPublicId(db,'a','manual_override','Keep after restart');
  db.prepare('INSERT INTO creator_grants VALUES(?,?,?,?)').run('a',1,1,123);assert.throws(()=>db.prepare('INSERT INTO creator_grants VALUES(?,?,?,?)').run('b',3,1,123));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close()}
 db=openStore(filename);try{assert.equal(db.prepare('SELECT username FROM profiles WHERE id=?').get('a').username,'manual_override');assert.equal(db.prepare('SELECT COUNT(*) n FROM creator_grants').get().n,1);assert.equal(resolvePublicId(db,'same_name_2').id,'a')}finally{db.close()}
});

test('name migration preserves relation rows, notification read state and deleted-row sequence',t=>{
 const filename=disk(t);let db=openStore(filename);const owner=seed(db,'owner','Owner Name','old_owner'),actor=seed(db,'actor','Actor Name','old_actor'),id=post(db,owner.id);
 db.prepare('INSERT INTO follows VALUES(?,?,?)').run(actor.id,owner.id,7);db.prepare('INSERT INTO likes VALUES(?,?)').run(actor.id,id);db.prepare('INSERT INTO pinned_posts VALUES(?,?)').run(id,9);
 db.prepare("INSERT INTO notifications(id,profile_id,actor_id,kind,post_id,created_at,read_at) VALUES(41,?,?,'mention',?,1,2)").run(owner.id,actor.id,id);
 db.prepare("INSERT INTO notifications(id,profile_id,actor_id,kind,post_id,created_at) VALUES(900,?,?,'like',?,1)").run(owner.id,actor.id,id);db.exec('DELETE FROM notifications WHERE id=900');
 const before={};for(const table of ['posts','follows','likes','pinned_posts','notifications'])before[table]=db.prepare('SELECT * FROM '+table).all();
 db.exec('DROP TABLE public_id_aliases;DROP TABLE creator_grants;PRAGMA user_version=10');db.close();db=openStore(filename);
 try{for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows,table);assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='notifications'").get().seq,900);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])}finally{db.close()}
});

test('failed name migration rolls back IDs, alias reservations and schema version',t=>{
 const filename=disk(t);let db=openStore(filename);seed(db,'a','First Name','old_a');seed(db,'b','Second Name','old_b');
 db.exec("DROP TABLE public_id_aliases;DROP TABLE creator_grants;PRAGMA user_version=10;CREATE TRIGGER fail_name BEFORE UPDATE OF username ON profiles WHEN NEW.id='b' BEGIN SELECT RAISE(ABORT,'fixture migration failure'); END;");db.close();
 assert.throws(()=>openStore(filename),/fixture migration failure/);db=new DatabaseSync(filename);
 try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,10);assert.deepEqual(db.prepare('SELECT username FROM profiles ORDER BY id').all().map(p=>p.username),['old_a','old_b']);assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='public_id_aliases'").get(),undefined);db.exec('DROP TRIGGER fail_name')}finally{db.close()}
 db=openStore(filename);try{assert.equal(resolvePublicId(db,'first_name').id,'a');assert.equal(resolvePublicId(db,'second_name').id,'b')}finally{db.close()}
});
