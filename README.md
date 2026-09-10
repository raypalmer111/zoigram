# Zoigram

Photo sharing between real players inside the inZOI phone. This repository contains the client 0.43.1 and community server 0.14.1 source for review and reproducible builds.

[Nexus Mods page](https://www.nexusmods.com/inzoi/mods/1474) · [Network and review notes](publication/nexus-0.13.1/REVIEW.md) · [Manual installation](publication/nexus-0.13.1/INSTALL.txt)

## Features

- Steam-linked profiles with server-assigned public IDs.
- Photo Mode posts, custom avatars, comments, likes and follows.
- Notifications, private messages, blocking and reports to the owner.
- Native UMG interface in the existing phone; English, Russian, French and Korean.

Internet access and Steam sign-in are required for community features. The client defaults to the Zoigram community service. No production database, accounts, tokens, private keys or personal photographs are included here. Test fixtures use synthetic accounts.

## Build the client

Install Node.js 20 or newer (24 recommended). From this repository root:

~~~text
node tools/package-nexus.cjs --directory ./review-output
~~~

The generated review-output/InzoiSocial_YV6DPJ folder can be installed by copying it into the Windows Documents/inZOI/Mods/InGame folder. Follow the included README.txt, especially when updating an existing installation. No package installation, PowerShell installer or administrator access is required for this folder build.

On Windows, running node tools/package-nexus.cjs creates a manual client ZIP and a separate review-source ZIP using the standard Windows ZIP implementation. Do not nest the source ZIP inside the player ZIP.

## Run tests

Client and packaging checks require no dependencies:

~~~text
node --test tests/*.test.cjs
~~~

Server checks require Node.js 24.13 or newer and pnpm (11.19.0 was used for the released server):

~~~text
cd server
pnpm install --frozen-lockfile --ignore-scripts
node --test test/*.test.cjs
~~~

The reviewed source snapshot passed 60 client/server checks, including account boundaries, image validation, moderation, backups and reproducible client packaging. These tests do not constitute an antivirus approval or a Nexus moderation decision.

## Source layout

- InzoiSocial/lua: native phone integration and interface.
- InzoiSocial/ui/OnlineBridge: the game's Cohtml network transport.
- server: community API, browser avatar upload and owner moderation interface.
- locales: source strings for all four supported languages.
- tools/bundle-native.cjs: combines modules into readable Lua source for the game validator.
- tools/package-nexus.cjs: builds the manual installation package.

The Lua bundle is source text, not bytecode. Embedded PNG byte tables are UI artwork. The mod does not download executable updates. The original optional installer is retained in tools/Install-Native.ps1 for inspection of the earlier Nexus upload; it is not included in the manual player package.

This project was developed with an AI coding agent under the mod author's direction. See the review notes for network behavior and disclosure.
