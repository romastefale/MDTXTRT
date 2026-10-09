

export const STATE_VERSION=2;
export const FORMAT_CONTRACT=Object.freeze({
  files:Object.freeze({
    md:Object.freeze({import:true,export:true,preservation:"declared-rich-semantics",presentation:"normalized"}),
    txt:Object.freeze({import:true,export:true,preservation:"plain-text",lossy:true})
  }),
  destinations:Object.freeze({
    telegram:Object.freeze({publish:true,unsupported:"reject"}),
    telegraph:Object.freeze({publish:true,unsupported:"reject"})
  })
});
export const plusSubmenus=['#plus-file-menu','#plus-format-menu','#plus-structure-menu','#plus-media-menu','#plus-interaction-menu'];
export const sheets=['#plusMenu',...plusSubmenus,'#linkMenu','#headingMenu','#quoteMenu','#listMenu','#exportMenu','#libraryMenu','#findMenu'];
export const THEME_KEY='mdtxtrt-theme';
export const BROWSER_OWNER_KEY='mdtxtrt-browser-owner';
export const DRAFT_KEY='rmdtxtml';
export const DRAFT_ARCHIVE_PREFIX='rmdtxtml-document:';
export const NEW_DOCUMENT_PARAM='new';
export const API = 'https://mdtxtrt.up.railway.app';
export const DB_NAME='mdtxtrt',DB_STORE='media';
export const telegramInsetFields=['top','right','bottom','left'];
export const panelAnchors=new WeakMap(),panelOpeners=new WeakMap();
export const PORTABLE_TAGS=new Set('a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div'.split(' '));
export const PORTABLE_ATTRS=new Set('href name class style src alt tg-spoiler start type reversed value checked disabled controls expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats'.split(' '));
