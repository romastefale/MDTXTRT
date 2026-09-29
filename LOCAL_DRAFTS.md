# Draft persistence contract

This document defines the draft persistence model used by MDTXTRT. The active document has two recovery layers: a fast browser-local working copy and a durable server copy on the Railway volume. Local archives created by `/novo` remain a separate browser-local recovery mechanism; they are not presented as a synchronized document library.

## Storage layers

### Browser working copy

- `localStorage["rmdtxtml"]` is the active browser slot. It contains draft version, document title, sanitized editor HTML, destination, Telegraph path, document UUID, revision, import-origin snapshots and local-media metadata.
- `localStorage["rmdtxtml-document:<document-uuid>"]` is a byte-for-byte archive created before `/novo` replaces the active slot.
- If the previous active slot cannot be parsed far enough to recover a UUID, `/novo` archives it as `rmdtxtml-document:unreadable-<new-token>`.
- `IndexedDB("mdtxtrt").objectStore("media")` stores browser attachment blobs by media identifier.
- Theme preference and the standalone-browser capability key are separate from document state.

### Railway volume copy

The backend persists active drafts below `$RAILWAY_VOLUME_MOUNT_PATH/drafts`. In production this path is the mounted Railway volume `/data`.

Each owner receives an isolated directory derived from a SHA-256 fingerprint of the verified owner identity. A persisted document contains:

- the full canonical draft and revision;
- owner kind (`telegram` or `browser`);
- for Telegram owners, the verified Telegram user identifier;
- update time;
- optional attachment metadata and attachment bytes;
- Telegram publication provenance when a document has been published.

Metadata and the active-document pointer are written through a temporary file followed by rename. A stale revision cannot replace a newer persisted revision.

The volume copy is updated after ordinary draft saves. Draft serialization starts from the canonical editor model rather than the live ProseMirror rendering DOM. Runtime-only ProseMirror classes, helper nodes and editing attributes are removed before strict draft validation; the same migration is applied when older locally/volume-saved HTML is read. This prevents editor decorations such as selection/trailing-break markers from being misreported as unsupported document content.

Local storage remains the immediate working cache so typing does not depend on a network round trip. It is never promoted as a silent substitute for the Railway copy: a volume write failure is surfaced, and external publication still traverses backend validation/persistence. The client does not report a failed volume save as durable success.

## Owner identity

A Telegram Mini App draft is keyed from cryptographically verified Telegram `initData`. The client cannot supply a replacement user identifier. Because the identity comes from the Telegram account, the same account can recover its persisted active draft on another Mini App session after local browser state is absent.

Standalone browser drafts use the existing 256-bit browser capability stored under `mdtxtrt-browser-owner`; the server stores only a SHA-256-derived owner fingerprint. Clearing that capability breaks the association to the old browser-owned server copy. This is intentional: there is no account login for standalone browser mode.

Different owners are isolated even if they somehow present the same document UUID.

## Startup and recovery

Startup follows these rules:

1. a deliberate `?new=<token>` launch creates the requested new document and does not replace it with a server copy;
2. an existing valid local active slot is restored immediately;
3. when no local active slot exists and no handoff/new-document transition is in progress, the client asks the backend for the owner's persisted active document;
4. a recovered server draft is validated and sanitized before it is applied; a local cache write failure is logged but cannot weaken or rewrite the authoritative recovered state;
5. persisted attachment bytes are downloaded through the authenticated draft endpoint and restored into IndexedDB before normal media recovery completes.

The transactional editor core is created before any draft is applied. Draft serialization, restore, handoff and export require that core; there is no raw-DOM fallback. During a server recovery with no local draft the editor is non-editable. If the volume request fails or is ambiguous, editing remains blocked instead of opening a replacement draft that could supersede the remote active pointer. A genuine 404 means no persisted active document and may start an empty document normally.

## Fail-closed library behavior

The owner library does not silently skip corrupt persistent documents or invalid Telegraph mappings. If one record cannot satisfy the persistence contract, the library request fails explicitly so a damaged record cannot disappear from the user's view as if it never existed. Repair/migration must be explicit.

## Attachments

A draft may reference at most one local attachment. Its bytes are persisted next to the server draft on the Railway volume. The metadata identifier and kind must match the draft. A document that references a local attachment cannot be accepted as durably persisted unless the corresponding bytes are already present for that document or accompany the save.

Installing a new local attachment does not clear unrelated IndexedDB records, so a browser-local `/novo` archive can continue to reference its previous blob.

## `/novo` and import boundaries

`/novo` preserves the previous local active slot before creating a new UUID/revision-0 document. The archived `rmdtxtml-document:...` snapshot is local recovery data and is not automatically turned into a server-side document library entry.

Importing Markdown or TXT is a different boundary: it creates another canonical document, resets editor history/selection/revision/page binding and replaces the active attachment. Import is intentionally not a partial undo operation.

## Telegram publication provenance and later editing

For Telegram Mini App publication, the server binds the document to the verified publisher before treating the operation as reusable state. The durable record contains:

- Telegram user id;
- private-chat id;
- document id and published revision;
- Telegram message id;
- status and update time.

The first publication persists a `pending` record before calling Telegram. A confirmed success stores the returned message id before the HTTP success is returned. A transport-ambiguous result becomes `uncertain` and blocks blind resending.

When the same verified Telegram user later publishes the same document after editing it, MDTXTRT does **not** rewrite the earlier chat message. It first sends a revision notice as a reply to the previous publication, then sends the new Rich Message as another message. The durable record advances to the newest message while retaining a bounded publication history (message id, revision, timestamp and notice id). This keeps the private bot chat itself as the human-readable Telegram provenance trail. Another Telegram user with the same document UUID is a different owner and cannot reuse that linkage.

The handoff publication path uses the same durable publication function, so browser → Mini App publication does not bypass publisher provenance.

## Durability limits

The Railway volume is the durable application copy for saved drafts, but it is not an unlimited content-version backup. The library can enumerate the owner's persisted draft records and the Telegraph pages linked to them. Telegram publication history is intentionally surfaced in the private bot conversation instead of as a separate in-app Telegram-publication editor.

Browser-local `/novo` archives are still local-only snapshots. Standalone browser server recovery also depends on retaining the browser capability key. Telegram-owned recovery does not depend on that browser key.

No physical-device, Telegram delivery, Telegraph delivery or disaster-recovery claim follows merely from the existence of these files; those behaviors are validated separately by the release evidence gates.
