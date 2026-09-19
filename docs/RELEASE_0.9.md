# Zoigram 0.9.0

Client 0.9.0, server 0.21.0, SQLite schema 10.

Players can mention @publicIDs in captions and comments, open mention notifications, and pin up to three own posts above the chronological profile grid. The Creator crown and avatar ring are assigned from the configured immutable owner profile ID. All new interface messages have six translations.

Media refresh keeps the existing signed-link authorization and renews expired photo/avatar URLs in batches of at most 30 targets. It preserves navigation and inputs, compensates for device clock differences, and limits automatic retries separately for each album photo. Unauthorized responses clear the former account's visible state.

Upload preparation checks the first missing local photograph before allocating a new session. Empty cancellation is advertised as a capability; clients never send it blindly to an older server. Idle empty sessions can be reclaimed when a new upload needs a slot, while received parts and active requests remain protected. Operational errors carry bounded reason and stage values, and rate-limit responses include meaningful retry times.

The schema migration preserves existing notification IDs, read state and sequence counters, adds mention uniqueness indexes and profile pins, and remains idempotent. Older clients receive the notification kinds they understand and retain chronological profile pagination. Backups include the pin count when that table exists, without changing the recorded structure of older backup manifests.

## Validation

- Combined Node test suite: 228 passed, including 171 server tests.
- Offline Lua: 30 behavior checks passed; all 28 modules compile.
- Focused final media-refresh and backup checks: 17 passed.
- Isolated browser checks cover the Creator crown/ring, separate normal verification, owner dialog, specific upload causes/stages and a 390px mobile viewport.
- Source-package checks rebuild byte-identical client contents without installed game files.
- SQLite implicit rollbacks preserve the original failure, while failed commits still roll back active transactions.

These results describe local and isolated tests. A browser screenshot does not establish native UMG rendering. In-game visual verification, server migration rehearsal, final archive hashes, deployment and source publication are recorded separately when completed. Production databases, sessions and operational reports are excluded from the public source.
