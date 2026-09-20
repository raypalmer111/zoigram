local Photo=require('B1.Game.PhotoFlow')
local CreatorPower=require('B1.Game.CreatorPower')
-- One shared adapter per live phone. Bound characters supply a valid world context.
local Adapter=require('B1.Phone.PhoneAdapter')
local Log=require('B1.Core.Diagnostics')
local M={}
local DISCOVERY_POLL_SECONDS = 2
local VISIBILITY_POLL_SECONDS = 0.25
local activeOwner, adapter, elapsed, attempted = nil, nil, 0, false
local lastWallTime=nil
local function valid(obj) return obj and obj:IsValid() end
local function inspect(owner,dt)
    local photoOk,photoError=pcall(Photo.tick,owner,dt or 0)
    if not photoOk then Log.emit('Photo lifecycle error',photoError);Photo.shutdown()end
    if adapter then
        if adapter:update(dt or 0) then return end
        adapter:dispose(); adapter=nil; attempted=false
    end
    if attempted then return end
    local ok,phone=pcall(Adapter.find,owner)
    if not ok then attempted=true; Log.emit('Phone discovery failed',phone); return end
    if not phone then return end
    attempted=true
    local registered,result=pcall(Adapter.register,phone)
    if registered then adapter=result else Log.emit('Phone registration failed',result) end
end
---@param self table
---@param owner AB1Character
function M.on_begin(self,owner)
    if valid(activeOwner) then return end
    activeOwner=owner; elapsed=0; attempted=false;lastWallTime=os.time()
    inspect(owner)
end
---@param self table
---@param owner AB1Character
---@param dt number
function M.on_tick(self,owner,dt)
    if not valid(activeOwner) then activeOwner=owner; attempted=false;lastWallTime=os.time() end
    if owner~=activeOwner then return end
    -- Simulation delta can stop on pause; phone networking must keep polling.
    -- Use wall seconds only while it is stopped, without accelerating normal ticks.
    local now=os.time();local step=math.max(0,tonumber(dt)or 0)
    if step==0 and lastWallTime then step=math.min(1,math.max(0,now-lastWallTime))end
    lastWallTime=now
    local powerOk,powerError=pcall(CreatorPower.tick,step)
    if not powerOk then Log.emit('Creator power lifecycle error',powerError);CreatorPower.shutdown()end
    elapsed=elapsed+step
    local interval=(adapter or Photo.state~='idle') and VISIBILITY_POLL_SECONDS or DISCOVERY_POLL_SECONDS
    if elapsed<interval then return end
    local step=elapsed;elapsed=0
    local ok,err=pcall(inspect,owner,step)
    if not ok then attempted=true; Log.emit('Phone lifecycle error',err) end
end
---@param self table
---@param owner AB1Character
function M.on_end(self,owner)
    if owner~=activeOwner then return end
    M.shutdown()
end
---@param self table
---@param owner AB1Character
---@param messageType string
---@param content string
function M.on_lua_message(self,owner,messageType,content)
    local powerOk,handled=pcall(CreatorPower.onMessage,messageType,content)
    if not powerOk then Log.emit('Creator power message failed',handled)end
    if powerOk and handled then return end
    if not adapter then return end
    local ok,err=pcall(adapter.onMessage,adapter,owner,messageType,content)
    if not ok then Log.emit('Profile message failed',err) end
end
function M.shutdown()
    Photo.shutdown()
    if adapter then adapter:dispose(); adapter=nil end
    CreatorPower.shutdown()
    activeOwner=nil; attempted=false;elapsed=0;lastWallTime=nil
end
return M

