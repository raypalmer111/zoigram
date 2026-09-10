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
 function allowed(path){return typeof path==='string'&&path.length<1500&&/^\/api\/(info|me(?:\/(avatar|avatar-upload|account-access))?|session|activity|notifications(?:\/read)?(?:\?before=\d+)?|conversations(?:\/[a-f0-9-]{36}\/(messages|read))?(?:\?before=\d+)?|feed(?:\?[^#\\]*)?|auth\/(device|poll)|blocks|reports|posts(?:\/\d+(?:\/(like|comments))?)?(?:\?[^#\\]*)?|comments\/\d+|profiles\/[a-f0-9-]{36}(?:\/(follow|block|following))?(?:\?[^#\\]*)?)$/.test(path);}
 function request(method,url,body,token,raw,language){return new Promise(function(resolve,reject){
  var x=new XMLHttpRequest();var timer=setTimeout(function(){reject(Error('Сервер или файл не ответил вовремя. Попробуйте снова.'));try{x.abort();}catch(e){}},25000);x.open(method,url,true);x.timeout=25000;if(raw)x.responseType='arraybuffer';else if(body!==undefined)x.setRequestHeader('Content-Type','application/json');if(token)x.setRequestHeader('Authorization','Bearer '+token);if(!raw)x.setRequestHeader('Accept-Language',language||'ru');
  x.onload=function(){clearTimeout(timer);try{if(raw){if(x.status!==200&&x.status!==0)throw Error('Не удалось прочитать снимок.');return resolve({status:200,body:x.response});}var data=JSON.parse(x.responseText);resolve({status:x.status,body:data});}catch(e){reject(Error('Сервер вернул непонятный ответ.'));}};
  x.onerror=function(){clearTimeout(timer);reject(Error('Нет связи с сервером. Проверьте интернет и повторите.'));};x.ontimeout=function(){clearTimeout(timer);reject(Error('Сервер не ответил вовремя. Попробуйте снова.'));};x.send(body===undefined?null:JSON.stringify(body));
 });}
 function base64(buffer){var bytes=new Uint8Array(buffer),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',chunks=[],chunk='';for(var i=0;i<bytes.length;i+=3){var n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);chunk+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');if(chunk.length>=16384){chunks.push(chunk);chunk='';}}chunks.push(chunk);return chunks.join('');}
 async function perform(job){
  async function progress(key,bytes){var catalogs=window.ZoigramCatalog||{},lang=String(job.language||'ru').toLowerCase().split(/[-_]/)[0],messages=catalogs[lang]||catalogs.en||{};return write('progress',{id:job.id,stage:messages[key]||key,messageKey:key,bytes:bytes});}
  var base=server(job.server);if(!allowed(job.path)||['GET','POST','PUT','PATCH','DELETE'].indexOf(job.method)<0)throw Error('Неизвестное сетевое действие.');
  var authenticated=job.path!=='/api/info'&&job.path.indexOf('/api/auth/')!==0;
  var token=access&&access.server===base&&access.expiresAt>Date.now()?access.token:null;
  if(authenticated&&!token)return {status:401,body:{error:'Войдите в Zoigram.'}};
  var body=job.body;
  if(job.upload){if(job.path!=='/api/posts'||job.method!=='POST'||!/^outgoing_[1-4]\.png$/.test(job.upload))throw Error('Неверный снимок.');await progress('Чтение снимка…');var local=await request('GET','uploads/'+job.upload,undefined,null,true);if(!local.body||!local.body.byteLength||local.body.byteLength>8*1024*1024)throw Error('Снимок пустой или больше 8 МБ. Уменьшите разрешение в фоторежиме.');await progress('Подготовка снимка…',local.body.byteLength);body={requestId:body.requestId,caption:body.caption,imageBase64:base64(local.body)};}
  await progress(job.upload?'Отправка фотографии…':'Загрузка…');var result=await request(job.method,base+job.path,body,token,false,job.language);
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
 engine.on('Ready',async function(){access=await read('session');var previous=await read('response');lastId=previous&&previous.id||'';ready=true;await write('worker',{ready:true,startedAt:Math.floor(Date.now()/1000),version:'0.14.0'});setInterval(tick,250);tick();});
})();
