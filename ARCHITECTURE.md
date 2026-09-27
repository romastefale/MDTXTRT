# MDTXTRT architecture

This document records the implementation boundaries that are authoritative for MDTXTRT. It exists to keep the published repository, local work, external protocol references, and design reference aligned without silent compatibility layers.

## Source of truth

- `main` in `romastefale/MDTXTRT` is the canonical published state.
- Exported ZIP archives are snapshots for comparison and recovery. They are never promoted over a newer `main` solely because they contain a complete tree.
- Changes should land as focused commits with regression coverage. A local reconstruction is valid only when its Git blob identities match the remote revision it claims to represent.

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
- Menu construction follows the reference's `examples/GlassContextMenu.tsx` “copy and own” model. MDTXTRT owns the application-specific menu shell and restyling while the optical primitive remains the package's `<Glass>`. The interactive menu keeps the package's content-sized material mode; it does not claim cross-browser refraction of the live editor beneath it.
- The copied menu optics remain traceable to that example: `mapSize 256`, `depth 0.65`, `curvature 0.26`, `dispersion 0.16`, `strength 0.22`, `bend 0.65`, `bendWidth 0.07`, `frost 3.5`, `brightness 0.55`, `specular 0.8`, `sheen 0.4`, and `sheenWidth 1`.
- There is no local displacement-map renderer, SVG-filter implementation, browser-engine detector, or compatibility renderer in MDTXTRT. `glass.js` was deleted rather than retained as a compatibility layer.
- Browser rendering behavior belongs to `@samasante/liquid-glass` and follows its README/BROWSERS contract. MDTXTRT does not inspect the engine and does not substitute blur, screenshots, canvas copies, or a second visual implementation when browser capabilities differ.
- When a component requires cross-browser bending rather than the package's material-mode behavior, it must migrate to the package's documented `refract`, in-place, or media-surface mode. A custom fallback is not an accepted migration path.
- The top chrome has one safe-area-aware row: undo/redo in the left pill, the application title plus theme switch centered independently of the side controls, and destination/publication controls in the right pill. The title is not an interaction trigger. Long control bars use low-cost frost optics without displacement; the small toast uses independent notification optics.
- The functional top pills and the bottom formatting bar share one responsive control-size token. The theme switch is intentionally more discreet: its visible control and icon are fixed at 60% of the corresponding primary-control scale. This reduced scale is identical in Telegram, Railway, and GitHub Pages access modes. The bottom bar keeps the most frequent formatting actions in-line and places the accent-tinted “more” control at the far right.
- Context menus preserve the `GlassContextMenu.tsx` compact scale (`210px` base width, `24px` rows, `9px` radius) and declare their invoking control as an anchor. The theme control has a larger invisible hit area for coarse pointers. Placement is clamped against the visual viewport and safe edges rather than expanding into full-screen sheets.
- The light/dark preference is explicit and persisted. HTML/body background, browser `theme-color`, standalone status-bar metadata, and Telegram header/background/bottom-bar colors are updated from the same selected mode so system chrome cannot retain the opposite theme.
- The vertical chrome composition is uniform across Telegram, Railway, and GitHub Pages. Browser access starts from CSS environment safe-area insets; Telegram Mini App geometry replaces that origin with the official WebApp 8.0+ `safeAreaInset` and `contentSafeAreaInset` runtime values when they are larger. All four Telegram sides are validated, mirrored to local CSS tokens, and refreshed on `safeAreaChanged` and `contentSafeAreaChanged`; unsupported Telegram clients are gated instead of receiving an implicit Telegram compatibility fallback.
- Menus and interaction chrome are compact, content-sized surfaces. Scrollbar chrome is hidden, and browser zoom/pinch zoom remains disabled by the explicit viewport/touch contract requested for this product.
- `ui.js` is committed so GitHub Pages and Railway serve the same canonical artifact. Read-only CI rebuilds it, uploads the generated bundle as a verification artifact, and fails on any diff; ordinary verification never writes a corrective commit to `main`.

## Execution and hosting boundary

- Node is pinned to `24.21.0`, an actively supported LTS runtime. CI reads that same version from `package.json`.
- GitHub Actions dependencies are pinned by immutable commit SHA, with the corresponding release tag recorded as a comment.
- npm dependency installation uses the committed lockfile through `npm ci`. CI and Railpack both verify the npm bundled with Node 24.21.0 is `11.19.0` before installation; the project does not provision a second npm through Corepack.
- Railway's Railpack configuration makes the deterministic install command explicit. A build must fail rather than silently fall back to `npm install` or a different npm version.
- The current server requires a durable absolute path through `RAILWAY_VOLUME_MOUNT_PATH` for handoffs, Telegraph credentials, and Telegraph page ownership state. Any move to a serverless or ephemeral-filesystem platform must first replace that storage contract with a durable store and preserve the same ownership and restart guarantees. Deployment portability must not be simulated with an in-memory or temporary-filesystem fallback.

## Provenance rule

When code is substantially derived from a third-party implementation or an external protocol materially shapes a feature, update `PROVENANCE.md` with the source, license or protocol status, affected files, and the nature of the adaptation before release.
