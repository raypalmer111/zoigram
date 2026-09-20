-- Fixed native learning bonus. The community server only authorizes access;
-- no server-provided command, table name, percentage or target reaches the game.
local Json=require('B1.Shared.Json')
local M={enabled=true}
local BUFF='Zoigram_Creator_Filming_Focus'
local MODIFIER='Zoigram_Creator_Filming_Learning'
local ADD='Zoigram_Creator_Filming_Add'
local REMOVE='Zoigram_Creator_Filming_Remove'
local REQUEST='Zoigram.CreatorPower.Inspect'
local RESPONSE='Zoigram.CreatorPower.State'
local APPLY='Zoigram.CreatorPower.Apply'
local CANCEL='Zoigram.CreatorPower.Cancel'
local serial=0
local function result(callback,ok,value)if callback then callback(ok,value)end end
local function fail(callback,reason)result(callback,false,{available=false,reason=reason})end
local function finite(v)return type(v)=='number'and v==v and math.abs(v)<1000000 end
local function selected(context)
 local pc=UE.UGameplayStatics.GetPlayerController(context,0)
 assert(pc,'no_character');local id=pc:GetCharacterEntityId();local value=id and tonumber(id.Value)
 assert(value and value>0 and value%1==0,'no_character');return id,string.format('%.0f',value)
end
function M.selectedEntity(context)local ok,_,value=pcall(selected,context);return ok and value or nil end
local function cli(command)
 local ok,message,data=inzoi.cli.execute(command)
 assert(ok,message or 'game_command_failed')
 if type(data)=='string'and #data>0 then return Json.decode(data)end
 return data
end
local function diagnostic(stage)
 -- Fixed codes only: native responses, account and simulation IDs stay private.
 local raw=Json.encode({stage=stage})
 local hex=raw:gsub('.',function(c)return string.format('%02x',c:byte())end)
 pcall(inzoi.cli.execute,'uimod.cfg_save mod_id=__MOD_ID__ section=diagnostics key=creator_game value="'..hex..'"')
end
local function script(id,command)
 return{iD=id,scripts={{ifType='If',conditions={},executes={{baseObject='Self',command=command,s1=MODIFIER,s2='None',f1=0,f2=0,prob=1}}}}}
end
function M.definitionRows()
 return{
  {table='Modifier',id=MODIFIER,value={iD=MODIFIER,modifierList={{modifierType='SkillExp',modifierKey='Filming',modifierCalcType='Multiply',value=1.1}}}},
  {table='Script',id=ADD,value=script(ADD,'AddModifier')},
  {table='Script',id=REMOVE,value=script(REMOVE,'RemoveModifier')},
  {table='Buff',id=BUFF,value={iD=BUFF,
   buffBasicInfo={isEssential=false,duration=60,expireTime={afterDay=-1,targetHour=-1,targetMinute=-1},tickInterval=0,scriptInterval=0,emotionId='None',emotionValue=0,emotionReasonPriority='Invalid',tags={},tagIconId='Skill_Icon_Filming'},
   buffDisplayInfo={displayTextId='',reasonTextId='',iconId='None',emotionColorId1='None',emotionColorId2='None',hiddenFromUI=true,alarmIconMaterialId='None',isHighlight=false,emotionReasonTitleTextId='',emotionReasonDescTextId=''},
   addScriptIdList={ADD},cancelScriptIdList={REMOVE},finishScriptIdList={REMOVE},tickScriptIdList={},intervalScriptIdList={}}}
 }
end
local function matches(actual,expected)
 if type(expected)=='number'then return type(actual)=='number'and math.abs(actual-expected)<0.00001 end
 if type(expected)~='table'then return actual==expected end
 if type(actual)~='table'then return false end
 if #actual~=#expected then return false end
 for k,v in pairs(expected)do if not matches(actual[k],v)then return false end end
 return true
end
local function ensureRows()
 for _,row in ipairs(M.definitionRows())do
  -- Registration uses the UI SDK's structured arguments. Lua CLI strips JSON
  -- quotes, so this stage only verifies the fixed definitions before gameplay.
  local read=cli('data.table_get alias='..row.table..' row='..row.id)
  assert(matches(read,row.value),'effect_definition_mismatch')
 end
end
local function nextNonce()serial=serial+1;return tostring(os.time())..'_'..serial end
local function request(context,callback,target,messageType,nonce)
 if M.pending then return fail(callback,'busy')end
 local ok,id,idText=pcall(selected,context)
 if not ok then return fail(callback,'no_character')end
 if target and idText~=target then return fail(callback,'character_changed')end
 nonce=nonce or nextNonce()
 M.pending={nonce=nonce,callback=callback,elapsed=0,deadline=os.time()+8,entityId=idText}
 local sent=pcall(inzoi.message.send_to_sim,id,messageType or REQUEST,nonce)
 if not sent then M.pending=nil;return fail(callback,'game_api_unavailable')end
 return true
