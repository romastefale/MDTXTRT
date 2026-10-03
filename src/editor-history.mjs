import {saveSelection,restoreSelection} from "./editor-selection.mjs";

export function createHistory(root,{depth=120,serialize=node=>node.innerHTML,onRestore=()=>{}}={}){
  const stack=[];
  let index=-1,restoring=false;

  function snapshot(){
    return {html:serialize(root),selection:saveSelection(root)};
  }
  function same(a,b){
    return Boolean(a&&b&&a.html===b.html);
  }
  function commit(){
    if(restoring)return false;
    const next=snapshot(),current=stack[index];
    if(same(current,next)){
      if(current)current.selection=next.selection;
      return false;
    }
    stack.splice(index+1);
    stack.push(next);
    if(stack.length>depth)stack.shift();
    index=stack.length-1;
    return true;
  }
  function restore(target){
    const item=stack[target];
    if(!item)return false;
    restoring=true;
    root.innerHTML=item.html;
    index=target;
    restoreSelection(root,item.selection,{focus:true});
    restoring=false;
    onRestore(item);
    return true;
  }
  function rememberSelection(){
    if(restoring||index<0)return false;
    stack[index].selection=saveSelection(root);
    return true;
  }
  function reset(){
    stack.length=0;index=-1;commit();
  }
  function undo(){
    if(index<=0)return false;
    return restore(index-1);
  }
  function redo(){
    if(index<0||index>=stack.length-1)return false;
    return restore(index+1);
  }

  reset();
  return {commit,rememberSelection,reset,undo,redo,canUndo:()=>index>0,canRedo:()=>index>=0&&index<stack.length-1,get restoring(){return restoring;}};
}
