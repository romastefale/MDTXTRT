

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

if(docName){
  const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
  const publishTitle=()=>ui.update({docTitle:descriptor.get.call(docName)});
  Object.defineProperty(docName,'value',{configurable:true,get(){return descriptor.get.call(this);},set(next){descriptor.set.call(this,next);publishTitle();}});
  docName.addEventListener('input',publishTitle);
  publishTitle();
}
