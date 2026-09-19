/* Prepare an upload copy; original photographs on disk are never changed. */
(function(){
 'use strict';
 var MAX_SOURCE=64*1024*1024,MAX_SOURCE_PIXELS=64000000,MAX_SERVER_PIXELS=32000000;
 function error(key,code,bytes){var e=Error(key);e.photoCode=code;e.imageBytes=bytes;e.local=true;return e;}
 function encode(buffer){var bytes=new Uint8Array(buffer),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',parts=[],s='';for(var i=0;i<bytes.length;i+=3){var n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);s+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');if(s.length>=16384){parts.push(s);s='';}}parts.push(s);return parts.join('');}
 function pngDimensions(buffer){
  // Photo Mode exports PNG, so its pixel count is available even without Image/canvas.
  var bytes=new Uint8Array(buffer);if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71||bytes[4]!==13||bytes[5]!==10||bytes[6]!==26||bytes[7]!==10||bytes[12]!==73||bytes[13]!==72||bytes[14]!==68||bytes[15]!==82)return null;
  function number(offset){return bytes[offset]*16777216+bytes[offset+1]*65536+bytes[offset+2]*256+bytes[offset+3];}
  return {width:number(16),height:number(20)};
 }
 async function prepare(buffer,maxBytes){
  var size=buffer&&buffer.byteLength;if(!size)throw error('Не удалось прочитать снимок.','photo_read',0);
  if(size>MAX_SOURCE)throw error('Исходное фото слишком большое. Максимум — 64 МБ.','photo_size',size);
  var result=buffer,compressed=false,dimensions=pngDimensions(buffer);
  if(dimensions&&dimensions.width*dimensions.height>MAX_SOURCE_PIXELS)throw error('Не удалось уменьшить фото. Попробуйте сделать новый снимок.','photo_prepare',size);
  // Some older Cohtml runtimes have no canvas encoder. The server can still prepare a bounded original.
  if(typeof document!=='undefined'&&typeof Image!=='undefined'&&typeof Blob!=='undefined'&&typeof URL!=='undefined'&&URL.createObjectURL){
   try{
    var img=new Image(),url=URL.createObjectURL(new Blob([buffer]));
    try{await new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(Error('decode timeout'));},25000);img.onload=function(){clearTimeout(timer);resolve();};img.onerror=function(){clearTimeout(timer);reject(Error('decode failed'));};img.src=url;});}finally{URL.revokeObjectURL(url);}
    var w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;dimensions={width:w,height:h};
    if(!w||!h||w*h>MAX_SOURCE_PIXELS)throw Error('unsupported dimensions');
    var canvas=document.createElement('canvas'),scale=Math.min(1,2048/w,2048/h);canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
    var ctx=canvas.getContext('2d');if(!ctx)throw Error('no canvas');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    var data=canvas.toDataURL('image/jpeg',0.86);if(!/^data:image\/jpeg;base64,/.test(data))throw Error('no JPEG encoder');
    var bytes=atob(data.slice(data.indexOf(',')+1)),copy=new Uint8Array(bytes.length);for(var j=0;j<bytes.length;j++)copy[j]=bytes.charCodeAt(j);
    if(copy.byteLength<=maxBytes&&(scale<1||copy.byteLength<size)){result=copy.buffer;compressed=true;}
   }catch(e){if(size>maxBytes||dimensions&&dimensions.width*dimensions.height>MAX_SERVER_PIXELS)throw error('Не удалось уменьшить фото. Попробуйте сделать новый снимок.','photo_prepare',size);}
   finally{if(canvas){canvas.width=1;canvas.height=1;}if(img)img.src='';}
  }
  if(!compressed&&dimensions&&dimensions.width*dimensions.height>MAX_SERVER_PIXELS)throw error('Не удалось уменьшить фото. Попробуйте сделать новый снимок.','photo_prepare',size);
  if(result.byteLength>maxBytes)throw error(maxBytes>8*1024*1024?'Фото должно быть не больше 25 МБ.':'Фото должно быть не больше 8 МБ.','photo_size',size);
  return {buffer:result,originalBytes:size,bytes:result.byteLength,compressed:compressed};
 }
 async function upload(job,files,send,read,progress){
  var body=job.body||{},id=body.requestId;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw error('Не указан идентификатор отправки.','response');
  await progress('Возобновление загрузки…');
  // Read the first missing local photo before allocating a slot. Previously a missing
  // Photo Mode file could leave an empty server session behind on every attempt.
  var state=await send('GET','/api/uploads/'+id),existing=state.status>=200&&state.status<300;
  if(!existing&&state.status!==410&&state.status!==404)return state;
  if(existing&&state.body.post)return state;
  function positions(value){if(!Array.isArray(value)||value.some(function(x){return !Number.isInteger(x)||x<0||x>=files.length;})||new Set(value).size!==value.length)throw error('Сервер вернул непонятный ответ.','response');return value;}
  var received=existing?positions(state.body.received):[],emptyOnlyCancellation=existing&&state.body.emptyOnlyCancellation===true,first=-1,prepared=null;
  async function prepareFile(index){
   await progress('Чтение снимка…',undefined,undefined,index+1,files.length);
   var local;try{local=await read(files[index]);}catch(e){e.photoCode='photo_read';e.local=true;throw e;}
   await progress('Подготовка снимка…',local&&local.byteLength,undefined,index+1,files.length);
   return prepare(local,25*1024*1024);
  }
  async function preserveOrRelease(e){
   // Never cancel after a network failure: the server might have received the photo.
   // The server also rechecks emptiness atomically if another device is uploading.
   if(e.local&&existing&&emptyOnlyCancellation&&received.length===0)try{await send('DELETE','/api/uploads/'+id,{emptyOnly:true});}catch(ignore){}
   throw e;
  }
  for(var p=0;p<files.length;p++)if(received.indexOf(p)===-1){first=p;break;}
  if(first!==-1)try{prepared=await prepareFile(first);}catch(e){return preserveOrRelease(e);}
  var begin=await send('POST','/api/uploads',{requestId:id,caption:body.caption||'',count:files.length});
  if(begin.status<200||begin.status>=300)return begin;if(begin.body.post)return begin;
  existing=true;emptyOnlyCancellation=begin.body.emptyOnlyCancellation===true;received=positions(begin.body.received);
  for(var i=0;i<files.length;i++){
   if(received.indexOf(i)!==-1)continue;
   var photo;try{photo=i===first&&prepared?prepared:await prepareFile(i);prepared=null;}catch(e){return preserveOrRelease(e);}
   await progress('Отправка фотографии…',photo.bytes,undefined,i+1,files.length);
   var part=await send('PUT','/api/uploads/'+id+'/'+i,{imageBase64:encode(photo.buffer)},function(percent){progress(percent===100?'Обработка фотографий…':'Отправка фотографии…',photo.bytes,percent,i+1,files.length).catch(function(){});});
   photo=null;if(part.status<200||part.status>=300)return part;received.push(i);
  }
  await progress('Публикация альбома…');return send('POST','/api/uploads/'+id+'/complete',{});
 }
 window.ZoigramPhotos={prepare:prepare,upload:upload,base64:encode};
})();
