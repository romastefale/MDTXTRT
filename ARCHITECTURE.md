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
- The transactional editor core is mandatory. Draft serialization, restore, handoff, search/replace and export fail explicitly if the core is unavailable; there is no raw-contenteditable-DOM fallback.

## Persistent draft and Telegram provenance boundary

- The browser active slot remains the low-latency working copy, but every ordinary active-draft save also schedules a durable copy under the Railway volume at `$RAILWAY_VOLUME_MOUNT_PATH/drafts` (production: `/data/drafts`).
- Persisted records are partitioned by a SHA-256 fingerprint of the owner. Telegram ownership comes only from verified Mini App `initData`; standalone browser ownership comes from the existing 256-bit browser capability. The raw browser capability is never written to the server record.
- Draft metadata, active-document pointers and attachment bytes use volume-backed files. Metadata/pointers are replaced atomically by rename, and a lower revision cannot overwrite a newer persisted revision.
- When the local active slot is absent, startup may recover the owner's active volume-backed draft. The transactional editor is created before recovery. A transport/server failure keeps editing and draft writes blocked so an empty replacement cannot supersede an unknown remote active document. Only an authoritative 404 is treated as absence. Recovered HTML is applied through the editor core rather than by mutating the live DOM behind ProseMirror.
- Telegram publication state is stored with the same owner/document record. The first Rich Message records `pending` before the network call and stores verified publisher id, chat id, Telegram message id and revision on success. Ambiguous transport/storage outcomes become `uncertain` and block blind duplication.
- A later explicit publication of the same document by the same verified Telegram user preserves the previous Rich Message. The server sends a revision notice replying to the previous publication, then sends the new content as a new Rich Message and appends both message provenance and revision metadata to the durable record. No current publication path calls `editMessageText`.
- Draft persistence serializes the canonical ProseMirror document, not transient rendering DOM. Runtime-only ProseMirror helper nodes/classes and editing attributes are stripped both client-side and server-side so older contaminated snapshots can migrate through the strict semantic allow-list.
- The owner-scoped library lists volume-backed drafts, Telegram publication summaries derived from the existing persisted provenance, and Telegraph page bindings. It is rendered as a normal `GlassContextMenu` submenu, following the same lifecycle as the existing Plus submenus: the root application menu closes before the library submenu opens, Back closes the submenu and restores the root menu, and both surfaces use the shared menu width, row height, scrolling, placement and `visualViewport` constraints. Back and New document are standard menu rows rather than custom circular controls. The application-menu trigger is a true toggle: pressing it again closes the currently open root menu, and pressing it while the library submenu is open closes that submenu instead of reopening the root. It is reachable from Web/PWA and the Telegram Mini App; private bot commands `/rascunhos` and `/telegraph` deep-link to the same submenu view. A Telegram publication card reopens the current linked document for editing; it does not mutate or reconstruct an earlier Telegram message. The private chat remains the human-readable Telegram message history.
- Library enumeration is fail-closed: a malformed persistent draft or invalid Telegraph mapping aborts the response instead of being silently omitted.
- Browser-local `rmdtxtml-document:...` archives created by `/novo` remain local recovery snapshots; persisted server documents are the library source.

## Browser → Mini App handoff

- Recovering a handoff and authorizing publication are separate operations. Claiming a handoff only restores the document, attachment and persisted action state.
- Publication state is durable for the handoff: `pending`, `sending`, `succeeded`, `failed` or `uncertain`. A confirmed Telegram result, including `messageId`, is persisted before the HTTP success response is returned.
- Reloading or reopening a `succeeded`, `sending` or `uncertain` handoff does not resend it. Transport ambiguity and backend interruption are represented as `uncertain`, never as implicit authorization to retry.
- A `failed` handoff may be attempted again only after another explicit publication action. Editing the recovered document invalidates the transferred snapshot authorization because document/revision no longer match.

## Telegram

