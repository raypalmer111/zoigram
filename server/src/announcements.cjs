'use strict';
const {transaction}=require('./store.cjs');
function createAnnouncements({db,fail,clock=Date.now}){
 function dto(r){return {id:r.id,title:r.title,body:r.body,kind:r.kind,startsAt:r.starts_at,endsAt:r.ends_at,active:!!r.active,revision:r.revision,updatedAt:r.updated_at};}
 function live(){return db.prepare('SELECT * FROM announcements WHERE active=1 AND starts_at<=? AND (ends_at IS NULL OR ends_at>?) ORDER BY updated_at DESC,id DESC LIMIT 3').all(clock(),clock()).map(dto);}
 function list(){return {items:db.prepare('SELECT * FROM announcements ORDER BY updated_at DESC,id DESC LIMIT 100').all().map(dto)};}
 function save(b,actor){
  const text=(v,max)=>{if(typeof v!=='string'||![...v.trim()].length||[...v].length>max||/[\x00-\x1f\x7f]/.test(v.replace(/\r?\n/g,'')))fail(400,'Проверьте текст и его длину.');return v.trim();};
  const title=text(b.title,80),body=text(b.body,1200),kind=b.kind,active=b.active;
  if(!['info','update','maintenance'].includes(kind)||typeof active!=='boolean')fail(400,'Проверьте параметры объявления.');
  const start=b.startsAt??clock(),end=b.endsAt??null;if(!Number.isSafeInteger(start)||start<0||end!==null&&(!Number.isSafeInteger(end)||end<=start))fail(400,'Проверьте даты объявления.');
  return transaction(db,()=>{
   let id=b.id;
   if(id!==undefined){if(!Number.isSafeInteger(id)||id<1)fail(400,'Проверьте параметры объявления.');const old=db.prepare('SELECT * FROM announcements WHERE id=?').get(id);if(!old)fail(404,'Объявление не найдено.');if(old.revision!==b.expectedRevision)fail(409,'Объявление изменено. Обновите страницу.');db.prepare('UPDATE announcements SET title=?,body=?,kind=?,active=?,starts_at=?,ends_at=?,revision=revision+1,updated_at=? WHERE id=?').run(title,body,kind,active?1:0,start,end,clock(),id);}
   else{if(db.prepare('SELECT COUNT(*) n FROM announcements').get().n>=100)fail(409,'Измените существующее объявление: достигнут лимит 100 записей.');id=Number(db.prepare('INSERT INTO announcements(title,body,kind,active,starts_at,ends_at,revision,updated_at) VALUES(?,?,?,?,?,?,1,?)').run(title,body,kind,active?1:0,start,end,clock()).lastInsertRowid);}
   db.prepare('INSERT INTO moderation(action,target_id,reason,created_at) VALUES(?,?,?,?)').run('announcement',String(id),JSON.stringify({actorId:actor,reason:active?'Публикация объявления':'Объявление скрыто',details:{title,kind,active}}),clock());return dto(db.prepare('SELECT * FROM announcements WHERE id=?').get(id));
  });
 }
 return {live,list,save};
}
module.exports={createAnnouncements};
