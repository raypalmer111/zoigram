# Zoigram 1.0 Creators

Client 1.0.0, server 0.22.0, schema 11.

Public IDs follow player-selected names. Normalization retains Unicode letters, combining marks attached to letters, numbers and underscores; spaces become underscores, symbols are removed, and letters become lowercase. Collision suffixes remain within 24 code points. Old IDs stay reserved for their original accounts and work in mentions and exact search, preventing reassignment after a rename. Internal UUIDs, accounts, passwords, photos, conversations and relationships remain unchanged.

Existing non-placeholder display names are migrated once. A bio-only save does not rename the account. A moderator override persists until the player actually changes their display name again. Direct client attempts to assign arbitrary IDs remain rejected. Native fallback avatar initials use complete UTF-8 characters for non-Latin IDs.

The owner can grant or revoke Creator status with a reason and an expected revision in the existing moderation panel. Changes are audited. Creator status does not grant admin access; the configured owner's status remains implicit. The same public profile DTO drives the gold crown and avatar ring throughout the app.

Creators can open their own profile and select **Activate superpower** to give the selected Zoi **10% faster Filming skill learning for 60 in-game minutes**. Zoigram checks Creator access with the community server before activation. The ability multiplies learning from normal Filming activities by 1.1; activation does not award experience or increase a skill level by itself.

The effect does not stack, and pressing the button again while it is active does not extend its duration. The profile displays the remaining game time. The modifier is removed when the effect expires. Reloading the mod or loading the world ends the active effect; it is not a permanent save-game upgrade. Activation requires a selected Zoi in a loaded world and a compatible client and server.

Native acceptance verified the Filming learning multiplier, unchanged experience and level at activation, repeat-activation protection, expiry cleanup and cleanup on Lua reload. The effect uses fixed definitions shipped with the client; the server authorizes access and does not supply arbitrary game commands or effect values.

Tests, release hashes, native acceptance evidence and deployment results are recorded in separate private release reports. Native acceptance does not imply that a production server has already been updated. Production data and game asset exports are not included in the source package.
