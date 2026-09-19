'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const {hash,random,transaction}=require('./store.cjs');
const MAX=8*1024*1024;
function createAvatars({db,origin,secret,budget,fail,limit,json,send,authorize,transport}){
 const signature=value=>crypto.createHmac('sha256',secret).update('avatar:'+value).digest('base64url');
 const conflict=code=>{try{fail(403,'Ссылка для аватара истекла. Откройте новую из профиля.')}catch(error){if(code)error.code=code;throw error}};
 const rows=()=>db.prepare('DELETE FROM avatar_uploads WHERE expires_at<?').run(Date.now());
 function ticket(req){
  const token=(req.headers.authorization||'').match(/^Avatar ([A-Za-z0-9_-]{43})$/)?.[1];if(!token)conflict();
  const row=db.prepare('SELECT u.*,s.profile_id FROM avatar_uploads u JOIN sessions s ON s.id=u.session_id JOIN profiles p ON p.id=s.profile_id WHERE u.token_hash=? AND u.expires_at>? AND s.expires_at>? AND p.banned=0').get(hash(token),Date.now(),Date.now());
  if(!row)conflict();return row;
 }
 function decorate(value,session){
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value)){value.forEach(item=>decorate(item,session));return value}
  if(typeof value.id==='string'&&typeof value.username==='string'&&typeof value.displayName==='string'){
   const avatar=db.prepare('SELECT revision FROM avatars WHERE profile_id=?').get(value.id);
   value.avatarVersion=avatar?.revision||null;value.avatarUrl=null;value.avatarExpiresAt=null;
   if(avatar){value.avatarExpiresAt=Date.now()+900000;const payload=Buffer.from(JSON.stringify({a:value.id,r:avatar.revision,s:session.id,e:value.avatarExpiresAt})).toString('base64url');value.avatarUrl=origin+'/api/avatars/'+value.id+'?grant='+payload+'.'+signature(payload)}
  }
  for(const item of Object.values(value))if(item&&typeof item==='object')decorate(item,session);
  return value;
 }
 async function upload(body,uploadTicket,req,lease){
  let encoded=body.imageBase64;delete body.imageBase64;
  if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX/3)*4)fail(413,'Слишком большой файл.');
  const input=Buffer.from(encoded,'base64');
  if(!input.length||input.length>MAX||input.toString('base64')!==encoded)fail(400,'Фотография повреждена или не поддерживается.');
  encoded=null;req.zoigramImageBytes=input.length;await lease.process();ticket(req);
  let image;
  try{
   const pipeline=sharp(input,{limitInputPixels:32000000,failOn:'warning',animated:false}),meta=await pipeline.metadata();
   if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1||meta.width<64||meta.height<64)throw Error('Unsupported image');
   const mask=Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256" fill="white"/></svg>');
   image=await pipeline.rotate().resize(512,512,{fit:'cover',position:'centre'}).ensureAlpha().composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
  }catch{fail(400,'Выберите обычное фото PNG, JPEG или WebP размером от 64×64.')}
  lease.check();ticket(req);
  return transaction(db,()=>{
   const current=db.prepare('SELECT u.* FROM avatar_uploads u JOIN sessions s ON s.id=u.session_id JOIN profiles p ON p.id=s.profile_id WHERE u.token_hash=? AND u.expires_at>? AND s.expires_at>? AND p.banned=0').get(uploadTicket.token_hash,Date.now(),Date.now());
   if(!current)conflict();
   const used=db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars)+(SELECT COALESCE(SUM(bytes),0) FROM upload_parts) n').get().n;
   const old=db.prepare('SELECT bytes FROM avatars WHERE profile_id=?').get(uploadTicket.profile_id)?.bytes||0;
   if(used-old+image.length>budget)fail(507,'Хранилище заполнено. Владелец сервера уже может освободить место.');
   const revision=random();
   db.prepare('INSERT INTO avatars VALUES(?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET image=excluded.image,bytes=excluded.bytes,revision=excluded.revision,updated_at=excluded.updated_at').run(uploadTicket.profile_id,image,image.length,revision,Date.now());
   db.prepare('DELETE FROM avatar_uploads WHERE session_id IN (SELECT id FROM sessions WHERE profile_id=?)').run(uploadTicket.profile_id);
   return revision;
  });
 }
 async function handle(req,res,u){
  const p=u.pathname,m=req.method;
  if(m==='GET'&&['/avatar','/avatar/app.js','/avatar/app.css'].includes(p)){
   res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
   res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
   const assets={'/avatar':['index.html','text/html'],'/avatar/app.js':['app.js','application/javascript'],'/avatar/app.css':['app.css','text/css']};
   const [file,type]=assets[p];send(res,200,fs.readFileSync(path.join(__dirname,'../avatar',file),'utf8'),type);return true;
  }
  if(p==='/api/avatar-upload'&&m==='PUT'){
   const uploadTicket=ticket(req);res.zoigramSession={id:uploadTicket.session_id,profile_id:uploadTicket.profile_id};limit('avatar:'+uploadTicket.profile_id,10,3600000);
   const lease=transport.admit(req,res);try{
    const body=await json(req,12*1024*1024);ticket(req);const revision=await upload(body,uploadTicket,req,lease);send(res,200,{ok:true,avatarVersion:revision});return true;
   }finally{lease.release();}
  }
  if(p==='/api/me/avatar-upload'&&m==='POST'){
   const s=authorize(req);limit('avatar-ticket:'+s.profile_id,15,600000);rows();
   const token=random(),expiresAt=Date.now()+600000;
   transaction(db,()=>{db.prepare('DELETE FROM avatar_uploads WHERE session_id=?').run(s.id);db.prepare('INSERT INTO avatar_uploads VALUES(?,?,?)').run(hash(token),s.id,expiresAt)});
   send(res,201,{uploadUrl:origin+'/avatar?lang='+String(res.getHeader('Content-Language')||'en')+'#'+token,expiresAt});return true;
  }
  if(p==='/api/me/avatar'&&m==='DELETE'){
   const s=authorize(req);
   transaction(db,()=>{db.prepare('DELETE FROM avatars WHERE profile_id=?').run(s.profile_id);db.prepare('DELETE FROM avatar_uploads WHERE session_id IN (SELECT id FROM sessions WHERE profile_id=?)').run(s.profile_id)});
   send(res,200,{ok:true});return true;
  }
  const match=p.match(/^\/api\/avatars\/([a-f0-9-]{36})$/);
  if(m==='GET'&&match){
   const grant=u.searchParams.get('grant')||'';if(grant.length>1000)conflict('media_invalid');
   const [payload,sig,...extra]=grant.split('.'),expected=signature(payload||'');
   if(extra.length||typeof sig!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(sig)||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))conflict('media_invalid');
   let g;try{g=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{conflict('media_invalid')}
   if(!g||typeof g!=='object'||g.a!==match[1]||typeof g.e!=='number')conflict('media_invalid');if(g.e<Date.now())conflict('media_expired');
   const s=db.prepare('SELECT s.* FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.id=? AND s.expires_at>? AND p.banned=0').get(g.s,Date.now());if(!s)conflict('media_session_ended');
   if(db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(s.profile_id,g.a,g.a,s.profile_id))fail(404,'Профиль недоступен.');
   const row=db.prepare('SELECT a.image FROM avatars a JOIN profiles p ON p.id=a.profile_id WHERE a.profile_id=? AND a.revision=? AND p.banned=0').get(g.a,g.r);if(!row)fail(404,'Фото недоступно');
   res.writeHead(200,{'Content-Type':'image/png','Content-Length':row.image.length,'Cache-Control':'private, no-store'});res.end(Buffer.from(row.image));return true;
  }
  return false;
 }
 return {handle,decorate};
}
module.exports={createAvatars};
