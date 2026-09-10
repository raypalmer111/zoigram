'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../src/app.cjs');
test('concurrent registration consumes one device approval and polling returns only one session',async t=>{
 const origin='https://zoigram.example',errors=[],app=createApp({database:':memory:',origin,onError:e=>errors.push(e)});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();assert.deepEqual(errors,[])});
 const request=(p,options={})=>fetch('http://127.0.0.1:'+app.server.address().port+p,{redirect:'manual',...options});
 const device=await(await request('/api/auth/device',{method:'POST'})).json();
 const poll=()=>request('/api/auth/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceToken:device.deviceToken})});
 assert.equal((await(await poll()).json()).status,'pending');
 const page=await request('/connect?code='+device.userCode+'&mode=register'),html=await page.text();
 const headers={Origin:origin,Cookie:page.headers.getSetCookie()[0].split(';')[0],'Content-Type':'application/x-www-form-urlencoded'};
 const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
 const responses=await Promise.all(['race_one','race_two'].map(login=>request('/account/register',{method:'POST',headers,body:new URLSearchParams({login,password:'Long test passphrase for race 89',csrf})})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,410]);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM profiles').get().n,1);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM account_credentials').get().n,1);
 const polls=await Promise.all([poll(),poll()]);assert.deepEqual(polls.map(r=>r.status).sort(),[200,410]);
 const access=await polls.find(r=>r.status===200).json();assert.equal(access.status,'complete');assert.equal(access.token.length,43);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
 assert.equal((await request('/api/me',{headers:{Authorization:'Bearer '+access.token}})).status,200);
 for(const url of ['/auth/steam','/auth/steam/callback','/admin/auth/start','/admin/auth/callback']){const r=await request(url);assert([401,404].includes(r.status));assert.equal(r.headers.get('location'),null)}
});
