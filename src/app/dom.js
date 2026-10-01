// Elementos fixos da página e o estado React (window.MDTXTRT_UI), resolvidos uma vez ao carregar.

export const one=s=>document.querySelector(s);
export const all=s=>Array.from(document.querySelectorAll(s));
export const editor = one('#editor');
export const docName = one('#docName');
export const linkBtn = one('#linkBtn');
export const toast = one('#toast');
export const toastTextHost = one('#toastTextHost');
if(!toast||!toastTextHost)throw new Error('Interface React incompleta: toast');
export const fileInput = one('#fileInput');
export const menuDismissLayer = one('#menuDismissLayer');
// Estado dos menus, do diálogo e da biblioteca: src/ui-store.mjs, renderizado
// pelo React (src/chrome.jsx). Este arquivo não altera a marcação dos menus.
export const ui = window.MDTXTRT_UI;
if(!ui)throw new Error('Interface React incompleta: estado');
