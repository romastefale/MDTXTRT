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
- There is no `sendMessage` downgrade path for rich content. Unsupported rich input fails explicitly instead of being silently translated to a legacy message.
- Uploaded rich-message media is referenced through the official `InputRichMessage.media` mechanism and `tg://<media-type>?id=...` references, including `tg://document?id=...`.
- Telegram Mini App session identity comes from verified `initData`; client-supplied user identifiers are not trusted as identity.

## Telegra.ph

- Publishing uses the official Telegra.ph API and its `Node` / `NodeElement` content model.
- Page creation and editing use `createPage` and `editPage`; persisted paths are verified with `getPage`.
- The server enforces the documented 64 KB content limit before publication.
- A Telegraph page path is bound to the authenticated Telegram user and MDTXTRT document identifier so an edit cannot be redirected to an unrelated page.
- The Telegraph access token and page ownership mapping are durable state and must not be moved to an ephemeral filesystem.

## Liquid Glass design contract

- The normative implementation reference is `romastefale/liquid-glass` at commit `4e7b769e1df7e5a7d3669fef22417fe3d2f79ade` (v0.1.1 lineage, MIT, © Sam Asante).
- `glass.js` is an attributed plain-JavaScript adaptation of the reference material-mode optics and displacement-map technique.
- Material chrome uses the reference optics vocabulary and values: refraction strength, depth, curvature, bend, dispersion, frost, saturation, sheen, glow, and specular gain.
- Content remains crisp above the material surface. The glass treatment belongs to chrome; it is not decorative blur applied to document content.
- The reference explicitly warns against stretching one displacement lens across a very wide dock-style panel. Such surfaces use an explicit frost-only material mode. This is a chosen material variant, not a runtime fallback.
- Material-mode browser capability is an explicit rendering profile on each surface through `data-lg-rendering`: `material-refraction` when the reference's `backdrop-filter: url(#…)` path is available, `material-frost` where the reference documents material mode as frost + tint + edge only, and `frost` for intentionally frost-only wide surfaces.
- The WebKit/Gecko `material-frost` profile is not presented as equivalent refraction. If cross-browser bending becomes a product requirement, the implementation must move to one of the reference's copy/in-place refraction architectures instead of silently substituting blur.
- Unsupported material refraction returns before displacement-map allocation, so no hidden ternary or late rendering fallback generates unused SVG lens work.

## Persistence and hosting boundary

The current server requires a durable absolute path through `RAILWAY_VOLUME_MOUNT_PATH` for handoffs, Telegraph credentials, and Telegraph page ownership state. Any move to a serverless or ephemeral-filesystem platform must first replace that storage contract with a durable store and preserve the same ownership and restart guarantees. Deployment portability must not be simulated with an in-memory or temporary-filesystem fallback.

## Provenance rule

When code is substantially derived from a third-party implementation or an external protocol materially shapes a feature, update `PROVENANCE.md` with the source, license or protocol status, affected files, and the nature of the adaptation before release.
