# Provenance and implementation references

MDTXTRT keeps implementation provenance explicit so architectural references are used transparently and licenses remain attached to derived work.

## Liquid Glass React architecture

- Normative repository: https://github.com/romastefale/liquid-glass
- Pinned normative revision: `4e7b769e1df7e5a7d3669fef22417fe3d2f79ade` (release 0.1.1).
- Runtime engine: `@samasante/liquid-glass@0.1.1`, © Sam Asante, MIT.
- Component reference: https://github.com/romastefale/liquid-glass/blob/main/examples/GlassContextMenu.tsx
- MDTXTRT authored source: `src/liquid-glass-ui.jsx`; generated production artifact: `ui.js`.
- Relationship: MDTXTRT imports the package's `Glass` primitive directly. Its context-menu component structure and `MENU_LENS` values are copied/adapted from the reference example under the project's documented “copy and own” model. The application shell, labels, editor controls, Telegram/Telegraph behavior, and product-specific styling remain MDTXTRT code.
- MDTXTRT does not claim the refraction engine, signed-distance-field displacement technique, SVG filter implementation, WebKit fixes, or cross-browser renderer as independently originated. Those remain package implementation concerns.
- The former local `glass.js` adaptation has been removed. No alternate displacement renderer or browser-specific visual fallback is retained in MDTXTRT.
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
- The interface icon source is Google Material Symbols / Material Design Icons: https://fonts.google.com/icons and https://github.com/google/material-design-icons.
- The light/dark theme switch uses the official rounded `light_mode` and `dark_mode` SVG assets from that source.
- Google publishes these icons under Apache License 2.0; the license notice is retained in `icons/LICENSE`.

When a future implementation is substantially derived from a third-party reference, record the source, license, affected files, and nature of the adaptation here before release.
