# Zoigram 0.9.0 — source and build instructions

Client **0.9.0** is paired with server **0.21.0** and database schema **10**. Update the community server before distributing the client. Existing accounts, passwords, public IDs, photos and social activity are retained. These are build and behavior notes; release checks and deployment results are recorded separately.

## Changes in this release

- Mention another player with their @publicID in a post caption or comment. Supported clients show mention notifications that open the associated publication or discussion. Self-mentions, blocked accounts and banned accounts do not generate alerts. Retrying a request does not duplicate notifications. Older clients retain their existing notification behavior.
- Pin up to three of your own posts at the top of your profile and unpin them from the post menu. The general feed remains chronological. Pins are controlled by the server and cannot be assigned to another player's post.
- The configured creator account receives a gold crown and a matching avatar ring. The badge is bound to the server's immutable owner profile ID, so a matching username or a profile edit cannot confer Creator status. Ordinary verification remains independent.
- Refresh expired photo and avatar links through authenticated requests. Refreshes and failed-image retries are bounded, and normal navigation preserves its place and drafts. Signed links, account restrictions and media access checks remain enforced.
- Recover from abandoned empty upload sessions and avoid leaving new empty sessions after local photo-read failures. Received album photos and completed publications remain protected. Upload diagnostics distinguish causes and provide appropriate retry guidance.
- All interface additions are localized in English, Russian, French, Korean, German and Chinese, following the game's language.

## Compatibility and migration

Schema 10 adds profile pins and mention notifications. Migration preserves notification IDs, read state and sequence numbers. Prepare a verified backup and rehearse the migration on a copy before deployment. The community database and media key are private and are not included in any release archive.

The existing album, saved-post, search, messaging, moderation and backup features remain available. The source package includes the server and client tests needed to exercise the new behavior. Tests use isolated accounts and never send test notifications to production players.

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

The configured community endpoint is [the Zoigram community server](https://vps-24654da6.vps.ovh.net). Internet access is required for community profiles, selected photo and avatar uploads, comments, likes, follows, notifications, reports, messages and announcements. The game stores a revocable session token for the selected server. Passwords are hashed server-side using scrypt.

Upload diagnostics contain bounded error codes, the mod version and available size/status information. They do not include arbitrary local files, photo contents, passwords, session tokens or raw error messages. The history and server metrics require the existing owner session. Announcement changes also require CSRF protection.

Existing signed-in players attach credentials to their profile through Profile > Edit profile > Sign-in and recovery. Public IDs, posts and relationships are retained. Recovery uses a one-time private recovery code. No account credentials or sessions are distributed in the source repository.

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

The source-package test checks that the included source rebuilds byte-identical client files. Tests use isolated synthetic accounts and require no production secrets. These commands describe how to verify a build; completed release checks and artifact hashes must be recorded separately.

Project: [Zoigram source](https://github.com/raypalmer111/zoigram). Distribution: [Zoigram on Nexus Mods](https://www.nexusmods.com/inzoi/mods/1474).
