// Teclado virtual: barra acompanhando o visualViewport e cursor visível.
import { S } from "./state.js";
import { sheets } from "./constants.js";
import { editor, one } from "./dom.js";
import { getTg } from "./theme.js";
import { panelIsOpen, placePanel, typingFocusActive, visualViewportBounds } from "./panels.js";

export function keyboardTarget(){
  return typingFocusActive();
}
export function syncBrowserViewport(){
  const root=document.documentElement,viewport=window.visualViewport,bounds=visualViewportBounds();
  if(S.session==='ready'){
    const stable=Number(getTg()?.viewportStableHeight);
    root.style.setProperty('--vv-top','0px');
    root.style.setProperty('--vv-bottom','0px');
    root.style.setProperty('--vv-height',Number.isFinite(stable)&&stable>0?stable+'px':'var(--tg-viewport-stable-height,100dvh)');
    root.removeAttribute('data-keyboard');
    for(const sel of sheets){const panel=one(sel);if(panelIsOpen(panel))placePanel(panel);}
    const dialog=one('#dialogMenu');
    if(dialog?.matches(':popover-open'))placePanel(dialog);
    if(typingFocusActive())keepCaretVisible();
    return;
  }
  // Frações de pixel do iOS sem teclado não contam como teclado (deixariam um vão).
  const raw=Math.max(0,root.clientHeight-bounds.top-bounds.height),bottom=raw>=1?raw:0;
  const hadKeyboard=S.inset>0;
  S.inset=keyboardTarget()||S.inset>0?bottom:0;
  // O iOS às vezes deixa a página rolada depois que o teclado fecha; a barra
  // ficaria acima da borda. A página não rola (overflow:clip), então volta ao topo.
  if(hadKeyboard&&!S.inset&&(window.scrollY||window.scrollX))window.scrollTo(0,0);
  root.toggleAttribute('data-keyboard',S.inset>0);
  root.style.setProperty('--vv-top',bounds.top+'px');
  root.style.setProperty('--vv-bottom',S.inset+'px');
  root.style.setProperty('--vv-height',bounds.height+'px');
  for(const sel of sheets){const panel=one(sel);if(panelIsOpen(panel))placePanel(panel);}
  const dialog=one('#dialogMenu');
  if(dialog?.matches(':popover-open'))placePanel(dialog);
  if(S.inset>0)keepCaretVisible();
}
// O cursor do editor fica visível entre a barra superior e a barra inferior (que
// acompanha o teclado): ao digitar e quando o teclado abre ou muda de altura.
export function caretRect(range){
  const rects=range.getClientRects();
  const last=rects.length?rects[rects.length-1]:null;
  if(last&&(last.height||last.width))return last;
  let node=range.endContainer;
  if(node.nodeType!==1)node=node.parentElement;
  else if(node===editor)node=editor.childNodes[Math.min(range.endOffset,editor.childNodes.length-1)]||editor;
  if(node?.nodeType!==1)node=node?.parentElement||editor;
  return node.getBoundingClientRect();
}
export function keepCaretVisible(){
  if(document.activeElement!==editor)return;
  const scroller=editor.closest('.scroll'),selection=document.getSelection();
  if(!scroller||!selection?.rangeCount)return;
  const range=selection.getRangeAt(0);
  if(!editor.contains(range.endContainer))return;
  const rect=caretRect(range);
  if(!rect||!Number.isFinite(rect.top))return;
  const view=visualViewportBounds(),gap=8;
  const bar=one('.bar-wrap')?.getBoundingClientRect(),top=one('.topbar')?.getBoundingClientRect();
  const lower=Math.min(view.bottom,bar&&bar.height?bar.top:view.bottom)-gap;
  const upper=Math.max(view.top,top&&top.height?top.bottom:view.top)+gap;
  if(rect.bottom>lower)scroller.scrollTop+=rect.bottom-lower;
  else if(rect.top<upper)scroller.scrollTop-=upper-rect.top;
}
export function scheduleCaretVisible(){
  cancelAnimationFrame(S.caretFrame);
  S.caretFrame=requestAnimationFrame(keepCaretVisible);
}
export function scheduleBrowserViewport(){
  cancelAnimationFrame(S.viewportFrame);
  S.viewportFrame=requestAnimationFrame(syncBrowserViewport);
}
