-- Shared native UMG construction helpers. Own roots and delegates are released together.
-- Slate enum values verified in inZOI build 322888; these three enums are absent from its exported type list.
local TextJustify={Left=0,Center=1};local BrushNoDraw=0;local SizeFill=1
local Glyphs=require('B1.UI.Glyphs')
local M={};M.__index=M;local serial=0
function M.avatarInitial(profile)
    local value=(profile.displayName or''):match('^[A-Za-z0-9]')or profile.username or'z'
    -- Take the complete UTF-8 code point; string.sub(1,1) splits non-Latin IDs.
    return (value:match('^[%z\1-\127\194-\244][\128-\191]*')or'Z'):upper()
end
function M.color(r,g,b,a) local c=UE.FLinearColor();c.R=r;c.G=g;c.B=b;c.A=a or 1;return c end
local function rgb(r,g,b)
    local function linear(v)v=v/255;return v<=.04045 and v/12.92 or((v+.055)/1.055)^2.4 end
    return M.color(linear(r),linear(g),linear(b))
end
M.palette={white=rgb(255,255,255),ink=rgb(23,21,27),muted=rgb(126,120,129),
    line=rgb(235,233,238),surface=rgb(247,246,249),blue=rgb(7,94,231),accent=rgb(224,5,71),
    blush=rgb(255,232,240),message=rgb(229,240,255),frame=rgb(23,21,27),gold=rgb(215,160,24)}
function M.margin(v) local m=UE.FMargin();m.Left=v;m.Top=v;m.Right=v;m.Bottom=v;return m end
function M.slate(color) local s=UE.FSlateColor();s.SpecifiedColor=color;return s end
function M.new(outer)
    serial=serial+1
    return setmetatable({outer=outer,suffix=tostring(os.time())..'_'..math.floor(os.clock()*1000)..'_'..serial,roots={},bindings={}},M)
end
function M:make(class,name)
    local w=UE.NewObject(class.StaticClass(),self.outer,'InzoiSocial_'..name..'_'..self.suffix)
    assert(w and w:IsValid(),'Cannot create '..name);return w
end
function M:text(value,size,name,tint,bold,left,wrap)
    local w=self:make(UE.UTextBlock,name);w:SetText(value)
    local font=w.Font;font.Size=math.max(7,math.floor(size*.75+.5));font.TypefaceFontName=bold and 'Bold' or 'Regular';w:SetFont(font)
    w:SetColorAndOpacity(M.slate(tint or M.palette.ink))
    w:SetJustification(left and TextJustify.Left or TextJustify.Center)
    if wrap then w:SetAutoWrapText(true) end
    return w
end
function M:bind(button,callback)
    button.OnClicked:Add(self.outer,callback);self.bindings[#self.bindings+1]={button=button,callback=callback}
end
function M:button(name,content,callback,padding)
    local b=self:make(UE.UButton,name);local style=b.WidgetStyle
    for _,key in ipairs({'Normal','Hovered','Pressed','Disabled'}) do
        local brush=style[key];brush.DrawAs=BrushNoDraw;style[key]=brush
    end
    style.NormalPadding=M.margin(0);style.PressedPadding=M.margin(0);b:SetStyle(style)
    b:SetBackgroundColor(M.palette.white);b:SetColorAndOpacity(M.palette.white)
    local slot=b:AddChild(content);slot:SetPadding(M.margin(padding or 0));slot:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Fill);slot:SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center);self:bind(b,callback);return b
end
function M:box(name,width,height,content)
    local b=self:make(UE.USizeBox,name)
    if width then b:SetWidthOverride(width) end;if height then b:SetHeightOverride(height) end
    if content then b:AddChild(content) end;return b
end
function M:panel(name,content,padding,tint)
    local p=self:make(UE.UBorder,name);p:SetBrushColor(tint or M.palette.white);p:SetPadding(M.margin(padding or 0))
    p:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Fill);p:SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Fill)
    if content then p:AddChild(content) end;return p
