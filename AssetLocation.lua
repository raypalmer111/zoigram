-- Resolve storage lazily through the game's own mod manager, including redirected Documents.
-- Re-registering an already mounted Lua mod is idempotent; this does not call reload.
local cached
return function()
 if cached then return cached end
 local ok,base=UE.UPluginBlueprintLibrary.GetPluginBaseDir('__MOD_ID__')
 if not ok or type(base)~='string' or base=='' then
  local mounted,message=inzoi.cli.execute('luamod.mount mod_id=__MOD_ID__')
  assert(mounted and type(message)=='string','MOD_STORAGE_UNAVAILABLE')
  base=message:gsub('\\','/'):match('%((.+)/lua%)$')
 end
 assert(type(base)=='string' and base~='','MOD_STORAGE_UNAVAILABLE')
 base=base:gsub('\\','/'):gsub('/+$','')
 assert(base:match('/__MOD_ID__$'),'UNEXPECTED_MOD_STORAGE')
 cached=base..'/assets/instagram-icon.png'
 return cached
end
