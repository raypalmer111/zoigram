'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {hash,random,transaction}=require('./store.cjs'),{act,fail,numeric,uuid}=require('./admin-actions.cjs');
const Metadata=require('./social-metadata.cjs');
const HOURS=4*3600000,PAGE=24;
function createAdmin({db,origin,secret,ownerSteamId='',ownerProfileId='',accounts,storageBytes,send,json,limit,onError,zoimeetMonitor,operations,announcements}){
 if(ownerSteamId&&!/^\d{17}$/.test(ownerSteamId))throw Error('OWNER_STEAM_ID must be one SteamID64');
 if(ownerProfileId&&!uuid(ownerProfileId))throw Error('OWNER_PROFILE_ID must be one profile UUID');
 const monitor=zoimeetMonitor||require('./zoimeet-monitor.cjs').createMonitor();
 const ownerId=()=>ownerProfileId||(ownerSteamId?db.prepare("SELECT id FROM profiles WHERE provider='steam' AND subject=?").get(ownerSteamId)?.id:null);
 const secure=new URL(origin).protocol==='https:',sessionName=secure?'__Host-zoigram_admin':'zg_admin';
 const cookie=(name,value,seconds)=>name+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+seconds+(secure?'; Secure':'');
 const readCookie=(req,name)=>{const match=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));return match.length===1&&/^[A-Za-z0-9_-]{43}$/.test(match[0].slice(name.length+1))?match[0].slice(name.length+1):null};
 const csrf=s=>crypto.createHmac('sha256',secret).update('zoigram-admin-csrf\0'+s.id).digest('base64url');
 function sameOrigin(req){if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')fail(403,'Запрос разрешён только со страницы панели.');}
 function authorize(req){
  const token=readCookie(req,sessionName);if(!token||!ownerId())return null;
  return db.prepare("SELECT s.id,s.profile_id,s.expires_at,p.username,p.display_name FROM admin_sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.token_hash=? AND s.expires_at>? AND p.id=? AND p.banned=0").get(hash(token),Date.now(),ownerId())||null;
 }
 function protect(req,s){sameOrigin(req);const value=req.headers['x-csrf-token'];if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||!crypto.timingSafeEqual(Buffer.from(value),Buffer.from(csrf(s))))fail(403,'Сеанс страницы устарел. Обновите панель и повторите действие.');}
 const summary=()=>({profiles:db.prepare('SELECT COUNT(*) n FROM profiles').get().n,posts:db.prepare('SELECT COUNT(*) n FROM posts').get().n,comments:db.prepare('SELECT COUNT(*) n FROM comments').get().n,reports:db.prepare('SELECT COUNT(*) n FROM reports WHERE resolved=0').get().n,banned:db.prepare('SELECT COUNT(*) n FROM profiles WHERE banned=1').get().n,bytes:db.prepare('SELECT (SELECT COALESCE(SUM(bytes),0) FROM posts)+(SELECT COALESCE(SUM(bytes),0) FROM avatars) n').get().n,storageBytes,newPosts:db.prepare('SELECT COUNT(*) n FROM posts WHERE created_at>?').get(Date.now()-86400000).n});
 const person=p=>p?{...Metadata.verification(db,p.id),id:p.id,username:p.username,displayName:p.display_name,bio:p.bio||'',banned:!!p.banned,createdAt:p.created_at,isOwner:p.id===ownerId()}:null;
 function profile(id){const p=db.prepare('SELECT * FROM profiles WHERE id=?').get(id);return p?{...person(p),posts:db.prepare('SELECT COUNT(*) n FROM posts WHERE profile_id=?').get(id).n,comments:db.prepare('SELECT COUNT(*) n FROM comments WHERE profile_id=?').get(id).n}:null}
 function post(p){const photos=[{position:0,width:p.width,height:p.height},...db.prepare('SELECT position,width,height FROM post_photos WHERE post_id=? ORDER BY position').all(p.id)].map(x=>({index:x.position,width:x.width,height:x.height,imageUrl:'/admin/api/media/'+p.id+'?photo='+x.position}));return {...p,photos,author:profile(p.profile_id),thumbnailUrl:'/admin/api/media/'+p.id+'?size=thumb',imageUrl:'/admin/api/media/'+p.id,...Metadata.likeCounts(db,p.id),comments:db.prepare('SELECT COUNT(*) n FROM comments WHERE post_id=?').get(p.id).n}}
 function comment(c){return {...c,author:profile(c.profile_id),postExists:!!db.prepare('SELECT 1 FROM posts WHERE id=?').get(c.post_id)}}
 const selectPost='SELECT id,profile_id,caption,created_at,width,height,bytes FROM posts';
 function target(kind,id){if(kind==='profile')return profile(id);if(!/^\d+$/.test(id))return null;if(kind==='post'){const p=db.prepare(selectPost+' WHERE id=?').get(Number(id));return p?post(p):null}const c=db.prepare('SELECT * FROM comments WHERE id=?').get(Number(id));return c?comment(c):null}
 const list=(rows,map=x=>x)=>({items:rows.slice(0,PAGE).map(map),nextCursor:rows.length>PAGE?String(rows[PAGE-1].id):null});
 const before=u=>u.searchParams.has('before')?numeric(u.searchParams.get('before')):Number.MAX_SAFE_INTEGER;
 const query=u=>{const q=(u.searchParams.get('q')||'').trim();if([...q].length>100)fail(400,'Поиск: не более 100 символов.');return q};
 const errorPage=message=>'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/admin/app.css"><title>Zoigram · Модерация</title><main class="auth-shell"><section class="auth-card"><div class="brand-mark">Z</div><h1>Не удалось войти</h1><p>'+String(message).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))+'</p><a class="primary button" href="/admin/">Вернуться в панель</a></section></main></html>';
 const assets=new Map([['/admin/',['index.html','text/html']],['/admin/zoimeet.js',['zoimeet.js','application/javascript']],['/admin/operations.js',['operations.js','application/javascript']],['/admin/app.js',['app.js','application/javascript']],['/admin/app.css',['app.css','text/css']]].map(([url,[name,type]])=>[url,{type,body:fs.readFileSync(path.join(__dirname,'../admin',name),'utf8')} ]));
 async function handle(req,res,u,ip){
  if(u.pathname!=='/admin'&&!u.pathname.startsWith('/admin/'))return false;
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Content-Language','ru');res.setHeader('Cache-Control','no-store');
  try{
   limit('admin-ip:'+ip,180);const p=u.pathname,m=req.method;
   if(req.headers['sec-fetch-site']==='cross-site'&&p.startsWith('/admin/api/'))fail(403,'Откройте панель на её основном адресе.');
   if(m==='GET'&&p==='/admin'){res.writeHead(303,{Location:'/admin/'});res.end();return true}
   if(m==='GET'&&assets.has(p)){const a=assets.get(p);send(res,200,a.body,a.type);return true}
   if(m==='GET'&&p==='/admin/api/session'){
    const s=authorize(req);send(res,200,s?{authenticated:true,csrfToken:csrf(s),expiresAt:s.expires_at,owner:{id:s.profile_id,username:s.username,displayName:s.display_name}}:{authenticated:false,enabled:!!(ownerProfileId||ownerSteamId)});return true;
   }
   if(m==='POST'&&p==='/admin/auth/password'){
    if(!ownerId())fail(503,'Панель владельца ещё не настроена.');sameOrigin(req);limit('admin-login:'+ip,6,600000);
    const b=await json(req,4096),c=await accounts.authenticate(b.login,b.password,ip);
    if(c.profile_id!==ownerId())fail(403,'Эта панель доступна только владельцу Zoigram.');
    const current=accounts.credentials(c.profile_id);if(!current||current.password_hash!==c.password_hash)fail(401,'Войдите в аккаунт владельца Zoigram.');
    const token=random(),expiresAt=Date.now()+HOURS;db.prepare('INSERT INTO admin_sessions(id,token_hash,profile_id,expires_at) VALUES(?,?,?,?)').run(crypto.randomUUID(),hash(token),c.profile_id,expiresAt);
    res.setHeader('Set-Cookie',cookie(sessionName,token,HOURS/1000));send(res,200,{ok:true});return true;
   }
   const s=authorize(req);if(!s)fail(401,'Войдите в аккаунт владельца Zoigram.');
   if(m==='POST')protect(req,s);else if(m!=='GET')fail(405,'Метод не поддерживается.');
   if(m==='POST'&&p==='/admin/api/logout'){db.prepare('DELETE FROM admin_sessions WHERE id=?').run(s.id);res.setHeader('Set-Cookie',cookie(sessionName,'',0));send(res,200,{ok:true});return true}
   if(m==='POST'&&p==='/admin/api/actions'){limit('admin-action:'+s.profile_id,30);const body=await json(req,8192);send(res,200,act(db,body,{id:s.profile_id},ownerSteamId));return true}
   if(m==='GET'&&p==='/admin/api/zoimeet'){send(res,200,await monitor(u.searchParams));return true;}
   if(m==='GET'&&p==='/admin/api/operations'){send(res,200,operations.snapshot());return true}
   if(m==='GET'&&p==='/admin/api/errors'){send(res,200,operations.list(u.searchParams));return true}
   if(m==='GET'&&p==='/admin/api/announcements'){send(res,200,announcements.list());return true}
   if(m==='POST'&&p==='/admin/api/announcements'){limit('announcement:'+s.profile_id,20);send(res,200,announcements.save(await json(req,12288),s.profile_id));return true}
   if(m==='GET'&&p==='/admin/api/summary'){send(res,200,summary());return true}
   const media=p.match(/^\/admin\/api\/media\/(\d+)$/);if(m==='GET'&&media){const id=numeric(media[1]),index=u.searchParams.get('photo')||'0';if(!/^[0-4]$/.test(index))fail(404,'Фото уже удалено.');const column=u.searchParams.get('size')==='thumb'?'thumbnail':'image',photo=index==='0'?db.prepare('SELECT '+column+' image FROM posts WHERE id=?').get(id):db.prepare('SELECT '+column+' image FROM post_photos WHERE post_id=? AND position=?').get(id,Number(index));if(!photo)fail(404,'Фото уже удалено.');res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':photo.image.length});res.end(Buffer.from(photo.image));return true}
   if(m==='GET'&&p==='/admin/api/profiles'){
    const q=query(u).replace(/^@/,''),status=u.searchParams.get('status')||'all';if(!['all','active','banned'].includes(status))fail(400,'Неизвестный фильтр игроков.');
    let stamp=Number.MAX_SAFE_INTEGER,id='~';if(u.searchParams.has('before')){try{[stamp,id]=JSON.parse(Buffer.from(u.searchParams.get('before'),'base64url').toString());if(!Number.isSafeInteger(stamp)||stamp<0||!uuid(id))throw Error()}catch{fail(400,'Неверная страница игроков.')}}
    const rows=db.prepare("SELECT * FROM profiles WHERE (created_at<? OR (created_at=? AND id<?)) AND (?='all' OR banned=?) AND (?='' OR instr(lower(username),lower(?))>0 OR instr(lower(display_name),lower(?))>0 OR id=?) ORDER BY created_at DESC,id DESC LIMIT ?").all(stamp,stamp,id,status,status==='banned'?1:0,q,q,q,q,PAGE+1);
    send(res,200,{items:rows.slice(0,PAGE).map(p=>profile(p.id)),nextCursor:rows.length>PAGE?Buffer.from(JSON.stringify([rows[PAGE-1].created_at,rows[PAGE-1].id])).toString('base64url'):null});return true;
   }
   const user=p.match(/^\/admin\/api\/profiles\/([a-f0-9-]{36})$/);if(m==='GET'&&user){const value=profile(user[1]);if(!value)fail(404,'Игрок не найден.');send(res,200,value);return true}
   if(m==='GET'&&p==='/admin/api/posts'){
    const q=query(u),author=u.searchParams.get('profile')||'';if(author&&!uuid(author))fail(400,'Неверный профиль.');const rows=db.prepare(selectPost+" WHERE id<? AND (?='' OR profile_id=?) AND (?='' OR instr(lower(caption),lower(?))>0 OR CAST(id AS TEXT)=?) ORDER BY id DESC LIMIT ?").all(before(u),author,author,q,q,q,PAGE+1);send(res,200,list(rows,post));return true;
   }
   const singlePost=p.match(/^\/admin\/api\/posts\/(\d+)$/);if(m==='GET'&&singlePost){const value=target('post',singlePost[1]);if(!value)fail(404,'Публикация уже удалена.');send(res,200,value);return true}
   if(m==='GET'&&p==='/admin/api/comments'){
    const q=query(u),postId=u.searchParams.get('post')?numeric(u.searchParams.get('post')):0;const rows=db.prepare("SELECT * FROM comments WHERE id<? AND (?=0 OR post_id=?) AND (?='' OR instr(lower(text),lower(?))>0 OR CAST(id AS TEXT)=?) ORDER BY id DESC LIMIT ?").all(before(u),postId,postId,q,q,q,PAGE+1);send(res,200,list(rows,comment));return true;
   }
   if(m==='GET'&&p==='/admin/api/reports'){
    const status=u.searchParams.get('status')||'open';if(!['open','closed','all'].includes(status))fail(400,'Неизвестный фильтр жалоб.');const rows=db.prepare("SELECT * FROM reports WHERE id<? AND (?='all' OR resolved=?) ORDER BY id DESC LIMIT ?").all(before(u),status,status==='closed'?1:0,PAGE+1);send(res,200,list(rows,r=>({...r,reporter:profile(r.profile_id),target:target(r.kind,r.target_id)})));return true;
   }
   if(m==='GET'&&p==='/admin/api/audit'){
    const rows=db.prepare('SELECT * FROM moderation WHERE id<? ORDER BY id DESC LIMIT ?').all(before(u),PAGE+1);send(res,200,list(rows,r=>{let details;try{details=JSON.parse(r.reason)}catch{}return {...r,reason:details?.reason||r.reason,details:details||{},actor:details?.actorId?profile(details.actorId):null}}));return true;
   }
   fail(404,'Страница панели не найдена.');
  }catch(e){if(!e.status&&onError)onError(e);const status=e.status||500,message=e.status?e.message:'Ошибка панели. Попробуйте позже.';if(status===429)res.setHeader('Retry-After','60');if(!res.headersSent)send(res,status,u.pathname.startsWith('/admin/api/')||req.method==='POST'?{error:message}:errorPage(message),u.pathname.startsWith('/admin/api/')||req.method==='POST'?'application/json':'text/html');else res.end();}
  return true;
 }
 return {handle};
}
module.exports={createAdmin};
