'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {buildManual,sourcePackage}=require('../tools/package-nexus.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'zoigram-nexus-'));t.after(()=>{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'zoigram-nexus-'));fs.rmSync(root,{recursive:true,force:true})});return root}
test('manual release has only declared runtime files, plugin and copy-install instructions',t=>{
 const root=fixture(t),destination=path.join(root,'InzoiSocial_YV6DPJ'),r=buildManual(destination);
 const manifest=JSON.parse(fs.readFileSync(path.join(destination,'mod_manifest.json')));
 assert.equal(manifest.ProjectName,r.modId);assert.equal(manifest.bEnable,true);
 const allowed=new Set(['.lua','.json','.uplugin','.js','.html','.png','.txt']);
 for(const item of r.files){assert(allowed.has(path.extname(item.path))||item.path.endsWith('/.keep'),item.path);assert(!/^(?:online|data|backups)\//.test(item.path));assert(!item.path.includes('..'))}
 assert.equal(r.files.length,manifest.NonAssets.length+3);
 for(const file of manifest.NonAssets)assert(r.files.some(item=>'/'+item.path===file));
 const lua=fs.readFileSync(path.join(destination,'lua/B1/PhoneIntegration.lua'),'utf8');
 assert(!/__MOD_ID__|__ASSET_PATH__|C:[/\\]Users[/\\]/.test(lua));
 assert.equal(JSON.parse(fs.readFileSync(path.join(destination,r.modId+'.uplugin'))).VersionName,r.version);
 assert(!fs.existsSync(path.join(destination,'Install.ps1')));assert.throws(()=>buildManual(destination),/empty/);
});
test('documented copy update removes obsolete Lua and UI without changing accounts or original photos',t=>{
 const root=fixture(t),stage=path.join(root,'release'),installed=path.join(root,'Документы OneDrive','inZOI','Mods','InGame','InzoiSocial_YV6DPJ');
 buildManual(stage);
 const keep={'online/session.cfg':'preserved-test-session','online/config.cfg':'preserved-test-settings','assets/post_1_2_3.png':'preserved-original-photo'};
 for(const [file,value]of Object.entries({...keep,'lua/B1/Old.lua':'old code','ui/Old/index.html':'obsolete UI'})){fs.mkdirSync(path.dirname(path.join(installed,file)),{recursive:true});fs.writeFileSync(path.join(installed,file),value)}
 for(const name of ['lua','ui']){const target=path.resolve(installed,name);assert(target.startsWith(path.resolve(installed)+path.sep));fs.rmSync(target,{recursive:true})}
 fs.cpSync(stage,installed,{recursive:true});for(const [file,value]of Object.entries(keep))assert.equal(fs.readFileSync(path.join(installed,file),'utf8'),value);
 assert(!fs.existsSync(path.join(installed,'lua/B1/Old.lua')));assert(!fs.existsSync(path.join(installed,'ui/Old')));
 assert(fs.existsSync(path.join(installed,'ui/OnlineBridge/uploads/.keep')));
});
test('review source alone rebuilds identical client contents without installed game files or npm packages',t=>{
 const root=fixture(t),source=path.join(root,'source'),original=path.join(root,'original'),rebuilt=path.join(root,'rebuilt');
 const before=buildManual(original),files=sourcePackage(source);
 assert(files.some(f=>f.path==='server/src/avatars.cjs'));assert(files.some(f=>f.path==='tools/Install-Native.ps1'));
 assert(!files.some(f=>/^(?:artifacts|server\/(?:data|backups|node_modules))\//.test(f.path)));
 const run=cp.spawnSync(process.execPath,[path.join(source,'tools/package-nexus.cjs'),'--directory',rebuilt],{cwd:source,encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout).files,before.files);
});
