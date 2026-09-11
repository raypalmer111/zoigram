# Zoigram 0.14.0 — source and build instructions

This client requires Zoigram server 0.15.0 with password authentication. The server was deployed and the client was installed and checked in-game on 10 September 2026. Existing players must configure their private login from an active session before signing out. The source for the earlier quarantined 0.13.1 file remains in GitHub history at commit 7a042cf287ed6fc4eb80e99ebc09f7a1926bd704; these are different releases.

On 11 September 2026, server hotfix 0.15.1 made sign-in, registration, password settings and recovery pages consistently English, including older links carrying another language. In-game and API translations remain available in all four languages. Client 0.14.0 is unchanged.

## Contents and network behavior

The manual player ZIP contains readable Lua source, JavaScript/HTML, manifests and PNG artwork. It contains no EXE, DLL, PowerShell installer, nested archive, server database, real account, password or private key. The separate source package includes server sources, synthetic test fixtures and the old optional installer source for review; the installer is not included or required in the player download.

The native UMG app uses the inZOI mod APIs; a hidden Cohtml bridge has a fixed API route/method allowlist. It does not download executable updates, evaluate downloaded code, upload game saves or access Steam authentication.

Internet access is essential for photos, avatars, comments, likes, follows, notifications, reports and private messages. The configured community endpoint is https://vps-24654da6.vps.ovh.net. Another compatible HTTPS community can be selected. HTTP is limited to local development addresses.

## Accounts

Sign-in opens an external browser on the configured community server. New users create a private username and password, without email or Steam. Passwords are hashed server-side using scrypt (N=32768, r=8, p=3, random salt). The game receives only a revocable session token and stores it in its own mod configuration, scoped to the server.

Recovery uses a random 160-bit code shown once; the database stores its hash. Password recovery rotates the code and revokes existing sessions. Forms require a same-origin request, HttpOnly cookie and CSRF token; attempts and expensive password operations are limited.

Existing signed-in users configure credentials through Profile > Edit profile > Sign-in and recovery. Their profile UUID, public ID, posts and relationships are retained. Old provider/subject database columns remain only for historical identity continuity; there is no Steam login endpoint or request. Expired legacy sessions require an owner-assisted ownership check; a new registration cannot claim an old public ID.

A private login identifies one profile. Without external identity verification, one person can create multiple accounts. Moderation remains bound to one explicitly configured profile UUID.

## Rebuild the manual client

Node.js 20 or newer, no client dependencies or administrator permissions:

    node tools/package-nexus.cjs --directory ./review-output

The result is review-output/InzoiSocial_YV6DPJ. On Windows, this also creates separate standard ZIPs:

    node tools/package-nexus.cjs

The Lua bundler concatenates checked-in modules into readable source, without bytecode, loadstring or runtime eval. Generated locales and image byte tables are checked in.

## Tests

    node --test tests/*.test.cjs

Server tests require Node.js 24.13 or newer:

    cd server
    pnpm install --frozen-lockfile --ignore-scripts
    node --test test/*.test.cjs

The Dockerfile pins pnpm 11.19.0. No production secrets are required. The source-package test verifies that this source alone rebuilds byte-identical client files.

## Review disclosure

The project was developed using an AI coding agent under the author's direction; apply the relevant Nexus AI tags. Local checks are documented separately and do not imply Nexus approval.

Removing Steam changes authentication and is not evidence that the earlier quarantine was caused by Steam. The exact Nexus scanner trigger is unknown. Review source and build steps are provided for a moderator to inspect.
