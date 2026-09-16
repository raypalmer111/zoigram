-- Publication drafts contain local filenames, never image bytes or account credentials.
local Valid=require('B1.Data.PhotoDraft')
local M={};M.__index=M
local function clone(v)
 local r={characterId=v.characterId,city=v.city,caption=v.caption or'',requestId=v.requestId,pending=v.pending==true,photos={}}
 for _,p in ipairs(v.photos or{})do r.photos[#r.photos+1]={photo=p.photo}end
 return r
end
local function valid(v)
 if type(v)~='table'or type(v.characterId)~='string'or not v.characterId:match('^%d+$')or type(v.city)~='string'or #v.city>512 or type(v.caption)~='string'or #v.caption>64000 or type(v.photos)~='table'or #v.photos>5 then return false end
 if v.requestId~=nil and(type(v.requestId)~='string'or #v.requestId>100 or not v.requestId:match('^[%w_%-]+$'))then return false end
 if v.pending and not v.requestId then return false end
 for _,p in ipairs(v.photos)do if type(p)~='table'or not Valid.validPhoto(p.photo)then return false end end;return true
end
function M.new(storage,server,accountId)
 local self=setmetatable({storage=storage,server=server,accountId=accountId,entries={}},M);local saved=storage.read('post_drafts')
 if type(saved)=='table'and saved.server==server and saved.accountId==accountId and type(saved.entries)=='table'then
  for i,v in ipairs(saved.entries)do if i>10 then break end;if valid(v)then self.entries[#self.entries+1]=clone(v)end end
 end
 return self
end
function M:get(characterId,city)for _,v in ipairs(self.entries)do if v.characterId==characterId and v.city==city then return clone(v)end end end
function M:save(draft)
 if not valid(draft)then return false end
 local entries={};for _,v in ipairs(self.entries)do if v.characterId~=draft.characterId or v.city~=draft.city then entries[#entries+1]=clone(v)end end
 if draft.caption~=''or #draft.photos>0 then entries[#entries+1]=clone(draft)end;if #entries>10 then return false end
 local ok=pcall(self.storage.write,'post_drafts',{version=1,server=self.server,accountId=self.accountId,entries=entries});if ok then self.entries=entries end;return ok
end
function M:clear(characterId,city)return self:save({characterId=characterId,city=city,caption='',photos={}})end
return M
