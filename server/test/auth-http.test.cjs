'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../src/app.cjs');const {ENDPOINT}=require('../src/steam.cjs');
test('browser redirect, Steam callback and game polling establish one reusable identity',async t=>{
 const origin='https://zoigram.example';let verifications=0;
 const app=createApp({database:':memory:',origin,steamFetch:async(url,opts)=>{assert.equal(url,ENDPOINT);assert.equal(new URLSearchParams(opts.body).get('openid.mode'),'check_authentication');verifications++;return new Response('is_valid:true\n')}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const local='http://127.0.0.1:'+app.server.address().port;
 const request=(p,options={})=>fetch(local+p,{redirect:'manual',...options,headers:{'Accept-Language':'ru',...options.headers}});
 const poll=token=>request('/api/auth/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceToken:token})});
 async function login(){
  const d=await(await request('/api/auth/device',{method:'POST'})).json();assert(d.verificationUrl.startsWith(origin+'/connect?code='));
  assert.equal((await(await poll(d.deviceToken)).json()).status,'pending');
  const page=await request('/connect?code='+d.userCode);assert.equal(page.status,200);assert((await page.text()).includes(d.userCode));
  const start=await request('/auth/steam?code='+d.userCode);assert.equal(start.status,303);
  const cookie=start.headers.get('set-cookie');assert(cookie.includes('HttpOnly'));assert(cookie.includes('Secure'));assert(cookie.includes('SameSite=Lax'));
  const redirect=new URL(start.headers.get('location'));assert.equal(redirect.origin+redirect.pathname,ENDPOINT);const returnTo=redirect.searchParams.get('openid.return_to');const callback=new URL(returnTo);
  for(const [k,v]of Object.entries({ns:'http://specs.openid.net/auth/2.0',mode:'id_res',op_endpoint:ENDPOINT,claimed_id:'https://steamcommunity.com/openid/id/76561198000000001',identity:'https://steamcommunity.com/openid/id/76561198000000001',return_to:returnTo,response_nonce:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')+require('node:crypto').randomUUID(),signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',sig:'test',assoc_handle:'test'}))callback.searchParams.set('openid.'+k,v);
  const path=callback.pathname+callback.search;assert.equal((await request(path)).status,400);
  const completed=await request(path,{headers:{Cookie:cookie.split(';')[0]}});assert.equal(completed.status,200);assert((await completed.text()).includes('Вход подтверждён'));
  assert.equal((await request(path,{headers:{Cookie:cookie.split(';')[0]}})).status,400);
  const result=await(await poll(d.deviceToken)).json();assert.equal(result.status,'complete');assert.equal(result.token.length,43);assert.equal((await poll(d.deviceToken)).status,410);
  assert.equal((await request('/api/me',{headers:{Authorization:'Bearer '+result.token}})).status,200);return result;
 }
 const first=await login(),second=await login();assert.equal(first.profile.id,second.profile.id);assert.notEqual(first.token,second.token);assert.equal(verifications,2);assert.equal(app.db.prepare("SELECT COUNT(*) n FROM profiles WHERE provider='steam'").get().n,1);
});
