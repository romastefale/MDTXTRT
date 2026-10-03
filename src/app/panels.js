// Menus: abertura, posição, foco e retenção do teclado ao tocar.
import { S } from "./state.js";
import { panelAnchors, panelOpeners, plusSubmenus, sheets } from "./constants.js";
import { editor, one, ui } from "./dom.js";
import { getTg } from "./theme.js";
import { dismissDialog } from "./dialog.js";
import { saveSel } from "./editing.js";
import { closeLibrary } from "./library.js";

export function showToast(msg){
  // O React (src/chrome.jsx, Toast) mostra o texto e a classe "on".
  ui.setToast({text:String(msg),visible:true});
  clearTimeout(showToast.t); showToast.t = setTimeout(()=>ui.setToast({visible:false}), 1600);
}
export function panelIsOpen(panel){
  if(!panel)return false;
  if(panel.id==='dialogMenu')return ui.getState().dialog.open;
  return ui.menu(panel.id).open;
}
export function librarySubmenuOpen(){
  return panelIsOpen(one('#libraryMenu'));
}
export function hasOpenLayer(){
  return panelIsOpen(one('#dialogMenu'))||sheets.some(sel=>panelIsOpen(one(sel)));
}
export function syncBackButton(){
  if(S.session!=='ready')return;
  if(hasOpenLayer())getTg().BackButton.show();
  else getTg().BackButton.hide();
}
export function closeTopLayer(){
  const dialog=one('#dialogMenu');
  if(panelIsOpen(dialog)){dismissDialog();return;}
  if(librarySubmenuOpen()){closeLibrary();return;}
  const sel=sheets.find(name=>panelIsOpen(one(name)));
  if(sel)closePanel(one(sel),true);
}
export function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
// position:fixed e getBoundingClientRect nem sempre têm a mesma origem. Com o
// teclado aberto o visualViewport pode estar deslocado: o retângulo do botão é
// relativo à área visível e o `top` do menu é relativo ao viewport de layout.
// Sem corrigir isso o menu abre longe do botão. Uma sonda em top:0 distingue
// esse caso de um fixed já preso à área visível (o deslocamento não entra) e
// do ambiente sem layout, que não mede a sonda.
function probeFixedOrigin(){
  const probe=document.createElement('div');
  probe.setAttribute('data-fixed-probe','');
  probe.style.cssText='position:fixed;top:0;left:0;width:4px;height:4px;margin:0;padding:0;border:0;pointer-events:none;visibility:hidden';
  document.documentElement.appendChild(probe);
  const box=probe.getBoundingClientRect();
  probe.remove();
  return box;
}
export function fixedFrame(){
  const root=document.documentElement,viewport=window.visualViewport;
  const telegramStable=S.session==='ready'?Number(getTg()?.viewportStableHeight):NaN;
  if(Number.isFinite(telegramStable)&&telegramStable>0){
    const width=root.clientWidth||window.innerWidth;
    return {shiftX:0,shiftY:0,visualFixed:false,bounds:{left:0,top:0,width,height:telegramStable,right:width,bottom:telegramStable}};
  }
  const ox=Math.max(0,viewport&&Number.isFinite(viewport.offsetLeft)?viewport.offsetLeft:0);
  const oy=Math.max(0,viewport&&Number.isFinite(viewport.offsetTop)?viewport.offsetTop:0);
  const width=viewport&&Number.isFinite(viewport.width)&&viewport.width>0?viewport.width:(root.clientWidth||window.innerWidth);
  const height=viewport&&Number.isFinite(viewport.height)&&viewport.height>0?viewport.height:(root.clientHeight||window.innerHeight);
  let shiftX=0,shiftY=0,originLeft=ox,originTop=oy,visualFixed=false;
  const keyboardLikely=ox>0.5||oy>0.5||Math.abs((root.clientHeight||0)-height)>=1;
  if(keyboardLikely){
    const box=probeFixedOrigin();
    if(box.width>=1&&Math.abs(box.top+oy)<=2&&Math.abs(box.left+ox)<=2){
      shiftX=ox;shiftY=oy;
    }else if(box.width>=1&&Math.abs(box.top)<=2&&Math.abs(box.left)<=2){
      visualFixed=true;originLeft=0;originTop=0;
    }else if(box.width>=1){
      shiftX=-box.left;shiftY=-box.top;originLeft=shiftX;originTop=shiftY;
    }
  }
  return {shiftX,shiftY,visualFixed,bounds:{left:originLeft,top:originTop,width,height,right:originLeft+width,bottom:originTop+height}};
}
export function shiftToFixed(rect,frame){
  if(!rect||(!frame.shiftX&&!frame.shiftY))return rect;
  return {left:rect.left+frame.shiftX,top:rect.top+frame.shiftY,right:rect.right+frame.shiftX,bottom:rect.bottom+frame.shiftY,width:rect.width,height:rect.height};
}
export function visualViewportBounds(){
  return fixedFrame().bounds;
}
export function panelViewportBounds(base=visualViewportBounds()){
  const frame=fixedFrame();
  const origin=base||frame.bounds;
  const bar=one('.bar-wrap');
  const rect=shiftToFixed(bar?.getBoundingClientRect?.()||null,frame);
  const bottom=rect&&Number.isFinite(rect.top)&&rect.top>origin.top&&rect.top<origin.bottom?Math.max(origin.top,rect.top-8):origin.bottom;
  return {...origin,height:Math.max(0,bottom-origin.top),bottom};
}
export function panelAnchor(panel){
  const override=panelAnchors.get(panel);
  if(override?.isConnected)return override;
  const id=panel.dataset.anchor;
  return id?one('#'+id):null;
}
export function panelOrigin(element){
  if(!element||typeof element.focus!=='function')return null;
  const panel=element.closest?.('.glass-menu');
  return panel?(panelAnchor(panel)||element):element;
}
export function isTypingEntry(element){
  return Boolean(element&&(element===editor||element.matches?.('textarea,input:not([type=button]):not([type=checkbox]):not([type=file]),[contenteditable="true"]')));
}
export function typingFocusActive(outsidePanel=null){
  const active=document.activeElement;
  return isTypingEntry(active)&&(!outsidePanel||!outsidePanel.contains(active));
}
export function focusControl(element){
  if(!element||!element.isConnected||typeof element.focus!=='function'||element.hidden||element.disabled)return false;
  try{element.focus({preventScroll:true});}catch{element.focus();}
  return true;
}
export function focusMenuControl(element,outsidePanel=null){
  if(typingFocusActive(outsidePanel))return false;
  return focusControl(element);
}
export function usableAnchorRect(rect,bounds){
  return Boolean(rect&&(rect.width>0||rect.height>0)&&rect.right>bounds.left&&rect.left<bounds.right&&rect.bottom>bounds.top&&rect.top<bounds.bottom);
}
export function placePanel(panel,anchorRect=null){
  if(!panel)return;
  const id=panel.id;
  const frame=fixedFrame(),viewport=frame.bounds,bounds=panelViewportBounds(viewport),edge=8,gap=8;
  const fullHeight=Math.max(0,bounds.height-edge*2);
  const baseMax=Math.max(0,Math.min(420,bounds.height*.55,fullHeight));
  const maxWidth=Math.max(0,bounds.width-edge*2);
  ui.setMenu(id,{positioned:true,maxHeight:baseMax,maxWidth});
  const anchor=panelAnchor(panel);
  const rect=shiftToFixed(anchorRect||anchor?.getBoundingClientRect()||null,frame);
  let box=panel.getBoundingClientRect();
  if(id==='dialogMenu'&&!usableAnchorRect(rect,viewport)){
    // Diálogo sem âncora: centrado na área livre abaixo da barra superior e acima
    // da inferior, com altura para o texto inteiro (sem o teto de 55% dos menus).
    const head=shiftToFixed(one('.topbar')?.getBoundingClientRect?.()||null,frame);
    const top=head&&Number.isFinite(head.bottom)&&head.bottom>bounds.top&&head.bottom<bounds.bottom?head.bottom:bounds.top;
    const free={...bounds,top,height:Math.max(0,bounds.bottom-top)};
    ui.setMenu(id,{maxHeight:Math.max(0,free.height-edge*2)});
    box=panel.getBoundingClientRect();
    const minLeft=free.left+edge,maxLeft=Math.max(minLeft,free.right-edge-box.width);
    const minTop=free.top+edge,maxTop=Math.max(minTop,free.bottom-edge-box.height);
    ui.setMenu(id,{
      left:clamp(free.left+(free.width-box.width)/2,minLeft,maxLeft),
      top:clamp(free.top+(free.height-box.height)/2,minTop,maxTop)
    });
    return;
  }
  if(!usableAnchorRect(rect,viewport)){
    const minLeft=bounds.left+edge,maxLeft=Math.max(minLeft,bounds.right-edge-box.width);
    const minTop=bounds.top+edge,maxTop=Math.max(minTop,bounds.bottom-edge-box.height);
    ui.setMenu(id,{
      left:clamp(bounds.left+(bounds.width-box.width)/2,minLeft,maxLeft),
      top:clamp(bounds.top+(bounds.height-box.height)/2,minTop,maxTop)
    });
    return;
  }
  const aboveSpace=Math.max(0,rect.top-gap-(bounds.top+edge));
  const belowSpace=Math.max(0,(bounds.bottom-edge)-(rect.bottom+gap));
  const wanted=Math.min(box.height||baseMax,baseMax);
  const preference=panel.dataset.placement||'auto';
  let side;
  if(preference==='top')side=aboveSpace>=wanted||aboveSpace>=belowSpace?'top':'bottom';
  else if(preference==='bottom')side=belowSpace>=wanted||belowSpace>=aboveSpace?'bottom':'top';
  else side=aboveSpace>=wanted?'top':belowSpace>=wanted?'bottom':aboveSpace>=belowSpace?'top':'bottom';
  const available=side==='top'?aboveSpace:belowSpace;
  ui.setMenu(id,{maxHeight:Math.max(0,Math.min(baseMax,available))});
  box=panel.getBoundingClientRect();
  const minLeft=bounds.left+edge,maxLeft=Math.max(minLeft,bounds.right-edge-box.width);
  const left=clamp(rect.left+rect.width/2-box.width/2,minLeft,maxLeft);
  const proposed=side==='top'?rect.top-gap-box.height:rect.bottom+gap;
  const minTop=bounds.top+edge,maxTop=Math.max(minTop,bounds.bottom-edge-box.height);
  ui.setMenu(id,{left,top:clamp(proposed,minTop,maxTop)});
}
export function setMenuPanelOpen(panel,open){
  if(!panel)return;
  const next=Boolean(open);
  if(next===panelIsOpen(panel))return;
  if(next){
    ui.setMenu(panel.id,{open:true,anchor:panelAnchor(panel)?.id||null});
    placePanel(panel);
  }else{
    ui.setMenu(panel.id,{open:false});
    panelAnchors.delete(panel);
  }
  syncBackButton();
  document.dispatchEvent(new Event('selectionchange'));
}
export function closePanels(except=null){
  for(const sel of sheets){
    const panel=one(sel);
    if(panel!==except&&panelIsOpen(panel))setMenuPanelOpen(panel,false);
  }
}
export function openPanel(sel,anchorOverride=null){
  const panel=one(sel);
  if(!panel)throw new Error('Painel indisponível: '+sel);
  saveSel();
  closePanels(panel);
  if(anchorOverride)panelAnchors.set(panel,anchorOverride);else panelAnchors.delete(panel);
  const anchor=panelAnchor(panel);
  panelOpeners.set(panel,panelOrigin(anchor||document.activeElement));
  const anchorRect=anchor?.getBoundingClientRect()||null;
  // O React abre o painel, zera a rolagem da lista e marca aria-expanded na âncora.
  ui.setMenu(panel.id,{open:true,anchor:anchor?.id||null});
  placePanel(panel,anchorRect);
  syncBackButton();
  document.dispatchEvent(new Event('selectionchange'));
}
export function closePanel(panel,returnFocus=false){
  if(!panelIsOpen(panel))return;
  const target=returnFocus?panelOpeners.get(panel):null;
  ui.setMenu(panel.id,{open:false});
  panelAnchors.delete(panel);
  syncBackButton();
  document.dispatchEvent(new Event('selectionchange'));
  if(returnFocus)focusMenuControl(target,panel);
}
export function togglePanel(sel,anchorOverride=null){
  const panel=one(sel);
  if(!panel)throw new Error('Painel indisponível: '+sel);
  if(panelIsOpen(panel)){
    closePanel(panel,true);
    return false;
  }
  openPanel(sel,anchorOverride);
  return true;
}
export function openPlusSubmenu(key){
  const sel='#plus-'+key+'-menu';
  if(!plusSubmenus.includes(sel))throw new Error('Categoria indisponível');
  openPanel(sel,one('#plusBtn'));
}
export function openPlusRoot(){
  openPanel('#plusMenu',one('#plusBtn'));
}
// Teclado virtual: enquanto o usuário digita, nenhum toque na interface (barras,
// menus, espaços entre os itens) pode tirar o foco do campo de texto. No iOS o
// teclado fecha no blur e um focus() posterior por script não o reabre, por isso o
// padrão do toque é cancelado antes de mover o foco. Campos de texto reais dentro
// de menus e diálogos (título do Telegraph, URL do link) recebem foco normalmente.
export function retainedInterfaceControl(target){
  if(!target?.closest||isTypingEntry(target)||target.closest('input,textarea,select,label'))return null;
  const control=target.closest('#ux-root button,#ux-root [role="button"],#ux-root a[href],#ux-root .glass-menu,#ux-root .topbar,#ux-root .bar-wrap,#ux-root .toast');
  return control&&!control.disabled?control:null;
}
// No toque, só o mousedown de compatibilidade é cancelado. Cancelar o pointerdown
// de um toque faz o WebKit (iOS e Telegram) suprimir esse mousedown, que é o
// evento cujo cancelamento impede o blur, e o WebKit ainda suprime o click. O
// resultado era o teclado fechando e o menu sem abrir. Com mouse e caneta, o
// pointerdown continua cancelado.
export function touchPress(event){
  return event.type==='pointerdown'&&event.pointerType==='touch';
}
export function retainTypingFocus(event){
  if(touchPress(event)||!typingFocusActive())return;
  if(retainedInterfaceControl(event.target))event.preventDefault();
}
export function holdDismissPress(event){
  if(touchPress(event))return;
  event.preventDefault();
  event.stopPropagation();
}
