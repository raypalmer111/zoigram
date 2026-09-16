'use strict';

const BUSY='Сервис обрабатывает фотографии. Попробуйте через несколько секунд.';
const DISCONNECTED='Нет связи с сервером. Попробуйте ещё раз.';
const TIMED_OUT='Сервер или файл не ответил вовремя. Попробуйте снова.';

function createUploadTransport({Problem,options={}}){
 const positive=(value,fallback,maximum)=>Number.isInteger(value)&&value>0?Math.min(value,maximum):fallback;
 const idleMs=positive(options.idleMs,30000,30000),totalMs=positive(options.totalMs,110000,110000),queueMs=positive(options.queueMs,10000,10000);
 const gate={active:0,receiving:0,waiting:0,inFlight:0,maximum:positive(options.maxProcessing,2,2),maxInFlight:positive(options.maxInFlight,4,4)};
 const queue=[];
 const problem=(status,message,code,extra={})=>Object.assign(new Problem(status,message),{code,...extra});
 const busy=()=>problem(503,BUSY,'upload_busy',{retryAfter:5});
 const disconnected=(req,incomplete)=>problem(499,DISCONNECTED,incomplete?'upload_aborted':'upload_cancelled');

 // Admission remains reserved until conversion/persistence finishes. Thus receiving,
 // queued and converting requests together can never retain more than four bodies.
 function admit(req,res){
  if(gate.inFlight>=gate.maxInFlight){req.zoigramCloseConnection=!req.complete;throw busy();}
  gate.inFlight++;req.zoigramUpload=true;req.zoigramUploadPhase='receiving';
  let released=false,processing=false,waiter=null;
  function check(){if(res.destroyed||req.socket?.destroyed)throw disconnected(req,false);}
  function grant(){processing=true;gate.active++;req.zoigramUploadPhase='processing';}
  function dispatch(){
   while(gate.active<gate.maximum&&queue.length){
    const item=queue.shift();item.cleanup();
    try{item.check();item.grant();item.resolve();}catch(error){item.reject(error);}
   }
  }
  async function process(){
   check();if(processing)return;
   if(gate.active<gate.maximum){grant();return;}
   req.zoigramUploadPhase='waiting';
   await new Promise((resolve,reject)=>{
    let timer,settled=false;
    const item={check,grant,resolve,reject,cleanup(){
     if(settled)return;settled=true;clearTimeout(timer);res.off('close',closed);gate.waiting--;waiter=null;
    }};
    function cancel(error){const index=queue.indexOf(item);if(index!==-1)queue.splice(index,1);item.cleanup();reject(error);}
    function closed(){cancel(disconnected(req,false));}
    gate.waiting++;waiter=item;queue.push(item);res.once('close',closed);
    timer=setTimeout(()=>cancel(busy()),queueMs);timer.unref?.();
   });
  }
  function release(){
   if(released)return;released=true;
   if(waiter){const item=waiter,index=queue.indexOf(item);if(index!==-1)queue.splice(index,1);item.cleanup();item.reject(disconnected(req,false));}
   if(processing){processing=false;gate.active--;}
   gate.inFlight--;dispatch();
  }
  return {process,check,release};
 }

 async function json(req,max=65536){
  function rejectHeader(status,message){req.zoigramCloseConnection=!req.complete;throw new Problem(status,message);}
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))rejectHeader(415,'Ожидается JSON.');
  if(Number(req.headers['content-length']||0)>max)rejectHeader(413,'Слишком большой файл.');
  const upload=!!req.zoigramUpload;
  if(upload){gate.receiving++;req.zoigramUploadPhase='receiving';req.zoigramBodyBytes=0;}
  let chunks=[];
  try{
   const body=await new Promise((resolve,reject)=>{
    let bytes=0,ended=false,settled=false,idleTimer,totalTimer;
    function cleanup(){clearTimeout(idleTimer);clearTimeout(totalTimer);req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);req.off('close',close);}
    function finish(failure){
     if(settled)return;settled=true;cleanup();
     if(failure){
      chunks=[];
      if(!req.complete&&!req.destroyed){req.pause();req.zoigramCloseConnection=true;}
      // Node may emit aborted, then error, then close while destroyed is already
      // true. Keep an error observer until close even on that aborted path.
      if(!req.closed){const ignore=()=>{};req.once('error',ignore);req.once('close',()=>req.off('error',ignore));}
      reject(failure);
     }else{const buffer=Buffer.concat(chunks,bytes);chunks=[];resolve(buffer);}
    }
    function timeout(){finish(problem(408,TIMED_OUT,'upload_timeout'));}
    function resetIdle(){clearTimeout(idleTimer);idleTimer=setTimeout(timeout,idleMs);idleTimer.unref?.();}
    function data(chunk){bytes+=chunk.length;if(upload)req.zoigramBodyBytes=bytes;if(bytes>max){finish(new Problem(413,'Слишком большой файл.'));return;}chunks.push(chunk);resetIdle();}
    function end(){ended=true;req.zoigramBodyComplete=true;finish();}
    function aborted(){if(!ended)finish(disconnected(req,!req.complete));}
    function error(value){
     const knownDisconnect=!ended&&!req.complete&&(req.aborted||req.destroyed)&&['ECONNRESET','ERR_STREAM_PREMATURE_CLOSE'].includes(value?.code);
     finish(knownDisconnect?disconnected(req,true):value);
    }
    function close(){if(!ended)finish(disconnected(req,!req.complete));}
    req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);req.once('close',close);
    resetIdle();totalTimer=setTimeout(timeout,totalMs);totalTimer.unref?.();
    if(req.aborted||req.destroyed&&!req.complete)aborted();
   });
   try{const value=JSON.parse(body.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
   catch{throw new Problem(400,'Не удалось прочитать запрос.');}
  }finally{chunks=[];if(upload)gate.receiving--;}
 }
 return {gate,admit,json};
}

module.exports={createUploadTransport};
