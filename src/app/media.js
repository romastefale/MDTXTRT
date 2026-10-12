import { S } from "./state.js";
import { editor } from "./dom.js";

// Mídia local = referência a uma mídia que o usuário enviou ao bot (file_id guardado no banco).
// O Mini App não guarda bytes: só {id, kind}.
export function mediaNode(id){return [...editor.querySelectorAll('[data-media-id]')].find(node=>node.getAttribute('data-media-id')===id)||null;}
export function clearRuntimeMedia(){
  S.mediaFiles.clear();
}
export function setMediaRefs(list){
  S.mediaFiles.clear();
  for(const item of Array.isArray(list)?list:[]){
    if(item&&/^[A-Za-z0-9_-]{1,64}$/.test(String(item.id||''))&&['image','video','audio','voice','document'].includes(item.kind))S.mediaFiles.set(item.id,{id:item.id,kind:item.kind});
  }
}
export function decorateSpecials(){
  for(const media of editor.querySelectorAll('video,audio'))media.controls=true;
}