- The protocol baseline is Telegram Bot API 10.3, released on 2026-08-24.
- Rich content and later revisions are sent through `sendRichMessage` and `InputRichMessage`. A later revision never rewrites the earlier Telegram message: an explicit update notice replies to the previous publication and the revised content follows as a new message.
- Rich-message HTML is validated against the documented tag, nesting, media, table, and `RichMessageButton` contracts before Telegram is called.
- The 32,768-character preflight counts Unicode text and custom-emoji alternative text, and RichText-only containers reject nested block markup locally rather than relying on Telegram to reject it.
- There is no `sendMessage` downgrade path for rich content. Unsupported rich input fails explicitly instead of being silently translated to a legacy message.
- Uploaded rich-message media is referenced through the official `InputRichMessage.media` mechanism and `tg://<media-type>?id=...` references, including `tg://document?id=...`.
- Local uploads fail closed when the declared rich-media kind and MIME family disagree; photo uploads also enforce Telegram's 10 MB limit before the API call. MDTXTRT does not retry an incompatible upload as another media kind.
- Telegram Mini App session identity comes from verified `initData`; client-supplied user identifiers are not trusted as identity.
- Private-chat file import uses the hosted Telegram Bot API file lifecycle as the transport authority: the incoming `Document.file_id` is resolved with `getFile`, the returned `File.file_path` is downloaded from Telegram's official file endpoint, and no parallel file transport or retained source-file copy is introduced. The hosted Bot API 20 MB download ceiling is enforced before download when `file_size` is present; the smaller canonical draft/source budgets remain product validation limits.
- Bot imports accept only validated `.md` and `.txt` filenames. Bytes are decoded as strict UTF-8 after removing a leading UTF-8 BOM. TXT source is retained literally in `importedTxt`; Markdown is parsed with the same Marked GFM settings and portable tag/attribute normalization used by the browser format contract.
- A successful bot import creates a new canonical document UUID with revision 0 and a passive handoff whose purpose is `import`. The handoff is pre-bound to the private Telegram user, contains no publication action, and cannot publish on claim. Before the Mini App applies such a handoff, it archives and read-backs the current active local draft using the existing new-document preservation contract; failure to preserve aborts application of the imported document.
- Local Rich Message contract failures are typed HTTP `400` errors. Telegram transport/API failures remain outside that preflight boundary and are surfaced as `502`; response status is never inferred from error-message text.

## Telegra.ph

- Publishing uses the official Telegra.ph API and its `Node` / `NodeElement` content model.
- Page creation and editing use `createPage` and `editPage`; persisted paths are verified with `getPage`. The owner-scoped library can fetch the authoritative page content with `getPage`, convert the validated Telegraph node tree back into editor HTML and reopen the same document/path for editing in browser or Mini App.
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
- The top chrome has one safe-area-aware row: undo/redo in the left pill, the application title plus theme switch centered independently of the side controls, and destination/application-menu controls in the right pill. The application menu uses the accent circular control and opens publication, export and library actions; the title is not an interaction trigger.
- The functional top pills and the bottom formatting bar share one responsive control-size token. The theme switch is intentionally more discreet: its visible control and icon are fixed at 60% of the corresponding primary-control scale. This reduced scale is identical in Telegram, Railway, and GitHub Pages access modes. The bottom bar keeps the most frequent formatting actions in-line and places the accent-tinted “more” control at the far right.
- Context menus preserve the `GlassContextMenu.tsx` compact scale (`210px` base width, `24px` rows, `9px` radius) and declare their invoking control as an anchor. Placement is clamped against the visual viewport and safe edges rather than expanding into full-screen sheets.
- Menu interaction obeys one keyboard-retention rule across the product: when the editor or another text-entry surface currently owns focus, pressing chrome/menu controls prevents pointer focus transfer, opening/closing a menu or moving between root/submenu does not focus menu rows, and the typing surface remains focused so the software keyboard stays open. Standard menus do not use the browser Popover API at all; they use an explicit `data-menu-open` state plus one transparent dismiss layer behind the active menu, avoiding mobile browser focus side effects while preserving deterministic outside-tap dismissal without click-through. Only the modal text dialog keeps `popover="manual"`, because it intentionally owns focus. Once typing focus has genuinely moved elsewhere, normal menu focus restoration resumes.
- The light/dark preference is explicit and persisted. HTML/body background, browser `theme-color`, standalone status-bar metadata, and Telegram header/background/bottom-bar colors are updated from the same selected mode so system chrome cannot retain the opposite theme.
- The vertical chrome composition is uniform across Telegram, Railway, and GitHub Pages. Browser access starts from CSS environment safe-area insets; Telegram Mini App geometry replaces that origin with the official WebApp 8.0+ `safeAreaInset` and `contentSafeAreaInset` runtime values when they are larger. All four Telegram sides are validated, mirrored to local CSS tokens, and refreshed on `safeAreaChanged` and `contentSafeAreaChanged`; unsupported Telegram clients are gated instead of receiving an implicit Telegram compatibility fallback.
- Menus and interaction chrome are compact, content-sized surfaces. Scrollbar chrome is hidden, and browser zoom/pinch zoom remains disabled by the explicit viewport/touch contract requested for this product.
- Overlay placement starts from the visible viewport and then reserves the live bottom formatting bar as a non-overlay region. Menus, link dialogs and media/interaction sheets are clamped above the bar (including keyboard-driven bar movement); constrained space reduces maximum size and enables internal scrolling instead of placing controls underneath the bar or changing baseline material geometry.
- Find is anchored to a control that remains visible while Find is open. Dialogs use the same visible-area contract, inert the background, trap keyboard focus, handle Escape and return focus to the visible origin control. Moving focus through overlays does not replace the transactional editor selection.
- These interaction corrections do not restore superseded geometry or menu behavior. Commit `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` is the explicitly adopted visual reference after the incremental application-menu/publication-library change; `BASELINE.md` records its relationship to the prior translucent baseline `aac423e012745c7873908ddc4a76371fb8218aa3`.
- `ui.js` is committed so GitHub Pages and Railway serve the same canonical artifact. Read-only CI rebuilds it, uploads the generated bundle as a verification artifact, and fails on any diff; ordinary verification never writes a corrective commit to `main`.
- `ui.js` is committed so GitHub Pages and Railway serve the same canonical artifact. Its production build explicitly defines `process.env.NODE_ENV="production"` and minifies syntax and whitespace, but deliberately does not minify identifiers. This preserves React's production path while removing the symbol-frequency renaming pass that previously produced byte-distinct bundles from unchanged inputs. The Stage 1 recovery verified two consecutive UI builds as byte-identical on the contracted Actions runner before committing the generated artifact. Release validation rebuilds both committed browser bundles unconditionally on that runtime and requires byte identity with the committed artifacts.

