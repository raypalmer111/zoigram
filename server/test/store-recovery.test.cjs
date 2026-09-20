'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite'),{openStore,identity,transaction}=require('../src/store.cjs');
test('startup repairs an interrupted upload generation migration and preserves existing generations',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-migration-')),file=path.join(directory,'db.sqlite');let db;
 t.after(()=>{db?.close();const target=path.resolve(directory);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert(/^zoigram-migration-[A-Za-z0-9]+$/.test(path.basename(target)));assert.equal(fs.realpathSync(target),target);fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:100})});
 db=openStore(file);const user=identity(db,'test','interrupted-migration');
 db.exec('ALTER TABLE upload_sessions DROP COLUMN generation');
 const now=Date.now(),insert=db.prepare('INSERT INTO upload_sessions(profile_id,request_id,caption,photo_count,created_at,expires_at) VALUES(?,?,?,?,?,?)');
 insert.run(user.id,'unfinished-row','preserve caption',1,now,now+60000);insert.run(user.id,'completed-row','other caption',1,now,now+60000);
 db.exec('ALTER TABLE upload_sessions ADD COLUMN generation TEXT');db.prepare('UPDATE upload_sessions SET generation=? WHERE request_id=?').run('existing-generation','completed-row');
 db.close();db=openStore(file);const rows=db.prepare('SELECT request_id,generation,caption FROM upload_sessions ORDER BY request_id').all();
 assert.equal(rows[0].generation,'existing-generation');assert.match(rows[1].generation,/^[a-f0-9]{32}$/);assert.equal(rows[1].caption,'preserve caption');assert.equal(db.prepare('PRAGMA user_version').get().user_version,11);
 db.close();db=openStore(file);assert.deepEqual(db.prepare('SELECT request_id,generation,caption FROM upload_sessions ORDER BY request_id').all(),rows);assert.equal(db.prepare('SELECT COUNT(*) n FROM profiles').get().n,1);
});

test('SQLite implicit rollback preserves the original storage or constraint error and leaves no partial rows',()=>{
 for(const cause of ['storage','constraint']){
  const db=new DatabaseSync(':memory:');let original;
  try{
   db.exec('CREATE TABLE pressure(id INTEGER PRIMARY KEY,data BLOB); PRAGMA max_page_count=4;');
   assert.throws(()=>transaction(db,()=>{
    db.prepare('INSERT INTO pressure VALUES(?,?)').run(1,Buffer.from('first write'));
    try{if(cause==='storage')db.prepare('INSERT INTO pressure VALUES(2,zeroblob(?))').run(131072);else db.exec('INSERT OR ROLLBACK INTO pressure(id) VALUES(1)');}catch(error){original=error;throw error;}
   }),error=>{assert.strictEqual(error,original);assert.equal(error.code,'ERR_SQLITE_ERROR');assert.equal(error.errcode,cause==='storage'?13:1555);assert(!error.message.includes('cannot rollback'));return true;});
   assert.equal(db.isTransaction,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM pressure').get().n,0);
   transaction(db,()=>db.exec('INSERT INTO pressure(id) VALUES(3)'));assert.equal(db.prepare('SELECT id FROM pressure').get().id,3);
  }finally{db.close();}
 }
});

test('a failed deferred constraint at commit rolls back pending writes and the connection remains usable',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);');
  assert.throws(()=>transaction(db,()=>db.exec('INSERT INTO child VALUES(1)')),error=>{assert.equal(error.errcode,787);return true;});
  assert.equal(db.isTransaction,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM child').get().n,0);
  transaction(db,()=>db.exec('INSERT INTO parent VALUES(1); INSERT INTO child VALUES(1)'));assert.equal(db.prepare('SELECT COUNT(*) n FROM child').get().n,1);
 }finally{db.close();}
});