end
function M.inspect(context,callback)
 if M.busy then return fail(callback,'busy')end
 return request(context,callback)
end
function M.onMessage(messageType,content)
 if messageType~=RESPONSE or not M.pending or type(content)~='string'or #content>4096 then return false end
 local parsed,s=pcall(Json.decode,content);local p=M.pending
 if not parsed or type(s)~='table'or s.nonce~=p.nonce then return false end
 M.pending=nil;s.entityId=p.entityId
 if s.available~=true or not finite(s.filmingMultiplier)or not finite(s.otherMultiplier)then
  local reason=s.reason=='game_command_failed'and'game_command_failed'or s.reason=='operation_cancelled'and'operation_cancelled'or'game_api_unavailable'
  fail(p.callback,reason)
 else result(p.callback,true,s)end
 return true
end
local function validGrant(grant)
 return type(grant)=='table'and grant.definitionsReady==true and grant.ability=='filming_learning'and grant.multiplier==1.1 and grant.durationGameMinutes==60
  and type(grant.profileId)=='string'and #grant.profileId>=8 and #grant.profileId<=80
end
function M.activate(context,grant,callback,isCurrent)
 if not M.enabled then return fail(callback,'game_validation_required')end
 if not validGrant(grant)then return fail(callback,'creator_required')end
 if M.busy or M.pending then return fail(callback,'busy')end
 local function current()if not isCurrent then return true end;local ok,value=pcall(isCurrent);return ok and value==true end
 if not current()then return fail(callback,'operation_cancelled')end
 M.busy=true
 local completed=false
 local function done(ok,s)
  if completed then return end;completed=true
  local cancel=M.cancel;M.cancel=nil;M.busy=nil;M.retry=nil;M.finish=nil;M.pending=nil
  if not ok and cancel then cancel()end
  result(callback,ok,s)
 end
 M.finish=done
 request(context,function(ok,before)
  if not ok then return done(false,before)end
  if not current()then return done(false,{reason='operation_cancelled'})end
  local prepared=pcall(ensureRows)
  if not prepared then return done(false,{reason='effect_definition_unavailable'})end
  if before.active and before.modifierPresent then return done(true,before)end
  if before.active or before.modifierPresent then return done(false,{reason='effect_state_mismatch'})end
  local target=before.entityId
  if not current()then return done(false,{reason='operation_cancelled'})end
  local chosen,id,idText=pcall(selected,context)
  if not chosen or idText~=target then return done(false,{reason='character_changed'})end
  if not current()then return done(false,{reason='operation_cancelled'})end
  local operation=nextNonce()
  -- Keep the original entity userdata for cancellation even after possession changes.
  M.cancel=function()pcall(inzoi.message.send_to_sim,id,CANCEL,operation)end
  local attempts=0
  local function rollback(reason)
   diagnostic(reason)
   done(false,{reason=reason})
  end
  local function verify()
   attempts=attempts+1
   request(context,function(readOk,after)
    if readOk and after.active and after.modifierPresent
     and math.abs(after.filmingMultiplier-before.filmingMultiplier*1.1)<0.0001
     and math.abs(after.otherMultiplier-before.otherMultiplier)<0.0001 then diagnostic('sim_apply_verified');return done(true,after)end
    if readOk and not after.active and attempts<3 then M.retry={wait=.25,deadline=os.time()+1,run=verify};return end
    rollback('effect_verification_failed')
   end,target)
  end
  request(context,function(applied,state)
   if not applied then return rollback(state.reason or'game_api_unavailable')end
   -- A separate readback validates the actual effect even if the command's
   -- acknowledgement was ambiguous. Applying is never retried.
   M.retry={wait=.25,deadline=os.time()+1,run=verify}
  end,target,APPLY,operation)
 end)
 return true
end
function M.tick(dt)
 -- Render dt normally advances these waits. Integer wall-clock deadlines are
 -- a bounded fallback when the game's B1 callback supplies paused dt=0.
 local now=os.time();local elapsed=math.max(0,tonumber(dt)or 0)
 if M.pending then
  M.pending.elapsed=M.pending.elapsed+elapsed
  if M.pending.elapsed>=8 or now>=M.pending.deadline then local p=M.pending;M.pending=nil;fail(p.callback,'game_reply_timeout')end
 end
 if M.retry then local retry=M.retry;retry.wait=retry.wait-elapsed;if retry.wait<=0 or now>=retry.deadline then M.retry=nil;retry.run()end end
end
function M.shutdown()
 local p,finish=M.pending,M.finish;M.pending=nil;M.retry=nil;M.busy=nil;M.finish=nil
 if finish then finish(false,{reason='game_session_ended'})
 elseif p then fail(p.callback,'game_session_ended')end
end
return M
