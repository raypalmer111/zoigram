-- Bound to Component/Modifier: GetComponent returns a base wrapper in the game.
-- This binding supplies typed ModifierIds; other component methods use the
-- native exported dispatch proved against the running game.
local M={}
local BUFF='Zoigram_Creator_Filming_Focus'
local MODIFIER='Zoigram_Creator_Filming_Learning'
local REQUEST='Zoigram.CreatorPower.Inspect'
local RESPONSE='Zoigram.CreatorPower.State'
local APPLY='Zoigram.CreatorPower.Apply'
local CANCEL='Zoigram.CreatorPower.Cancel'
local operations={}
local function finite(v)return type(v)=='number'and v==v and math.abs(v)<1000000000000000000 end
local function enum(name)
 local t=INZOI.EB2ComponentType;assert(t and t[name]~=nil,'components_unavailable');return t[name]
end
local function entity(owner)
 local value=INZOI.FB2EntityManager.Get():FindCharacter(owner:GetOwnerEntityId())
 assert(value and not value:IsInvalid(),'no_character');return value
end
local function components(owner)
 local value=entity(owner)
 return value:GetComponent(enum('Buff')),owner,value:GetComponent(enum('Skill'))
end
local function removeOwnEffect(owner)
 -- Independent attempts: missing/corrupt buff data cannot skip modifier cleanup.
 pcall(function()
  local buff=components(owner)
  if INZOI.FB2BuffComponent.HasBuff(buff,BUFF)then INZOI.FB2BuffComponent.RemoveBuff(buff,BUFF,true)end
 end)
 pcall(function()if owner.ModifierIds:Contains(MODIFIER)then owner:RemoveModifier(MODIFIER)end end)
end
local function snapshot(owner)
 local buff,modifier,skill=components(owner)
 assert(buff and modifier and skill,'components_unavailable')
 local kind=INZOI.EB1ModifierType and INZOI.EB1ModifierType.SkillExp
 assert(kind~=nil,'skill_modifier_unavailable')
 local filming=modifier:CalculateModifierValue(kind,'Filming',1,false)
 local logic=modifier:CalculateModifierValue(kind,'Logic',1,false)
 assert(finite(filming)and finite(logic),'modifier_read_failed')
 local active=INZOI.FB2BuffComponent.HasBuff(buff,BUFF)
 local present=modifier.ModifierIds:Contains(MODIFIER)
 -- An orphan is only ever our exact row ID. Repair it before returning a baseline.
 if present and not active then modifier:RemoveModifier(MODIFIER);present=modifier.ModifierIds:Contains(MODIFIER);assert(not present,'orphan_cleanup_failed')end
 assert(not active or present,'effect_cleanup_pending')
 filming=modifier:CalculateModifierValue(kind,'Filming',1,false)
 logic=modifier:CalculateModifierValue(kind,'Logic',1,false)
 local learned=INZOI.FB2SkillComponent.FindSkill(skill,'Filming')
 local experience=0;if learned then experience=tonumber(learned.Experience)end
 local level=INZOI.FB2SkillComponent.GetSkillLevel(skill,'Filming')
 assert(finite(experience)and finite(level)and experience>=0 and level>=0,'skill_read_failed')
 local remaining=0
 if active then
  local instance=INZOI.FB2BuffComponent.GetBuff(buff,BUFF);assert(instance,'buff_read_failed')
  local ticks=INZOI.FB2TimeManager.StaticGetCurrentTicks()
  local duration,start=tonumber(instance.Duration),tonumber(instance.StartTime)
  local reduction=tonumber(instance.ReduceTick)
  assert(finite(duration)and duration>0 and finite(start)and finite(tonumber(ticks))and finite(reduction),'buff_read_failed')
  -- UE FDateTime/FTimespan use 100 ns ticks: 600,000,000 ticks per minute.
  remaining=math.max(0,(start+duration-tonumber(ticks)-reduction)/600000000)
 end
 return{active=active,present=present,filming=filming,logic=logic,experience=experience,level=level,remaining=remaining}
