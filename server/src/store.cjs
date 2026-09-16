'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
function openStore(filename){
 if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
 const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec(`
 CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, banned INTEGER NOT NULL DEFAULT 0, UNIQUE(provider,subject));
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(secret_hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, profile_id TEXT REFERENCES profiles(id), consumed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS logins(state_hash TEXT PRIMARY KEY, device_hash TEXT NOT NULL REFERENCES devices(secret_hash) ON DELETE CASCADE, cookie_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, caption TEXT NOT NULL, created_at INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, image BLOB NOT NULL, thumbnail BLOB NOT NULL, bytes INTEGER NOT NULL, UNIQUE(profile_id,request_id));
 CREATE TABLE IF NOT EXISTS post_photos(post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 4),width INTEGER NOT NULL,height INTEGER NOT NULL,image BLOB NOT NULL,thumbnail BLOB NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(post_id,position));
 CREATE INDEX IF NOT EXISTS posts_author ON posts(profile_id,id DESC);
 CREATE TABLE IF NOT EXISTS likes(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(profile_id,post_id));
 CREATE TABLE IF NOT EXISTS follows(follower_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,following_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(follower_id,following_id),CHECK(follower_id<>following_id));
 CREATE TABLE IF NOT EXISTS blocks(blocker_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,blocked_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,PRIMARY KEY(blocker_id,blocked_id),CHECK(blocker_id<>blocked_id));
 CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,request_id TEXT NOT NULL,text TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(profile_id,request_id));
 CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,id);
 CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,kind TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,UNIQUE(profile_id,kind,target_id));
 CREATE TABLE IF NOT EXISTS moderation(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_logins(state_hash TEXT PRIMARY KEY,cookie_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
 CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('like','follow')),post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,read_at INTEGER,CHECK((kind='like' AND post_id IS NOT NULL) OR (kind='follow' AND post_id IS NULL)));
 CREATE UNIQUE INDEX IF NOT EXISTS notifications_like ON notifications(profile_id,actor_id,post_id) WHERE kind='like';
 CREATE UNIQUE INDEX IF NOT EXISTS notifications_follow ON notifications(profile_id,actor_id) WHERE kind='follow';
 CREATE INDEX IF NOT EXISTS notifications_inbox ON notifications(profile_id,id DESC);
 CREATE TABLE IF NOT EXISTS direct_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,sender_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,recipient_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,request_id TEXT NOT NULL,text TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(sender_id,request_id),CHECK(sender_id<>recipient_id));
 CREATE INDEX IF NOT EXISTS direct_messages_recipient ON direct_messages(recipient_id,id DESC);
 CREATE INDEX IF NOT EXISTS direct_messages_sender ON direct_messages(sender_id,id DESC);
 CREATE TABLE IF NOT EXISTS avatars(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,image BLOB NOT NULL,bytes INTEGER NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS avatar_uploads(token_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS account_credentials(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,login TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS account_links(token_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS account_flows(token_hash TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('device','settings')),device_hash TEXT REFERENCES devices(secret_hash) ON DELETE CASCADE,session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS profile_verifications(profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,verified INTEGER NOT NULL CHECK(verified IN (0,1)),revision INTEGER NOT NULL CHECK(revision>0),updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS post_like_bonuses(post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 1000000),revision INTEGER NOT NULL CHECK(revision>0),updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS bookmarks(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,UNIQUE(profile_id,post_id));
 CREATE INDEX IF NOT EXISTS bookmarks_profile ON bookmarks(profile_id,id DESC);`);
 db.exec(`
 CREATE TABLE IF NOT EXISTS upload_sessions(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,request_id TEXT NOT NULL,caption TEXT NOT NULL,photo_count INTEGER NOT NULL CHECK(photo_count BETWEEN 1 AND 5),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,generation TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,PRIMARY KEY(profile_id,request_id));
 CREATE INDEX IF NOT EXISTS upload_sessions_expiry ON upload_sessions(expires_at) WHERE post_id IS NULL;
 CREATE TABLE IF NOT EXISTS upload_parts(profile_id TEXT NOT NULL,request_id TEXT NOT NULL,position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),digest TEXT NOT NULL,input_bytes INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,image BLOB NOT NULL,thumbnail BLOB NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(profile_id,request_id,position),FOREIGN KEY(profile_id,request_id) REFERENCES upload_sessions(profile_id,request_id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS operational_errors(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL,profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,source TEXT NOT NULL,code TEXT NOT NULL,status INTEGER NOT NULL,client_version TEXT NOT NULL,image_bytes INTEGER,route TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS operational_errors_time ON operational_errors(created_at);
 CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL,active INTEGER NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 `);
 transaction(db,()=>{if(!db.prepare('PRAGMA table_info(upload_sessions)').all().some(c=>c.name==='generation'))db.exec('ALTER TABLE upload_sessions ADD COLUMN generation TEXT');db.exec('UPDATE upload_sessions SET generation=lower(hex(randomblob(16))) WHERE generation IS NULL');});
 // Preserve existing notification IDs and read state while adding comment alerts.
 if(!db.prepare('PRAGMA table_info(notifications)').all().some(c=>c.name==='comment_id'))transaction(db,()=>{
  const sequence=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='notifications'").get()?.seq||0;
  db.exec(`CREATE TABLE notifications_next(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,actor_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('like','follow','comment')),post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,read_at INTEGER,comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,CHECK((kind='like' AND post_id IS NOT NULL AND comment_id IS NULL) OR (kind='follow' AND post_id IS NULL AND comment_id IS NULL) OR (kind='comment' AND post_id IS NOT NULL AND comment_id IS NOT NULL)));
   INSERT INTO notifications_next(id,profile_id,actor_id,kind,post_id,created_at,read_at) SELECT id,profile_id,actor_id,kind,post_id,created_at,read_at FROM notifications;
   DROP TABLE notifications;
   ALTER TABLE notifications_next RENAME TO notifications;`);
  if(db.prepare("SELECT 1 FROM sqlite_sequence WHERE name='notifications'").get())db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='notifications'").run(sequence);
  else db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run('notifications',sequence);
 });
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS notifications_like ON notifications(profile_id,actor_id,post_id) WHERE kind='like';
 CREATE UNIQUE INDEX IF NOT EXISTS notifications_follow ON notifications(profile_id,actor_id) WHERE kind='follow';
 CREATE UNIQUE INDEX IF NOT EXISTS notifications_comment ON notifications(comment_id) WHERE kind='comment';
 CREATE INDEX IF NOT EXISTS notifications_inbox ON notifications(profile_id,id DESC);
 PRAGMA user_version=9;`);
 return db;
}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
function identity(db,provider,subject){
 const old=db.prepare('SELECT * FROM profiles WHERE provider=? AND subject=?').get(provider,subject);if(old)return old;
 const id=crypto.randomUUID(),username='player_'+id.replaceAll('-','').slice(0,12);
 db.prepare('INSERT INTO profiles(id,provider,subject,username,display_name,created_at) VALUES(?,?,?,?,?,?)').run(id,provider,subject,username,'Новый игрок',Date.now());
 return db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
}
function session(db,profileId){
 const token=random(),expiresAt=Date.now()+7*86400000;
 db.prepare('INSERT INTO sessions(id,token_hash,profile_id,expires_at) VALUES(?,?,?,?)').run(crypto.randomUUID(),hash(token),profileId,expiresAt);
 return {token,expiresAt};
}
module.exports={openStore,transaction,identity,session,hash,random};
