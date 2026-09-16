local Drafts=require('B1.Data.PostDrafts')
local Valid=require('B1.Data.PhotoDraft')
local Json=require('B1.Shared.Json')
local M={}
function M.attach(C,Transport,Photo)
 function C:postDrafts()
  if not self.me then return nil end
  if not self.postDraftStore or self.postDraftStore.server~=self.server or self.postDraftStore.accountId~=self.me.id then self.postDraftStore=Drafts.new(Transport,self.server,self.me.id)end
  return self.postDraftStore
 end
 function C:persistPublication(d)
  if not d or not self.me or d.onlineAccount~=self.me.id or d.onlineServer~=self.server then return false end
  local record={characterId=d.characterId,city=d.city,caption=d.caption or'',photos=d.photos or{},requestId=d.onlineRequest,pending=d.pending==true}
  local signature
  -- Textures must not enter the configuration file or its comparison signature.
  record.photos={};for _,p in ipairs(d.photos or{})do record.photos[#record.photos+1]={photo=p.photo}end
  signature=Json.encode({server=self.server,accountId=self.me.id,record=record})
  if self.savedPublication==signature then return true end
  if not self:postDrafts():save(record)then self.error='Не удалось сохранить черновик публикации.';return false end
  self.savedPublication=signature;return true
 end
 function C:savePostDraft()
  local d=self.draft
  if self.mode~='create'or not d or not self.me then return true end
  if not d.pending then
   local caption=self:input('caption');if caption~=d.caption then d.caption=caption;d.onlineRequest=nil end
  end
  return self:persistPublication(d)
 end
 function C:create()
  if not self.me then self.mode='login';self:draw();return end
  self.app:refresh(false,0);self.mode='create';self.error=nil
  local author=self.app.profile and tostring(self.app.profile.characterId);self.draftAuthor=author
  if not author then self.draft=nil;self.error='Дождитесь загрузки персонажа.';self:draw();return end
  local city=UE.UGameplayStatics.GetCurrentLevelName(self.app.context,true)
  local d=Photo.getDraft(author)
  if d and(d.onlineAccount~=self.me.id or d.onlineServer~=self.server or d.city~=city)then Photo.clear(author);d=nil end
  if not d then
   d=Photo.draft(author);d.photos={};d.city=city;d.onlineAccount=self.me.id;d.onlineServer=self.server
   local saved=self:postDrafts():get(author,city)
   if not saved then
    local legacy=Transport.read('draft')
    if legacy and legacy.characterId==author and legacy.city==city and legacy.accountId==self.me.id and legacy.server==self.server and Valid.validPhoto(legacy.photo)then saved={caption=legacy.caption or'',photos={{photo=legacy.photo}},requestId=legacy.requestId,pending=legacy.requestId~=nil}end
   end
   if saved then
    d.caption=saved.caption;d.onlineRequest=saved.requestId;d.pending=saved.pending
    for _,p in ipairs(saved.photos)do
     local item={photo=p.photo};local ok,texture=pcall(function()return UE.UKismetRenderingLibrary.ImportFileAsTexture2D(self.app.context,Photo.path(p.photo))end)
     if ok and texture and texture:IsValid()then item.texture=texture;item.width=texture:Blueprint_GetSizeX();item.height=texture:Blueprint_GetSizeY()end
     d.photos[#d.photos+1]=item
    end
   end
  end
  self.draft=d;self.draftIndex=math.max(1,math.min(self.draftIndex or 1,#d.photos));self:draw()
 end
 function C:camera(add)
  if not self.me or not self.draft or self.draft.pending then return end
  if not self:savePostDraft()then self:draw();return end
  self.app:refresh(false,0);local author=self.app.profile and tostring(self.app.profile.characterId)
  if author~=self.draftAuthor then self.error='Сначала сохраните снимок для текущего персонажа.';self:draw();return end
  local d=self.draft;local index=add and #d.photos+1 or math.min(self.draftIndex or 1,#d.photos+1)
  if index>5 then return end
  local ok=pcall(Photo.start,self.app.context,author,index,function()self.draftIndex=index;self:persistPublication(d)end)
  if ok then self.app.onExit()else Photo.shutdown();self.error='Не удалось открыть фоторежим.';self:draw()end
 end
 function C:publicationDone(d)
  if not self:postDrafts():clear(d.characterId,d.city)then self.error='Не удалось сохранить черновик публикации.';return end
  if Photo.getDraft(d.characterId)==d then Photo.clear(d.characterId)end
  self.savedPublication=nil;pcall(Transport.write,'draft',{});self.draft=nil;self.app.view:clearOnlineInput('caption');self.history={};self.tab='feed';self.notice='Публикация добавлена.';self:feed('all')
 end
 function C:publicationFailed(status,result)
  local d=self.draft;if not d then return end
  if result.submitted==false or(status>=400 and status<500 and status~=409 and status~=401)then d.pending=false;self:persistPublication(d)end
 end
 function C:sendPublication(d)
  local files={}
  for i,p in ipairs(d.photos)do
   local ok,filename=pcall(Photo.exportOnline,self.app.context,p,i)
   if not ok then self.error='Не удалось подготовить снимок для отправки.';self:draw();return end
   files[#files+1]=filename
  end
  d.onlineRequest=d.onlineRequest or Transport.nonce();d.pending=true
  if not self:persistPublication(d)then d.pending=false;self:draw();return end
  self:request('POST','/api/posts',{requestId=d.onlineRequest,caption=d.caption},function(r)
   if type(r.post)~='table'or not r.post.id then self.error='Сервер вернул непонятный ответ.';return end
   self:publicationDone(d)
  end,files)
 end
 function C:publish()
  local d=self.draft;if not self.me or not d then return end
  self.app:refresh(false,0);local author=self.app.profile and tostring(self.app.profile.characterId)
  if author~=d.characterId then self.error='Сначала сохраните снимок для текущего персонажа.';self:draw();return end
  if not self:savePostDraft()then self:draw();return end
  if #d.photos<1 or #d.photos>5 then self.error='В альбоме должно быть от 1 до 5 фотографий.';self:draw();return end
  if Valid.captionLength(d.caption)>2200 then self.error='Подпись должна быть не длиннее 2200 символов.';self:draw();return end
  if #d.photos>1 and not(self.info and self.info.features and self.info.features.photoAlbums)then self.error='Для альбомов требуется обновление сервера.';self:draw();return end
  if d.pending and d.onlineRequest and self.info and self.info.features and self.info.features.postRequestLookup then
   self:request('GET','/api/posts/request/'..d.onlineRequest,nil,function(r)if r.found and r.post then self:publicationDone(d)elseif r.found==false then self:sendPublication(d)else self.error='Сервер вернул непонятный ответ.'end end)
  else self:sendPublication(d)end
 end
 function C:albumAction(action,value)
  if action=='albumPhoto'then
   self.albumIndices=self.albumIndices or{};self.albumIndices[value.id]=value.index;self:draw();return true
  end
  if self.mode~='create'or not self.draft then return false end
  local d=self.draft;local index=self.draftIndex or 1
  if action=='draftPhoto'then self.draftIndex=math.max(1,math.min(value,#d.photos));self:draw();return true end
  if d.pending then return action=='addPhoto'or action=='removePhoto'or action=='photoLeft'or action=='photoRight'or action=='coverPhoto'or action=='discardDraft' end
  if action=='addPhoto'then self:camera(true);return true end
  if action=='discardDraft'then
   if not self.confirmDiscard then self.confirmDiscard=true;self:draw();return true end
   if not self:postDrafts():clear(d.characterId,d.city)then self.error='Не удалось сохранить черновик публикации.';self:draw();return true end
   Photo.clear(d.characterId);self.savedPublication=nil;self.confirmDiscard=nil;self.app.view:clearOnlineInput('caption');self:create();return true
  end
  if action=='removePhoto'then table.remove(d.photos,index);self.draftIndex=math.max(1,math.min(index,#d.photos))
  elseif action=='photoLeft'and index>1 then d.photos[index],d.photos[index-1]=d.photos[index-1],d.photos[index];self.draftIndex=index-1
  elseif action=='photoRight'and index<#d.photos then d.photos[index],d.photos[index+1]=d.photos[index+1],d.photos[index];self.draftIndex=index+1
  elseif action=='coverPhoto'and index>1 then local p=table.remove(d.photos,index);table.insert(d.photos,1,p);self.draftIndex=1
  else return false end
  d.onlineRequest=nil;self.confirmDiscard=nil;self:persistPublication(d);self:draw();return true
 end
end
return M
