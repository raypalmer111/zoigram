'use strict';
const catalog=require('./locales.json'),languages=Object.keys(catalog);
function normalize(value){const base=typeof value==='string'?value.trim().toLowerCase().replaceAll('_','-').split('-')[0]:'';return languages.includes(base)?base:null}
function negotiate(header,fallback='en'){
 const choices=String(header||'').slice(0,1024).split(',').map((item,index)=>{const [tag,...params]=item.trim().split(';');const qParam=params.find(p=>p.trim().startsWith('q='));const q=qParam?Number(qParam.trim().slice(2)):1;return {language:normalize(tag),q,index}}).filter(x=>x.language&&Number.isFinite(x.q)&&x.q>0&&x.q<=1).sort((a,b)=>b.q-a.q||a.index-b.index);
 return choices[0]?.language||fallback;
}
function languageFor(req,url){
 const query=normalize(url.searchParams.get('lang'));
 const cookie=normalize((req.headers.cookie||'').match(/(?:^|;\s*)zg_lang=([A-Za-z-]+)(?:;|$)/)?.[1]);
 // Old native clients sent no language. Keep their Russian API messages compatible.
 return query||(!url.pathname.startsWith('/api/')&&cookie)||negotiate(req.headers['accept-language'],url.pathname.startsWith('/api/')&&!req.headers['accept-language']?'ru':'en');
}
function t(language,key,values={}){return (catalog[normalize(language)||'en'][key]||catalog.en[key]||key).replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match)}
module.exports={languages,normalize,negotiate,languageFor,t,catalog};
