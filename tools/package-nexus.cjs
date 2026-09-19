'use strict';
// Manual client and a separate, inspectable source package. Never packages installed mod data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {buildNative}=require('./bundle-native.cjs');
const root=path.resolve(__dirname,'..'),defaultModId='InzoiSocial_YV6DPJ';
const publication='publication/nexus-'+JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const uiFiles=['photos.js','app.js','index.html','locales.js','uimod_manifest.json','uploads/.keep'];
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function walk(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.isSymbolicLink())throw Error('Symlink in source: '+entry.name);
  const file=path.join(directory,entry.name);return entry.isDirectory()?walk(file):[file];
 });
}
function empty(destination){fs.mkdirSync(destination,{recursive:true});if(fs.readdirSync(destination).length)throw Error('Destination must be empty: '+destination)}
function write(destination,relative,bytes){const file=path.join(destination,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes)}
function buildManual(destination,modId=defaultModId){
 if(!/^InzoiSocial_[A-Z0-9]{6}$/.test(modId))throw Error('Invalid mod ID');empty(destination);
 const records=[],version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
 function payload(relative,bytes){write(destination,relative,bytes);records.push({path:relative,sha256:digest(bytes)})}
 for(const item of buildNative({modId}).files)payload('lua/'+item.path,item.content);
 payload('assets/instagram-icon.png',fs.readFileSync(path.join(root,'InzoiSocial/assets/instagram-icon.png')));
 for(const file of uiFiles)payload('ui/OnlineBridge/'+file,fs.readFileSync(path.join(root,'InzoiSocial/ui/OnlineBridge',file),'utf8').replaceAll('__MOD_ID__',modId));
 payload('ui/uimod_apps.json',JSON.stringify({apps:[{name:'OnlineBridge',default:true,enabled:true}]},null,2));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'InzoiSocial/mod_manifest.json'),'utf8'));
 manifest.ProjectName=modId;manifest.bEnable=true;manifest.NonAssets=records.map(item=>'/'+item.path);
 write(destination,'mod_manifest.json',JSON.stringify(manifest,null,2)+'\n');
 write(destination,modId+'.uplugin',fs.readFileSync(path.join(root,'InzoiSocial/InzoiSocial.uplugin')));
 write(destination,'README.txt',fs.readFileSync(path.join(root,publication+'/INSTALL.txt')));
 return {version,modId,files:walk(destination).map(file=>({path:path.relative(destination,file).replaceAll('\\','/'),sha256:digest(fs.readFileSync(file))})),runtimeFiles:records};
}
const {zipDirectory}=require('./zip-directory.cjs');
function sourcePackage(destination){
 empty(destination);
 const fixed=['package.json','InzoiSocial/mod_manifest.json','InzoiSocial/InzoiSocial.uplugin','InzoiSocial/obsolete-files.json','InzoiSocial/assets/instagram-icon.png',
  'tools/bundle-native.cjs','tools/package-nexus.cjs','tools/build-locales.cjs','tools/zip-directory.cjs','locales/messages.de.json','locales/messages.zh.json','tools/build-ui-glyphs.cjs','tools/Install-Native.ps1','locales/messages.json',
   publication+'/INSTALL.txt',publication+'/REVIEW.md',publication+'/CHANGELOG.txt','docs/RELEASE_0.9.md','tools/test-lua-offline.cjs','tests/lua/messaging061.lua','tests/lua/albums070.lua','tests/lua/social090.lua',
  'tests/photos.test.cjs','tests/bundle-native.test.cjs','tests/localization.test.cjs','tests/online-bridge.test.cjs','tests/nexus-package.test.cjs','tests/zip-directory.test.cjs',
  'docs/ACCOUNTS.md','docs/ADMIN.md','server/package.json','server/pnpm-lock.yaml','server/Dockerfile','server/.dockerignore',
  'server/deploy/compose.yaml','server/deploy/Caddyfile','server/deploy/.env.example','server/deploy/preflight.cjs'];
 const dirs=['InzoiSocial/lua','server/src','server/admin','server/avatar','server/tools','server/test'];
 const list=[...fixed,...uiFiles.map(file=>'InzoiSocial/ui/OnlineBridge/'+file),...dirs.flatMap(dir=>walk(path.join(root,dir)).map(file=>path.relative(root,file).replaceAll('\\','/')))];
 for(const relative of list){
  if(/(?:^|\/)(?:backups|artifacts|private|node_modules|\.git)(?:\/|$)|^server\/data\/|^InzoiSocial\/(?:data|online)\/|(?:^|\/)(?:\.env|session\.cfg|config\.cfg|media\.key)$|\.(?:sqlite|zip|7z|rar|exe|dll)$/i.test(relative))throw Error('Private or unexpected source: '+relative);
  write(destination,relative,fs.readFileSync(path.join(root,relative)));
 }
 const pkg=JSON.parse(fs.readFileSync(path.join(destination,'package.json')));pkg.scripts={test:'node --test tests/*.test.cjs','build:locales':'node tools/build-locales.cjs','server:test':'node --test server/test/*.test.cjs','server:start':'node server/src/main.cjs','package:manual':'node tools/package-nexus.cjs'};write(destination,'package.json',JSON.stringify(pkg,null,2)+'\n');
 write(destination,'README.md',fs.readFileSync(path.join(root,publication+'/REVIEW.md')));
 return walk(destination).map(file=>({path:path.relative(destination,file).replaceAll('\\','/'),sha256:digest(fs.readFileSync(file))}));
}
function main(){
 if(process.argv[2]==='--directory'){
  if(!process.argv[3])throw Error('Pass an empty output directory');
  const result=buildManual(path.resolve(process.argv[3],defaultModId));console.log(JSON.stringify(result,null,2));return;
 }
 if(process.argv.length>2)throw Error('Usage: node tools/package-nexus.cjs [--directory OUTPUT]');
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,stamp=new Date().toISOString().replace(/[-:.]/g,'');
 const releases=path.join(root,'artifacts/releases'),build=path.join(releases,'nexus-build-'+stamp),stage=path.join(build,defaultModId);
 const result=buildManual(stage),zip=path.join(releases,'Zoigram-'+version+'-Manual-'+stamp+'.zip');zipDirectory(build,zip);
 const sources=path.join(releases,'nexus-source-'+stamp),sourceRoot=path.join(sources,'Zoigram-Source'),sourceFiles=sourcePackage(sourceRoot);
 const sourceZip=path.join(releases,'Zoigram-'+version+'-Review-Source-'+stamp+'.zip');zipDirectory(sources,sourceZip);
 const report={...result,checkedAt:new Date().toISOString(),stagingDirectory:stage,zip,bytes:fs.statSync(zip).size,sha256:digest(fs.readFileSync(zip)),sourceZip,sourceRoot,sourceFiles,sourceSha256:digest(fs.readFileSync(sourceZip))};
 const reports=path.join(root,'artifacts/game-discovery');fs.mkdirSync(reports,{recursive:true});fs.writeFileSync(path.join(reports,'nexus-release.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({version,zip,bytes:report.bytes,sha256:report.sha256,sourceZip,sourceSha256:report.sourceSha256,files:result.files.length,sourceFiles:sourceFiles.length},null,2));
}
module.exports={buildManual,sourcePackage,zipDirectory};
if(require.main===module)try{main()}catch(error){console.error(error.stack);process.exitCode=1}
