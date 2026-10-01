// Diálogo modal de texto/confirmação.
import { S } from "./state.js";
import { panelAnchors } from "./constants.js";
import { editor, one, ui } from "./dom.js";
import { closePanels, focusControl, focusMenuControl, panelOrigin, placePanel, syncBackButton } from "./panels.js";
import { saveSel } from "./editing.js";

export function dialogOutsideBranches(dialog){
  const targets=[],seen=new Set();
  let node=dialog;
  while(node&&node!==document.body){
    const parent=node.parentElement;
    if(!parent)break;
    for(const child of parent.children){
      if(child!==node&&!seen.has(child)){seen.add(child);targets.push(child);}
    }
    node=parent;
  }
  return targets;
}
export function setDialogModality(active){
  const dialog=one('#dialogMenu');
  if(active){
    S.dialogInerted=dialogOutsideBranches(dialog).map(element=>[element,element.hasAttribute('inert')]);
    for(const [element] of S.dialogInerted)element.setAttribute('inert','');
  }else{
    for(const [element,wasInert] of S.dialogInerted){
      if(!wasInert)element.removeAttribute('inert');
    }
    S.dialogInerted=[];
  }
}
export function libraryFocusables(){
  const view=one('#libraryMenu');
  return view?[...view.querySelectorAll('button:not([disabled]):not([hidden]):not([tabindex="-1"]),input:not([disabled]):not([hidden]),textarea:not([disabled]):not([hidden]),select:not([disabled]):not([hidden]),[tabindex]:not([tabindex="-1"])')]:[];
}
export function focusLibraryStart(){return focusMenuControl(one('#libraryClose'));}
export function dialogFocusables(){
  const dialog=one('#dialogMenu');
  return [...dialog.querySelectorAll('button:not([disabled]):not([hidden]),input:not([disabled]):not([hidden]),textarea:not([disabled]):not([hidden]),select:not([disabled]):not([hidden]),[tabindex]:not([tabindex="-1"])')];
}
export function focusDialogStart(selectValue=false){
  const input=one('#dialogInput');
  const target=!S.dialogConfirm&&!input.hidden?input:one('#dialogOk');
  if(focusControl(target)&&selectValue&&!S.dialogConfirm&&input.rows===1)input.select();
}
export function dialogOrigin(){
  const active=document.activeElement;
  if(active&&active!==document.body&&active!==editor)return panelOrigin(active);
  if(S.lastInteractionControl?.isConnected)return panelOrigin(S.lastInteractionControl);
  return editor;
}
export function finishDialog(value){
  const resolve=S.dialogResolve,target=S.dialogReturnFocus;
  S.dialogResolve=null;S.dialogReturnFocus=null;
  const dialog=one('#dialogMenu');
  if(ui.getState().dialog.open)ui.setDialog({open:false});
  panelAnchors.delete(dialog);
  setDialogModality(false);
  syncBackButton();
  focusControl(target);
  if(resolve)resolve(value);
}
// Voltar do Telegram e Esc fecham sem escolher: num diálogo de escolha, false seria a segunda opção.
export function dismissDialog(){finishDialog(S.dialogConfirm&&!S.dialogChoice?false:null);}
export function dialogOpen(label,value='',rows=1,confirmMode=false,anchorOverride=null,labels=null){
  if(S.dialogResolve)finishDialog(null);
  saveSel();
  S.dialogReturnFocus=dialogOrigin();
  closePanels();
  const dialog=one('#dialogMenu');
  const anchor=anchorOverride?.isConnected?anchorOverride:S.dialogReturnFocus?.isConnected?S.dialogReturnFocus:null;
  if(anchor)panelAnchors.set(dialog,anchor);else panelAnchors.delete(dialog);
  const anchorRect=anchor?.getBoundingClientRect()||null;
  S.dialogConfirm=confirmMode;
  S.dialogChoice=Boolean(labels);
  // O React mostra o popover com o texto, o campo e os rótulos deste pedido.
  ui.setDialog({
    open:true,
    serial:ui.getState().dialog.serial+1,
    label:String(label),
    confirm:confirmMode,
    value:confirmMode?'':String(value===null||value===undefined?'':value),
    rows:Math.max(1,Math.min(5,rows)),
    ok:labels?.ok||(confirmMode?'Continuar':'OK'),
    cancel:labels?.cancel||'Cancelar'
  });
  setDialogModality(true);
  placePanel(dialog,anchorRect);
  syncBackButton();
  return new Promise(resolve=>{
    S.dialogResolve=resolve;
    focusDialogStart(rows===1);
  });
}
export function ask(label,value='',rows=1,anchorOverride=null){return dialogOpen(label,value,rows,false,anchorOverride);}
export async function approve(label){return await dialogOpen(label,'',1,true)===true;}
export function chooseDialog(label,ok,cancel){return dialogOpen(label,'',1,true,null,{ok,cancel});}
