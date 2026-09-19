'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('InzoiSocial/ui/OnlineBridge/app.js','utf8');
const encode=v=>Buffer.from(JSON.stringify(v)).toString('hex'),decode=v=>JSON.parse(Buffer.from(v,'hex'));
async function fixture({session,route=()=>({status:200,body:{ok:true}}),previous}={}){
 const config={session:encode(session||{}),response:encode(previous||{})},calls=[],timers=new Map();let ready,tick,next=0;
 class XHR{open(method,url){this.method=method;this.url=url;this.headers={};this.upload={}}setRequestHeader(k,v){this.headers[k]=v}abort(){this.aborted=true}send(body){this.body=body;calls.push(this);const r=route(this);if(r===null)return;this.status=r.status;this.response=r.raw;this.responseText=r.text!==undefined?r.text:JSON.stringify(r.body);if(this.upload.onprogress)this.upload.onprogress({lengthComputable:true,loaded:50,total:100});queueMicrotask(()=>{if(r.error){if(this.onerror)this.onerror();}else if(this.onload)this.onload();})}}
 const context={window:{inzoi:{cli:{execute:async(name,args)=>{if(name==='uimod.cfg_load')return {success:true,data:{value:config[args.key]}};config[args.key]=args.value;return {success:true,data:{saved:true}}}}}},engine:{on:(event,fn)=>{ready=fn}},XMLHttpRequest:XHR,Uint8Array,Date,JSON,Promise,Error,escape,unescape,encodeURIComponent,decodeURIComponent,setInterval:fn=>{tick=fn},setTimeout:fn=>{timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync('InzoiSocial/ui/OnlineBridge/locales.js','utf8'),context);vm.runInNewContext(fs.readFileSync('InzoiSocial/ui/OnlineBridge/photos.js','utf8'),context);vm.runInNewContext(source,context);await ready();await new Promise(setImmediate);
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
 const f=await fixture({session});for(const [method,path]of [['GET','/api/saved'],['GET','/api/saved?before=14'],['PUT','/api/posts/3/save'],['DELETE','/api/posts/3/save']]){const r=await f.run({method,path,language:'zh'});assert.equal(r.status,200);assert.equal(f.calls.at(-1).headers['X-Zoigram-Features'],'comment-notifications,mention-notifications,pinned-posts');assert.equal(f.calls.at(-1).headers['Accept-Language'],'zh')}
 const denied=await f.run({server:'https://other.example',language:'de'});assert.equal(denied.body.error,'Melde dich bei Zoigram an.');const n=f.calls.length;for(const path of ['/api/saved?profile=other','/api/posts/3/save/../../me'])assert.equal((await f.run({path})).status,0);assert.equal(f.calls.length,n);
});

test('unread conversation filtering and its cursor cross the real bridge allowlist',async()=>{const f=await fixture({session});for(const path of ['/api/conversations?filter=unread','/api/conversations?filter=all','/api/conversations?filter=unread&before=18']){assert.equal((await f.run({path})).status,200);assert(f.calls.at(-1).url.endsWith(path))}for(const path of ['/api/conversations?filter=unread#x','/api/conversations?filter=admin','/api/conversations?filter=unread&owner=other'])assert.equal((await f.run({path})).status,0)});

test('albums read all five distinct local files in order and preserve the pending request ID',async()=>{
 const f=await fixture({session,route:x=>x.url.startsWith('uploads/')?{status:0,raw:Uint8Array.from({length:64},()=>Number(x.url.match(/_(\d)/)[1])).buffer}:{status:201,body:{post:{id:90}}}});
 const upload=Array.from({length:5},(_,i)=>'outgoing_'+(i+1)+'.png');const r=await f.run({method:'POST',path:'/api/posts',upload,body:{requestId:'album-stable',caption:'Order'}});assert.equal(r.status,201);
 const body=JSON.parse(f.calls.at(-1).body);assert.equal(body.requestId,'album-stable');assert.equal(body.imagesBase64.length,5);body.imagesBase64.forEach((v,i)=>assert.equal(Buffer.from(v,'base64')[0],i+1));assert.equal(decode(f.config.progress).percent,50);
 assert.equal((await f.run({path:'/api/posts/request/album-stable'})).status,201);
});
test('local photo errors remain distinct from server errors and never send a partial album',async()=>{
 const f=await fixture({session,route:()=>({status:404})});const r=await f.run({method:'POST',path:'/api/posts',language:'en',upload:['outgoing_1.png','outgoing_2.png'],body:{requestId:'stable-album',caption:''}});
 assert.equal(r.status,0);assert.equal(r.body.submitted,false);assert.equal(r.body.messageKey,'Не удалось прочитать снимок.');assert.equal(f.calls.length,1);
 for(const upload of [[],['outgoing_1.png','outgoing_1.png'],['../session.cfg'],Array(6).fill('outgoing_1.png')]){const before=f.calls.length;assert.equal((await f.run({method:'POST',path:'/api/posts',upload,body:{}})).status,0);assert.equal(f.calls.length,before)}
});
test('non-JSON HTTP failures keep their status and do not show HTML; malformed success is uncertain',async()=>{
 for(const status of [413,429,502,200]){const f=await fixture({session,route:()=>({status,text:'<html>proxy response</html>'})});const r=await f.run({});assert.equal(r.status,status===200?0:status);assert(!r.body.error.includes('<html>'));if(status===502)assert.equal(r.body.messageKey,'Сервер временно недоступен. Повторите отправку.')}
});

