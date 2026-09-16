'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const CLIENT_CODES=new Set(['photo_read','photo_prepare','photo_size','network','response']);
function createOperations({db,budget,gate,dataDirectory,backupDirectory,clock=Date.now}){
 const version=v=>/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v||'')?v:'unknown';
 function clean(){db.prepare('DELETE FROM operational_errors WHERE created_at<?').run(clock()-14*86400000);db.exec('DELETE FROM operational_errors WHERE id NOT IN (SELECT id FROM operational_errors ORDER BY id DESC LIMIT 5000)');}
 function record({source='server',profileId=null,clientVersion,code,status=0,imageBytes=null,route='upload'}){
  if(!['server','client'].includes(source))return null;if(source==='client'&&!CLIENT_CODES.has(code))return null;
  const n=Number.isSafeInteger(imageBytes)&&imageBytes>=0&&imageBytes<=1024*1024*1024?imageBytes:null;
  const label=source==='client'?code:status===413?'photo_size':status===429?'rate_limit':status===507?'storage_full':status===503?'busy':status>=500?'server_error':status===409?'conflict':'request_rejected';
  const id=Number(db.prepare('INSERT INTO operational_errors(created_at,profile_id,source,code,status,client_version,image_bytes,route) VALUES(?,?,?,?,?,?,?,?)').run(clock(),profileId,source,label,Number.isInteger(status)&&status>=0&&status<=599?status:0,version(clientVersion),n,['upload','api','auth','media'].includes(route)?route:'api').lastInsertRowid);
  if(id%50===0)clean();return id;
 }
 function capture(req,res,u,status){
  if(status<400||!u.pathname.startsWith('/api/')||u.pathname==='/api/diagnostics'||status===401||status===404)return null;
  try{return record({profileId:res.zoigramSession?.profile_id||null,clientVersion:req.headers['x-zoigram-version'],status,imageBytes:req.zoigramImageBytes,route:/^\/api\/(uploads|posts)/.test(u.pathname)?'upload':u.pathname.startsWith('/api/auth/')?'auth':u.pathname.startsWith('/api/media/')?'media':'api'});}catch{return null;}
 }
 function list(params){const raw=params.get('before')||'',before=/^\d{1,15}$/.test(raw)?Number(raw):Number.MAX_SAFE_INTEGER,source=['server','client'].includes(params.get('source'))?params.get('source'):'';const rows=db.prepare('SELECT e.*,p.username FROM operational_errors e LEFT JOIN profiles p ON p.id=e.profile_id WHERE e.id<? AND (?=\'\' OR e.source=?) ORDER BY e.id DESC LIMIT 51').all(before,source,source);return {items:rows.slice(0,50),nextCursor:rows.length>50?String(rows[49].id):null};}
 function readBackup(){
  if(!backupDirectory)return {available:false};
  try{const p=path.join(backupDirectory,'status.json');if(fs.statSync(p).size>32768)return {available:false};const v=JSON.parse(fs.readFileSync(p,'utf8'));if(v.format!=='zoigram-backup-status-v1')return {available:false};return {available:true,...v,stale:!v.lastSuccessAt||clock()-v.lastSuccessAt>Math.max(2*(v.intervalSeconds||86400)*1000,3600000)};}catch{return {available:false};}
 }
 function snapshot(){
  let disk=null,databaseBytes=null;if(dataDirectory){try{const s=fs.statfsSync(dataDirectory);disk={total:s.blocks*s.bsize,free:s.bavail*s.bsize};databaseBytes=['zoigram.sqlite','zoigram.sqlite-wal','zoigram.sqlite-shm'].reduce((n,f)=>{try{return n+fs.statSync(path.join(dataDirectory,f)).size}catch{return n}},0);}catch{}}
  const cgroup=f=>{try{const n=Number(fs.readFileSync('/sys/fs/cgroup/'+f,'utf8').trim());return Number.isSafeInteger(n)&&n>0?n:null;}catch{return null;}};
  const memory=process.memoryUsage(),container={used:cgroup('memory.current'),limit:cgroup('memory.max')},media=db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars) n').get().n,staged=db.prepare('SELECT COALESCE(SUM(bytes),0) n FROM upload_parts').get().n,backups=readBackup(),warnings=[];
  if(media+staged>=budget*.8)warnings.push('media_quota');if(disk&&(disk.free<1024*1024*1024||disk.free/disk.total<.1))warnings.push('disk_low');if(container.limit&&container.used/container.limit>.85)warnings.push('memory_high');if(!backups.available||backups.stale||backups.lastError)warnings.push('backup_attention');if(backups.available&&(!backups.lastRestoreTest?.ok||clock()-backups.lastRestoreTest.at>8*86400000))warnings.push('restore_attention');
  return {at:clock(),version:require('../package.json').version,uptimeSeconds:Math.floor(process.uptime()),cpu:{load:os.loadavg(),cores:os.availableParallelism()},memory:{rss:memory.rss,heap:memory.heapUsed,container,hostTotal:os.totalmem(),hostFree:os.freemem()},disk,storage:{media,staged,quota:budget,databaseBytes},uploads:{active:gate.active,maximum:2,pending:db.prepare('SELECT COUNT(*) n FROM upload_sessions WHERE post_id IS NULL').get().n},errors24h:db.prepare('SELECT COUNT(*) n FROM operational_errors WHERE created_at>?').get(clock()-86400000).n,backups,warnings};
 }
 clean();return {record,capture,list,snapshot,clean};
}
module.exports={createOperations,CLIENT_CODES};
