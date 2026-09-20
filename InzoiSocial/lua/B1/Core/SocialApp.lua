-- The account and feed live on the community server. The selected Zoi owns local gameplay actions.
local Photo=require('B1.Game.PhotoFlow')
local Online=require('B1.Online.Controller')
local M={};M.__index=M
function M.new(view,context,onExit)
 local self=setmetatable({view=view,context=context,onExit=onExit,opened=false,elapsed=0},M)
 self.online=Online.new(self);return self
end
function M:refresh()
 local ok,id=pcall(function()
  local pc=UE.UGameplayStatics.GetPlayerController(self.context,0)
  local character=pc and pc:IsValid()and pc:GetB1Character()
  if character and character:IsValid()then local id=character:GetEntityId().Value;if id and id>0 then return tostring(id)end end
 end)
 self.profile=ok and id and {characterId=id}or nil
 if self.resumeAuthor and self.profile and self.online.me and not self.online.transport.pending then
  local author=self.resumeAuthor;self.resumeAuthor=nil
  if self.profile.characterId==author then self.online.tab='create';self.online.history={};self.online:create()end
 end
end
function M:open()
 self.opened=true;self.elapsed=0;self:refresh();self.online:open()
end
function M:close()
 if self.online then self.online:saveDraft();self.online:onPhoneClose()end;self.opened=false
end
function M:back()if not self.online:back()then self.onExit()end end
function M:update(dt)
 if not self.opened then return end
 self.online:tick(dt);self.elapsed=self.elapsed+(dt or 0)
 if self.elapsed>=1 then self.elapsed=0;self:refresh()end
end
function M:onMessage()end
return M
