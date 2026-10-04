// Biblioteca de rascunhos e publicações.
import { S } from "./state.js";
import { API } from "./constants.js";
import { docName, editor, one, ui } from "./dom.js";
import { clearRuntimeMedia } from "./media.js";
import { cleanDraftHTML, loadRemoteDraft, normalizedRevision, remoteDraftIdentity, saveLocal } from "./draft.js";
import { closePanel, focusControl, focusMenuControl, openPanel, panelIsOpen, showToast, syncBackButton } from "./panels.js";
import { focusLibraryStart } from "./dialog.js";
import { readResponse, setDestination } from "./publish.js";

export function libraryViewParam(){
  let value='';
  try{value=new URL(location.href).searchParams.get('view')||'';}catch{}
  return ['library','telegraph'].includes(value)?value:'';
}
export function consumeLibraryView(){
  const value=libraryViewParam();
  if(!value)return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete('view');
    history.replaceState(history.state,'',url.href);
  }catch{}
  return value;
}
export async function fetchLibrary(){
  const identity=remoteDraftIdentity();
  const res=await fetch(API+'/api/library/list',{
    method:'POST',signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/json'},body:JSON.stringify(identity)
  });
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível carregar a biblioteca');
  if(!Array.isArray(data.drafts)||!Array.isArray(data.telegram)||!Array.isArray(data.telegraph))throw new Error('Resposta da biblioteca inválida');
  return data;
}
export async function openLibraryDraft(doc){
  ui.setLibrary({status:'Abrindo rascunho…'});
  try{
    const loaded=await loadRemoteDraft(doc);
    if(!loaded)throw new Error('Rascunho não encontrado');
    dismissLibraryMenu();
    showToast('Rascunho aberto');
  }catch(error){ui.setLibrary({status:error.message||'Não foi possível abrir o rascunho'});}
}
export async function openTelegraphDocument(doc){
  S.exportOverride=null;
  ui.setLibrary({status:'Carregando página do Telegraph…'});
  try{
    const identity=remoteDraftIdentity();
    const res=await fetch(API+'/api/telegraph/load',{
      method:'POST',signal:AbortSignal.timeout(20000),
      headers:{'content-type':'application/json'},
      body:JSON.stringify({...identity,doc})
    });
    const data=await readResponse(res);
    if(!res.ok)throw new Error(data.error||'Não foi possível carregar a página do Telegraph');
    if(data.doc!==doc||typeof data.path!=='string'||!data.path||typeof data.title!=='string'||typeof data.html!=='string')throw new Error('Resposta do Telegraph inválida');
    const html=cleanDraftHTML(data.html);
    clearRuntimeMedia();
    if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
    S.editorCore.resetHTML(html,{silent:true});
    docName.value=data.title.slice(0,256);
    S.docId=doc;
    S.docRevision=normalizedRevision(data.revision);
    S.telegraphPath=data.path;
    S.importedMd='';S.importedTxt='';S.importedHtml=html;
    S.activeHandoff='';S.handoffAction=null;
    S.draftWriteBlocked=false;
    setDestination('telegraph',false,false);
    saveLocal();
    dismissLibraryMenu();
    showToast('Página Telegraph aberta para edição');
  }catch(error){ui.setLibrary({status:error.message||'Não foi possível abrir a página'});}
}
// Entradas da biblioteca: o React (LibraryEntry) renderiza cada uma.
export function libraryList(items,entry,empty){
  const list=items.map((item,index)=>({key:index+':'+item.docId,title:item.name,preview:item.preview,createdAt:item.createdAt,updatedAt:item.updatedAt,...entry(item)}));
  return {items:list,empty:list.length?'':empty};
}
export async function renderLibrary(preferred=''){
  const pending={items:[],empty:''};
  ui.setLibrary({status:'Carregando…',publicationCount:0,draftCount:0,drafts:pending,telegram:pending,telegraph:pending});
  try{
    const data=await fetchLibrary();
    const drafts=libraryList(data.drafts,item=>({
      meta:['rev. '+item.revision,item.hasMedia?'com anexo':''].filter(Boolean).join(' · '),
      platform:item.dest==='telegraph'?'Telegraph':'Telegram',onSelect:()=>void openLibraryDraft(item.docId),label:'Editar'
    }),'Nenhum rascunho salvo.');
    const telegram=libraryList(data.telegram,item=>{
      const state=item.status==='succeeded'?'publicada':item.status==='pending'?'pendente':'confirmação necessária';
      return {
        meta:['rev. '+item.revision,item.messageId?'mensagem #'+item.messageId:'',item.historyCount>1?item.historyCount+' versões':'',state].filter(Boolean).join(' · '),
        platform:'Telegram',onSelect:()=>void openLibraryDraft(item.docId),label:'Editar texto'
      };
    },'Nenhuma publicação Telegram vinculada.');
    const telegraph=libraryList(data.telegraph,item=>{
      const pending=item.status!=='succeeded';
      return {
        meta:pending?'Publicação pendente de confirmação':['rev. '+item.revision,item.path].filter(Boolean).join(' · '),
        platform:'Telegraph',disabled:pending,onSelect:()=>void openTelegraphDocument(item.docId),label:'Editar página'
      };
    },'Nenhuma publicação Telegraph vinculada.');
    const publicationTotal=data.telegram.length+data.telegraph.length;
    ui.setLibrary({
      publicationCount:publicationTotal,draftCount:data.drafts.length,drafts,telegram,telegraph,
      status:publicationTotal+' '+(publicationTotal===1?'publicação':'publicações')+' · '+data.drafts.length+' '+(data.drafts.length===1?'rascunho':'rascunhos')
    });
    if(preferred==='telegram'||preferred==='telegraph')setPublicationsExpanded(true);
    if(preferred==='telegram')one('#telegramLibrarySection')?.scrollIntoView({block:'nearest'});
    if(preferred==='telegraph')one('#telegraphLibrarySection')?.scrollIntoView({block:'nearest'});
  }catch(error){
    const unavailable={items:[],empty:'Biblioteca indisponível.'};
    ui.setLibrary({status:error.message||'Não foi possível carregar a biblioteca',drafts:unavailable,telegram:unavailable,telegraph:unavailable});
  }
}
export function setPublicationsExpanded(expanded){ui.setLibrary({publicationsOpen:Boolean(expanded)});}
export function setDraftsExpanded(expanded){ui.setLibrary({draftsOpen:Boolean(expanded)});}
export function openLibrary(preferred=''){
  setPublicationsExpanded(false);
  setDraftsExpanded(false);
  openPanel('#libraryMenu',one('#exportBtn'));
  syncBackButton();
  queueMicrotask(focusLibraryStart);
  void renderLibrary(preferred);
}
export function closeLibrary(){
  const menu=one('#libraryMenu');
  if(!panelIsOpen(menu))return;
  closePanel(menu,false);
  setPublicationsExpanded(false);
  setDraftsExpanded(false);
  openPanel('#exportMenu',one('#exportBtn'));
  syncBackButton();
  queueMicrotask(()=>focusMenuControl(one('#libraryBtn')));
}
export function dismissLibraryMenu(){
  const menu=one('#libraryMenu');
  if(panelIsOpen(menu))closePanel(menu,false);
  syncBackButton();
  queueMicrotask(()=>focusControl(editor));
}
