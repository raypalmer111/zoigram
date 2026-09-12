'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('InzoiSocial/ui/OnlineBridge/app.js','utf8');
const encode=v=>Buffer.from(JSON.stringify(v)).toString('hex'),decode=v=>JSON.parse(Buffer.from(v,'hex'));
async function fixture({session,route=()=>({status:200,body:{ok:true}}),previous}={}){
 const config={session:encode(session||{}),response:encode(previous||{})},calls=[],timers=new Map();let ready,tick,next=0;
 class XHR{open(method,url){this.method=method;this.url=url;this.headers={}}setRequestHeader(k,v){this.headers[k]=v}abort(){this.aborted=true}send(body){this.body=body;calls.push(this);const r=route(this);if(r===null)return;this.status=r.status;this.response=r.raw;this.responseText=JSON.stringify(r.body);queueMicrotask(()=>this.onload())}}
 const context={window:{inzoi:{cli:{execute:async(name,args)=>{if(name==='uimod.cfg_load')return {success:true,data:{value:config[args.key]}};config[args.key]=args.value;return {success:true,data:{saved:true}}}}}},engine:{on:(event,fn)=>{ready=fn}},XMLHttpRequest:XHR,Uint8Array,Date,JSON,Promise,Error,escape,unescape,encodeURIComponent,decodeURIComponent,setInterval:fn=>{tick=fn},setTimeout:fn=>{timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync('InzoiSocial/ui/OnlineBridge/locales.js','utf8'),context);vm.runInNewContext(source,context);await ready();await new Promise(setImmediate);
 return {config,calls,timers,run:async(job)=>{config.request=encode({id:String(++next),createdAt:Date.now()/1000,method:'GET',server:'http://127.0.0.1:43821',path:'/api/me',...job});await tick();return decode(config.response)},start:job=>{config.request=encode({id:'timeout-job',createdAt:Date.now()/1000,server:'http://127.0.0.1:43821',...job});return tick()},tick};
}
const session={server:'http://127.0.0.1:43821',token:'test-token',expiresAt:Date.now()+600000};
test('native activity, conversations and avatar actions reach authenticated API through the real allowlist',async()=>{
 const f=await fixture({session}),id='11111111-1111-4111-8111-111111111111';
 for(const path of ['/api/activity','/api/notifications','/api/notifications/read','/api/notifications?before=9','/api/conversations','/api/conversations/'+id+'/messages','/api/conversations/'+id+'/read','/api/me/avatar-upload','/api/me/avatar','/api/me/account-access']){
  const before=f.calls.length;assert.equal((await f.run({path})).status,200,path);assert.equal(f.calls.length,before+1,path);assert.equal(f.calls.at(-1).headers.Authorization,'Bearer test-token');
 }
 assert.equal((await f.run({method:'POST',path:'/api/me/account-access',body:{}})).status,200);
 for(const path of ['/api/admin','/api/me/avatar/../../session','/api/conversations/../../me','/api/notifications#x'])assert.equal((await f.run({path})).status,0);
});
test('bridge unwraps game SDK results and binds saved authentication to its server',async()=>{
 const f=await fixture({session});assert.equal((await f.run({})).status,200);assert.equal(f.calls[0].headers.Authorization,'Bearer test-token');
 assert.equal((await f.run({server:'https://another.example'})).status,401);assert.equal(f.calls.length,1);
 assert.equal((await f.run({server:'http://unsafe.example'})).status,0);assert.equal(f.calls.length,1);
});
test('large Photo Mode upload uses a plain local URL and preserves byte content and request identity',async()=>{
 const bytes=require('node:crypto').randomBytes(3311142);const f=await fixture({session,route:x=>x.url.startsWith('uploads/')?{status:0,raw:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}:{status:201,body:{post:{id:42}}}});
 const result=await f.run({method:'POST',path:'/api/posts',body:{requestId:'stable-request',caption:'Мой кадр 🌆'},upload:'outgoing_1.png'});assert.equal(result.status,201);
 assert.equal(f.calls[0].url,'uploads/outgoing_1.png');assert.equal(f.calls[0].headers.Authorization,undefined);const sent=JSON.parse(f.calls[1].body);assert.equal(sent.requestId,'stable-request');assert.equal(sent.caption,'Мой кадр 🌆');assert.deepEqual(Buffer.from(sent.imageBase64,'base64'),bytes);
 await f.tick();assert.equal(f.calls.length,2);
});
test('login persists credentials without copying them into native responses; logout clears them',async()=>{
 const f=await fixture({route:x=>x.url.endsWith('/poll')?{status:200,body:{status:'complete',token:'new-secret',expiresAt:Date.now()+600000,profile:{id:'user'}}}:{status:200,body:{ok:true}}});
 const r=await f.run({method:'POST',path:'/api/auth/poll',body:{deviceToken:'device'}});assert.equal(r.body.token,undefined);assert.equal(decode(f.config.session).token,'new-secret');
 await f.run({method:'DELETE',path:'/api/session'});assert.deepEqual(decode(f.config.session),{});assert.equal((await f.run({})).status,401);
});
test('manual timeout releases a hung Cohtml local-file request so the user can retry',async()=>{
 const f=await fixture({session,route:()=>null});const task=f.start({method:'POST',path:'/api/posts',upload:'outgoing_2.png',body:{requestId:'retry-request',caption:''}});await new Promise(setImmediate);assert.equal(f.calls.length,1);for(const timer of f.timers.values())timer();await task;assert.equal(decode(f.config.response).status,0);assert(f.calls[0].aborted);
});

test('language follows each job and local errors are translated without altering content',async()=>{
 const f=await fixture({session});
 for(const [language,message]of [['en','Sign in to Zoigram.'],['fr','Connectez-vous à Zoigram.'],['ko','Zoigram에 로그인해 주세요.'],['ru','Войдите в Zoigram.']]){
  const ok=await f.run({language});assert.equal(ok.status,200);assert.equal(f.calls.at(-1).headers['Accept-Language'],language);
  const denied=await f.run({server:'https://other.example',language});assert.equal(denied.status,401);assert.equal(denied.body.error,message);assert.equal(denied.body.messageKey,'Войдите в Zoigram.');
 }
});

test('search and caption editing cross the bridge with unchanged queries and optimistic concurrency data',async()=>{const f=await fixture({session});const path='/api/profiles/search?q=%40%D0%9C%D0%B8%D0%BD%D0%B0&after=11111111-1111-4111-8111-111111111111';assert.equal((await f.run({path})).status,200);assert(f.calls.at(-1).url.endsWith(path));const body={caption:'New 🌆',expectedCaption:'Before'};assert.equal((await f.run({method:'PATCH',path:'/api/posts/12',body})).status,200);assert.deepEqual(JSON.parse(f.calls.at(-1).body),body);for(const path of ['/api/profiles/search/../../me','/api/profiles/search?q=x#y','/api/profiles/search?q=x\\evil'])assert.equal((await f.run({path})).status,0);});

test('bookmarks cross the bridge with comment capability and Chinese/German request locales',async()=>{
 const f=await fixture({session});for(const [method,path]of [['GET','/api/saved'],['GET','/api/saved?before=14'],['PUT','/api/posts/3/save'],['DELETE','/api/posts/3/save']]){const r=await f.run({method,path,language:'zh'});assert.equal(r.status,200);assert.equal(f.calls.at(-1).headers['X-Zoigram-Features'],'comment-notifications');assert.equal(f.calls.at(-1).headers['Accept-Language'],'zh')}
 const denied=await f.run({server:'https://other.example',language:'de'});assert.equal(denied.body.error,'Melde dich bei Zoigram an.');const n=f.calls.length;for(const path of ['/api/saved?profile=other','/api/posts/3/save/../../me'])assert.equal((await f.run({path})).status,0);assert.equal(f.calls.length,n);
});

test('unread conversation filtering and its cursor cross the real bridge allowlist',async()=>{const f=await fixture({session});for(const path of ['/api/conversations?filter=unread','/api/conversations?filter=all','/api/conversations?filter=unread&before=18']){assert.equal((await f.run({path})).status,200);assert(f.calls.at(-1).url.endsWith(path))}for(const path of ['/api/conversations?filter=unread#x','/api/conversations?filter=admin','/api/conversations?filter=unread&owner=other'])assert.equal((await f.run({path})).status,0)});
