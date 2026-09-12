local Catalog=require('B1.LocalizationCatalog')
local M={preference='auto',language='en'}
function M.normalize(value)
 if type(value)~='string'then return nil end
 local language=value:lower():gsub('_','-'):match('^([a-z]+)')
 return Catalog[language]and language or nil
end
function M.refresh()
 local language=M.normalize(M.preference)
 if not language then
  local ok,value=pcall(function()return UE.UKismetInternationalizationLibrary.GetCurrentLanguage()end)
  language=ok and M.normalize(tostring(value))or nil
 end
 language=language or'en';local changed=M.language~=language;M.language=language;return changed
end
function M.set(value)M.preference=M.normalize(value)or'auto';M.refresh();return M.preference end
function M.t(key,values)
 if key==nil then return ''end
 local message=Catalog[M.language][key]or Catalog.en[key]or key
 return(message:gsub('{([%w_]+)}',function(name)return values and values[name]~=nil and tostring(values[name])or'{'..name..'}'end))
end
function M.date(milliseconds)
 local formats={ru='%d.%m.%Y',en='%m/%d/%Y',fr='%d/%m/%Y',ko='%Y.%m.%d',de='%d.%m.%Y',zh='%Y/%m/%d'}
 return os.date(formats[M.language]or formats.en,math.floor(milliseconds/1000))
end
function M.name()
 local names={ru='Русский',en='English',fr='Français',ko='한국어',de='Deutsch',zh='简体中文'};return names[M.language]or'English'
end
function M.choices()
 return {{'auto',M.t('Как в игре')},{'ru','Русский'},{'en','English'},{'fr','Français'},{'ko','한국어'},{'de','Deutsch'},{'zh','简体中文'}}
end
return M
