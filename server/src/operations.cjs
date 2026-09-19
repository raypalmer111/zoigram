'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const CLIENT_CODES=new Set(['photo_read','photo_prepare','photo_size','network','response']);
const ROUTES=new Set(['upload','upload_legacy','upload_resumable','api','auth','media']);
const MEDIA_CODES=new Set(['media_invalid','media_expired','media_session_ended']);
const UPLOAD_CODES=new Map([['upload_slots_full',429],['daily_posts_limit',429],['upload_service_full',503],['upload_expired',410],['upload_changed',409],['upload_has_photos',409],['upload_in_progress',409]]);
const STAGES=new Set(['upload_start','upload_part','upload_complete','upload_cancel','upload_status']);
function createOperations({db,budget,gate,dataDirectory,backupDirectory,clock=Date.now}){
 const version=v=>typeof v==='string'&&v===v.trim()&&/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)?v:'unknown';
 function clean(){db.prepare('DELETE FROM operational_errors WHERE created_at<?').run(clock()-14*86400000);db.exec('DELETE FROM operational_errors WHERE id NOT IN (SELECT id FROM operational_errors ORDER BY id DESC LIMIT 5000)');}
 function record({source='server',profileId=null,clientVersion,code,status=0,imageBytes=null,route='upload',stage=null}){
  if(!['server','client'].includes(source))return null;if(source==='client'&&!CLIENT_CODES.has(code))return null;
  const n=Number.isSafeInteger(imageBytes)&&imageBytes>=0&&imageBytes<=1024*1024*1024?imageBytes:null;
  const label=source==='client'?code:route==='media'&&status===403&&MEDIA_CODES.has(code)?code:route.startsWith('upload')&&UPLOAD_CODES.get(code)===status?code:code==='upload_aborted'&&status===499?'upload_aborted':code==='upload_cancelled'&&status===499?'upload_cancelled':code==='upload_timeout'&&status===408?'upload_timeout':status===413?'photo_size':status===429?'rate_limit':status===507?'storage_full':status===503?'busy':status>=500?'server_error':status===409?'conflict':'request_rejected';
  const id=Number(db.prepare('INSERT INTO operational_errors(created_at,profile_id,source,code,status,client_version,image_bytes,route,stage) VALUES(?,?,?,?,?,?,?,?,?)').run(clock(),profileId,source,label,Number.isInteger(status)&&status>=0&&status<=599?status:0,version(clientVersion),n,ROUTES.has(route)?route:'api',source==='server'&&route.startsWith('upload')&&STAGES.has(stage)?stage:null).lastInsertRowid);
  if(id%50===0)clean();return id;
 }
 function capture(req,res,u,status,error){
  if(status<400||!u.pathname.startsWith('/api/')||u.pathname==='/api/diagnostics'||status===401||status===404)return null;
  const route=u.pathname==='/api/posts'&&req.method==='POST'?'upload_legacy':/^\/api\/uploads(?:\/|$)/.test(u.pathname)?'upload_resumable':u.pathname.startsWith('/api/auth/')?'auth':/^\/api\/(?:media|avatars)\//.test(u.pathname)?'media':'api';
  // Probing a never-started or expired draft is part of normal resume, not a failed photo upload.
  if(route==='upload_resumable'&&req.method==='GET'&&status===410&&error?.code==='upload_expired')return null;
  const stage=route==='upload_resumable'?(u.pathname==='/api/uploads'?'upload_start':req.method==='DELETE'?'upload_cancel':/\/complete$/.test(u.pathname)?'upload_complete':/\/[0-4]$/.test(u.pathname)?'upload_part':'upload_status'):route==='upload_legacy'?'upload_complete':null;
  try{return record({profileId:res.zoigramSession?.profile_id||null,clientVersion:req.headers['x-zoigram-version'],code:route.startsWith('upload_')||route==='media'?error?.code:undefined,status,imageBytes:req.zoigramImageBytes,route,stage});}catch{return null;}
 }
 function list(params){const raw=params.get('before')||'',before=/^\d{1,15}$/.test(raw)?Number(raw):Number.MAX_SAFE_INTEGER,source=['server','client'].includes(params.get('source'))?params.get('source'):'';const rows=db.prepare('SELECT e.*,p.username FROM operational_errors e LEFT JOIN profiles p ON p.id=e.profile_id WHERE e.id<? AND (?=\'\' OR e.source=?) ORDER BY e.id DESC LIMIT 51').all(before,source,source);return {items:rows.slice(0,50),nextCursor:rows.length>50?String(rows[49].id):null};}
 function readBackup(){
  if(!backupDirectory)return {available:false};
  const {readStatus,FORMAT}=require('./backup-monitor.cjs'),v=readStatus(backupDirectory);if(v.format!==FORMAT)return {available:false};return {available:true,...v,stale:!v.lastSuccessAt||clock()-v.lastSuccessAt>Math.max(2*v.intervalSeconds*1000,3600000)};
 }
 function snapshot(){
  let disk=null,databaseBytes=null;if(dataDirectory){try{const s=fs.statfsSync(dataDirectory);disk={total:s.blocks*s.bsize,free:s.bavail*s.bsize};databaseBytes=['zoigram.sqlite','zoigram.sqlite-wal','zoigram.sqlite-shm'].reduce((n,f)=>{try{return n+fs.statSync(path.join(dataDirectory,f)).size}catch{return n}},0);}catch{}}
  const cgroup=f=>{try{const n=Number(fs.readFileSync('/sys/fs/cgroup/'+f,'utf8').trim());return Number.isSafeInteger(n)&&n>0?n:null;}catch{return null;}};
  const memory=process.memoryUsage(),container={used:cgroup('memory.current'),limit:cgroup('memory.max')},media=db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars) n').get().n,staged=db.prepare('SELECT COALESCE(SUM(bytes),0) n FROM upload_parts').get().n,backups=readBackup(),warnings=[];
  if(media+staged>=budget*.8)warnings.push('media_quota');if(disk&&(disk.free<1024*1024*1024||disk.free/disk.total<.1))warnings.push('disk_low');if(container.limit&&container.used/container.limit>.85)warnings.push('memory_high');if(!backups.available||backups.stale||backups.lastError)warnings.push('backup_attention');if(backups.available&&(!backups.lastRestoreTest?.ok||clock()-backups.lastRestoreTest.at>8*86400000))warnings.push('restore_attention');
  const errorSummary=db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(source='server' AND status>=500),0) server5xx,COALESCE(SUM(source='server' AND code IN ('busy','upload_service_full') AND status=503),0) busyResponses,COALESCE(SUM(source='server' AND ((code IN ('upload_aborted','upload_cancelled') AND status=499) OR (code='upload_timeout' AND status=408))),0) uploadConnections,COALESCE(SUM(source='server' AND status>=400 AND status<500 AND code NOT IN ('upload_aborted','upload_cancelled','upload_timeout') AND NOT (route='media' AND status=403 AND code IN ('media_invalid','media_expired','media_session_ended'))),0) rejected4xx,COALESCE(SUM(source='server' AND route='media' AND status=403 AND code IN ('media_invalid','media_expired','media_session_ended')),0) mediaAccessRejected,COALESCE(SUM(source='client'),0) clientDiagnostics FROM operational_errors WHERE created_at>?`).get(clock()-86400000);
  return {at:clock(),version:require('../package.json').version,uptimeSeconds:Math.floor(process.uptime()),cpu:{load:os.loadavg(),cores:os.availableParallelism()},memory:{rss:memory.rss,heap:memory.heapUsed,container,hostTotal:os.totalmem(),hostFree:os.freemem()},disk,storage:{media,staged,quota:budget,databaseBytes},uploads:{active:gate.active,maximum:gate.maximum??2,receiving:gate.receiving??0,waiting:gate.waiting??0,inFlight:gate.inFlight??((gate.active||0)+(gate.receiving||0)+(gate.waiting||0)),maxInFlight:gate.maxInFlight??4,pending:db.prepare('SELECT COUNT(*) n FROM upload_sessions WHERE post_id IS NULL').get().n},errors24h:errorSummary.total,errorSummary,backups,warnings};
 }
 clean();return {record,capture,list,snapshot,clean};
}
module.exports={createOperations,CLIENT_CODES};
