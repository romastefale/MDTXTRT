# Draft persistence contract

MDTXTRT keeps the fast local recovery layer, but the active draft is no longer local-only. The application also writes the canonical active draft snapshot to the Railway persistent volume mounted at `RAILWAY_VOLUME_MOUNT_PATH` (production: `/data`).

## Storage layers

### Browser-local recovery

- `localStorage["rmdtxtml"]` is the active local recovery slot. It contains draft version, document title/name, sanitized editor HTML, selected destination, Telegraph path, document UUID, revision, import-origin snapshots and local-media metadata.
- `localStorage["rmdtxtml-document:<document-uuid>"]` stores a byte-for-byte snapshot when `/novo` deliberately starts another document.
- If the active slot cannot be parsed well enough to recover a UUID, `/novo` preserves the bytes under `rmdtxtml-document:unreadable-<new-token>`.
- `IndexedDB("mdtxtrt").objectStore("media")` remains the local media cache by media identifier.

The local layer is still useful for immediate recovery and offline/transient-failure tolerance. It is not the only persistence layer.

### Railway volume

The backend stores active draft state below `<RAILWAY_VOLUME_MOUNT_PATH>/drafts/`.

Each owner gets a server-side namespace derived from a one-way SHA-256 fingerprint. Within that namespace, the backend stores:

- the active document pointer;
- one JSON record per document UUID;
- the referenced attachment blob when the active draft contains a local attachment;
- Telegram publication provenance for that document when applicable.

Writes use a temporary file followed by rename so a completed record is not replaced by a partially written JSON file.

## Owner identity

The persistent draft namespace is never selected from an arbitrary user ID supplied by the client.

- In a Telegram Mini App session, identity is derived from cryptographically verified Telegram `initData`. The persisted provenance retains the verified Telegram user ID needed to associate later edits with the original publisher.
- In standalone Web/PWA mode, identity is derived from the existing 256-bit browser capability and the backend stores only its SHA-256-derived namespace. The raw browser capability is not stored server-side.

A different Telegram user receives a different persistent namespace and cannot use another user's stored publication binding.

## Active draft lifecycle

Document changes still save locally with the existing debounce. The same save path also schedules a write to the Railway volume. `pagehide` requests both the local write and a final volume write.

When local storage is empty, startup attempts to recover the active draft from the persistent volume. The recovered draft is validated and sanitized before it is applied, and it is copied back into the local active slot. If the draft references a stored attachment, the blob is retrieved from the volume and rehydrated into IndexedDB before normal media restoration.

A failure to update the volume does not silently destroy the local copy. The UI reports that the persistent copy could not be updated and keeps the local recovery state available.

## `/novo`

The Telegram `/novo` command still creates a distinct document UUID and preserves the previous local active slot before replacement. The local archive is retained because it is an explicit recovery boundary and does not depend on network availability.

The new active document then participates in normal Railway-volume persistence under its new UUID.

## Import

Importing Markdown or TXT creates a new document and resets editor history, selection, UUID, revision and Telegraph binding. The resulting active document is persisted through the same local + Railway save contract.

Import remains distinct from `/novo`: it does not create a local previous-document archive as an undo mechanism.

## Telegram publication provenance and later editing

When a Mini App publication includes the canonical draft snapshot, the backend first persists that draft under the verified Telegram owner.

For the first confirmed publication of a document, the durable record stores:

- verified Telegram user ID;
- target private-chat ID;
- Telegram message ID;
- document revision;
- publication timestamp/state.

A later explicit publication of the same document by the same verified Telegram owner uses the stored message ID and Telegram `editMessageText` with `rich_message` instead of creating a new message. A different document UUID has no inherited publication binding.

Before the first send, a `pending` provenance state is persisted. Transport ambiguity is recorded as `uncertain` and blocks silent duplicate creation. A confirmed rejection clears the pending binding so another explicit attempt is allowed. After a confirmed send or edit, the `succeeded` record is written before the backend reports a stable success.

This record is operational provenance required to find and edit the published Telegram message. It is not a general audit log of every historical revision.

## Handoffs

Browser-to-Mini-App handoffs retain their existing durable state machine in `/data/handoffs`. Claiming a handoff restores state but does not authorize publication. When an explicit handoff publication is performed, it now passes through the same persistent Telegram publication layer, so the verified publisher/message binding is kept with the document.

## Limits

The current server-side draft store is intentionally small and document-oriented. It is not a collaborative database, conflict-resolution engine, document picker, or immutable history. Concurrent multi-device editing is not advertised.

The final release gate must still verify real restart persistence, storage failure behavior, Telegram send/edit behavior, and rollback against the deployed Railway volume.
