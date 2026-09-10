'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApp}=require('../src/app.cjs'),{identity,session,hash,random}=require('../src/store.cjs'),Passwords=require('../src/passwords.cjs');
const origin='https://zoigram.example',PASS='A quiet river under moonlight 47',NEXT='Another long private password 98';
async function fixture(t,options={}){
 const errors=[],app=createApp({database:':memory:',origin,secret:Buffer.alloc(32,3),onError:e=>errors.push(e),...options});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();assert.deepEqual(errors,[])});
 const request=(p,o={})=>fetch('http://127.0.0.1:'+app.server.address().port+p,{redirect:'manual',...o,headers:{'Accept-Language':'ru',...o.headers}});
 const json=(p,b={},headers={},method='POST')=>request(p,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(b)});
 async function browser(mode='login',lang='ru'){
  const d=await(await json('/api/auth/device')).json(),r=await request('/connect?code='+d.userCode+'&mode='+mode+'&lang='+lang),html=await r.text();assert.equal(r.status,200);
  return {d,cookie:r.headers.getSetCookie()[0].split(';')[0],csrf:html.match(/name="csrf" value="([^"]+)"/)[1],html};
 }
 const submit=(flow,mode,b={},headers={})=>request('/account/'+mode+'?lang=ru',{method:'POST',headers:{Origin:origin,Cookie:flow.cookie,'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams({csrf:flow.csrf,...b})});
 async function register(login='moonwalker'){const flow=await browser('register'),r=await submit(flow,'register',{login,password:PASS}),html=await r.text();assert.equal(r.status,200,html);const recovery=html.match(/class="recovery">([a-f0-9-]+)</)[1];const access=await(await json('/api/auth/poll',{deviceToken:flow.d.deviceToken})).json();assert.equal(access.status,'complete');return {flow,access,recovery,login}}
 async function settings(token){
  const r=await json('/api/me/account-access',{}, {Authorization:'Bearer '+token});assert.equal(r.status,201);const ticket=await r.json();assert(!new URL(ticket.url).searchParams.has('token'));
  const exchange=await request('/account/ticket',{method:'POST',headers:{Origin:origin,Authorization:'Account '+new URL(ticket.url).hash.slice(1)}});assert.equal(exchange.status,200);
  const cookie=exchange.headers.getSetCookie()[0].split(';')[0],page=await request('/account/settings',{headers:{Cookie:cookie}}),html=await page.text();assert.equal(page.status,200);
  return {cookie,csrf:html.match(/name="csrf" value="([^"]+)"/)[1],html,ticket};
 }
 return {app,request,json,browser,submit,register,settings};
}
test('registration and device login use one identity; private login and secrets never become a public ID',async t=>{
 const f=await fixture(t),r=await f.register('MoonWalker'),p=r.access.profile;assert.notEqual(p.username,'moonwalker');assert(p.username.startsWith('player_'));assert.equal(p.accountConfigured,true);
 const row=f.app.db.prepare('SELECT * FROM account_credentials').get();assert.equal(row.login,'moonwalker');assert(row.password_hash.startsWith('scrypt1$'));assert(!JSON.stringify(row).includes(PASS));assert(!JSON.stringify(row).includes(r.recovery));
 assert.equal((await f.json('/api/auth/poll',{deviceToken:r.flow.d.deviceToken})).status,410);
 const next=await f.browser();assert.equal((await f.submit(next,'login',{login:'MOONWALKER',password:PASS})).status,200);const again=await(await f.json('/api/auth/poll',{deviceToken:next.d.deviceToken})).json();assert.equal(again.profile.id,p.id);assert.notEqual(again.token,r.access.token);
 const other=identity(f.app.db,'test','viewer'),access=session(f.app.db,other.id),pub=await(await f.request('/api/profiles/'+p.id,{headers:{Authorization:'Bearer '+access.token}})).json();assert(!JSON.stringify(pub).includes('moonwalker'));assert(!Object.hasOwn(pub.profile,'accountConfigured'));
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM account_credentials').get().n,1);
});
test('browser forms require same origin, a matching HttpOnly cookie and ASCII CSRF token',async t=>{
 const f=await fixture(t),b=await f.browser('register');
 assert(b.cookie.startsWith('__Host-zoigram_account='));assert(!b.html.includes('steamcommunity.com'));assert(b.html.includes('type="password"'));
 for(const headers of [{Origin:'https://evil.example'},{Origin:''},{Cookie:''},{'Sec-Fetch-Site':'cross-site'}]){const r=await f.submit(b,'register',{login:'intruder',password:PASS},headers);assert([403,410].includes(r.status))}
 for(const csrf of ['',random(),'я'.repeat(43)])assert.equal((await f.submit(b,'register',{login:'intruder',password:PASS,csrf})).status,403);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM profiles').get().n,0);
 assert.equal((await f.request('/auth/steam')).status,404);
 const info=await(await f.request('/api/info')).json();assert.equal(info.authentication,'password');
});
test('expired or consumed browser flows cannot create another profile',async t=>{
 const f=await fixture(t),b=await f.browser('register');f.app.db.prepare('UPDATE devices SET expires_at=1 WHERE user_code=?').run(b.d.userCode);
 assert.equal((await f.submit(b,'register',{login:'expired_user',password:PASS})).status,410);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM profiles').get().n,0);
 const r=await f.register();assert.equal((await f.submit(r.flow,'register',{login:'replayed_user',password:PASS})).status,410);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM profiles').get().n,1);
});
test('signed-in legacy profile gains credentials while keeping posts, public ID and current session',async t=>{
 const f=await fixture(t),old=identity(f.app.db,'steam','76561198000000001'),other=identity(f.app.db,'test','other'),access=session(f.app.db,old.id);
 f.app.db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(old.id,random(),'test','Old post',Date.now(),64,64,Buffer.from('photo'),Buffer.from('thumb'),10);
 const b=await f.settings(access.token);assert(b.html.includes('Настроить вход'));assert.equal((await f.submit(b,'bind',{login:'legacy_player',password:PASS,profileId:other.id})).status,200);
 const me=await(await f.request('/api/me',{headers:{Authorization:'Bearer '+access.token}})).json();assert.equal(me.profile.id,old.id);assert.equal(me.profile.username,old.username);assert.equal(me.profile.postCount,1);assert(me.profile.accountConfigured);
 assert.equal(f.app.db.prepare('SELECT profile_id FROM account_credentials').get().profile_id,old.id);
 assert.equal((await f.request('/account/ticket',{method:'POST',headers:{Origin:origin,Authorization:'Account '+new URL(b.ticket.url).hash.slice(1)}})).status,410);
 assert.equal((await f.submit(b,'bind',{login:'another_login',password:PASS})).status,410);
});
test('setup tickets reject strangers, cross-origin requests and revoked game sessions',async t=>{
 const f=await fixture(t),p=identity(f.app.db,'test','setup'),access=session(f.app.db,p.id);
 assert.equal((await f.json('/api/me/account-access')).status,401);
 const link=await(await f.json('/api/me/account-access',{}, {Authorization:'Bearer '+access.token})).json(),ticket=new URL(link.url).hash.slice(1);
 assert.equal((await f.request('/account/ticket',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Account '+ticket}})).status,403);
 f.app.db.prepare('DELETE FROM sessions WHERE profile_id=?').run(p.id);
 assert.equal((await f.request('/account/ticket',{method:'POST',headers:{Origin:origin,Authorization:'Account '+ticket}})).status,410);
});
test('recovery rotates the code and password and revokes previous game and moderator sessions',async t=>{
 const f=await fixture(t),r=await f.register(),uid=r.access.profile.id,admin=random();
 f.app.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(random(),hash(admin),uid,Date.now()+60000);
 const b=await f.browser('recover');assert.equal((await f.submit(b,'recover',{login:r.login,password:NEXT,recovery:'wrong'})).status,401);
 const reset=await f.submit(b,'recover',{login:r.login,password:NEXT,recovery:r.recovery}),html=await reset.text();assert.equal(reset.status,200,html);assert(!html.includes(r.recovery));assert(html.includes('class="recovery"'));
 assert.equal((await f.request('/api/me',{headers:{Authorization:'Bearer '+r.access.token}})).status,401);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
 const loggedIn=await(await f.json('/api/auth/poll',{deviceToken:b.d.deviceToken})).json();assert.equal(loggedIn.profile.id,uid);
 const oldCode=await f.browser('recover');assert.equal((await f.submit(oldCode,'recover',{login:r.login,password:PASS,recovery:r.recovery})).status,401);
 const login=await f.browser();assert.equal((await f.submit(login,'login',{login:r.login,password:PASS})).status,401);assert.equal((await f.submit(login,'login',{login:r.login,password:NEXT})).status,200);
});
test('password changes require the current password and keep only the initiating game session',async t=>{
 const f=await fixture(t),r=await f.register(),other=session(f.app.db,r.access.profile.id),b=await f.settings(r.access.token);
 assert.equal((await f.submit(b,'password',{login:r.login,currentPassword:'wrong',password:NEXT})).status,401);
 assert.equal((await f.submit(b,'password',{login:r.login,currentPassword:PASS,password:NEXT})).status,200);
 assert.equal((await f.request('/api/me',{headers:{Authorization:'Bearer '+r.access.token}})).status,200);
 assert.equal((await f.request('/api/me',{headers:{Authorization:'Bearer '+other.token}})).status,401);
 assert.equal((await f.submit(b,'password',{login:r.login,currentPassword:NEXT,password:PASS})).status,410);
});
test('banned accounts cannot sign in or recover, and duplicate login cannot steal their identity',async t=>{
 const f=await fixture(t),r=await f.register();f.app.db.prepare('UPDATE profiles SET banned=1 WHERE id=?').run(r.access.profile.id);
 const b=await f.browser();assert.equal((await f.submit(b,'login',{login:r.login,password:PASS})).status,401);
 const recovery=await f.browser('recover');assert.equal((await f.submit(recovery,'recover',{login:r.login,password:NEXT,recovery:r.recovery})).status,401);
 const duplicate=await f.browser('register');assert.equal((await f.submit(duplicate,'register',{login:r.login,password:NEXT})).status,409);
 assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM profiles').get().n,1);
});
test('passwords reject short values; login rejects path separators and repeated attempts are limited',async t=>{
 const f=await fixture(t),b=await f.browser('register');
 assert.equal((await f.submit(b,'register',{login:'../bad',password:PASS})).status,400);
 assert.equal((await f.submit(b,'register',{login:'valid_name',password:'short'})).status,400);
 const login=await f.browser();for(let i=0;i<12;i++)assert.equal((await f.submit(login,'login',{login:'missing',password:PASS})).status,401);
 assert.equal((await f.submit(login,'login',{login:'missing',password:PASS})).status,429);
});
test('owner password login grants a separate Secure cookie and denies normal accounts',async t=>{
 const ownerId=crypto.randomUUID(),f=await fixture(t,{ownerProfileId:ownerId}),owner=identity(f.app.db,'local','owner-seed');
 f.app.db.prepare('UPDATE profiles SET id=? WHERE id=?').run(ownerId,owner.id);
 const encoded=await Passwords.encode(PASS);f.app.db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?,?)').run(ownerId,'owner_login',encoded,hash('test-recovery'),Date.now(),Date.now());
 const other=await f.register('normal_user');
 const login=(login,password=PASS,headers={})=>f.json('/admin/auth/password',{login,password},{Origin:origin,...headers});
 assert.equal((await login('owner_login',PASS,{Origin:'https://evil.example'})).status,403);
 assert.equal((await login(other.login)).status,403);
 assert.equal((await login('owner_login','wrong')).status,401);
 const r=await login('owner_login');assert.equal(r.status,200);const cookie=r.headers.getSetCookie()[0];for(const flag of ['Secure','HttpOnly','SameSite=Lax','Path=/'])assert(cookie.includes(flag));
 const state=await(await f.request('/admin/api/session',{headers:{Cookie:cookie.split(';')[0]}})).json();assert(state.authenticated);assert.equal(state.owner.id,ownerId);
 assert.equal((await f.request('/admin/api/summary',{headers:{Authorization:'Bearer '+other.access.token}})).status,401);
});
