# Zoigram 1.0 Creators — source and build instructions

Client **1.0.0** is paired with server **0.22.0** and database schema **11**. Update the community server before distributing the client. Internal account identities, credentials, posts and conversations remain intact. Public IDs now follow each player's chosen display name.

## Changes in this release

- Public IDs update when the display name changes. Unicode letters and numbers are retained, letters use lowercase, spaces become underscores, and decorative symbols are removed. Duplicates receive a numeric suffix. A public ID has up to 24 Unicode code points. Names that contain no usable characters keep a stable generated fallback.
- Former IDs remain reserved to their original accounts and resolve in mentions and exact-ID search. Migration derives IDs from existing non-placeholder names. Bio-only edits preserve an existing ID, including a moderation override.
- Only the configured owner can grant or revoke Creator status in the moderation panel. Gold crowns and avatar rings follow the immutable profile UUID. Creator status does not grant moderation access; ordinary verification is independent.
- Creators can activate **10% faster Filming skill learning for 60 in-game minutes** for the selected Zoi from their own profile. The effect does not stack or extend when activated again. Activation does not grant experience or levels directly. The effect ends on expiry, mod reload or world load.
- English, Russian, French, Korean, German and Chinese interface support.

## Creator ability

Open your own profile and select **Activate superpower** while a Zoi is selected in a loaded world. The community server checks the account's current Creator access; the client applies and verifies the fixed native Filming learning effect. The profile shows its active state and remaining game minutes. Other skill-learning modifiers are unchanged.

The 1.1 Filming learning multiplier, unchanged experience and skill level on activation, protection against stacking, expiry cleanup and reload cleanup were verified in a running game. Offline tests cover authorization and lifecycle handling separately. The effect definitions are shipped as readable client source. The server cannot send arbitrary commands, percentages or targets to the game through this feature.

## Compatibility and migration

Schema 11 adds reserved ID aliases and explicit Creator grants. Migration is transactional and repeatable without renaming users again. Prepare a verified backup and rehearse on an isolated copy before updating a running community. Databases, player sessions, media keys and deployment telemetry are excluded from release sources.

## Photo limits and compatibility

A source-file limit is different from the transmitted-image limit. One MiB is 1,048,576 bytes; one MP here is one million pixels.

- Source file: at most **64 MiB**. Canvas preparation supports up to **64 MP**.
- Prepared upload: at most **25 MiB per photo** through the new resumable protocol.
- Legacy endpoint used by older clients: **8 MiB per photo**. Updating only the server does not add client-side compression to an old mod.
- If canvas/JPEG encoding is unavailable, the original may be sent only if it fits the protocol limit and server validation. Server inputs must be single-frame PNG, JPEG or WebP, at least 64 × 64 pixels and at most 32 million pixels. Without successful preparation, known inputs over 32 MP are rejected locally rather than sent. The PNG exported by Photo Mode is inspected before browser decoding, including the 64 MP source limit. Unsupported originals remain rejected.

Server processing re-encodes accepted photos, limits their maximum edge to 2048 pixels and creates thumbnails. The source-file increase applies to publication photos, not to every upload type or avatar limit.

## Contents and network behavior

The manual player package consists of readable Lua source, JavaScript/HTML, manifests and PNG artwork. The packaging allowlist excludes executables, DLLs, installer scripts, nested archives, databases, private credentials and private keys. The review source package is a separate ZIP; do not nest it inside the player ZIP.

The native phone app uses inZOI mod APIs and a hidden Cohtml bridge with a fixed API route/method allowlist. It does not download executable updates, evaluate downloaded code, upload game saves or contact Steam authentication.

The configured community endpoint is [the Zoigram community server](https://vps-24654da6.vps.ovh.net). Internet access is required for community profiles, selected photo and avatar uploads, comments, likes, follows, notifications, reports, messages, announcements and Creator authorization. The game stores a revocable session token for the selected server. Passwords are hashed server-side using scrypt.

Upload diagnostics contain bounded error codes, the mod version and available size/status information. They do not include arbitrary local files, photo contents, passwords, session tokens or raw error messages. The history and server metrics require the existing owner session. Announcement changes also require CSRF protection.

Existing signed-in players attach credentials to their profile through Profile > Edit profile > Sign-in and recovery. Attaching credentials preserves the current public ID, posts and relationships; changing the display name updates the public ID as described above. Recovery uses a one-time private recovery code. No account credentials or sessions are distributed in the source repository.

## Rebuild the manual client

Use Node.js 20 or newer. No client dependencies or administrator permissions are required. Run from the source root; use an empty output directory:

    node tools/package-nexus.cjs --directory ./review-output

The result is review-output/InzoiSocial_YV6DPJ. To create separate standard player and source ZIPs under artifacts/releases:

    node tools/package-nexus.cjs

The Lua bundler combines checked-in modules into readable source without bytecode, loadstring or runtime eval. Generated locales and image byte tables are checked in.

## Tests

From the source root:

    node --test tests/*.test.cjs

Server tests require Node.js 24.13 or newer and pnpm:

    cd server
    pnpm install --frozen-lockfile --ignore-scripts
    node --test test/*.test.cjs

Optional offline Lua checks use the Fengari 0.1.5 test VM. Run from the source root:

    npm install --prefix ./artifacts/lua-qa --no-save --ignore-scripts fengari@0.1.5
    node tools/test-lua-offline.cjs

This test dependency is not included in the player mod. The source-package test checks that the included source rebuilds byte-identical client files. Tests use isolated synthetic accounts and require no production secrets. These commands describe how to verify a build; completed release checks, artifact hashes and deployment results are recorded separately.

Project: [Zoigram source](https://github.com/raypalmer111/zoigram). Distribution: [Zoigram on Nexus Mods](https://www.nexusmods.com/inzoi/mods/1474).
