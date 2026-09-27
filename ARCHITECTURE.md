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
- A Telegraph page path is bound to the authenticated Telegram user and MDTXTRT document identifier so an edit cannot be redirected to an unrelated page.
- The Telegraph access token and page ownership mapping are durable state and must not be moved to an ephemeral filesystem.
- If persisted page ownership exists but the corresponding access token is missing, startup fails closed. MDTXTRT never creates a replacement Telegraph account behind existing ownership mappings.
- Telegra.ph request validation and ownership failures are typed locally as `400` (or explicit `404` for an absent owned page). Telegra.ph transport/API failures are surfaced as `502`; status classification does not depend on matching error strings.

## Liquid Glass design contract

- The normative implementation reference is `romastefale/liquid-glass` at commit `4e7b769e1df7e5a7d3669fef22417fe3d2f79ade` (v0.1.1 lineage, MIT, © Sam Asante).
- `glass.js` is an attributed plain-JavaScript adaptation of the reference material-mode optics and displacement-map technique; the adapted source itself carries the reference URL, pinned revision, author attribution, and MIT status.
- Material chrome uses the reference optics vocabulary and values: refraction strength, depth, curvature, bend, dispersion, frost, saturation, sheen, glow, and specular gain.
- Content remains crisp above the material surface. The glass treatment belongs to chrome; it is not decorative blur applied to document content.
- The reference explicitly warns against stretching one displacement lens across a very wide dock-style panel. Such surfaces use an explicit frost-only material mode. This is a chosen material variant, not a runtime fallback.
- Material-mode browser capability is an explicit rendering profile on each surface through `data-lg-rendering`: `material-refraction` when the reference's `backdrop-filter: url(#…)` path is available, `material-frost` where the reference documents material mode as frost + tint + edge only, and `frost` for intentionally frost-only wide surfaces.
- The WebKit/Gecko `material-frost` profile is not presented as equivalent refraction. If cross-browser bending becomes a product requirement, the implementation must move to one of the reference's copy/in-place refraction architectures instead of silently substituting blur.
- Unsupported material refraction returns before displacement-map allocation, so no hidden ternary or late rendering fallback generates unused SVG lens work.
- Compact interaction surfaces now derive from `examples/GlassContextMenu.tsx` in the pinned reference. Menus, dialogs, toasts, brand chrome, and compact control groups use the dedicated `context-menu` optics profile instead of the legacy full-width sheet paradigm.
- The `context-menu` profile preserves the reference menu coefficients and symmetric RGB dispersion model. Runtime state is explicit as `context-menu-refraction` or `context-menu-frost`; no reduced renderer is presented as equivalent refraction.
- Floating menus are anchored to their invoking controls, clamped to the visual viewport, and capped to compact dimensions. Long menus remain scrollable with scrollbar chrome hidden rather than expanding to fill the screen.
- Browser zoom and pinch zoom remain disabled by the viewport contract and touch-action policy. This is an intentional product invariant, not a browser fallback.

## Execution and hosting boundary

- Node is pinned to `24.21.0`, an actively supported LTS runtime. CI reads that same version from `package.json`.
- GitHub Actions dependencies are pinned by immutable commit SHA, with the corresponding release tag recorded as a comment.
- npm dependency installation uses the committed lockfile through `npm ci`. CI and Railpack both verify the npm bundled with Node 24.21.0 is `11.19.0` before installation; the project does not provision a second npm through Corepack.
- Railway's Railpack configuration makes the deterministic install command explicit. A build must fail rather than silently fall back to `npm install` or a different npm version.
- The current server requires a durable absolute path through `RAILWAY_VOLUME_MOUNT_PATH` for handoffs, Telegraph credentials, and Telegraph page ownership state. Any move to a serverless or ephemeral-filesystem platform must first replace that storage contract with a durable store and preserve the same ownership and restart guarantees. Deployment portability must not be simulated with an in-memory or temporary-filesystem fallback.

## Provenance rule

When code is substantially derived from a third-party implementation or an external protocol materially shapes a feature, update `PROVENANCE.md` with the source, license or protocol status, affected files, and the nature of the adaptation before release.
