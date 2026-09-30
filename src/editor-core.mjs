import {rangeInside,saveSelection,restoreSelection,selectionTextOffsets,elementAtRangeStart,setCaret} from "./editor-selection.mjs";
import {createHistory} from "./editor-history.mjs";
import {createFormatting} from "./editor-formatting.mjs";
import {createStructure} from "./editor-structure.mjs";
import {createSearch} from "./editor-search.mjs";

function currentTextBlock(root){
  const element=elementAtRangeStart(root);
  const block=element?.closest?.("p,div,h1,h2,h3,h4,h5,h6,blockquote,aside,footer,pre,figcaption,caption,td,th,summary");
  return block&&root.contains(block)?block:null;
}

function textCaretOffset(block,range){
  const pre=block.ownerDocument.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer,range.startOffset);
  return pre.toString().length;
}

function setTextCaret(block,offset){
  const doc=block.ownerDocument,walker=doc.createTreeWalker(block,doc.defaultView.NodeFilter.SHOW_TEXT);
  let node,remaining=Math.max(0,offset);
  while((node=walker.nextNode())){
    if(remaining<=node.data.length){setCaret(node,remaining);return true;}
    remaining-=node.data.length;
  }
  setCaret(block,block.childNodes.length);
  return true;
}

function replaceBlockText(block,text){
  block.replaceChildren(block.ownerDocument.createTextNode(text));
}

