'use strict';
const path=require('node:path');
const {createBackup,verifyBackup,restoreBackup}=require('../src/backups.cjs');
const data=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data'));
const backups=path.resolve(process.env.BACKUP_DIR||path.join(__dirname,'../backups'));
const keep=Number(process.env.BACKUP_KEEP||3),[command,...args]=process.argv.slice(2);
const {createBackupMonitor,runBackupWorker}=require('../src/backup-monitor.cjs');
async function run(){
 if(command==='create')return createBackup(data,backups,{keep});
 if(command==='verify'&&args.length===1)return verifyBackup(args[0]);
 if(command==='restore'&&args.length===2)return restoreBackup(args[0],args[1]);
 if(command==='worker'){
  const monitor=createBackupMonitor({dataDirectory:data,backupDirectory:backups,keep,intervalSeconds:Number(process.env.BACKUP_INTERVAL_SECONDS||86400)});
  const controller=new AbortController(),stop=()=>controller.abort();
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
  try{await runBackupWorker(monitor,{signal:controller.signal,onStatus:status=>console.log(JSON.stringify({event:status.lastError?'backup-attention':'backup-complete',...status})),onError:error=>console.error(JSON.stringify({event:'backup-attention',...error}))});}
  finally{for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,stop);}
  return;
 }
 throw Error('Usage: node tools/backup.cjs create | verify SNAPSHOT_DIR | restore SNAPSHOT_DIR EMPTY_DATA_DIR | worker');
}
run().then(result=>{if(result)console.log(JSON.stringify(result,null,2))}).catch(e=>{console.error(e.message);process.exitCode=1});
