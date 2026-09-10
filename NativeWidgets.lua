-- Native widgets only; every button name was observed in build 322888.
local M={}
function M.valid(o) return o and o:IsValid() end
function M.find(context,class,visibleOnly)
 local a=UE.TArray(UE.UUserWidget);UE.UWidgetBlueprintLibrary.GetAllWidgetsOfClass(context,a,class.StaticClass(),false)
 for i=1,a:Length()do local w=a:Get(i);if M.valid(w) and (not visibleOnly or w:IsVisible())then return w end end
end
function M.named(root,name)
 local seen={};local function walk(w,depth)
  if not M.valid(w) or seen[w] or depth>35 then return end;seen[w]=true
  if w:GetName()==name then return w end
  if type(w.GetChildrenCount)=='function' then for i=0,w:GetChildrenCount()-1 do local found=walk(w:GetChildAt(i),depth+1);if found then return found end end end
  if w.WidgetTree then return walk(w.WidgetTree.RootWidget,depth+1) end
 end
 return walk(root,0)
end
return M

