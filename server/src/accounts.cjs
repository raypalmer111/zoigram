'use strict';
const crypto=require('node:crypto');
const {hash,random,identity,transaction}=require('./store.cjs');
const Passwords=require('./passwords.cjs'),I18n=require('./i18n.cjs');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TTL=600000;
function createAccounts({db,origin,secret,fail,limit,json,send,authorize}){
 const secure=origin.startsWith('https:'),cookieName=secure?'__Host-zoigram_account':'zg_account';
 const cookie=token=>cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=600'+(secure?'; Secure':'');
 const csrf=token=>crypto.createHmac('sha256',secret).update('account-csrf:'+token).digest('base64url');
 const readCookie=req=>{const values=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));const token=values.length===1?values[0].slice(cookieName.length+1):'';return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null};
 const normalize=login=>typeof login==='string'?login.trim().toLowerCase():'';
 const recovery=()=>crypto.randomBytes(20).toString('hex').match(/.{5}/g).join('-');
 const recoveryHash=value=>hash(typeof value==='string'?value.replace(/[\s-]/g,'').toLowerCase():'');
 const credentials=id=>db.prepare('SELECT * FROM account_credentials WHERE profile_id=?').get(id);
 function sameOrigin(req){if(req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')fail(403,'Откройте форму на сайте Zoigram.');}
 function password(value){if(!Passwords.validPassword(value))fail(400,'Пароль: от 15 до 128 символов. Можно использовать фразу.');return value}
 function checkLogin(value){const login=normalize(value);if(!/^[a-z0-9_]{3,32}$/.test(login))fail(400,'Логин: 3–32 латинские буквы, цифры или знак _.');return login}
 function clean(){for(const table of ['account_links','account_flows'])db.prepare('DELETE FROM '+table+' WHERE expires_at<?').run(Date.now());}
 function currentFlow(token){
  const f=token&&db.prepare('SELECT * FROM account_flows WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
  if(!f)fail(410,'Страница входа устарела. Откройте её заново из игры.');
  if(f.kind==='device'){
   const d=db.prepare('SELECT * FROM devices WHERE secret_hash=? AND expires_at>? AND consumed=0 AND profile_id IS NULL').get(f.device_hash,Date.now());
   if(!d)fail(410,'Страница входа устарела. Откройте её заново из игры.');return {...f,code:d.user_code};
  }
  const s=db.prepare('SELECT s.*,p.banned FROM sessions s JOIN profiles p ON p.id=s.profile_id WHERE s.id=? AND s.expires_at>? AND p.banned=0').get(f.session_id,Date.now());
  if(!s)fail(410,'Страница входа устарела. Откройте её заново из игры.');return {...f,profileId:s.profile_id};
 }
 async function authenticate(login,password,ip){
  login=normalize(login);limit('password-ip:'+ip,12,600000);limit('password-login:'+hash(login),20,600000);
  const row=db.prepare('SELECT c.*,p.banned FROM account_credentials c JOIN profiles p ON p.id=c.profile_id WHERE c.login=?').get(login);
  const valid=await Passwords.verify(password,row?.password_hash);
  if(!valid||!row||row.banned)fail(401,'Неверный логин или пароль.');
  const fresh=db.prepare('SELECT c.*,p.banned FROM account_credentials c JOIN profiles p ON p.id=c.profile_id WHERE c.profile_id=?').get(row.profile_id);
  if(!fresh||fresh.banned||fresh.password_hash!==row.password_hash)fail(401,'Неверный логин или пароль.');return fresh;
 }
 function finish(token,profileId){const f=currentFlow(token);if(f.kind!=='device')fail(400,'Неверное действие для этой страницы.');
  if(!db.prepare('SELECT 1 FROM profiles WHERE id=? AND banned=0').get(profileId))fail(401,'Неверный логин или пароль.');
  const changed=db.prepare('UPDATE devices SET profile_id=? WHERE secret_hash=? AND expires_at>? AND consumed=0 AND profile_id IS NULL').run(profileId,f.device_hash,Date.now()).changes;
  if(!changed)fail(410,'Страница входа устарела. Откройте её заново из игры.');db.prepare('DELETE FROM account_flows WHERE token_hash=?').run(hash(token));
 }
 function revoke(profileId,keepSession){
  db.prepare('DELETE FROM sessions WHERE profile_id=? AND id<>?').run(profileId,keepSession||'');
  db.prepare('DELETE FROM admin_sessions WHERE profile_id=?').run(profileId);
  db.prepare('DELETE FROM devices WHERE profile_id=?').run(profileId);
 }
 function page(language,content){return '<!doctype html><html lang="'+language+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zoigram</title><style>\n'+
  '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px 16px;font:15px system-ui,sans-serif;background:radial-gradient(ellipse at top left,#fff0dc,transparent 58%),radial-gradient(ellipse at bottom right,#f3dcfa,transparent 60%),#fafafa;color:#24242b}main{width:100%;max-width:440px;background:white;border:1px solid #e8e8ed;border-radius:24px;padding:32px;box-shadow:0 18px 60px #5424520d}.brand{font-size:34px;font-weight:750;letter-spacing:-1.7px;margin-bottom:22px}h1{font-size:23px;letter-spacing:-.6px;margin:0 0 12px}p,small{line-height:1.55;color:#73717b}label{display:block;margin:17px 0 7px;font-size:13px;font-weight:600}input{width:100%;padding:13px;border:1px solid #dcdce3;border-radius:10px;font:inherit;background:#fafafa;color:inherit}input:focus{outline:2px solid #bc56a4;outline-offset:2px}button{width:100%;border:0;border-radius:10px;padding:14px;font:600 15px system-ui;margin:22px 0 8px;color:white;background:linear-gradient(110deg,#ef914b,#cc447a,#8b51c8);cursor:pointer}a{color:#9b3885;text-decoration:none}.tabs{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-top:20px}.error{color:#a71b35;background:#fff0f2;border-radius:10px;padding:12px}.code{font:700 24px monospace;letter-spacing:3px;color:#a43989}.recovery{font:15px monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#faf3fc;border:1px solid #eddaef;border-radius:12px;padding:16px;user-select:all}small{display:block;font-size:12px}hr{border:0;border-top:1px solid #eee;margin:24px 0}</style></head><body><main><div class="brand">Zoigram</div>'+content+'</main></body></html>'}
 function formPage(language,f,token,mode,error=''){
  const t=key=>escape(I18n.t(language,key)),settings=f.kind==='settings',c=settings?credentials(f.profileId):null;
  if(settings)mode=c?'password':'bind';if(!['login','register','recover','password','bind'].includes(mode))mode='login';
  const titles={login:'Войти в Zoigram',register:'Создать аккаунт',recover:'Восстановить доступ',bind:'Настроить вход',password:'Изменить пароль'};
  let body='<h1>'+t(titles[mode])+'</h1>'+(settings?'<p>'+t('Ваш профиль, публикации и публичный ID сохранятся.')+'</p>':'<p>'+t('Сверьте код с кодом в игре:')+'</p><p class="code">'+escape(f.code)+'</p><small>'+t('Продолжайте, только если вы сами начали этот вход.')+'</small>');
  if(error)body+='<p class="error" role="alert">'+t(error)+'</p>';
  body+='<form method="post" action="/account/'+mode+'?lang='+language+'"><input type="hidden" name="csrf" value="'+csrf(token)+'">';
  const input=(name,label,type,autocomplete,extra='')=>'<label for="'+name+'">'+t(label)+'</label><input id="'+name+'" name="'+name+'" type="'+type+'" autocomplete="'+autocomplete+'" required '+extra+'>';
  body+=input('login','Логин','text','username',c?'readonly value="'+escape(c.login)+'"':'minlength="3" maxlength="32" pattern="[a-zA-Z0-9_]{3,32}" autocapitalize="none" spellcheck="false"');
  if(mode==='recover')body+=input('recovery','Резервный код','text','off','maxlength="80" autocapitalize="none" spellcheck="false"');
  if(mode==='password')body+=input('currentPassword','Текущий пароль','password','current-password','maxlength="128"');
  body+=input('password',mode==='login'?'Пароль':'Новый пароль','password',mode==='login'?'current-password':'new-password','minlength="15" maxlength="128"');
  if(mode!=='login')body+='<small>'+t('Пароль: от 15 до 128 символов. Можно использовать фразу.')+'</small>';
  body+='<button type="submit">'+t(mode==='login'?'Войти':mode==='register'?'Создать аккаунт':'Сохранить')+'</button></form>';
  if(!settings){body+='<nav class="tabs">';for(const m of ['login','register','recover'])if(m!==mode)body+='<a href="/connect?code='+f.code+'&amp;mode='+m+'&amp;lang='+language+'">'+t(titles[m])+'</a>';body+='</nav>'}
  body+='<hr><small>'+t('Логин нужен только для входа. Другие игроки видят ваш публичный ID.')+'</small><small>'+t('Почта и Steam не нужны. Сохраните резервный код для восстановления доступа.')+'</small>';
  return page(language,body);
 }
 function success(language,code){const t=key=>escape(I18n.t(language,key));return page(language,'<h1>'+t('Готово')+'</h1><p>'+t('Вернитесь в Zoigram в игре. Ваш профиль готов.')+'</p>'+(code?'<h2>'+t('Сохраните резервный код')+'</h2><pre class="recovery">'+escape(code)+'</pre><p>'+t('Он показывается один раз. Храните его отдельно: с ним можно восстановить доступ без почты.')+'</p>':''))}
 async function form(req){if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'Неверный формат формы.');let size=0,chunks=[];try{for await(const c of req){size+=c.length;if(size>8192)fail(413,'Слишком большой запрос.');chunks.push(c)}}catch(error){if(!req.complete&&(req.aborted||req.destroyed)&&['ECONNRESET','ERR_STREAM_PREMATURE_CLOSE'].includes(error?.code))fail(499,'Нет связи с сервером. Попробуйте ещё раз.');throw error}const params=new URLSearchParams(Buffer.concat(chunks).toString('utf8')),result={};for(const [key,value]of params){if(Object.hasOwn(result,key))fail(400,'Неверный формат формы.');result[key]=value}return result}
 async function handle(req,res,u,ip,language){
  const p=u.pathname,m=req.method;
  if(m==='POST'&&p==='/api/me/account-access'){
   const s=authorize(req);limit('account-link:'+s.id,6,600000);const token=random();db.prepare('INSERT INTO account_links VALUES(?,?,?)').run(hash(token),s.id,Date.now()+TTL);
   send(res,201,{url:origin+'/account?lang='+I18n.accountLanguage+'#'+token,expiresAt:Date.now()+TTL});return true;
  }
  if(p!=='/connect'&&p!=='/account'&&!p.startsWith('/account/'))return false;
  clean();res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
  if(m==='GET'&&p==='/account/launch.js'){send(res,200,"(async()=>{const token=location.hash.slice(1);history.replaceState(null,'',location.pathname+location.search);try{if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error();const r=await fetch('/account/ticket'+location.search,{method:'POST',headers:{Authorization:'Account '+token}});if(!r.ok)throw Error();location.replace('/account/settings'+location.search)}catch{document.getElementById('error').hidden=false}})();",'application/javascript');return true}
  if(m==='GET'&&p==='/account'){send(res,200,page(language,'<h1>'+escape(I18n.t(language,'Настройки входа'))+'</h1><p>'+escape(I18n.t(language,'Загрузка…'))+'</p><p id="error" hidden>'+escape(I18n.t(language,'Страница входа устарела. Откройте её заново из игры.'))+'</p><script src="/account/launch.js" defer></script>'),'text/html');return true}
  if(m==='POST'&&p==='/account/ticket'){
   sameOrigin(req);limit('account-ticket:'+ip,20,600000);const ticket=(req.headers.authorization||'').match(/^Account ([A-Za-z0-9_-]{43})$/)?.[1];
   const token=random();transaction(db,()=>{const link=ticket&&db.prepare('SELECT a.* FROM account_links a JOIN sessions s ON s.id=a.session_id JOIN profiles p ON p.id=s.profile_id WHERE a.token_hash=? AND a.expires_at>? AND s.expires_at>? AND p.banned=0').get(hash(ticket),Date.now(),Date.now());if(!link)fail(410,'Страница входа устарела. Откройте её заново из игры.');db.prepare('DELETE FROM account_links WHERE token_hash=?').run(hash(ticket));db.prepare('INSERT INTO account_flows VALUES(?,?,?,?,?)').run(hash(token),'settings',null,link.session_id,Date.now()+TTL)});
   res.setHeader('Set-Cookie',cookie(token));send(res,200,{ok:true});return true;
  }
  if(m==='GET'&&p==='/connect'){
   limit('connect-page:'+ip,30,600000);const code=(u.searchParams.get('code')||'').toUpperCase(),d=/^[0-9A-F]{10}$/.test(code)&&db.prepare('SELECT * FROM devices WHERE user_code=? AND expires_at>? AND consumed=0 AND profile_id IS NULL').get(code,Date.now());
   if(!d)fail(410,'Код входа истёк. Начните заново в игре.');const token=random();db.prepare('INSERT INTO account_flows VALUES(?,?,?,?,?)').run(hash(token),'device',d.secret_hash,null,Math.min(d.expires_at,Date.now()+TTL));res.setHeader('Set-Cookie',cookie(token));send(res,200,formPage(language,{kind:'device',code},token,u.searchParams.get('mode')),'text/html');return true;
  }
  const token=readCookie(req),flow=currentFlow(token);
  if(m==='GET'&&p==='/account/settings'&&flow.kind==='settings'){send(res,200,formPage(language,flow,token),'text/html');return true}
  if(m!=='POST'||!/^\/account\/(login|register|recover|bind|password)$/.test(p))fail(404,'Страница не найдена.');
  sameOrigin(req);const body=await form(req);if(typeof body.csrf!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.csrf)||!crypto.timingSafeEqual(Buffer.from(body.csrf),Buffer.from(csrf(token))))fail(403,'Страница входа устарела. Откройте её заново из игры.');
  const action=p.split('/').at(-1);if((flow.kind==='settings')!==['bind','password'].includes(action))fail(400,'Неверное действие для этой страницы.');
  try{
   let code;
   if(action==='login'){const c=await authenticate(body.login,body.password,ip);transaction(db,()=>{const fresh=credentials(c.profile_id);if(!fresh||fresh.password_hash!==c.password_hash)fail(401,'Неверный логин или пароль.');finish(token,c.profile_id)})}
   else{
    limit('account-mutate:'+ip,8,3600000);const login=checkLogin(body.login),newPassword=password(body.password);
    let c;if(action==='recover'){
     limit('recover-login:'+hash(login),5,3600000);c=db.prepare('SELECT c.*,p.banned FROM account_credentials c JOIN profiles p ON p.id=c.profile_id WHERE c.login=?').get(login);
     const supplied=recoveryHash(body.recovery),expected=c?.recovery_hash||hash('invalid-recovery');if(!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))||!c||c.banned)fail(401,'Неверный логин или резервный код.');
    }else if(flow.kind==='settings'){
     c=credentials(flow.profileId);if((action==='bind'&&c)||(action==='password'&&!c))fail(409,'Настройки входа изменились. Откройте страницу заново.');
     if(c){if(c.login!==login||!await Passwords.verify(body.currentPassword,c.password_hash))fail(401,'Неверный логин или пароль.')}
    }else{limit('register:'+ip,3,3600000)}
    const encoded=await Passwords.encode(newPassword);code=recovery();
    transaction(db,()=>{
     const freshFlow=currentFlow(token);let profileId;
     if(action==='register'){
      if(db.prepare('SELECT 1 FROM account_credentials WHERE login=?').get(login))fail(409,'Этот логин уже занят.');const p=identity(db,'local',crypto.randomUUID());profileId=p.id;
      db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?,?)').run(profileId,login,encoded,recoveryHash(code),Date.now(),Date.now());
     }else if(action==='bind'){
      profileId=freshFlow.profileId;if(credentials(profileId))fail(409,'Настройки входа изменились. Откройте страницу заново.');if(db.prepare('SELECT 1 FROM account_credentials WHERE login=?').get(login))fail(409,'Этот логин уже занят.');
      db.prepare('INSERT INTO account_credentials VALUES(?,?,?,?,?,?)').run(profileId,login,encoded,recoveryHash(code),Date.now(),Date.now());
     }else{
      profileId=c.profile_id;const fresh=credentials(profileId);if(!fresh||fresh.password_hash!==c.password_hash||fresh.recovery_hash!==c.recovery_hash)fail(409,'Настройки входа изменились. Откройте страницу заново.');
      if(!db.prepare('SELECT 1 FROM profiles WHERE id=? AND banned=0').get(profileId))fail(401,'Неверный логин или пароль.');
      db.prepare('UPDATE account_credentials SET password_hash=?,recovery_hash=?,updated_at=? WHERE profile_id=?').run(encoded,recoveryHash(code),Date.now(),profileId);
      revoke(profileId,action==='password'?freshFlow.session_id:null);
     }
     if(freshFlow.kind==='device')finish(token,profileId);else db.prepare('DELETE FROM account_flows WHERE token_hash=?').run(hash(token));
    });
   }
   send(res,200,success(language,code),'text/html');return true;
  }catch(e){if(!e.status)throw e;send(res,e.status,formPage(language,flow,token,action,e.message),'text/html');return true}
 }
 return {handle,authenticate,credentials,clean};
}
module.exports={createAccounts};
