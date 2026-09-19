-- Renew expiring grants before asking UMG to download them. This queue shares the
-- authenticated transport; it never stores credentials or relaxes media access.
local M={}
local function now(model)return model.mediaClock and model.mediaClock()or os.time()*1000 end
local function identity(model)return tostring(model.server)..':'..tostring(model.me and model.me.id or'')end
local function state(model)
 local key=identity(model)
 if not model.mediaState or model.mediaState.key~=key then
  model.mediaState={key=key,entries={},order={},queue={},cooldown=0};model.mediaGeneration=(model.mediaGeneration or 0)+1
 end
 return model.mediaState
end
local function entry(model,kind,id)
 local s=state(model);local key=kind..':'..tostring(id);local e=s.entries[key]
 if not e then
  e={key=key,kind=kind,id=id,attempts=0};s.entries[key]=e;s.order[#s.order+1]=key
  while #s.order>256 do local old=table.remove(s.order,1);s.entries[old]=nil;s.queue[old]=nil end
 end
 return s,e
end
local function fresh(model,kind,value)
 local expires=kind=='post'and value.mediaExpiresAt or value.avatarExpiresAt
 return type(expires)=='number'and expires>now(model)+(model.mediaState and model.mediaState.clockOffset or 0)+30000
end
local function url(kind,value)return kind=='post'and value.thumbnailUrl or value.avatarUrl end
local function visit(model,fn)
 local seen={}
 local function walk(value,depth)
  if type(value)~='table'or seen[value]or depth>5 then return end;seen[value]=true
  fn(value)
  for _,key in ipairs({'me','selectedProfile','selectedConversation','selectedPost','editTarget','deleteTarget','posts','pinnedPosts','comments','searchResults','accounts','notifications','conversations','messages','author','actor','participant','history'})do walk(value[key],depth+1)end
  for _,child in ipairs(value)do walk(child,depth+1)end
 end
 walk(model,0)
end
function M.attach(Controller)
 function Controller:resetMedia()
  self.mediaState=nil;self.mediaGeneration=(self.mediaGeneration or 0)+1
 end
 function Controller:mediaReady(kind,value,asset)
  if not self.me or type(value)~='table'or value.id==nil then return false end
  if not(self.info and self.info.features and self.info.features.mediaRefresh)then return true end
  local s,e=entry(self,kind,value.id)
  local current=url(kind,value)
  if e.url and e.url~=current then e.attempts=0;e.unavailable=nil;e.needsRefresh=nil;e.failures=nil end;e.url=current
  if e.unavailable then return false end
  local failed=e.failures and e.failures[tostring(asset or 1)]
  if not(e.needsRefresh and failed)and fresh(self,kind,value)then return true end
  if e.attempts<2 and not e.inflight then s.queue[e.key]=e end
  return false
 end
 function Controller:mediaFailed(kind,value,asset)
  if not self.me or not(self.info and self.info.features and self.info.features.mediaRefresh)then return end
  local s,e=entry(self,kind,value.id)
  e.needsRefresh=true;e.url=url(kind,value);e.failures=e.failures or{};e.failures[tostring(asset or 1)]=true
  if e.attempts<2 and not e.inflight and not e.unavailable then s.queue[e.key]=e end
 end
 function Controller:mediaLoaded(kind,value,asset)
  local s,e=entry(self,kind,value.id)
  if e.failures then e.failures[tostring(asset or 1)]=nil end
  if not e.failures or not next(e.failures)then e.attempts=0;e.unavailable=nil;e.needsRefresh=nil;s.queue[e.key]=nil end
 end
 function Controller:applyMedia(result)
  local posts,profiles={},{}
  for _,p in ipairs(result.posts or{})do posts[tostring(p.id)]=p end
  for _,p in ipairs(result.profiles or{})do profiles[tostring(p.id)]=p end
  visit(self,function(value)
   local post=value.author and posts[tostring(value.id)]
   if post then
    for _,field in ipairs({'thumbnailUrl','imageUrl','mediaExpiresAt'})do value[field]=post[field]end
    for i,photo in ipairs(value.photos or{})do
     local renewed=post.photos and post.photos[i]
     if renewed then photo.thumbnailUrl=renewed.thumbnailUrl;photo.imageUrl=renewed.imageUrl end
    end
   end
   local profile=value.username and profiles[tostring(value.id)]
   if profile then for _,field in ipairs({'avatarUrl','avatarExpiresAt','avatarVersion'})do value[field]=profile[field]end end
  end)
  return posts,profiles
 end
 function Controller:refreshMediaTick()
  if not self.me or self.transport.pending or self.busy then return end
  local s=state(self);if now(self)<s.cooldown then return end
  local body={postIds={},profileIds={}};local batch={}
  for _,key in ipairs(s.order)do
   local e=s.queue[key]
   if e and e.attempts<2 and not e.inflight then
    s.queue[key]=nil;e.inflight=true;e.attempts=e.attempts+1;batch[#batch+1]=e
    local list=e.kind=='post'and body.postIds or body.profileIds;list[#list+1]=e.id
    if #batch==30 then break end
   end
  end
  if #batch==0 then return end
  local generation=self.mediaGeneration;local server=self.server;local account=self.me.id
  self.transport:send(server,'POST','/api/media/refresh',body,function(status,result)
   if self.mediaGeneration~=generation or self.server~=server or not self.me or self.me.id~=account then return end
   result=type(result)=='table'and result or{};local ok=status>=200 and status<300;local posts,profiles={},{}
   if ok then
    if type(result.serverTime)=='number'then s.clockOffset=result.serverTime-now(self)end
    posts,profiles=self:applyMedia(result)
   else s.cooldown=now(self)+60000 end
   for _,e in ipairs(batch)do
    e.inflight=nil
    if ok then
     local renewed=(e.kind=='post'and posts or profiles)[tostring(e.id)]
     e.unavailable=not renewed
     if renewed then e.url=url(e.kind,renewed);e.needsRefresh=nil end
     -- A response without usable expiry must not create an endless redraw loop.
     if renewed and not fresh(self,e.kind,renewed)then e.attempts=2 end
    end
   end
   if status==401 then self:sessionEnded(result)end
   -- The page saves input values when the route is unchanged. Its scroll offset
   -- is carried across rebuilding widgets; no feed/profile navigation is fired.
   if self.app.view.page and self.app.view.page.scroll then
    local good,offset=pcall(function()return self.app.view.page.scroll:GetScrollOffset()end);if good then self.restoreScroll=offset end
   end
   self:draw()
  end)
 end
end
return M
