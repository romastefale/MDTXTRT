# MDTXTRT architecture

This document records the implementation boundaries that are authoritative for MDTXTRT. It exists to keep the published repository, local work, external protocol references, and design reference aligned without silent compatibility layers.

## Source of truth

- `main` in `romastefale/MDTXTRT` is the canonical published state.
- Exported ZIP archives are snapshots for comparison and recovery. They are never promoted over a newer `main` solely because they contain a complete tree.
- Changes should land as focused commits with regression coverage. A local reconstruction is valid only when its Git blob identities match the remote revision it claims to represent.

## Document identity, revision and local recovery

- Every active document has a UUID and a non-negative local revision. The revision advances with document-semantic changes and is used to reject late asynchronous results that no longer match the document state that originated a request.
- Telegraph publish/recovery requests carry the originating document UUID and revision. A response may be reported as the result of its original request, but it must not mutate a different document or a newer revision.
- Importing Markdown/TXT is a document boundary, not an HTML edit: it creates a new UUID, resets revision, selection, editor history and Telegraph path, and removes the active local attachment being replaced. Undo never crosses that boundary.
- `/novo` is a different document boundary: before a new document is created, the current active local-draft bytes are archived and read back successfully. The new document starts with a new UUID, revision 0, empty content, no Telegraph page and independent editor history. If the prior slot cannot be preserved, the transition is aborted.
- Local attachments are stored by media identifier in IndexedDB. Installing an attachment no longer clears unrelated media records, so a document archived by `/novo` does not lose its attachment merely because a newer document receives another one.
- Unreadable or incompatible active drafts are never silently deleted. Normal boot blocks automatic overwrites; a `/novo` transition preserves the unreadable bytes under a recovery key before replacing the active slot.
- The precise local-storage scope, lifecycle and durability limitations are defined in [LOCAL_DRAFTS.md](LOCAL_DRAFTS.md). Only the active draft is auto-restored; archived documents are local recovery snapshots, not a synchronized document library.

## Transactional editor boundary

- ProseMirror is the editor source of truth. Schema, transactions, selection and history belong to the editor core; application controls issue commands against that state instead of treating arbitrary DOM mutation as the document model.
- Accepted aliases normalize to one semantic mark: `b/strong`, `i/em`, and `s/strike/del` are equivalent at the schema boundary. Toolbar commands therefore remove/apply semantics rather than specific tag names.
- Undo/redo and formatting keymaps are editor-local. Inputs such as document name, Find/Replace and dialogs retain their native keyboard behavior.
- Composition and paste are committed through the transactional core. Literal Find/Replace walks document text and does not construct a regular expression from user input.
- Import/export/publication semantics are governed by [FORMAT_CONTRACT.md](FORMAT_CONTRACT.md). Portable export begins from serialized editor state, not transient rendering DOM.

## Browser → Mini App handoff

- Recovering a handoff and authorizing publication are separate operations. Claiming a handoff only restores the document, attachment and persisted action state.
- Publication state is durable for the handoff: `pending`, `sending`, `succeeded`, `failed` or `uncertain`. A confirmed Telegram result, including `messageId`, is persisted before the HTTP success response is returned.
- Reloading or reopening a `succeeded`, `sending` or `uncertain` handoff does not resend it. Transport ambiguity and backend interruption are represented as `uncertain`, never as implicit authorization to retry.
- A `failed` handoff may be attempted again only after another explicit publication action. Editing the recovered document invalidates the transferred snapshot authorization because document/revision no longer match.

## Telegram

- The protocol baseline is Telegram Bot API 10.3, released on 2026-08-24.
- Rich content is sent through `sendRichMessage` and `InputRichMessage`.
- Rich-message HTML is validated against the documented tag, nesting, media, table, and `RichMessageButton` contracts before Telegram is called.
- The 32,768-character preflight counts Unicode text and custom-emoji alternative text, and RichText-only containers reject nested block markup locally rather than relying on Telegram to reject it.
- There is no `sendMessage` downgrade path for rich content. Unsupported rich input fails explicitly instead of being silently translated to a legacy message.
- Uploaded rich-message media is referenced through the official `InputRichMessage.media` mechanism and `tg://<media-type>?id=...` references, including `tg://document?id=...`.
- Local uploads fail closed when the declared rich-media kind and MIME family disagree; photo uploads also enforce Telegram's 10 MB limit before the API call. MDTXTRT does not retry an incompatible upload as another media kind.
- Telegram Mini App session identity comes from verified `initData`; client-supplied user identifiers are not trusted as identity.
- Local Rich Message contract failures are typed HTTP `400` errors. Telegram transport/API failures remain outside that preflight boundary and are surfaced as `502`; response status is never inferred from error-message text.

