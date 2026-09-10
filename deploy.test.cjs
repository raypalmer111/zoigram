'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {preflight}=require('../deploy/preflight.cjs');
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-deploy-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-deploy-'));fs.rmSync(dir,{recursive:true,force:true})});return dir}
test('deployment rejects placeholder domains, malformed addresses and unsafe retention settings',async t=>{
 const dir=directory(t),file=path.join(dir,'.env');
 const write=(domain,extra='')=>fs.writeFileSync(file,'DOMAIN='+domain+'\nSTORAGE_LIMIT_MB=2048\nBACKUP_KEEP=3\nBACKUP_INTERVAL_SECONDS=86400\n'+extra);
 for(const domain of ['photos.example.com','https://photos.zoigram.community','photos.zoigram.community/path','127.0.0.1','bad domain.com','a..com']){write(domain);await assert.rejects(()=>preflight(file,{resolve:false}),/DOMAIN/)}
 write('photos.zoigram.community','BACKUP_KEEP=0\n');await assert.rejects(()=>preflight(file,{resolve:false}),/Duplicate/);
 write('photos.zoigram.community');const valid=await preflight(file,{resolve:false});assert.equal(valid.photoQuotaMB,2048);assert.equal(valid.backupKeep,3);assert.equal(valid.backupEveryHours,24);
});
test('startup refuses a missing paired key or an incomplete restore before altering data',t=>{
 const data=directory(t),database=path.join(data,'zoigram.sqlite'),key=path.join(data,'media.key');fs.writeFileSync(database,'preserve this file');
 const run=()=>cp.spawnSync(process.execPath,[path.resolve(__dirname,'../src/main.cjs')],{env:{...process.env,DATA_DIR:data,HOST:'127.0.0.1',PUBLIC_ORIGIN:'http://127.0.0.1:43899',PORT:'43899'},encoding:'utf8',windowsHide:true,timeout:10000});
 let result=run();assert.equal(result.status,1);assert.match(result.stderr,/no media.key/);assert(!fs.existsSync(key));assert.equal(fs.readFileSync(database,'utf8'),'preserve this file');
 fs.writeFileSync(key,Buffer.alloc(32,5));fs.writeFileSync(path.join(data,'.restoring'),'incomplete');result=run();assert.equal(result.status,1);assert.match(result.stderr,/restore is incomplete/);assert.equal(fs.readFileSync(database,'utf8'),'preserve this file');
});
