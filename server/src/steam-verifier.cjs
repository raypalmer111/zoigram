'use strict';
const ENDPOINT='https://steamcommunity.com/openid/login',NS='http://specs.openid.net/auth/2.0';
class AuthError extends Error{constructor(message){super(message);this.status=400}}
function parameters(params){const values=Object.create(null);for(const [key,value]of params){if(Object.hasOwn(values,key))throw new AuthError('Повторяющиеся параметры входа.');values[key]=value}return values}
function loginUrl(origin,returnTo){const url=new URL(ENDPOINT);for(const [k,v]of Object.entries({ns:NS,mode:'checkid_setup',return_to:returnTo,realm:origin+'/',identity:NS+'/identifier_select',claimed_id:NS+'/identifier_select'}))url.searchParams.set('openid.'+k,v);return url.href}
async function verifySteam(db,values,returnTo,fetcher=fetch){
 const p=name=>values['openid.'+name];
 if(p('mode')!=='id_res'||p('ns')!==NS||p('op_endpoint')!==ENDPOINT||p('return_to')!==returnTo)throw new AuthError('Steam вернул неверный ответ.');
 const claimed=p('claimed_id')||'',match=claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
 if(!match||p('identity')!==claimed)throw new AuthError('Не удалось проверить Steam-аккаунт.');
 const signed=new Set((p('signed')||'').split(','));if(!['op_endpoint','claimed_id','identity','return_to','response_nonce'].every(k=>signed.has(k))||!p('sig'))throw new AuthError('Неполная подпись Steam.');
 const nonce=p('response_nonce')||'',timestamp=Date.parse(nonce.slice(0,20));
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ.+$/.test(nonce)||!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>300000||db.prepare('SELECT 1 FROM nonces WHERE nonce=?').get(nonce))throw new AuthError('Ответ Steam устарел или уже использован.');
 const body=new URLSearchParams();for(const [k,v]of Object.entries(values))if(k.startsWith('openid.'))body.set(k,v);body.set('openid.mode','check_authentication');
 const response=await fetcher(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok||!/(?:^|\n)is_valid:true(?:\r?\n|$)/.test(await response.text()))throw new AuthError('Steam не подтвердил подпись. Попробуйте ещё раз.');
 return {subject:match[1],nonce};
}
module.exports={ENDPOINT,NS,AuthError,parameters,loginUrl,verifySteam};
