'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createBackup,verifyBackup}=require('../src/backups.cjs');
const {createBackupMonitor,runBackupWorker,rehearseRestore,readStatus,FORMAT,RESTORE_INTERVAL_MS}=require('../src/backup-monitor.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-monitor-')),data=path.join(root,'data'),backups=path.join(root,'backups');fs.mkdirSync(data);
 const db=new DatabaseSync(path.join(data,'zoigram.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE profiles(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE posts(id INTEGER PRIMARY KEY,profile_id INTEGER REFERENCES profiles(id),image BLOB); PRAGMA user_version=9');
 db.prepare('INSERT INTO profiles VALUES(?,?)').run(1,'Private test account');
 db.prepare('INSERT INTO posts VALUES(?,?,?)').run(1,1,Buffer.from('photo data'));
 const key=crypto.randomBytes(32);fs.writeFileSync(path.join(data,'media.key'),key);fs.writeFileSync(path.join(data,'production-marker.txt'),'keep');
 t.after(()=>{db.close();const resolved=path.resolve(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert(/^zoigram-monitor-[A-Za-z0-9]+$/.test(path.basename(resolved)));assert.equal(fs.realpathSync(root),resolved);fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 let time=Date.now();
 const monitor=options=>createBackupMonitor({dataDirectory:data,backupDirectory:backups,clock:()=>time,...options});
 return {root,data,backups,db,key,monitor,now:()=>time,advance:ms=>{time+=ms;}};
}
function unchangedSource(f){
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM profiles').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM posts').get().n,1);
 assert.equal(f.db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
 assert.equal(Buffer.from(f.db.prepare('SELECT image FROM posts').get().image).toString(),'photo data');
 assert.deepEqual(fs.readFileSync(path.join(f.data,'media.key')),f.key);
 assert.equal(fs.readFileSync(path.join(f.data,'production-marker.txt'),'utf8'),'keep');
 assert(!fs.existsSync(path.join(f.data,'.restoring')));
}
test('first successful backup writes atomic status and rehearses restore without touching the live WAL database',async t=>{
 const f=fixture(t),status=await f.monitor().cycle();
 assert.equal(status.format,FORMAT);assert.equal(status.lastAttemptAt,f.now());assert.equal(status.lastSuccessAt,f.now());assert.equal(status.nextDueAt,f.now()+86400000);assert.equal(status.lastError,null);assert.equal(status.inProgress,false);
 assert.deepEqual(status.lastRestoreTest,{at:f.now(),ok:true,durationMs:0});assert(status.lastBackup.bytes>32);assert.equal(status.lastBackup.schemaVersion,9);
 const snapshot=await verifyBackup(path.join(f.backups,status.lastBackup.name));assert.equal(snapshot.database.counts.posts,1);assert.equal(snapshot.database.counts.profiles,1);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.backups,'status.json'),'utf8')),status);
 assert(!fs.readdirSync(f.backups).some(name=>name.startsWith('.restore-check-')||name.startsWith('.status-')));
 unchangedSource(f);
});
test('restore checks persist across worker restarts and run again at the weekly boundary',async t=>{
 const f=fixture(t),first=await f.monitor().cycle();
 f.advance(86400000);const second=await f.monitor().cycle();assert.deepEqual(second.lastRestoreTest,first.lastRestoreTest);assert.equal(second.lastSuccessAt,f.now());
 f.advance(RESTORE_INTERVAL_MS-86400000);const third=await f.monitor().cycle();assert.equal(third.lastRestoreTest.at,f.now());assert(third.lastRestoreTest.at>first.lastRestoreTest.at);assert.equal(third.lastRestoreTest.ok,true);
 assert.equal(fs.readdirSync(f.backups).filter(name=>name.startsWith('zoigram-')).length,3);unchangedSource(f);
});
test('failed backups keep the previous good status, sanitize failures and recover on a bounded retry',async t=>{
 const f=fixture(t),first=await f.monitor().cycle();f.advance(1000);fs.unlinkSync(path.join(f.data,'media.key'));
 const failed=await f.monitor().cycle();assert.equal(failed.lastSuccessAt,first.lastSuccessAt);assert.deepEqual(failed.lastBackup,first.lastBackup);assert.deepEqual(failed.lastRestoreTest,first.lastRestoreTest);assert.deepEqual(failed.lastError,{at:f.now(),code:'backup_failed'});assert.equal(failed.nextDueAt-f.now(),300000);assert.equal(failed.inProgress,false);
 const raw=fs.readFileSync(path.join(f.backups,'status.json'),'utf8');assert(!raw.includes(f.root));assert(!raw.includes('ENOENT'));assert(!raw.includes('Private test account'));
 await verifyBackup(path.join(f.backups,first.lastBackup.name));fs.writeFileSync(path.join(f.data,'media.key'),f.key);f.advance(300000);const recovered=await f.monitor().cycle();assert.equal(recovered.lastError,null);assert.equal(recovered.lastSuccessAt,f.now());unchangedSource(f);
});
test('restore failure is distinguished from backup failure and retried before the next weekly interval',async t=>{
 const f=fixture(t),original=fs.mkdtempSync;
 const mocked=t.mock.method(fs,'mkdtempSync',function(prefix,...rest){if(String(prefix).includes('.restore-check-'))throw Error('private filesystem path and secret');return original.call(fs,prefix,...rest);});
 const failed=await f.monitor().cycle();assert.equal(failed.lastSuccessAt,f.now());assert.equal(failed.lastError.code,'restore_failed');assert.equal(failed.lastRestoreTest.ok,false);assert.equal(failed.nextDueAt-f.now(),300000);await verifyBackup(path.join(f.backups,failed.lastBackup.name));assert(!JSON.stringify(failed).includes('secret'));unchangedSource(f);
 mocked.mock.restore();f.advance(300000);const recovered=await f.monitor().cycle();assert.equal(recovered.lastError,null);assert.equal(recovered.lastRestoreTest.ok,true);assert.equal(recovered.lastRestoreTest.at,f.now());unchangedSource(f);
});
test('a damaged snapshot leaves its isolated rehearsal for diagnosis and never changes production',async t=>{
 const f=fixture(t),snapshot=await createBackup(f.data,f.backups);fs.writeFileSync(path.join(snapshot.directory,'media.key'),Buffer.alloc(32));
 await assert.rejects(()=>rehearseRestore(snapshot.directory,fs.realpathSync(f.backups)),/checksum mismatch/);
 const failed=fs.readdirSync(f.backups).filter(name=>name.startsWith('.restore-check-'));assert.equal(failed.length,1);assert.deepEqual(fs.readdirSync(path.join(f.backups,failed[0])),[]);unchangedSource(f);
});
test('an interrupted or malformed status is replaced without retaining untrusted fields',async t=>{
 const f=fixture(t);fs.mkdirSync(f.backups);fs.writeFileSync(path.join(f.backups,'status.json'),'{interrupted');assert.deepEqual(readStatus(f.backups),{});
 const status=await f.monitor().cycle();assert.equal(status.lastRestoreTest.ok,true);
 fs.writeFileSync(path.join(f.backups,'status.json'),JSON.stringify({...status,secret:'never return',lastError:{at:f.now(),code:'private secret'},lastBackup:{name:'../../data',bytes:1},lastRestoreTest:{at:f.now(),ok:true,durationMs:-1}}));
 const safe=readStatus(f.backups);assert(!Object.hasOwn(safe,'secret'));assert(!Object.hasOwn(safe,'lastError'));assert(!Object.hasOwn(safe,'lastBackup'));assert.equal(safe.lastRestoreTest.durationMs,0);unchangedSource(f);
});
test('worker retries failure and aborts its waiting timer gracefully',async t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.data,'media.key'));const controller=new AbortController(),results=[],delays=[];
 await runBackupWorker(f.monitor(),{signal:controller.signal,onStatus:status=>{results.push(status);if(results.length===2)controller.abort();},wait:async milliseconds=>{delays.push(milliseconds);fs.writeFileSync(path.join(f.data,'media.key'),f.key);f.advance(milliseconds);}});
 assert.equal(results.length,2);assert.equal(results[0].lastError.code,'backup_failed');assert.equal(results[1].lastError,null);assert.deepEqual(delays,[300000]);unchangedSource(f);
 const waiting=new AbortController();let attempts=0;const done=runBackupWorker(f.monitor(),{signal:waiting.signal,onStatus:()=>{attempts++;setTimeout(()=>waiting.abort(),10);}});await done;assert.equal(attempts,1);unchangedSource(f);
});
test('worker survives status I/O failure without leaking details, then stops after a requested abort',async()=>{
 const controller=new AbortController(),errors=[];let attempts=0;
 await runBackupWorker({retrySeconds:60,clock:()=>100,cycle:async()=>{attempts++;throw Error('private path');}},{signal:controller.signal,onError:error=>errors.push(error),wait:async milliseconds=>{assert.equal(milliseconds,60000);controller.abort();}});
 assert.equal(attempts,1);assert.deepEqual(errors,[{at:100,code:'backup_status_unavailable'}]);
});
test('unsafe scheduling and a production-data backup root are refused',async t=>{
 const f=fixture(t);assert.throws(()=>f.monitor({intervalSeconds:59}),/interval/);assert.throws(()=>f.monitor({keep:0}),/retention/);assert.throws(()=>f.monitor({backupDirectory:f.data}),/differ/);unchangedSource(f);
});
