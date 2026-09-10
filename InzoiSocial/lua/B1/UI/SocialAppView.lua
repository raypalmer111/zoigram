local L=require('B1.Localization')
local Kit=require('B1.UI.WidgetKit')
local Icon=require('B1.UI.IconAsset')
local Glyphs=require('B1.UI.Glyphs')
local Page=require('B1.UI.Pages.OnlinePage')
local M={}
function M.create(outer,actions,returnVisibility)
 local kit=Kit.new(outer);local P=kit.palette;local view={kit=kit,tabs={}}
 function view:destroy()if self.page then self.page:destroy()end;self.kit:destroy()end
 local ok,err=pcall(function()
  local logo=Icon.load(outer);local iconColumn=kit:make(UE.UVerticalBox,'IconColumn')
  Kit.center(iconColumn,kit:button('Open',kit:picture(logo,'IconImage',56),actions.open));kit:gap(iconColumn,5,'LabelGap');iconColumn:AddChild(kit:text('Zoigram',13,'IconLabel',P.white))
  view.iconRoot=kit:box('IconRoot',64,89,iconColumn);kit.roots[#kit.roots+1]=view.iconRoot
  local column=kit:make(UE.UVerticalBox,'ScreenColumn')
  view.screen=kit:roundedPanel('ScreenRoot_Return_'..tostring(returnVisibility),column,0,P.white,14);kit.roots[#kit.roots+1]=view.screen
  local header=kit:make(UE.UHorizontalBox,'HeaderRow')
  local back=kit:iconButton('Back','back',actions.back,18);view.back=back;header:AddChild(back)
  local branding=kit:make(UE.UVerticalBox,'Branding')
  view.wordmark=kit:glyph('wordmark','BrandWordmark',29,P.ink,112)
  branding:AddChildToVerticalBox(view.wordmark):SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Left)
  view.title=kit:text('Zoigram',18,'Wordmark',P.ink,true,true,true);branding:AddChild(view.title)
  Kit.fill(header:AddChildToHorizontalBox(branding)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
  local function activity(name,symbol,route,tint)
   local row=kit:make(UE.UHorizontalBox,name..'Content')
   local icon,image=kit:glyph(symbol,name..'Icon',19,P.ink);row:AddChildToHorizontalBox(icon):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
   local count=kit:text('',9,name..'Count',tint,true);row:AddChildToHorizontalBox(count):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
   local button=kit:button(name,row,function()actions.online(route)end,7)
   local hit=kit:box(name..'HitArea',40,42,button);header:AddChildToHorizontalBox(hit):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
   return hit,button,image,count
  end
  view.notificationHit,view.notificationAction,view.notificationIcon,view.notificationCount=activity('Notifications','heart','notifications',P.accent)
  view.messageHit,view.messageAction,view.messageIcon,view.messageCount=activity('Conversations','mail','conversations',P.blue)
  local context,contextButton=kit:iconButton('HeaderAction','gear',function()
   if view.model then actions.online(view.model.mode=='profile'and view.model.me and view.model.profileId~=view.model.me.id and'profileMenu'or'settings')end
  end,18)
  view.headerHit=context;view.headerAction=contextButton;header:AddChild(context)
  column:AddChild(kit:box('HeaderHeight',nil,53,kit:roundedPanel('Header',header,4,P.white,14)));kit:line(column,'HeaderRule')
  view.page=Page.create(kit,actions.online);Kit.fill(column:AddChildToVerticalBox(view.page.root))
  local footerColumn=kit:make(UE.UVerticalBox,'FooterContent');kit:line(footerColumn,'FooterRule')
  local nav=kit:make(UE.UHorizontalBox,'Navigation');footerColumn:AddChild(nav)
  for _,item in ipairs({{'feed',L.t('Лента'),'NavFeed','home'},{'create','','NavCreate','plus'},{'me',L.t('Профиль'),'NavProfile','user'}})do
   local route=item[1];local body=kit:make(UE.UVerticalBox,item[3]..'Column')
   kit:gap(body,9,item[3]..'Top')
   local glyph,art=kit:glyph(item[4],item[3]..'Icon',route=='create'and 23 or 18,route=='create'and P.accent or P.ink);Kit.center(body,glyph)
   kit:gap(body,4,item[3]..'Gap')
   local label=kit:text(item[2],9,item[3]..'Label',P.muted);body:AddChild(label)
   local b=kit:button(item[3],kit:box(item[3]..'Height',nil,58,body),function()actions.online(route)end)
   Kit.fill(nav:AddChildToHorizontalBox(b));view.tabs[route]={label=label,icon=art,button=b}
  end
  view.footer=kit:roundedPanel('Footer',footerColumn,0,P.white,14);column:AddChild(view.footer)
  view.screen:SetVisibility(UE.ESlateVisibility.Collapsed)
 end)
 if not ok then view:destroy();error(err)end
 function view:renderOnline(model)
  self.model=model;local mode=model.mode
  local titles={feed='Zoigram',profile=L.t('Профиль'),create=L.t('Новый пост'),comments=L.t('Комментарии'),edit=L.t('Редактировать'),setup=L.t('Настройки'),following=L.t('Подписки'),blocks=L.t('Заблокированные'),report=L.t('Жалоба'),deletePost=L.t('Публикация'),notifications=L.t('Уведомления'),conversations=L.t('Сообщения'),messages=model.selectedConversation and model.selectedConversation.displayName or L.t('Сообщения'),login='Zoigram'}
  self.title:SetText(titles[mode]or'Zoigram')
  local branded=mode=='feed'or mode=='login'
  self.wordmark:SetVisibility(branded and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed)
  self.title:SetVisibility(branded and UE.ESlateVisibility.Collapsed or UE.ESlateVisibility.Visible)
  self.back:SetVisibility(UE.ESlateVisibility.Visible)
  local activity=model.me~=nil
  self.notificationHit:SetVisibility(activity and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed);self.notificationAction:SetIsEnabled(not model.busy)
  self.messageHit:SetVisibility(activity and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed);self.messageAction:SetIsEnabled(not model.busy)
  local n=model.unreadNotifications or 0;local m=model.unreadMessages or 0
  self.notificationIcon:SetBrushFromTexture(Glyphs.load(outer,(n>0 or mode=='notifications')and'heartFilled'or'heart'),false)
  self.notificationIcon:SetColorAndOpacity((n>0 or mode=='notifications')and P.accent or P.ink)
  self.messageIcon:SetColorAndOpacity((m>0 or mode=='conversations'or mode=='messages')and P.blue or P.ink)
  self.notificationCount:SetText(n>0 and tostring(math.min(n,99))or'');self.messageCount:SetText(m>0 and tostring(math.min(m,99))or'')
  self.notificationCount:SetVisibility(n>0 and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed);self.messageCount:SetVisibility(m>0 and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed)
  local context=mode=='login'or mode=='profile';self.headerHit:SetVisibility(context and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed);self.headerAction:SetIsEnabled(not model.busy)
  local root=mode=='feed'or mode=='profile'or mode=='create';self.footer:SetVisibility(model.me and root and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed)
  for route,tab in pairs(self.tabs)do
   tab.label:SetText(route=='feed'and L.t('Лента')or(route=='me'and L.t('Профиль')or''))
   local selected=model.tab==route;tab.label:SetColorAndOpacity(Kit.slate(selected and P.ink or P.muted));tab.icon:SetColorAndOpacity(route=='create'and P.accent or P.ink);tab.button:SetIsEnabled(not model.busy)
  end
  self.page:render(model)
 end
 function view:invalidateOnlinePhoto(id)self.page.cache[id]=nil end
 function view:getOnlineInput(name)return self.page:get(name)end
 function view:clearOnlineInput(name)self.page:clear(name)end
 return view
end
return M
