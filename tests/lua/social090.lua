local Controller=require('B1.Online.Controller')
UE.FLinearColor=function()return{}end
local Kit=require('B1.UI.WidgetKit')
local count=0
local function test(name,fn)fn();count=count+1;print('PASS '..name)end
local function fixture()
 local c,clock={},{time=1000000};local sent={};local inputs={comment='Keep @friend',caption='My draft'}
 c=setmetatable({server='https://community.example',me={id='owner'},info={features={mediaRefresh=true,pinnedPosts=true}},mode='comments',history={},posts={},comments={},mediaClock=function()return clock.time end,
  app={view={page={scroll={GetScrollOffset=function()return 143 end}},getOnlineInput=function(_,key)return inputs[key]or''end}},transport={}},Controller)
 c.draw=function(self)self.draws=(self.draws or 0)+1 end;c.saveDraft=function()return true end
 c.transport.send=function(self,server,method,path,body,callback)
  assert(not self.pending);self.pending=true;sent[#sent+1]={server=server,method=method,path=path,body=body,callback=callback};return true
 end
 local function respond(status,result)
  local item=sent[#sent];c.transport.pending=nil;item.callback(status,result)
 end
 return c,sent,respond,clock,inputs
end
local function post(id,expires)
 return {id=id,author={id='author',username='author'},caption='Keep caption',createdAt=id,likes=8,thumbnailUrl='old-thumb-'..id,imageUrl='old-image-'..id,mediaExpiresAt=expires or 900000,photos={{thumbnailUrl='old-photo-thumb',imageUrl='old-photo-image'}}}
end
local function renewed(p,expires)
 return {id=p.id,author=p.author,caption='Server copy must not replace edited context',likes=99,thumbnailUrl='renewed-thumb-'..p.id,imageUrl='renewed-image-'..p.id,mediaExpiresAt=expires or 1900000,photos={{thumbnailUrl='renewed-photo-thumb',imageUrl='renewed-photo-image'}}}
end
test('Expired cover, album and avatar grants coalesce and refresh history without changing UI or drafts',function()
 local c,sent,respond,clock,inputs=fixture();local p=post(1);local a={id='author',username='author',avatarVersion=1,avatarUrl='old-avatar',avatarExpiresAt=900000}
 p.author=a;c.posts={p};c.selectedPost=p;c.comments={{id=8,author=a,text='Keep comment'}};c.draft={caption='Local unsent'}
 local historical=post(1);c.history={{mode='profile',posts={historical},selectedProfile=a}}
 for i=1,20 do assert(not c:mediaReady('post',p));assert(not c:mediaReady('profile',a))end
 c:refreshMediaTick();assert(#sent==1 and #sent[1].body.postIds==1 and #sent[1].body.profileIds==1)
 assert(sent[1].method=='POST'and sent[1].path=='/api/media/refresh');c:refreshMediaTick();assert(#sent==1)
 respond(200,{posts={renewed(p)},profiles={{id='author',username='author',avatarVersion=2,avatarUrl='new-avatar',avatarExpiresAt=1900000}}})
 assert(p.thumbnailUrl=='renewed-thumb-1'and historical.thumbnailUrl==p.thumbnailUrl and p.photos[1].imageUrl=='renewed-photo-image')
 assert(a.avatarUrl=='new-avatar'and a.avatarVersion==2 and c:mediaReady('post',p)and c:mediaReady('profile',a))
 assert(p.caption=='Keep caption'and p.likes==8 and c.mode=='comments'and c.selectedPost==p and c.restoreScroll==143)
 assert(inputs.comment=='Keep @friend'and c.draft.caption=='Local unsent'and #c.history==1)
end)
test('Media refresh batches have at most 30 targets and bounded queue state',function()
 local c,sent,respond=fixture();for i=1,65 do local p=post(i);c.posts[#c.posts+1]=p;c:mediaReady('post',p)end
 c:refreshMediaTick();assert(#sent[1].body.postIds==30);respond(200,{posts={}});c:refreshMediaTick();assert(#sent[2].body.postIds==30);respond(200,{posts={}});c:refreshMediaTick();assert(#sent[3].body.postIds==5);respond(200,{posts={}})
 c:refreshMediaTick();assert(#sent==3)
 for i=100,500 do c:mediaReady('post',post(i))end;assert(#c.mediaState.order==256)
end)
test('Missing and inaccessible media is not requested repeatedly or replaced by another target',function()
 local c,sent,respond=fixture();local p=post(1);c.posts={p};assert(not c:mediaReady('post',p));c:refreshMediaTick()
 respond(200,{posts={renewed(post(2))},unavailablePostIds={1}});for i=1,5 do assert(not c:mediaReady('post',p));c:refreshMediaTick()end
 assert(#sent==1 and p.thumbnailUrl=='old-thumb-1');local external=renewed(p);p.thumbnailUrl=external.thumbnailUrl;p.mediaExpiresAt=external.mediaExpiresAt
 assert(c:mediaReady('post',p),'Explicit new API media can recover an unavailable old grant')
end)
test('Failed refresh backs off and stops after two attempts; explicit refresh permits retry',function()
 local c,sent,respond,clock=fixture();local p=post(1);c.posts={p};c:mediaReady('post',p);c:refreshMediaTick();respond(503,{})
 for i=1,10 do c:mediaReady('post',p);c:refreshMediaTick()end;assert(#sent==1)
 clock.time=clock.time+60000;c:refreshMediaTick();assert(#sent==2);respond(0,{})
 clock.time=clock.time+60000;for i=1,10 do c:mediaReady('post',p);c:refreshMediaTick()end;assert(#sent==2)
 c:resetMedia();c:mediaReady('post',p);c:refreshMediaTick();assert(#sent==3)
end)
test('Repeated UMG download failures have only two automatic renewals until a successful texture',function()
 local c,sent,respond=fixture();local p=post(1,1900000);c.posts={p};assert(c:mediaReady('post',p))
 for attempt=1,2 do
  c:mediaFailed('post',p);assert(not c:mediaReady('post',p));c:refreshMediaTick();assert(#sent==attempt)
  local r=renewed(p);r.thumbnailUrl='retry-'..attempt;respond(200,{posts={r}});assert(c:mediaReady('post',p))
 end
 c:mediaFailed('post',p);for i=1,20 do assert(not c:mediaReady('post',p));c:refreshMediaTick()end;assert(#sent==2)
 c:mediaLoaded('post',p);assert(c:mediaReady('post',p))
end)
test('A successful album cover cannot reset failed second-photo retry limits',function()
 local c,sent,respond=fixture();local p=post(1,1900000);c.posts={p}
 for attempt=1,2 do
  c:mediaFailed('post',p,2);c:mediaLoaded('post',p,1)
  assert(c:mediaReady('post',p,1)and not c:mediaReady('post',p,2));c:refreshMediaTick();assert(#sent==attempt)
  local r=renewed(p);r.thumbnailUrl='album-attempt-'..attempt;respond(200,{posts={r}})
  assert(c:mediaReady('post',p,2));c:mediaLoaded('post',p,1)
 end
 c:mediaFailed('post',p,2)
 for i=1,20 do c:mediaLoaded('post',p,1);assert(not c:mediaReady('post',p,2));c:refreshMediaTick()end
 assert(#sent==2);c:mediaLoaded('post',p,2);assert(c:mediaReady('post',p,2))
end)
test('Server time corrects a fast local clock without weakening the actual media expiry',function()
 local c,sent,respond,clock=fixture();clock.time=100000000;local p=post(1);c.posts={p};assert(not c:mediaReady('post',p));c:refreshMediaTick()
 respond(200,{posts={renewed(p,1900000)},serverTime=1000000});assert(c:mediaReady('post',p))
 clock.time=clock.time+880000;assert(not c:mediaReady('post',p));c:refreshMediaTick();assert(#sent==2)
end)
test('Refreshing cannot write old account grants after server, account or session changes',function()
 for _,change in ipairs({'account','server','session'})do
  local c,sent,respond=fixture();local p=post(1);c.posts={p};c:mediaReady('post',p);c:refreshMediaTick()
  if change=='account'then c.me={id='other'}elseif change=='server'then c.server='https://other.example'else c:resetMedia()end
  respond(200,{posts={renewed(p)}});assert(p.thumbnailUrl=='old-thumb-1'and not c.draws)
 end
end)
test('Unauthenticated refresh closes the session and a malformed expiry cannot cause retry storms',function()
 local c,sent,respond=fixture();local p=post(1);c.posts={p};c:mediaReady('post',p);c:refreshMediaTick();respond(401,{error='Expired'})
 assert(c.me==nil and c.mode=='login'and c.error=='Expired'and #c.posts==0 and #c.history==0 and c.selectedPost==nil);c:refreshMediaTick();assert(#sent==1)
 c,sent,respond=fixture();p=post(1);c.posts={p};c:mediaReady('post',p);c:refreshMediaTick();local r=renewed(p);r.mediaExpiresAt=nil;respond(200,{posts={r}})
 for i=1,10 do assert(not c:mediaReady('post',p));c:refreshMediaTick()end;assert(#sent==1)
end)
test('Profile pages prepend pins only on the first page and never duplicate posts on pagination',function()
 local c=fixture();local calls={};c.request=function(self,method,path,body,success)calls[#calls+1]=path
  if path=='/api/profiles/owner'then success({profile={id='owner'}})
  elseif path=='/api/feed?profile=owner'then success({pinnedPosts={{id=8,pinned=true}},posts={{id=10},{id=8},{id=9}},nextCursor='9'})
  else assert(path=='/api/feed?profile=owner&before=9');success({posts={{id=8},{id=7}},nextCursor=nil})end
 end
 c:profile('owner');assert(#c.posts==3 and c.posts[1].id==8 and c.posts[2].id==10 and c.cursor=='9')
 c:profile('owner',true);assert(#c.posts==4 and c.posts[4].id==7 and c.cursor==nil)
end)
test('Pin and unpin update profile ordering while retaining feed order, history and scroll',function()
 local c=fixture();c.mode='post';local a,b=post(10),post(5);a.author.id='owner';b.author.id='owner';c.posts={a,b};c.selectedPost=b
 local profile={mode='profile',profileId='owner',posts={a,b},cursor='5',scrollOffset=222};local feed={mode='feed',posts={a,b}};c.history={profile,feed}
 local methods={};c.request=function(self,method,path,body,callback)
  methods[#methods+1]=method;assert(path=='/api/posts/5/pin');local changed=post(5);changed.author.id='owner';changed.pinned=method=='PUT';changed.pinnedAt=changed.pinned and 90 or nil;callback({post=changed})
 end
 c:pinPost(b);assert(methods[1]=='PUT'and profile.posts[1].id==5 and feed.posts[1].id==10 and c.selectedPost.pinned)
 assert(c.mode=='post'and profile.cursor=='5'and profile.scrollOffset==222 and c.restoreScroll==143)
 c:pinPost(c.selectedPost);assert(methods[2]=='DELETE'and profile.posts[1].id==10 and not c.selectedPost.pinned)
 c:pinPost({id=99,author={id='other'}});assert(#methods==2)
end)
test('Caption mentions open the post and comment mentions jump directly to the target without extra pages',function()
 local c=fixture();local calls={};c.mode='notifications';c.notifications={{id=8}}
 c.request=function(self,method,path,body,success)
  calls[#calls+1]=path
  if path=='/api/posts/10'then success({post=post(10)})
  elseif path=='/api/posts/10/comments?after=76'then success({post=post(10),comments={{id=77,text='@owner hello'}},nextCursor=nil})
  elseif path=='/api/posts/10/comments'then success({post=post(10),comments={{id=1,text='earlier'}},nextCursor=nil})else error(path)end
 end
 c:act('notification',{kind='mention',postId=10});assert(c.mode=='post'and c.selectedPost.id==10 and #calls==1)
 c.mode='notifications';c:act('notification',{kind='mention',postId=10,commentId=77});assert(c.mode=='comments'and c.focusCommentId==77 and c.comments[1].id==77 and #calls==3)
 local saved=c:snapshot();c.focusCommentId=nil;c:restore(saved,false);assert(c.focusCommentId==77)
 c:act('allComments');assert(c.focusCommentId==nil and c.comments[1].id==1 and #calls==4)
end)
test('429 retry timing is localized and rounded up without changing the failed draft',function()
 local c,sent,respond=fixture();c.draft={caption='Keep'};c:request('POST','/api/posts',{},function()error('Must fail')end)
 respond(429,{error='Slow down',retryAfter=2.4});assert(c.error:find('3',1,true)and c.draft.caption=='Keep')
end)
test('Avatar photo masks use true rounded image brushes while preserving the texture resource',function()
 UE.FVector4=function(a,b,c,d)return {X=a,Y=b,Z=c,W=d}end
 local image={Brush={ResourceObject='avatar texture',OutlineSettings={Width=4}}};image.SetBrush=function(self,brush)self.Brush=brush end
 Kit:roundImage(image,18);assert(image.Brush.ResourceObject=='avatar texture'and image.Brush.DrawAs==4)
 local o=image.Brush.OutlineSettings;assert(o.RoundingType==0 and o.Width==0 and o.CornerRadii.X==18 and o.CornerRadii.W==18)
end)
print('SOCIAL_090_LUA_CHECKS='..count)
