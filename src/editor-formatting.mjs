import {rangeInside,elementAtRangeStart,setCaret} from "./editor-selection.mjs";

const COMMAND_TAG=Object.freeze({
  bold:"strong",
  italic:"em",
  underline:"u",
  strike:"s",
  mark:"mark",
  sub:"sub",
  sup:"sup",
  spoiler:"tg-spoiler",
  code:"code",
  math:"tg-math"
});

function commandSelector(command){
  const tag=COMMAND_TAG[command];
  if(command==="bold")return "strong,b";
  if(command==="italic")return "em,i";
  if(command==="underline")return "u,ins";
  if(command==="strike")return "s,strike,del";
  return tag||"";
}

function closestMark(root,command,range=rangeInside(root)){
  const selector=commandSelector(command);
  if(!selector||!range)return null;
  let node=elementAtRangeStart(root,range);
  const found=node?.closest?.(selector)||null;
  return found&&root.contains(found)?found:null;
}

function stripElements(fragment,selector){
  for(const node of [...fragment.querySelectorAll?.(selector)||[]]){
    node.replaceWith(...node.childNodes);
  }
}

function restoreRangeAroundMarkers(doc,start,end){
  const selection=doc.getSelection?.();
  if(!selection)return;
  const range=doc.createRange();
  range.setStartAfter(start);
  range.setEndBefore(end);
  selection.removeAllRanges();selection.addRange(range);
  start.remove();end.remove();
}

function replaceSelectedRange(root,range,fragment){
  const doc=root.ownerDocument;
  const start=doc.createComment("selection-start"),end=doc.createComment("selection-end");
  const container=doc.createDocumentFragment();
  container.append(start,fragment,end);
  range.deleteContents();
  range.insertNode(container);
  restoreRangeAroundMarkers(doc,start,end);
}

function splitAncestorAtMarker(ancestor,marker){
  const doc=ancestor.ownerDocument,parent=ancestor.parentNode;
  if(!parent)return;
  const leftRange=doc.createRange(),rightRange=doc.createRange();
  leftRange.selectNodeContents(ancestor);leftRange.setEndBefore(marker);
  rightRange.selectNodeContents(ancestor);rightRange.setStartAfter(marker);
  const left=leftRange.cloneContents(),right=rightRange.cloneContents();
  const leftClone=ancestor.cloneNode(false),rightClone=ancestor.cloneNode(false);
  leftClone.append(left);rightClone.append(right);
  if(leftClone.textContent||leftClone.querySelector?.("*"))parent.insertBefore(leftClone,ancestor);
  parent.insertBefore(marker,ancestor);
  if(rightClone.textContent||rightClone.querySelector?.("*"))parent.insertBefore(rightClone,ancestor);
  ancestor.remove();
}

function escapeDisabledMarks(root,commands){
  if(!commands.length)return;
  const doc=root.ownerDocument,range=rangeInside(root);
  if(!range||!range.collapsed)return;
  const marker=doc.createTextNode("");
  range.insertNode(marker);
  for(const command of commands){
    const selector=commandSelector(command);
    if(!selector)continue;
    let element=marker.parentElement?.closest?.(selector)||null;
    while(element&&root.contains(element)){
      splitAncestorAtMarker(element,marker);
      element=marker.parentElement?.closest?.(selector)||null;
    }
  }
  setCaret(marker,0);
}

function insertMarkedText(root,text,enabledCommands){
  const doc=root.ownerDocument,range=rangeInside(root);
  if(!range||!range.collapsed)return false;
  let node=doc.createTextNode(text),inner=node;
  for(const command of enabledCommands){
    const tag=COMMAND_TAG[command];
    if(!tag)continue;
    const wrapper=doc.createElement(tag);
    wrapper.append(node);
    node=wrapper;
  }
  range.insertNode(node);
  setCaret(inner,inner.data.length);
  return true;
}

export function createFormatting(root,{changed=()=>{},selectionChanged=()=>{}}={}){
  const typingOverrides=new Map();

  function activeMark(command){
    if(typingOverrides.has(command))return typingOverrides.get(command);
    const range=rangeInside(root);
    if(!range)return false;
    const selector=commandSelector(command);
    if(!selector)return false;
    if(range.collapsed)return Boolean(closestMark(root,command,range));
    const walker=root.ownerDocument.createTreeWalker(root,root.ownerDocument.defaultView.NodeFilter.SHOW_TEXT);
    let node,seen=false;
    while((node=walker.nextNode())){
      if(!node.data)continue;
      let intersects=false;
      try{intersects=range.intersectsNode(node);}catch{}
      if(!intersects)continue;
      seen=true;
      const element=node.parentElement;
      const mark=element?.closest?.(selector)||null;
      if(!mark||!root.contains(mark))return false;
    }
    return seen;
  }

  function toggle(command,value=null){
    if(command==="createLink")return toggleLink(String(value||""));
    const selector=commandSelector(command);
    const tag=COMMAND_TAG[command];
    if(!selector||!tag)throw new Error("Ação de edição indisponível");
    const range=rangeInside(root);
    if(!range)throw new Error("Seleção do editor indisponível");
    if(range.collapsed){
      typingOverrides.set(command,!activeMark(command));
      root.focus({preventScroll:true});
      selectionChanged();
      return true;
    }
    typingOverrides.clear();
    const remove=activeMark(command);
    const fragment=range.extractContents();
    if(remove)stripElements(fragment,selector);
    else{
      const wrapper=root.ownerDocument.createElement(tag);
      wrapper.append(fragment);
      const next=root.ownerDocument.createDocumentFragment();
      next.append(wrapper);
      replaceSelectedRange(root,range,next);
      changed();
      selectionChanged();
      return true;
    }
    replaceSelectedRange(root,range,fragment);
    changed();selectionChanged();
    return true;
  }

  function toggleLink(href){
    const range=rangeInside(root);
    if(!range||range.collapsed)throw new Error("Selecione o texto para criar o hyperlink");
    const fragment=range.extractContents();
    stripElements(fragment,"a[href]");
    const link=root.ownerDocument.createElement("a");
    link.setAttribute("href",href);
    link.append(fragment);
    const next=root.ownerDocument.createDocumentFragment();next.append(link);
    replaceSelectedRange(root,range,next);
    changed();selectionChanged();
    return true;
  }

  function linkHref(){
    return closestMark(root,"createLink")?.getAttribute?.("href")||elementAtRangeStart(root)?.closest?.("a[href]")?.getAttribute("href")||"";
  }

  function beforeInput(event){
    if(!typingOverrides.size||event.isComposing||event.inputType!=="insertText"||typeof event.data!=="string")return false;
    const range=rangeInside(root);
    if(!range||!range.collapsed)return false;
    event.preventDefault();
    const disabled=[...typingOverrides].filter(([,on])=>!on).map(([command])=>command);
    const enabled=[...typingOverrides].filter(([,on])=>on).map(([command])=>command);
    escapeDisabledMarks(root,disabled);
    const inserted=insertMarkedText(root,event.data,enabled);
    typingOverrides.clear();
    if(inserted){changed();selectionChanged();}
    return inserted;
  }

  function clearTypingOverrides(){typingOverrides.clear();}

  return {toggle,activeMark,linkHref,beforeInput,clearTypingOverrides};
}
