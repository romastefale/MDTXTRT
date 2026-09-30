export function rangeInside(root){
  const selection=root.ownerDocument.getSelection?.();
  if(!selection||selection.rangeCount===0)return null;
  const range=selection.getRangeAt(0);
  if(!root.contains(range.commonAncestorContainer))return null;
  return range;
}

function nodePath(root,node){
  const path=[];
  let current=node;
  while(current&&current!==root){
    const parent=current.parentNode;
    if(!parent)return null;
    path.push(Array.prototype.indexOf.call(parent.childNodes,current));
    current=parent;
  }
  return current===root?path.reverse():null;
}

function nodeAtPath(root,path){
  let node=root;
  for(const index of path||[]){
    if(!node?.childNodes||index<0||index>=node.childNodes.length)return null;
    node=node.childNodes[index];
  }
  return node;
}

function maxOffset(node){
  return node?.nodeType===3?node.data.length:node?.childNodes?.length||0;
}

export function saveSelection(root){
  const selection=root.ownerDocument.getSelection?.();
  if(!selection||selection.rangeCount===0||!root.contains(selection.anchorNode)||!root.contains(selection.focusNode))return null;
  const anchorPath=nodePath(root,selection.anchorNode),focusPath=nodePath(root,selection.focusNode);
  if(!anchorPath||!focusPath)return null;
  return {
    anchorPath,
    anchorOffset:selection.anchorOffset,
    focusPath,
    focusOffset:selection.focusOffset
  };
}

export function restoreSelection(root,saved,{focus=true}={}){
  if(!saved)return false;
  const anchor=nodeAtPath(root,saved.anchorPath),focusNode=nodeAtPath(root,saved.focusPath);
  if(!anchor||!focusNode)return false;
  const selection=root.ownerDocument.getSelection?.();
  if(!selection)return false;
  try{
    if(focus)root.focus({preventScroll:true});
    selection.setBaseAndExtent(
      anchor,Math.max(0,Math.min(saved.anchorOffset,maxOffset(anchor))),
      focusNode,Math.max(0,Math.min(saved.focusOffset,maxOffset(focusNode)))
    );
    return true;
  }catch{return false;}
}

export function setCaret(node,offset){
  const doc=node.ownerDocument,selection=doc.getSelection?.();
  if(!selection)return false;
  const range=doc.createRange();
  range.setStart(node,Math.max(0,Math.min(offset,maxOffset(node))));
  range.collapse(true);
  selection.removeAllRanges();selection.addRange(range);
  return true;
}

export function elementAtRangeStart(root,range=rangeInside(root)){
  if(!range)return null;
  let node=range.startContainer;
  if(node.nodeType===3)node=node.parentElement;
  else if(node.nodeType!==1)node=node.parentElement;
  return node&&root.contains(node)?node:null;
}

export function closestWithin(root,selector,range=rangeInside(root)){
  const element=elementAtRangeStart(root,range);
  const found=element?.closest?.(selector)||null;
  return found&&root.contains(found)?found:null;
}

export function selectNodeContents(root,node){
  if(!node||!root.contains(node))return false;
  const selection=root.ownerDocument.getSelection?.();
  if(!selection)return false;
  const range=root.ownerDocument.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();selection.addRange(range);
  return true;
}

export function selectNode(root,node){
  if(!node||!root.contains(node))return false;
  const selection=root.ownerDocument.getSelection?.();
  if(!selection)return false;
  const range=root.ownerDocument.createRange();
  range.selectNode(node);
  selection.removeAllRanges();selection.addRange(range);
  return true;
}

export function textRanges(root){
  const doc=root.ownerDocument,walker=doc.createTreeWalker(root,doc.defaultView.NodeFilter.SHOW_TEXT);
  const rows=[];
  let node,offset=0;
  while((node=walker.nextNode())){
    const start=offset;
    offset+=node.data.length;
    rows.push({node,start,end:offset});
  }
  return {rows,length:offset};
}

export function rangeForTextOffsets(root,from,to){
  const {rows,length}=textRanges(root);
  const start=Math.max(0,Math.min(from,length)),end=Math.max(start,Math.min(to,length));
  const locate=(pos,preferEnd=false)=>{
    if(!rows.length)return {node:root,offset:0};
    const row=rows.find(item=>pos<item.end||(!preferEnd&&pos===item.start))||rows.at(-1);
    return {node:row.node,offset:Math.max(0,Math.min(pos-row.start,row.node.data.length))};
  };
  const a=locate(start),b=locate(end,true);
  const range=root.ownerDocument.createRange();
  range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);
  return range;
}

export function selectionTextOffsets(root){
  const range=rangeInside(root);
  if(!range)return null;
  const pre=root.ownerDocument.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer,range.startOffset);
  const from=pre.toString().length;
  return {from,to:from+range.toString().length};
}
