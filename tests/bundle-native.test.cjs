'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {buildNative}=require('../tools/bundle-native.cjs');
test('shipping Lua has a self-contained entry and no game-disallowed file imports',()=>{
 const build=buildNative({modId:'InzoiSocial_YV6DPJ',assetPath:"C:/Users/O'Brien/Documents/inZOI/Mods/InGame/InzoiSocial_YV6DPJ/assets/instagram-icon.png"});
 const entry=build.files.find(f=>f.path==='B1/PhoneIntegration.lua').content;
 assert(!/\brequire\s*\(/.test(entry));assert(!/\b(?:loadfile|loadstring|dofile)\s*\(/.test(entry));assert(!entry.includes('__ASSET_PATH__'));assert(!entry.includes('__MOD_ID__'));assert(!entry.includes("C:/Users/"));
 assert(!/(?<![.\w])NewObject\s*\(/.test(entry));assert(entry.includes('UE.NewObject('));
 const definitions=[...entry.matchAll(/factories\['([^']+)'\]=function/g)].map(m=>m[1]);const references=[...entry.matchAll(/zmodule\('([^']+)'\)/g)].map(m=>m[1]);assert.equal(new Set(definitions).size,definitions.length);for(const ref of references)assert(definitions.includes(ref),ref);
 const manifest=JSON.parse(build.files.find(f=>f.path==='lua_manifest.json').content);for(const binding of manifest.bindings.B1)assert(build.files.some(f=>f.path===binding.script.replaceAll('.','/')+'.lua'));
 const obsolete=JSON.parse(fs.readFileSync(require('node:path').resolve(__dirname,'../InzoiSocial/obsolete-files.json')));for(const f of build.files)assert(!obsolete.includes('lua/'+f.path),'Installer would remove '+f.path);
});
test('packaged icon is byte-identical and requires no installer or absolute path',()=>{
 const entry=buildNative({modId:'InzoiSocial_YV6DPJ'}).files[0].content;
 assert(!entry.includes('__ASSET_PATH__'));assert(!entry.includes('__MOD_ID__'));assert(!entry.includes('ImportFileAsTexture2D(worldContext'));
 const match=entry.match(/factories\['B1\.UI\.IconData'\]=function\(\)\s+return \{([\d,]+)\}/);assert(match,'embedded icon missing');
 assert.deepEqual(Buffer.from(match[1].split(',').map(Number)),fs.readFileSync('InzoiSocial/assets/instagram-icon.png'));
 assert(entry.includes('ImportBufferAsTexture2D'));assert(entry.includes('function M.shutdown()'));assert(entry.includes('    M.shutdown()'));
});
test('shipping Lua contains private activity, messaging and report flows inside the native phone',()=>{
 const entry=buildNative({modId:'InzoiSocial_YV6DPJ'}).files[0].content;
 for(const endpoint of ['/api/activity','/api/notifications','/api/conversations/'])assert(entry.includes(endpoint),endpoint);
 for(const action of ["action('report',{kind='post'","action('report',{kind='comment'","'ReportProfileDirect'"])assert(entry.includes(action),action);
 assert(entry.includes("descendant(canvas,'WBP_Common_CloseButton')"));assert(entry.includes('self.closeButton:SetVisibility(UE.ESlateVisibility.Collapsed)'));assert(entry.includes('self.closeButton:SetVisibility(self.originalCloseVisibility)'));
});
