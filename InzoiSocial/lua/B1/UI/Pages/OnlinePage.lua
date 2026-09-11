local L=require('B1.Localization')
local Kit=require('B1.UI.WidgetKit')
local M={}
function M.create(kit,action)
 local page={inputs={},saved={},tasks={},cache={},cacheOrder={}};local P=kit.palette
 page.root=kit:make(UE.UVerticalBox,'OnlineRoot')
 page.status=kit:text('',11,'OnlineStatus',P.muted,false,true,true);page.statusPanel=kit:panel('OnlineStatusPanel',page.status,10,P.surface);page.root:AddChild(page.statusPanel)
 page.scroll=kit:make(UE.UScrollBox,'OnlineScroll');Kit.fill(page.root:AddChildToVerticalBox(page.scroll))
 page.scroll:SetScrollBarVisibility(UE.ESlateVisibility.Collapsed)
 page.content=kit:make(UE.UVerticalBox,'OnlineContent');page.body=kit:panel('OnlineBody',page.content,0);page.scroll:AddChild(page.body)
 function page:get(name)local w=self.inputs[name];return w and w:IsValid()and tostring(w:GetText())or self.saved[name]or''end
 function page:clear(name)self.saved[name]=nil;local w=self.inputs[name];if w and w:IsValid()then w:SetText('')end end
 function page:stopImages()
  self.generation=(self.generation or 0)+1
  for _,t in ipairs(self.tasks)do if t.task and t.task:IsValid()then pcall(function()t.task.OnSuccess:Remove(kit.outer,t.success);t.task.OnFail:Remove(kit.outer,t.fail)end)end end;self.tasks={}
 end
 function page:render(model)
  self.model=model;local status=model.error or(model.busy and L.t('Загрузка…'))or(model.mode=='create'and model.draft and model.draft.error)or model.notice or''
  self.status:SetText(L.t(status));self.status:SetColorAndOpacity(Kit.slate(model.error and P.accent or P.muted));self.statusPanel:SetVisibility(status~=''and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed)
   local route=tostring(model.pendingLogin and model.pendingLogin.userCode or'')..':'..model.mode..':'..tostring(model.mode=='profile'and model.profileId or'')..':'..tostring((model.mode=='comments'or model.mode=='post')and model.selectedPost and model.selectedPost.id or'')..':'..tostring(model.mode=='editPost'and model.editTarget and model.editTarget.id or'')..':'..tostring(model.mode=='messages'and model.conversationId or'')
  if self.route~=route then self.saved={};self.scroll:ScrollToStart()else for name,w in pairs(self.inputs)do if w:IsValid()then self.saved[name]=tostring(w:GetText())end end end
  self.route=route;self.inputs={};self:stopImages();if self.k then self.k:destroy()end;self.content:ClearChildren();local k=Kit.new(kit.outer);self.k=k;local content=self.content
  self.body:SetPadding(Kit.margin(model.mode=='feed'and 0 or 14))
  local cacheKey=model.server..':'..tostring(model.me and model.me.id);if self.cacheKey~=cacheKey then self.cache={};self.avatarCache={};self.avatarCacheOrder={};self.cacheOrder={};self.cacheKey=cacheKey end
  local function label(text,size,name,color,bold)content:AddChild(k:text(text,size or 13,'Online'..name,color or P.ink,bold,true,true))end
  local function gap(height)k:gap(content,height or 12,'OnlineGap'..content:GetChildrenCount())end
  local function button(parent,title,name,a,value,color,filled)
   local text=k:text(title,12,'Online'..name..'Label',filled and P.white or(color or P.ink),true,false,true)
   local b=k:button('Online'..name,k:roundedPanel('Online'..name..'Fill',text,12,filled and(color or P.accent)or P.surface,10),function()action(a,value)end);b:SetIsEnabled(not model.busy);parent:AddChild(b);return b
  end
  local function nameLine(p,size,name,tint,value)
   local row=k:make(UE.UHorizontalBox,'Online'..name..'Row')
   local text=k:text(value or p.displayName,size,'Online'..name,tint or P.ink,true,true,true)
   local bounds=k:box('Online'..name..'TextBounds',nil,nil,text);bounds:SetMaxDesiredWidth(size>=16 and 200 or 150)
   row:AddChildToHorizontalBox(bounds):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
   if p.verified==true then
    row:AddChild(k:box('Online'..name..'BadgeGap',4,1))
    local badge=k:glyph('verified','Online'..name..'Verified',size>=16 and 16 or 13,P.blue)
    pcall(function()badge:SetToolTipText(L.t('Подтверждённый аккаунт'))end)
    row:AddChildToHorizontalBox(badge):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
   end
   return row
  end
  local function avatar(p,size,name)
   local initial=((p.displayName or''):match('^[A-Za-z0-9]')or(p.username or'z'):sub(1,1)):upper()
   local fallback=k:roundedPanel('Online'..name,k:text(initial,math.floor(size*.39),'Online'..name..'Initial',P.accent,true),math.floor(size*.2),P.blush,size/2)
   local overlay=k:make(UE.UOverlay,'Online'..name..'Layers')
   local function add(w)local slot=overlay:AddChildToOverlay(w);slot:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Fill);slot:SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Fill)end
   add(fallback)
   if type(p.avatarUrl)=='string'and p.avatarUrl:sub(1,#model.server+13)==model.server..'/api/avatars/'then
    local pic=k:make(UE.UImage,'Online'..name..'Photo');pic:SetColorAndOpacity(P.white);pic:SetVisibility(UE.ESlateVisibility.Collapsed);add(pic)
    self.avatarCache=self.avatarCache or{};local key=p.id..':'..tostring(p.avatarVersion);local cached=self.avatarCache[key]
    local function show(texture)if pic:IsValid()then pic:SetBrushFromTextureDynamic(texture,false);pic:SetVisibility(UE.ESlateVisibility.Visible);fallback:SetVisibility(UE.ESlateVisibility.Collapsed)end end
    if cached and cached:IsValid()then show(cached)
    else
     local generation=self.generation
     local ok=pcall(function()
      local task=UE.UAsyncTaskDownloadImage.DownloadImage(p.avatarUrl);local entry={task=task}
      entry.success=function(...)
       if self.generation~=generation then return end
       for i=1,select('#',...)do local texture=select(i,...);local good,class=pcall(function()return texture:GetClass():GetName()end)
        if good and class=='Texture2DDynamic'then
         if not self.avatarCache[key]then self.avatarCacheOrder[#self.avatarCacheOrder+1]=key end
         self.avatarCache[key]=texture
         while #self.avatarCacheOrder>48 do self.avatarCache[table.remove(self.avatarCacheOrder,1)]=nil end
         show(texture);break
        end
       end
      end
      entry.fail=function()end
      task.OnSuccess:Add(kit.outer,entry.success);task.OnFail:Add(kit.outer,entry.fail);self.tasks[#self.tasks+1]=entry
     end)
    end
   end
   return k:box('Online'..name..'Size',size,size,overlay)
  end
  local function input(name,title,value,height)
   label(title,10,name..'Title',P.muted,true);gap(5)
   local w=k:make(UE.UMultiLineEditableTextBox,'OnlineInput_'..name);local style=UE.FTextBlockStyle();style.Font=k:text('',12,'OnlineInputFont_'..name).Font;style.ColorAndOpacity=k.slate(P.ink);w:SetTextStyle(style);w:SetText(self.saved[name]or value or'');self.inputs[name]=w
   content:AddChild(k:box('OnlineInputSize_'..name,nil,height or 42,w));gap()
  end
  local function empty(title,description)
   gap(40);Kit.center(content,kit:picture(require('B1.UI.IconAsset').load(kit.outer),'OnlineEmptyLogo',62));gap(18)
   content:AddChild(k:text(title,19,'OnlineEmpty',P.ink,true,false,true));gap(6);content:AddChild(k:text(description,12,'OnlineEmptyHint',P.muted,false,false,true));gap(30)
  end
  local function image(post,column,index,tile)
   local name='OnlinePhoto'..index;local width=tile or(model.mode=='feed'and 324 or 296);local height=tile or math.min(420,width*post.height/math.max(1,post.width));if not tile then width=height*post.width/math.max(1,post.height)end
   local overlay=k:make(UE.UOverlay,name..'Overlay');local function stretch(w)local slot=overlay:AddChildToOverlay(w);slot:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Fill);slot:SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Fill)end
   stretch(k:panel(name..'Bg',nil,0,P.surface));local pic=k:make(UE.UImage,name);pic:SetColorAndOpacity(P.white);if tile then local scale=k:make(UE.UScaleBox,name..'Crop');scale:SetStretch(5);scale:AddChild(k:box(name..'Aspect',post.width,post.height,pic));stretch(scale)else stretch(pic)end;pic:SetVisibility(UE.ESlateVisibility.Collapsed)
   local hint=k:text(L.t('Загрузка фото…'),11,name..'Hint',P.muted);local slot=overlay:AddChildToOverlay(hint);slot:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Center);slot:SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
   local frame=k:box(name..'Size',width,height,overlay);if tile then frame:SetClipping(1)else Kit.center(column,frame)end;local cached=self.cache[post.id]
   local function show(texture)if pic:IsValid()then pic:SetBrushFromTextureDynamic(texture,false);pic:SetVisibility(UE.ESlateVisibility.Visible);hint:SetVisibility(UE.ESlateVisibility.Collapsed)end end
   if cached and cached:IsValid()then show(cached);return frame end
   if type(post.thumbnailUrl)~='string'or post.thumbnailUrl:sub(1,#model.server+11)~=model.server..'/api/media/'then hint:SetText(L.t('Фото недоступно'));return frame end
   local generation=self.generation;local ok,err=pcall(function()
    local task=UE.UAsyncTaskDownloadImage.DownloadImage(post.thumbnailUrl);local entry={task=task}
    entry.success=function(...)
     if self.generation~=generation then return end
     for i=1,select('#',...)do local texture=select(i,...);local good,name=pcall(function()return texture:GetClass():GetName()end)
      if good and name=='Texture2DDynamic'then self.cache[post.id]=texture;self.cacheOrder[#self.cacheOrder+1]=post.id;if #self.cacheOrder>24 then local expired=table.remove(self.cacheOrder,1);self.cache[expired]=nil end;show(texture);break end
     end
    end
    entry.fail=function()if self.generation==generation and hint:IsValid()then hint:SetText(L.t('Фото не загрузилось. Обновите ленту.'))end end
    task.OnSuccess:Add(kit.outer,entry.success);task.OnFail:Add(kit.outer,entry.fail);self.tasks[#self.tasks+1]=entry
   end);if not ok then hint:SetText(L.t('Фото временно недоступно'))end
   return frame
  end
  local function posts(items)
   if #items==0 then
    if model.mode=='profile'then empty(L.t('История в кадрах'),L.t('Здесь появятся опубликованные фотографии.'))
    elseif model.scope=='following'then empty(L.t('Ваша лента подписок'),L.t('Подпишитесь на авторов, чьи кадры вам нравятся.'))
    else empty(L.t('Первый кадр — за вами'),L.t('Нажмите ＋, чтобы поделиться моментом из inZOI.'))end;return
   end
   for i,post in ipairs(items)do
    local column=k:make(UE.UVerticalBox,'OnlinePost'..i);content:AddChild(column)
    local head=k:make(UE.UHorizontalBox,'OnlinePostHeader'..i);column:AddChild(k:box('OnlinePostHeaderHeight'..i,nil,53,k:panel('OnlinePostHeaderPad'..i,head,9)))
    head:AddChildToHorizontalBox(avatar(post.author,34,'Avatar'..i)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
    local names=k:make(UE.UVerticalBox,'OnlineAuthorNames'..i);names:AddChild(nameLine(post.author,12,'AuthorName'..i));names:AddChild(k:text('@'..post.author.username,10,'OnlineAuthorHandle'..i,P.muted,false,true))
    local author=k:button('OnlineAuthor'..i,names,function()action('profile',post.author.id)end,7);author:SetIsEnabled(not model.busy);Kit.fill(head:AddChildToHorizontalBox(author))
    if model.me and post.author.id==model.me.id then local menu=k:button('OnlinePostMenu'..i,k:glyph('more','OnlinePostMenuGlyph'..i,18),function()action('postMenu',post)end,7);menu:SetIsEnabled(not model.busy);head:AddChild(menu)end
    if model.postMenu==post.id and model.me and post.author.id==model.me.id then button(column,L.t('Изменить подпись'),'EditPost'..i,'editPost',post);button(column,L.t('Удалить публикацию'),'DeletePost'..i,'deletePost',post,P.accent)end
    image(post,column,i)
    local row=k:make(UE.UHorizontalBox,'OnlineActions'..i);column:AddChild(k:panel('OnlineActionsPad'..i,row,4))
     local reaction=k:make(UE.UHorizontalBox,'OnlineLikeContent'..i)
     reaction:AddChildToHorizontalBox((k:glyph(post.liked and'heartFilled'or'heart','OnlineHeart'..i,19,post.liked and P.accent or P.ink))):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     local count=k:text(' '..post.likes,13,'OnlineLikeLabel'..i,post.liked and P.accent or P.ink,true);reaction:AddChildToHorizontalBox(count):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     local heart=k:button('OnlineLike'..i,reaction,function()action('like',post)end,7);heart:SetIsEnabled(not model.busy);row:AddChild(heart)
     local comments=k:button('OnlineComments'..i,k:text(L.t('Комментарии · {count}',{count=post.comments}),11,'OnlineCommentsLabel'..i,P.muted),function()action('comments',post)end,8);comments:SetIsEnabled(not model.busy);row:AddChild(comments)
     Kit.fill(row:AddChildToHorizontalBox(k:box('OnlineActionSpace'..i)))
     if model.me and post.author.id~=model.me.id then local report=k:button('OnlineReportPost'..i,k:glyph('flag','OnlineReportPostGlyph'..i,16,P.ink),function()action('report',{kind='post',id=post.id})end,8);report:SetIsEnabled(not model.busy);row:AddChild(report)end
    if post.caption~=''then column:AddChild(k:panel('OnlineCaptionPad'..i,k:text(post.caption,12,'OnlineCaption'..i,P.ink,false,true,true),10))end
    column:AddChild(k:panel('OnlineDatePad'..i,k:text(L.date(post.createdAt),9,'OnlineDate'..i,P.muted,false,true),10));k:gap(column,6,'OnlinePostGap'..i);k:line(column,'OnlinePostRule'..i,P.line)
   end
   if model.mode~='post'and model.mode~='comments'and model.cursor then gap();button(content,L.t('Показать ещё'),'More','more')end
  end
  local function grid(items)
   if #items==0 then empty(L.t('История в кадрах'),L.t('Здесь появятся опубликованные фотографии.'));return end
   for start=1,#items,3 do
    local row=k:make(UE.UHorizontalBox,'OnlineGridRow'..start);Kit.center(content,k:box('OnlineGridRowSize'..start,296,97,row))
    for i=start,math.min(start+2,#items)do
     if i>start then row:AddChild(k:box('OnlineGridGap'..i,2,97))end
     local post=items[i];local tile=image(post,nil,'Grid'..i,97)
     local b=k:button('OnlineGridPost'..i,tile,function()action('post',post)end);b:SetIsEnabled(not model.busy);row:AddChild(b)
    end
    gap(2)
   end
   if model.cursor then gap();button(content,L.t('Показать ещё'),'More','more')end
  end
  if model.mode=='search'then
   gap(8);input('search',L.t('Имя или @ID'),model.searchQuery or'',42);button(content,L.t('Найти игроков'),'RunSearch','runSearch',nil,P.blue,true);gap(14)
   if model.searchPerformed and #(model.searchResults or{})==0 then empty(L.t('Никого не найдено'),L.t('Попробуйте другое имя или ID.'))
   elseif not model.searchPerformed then label(L.t('Найдите автора и подпишитесь на его фотографии.'),12,'SearchHint',P.muted)end
   for i,p in ipairs(model.searchResults or{})do
    local row=k:make(UE.UHorizontalBox,'OnlineSearchRow'..i);row:AddChildToHorizontalBox(avatar(p,40,'SearchAvatar'..i)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
    local names=k:make(UE.UVerticalBox,'OnlineSearchNames'..i);names:AddChild(nameLine(p,13,'SearchName'..i));names:AddChild(k:text('@'..p.username,10,'OnlineSearchHandle'..i,P.muted,false,true))
    Kit.fill(row:AddChildToHorizontalBox(k:panel('OnlineSearchNamePad'..i,names,9)))
    local b=k:button('OnlineSearchResult'..i,row,function()action('profile',p.id)end,4);b:SetIsEnabled(not model.busy);content:AddChild(b);k:line(content,'OnlineSearchRule'..i)
   end
   if model.searchCursor then gap();button(content,L.t('Показать ещё'),'MoreSearch','moreSearch')end
  elseif model.mode=='post'then
   if model.selectedPost then posts({model.selectedPost})end
  elseif model.mode=='editPost'then
   if model.editTarget then image(model.editTarget,content,'EditPreview');gap();input('editCaption',L.t('Подпись'),model.editTarget.caption,100);label(L.t('Фотография, лайки и комментарии сохранятся.'),11,'EditCaptionHint',P.muted);gap();button(content,L.t('Сохранить'),'SaveCaption','saveCaption',nil,P.blue,true);gap(8);button(content,L.t('Отмена'),'CancelCaption','back')end
  elseif model.mode=='feed'then
   local row=k:make(UE.UHorizontalBox,'OnlineFeedFilters');content:AddChild(k:box('OnlineFiltersHeight',nil,42,row))
   for _,choice in ipairs({{'all',L.t('Для вас')},{'following',L.t('Подписки')}})do local scope=choice[1];local active=scope==model.scope;local b=k:button('OnlineScope'..scope,k:text(choice[2],12,'OnlineScopeLabel'..scope,active and P.ink or P.muted,active),function()action('scope',scope)end,10);b:SetIsEnabled(not model.busy);Kit.fill(row:AddChildToHorizontalBox(b))end
    local refresh=k:button('OnlineRefresh',k:glyph('refresh','OnlineRefreshGlyph',17,P.ink),function()action('refresh')end,12);refresh:SetIsEnabled(not model.busy);row:AddChild(refresh)
    k:line(content,'OnlineFiltersRule');posts(model.posts)
  elseif model.mode=='profile'then
   local p=model.selectedProfile;if p then
    gap(12);local summary=k:make(UE.UHorizontalBox,'OnlineProfileSummary');content:AddChild(summary);summary:AddChild(avatar(p,64,'ProfileAvatar'))
    for _,stat in ipairs({{p.postCount,L.t('постов'),'Posts'},{p.followers,L.t('подписчиков'),'Followers'},{p.following,L.t('подписок'),'Following'}})do local col=k:make(UE.UVerticalBox,'OnlineStat'..stat[3]);col:AddChild(k:text(tostring(stat[1]),18,'OnlineStatValue'..stat[3],P.ink,true));col:AddChild(k:text(stat[2],9,'OnlineStatLabel'..stat[3],P.muted,false,false,true));Kit.fill(summary:AddChildToHorizontalBox(col)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)end
    gap();content:AddChild(nameLine(p,17,'ProfileName'));label('@'..p.username,11,'ProfileUsername',P.muted);if p.bio~=''then gap(6);label(p.bio,12,'ProfileBio')end;gap()
    if p.isSelf then button(content,L.t('Редактировать профиль'),'EditProfile','edit')
    else button(content,p.isFollowing and L.t('Вы подписаны')or L.t('Подписаться'),'Follow','follow',nil,p.isFollowing and P.ink or P.accent,not p.isFollowing);gap(8);button(content,L.t('Написать сообщение'),'MessageProfile','message',p.id,P.blue,true);gap(8);button(content,L.t('Пожаловаться'),'ReportProfileDirect','report',{kind='profile',id=p.id},P.muted)end
    if model.profileMenu and not p.isSelf then gap(8);button(content,model.confirmBlock==p.id and L.t('Подтвердить блокировку')or L.t('Заблокировать'),'Block','block',nil,P.accent)end
    gap(16);k:line(content,'OnlineProfileRule');gap(8);grid(model.posts)
   else label(L.t('Загрузка профиля…'),13,'ProfileLoading',P.muted)end
   elseif model.mode=='notifications'then
    gap(4)
    if #(model.notifications or{})==0 then empty(L.t('Пока нет уведомлений'),L.t('Лайки и подписки появятся здесь.'))end
    for i,n in ipairs(model.notifications or{})do
     local row=k:make(UE.UHorizontalBox,'OnlineNotificationRow'..i);row:AddChildToHorizontalBox(avatar(n.actor,42,'NotificationAvatar'..i)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     local copy=k:make(UE.UVerticalBox,'OnlineNotificationCopy'..i);copy:AddChild(k:text(n.kind=='like'and L.t('Новый лайк от {name}',{name=n.actor.displayName})or L.t('Новая подписка от {name}',{name=n.actor.displayName}),12,'OnlineNotificationText'..i,P.ink,true,true,true));copy:AddChild(nameLine(n.actor,9,'NotificationDate'..i,P.muted,'@'..n.actor.username..' · '..L.date(n.createdAt)));Kit.fill(row:AddChildToHorizontalBox(copy)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     if not n.isRead then row:AddChildToHorizontalBox(k:text('●',12,'OnlineNotificationUnread'..i,P.accent,true)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)end
     local card=k:button('OnlineNotification'..i,k:panel('OnlineNotificationSurface'..i,row,9,n.isRead and P.white or P.blush),function()action('notification',n)end);card:SetIsEnabled(not model.busy);content:AddChild(card);k:line(content,'OnlineNotificationRule'..i,P.line)
    end
    if model.notificationCursor then gap();button(content,L.t('Показать ещё'),'MoreNotifications','moreNotifications')end
   elseif model.mode=='conversations'then
    gap(4)
    if #(model.conversations or{})==0 then empty(L.t('Пока нет сообщений'),L.t('Напишите игроку из его профиля.'))end
    for i,c in ipairs(model.conversations or{})do
     local row=k:make(UE.UHorizontalBox,'OnlineConversationRow'..i);row:AddChildToHorizontalBox(avatar(c.participant,46,'ConversationAvatar'..i)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     local copy=k:make(UE.UVerticalBox,'OnlineConversationCopy'..i);copy:AddChild(nameLine(c.participant,13,'ConversationName'..i));local preview=c.lastMessage.outgoing and L.t('Вы: {text}',{text=c.lastMessage.text})or c.lastMessage.text;copy:AddChild(k:text(preview,10,'OnlineConversationPreview'..i,P.muted,false,true,true));Kit.fill(row:AddChildToHorizontalBox(copy)):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     local meta=k:make(UE.UVerticalBox,'OnlineConversationMeta'..i);meta:AddChild(k:text(L.date(c.lastMessage.createdAt),9,'OnlineConversationDate'..i,P.muted));if c.unread and c.unread>0 then meta:AddChild(k:text(tostring(math.min(c.unread,99)),11,'OnlineConversationUnread'..i,P.blue,true))end;row:AddChildToHorizontalBox(meta):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     local card=k:button('OnlineConversation'..i,k:panel('OnlineConversationSurface'..i,row,9,c.unread and c.unread>0 and P.message or P.white),function()action('conversation',c.participant.id)end);card:SetIsEnabled(not model.busy);content:AddChild(card);k:line(content,'OnlineConversationRule'..i,P.line)
    end
    if model.conversationCursor then gap();button(content,L.t('Показать ещё'),'MoreConversations','moreConversations')end
   elseif model.mode=='messages'then
    if model.selectedConversation then
     local participant=k:button('OnlineMessageParticipant',nameLine(model.selectedConversation,10,'MessageParticipantLabel',P.muted,'@'..model.selectedConversation.username),function()action('profile',model.selectedConversation.id)end,7);participant:SetIsEnabled(not model.busy);content:AddChild(participant);k:line(content,'OnlineMessageParticipantRule',P.line)
    end
    if model.messageCursor then gap(6);button(content,L.t('Показать более ранние'),'MoreMessages','moreMessages');gap(8)end
    if #(model.messages or{})==0 then empty(L.t('Начните переписку'),L.t('Напишите первое сообщение.'))end
    for i,message in ipairs(model.messages or{})do
     local row=k:make(UE.UHorizontalBox,'OnlineMessageRow'..i)
     if message.outgoing then Kit.fill(row:AddChildToHorizontalBox(k:box('OnlineMessageLead'..i)))end
     local copy=k:make(UE.UVerticalBox,'OnlineMessageCopy'..i);copy:AddChild(k:text(message.text,12,'OnlineMessageText'..i,P.ink,false,true,true));copy:AddChild(k:text(L.date(message.createdAt),8,'OnlineMessageDate'..i,P.muted,false,true))
     row:AddChildToHorizontalBox(k:box('OnlineMessageBubbleSize'..i,228,nil,k:roundedPanel('OnlineMessageBubble'..i,copy,9,message.outgoing and P.message or P.surface,12))):SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
     if not message.outgoing then Kit.fill(row:AddChildToHorizontalBox(k:box('OnlineMessageTrail'..i)))end
     content:AddChild(row);gap(6)
    end
    gap(10);input('message',L.t('Ваше сообщение'),'',68);button(content,L.t('Отправить'),'SendMessage','sendMessage',nil,P.blue,true);gap(8)
   elseif model.mode=='create'then
   gap(8);local draft=model.draft
   if draft and draft.texture and draft.texture:IsValid()then
    local pic=k:make(UE.UImage,'OnlineDraftImage');pic:SetBrushFromTexture(draft.texture,false);local h=math.min(225,300*draft.height/math.max(1,draft.width));Kit.center(content,k:box('OnlineDraftImageSize',h*draft.width/math.max(1,draft.height),h,pic));gap()
   else empty(L.t('Поймайте момент'),L.t('Сделайте кадр в фоторежиме, сохраните его и вернитесь сюда.'))end
   button(content,draft and draft.texture and L.t('Переснять')or L.t('Открыть фоторежим'),'Camera','camera');gap()
   input('caption',L.t('Подпись'),draft and draft.caption or'',82);label(L.t('Пост увидят участники вашего сообщества.'),10,'Visibility',P.muted);gap()
   local publish=button(content,L.t('Опубликовать'),'Publish','publish',nil,P.accent,true);publish:SetIsEnabled(not model.busy and draft~=nil and draft.texture~=nil)
  elseif model.mode=='deletePost'then
   gap(18);label(L.t('Удалить эту публикацию?'),20,'DeleteTitle',P.ink,true);gap();label(L.t('Фото, лайки и комментарии исчезнут из Zoigram. Отменить удаление нельзя.'),12,'DeleteHelp',P.muted);gap()
   if model.deleteTarget then image(model.deleteTarget,content,'DeletePreview');gap();if model.deleteTarget.caption~=''then label(model.deleteTarget.caption,12,'DeleteCaption');gap()end end
   button(content,L.t('Удалить публикацию'),'ConfirmDelete','confirmDelete',nil,P.accent,true);gap(8);button(content,L.t('Оставить публикацию'),'CancelDelete','back')
  elseif model.mode=='comments'then
   gap(8)
   if #model.comments==0 then label(L.t('Пока тихо. Начните разговор.'),13,'NoComments',P.muted);gap()end
   for i,c in ipairs(model.comments)do
     local head=k:make(UE.UHorizontalBox,'OnlineCommentHead'..i);content:AddChild(head);head:AddChild(avatar(c.author,28,'CommentAvatar'..i));head:AddChild(k:button('OnlineCommentAuthor'..i,nameLine(c.author,12,'CommentAuthorLabel'..i),function()action('profile',c.author.id)end,6));gap(4);label(c.text,12,'CommentText'..i)
     if model.me and c.author.id==model.me.id then content:AddChild(k:button('OnlineDeleteComment'..i,k:text(L.t('Удалить'),10,'OnlineDeleteCommentLabel'..i,P.muted),function()action('deleteComment',c)end,5))
     elseif model.me then content:AddChild(k:button('OnlineReportComment'..i,k:text('⚑ '..L.t('Пожаловаться'),10,'OnlineReportCommentLabel'..i,P.muted),function()action('report',{kind='comment',id=c.id})end,5))end
    gap();k:line(content,'OnlineCommentRule'..i,P.surface);gap()
   end
   if model.commentCursor then button(content,L.t('Ещё комментарии'),'MoreComments','moreComments');gap()end
   input('comment',L.t('Ваш комментарий'),'',74);button(content,L.t('Отправить'),'Reply','reply',nil,P.accent,true)
  elseif model.mode=='edit'then
   button(content,L.t('Вход и восстановление'),'AccountAccess','accountAccess',nil,P.blue);gap(8)
   if not model.me.accountConfigured then label(L.t('Настройте логин и пароль до выхода из аккаунта.'),11,'AccountSetupHint',P.accent);gap(8)end
   if model.pendingAccount then input('accountUrl',L.t('Ссылка для браузера · Ctrl+A, Ctrl+C'),model.pendingAccount.url,62)end
   Kit.center(content,avatar(model.me,76,'EditAvatar'));gap(10)
   if model.info and model.info.features and model.info.features.avatars then
    button(content,L.t('Загрузить фото'),'UploadAvatar','uploadAvatar',nil,P.blue);gap(6)
    if model.me.avatarUrl then button(content,L.t('Удалить аватар'),'RemoveAvatar','removeAvatar',nil,P.muted);gap(6)end
    if model.pendingAvatar then
     label(L.t('Выберите фото в браузере. После загрузки аватар обновится здесь.'),11,'AvatarWaiting',P.muted);gap(6)
     input('avatarUrl',L.t('Ссылка для браузера · Ctrl+A, Ctrl+C'),model.pendingAvatar.uploadUrl,62)
    end
   end
   gap();label(L.t('ID аккаунта'),10,'AccountIdTitle',P.muted,true);gap(5);label('@'..model.me.username,16,'AccountId',P.ink,true);gap(5);label(L.t('Закреплён за аккаунтом. Изменение через модератора.'),11,'AccountIdHelp',P.muted);gap(20);input('name',L.t('Имя'),model.me.displayName);input('bio',L.t('О себе'),model.me.bio,90);button(content,L.t('Сохранить'),'SaveProfile','saveProfile',nil,P.accent,true)
  elseif model.mode=='setup'then
   gap();if model.me then label('@'..model.me.username,17,'SettingsAccount',P.ink,true);gap();button(content,L.t('Мои подписки'),'FollowingList','following');gap(8);button(content,L.t('Заблокированные аккаунты'),'OpenBlocks','blocks');gap(24)else label(L.t('Ваше сообщество'),20,'SetupTitle',P.ink,true);gap()end
   label(L.t('Язык'),13,'LanguageTitle',P.ink,true);gap(6)
   for _,choice in ipairs(L.choices())do button(content,(L.preference==choice[1]and'● 'or'○ ')..choice[2],'Language_'..choice[1],'language',choice[1]);gap(4)end
   label(L.t('Язык интерфейса Zoigram. Публикации и имена игроков не переводятся.'),10,'LanguageHelp',P.muted);gap(20)
   input('server',L.t('Адрес сервера Zoigram'),model.server,48);button(content,L.t('Подключиться'),'Connect','connect');gap(8)
   if model.info and model.info.environment=='local'then label(L.t('Локальное сообщество на этом компьютере.'),10,'LocalInfo',P.muted)end
   if model.me then gap(24);button(content,L.t('Выйти из аккаунта'),'Logout','logout',nil,P.accent)end
  elseif model.mode=='login'then
   empty(L.t('Жизнь. В вашем кадре.'),L.t('Фотографии, люди и моменты из inZOI.'))
   if model.pendingLogin then label(L.t('Код: {code}',{code=model.pendingLogin.userCode}),20,'LoginCode',P.accent,true);gap();input('loginUrl',L.t('Ссылка для браузера · Ctrl+A, Ctrl+C'),model.pendingLogin.verificationUrl,76);label(L.t('Войдите в Zoigram в браузере и вернитесь в игру.'),11,'LoginHelp',P.muted);gap();button(content,L.t('Открыть страницу входа'),'OpenLogin','openLogin',nil,P.accent,true);gap(8);button(content,L.t('Начать заново'),'CancelLogin','cancelLogin')
   else button(content,L.t('Войти / создать аккаунт'),'Login','login',nil,P.accent,true)end
   gap();label(L.t('Логин и пароль Zoigram. Без почты и Steam.'),10,'LoginPrivacy',P.muted)
  elseif model.mode=='report'then
   gap(22);Kit.center(content,k:box('OnlineReportEmblemSize',54,54,k:roundedPanel('OnlineReportEmblem',k:glyph('flag','OnlineReportFlag',26,P.accent),14,P.blush,18)))
   gap(16);content:AddChild(k:text(L.t('Отправить жалобу'),20,'OnlineReportTitle',P.ink,true));gap(10)
   content:AddChild(k:text(L.t('Жалоба попадёт только владельцу Zoigram. Игрок не увидит, кто её отправил.'),11,'OnlineReportPrivacy',P.muted,false,false,true));gap(20)
   input('reason',L.t('Что произошло?'),L.t('Спам или нежелательный контент'),105);button(content,L.t('Отправить жалобу'),'SendReport','sendReport',nil,P.accent,true);gap(8);button(content,L.t('Отмена'),'CancelReport','back')
   elseif model.mode=='following'or model.mode=='blocks'then
   gap();for i,p in ipairs(model.accounts or{})do button(content,p.displayName..' · @'..p.username,'FollowingAccount'..i,'profile',p.id);if model.mode=='blocks'then gap(4);button(content,L.t('Разблокировать'),'Unblock'..i,'unblock',p.id)end;gap()end
   if #(model.accounts or{})==0 then label(L.t('Здесь пока никого.'),13,'AccountsEmpty',P.muted)end
    if model.mode=='following'and model.accountsCursor then button(content,L.t('Показать ещё'),'MoreAccounts','moreAccounts')end
   end
   if model.restoreScroll then local offset=model.restoreScroll;model.restoreScroll=nil;pcall(function()self.scroll:SetScrollOffset(offset)end)end
   if model.mode=='messages'and model.scrollMessages then model.scrollMessages=false;pcall(function()self.scroll:ScrollToEnd()end)end
  end
 function page:reset()self.scroll:ScrollToStart()end
 function page:destroy()self:stopImages();if self.k then self.k:destroy();self.k=nil end;self.cache={};self.avatarCache={}end
 return page
end
return M
