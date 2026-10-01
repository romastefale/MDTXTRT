// Mídias anexadas: IndexedDB, restauração e limites de upload.
import { S } from "./state.js";
import { DB_NAME, DB_STORE } from "./constants.js";
import { editor } from "./dom.js";
import { activeMedia } from "./draft.js";
import { showToast } from "./panels.js";
import { requireEditorCore } from "./editing.js";

export function mediaDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('Este navegador não oferece armazenamento persistente para anexos'));return;}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DB_STORE))req.result.createObjectStore(DB_STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Não foi possível abrir o armazenamento de anexos'));
  });
}
export async function mediaStore(value){
  const db=await mediaDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(value);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Não foi possível salvar o anexo'));tx.onabort=tx.onerror;
  });
  db.close();
}
export async function mediaLoad(id){
  const db=await mediaDB();
  const value=await new Promise((resolve,reject)=>{
    const req=db.transaction(DB_STORE,'readonly').objectStore(DB_STORE).get(id);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('Não foi possível recuperar o anexo'));
  });
  db.close();return value;
}
export async function mediaClear(){
  const db=await mediaDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).clear();
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Não foi possível limpar os anexos'));tx.onabort=tx.onerror;
  });
  db.close();
}
export async function mediaDelete(id){
  if(!id)return;
  const db=await mediaDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Não foi possível remover o anexo'));tx.onabort=tx.onerror;
  });
  db.close();
}
export function mediaNode(id){return [...editor.querySelectorAll('[data-media-id]')].find(node=>node.getAttribute('data-media-id')===id)||null;}
export function clearRuntimeMedia(){
  for(const media of S.mediaFiles.values())if(media.url)URL.revokeObjectURL(media.url);
  S.mediaFiles.clear();
  S.remoteMediaSyncedIds.clear();
}
export function restoreActiveMediaVisual(){
  let restored=false;
  for(const media of activeMedia()){
    if(!media.url)continue;
    restored=requireEditorCore().patchMedia(media.id,{src:media.url,'data-media-missing':''})||restored;
  }
  return restored;
}
export async function restoreMedia(){
  const nodes=[...editor.querySelectorAll('[data-media-id]')];
  for(const node of nodes){
    const id=node.getAttribute('data-media-id')||'';
    try{
      const saved=await mediaLoad(id);
      if(!saved||saved.id!==id||!['image','video','audio','voice','document'].includes(saved.kind)||typeof saved.name!=='string'||!saved.name||typeof saved.type!=='string'||!saved.type||!(saved.file instanceof Blob))throw new Error('Anexo persistido incompatível');
      const prior=S.mediaFiles.get(id);if(prior?.url)URL.revokeObjectURL(prior.url);
      const file=saved.file instanceof File?saved.file:new File([saved.file],saved.name,{type:saved.type,lastModified:Number.isFinite(saved.lastModified)?saved.lastModified:0});
      S.mediaFiles.set(id,{file,id,kind:saved.kind,url:URL.createObjectURL(file)});
    }catch(err){
      try{await mediaDelete(id);}catch(cleanupError){console.error('Media cleanup',cleanupError);}
      requireEditorCore().patchMedia(id,{src:'','data-media-missing':'true'});
      showToast(err.message||'Não foi possível recuperar o anexo');
    }
  }
  restoreActiveMediaVisual();decorateSpecials();
}
export async function installMedia(file,id,kind){
  const prior=S.mediaFiles.get(id);if(prior?.url)URL.revokeObjectURL(prior.url);
  S.mediaFiles.set(id,{file,id,kind,url:URL.createObjectURL(file)});
  await mediaStore({id,file,kind,name:file.name,type:file.type,lastModified:file.lastModified});
  const node=mediaNode(id);
  if(!node)throw new Error('Anexo não encontrado no documento');
  restoreActiveMediaVisual();
  decorateSpecials();
}
export function telegramUploadLimit(kind){
  return kind==='image'?10_000_000:50_000_000;
}
export function decorateSpecials(){
  requireEditorCore();
  for(const media of editor.querySelectorAll('video,audio'))media.controls=true;
}
