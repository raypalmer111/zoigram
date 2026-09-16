# Zoigram server 0.20.2 — fixes and validation

Client 0.8.0 is unchanged. Database schema remains 9. This is a server maintenance update.

## Confirmed issues fixed

- An invalid absolute HTTP request URL could terminate the API process. It now returns HTTP 400, and a subsequent health request succeeds.
- Photo uploads and profile changes could finish after logout, a ban or session expiry. Authorization is checked again after receiving a body and after asynchronous image processing.
- A message could arrive after its recipient blocked the sender. Comments submitted while a post was deleted or blocked could create an internal error or bypass the new restriction. These actions now check current access before writing.
- An owner action or announcement could finish after the moderator logged out. Approved device login tokens also survived a ban and subsequent unban. Both paths now respect revoked access.
- An interrupted account form was recorded as an internal error. Known connection interruptions now have the appropriate transport status; unrelated internal errors remain visible.
- Avatar uploads bypassed the shared admission and conversion limits and could persist after disconnection. Photos and avatars now share the same bounded transport and conversion queue.
- A malformed Unicode signature in a photo or avatar link caused an internal error. Signatures are validated before constant-time comparison.
- Invalid backup-status dates could conceal freshness and restore warnings. The dashboard now uses validated status fields.
- Restarting after an interrupted upload-session migration could leave a missing generation identifier. Startup repairs missing identifiers atomically while preserving existing values.

## Validation and scope

All 146 local server tests passed, including 35 new regression checks. Tests use isolated databases and HTTP connections. The malformed-request test uses a separate process and verifies that the API remains available after the rejected request.

The audit covered HTTP dispatch, photo and avatar transport, access revocation, accounts, moderation, messages, comments, media links, diagnostics, announcements, database startup, backup status and existing backup/restore tests. This is evidence for the tested behavior, not a guarantee that every possible bug is absent. Linux candidate tests and production checks are recorded separately in the deployment artifacts.

Resource limits remain in place: at most four admitted image requests and two simultaneous conversions. An album may contain up to five photos. These are different limits; unlimited simultaneous decoding can exhaust memory.
