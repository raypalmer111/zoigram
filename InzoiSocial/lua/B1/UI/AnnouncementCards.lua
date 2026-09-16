local L=require('B1.Localization')
local M={}
local function preview(text)
 local out={};for char in text:gmatch('[%z\1-\127\194-\244][\128-\191]*')do out[#out+1]=char;if #out>150 then out[#out]='…';break end end;return table.concat(out)
end
function M.render(model,k,content,button,action)
 local P=k.palette
 for i,a in ipairs(model:visibleAnnouncements())do
  local column=k:make(UE.UVerticalBox,'Announcement'..i)
  column:AddChild(k:text(L.t(a.kind=='maintenance'and'Технические работы'or a.kind=='update'and'Обновление Zoigram'or'Объявление владельца'),10,'AnnouncementKind'..i,P.muted,true,true,true))
  k:gap(column,5,'AnnouncementGap'..i..'_'..column:GetChildrenCount());column:AddChild(k:text(a.title,14,'AnnouncementTitle'..i,P.ink,true,true,true));k:gap(column,5,'AnnouncementGap'..i..'_'..column:GetChildrenCount());column:AddChild(k:text(preview(a.body),12,'AnnouncementBody'..i,P.ink,false,true,true));k:gap(column,8,'AnnouncementActionsGap'..i)
  local row=k:make(UE.UHorizontalBox,'AnnouncementActions'..i);column:AddChild(row)
  button(row,L.t('Подробнее'),'AnnouncementOpen'..i,'openAnnouncement',a.id,P.blue)
  button(row,L.t('Скрыть'),'AnnouncementDismiss'..i,'dismissAnnouncement',a.id,P.muted)
  content:AddChild(k:panel('AnnouncementCard'..i,column,14,P.surface));k:gap(content,6,'AnnouncementCardGap'..i)
 end
end
return M
