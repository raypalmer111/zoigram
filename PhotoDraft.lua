local M={}
function M.captionLength(text)local n=0;for _ in text:gmatch('[%z\1-\127\194-\244][\128-\191]*')do n=n+1 end;return n end
function M.validPhoto(filename)return type(filename)=='string'and filename:match('^post_%d+_%d+_%d+%.png$')~=nil end
return M
