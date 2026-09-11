'use strict';
const http=require('node:http'),crypto=require('node:crypto'),sharp=require('sharp');
const {openStore,transaction,session,hash,random}=require('./store.cjs');
const I18n=require('./i18n.cjs');
sharp.concurrency(2);sharp.cache({memory:32,files:0,items:20});
const MAX_IMAGE=8*1024*1024,MAX_JSON=12*1024*1024;
class Problem extends Error{constructor(status,message){super(message);this.status=status}}
const fail=(status,message)=>{throw new Problem(status,message)};
const text=(v,max,required=false)=>{if(typeof v!=='string'||[...v].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))fail(400,'Проверьте текст и его длину.');v=v.trim();if(required&&!v)fail(400,'Заполните поле.');return v};
const key=v=>{if(typeof v!=='string'||! /^[a-zA-Z0-9_-]{8,100}$/.test(v))fail(400,'Не указан идентификатор отправки.');return v};
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=(title,body,language)=>'<!doctype html><html lang="'+language+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(title)+' · Zoigram</title><style>body{font:16px system-ui;margin:12vh auto;padding:24px;max-width:500px;color:#25212c;background:#faf8fc}main{background:white;padding:32px;border-radius:24px;box-shadow:0 12px 60px #44224412}a,button{display:inline-block;padding:14px 20px;background:#a92fc2;color:white;border:0;border-radius:12px;text-decoration:none;font:inherit}p{line-height:1.6}code{font-size:24px}small{color:#777}</style><main><h1>'+escape(title)+'</h1>'+body+'</main></html>';
function createApp(options={}){
 const db=options.db||openStore(options.database),origin=new URL(options.origin).origin,secret=options.secret||crypto.randomBytes(32),now=()=>Date.now();
 const local=['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname);
 if(!local&&!origin.startsWith('https://'))throw Error('Public origin requires HTTPS');
 const budget=options.storageBytes||10*1024*1024*1024,limits=new Map();let conversions=0;
 function limit(bucket,max,ms=60000){const t=now();let r=limits.get(bucket);if(!r||r.until<=t){r={count:0,until:t+ms};limits.set(bucket,r)}if(++r.count>max)fail(429,'Слишком много запросов. Подождите немного.');if(limits.size>20000){for(const [k,v]of limits)if(v.until<=t)limits.delete(k);if(limits.size>20000)fail(503,'Сервис занят. Попробуйте позже.')}}
 function blocked(a,b){return !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(a,b,b,a)}
 function profile(id,viewer){
  const p=db.prepare('SELECT id,username,display_name,bio,created_at,banned FROM profiles WHERE id=?').get(id);if(!p||p.banned)fail(404,'Профиль недоступен.');
  return {...(id===viewer?{accountConfigured:!!db.prepare("SELECT 1 FROM account_credentials WHERE profile_id=?").get(id),accountRevision:db.prepare("SELECT updated_at FROM account_credentials WHERE profile_id=?").get(id)?.updated_at||0}:{}),id:p.id,username:p.username,displayName:p.display_name,bio:p.bio,createdAt:p.created_at,postCount:db.prepare('SELECT COUNT(*) n FROM posts WHERE profile_id=?').get(id).n,followers:db.prepare('SELECT COUNT(*) n FROM follows f JOIN profiles p ON p.id=f.follower_id WHERE f.following_id=? AND p.banned=0').get(id).n,following:db.prepare('SELECT COUNT(*) n FROM follows f JOIN profiles p ON p.id=f.following_id WHERE f.follower_id=? AND p.banned=0').get(id).n,isSelf:id===viewer,isFollowing:!!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(viewer,id),isBlocked:!!db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(viewer,id)};
 }
 function authorize(req){const token=(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];if(!token)fail(401,'Войдите в Zoigram.');const s=db.prepare('SELECT s.*,p.banned FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE token_hash=? AND expires_at>?').get(hash(token),now());if(!s||s.banned)fail(401,'Войдите в Zoigram заново.');return s}
 function visiblePost(id,user){const p=db.prepare('SELECT p.id,p.profile_id,p.caption,p.created_at,p.width,p.height FROM posts p JOIN profiles a ON a.id=p.profile_id WHERE p.id=? AND a.banned=0').get(id);if(!p||blocked(user,p.profile_id))fail(404,'Публикация недоступна.');return p}
 function mediaGrant(id,s){const payload=Buffer.from(JSON.stringify({p:id,s:s.id,e:now()+15*60000})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url')}
 function postDto(p,s){const grant=mediaGrant(p.id,s);return {id:p.id,author:profile(p.profile_id,s.profile_id),caption:p.caption,createdAt:p.created_at,width:p.width,height:p.height,imageUrl:origin+'/api/media/'+p.id+'?grant='+grant,thumbnailUrl:origin+'/api/media/'+p.id+'?size=thumb&grant='+grant,likes:db.prepare('SELECT COUNT(*) n FROM likes l JOIN profiles a ON a.id=l.profile_id WHERE l.post_id=? AND a.banned=0').get(p.id).n,liked:!!db.prepare('SELECT 1 FROM likes WHERE profile_id=? AND post_id=?').get(s.profile_id,p.id),comments:db.prepare('SELECT COUNT(*) n FROM comments c JOIN profiles a ON a.id=c.profile_id WHERE c.post_id=? AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=c.profile_id) OR (b.blocker_id=c.profile_id AND b.blocked_id=?))').get(p.id,s.profile_id,s.profile_id).n}}
 function notify(recipient,actor,kind,postId){if(recipient===actor)return;db.prepare('INSERT OR IGNORE INTO notifications(profile_id,actor_id,kind,post_id,created_at) VALUES(?,?,?,?,?)').run(recipient,actor,kind,postId??null,now())}
 function unreadNotifications(uid){return db.prepare(`SELECT COUNT(*) n FROM notifications n JOIN profiles a ON a.id=n.actor_id WHERE n.profile_id=? AND n.read_at IS NULL AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=?))`).get(uid,uid,uid).n}
 function unreadMessages(uid){return db.prepare(`SELECT COUNT(*) n FROM direct_messages m JOIN profiles a ON a.id=m.sender_id WHERE m.recipient_id=? AND m.read_at IS NULL AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=m.sender_id) OR (b.blocker_id=m.sender_id AND b.blocked_id=?))`).get(uid,uid,uid).n}
 function notificationDto(n,uid){return {id:n.id,kind:n.kind,actor:profile(n.actor_id,uid),postId:n.post_id||null,createdAt:n.created_at,isRead:n.read_at!==null}}
 function messageDto(m,uid){return {id:m.id,text:m.text,createdAt:m.created_at,outgoing:m.sender_id===uid,isRead:m.sender_id===uid||m.read_at!==null}}
 function send(res,status,body,type='application/json'){if(type==='application/json'&&res.zoigramSession)avatars.decorate(body,res.zoigramSession);res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body)}
 async function json(req,max=65536){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'Ожидается JSON.');if(Number(req.headers['content-length']||0)>max)fail(413,'Слишком большой файл.');let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>max)fail(413,'Слишком большой файл.');chunks.push(chunk)}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{fail(400,'Не удалось прочитать запрос.')}}
 function cleanExpired(){db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());db.prepare('DELETE FROM logins WHERE expires_at<?').run(now());db.prepare('DELETE FROM devices WHERE expires_at<?').run(now());db.prepare('DELETE FROM nonces WHERE expires_at<?').run(now());db.prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(now());db.prepare('DELETE FROM admin_logins WHERE expires_at<?').run(now());for(const table of ['account_links','account_flows'])db.prepare('DELETE FROM '+table+' WHERE expires_at<?').run(now());}
 const accounts=require('./accounts.cjs').createAccounts({db,origin,secret,fail,limit,json,send,authorize});
 const admin=require('./admin.cjs').createAdmin({db,origin,secret,ownerSteamId:options.ownerSteamId||'',ownerProfileId:options.ownerProfileId||'',accounts,storageBytes:budget,send,json,limit,onError:options.onError});
 const avatars=require('./avatars.cjs').createAvatars({db,origin,secret,budget,fail,limit,json,send,authorize});
 cleanExpired();const cleaner=setInterval(cleanExpired,300000);cleaner.unref();
 async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const ip=options.trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1).trim():req.socket.remoteAddress;
  const u=new URL(req.url,'http://local'),language=I18n.languageFor(req,u),t=key=>escape(I18n.t(language,key));
  res.setHeader('Content-Language',language);res.setHeader('Vary','Accept-Language, Cookie');
  try{
   const method=req.method,p=u.pathname;
   if(await admin.handle(req,res,u,ip))return;
   if(p.startsWith('/api/')){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Accept-Language');res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, PATCH, DELETE, OPTIONS');if(method==='OPTIONS'){res.writeHead(204);return res.end()}}
   limit('ip:'+ip,600);if(method==='GET'&&p==='/health')return send(res,200,{ok:true,service:'Zoigram',version:require('../package.json').version});
   if(await avatars.handle(req,res,u))return;
   if(await accounts.handle(req,res,u,ip,language))return;
    if(method==='GET'&&p==='/api/info')return send(res,200,{name:options.name||'Zoigram',version:require('../package.json').version,environment:local?'local':'public',authentication:'password',features:{avatars:true,accounts:true},languages:I18n.languages,limits:{imageBytes:MAX_IMAGE,caption:2200,comment:1000,message:2000,postsPerDay:20},origin});
   if(method==='POST'&&p==='/api/auth/device'){
    limit('device:'+ip,6,600000);const deviceToken=random(),userCode=crypto.randomBytes(5).toString('hex').toUpperCase(),expiresAt=now()+600000;
    db.prepare('INSERT INTO devices(secret_hash,user_code,expires_at) VALUES(?,?,?)').run(hash(deviceToken),userCode,expiresAt);
    return send(res,201,{deviceToken,userCode,expiresAt,verificationUrl:origin+'/connect?code='+userCode+'&lang='+I18n.accountLanguage});
   }
   if(method==='POST'&&p==='/api/auth/poll'){
    const body=await json(req),deviceToken=body.deviceToken;if(typeof deviceToken!=='string'||deviceToken.length!==43)fail(400,'Код входа неверен.');limit('poll:'+hash(deviceToken),40);
    const d=db.prepare('SELECT * FROM devices WHERE secret_hash=? AND expires_at>?').get(hash(deviceToken),now());if(!d)fail(410,'Код входа истёк. Начните заново.');if(d.consumed)fail(410,'Вход уже завершён. Если связь прервалась, начните заново.');if(!d.profile_id)return send(res,200,{status:'pending'});
    const me=profile(d.profile_id,d.profile_id);const access=transaction(db,()=>{const access=session(db,d.profile_id);db.prepare('UPDATE devices SET consumed=1 WHERE secret_hash=?').run(d.secret_hash);return access});return send(res,200,{status:'complete',...access,profile:me});
   }
   if(method==='GET'&&p==='/')return send(res,200,page('Zoigram','<p>'+t('Фотографии из inZOI, которыми делятся реальные игроки.')+'</p><p>'+t('Для входа откройте Zoigram в телефоне персонажа и нажмите «Войти».')+'</p>'+(local?'<p><small>'+t('Сейчас это локальный тестовый сервер на вашем компьютере.')+'</small></p>':''),language),'text/html');
   const media=p.match(/^\/api\/media\/(\d+)$/);
   if(method==='GET'&&media){
    const grant=u.searchParams.get('grant')||'';if(grant.length>1000)fail(403,'Ссылка истекла. Обновите ленту.');const [payload,signature,...extra]=grant.split('.'),expected=crypto.createHmac('sha256',secret).update(payload||'').digest('base64url');if(extra.length||!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail(403,'Ссылка истекла. Обновите ленту.');
    let g;try{g=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{fail(403,'Неверная ссылка.')}
    if(g.p!==Number(media[1])||typeof g.e!=='number'||g.e<now())fail(403,'Ссылка истекла. Обновите ленту.');const s=db.prepare('SELECT s.* FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.id=? AND s.expires_at>? AND p.banned=0').get(g.s,now());if(!s)fail(403,'Войдите заново.');visiblePost(g.p,s.profile_id);
    const row=db.prepare('SELECT '+(u.searchParams.get('size')==='thumb'?'thumbnail':'image')+' AS image FROM posts WHERE id=?').get(g.p);res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':row.image.length,'Cache-Control':'private, no-store'});return res.end(Buffer.from(row.image));
   }
   if(!p.startsWith('/api/'))fail(404,'Страница не найдена.');const s=authorize(req),uid=s.profile_id;res.zoigramSession=s;limit('user:'+uid,240);
   if(method==='DELETE'&&p==='/api/session'){db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);return send(res,200,{ok:true})}
   if(method==='GET'&&p==='/api/me')return send(res,200,{profile:profile(uid,uid)});
   if(method==='PATCH'&&p==='/api/me'){
    const b=await json(req),current=db.prepare('SELECT username FROM profiles WHERE id=?').get(uid);
    if(['id','profileId','provider','subject'].some(k=>Object.hasOwn(b,k))||Object.hasOwn(b,'username')&&b.username!==current.username)fail(403,'ID аккаунта закреплён. Изменить его может только модератор.');
    const name=text(b.displayName,40,true),bio=text(b.bio||'',160);
    db.prepare('UPDATE profiles SET display_name=?,bio=? WHERE id=?').run(name,bio,uid);return send(res,200,{profile:profile(uid,uid)});
   }
   if(method==='GET'&&p==='/api/activity')return send(res,200,{unreadNotifications:unreadNotifications(uid),unreadMessages:unreadMessages(uid)});
   if(method==='GET'&&p==='/api/notifications'){
    const before=u.searchParams.get('before');if(before&&!/^\d{1,15}$/.test(before))fail(400,'Неверная страница уведомлений.');
    const rows=db.prepare(`SELECT n.* FROM notifications n JOIN profiles a ON a.id=n.actor_id WHERE n.profile_id=? AND n.id<? AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=?)) ORDER BY n.id DESC LIMIT 21`).all(uid,before?Number(before):Number.MAX_SAFE_INTEGER,uid,uid);
    return send(res,200,{notifications:rows.slice(0,20).map(n=>notificationDto(n,uid)),nextCursor:rows.length>20?String(rows[19].id):null,unread:unreadNotifications(uid)});
   }
   if(method==='PUT'&&p==='/api/notifications/read'){
    const b=await json(req),through=Number(b.through);if(!Number.isSafeInteger(through)||through<1)fail(400,'Неверный номер уведомления.');db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE profile_id=? AND id<=?').run(now(),uid,through);return send(res,200,{ok:true,unread:unreadNotifications(uid)});
   }
   if(method==='GET'&&p==='/api/conversations'){
    const before=u.searchParams.get('before');if(before&&!/^\d{1,15}$/.test(before))fail(400,'Неверная страница диалогов.');const cursor=before?Number(before):Number.MAX_SAFE_INTEGER;
    const rows=db.prepare(`WITH latest AS (SELECT CASE WHEN sender_id=? THEN recipient_id ELSE sender_id END other_id,MAX(id) last_id FROM direct_messages WHERE sender_id=? OR recipient_id=? GROUP BY other_id) SELECT m.*,l.other_id,(SELECT COUNT(*) FROM direct_messages unread WHERE unread.sender_id=l.other_id AND unread.recipient_id=? AND unread.read_at IS NULL) unread FROM latest l JOIN direct_messages m ON m.id=l.last_id JOIN profiles a ON a.id=l.other_id WHERE m.id<? AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=l.other_id) OR (b.blocker_id=l.other_id AND b.blocked_id=?)) ORDER BY m.id DESC LIMIT 21`).all(uid,uid,uid,uid,cursor,uid,uid);
    const conversations=rows.slice(0,20).map(r=>({participant:profile(r.other_id,uid),lastMessage:messageDto(r,uid),unread:r.unread}));return send(res,200,{conversations,nextCursor:rows.length>20?String(rows[19].id):null,unread:unreadMessages(uid)});
   }
   const conversation=p.match(/^\/api\/conversations\/([a-f0-9-]{36})(?:\/messages|\/read)$/);
   if(conversation){const other=conversation[1],isMessages=p.endsWith('/messages'),isRead=p.endsWith('/read');if(other===uid)fail(400,'Нельзя написать самому себе.');profile(other,uid);if(blocked(uid,other))fail(404,'Диалог недоступен.');
    if(isMessages&&method==='GET'){const before=u.searchParams.get('before');if(before&&!/^\d{1,15}$/.test(before))fail(400,'Неверная страница сообщений.');const rows=db.prepare(`SELECT * FROM direct_messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND id<? ORDER BY id DESC LIMIT 31`).all(uid,other,other,uid,before?Number(before):Number.MAX_SAFE_INTEGER);const page=rows.slice(0,30);return send(res,200,{participant:profile(other,uid),messages:page.reverse().map(m=>messageDto(m,uid)),nextCursor:rows.length>30?String(rows[29].id):null,unread:unreadMessages(uid)})}
    if(isMessages&&method==='POST'){limit('message:'+uid,30);const b=await json(req),value=text(b.text,2000,true),requestId=key(b.requestId);const existing=db.prepare('SELECT * FROM direct_messages WHERE sender_id=? AND request_id=?').get(uid,requestId);if(existing){if(existing.recipient_id!==other||existing.text!==value)fail(409,'Идентификатор сообщения уже использован.');return send(res,200,{message:messageDto(existing,uid),repeated:true})}const id=Number(db.prepare('INSERT INTO direct_messages(sender_id,recipient_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(uid,other,requestId,value,now()).lastInsertRowid);return send(res,201,{message:messageDto(db.prepare('SELECT * FROM direct_messages WHERE id=?').get(id),uid)})}
    if(isRead&&method==='PUT'){db.prepare('UPDATE direct_messages SET read_at=COALESCE(read_at,?) WHERE sender_id=? AND recipient_id=? AND read_at IS NULL').run(now(),other,uid);return send(res,200,{ok:true,unread:unreadMessages(uid)})}
   }
   if(method==='GET'&&p==='/api/feed'){
    const scope=u.searchParams.get('scope')||'all',author=u.searchParams.get('profile'),before=u.searchParams.get('before');if(!['all','following'].includes(scope)||before&&!/^\d{1,15}$/.test(before))fail(400,'Неверный фильтр ленты.');if(author){profile(author,uid);if(blocked(uid,author))fail(404,'Профиль недоступен.')}
    const rows=db.prepare(`SELECT p.id,p.profile_id,p.caption,p.created_at,p.width,p.height FROM posts p JOIN profiles a ON a.id=p.profile_id WHERE a.banned=0 AND p.id<? AND (? IS NULL OR p.profile_id=?) AND (?='all' OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=p.profile_id)) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.profile_id) OR (b.blocker_id=p.profile_id AND b.blocked_id=?)) ORDER BY p.id DESC LIMIT 11`).all(before?Number(before):Number.MAX_SAFE_INTEGER,author,author,scope,uid,uid,uid);
    return send(res,200,{posts:rows.slice(0,10).map(p=>postDto(p,s)),nextCursor:rows.length>10?String(rows[9].id):null});
   }
   if(method==='POST'&&p==='/api/posts'){
    limit('upload:'+uid,30,3600000);if(conversions>=2)fail(503,'Сервис обрабатывает фотографии. Попробуйте через несколько секунд.');const b=await json(req,MAX_JSON),requestId=key(b.requestId),caption=text(b.caption||'',2200),encoded=b.imageBase64;
    if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_IMAGE/3)*4||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded))fail(400,'Не удалось прочитать фотографию.');const input=Buffer.from(encoded,'base64');if(input.toString('base64')!==encoded)fail(400,'Не удалось прочитать фотографию.');if(input.length<16||input.length>MAX_IMAGE)fail(413,'Фото должно быть не больше 8 МБ.');
    const digest=hash(caption+'\0'+encoded),previous=db.prepare('SELECT id,payload_hash FROM posts WHERE profile_id=? AND request_id=?').get(uid,requestId);if(previous){if(previous.payload_hash!==digest)fail(409,'Этот запрос уже использован для другого поста.');return send(res,200,{post:postDto(visiblePost(previous.id,uid),s),repeated:true})}
    if(db.prepare('SELECT COUNT(*) n FROM posts WHERE profile_id=? AND created_at>?').get(uid,now()-86400000).n>=20)fail(429,'Можно опубликовать до 20 фотографий за сутки.');
    let image,thumb,info;conversions++;try{const base=sharp(input,{limitInputPixels:32000000,failOn:'warning',animated:false});const meta=await base.metadata();if(!['png','jpeg','webp'].includes(meta.format)||meta.pages>1||!meta.width||!meta.height||meta.width<64||meta.height<64)fail(400,'Выберите обычное фото PNG, JPEG или WebP размером от 64×64.');const full=await base.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85,mozjpeg:true}).toBuffer({resolveWithObject:true});image=full.data;info=full.info;thumb=await sharp(image).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer()}catch(e){if(e.status)throw e;fail(400,'Фотография повреждена или не поддерживается.')}finally{conversions--}
    const postId=transaction(db,()=>{const same=db.prepare('SELECT id,payload_hash FROM posts WHERE profile_id=? AND request_id=?').get(uid,requestId);if(same){if(same.payload_hash!==digest)fail(409,'Идентификатор запроса уже использован.');return same.id}if(db.prepare('SELECT COUNT(*) n FROM posts WHERE profile_id=? AND created_at>?').get(uid,now()-86400000).n>=20)fail(429,'Достигнут лимит публикаций на сегодня.');const used=db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars) n').get().n;if(used+image.length+thumb.length>budget)fail(507,'Хранилище заполнено. Владелец сервера уже может освободить место.');return Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid,requestId,digest,caption,now(),info.width,info.height,image,thumb,image.length+thumb.length).lastInsertRowid)});
    return send(res,201,{post:postDto(visiblePost(postId,uid),s)});
   }
   const postRoute=p.match(/^\/api\/posts\/(\d+)(?:\/(like|comments))?$/);
   if(postRoute){const id=Number(postRoute[1]),action=postRoute[2],post=visiblePost(id,uid);
    if(!action&&method==='GET')return send(res,200,{post:postDto(post,s)});
    if(!action&&method==='DELETE'){if(post.profile_id!==uid)fail(403,'Можно удалить только свою публикацию.');db.prepare('DELETE FROM posts WHERE id=?').run(id);return send(res,200,{ok:true})}
    if(action==='like'&&['PUT','DELETE'].includes(method)){transaction(db,()=>{if(method==='PUT'){const changed=db.prepare('INSERT OR IGNORE INTO likes VALUES(?,?)').run(uid,id).changes;if(changed)notify(post.profile_id,uid,'like',id)}else{db.prepare('DELETE FROM likes WHERE profile_id=? AND post_id=?').run(uid,id);db.prepare("DELETE FROM notifications WHERE kind='like' AND actor_id=? AND post_id=?").run(uid,id)}});return send(res,200,{post:postDto(post,s)})}
    if(action==='comments'&&method==='GET'){
     const after=u.searchParams.get('after')||'0';if(!/^\d{1,15}$/.test(after))fail(400,'Неверная страница комментариев.');const rows=db.prepare(`SELECT c.* FROM comments c JOIN profiles a ON a.id=c.profile_id WHERE c.post_id=? AND c.id>? AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=c.profile_id) OR (b.blocker_id=c.profile_id AND b.blocked_id=?)) ORDER BY c.id LIMIT 21`).all(id,Number(after),uid,uid);return send(res,200,{post:postDto(post,s),comments:rows.slice(0,20).map(c=>({id:c.id,author:profile(c.profile_id,uid),text:c.text,createdAt:c.created_at})),nextCursor:rows.length>20?String(rows[19].id):null});
    }
    if(action==='comments'&&method==='POST'){
     limit('comment:'+uid,12);const b=await json(req),value=text(b.text,1000,true),requestId=key(b.requestId);const existing=db.prepare('SELECT * FROM comments WHERE profile_id=? AND request_id=?').get(uid,requestId);if(existing){if(existing.post_id!==id||existing.text!==value)fail(409,'Идентификатор комментария уже использован.');return send(res,200,{ok:true,id:existing.id,repeated:true})}const cid=Number(db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(uid,id,requestId,value,now()).lastInsertRowid);return send(res,201,{ok:true,id:cid});
    }
   }
   const commentRoute=p.match(/^\/api\/comments\/(\d+)$/);if(commentRoute&&method==='DELETE'){const c=db.prepare('SELECT * FROM comments WHERE id=?').get(Number(commentRoute[1]));if(!c)fail(404,'Комментарий недоступен.');visiblePost(c.post_id,uid);if(c.profile_id!==uid)fail(403,'Можно удалить только свой комментарий.');db.prepare('DELETE FROM comments WHERE id=?').run(c.id);return send(res,200,{ok:true})}
   const account=p.match(/^\/api\/profiles\/([a-f0-9-]{36})(?:\/(follow|block|following))?$/);
   if(account){const target=account[1],action=account[2];profile(target,uid);
    if(!action&&method==='GET'){if(blocked(uid,target))fail(404,'Профиль недоступен.');return send(res,200,{profile:profile(target,uid)})}
    if(action==='block'&&['PUT','DELETE'].includes(method)){if(uid===target)fail(400,'Это ваш профиль.');transaction(db,()=>{if(method==='PUT'){db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').run(uid,target);db.prepare('DELETE FROM follows WHERE (follower_id=? AND following_id=?) OR (follower_id=? AND following_id=?)').run(uid,target,target,uid)}else db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(uid,target)});return send(res,200,{ok:true})}
    if(blocked(uid,target))fail(404,'Профиль недоступен.');
    if(action==='follow'&&['PUT','DELETE'].includes(method)){if(uid===target)fail(400,'Это ваш профиль.');transaction(db,()=>{if(method==='PUT'){const changed=db.prepare('INSERT OR IGNORE INTO follows VALUES(?,?,?)').run(uid,target,now()).changes;if(changed)notify(target,uid,'follow',null)}else{db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(uid,target);db.prepare("DELETE FROM notifications WHERE kind='follow' AND profile_id=? AND actor_id=?").run(target,uid)}});return send(res,200,{profile:profile(target,uid)})}
    if(action==='following'&&method==='GET'){const after=u.searchParams.get('after')||'';const rows=db.prepare('SELECT f.following_id FROM follows f JOIN profiles p ON p.id=f.following_id WHERE f.follower_id=? AND f.following_id>? AND p.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=f.following_id) OR (b.blocker_id=f.following_id AND b.blocked_id=?)) ORDER BY f.following_id LIMIT 21').all(target,after,uid,uid);return send(res,200,{profiles:rows.slice(0,20).map(r=>profile(r.following_id,uid)),nextCursor:rows.length>20?rows[19].following_id:null})}
   }
   if(method==='GET'&&p==='/api/blocks'){const rows=db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id=? ORDER BY blocked_id LIMIT 100').all(uid);return send(res,200,{profiles:rows.map(r=>{try{return profile(r.blocked_id,uid)}catch{return null}}).filter(Boolean)})}
   if(method==='POST'&&p==='/api/reports'){
    limit('report:'+uid,10,3600000);const b=await json(req),reason=text(b.reason||'',500,true),kind=b.kind,target=String(b.targetId);if(!['post','comment','profile'].includes(kind))fail(400,'Неверный тип жалобы.');if(kind==='post')visiblePost(Number(target),uid);if(kind==='profile')profile(target,uid);if(kind==='comment'){const c=db.prepare('SELECT post_id FROM comments WHERE id=?').get(Number(target));if(!c)fail(404,'Комментарий не найден.');visiblePost(c.post_id,uid)}db.prepare('INSERT OR IGNORE INTO reports(profile_id,kind,target_id,reason,created_at) VALUES(?,?,?,?,?)').run(uid,kind,target,reason,now());return send(res,201,{ok:true});
   }
   fail(404,'Действие не найдено.');
  }catch(e){const status=e.status||500;if(status===429)res.setHeader('Retry-After','60');if(!e.status&&options.onError)options.onError(e);if(!res.headersSent){const key=status===500?'Ошибка сервера. Попробуйте позже.':e.message;const error=I18n.t(language,key);if(u.pathname.startsWith('/api/'))send(res,status,{error,messageKey:key});else send(res,status,page('Zoigram','<p>'+escape(error)+'</p>',language),'text/html')}else res.end()}
 }
 const server=http.createServer(handler);server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 let closing;
 return {server,db,close:()=>closing||(closing=new Promise(resolve=>{clearInterval(cleaner);server.close(()=>{if(!options.db)db.close();resolve()});server.closeIdleConnections()})),origin};
}
module.exports={createApp,Problem,MAX_IMAGE};
