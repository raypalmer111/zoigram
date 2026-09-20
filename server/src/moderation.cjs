'use strict';
const {transaction}=require('./store.cjs');
const {normalizePublicId,resolvePublicId,overridePublicId}=require('./public-ids.cjs');

// Shared by the server CLI and the authenticated owner-only HTTP controller.
function setPublicId(db,selector,newId,reason,options={}){
 if(typeof selector!=='string'||!selector.trim())throw Error('Укажите UUID или @ID аккаунта.');
 const username=typeof newId==='string'?normalizePublicId(newId,Infinity):'';
 if(!username||Array.from(username).length>24)throw Error('ID: 1–24 буквы, цифры или _.');
 if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('Укажите причину смены ID (до 1000 символов).');
 selector=selector.trim();
 return transaction(db,()=>{
  const p=selector.startsWith('@')?resolvePublicId(db,selector.slice(1)):db.prepare('SELECT id,username FROM profiles WHERE id=?').get(selector);
  if(!p)throw Error('Аккаунт не найден. Используйте UUID или @ID.');
  if(options.expectedPublicId!==undefined&&p.username!==options.expectedPublicId){const error=Error('ID уже изменился. Обновите профиль и повторите действие.');error.status=409;throw error}
  if(p.username===username)return {id:p.id,previousId:p.username,publicId:username,changed:false};
  try{overridePublicId(db,p.id,username)}catch(e){if(e.message.includes('UNIQUE'))throw Error('Этот ID уже занят.');throw e}
  db.prepare('INSERT INTO moderation(action,target_id,reason,created_at) VALUES(?,?,?,?)').run('set-id',p.id,JSON.stringify({reason:reason.trim(),previousId:p.username,publicId:username,...(options.actorId?{actorId:options.actorId}:{})}),Date.now());
  return {id:p.id,previousId:p.username,publicId:username,changed:true};
 });
}
module.exports={setPublicId};
