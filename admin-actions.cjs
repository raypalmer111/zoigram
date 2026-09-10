'use strict';
const {transaction}=require('./store.cjs'),{setPublicId}=require('./moderation.cjs');
class AdminError extends Error{constructor(status,message){super(message);this.status=status}}
const fail=(status,message)=>{throw new AdminError(status,message)};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function numeric(value){const s=String(value);if(!/^[1-9]\d{0,14}$/.test(s))fail(400,'Неверный номер записи.');return Number(s)}
function reasonText(value){if(typeof value!=='string'||!value.trim()||[...value].length>1000||/[\x00-\x1f\x7f]/.test(value))fail(400,'Укажите причину: от 1 до 1000 символов в одной строке.');return value.trim()}
function audit(db,action,target,reason,actorId,details){db.prepare('INSERT INTO moderation(action,target_id,reason,created_at) VALUES(?,?,?,?)').run(action,String(target),JSON.stringify({reason,actorId,details}),Date.now())}
function act(db,input,actor,ownerSteamId){
 const {action}=input,target=String(input.targetId||''),reason=reasonText(input.reason);
 if(!['set-id','ban','unban','delete-post','delete-comment','resolve','reopen'].includes(action))fail(400,'Неизвестное действие модерации.');
 if(['set-id','ban','unban'].includes(action)&&!uuid(target))fail(400,'Неверный UUID аккаунта.');
 if(action==='set-id'){
  if(typeof input.expectedPublicId!=='string')fail(400,'Откройте актуальный профиль перед сменой ID.');
  try{return setPublicId(db,target,input.publicId,reason,{actorId:actor.id,expectedPublicId:input.expectedPublicId})}catch(e){if(e.status)throw e;fail(400,e.message)}
 }
 return transaction(db,()=>{
  let details,changed=true;
  if(action==='ban'||action==='unban'){
   const p=db.prepare('SELECT * FROM profiles WHERE id=?').get(target);if(!p)fail(404,'Игрок не найден.');
   if(action==='ban'&&(p.id===actor.id||(p.provider==='steam'&&p.subject===ownerSteamId)))fail(403,'Нельзя заблокировать владельца панели.');
   const banned=action==='ban'?1:0;changed=p.banned!==banned;details={publicId:p.username,name:p.display_name};
   if(changed){db.prepare('UPDATE profiles SET banned=? WHERE id=?').run(banned,target);if(banned){db.prepare('DELETE FROM sessions WHERE profile_id=?').run(target);db.prepare('DELETE FROM admin_sessions WHERE profile_id=?').run(target)}}
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
