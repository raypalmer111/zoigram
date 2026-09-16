/* Cohtml transport only. The app itself uses native UMG inside the Zoi phone. */
(function(){
 'use strict';
 var MOD='__MOD_ID__',busy=false,lastId='',access=null,ready=false;
 function hex(value){var bytes=unescape(encodeURIComponent(JSON.stringify(value))),out=[];for(var i=0;i<bytes.length;i++)out.push(('0'+bytes.charCodeAt(i).toString(16)).slice(-2));return out.join('');}
 function unhex(value){if(typeof value!=='string'||value.length>3000000||value.length%2||/[^0-9a-f]/i.test(value))throw Error('Invalid local message');var bytes=value.replace(/../g,function(h){return String.fromCharCode(parseInt(h,16));});return JSON.parse(decodeURIComponent(escape(bytes)));}
 async function cli(name,args){var result=await window.inzoi.cli.execute(name,args);if(result&&result.success===false)throw Error(result.message||'Game bridge failed');return result&&result.data!==undefined?result.data:result;}
 async function read(key){try{var r=await cli('uimod.cfg_load',{mod_id:MOD,section:'online',key:key});return r&&r.value?unhex(r.value):null;}catch(e){return null;}}
 function write(key,value){return cli('uimod.cfg_save',{mod_id:MOD,section:'online',key:key,value:hex(value)});}
 function server(value){if(typeof value!=='string'||value.length>240)throw Error('Укажите адрес сервера.');value=value.replace(/\/+$/,'');if(!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(value)&&!/^http:\/\/(127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(value))throw Error('Нужен HTTPS-адрес сервера без пути.');return value;}
 function allowed(path){return typeof path==='string'&&path.length<1500&&/^\/api\/(info|me(?:\/(avatar|avatar-upload|account-access))?|session|saved(?:\?before=\d+)?|activity|notifications(?:\/read)?(?:\?before=\d+)?|conversations(?:\?filter=(?:all|unread)(?:&before=\d+)?|\?before=\d+)?|conversations\/[a-f0-9-]{36}\/(messages|read)(?:\?before=\d+)?|feed(?:\?[^#\\]*)?|auth\/(device|poll)|blocks|reports|posts(?:\/request\/[a-zA-Z0-9_-]{8,100}|\/\d+(?:\/(like|comments|save))?)?(?:\?[^#\\]*)?|comments\/\d+|profiles\/search(?:\?q=[^#\\]*)?|profiles\/[a-f0-9-]{36}(?:\/(follow|block|following))?(?:\?[^#\\]*)?)$/.test(path);}
   function request(method,url,body,token,raw,language,onProgress){return new Promise(function(resolve,reject){
   var x=new XMLHttpRequest(),done=false,timeout=raw?25000:(onProgress?120000:25000);
   function finish(error,value){if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);}
   var timer=setTimeout(function(){finish(Error(raw?'Не удалось прочитать снимок.':'Сервер не ответил вовремя. Попробуйте снова.'));try{x.abort();}catch(e){}},timeout);
   x.open(method,url,true);x.timeout=timeout;if(raw)x.responseType='arraybuffer';else if(body!==undefined)x.setRequestHeader('Content-Type','application/json');
   if(!raw)x.setRequestHeader('X-Zoigram-Version','0.8.0');
   if(token)x.setRequestHeader('Authorization','Bearer '+token);if(!raw){x.setRequestHeader('Accept-Language',language||'en');x.setRequestHeader('X-Zoigram-Features','comment-notifications');}
   if(onProgress&&x.upload)x.upload.onprogress=function(e){if(!done&&e.lengthComputable&&e.total>0)onProgress(Math.min(100,Math.floor(100*e.loaded/e.total)));};
   x.onload=function(){
    if(raw){if(x.status!==200&&x.status!==0)return finish(Error('Не удалось прочитать снимок.'));return finish(null,{status:200,body:x.response});}
    var data;try{data=JSON.parse(x.responseText);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();}catch(e){
     var key=x.status===413?(method==='PUT'&&/\/api\/uploads\/[A-Za-z0-9_-]{8,100}\/[0-4]$/.test(url)?'Фото должно быть не больше 25 МБ.':'Фото должно быть не больше 8 МБ.'):x.status===429?'Слишком много запросов. Подождите немного.':x.status>=500?'Сервер временно недоступен. Повторите отправку.':'Сервер вернул непонятный ответ.';
     return finish(null,{status:x.status>=400?x.status:0,body:{error:key,messageKey:key}});
    }
    finish(null,{status:x.status,body:data});
   };
   x.onerror=function(){finish(Error(raw?'Не удалось прочитать снимок.':'Нет связи с сервером. Проверьте интернет и повторите.'));};
   x.ontimeout=function(){finish(Error(raw?'Не удалось прочитать снимок.':'Сервер не ответил вовремя. Попробуйте снова.'));};
   x.send(body===undefined?null:JSON.stringify(body));
  });}
function base64(buffer){var bytes=new Uint8Array(buffer),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',chunks=[],chunk='';for(var i=0;i<bytes.length;i+=3){var n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);chunk+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');if(chunk.length>=16384){chunks.push(chunk);chunk='';}}chunks.push(chunk);return chunks.join('');}
 async function perform(job){
  var progressChain=Promise.resolve(),lastProgress=0;async function progress(key,bytes,percent,photo,total){var catalogs=window.ZoigramCatalog||{},lang=String(job.language||'ru').toLowerCase().split(/[-_]/)[0],messages=catalogs[lang]||catalogs.en||{};progressChain=progressChain.catch(function(){}).then(function(){return write('progress',{id:job.id,stage:messages[key]||key,messageKey:key,bytes:bytes,percent:percent,photo:photo,total:total});});return progressChain;}
  var base=server(job.server);if(!allowed(job.path)||['GET','POST','PUT','PATCH','DELETE'].indexOf(job.method)<0)throw Error('Неизвестное сетевое действие.');
  var authenticated=job.path!=='/api/info'&&job.path.indexOf('/api/auth/')!==0;
  var token=access&&access.server===base&&access.expiresAt>Date.now()?access.token:null;
  if(authenticated&&!token)return {status:401,body:{error:'Войдите в Zoigram.'}};
  var body=job.body;
     var submitted=false,result;
   try{
    if(job.upload){
     var files=typeof job.upload==='string'?[job.upload]:job.upload;
     if(job.path!=='/api/posts'||job.method!=='POST'||!Array.isArray(files)||files.length<1||files.length>5||files.some(function(f){return typeof f!=='string'||!/^outgoing_[1-5]\.png$/.test(f);})||new Set(files).size!==files.length)throw Error('Неверный снимок.');
     if(body.resumable&&window.ZoigramPhotos){
      submitted=true;result=await window.ZoigramPhotos.upload(job,files,function(method,path,payload,onProgress){return request(method,base+path,payload,token,false,job.language,onProgress||function(){});},async function(file){return (await request('GET','uploads/'+file,undefined,null,true)).body;},progress);
     }else{
     var images=[];for(var i=0;i<files.length;i++){
      await progress('Чтение снимка…',undefined,undefined,i+1,files.length);
      var local=await request('GET','uploads/'+files[i],undefined,null,true);
      var prepared=window.ZoigramPhotos?await window.ZoigramPhotos.prepare(local.body,8*1024*1024):{buffer:local.body};local.body=prepared.buffer;
      if(!local.body||!local.body.byteLength||local.body.byteLength>8*1024*1024)throw Error('Фото должно быть не больше 8 МБ.');
      await progress('Подготовка снимка…',local.body.byteLength,undefined,i+1,files.length);images.push(base64(local.body));
     }
     body={requestId:body.requestId,caption:body.caption};if(images.length===1)body.imageBase64=images[0];else body.imagesBase64=images;
     }
    }
    if(!result){await progress(job.upload?'Отправка фотографии…':'Загрузка…');submitted=true;
    result=await request(job.method,base+job.path,body,token,false,job.language,job.upload?function(percent){var time=Date.now();if(percent===100||time-lastProgress>=300){lastProgress=time;progress(percent===100?'Обработка фотографий…':'Отправка фотографии…',undefined,percent).catch(function(){});}}:undefined);}
    await progressChain.catch(function(){});
    }catch(e){await progressChain.catch(function(){});
    if(job.upload&&body&&body.resumable&&token){try{var diagnostic=new XMLHttpRequest();diagnostic.open('POST',base+'/api/diagnostics',true);diagnostic.timeout=3000;diagnostic.setRequestHeader('Content-Type','application/json');diagnostic.setRequestHeader('Authorization','Bearer '+token);diagnostic.setRequestHeader('X-Zoigram-Version','0.8.0');diagnostic.send(JSON.stringify({code:e.photoCode||'network',imageBytes:e.imageBytes}));}catch(ignore){}}
    return {status:0,body:{error:String(e.message||e),submitted:e.local?false:submitted}};
   }
if(job.path==='/api/auth/poll'&&result.status===200&&result.body.status==='complete'){
   access={server:base,token:result.body.token,expiresAt:result.body.expiresAt};await write('session',access);delete result.body.token;
  }
  if((job.path==='/api/session'&&result.status===200)||(result.status===401&&access&&access.server===base)){access=null;await write('session',{});}
  return result;
 }
 async function tick(){if(busy||!ready)return;busy=true;var job;try{
  job=await read('request');if(!job||!job.id||job.id===lastId||typeof job.createdAt!=='number')return;
  if(Date.now()/1000-job.createdAt>60||job.createdAt>Date.now()/1000+15){lastId=job.id;return;}
  lastId=job.id;var result;try{result=await perform(job);}catch(e){result={status:0,body:{error:String(e.message||e)}};}
  var lang=String(job.language||'ru').toLowerCase().split(/[-_]/)[0],catalog=window.ZoigramCatalog||{},messages=catalog[lang]||catalog.en||{};
  if(result.body&&result.body.error){var key=result.body.messageKey||result.body.error;if(messages[key]){result.body.messageKey=key;result.body.error=messages[key];}}
  await write('response',{id:job.id,status:result.status,body:result.body,finishedAt:Math.floor(Date.now()/1000)});
 }catch(e){if(job&&job.id)lastId='';}finally{busy=false;}}
 engine.on('Ready',async function(){access=await read('session');var previous=await read('response');lastId=previous&&previous.id||'';ready=true;await write('worker',{ready:true,startedAt:Math.floor(Date.now()/1000),version:'0.8.0'});setInterval(tick,250);tick();});
})();
