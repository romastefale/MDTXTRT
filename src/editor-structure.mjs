import {rangeInside,closestWithin,elementAtRangeStart,setCaret,selectNode} from "./editor-selection.mjs";

const BLOCK_SELECTOR="p,h1,h2,h3,h4,h5,h6,blockquote,aside,footer,pre,li,table,figure,details,hr,tg-map,tg-collage,tg-slideshow,tg-math-block,tg-button-row";

function topBlock(root,node){
  let current=node?.nodeType===1?node:node?.parentElement;
  while(current&&current.parentElement!==root)current=current.parentElement;
  return current&&current.parentElement===root?current:null;
}

function currentBlock(root){
  const range=rangeInside(root);
  const element=elementAtRangeStart(root,range);
  return element?.closest?.(BLOCK_SELECTOR)||null;
}

function notify(root,changed,selectionChanged){
  root.normalize();
  changed();
  selectionChanged();
}

function editableRange(root){
  const existing=rangeInside(root);
  if(existing)return existing;
  root.focus({preventScroll:true});
  const range=root.ownerDocument.createRange(),selection=root.ownerDocument.getSelection?.();
  range.selectNodeContents(root);range.collapse(false);
  selection?.removeAllRanges();selection?.addRange(range);
  return range;
}

export function createStructure(root,{changed=()=>{},selectionChanged=()=>{}}={}){
  function currentBlockKind(){
    const block=currentBlock(root);
    if(!block)return "p";
    const tag=block.localName;
    if(/^h[1-6]$/.test(tag))return tag;
    if(tag==="footer"||block.classList?.contains("tg-footer"))return "footer";
    if(tag==="blockquote")return block.hasAttribute("expandable")?"expandquote":"blockquote";
    if(tag==="aside")return "pullquote";
    if(tag==="pre")return "pre";
    return tag==="p"?"p":tag;
  }

  function inBlock(kind){
    const element=elementAtRangeStart(root);
    if(!element)return false;
    if(kind==="li")return Boolean(element.closest("li"));
    if(kind==="blockquote")return Boolean(element.closest("blockquote"));
    if(kind==="aside")return Boolean(element.closest("aside"));
    return false;
  }

  function formatBlock(kind){
    const block=currentBlock(root);
    if(!block||["li","table","figure","details"].includes(block.localName))return false;
    const current=currentBlockKind();
    const target=current===kind?"p":kind;
    let tag=target,attrs={};
    if(target==="expandquote"){tag="blockquote";attrs.expandable="";}
    else if(target==="pullquote")tag="aside";
    else if(target==="footer")tag="footer";
    else if(!/^(?:p|h[1-6]|blockquote|aside|footer|pre)$/.test(target))tag="p";
    const replacement=root.ownerDocument.createElement(tag);
    for(const [name,value] of Object.entries(attrs))replacement.setAttribute(name,value);
    while(block.firstChild)replacement.append(block.firstChild);
    block.replaceWith(replacement);
    setCaret(replacement,replacement.childNodes.length);
    notify(root,changed,selectionChanged);
    return true;
  }

  function toggleList(kind="ul"){
    const block=currentBlock(root);
    if(!block)return false;
    const list=block.closest?.("ul,ol");
    if(list){
      const item=block.closest("li");
      if(!item)return false;
      const p=root.ownerDocument.createElement("p");
      while(item.firstChild)p.append(item.firstChild);
      list.parentNode.insertBefore(p,list.nextSibling);
      item.remove();
      if(!list.querySelector("li"))list.remove();
      setCaret(p,p.childNodes.length);
      notify(root,changed,selectionChanged);
      return true;
    }
    const container=root.ownerDocument.createElement(kind==="ol"?"ol":"ul");
    const item=root.ownerDocument.createElement("li");
    if(block.localName==="p"){
      while(block.firstChild)item.append(block.firstChild);
      block.replaceWith(container);
    }else{
      item.append(block.cloneNode(true));
      block.replaceWith(container);
    }
    container.append(item);
    setCaret(item,item.childNodes.length);
    notify(root,changed,selectionChanged);
    return true;
  }

  function insertHTML(html,asBlock=false){
    const range=editableRange(root);
    const template=root.ownerDocument.createElement("template");
    template.innerHTML=String(html||"");
    const fragment=template.content;
    if(!fragment.childNodes.length)return false;
    range.deleteContents();
    if(asBlock){
      const anchor=topBlock(root,range.startContainer)||topBlock(root,elementAtRangeStart(root,range));
      const nodes=[...fragment.childNodes];
      if(anchor){
        const next=anchor.nextElementSibling;
        const ref=anchor.nextSibling;
        for(const node of nodes)root.insertBefore(node,ref);
        if(next)setCaret(next,0);
        else{
          const caret=root.ownerDocument.createElement("p");caret.append(root.ownerDocument.createElement("br"));
          root.append(caret);setCaret(caret,0);
        }
      }else{
        root.append(fragment);
        const caret=root.ownerDocument.createElement("p");caret.append(root.ownerDocument.createElement("br"));
        root.append(caret);setCaret(caret,0);
      }
    }else{
      const last=fragment.lastChild;
      range.insertNode(fragment);
      if(last){
        const selection=root.ownerDocument.getSelection?.(),next=root.ownerDocument.createRange();
        next.setStartAfter(last);next.collapse(true);selection?.removeAllRanges();selection?.addRange(next);
      }
    }
    notify(root,changed,selectionChanged);
    return true;
  }

  function insertText(text){
    const range=editableRange(root);
    range.deleteContents();
    const parts=String(text).split(/\r\n|\r|\n/);
    const fragment=root.ownerDocument.createDocumentFragment();
    let last=null;
    parts.forEach((part,index)=>{
      if(index){last=root.ownerDocument.createElement("br");fragment.append(last);}
      if(part){last=root.ownerDocument.createTextNode(part);fragment.append(last);}
    });
    if(!last)return true;
    range.insertNode(fragment);
    if(last.nodeType===3)setCaret(last,last.data.length);
    else setCaret(last.parentNode,Array.prototype.indexOf.call(last.parentNode.childNodes,last)+1);
    notify(root,changed,selectionChanged);
    return true;
  }

  function table(){
    return closestWithin(root,"table");
  }
  function cell(){
    return closestWithin(root,"td,th");
  }
  function columnCount(row){
    return [...row.cells].reduce((sum,item)=>sum+Math.max(1,Number(item.getAttribute("colspan")||1)||1),0);
  }
  function addTableColumn(){
    const active=table();if(!active)return false;
    const rows=[...active.rows];if(!rows.length)return false;
    const max=Math.max(...rows.map(columnCount));
    if(max>=20)throw new Error("O Telegram aceita no máximo 20 colunas por tabela");
    const current=cell(),index=current?current.cellIndex+1:max;
    for(const row of rows){
      const reference=row.cells[index]||null;
      const tag=row.parentElement?.localName==="thead"?"th":"td";
      row.insertBefore(root.ownerDocument.createElement(tag),reference);
    }
    notify(root,changed,selectionChanged);return true;
  }
  function removeTableColumn(){
    const active=table(),current=cell();if(!active||!current)return false;
    const index=current.cellIndex;
    for(const row of [...active.rows])row.cells[index]?.remove();
    if([...active.rows].every(row=>row.cells.length===0))active.remove();
    notify(root,changed,selectionChanged);return true;
  }
  function addTableRow(){
    const active=table();if(!active)return false;
    const current=closestWithin(root,"tr"),columns=Math.max(1,...[...active.rows].map(columnCount));
    const row=root.ownerDocument.createElement("tr");
    for(let i=0;i<columns;i++)row.append(root.ownerDocument.createElement("td"));
    const section=current?.parentElement||active.tBodies[0]||active;
    if(current&&current.parentElement===section)section.insertBefore(row,current.nextSibling);else section.append(row);
    notify(root,changed,selectionChanged);return true;
  }
  function removeTableRow(){
    const active=table(),row=closestWithin(root,"tr");if(!active||!row)return false;
    row.remove();
    if(!active.rows.length)active.remove();
    notify(root,changed,selectionChanged);return true;
  }
  function deleteTable(){
    const active=table();if(!active)return false;
    const next=active.nextSibling||active.previousSibling;
    active.remove();
    if(next?.nodeType===1)setCaret(next,next.childNodes.length);
    notify(root,changed,selectionChanged);return true;
  }
  function selectTable(){
    const active=table();return active?selectNode(root,active):false;
  }

  function insertParagraph(){
    const range=rangeInside(root);
    if(!range||!range.collapsed)return false;
    const block=currentBlock(root);
    if(!block||!["blockquote","aside"].includes(block.localName)&&!/h[1-6]/.test(block.localName))return false;
    const empty=!block.textContent.replace(/\u200b/g,"").trim();
    if(empty){
      const p=root.ownerDocument.createElement("p");p.append(root.ownerDocument.createElement("br"));
      block.replaceWith(p);setCaret(p,0);
      notify(root,changed,selectionChanged);
      return true;
    }
    const clone=block.cloneNode(false);
    if(block.hasAttribute("expandable"))clone.setAttribute("expandable","");
    const tail=root.ownerDocument.createRange();
    tail.setStart(range.startContainer,range.startOffset);
    tail.setEnd(block,block.childNodes.length);
    const rest=tail.extractContents();
    if(rest.childNodes.length)clone.append(rest);else clone.append(root.ownerDocument.createElement("br"));
    block.parentNode.insertBefore(clone,block.nextSibling);
    setCaret(clone,0);
    notify(root,changed,selectionChanged);
    return true;
  }

  function exitFormattedBlock(){
    const range=rangeInside(root);
    if(!range||!range.collapsed)return false;
    const block=currentBlock(root);
    if(!block||!["blockquote","aside"].includes(block.localName)&&!/h[1-6]/.test(block.localName))return false;
    if(range.startOffset!==block.childNodes.length&&range.startContainer===block)return false;
    const p=root.ownerDocument.createElement("p");p.append(root.ownerDocument.createElement("br"));
    block.parentNode.insertBefore(p,block.nextSibling);setCaret(p,0);
    notify(root,changed,selectionChanged);return true;
  }

  function normalizeEmptyFormattedBlock(inputType=""){
    if(!String(inputType).startsWith("delete"))return false;
    const block=currentBlock(root);
    if(!block||block.textContent.replace(/\u200b/g,"").trim())return false;
    if(!["blockquote","aside"].includes(block.localName)&&!/h[1-6]/.test(block.localName))return false;
    const p=root.ownerDocument.createElement("p");p.append(root.ownerDocument.createElement("br"));
    block.replaceWith(p);setCaret(p,0);
    notify(root,changed,selectionChanged);return true;
  }

  return {
    currentBlockKind,inBlock,formatBlock,toggleList,insertHTML,insertText,
    addTableColumn,removeTableColumn,addTableRow,removeTableRow,deleteTable,selectTable,
    insertParagraph,exitFormattedBlock,normalizeEmptyFormattedBlock
  };
}
