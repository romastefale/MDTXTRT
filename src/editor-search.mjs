import {rangeForTextOffsets,selectionTextOffsets} from "./editor-selection.mjs";

function folded(value){
  let text="",starts=[],ends=[];
  for(let i=0;i<value.length;){
    const cp=value.codePointAt(i),char=String.fromCodePoint(cp),fold=char.toLocaleLowerCase();
    for(let j=0;j<fold.length;j++){starts.push(i);ends.push(i+char.length);}
    text+=fold;i+=char.length;
  }
  return {text,starts,ends};
}

export function createSearch(root,{changed=()=>{},selectionChanged=()=>{}}={}){
  function sourceText(){return root.textContent||"";}
  function findLiteral(term){
    term=String(term||"");
    if(!term)return [];
    const source=sourceText(),hay=folded(source),needle=folded(term).text;
    if(!needle)return [];
    const found=[];
    let at=0;
    while((at=hay.text.indexOf(needle,at))!==-1){
      const from=hay.starts[at],to=hay.ends[at+needle.length-1];
      if(from!==undefined&&to!==undefined)found.push({from,to});
      at+=Math.max(1,needle.length);
    }
    return found;
  }
  function selectRange(item,{focus=false}={}){
    if(!item)return false;
    const range=rangeForTextOffsets(root,item.from,item.to),selection=root.ownerDocument.getSelection?.();
    if(!selection)return false;
    selection.removeAllRanges();selection.addRange(range);
    if(focus)root.focus({preventScroll:true});
    selectionChanged();
    return true;
  }
  function findNext(term){
    const all=findLiteral(term);
    if(!all.length)return null;
    const current=selectionTextOffsets(root)||{from:-1,to:-1};
    const next=all.find(item=>item.from>current.from||(current.from===current.to&&item.from===current.from&&item.to!==current.to))||all[0];
    selectRange(next);
    return next;
  }
  function selectedText(){
    const range=root.ownerDocument.getSelection?.()?.rangeCount?root.ownerDocument.getSelection().getRangeAt(0):null;
    return range&&root.contains(range.commonAncestorContainer)?range.toString():"";
  }
  function selectionMatches(term){return selectedText().toLocaleLowerCase()===String(term||"").toLocaleLowerCase();}
  function replaceSelection(text){
    const selection=root.ownerDocument.getSelection?.();
    if(!selection?.rangeCount)return false;
    const range=selection.getRangeAt(0);
    if(!root.contains(range.commonAncestorContainer))return false;
    range.deleteContents();
    const node=root.ownerDocument.createTextNode(String(text));
    range.insertNode(node);
    range.setStartAfter(node);range.collapse(true);
    selection.removeAllRanges();selection.addRange(range);
    changed();selectionChanged();
    return true;
  }
  function replaceAllLiteral(term,replacement){
    const all=findLiteral(term);
    if(!all.length)return 0;
    for(const item of [...all].reverse()){
      const range=rangeForTextOffsets(root,item.from,item.to);
      range.deleteContents();
      range.insertNode(root.ownerDocument.createTextNode(String(replacement)));
    }
    root.normalize();changed();selectionChanged();
    return all.length;
  }
  return {findLiteral,selectRange,findNext,selectedText,selectionMatches,replaceSelection,replaceAllLiteral};
}
