local M={}
function M.attach(C,Transport)
 function C:visibleAnnouncements()
  local account=self.me and self.me.id
  if not account then return{}end
  if not self.announcementReads or self.announcementReads.server~=self.server or self.announcementReads.accountId~=account then
   local saved=Transport.read('announcement_reads')
   self.announcementReads=type(saved)=='table'and saved.server==self.server and saved.accountId==account and type(saved.reads)=='table'and saved or{server=self.server,accountId=account,reads={}}
  end
  local out={};for _,a in ipairs(self.announcements or{})do
   if type(a.id)=='number'and type(a.revision)=='number'and type(a.title)=='string'and type(a.body)=='string'and self.announcementReads.reads[tostring(a.id)]~=a.revision then out[#out+1]=a end
   if #out>=3 then break end
  end
  return out
 end
 function C:announcementAction(action,value)
  if action~='openAnnouncement'and action~='dismissAnnouncement'then return false end
  local found;for _,a in ipairs(self:visibleAnnouncements())do if a.id==value then found=a;break end end
  if not found then return true end
  if action=='openAnnouncement'then self:push();self.selectedAnnouncement=found;self.mode='announcement';self:draw();return true end
  local saved=self.announcementReads;local previous=saved.reads[tostring(found.id)];saved.reads[tostring(found.id)]=found.revision
  local keys={};for id in pairs(saved.reads)do keys[#keys+1]=id end;table.sort(keys,function(a,b)return(tonumber(a)or 0)>(tonumber(b)or 0)end);for i=101,#keys do saved.reads[keys[i]]=nil end
  local ok=pcall(Transport.write,'announcement_reads',saved)
  if not ok then saved.reads[tostring(found.id)]=previous;self.error='Не удалось сохранить настройки объявления.'end
  self:draw();return true
 end
end
return M
