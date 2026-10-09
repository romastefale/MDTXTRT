

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


export const ui = window.MDTXTRT_UI;
if(!ui)throw new Error('Interface React incompleta: estado');
