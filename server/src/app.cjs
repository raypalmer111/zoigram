'use strict';
const http=require('node:http'),crypto=require('node:crypto'),sharp=require('sharp');
const {openStore,transaction,session,hash,random}=require('./store.cjs');
const I18n=require('./i18n.cjs'),Metadata=require('./social-metadata.cjs'),Social=require('./social-features.cjs');
sharp.concurrency(2);sharp.cache({memory:32,files:0,items:20});
const Albums=require('./albums.cjs'),MAX_IMAGE=Albums.MAX_IMAGE;
class Problem extends Error{constructor(status,message){super(message);this.status=status}}
const fail=(status,message,details={})=>{throw Object.assign(new Problem(status,message),details)};
const text=(v,max,required=false)=>{if(typeof v!=='string'||[...v].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))fail(400,'Проверьте текст и его длину.');v=v.trim();if(required&&!v)fail(400,'Заполните поле.');return v};
const key=v=>{if(typeof v!=='string'||! /^[a-zA-Z0-9_-]{8,100}$/.test(v))fail(400,'Не указан идентификатор отправки.');return v};
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=(title,body,language)=>'<!doctype html><html lang="'+language+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(title)+' · Zoigram</title><style>body{font:16px system-ui;margin:12vh auto;padding:24px;max-width:500px;color:#25212c;background:#faf8fc}main{background:white;padding:32px;border-radius:24px;box-shadow:0 12px 60px #44224412}a,button{display:inline-block;padding:14px 20px;background:#a92fc2;color:white;border:0;border-radius:12px;text-decoration:none;font:inherit}p{line-height:1.6}code{font-size:24px}small{color:#777}</style><main><h1>'+escape(title)+'</h1>'+body+'</main></html>';
function createApp(options={}){
 const db=options.db||openStore(options.database),origin=new URL(options.origin).origin,secret=options.secret||crypto.randomBytes(32),creatorProfileId=options.ownerProfileId||'',now=()=>Date.now();
 db.function('zoigram_fold',{deterministic:true},value=>String(value||'').normalize('NFKC').toLowerCase());
 const local=['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname);
 if(!local&&!origin.startsWith('https://'))throw Error('Public origin requires HTTPS');
 const budget=options.storageBytes||10*1024*1024*1024,limits=new Map(),transport=require('./upload-transport.cjs').createUploadTransport({Problem,options:options.uploadTransport}),gate=transport.gate;
 function limit(bucket,max,ms=60000){const t=now();let r=limits.get(bucket);if(!r||r.until<=t){r={count:0,until:t+ms};limits.set(bucket,r)}if(++r.count>max)fail(429,'Слишком много запросов. Подождите немного.',{code:'rate_limit',retryAfter:Math.max(1,Math.ceil((r.until-t)/1000)),stage:({'upload-start':'upload_start','upload-part':'upload_part','upload-complete':'upload_complete'})[bucket.split(':')[0]]});if(limits.size>20000){for(const [k,v]of limits)if(v.until<=t)limits.delete(k);if(limits.size>20000)fail(503,'Сервис занят. Попробуйте позже.')}}
 function dailyPostLimit(uid){const first=db.prepare('SELECT COUNT(*) n,MIN(created_at) first FROM posts WHERE profile_id=? AND created_at>?').get(uid,now()-86400000);if(first.n>=20)fail(429,'Достигнут лимит публикаций на сегодня.',{code:'daily_posts_limit',retryAfter:Math.max(1,Math.ceil((first.first+86400000-now())/1000))});}
 function blocked(a,b){return !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)').get(a,b,b,a)}
 function profile(id,viewer){
  const p=db.prepare('SELECT id,username,display_name,bio,created_at,banned FROM profiles WHERE id=?').get(id);if(!p||p.banned)fail(404,'Профиль недоступен.');
  return {...(id===viewer?{accountConfigured:!!db.prepare("SELECT 1 FROM account_credentials WHERE profile_id=?").get(id),accountRevision:db.prepare("SELECT updated_at FROM account_credentials WHERE profile_id=?").get(id)?.updated_at||0}:{}),id:p.id,creator:p.id===creatorProfileId,verified:Metadata.verification(db,p.id).verified,username:p.username,displayName:p.display_name,bio:p.bio,createdAt:p.created_at,postCount:db.prepare('SELECT COUNT(*) n FROM posts WHERE profile_id=?').get(id).n,followers:db.prepare('SELECT COUNT(*) n FROM follows f JOIN profiles p ON p.id=f.follower_id WHERE f.following_id=? AND p.banned=0').get(id).n,following:db.prepare('SELECT COUNT(*) n FROM follows f JOIN profiles p ON p.id=f.following_id WHERE f.follower_id=? AND p.banned=0').get(id).n,isSelf:id===viewer,isFollowing:!!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(viewer,id),isBlocked:!!db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(viewer,id)};
 }
 function authorize(req){const token=(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];if(!token)fail(401,'Войдите в Zoigram.');const s=db.prepare('SELECT s.*,p.banned FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE token_hash=? AND expires_at>?').get(hash(token),now());if(!s||s.banned)fail(401,'Войдите в Zoigram заново.');return s}
 function visiblePost(id,user){const p=db.prepare('SELECT p.id,p.profile_id,p.caption,p.created_at,p.width,p.height FROM posts p JOIN profiles a ON a.id=p.profile_id WHERE p.id=? AND a.banned=0').get(id);if(!p||blocked(user,p.profile_id))fail(404,'Публикация недоступна.');return p}
 function mediaGrant(id,s,expiresAt){const payload=Buffer.from(JSON.stringify({p:id,s:s.id,e:expiresAt})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url')}
 function postDto(p,s){const mediaExpiresAt=Math.min(now()+15*60000,s.expires_at),grant=mediaGrant(p.id,s,mediaExpiresAt),pin=db.prepare('SELECT created_at FROM pinned_posts WHERE post_id=?').get(p.id);return {id:p.id,mediaExpiresAt,pinned:!!pin,pinnedAt:pin?.created_at??null,photos:Albums.list(db,p,origin,grant),saved:!!db.prepare('SELECT 1 FROM bookmarks WHERE profile_id=? AND post_id=?').get(s.profile_id,p.id),author:profile(p.profile_id,s.profile_id),caption:p.caption,createdAt:p.created_at,width:p.width,height:p.height,imageUrl:origin+'/api/media/'+p.id+'?grant='+grant,thumbnailUrl:origin+'/api/media/'+p.id+'?size=thumb&grant='+grant,likes:Metadata.likeCounts(db,p.id).likes,liked:!!db.prepare('SELECT 1 FROM likes WHERE profile_id=? AND post_id=?').get(s.profile_id,p.id),comments:db.prepare('SELECT COUNT(*) n FROM comments c JOIN profiles a ON a.id=c.profile_id WHERE c.post_id=? AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=c.profile_id) OR (b.blocker_id=c.profile_id AND b.blocked_id=?))').get(p.id,s.profile_id,s.profile_id).n}}
 function notify(recipient,actor,kind,postId,commentId){if(recipient===actor)return;db.prepare('INSERT OR IGNORE INTO notifications(profile_id,actor_id,kind,post_id,created_at,comment_id) VALUES(?,?,?,?,?,?)').run(recipient,actor,kind,postId??null,now(),commentId??null)}
 const notificationFeatures=`(? OR n.kind!='comment') AND (? OR n.kind!='mention')`;
 const notificationDedup=`NOT (? AND n.kind='comment' AND EXISTS(SELECT 1 FROM notifications mention WHERE mention.kind='mention' AND mention.profile_id=n.profile_id AND mention.comment_id=n.comment_id))`;
 function unreadNotifications(uid,comments=false,mentions=false){return db.prepare(`SELECT COUNT(*) n FROM notifications n JOIN profiles a ON a.id=n.actor_id WHERE n.profile_id=? AND n.read_at IS NULL AND ${notificationFeatures} AND ${notificationDedup} AND ${Social.notificationVisible}`).get(uid,comments?1:0,mentions?1:0,mentions?1:0).n}
 function unreadMessages(uid){return db.prepare(`SELECT COUNT(*) n FROM direct_messages m JOIN profiles a ON a.id=m.sender_id WHERE m.recipient_id=? AND m.read_at IS NULL AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=m.sender_id) OR (b.blocker_id=m.sender_id AND b.blocked_id=?))`).get(uid,uid,uid).n}
 function notificationDto(n,uid){return {id:n.id,kind:n.kind,actor:profile(n.actor_id,uid),postId:n.post_id||null,commentId:n.comment_id||null,createdAt:n.created_at,isRead:n.read_at!==null}}
 function messageDto(m,uid){return {id:m.id,text:m.text,createdAt:m.created_at,outgoing:m.sender_id===uid,isRead:m.sender_id===uid||m.read_at!==null}}
 function send(res,status,body,type='application/json'){if(res.destroyed||res.writableEnded)return;if(type==='application/json'&&res.zoigramSession)avatars.decorate(body,res.zoigramSession);res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body)}
 const json=async(req,max)=>{const body=await transport.json(req,max);if(req.zoigramSession)authorize(req);return body};
 function cleanExpired(){db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());db.prepare('DELETE FROM logins WHERE expires_at<?').run(now());db.prepare('DELETE FROM devices WHERE expires_at<?').run(now());db.prepare('DELETE FROM nonces WHERE expires_at<?').run(now());db.prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(now());db.prepare('DELETE FROM admin_logins WHERE expires_at<?').run(now());for(const table of ['account_links','account_flows'])db.prepare('DELETE FROM '+table+' WHERE expires_at<?').run(now());}
 const accounts=require('./accounts.cjs').createAccounts({db,origin,secret,fail,limit,json,send,authorize});
 const operations=require('./operations.cjs').createOperations({db,budget,gate,dataDirectory:options.dataDirectory,backupDirectory:options.backupDirectory});
 const announcements=require('./announcements.cjs').createAnnouncements({db,fail});
 const admin=require('./admin.cjs').createAdmin({db,origin,secret,operations,announcements,zoimeetMonitor:options.zoimeetMonitor,ownerSteamId:options.ownerSteamId||'',ownerProfileId:options.ownerProfileId||'',accounts,storageBytes:budget,send,json,limit,onError:options.onError});
 const avatars=require('./avatars.cjs').createAvatars({db,origin,secret,budget,fail,limit,json,send,authorize,transport});
 const social=Social.createSocial({db,clock:now});
 const uploads=require('./uploads.cjs').createUploads({db,budget,fail,json,send,key,text,limit,transport,postDto,visiblePost,authorize,onPostCreated:(id,uid,caption)=>social.syncMentions(id,uid,caption)});
 const clean=()=>{cleanExpired();uploads.clean();operations.clean()};clean();const cleaner=setInterval(clean,300000);cleaner.unref();
 async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const ip=options.trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1).trim():req.socket.remoteAddress;
  let u=new URL('http://local/'),language='en';const t=key=>escape(I18n.t(language,key));
  res.setHeader('Content-Language',language);res.setHeader('Vary','Accept-Language, Cookie');
  try{
   try{u=new URL(req.url,'http://local')}catch{fail(400,'Не удалось прочитать запрос.')}
   language=I18n.languageFor(req,u);res.setHeader('Content-Language',language);
   const method=req.method,p=u.pathname;
   if(await admin.handle(req,res,u,ip))return;
   if(p.startsWith('/api/')){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Accept-Language, X-Zoigram-Features, X-Zoigram-Version');res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, PATCH, DELETE, OPTIONS');if(method==='OPTIONS'){res.writeHead(204);return res.end()}}
   limit('ip:'+ip,600);if(method==='GET'&&p==='/health')return send(res,200,{ok:true,service:'Zoigram',version:require('../package.json').version});
   if(await avatars.handle(req,res,u))return;
   if(await accounts.handle(req,res,u,ip,language))return;
    if(method==='GET'&&p==='/api/info')return send(res,200,{name:options.name||'Zoigram',version:require('../package.json').version,environment:local?'local':'public',authentication:'password',features:{avatars:true,accounts:true,profileSearch:true,captionEditing:true,savedPosts:true,commentNotifications:true,mentionNotifications:true,mentions:true,pinnedPosts:true,mediaRefresh:true,unreadConversations:true,photoAlbums:true,postRequestLookup:true,resumableUploads:true,announcements:true},languages:I18n.languages,limits:{albumPhotos:Albums.MAX_PHOTOS,imageBytes:MAX_IMAGE,uploadImageBytes:require('./uploads.cjs').MAX_INPUT,caption:2200,comment:1000,message:2000,postsPerDay:20,pinnedPosts:3},origin});
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
    const mediaFail=(code,message)=>{throw Object.assign(new Problem(403,message),{code})};
    const grant=u.searchParams.get('grant')||'';if(grant.length>1000)mediaFail('media_invalid','Ссылка истекла. Обновите ленту.');const [payload,signature,...extra]=grant.split('.'),expected=crypto.createHmac('sha256',secret).update(payload||'').digest('base64url');if(extra.length||!/^[A-Za-z0-9_-]{43}$/.test(signature||'')||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))mediaFail('media_invalid','Ссылка истекла. Обновите ленту.');
    let g;try{g=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'))}catch{mediaFail('media_invalid','Неверная ссылка.')}
    if(!g||g.p!==Number(media[1])||!Number.isFinite(g.e)||typeof g.s!=='string')mediaFail('media_invalid','Неверная ссылка.');if(g.e<now())mediaFail('media_expired','Ссылка истекла. Обновите ленту.');const s=db.prepare('SELECT s.* FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.id=? AND s.expires_at>? AND p.banned=0').get(g.s,now());if(!s)mediaFail('media_session_ended','Войдите заново.');res.zoigramSession=s;visiblePost(g.p,s.profile_id);
    const index=u.searchParams.get('photo')||'0';if(!/^[0-4]$/.test(index))fail(404,'Фото недоступно');const column=u.searchParams.get('size')==='thumb'?'thumbnail':'image';const row=index==='0'?db.prepare('SELECT '+column+' AS image FROM posts WHERE id=?').get(g.p):db.prepare('SELECT '+column+' AS image FROM post_photos WHERE post_id=? AND position=?').get(g.p,Number(index));if(!row)fail(404,'Фото недоступно');res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':row.image.length,'Cache-Control':'private, no-store'});return res.end(Buffer.from(row.image));
   }
   if(!p.startsWith('/api/'))fail(404,'Страница не найдена.');const s=authorize(req),uid=s.profile_id;req.zoigramSession=s;res.zoigramSession=s;const features=new Set(String(req.headers['x-zoigram-features']||'').split(',').map(x=>x.trim())),commentAlerts=features.has('comment-notifications'),mentionAlerts=features.has('mention-notifications');limit('user:'+uid,240);
   if(await uploads.handle(req,res,u,s))return;
   if(method==='POST'&&p==='/api/diagnostics'){limit('diagnostic:'+uid,12,3600000);const b=await json(req,2048);if(!require('./operations.cjs').CLIENT_CODES.has(b.code))fail(400,'Проверьте параметры запроса.');operations.record({source:'client',profileId:uid,clientVersion:req.headers['x-zoigram-version'],code:b.code,status:0,imageBytes:b.imageBytes,route:'upload'});return send(res,202,{ok:true})}
   if(method==='GET'&&p==='/api/announcements')return send(res,200,{announcements:announcements.live()});
   if(method==='DELETE'&&p==='/api/session'){db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);return send(res,200,{ok:true})}
   if(method==='GET'&&p==='/api/me')return send(res,200,{profile:profile(uid,uid)});
   if(method==='POST'&&p==='/api/media/refresh'){
    limit('media-refresh:'+uid,60);const b=await json(req,4096),postIds=b.postIds||[],profileIds=b.profileIds||[];
    if(!Array.isArray(postIds)||!Array.isArray(profileIds)||postIds.length+profileIds.length>30||postIds.some(id=>!Number.isSafeInteger(id)||id<1)||profileIds.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))fail(400,'Проверьте параметры запроса.');
    const posts=[],profiles=[],unavailablePostIds=[],unavailableProfileIds=[];
    for(const id of new Set(postIds)){try{posts.push(postDto(visiblePost(id,uid),s))}catch(e){if(e.status!==404)throw e;unavailablePostIds.push(id)}}
    for(const id of new Set(profileIds)){try{if(blocked(uid,id))fail(404,'Профиль недоступен.');profiles.push(profile(id,uid))}catch(e){if(e.status!==404)throw e;unavailableProfileIds.push(id)}}
    return send(res,200,{serverTime:now(),posts,profiles,unavailablePostIds,unavailableProfileIds});
   }
   if(method==='PATCH'&&p==='/api/me'){
    const b=await json(req),current=db.prepare('SELECT username FROM profiles WHERE id=?').get(uid);
    if(['id','profileId','provider','subject'].some(k=>Object.hasOwn(b,k))||Object.hasOwn(b,'username')&&b.username!==current.username)fail(403,'ID аккаунта закреплён. Изменить его может только модератор.');
    const name=text(b.displayName,40,true),bio=text(b.bio||'',160);
    db.prepare('UPDATE profiles SET display_name=?,bio=? WHERE id=?').run(name,bio,uid);return send(res,200,{profile:profile(uid,uid)});
   }
   if(method==='GET'&&p==='/api/profiles/search'){
    limit('search:'+uid,60);const query=text(u.searchParams.get('q')||'',80).normalize('NFKC').replace(/^@/,'').toLowerCase(),after=u.searchParams.get('after')||'';
    if(after&&!/^[a-f0-9-]{36}$/.test(after))fail(400,'Неверная страница поиска.');
    if(!query)return send(res,200,{profiles:[],nextCursor:null});
    const rows=db.prepare(`SELECT p.id FROM profiles p WHERE p.banned=0 AND p.id>? AND (instr(zoigram_fold(p.username),?)>0 OR instr(zoigram_fold(p.display_name),?)>0) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.id) OR (b.blocker_id=p.id AND b.blocked_id=?)) ORDER BY p.id LIMIT 21`).all(after,query,query,uid,uid);
    return send(res,200,{profiles:rows.slice(0,20).map(p=>profile(p.id,uid)),nextCursor:rows.length>20?rows[19].id:null});
   }
   if(method==='GET'&&p==='/api/activity')return send(res,200,{unreadNotifications:unreadNotifications(uid,commentAlerts,mentionAlerts),unreadMessages:unreadMessages(uid)});
   if(method==='GET'&&p==='/api/notifications'){
    const before=u.searchParams.get('before');if(before&&!/^\d{1,15}$/.test(before))fail(400,'Неверная страница уведомлений.');
    const rows=db.prepare(`SELECT n.* FROM notifications n JOIN profiles a ON a.id=n.actor_id WHERE n.profile_id=? AND n.id<? AND ${notificationFeatures} AND ${notificationDedup} AND ${Social.notificationVisible} ORDER BY n.id DESC LIMIT 21`).all(uid,before?Number(before):Number.MAX_SAFE_INTEGER,commentAlerts?1:0,mentionAlerts?1:0,mentionAlerts?1:0);
    return send(res,200,{notifications:rows.slice(0,20).map(n=>notificationDto(n,uid)),nextCursor:rows.length>20?String(rows[19].id):null,unread:unreadNotifications(uid,commentAlerts,mentionAlerts)});
   }
   if(method==='PUT'&&p==='/api/notifications/read'){
    const b=await json(req),through=Number(b.through);if(!Number.isSafeInteger(through)||through<1)fail(400,'Неверный номер уведомления.');db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id IN (SELECT n.id FROM notifications n JOIN profiles a ON a.id=n.actor_id WHERE n.profile_id=? AND n.id<=? AND ${notificationFeatures} AND ${Social.notificationVisible})`).run(now(),uid,through,commentAlerts?1:0,mentionAlerts?1:0);return send(res,200,{ok:true,unread:unreadNotifications(uid,commentAlerts,mentionAlerts)});
   }
   if(method==='GET'&&p==='/api/conversations'){
    const filter=u.searchParams.get('filter')||'all';if(!['all','unread'].includes(filter))fail(400,'Неверный фильтр диалогов.');
    const before=u.searchParams.get('before');if(before&&!/^\d{1,15}$/.test(before))fail(400,'Неверная страница диалогов.');const cursor=before?Number(before):Number.MAX_SAFE_INTEGER;
    const rows=db.prepare(`WITH latest AS (SELECT CASE WHEN sender_id=? THEN recipient_id ELSE sender_id END other_id,MAX(id) last_id FROM direct_messages WHERE sender_id=? OR recipient_id=? GROUP BY other_id) SELECT m.*,l.other_id,(SELECT COUNT(*) FROM direct_messages unread WHERE unread.sender_id=l.other_id AND unread.recipient_id=? AND unread.read_at IS NULL) unread FROM latest l JOIN direct_messages m ON m.id=l.last_id JOIN profiles a ON a.id=l.other_id WHERE m.id<? AND (?=0 OR EXISTS(SELECT 1 FROM direct_messages u WHERE u.sender_id=l.other_id AND u.recipient_id=? AND u.read_at IS NULL)) AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=l.other_id) OR (b.blocker_id=l.other_id AND b.blocked_id=?)) ORDER BY m.id DESC LIMIT 21`).all(uid,uid,uid,uid,cursor,filter==='unread'?1:0,uid,uid,uid);
    const conversations=rows.slice(0,20).map(r=>({participant:profile(r.other_id,uid),lastMessage:messageDto(r,uid),unread:r.unread}));return send(res,200,{conversations,nextCursor:rows.length>20?String(rows[19].id):null,unread:unreadMessages(uid)});
   }
   const conversation=p.match(/^\/api\/conversations\/([a-f0-9-]{36})(?:\/messages|\/read)$/);
   if(conversation){const other=conversation[1],isMessages=p.endsWith('/messages'),isRead=p.endsWith('/read');if(other===uid)fail(400,'Нельзя написать самому себе.');profile(other,uid);if(blocked(uid,other))fail(404,'Диалог недоступен.');
    if(isMessages&&method==='GET'){const before=u.searchParams.get('before');if(before&&!/^\d{1,15}$/.test(before))fail(400,'Неверная страница сообщений.');const rows=db.prepare(`SELECT * FROM direct_messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND id<? ORDER BY id DESC LIMIT 31`).all(uid,other,other,uid,before?Number(before):Number.MAX_SAFE_INTEGER);const page=rows.slice(0,30);return send(res,200,{participant:profile(other,uid),messages:page.reverse().map(m=>messageDto(m,uid)),nextCursor:rows.length>30?String(rows[29].id):null,unread:unreadMessages(uid)})}
     if(isMessages&&method==='POST'){limit('message:'+uid,30);const b=await json(req),value=text(b.text,2000,true),requestId=key(b.requestId);profile(other,uid);if(blocked(uid,other))fail(404,'Диалог недоступен.');const existing=db.prepare('SELECT * FROM direct_messages WHERE sender_id=? AND request_id=?').get(uid,requestId);if(existing){if(existing.recipient_id!==other||existing.text!==value)fail(409,'Идентификатор сообщения уже использован.');return send(res,200,{message:messageDto(existing,uid),repeated:true})}const id=Number(db.prepare('INSERT INTO direct_messages(sender_id,recipient_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(uid,other,requestId,value,now()).lastInsertRowid);return send(res,201,{message:messageDto(db.prepare('SELECT * FROM direct_messages WHERE id=?').get(id),uid)})}
    if(isRead&&method==='PUT'){db.prepare('UPDATE direct_messages SET read_at=COALESCE(read_at,?) WHERE sender_id=? AND recipient_id=? AND read_at IS NULL').run(now(),other,uid);return send(res,200,{ok:true,unread:unreadMessages(uid)})}
   }
   if(method==='GET'&&p==='/api/saved'){
    const before=u.searchParams.get('before');if(before&&!/^\d{1,15}$/.test(before))fail(400,'Неверная страница сохранённых публикаций.');
    const rows=db.prepare(`SELECT p.id,p.profile_id,p.caption,p.created_at,p.width,p.height,b.id bookmark_id FROM bookmarks b JOIN posts p ON p.id=b.post_id JOIN profiles a ON a.id=p.profile_id WHERE b.profile_id=? AND b.id<? AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks x WHERE (x.blocker_id=? AND x.blocked_id=p.profile_id) OR (x.blocker_id=p.profile_id AND x.blocked_id=?)) ORDER BY b.id DESC LIMIT 11`).all(uid,before?Number(before):Number.MAX_SAFE_INTEGER,uid,uid);
    return send(res,200,{announcements:announcements.live(),posts:rows.slice(0,10).map(p=>postDto(p,s)),nextCursor:rows.length>10?String(rows[9].bookmark_id):null});
   }
   if(method==='GET'&&p==='/api/feed'){
    const scope=u.searchParams.get('scope')||'all',author=u.searchParams.get('profile'),before=u.searchParams.get('before');if(!['all','following'].includes(scope)||before&&!/^\d{1,15}$/.test(before))fail(400,'Неверный фильтр ленты.');if(author){profile(author,uid);if(blocked(uid,author))fail(404,'Профиль недоступен.')}
     const separatePins=!!author&&features.has('pinned-posts');
     const rows=db.prepare(`SELECT p.id,p.profile_id,p.caption,p.created_at,p.width,p.height FROM posts p JOIN profiles a ON a.id=p.profile_id WHERE a.banned=0 AND p.id<? AND (? IS NULL OR p.profile_id=?) AND (?='all' OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=? AND f.following_id=p.profile_id)) AND (?=0 OR NOT EXISTS(SELECT 1 FROM pinned_posts pin WHERE pin.post_id=p.id)) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.profile_id) OR (b.blocker_id=p.profile_id AND b.blocked_id=?)) ORDER BY p.id DESC LIMIT 11`).all(before?Number(before):Number.MAX_SAFE_INTEGER,author,author,scope,uid,separatePins?1:0,uid,uid);
     const pins=separatePins&&!before?db.prepare(`SELECT p.id,p.profile_id,p.caption,p.created_at,p.width,p.height FROM pinned_posts pin JOIN posts p ON p.id=pin.post_id WHERE p.profile_id=? ORDER BY pin.created_at DESC,p.id DESC LIMIT 3`).all(author):[];
     return send(res,200,{announcements:announcements.live(),...(separatePins?{pinnedPosts:pins.map(p=>postDto(p,s))}:{}),posts:rows.slice(0,10).map(p=>postDto(p,s)),nextCursor:rows.length>10?String(rows[9].id):null});
   }
       const requestPost=p.match(/^\/api\/posts\/request\/([a-zA-Z0-9_-]{8,100})$/);
    if(method==='GET'&&requestPost){const row=db.prepare('SELECT id FROM posts WHERE profile_id=? AND request_id=?').get(uid,requestPost[1]);return send(res,200,{found:!!row,...(row?{post:postDto(visiblePost(row.id,uid),s)}:{})})}
    if(method==='POST'&&p==='/api/posts'){
     limit('upload:'+uid,30,3600000);const lease=transport.admit(req,res);
     try{
      const b=await json(req,Albums.MAX_BODY),requestId=key(b.requestId),caption=text(b.caption||'',2200),{inputs,digest}=Albums.decode(b,caption,fail);
      req.zoigramImageBytes=inputs.reduce((n,p)=>n+p.length,0);delete b.imageBase64;delete b.imagesBase64;
      const previous=db.prepare('SELECT id,payload_hash FROM posts WHERE profile_id=? AND request_id=?').get(uid,requestId);
      if(previous){if(previous.payload_hash!==digest)fail(409,'Этот запрос уже использован для другого поста.');return send(res,200,{post:postDto(visiblePost(previous.id,uid),s),repeated:true})}
      dailyPostLimit(uid);
      await lease.process();authorize(req);const photos=await Albums.convert(inputs,fail);lease.check();authorize(req);const bytes=photos.reduce((n,p)=>n+p.bytes,0),cover=photos[0];
      const postId=transaction(db,()=>{
       if(db.prepare('SELECT 1 FROM upload_sessions WHERE profile_id=? AND request_id=? AND (post_id IS NOT NULL OR expires_at>?)').get(uid,requestId,now()))fail(409,'Этот запрос уже использован для другого поста.');
       const same=db.prepare('SELECT id,payload_hash FROM posts WHERE profile_id=? AND request_id=?').get(uid,requestId);if(same){if(same.payload_hash!==digest)fail(409,'Идентификатор запроса уже использован.');return same.id}
       dailyPostLimit(uid);
       const used=db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars)+(SELECT COALESCE(SUM(bytes),0) FROM upload_parts) n').get().n;if(used+bytes>budget)fail(507,'Хранилище заполнено. Владелец сервера уже может освободить место.');
       const id=Number(db.prepare('INSERT INTO posts(profile_id,request_id,payload_hash,caption,created_at,width,height,image,thumbnail,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid,requestId,digest,caption,now(),cover.width,cover.height,cover.image,cover.thumbnail,bytes).lastInsertRowid);
        const insert=db.prepare('INSERT INTO post_photos VALUES(?,?,?,?,?,?,?)');photos.slice(1).forEach((p,i)=>insert.run(id,i+1,p.width,p.height,p.image,p.thumbnail,p.bytes));social.syncMentions(id,uid,caption);return id;
      });return send(res,201,{post:postDto(visiblePost(postId,uid),s)});
     }finally{lease.release()}
    }
 const postRoute=p.match(/^\/api\/posts\/(\d+)(?:\/(like|comments|save|pin))?$/);
   if(postRoute){const id=Number(postRoute[1]),action=postRoute[2],post=visiblePost(id,uid);
    if(!action&&method==='GET')return send(res,200,{post:postDto(post,s)});
    if(!action&&method==='PATCH'){
     limit('edit-post:'+uid,30);if(post.profile_id!==uid)fail(403,'Можно изменить только свою публикацию.');
     const body=await json(req);if(Object.keys(body).some(k=>!['caption','expectedCaption'].includes(k)))fail(400,'Можно изменить только подпись.');
     const caption=text(body.caption,2200),expected=text(body.expectedCaption,2200);
      transaction(db,()=>{const current=visiblePost(id,uid);if(current.caption===caption)return;if(current.caption!==expected)fail(409,'Подпись уже изменена. Откройте публикацию заново.');db.prepare('UPDATE posts SET caption=? WHERE id=? AND profile_id=?').run(caption,id,uid);social.syncMentions(id,uid,caption)});
     return send(res,200,{post:postDto(visiblePost(id,uid),s)});
    }
     if(!action&&method==='DELETE'){if(post.profile_id!==uid)fail(403,'Можно удалить только свою публикацию.');db.prepare('DELETE FROM posts WHERE id=?').run(id);return send(res,200,{ok:true})}
     if(action==='pin'&&['PUT','DELETE'].includes(method)){
      if(post.profile_id!==uid)fail(403,'Можно закрепить только свою публикацию.');
      transaction(db,()=>{if(method==='DELETE'){db.prepare('DELETE FROM pinned_posts WHERE post_id=?').run(id);return}if(db.prepare('SELECT 1 FROM pinned_posts WHERE post_id=?').get(id))return;const count=db.prepare('SELECT COUNT(*) n FROM pinned_posts pin JOIN posts p ON p.id=pin.post_id WHERE p.profile_id=?').get(uid).n;if(count>=3)fail(409,'Можно закрепить не больше 3 публикаций.',{code:'pin_limit'});db.prepare('INSERT INTO pinned_posts(post_id,created_at) VALUES(?,?)').run(id,now())});
      return send(res,200,{post:postDto(post,s)});
     }
    if(action==='save'&&['PUT','DELETE'].includes(method)){
     if(method==='PUT')db.prepare('INSERT OR IGNORE INTO bookmarks(profile_id,post_id,created_at) VALUES(?,?,?)').run(uid,id,now());
     else db.prepare('DELETE FROM bookmarks WHERE profile_id=? AND post_id=?').run(uid,id);
     return send(res,200,{post:postDto(post,s)});
    }
    if(action==='like'&&['PUT','DELETE'].includes(method)){transaction(db,()=>{if(method==='PUT'){const changed=db.prepare('INSERT OR IGNORE INTO likes VALUES(?,?)').run(uid,id).changes;if(changed)notify(post.profile_id,uid,'like',id)}else{db.prepare('DELETE FROM likes WHERE profile_id=? AND post_id=?').run(uid,id);db.prepare("DELETE FROM notifications WHERE kind='like' AND actor_id=? AND post_id=?").run(uid,id)}});return send(res,200,{post:postDto(post,s)})}
    if(action==='comments'&&method==='GET'){
     const after=u.searchParams.get('after')||'0';if(!/^\d{1,15}$/.test(after))fail(400,'Неверная страница комментариев.');const rows=db.prepare(`SELECT c.* FROM comments c JOIN profiles a ON a.id=c.profile_id WHERE c.post_id=? AND c.id>? AND a.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=c.profile_id) OR (b.blocker_id=c.profile_id AND b.blocked_id=?)) ORDER BY c.id LIMIT 21`).all(id,Number(after),uid,uid);return send(res,200,{post:postDto(post,s),comments:rows.slice(0,20).map(c=>({id:c.id,author:profile(c.profile_id,uid),text:c.text,createdAt:c.created_at})),nextCursor:rows.length>20?String(rows[19].id):null});
    }
    if(action==='comments'&&method==='POST'){
     limit('comment:'+uid,12);const b=await json(req),value=text(b.text,1000,true),requestId=key(b.requestId);visiblePost(id,uid);const existing=db.prepare('SELECT * FROM comments WHERE profile_id=? AND request_id=?').get(uid,requestId);if(existing){if(existing.post_id!==id||existing.text!==value)fail(409,'Идентификатор комментария уже использован.');return send(res,200,{ok:true,id:existing.id,repeated:true})}const cid=transaction(db,()=>{const cid=Number(db.prepare('INSERT INTO comments(profile_id,post_id,request_id,text,created_at) VALUES(?,?,?,?,?)').run(uid,id,requestId,value,now()).lastInsertRowid);notify(post.profile_id,uid,'comment',id,cid);social.syncMentions(id,uid,value,cid);return cid});return send(res,201,{ok:true,id:cid});
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
  }catch(e){const status=e.status||500;const errorId=operations.capture(req,res,u,status,e);if(!e.status&&options.onError)options.onError(e);if(res.destroyed||res.writableEnded)return;if(!res.headersSent){if([429,503].includes(status)&&Number.isInteger(e.retryAfter)&&e.retryAfter>0&&e.retryAfter<=86400)res.setHeader('Retry-After',String(e.retryAfter));else if(status===429)res.setHeader('Retry-After','60');if(req.zoigramCloseConnection){res.shouldKeepAlive=false;res.setHeader('Connection','close');}}if(!res.headersSent){const key=status===500?'Ошибка сервера. Попробуйте позже.':e.message;const error=I18n.t(language,key);if(u.pathname.startsWith('/api/'))send(res,status,{error,messageKey:key,...(new Set(['pin_limit','rate_limit','daily_posts_limit','upload_slots_full','upload_service_full','upload_expired','upload_changed','upload_has_photos','upload_in_progress','media_expired','media_invalid','media_session_ended']).has(e.code)?{code:e.code}:{}),...(Number.isInteger(e.retryAfter)&&e.retryAfter>0&&e.retryAfter<=86400?{retryAfter:e.retryAfter}:{}),...(['upload_start','upload_part','upload_complete','upload_cancel','upload_status'].includes(e.stage)?{stage:e.stage}:{}),...(errorId?{errorId}:{})});else send(res,status,page('Zoigram','<p>'+escape(error)+'</p>',language),'text/html')}else res.end()}
 }
 const server=http.createServer(handler);server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
 let closing;
 return {server,db,close:()=>closing||(closing=new Promise(resolve=>{clearInterval(cleaner);server.close(()=>{if(!options.db)db.close();resolve()});server.closeIdleConnections()})),origin};
}
module.exports={createApp,Problem,MAX_IMAGE};
