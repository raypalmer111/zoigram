local L=require('B1.Localization')
local Kit=require('B1.UI.WidgetKit')
local M={}
function M.render(page,model,k,content,button,label,gap,input,empty,action)
 local d=model.draft;local P=k.palette;local photos=d and d.photos or{};local index=math.max(1,math.min(model.draftIndex or 1,#photos));local selected=photos[index];local locked=d and d.pending
 gap(8)
 if selected then
  if selected.texture and selected.texture:IsValid()then
   local pic=k:make(UE.UImage,'OnlineDraftImage');pic:SetBrushFromTexture(selected.texture,false)
   local h=math.min(225,296*selected.height/math.max(1,selected.width));Kit.center(content,k:box('OnlineDraftImageSize',h*selected.width/math.max(1,selected.height),h,pic))
  else label(L.t('Снимок не найден. Переснимите или удалите его из черновика.'),12,'MissingDraftPhoto',P.accent)end
  gap(8);label(L.t('Фото {index} из {count}',{index=index,count=#photos})..(index==1 and' · '..L.t('Обложка')or''),11,'PhotoCounter',P.muted);gap(8)
  local row=k:make(UE.UHorizontalBox,'OnlineDraftPhotos');Kit.center(content,row)
  for i,p in ipairs(photos)do
   local tile
   if p.texture and p.texture:IsValid()then
    local image=k:make(UE.UImage,'OnlineDraftThumb'..i);image:SetBrushFromTexture(p.texture,false)
    local crop=k:make(UE.UScaleBox,'OnlineDraftThumbCrop'..i);crop:SetStretch(5);crop:AddChild(k:box('OnlineDraftThumbAspect'..i,p.width,p.height,image));tile=k:box('OnlineDraftThumbSize'..i,48,48,crop);tile:SetClipping(1)
   else tile=k:box('OnlineDraftMissingSize'..i,48,48,k:text(tostring(i),14,'OnlineDraftMissing'..i,P.muted))end
   local b=k:button('OnlineDraftSelect'..i,k:panel('OnlineDraftSelectBorder'..i,tile,2,i==index and P.accent or P.surface),function()action('draftPhoto',i)end);b:SetIsEnabled(not model.busy);row:AddChild(b)
   if i<#photos then row:AddChild(k:box('OnlineDraftThumbGap'..i,5,1))end
  end
  if not locked then
   gap(8);local order=k:make(UE.UHorizontalBox,'OnlineDraftOrder');Kit.center(content,order)
   button(order,'‹','PhotoLeft','photoLeft'):SetIsEnabled(not model.busy and index>1)
   button(order,L.t('Удалить'),'RemovePhoto','removePhoto',nil,P.accent)
   button(order,'›','PhotoRight','photoRight'):SetIsEnabled(not model.busy and index<#photos)
   if index>1 then gap(6);button(content,L.t('Сделать обложкой'),'CoverPhoto','coverPhoto')end
  end
 else empty(L.t('Поймайте момент'),L.t('Сделайте кадр в фоторежиме, сохраните его и вернитесь сюда.'))end
 gap(10)
 if locked then
  label(L.t('Отправка не подтверждена. Повторите её, чтобы проверить результат без дубликатов.'),11,'PendingPost',P.muted);gap(8)
 else
  local albumSupported=model.info and model.info.features and model.info.features.photoAlbums
  if #photos<5 and(#photos==0 or albumSupported)then button(content,L.t(#photos==0 and'Открыть фоторежим'or'Добавить фото'),'AddPhoto','addPhoto',nil,P.blue);gap(6)end
  if selected then button(content,L.t('Переснять'),'Camera','camera');gap(10)end
 end
 input('caption',L.t('Подпись'),d and d.caption or'',82)
 if page.inputs.caption then page.inputs.caption:SetIsEnabled(not locked and not model.busy)end
 label(L.t('Черновик сохраняется на этом компьютере.'),10,'DraftSavedHint',P.muted);gap(8)
 local publish=button(content,L.t(locked and'Повторить отправку'or'Опубликовать'),'Publish','publish',nil,P.accent,true);publish:SetIsEnabled(not model.busy and #photos>0)
 if not locked and d and(#photos>0 or d.caption~='')then gap(8);button(content,L.t(model.confirmDiscard and'Подтвердить удаление черновика'or'Удалить черновик'),'DiscardDraft','discardDraft',nil,P.muted)end
end
return M
