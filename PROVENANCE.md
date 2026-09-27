# Provenance and implementation references

MDTXTRT keeps implementation provenance explicit so architectural references are used transparently and licenses remain attached to derived work.

## Liquid Glass material architecture

- Design and implementation reference: https://github.com/romastefale/liquid-glass
- Reference revision used for the architecture contract: `4e7b769e1df7e5a7d3669fef22417fe3d2f79ade` (v0.1.1 lineage).
- Upstream project credited by that repository: `@samasante/liquid-glass`, © Sam Asante.
- License: MIT.
- MDTXTRT files: `glass.js`, `index.html`, and the floating-panel placement logic in `app.js`.
- UX component source: https://github.com/romastefale/liquid-glass/blob/main/examples/GlassContextMenu.tsx
- Relationship: `glass.js` is an adapted plain-JavaScript implementation of the reference project's displacement-map / SVG backdrop-filter material architecture and its published optics. The compact menu geometry, crisp overlay edge, and dedicated `context-menu` optics profile are derived from `examples/GlassContextMenu.tsx`. MDTXTRT does not present those techniques or design decisions as independently originated.
- The context-menu profile preserves the reference coefficients (`mapSize 256`, `depth 0.65`, `curvature 0.26`, `dispersion 0.16`, `strength 0.22`, `bend 0.65`, `bendWidth 0.07`, `frost 3.5`, `brightness 0.55`, `specular 0.8`, `sheen 0.4`, `sheenWidth 1`) and uses the reference's symmetric RGB dispersion model.
- Browser behavior remains explicit: Blink may expose `context-menu-refraction`; engines without backdrop SVG displacement expose `context-menu-frost`. MDTXTRT records the active renderer through `data-lg-rendering` and does not claim optical equivalence between them.
- The repository `LICENSE` retains the Sam Asante copyright notice alongside the MDTXTRT copyright notice.

## Telegram Bot API

- Protocol reference: https://core.telegram.org/bots/api
- Changelog reference: https://core.telegram.org/bots/api-changelog
- Protocol baseline for Rich Messages: Bot API 10.3 (2026-08-24).
- MDTXTRT uses the official Rich Messages architecture (`sendRichMessage`, `InputRichMessage`, rich-message media references and rich buttons) rather than emulating unsupported markup through legacy message fallbacks.
- Telegram documentation is used as an interoperability specification; Telegram source code is not incorporated into this repository.

## Telegra.ph API

- Protocol reference: https://telegra.ph/api
- MDTXTRT maps editor content to the documented `Node` / `NodeElement` model and uses the official `createPage`, `editPage`, `getPage` and account methods.
- Telegra.ph documentation is used as an interoperability specification; Telegra.ph source code is not incorporated into this repository.

## Icon assets

- Vector icon assets live under `icons/`.
- Their license notice is retained in `icons/LICENSE`.

When a future implementation is substantially derived from a third-party reference, record the source, license, affected files, and nature of the adaptation here before release.
