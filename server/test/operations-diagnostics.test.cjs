'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {openStore}=require('../src/store.cjs'),{createOperations}=require('../src/operations.cjs');
test('malformed backup timestamps cannot report healthy backups or bypass dashboard field sanitization',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-operations-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-operations-'));fs.rmSync(dir,{recursive:true,force:true})});
 const db=openStore(':memory:');t.after(()=>db.close());const now=Date.now(),ops=createOperations({db,budget:100000,gate:{active:0},clock:()=>now,backupDirectory:dir});
 const write=value=>fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify(value));
 write({format:'zoigram-backup-status-v1',lastSuccessAt:'invalid',intervalSeconds:'invalid',lastRestoreTest:{ok:true,at:'invalid'},available:true,secret:'never expose raw status fields'});
 let snapshot=ops.snapshot();assert.equal(snapshot.backups.available,true);assert.equal(snapshot.backups.stale,true);assert.equal(snapshot.backups.lastSuccessAt,null);assert(snapshot.warnings.includes('backup_attention'));assert(snapshot.warnings.includes('restore_attention'));assert(!JSON.stringify(snapshot).includes('never expose'));
 write({format:'zoigram-backup-status-v1',lastSuccessAt:now,intervalSeconds:86400,lastRestoreTest:{ok:true,at:now,durationMs:12},available:false,inProgress:'false',nextDueAt:'invalid'});
 snapshot=ops.snapshot();assert.equal(snapshot.backups.available,true);assert.equal(snapshot.backups.stale,false);assert.equal(snapshot.backups.inProgress,false);assert.equal(snapshot.backups.nextDueAt,null);assert(!snapshot.warnings.includes('backup_attention'));assert(!snapshot.warnings.includes('restore_attention'));
});

test('media denial codes are bounded to media routes and HTTP 403, without changing historical events or inferring versions',t=>{
 const db=openStore(':memory:');t.after(()=>db.close());const now=Date.now(),ops=createOperations({db,budget:100000,gate:{active:0},clock:()=>now}),secret='private-session-and-grant';
 const old=ops.record({route:'media',status:403}),before=db.prepare('SELECT * FROM operational_errors WHERE id=?').get(old);
 function capture(path,status,code,version){return ops.capture({method:'GET',headers:{'x-zoigram-version':version}}, {},new URL(path+'?grant='+secret,'https://local'),status,{code,message:secret,stack:secret});}
 capture('/api/media/1',403,'media_expired');capture('/api/avatars/00000000-0000-0000-0000-000000000001',403,'media_session_ended','0.8.0');capture('/api/media/2',403,'media_invalid');
 capture('/api/media/3',500,'media_expired');capture('/api/feed',403,'media_expired');capture('/api/media/4',403,secret);
 const rows=ops.list(new URLSearchParams()).items.reverse();assert.deepEqual(rows.map(r=>r.code),['request_rejected','media_expired','media_session_ended','media_invalid','server_error','request_rejected','request_rejected']);
 assert.equal(rows[2].route,'media');assert.equal(rows[1].client_version,'unknown');assert.equal(rows[2].client_version,'0.8.0');assert(rows.every(r=>r.profile_id===null));assert(!JSON.stringify(rows).includes(secret));
 assert.deepEqual(db.prepare('SELECT * FROM operational_errors WHERE id=?').get(old),before);assert.equal(ops.record({source:'client',code:'media_expired'}),null);
 const snapshot=ops.snapshot();assert.equal(snapshot.errors24h,7);assert.equal(snapshot.errorSummary.server5xx,1);assert.equal(snapshot.errorSummary.mediaAccessRejected,3);assert.equal(snapshot.errorSummary.rejected4xx,3);
});
