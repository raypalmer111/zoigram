'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {generate,languages}=require('../tools/build-locales.cjs');
const rows=JSON.parse(fs.readFileSync('locales/messages.json','utf8')),keys=new Set(rows.map(r=>r[0]));
test('all six complete catalogs have identical placeholders and shipped files are current',()=>{
 assert.equal(languages.length,6);assert(rows.length>170);
 for(const [file,expected]of Object.entries(generate()))assert.equal(fs.readFileSync(file,'utf8'),expected,file+' is stale');
 const html=fs.readFileSync('InzoiSocial/ui/OnlineBridge/index.html','utf8');assert(html.indexOf('locales.js')<html.indexOf('app.js'));
});
test('every active native UI message and server or bridge failure has a translation',()=>{
 for(const file of ['server/src/uploads.cjs','server/src/announcements.cjs','InzoiSocial/ui/OnlineBridge/photos.js','InzoiSocial/lua/B1/Online/Announcements.lua','InzoiSocial/lua/B1/UI/AnnouncementCards.lua','InzoiSocial/lua/B1/UI/AlbumComposer.lua','InzoiSocial/lua/B1/Online/Publishing.lua','server/src/albums.cjs','InzoiSocial/lua/B1/UI/Pages/OnlinePage.lua','InzoiSocial/lua/B1/UI/SocialAppView.lua','InzoiSocial/lua/B1/Localization.lua','InzoiSocial/lua/B1/Online/Controller.lua','InzoiSocial/lua/B1/Online/Transport.lua','InzoiSocial/lua/B1/Game/PhotoFlow.lua','InzoiSocial/ui/OnlineBridge/app.js','server/src/app.cjs','server/src/accounts.cjs','server/src/passwords.cjs']){
  const source=fs.readFileSync(file,'utf8');
  for(const match of source.matchAll(/(?:L\.t\(|error=|notice=|fail\(\d+,|new AuthError\(|Error\()'([^'\r\n]+)'/g))if(/[А-Яа-яЁё]/.test(match[1]))assert(keys.has(match[1]),file+': '+match[1]);
 }
});
