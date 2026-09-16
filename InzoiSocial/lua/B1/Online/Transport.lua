local L=require('B1.Localization')
local Json=require('B1.Shared.Json')
local M={};M.__index=M;local serial=0
function M.nonce()serial=serial+1;return tostring(os.time())..'_'..math.floor(os.clock()*1000000)..'_'..serial end
function M.read(key)
 local ok,msg,data=inzoi.cli.execute('uimod.cfg_load mod_id=__MOD_ID__ section=online key='..key)
 if not ok then return nil end
 local good,result=pcall(function()local raw=Json.decode(data).value;if not raw or #raw>3000000 or #raw%2~=0 or raw:find('[^%x]')then return nil end;return Json.decode((raw:gsub('..',function(h)return string.char(tonumber(h,16))end)))end)
 return good and result or nil
end
function M.write(key,value)
 local raw=Json.encode(value):gsub('.',function(c)return string.format('%02x',c:byte())end)
 local ok,msg=inzoi.cli.execute('uimod.cfg_save mod_id=__MOD_ID__ section=online key='..key..' value="'..raw..'"');assert(ok,msg or 'Не удалось связаться с сетевым модулем.')
end
function M.server(value)
 if type(value)~='string'then return nil end;value=value:gsub('^%s+',''):gsub('%s+$',''):gsub('/+$','')
 if #value>240 or value:find('[%s@?#\\]')then return nil end
 local host=value:match('^https://([%w%.%-:]+)$');if host and not host:find('%.%.',1,true)then return value end
 if value:match('^http://127%.0%.0%.1:%d+$')or value:match('^http://localhost:%d+$')then return value end
 return nil
end
function M.new()return setmetatable({elapsed=0},M)end
function M:send(server,method,path,body,callback,upload)
 if self.pending then return false end
 local job={id=M.nonce(),createdAt=os.time(),server=server,method=method,path=path,body=body,upload=upload,language=L.language}
 local ok,err=pcall(M.write,'request',job)
 if not ok then callback(0,{error='Не удалось отправить запрос из игры.'});return false end
 self.pending={id=job.id,callback=callback,started=os.time(),timeout=upload and 300 or 40};return true
end
function M:tick(dt)
 if not self.pending then return end;self.elapsed=self.elapsed+(dt or 0);if self.elapsed<.25 then return end;self.elapsed=0
 local reply=M.read('response');local p=self.pending;local progress=M.read('progress');if progress and progress.id==p.id then p.progress=progress end
 if reply and reply.id==p.id then self.pending=nil;p.callback(reply.status,reply.body or {})
 elseif os.time()-p.started>(p.timeout or 40) then self.pending=nil;p.callback(0,{error='Сетевой модуль не ответил. Повторите действие; после обновления мода может потребоваться перезапуск игры.'})end
end
function M:dispose()self.pending=nil end
return M
