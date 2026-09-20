'use strict';
function verification(db,id){const row=db.prepare('SELECT verified,revision FROM profile_verifications WHERE profile_id=?').get(id);return {verified:!!row?.verified,verificationRevision:row?.revision||0}}
function creator(db,id,ownerProfileId){
 if(ownerProfileId&&id===ownerProfileId)return {creator:true,creatorRevision:0,creatorSource:'owner'};
 const row=db.prepare('SELECT creator,revision FROM creator_grants WHERE profile_id=?').get(id);
 return {creator:!!row?.creator,creatorRevision:row?.revision||0,creatorSource:row?.creator?'grant':null};
}
function likeBonus(db,id){const row=db.prepare('SELECT amount,revision FROM post_like_bonuses WHERE post_id=?').get(id);return {bonusLikes:row?.amount||0,likeBonusRevision:row?.revision||0}}
function likeCounts(db,id){const realLikes=db.prepare('SELECT COUNT(*) n FROM likes l JOIN profiles p ON p.id=l.profile_id WHERE l.post_id=? AND p.banned=0').get(id).n,bonus=likeBonus(db,id);return {...bonus,realLikes,likes:realLikes+bonus.bonusLikes}}
module.exports={verification,creator,likeBonus,likeCounts};
