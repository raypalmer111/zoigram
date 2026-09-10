'use strict';
const {hash,random,transaction,identity}=require('./store.cjs');
const {ENDPOINT,AuthError,parameters,loginUrl,verifySteam}=require('./steam-verifier.cjs');
function beginLogin(db,origin,code){
 const device=db.prepare('SELECT * FROM devices WHERE user_code=? AND expires_at>? AND consumed=0 AND profile_id IS NULL').get(code,Date.now());
 if(!device)throw new AuthError('Код входа истёк. Начните вход заново в игре.');
 const state=random(),cookie=random(),returnTo=origin+'/auth/steam/callback?state='+state;
 db.prepare('INSERT INTO logins VALUES(?,?,?,?)').run(hash(state),device.secret_hash,hash(cookie),Date.now()+600000);
 return {url:loginUrl(origin,returnTo),cookie};
}
async function finishLogin(db,origin,params,cookie,fetcher=fetch){
 const values=parameters(params),state=values.state||'',login=db.prepare('SELECT * FROM logins WHERE state_hash=? AND expires_at>?').get(hash(state),Date.now());
 if(!login||!cookie||hash(cookie)!==login.cookie_hash)throw new AuthError('Сеанс входа истёк или открыт в другом браузере.');
 const {subject,nonce}=await verifySteam(db,values,origin+'/auth/steam/callback?state='+state,fetcher);
 return transaction(db,()=>{
  const pending=db.prepare('SELECT * FROM devices WHERE secret_hash=? AND expires_at>? AND consumed=0 AND profile_id IS NULL').get(login.device_hash,Date.now());
  if(!pending||!db.prepare('SELECT 1 FROM logins WHERE state_hash=?').get(hash(state)))throw new AuthError('Этот код входа уже использован.');
  db.prepare('INSERT INTO nonces VALUES(?,?)').run(nonce,Date.now()+600000);
  const profile=identity(db,'steam',subject);if(profile.banned)throw new AuthError('Аккаунт заблокирован.');
  db.prepare('UPDATE devices SET profile_id=? WHERE secret_hash=?').run(profile.id,login.device_hash);
  db.prepare('DELETE FROM logins WHERE device_hash=?').run(login.device_hash);
  return profile.id;
 });
}
module.exports={beginLogin,finishLogin,AuthError,ENDPOINT};
