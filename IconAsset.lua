-- The generated bundle embeds the original PNG bytes; no installation path is needed.
local M={};local cached
function M.load(worldContext)
 if cached and cached:IsValid() then return cached end
 local bytes=require('B1.UI.IconData')
 cached=UE.UKismetRenderingLibrary.ImportBufferAsTexture2D(worldContext,bytes)
 assert(cached and cached:IsValid(),'ICON_LOAD_FAILED')
 return cached
end
return M
