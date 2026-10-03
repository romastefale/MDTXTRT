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

// Chrome e WebKit deixam a primeira linha de um editor vazio como texto solto na
// raiz. Para os atalhos de Markdown valerem nela, a linha vira um <p>.
const INLINE_LINE=/^(a|b|strong|i|em|u|s|del|code|span|mark|sub|sup|tg-spoiler|tg-emoji|tg-time|tg-math)$/;
function wrapRootLine(root,range){
  const node=range.startContainer;
  if(node.nodeType!==3||node.parentNode!==root)return null;
  const offset=range.startOffset,inline=item=>item.nodeType===3||item.nodeType===1&&INLINE_LINE.test(item.localName);
  let first=node,last=node;
  while(first.previousSibling&&inline(first.previousSibling))first=first.previousSibling;
  while(last.nextSibling&&inline(last.nextSibling))last=last.nextSibling;
  const p=root.ownerDocument.createElement("p");
  root.insertBefore(p,first);
  for(let item=first;item;){
    const next=item===last?null:item.nextSibling;
    p.append(item);item=next;
  }
  setCaret(node,offset);
  return p;
}

// Um bloco sem texto nem mídia precisa de <br> para ter altura e receber o cursor.
function ensureCaretLine(block){
  if(block.textContent.replace(/\u200b/g,"")||block.querySelector("br,img,video,audio,iframe,input,tg-emoji"))return;
  block.replaceChildren(block.ownerDocument.createElement("br"));
}

