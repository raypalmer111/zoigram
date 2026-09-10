'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApp}=require('../src/app.cjs'),I18n=require('../src/i18n.cjs'),{identity,session}=require('../src/store.cjs'),{ENDPOINT}=require('../src/steam.cjs');
async function fixture(t,options={}){const app=createApp({database:':memory:',origin:'https://zoigram.example',...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());return {app,request:(p,options={})=>fetch('http://127.0.0.1:'+app.server.address().port+p,{redirect:'manual',...options})}}
test('language negotiation handles regional tags, priorities, exclusions and fallback',()=>{
 assert.equal(I18n.normalize('ko-KR'),'ko');assert.equal(I18n.normalize('fr_CA'),'fr');
 assert.equal(I18n.negotiate('de-DE, fr-CA;q=0.8, en;q=0.5'),'fr');assert.equal(I18n.negotiate('ko;q=0,ru;q=.6,en;q=.9'),'en');assert.equal(I18n.negotiate('de,fr;q=invalid'),'en');
 assert.equal(I18n.t('ko','Код: {code}',{code:'ABC123'}),'코드: ABC123');assert.equal(I18n.t('xx','Профиль'),'Profile');
});
test('concurrent API requests use their own language and never translate player content',async t=>{
 const {app,request}=await fixture(t);const person=identity(app.db,'test','locale-person');app.db.prepare('UPDATE profiles SET display_name=?,bio=? WHERE id=?').run('Лента','Сохранить',person.id);const access=session(app.db,person.id),auth={Authorization:'Bearer '+access.token};
 const image=await require('sharp')({create:{width:64,height:64,channels:3,background:'#eeeeee'}}).png().toBuffer();
 const post=await request('/api/posts',{method:'POST',headers:{...auth,'Content-Type':'application/json','Accept-Language':'ko'},body:JSON.stringify({requestId:crypto.randomUUID(),caption:'Профиль 한국어 Français 🌆',imageBase64:image.toString('base64')})});assert.equal(post.status,201);
 await Promise.all(I18n.languages.map(async language=>{
  const headers={'Accept-Language':language};const denied=await request('/api/me',{headers});assert.equal(denied.status,401);assert.equal(denied.headers.get('content-language'),language);const body=await denied.json();assert.equal(body.error,I18n.t(language,'Войдите через Steam.'));assert.equal(body.messageKey,'Войдите через Steam.');
  const profile=(await(await request('/api/me',{headers:{...headers,...auth}})).json()).profile;assert.equal(profile.displayName,'Лента');assert.equal(profile.bio,'Сохранить');assert.equal(profile.id,person.id);
  const feed=await(await request('/api/feed',{headers:{...headers,...auth}})).json();assert.equal(feed.posts[0].caption,'Профиль 한국어 Français 🌆');
  const invalid=await request('/api/me',{method:'PATCH',headers:{...headers,...auth,'Content-Type':'application/json'},body:JSON.stringify({username:'rename',displayName:'name'})});assert.equal(invalid.status,403);assert.equal((await invalid.json()).error,I18n.t(language,'ID аккаунта закреплён. Изменить его может только модератор.'));
 }));
 const unsupported=await request('/api/me',{headers:{'Accept-Language':'de-DE'}});assert.equal((await unsupported.json()).error,'Sign in with Steam.');
});
test('all Steam pages retain the chosen language through redirect and verified callback',async t=>{
 const {request}=await fixture(t,{steamFetch:async()=>new Response('is_valid:true\n')});
 for(const language of I18n.languages){
  const device=await(await request('/api/auth/device',{method:'POST',headers:{'Accept-Language':language}})).json();assert.equal(new URL(device.verificationUrl).searchParams.get('lang'),language);
  const connect=await request(new URL(device.verificationUrl).pathname+new URL(device.verificationUrl).search,{headers:{'Accept-Language':'de'}});const html=await connect.text();assert(html.includes('<html lang="'+language+'">'));assert(html.includes(I18n.t(language,'Войти в Zoigram')));assert(html.includes('&amp;lang='+language));assert(html.includes(device.userCode));
  const start=await request('/auth/steam?code='+device.userCode+'&lang='+language);assert.equal(start.status,303);const cookies=start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert(cookies.includes('zg_lang='+language));
  const redirect=new URL(start.headers.get('location'));assert.equal(redirect.origin+redirect.pathname,ENDPOINT);const returnTo=redirect.searchParams.get('openid.return_to'),callback=new URL(returnTo);
  for(const [k,v]of Object.entries({ns:'http://specs.openid.net/auth/2.0',mode:'id_res',op_endpoint:ENDPOINT,claimed_id:'https://steamcommunity.com/openid/id/76561198000000001',identity:'https://steamcommunity.com/openid/id/76561198000000001',return_to:returnTo,response_nonce:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')+crypto.randomUUID(),signed:'op_endpoint,claimed_id,identity,return_to,response_nonce',sig:'test'}))callback.searchParams.set('openid.'+k,v);
  const bad=await request(callback.pathname+callback.search,{headers:{Cookie:'zg_lang='+language}});assert.equal(bad.status,400);assert((await bad.text()).includes('<html lang="'+language+'">'));
  const completed=await request(callback.pathname+callback.search,{headers:{Cookie:cookies,'Accept-Language':'en'}});assert.equal(completed.status,200);const final=await completed.text();assert(final.includes('<html lang="'+language+'">'));assert(final.includes(I18n.t(language,'Вход подтверждён').replaceAll("'",'&#39;')));
  const home=await(await request('/?lang='+language)).text();assert(home.includes('<html lang="'+language+'">'));
  const expired=await request('/connect?code=INVALID&lang='+language);assert.equal(expired.status,400);assert((await expired.text()).includes(I18n.t(language,'Код входа истёк. Начните заново в игре.').replaceAll("'",'&#39;')));
 }
});
