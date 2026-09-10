'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApp}=require('../src/app.cjs'),I18n=require('../src/i18n.cjs'),{identity,session}=require('../src/store.cjs');
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
  const headers={'Accept-Language':language};const denied=await request('/api/me',{headers});assert.equal(denied.status,401);assert.equal(denied.headers.get('content-language'),language);const body=await denied.json();assert.equal(body.error,I18n.t(language,'Войдите в Zoigram.'));assert.equal(body.messageKey,'Войдите в Zoigram.');
  const profile=(await(await request('/api/me',{headers:{...headers,...auth}})).json()).profile;assert.equal(profile.displayName,'Лента');assert.equal(profile.bio,'Сохранить');assert.equal(profile.id,person.id);
  const feed=await(await request('/api/feed',{headers:{...headers,...auth}})).json();assert.equal(feed.posts[0].caption,'Профиль 한국어 Français 🌆');
  const invalid=await request('/api/me',{method:'PATCH',headers:{...headers,...auth,'Content-Type':'application/json'},body:JSON.stringify({username:'rename',displayName:'name'})});assert.equal(invalid.status,403);assert.equal((await invalid.json()).error,I18n.t(language,'ID аккаунта закреплён. Изменить его может только модератор.'));
 }));
 const unsupported=await request('/api/me',{headers:{'Accept-Language':'de-DE'}});assert.equal((await unsupported.json()).error,'Sign in to Zoigram.');
});
test('password forms retain all four languages, mask passwords and never redirect to Steam',async t=>{
 const {request}=await fixture(t);
 for(const language of I18n.languages){
  const d=await(await request('/api/auth/device',{method:'POST',headers:{'Accept-Language':language}})).json();
  assert.equal(new URL(d.verificationUrl).searchParams.get('lang'),language);
  const r=await request('/connect?code='+d.userCode+'&mode=register&lang='+language),html=await r.text();
  assert.equal(r.status,200);assert(html.includes('<html lang="'+language+'">'));assert(html.includes(I18n.t(language,'Создать аккаунт')));assert(html.includes('type="password"'));assert(!html.includes('steamcommunity.com'));
  const cookie=r.headers.getSetCookie()[0].split(';')[0],csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
  const invalid=await request('/account/register?lang='+language,{method:'POST',headers:{Origin:'https://zoigram.example',Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,login:'new_player',password:'short'})});
  assert.equal(invalid.status,400);assert((await invalid.text()).includes(I18n.t(language,'Пароль: от 15 до 128 символов. Можно использовать фразу.')));
  const expired=await request('/connect?code=INVALID&lang='+language);assert.equal(expired.status,410);
  const home=await(await request('/?lang='+language)).text();assert(home.includes('<html lang="'+language+'">'));
 }
});
