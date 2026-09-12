-- Local drafts belong to one server/account. They are never sent until Send is pressed.
local M={};M.__index=M
function M.new(storage,server,accountId)
 local saved=storage.read('message_drafts');local self=setmetatable({storage=storage,server=server,accountId=accountId,entries={}},M)
 if type(saved)=='table'and saved.server==server and saved.accountId==accountId and type(saved.entries)=='table'then
  for i,v in ipairs(saved.entries)do
   if i>20 then break end
   if type(v)=='table'and type(v.peerId)=='string'and #v.peerId<=128 and type(v.text)=='string'and #v.text<=64000 then
    self.entries[#self.entries+1]={peerId=v.peerId,text=v.text,requestId=type(v.requestId)=='string'and #v.requestId<=128 and v.requestId or nil}
   end
  end
 end
 return self
end
function M:entry(peerId)for _,entry in ipairs(self.entries)do if entry.peerId==peerId then return entry end end end
function M:get(peerId)local entry=self:entry(peerId);return entry and entry.text or''end
function M:flush()
 if not self.dirty then return true end
 local ok=pcall(self.storage.write,'message_drafts',{version=1,server=self.server,accountId=self.accountId,entries=self.entries})
 if ok then self.dirty=false end;return ok
end
function M:set(peerId,text)
 if type(peerId)~='string'or peerId==''or type(text)~='string'or #text>64000 then return false end
 local entry=self:entry(peerId)
 if entry and entry.text==text or not entry and text==''then return self:flush()end
 for i=#self.entries,1,-1 do if self.entries[i].peerId==peerId then table.remove(self.entries,i)end end
 if text~=''then table.insert(self.entries,1,{peerId=peerId,text=text})end
 while #self.entries>20 do table.remove(self.entries)end
 self.dirty=true;return self:flush()
end
function M:requestId(peerId,nonce)
 local entry=self:entry(peerId);if not entry then return nil end
 if not entry.requestId then entry.requestId=nonce();self.dirty=true end
 if not self:flush()then return nil end;return entry.requestId
end
function M:clear()self.entries={};self.dirty=true;return self:flush()end
function M.preview(text)
 text=(text or''):gsub('%s+',' ');local count=0
 for i=1,#text do local b=text:byte(i);if b<128 or b>=192 then count=count+1;if count>80 then return text:sub(1,i-1)..'…'end end end
 return text
end
return M
