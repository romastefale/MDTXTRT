
import { S } from "./state.js";
import { API, BROWSER_OWNER_KEY, DRAFT_ARCHIVE_PREFIX, DRAFT_KEY, NEW_DOCUMENT_PARAM, STATE_VERSION } from "./constants.js";
import { docName, editor } from "./dom.js";
import { getTg } from "./theme.js";
import { clearRuntimeMedia, decorateSpecials, installMedia } from "./media.js";
import { showToast } from "./panels.js";
import { approve, chooseDialog } from "./dialog.js";
import { requireEditorCore, syncEditorSelectionUI } from "./editing.js";
import { readResponse, setDestination } from "./publish.js";
import { storageBlocked, storageGet, storageSet } from "./storage.js";

const activeRemoteDraftSaves=new Set();

export function normalizedRevision(value){return Number.isSafeInteger(value)&&value>=0?value:0;}
export function advanceDocumentGeneration(){
  if(!Number.isSafeInteger(S.docGeneration)||S.docGeneration>=Number.MAX_SAFE_INTEGER)throw new Error('O documento excedeu o limite de gerações desta sessão');
  S.docGeneration++;
  return S.docGeneration;
}
function currentDocumentGeneration(generation,doc){
  return S.docGeneration===generation&&S.docId===doc;
}
export async function waitForRemoteDraftSaves(doc=''){
  await S.remoteSaveQueue;
  while(true){
    const pending=[...activeRemoteDraftSaves].filter(save=>!doc||save.doc===doc).map(save=>save.promise);
    if(!pending.length)return;
    await Promise.allSettled(pending);
  }
}
export function bumpDocumentRevision(){
  if(S.docRevision>=Number.MAX_SAFE_INTEGER)throw new Error('O documento excedeu o limite de revisões desta sessão');
  S.docRevision++;
}
export function requestMatchesDocument(doc,revision){return S.docId===doc&&S.docRevision===revision;}
export function browserOwnerKey(){
  let key='';
  try{key=storageGet(BROWSER_OWNER_KEY)||'';}
  catch{throw new Error('Não foi possível acessar a identidade persistente do navegador');}
  if(/^[a-f0-9]{64}$/.test(key))return key;
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  key=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  try{
    storageSet(BROWSER_OWNER_KEY,key);
    if(storageGet(BROWSER_OWNER_KEY)!==key)throw new Error('A identidade não permaneceu armazenada');
  }catch{throw new Error('Não foi possível persistir a identidade do navegador');}
  return key;
}
export function sanitizeDraftRuntimeDOM(box){
  for(const el of [...box.querySelectorAll('*')]){
    for(const name of ['contenteditable','draggable','spellcheck','tabindex','aria-selected'])el.removeAttribute(name);
    if(['video','audio'].includes(el.localName))el.removeAttribute('controls');
  }
  return box;
}
export function draftHTML(){
  const box=document.createElement('div');
  box.innerHTML=requireEditorCore().html();
  sanitizeDraftRuntimeDOM(box);
  box.querySelectorAll('[data-media-id]').forEach(node=>{if(/^blob:/i.test(node.getAttribute('src')||''))node.removeAttribute('src');});
  return box.innerHTML;
}
export function activeMedia(){
  const result=[];
  for(const node of editor.querySelectorAll('[data-media-id]')){
    const id=node.getAttribute('data-media-id')||'';
    const media=S.mediaFiles.get(id);
    if(media)result.push(media);
  }
  return result;
}
export function draftState(action=''){
  const active=activeMedia();
  const state={version:STATE_VERSION,name:docName.value,html:draftHTML(),dest:S.dest,telegraphPath:S.telegraphPath,docId:S.docId,revision:S.docRevision,importedMd:S.importedMd,importedTxt:S.importedTxt,importedHtml:S.importedHtml,media:active.map(item=>({id:item.id,kind:item.kind}))};
  if(action)state.action=action;
  return state;
}
export function cleanDraftHTML(html){
  if(typeof html!=='string')throw new Error('Rascunho inválido');
  const box=document.createElement('div');box.innerHTML=html;
  sanitizeDraftRuntimeDOM(box);
  const allowed=new Set('a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div'.split(' '));
  const attrs=new Set('href name class style src alt tg-spoiler start type reversed value checked disabled controls expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats data-media-id data-media-missing'.split(' '));
  const localMedia=[...box.querySelectorAll('[data-media-id]')];
  if(localMedia.length>50)throw new Error('O Telegram aceita no máximo 50 mídias por mensagem');
  if(new Set(localMedia.map(node=>node.getAttribute('data-media-id'))).size!==localMedia.length)throw new Error('O rascunho contém identificadores de mídia duplicados');
  for(const el of [...box.querySelectorAll('*')]){
    if(!allowed.has(el.localName))throw new Error('O rascunho contém um elemento não suportado');
    for(const a of [...el.attributes]){
      if(!attrs.has(a.name))throw new Error('O rascunho contém um atributo não suportado');
      if(a.name==='class'&&!(/^language-[a-z0-9+-]+$/i.test(a.value)||a.value==='tg-footer'))throw new Error('O rascunho contém uma classe não suportada');
      if(a.name==='style'&&!(el.localName==='tg-button'&&['link','primary','success','danger'].includes(a.value)))throw new Error('O rascunho contém um estilo não suportado');
      if(a.name==='data-media-id'&&!/^[A-Za-z0-9_-]{1,64}$/.test(a.value))throw new Error('O rascunho contém um identificador de mídia inválido');
      if(['href','src','url'].includes(a.name)&&a.value){
        if(a.name==='href'&&a.value.startsWith('#'))continue;
        let u;try{u=new URL(a.value,location.href);}catch{throw new Error('O rascunho contém um link inválido');}
        if(!['http:','https:','tg:','mailto:','tel:'].includes(u.protocol))throw new Error('O rascunho contém um link inválido');
      }
    }
  }
  return box.innerHTML;
}
export function markDirty(){
  S.exportOverride=null;
  bumpDocumentRevision();
  decorateSpecials();
  clearTimeout(S.saveTimer);
  const generation=S.docGeneration,doc=S.docId;
  S.saveTimer=setTimeout(()=>{
    if(currentDocumentGeneration(generation,doc))saveLocal();
  },400);
}


