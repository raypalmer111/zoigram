local Drafts=require('B1.Data.PostDrafts')
local Controller=require('B1.Online.Controller')
local Transport=require('B1.Online.Transport')
local Photo=require('B1.Game.PhotoFlow')
local Json=require('B1.Shared.Json')
local count=0
local function test(name,fn)fn();count=count+1;print('PASS '..name)end
local function storage()
 local files={};return {read=function(k)return files[k]and Json.decode(files[k])end,write=function(k,v)files[k]=Json.encode(v)end}
end
local function record()return {characterId='101',city='city',caption='Album 中文 🌆',photos={{photo='post_101_123_1.png'},{photo='post_101_123_2.png'}},requestId='stable_request',pending=true}end
test('Publication drafts restore ordered photos, Unicode captions and pending retry IDs',function()
 local s=storage();local d=Drafts.new(s,'https://one','account');assert(d:save(record()));local r=Drafts.new(s,'https://one','account'):get('101','city');assert(r.caption==record().caption and r.photos[2].photo=='post_101_123_2.png'and r.pending and r.requestId=='stable_request')
 assert(not Drafts.new(s,'https://two','account'):get('101','city'));assert(not Drafts.new(s,'https://one','other'):get('101','city'));assert(not d:get('102','city'));assert(not d:get('101','different-city'))
end)
test('Invalid file paths and write failures cannot replace the stored draft',function()
 local s=storage();local d=Drafts.new(s,'s','a');assert(d:save(record()));local bad=record();bad.photos[1].photo='../session.cfg';assert(not d:save(bad));assert(d:get('101','city').photos[1].photo==record().photos[1].photo)
 local write=s.write;s.write=function()error('full disk')end;local changed=record();changed.caption='New';assert(not d:save(changed));assert(d:get('101','city').caption==record().caption);assert(not d:clear('101','city'));s.write=write;assert(d:clear('101','city'));assert(not d:get('101','city'))
end)
local function fixture()
 local s=storage();Transport.read=s.read;Transport.write=s.write
 UE.UGameplayStatics={GetCurrentLevelName=function()return'city'end}
 local inputs={caption=''},c
 c=setmetatable({server='https://one',me={id='owner'},info={features={photoAlbums=true,postRequestLookup=true}},mode='create',transport={},posts={},history={},app={profile={characterId='101'},context={},refresh=function()end,view={getOnlineInput=function(_,k)return inputs[k]or''end,clearOnlineInput=function(_,k)inputs[k]=''end}}},Controller)
 c.draw=function()end;c.feed=function(self)self.mode='feed'end
 Photo.clear('101');c:create();inputs.caption=c.draft.caption
 local texture={IsValid=function()return true end,Blueprint_GetSizeX=function()return 128 end,Blueprint_GetSizeY=function()return 96 end}
 c.draft.photos={{photo='post_101_123_1.png',texture=texture,width=128,height=96},{photo='post_101_123_2.png',texture=texture,width=128,height=96}};return c,inputs,s
end
test('Caption saves before navigation and photo order and cover survive restarting the controller',function()
 local c,inputs,s=fixture();inputs.caption='My caption';assert(c:saveDraft());c.draftIndex=2;c:act('coverPhoto');assert(c.draft.photos[1].photo=='post_101_123_2.png')
 local r=Drafts.new(s,c.server,c.me.id):get('101','city');assert(r.caption=='My caption'and r.photos[1].photo=='post_101_123_2.png')
end)
test('Missing local photo files retain their slot and caption when a draft is restored',function()
 local c,inputs,s=fixture();inputs.caption='Keep';assert(c:saveDraft());Photo.clear('101');UE.UKismetRenderingLibrary={ImportFileAsTexture2D=function()return nil end};c:create();assert(#c.draft.photos==2 and c.draft.caption=='Keep'and not c.draft.photos[1].texture)
end)
test('Ambiguous upload freezes its payload and retry finds an already published post without reupload',function()
 local c,inputs,s=fixture();inputs.caption='Original';local original=Photo.exportOnline;Photo.exportOnline=function(_,p,i)return 'outgoing_'..i..'.png'end
 local requests={};c.request=function(self,method,p,body,callback,upload)requests[#requests+1]={path=p,body=body,callback=callback,upload=upload}end
 c:publish();assert(c.draft.pending);local id=c.draft.onlineRequest;assert(#requests[1].upload==2);assert(Drafts.new(s,c.server,c.me.id):get('101','city').requestId==id)
 c:publicationFailed(0,{submitted=true});inputs.caption='Changed while waiting';assert(c:saveDraft());assert(c.draft.caption=='Original');c:act('removePhoto');assert(#c.draft.photos==2)
 c:publish();assert(requests[2].path=='/api/posts/request/'..id);requests[2].callback({found=true,post={id=77}});assert(#requests==2 and c.mode=='feed'and c.draft==nil and inputs.caption=='');Photo.exportOnline=original
end)
test('A failed local read permits correction while a retry after no server match retains its request ID',function()
 local c,inputs=fixture();inputs.caption='Draft';local original=Photo.exportOnline;Photo.exportOnline=function(_,p,i)return 'outgoing_'..i..'.png'end
 local requests={};c.request=function(self,method,p,body,callback,upload)requests[#requests+1]={path=p,body=body,callback=callback}end
 c:publish();local id=c.draft.onlineRequest;c:publicationFailed(0,{submitted=true});c:publish();requests[2].callback({found=false});assert(requests[3].body.requestId==id and requests[3].body.caption=='Draft')
 c:publicationFailed(0,{submitted=false});assert(not c.draft.pending);inputs.caption='Corrected';c:saveDraft();assert(c.draft.onlineRequest==nil);Photo.exportOnline=original
end)
test('Failed autosave stops navigation and publish before any network request',function()
 local c,inputs=fixture();inputs.caption='Keep';Transport.write=function()error('disk unavailable')end;c.request=function()error('must not send')end;c:act('feed');assert(c.mode=='create'and c.error);c:publish();assert(not c.draft.pending)
end)
test('Returning from Photo Mode reloads released textures and publishing recovers another released texture',function()
 local c,inputs=fixture();local imported=0;local originalPath=Photo.path;Photo.path=function(name)return "/fixture/"..name end
 local texture={IsValid=function()return true end,Blueprint_GetSizeX=function()return 1920 end,Blueprint_GetSizeY=function()return 1080 end}
 UE.UKismetRenderingLibrary={ImportFileAsTexture2D=function()imported=imported+1;return texture end}
 local invalid={IsValid=function()return false end};c.draft.photos[1].texture=invalid;c.draft.photos[2].texture=invalid
 c:create();assert(imported==2 and c.draft.photos[1].texture==texture and c.draft.photos[1].width==1920)
 c:create();assert(imported==2,'Valid textures should not be reimported')
 c.draft.photos[2].texture=invalid;local original=Photo.exportOnline
 Photo.exportOnline=function(_,p,i)assert(p.texture==texture);return 'outgoing_'..i..'.png'end
 local sent=false;c.request=function()sent=true end;c:publish();Photo.exportOnline=original;Photo.path=originalPath;assert(imported==3 and sent)
end)
print('ALBUM_LUA_CHECKS='..count)