end
local function ownerKey(owner)
 local value=tonumber(owner:GetOwnerEntityId().Value)
 assert(value and value>0 and value%1==0,'no_character')
 return string.format('%.0f',value)
end
local function operationNonce(content)
 local seconds,sequence=content:match('^(%d+)_(%d+)$')
 seconds,sequence=tonumber(seconds),tonumber(sequence)
 if not seconds or not sequence or seconds<=0 or sequence<=0 or seconds>10000000000 or sequence>1000000000 then return end
 return seconds,sequence
end
local function advance(record,seconds,sequence)
 if record.seconds and(seconds<record.seconds or(seconds==record.seconds and sequence<=record.sequence))then return false end
 record.seconds,record.sequence=seconds,sequence;return true
end
local function reply(owner,nonce,reason)
 local ok,s=pcall(snapshot,owner);local raw
 if ok and not reason then
  raw=string.format('{"nonce":"%s","available":true,"active":%s,"modifierPresent":%s,"filmingMultiplier":%.8f,"otherMultiplier":%.8f,"experience":%.8f,"level":%d,"remainingGameMinutes":%.4f}',nonce,tostring(s.active),tostring(s.present),s.filming,s.logic,s.experience,s.level,s.remaining)
 else
  raw=string.format('{"nonce":"%s","available":false,"reason":"%s"}',nonce,reason or'game_api_unavailable')
 end
 inzoi.message.send_to_client(owner:GetOwnerEntityId(),RESPONSE,raw)
end
---@param self table
---@param owner FB2ModifierComponent
function M.on_begin(self,owner)
 -- Runtime definitions are not saved. A loaded/reloaded world starts clean,
 -- so a serialized boost can never outlive the mod's cleanup definitions.
 removeOwnEffect(owner)
 operations[ownerKey(owner)]=nil
end
---@param self table
---@param owner FB2ModifierComponent
function M.on_lua_message(self,owner,messageType,content)
 if(messageType~=REQUEST and messageType~=APPLY and messageType~=CANCEL)or type(content)~='string'or not content:match('^[%w_]+$')or #content>64 then return end
 if messageType==REQUEST then return reply(owner,content)end
 local seconds,sequence=operationNonce(content);if not seconds then return end
 local key=ownerKey(owner);local record=operations[key]or{};operations[key]=record
 if messageType==CANCEL then
  -- Tombstone even a not-yet-delivered Apply. An old cancellation cannot
  -- remove a later activation, including when both target the same Zoi.
  advance(record,seconds,sequence)
  if record.applied==content then record.applied=nil;removeOwnEffect(owner)end
  return
 end
 local now=os.time()
 if seconds<now-15 or seconds>now+2 then return reply(owner,content,'operation_cancelled')end
 -- One high-water mark per bound entity prevents replay after natural expiry,
 -- without an ever-growing nonce list. Mark before any native mutation.
 if not advance(record,seconds,sequence)then
  -- A duplicate acknowledgement must not cancel the original successful add.
  -- The remembered operation can be read again, but is never applied again.
  if record.applied==content then return reply(owner,content)end
  return reply(owner,content,'operation_cancelled')
 end
 local readable,before=pcall(snapshot,owner)
 if not readable then return reply(owner,content,'game_api_unavailable')end
 if before.active and before.present then return reply(owner,content)end
 record.applied=content
 -- B2Authority commands must run on the simulation thread. Only the bound
 -- owner and fixed local constants enter this command; message data is a nonce.
 local called,accepted=pcall(inzoi.cli.execute,'buff.add entity_id='..key..' buff_id='..BUFF..' duration_minutes=60')
 if not called or not accepted then
  local observed,after=pcall(snapshot,owner)
  if not observed or not(after.active and after.present)then return reply(owner,content,'game_command_failed')end
 end
 -- Never decode the mutation's result body or repeat the add. The client
 -- verifies the actual skill multiplier in a separate nonce-bound readback.
 return reply(owner,content)
end
---@param self table
---@param owner FB2ModifierComponent
function M.on_end(self,owner)
 removeOwnEffect(owner)
 local ok,key=pcall(ownerKey,owner);if ok then operations[key]=nil end
end
return M