end
function M:roundedPanel(name,content,padding,tint,radius)
    local p=self:panel(name,content,padding,tint)
    pcall(function()
        local brush=p.Background;brush.DrawAs=4
        local outline=brush.OutlineSettings;outline.RoundingType=0;outline.Width=0;outline.CornerRadii=UE.FVector4(radius or 12,radius or 12,radius or 12,radius or 12);brush.OutlineSettings=outline
        p:SetBrush(brush)
    end)
    return p
end
function M:roundImage(image,radius)
    -- Rounded Slate image brushes mask the photo itself; a rounded background
    -- alone leaves the image's square corners visible over an avatar ring.
    local brush=image.Brush;brush.DrawAs=4
    local outline=brush.OutlineSettings;outline.RoundingType=0;outline.Width=0
    outline.CornerRadii=UE.FVector4(radius,radius,radius,radius);brush.OutlineSettings=outline
    image:SetBrush(brush)
end
function M:glyph(symbol,name,size,tint,width)
    local image=self:make(UE.UImage,name..'Image');image:SetBrushFromTexture(Glyphs.load(self.outer,symbol),false);image:SetColorAndOpacity(tint or M.palette.ink)
    return self:box(name,width or size,size,image),image
end
function M:iconButton(name,symbol,callback,size,tint)
    local art=self:glyph(symbol,name..'Glyph',size or 20,tint)
    local button=self:button(name,art,callback,9)
    return self:box(name..'HitArea',38,42,button),button
end
function M.fill(slot)
    local size=UE.FSlateChildSize();size.SizeRule=SizeFill;size.Value=1;slot:SetSize(size);return slot
end
function M.center(column,w)
    local slot=column:AddChildToVerticalBox(w);slot:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Center);return slot
end
function M:gap(column,height,name) column:AddChild(self:box(name,nil,height)) end
function M:line(column,name,tint)
    local p=self:panel(name,nil,0,tint or M.palette.line);column:AddChild(self:box(name..'Size',nil,1,p));return p
end
function M:picture(texture,name,size)
    local image=self:make(UE.UImage,name);image:SetBrushFromTexture(texture,false);image:SetColorAndOpacity(M.palette.white)
    return self:box(name..'Size',size,size,image)
end
function M:portrait(name,size)
    local overlay=self:make(UE.UOverlay,name..'Overlay')
    local function stretch(widget)
        local slot=overlay:AddChildToOverlay(widget)
        slot:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Fill);slot:SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Fill)
    end
    stretch(self:panel(name..'Background',nil,0,M.palette.surface))
    local image=self:make(UE.UImage,name..'Image');image:SetColorAndOpacity(M.palette.white);stretch(image)
    local fallback=self:text('…',22,name..'Fallback',M.palette.muted,true)
    local slot=overlay:AddChildToOverlay(fallback);slot:SetHorizontalAlignment(UE.EHorizontalAlignment.HAlign_Center);slot:SetVerticalAlignment(UE.EVerticalAlignment.VAlign_Center)
    local result={root=self:box(name..'Size',size,size,overlay)}
    function result:set(texture)
        local valid=texture and texture:IsValid()
        if valid then image:SetBrushFromTexture(texture,false) end
        image:SetVisibility(valid and UE.ESlateVisibility.Visible or UE.ESlateVisibility.Collapsed)
        fallback:SetVisibility(valid and UE.ESlateVisibility.Collapsed or UE.ESlateVisibility.Visible)
    end
    result:set(nil);return result
end
function M:destroy()
    for _,b in ipairs(self.bindings) do if b.button and b.button:IsValid() then pcall(function() b.button.OnClicked:Remove(self.outer,b.callback) end) end end
    for _,root in ipairs(self.roots) do if root and root:IsValid() then root:RemoveFromParent() end end
    self.bindings={};self.roots={}
end
return M


