'use strict';
// Server-side, read-only bridge. Never forwards browser cookies or player tokens.
const fs=require('node:fs'),https=require('node:https');
function monitorError(){return Object.assign(Error('ZoiMeet временно недоступен. Сведения о подключениях не обновлены.'),{status:503});}
function createMonitor(options={}){
 const read=options.readFile||fs.readFileSync,request=options.request||https.request;
 return async function(query){
  let token;try{token=read(options.tokenFile||process.env.ZOIMEET_MONITOR_TOKEN_FILE||'/run/secrets/zoimeet_monitor','utf8').trim();}catch{throw monitorError();}
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw monitorError();
  const params=new URLSearchParams();for(const key of ['status','q','devicePage','requestPage'])if(query.has(key))params.set(key,query.get(key));
  return new Promise((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port:8443,servername:'vps-24654da6.vps.ovh.net',path:'/internal/monitor?'+params,method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'}},res=>{
    let size=0;const chunks=[];res.on('data',part=>{size+=part.length;if(size>262144){res.destroy();reject(monitorError());}else chunks.push(part);});res.on('error',()=>reject(monitorError()));res.on('end',()=>{try{if(res.statusCode===400)return reject(Object.assign(Error('Проверьте фильтр или номер страницы ZoiMeet.'),{status:400}));if(res.statusCode!==200)throw Error();const result=JSON.parse(Buffer.concat(chunks));if(result.service!=='ZoiMeet'||!Array.isArray(result.devices?.items)||!Array.isArray(result.requests?.items))throw Error();resolve(result);}catch{reject(monitorError());}});
   });req.setTimeout(4000,()=>{req.destroy();reject(monitorError());});req.on('error',()=>reject(monitorError()));req.end();
  });
 };
}
module.exports={createMonitor};
