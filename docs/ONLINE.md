# Zoigram 1.0 Creators

Zoigram connects real players to a community server from the inZOI phone. Client 1.0.0 uses server 0.22.0 and schema 11. There are no NPC social accounts. A Zoigram account is independent of the selected Zoi, city and save file.

## Sign in

Open Zoigram, choose sign in or create an account, and open the displayed browser link. Check the code and use your private Zoigram login and password. No Steam sign-in or email is required. Save the recovery code when registering. A private login is separate from your public name and ID.

One registration creates one profile. Without external identity verification, one person can register more than one account. The service does not verify ownership of inZOI.

## Photos and profiles

Use **+ → Photo Mode → take and save a photo → return to Zoigram**. Add a caption and publish. Albums contain up to five photos; drafts preserve their order and caption. Upload retries reuse the same publication request and resume confirmed photos.

The current client prepares source photos up to 64 MiB and 64 million pixels before upload. Each prepared photo may be up to 25 MiB through the resumable protocol. Older clients retain their legacy 8 MiB limit. See the release review for decoding, fallback and server image limits. Avatars have a separate 8 MiB limit.

Use the post menu to edit your caption, delete your own post or pin up to three posts in your profile. Pinned posts do not change chronological feed order. Deleting a publication removes its server photos, comments and reactions; original local photos remain.

Change your name, bio or avatar through **Profile → Edit profile**. Your public ID follows your name: letters become lowercase, spaces become underscores, and decorative symbols are removed. Unicode names are supported. IDs contain up to 24 code points; duplicates receive a number. Former IDs remain reserved to your account and still resolve in mentions and exact search. Your internal account identity and private login do not change. A moderator override lasts until you change the display name again.

## Community actions

Like, comment, follow, save posts and send private messages from the app. Mention a player with **@ID** in a caption or comment. The activity screen shows likes, follows, comments and mentions; opening an item leads to its related content. Notification counters refresh while the app is open. This is not real-time multiplayer world synchronization.

Report a post, comment or profile from its menu. Reports go to the owner's private moderation panel. Blocking removes relationships and limits contact and content visibility. Reports alone do not delete content automatically.

The owner grants and revokes Creator status in the moderation panel. Creators have a gold badge and avatar ring. Creator and verification are separate statuses, and neither gives access to moderation.

Creators can select **Activate superpower** in their own profile for **10% faster Filming skill learning for 60 in-game minutes** on the selected Zoi. The server verifies Creator access before activation. The effect does not stack or extend when clicked again, and activation does not award experience or levels directly. Its remaining time appears in the profile. The effect is removed on expiry, mod reload or world load. See [the release notes](RELEASE_1.0.md) for native validation and compatibility details.

## Language, privacy and updating

The interface follows the game's language: English, Russian, French, Korean, German or Chinese. Unsupported languages use English. Account sign-in and recovery pages remain in English. Player content is not translated. The location button displays **Coming soon** and sends no location data.

The app stores a revocable session token for its selected server. Passwords remain on the account sign-in page and are hashed on the server. Signed photo links expire and access also depends on the active session and blocks. Separate communities do not share users or photos.

Follow the instructions inside the player archive when updating. Keep account settings, sessions, drafts and original photos. Update the community server before distributing a client that requires new endpoints. Keep verified backups before database migrations. See [accounts](ACCOUNTS.md), [moderation](MODERATION.md), [the owner panel](ADMIN.md) and [localization](LOCALIZATION.md).
