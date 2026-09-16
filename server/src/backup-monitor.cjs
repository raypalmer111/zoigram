'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createBackup,verifyBackup,restoreBackup,inspectDatabase}=require('./backups.cjs');
const FORMAT='zoigram-backup-status-v1',RESTORE_INTERVAL_MS=7*86400000;
const snapshotName=/^zoigram-\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const CODES=new Set(['backup_failed','restore_failed']);
const timestamp=value=>Number.isSafeInteger(value)&&value>0?value:null;
function readStatus(root){
 try{
  const file=path.join(root,'status.json'),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)return {};
  const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.format!==FORMAT)return {};
  const result={lastAttemptAt:timestamp(v.lastAttemptAt),lastSuccessAt:timestamp(v.lastSuccessAt)};
  if(v.lastError&&timestamp(v.lastError.at)&&CODES.has(v.lastError.code))result.lastError={at:v.lastError.at,code:v.lastError.code};
  if(v.lastRestoreTest&&timestamp(v.lastRestoreTest.at)&&typeof v.lastRestoreTest.ok==='boolean')result.lastRestoreTest={at:v.lastRestoreTest.at,ok:v.lastRestoreTest.ok,durationMs:Number.isSafeInteger(v.lastRestoreTest.durationMs)&&v.lastRestoreTest.durationMs>=0?v.lastRestoreTest.durationMs:0};
  if(snapshotName.test(v.lastBackup?.name||'')&&Number.isSafeInteger(v.lastBackup.bytes)&&v.lastBackup.bytes>=0)result.lastBackup={name:v.lastBackup.name,bytes:v.lastBackup.bytes,createdAt:timestamp(v.lastBackup.createdAt),schemaVersion:Number.isSafeInteger(v.lastBackup.schemaVersion)?v.lastBackup.schemaVersion:null};
  return result;
 }catch{return {};}
}
function writeStatus(root,status){
 const temporary=path.join(root,'.status-'+crypto.randomBytes(12).toString('hex')+'.tmp');
 try{
  fs.writeFileSync(temporary,JSON.stringify(status,null,2)+'\n',{flag:'wx',mode:0o600});
  const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,path.join(root,'status.json'));
 }catch(error){
  // This exact temporary file was created by this call, never a computed tree.
  try{const stat=fs.lstatSync(temporary);if(stat.isFile()&&!stat.isSymbolicLink())fs.unlinkSync(temporary);}catch{}
  throw error;
 }
}
function removeSuccessfulRehearsal(root,directory){
 const target=path.resolve(directory),name=path.basename(target);
 if(!/^\.restore-check-[A-Za-z0-9]+$/.test(name)||path.dirname(target)!==root||fs.realpathSync(root)!==root||fs.realpathSync(target)!==target)throw Error('Invalid restore rehearsal cleanup path');
 const stat=fs.lstatSync(target);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid restore rehearsal directory');
 const names=fs.readdirSync(target).sort();
 if(names.join(',')!=='media.key,zoigram.sqlite')throw Error('Unexpected restore rehearsal contents');
 for(const name of names){const stat=fs.lstatSync(path.join(target,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unexpected restore rehearsal file');}
 for(const name of names)fs.unlinkSync(path.join(target,name));
 fs.rmdirSync(target);
}
async function rehearseRestore(snapshotDirectory,root){
 // mkdtemp creates a new isolated directory. Production is never a restore target.
 const target=fs.mkdtempSync(path.join(root,'.restore-check-'));
 fs.chmodSync(target,0o700);
 await restoreBackup(snapshotDirectory,target);
 const verified=await verifyBackup(snapshotDirectory);
 const restored=inspectDatabase(path.join(target,'zoigram.sqlite'));
 if(JSON.stringify(restored)!==JSON.stringify(verified.database))throw Error('Restored database differs from the verified snapshot');
 const key=fs.readFileSync(path.join(target,'media.key'));
 if(key.length!==32||!key.equals(fs.readFileSync(path.join(snapshotDirectory,'media.key'))))throw Error('Restored media key differs from the verified snapshot');
 // Failed rehearsals remain for diagnosis. Only successful, checked copies go.
 removeSuccessfulRehearsal(root,target);
 return {schemaVersion:restored.schemaVersion};
}
function createBackupMonitor({dataDirectory,backupDirectory,keep=3,intervalSeconds=86400,clock=Date.now}={}){
 if(!Number.isInteger(intervalSeconds)||intervalSeconds<60||intervalSeconds>604800)throw Error('Backup interval must be 60 to 604800 seconds');
 if(!Number.isInteger(keep)||keep<1||keep>90)throw Error('Backup retention must be 1 to 90');
 if(typeof dataDirectory!=='string'||typeof backupDirectory!=='string')throw Error('Backup directories are required');
 const data=path.resolve(dataDirectory),configuredRoot=path.resolve(backupDirectory);
 if(data===configuredRoot)throw Error('Backup directory must differ from production data');
 const retrySeconds=Math.max(60,Math.min(300,Math.floor(intervalSeconds/12)));
 let running=false;
 async function cycle(){
  if(running)throw Error('A backup cycle is already running');
  running=true;
  try{
   fs.mkdirSync(configuredRoot,{recursive:true,mode:0o700});
   const root=fs.realpathSync(configuredRoot);
   if(fs.existsSync(data)&&fs.realpathSync(data)===root)throw Error('Backup directory resolves to production data');
   let status={format:FORMAT,lastAttemptAt:null,lastSuccessAt:null,lastError:null,lastBackup:null,lastRestoreTest:null,...readStatus(root),intervalSeconds,nextDueAt:null,inProgress:true};
   status.lastAttemptAt=clock();status.nextDueAt=status.lastAttemptAt+intervalSeconds*1000;writeStatus(root,status);
   let stage='backup';
   try{
    const made=await createBackup(data,root,{keep}),verified=await verifyBackup(made.directory);
    status.lastSuccessAt=clock();status.lastError=null;
    status.lastBackup={name:path.basename(made.directory),bytes:Object.values(verified.files).reduce((sum,file)=>sum+file.bytes,0)+fs.statSync(path.join(made.directory,'manifest.json')).size,createdAt:Date.parse(verified.createdAt),schemaVersion:verified.database.schemaVersion};
    writeStatus(root,status);
    if(!status.lastRestoreTest?.ok||clock()-status.lastRestoreTest.at>=RESTORE_INTERVAL_MS){
     stage='restore';const started=clock();
     try{await rehearseRestore(made.directory,root);status.lastRestoreTest={at:clock(),ok:true,durationMs:Math.max(0,clock()-started)};}
     catch(error){status.lastRestoreTest={at:clock(),ok:false,durationMs:Math.max(0,clock()-started)};throw error;}
    }
    status.nextDueAt=clock()+intervalSeconds*1000;
   }catch{
    status.lastError={at:clock(),code:stage==='restore'?'restore_failed':'backup_failed'};
    status.nextDueAt=clock()+retrySeconds*1000;
   }
   status.inProgress=false;writeStatus(root,status);
   return status;
  }finally{running=false;}
 }
 return {cycle,retrySeconds,clock};
}
function waitForNextRun(milliseconds,signal){
 if(signal?.aborted)return Promise.resolve();
 return new Promise(resolve=>{
  let timer;const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
  timer=setTimeout(done,Math.max(0,milliseconds));signal?.addEventListener('abort',done,{once:true});
  if(signal?.aborted)done();
 });
}
async function runBackupWorker(monitor,{signal,onStatus=()=>{},onError=()=>{},wait=waitForNextRun}={}){
 while(!signal?.aborted){
  let delay=monitor.retrySeconds*1000;
  try{const status=await monitor.cycle();onStatus(status);delay=Math.max(0,status.nextDueAt-monitor.clock());}
  catch{onError({at:monitor.clock(),code:'backup_status_unavailable'});}
  if(!signal?.aborted)await wait(delay,signal);
 }
}
module.exports={createBackupMonitor,runBackupWorker,rehearseRestore,readStatus,FORMAT,RESTORE_INTERVAL_MS};
