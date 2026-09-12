local L=require('B1.Localization')
local Transport=require('B1.Online.Transport')
local Photo=require('B1.Game.PhotoFlow')
local M={};M.__index=M
function M.new(app)
 local config=Transport.read('config')or{};L.set('auto')
 return setmetatable({app=app,transport=Transport.new(),server=Transport.server(config.server)or'https://vps-24654da6.vps.ovh.net',mode='setup',scope='all',posts={},comments={},notifications={},conversations={},messages={},history={},tab='feed',revision=0,elapsed=0,activityElapsed=20,unreadNotifications=0,unreadMessages=0},M)
end
function M:draw()
 if self.pendingLogin and type(self.pendingLogin.verificationUrl)=='string'then self.pendingLogin.verificationUrl=self.pendingLogin.verificationUrl:gsub('&lang=[%w_%-]+','')..'&lang='..L.language end
 self.revision=self.revision+1;self.app.view:renderOnline(self)end
function M:input(name)return self.app.view:getOnlineInput(name)end
function M:request(method,path,body,success,upload,silent,quiet)
 if self.transport.pending then return end
 if not silent then self.busy=true;self.error=nil;self:draw()end
 self.transport:send(self.server,method,path,body,function(status,result)
  self.busy=false
  if status>=200 and status<300 then success(result)
  elseif status==401 then self.me=nil;self.pendingAvatar=nil;self.pendingAccount=nil;self.mode='login';self.error=result.messageKey or result.error
  elseif not quiet then self.error=result.messageKey or result.error or 'Нет связи с сервером. Попробуйте ещё раз.'end
  if not silent or self.error then self:draw()end
 end,upload)
end
function M:open()
 L.refresh()
 if not self.initialized then self.initialized=true;if self.server~=''then self:connect(self.server)else self:draw()end elseif self.pendingLogin then self:draw()elseif self.me then self.history={};self.tab='feed';self:feed(self.scope)else self:draw()end
end
function M:connect(value)
 local server=Transport.server(value)
 if not server then self.error='Укажите HTTPS-адрес сервера.';self:draw();return end
 if self.server~=server then self.searchQuery=nil;self.searchResults={};self.searchCursor=nil;self.searchPerformed=false;self.me=nil;self.posts={};self.comments={};self.notifications={};self.conversations={};self.messages={};self.unreadNotifications=0;self.unreadMessages=0 end;self.history={};self.pendingLogin=nil;self.pendingAvatar=nil;self.pendingAccount=nil;self.server=server;self.mode='setup'
 self:request('GET','/api/info',nil,function(info)
  if info.authentication~='password'or info.origin~=self.server then self.error='По этому адресу нет совместимого сервера Zoigram.';return end
  self.info=info;self:saveConfig();self.mode='login';self.pendingLogin=nil
  self:request('GET','/api/me',nil,function(r)self.me=r.profile;self.activityElapsed=20;self:feed('all')end)
 end)
end
function M:activity()
 if not self.me then return end
 self:request('GET','/api/activity',nil,function(r)
  local nextNotifications=r.unreadNotifications or 0;local nextMessages=r.unreadMessages or 0
  local changed=self.unreadNotifications~=nextNotifications or self.unreadMessages~=nextMessages
  local refreshNotifications=self.mode=='notifications'and nextNotifications>0 and self.unreadNotifications~=nextNotifications
  local refreshMessages=(self.mode=='messages'or self.mode=='conversations')and nextMessages>0 and self.unreadMessages~=nextMessages
  self.unreadNotifications=nextNotifications;self.unreadMessages=nextMessages
  if refreshNotifications then self.notifications={};self.notificationCursor=nil;self:notificationsPage(false)
  elseif refreshMessages and self.mode=='messages'then self.messages={};self.messageCursor=nil;self:thread(self.conversationId,false)
  elseif refreshMessages then self.conversations={};self.conversationCursor=nil;self:conversationsPage(false)
  elseif changed then self:draw()end
 end,nil,true,true)