export function createEditorCore({element,onChange=()=>{},onSelectionChange=()=>{}}){
  if(!element)throw new Error("Elemento do editor ausente");

  let destroyed=false;
  let history;
  const notifySelection=()=>{if(!destroyed){history?.rememberSelection();onSelectionChange({});}};

  const changed=()=>{
    if(destroyed)return;
    history?.commit();
    onChange({});
  };

  history=createHistory(element,{depth:120,onRestore:()=>{onChange({});notifySelection();}});
  const formatting=createFormatting(element,{changed,selectionChanged:notifySelection});
  const structure=createStructure(element,{changed,selectionChanged:notifySelection});
  const search=createSearch(element,{changed,selectionChanged:notifySelection});

  function html(){return element.innerHTML;}

  function setHTML(value,{silent=true}={}){
    element.innerHTML=String(value||"");
    history.reset();
    if(!silent)onChange({});
    notifySelection();
  }

  function resetHTML(value,{silent=true}={}){
    setHTML(value,{silent});
  }

  function syncFromDOM({silent=false}={}){
    const didChange=history.commit();
    if(didChange&&!silent)onChange({});
    notifySelection();
    return didChange;
  }

  function captureSelection(){return saveSelection(element);}
  function restore(saved){return restoreSelection(element,saved,{focus:true});}

  function expandWord(){
    const range=rangeInside(element);
    if(!range||!range.collapsed||range.startContainer.nodeType!==3)return false;
    const text=range.startContainer.data,index=range.startOffset;
    let from=index,to=index;
    while(from>0&&/\S/.test(text[from-1]))from--;
    while(to<text.length&&/\S/.test(text[to]))to++;
    if(from===to)return false;
    range.setStart(range.startContainer,from);range.setEnd(range.startContainer,to);
    const selection=element.ownerDocument.getSelection();
    selection.removeAllRanges();selection.addRange(range);
    notifySelection();
    return true;
  }

  function applyMarkdownBlockRule({allowTask=true}={}){
    const range=rangeInside(element);
    const block=currentTextBlock(element);
    if(!range||!range.collapsed||!block||!["p","div"].includes(block.localName))return false;
    const text=block.textContent.replace(/\u00a0/g," ");
    const caret=textCaretOffset(block,range);
    const escaped=text.match(/^\\(#{1,6}|>|[-*+]|\d+\.) (?=\S)/);
    if(escaped){
      replaceBlockText(block,text.slice(1));setTextCaret(block,Math.max(0,caret-1));changed();notifySelection();return true;
    }
    const heading=text.match(/^(#{1,6}) (?=\S)/);
    const quote=text.match(/^> (?=\S)/);
    const task=allowTask&&text.match(/^- \[([ xX])\] (?=\S)/);
    const bullet=text.match(/^[-*+] (?=\S)/);
    const ordered=text.match(/^(\d+)\. (?=\S)/);
    if(!heading&&!quote&&!task&&!bullet&&!ordered)return false;
    if(heading){
      const tag="h"+heading[1].length,node=element.ownerDocument.createElement(tag),prefix=heading[0].length;
      node.textContent=text.slice(prefix);block.replaceWith(node);setTextCaret(node,Math.max(0,caret-prefix));changed();notifySelection();return true;
    }
    if(quote){
      const node=element.ownerDocument.createElement("blockquote"),prefix=quote[0].length;
      node.textContent=text.slice(prefix);block.replaceWith(node);setTextCaret(node,Math.max(0,caret-prefix));changed();notifySelection();return true;
    }
    const match=task||ordered||bullet,prefix=match[0].length,list=element.ownerDocument.createElement(ordered?"ol":"ul"),item=element.ownerDocument.createElement("li");
    if(task){
      const checkbox=element.ownerDocument.createElement("input");checkbox.type="checkbox";checkbox.checked=task[1].toLowerCase()==="x";
      item.append(checkbox,element.ownerDocument.createTextNode(text.slice(prefix)));
    }else item.textContent=text.slice(prefix);
    if(ordered)list.start=Number(ordered[1]);
    list.append(item);block.replaceWith(list);setTextCaret(item,Math.max(0,caret-prefix));changed();notifySelection();return true;
  }

  function applyMarkdownInlineRule(){
    const range=rangeInside(element),block=currentTextBlock(element);
    if(!range||!range.collapsed||!block||["pre","tg-math-block"].includes(block.localName))return false;
    if(block.querySelector("*"))return false;
    const text=block.textContent,offset=textCaretOffset(block,range);
    const rules=[
      {marker:"**",tag:"strong"},
      {marker:"~~",tag:"s"},
      {marker:"\x60",tag:"code"},
      {marker:"*",tag:"em",single:true}
    ];
    for(const rule of rules){
      const before=text.slice(0,offset);
      if(!before.endsWith(rule.marker))continue;
      const closeStart=offset-rule.marker.length;
      const open=text.lastIndexOf(rule.marker,closeStart-rule.marker.length);
      if(open<0)continue;
      if(rule.single&&(text[open-1]===rule.marker||text[open+1]===rule.marker))continue;
      if(open>0&&text[open-1]==="\\"){
        const next=text.slice(0,open-1)+text.slice(open);
        replaceBlockText(block,next);setTextCaret(block,Math.max(0,offset-1));changed();notifySelection();return true;
      }
      const value=text.slice(open+rule.marker.length,closeStart);
      if(!value||value.includes("\n"))continue;
      const left=text.slice(0,open),right=text.slice(offset);
      block.replaceChildren();
      if(left)block.append(element.ownerDocument.createTextNode(left));
      const mark=element.ownerDocument.createElement(rule.tag);mark.textContent=value;block.append(mark);
      if(right)block.append(element.ownerDocument.createTextNode(right));
      setTextCaret(mark,value.length);
      changed();notifySelection();return true;
    }
    return false;
  }

  function patchMedia(id,patch){
    const node=[...element.querySelectorAll("[data-media-id]")].find(item=>item.getAttribute("data-media-id")===id);
    if(!node)return false;
    for(const [key,value] of Object.entries(patch||{})){
      if(value===null||value===undefined||value==="")node.removeAttribute(key);
      else node.setAttribute(key,String(value));
    }
    return true;
  }

  function deleteSelection(event){
    const range=rangeInside(element);
    if(!range||range.collapsed)return false;
    event.preventDefault();
    range.deleteContents();range.collapse(true);
    const selection=element.ownerDocument.getSelection?.();
    selection?.removeAllRanges();selection?.addRange(range);
    if(!structure.normalizeEmptyFormattedBlock(event.inputType)){changed();notifySelection();}
    return true;
  }

  function handleBeforeInput(event){
    if(formatting.beforeInput(event))return true;
    if(event.inputType==="insertParagraph"&&structure.insertParagraph()){
      event.preventDefault();return true;
    }
    if(String(event.inputType||"").startsWith("delete")){
      if(deleteSelection(event))return true;
      if(structure.normalizeEmptyFormattedBlock(event.inputType)){
        event.preventDefault();return true;
      }
    }
    return false;
  }

  function handleKeydown(event){
    if(!["Backspace","Delete"].includes(event.key))return false;
    const range=rangeInside(element);
    if(!range)return false;
    if(!range.collapsed){
      const selected=[...element.querySelectorAll("table,figure,tg-map,tg-collage,tg-slideshow")].filter(node=>{
        try{return range.intersectsNode(node)&&range.comparePoint(node.parentNode,Array.prototype.indexOf.call(node.parentNode.childNodes,node))<=0&&range.comparePoint(node.parentNode,Array.prototype.indexOf.call(node.parentNode.childNodes,node)+1)>=0;}catch{return false;}
      });
      if(selected.length){
        event.preventDefault();
        range.deleteContents();
        changed();notifySelection();
        return true;
      }
      return false;
    }
    const container=range.startContainer;
    if(container!==element&&container.nodeType!==1)return false;
    const nodes=container===element?element.childNodes:container.childNodes;
    const index=range.startOffset;
    const target=event.key==="Backspace"?nodes[index-1]:nodes[index];
    if(target?.nodeType===1&&["TABLE","FIGURE","TG-MAP","TG-COLLAGE","TG-SLIDESHOW"].includes(target.tagName)){
      event.preventDefault();target.remove();changed();notifySelection();return true;
    }
    return false;
  }

  return {
    html,
    setHTML,
    resetHTML,
    syncFromDOM,
    patchMedia,
    focus:()=>element.focus({preventScroll:true}),
    saveSelection:captureSelection,
    captureSelection,
    restoreSelection:(saved)=>restore(saved),
    rememberSelection:()=>history.rememberSelection(),
    expandWord,
    exec:formatting.toggle,
    activeMark:formatting.activeMark,
    linkHref:formatting.linkHref,
    currentBlockKind:structure.currentBlockKind,
    inBlock:structure.inBlock,
    applyMarkdownBlockRule,
    applyMarkdownInlineRule,
    normalizeEmptyFormattedBlock:structure.normalizeEmptyFormattedBlock,
    exitFormattedBlock:structure.exitFormattedBlock,
    toggleList:structure.toggleList,
    formatBlock:structure.formatBlock,
    insertHTML:structure.insertHTML,
    insertText:structure.insertText,
    addTableColumn:structure.addTableColumn,
    removeTableColumn:structure.removeTableColumn,
    addTableRow:structure.addTableRow,
    removeTableRow:structure.removeTableRow,
    deleteTable:structure.deleteTable,
    selectTable:structure.selectTable,
    handleBeforeInput,
    handleKeydown,
    undo:()=>history.undo(),
    redo:()=>history.redo(),
    findLiteral:search.findLiteral,
    findNext:search.findNext,
    selectRange:search.selectRange,
    selectedText:search.selectedText,
    selectionEmpty:()=>Boolean(rangeInside(element)?.collapsed),
    selectionOffsets:()=>selectionTextOffsets(element),
    selectionMatches:search.selectionMatches,
    replaceSelection:search.replaceSelection,
    replaceAllLiteral:search.replaceAllLiteral,
    destroy:()=>{destroyed=true;}
  };
}

if(typeof window!=="undefined")window.MDTXTRTEditorCore={createEditorCore};
