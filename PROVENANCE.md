# Provenance and implementation references

MDTXTRT keeps implementation provenance explicit so architectural references are used transparently and licenses remain attached to derived work.

## Liquid Glass material architecture

- Design and implementation reference: https://github.com/romastefale/liquid-glass
- Upstream project credited by that repository: `@samasante/liquid-glass`, © Sam Asante.
- License: MIT.
- MDTXTRT file: `glass.js`.
- Relationship: `glass.js` is an adapted plain-JavaScript implementation of the reference project's displacement-map / SVG backdrop-filter material architecture and its published material optics. MDTXTRT does not present that technique as independently originated.
- The repository `LICENSE` retains the Sam Asante copyright notice alongside the MDTXTRT copyright notice.

## Telegram Bot API

- Protocol reference: https://core.telegram.org/bots/api
- Changelog reference: https://core.telegram.org/bots/api-changelog
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