const resumedFiles=Array.from({length:5},(_,i)=>'outgoing_'+(i+1)+'.png');
const resumedJob={method:'POST',path:'/api/posts',language:'en',upload:resumedFiles,body:{requestId:'resumable-stable-080',caption:'Five views 🌆',resumable:true}};
function localPhoto(url){return Uint8Array.from({length:64},()=>Number(url.match(/_(\d)/)[1])).buffer;}
test('resumable albums read and send only missing parts, then complete exactly once',async()=>{
 const f=await fixture({session,route:x=>{
  if(x.url.startsWith('uploads/'))return {status:0,raw:localPhoto(x.url)};
  if(x.method==='GET'||x.url.endsWith('/api/uploads'))return {status:200,body:{received:[0,1]}};
  if(x.url.endsWith('/complete'))return {status:201,body:{post:{id:81}}};
  return {status:200,body:{ok:true}};
 }});
 const result=await f.run(resumedJob);assert.equal(result.status,201);assert.equal(result.body.post.id,81);
 assert.deepEqual(f.calls.filter(x=>x.url.startsWith('uploads/')).map(x=>x.url),['uploads/outgoing_3.png','uploads/outgoing_4.png','uploads/outgoing_5.png']);
 const parts=f.calls.filter(x=>x.method==='PUT');assert.deepEqual(parts.map(x=>Number(x.url.split('/').at(-1))),[2,3,4]);parts.forEach((part,i)=>{assert.equal(Buffer.from(JSON.parse(part.body).imageBase64,'base64')[0],i+3);assert.equal(part.headers.Authorization,'Bearer test-token');});
 assert.equal(f.calls.filter(x=>x.url.endsWith('/complete')).length,1);assert.deepEqual(JSON.parse(f.calls.find(x=>x.url.endsWith('/api/uploads')).body),{requestId:resumedJob.body.requestId,caption:'Five views 🌆',count:5});await f.tick();assert.equal(f.calls.filter(x=>x.url.endsWith('/complete')).length,1);
});
for(const failure of ['http','network'])test('a '+failure+' part failure stops completion and retry skips confirmed parts with the same request ID',async()=>{
 const received=new Set();let fail=true;
 const f=await fixture({session,route:x=>{
  if(x.url.startsWith('uploads/'))return {status:0,raw:localPhoto(x.url)};
  if(x.url.endsWith('/api/diagnostics'))return {status:200,body:{ok:true}};
  if(x.method==='GET'||x.url.endsWith('/api/uploads'))return {status:200,body:{received:[...received]}};
  if(x.url.endsWith('/complete'))return {status:201,body:{post:{id:82}}};
  const index=Number(x.url.split('/').at(-1));if(index===1&&fail){fail=false;return failure==='network'?{error:true}:{status:503,body:{error:'Please retry'}};}
  received.add(index);return {status:200,body:{ok:true}};
 }});
 const first=await f.run(resumedJob);assert.equal(first.status,failure==='network'?0:503);assert.equal(f.calls.filter(x=>x.url.endsWith('/complete')).length,0);assert.deepEqual([...received],[0]);
 const boundary=f.calls.length,second=await f.run(resumedJob);assert.equal(second.status,201);
 const retried=f.calls.slice(boundary);assert.deepEqual(retried.filter(x=>x.url.startsWith('uploads/')).map(x=>x.url),['uploads/outgoing_2.png','uploads/outgoing_3.png','uploads/outgoing_4.png','uploads/outgoing_5.png']);assert(!retried.some(x=>x.method==='PUT'&&x.url.endsWith('/0')));
 assert.equal(f.calls.filter(x=>x.url.endsWith('/complete')).length,1);for(const begin of f.calls.filter(x=>x.url.endsWith('/api/uploads')))assert.equal(JSON.parse(begin.body).requestId,resumedJob.body.requestId);assert.equal(decode(f.config.session).token,'test-token');
});
test('an already completed resumable request returns its post without reading local files or completing again',async()=>{
 const f=await fixture({session,route:()=>({status:200,body:{post:{id:83}}})});const result=await f.run(resumedJob);
 assert.equal(result.status,200);assert.equal(result.body.post.id,83);assert.equal(f.calls.length,1);assert(f.calls[0].url.endsWith('/api/uploads/'+resumedJob.body.requestId));assert.equal(f.calls[0].method,'GET');
});
for(const rejectedStage of ['begin','part','complete'])test('HTTP 401 during resumable '+rejectedStage+' clears persisted and in-memory authentication',async()=>{
 const f=await fixture({session,route:x=>{
  if(x.url.startsWith('uploads/'))return {status:0,raw:localPhoto(x.url)};
  if(x.method==='GET')return {status:200,body:{received:rejectedStage==='complete'?[0,1,2,3,4]:[]}};
  const stage=x.url.endsWith('/api/uploads')?'begin':x.url.endsWith('/complete')?'complete':'part';
  if(stage===rejectedStage)return {status:401,body:{error:'Sign in again'}};
  return {status:200,body:stage==='begin'?{received:rejectedStage==='complete'?[0,1,2,3,4]:[]}:{ok:true}};
 }});
 const result=await f.run(resumedJob);assert.equal(result.status,401);assert.deepEqual(decode(f.config.session),{});const count=f.calls.length;assert.equal((await f.run({})).status,401);assert.equal(f.calls.length,count);
});
test('non-JSON proxy 413 reports 25 MiB for a resumable part and retains 8 MiB for legacy uploads',async()=>{
 for(const resumable of [true,false]){
  const f=await fixture({session,route:x=>{
   if(x.url.startsWith('uploads/'))return {status:0,raw:localPhoto(x.url)};
   if(x.method==='GET')return {status:410,body:{}};
   if(x.url.endsWith('/api/uploads'))return {status:200,body:{received:[]}};
   return {status:413,text:'<html>Payload too large</html>'};
  }});
  const result=await f.run({...resumedJob,upload:['outgoing_1.png'],body:{...resumedJob.body,resumable}});
  assert.equal(result.status,413);assert.equal(result.body.messageKey,resumable?'Фото должно быть не больше 25 МБ.':'Фото должно быть не больше 8 МБ.');assert(!result.body.error.includes('<html>'));
 }
});
test('media renewal, pinning and safe empty-draft cleanup use the authenticated bridge allowlist',async()=>{
 const f=await fixture({session}),profile='11111111-1111-4111-8111-111111111111';
 for(const [method,path,body]of [['POST','/api/media/refresh',{postIds:[1],profileIds:[profile]}],['PUT','/api/posts/1/pin',{}],['DELETE','/api/posts/1/pin',{}],['GET','/api/uploads/stable-request'],['DELETE','/api/uploads/stable-request',{emptyOnly:true}]]){
  assert.equal((await f.run({method,path,body})).status,200);const call=f.calls.at(-1);assert.equal(call.headers.Authorization,'Bearer test-token');assert.equal(call.headers['X-Zoigram-Features'],'comment-notifications,mention-notifications,pinned-posts');if(body)assert.deepEqual(JSON.parse(call.body),body);
 }
 const before=f.calls.length;for(const path of ['/api/uploads/short','/api/uploads/../../session','/api/uploads/stable-request?emptyOnly=true','/api/media/refresh/../session','/api/posts/no/pin','/api/posts/1/pin/../../me'])assert.equal((await f.run({path})).status,0,path);assert.equal(f.calls.length,before);
});
test('resumable local-read failure does not reserve a slot and reports an unsubmitted photo error',async()=>{
 const f=await fixture({session,route:x=>x.url.endsWith('/api/diagnostics')?{status:202,body:{ok:true}}:x.url.startsWith('uploads/')?{status:404}:{status:410,body:{}}});
 const result=await f.run({...resumedJob,upload:['outgoing_1.png']});assert.equal(result.status,0);assert.equal(result.body.submitted,false);assert.equal(result.body.messageKey,'Не удалось прочитать снимок.');assert(!f.calls.some(x=>x.method==='POST'&&x.url.endsWith('/api/uploads')));
});
