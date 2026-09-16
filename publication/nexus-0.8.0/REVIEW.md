# Zoigram 0.8.0 — source and build instructions

Client **0.8.0** is paired with server **0.20.1** and database schema **9**. The client package is unchanged by this server-only hotfix. Update the community server before distributing this client. These are build and behavior notes, not a declaration that a particular server or distribution page has already been updated.

Server 0.20.1 separates photo reception from conversion, queues completed uploads and classifies connection failures correctly. It admits up to four uploads in flight with two simultaneous image conversions. See the [server hotfix notes](https://github.com/raypalmer111/zoigram/blob/main/docs/SERVER_HOTFIX_0.20.1.md) for compatibility and validation details.

## Changes in this release

1. Photo preparation accepts originals up to 64 MiB and supports up to 64 million pixels through canvas. When JPEG encoding is available, originals exceeding 2048 pixels on either side use a resized JPEG copy with a maximum edge of 2048 pixels, even if that copy has more bytes. For smaller dimensions, the original is retained if JPEG would be larger. Original local photographs are preserved.
2. Albums of up to five ordered photos upload one photo at a time. Accepted parts survive for up to 24 hours and are skipped on retry. An interrupted individual photo restarts from its beginning. Publishing remains atomic and retry IDs prevent duplicate posts.
3. A private error history identifies upload failures by time, bounded error category, available player identity, client version, image size and HTTP status. Retention is limited to 14 days and approximately 5,000 events.
4. Owner server status separates filesystem capacity/free space from the media quota and shows temporary storage, active processing, pending albums, memory, CPU load averages and threshold warnings.
5. Backup status shows the last attempt, last successful copy, next run and sanitized failures. A restore rehearsal uses a separate temporary database after the first copy and at least weekly thereafter; it never overwrites production data.
6. The owner can preview, schedule, edit and hide plain-text announcements. Revision checks reject stale edits. Supported game clients display up to three current announcements, which players can dismiss locally.

Publication drafts retain captions, photo filenames and retry IDs for the active account, server and Zoi. Existing posts, profiles and public IDs are retained. Legacy clients still receive the album cover. All album images and avatars count toward the configured media quota; the owner can review every album photo.

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
