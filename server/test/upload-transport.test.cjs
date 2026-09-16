'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),sharp=require('sharp');
const {createApp}=require('../src/app.cjs'),{identity,session}=require('../src/store.cjs'),Albums=require('../src/albums.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate,message,ms=2000){const end=Date.now()+ms;while(!predicate()){assert(Date.now()<end,message);await new Promise(resolve=>setTimeout(resolve,5))}}
function barrier(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
async function fixture(t,transport={}){
 const errors=[],raw=[],app=createApp({database:':memory:',origin:'http://127.0.0.1',uploadTransport:{idleMs:2000,totalMs:5000,queueMs:1500,...transport},onError:error=>errors.push(error)});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{raw.forEach(r=>r.client.destroy());app.server.closeAllConnections();await app.close()});
 const port=app.server.address().port,origin='http://127.0.0.1:'+port,users=Array.from({length:6},(_,i)=>{const p=identity(app.db,'test','transport-'+i);return {...p,...session(app.db,p.id)}});
 const photo=(await sharp({create:{width:80,height:80,channels:3,background:'#ab3478'}}).png().toBuffer()).toString('base64');
 async function call(method,route,body,user=users[0]){const res=await fetch(origin+route,{method,headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json','X-Zoigram-Version':'0.8.0'},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,headers:res.headers,body:await res.json()}}
 async function job(protocol,user=users[0]){const id=crypto.randomUUID();if(protocol==='resumable')assert.equal((await call('POST','/api/uploads',{requestId:id,count:1,caption:'Transport fixture'},user)).status,200);return {protocol,user,id,method:protocol==='legacy'?'POST':'PUT',route:protocol==='legacy'?'/api/posts':'/api/uploads/'+id+'/0',body:protocol==='legacy'?{requestId:id,caption:'Transport fixture',imageBase64:photo}:{imageBase64:photo}}}
 function stream(job,options={}){
  const incoming=barrier(),closed=barrier(),outcome=barrier(),bytes=Buffer.from(JSON.stringify(job.body));
  const onRequest=req=>{if(req.headers['x-test-request']===job.id){app.server.off('request',onRequest);incoming.resolve(req);req.on('close',closed.resolve)}};
  app.server.on('request',onRequest);
  const client=http.request({host:'127.0.0.1',port,path:job.route,method:job.method,headers:{Authorization:'Bearer '+job.user.token,'Content-Type':'application/json','Content-Length':options.length||bytes.length,'X-Zoigram-Version':job.protocol==='legacy'?'0.7.0':'0.8.0','X-Test-Request':job.id}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const body=Buffer.concat(chunks).toString();outcome.resolve({status:res.statusCode,headers:res.headers,body:body?JSON.parse(body):null})});res.on('error',error=>outcome.resolve({error}))});
  client.on('error',error=>outcome.resolve({error}));client.setTimeout(4000,()=>client.destroy(Error('Transport test client timed out')));
  const result={client,bytes,incoming:incoming.promise,closed:closed.promise,outcome:outcome.promise};raw.push(result);client.write(bytes.subarray(0,options.initialBytes||1));return result;
 }
 const submit=job=>call(job.method,job.route,job.body,job.user);
 const counts=()=>({posts:app.db.prepare('SELECT COUNT(*) n FROM posts').get().n,parts:app.db.prepare('SELECT COUNT(*) n FROM upload_parts').get().n});
 const logs=()=>app.db.prepare('SELECT status,code,client_version FROM operational_errors ORDER BY id').all();
 return {app,errors,users,call,job,stream,submit,counts,logs};
}

for(const protocol of ['legacy','resumable']){
 test(protocol+' request disconnect is a client abort, writes nothing and releases its upload slot',async t=>{
  const f=await fixture(t),job=await f.job(protocol),held=f.stream(job);await held.incoming;
  const aborted=barrier();(await held.incoming).once('aborted',aborted.resolve);held.client.destroy();await aborted.promise;
  await until(()=>f.logs().length===1,'disconnected upload was not recorded');
  assert.equal(f.logs()[0].status,499);assert.equal(f.logs()[0].code,'upload_aborted');assert.equal(f.logs()[0].client_version,protocol==='legacy'?'0.7.0':'0.8.0');assert.deepEqual(f.errors,[]);assert.deepEqual(f.counts(),{posts:0,parts:0});
  const retry=await f.submit(job);assert.equal(retry.status,protocol==='legacy'?201:200);const again=await f.submit(job);assert.equal(again.status,200);assert.equal(again.body.repeated,true);assert.deepEqual(f.counts(),protocol==='legacy'?{posts:1,parts:0}:{posts:0,parts:1});
 });
 test(protocol+' idle request returns 408 and releases resources without an internal server error',async t=>{
  const f=await fixture(t,{idleMs:80,totalMs:1000,maxInFlight:1}),job=await f.job(protocol),held=f.stream(job);await held.incoming;const result=await held.outcome;
  assert.equal(result.status,408);assert.equal(f.logs()[0].code,'upload_timeout');assert.equal(f.logs()[0].status,408);assert.deepEqual(f.errors,[]);assert.deepEqual(f.counts(),{posts:0,parts:0});
  const retry=await f.submit(job);assert.equal(retry.status,protocol==='legacy'?201:200);
 });
}

test('two stalled legacy/resumable bodies do not occupy conversion slots for healthy players',async t=>{
 const f=await fixture(t),first=await f.job('legacy'),second=await f.job('resumable'),held=[f.stream(first),f.stream(second)];await Promise.all(held.map(r=>r.incoming));
 const healthy=[await f.job('legacy',f.users[1]),await f.job('resumable',f.users[1])];assert.deepEqual((await Promise.all(healthy.map(f.submit))).map(r=>r.status),[201,200]);assert.deepEqual(f.counts(),{posts:1,parts:1});
 held.forEach(r=>r.client.destroy());await until(()=>f.logs().filter(r=>r.status===499).length===2,'stalled upload slots were not released');assert.deepEqual(f.errors,[]);
});

test('four outstanding upload bodies bound memory; overflow is retryable and an abort frees capacity',async t=>{
 const f=await fixture(t),jobs=[];for(let i=0;i<4;i++)jobs.push(await f.job(i%2?'resumable':'legacy',f.users[i]));const held=jobs.map(j=>f.stream(j));await Promise.all(held.map(r=>r.incoming));
 const next=await f.job('legacy',f.users[4]),busy=await f.submit(next);assert.equal(busy.status,503);assert.equal(busy.headers.get('retry-after'),'5');assert.deepEqual(f.counts(),{posts:0,parts:0});
 held[0].client.destroy();await until(()=>f.logs().some(r=>r.status===499),'abort did not release receive capacity');assert.equal((await f.submit(next)).status,201);assert.deepEqual(f.errors,[]);
});

test('legacy and resumable image conversions share a two-worker limit and a bounded waiting queue',async t=>{
 const f=await fixture(t),original=Albums.convert,release=barrier();let entered=0,active=0,peak=0;
 Albums.convert=async(...args)=>{entered++;active++;peak=Math.max(peak,active);try{await release.promise;return await original(...args)}finally{active--}};
 const pending=[];try{
  const jobs=[];for(let i=0;i<4;i++)jobs.push(await f.job(i%2?'resumable':'legacy',f.users[i]));
  pending.push(f.submit(jobs[0]),f.submit(jobs[1]));await until(()=>entered===2,'first two conversions did not start');
  const third=f.stream(jobs[2]),fourth=f.stream(jobs[3]);for(const request of [third,fourth])request.client.end(request.bytes.subarray(1));pending.push(third.outcome,fourth.outcome);
  const bodies=await Promise.all([third.incoming,fourth.incoming]);await until(()=>bodies.every(req=>req.complete),'queued request bodies did not finish receiving');await tick();
  const extra=await f.job('legacy',f.users[4]);assert.equal((await f.submit(extra)).status,503);assert.equal(entered,2);assert.equal(active,2);
  release.resolve();assert.deepEqual((await Promise.all(pending)).map(r=>r.status),[201,200,201,200]);assert.equal(peak,2);assert.equal(entered,4);assert.equal(active,0);assert.deepEqual(f.counts(),{posts:2,parts:2});assert.equal((await f.submit(extra)).status,201);assert.deepEqual(f.errors,[]);
 }finally{release.resolve();await Promise.all(pending);Albums.convert=original}
});

test('a processing queue timeout is retryable and cannot publish the timed-out job later',async t=>{
 const f=await fixture(t,{maxProcessing:1,maxInFlight:2,queueMs:80}),original=Albums.convert,release=barrier();let entered=0;
 Albums.convert=async(...args)=>{entered++;await release.promise;return original(...args)};let pending;
 try{const first=await f.job('legacy'),queued=await f.job('resumable',f.users[1]);pending=f.submit(first);await until(()=>entered===1,'first conversion did not start');const result=await f.submit(queued);assert.equal(result.status,503);assert.equal(result.headers.get('retry-after'),'5');assert.equal(entered,1);assert.deepEqual(f.counts(),{posts:0,parts:0});
  release.resolve();assert.equal((await pending).status,201);await tick();assert.equal(entered,1);assert.deepEqual(f.counts(),{posts:1,parts:0});assert.equal((await f.submit(queued)).status,200);assert.deepEqual(f.errors,[]);
 }finally{release.resolve();if(pending)await pending;Albums.convert=original}
});

test('regular incoming bytes reset the idle timer but cannot exceed the total request deadline',async t=>{
 const f=await fixture(t,{idleMs:90,totalMs:220,maxInFlight:1}),job=await f.job('legacy'),held=f.stream(job);await held.incoming;let sent=1;
 const timer=setInterval(()=>{if(!held.client.destroyed)held.client.write(held.bytes.subarray(sent,++sent))},25);
 try{const result=await held.outcome;assert(sent>=5,'request expired before receiving multiple progress chunks');assert.equal(result.status,408);assert.equal(f.logs()[0].code,'upload_timeout');assert.deepEqual(f.counts(),{posts:0,parts:0});assert.deepEqual(f.errors,[])}finally{clearInterval(timer)}
 assert.equal((await f.submit(job)).status,201);
});


test('disconnecting a completed body in the processing queue removes it without publishing or converting',async t=>{
 const f=await fixture(t,{maxProcessing:1,maxInFlight:2}),original=Albums.convert,release=barrier();let entered=0;
 Albums.convert=async(...args)=>{entered++;await release.promise;return original(...args)};let pending;
 try{const first=await f.job('legacy'),queued=await f.job('resumable',f.users[1]);pending=f.submit(first);await until(()=>entered===1,'first conversion did not start');
  const request=f.stream(queued);request.client.end(request.bytes.subarray(1));const incoming=await request.incoming;await until(()=>incoming.complete,'queued body did not complete');await tick();request.client.destroy();
  await until(()=>f.logs().some(row=>row.code==='upload_cancelled'),'queue cancellation was not recorded');assert.equal(entered,1);assert.deepEqual(f.counts(),{posts:0,parts:0});
  release.resolve();assert.equal((await pending).status,201);await tick();assert.equal(entered,1);assert.deepEqual(f.counts(),{posts:1,parts:0});assert.equal((await f.submit(queued)).status,200);assert.deepEqual(f.errors,[]);
 }finally{release.resolve();if(pending)await pending;Albums.convert=original}
});

for(const protocol of ['legacy','resumable']){
 test(protocol+' disconnect during conversion retains its worker until finish and never stores the photo',async t=>{
  const f=await fixture(t,{maxInFlight:1}),original=Albums.convert,release=barrier();let entered=0;
  Albums.convert=async(...args)=>{entered++;await release.promise;return original(...args)};
  try{const job=await f.job(protocol),request=f.stream(job);request.client.end(request.bytes.subarray(1));const incoming=await request.incoming;
   await until(()=>entered===1,'conversion did not start');const socketClosed=barrier();incoming.socket.once('close',socketClosed.resolve);request.client.destroy();await socketClosed.promise;
   assert.equal((await f.submit(job)).status,503,'a conversion must keep its admission slot until it finishes');assert.equal(entered,1);assert.deepEqual(f.counts(),{posts:0,parts:0});
   release.resolve();await until(()=>f.logs().some(row=>row.code==='upload_cancelled'),'conversion cancellation was not recorded');assert.deepEqual(f.counts(),{posts:0,parts:0});assert.deepEqual(f.errors,[]);
   assert.equal((await f.submit(job)).status,protocol==='legacy'?201:200);assert.equal(entered,2);
  }finally{release.resolve();Albums.convert=original}
 });
}

function readerFixture(){
 const {EventEmitter}=require('node:events'),{Problem}=require('../src/app.cjs'),{createUploadTransport}=require('../src/upload-transport.cjs');
 const transport=createUploadTransport({Problem,options:{idleMs:2000,totalMs:3000}}),req=Object.assign(new EventEmitter(),{headers:{'content-type':'application/json'},complete:false,destroyed:false,aborted:false,closed:false,zoigramUpload:true,pause(){this.paused=true}});
 return {transport,req};
}
test('an aborted destroyed body tolerates a later ECONNRESET until close and cleans all reader listeners',async()=>{
 const {transport,req}=readerFixture(),outcome=transport.json(req).then(()=>assert.fail('aborted JSON must reject'),error=>error);
 req.emit('data',Buffer.from('{'));req.destroyed=true;req.aborted=true;req.emit('aborted');
 assert.doesNotThrow(()=>req.emit('error',Object.assign(Error('aborted'),{code:'ECONNRESET'})));
 req.closed=true;req.emit('close');const error=await outcome;assert.equal(error.status,499);assert.equal(error.code,'upload_aborted');assert.equal(transport.gate.receiving,0);
 for(const event of ['data','end','error','aborted','close'])assert.equal(req.listenerCount(event),0,'reader leaked '+event+' listener');
});
test('an unrelated ECONNRESET while the body is still connected is not mislabeled as a client abort',async()=>{
 const {transport,req}=readerFixture(),original=Object.assign(Error('unrelated internal reset'),{code:'ECONNRESET'}),outcome=transport.json(req).then(()=>assert.fail('errored JSON must reject'),error=>error);
 req.emit('data',Buffer.from('{'));req.emit('error',original);const error=await outcome;assert.equal(error,original);assert.equal(error.status,undefined);assert.notEqual(error.code,'upload_aborted');assert.equal(transport.gate.receiving,0);
 req.closed=true;req.emit('close');for(const event of ['data','end','error','aborted','close'])assert.equal(req.listenerCount(event),0,'reader leaked '+event+' listener');
});
