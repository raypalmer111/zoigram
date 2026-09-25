# Zoigram 1.2.0 — tested client status

The Zoigram **client** package is version 1.2.0 and is marked non-beta/non-experimental. The deployed companion **server** uses its own version, 0.23.0-beta.4 (database schema 13), and currently limits stories to four per account per day. These version numbers describe different components.

## In-game photo check (25 September 2026)

- The installed 1.2.0 client opened on the inZOI phone. Existing feed images rendered, and feed scrolling worked.
- A photo saved in inZOI Photo Mode appeared in the post composer's large preview and thumbnail. The draft and preview survived an inZOI restart.
- The owner published one temporary post containing that photo and immediately deleted it. The client received a successful post response and cleared the draft; the server created and then removed the post. The account returned to zero posts, with no related pending upload.
- Because the post was deleted immediately, its appearance in the public feed was not captured. The specific upload problem reported by another player was not reproduced or proven fixed by this single test.
- The test world was not saved after inZOI warned about content from absent mods. Its save and mod-save files still matched their backup after the check.

Automated checks against the separate 1.2.0 release source/build passed: 282 client tests (3 legacy-package tests skipped), 261 server tests, 41 offline Lua module checks, and 5 package tests. The player ZIP's SHA-256 is `B2B8C230EE6D51CD233D6B0E1D9B9B02E677D95080018DA829FF7B4796594E11`.

## Distribution and source scope

The 1.2.0 player ZIP was prepared for [Zoigram on Nexus Mods](https://www.nexusmods.com/inzoi/mods/1474). This GitHub update is an information update, **not** a Nexus upload or a GitHub binary release. Check the Nexus files page for the version actually available to players.

The source on this repository's `main` branch remains the historical 1.0.0 snapshot. Its package instructions do not build 1.2.0. The 1.2.0 client source and matching build instructions must be synchronized separately before this repository can be used to reproduce that release. Account sessions, player photos, saves, server databases, and secrets are not release-source material.
