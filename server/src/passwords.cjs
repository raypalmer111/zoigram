'use strict';
const crypto=require('node:crypto'),{promisify}=require('node:util');
const derive=promisify(crypto.scrypt),params={N:32768,r:8,p:3,maxmem:64*1024*1024};
const dummy='scrypt1$00000000000000000000000000000000$'+'00'.repeat(64);
let active=0;
async function run(password,salt){
 if(active>=2){const e=Error('Вход занят. Попробуйте через несколько секунд.');e.status=503;throw e}
 active++;try{return await derive(password,salt,64,params)}finally{active--}
}
function validPassword(value){return typeof value==='string'&&[...value].length>=15&&[...value].length<=128&&!/[\x00-\x1f\x7f]/.test(value)}
async function encode(password){const salt=crypto.randomBytes(16).toString('hex');return 'scrypt1$'+salt+'$'+(await run(password,salt)).toString('hex')}
async function verify(password,encoded){
 const value=/^scrypt1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded||'')?encoded:dummy;
 const [,salt,key]=value.split('$'),candidate=await run(typeof password==='string'&&Buffer.byteLength(password)<=1024?password:'invalid',salt);
 return crypto.timingSafeEqual(candidate,Buffer.from(key,'hex'))&&value!==dummy;
}
module.exports={encode,verify,validPassword};
