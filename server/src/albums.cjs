'use strict';
const sharp=require('sharp');
const {hash}=require('./store.cjs');
const MAX_IMAGE=8*1024*1024,MAX_PHOTOS=5,MAX_BODY=56*1024*1024;
function decode(body,caption,fail){
 if(Object.hasOwn(body,'imagesBase64')&&Object.hasOwn(body,'imageBase64'))fail(400,'Укажите один снимок или альбом.');
 const encoded=Object.hasOwn(body,'imagesBase64')?body.imagesBase64:[body.imageBase64];
 if(!Array.isArray(encoded)||encoded.length<1||encoded.length>MAX_PHOTOS)fail(400,'В альбоме должно быть от 1 до 5 фотографий.');
 const inputs=encoded.map(value=>{
  if(typeof value==='string'&&value.length>Math.ceil(MAX_IMAGE/3)*4)fail(413,'Фото должно быть не больше 8 МБ.');
  if(typeof value!=='string'||value.length%4!==0||/[^A-Za-z0-9+/=]/.test(value))fail(400,'Не удалось прочитать фотографию.');
  const input=Buffer.from(value,'base64');if(input.toString('base64')!==value)fail(400,'Не удалось прочитать фотографию.');
  if(input.length<16||input.length>MAX_IMAGE)fail(413,'Фото должно быть не больше 8 МБ.');return input;
 });
 // A one-photo album and legacy upload share the same retry identity.
 const digest=encoded.length===1?hash(caption+'\0'+encoded[0]):hash(JSON.stringify([caption,...encoded]));
 return {inputs,digest};
}
async function convert(inputs,fail){
 const photos=[];
 try{for(const input of inputs){
  const base=sharp(input,{limitInputPixels:32000000,failOn:'warning',animated:false}),meta=await base.metadata();
  if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1||!meta.width||!meta.height||meta.width<64||meta.height<64)fail(400,'Выберите обычное фото PNG, JPEG или WebP размером от 64×64.');
  const full=await base.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85,mozjpeg:true}).toBuffer({resolveWithObject:true});
  const thumbnail=await sharp(full.data).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
  photos.push({image:full.data,thumbnail,width:full.info.width,height:full.info.height,bytes:full.data.length+thumbnail.length});
 }}catch(e){if(e.status)throw e;fail(400,'Фотография повреждена или не поддерживается.');}
 return photos;
}
function list(db,post,origin,grant){
 const rows=[{position:0,width:post.width,height:post.height},...db.prepare('SELECT position,width,height FROM post_photos WHERE post_id=? ORDER BY position').all(post.id)];
 return rows.map(p=>({index:p.position,width:p.width,height:p.height,imageUrl:origin+'/api/media/'+post.id+'?photo='+p.position+'&grant='+grant,thumbnailUrl:origin+'/api/media/'+post.id+'?photo='+p.position+'&size=thumb&grant='+grant}));
}
module.exports={MAX_IMAGE,MAX_PHOTOS,MAX_BODY,decode,convert,list};
