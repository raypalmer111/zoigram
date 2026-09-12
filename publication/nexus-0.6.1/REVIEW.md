# Zoigram 0.6.1 — source and build instructions

Client 0.6.1 and server 0.18.1 add an Unread conversation filter and local message drafts for individual chats. Drafts survive restarts, are bound to the active server/account, and are cleared on explicit sign-out. Up to 20 recent drafts are retained. A saved request ID makes send retries idempotent. Typing while a message is sending preserves the next draft. English, Russian, French, Korean, German and Simplified Chinese are supported. Game-language selection, bookmarks, comment alerts and the Coming soon location placeholder from 0.6 remain available.

## Contents and network behavior

The manual player ZIP contains readable Lua source, JavaScript/HTML, manifests and PNG artwork. It contains no EXE, DLL, PowerShell installer, nested archive, database, private account, password or private key. Source packages are separate from the player ZIP.

The native phone app uses the inZOI mod APIs and a hidden Cohtml bridge with a fixed API route/method allowlist. It does not download executable updates, evaluate downloaded code, upload game saves or contact Steam authentication.

The configured community endpoint is https://vps-24654da6.vps.ovh.net. Internet access is required for community profiles, selected photo and avatar uploads, comments, likes, follows, notifications, reports and messages. The game stores a revocable session token scoped to the selected server. Passwords are hashed server-side using scrypt.

Existing signed-in players attach credentials to their existing profile through Profile > Edit profile > Sign-in and recovery. Public IDs, posts and relationships are retained. Recovery uses a one-time private recovery code. No account credentials or sessions are distributed in this repository.

## Rebuild the manual client

Use Node.js 20 or newer. No client dependencies or administrator permissions are required:

    node tools/package-nexus.cjs --directory ./review-output

The result is review-output/InzoiSocial_YV6DPJ. This command also creates separate standard ZIPs:

    node tools/package-nexus.cjs

The Lua bundler concatenates checked-in modules into readable source without bytecode, loadstring or runtime eval. Generated locales and image byte tables are checked in.

## Tests

    node --test tests/*.test.cjs

Server tests require Node.js 24.13 or newer:

    cd server
    pnpm install --frozen-lockfile --ignore-scripts
    node --test test/*.test.cjs

The source-package test verifies that the checked-in source rebuilds byte-identical client files. Tests use isolated synthetic accounts and require no production secrets.

## Review disclosure

The project was developed with an AI coding agent under the author's direction. Source and build instructions are provided for review. Local tests and antivirus results do not imply Nexus Mods approval.
