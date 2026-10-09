
import { S } from "./state.js";
import { sheets } from "./constants.js";
import { editor, one } from "./dom.js";
import { getTg } from "./theme.js";
import { panelIsOpen, placePanel, typingFocusActive, fixedFrame, shiftToFixed } from "./panels.js";

export function keyboardTarget(){
  return typingFocusActive();
}
export function syncBrowserViewport(){
  const root=document.documentElement,frame=fixedFrame(),bounds=frame.bounds;
  if(S.session==='ready'){
    const stable=Number(getTg()?.viewportStableHeight);
    
    const top=frame.visualFixed?0:bounds.top;
    root.style.setProperty('--vv-top',top+'px');
    root.style.setProperty('--vv-bottom','0px');
    root.style.setProperty('--vv-height',top>0?bounds.height+'px':Number.isFinite(stable)&&stable>0?stable+'px':'var(--tg-viewport-stable-height,100dvh)');
    root.removeAttribute('data-keyboard');
    for(const sel of sheets){const panel=one(sel);if(panelIsOpen(panel))placePanel(panel);}
    const dialog=one('#dialogMenu');
    if(dialog?.matches(':popover-open'))placePanel(dialog);
    if(typingFocusActive())keepCaretVisible();
    return;
  }
  
  
  
  const covered=Math.max(0,root.clientHeight-(frame.visualFixed?0:bounds.top)-bounds.height);
  const lift=frame.visualFixed?0:(covered>=1?covered:0);
  const hadKeyboard=S.inset>0||root.hasAttribute('data-keyboard');
  const typing=keyboardTarget()||S.inset>0;
  S.inset=typing?lift:0;
  const keyboardOpen=typing&&(frame.visualFixed?covered>=1:S.inset>0);
  
  
  if(hadKeyboard&&!keyboardOpen&&(window.scrollY||window.scrollX))window.scrollTo(0,0);
  root.toggleAttribute('data-keyboard',keyboardOpen);
  root.style.setProperty('--vv-top',bounds.top+'px');
  root.style.setProperty('--vv-bottom',S.inset+'px');
  root.style.setProperty('--vv-height',bounds.height+'px');
  for(const sel of sheets){const panel=one(sel);if(panelIsOpen(panel))placePanel(panel);}
  const dialog=one('#dialogMenu');
  if(dialog?.matches(':popover-open'))placePanel(dialog);
  if(S.inset>0)keepCaretVisible();
}


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
  const frame=fixedFrame();
  const rect=shiftToFixed(caretRect(range),frame);
  if(!rect||!Number.isFinite(rect.top))return;
  const view=frame.bounds,gap=8;
  const bar=shiftToFixed(one('.bar-wrap')?.getBoundingClientRect(),frame),top=shiftToFixed(one('.topbar')?.getBoundingClientRect(),frame);
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
