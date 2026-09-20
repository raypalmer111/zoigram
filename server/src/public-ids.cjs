'use strict';

const MAX_LENGTH=24;
const codepoints=value=>Array.from(value);
const key=value=>String(value??'').normalize('NFKC').toLowerCase().normalize('NFC');

// Combining marks belong to the letter before them (including scripts whose
// vowels use marks); punctuation, emoji and isolated marks are not identifiers.
function normalizePublicId(value,maxLength=MAX_LENGTH){
 return codepoints(key(value).replace(/\s+/gu,'_').replace(/[^\p{L}\p{M}\p{N}_]/gu,'').replace(/(^|_)\p{M}+/gu,'$1').replace(/_+/g,'_').replace(/^_+|_+$/g,'')).slice(0,maxLength).join('').replace(/_+$/g,'');
}
function aliasTable(db){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_id_aliases'").get())}
function resolvePublicId(db,value){
 const username=key(String(value??'').replace(/^@/,''));
 if(!username||codepoints(username).length>MAX_LENGTH||!/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u.test(username))return null;
 // Reserved aliases take precedence. A manually inserted legacy fixture may
 // have no alias yet, so current public IDs remain a supported fallback.
 if(aliasTable(db)){const profile=db.prepare('SELECT p.* FROM public_id_aliases a JOIN profiles p ON p.id=a.profile_id WHERE a.username=?').get(username);if(profile)return profile}
 return db.prepare('SELECT * FROM profiles WHERE username=? COLLATE NOCASE').get(username)||null;
}
function atomic(db,fn){if(db.isTransaction)return fn();db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error}}
function reservePublicId(db,value,profileId){
 const username=key(value),owner=db.prepare('SELECT profile_id FROM public_id_aliases WHERE username=?').get(username);
 if(owner&&owner.profile_id!==profileId){const error=Error('Этот ID уже занят.');error.code='public_id_taken';throw error}
 db.prepare('INSERT OR IGNORE INTO public_id_aliases(username,profile_id) VALUES(?,?)').run(username,profileId);
}
function available(db,username,profileId){
 const reserved=db.prepare('SELECT profile_id FROM public_id_aliases WHERE username=?').get(username);
 if(reserved&&reserved.profile_id!==profileId)return false;
 return !db.prepare('SELECT 1 FROM profiles WHERE username=? COLLATE NOCASE AND id<>?').get(username,profileId);
}
function fallbackName(profileId){return 'player_'+String(profileId).replace(/[^a-z0-9]/gi,'').toLowerCase().slice(0,12)}
function uniquePublicId(db,profileId,displayName){
 const base=normalizePublicId(displayName)||fallbackName(profileId);
 if(available(db,base,profileId))return base;
 for(let number=2;Number.isSafeInteger(number);number++){
  const suffix='_'+number,prefix=codepoints(base).slice(0,MAX_LENGTH-suffix.length).join('').replace(/_+$/g,'');
  const candidate=prefix+suffix;if(available(db,candidate,profileId))return candidate;
 }
 throw Error('Не удалось подобрать свободный ID.');
}
function assignPublicId(db,profile,username){
 reservePublicId(db,profile.username,profile.id);
 if(!available(db,username,profile.id)){const error=Error('Этот ID уже занят.');error.code='public_id_taken';throw error}
 reservePublicId(db,username,profile.id);
 db.prepare('UPDATE profiles SET username=? WHERE id=?').run(username,profile.id);
 return username;
}
function updateNamePublicId(db,profileId,displayName){
 return atomic(db,()=>{
  const profile=db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);if(!profile)throw Error('Аккаунт не найден.');
  if(profile.display_name===displayName)return profile.username;
  const username=assignPublicId(db,profile,uniquePublicId(db,profile.id,displayName));
  db.prepare('UPDATE profiles SET display_name=? WHERE id=?').run(displayName,profile.id);
  return username;
 });
}
function overridePublicId(db,profileId,value){
 const username=normalizePublicId(value,Infinity);
 if(!username||codepoints(username).length>MAX_LENGTH)throw Error('ID: 1–24 буквы, цифры или _.');
 return atomic(db,()=>{const profile=db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);if(!profile)throw Error('Аккаунт не найден.');return assignPublicId(db,profile,username)});
}
function migratePublicIds(db){
 const profiles=db.prepare('SELECT * FROM profiles ORDER BY created_at,id').all();
 // Reserve all former handles first: an earlier row cannot take the current
 // handle of a later row while display names are migrated.
 for(const profile of profiles)reservePublicId(db,profile.username,profile.id);
 for(const profile of profiles)if(profile.display_name!=='Новый игрок')assignPublicId(db,profile,uniquePublicId(db,profile.id,profile.display_name));
}
module.exports={MAX_LENGTH,normalizePublicId,resolvePublicId,reservePublicId,updateNamePublicId,overridePublicId,migratePublicIds};
