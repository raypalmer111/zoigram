'use strict';
// Test-only Lua 5.3 VM. No UE objects are simulated as passing native UI checks.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const F=require('../artifacts/lua-qa/node_modules/fengari'),{lua,lauxlib,lualib,to_luastring}=F,L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function execute(source,name){const status=lauxlib.luaL_loadbuffer(L,to_luastring(source),null,to_luastring(name));if(status!==lua.LUA_OK)throw Error(lua.lua_tojsstring(L,-1));if(lua.lua_pcall(L,0,0,0)!==lua.LUA_OK)throw Error(lua.lua_tojsstring(L,-1))}
const root=path.resolve('InzoiSocial/lua');let modules=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.lua')){const source=fs.readFileSync(f,'utf8'),relative=path.relative(root,f).replaceAll('\\','/'),name=relative.replace(/\.lua$/,'').replaceAll('/','.');const status=lauxlib.luaL_loadbuffer(L,to_luastring(source),null,to_luastring(relative));assert.equal(status,lua.LUA_OK,status!==lua.LUA_OK?lua.lua_tojsstring(L,-1):relative);lua.lua_pop(L,1);execute('package.preload['+JSON.stringify(name)+']=function(...)\n'+source+'\nend',name);if(name.startsWith('Shared.'))execute('package.preload["B1.'+name+'"]=package.preload['+JSON.stringify(name)+']','alias');modules++}}}walk(root);
execute("UE={UKismetInternationalizationLibrary={GetCurrentLanguage=function()return 'en'end}}",'game language fixture');
// Current release's Unicode public IDs must remain valid in native avatar text.
for(const file of ['tests/lua/messaging061.lua','tests/lua/albums070.lua','tests/lua/social090.lua','tests/lua/identity0100.lua','tests/lua/creator-controller100.lua','tests/lua/creator100.lua'])execute(fs.readFileSync(file,'utf8'),file);
console.log('Compiled '+modules+' Lua modules; offline client checks passed.');
