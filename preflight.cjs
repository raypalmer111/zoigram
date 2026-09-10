'use strict';
// Validate deployment inputs without starting containers or changing the server.
const fs=require('node:fs'),dns=require('node:dns/promises'),net=require('node:net'),path=require('node:path');
async function preflight(filename,{resolve=true}={}){
 const values={};for(const line of fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){if(!line.trim()||line.trim().startsWith('#'))continue;const m=line.match(/^([A-Z_]+)=(.*)$/);if(!m)throw Error('Invalid .env line');if(Object.hasOwn(values,m[1]))throw Error('Duplicate setting '+m[1]);values[m[1]]=m[2].trim()}
 const domain=values.DOMAIN||'';
 if(domain.length>253||!domain.includes('.')||domain.split('.').some(p=>!/^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(p))||net.isIP(domain)||/(^|\.)(example\.(com|org|net)|localhost|test|invalid)$/.test(domain))throw Error('Set DOMAIN to your real DNS name, without https://, port or path');
 for(const [key,min,max]of [['STORAGE_LIMIT_MB',64,1048576],['BACKUP_KEEP',1,90],['BACKUP_INTERVAL_SECONDS',60,604800]]){const n=Number(values[key]);if(!Number.isInteger(n)||n<min||n>max)throw Error('Invalid '+key)}
 // Query public DNS records directly: OVH maps the VPS's own FQDN to 127.0.1.1 in /etc/hosts.
 const addresses=[];
 if(resolve){
  const resolver=new dns.Resolver({timeout:5000,tries:2});resolver.setServers(['1.1.1.1','8.8.8.8']);
  const results=await Promise.allSettled([resolver.resolve4(domain),resolver.resolve6(domain)]);
  for(const [index,result]of results.entries()){
   if(result.status==='fulfilled')addresses.push(...result.value.map(address=>({address,family:index===0?4:6})));
   else if(!['ENODATA','ENOTFOUND'].includes(result.reason.code))throw result.reason;
  }
  if(!addresses.length)throw Error('DOMAIN has no A or AAAA DNS records');
 }
 if(addresses.some(a=>net.isIPv4(a.address)&&/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)||a.address==='::1'))throw Error('DOMAIN resolves to a local network address');
 return {origin:'https://'+domain,addresses,photoQuotaMB:Number(values.STORAGE_LIMIT_MB),backupKeep:Number(values.BACKUP_KEEP),backupEveryHours:Number(values.BACKUP_INTERVAL_SECONDS)/3600,estimatedDataAndBackupMB:Number(values.STORAGE_LIMIT_MB)*(Number(values.BACKUP_KEEP)+3),note:'Disk estimate excludes OS, Docker images, database overhead and manually retained backups. DNS must point to the VPS; ports 80/443 must be reachable.'};
}
module.exports={preflight};
if(require.main===module)preflight(path.resolve(process.argv[2]||path.join(__dirname,'.env')),{resolve:!process.argv.includes('--no-dns')}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1});
