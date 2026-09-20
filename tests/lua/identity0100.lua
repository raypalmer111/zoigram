local Kit=require('B1.UI.WidgetKit')
for _,case in ipairs({
 {{displayName='Alice',username='alice'},'A'},
 {{displayName='Анна Ли',username='анна_ли'},'а'},
 {{displayName='한 별',username='한_별'},'한'},
 {{displayName='小 明',username='小_明'},'小'},
 {{displayName='✨',username='élise'},'é'},
 {{displayName='',username=''},'Z'}
})do assert(Kit.avatarInitial(case[1])==case[2],'Avatar initial must preserve the complete UTF-8 character')end
print('PASS Avatar initials preserve Latin, Cyrillic, Korean, Chinese and accented Unicode IDs')
