'use strict';
const path=require('node:path');
const {createBackup,verifyBackup,restoreBackup}=require('../src/backups.cjs');
const data=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data'));
const backups=path.resolve(process.env.BACKUP_DIR||path.join(__dirname,'../backups'));
const keep=Number(process.env.BACKUP_KEEP||3),[command,...args]=process.argv.slice(2);
let timer,stopping=false,wake;
async function run(){
 if(command==='create')return createBackup(data,backups,{keep});
 if(command==='verify'&&args.length===1)return verifyBackup(args[0]);
 if(command==='restore'&&args.length===2)return restoreBackup(args[0],args[1]);
 if(command==='worker'){
  const seconds=Number(process.env.BACKUP_INTERVAL_SECONDS||86400);if(!Number.isInteger(seconds)||seconds<60||seconds>604800)throw Error('Backup interval must be 60 to 604800 seconds');
  if(!Number.isInteger(keep)||keep<1||keep>90)throw Error('Backup retention must be 1 to 90');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearTimeout(timer);wake?.()});
  while(!stopping){try{console.log(JSON.stringify({event:'backup-complete',...await createBackup(data,backups,{keep})}))}catch(e){console.error('Backup failed: '+e.message);throw e}
   if(!stopping)await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,seconds*1000)});
  }return;
 }
 throw Error('Usage: node tools/backup.cjs create | verify SNAPSHOT_DIR | restore SNAPSHOT_DIR EMPTY_DATA_DIR | worker');
}
run().then(result=>{if(result)console.log(JSON.stringify(result,null,2))}).catch(e=>{console.error(e.message);process.exitCode=1});
