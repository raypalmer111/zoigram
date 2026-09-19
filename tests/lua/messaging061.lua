local Drafts=require('B1.Data.MessageDrafts')
local Controller=require('B1.Online.Controller')
local Transport=require('B1.Online.Transport')
local Json=require('B1.Shared.Json')
local count=0
local function test(name,fn)fn();count=count+1;print('PASS '..name)end
local function storage()
 local encoded;local writes=0
 return {read=function()return encoded and Json.decode(encoded)end,write=function(_,value)encoded=Json.encode(value);writes=writes+1 end},function()return writes end
end
test('Drafts survive reopening, isolate peers, and bind to account and server',function()
 local s,w=storage();local d=Drafts.new(s,'https://one','owner');assert(d:set('alice','Hello 中文'));assert(d:set('bob','Bonjour'));assert(d:get('alice')=='Hello 中文');assert(d:get('bob')=='Bonjour')
 d=Drafts.new(s,'https://one','owner');assert(d:get('alice')=='Hello 中文');local before=w();assert(d:set('alice','Hello 中文'));assert(w()==before)
 assert(Drafts.new(s,'https://two','owner'):get('alice')=='');assert(Drafts.new(s,'https://one','other'):get('alice')=='')
 assert(d:set('alice',''));assert(Drafts.new(s,'https://one','owner'):get('alice')=='');assert(d:get('bob')=='Bonjour')
end)
test('A send retry reuses its persisted ID, but another peer or edited text gets a new one',function()
 local s=storage();local n=0;local function nonce()n=n+1;return 'id'..n end
 local d=Drafts.new(s,'s','a');d:set('p','same');local id=d:requestId('p',nonce);d=Drafts.new(s,'s','a');assert(d:requestId('p',nonce)==id);d:set('q','same');assert(d:requestId('q',nonce)~=id);d:set('p','changed');assert(d:requestId('p',nonce)~=id)
end)
test('Failed persistence retries without pretending a request ID is durable; logout clears drafts',function()
 local s=storage();local d=Drafts.new(s,'s','a');local write=s.write;s.write=function()error('disk unavailable')end;assert(not d:set('p','draft'));assert(d:requestId('p',function()return 'stable'end)==nil)
 s.write=write;assert(d:requestId('p',function()error('must retain generated ID')end)=='stable');assert(Drafts.new(s,'s','a'):get('p')=='draft');assert(d:clear());assert(Drafts.new(s,'s','a'):get('p')=='')
end)
test('Oversized drafts are rejected without replacing the saved text; recent drafts are bounded',function()
 local s=storage();local d=Drafts.new(s,'s','a');d:set('p','keep');assert(not d:set('p',string.rep('x',64001)));assert(d:get('p')=='keep');for i=1,25 do assert(d:set('p'..i,'value'))end;assert(#d.entries==20 and d:get('p25')=='value'and d:get('p1')=='')
end)
local function controller()
 local inputs={message=''};local s=storage();Transport.read=s.read;Transport.write=s.write
 local c=setmetatable({me={id='owner'},server='https://one',mode='messages',conversationId='alice',messages={},history={},transport={},revision=0,app={view={getOnlineInput=function(_,k)return inputs[k]or''end,clearOnlineInput=function(_,k)inputs[k]=''end}}},Controller);c.draw=function()end
 return c,inputs
end
test('Controller preserves typed text after delayed send and clears only the submitted draft',function()
 local c,inputs=controller();inputs.message='First';local done;local sent;c.request=function(_,method,path,body,callback)sent=body;done=callback end
 c:act('sendMessage');assert(sent.text=='First');inputs.message='Second while waiting';done({message={id=7,text='First',outgoing=true}});assert(inputs.message=='Second while waiting'and c:messageDraft('alice')=='Second while waiting')
 c:act('sendMessage');assert(sent.text=='Second while waiting');done({message={id=8,text=sent.text,outgoing=true}});assert(inputs.message==''and c:messageDraft('alice')=='');assert(#c.messages==2)
end)
test('Unread filter resets the cursor, persists in history and is used by subsequent pages',function()
 local c=controller();c.mode='conversations';c.conversations={};c.request=function(self,method,path,body,callback)self.lastPath=path;callback({conversations={},nextCursor='18',unread=3})end
 c:act('conversationFilter','unread');assert(c.lastPath=='/api/conversations?filter=unread');c:act('moreConversations');assert(c.lastPath=='/api/conversations?filter=unread&before=18');local state=c:snapshot();c.conversationFilter='all';c:restore(state,false);assert(c.conversationFilter=='unread'and c.lastPath=='/api/conversations?filter=unread')
end)
test('Draft preview restoration does not copy an input into a different account',function()
 local c,inputs=controller();inputs.message='private';assert(c:saveMessageDraft());assert(c:messageDraft('alice')=='private');c.me={id='different'};assert(c:messageDraft('alice')=='');c.me={id='owner'};assert(c:messageDraft('alice')=='private')
end)
test('Draft failure prevents navigation and long Unicode previews stay valid',function()
 local c,inputs=controller();inputs.message='keep';Transport.write=function()error('disk unavailable')end;c.request=function()error('must not leave this draft')end;c:act('conversations');assert(c.mode=='messages'and inputs.message=='keep'and c.error)
 assert(Drafts.preview('one\n two')=='one two');assert(Drafts.preview(string.rep('🙂',81))==string.rep('🙂',80)..'…')
end)
print('LUA_CHECKS='..count)