## Telegra.ph

- Publishing uses the official Telegra.ph API and its `Node` / `NodeElement` content model.
- Page creation and editing use `createPage` and `editPage`; persisted paths are verified with `getPage`.
- The server enforces the documented 64 KB content limit before publication.
- A Telegraph page path is bound to an explicit owner plus the MDTXTRT document identifier so an edit cannot be redirected to an unrelated page. Inside the Mini App, the owner is the Telegram identity verified from `initData`; in a standalone browser, the owner is the SHA-256 digest of a locally generated 256-bit capability key. The raw browser capability is never persisted by the server.
- The Telegraph access token and page ownership mapping are durable state and must not be moved to an ephemeral filesystem.
- If persisted page ownership exists but the corresponding access token is missing, startup fails closed. MDTXTRT never creates a replacement Telegraph account behind existing ownership mappings.
- Telegra.ph request validation and ownership failures are typed locally as `400` (or explicit `404` for an absent owned page). Telegra.ph transport/API failures are surfaced as `502`; status classification does not depend on matching error strings.

## Liquid Glass design contract

- The normative design and implementation reference is `romastefale/liquid-glass` at commit `4e7b769e1df7e5a7d3669fef22417fe3d2f79ade` (release 0.1.1, MIT, © Sam Asante).
- MDTXTRT uses the reference through its published engine package, pinned as `@samasante/liquid-glass@0.1.1`, with React and React DOM as explicit runtime dependencies. The product does not maintain a parallel Liquid Glass engine.
- The authored UX layer is `src/liquid-glass-ui.jsx`; `ui.js` is its deterministic production bundle. The source imports `Glass` directly from `@samasante/liquid-glass`.
- Menu construction follows the reference's `examples/GlassContextMenu.tsx` “copy and own” model. MDTXTRT owns the application-specific menu shell and restyling while the optical primitive remains the package's `<Glass>`.
- The copied menu component structure remains traceable to that example, but MDTXTRT deliberately standardizes the visible menu material with the chrome capsules. Menu and capsule Glass optics both disable directional `sheen`, `glow`, and `specular`, while all other optical values come from the package defaults. Their translucent fill is the same theme-specific `--glass-tint`, and their perimeter uses the same uniform `--glass-hairline` token (12% white in light mode, 5% white in dark mode). Menus do not add a second outer edge or a directional highlight.
- There is no local displacement-map renderer, SVG-filter implementation, browser-engine detector, or compatibility renderer in MDTXTRT. `glass.js` was deleted rather than retained as a compatibility layer.
- Browser rendering behavior belongs to `@samasante/liquid-glass` and follows its README/BROWSERS contract. MDTXTRT does not inspect the engine and does not substitute blur, screenshots, canvas copies, or a second visual implementation when browser capabilities differ.
- When a component requires cross-browser bending rather than the package's material-mode behavior, it must migrate to the package's documented `refract`, in-place, or media-surface mode. A custom fallback is not an accepted migration path.
- The top chrome has one safe-area-aware row: undo/redo in the left pill, the application title plus theme switch centered independently of the side controls, and destination/publication controls in the right pill. The title is not an interaction trigger.
- The functional top pills and the bottom formatting bar share one responsive control-size token. The theme switch is intentionally more discreet: its visible control and icon are fixed at 60% of the corresponding primary-control scale. This reduced scale is identical in Telegram, Railway, and GitHub Pages access modes. The bottom bar keeps the most frequent formatting actions in-line and places the accent-tinted “more” control at the far right.
- Context menus preserve the `GlassContextMenu.tsx` compact scale (`210px` base width, `24px` rows, `9px` radius) and declare their invoking control as an anchor. Placement is clamped against the visual viewport and safe edges rather than expanding into full-screen sheets.
- The light/dark preference is explicit and persisted. HTML/body background, browser `theme-color`, standalone status-bar metadata, and Telegram header/background/bottom-bar colors are updated from the same selected mode so system chrome cannot retain the opposite theme.
- The vertical chrome composition is uniform across Telegram, Railway, and GitHub Pages. Browser access starts from CSS environment safe-area insets; Telegram Mini App geometry replaces that origin with the official WebApp 8.0+ `safeAreaInset` and `contentSafeAreaInset` runtime values when they are larger. All four Telegram sides are validated, mirrored to local CSS tokens, and refreshed on `safeAreaChanged` and `contentSafeAreaChanged`; unsupported Telegram clients are gated instead of receiving an implicit Telegram compatibility fallback.
- Menus and interaction chrome are compact, content-sized surfaces. Scrollbar chrome is hidden, and browser zoom/pinch zoom remains disabled by the explicit viewport/touch contract requested for this product.
- Overlay placement uses the visible viewport as the runtime geometry authority. Menus keep their baseline width/row/radius/material values when space exists; constrained space reduces their maximum size and enables internal scrolling instead of changing the normal composition.
- Find is anchored to a control that remains visible while Find is open. Dialogs use the same visible-area contract, inert the background, trap keyboard focus, handle Escape and return focus to the visible origin control. Moving focus through overlays does not replace the transactional editor selection.
- These interaction corrections do not restore superseded geometry or menu behavior. Commit `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` remains the visual design contract; subsequent changes are behavioral evolution from that reference.
- `ui.js` is committed so GitHub Pages and Railway serve the same canonical artifact. Read-only CI rebuilds it, uploads the generated bundle as a verification artifact, and fails on any diff; ordinary verification never writes a corrective commit to `main`.
- The React UI release build deliberately minifies syntax and whitespace but not identifiers. This avoids runner-dependent symbol-renaming churn while preserving a compact production artifact. Release validation rebuilds both browser bundles unconditionally and requires byte identity.

