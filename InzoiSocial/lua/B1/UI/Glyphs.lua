local data=require('B1.UI.GlyphData')
local M={};local textures={}
function M.load(outer,name)
 local t=textures[name]
 if t and t:IsValid()then return t end
 assert(data[name],'Missing UI glyph: '..name)
 t=UE.UKismetRenderingLibrary.ImportBufferAsTexture2D(outer,data[name])
 assert(t and t:IsValid(),'UI_GLYPH_LOAD_FAILED: '..name)
 textures[name]=t;return t
end
return M
