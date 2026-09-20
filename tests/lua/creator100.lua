local Json=require('B1.Shared.Json')
local Power=require('B1.Game.CreatorPower')
local Sim=require('B2.CreatorPower')
local APPLY='Zoigram.CreatorPower.Apply'
local CANCEL='Zoigram.CreatorPower.Cancel'
local count=0
local function test(name,fn)Power.shutdown();Power.enabled=false;fn();count=count+1;print('PASS '..name)end
local grant={ability='filming_learning',profileId='owner-profile-id',multiplier=1.1,durationGameMinutes=60,definitionsReady=true}
local function fixture()
 local calls,messages,rows={}, {},{};local selectedId=41
 for _,r in ipairs(Power.definitionRows())do rows[r.table..'/'..r.id]=r.value end
 UE={UGameplayStatics={GetPlayerController=function()return{GetCharacterEntityId=function()return{Value=selectedId}end}end}}
 inzoi={message={send_to_sim=function(id,kind,content)messages[#messages+1]={id=id.Value,kind=kind,nonce=content}end},cli={execute=function(command)
  calls[#calls+1]=command
  assert(not command:find('buff.add',1,true)and not command:find('buff.remove',1,true),'B1 must never execute B2Authority mutations')
  local alias=command:match('alias=(%w+)');local row=command:match(' row=([%w_]+)')
  if command:find('data.table_get',1,true)then return true,'',Json.encode(rows[alias..'/'..row])end
  return true,'',''
 end}}
 local function reply(s)
  s=s or{};s.nonce=messages[#messages].nonce;s.available=s.available~=false;s.active=s.active or false;s.modifierPresent=s.modifierPresent or false
  s.filmingMultiplier=s.filmingMultiplier or 1.2;s.otherMultiplier=s.otherMultiplier or 1.5
  Power.onMessage('Zoigram.CreatorPower.State',Json.encode(s))
 end
 return calls,messages,reply,function(value)selectedId=value end,rows
end
local function messageCount(messages,kind)local total=0;for _,m in ipairs(messages)do if m.kind==kind then total=total+1 end end;return total end
local function active()return{active=true,modifierPresent=true,filmingMultiplier=1.32,otherMultiplier=1.5,remainingGameMinutes=60}end

test('Disabled build and invalid grants never enter gameplay',function()
 local calls,messages=fixture();local answer;Power.activate({},grant,function(ok,s)assert(not ok);answer=s end)
 assert(answer.reason=='game_validation_required'and #calls==0 and #messages==0);Power.enabled=true
 for _,bad in ipairs({{}, {ability='filming_learning',profileId='owner-profile-id',multiplier=2,durationGameMinutes=60},{ability='other',profileId='owner-profile-id',multiplier=1.1,durationGameMinutes=60}})do
  Power.activate({},bad,function(ok,s)assert(not ok and s.reason=='creator_required')end)
 end
 assert(#calls==0 and #messages==0)
end)
test('Old or unrelated simulation replies cannot complete an inspection',function()
 local calls,messages,reply=fixture();local completed=false;Power.inspect({},function(ok,s)completed=true;assert(ok and s.entityId=='41')end)
 assert(not Power.onMessage('Zoigram.CreatorPower.State','{"nonce":"old","available":true}'))
 assert(not completed);reply();assert(completed and #calls==0)
end)
test('Existing boost never dispatches Apply or refreshes expiry',function()
 local calls,messages,reply=fixture();Power.enabled=true;local answer
 Power.activate({},grant,function(ok,s)assert(ok);answer=s end);reply(active());assert(answer.active and messageCount(messages,APPLY)==0)
end)
test('One fixed Apply succeeds only after separate multiplier readback',function()
 local calls,messages,reply=fixture();Power.enabled=true;local completed=false
 Power.activate({},grant,function(ok,s)assert(ok and s.active);completed=true end);reply()
 assert(messageCount(messages,APPLY)==1 and messages[#messages].id==41 and messages[#messages].nonce:match('^%d+_%d+$'))
 reply(active());assert(not completed);Power.tick(.3);reply(active())
 assert(completed and not Power.busy and messageCount(messages,CANCEL)==0)
end)
test('Changed character and expired account context before dispatch send no Apply',function()
 for _,which in ipairs({'character','account'})do
  local calls,messages,reply,change=fixture();Power.enabled=true;local current=true;local completed=false
  Power.activate({},grant,function(ok)assert(not ok);completed=true end,function()return current end)
  if which=='character'then change(42)else current=false end;reply();assert(completed and messageCount(messages,APPLY)==0)
 end
end)
test('A changed unrelated skill rolls back only the original operation and entity',function()
 local calls,messages,reply=fixture();Power.enabled=true;local answer
 Power.activate({},grant,function(ok,s)assert(not ok);answer=s end);reply();local operation=messages[#messages].nonce
 reply(active());Power.tick(.3);reply({active=true,modifierPresent=true,filmingMultiplier=1.32,otherMultiplier=2})
 assert(answer.reason=='effect_verification_failed');local cancel=messages[#messages];assert(cancel.kind==CANCEL and cancel.id==41 and cancel.nonce==operation)
end)
test('Possession changes after Apply cancel the captured old Zoi only',function()
 local calls,messages,reply,change=fixture();Power.enabled=true;local completed=false
 Power.activate({},grant,function(ok)assert(not ok);completed=true end);reply();local operation=messages[#messages].nonce
 reply(active());change(42);Power.tick(.3)
 assert(completed and messages[#messages].kind==CANCEL and messages[#messages].id==41 and messages[#messages].nonce==operation)
end)
test('Conflicting definitions fail closed without mutations',function()
 local calls,messages,reply,change,rows=fixture();Power.enabled=true;rows['Modifier/Zoigram_Creator_Filming_Learning'].modifierList[1].value=3
 Power.activate({},grant,function(ok,s)assert(not ok and s.reason=='effect_definition_unavailable')end);reply();assert(messageCount(messages,APPLY)==0)
end)
test('Missing Apply acknowledgement times out and cancels exactly once',function()
 local calls,messages,reply=fixture();Power.enabled=true;local answer;local completed=0
 Power.activate({},grant,function(ok,s)assert(not ok);answer=s;completed=completed+1 end);reply();local operation=messages[#messages].nonce
 Power.tick(9);Power.tick(9)
 assert(answer.reason=='game_reply_timeout'and completed==1 and Power.pending==nil and messageCount(messages,CANCEL)==1 and messages[#messages].nonce==operation)
end)
test('Shutdown in the retry gap completes once and cancels the unconfirmed effect',function()
 local calls,messages,reply=fixture();Power.enabled=true;local completed=0
 Power.activate({},grant,function(ok,s)completed=completed+1;assert(not ok and s.reason=='game_session_ended')end);reply();reply(active())
 assert(Power.retry and not Power.pending);Power.shutdown();Power.shutdown();assert(completed==1 and messageCount(messages,CANCEL)==1)
end)
test('Confirmed finite effect survives shutdown and stale UI context',function()
 local calls,messages,reply=fixture();Power.enabled=true;local current=true;local completed=false
 Power.activate({},grant,function(ok)assert(ok);completed=true end,function()return current end);reply();current=false
 reply(active());Power.tick(.3);reply(active());Power.shutdown();assert(completed and messageCount(messages,CANCEL)==0)
end)
test('Paused zero-delta wall clock advances post-Apply readback',function()
 local originalTime=os.time;local clock=100;os.time=function()return clock end
 local calls,messages,reply=fixture();Power.enabled=true;local completed=false
 Power.activate({},grant,function(ok,s)assert(ok and s.active);completed=true end);reply();reply(active());local sent=#messages
 clock=101;Power.tick(0);assert(#messages==sent+1);reply(active());assert(completed);os.time=originalTime
end)
test('Simulation rejection is fixed-code failure without retrying Apply',function()
 local calls,messages,reply=fixture();Power.enabled=true;local answer
 Power.activate({},grant,function(ok,s)assert(not ok);answer=s end);reply();reply({available=false,reason='game_command_failed'})
 assert(answer.reason=='game_command_failed'and messageCount(messages,APPLY)==1 and messageCount(messages,CANCEL)==1)
end)

local function simulationFixture()
 local s={active=false,present=false,adds=0,removes=0,modifierRemoves=0,start=100000000000,duration=36000000000,replies={}}
 local modifier={ModifierIds={Contains=function(_,id)assert(id=='Zoigram_Creator_Filming_Learning');return s.present end},GetOwnerEntityId=function()return{Value=41}end,
  RemoveModifier=function(_,id)assert(id=='Zoigram_Creator_Filming_Learning');s.present=false;s.modifierRemoves=s.modifierRemoves+1 end,
  CalculateModifierValue=function(_,kind,key)return key=='Filming'and(s.present and 1.32 or 1.2)or 1.5 end}
 local character={IsInvalid=function()return false end,GetComponent=function(_,kind)return{kind=kind}end}
 INZOI={EB2ComponentType={Buff=1,Skill=2},EB1ModifierType={SkillExp=2},FB2EntityManager={Get=function()return{FindCharacter=function()return character end}end},
  FB2BuffComponent={HasBuff=function()return s.active end,RemoveBuff=function()s.removes=s.removes+1;if s.removeFails then error('Removal failed')end;s.active=false end,
   GetBuff=function()return{Duration=s.duration,StartTime=s.start,ReduceTick=0}end},
  FB2TimeManager={StaticGetCurrentTicks=function()return s.start end},
  FB2SkillComponent={FindSkill=function()return{Experience=12,Level=2}end,GetSkillLevel=function()return 2 end}}
 inzoi={message={send_to_client=function(id,kind,value)assert(id.Value==41);s.replies[#s.replies+1]=Json.decode(value)end},cli={execute=function(command)
  assert(command=='buff.add entity_id=41 buff_id=Zoigram_Creator_Filming_Focus duration_minutes=60')
  s.adds=s.adds+1;if s.addFails then return false,'B2 failure','ignored' end
  s.active=true;s.present=true;return true,'Applied','Human text and JSON are not parsed here'
 end}}
 Sim.on_begin({},modifier)
 s.send=function(kind,nonce)Sim.on_lua_message({},modifier,kind,nonce)end
 s.nonce=function(n,age)return tostring(os.time()-(age or 0))..'_'..n end
 s.last=function()return s.replies[#s.replies]end;s.owner=modifier;return s
end
test('B2 applies fixed constants using its bound owner and ignores mutation result bodies',function()
 local s=simulationFixture();s.send(APPLY,s.nonce(1))
 assert(s.adds==1 and s.last().available and s.last().active and s.last().remainingGameMinutes==60 and s.last().filmingMultiplier==1.32)
end)
test('Duplicate Apply never stacks, refreshes, or reapplies after natural expiry',function()
 local s=simulationFixture();local nonce=s.nonce(1);s.send(APPLY,nonce);local start,duration=s.start,s.duration
 s.send(APPLY,nonce);assert(s.adds==1 and s.start==start and s.duration==duration and s.last().available and s.last().active)
 s.active=false;s.present=false;s.send(APPLY,nonce);assert(s.adds==1 and not s.active)
end)
test('New Apply while active preserves the existing operation and expiry',function()
 local s=simulationFixture();local first,second=s.nonce(1),s.nonce(2);s.send(APPLY,first);s.send(APPLY,second)
 assert(s.adds==1 and s.last().active);s.send(CANCEL,second);assert(s.active and s.present and s.removes==0)
 s.send(CANCEL,first);assert(not s.active and not s.present)
end)
test('Cancel arriving before queued Apply prevents the delayed mutation',function()
 local s=simulationFixture();local nonce=s.nonce(1);s.send(CANCEL,nonce);s.send(APPLY,nonce)
 assert(s.adds==0 and s.removes==0 and s.last().reason=='operation_cancelled')
end)
test('Late Cancel from an older operation cannot remove a newer effect',function()
 local s=simulationFixture();local first,second=s.nonce(1),s.nonce(2);s.send(APPLY,first);s.active=false;s.present=false;s.send(APPLY,second)
 s.send(CANCEL,first);assert(s.adds==2 and s.active and s.present and s.removes==0)
 s.send(CANCEL,second);assert(not s.active and not s.present and s.removes==1)
end)
test('Stale, malformed, and arbitrary payloads never become gameplay commands',function()
 local s=simulationFixture();s.send(APPLY,s.nonce(1,16));assert(s.last().reason=='operation_cancelled')
 for _,payload in ipairs({'buff.add entity_id=99','123_0','{"duration":999}','99999999999999_1'})do s.send(APPLY,payload)end
 assert(s.adds==0)
end)
test('Failed B2 command is not retried by duplicate delivery',function()
 local s=simulationFixture();s.addFails=true;local nonce=s.nonce(1);s.send(APPLY,nonce);assert(s.last().reason=='game_command_failed')
 s.addFails=false;s.send(APPLY,nonce);assert(s.adds==1 and not s.active)
end)
test('Orphan repair and teardown independently clean only own modifier',function()
 local s=simulationFixture();s.present=true;s.send('Zoigram.CreatorPower.Inspect','inspect_1')
 assert(s.last().available and not s.last().modifierPresent and s.modifierRemoves==1)
 s.active=true;s.present=true;s.removeFails=true;Sim.on_end({},s.owner);assert(not s.present and s.modifierRemoves==2)
 s.present=true;s.owner.GetOwnerEntityId=function()error('Owner already destroyed')end
 assert(pcall(Sim.on_end,{},s.owner)and not s.present and s.modifierRemoves==3)
end)
Power.shutdown();Power.enabled=false
print('CREATOR_100_OFFLINE_CHECKS='..count)
