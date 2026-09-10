'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('./app.cjs');
const port=Number(process.env.PORT||43821),host=process.env.HOST||'127.0.0.1',origin=process.env.PUBLIC_ORIGIN||'http://127.0.0.1:'+port;
const data=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data'));fs.mkdirSync(data,{recursive:true});
if(fs.existsSync(path.join(data,'.restoring')))throw Error('Data restore is incomplete. Restore into an empty directory before starting the server.');
const secretPath=path.join(data,'media.key');if(fs.existsSync(path.join(data,'zoigram.sqlite'))&&!fs.existsSync(secretPath))throw Error('Existing database has no media.key. Restore its matching key from backup.');if(!fs.existsSync(secretPath))fs.writeFileSync(secretPath,crypto.randomBytes(32),{mode:0o600,flag:'wx'});
if(fs.readFileSync(secretPath).length!==32)throw Error('Invalid media.key');
const app=createApp({database:path.join(data,'zoigram.sqlite'),origin,secret:fs.readFileSync(secretPath),name:process.env.COMMUNITY_NAME||'Zoigram',ownerSteamId:process.env.OWNER_STEAM_ID||'',trustProxy:process.env.TRUST_PROXY==='loopback',storageBytes:Number(process.env.STORAGE_LIMIT_MB||10240)*1024*1024,onError:e=>console.error('[Zoigram]',e.stack)});
if(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)&&!['localhost','127.0.0.1','::1'].includes(host))throw Error('A local-test origin must listen only on loopback');
app.server.listen(port,host,()=>console.log('Zoigram API: '+origin+' | '+(new URL(origin).protocol==='https:'?'public configuration':'local development')));
let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await app.close()});

