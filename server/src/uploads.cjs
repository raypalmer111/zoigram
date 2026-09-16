'use strict';
const crypto=require('node:crypto');
const {transaction,hash}=require('./store.cjs'),Albums=require('./albums.cjs');
const MAX_INPUT=25*1024*1024,TTL=24*3600000;
function createUploads({db,budget,fail,json,send,key,text,limit,transport,postDto,visiblePost,clock=Date.now}){
 const stagedLimit=Math.min(512*1024*1024,Math.floor(budget/4));
 const row=(uid,id)=>db.prepare('SELECT * FROM upload_sessions WHERE profile_id=? AND request_id=?').get(uid,id);
 function clean(){db.prepare('DELETE FROM upload_sessions WHERE post_id IS NULL AND expires_at<?').run(clock());}
 function get(uid,id){const r=row(uid,id);if(!r||(!r.post_id&&r.expires_at<=clock()))fail(410,'Загрузка истекла. Повторите отправку.');return r;}
 function status(r,s){return {requestId:r.request_id,received:db.prepare('SELECT position FROM upload_parts WHERE profile_id=? AND request_id=? ORDER BY position').all(r.profile_id,r.request_id).map(p=>p.position),expiresAt:r.expires_at,...(r.post_id?{post:postDto(visiblePost(r.post_id,s.profile_id),s)}:{})};}
 function quota(uid,bytes){
  const total=db.prepare('SELECT COALESCE(SUM(bytes),0) n FROM upload_parts').get().n;
  if(total+bytes>stagedLimit)fail(507,'Недостаточно места для временной загрузки. Повторите позже.');
  const used=db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars) n').get().n;
  if(used+total+bytes>budget)fail(507,'Хранилище заполнено. Владелец сервера уже может освободить место.');
 }
 async function handle(req,res,u,s){
  const match=u.pathname.match(/^\/api\/uploads(?:\/([a-zA-Z0-9_-]{8,100})(?:\/(complete|[0-4]))?)?$/);
  if(!match)return false;const uid=s.profile_id,m=req.method,id=match[1],part=match[2];clean();
  if(m==='POST'&&!id){
   limit('upload-start:'+uid,60,3600000);const b=await json(req,16384),rid=key(b.requestId),caption=text(b.caption||'',2200),count=b.count;
   if(!Number.isInteger(count)||count<1||count>5)fail(400,'В альбоме должно быть от 1 до 5 фотографий.');
   let r=row(uid,rid);
   if(r){if(r.caption!==caption||r.photo_count!==count)fail(409,'Этот запрос уже использован для другого поста.');}
   else{
    if(db.prepare('SELECT 1 FROM posts WHERE profile_id=? AND request_id=?').get(uid,rid))fail(409,'Этот запрос уже использован для другого поста.');
    if(db.prepare('SELECT COUNT(*) n FROM upload_sessions WHERE profile_id=? AND post_id IS NULL').get(uid).n>=3)fail(429,'Завершите предыдущую загрузку или повторите позже.');
    if(db.prepare('SELECT COUNT(*) n FROM upload_sessions WHERE post_id IS NULL').get().n>=300)fail(503,'Сервис занят. Попробуйте позже.');
    db.prepare('INSERT INTO upload_sessions(profile_id,request_id,caption,photo_count,created_at,expires_at,generation) VALUES(?,?,?,?,?,?,?)').run(uid,rid,caption,count,clock(),clock()+TTL,crypto.randomUUID());r=row(uid,rid);
   }
   send(res,200,status(r,s));return true;
  }
  if(!id)fail(405,'Метод не поддерживается.');
  const r=get(uid,id);
  function currentGeneration(){const current=get(uid,id);if(current.generation!==r.generation)fail(409,'Загрузка изменена. Повторите отправку.');return current;}
  if(m==='GET'&&!part){send(res,200,status(r,s));return true;}
  if(m==='DELETE'&&!part){if(r.post_id)fail(409,'Публикация уже отправлена.');db.prepare('DELETE FROM upload_sessions WHERE profile_id=? AND request_id=?').run(uid,id);send(res,200,{ok:true});return true;}
  if(m==='PUT'&&/^[0-4]$/.test(part||'')){
   if(r.post_id)fail(409,'Публикация уже отправлена.');const index=Number(part);if(index>=r.photo_count)fail(400,'Неверный снимок.');
   limit('upload-part:'+uid,120,3600000);const lease=transport.admit(req,res);
   try{
    const b=await json(req,Math.ceil(MAX_INPUT/3)*4+4096);let value=b.imageBase64;delete b.imageBase64;
    if(typeof value!=='string')fail(400,'Не удалось прочитать фотографию.');
    if(value.length>Math.ceil(MAX_INPUT/3)*4)fail(413,'Фото должно быть не больше 25 МБ.');
    if(value.length%4||/[^A-Za-z0-9+/=]/.test(value))fail(400,'Не удалось прочитать фотографию.');
    const input=Buffer.from(value,'base64');req.zoigramImageBytes=input.length;
    if(input.length>MAX_INPUT)fail(413,'Фото должно быть не больше 25 МБ.');if(input.length<16||input.toString('base64')!==value)fail(400,'Не удалось прочитать фотографию.');
    value=null;currentGeneration();const digest=hash(input),previous=db.prepare('SELECT digest FROM upload_parts WHERE profile_id=? AND request_id=? AND position=?').get(uid,id,index);
    if(previous){if(previous.digest!==digest)fail(409,'Снимок уже загружен с другим содержимым.');send(res,200,{ok:true,index,repeated:true});return true;}
    await lease.process();const [photo]=await Albums.convert([input],fail);lease.check();
    transaction(db,()=>{
     const current=currentGeneration();if(current.post_id)fail(409,'Публикация уже отправлена.');if(index>=current.photo_count)fail(409,'Загрузка изменена. Повторите отправку.');
     const other=db.prepare('SELECT digest FROM upload_parts WHERE profile_id=? AND request_id=? AND position=?').get(uid,id,index);
     if(other){if(other.digest!==digest)fail(409,'Снимок уже загружен с другим содержимым.');return;}
     quota(uid,photo.bytes);db.prepare('INSERT INTO upload_parts VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid,id,index,digest,input.length,photo.width,photo.height,photo.image,photo.thumbnail,photo.bytes);
    });send(res,200,{ok:true,index});return true;
   }finally{lease.release();}
  }
  if(m==='POST'&&part==='complete'){
   limit('upload-complete:'+uid,60,3600000);await json(req,4096);
   const postId=transaction(db,()=>{
    const current=currentGeneration();if(current.post_id)return current.post_id;
    const photos=db.prepare('SELECT * FROM upload_parts WHERE profile_id=? AND request_id=? ORDER BY position').all(uid,id);
    if(photos.length!==current.photo_count||photos.some((p,i)=>p.position!==i))fail(409,'Не все фотографии загружены. Повторите отправку.');
    if(db.prepare('SELECT COUNT(*) n FROM posts WHERE profile_id=? AND created_at>?').get(uid,clock()-86400000).n>=20)fail(429,'Достигнут лимит публикаций на сегодня.');
    const bytes=photos.reduce((n,p)=>n+p.bytes,0),cover=photos[0],used=db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars) n').get().n;
    if(used+bytes>budget)fail(507,'Хранилище заполнено. Владелец сервера уже может освободить место.');
    const digest=hash(JSON.stringify({caption:current.caption,photos:photos.map(p=>p.digest)}));
    const post=Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid,id,digest,current.caption,clock(),cover.width,cover.height,cover.image,cover.thumbnail,bytes).lastInsertRowid);
    const insert=db.prepare('INSERT INTO post_photos VALUES(?,?,?,?,?,?,?)');photos.slice(1).forEach((p,i)=>insert.run(post,i+1,p.width,p.height,p.image,p.thumbnail,p.bytes));
    db.prepare('UPDATE upload_sessions SET post_id=? WHERE profile_id=? AND request_id=?').run(post,uid,id);db.prepare('DELETE FROM upload_parts WHERE profile_id=? AND request_id=?').run(uid,id);return post;
   });send(res,200,{post:postDto(visiblePost(postId,uid),s)});return true;
  }
  fail(405,'Метод не поддерживается.');
 }
 return {handle,clean,stagedLimit};
}
module.exports={createUploads,MAX_INPUT,TTL};