end
function M:feed(scope,more)
 if not self.me then self.mode='login';self:draw();return end
 self.mode='feed';self.scope=scope or self.scope;self.selectedProfile=nil;self.profileId=nil;self.postMenu=nil
 local path='/api/feed?scope='..self.scope;if more and self.cursor then path=path..'&before='..self.cursor end
 self:request('GET',path,nil,function(r)
  if more then for _,post in ipairs(r.posts or{})do self.posts[#self.posts+1]=post end else self.posts=r.posts or{}end
  self.cursor=r.nextCursor
 end)
end
function M:saved(more)
 if not self.me then return end;self.mode='saved';self.postMenu=nil
 local path='/api/saved';if more and self.cursor then path=path..'?before='..self.cursor end
 self:request('GET',path,nil,function(r)if more then for _,p in ipairs(r.posts or{})do self.posts[#self.posts+1]=p end else self.posts=r.posts or{}end;self.cursor=r.nextCursor end)
end
function M:search(more)
 self.mode='search'
 local query=more and self.searchQuery or self:input('search');query=(query or''):gsub('^%s+',''):gsub('%s+$','')
 if not more then self.searchQuery=query;self.searchResults={};self.searchCursor=nil end
 if query==''then self.searchPerformed=false;self:draw();return end
 local encoded=query:gsub('[^%w%-_%.~]',function(c)return string.format('%%%02X',c:byte())end)
 local path='/api/profiles/search?q='..encoded;if more and self.searchCursor then path=path..'&after='..self.searchCursor end
 self:request('GET',path,nil,function(r)
  if more then for _,p in ipairs(r.profiles or{})do self.searchResults[#self.searchResults+1]=p end else self.searchResults=r.profiles or{}end
  self.searchCursor=r.nextCursor;self.searchPerformed=true
 end)
end
function M:profile(id,more)
 if not id then return end;self.mode='profile';self.profileId=id
 local function posts()local path='/api/feed?profile='..id;if more and self.cursor then path=path..'&before='..self.cursor end
  self:request('GET',path,nil,function(r)if more then for _,p in ipairs(r.posts or{})do self.posts[#self.posts+1]=p end else self.posts=r.posts or{}end;self.cursor=r.nextCursor end)
 end
 if more then posts()else self.posts={};self:request('GET','/api/profiles/'..id,nil,function(r)self.selectedProfile=r.profile;if self.me and id==self.me.id then self.me=r.profile end;posts()end)end
end
function M:discussion(post,more)
 self.mode='comments';self.selectedPost=post;local path='/api/posts/'..post.id..'/comments'
 if more and self.commentCursor then path=path..'?after='..self.commentCursor end
 self:request('GET',path,nil,function(r)self:replacePost(r.post);self.selectedPost=r.post;if more then for _,c in ipairs(r.comments or{})do self.comments[#self.comments+1]=c end else self.comments=r.comments or{}end;self.commentCursor=r.nextCursor end)
end
function M:notificationsPage(more)
 self.mode='notifications';local path='/api/notifications';if more and self.notificationCursor then path=path..'?before='..self.notificationCursor end
 self:request('GET',path,nil,function(r)
  if more then for _,n in ipairs(r.notifications or{})do self.notifications[#self.notifications+1]=n end else self.notifications=r.notifications or{}end
  self.notificationCursor=r.nextCursor;self.unreadNotifications=r.unread or 0
  if not more and self.unreadNotifications>0 and self.notifications[1]then
   local through=self.notifications[1].id;self:request('PUT','/api/notifications/read',{through=through},function(marked)self.unreadNotifications=marked.unread or 0;for _,n in ipairs(self.notifications)do if n.id<=through then n.isRead=true end end;self:draw()end,nil,true)
  end
 end)
end
function M:conversationsPage(more)
 self.mode='conversations';local path='/api/conversations';if more and self.conversationCursor then path=path..'?before='..self.conversationCursor end
 self:request('GET',path,nil,function(r)
  if more then for _,c in ipairs(r.conversations or{})do self.conversations[#self.conversations+1]=c end else self.conversations=r.conversations or{}end
  self.conversationCursor=r.nextCursor;self.unreadMessages=r.unread or 0
 end)
end
function M:thread(id,more)
 if not id then return end;self.mode='messages';self.conversationId=id;self.scrollMessages=not more;local path='/api/conversations/'..id..'/messages';if more and self.messageCursor then path=path..'?before='..self.messageCursor end
 self:request('GET',path,nil,function(r)
  self.selectedConversation=r.participant
  if more then local joined={};for _,message in ipairs(r.messages or{})do joined[#joined+1]=message end;for _,message in ipairs(self.messages)do joined[#joined+1]=message end;self.messages=joined else self.messages=r.messages or{}end
  self.messageCursor=r.nextCursor;self.unreadMessages=r.unread or self.unreadMessages
  self:request('PUT','/api/conversations/'..id..'/read',{},function(marked)self.unreadMessages=marked.unread or 0;for _,message in ipairs(self.messages)do if not message.outgoing then message.isRead=true end end;self:draw()end,nil,true)
 end)
end
function M:replacePost(post)
 local function update(state)
  for i,p in ipairs(state.posts or{})do if p.id==post.id then state.posts[i]=post end end
  if state.selectedPost and state.selectedPost.id==post.id then state.selectedPost=post end
 end
 update(self);for _,state in ipairs(self.history or{})do update(state)end
end
function M:create()
 if not self.me then self.mode='login';self:draw();return end
 self.app:refresh(false,0);self.mode='create';self.error=nil;self.draftAuthor=self.app.profile and self.app.profile.characterId
 self.draft=self.draftAuthor and Photo.getDraft(self.draftAuthor)
 if not self.draft and self.draftAuthor then
  local saved=Transport.read('draft')
  if saved and saved.characterId==self.draftAuthor and saved.accountId==self.me.id and saved.server==self.server and saved.city==UE.UGameplayStatics.GetCurrentLevelName(self.app.context,true)then
   local ok,texture=pcall(function()return UE.UKismetRenderingLibrary.ImportFileAsTexture2D(self.app.context,Photo.path(saved.photo))end)
   if ok and texture and texture:IsValid()then
    local d=Photo.draft(self.draftAuthor);d.photo=saved.photo;d.caption=saved.caption or'';d.texture=texture;d.width=texture:Blueprint_GetSizeX();d.height=texture:Blueprint_GetSizeY();d.onlineRequest=saved.requestId;d.onlineCaption=d.caption;d.onlineAccount=self.me.id;d.onlineServer=self.server;self.draft=d
   end
  end
 end
 self:draw()
end
function M:camera()
 if not self.me then return end;self.app:refresh(false,0);local author=self.app.profile and self.app.profile.characterId
 if not author then self.error='Дождитесь загрузки персонажа.';self:draw();return end
 local previous=Photo.getDraft(author);if previous then previous.caption=self:input('caption')end
 local ok,err=pcall(Photo.start,self.app.context,author)
 if ok then self.draftAuthor=author;self.app.onExit()
 else Photo.shutdown();self.error='Не удалось открыть фоторежим.';self:draw()end
end
function M:publish()
 self.app:refresh(false,0);local author=self.app.profile and self.app.profile.characterId
 local draft=author and Photo.getDraft(author)
 if not self.me or author~=self.draftAuthor or not draft or not draft.texture or not draft.texture:IsValid()then self.error='Сначала сохраните снимок для текущего персонажа.';self:draw();return end
 local caption=self:input('caption');if require('B1.Data.PhotoDraft').captionLength(caption)>2200 then self.error='Подпись должна быть не длиннее 2200 символов.';self:draw();return end
 draft.caption=caption
 if not draft.onlineRequest or draft.onlineCaption~=caption or draft.onlineAccount~=self.me.id or draft.onlineServer~=self.server then draft.onlineRequest=Transport.nonce();draft.onlineCaption=caption;draft.onlineAccount=self.me.id;draft.onlineServer=self.server end
 Transport.write('draft',{characterId=author,city=UE.UGameplayStatics.GetCurrentLevelName(self.app.context,true),photo=draft.photo,caption=caption,accountId=self.me.id,server=self.server,requestId=draft.onlineRequest})
 local ok,filename=pcall(Photo.exportOnline,self.app.context,draft)
 if not ok then self.error='Не удалось подготовить снимок для отправки.';self:draw();return end
 self:request('POST','/api/posts',{requestId=draft.onlineRequest,caption=caption},function(r)
  if Photo.getDraft(author)==draft then Photo.clear(author)end
  Transport.write('draft',{});self.draft=nil;self.app.view:clearOnlineInput('caption');self.history={};self.tab='feed';self.notice='Публикация добавлена.';self:feed('all')
 end,filename)
end
function M:openLogin()
 if not self.pendingLogin then return end
 local opened=pcall(function()
  local library=UE.UKismetSystemLibrary
  assert(library and library.LaunchURL,'External browser API unavailable')
  library.LaunchURL(self.pendingLogin.verificationUrl)
 end)
 if not opened then self.notice='Скопируйте ссылку ниже и откройте её в браузере.'end
 self:draw()
end
function M:saveDraft()
 if self.mode=='create'and self.draftAuthor then
  local value=self:input('caption');local d=Photo.getDraft(self.draftAuthor)
  if d or value~=''then d=d or Photo.draft(self.draftAuthor);d.caption=value end
 end
end
function M:uploadAvatar()
 if not self.me then return end
 self:request('POST','/api/me/avatar-upload',{},function(r)
  if type(r.expiresAt)~='number'or type(r.uploadUrl)~='string'or r.uploadUrl:sub(1,#self.server+13)~=self.server..'/avatar?lang='then self.error='Сервер вернул неверный адрес входа.';return end
  self.pendingAvatar=r;self.avatarBefore=self.me.avatarVersion;self.avatarElapsed=0
  pcall(function()UE.UKismetSystemLibrary.LaunchURL(r.uploadUrl)end)
 end)
end
function M:accountAccess()
 if not self.me then return end
 self:request('POST','/api/me/account-access',{},function(r)
  if type(r.url)~='string'or r.url:sub(1,#self.server+14)~=self.server..'/account?lang='then self.error='Сервер вернул неверный адрес входа.';return end
  self.pendingAccount=r;self.accountBefore=self.me.accountRevision or 0;pcall(function()UE.UKismetSystemLibrary.LaunchURL(r.url)end)
 end)
end
function M:snapshot()
 return {scrollOffset=self.app.view.page and self.app.view.page.scroll:GetScrollOffset()or 0,searchQuery=self.searchQuery,searchResults=self.searchResults,searchCursor=self.searchCursor,searchPerformed=self.searchPerformed,mode=self.mode,scope=self.scope,profileId=self.profileId,selectedProfile=self.selectedProfile,selectedPost=self.selectedPost,tab=self.tab,posts=self.posts,comments=self.comments,cursor=self.cursor,commentCursor=self.commentCursor,accounts=self.accounts,accountsCursor=self.accountsCursor,notifications=self.notifications,notificationCursor=self.notificationCursor,conversations=self.conversations,conversationCursor=self.conversationCursor,messages=self.messages,messageCursor=self.messageCursor,conversationId=self.conversationId,selectedConversation=self.selectedConversation}
end
function M:push()
 self.history=self.history or{};self.history[#self.history+1]=self:snapshot();if #self.history>8 then table.remove(self.history,1)end;self.postMenu=nil;self.profileMenu=nil
end
function M:restore(state,refresh)
 for _,key in ipairs({'searchQuery','searchResults','searchCursor','searchPerformed','mode','scope','profileId','selectedProfile','selectedPost','tab','posts','comments','cursor','commentCursor','accounts','accountsCursor','notifications','notificationCursor','conversations','conversationCursor','messages','messageCursor','conversationId','selectedConversation'})do self[key]=state[key]end
 self.restoreScroll=state.scrollOffset;self.postMenu=nil;self.deleteTarget=nil;self.profileMenu=nil
 if refresh and self.mode=='feed'then self:feed(self.scope)
 elseif refresh and self.mode=='profile'then self:profile(self.profileId)
 elseif refresh and self.mode=='saved'then self:saved(false)
 else self:draw()end
end
function M:saveConfig()
 local config=Transport.read('config')or{};config.server=self.server;config.language=L.preference;Transport.write('config',config)
end
function M:act(action,value)
 if self.transport.pending then return end
 self:saveDraft();self.error=nil;self.notice=nil
 if action=='language'then L.set(value);self:saveConfig();self:draw()
 elseif action=='back'then self:back()
 elseif action=='connect'then self:connect(self:input('server'))
 elseif action=='login'then
  self:request('POST','/api/auth/device',{},function(r)
   if type(r.verificationUrl)~='string'or r.verificationUrl:sub(1,#self.server+14)~=self.server..'/connect?code='then self.error='Сервер вернул неверный адрес входа.';return end
   self.pendingLogin=r;self.mode='login';self:openLogin()
  end)
 elseif action=='openLogin'then self:openLogin()
 elseif action=='cancelLogin'then self.pendingLogin=nil;self:draw()
 elseif action=='feed'then self.history={};self.tab='feed';self.postMenu=nil;self:feed(self.scope)
 elseif action=='saved'then self:push();self.posts={};self.cursor=nil;self:saved(false)
 elseif action=='savePost'then self:request(value.saved and'DELETE'or'PUT','/api/posts/'..value.id..'/save',{},function(r)
  self:replacePost(r.post);if not r.post.saved then
   local function remove(state)if state.mode=='saved'then for i=#(state.posts or{}),1,-1 do if state.posts[i].id==r.post.id then table.remove(state.posts,i)end end end end
   remove(self);for _,state in ipairs(self.history or{})do remove(state)end
  end
 end)
 elseif action=='location'then self.notice='Coming soon';self:draw()
 elseif action=='search'then self.history={};self.tab='search';self.mode='search';self:draw()
 elseif action=='runSearch'then self:search(false)
 elseif action=='moreSearch'then self:search(true)
 elseif action=='post'then self:request('GET','/api/posts/'..value.id,nil,function(r)self:push();self.selectedPost=r.post;self.mode='post'end)
 elseif action=='editPost'then
  if not self.me or value.author.id~=self.me.id then return end
  self:push();self.editTarget=value;self.mode='editPost';self:draw()
 elseif action=='saveCaption'then
  local target=self.editTarget;if not target or not self.me or target.author.id~=self.me.id then return end
  local caption=self:input('editCaption');if require('B1.Data.PhotoDraft').captionLength(caption)>2200 then self.error='Подпись должна быть не длиннее 2200 символов.';self:draw();return end
  self:request('PATCH','/api/posts/'..target.id,{caption=caption,expectedCaption=target.caption},function(r)
   self:replacePost(r.post);self.editTarget=nil;local previous=table.remove(self.history);self.notice='Подпись обновлена.'
   if previous then self:restore(previous,false)else self.selectedPost=r.post;self.mode='post'end
  end)
 elseif action=='scope'then self.history={};self.tab='feed';self.postMenu=nil;self:feed(value)
 elseif action=='refresh'then self.postMenu=nil;self:feed(self.scope)
 elseif action=='notifications'then if self.mode~='notifications'then self:push()end;self.notifications={};self.notificationCursor=nil;self:notificationsPage(false)
 elseif action=='moreNotifications'then self:notificationsPage(true)
 elseif action=='notification'then if value.postId then self:request('GET','/api/posts/'..value.postId,nil,function(r)self:push();self.comments={};self.commentCursor=nil;self:discussion(r.post)end)else self:act('profile',value.actor.id)end
 elseif action=='conversations'then if self.mode~='conversations'then self:push()end;self.conversations={};self.conversationCursor=nil;self:conversationsPage(false)
 elseif action=='moreConversations'then self:conversationsPage(true)
 elseif action=='conversation'then self:push();self.messages={};self.messageCursor=nil;self:thread(value,false)
 elseif action=='message'then local id=value or(self.selectedProfile and self.selectedProfile.id);if id then self:push();self.messages={};self.messageCursor=nil;self:thread(id,false)end
 elseif action=='moreMessages'then self:thread(self.conversationId,true)
 elseif action=='sendMessage'then
  local value=self:input('message');if self.messageText~=value then self.messageKey=Transport.nonce();self.messageText=value end
  self:request('POST','/api/conversations/'..self.conversationId..'/messages',{requestId=self.messageKey or Transport.nonce(),text=value},function(r)self.messages[#self.messages+1]=r.message;self.app.view:clearOnlineInput('message');self.messageText=nil;self.messageKey=nil;self.scrollMessages=true;self:draw()end)
 elseif action=='me'then self.history={};self.tab='me';if self.me then self:profile(self.me.id)else self.mode='login';self:draw()end
 elseif action=='create'then self.history={};self.tab='create';self:create()
 elseif action=='profile'then if self.mode~='profile'or self.profileId~=value then self:push();self:profile(value)end
 elseif action=='more'then if self.mode=='profile'then self:profile(self.profileId,true)elseif self.mode=='saved'then self:saved(true)else self:feed(self.scope,true)end
 elseif action=='camera'then self:camera()
 elseif action=='publish'then self:publish()
 elseif action=='postMenu'then self.postMenu=self.postMenu~=value.id and value.id or nil;self:draw()
 elseif action=='profileMenu'then self.profileMenu=not self.profileMenu;self:draw()
 elseif action=='comments'then self:push();self.comments={};self.commentCursor=nil;self:discussion(value)
 elseif action=='moreComments'then self:discussion(self.selectedPost,true)
 elseif action=='like'then self:request(value.liked and'DELETE'or'PUT','/api/posts/'..value.id..'/like',{},function(r)self:replacePost(r.post)end)
 elseif action=='reply'then
  local text=self:input('comment');if self.commentText~=text then self.commentKey=Transport.nonce();self.commentText=text end
  self:request('POST','/api/posts/'..self.selectedPost.id..'/comments',{requestId=self.commentKey or Transport.nonce(),text=text},function()self.app.view:clearOnlineInput('comment');self.commentText=nil;self:discussion(self.selectedPost)end)
 elseif action=='follow'then local p=self.selectedProfile;self:request(p.isFollowing and'DELETE'or'PUT','/api/profiles/'..p.id..'/follow',{},function(r)self.selectedProfile=r.profile end)
 elseif action=='edit'then self:push();self.mode='edit';self:draw()
 elseif action=='accountAccess'then self:accountAccess()
 elseif action=='uploadAvatar'then self:uploadAvatar()
 elseif action=='removeAvatar'then self:request('DELETE','/api/me/avatar',nil,function()self.pendingAvatar=nil;self:request('GET','/api/me',nil,function(r)self.me=r.profile;self.notice='Аватар удалён.'end)end)
 elseif action=='saveProfile'then self:request('PATCH','/api/me',{displayName=self:input('name'),bio=self:input('bio')},function(r)self.me=r.profile;table.remove(self.history);self:profile(r.profile.id)end)
 elseif action=='settings'then if self.mode~='setup'then self:push();self.mode='setup';self:draw()end
 elseif action=='logout'then self:request('DELETE','/api/session',nil,function()self.me=nil;self.searchQuery=nil;self.searchResults={};self.searchCursor=nil;self.searchPerformed=false;self.pendingLogin=nil;self.pendingAvatar=nil;self.pendingAccount=nil;self.posts={};self.comments={};self.notifications={};self.conversations={};self.messages={};self.unreadNotifications=0;self.unreadMessages=0;self.history={};self.mode='login'end)
 elseif action=='deletePost'then
  if not self.me or not value or value.author.id~=self.me.id then self.error='Можно удалить только свою публикацию.';self:draw();return end
  self:push();self.deleteTarget=value;self.mode='deletePost';self:draw()
 elseif action=='confirmDelete'then
  local target=self.deleteTarget
  if self.mode~='deletePost'or not self.me or not target or target.author.id~=self.me.id then return end
  self:request('DELETE','/api/posts/'..target.id,nil,function()
   self.deleteTarget=nil;self.postMenu=nil;self.selectedPost=nil;if self.app.view.invalidateOnlinePhoto then self.app.view:invalidateOnlinePhoto(target.id)end
   self.me.postCount=math.max(0,(self.me.postCount or 1)-1)
   for _,state in ipairs(self.history or{})do for i=#(state.posts or{}),1,-1 do if state.posts[i].id==target.id then table.remove(state.posts,i)end end end
   local previous=table.remove(self.history)
   while previous and (previous.mode=='post'or previous.mode=='comments')and previous.selectedPost and previous.selectedPost.id==target.id do previous=table.remove(self.history)end
   self.notice='Публикация удалена.'
   if previous then self:restore(previous,true)else self.tab='feed';self:feed(self.scope)end
  end)
 elseif action=='deleteComment'then self:request('DELETE','/api/comments/'..value.id,nil,function()self:discussion(self.selectedPost)end)
 elseif action=='report'then self:push();self.reportTarget=value;self.mode='report';self:draw()
 elseif action=='sendReport'then self:request('POST','/api/reports',{kind=self.reportTarget.kind,targetId=self.reportTarget.id,reason=self:input('reason')},function()self:back();self.notice='Жалоба отправлена.';self:draw()end)
 elseif action=='block'then local p=self.selectedProfile;if self.confirmBlock~=p.id then self.confirmBlock=p.id;self:draw()else self:request('PUT','/api/profiles/'..p.id..'/block',{},function()self.confirmBlock=nil;self.history={};self.tab='feed';self:feed(self.scope)end)end
 elseif action=='blocks'then self:push();self.mode='blocks';self:request('GET','/api/blocks',nil,function(r)self.accounts=r.profiles end)
 elseif action=='unblock'then self:request('DELETE','/api/profiles/'..value..'/block',nil,function()self:request('GET','/api/blocks',nil,function(r)self.accounts=r.profiles end)end)
 elseif action=='following'then self:push();self.mode='following';self:request('GET','/api/profiles/'..self.me.id..'/following',nil,function(r)self.accounts=r.profiles;self.accountsCursor=r.nextCursor end)
 elseif action=='moreAccounts'then self:request('GET','/api/profiles/'..self.me.id..'/following?after='..self.accountsCursor,nil,function(r)for _,p in ipairs(r.profiles)do self.accounts[#self.accounts+1]=p end;self.accountsCursor=r.nextCursor end)
 end
end
function M:back()
 if self.transport.pending then return true end
 self:saveDraft();self.error=nil;self.notice=nil
 local previous=table.remove(self.history or{})
 if previous then self:restore(previous,false);return true end
 if self.mode~='feed'and self.me then self.tab='feed';self:feed(self.scope);return true end
 return false
end
function M:tick(dt)
 self.languageElapsed=(self.languageElapsed or 0)+(dt or 0);if self.languageElapsed>=2 then self.languageElapsed=0;if L.refresh()then self:draw()end end
 self.transport:tick(dt);self.elapsed=self.elapsed+(dt or 0);self.activityElapsed=self.activityElapsed+(dt or 0)
 if self.pendingAccount and self.me and self.elapsed>=3 and not self.transport.pending then
  self.elapsed=0;if os.time()*1000>self.pendingAccount.expiresAt then self.pendingAccount=nil else self:request('GET','/api/me',nil,function(r)self.me=r.profile;if (r.profile.accountRevision or 0)~=self.accountBefore then self.pendingAccount=nil;self.notice='Вход настроен. Сохраните резервный код в браузере.';self:draw()end end,nil,true,true)end
 end
 if self.pendingAvatar and self.me then
  self.avatarElapsed=(self.avatarElapsed or 0)+(dt or 0)
  if os.time()*1000>self.pendingAvatar.expiresAt then self.pendingAvatar=nil;self:draw()
  elseif self.avatarElapsed>=3 and not self.transport.pending then
   self.avatarElapsed=0
   self:request('GET','/api/me',nil,function(r)
    self.me=r.profile
    if r.profile.avatarVersion~=self.avatarBefore then
     self.pendingAvatar=nil;self.notice='Аватар обновлён.'
     if self.selectedProfile and self.selectedProfile.id==self.me.id then self.selectedProfile=r.profile end
     self:draw()
    end
   end,nil,true,true)
  end
 end
 if self.pendingLogin and self.elapsed>=2 and not self.transport.pending then
  self.elapsed=0;if os.time()*1000>self.pendingLogin.expiresAt then self.pendingLogin=nil;self.error='Код входа истёк. Начните заново.';self:draw();return end
  self:request('POST','/api/auth/poll',{deviceToken=self.pendingLogin.deviceToken},function(r)if r.status=='complete'then self.pendingLogin=nil;self.me=r.profile;self:feed('all')end end,nil,true)
 end
 if self.me and not self.pendingLogin and self.activityElapsed>=20 and not self.transport.pending then self.activityElapsed=0;self:activity()end
end
function M:dispose()self.pendingAvatar=nil;self.pendingAccount=nil;self.transport:dispose()end
return M
