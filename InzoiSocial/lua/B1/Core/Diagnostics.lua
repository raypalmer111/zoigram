-- Local diagnostics; no simulation data is written.
local M = {}
function M.emit(state, detail)
    local value = state .. (detail and ('; ' .. tostring(detail)) or '')
    print('[InzoiSocial] ' .. value)
    value = value:gsub('["\\\r\n]', '_')
    if inzoi and inzoi.cli and type(inzoi.cli.execute) == 'function' then
        local ok, err = pcall(inzoi.cli.execute, 'uimod.cfg_save mod_id=__MOD_ID__ section=diagnostics key=social value="' .. value .. '"')
        if not ok then print('[InzoiSocial] Diagnostic persistence unavailable: ' .. tostring(err)) end
    end
end
return M
