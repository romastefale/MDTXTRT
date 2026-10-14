// Biblioteca da versão estática: os rascunhos ficam só neste aparelho (localStorage).
// O documento aberto fica em DRAFT_KEY; os outros ficam arquivados em DRAFT_ARCHIVE_PREFIX + docId.
import { DRAFT_ARCHIVE_PREFIX, DRAFT_KEY, STATE_VERSION } from "./constants.js";
import { storageGet, storageKeys, storageRemove } from "./storage.js";

const ID=/^[a-f0-9-]{36}$/i;
const preview=html=>Array.from(String(html).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()).slice(0,280).join('');
function parse(raw){
  try{
    const d=JSON.parse(raw);
    if(d&&d.version===STATE_VERSION&&typeof d.html==='string'&&typeof d.name==='string'&&ID.test(String(d.docId)))return d;
  }catch{}
  return null;
}
export function listLocalDrafts(){
  const byDoc=new Map();
  const add=raw=>{
    const d=parse(raw);
    if(!d)return;
    const docId=d.docId.toLowerCase();
    const saved=Number.isFinite(d.savedAt)?d.savedAt:0;
    const previous=byDoc.get(docId);
    if(previous&&previous.updatedAt>=saved)return;
    byDoc.set(docId,{docId,name:d.name,dest:d.dest,revision:Number.isSafeInteger(d.revision)?d.revision:0,telegraphPath:'',preview:preview(d.html),createdAt:saved,updatedAt:saved,hasMedia:false});
  };
  const current=storageGet(DRAFT_KEY);
  if(current!==null)add(current);
  for(const key of storageKeys(DRAFT_ARCHIVE_PREFIX)){
    const raw=storageGet(key);
    if(raw!==null)add(raw);
  }
  return [...byDoc.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
}
// Texto bruto do rascunho guardado para este documento (o aberto ou um arquivado), ou null.
export function archivedDraftKey(docId){return DRAFT_ARCHIVE_PREFIX+String(docId).toLowerCase();}
export function readStoredDraft(docId){
  const current=storageGet(DRAFT_KEY);
  if(current!==null){
    const d=parse(current);
    if(d&&d.docId.toLowerCase()===String(docId).toLowerCase())return current;
  }
  return storageGet(archivedDraftKey(docId));
}
export function removeStoredDraft(docId){
  const current=storageGet(DRAFT_KEY);
  if(current!==null){
    const d=parse(current);
    if(d&&d.docId.toLowerCase()===String(docId).toLowerCase())storageRemove(DRAFT_KEY);
  }
  storageRemove(archivedDraftKey(docId));
}