// Crédito vazio: um <cite> sem texto (vazio, só espaços, só &nbsp; ou só <br>) sai no
// envio, pela mesma regra de toRichHTML e telegraphNodes (#155): textContent.trim() vazio.
// :empty não pega espaços nem <br>, então o núcleo marca esses <cite> com
// data-empty-credit e a prévia os trata como "sem crédito" (styles.css). Enquanto o cursor
// está dentro do crédito vazio (apagou o nome para digitar outro), ele fica sem a marca e
// mantém a linha própria, para o texto digitado entrar no crédito. A marca é só da prévia:
// html() e o histórico a tiram, e ela não chega ao rascunho, à exportação nem ao envio.
export const EMPTY_CREDIT="data-empty-credit";
export function isEmptyCredit(cite){return !cite.textContent.trim();}
export function markEmptyCredits(root){
  const selection=root.ownerDocument.getSelection?.(),caret=selection?.rangeCount?selection.anchorNode:null;
  for(const cite of root.querySelectorAll("cite")){
    const editing=Boolean(caret&&cite.contains(caret));
    cite.toggleAttribute(EMPTY_CREDIT,isEmptyCredit(cite)&&!editing);
  }
}
export function editorHTML(root){
  if(!root.querySelector("["+EMPTY_CREDIT+"]"))return root.innerHTML;
  const copy=root.cloneNode(true);
  for(const node of copy.querySelectorAll("["+EMPTY_CREDIT+"]"))node.removeAttribute(EMPTY_CREDIT);
  return copy.innerHTML;
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

  // Qualquer mudança no texto (digitação, colagem, setHTML, desfazer, innerHTML de fora)
  // ou no cursor remarca os créditos vazios. Mudança de atributo não é observada: a marca
  // não reentra.
  const remarkCredits=()=>{if(!destroyed)markEmptyCredits(element);};
  remarkCredits();
  const Observer=element.ownerDocument?.defaultView?.MutationObserver;
  const credits=typeof Observer==="function"?new Observer(remarkCredits):null;
  credits?.observe(element,{subtree:true,childList:true,characterData:true});
  element.ownerDocument?.addEventListener?.("selectionchange",remarkCredits);
  history=createHistory(element,{depth:120,serialize:editorHTML,onRestore:()=>{onChange({});notifySelection();}});
  const formatting=createFormatting(element,{changed,selectionChanged:notifySelection});
  const structure=createStructure(element,{changed,selectionChanged:notifySelection});
  const search=createSearch(element,{changed,selectionChanged:notifySelection});

  function html(){return editorHTML(element);}

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

  // Atalhos de Markdown no início da linha: "# " a "###### ", "> ", "- ", "* ",
  // "+ ", "1. " e "- [ ] ". Convertem assim que o espaço é digitado depois do
  // marcador, ou quando o marcador é digitado antes de um texto que já existe.
  // "\\# " mantém o marcador como texto.
  function markerMatch(text,before,source){
    return text.match(new RegExp("^"+source+"(?=\\S)"))||before.match(new RegExp("^"+source+"$"));
  }

  function applyTaskItemRule(block,range){
    if(block?.localName!=="li"||block.parentNode?.localName!=="ul"||block.querySelector("input"))return false;
    const text=block.textContent.replace(/\u00a0/g," "),caret=textCaretOffset(block,range);
    const task=markerMatch(text,text.slice(0,caret),"\\[([ xX])\\] ");
    if(!task)return false;
    const doc=element.ownerDocument,checkbox=doc.createElement("input");
    checkbox.type="checkbox";checkbox.checked=task[1].toLowerCase()==="x";
    const rest=doc.createTextNode(text.slice(task[0].length));
    block.replaceChildren(checkbox,rest);
    setCaret(rest,Math.max(0,caret-task[0].length));
    changed();notifySelection();return true;
  }

  function applyMarkdownBlockRule({allowTask=true}={}){
    const range=rangeInside(element);
    if(!range||!range.collapsed)return false;
    let block=currentTextBlock(element);
    if(!block){
      const item=elementAtRangeStart(element)?.closest?.("li");
      if(allowTask&&item&&element.contains(item))return applyTaskItemRule(item,range);
    }
    if(!block&&wrapRootLine(element,range))block=currentTextBlock(element);
    const current=rangeInside(element);
    // Também numa linha de título continuada pelo Enter: "## " ali troca o nível.
    if(!current||!block||!/^(p|div|h[1-6])$/.test(block.localName))return false;
    const text=block.textContent.replace(/\u00a0/g," ");
    const caret=textCaretOffset(block,current),before=text.slice(0,caret);
    const escaped=text.match(/^\\(#{1,6}|>|[-*+]|\d+\.) (?=\S)/);
    if(escaped){
      replaceBlockText(block,text.slice(1));setTextCaret(block,Math.max(0,caret-1));changed();notifySelection();return true;
    }
    const heading=markerMatch(text,before,"(#{1,6}) ");
    const quote=markerMatch(text,before,"> ");
    const task=allowTask&&markerMatch(text,before,"- \\[([ xX])\\] ");
    const bullet=markerMatch(text,before,"[-*+] ");
    const ordered=markerMatch(text,before,"(\\d+)\\. ");
    if(!heading&&!quote&&!task&&!bullet&&!ordered)return false;
    const doc=element.ownerDocument;
    const place=(node,target,prefix)=>{
      ensureCaretLine(target);
      block.replaceWith(node);
      if(target.textContent)setTextCaret(target,Math.max(0,caret-prefix));
      else setCaret(target,target.querySelector("input")?1:0);
      changed();notifySelection();return true;
    };
    if(heading){
      const node=doc.createElement("h"+heading[1].length),prefix=heading[0].length;
      node.textContent=text.slice(prefix);return place(node,node,prefix);
    }
    if(quote){
      const node=doc.createElement("blockquote"),prefix=quote[0].length;
      node.textContent=text.slice(prefix);return place(node,node,prefix);
    }
    const match=task||ordered||bullet,prefix=match[0].length,list=doc.createElement(ordered?"ol":"ul"),item=doc.createElement("li");
    if(task){
      const checkbox=doc.createElement("input");checkbox.type="checkbox";checkbox.checked=task[1].toLowerCase()==="x";
      item.append(checkbox);
      if(text.slice(prefix))item.append(doc.createTextNode(text.slice(prefix)));
    }else item.textContent=text.slice(prefix);
    if(ordered)list.start=Number(ordered[1]);
    list.append(item);
    return place(list,item,prefix);
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
    canUndo:()=>history.canUndo(),
    canRedo:()=>history.canRedo(),
    findLiteral:search.findLiteral,
    findNext:search.findNext,
    selectRange:search.selectRange,
    selectedText:search.selectedText,
    selectionEmpty:()=>Boolean(rangeInside(element)?.collapsed),
    selectionOffsets:()=>selectionTextOffsets(element),
    selectionMatches:search.selectionMatches,
    replaceSelection:search.replaceSelection,
    replaceAllLiteral:search.replaceAllLiteral,
    destroy:()=>{destroyed=true;credits?.disconnect();element.ownerDocument?.removeEventListener?.("selectionchange",remarkCredits);}
  };
}

if(typeof window!=="undefined")window.MDTXTRTEditorCore={createEditorCore};
