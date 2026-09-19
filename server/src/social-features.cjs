'use strict';

// Public IDs are ASCII and case-insensitive. Do not interpret email addresses,
// embedded handles, or the beginning of an overlong identifier as mentions.
function mentionNames(value){
 const names=new Set();
 for(const match of String(value||'').matchAll(/(?<![\p{L}\p{N}_@.+-])@([a-zA-Z0-9_]{3,24})(?![\p{L}\p{N}_@])/gu))names.add(match[1].toLowerCase());
 return [...names];
}

function createSocial({db,clock=Date.now}){
 function syncMentions(postId,actorId,value,commentId=null){
  const post=db.prepare('SELECT p.profile_id FROM posts p JOIN profiles a ON a.id=p.profile_id WHERE p.id=? AND a.banned=0').get(postId);
  const recipients=new Set();
  if(post&&db.prepare('SELECT 1 FROM profiles WHERE id=? AND banned=0').get(actorId)){
   for(const name of mentionNames(value)){
    const target=db.prepare(`SELECT p.id FROM profiles p WHERE p.username=? COLLATE NOCASE AND p.banned=0 AND p.id!=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=p.id AND b.blocked_id IN (?,?)) OR (b.blocked_id=p.id AND b.blocker_id IN (?,?)))`).get(name,actorId,actorId,post.profile_id,actorId,post.profile_id);
    if(target)recipients.add(target.id);
   }
  }
  const old=db.prepare("SELECT id,profile_id FROM notifications WHERE kind='mention' AND actor_id=? AND post_id=? AND comment_id IS ?").all(actorId,postId,commentId);
  for(const notification of old)if(!recipients.has(notification.profile_id))db.prepare('DELETE FROM notifications WHERE id=?').run(notification.id);
  for(const recipient of recipients)db.prepare("INSERT OR IGNORE INTO notifications(profile_id,actor_id,kind,post_id,comment_id,created_at) VALUES(?,?,'mention',?,?,?)").run(recipient,actorId,postId,commentId,clock());
  return recipients;
 }
 return {syncMentions};
}

// Applies to both the unread count and inbox so hidden content cannot leave an
// unread badge that the recipient has no way to clear.
const notificationVisible=`a.banned=0
 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=n.profile_id AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=n.profile_id))
 AND (n.post_id IS NULL OR EXISTS(SELECT 1 FROM posts p JOIN profiles owner ON owner.id=p.profile_id WHERE p.id=n.post_id AND owner.banned=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=n.profile_id AND b.blocked_id=p.profile_id) OR (b.blocker_id=p.profile_id AND b.blocked_id=n.profile_id))))`;

module.exports={mentionNames,createSocial,notificationVisible};
