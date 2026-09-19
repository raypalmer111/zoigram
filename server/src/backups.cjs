'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');
const files=['zoigram.sqlite','media.key'];
const snapshotName=/^zoigram-\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const sha=async file=>{const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')};
function regular(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Expected a regular file: '+file);return stat}
function inspectDatabase(file){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const check=db.prepare('PRAGMA integrity_check').all();if(check.length!==1||Object.values(check[0])[0]!=='ok')throw Error('SQLite integrity check failed');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQLite relationships are damaged');
   const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
   const counts={};for(const table of ['profiles','posts','comments','likes','follows','notifications','direct_messages','moderation','avatars','post_photos','pinned_posts'])if(present.has(table))counts[table]=db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  return {schemaVersion:db.prepare('PRAGMA user_version').get().user_version,counts};
 }finally{db.close()}
}
async function verifyBackup(directory){
 const dir=path.resolve(directory);regular(path.join(dir,'manifest.json'));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 if(manifest.format!=='zoigram-backup-v1'||!Number.isFinite(Date.parse(manifest.createdAt)))throw Error('Unknown backup format');
 if(Object.keys(manifest.files||{}).sort().join(',')!==[...files].sort().join(','))throw Error('Incomplete backup manifest');
 for(const name of files){const file=path.join(dir,name),stat=regular(file),expected=manifest.files[name];if(stat.size!==expected.bytes||await sha(file)!==expected.sha256)throw Error('Backup checksum mismatch: '+name)}
 if(manifest.files['media.key'].bytes!==32)throw Error('Invalid media key');
 const inspected=inspectDatabase(path.join(dir,'zoigram.sqlite'));
 if(JSON.stringify(inspected)!==JSON.stringify(manifest.database))throw Error('Backup database does not match its manifest');
 return {directory:dir,...manifest};
}
function removeSnapshot(directory){
 // Only our exact, complete snapshot contents may be removed. Unknown files stay.
 const names=fs.readdirSync(directory).sort();if(names.join(',')!==[...files,'manifest.json'].sort().join(','))return false;
 for(const name of names)regular(path.join(directory,name));
 for(const name of names)fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);return true;
}
function pruneBackups(directory,keep){
 if(!Number.isInteger(keep)||keep<1||keep>90)throw Error('Backup retention must be 1 to 90');
 const root=fs.realpathSync(directory);
 const snapshots=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&snapshotName.test(e.name)).map(e=>e.name).sort().reverse();
 const removed=[];
 for(const name of snapshots.slice(keep)){
  const dir=path.resolve(root,name);if(path.dirname(dir)!==root||fs.realpathSync(dir)!==dir)throw Error('Invalid backup cleanup path');
  try{const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));if(manifest.format==='zoigram-backup-v1'&&removeSnapshot(dir))removed.push(name)}catch(e){if(e.code!=='ENOENT')throw e}
 }
 return removed;
}
async function createBackup(dataDirectory,backupDirectory,{keep=3}={}){
 if(!Number.isInteger(keep)||keep<1||keep>90)throw Error('Backup retention must be 1 to 90');
 const data=path.resolve(dataDirectory),root=path.resolve(backupDirectory),source=path.join(data,'zoigram.sqlite');
 if(fs.existsSync(path.join(data,'.restoring')))throw Error('A restore is in progress');
 regular(source);regular(path.join(data,'media.key'));const key=fs.readFileSync(path.join(data,'media.key'));if(key.length!==32)throw Error('Invalid media key');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const createdAt=new Date().toISOString(),name='zoigram-'+createdAt.replace(/[-:.]/g,'')+'-'+crypto.randomBytes(4).toString('hex');
 const partial=path.join(root,'.partial-'+name),destination=path.join(root,name);fs.mkdirSync(partial,{mode:0o700});
 try{
  const db=new DatabaseSync(source,{readOnly:true});try{db.exec('PRAGMA busy_timeout=5000');await backup(db,path.join(partial,'zoigram.sqlite'))}finally{db.close()}
  // Seal only the copied database into one file; the live database stays in WAL mode.
  const sealed=new DatabaseSync(path.join(partial,'zoigram.sqlite'));try{sealed.exec('PRAGMA journal_mode=DELETE')}finally{sealed.close()}
  fs.chmodSync(path.join(partial,'zoigram.sqlite'),0o600);
  if(!fs.readFileSync(path.join(data,'media.key')).equals(key))throw Error('Media key changed during backup');
  fs.writeFileSync(path.join(partial,'media.key'),key,{flag:'wx',mode:0o600});
  const manifest={format:'zoigram-backup-v1',createdAt,database:inspectDatabase(path.join(partial,'zoigram.sqlite')),files:{}};
  for(const name of files){const file=path.join(partial,name);manifest.files[name]={bytes:fs.statSync(file).size,sha256:await sha(file)}}
  fs.writeFileSync(path.join(partial,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  await verifyBackup(partial);fs.renameSync(partial,destination);
  const removed=pruneBackups(root,keep);return {directory:destination,createdAt,counts:manifest.database.counts,removed};
 }catch(e){
  // A failed/incomplete snapshot is never selected for restore or retention.
  // Leave it for diagnosis instead of deleting files after an uncertain failure.
  throw e;
 }
}
async function restoreBackup(snapshotDirectory,targetDirectory){
 const snapshot=await verifyBackup(snapshotDirectory),target=path.resolve(targetDirectory);
 if(fs.existsSync(target)){if(!fs.lstatSync(target).isDirectory()||fs.lstatSync(target).isSymbolicLink()||fs.readdirSync(target).length)throw Error('Restore destination must be an empty directory')}else fs.mkdirSync(target,{recursive:true,mode:0o700});
 const marker=path.join(target,'.restoring');fs.writeFileSync(marker,'Zoigram restore in progress\n',{flag:'wx',mode:0o600});
 for(const name of files){fs.copyFileSync(path.join(snapshot.directory,name),path.join(target,name),fs.constants.COPYFILE_EXCL);fs.chmodSync(path.join(target,name),0o600);if(await sha(path.join(target,name))!==snapshot.files[name].sha256)throw Error('Restored checksum mismatch: '+name)}
 inspectDatabase(path.join(target,'zoigram.sqlite'));fs.unlinkSync(marker);
 return {directory:target,counts:snapshot.database.counts};
}
module.exports={createBackup,verifyBackup,restoreBackup,pruneBackups,inspectDatabase};