export function pristineAfterDelete(){
  if(!S.blankAfterDelete||S.blankAfterDelete!==S.docId)return false;
  const empty=!editor.textContent.trim()&&!editor.querySelector('[data-media-id],img,video,audio,iframe,hr,table,input,tg-map,tg-math-block,tg-button-row');
  if(empty&&docName.value==='Ideia'&&!S.importedMd&&!S.importedTxt&&!S.importedHtml)return true;
  S.blankAfterDelete='';
  return false;
}
export function saveLocal(){
  clearTimeout(S.saveTimer);
  if(pristineAfterDelete()){clearTimeout(S.remoteSaveTimer);return true;}
  if(S.draftWriteBlocked){
    if(!S.draftBlockNoticeShown){S.draftBlockNoticeShown=true;showToast('O rascunho recuperável foi preservado; alterações desta sessão não substituirão essa cópia');}
    return false;
  }
  try{
    storageSet(DRAFT_KEY,JSON.stringify(draftState()));
    scheduleRemoteDraftSave();
    return true;
  }catch{
    showToast('Não foi possível salvar neste dispositivo');
    scheduleRemoteDraftSave();
    return false;
  }
}
export function remoteDraftIdentity(){
  const initData=getTg()?.initData;
  if(typeof initData==='string'&&initData)return {initData};
  return {browserKey:browserOwnerKey()};
}
export function appendRemoteIdentity(target,identity=remoteDraftIdentity()){
  for(const [key,value] of Object.entries(identity))target.set(key,value);
  return identity;
}
export function reportRemoteSaveFailure(error){
  console.error('Persistent draft',error);
  if(!S.remoteSaveNoticeShown){
    S.remoteSaveNoticeShown=true;
    showToast('A cópia no servidor não pôde ser atualizada; o rascunho local foi mantido');
  }
}
export async function persistRemoteDraft(pagehide=false,generation=S.docGeneration,doc=S.docId){
  if(!currentDocumentGeneration(generation,doc))return false;
  if(S.draftWriteBlocked||!remoteDraftsAvailable())return false;
  
  if(S.deletingDoc&&S.deletingDoc===S.docId)return false;
  if(pristineAfterDelete())return false;
  const snapshot=draftState();
  const form=new FormData();
  appendRemoteIdentity(form);
  form.set('draft',JSON.stringify(snapshot));
  const active=activeMedia();
  const pending=active.filter(media=>!S.remoteMediaSyncedIds.has(media.id));
  for(const media of pending)form.set('upload_'+media.id,media.file,media.file.name);
  const options={method:'POST',body:form};
  if(!pagehide)options.signal=AbortSignal.timeout(60000);
  else if(!pending.length&&JSON.stringify(snapshot).length<60000)options.keepalive=true;
  const save=(async()=>{
    const res=await fetch(API+'/api/drafts/save',options);
    const data=await readResponse(res);
    if(!currentDocumentGeneration(generation,doc))return false;
    if(!res.ok)throw new Error(data.error||'Não foi possível salvar o rascunho no servidor');
    if(data?.draft?.docId!==snapshot.docId||data?.draft?.revision!==snapshot.revision)throw new Error('Confirmação de persistência inválida');
    S.remoteMediaSyncedIds=new Set(active.map(media=>media.id));
    S.remoteSaveNoticeShown=false;
    return true;
  })();
  const pendingSave={doc,promise:save};
  activeRemoteDraftSaves.add(pendingSave);
  try{return await save;}
  finally{activeRemoteDraftSaves.delete(pendingSave);}
}


