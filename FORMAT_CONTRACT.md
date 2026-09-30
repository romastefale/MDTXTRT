# Format contract — audited for Etapa 7/7

This document is the executable product contract for import, export and publication. It originated in the earlier format-contract evolution and remains the format-specific boundary of the current product after the six implementation stages. `ARCHITECTURE.md` records the broader system boundaries; Etapa 7/7 changes validation/evidence only, not these serialization semantics.

The current visual baseline is the SHA in `RELEASE_MANIFEST.json.visualBaseline`; `BASELINE.md` records its provenance and superseded historical references.

## File matrix

| File surface | Import | Export | Declared preservation | Loss / rejection behavior |
| --- | --- | --- | --- | --- |
| Markdown (`.md`) | Yes | Yes | Headings, paragraphs, emphasis, strong, strike, inline code, links, lists, task items, tables and the rich extensions accepted by the editor. Extensions without native Markdown syntax are preserved as controlled raw HTML. | Local attachments without a public URL are rejected. Runtime/presentation attributes such as `controls`, `contenteditable`, `draggable`, runtime selection classes and checkbox `disabled` are normalized away and are not file semantics. |
| Text (`.txt`) | Yes | Yes | Plain text and line breaks only. | Media is rejected. If formatting, links or structural semantics are present, export requires explicit confirmation before the lossy conversion. |

Markdown export always serializes the current edited document. It does not return the originally imported bytes merely because the document appears unchanged.

Private-chat bot import is another entry point into this same file contract, not a bot-specific document model. It accepts only `.md` and `.txt`, requires a valid filename and strict UTF-8 payload, removes only a leading UTF-8 BOM, and then creates the same canonical document state used by browser import. TXT keeps the decoded source string literally in `importedTxt` and receives no Markdown interpretation. Markdown uses Marked with `gfm:true` and `breaks:false`, followed by the same portable tag/attribute normalization described below.

Markdown strike has one canonical file representation: `~~text~~`. The importer accepts the HTML aliases already supported by the editor (`s`, `strike`, `del`), while the editor core normalizes them to the strike mark.

## Destination matrix

| Destination | Supported contract | Unsupported content |
| --- | --- | --- |
| Telegram Rich Message | The rich-message HTML contract validated by `toRichHTML()` on the client and by the server Rich Message validator. Local media is uploaded separately and bound to its media placeholder. | Rejected before/at publication; no silent semantic downgrade. |
| Telegraph | Telegraph's explicit tag/attribute subset validated by `telegraphNodes()` on the client and `telegraphValid()` on the server. | Rejected with an error; no silent conversion to a weaker representation. |

## Editor-to-publication fidelity

The editor is a semantic preview of the selected publication target. A one-click structural control must not inject instructional/sample phrases into the document. Pull quotes and expandable quotes format the author's current block/selection while preserving its text; empty structures remain empty until the author types content. Checklist, table and expandable-content skeletons likewise contain no hidden example copy.

Presentation-only cues may distinguish structures in the editor, but they are CSS/runtime affordances rather than serialized content. In particular, normal quotes, expandable quotes and pull quotes have distinct editor treatments that track their distinct publication semantics without adding labels to the exported or published payload.

This is intentionally a semantic, not pixel-identical, WYSIWYG contract: native Telegram/Telegraph clients control final typography and spacing, while MDTXTRT must preserve structure, emphasis and authored text closely enough that publication does not reveal unexpected content. The rule applies at insertion time as well as at export/publication time.

## Shared normalization boundary

The portable Markdown boundary and the Markdown importer use the same allow-list for tags and attributes. Before validation, only known runtime/presentation state is removed:

- `controls` on `video` and `audio`;
- `disabled` on imported task-list checkboxes;
- `contenteditable` and `draggable`;
- the ProseMirror-only `ProseMirror-selectednode` class.

This prevents the editor's rendering requirements from becoming serialized file requirements. For example, the editor may render a video with `controls`, while the exported Markdown omits that attribute; reimport restores the video semantically and the editor adds its runtime controls again.

## Round-trip acceptance

A supported round trip is:

1. create or import content;
2. edit it in the transactional editor;
3. export it;
4. import the exported file into a new document;
5. compare declared semantics, not incidental DOM presentation.

Regression tests must exercise edited content through this path. Returning an untouched original file is not sufficient evidence of compatibility.
