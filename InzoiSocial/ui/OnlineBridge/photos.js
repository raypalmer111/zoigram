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
  var begin=await send('POST','/api/uploads',{requestId:id,caption:body.caption||'',count:files.length});
  if(begin.status<200||begin.status>=300)return begin;if(begin.body.post)return begin;
  var received=begin.body.received;if(!Array.isArray(received)||received.some(function(x){return !Number.isInteger(x)||x<0||x>=files.length;}))throw error('Сервер вернул непонятный ответ.','response');
  for(var i=0;i<files.length;i++){
   if(received.indexOf(i)!==-1)continue;
   await progress('Чтение снимка…',undefined,undefined,i+1,files.length);
   var local;try{local=await read(files[i]);}catch(e){e.photoCode='photo_read';e.local=true;throw e;}
   await progress('Подготовка снимка…',local.byteLength,undefined,i+1,files.length);
   var photo=await prepare(local,25*1024*1024);
   await progress('Отправка фотографии…',photo.bytes,undefined,i+1,files.length);
   var part=await send('PUT','/api/uploads/'+id+'/'+i,{imageBase64:encode(photo.buffer)},function(percent){progress(percent===100?'Обработка фотографий…':'Отправка фотографии…',photo.bytes,percent,i+1,files.length).catch(function(){});});
   if(part.status<200||part.status>=300)return part;
  }
  await progress('Публикация альбома…');return send('POST','/api/uploads/'+id+'/complete',{});
 }
 window.ZoigramPhotos={prepare:prepare,upload:upload,base64:encode};
})();