export function remoteDraftsAvailable(){
  const initData=getTg()?.initData;
  return Boolean(typeof initData==='string'&&initData)||!storageBlocked();
}
export function scheduleRemoteDraftSave(delay=650){
  clearTimeout(S.remoteSaveTimer);
  if(!remoteDraftsAvailable())return;
  const generation=S.docGeneration,doc=S.docId;
  S.remoteSaveTimer=setTimeout(()=>{
    S.remoteSaveQueue=S.remoteSaveQueue.then(()=>persistRemoteDraft(false,generation,doc)).catch(error=>{reportRemoteSaveFailure(error);});
  },delay);
}
export async function applyPersistentDraftData(data,identity,generation=S.docGeneration){
  S.exportOverride=null;
  const d=data.draft;
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||d.name.length>256||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string'||!Array.isArray(d.media))throw new Error('Rascunho persistido incompatível');
  const html=cleanDraftHTML(d.html);
  clearRuntimeMedia();
  requireEditorCore().resetHTML(html,{silent:true});
  docName.value=d.name;
  S.telegraphPath=d.telegraphPath;
  S.docId=d.docId;
  S.docRevision=normalizedRevision(d.revision);
  S.importedMd=d.importedMd;
  S.importedTxt=d.importedTxt;
  S.importedHtml=d.importedHtml;
  S.dest=d.dest;
  S.activeHandoff='';S.handoffAction=null;
  S.draftWriteBlocked=false;
  const media=Array.isArray(data.media)?data.media:[];
  if(media.length!==d.media.length)throw new Error('Anexos persistidos incompatíveis');
  for(const meta of media){
    const expected=d.media.find(item=>item.id===meta.id&&item.kind===meta.kind);
    if(!expected||typeof meta.name!=='string'||typeof meta.mime!=='string')throw new Error('Anexo persistido incompatível');
    const fileRes=await fetch(API+'/api/drafts/file',{
      method:'POST',
      signal:AbortSignal.timeout(60000),
      headers:{'content-type':'application/json'},
      body:JSON.stringify({...identity,doc:d.docId,id:meta.id})
    });
    if(!currentDocumentGeneration(generation,d.docId))return false;
    if(!fileRes.ok){
      let msg='Não foi possível recuperar o anexo persistido';
      try{msg=(await fileRes.json()).error||msg;}catch{}
      throw new Error(msg);
    }
    const blob=await fileRes.blob();
    if(!currentDocumentGeneration(generation,d.docId))return false;
    const file=new File([blob],meta.name,{type:meta.mime,lastModified:0});
    await installMedia(file,meta.id,meta.kind);
    if(!currentDocumentGeneration(generation,d.docId))return false;
    S.remoteMediaSyncedIds.add(meta.id);
  }
  setDestination(S.dest,false,false);
  syncEditorSelectionUI();
  try{storageSet(DRAFT_KEY,JSON.stringify({...d,html}));}catch(error){console.error('Local draft cache',error);}
  return true;
}
export async function loadRemoteDraft(doc=''){
  const generation=advanceDocumentGeneration();
  const identity=remoteDraftIdentity();
  const res=await fetch(API+'/api/drafts/load',{
    method:'POST',
    signal:AbortSignal.timeout(5000),
    headers:{'content-type':'application/json'},
    body:JSON.stringify({...identity,...(doc?{doc}:{})})
  });
  if(res.status===404)return false;
  const data=await readResponse(res);
  if(!currentDocumentGeneration(generation,S.docId))return false;
  if(!res.ok)throw new Error(data.error||'Não foi possível recuperar o rascunho do servidor');
  return applyPersistentDraftData(data,identity,generation);
}
export async function createNewDocumentLaunch(){
  
  
  if(storageBlocked()&&S.session!=='ready'){
    const empty=!editor.textContent.trim()&&!editor.querySelector('[data-media-id],img,video,audio,iframe,hr');
    if(!empty&&!await approve('Este navegador está bloqueando o armazenamento, então o texto atual não pode ser guardado. Começar um rascunho novo mesmo assim?'))return;
    resetToNewDocument();
    S.draftRecoveryPending=false;
    editor.setAttribute('contenteditable','true');
    setDestination(S.dest,false,false);
    syncEditorSelectionUI();
    showToast('Novo documento criado.');
    return;
  }
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  const token=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  const url=new URL(location.href);
  url.searchParams.set(NEW_DOCUMENT_PARAM,token);
  url.searchParams.delete('view');
  location.assign(url.href);
}
export function newDocumentToken(){
  let token='';
  try{token=new URL(location.href).searchParams.get(NEW_DOCUMENT_PARAM)||'';}catch{}
  return /^[a-f0-9]{32}$/i.test(token)?token.toLowerCase():'';
}
export function consumeNewDocumentToken(){
  const token=newDocumentToken();
  if(!token)return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete(NEW_DOCUMENT_PARAM);
    history.replaceState(history.state,'',url.href);
  }catch{}
  return token;
}
export function archiveStoredDraftForNew(token){
  let raw;
  try{raw=storageGet(DRAFT_KEY);}
  catch{throw new Error('Não foi possível acessar o documento anterior; nenhum novo documento foi criado');}
  if(raw===null)return false;
  let suffix='unreadable-'+token;
  try{
    const parsed=JSON.parse(raw);
    if(parsed&&/^[a-f0-9-]{36}$/i.test(String(parsed.docId||'')))suffix=String(parsed.docId).toLowerCase();
  }catch{}
  const key=DRAFT_ARCHIVE_PREFIX+suffix;
  try{
    storageSet(key,raw);
    if(storageGet(key)!==raw)throw new Error('readback');
  }catch{throw new Error('Não foi possível preservar o documento anterior; nenhum novo documento foi criado');}
  return true;
}
export function resetToNewDocument(){
  advanceDocumentGeneration();
  S.exportOverride=null;
  clearRuntimeMedia();
  S.mediaChoice=null;S.savedRange=null;S.activeHandoff='';S.handoffAction=null;
  requireEditorCore().resetHTML('',{silent:true});docName.value='Ideia';S.dest='telegram';S.telegraphPath='';
  S.docId=crypto.randomUUID();S.docRevision=0;S.importedMd='';S.importedTxt='';S.importedHtml='';
  S.draftWriteBlocked=false;S.draftBlockNoticeShown=false;
}
export function startRequestedNewDocument(token){
  if(!token)return false;
  const preserved=archiveStoredDraftForNew(token);
  resetToNewDocument();
  return preserved;
}
export function loadLocal(){
  let raw;
  try{raw=storageGet(DRAFT_KEY);}
  catch{S.draftWriteBlocked=true;throw new Error('Não foi possível acessar o rascunho local; nenhuma cópia foi alterada');}
  if(raw===null)return false;
  let d;
  try{d=JSON.parse(raw);}
  catch{S.draftWriteBlocked=true;throw new Error('Rascunho local inválido preservado para recuperação');}
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||d.name.length>256||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string'){
    S.draftWriteBlocked=true;
    throw new Error('Rascunho local incompatível preservado para recuperação');
  }
  let html;
  try{html=cleanDraftHTML(d.html);}
  catch(error){S.draftWriteBlocked=true;throw new Error((error.message||'Rascunho local inválido')+'. A cópia local foi preservada para recuperação');}
  advanceDocumentGeneration();
  requireEditorCore().resetHTML(html,{silent:true});docName.value=d.name;S.telegraphPath=d.telegraphPath;S.docId=d.docId;S.docRevision=normalizedRevision(d.revision);S.importedMd=d.importedMd;S.importedTxt=d.importedTxt;S.importedHtml=d.importedHtml;S.dest=d.dest;
  S.draftWriteBlocked=false;
  return true;
}
export async function recoverPersistentDraft(){
  try{
    const loaded=await loadRemoteDraft();
    S.draftRecoveryPending=false;
    S.draftWriteBlocked=false;
    editor.setAttribute('contenteditable','true');
    if(loaded){
      setDestination(S.dest,false,false);
      syncEditorSelectionUI();
      showToast('Rascunho recuperado do servidor');
    }
    return true;
  }catch(error){
    console.error('Persistent draft recovery',error);
    S.draftWriteBlocked=true;
    S.draftRecoveryPending=true;
    editor.setAttribute('contenteditable','false');
    void offerDraftRecovery();
    return false;
  }
}
export async function offerDraftRecovery(){
  const choice=await chooseDialog('Não foi possível buscar sua cópia salva no servidor. A edição fica pausada para não substituí-la.','Tentar de novo','Começar rascunho novo');
  if(!S.draftRecoveryPending)return;
  if(choice===true){showToast('Buscando a cópia salva…');await recoverPersistentDraft();return;}
  if(choice===false){createNewDocumentLaunch();return;}
}