## Action semantics

- The top hamburger application control opens the publication/export/library menu whenever the session is usable; it is not a direct-send shortcut inside the Mini App.
- In a standalone browser with Telegram selected, the menu action is labeled and behaves as “open the Mini App”; the handoff is recovered there and publication still requires explicit authorization.
- Inside the Mini App, the same action is labeled and behaves as “publish to Telegram”. Markdown and TXT download actions remain available in that menu.
- With Telegraph selected, the menu action publishes to Telegraph in either access mode under the Telegraph identity contract.
- Destination controls expose their actual toggle behavior in accessibility text. The document-title control is visibly labeled as “Título do documento” in the publication/export flow and changes to “Título da página no Telegraph” when Telegraph owns the title field.

## Durable draft and publication boundary

- Document UUID and revision remain integrity coordinates rather than a complete immutable revision history.
- The active draft is durably mirrored to the Railway volume under an owner namespace. Browser-local storage remains a fast recovery/cache layer rather than the only copy.
- Telegram owner namespaces are derived only from verified Mini App `initData`; standalone browser namespaces are derived from the existing 256-bit local capability and only a SHA-256-derived namespace is used server-side.
- A persistent draft record contains the canonical draft snapshot, optional attachment metadata/blob and the operational Telegram publication binding for that document.
- The first confirmed Telegram publication records verified publisher ID, private-chat ID, message ID, document revision and publication state. A later explicit publish preserves the previous message, replies with a revision notice, then sends the revised content as a new Rich Message.
- Publication transport ambiguity is durable state: `pending` or `uncertain` blocks an automatic duplicate send. A confirmed rejection requires another explicit action.
- Telegram provenance retains a bounded history of published revision/message IDs and notice IDs so the private chat remains the visible revision trail. The library exposes a summary of that provenance next to the current linked document without introducing immutable content snapshots.

## Execution and hosting boundary

- Node is pinned to `24.21.0`, an actively supported LTS runtime. CI reads that same version from `package.json`.
- GitHub Actions dependencies are pinned by immutable commit SHA, with the corresponding release tag recorded as a comment.
- npm dependency installation uses the committed lockfile through `npm ci`. CI and Railpack both verify the npm bundled with Node 24.21.0 is `11.19.0` before installation; the project does not provision a second npm through Corepack.
- Railway's Railpack configuration makes the deterministic install command explicit. A build must fail rather than silently fall back to `npm install` or a different npm version.
- The current server requires a durable absolute path through `RAILWAY_VOLUME_MOUNT_PATH` for active drafts and attachments, Telegram publication provenance, handoffs, Telegraph credentials, and Telegraph page ownership state. Production mounts the MDTXTRT Railway volume at `/data`. Any move to a serverless or ephemeral-filesystem platform must first replace that storage contract with a durable store and preserve the same ownership and restart guarantees. Deployment portability must not be simulated with an in-memory or temporary-filesystem fallback.

## Provenance rule

When code is substantially derived from a third-party implementation or an external protocol materially shapes a feature, update `PROVENANCE.md` with the source, license or protocol status, affected files, and the nature of the adaptation before release.
