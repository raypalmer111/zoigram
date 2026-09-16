'use strict';
const {transaction}=require('./store.cjs'),{setPublicId}=require('./moderation.cjs'),Metadata=require('./social-metadata.cjs');
class AdminError extends Error{constructor(status,message){super(message);this.status=status}}
const fail=(status,message)=>{throw new AdminError(status,message)};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function numeric(value){const s=String(value);if(!/^[1-9]\d{0,14}$/.test(s))fail(400,'Неверный номер записи.');return Number(s)}
function reasonText(value){if(typeof value!=='string'||!value.trim()||[...value].length>1000||/[\x00-\x1f\x7f]/.test(value))fail(400,'Укажите причину: от 1 до 1000 символов в одной строке.');return value.trim()}
function audit(db,action,target,reason,actorId,details){db.prepare('INSERT INTO moderation(action,target_id,reason,created_at) VALUES(?,?,?,?)').run(action,String(target),JSON.stringify({reason,actorId,details}),Date.now())}
function act(db,input,actor,ownerSteamId){
 const {action}=input,target=String(input.targetId||''),reason=reasonText(input.reason);
 if(!['set-id','set-verified','set-like-bonus','ban','unban','delete-post','delete-comment','resolve','reopen'].includes(action))fail(400,'Неизвестное действие модерации.');
 if(['set-id','set-verified','ban','unban'].includes(action)&&!uuid(target))fail(400,'Неверный UUID аккаунта.');
 if(action==='set-id'){
  if(typeof input.expectedPublicId!=='string')fail(400,'Откройте актуальный профиль перед сменой ID.');
  try{return setPublicId(db,target,input.publicId,reason,{actorId:actor.id,expectedPublicId:input.expectedPublicId})}catch(e){if(e.status)throw e;fail(400,e.message)}
 }
 return transaction(db,()=>{
  let details,changed=true;
  if(action==='set-verified'||action==='set-like-bonus'){
   if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(400,'Откройте актуальную запись перед изменением.');
   if(action==='set-verified'){
    if(typeof input.verified!=='boolean')fail(400,'Укажите статус верификации.');
    const p=db.prepare('SELECT username FROM profiles WHERE id=?').get(target);if(!p)fail(404,'Игрок не найден.');
    const previous=Metadata.verification(db,target);if(previous.verificationRevision!==input.expectedRevision)fail(409,'Верификация уже изменилась. Обновите профиль.');
    changed=previous.verified!==input.verified;details={publicId:p.username,previous:previous.verified,verified:input.verified};
    if(changed)db.prepare('INSERT INTO profile_verifications VALUES(?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET verified=excluded.verified,revision=excluded.revision,updated_at=excluded.updated_at').run(target,input.verified?1:0,previous.verificationRevision+1,Date.now());
   }else{
    const id=numeric(target);if(!Number.isSafeInteger(input.bonusLikes)||input.bonusLikes<0||input.bonusLikes>1000000)fail(400,'Количество добавленных лайков: целое число от 0 до 1000000.');
    if(!db.prepare('SELECT 1 FROM posts WHERE id=?').get(id))fail(404,'Публикация уже удалена.');
    const previous=Metadata.likeBonus(db,id);if(previous.likeBonusRevision!==input.expectedRevision)fail(409,'Количество лайков уже изменилось. Откройте публикацию заново.');
    changed=previous.bonusLikes!==input.bonusLikes;details={previous:previous.bonusLikes,bonusLikes:input.bonusLikes,delta:input.bonusLikes-previous.bonusLikes};
    if(changed)db.prepare('INSERT INTO post_like_bonuses VALUES(?,?,?,?) ON CONFLICT(post_id) DO UPDATE SET amount=excluded.amount,revision=excluded.revision,updated_at=excluded.updated_at').run(id,input.bonusLikes,previous.likeBonusRevision+1,Date.now());
   }
  }else if(action==='ban'||action==='unban'){
   const p=db.prepare('SELECT * FROM profiles WHERE id=?').get(target);if(!p)fail(404,'Игрок не найден.');
   if(action==='ban'&&(p.id===actor.id||(p.provider==='steam'&&p.subject===ownerSteamId)))fail(403,'Нельзя заблокировать владельца панели.');
   const banned=action==='ban'?1:0;changed=p.banned!==banned;details={publicId:p.username,name:p.display_name};
   if(changed)db.prepare('UPDATE profiles SET banned=? WHERE id=?').run(banned,target);if(banned){db.prepare('DELETE FROM sessions WHERE profile_id=?').run(target);db.prepare('DELETE FROM admin_sessions WHERE profile_id=?').run(target);db.prepare('DELETE FROM devices WHERE profile_id=?').run(target)}
  }else if(action==='delete-post'||action==='delete-comment'){
   const id=numeric(target),post=action==='delete-post';
   const row=post?db.prepare('SELECT p.id,p.profile_id,p.caption,p.bytes,a.username FROM posts p JOIN profiles a ON a.id=p.profile_id WHERE p.id=?').get(id):db.prepare('SELECT c.id,c.post_id,c.profile_id,c.text,a.username FROM comments c JOIN profiles a ON a.id=c.profile_id WHERE c.id=?').get(id);
   if(!row)fail(404,'Запись уже удалена или не найдена.');details={...row};
   if(input.reportId!==undefined){const rid=numeric(input.reportId),report=db.prepare('SELECT * FROM reports WHERE id=?').get(rid);if(!report||report.kind!==(post?'post':'comment')||report.target_id!==target)fail(409,'Жалоба не относится к выбранной записи.');db.prepare('UPDATE reports SET resolved=1 WHERE id=?').run(rid);details.reportId=rid}
   db.prepare(post?'DELETE FROM posts WHERE id=?':'DELETE FROM comments WHERE id=?').run(id);
  }else{
   const id=numeric(target),r=db.prepare('SELECT * FROM reports WHERE id=?').get(id);if(!r)fail(404,'Жалоба не найдена.');const resolved=action==='resolve'?1:0;changed=r.resolved!==resolved;details={kind:r.kind,targetId:r.target_id};if(changed)db.prepare('UPDATE reports SET resolved=? WHERE id=?').run(resolved,id);
  }
  if(changed)audit(db,action,target,reason,actor.id,details);return {ok:true,changed};
 });
}
module.exports={act,AdminError,fail,numeric,uuid};
