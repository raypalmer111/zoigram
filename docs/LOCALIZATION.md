# Zoigram localization

Client 1.0.0 and server 0.22.0 include English, Russian, French, Korean, German and Simplified Chinese. The native phone reads UE.UKismetInternationalizationLibrary.GetCurrentLanguage(), checks for changes every two seconds and falls back to English for unsupported languages. A legacy manual language setting is ignored at app initialization. Regional tags such as de-DE and zh-Hans-CN map to their base language. Chinese currently uses Simplified Chinese for all zh variants.

Only system text is translated. Player names, captions, comments and messages are unchanged. The separate account sign-in/recovery pages remain in English by the owner's request. Send location displays the literal Coming soon in every language and does not collect or send location data.

Edit locales/messages.json for RU/EN/FR/KO and the matching keyed catalog in locales/messages.de.json or locales/messages.zh.json. Run node tools/build-locales.cjs. It verifies complete key parity and identical placeholders before writing Lua, bridge and server catalogs. Run node --test tests/*.test.cjs server/test/*.test.cjs for catalog, network and API checks. Offline Lua checks use tools/test-lua-offline.cjs with the development Fengari dependency; they do not establish compatibility with the native game. Gameplay effects also require verification in a loaded world.
