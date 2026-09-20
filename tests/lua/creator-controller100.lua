-- Controller integration checks use delayed native callbacks; they do not prove
-- the real engine effect, which is checked independently in a loaded world.
local Controller=require('B1.Online.Controller')
local Power=require('B1.Game.CreatorPower')
local Diagnostics=require('B1.Core.Diagnostics')
local savedDiagnosticEmit=Diagnostics.emit
local saved={enabled=Power.enabled,selectedEntity=Power.selectedEntity,inspect=Power.inspect,activate=Power.activate,shutdown=Power.shutdown}
local count=0
local function test(name,fn)fn();count=count+1;print('PASS '..name)end
local function fixture()
 local sent,native,reads,entity={},{},{},'1001';local applied=0
 local c=setmetatable({server='https://community.example',me={id='creator-account',creator=true},profileId='creator-account',mode='profile',info={features={creatorPower=true}},history={},posts={},comments={},creatorPowerElapsed=5,
  app={opened=true,context={},view={page={},getOnlineInput=function()return''end}},transport={}},Controller)
 c.draw=function(self)self.draws=(self.draws or 0)+1 end;c.saveDraft=function()return true end;c.transport.dispose=function(self)self.pending=nil end
 c.transport.send=function(self,server,method,path,body,callback)
  assert(not self.pending);local item={server=server,method=method,path=path,body=body,callback=callback};self.pending=item;sent[#sent+1]=item;return true
 end
 Power.enabled=true;Power.selectedEntity=function()return entity end
 Power.inspect=function(context,callback)reads[#reads+1]=callback end
 Power.activate=function(context,grant,callback,isCurrent)native[#native+1]={grant=grant,callback=callback,guard=isCurrent}end
 Power.shutdown=function()error('Closing a phone must not remove a finite native effect')end
 Diagnostics.emit=function()end
  local function grant(changes)local r={ability='filming_learning',profileId='creator-account',multiplier=1.1,durationGameMinutes=60,definitionsReady=true};for k,v in pairs(changes or{})do r[k]=v end;return r end
 local function respond(status,value,index)local request=sent[index or #sent];if c.transport.pending==request then c.transport.pending=nil end;request.callback(status,value)end
 local function complete(index)
  local operation=native[index or #native];if operation.guard()then applied=applied+1;operation.callback(true,{available=true,active=true,entityId=entity,remainingGameMinutes=60})else operation.callback(false,{reason='operation_cancelled'})end
 end
 return c,sent,native,reads,respond,grant,complete,function(value)entity=value end,function()return applied end
end

test('Creator activation obtains a fresh fixed server grant and blocks duplicate clicks',function()
 local c,sent,native,reads,respond,grant,complete,_,applied=fixture()
 c:activateCreatorPower();c:activateCreatorPower();assert(#sent==1 and #native==0 and c.creatorPowerBusy)
 assert(sent[1].method=='GET'and sent[1].path=='/api/me/creator-power'and sent[1].body==nil)
 respond(200,grant({command='must not enter the engine'}));assert(#native==1 and native[1].guard()and native[1].grant.command==nil)
 c:activateCreatorPower();assert(#sent==1 and #native==1);complete();assert(applied()==1 and not c.creatorPowerBusy and c.creatorPowerState.active)
 c:activateCreatorPower();assert(#sent==1 and applied()==1 and c.notice=='Суперспособность уже активна.')
 c.creatorPowerState={available=true,active=false,entityId='1001'};c:activateCreatorPower();assert(#sent==2,'An expired effect needs a new permission request')
end)
test('Client rejects grants for another account or changed ability parameters',function()
  for _,changed in ipairs({{profileId='another-account'},{ability='money'},{multiplier=999},{durationGameMinutes=600},{definitionsReady=false}})do
  local c,sent,native,reads,respond,grant=fixture();c:activateCreatorPower();respond(200,grant(changed));assert(#native==0 and not c.creatorPowerBusy and c.error=='Сервер вернул неверное разрешение суперспособности.')
 end
end)
test('Revoked Creator and expired session responses never reach the native effect',function()
 for _,status in ipairs({403,401})do local c,sent,native,reads,respond=fixture();c:activateCreatorPower();respond(status,{messageKey='Суперспособность доступна только креаторам.'});assert(#native==0 and not c.creatorPowerBusy);if status==401 then assert(c.me==nil and c.mode=='login')else assert(c.me.id=='creator-account'and c.error)end end
end)
test('Delayed permission cannot cross account, server, connection, phone or disposal boundaries',function()
 for _,change in ipairs({'account','account-revision','server','connect','phone','dispose','session'})do
  local c,sent,native,reads,respond,grant=fixture();c:activateCreatorPower()
  if change=='account'then c.me={id='other',creator=true}
  elseif change=='account-revision'then c.me.accountRevision=1
  elseif change=='server'then c.server='https://other.example'
  elseif change=='connect'then c:connect(c.server)
  elseif change=='phone'then c:onPhoneClose();c.app.opened=false;c.app.opened=true
  elseif change=='dispose'then c:dispose()
  else c:sessionEnded({error='Session ended'})end
  respond(200,grant(),1);assert(#native==0 and not c.creatorPowerBusy,change)
 end
end)
test('A changed selected Zoi invalidates both the HTTP and delayed native stages',function()
 local c,sent,native,reads,respond,grant,complete,setEntity,applied=fixture();c:activateCreatorPower();setEntity('1002');respond(200,grant());assert(#native==0 and not c.creatorPowerBusy and c.notice)
 c,sent,native,reads,respond,grant,complete,setEntity,applied=fixture();c:activateCreatorPower();respond(200,grant());setEntity('1002');assert(not native[1].guard());complete();assert(applied()==0 and not c.creatorPowerBusy and c.notice)
end)
test('Logout and close cancel delayed native activation without touching an existing effect',function()
 for _,change in ipairs({'logout','close','dispose'})do
  local c,sent,native,reads,respond,grant,complete,_,applied=fixture();c:activateCreatorPower();respond(200,grant())
  if change=='logout'then c:act('logout')elseif change=='close'then c:onPhoneClose();c.app.opened=false else c:dispose()end
  assert(not native[1].guard());complete();assert(applied()==0 and not c.creatorPowerBusy)
 end
 local c,sent,native,reads,respond,grant,complete,_,applied=fixture();c:activateCreatorPower();respond(200,grant());complete();assert(applied()==1);c:onPhoneClose();c:dispose();assert(applied()==1)
end)
test('Permissions and release gates prevent activation for ordinary or foreign profiles',function()
 for _,change in ipairs({'ordinary','foreign-profile','client-gate','server-gate','closed','no-character'})do
  local c,sent,native,reads,respond,grant,complete,setEntity=fixture()
  if change=='ordinary'then c.me.creator=false elseif change=='foreign-profile'then c.profileId='another'
  elseif change=='client-gate'then Power.enabled=false elseif change=='server-gate'then c.info.features.creatorPower=false
  elseif change=='closed'then c.app.opened=false else setEntity(nil)end
  c:activateCreatorPower();assert(#sent==0 and #native==0,change)
 end
end)
test('Native state polling is visible-only, bounded and redraws only meaningful state changes',function()
 local c,sent,native,reads=fixture();c:refreshCreatorPower(false);assert(#reads==1)
 for i=1,30 do c:refreshCreatorPower(false)end;assert(#reads==1)
 reads[1](true,{available=true,active=false,entityId='1001'});assert(c.draws==1 and c.creatorPowerState.available)
 c.creatorPowerElapsed=4.9;c:refreshCreatorPower(false);assert(#reads==1);c.creatorPowerElapsed=5;c:refreshCreatorPower(false);assert(#reads==2)
 reads[2](true,{available=true,active=false,entityId='1001'});assert(c.draws==1)
 c.creatorPowerElapsed=5;c:refreshCreatorPower(false);reads[3](true,{available=true,active=true,entityId='1001',remainingGameMinutes=40.8});assert(c.draws==2)
 c.creatorPowerElapsed=5;c:refreshCreatorPower(false);reads[4](true,{available=true,active=true,entityId='1001',remainingGameMinutes=40.1});assert(c.draws==2)
 c.creatorPowerElapsed=5;c.mode='feed';c:refreshCreatorPower(false);assert(#reads==4);c.mode='profile';c.app.opened=false;c:refreshCreatorPower(true);assert(#reads==4)
end)
test('Stale native inspection does not overwrite a new account and cannot overlap activation',function()
 local c,sent,native,reads=fixture();c:refreshCreatorPower(true);c:activateCreatorPower();assert(#sent==0)
 c:onPhoneClose();c.app.opened=true;c:refreshCreatorPower(true);assert(#reads==2)
 reads[1](true,{available=true,active=true,remainingGameMinutes=60});assert(c.creatorPowerState==nil)
 reads[2](true,{available=true,active=false});assert(c.creatorPowerState.available and not c.creatorPowerState.active)
end)

test('Close and reopen during Creator authorization sends a fresh feed and ignores the old response',function()
 local c,sent,native,reads,respond,grant=fixture();c.initialized=true;c.scope='all'
 c:activateCreatorPower();local old=sent[1];assert(c.transport.pending==old and c.creatorPowerBusy)
 c.app.opened=false;c:onPhoneClose();assert(c.transport.pending==nil and not c.creatorPowerBusy)
 c.app.opened=true;c:open();assert(#sent==2 and sent[2].path=='/api/feed?scope=all'and c.mode=='feed'and c.busy)
 local current=c.transport.pending;local draws=c.draws
 respond(200,grant(),1);assert(c.transport.pending==current and #native==0 and c.draws==draws and not c.creatorPowerBusy)
 respond(200,{posts={}},2);assert(not c.busy and c.transport.pending==nil and c.mode=='feed'and c.draws>draws)
end)

test('Closing during native readback preserves an unrelated upload and an already applied finite effect',function()
 local c,sent,native,reads,respond,grant,complete,_,applied=fixture()
 c:activateCreatorPower();respond(200,grant());assert(#native==1 and c.transport.pending==nil)
 local upload={id='photo-upload',upload={'outgoing_1.png'}};c.transport.pending=upload
 c:onPhoneClose();assert(c.transport.pending==upload and not c.creatorPowerBusy)
 native[1].callback(true,{available=true,active=true,entityId='1001',remainingGameMinutes=60})
 assert(c.transport.pending==upload and c.creatorPowerState==nil,'A stale completion must not cancel the upload or repaint the closed phone')
 c,sent,native,reads,respond,grant,complete,_,applied=fixture();c:activateCreatorPower();respond(200,grant());complete();assert(applied()==1)
 c.transport.pending=upload;c:onPhoneClose();assert(applied()==1 and c.transport.pending==upload)
end)

test('Reopening an available profile re-enables its button after unchanged native readback without rebuilding photos',function()
 local Page=require('B1.UI.Pages.OnlinePage')
 local c,sent,native,reads,respond=fixture();local page=c.app.view.page
 page.updateCreatorPowerButton=Page.updateCreatorPowerButton
 c.creatorPowerState={available=true,active=false,entityId='1001'}
 c.draw=function(self)
  self.draws=(self.draws or 0)+1
  page.creatorPowerButton={IsValid=function()return true end,SetIsEnabled=function(button,value)button.enabled=value end}
  page:updateCreatorPowerButton(self)
 end
 c:draw();assert(page.creatorPowerButton.enabled)
 c:profile(c.me.id)
 respond(200,{profile={id='creator-account',creator=true,isSelf=true}})
 respond(200,{posts={}})
 assert(#reads==1 and c.creatorPowerInspect and not page.creatorPowerButton.enabled)
 local button,draws=page.creatorPowerButton,c.draws
 reads[1](true,{available=true,active=false,entityId='1001'})
 assert(button.enabled and page.creatorPowerButton==button and c.draws==draws,'Identical readback must update only the existing button')
 c.creatorPowerElapsed=5;c:refreshCreatorPower(false);assert(not button.enabled)
 c:onPhoneClose();c.app.opened=false;reads[2](true,{available=true,active=false,entityId='1001'})
 assert(not button.enabled and c.draws==draws,'Closed phone must not receive a stale enable update')
end)

test('Silent activity cannot overwrite the visible status while foreground upload progress still updates',function()
 local c,sent,native,reads,respond=fixture();local progressCalls=0;local status='Ready';local draws=0
 c.elapsed=0;c.activityElapsed=0;c.unreadNotifications=0;c.unreadMessages=0
 c.transport.tick=function()end;c.refreshMediaTick=function()end;c.refreshCreatorPower=function()end
 c.app.view.page.setProgress=function(_,value)progressCalls=progressCalls+1;status=value.messageKey end
 c.draw=function(self)draws=draws+1;status=self.busy and'Visible loading'or(self.notice or'Ready')end
 c:activity();assert(#sent==1 and sent[1].path=='/api/activity')
 c.transport.pending.progress={messageKey='Загрузка…'};c:tick(.3)
 assert(progressCalls==0 and status=='Ready','A silent request must not leave a visible Loading status')
 respond(200,{unreadNotifications=0,unreadMessages=0});assert(draws==0 and status=='Ready'and not c.transport.pending)
 local finished=false;c:request('POST','/api/posts',{},function()finished=true;c.notice='Posted'end,{'outgoing_1.png'})
 assert(c.busy and status=='Visible loading');c.transport.pending.progress={messageKey='Отправка фотографии…',percent=50};c:tick(.3)
 assert(progressCalls==1 and status=='Отправка фотографии…','Foreground photo progress must remain visible')
 c:activity();assert(#sent==2 and status=='Отправка фотографии…','A silent poll cannot clear or replace an in-flight upload')
 respond(201,{post={id=1}});assert(finished and not c.busy and status=='Posted')
 c:activity();c.transport.pending.progress={messageKey='Загрузка…'};c:tick(.3);respond(200,{unreadNotifications=0,unreadMessages=0})
 assert(progressCalls==1 and status=='Posted','A completed visible action retains its status across silent polling')
end)

test('Creator failure diagnostics contain a fixed reason without account or native payload data',function()
 for _,value in ipairs({'effect_verification_failed','game_reply_timeout','profile-private-id token-private-value',false})do
  local c,sent,native,reads,respond,grant=fixture();local logs={}
  Diagnostics.emit=function(message,detail)logs[#logs+1]={message=message,detail=detail}end
  c:activateCreatorPower();respond(200,grant());native[1].callback(false,{reason=value,profileId='private-id',message='private payload'})
  assert(#logs==1 and logs[1].message=='Creator power activation failed')
  assert(logs[1].detail==((value=='effect_verification_failed'or value=='game_reply_timeout')and value or'unknown'))
  assert(not c.creatorPowerBusy and c.error)
 end
 local c,sent,native,reads,respond,grant=fixture();Diagnostics.emit=function()error('Unavailable diagnostic persistence')end
 c:activateCreatorPower();respond(200,grant());native[1].callback(false,{reason='game_api_unavailable'});assert(not c.creatorPowerBusy and c.error)
end)

Diagnostics.emit=savedDiagnosticEmit
for key,value in pairs(saved)do Power[key]=value end
-- Restore absent fields as well when run before the new native module is loaded.
if saved.selectedEntity==nil then Power.selectedEntity=nil end
print('CREATOR_CONTROLLER_100_CHECKS='..count)

-- Exercise the real integration->transport polling chain with a stopped game
-- clock. Existing background HTTP must still deliver its response on pause.
do
 local Integration=require('B1.PhoneIntegration')
 local Adapter=require('B1.Phone.PhoneAdapter');local Photo=require('B1.Game.PhotoFlow')
 local Transport=require('B1.Online.Transport')
 local old={time=os.time,find=Adapter.find,register=Adapter.register,photoTick=Photo.tick,photoShutdown=Photo.shutdown,powerTick=Power.tick,powerShutdown=Power.shutdown,read=Transport.read}
 local wall,reads,done=100,0,false;os.time=function()return wall end
 local transport=Transport.new();transport.pending={id='paused_request',started=100,timeout=40,callback=function(status,body)assert(status==200 and body.ready);done=true end}
 Transport.read=function(key)reads=reads+1;if key=='response'then return{id='paused_request',status=200,body={ready=true}}end end
 Photo.tick=function()end;Photo.shutdown=function()end;Power.tick=function()end;Power.shutdown=function()end
 local owner={IsValid=function()return true end}
 Adapter.find=function()return{}end
 Adapter.register=function()return{update=function(_,dt)transport:tick(dt);return true end,dispose=function()end}end
 Integration.shutdown();Integration.on_begin({},owner)
 for i=1,60 do Integration.on_tick({},owner,0)end;assert(reads==0 and not done)
 wall=101;Integration.on_tick({},owner,0);assert(done and reads==2 and not transport.pending)
 Integration.shutdown();os.time=old.time;Adapter.find=old.find;Adapter.register=old.register;Photo.tick=old.photoTick;Photo.shutdown=old.photoShutdown;Power.tick=old.powerTick;Power.shutdown=old.powerShutdown;Transport.read=old.read
 print('PASS Paused phone integration consumes a real transport reply without resuming simulation')
end
