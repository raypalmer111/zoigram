# Zoigram 0.13.1 - source and review notes

Nexus page: https://www.nexusmods.com/inzoi/mods/1474

This source package is separate from the manual player download. It contains no real accounts, photos, sessions, database, private keys or production environment file. Test accounts and fixtures are synthetic.

The mod adds a native UMG social application to the existing inZOI phone. It uses the game's Lua and UI mod systems. The player package contains ordinary Lua/JavaScript/HTML, JSON manifests and PNG artwork. It has no EXE, DLL, PowerShell installer, nested archive or password. It does not download or execute program updates.

The previous 109705-byte player ZIP included an optional Install.ps1. It copied files into the Windows Documents mod folder, removed specifically listed obsolete Lua files and enabled the manifest. Its original source is provided as tools/Install-Native.ps1 for review; the replacement player package does not require or include it. The exact Nexus scan trigger is unknown. The manual package is not a claim that quarantine has been cleared.

## Network functionality

Internet access is essential to sharing content between real players. The configured default API is https://vps-24654da6.vps.ovh.net. Users may select another compatible HTTPS community server. Loopback HTTP is supported for local development only.

Steam authentication takes place in an external browser through Steam OpenID. The mod receives an application session token, not the Steam password. Tokens and settings are stored by the game in the mod's online configuration section. The hidden Cohtml UI is a transport bridge with a fixed API route/method allowlist; the visible application is native UMG.

Users explicitly publish Photo Mode images, upload an avatar, like, comment, follow, report or send messages. The client retrieves feeds, signed images, profiles, notifications and conversations. Avatars are selected in the browser using a short-lived, owner-bound upload capability. Game saves are not uploaded. Server source, moderation endpoints and tests are included for inspection.

## Reproduce the manual client

Requires Node.js 20 or newer (24 recommended). No npm dependencies or administrator permissions are needed for the client folder build.

From this source root, run:

```text
node tools/package-nexus.cjs --directory ./review-output
```

The resulting review-output/InzoiSocial_YV6DPJ folder is ready for manual installation. On Windows, running `node tools/package-nexus.cjs` additionally creates standard ZIP files using .NET's ZIP implementation with forward-slash entry names. Source and player ZIPs remain separate.

tools/bundle-native.cjs combines the checked-in Lua modules into one readable Lua source file for the game's startup validator. It does not produce machine code or Lua bytecode and does not use loadstring, runtime eval or downloaded code. The PNG byte tables in IconData/GlyphData are local UI artwork imported using the game texture API. Generated locale and glyph files are checked in, so reproducing the release does not require image generation or external services.

## Tests

```text
node --test tests/*.test.cjs
```

Server tests require Node.js 24.13 or newer and the pinned pnpm dependency lockfile:

```text
cd server
pnpm install --frozen-lockfile --ignore-scripts
node --test test/*.test.cjs
```

The server's Dockerfile uses pnpm 11.19.0. These tests use isolated databases and test identities; no production credentials are required.

## Version and disclosure

The software version is 0.13.1 (server API version 0.14.1). The supplied Nexus screenshot shows file metadata 0.43.1; this does not match the source or plugin manifest and should be corrected on the file page after confirming the upload.

Source code and build instructions are provided for review.
