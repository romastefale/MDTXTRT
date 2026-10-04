# Surface contract — final 7/7 audit

This is the release-time inventory of capabilities that MDTXTRT actually exposes. A control, command or capability belongs here only when the current code exposes it and there is a concrete functional path.

## Web and installed PWA

The Web/PWA shell uses the same editor and document model.

| Announced capability | Functional path |
| --- | --- |
| Rich document editing | ProseMirror transactional editor in `src/editor-core.mjs` |
| Undo / redo | `#undoBtn` / `#redoBtn` → editor history |
| Theme | `#themeBtn` → persisted light/dark preference |
| Destination | `#destBtn` → Telegram / Telegraph contract |
| Import Markdown / TXT | File menu → `#importMdBtn` / `#importTxtBtn` |
| Export Markdown / TXT | top hamburger application menu → `#exportMdBtn` / `#exportTxtBtn` |
| Find / replace | File menu → `#findBtn` → literal search/replace |
| Rich formatting / structures | formatting bar and Plus submenus → commands / `insertFeature()` |
| Links | `#linkBtn` → hyperlink, URL or Telegram button according to destination |
| Local attachment | media/voice input → IndexedDB + draft metadata |
| Telegraph publish | top hamburger application menu → `publishTelegraph()` → backend ownership/path contract |
| Telegram from browser/PWA | explicit browser-to-Mini-App handoff; browser mode never pretends to possess Telegram identity |
| Draft persistence / library | local recovery plus Railway-volume records; top hamburger → Rascunhos e publicações → standard GlassContextMenu submenu with owner-scoped publication/draft cards |
| Telegram publication library/edit | existing durable Telegram provenance → publication summary card → linked current draft opened in editor; prior messages remain unchanged |
| Telegraph page library/edit | owner-scoped page list → authoritative `/api/telegraph/load` → same document/path opened in editor |

## Telegram Mini App

The Mini App uses the same shell after server validation of Telegram `initData`.

| Announced capability | Functional path |
| --- | --- |
| Editor/import/export controls | same Web shell after `/api/telegram/session` succeeds |
| Telegram publish | `publishTelegram()` → verified owner → durable provenance → `sendRichMessage` |
| Publish a revised Telegram document | durable owner/document provenance → revision notice replying to prior message → new `sendRichMessage`; prior message is preserved |
| Draft / publication library | same owner-scoped standard submenu as Web/PWA; it follows the shared menu row, scrolling, placement and visual-viewport rules; Publicações and Rascunhos are independently collapsible, with Telegram/Telegraph publications listed before drafts |
| Keyboard retention across menus | any active text-entry focus remains the focus owner while root menus/submenus open, close or switch; standard menus use explicit `data-menu-open` state (not native Popover API), and a transparent dismiss layer closes outside taps without focus transfer or click-through |
| Telegraph publish/edit | same Telegraph path with verified Telegram owner |
| Handoff recovery | `/api/handoff/claim`; claim is passive until explicit publish |
| Settings / Back integration | official Mini App SettingsButton / BackButton events |
| Fullscreen / viewport / safe areas | official Telegram state/events; Web visual viewport is the non-Telegram fallback |
| Draft persistence | Railway namespace derived from verified Telegram identity |

## Private bot chat

The bot advertises these commands only in private chats:

| Command | Functional path |
| --- | --- |
| `/start` | opens MDTXTRT entry points |
| `/app` | opens the active document in the Mini App |
| `/novo` | creates a one-shot new-document launch token |
| `/rascunhos` | lists the owner's saved drafts in the chat, each opening in the Mini App editor |
| `/telegraph` | opens the Mini App in the Telegraph editor |
| `/enviar` | lists saved drafts; the chosen one is sent from the Mini App |
| `/exportar` | lists saved drafts and publications; the chosen one is exported as TXT or Markdown |
| `/importar` | validates/downloads a private .md/.txt document and creates a passive import handoff |
| `/ajuda` | documents registered command paths (`/help`, the Bot API global command, answers the same and is not listed) |

Unsupported attachment/command combinations are rejected with guidance rather than silently interpreted. An unknown command in the private chat gets a short pointer to `/ajuda`; plain text gets no reply. Commands addressed to another bot (`/cmd@other_bot`) are ignored. In groups the bot answers only its own commands, pointing to the private chat, and ignores documents and plain messages.

## Destination-scoped editor controls

Telegram-only items are hidden when Telegraph is selected; Telegraph-only items are hidden when Telegram is selected. Unsupported serialized content is rejected rather than silently downgraded.

Declared insertions include math block, divider, table, details, image, video, embed, audio, document, map, collage, slideshow, anchor, reference, time, custom emoji, button, ordered/task list, pull quote and expandable quote. Declared mark/command controls include bold, italic, underline, strike, mark, spoiler, code, subscript, superscript, inline math and unordered list.

## Release evidence boundary

The static surface audit proves that announced controls and commands have implementation paths in the candidate. It does not prove physical rendering or external-service behavior. Final approval still requires real Web/PWA/Mini App/device evidence, real Telegram/Telegraph evidence, import/export evidence, persistent-volume restart evidence, fault injection and rollback for the exact candidate SHA being certified. That SHA identifies the evidence record only; it does not constrain later evolution.
