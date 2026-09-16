-- Uses inZOI's photo-mode action and the actual saved/cropped frame texture.
local N=require('B1.Game.NativeWidgets')
local Log=require('B1.Core.Diagnostics')
local M={state='idle',drafts={}};local serial=0
local function assetDir()return(require('B1.UI.AssetLocation')():gsub('instagram%-icon%.png$',''))end
function M.path(filename)assert(require('B1.Data.PhotoDraft').validPhoto(filename),'Invalid photo filename');return assetDir()..filename end
function M.getDraft(id)return id and M.drafts[tostring(id)]end
function M.draft(id)
 id=tostring(id);if not M.drafts[id]then serial=serial+1;M.drafts[id]={id=tostring(os.time())..'_'..serial,characterId=id,caption='',photos={}}end
 return M.drafts[id]
end
function M.clear(id)M.drafts[tostring(id)]=nil end
function M.detach()
 if M.binding and N.valid(M.binding.button)then pcall(function()M.binding.button.OnClicked:Remove(M.binding.outer,M.binding.callback)end)end
 M.binding=nil
end
function M.start(context,id,index,onCaptured)
 assert(M.state=='idle','Фоторежим уже открывается')
 local pc=UE.UGameplayStatics.GetPlayerController(context,0);local character=pc and pc:GetB1Character();assert(N.valid(character),'Камера сейчас недоступна')
 M.draft(id);M.captureIndex=index or 1;M.onCaptured=onCaptured;M.author=tostring(id);M.state='opening';M.elapsed=0;M.wait=0;M.phoneRequested=nil
 serial=serial+1;M.handler=UE.NewObject(INZOI.UB1RadialMenuUIHandler.StaticClass(),character,'InzoiSocial_PhotoActions_'..os.time()..'_'..serial)
 M.handler:ExecutePhotoMode()
end
function M.capture(w)
 if M.state~='camera'then return end
 local draft=M.draft(M.author)
 local ok,err=pcall(function()
  local texture=w.BW_Image_CropResult.Brush.ResourceObject
  assert(N.valid(texture)and texture:Blueprint_GetSizeX()>64,'Снимок ещё не готов')
  serial=serial+1;local filename='post_'..M.author..'_'..os.time()..'_'..serial..'.png'
  local options=UE.FImageWriteOptions();options.Format=UE.EDesiredImageFormat.PNG;options.bOverwriteFile=false;options.bAsync=false
  UE.UImageWriteBlueprintLibrary.ExportToDisk(texture,M.path(filename),options)
  local copied=UE.UKismetRenderingLibrary.ImportFileAsTexture2D(w,M.path(filename))
  assert(N.valid(copied),'Не удалось сохранить фото для публикации')
  draft.photos=draft.photos or{};local index=math.max(1,math.min(M.captureIndex or 1,#draft.photos+1));assert(index<=5,'Album is full')
  draft.photos[index]={photo=filename,texture=copied,width=copied:Blueprint_GetSizeX(),height=copied:Blueprint_GetSizeY()};draft.onlineRequest=nil;draft.error=nil
  if M.onCaptured then M.onCaptured()end
  Log.emit('Photo added to draft',filename)
 end)
 if not ok then draft.error='Не удалось получить снимок. Повторите съёмку.';Log.emit('Photo capture failed',err)end
end
function M.tick(context,dt)
 if M.state=='idle'then return end
 M.elapsed=(M.elapsed or 0)+dt;M.wait=(M.wait or 0)+dt;if M.wait<.4 then return end;M.wait=0
 local photo=N.find(context,INZOI.UB1PhotoModeWidget,true)
 if M.state=='opening'then
  if photo then
   M.state='camera';M.elapsed=0;local button=photo:GetSaveButton();local callback=function()M.capture(photo)end
   button.OnClicked:Add(photo,callback);M.binding={button=button,outer=photo,callback=callback};Log.emit('Photo mode connected')
  elseif M.elapsed>10 then M.draft(M.author).error='Камера не открылась. Повторите попытку.';M.state='returning';M.elapsed=0 end
 elseif M.state=='camera'then
  -- The player keeps the native Save / Cancel / Back controls, including retakes.
  if not photo then M.detach();M.state='returning';M.elapsed=0 end
 elseif M.state=='returning'then
  if photo then return end
  local phone=N.find(context,INZOI.UB1SmartphoneWidget,true)
  if phone then M.resume=M.author;M.state='idle';M.handler=nil;return end
  if N.find(context,INZOI.UB1HudWindow,true)and not M.phoneRequested and N.valid(M.handler)then
   M.phoneRequested=true;M.handler:ExecuteSmartPhone()
  end
  if M.elapsed>8 then M.resume=M.author;M.state='idle';M.handler=nil end
 end
end
function M.consumeResume()local id=M.resume;M.resume=nil;M.phoneRequested=nil;return id end
function M.shutdown()M.detach();M.state='idle';M.handler=nil;M.resume=nil;M.phoneRequested=nil end
local exportSlot=0
function M.exportOnline(context,draft,slot)
 assert(draft and N.valid(draft.texture),'No photograph')
 exportSlot=exportSlot%5+1;slot=slot or exportSlot;assert(slot>=1 and slot<=5 and slot%1==0,'Invalid album slot');local filename='outgoing_'..slot..'.png'
 local root=require('B1.UI.AssetLocation')():gsub('assets/instagram%-icon%.png$','ui/OnlineBridge/uploads/')
 assert(root:match('/ui/OnlineBridge/uploads/$'),'Invalid upload directory')
 local options=UE.FImageWriteOptions();options.Format=UE.EDesiredImageFormat.PNG;options.bOverwriteFile=true;options.bAsync=false
 UE.UImageWriteBlueprintLibrary.ExportToDisk(draft.texture,root..filename,options)
 local check=UE.UKismetRenderingLibrary.ImportFileAsTexture2D(context,root..filename);assert(N.valid(check),'Could not export photo')
 return filename
end
return M

