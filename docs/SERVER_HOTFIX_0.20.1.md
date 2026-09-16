# Server 0.20.1 — interrupted photo uploads

This server-only update fixes photo uploads that could occupy both image-processing slots while request bodies were still arriving. In server 0.20.0, further attempts could receive HTTP 503, and a disconnected upload was incorrectly recorded as an internal HTTP 500 error.

The server now accepts up to **four uploads in flight** and runs at most **two image conversions** at once. Reception and conversion use separate counters. Completed request bodies wait for a conversion worker, so two slow transfers no longer occupy both workers. These bounds protect server memory; a full admission queue can still return HTTP 503 with retry guidance.

Stalled transfers time out, disconnected queued requests are cancelled, and a disconnected conversion cannot publish its result. Transport failures are recorded separately: HTTP 499 for a disconnected or cancelled request and HTTP 408 for a timeout. These diagnostic statuses do not turn an unreliable connection into a reliable one, but they avoid treating a connection failure as a server crash.

The owner dashboard distinguishes receiving, waiting and processing uploads. Error history separates connection failures, temporary capacity responses, other rejected requests and client reports. New events identify the legacy or resumable protocol. The client version is shown only when the client supplies a valid version; the server does not infer it from the protocol. Existing diagnostic records retain their original classification.

## Client compatibility

**Client 0.8.0 is unchanged.** No replacement player ZIP is required for this server fix. Client 0.8.0 is recommended for automatic photo preparation, resumable albums and the **25 MiB per-photo** upload path. Older clients remain supported through the legacy **8 MiB per-photo** path. Updating the server alone does not add resizing or resumable uploads to an older mod.

Database schema remains **9**. This update contains no schema migration and does not remove ZoiMeet.

## Validation

The Linux candidate passed all **111 server tests**. The **47 client checks** and offline Lua checks also passed. A targeted set of **25 transport and resumable-upload tests** covers interrupted and stalled request bodies, simultaneous upload protocols, bounded conversion queues, late stream events and cancellation before publication. Browser checks cover the owner dashboard and error labels on desktop and a 390 px viewport.

Server 0.20.1 was deployed and verified on 16 September 2026. The service reports schema 9; all recorded community table counts and the profile-identity digest were preserved. A new backup completed, and the API, backup service and ZoiMeet were healthy after the update. No new diagnostic events were present at the first post-deployment check. Publication of the source commit is verified separately.
