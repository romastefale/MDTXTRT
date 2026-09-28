# Local draft contract

This document defines exactly what MDTXTRT persists locally and what it does not promise. Local drafts are a browser recovery mechanism, not a synchronized document database or a durable provenance ledger.

## Storage scope

Local state belongs to the current browser profile and origin.

- `localStorage["rmdtxtml"]` is the one **active draft slot**. It contains draft version, document name, sanitized editor HTML, selected destination, Telegraph path, document UUID, local revision, import-origin snapshots and local-media metadata.
- `localStorage["rmdtxtml-document:<document-uuid>"]` stores a byte-for-byte snapshot of the active slot when `/novo` deliberately starts another document.
- If the active slot cannot be parsed well enough to recover a UUID, `/novo` preserves its bytes under `rmdtxtml-document:unreadable-<new-token>` before replacing the active slot.
- `IndexedDB("mdtxtrt").objectStore("media")` stores local attachment blobs by media identifier. A document may reference at most one local attachment. Attachment installation no longer clears unrelated media records, so an attachment referenced by a `/novo` archive remains recoverable from local storage.
- Theme preference and the standalone-browser Telegraph capability are separate local keys and are not part of a document snapshot.

These records are not uploaded merely because they exist locally.

## Active draft lifecycle

The active draft is saved after document changes with a short debounce and synchronously requested again on `pagehide`.

On normal startup, only `rmdtxtml` is automatically restored. Archived `rmdtxtml-document:...` records are preservation/recovery snapshots; the current product does not expose a multi-document library or synchronized document picker.

If the active draft contains invalid JSON, an unsupported draft version or content that fails sanitization, MDTXTRT preserves the stored bytes and blocks automatic draft writes for that session. The application does not replace the only recoverable copy with an empty/default document.

## `/novo`

The Telegram `/novo` command generates a unique launch token. Opening either the Mini App or browser action with that token performs this sequence:

1. read the current active draft bytes, if present;
2. write and read back an archive copy;
3. only after preservation succeeds, create a new document UUID with revision 0, empty content, no Telegraph path and independent editor history;
4. replace the active draft slot with the new document;
5. consume the launch token from the URL so a reload does not create another document.

If the previous active slot cannot be archived, the new-document transition is aborted and the previous active draft remains authoritative.

A local attachment referenced by the archived document is not deleted by this transition.

## Import is a different boundary

Importing Markdown or TXT also starts a new document and resets editor history, selection, document UUID, revision and Telegraph page binding. It is intentionally **not** equivalent to `/novo`: import does not create a previous-document archive as an undo mechanism, and the active local attachment being replaced by the import is removed.

Supporting “undo import” would require restoring the complete prior document state, including its attachment, not merely previous HTML.

## Handoffs and publication

Browser-to-Mini-App handoffs have their own server-side persistence and publication state machine. Claiming a handoff may replace the active local draft, but recovering a handoff never authorizes publication by itself.

Local draft revision is used for integrity checks during a session and for binding asynchronous requests to the document state that originated them. It is not an audit log.

## Durability limits

Local drafts are best-effort browser persistence. They can disappear when the user clears site data, the browser evicts storage, the profile is removed, storage is unavailable, or the origin changes. They are not synchronized across browsers or devices and are not backed up by the MDTXTRT backend.

The application fails closed when a required preservation write cannot be confirmed, but it cannot turn browser storage into durable server storage.

## Provenance is a separate expansion

If the product later needs durable revision/publication provenance, add an explicit server-side record keyed by document and revision and bind every publication to the exact content/revision that produced it. That is a separate capability from local draft recovery and must not be inferred from the current local revision counter.
