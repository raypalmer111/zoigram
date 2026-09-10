local Photo=require('B1.Game.PhotoFlow')
-- Integration verified against the native phone hierarchy in game build 322888.
local View = require('B1.UI.SocialAppView')
local SocialApp = require('B1.Core.SocialApp')
local Log = require('B1.Core.Diagnostics')
local M = {}; M.__index=M
local function valid(obj) return obj and obj:IsValid() end
local function child(parent, name)
    if not valid(parent) or type(parent.GetChildrenCount) ~= 'function' then return nil end
    for index=0,parent:GetChildrenCount()-1 do
        local value=parent:GetChildAt(index)
        if valid(value) and value:GetName()==name then return value end
    end
end
local function descendant(parent,name)
    if not valid(parent) then return nil end
    if parent:GetName()==name then return parent end
    if type(parent.GetChildrenCount)~='function' then return nil end
    for index=0,parent:GetChildrenCount()-1 do local value=descendant(parent:GetChildAt(index),name);if value then return value end end
end
local function removePrevious(parent, prefix)
    for index=parent:GetChildrenCount()-1,0,-1 do
        local value=parent:GetChildAt(index)
        if valid(value) and value:GetName():sub(1,#prefix)==prefix then value:RemoveFromParent() end
    end
end
function M.find(worldContext)
    local found=UE.TArray(UE.UUserWidget)
    UE.UWidgetBlueprintLibrary.GetAllWidgetsOfClass(worldContext,found,INZOI.UB1SmartphoneWidget.StaticClass(),false)
    for index=1,found:Length() do
        local phone=found:Get(index)
        if valid(phone) and phone:IsVisible() and valid(phone.WBP_Mobile) then return phone end
    end
end
function M.register(phone)
    assert(valid(phone), 'PHONE_MISSING')
    local mobile=phone.WBP_Mobile
    assert(valid(mobile), 'MOBILE_MISSING')
    local message=mobile.WBP_Mobile_AppIcon_Message
    assert(valid(message), 'MESSAGE_ICON_MISSING')
    local iconColumn=message:GetParent()
    local dock=valid(iconColumn) and iconColumn:GetParent()
    local menu=valid(dock) and dock:GetParent()
    assert(valid(menu) and menu:GetName()=='B1VerticalBox_App', 'PHONE_LAYOUT_CHANGED')
    local canvas=menu:GetParent()
    assert(valid(canvas) and canvas:GetName()=='B1CanvasPanel_181','PHONE_CANVAS_CHANGED')
    local closeButton=descendant(canvas,'WBP_Common_CloseButton')
    assert(valid(closeButton),'PHONE_CLOSE_BUTTON_MISSING')
    local apps=child(menu,'B1WrapBox_App_Middle')
    assert(valid(apps),'PHONE_APPS_CONTAINER_MISSING')
    Log.emit('Phone objects found',phone:GetClass():GetName() .. ' / ' .. apps:GetName())
    for _, entry in ipairs({{apps,'AddChildToWrapBox'},{canvas,'AddChildToCanvas'},{menu,'GetVisibility'},{menu.Slot,'GetAnchors'},{menu.Slot,'GetOffsets'}}) do
        assert(valid(entry[1]) and type(entry[1][entry[2]])=='function','PHONE_FUNCTION_MISSING: '..entry[2])
        print('[InzoiSocial] callable ' .. entry[1]:GetClass():GetName() .. '.' .. entry[2])
    end
    local originalVisibility=menu:GetVisibility();local originalCloseVisibility=closeButton:GetVisibility()
    local hidden=originalVisibility==UE.ESlateVisibility.Collapsed or originalVisibility==UE.ESlateVisibility.Hidden
    local recovered=false
    for i=0,canvas:GetChildrenCount()-1 do
        local previous=canvas:GetChildAt(i);local name=previous:GetName()
        if name:sub(1,23)=='InzoiSocial_ScreenRoot_' then
            local saved=tonumber(name:match('Return_(%d)_'))
            if saved==0 or saved==3 or saved==4 then originalVisibility=saved end
            -- Recover an open app or a pre-0.3 orphan left by a failed hot reload.
            if hidden and (previous:IsVisible() or not saved) then
                if originalVisibility==1 or originalVisibility==2 then originalVisibility=UE.ESlateVisibility.SelfHitTestInvisible end
                menu:SetVisibility(originalVisibility)
                recovered=true
                Log.emit('Recovered phone menu after Lua reload')
            end
        end
    end
    if recovered and (originalCloseVisibility==UE.ESlateVisibility.Collapsed or originalCloseVisibility==UE.ESlateVisibility.Hidden)then originalCloseVisibility=UE.ESlateVisibility.Visible;closeButton:SetVisibility(originalCloseVisibility)end
    if originalVisibility==1 or originalVisibility==2 then originalVisibility=UE.ESlateVisibility.SelfHitTestInvisible end
    removePrevious(apps,'InzoiSocial_IconRoot_'); removePrevious(canvas,'InzoiSocial_ScreenRoot_')
    local self=setmetatable({phone=phone,menu=menu,closeButton=closeButton,opened=false,originalVisibility=originalVisibility,originalCloseVisibility=originalCloseVisibility},M)
    local ok,err=pcall(function()
        self.view=View.create(mobile,{
            open=function() self:open() end,exit=function() self:close() end,
            back=function()self.app:back()end,
            online=function(action,value)self.app.online:act(action,value)end},originalVisibility)
        self.app=SocialApp.new(self.view,mobile,function() self:close() end)
        local slot=apps:AddChildToWrapBox(self.view.iconRoot)
        assert(valid(slot),'ICON_ATTACHMENT_FAILED')
        local screenSlot=canvas:AddChildToCanvas(self.view.screen)
        assert(valid(screenSlot),'SCREEN_ATTACHMENT_FAILED')
        local anchors=menu.Slot:GetAnchors();local offsets=menu.Slot:GetOffsets()
        offsets.Left=offsets.Left-12
        if anchors.Minimum.X==anchors.Maximum.X then offsets.Right=offsets.Right+24 else offsets.Right=offsets.Right-12 end
        screenSlot:SetAnchors(anchors);screenSlot:SetOffsets(offsets);screenSlot:SetZOrder(20)
    end)
    if not ok then self:dispose(); error(err) end
    Log.emit('Zoigram application registered',phone:GetName()..' / '..apps:GetName()..' / menu='..tostring(self.originalVisibility))
    return self
end
function M:open()
    if self.opened then return end
    if not valid(self.phone) or not valid(self.menu) or not self.view or not valid(self.view.screen) then return end
    local ok,err=pcall(function()
        self.app:open()
        self.menu:SetVisibility(UE.ESlateVisibility.Collapsed)
        self.closeButton:SetVisibility(UE.ESlateVisibility.Collapsed)
        self.view.screen:SetVisibility(UE.ESlateVisibility.Visible)
        self.opened=true
    end)
    if not ok then self:close(); Log.emit('Open failed',err); return end
    Log.emit('Zoigram application opened')
end
function M:close()
    local wasOpen=self.opened
    if self.app then self.app:close() end
    if self.view and valid(self.view.screen) then self.view.screen:SetVisibility(UE.ESlateVisibility.Collapsed) end
    if wasOpen and valid(self.menu) then self.menu:SetVisibility(self.originalVisibility) end
    if valid(self.closeButton) then self.closeButton:SetVisibility(self.originalCloseVisibility) end
    self.opened=false
    if wasOpen then Log.emit('Returned to phone menu') end
end
function M:update(dt)
    if not valid(self.phone) then return false end
    if not self.phone:IsVisible() then
        if self.opened then self:close() end
        self.recheckElapsed=(self.recheckElapsed or 0)+(dt or 0)
        if self.recheckElapsed>=1 then
            self.recheckElapsed=0
            local visible=M.find(self.phone)
            if visible and visible~=self.phone then return false end
        end
    else self.recheckElapsed=0 end
    if self.phone:IsVisible() and Photo.resume then
        local author=Photo.consumeResume();self:open();self.app.resumeAuthor=author;self.app:refresh(false,0)
    end
    if self.opened and self.app then self.app:update(dt or 0) end
    return true
end
function M:onMessage(owner,messageType,content)
    if self.app then self.app:onMessage(owner,messageType,content) end
end
function M:dispose()
    pcall(function() self:close() end)
    if self.app and self.app.online then self.app.online:dispose()end
    if self.view then self.view:destroy(); self.view=nil end
end
return M