## Action semantics

- The top export/publication control opens the publication/export menu whenever the session is usable; it is not a direct-send shortcut inside the Mini App.
- In a standalone browser with Telegram selected, the menu action is labeled and behaves as “open the Mini App”; the handoff is recovered there and publication still requires explicit authorization.
- Inside the Mini App, the same action is labeled and behaves as “publish to Telegram”. Markdown and TXT download actions remain available in that menu.
- With Telegraph selected, the menu action publishes to Telegraph in either access mode under the Telegraph identity contract.
- Destination controls expose their actual toggle behavior in accessibility text, while the document-name control changes its accessible label to Telegraph title when that destination owns the title field.

## Durable document provenance boundary

- The current document UUID and local revision are integrity coordinates, not durable provenance. Local draft archives and handoff records are recovery/idempotency mechanisms, not an audit history.
- If product scope later requires traceable revisions/publications, add durable server-side records keyed by document and revision and bind each publication to the exact serialized content/revision that produced it.
- That expansion comes after the basic integrity guarantees above and must not be simulated by treating browser storage, a revision counter or a Telegraph path as an audit log.

## Execution and hosting boundary

- Node is pinned to `24.21.0`, an actively supported LTS runtime. CI reads that same version from `package.json`.
- GitHub Actions dependencies are pinned by immutable commit SHA, with the corresponding release tag recorded as a comment.
- npm dependency installation uses the committed lockfile through `npm ci`. CI and Railpack both verify the npm bundled with Node 24.21.0 is `11.19.0` before installation; the project does not provision a second npm through Corepack.
- Railway's Railpack configuration makes the deterministic install command explicit. A build must fail rather than silently fall back to `npm install` or a different npm version.
- The current server requires a durable absolute path through `RAILWAY_VOLUME_MOUNT_PATH` for handoffs, Telegraph credentials, and Telegraph page ownership state. Any move to a serverless or ephemeral-filesystem platform must first replace that storage contract with a durable store and preserve the same ownership and restart guarantees. Deployment portability must not be simulated with an in-memory or temporary-filesystem fallback.

## Provenance rule

When code is substantially derived from a third-party implementation or an external protocol materially shapes a feature, update `PROVENANCE.md` with the source, license or protocol status, affected files, and the nature of the adaptation before release.
