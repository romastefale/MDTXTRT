
import { S } from "./state.js";
import { THEME_KEY, sheets } from "./constants.js";
import { all, docName, editor, fileInput, linkBtn, menuDismissLayer, one, ui } from "./dom.js";
import { applyAssets, applyScheme, setTheme } from "./theme.js";
import { clearRuntimeMedia, decorateSpecials } from "./media.js";
import { advanceDocumentGeneration, archiveStoredDraftForNew, consumeNewDocumentToken, createNewDocumentLaunch, loadLocal, loadRemoteDraft, markDirty, offerDraftRecovery, persistRemoteDraft, recoverPersistentDraft, remoteDraftsAvailable, saveLocal, startRequestedNewDocument, syncDocMeta } from "./draft.js";
import { verifyTelegram } from "./telegram.js";
import { call } from "./serverless.js";
import { closePanel, closePanels, focusControl, holdDismissPress, isTypingEntry, librarySubmenuOpen, noticeDismissPress, openPanel, openPlusRoot, openPlusSubmenu, panelIsOpen, retainTypingFocus, showToast, syncBackButton, togglePanel } from "./panels.js";
import { dialogFocusables, dismissDialog, finishDialog, focusDialogStart, focusLibraryStart, libraryFocusables, notifyDialog } from "./dialog.js";
import { commitEditorInput, exec, flashBtn, formatBlock, histRedo, histUndo, insertFeature, syncHistoryButtons, insertHTML, insertHyperlink, insertLinkButton, insertPlainText, insertVisibleLink, requireEditorCore, restoreSel, saveSel, syncEditorSelectionUI } from "./editing.js";
import { closeLibrary, consumeLibraryView, openLibrary, setDraftsExpanded, setPublicationsExpanded } from "./library.js";
import { consumeBotLaunchAction, consumeLaunchDestination, consumeLaunchDocument, runBotLaunchAction } from "./launch.js";
import { escapeHTML, mdToBasicHTML } from "./convert.js";
import { exportFile, publishCurrent, setDestination } from "./publish.js";
import { scheduleBrowserViewport, scheduleCaretVisible, syncBrowserViewport } from "./viewport.js";
import { STORAGE_BLOCKED_NOTICE, storageBlocked, storageGet } from "./storage.js";

applyAssets();
export const scheme=window.matchMedia('(prefers-color-scheme: light)');
try{
  const stored=storageGet(THEME_KEY);
  if(stored==='light'||stored==='dark')S.themePreference=stored;
}catch{}
applyScheme();
scheme.addEventListener('change',()=>{if(!S.themePreference)applyScheme();});
document.addEventListener('click',event=>{
  const control=event.target?.closest?.('button,input,textarea,select,[role="button"],[tabindex]');
  if(control&&!one('#dialogMenu').contains(control))S.lastInteractionControl=control;
},true);
one('#dialogOk').addEventListener('click',()=>finishDialog(S.dialogConfirm?true:one('#dialogInput').value));
one('#dialogCancel').addEventListener('click',()=>finishDialog(S.dialogConfirm?false:null));
one('#dialogInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&e.currentTarget.rows===1){e.preventDefault();finishDialog(e.currentTarget.value);}});
one('#dialogMenu').addEventListener('keydown',event=>{
  
  
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissDialog();return;}
  if(event.key!=='Tab')return;
  const items=dialogFocusables();
  if(!items.length){event.preventDefault();return;}
  const at=items.indexOf(document.activeElement);
  const next=event.shiftKey?(at<=0?items.length-1:at-1):(at<0||at===items.length-1?0:at+1);
  event.preventDefault();focusControl(items[next]);
});
document.addEventListener('focusin',event=>{
  const dialog=one('#dialogMenu');
  if(dialog.matches(':popover-open')&&!dialog.contains(event.target)){queueMicrotask(()=>focusDialogStart(false));return;}
  const menu=one('#libraryMenu');
  if(librarySubmenuOpen()&&!menu.contains(event.target)&&!isTypingEntry(event.target))queueMicrotask(focusLibraryStart);
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const dialog=one('#dialogMenu');
  if(dialog.matches(':popover-open')){event.preventDefault();dismissDialog();return;}
  if(librarySubmenuOpen()){event.preventDefault();closeLibrary();return;}
  const sel=sheets.find(name=>panelIsOpen(one(name)));
  if(sel){event.preventDefault();closePanel(one(sel),true);}
});









let dialogOutsidePress=false;
function dialogOutsideTarget(event){
  const dialog=one('#dialogMenu');
  if(!dialog?.matches(':popover-open'))return false;
  const target=event.target;
  if(target instanceof Node&&dialog.contains(target)&&target!==dialog)return false;
  if(target===dialog){
    
    const box=dialog.getBoundingClientRect();
    return !(event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom);
  }
  return true;
}
function holdDialogOutsidePress(event){
  if(!(event.type==='pointerdown'&&event.pointerType==='touch'))event.preventDefault();
  event.stopPropagation();
}
let dialogPointerPressAt=-Infinity;
window.addEventListener('pointerdown',event=>{
  dialogPointerPressAt=event.timeStamp;
  dialogOutsidePress=dialogOutsideTarget(event);
  if(dialogOutsidePress)holdDialogOutsidePress(event);
},true);
window.addEventListener('mousedown',event=>{
  
  if(event.timeStamp-dialogPointerPressAt>1000)dialogOutsidePress=dialogOutsideTarget(event);
  if(dialogOutsidePress)holdDialogOutsidePress(event);
},true);
window.addEventListener('pointercancel',()=>{dialogOutsidePress=false;},true);
window.addEventListener('click',event=>{
  if(!dialogOutsidePress)return;
  dialogOutsidePress=false;
  if(!dialogOutsideTarget(event))return;
  event.preventDefault();event.stopPropagation();
  dismissDialog();
},true);
window.addEventListener('pagehide',()=>{
  saveLocal();
  clearTimeout(S.remoteSaveTimer);
  void persistRemoteDraft(true).catch(error=>console.error('Persistent draft pagehide',error));
});
editor.addEventListener('beforeinput',event=>{
  if(!S.editorCore||S.composing)return;
  if(S.editorCore.handleBeforeInput(event))scheduleCaretVisible();
});
editor.addEventListener('keydown',event=>{if(S.editorCore)S.editorCore.handleKeydown(event);});
editor.addEventListener('input', event=>{ if(!S.composing)commitEditorInput(event); });
editor.addEventListener('change',e=>{if(e.target.matches('input[type=checkbox]')){e.target.toggleAttribute('checked',e.target.checked);requireEditorCore().syncFromDOM({addToHistory:true});syncEditorSelectionUI();}});
editor.addEventListener('compositionstart', ()=> S.composing = true);
editor.addEventListener('compositionend', event=>{ S.composing = false; commitEditorInput(event); });
editor.addEventListener('keyup', saveSel);
editor.addEventListener('mouseup', saveSel);
editor.addEventListener('paste', e => {
  e.preventDefault();
  const text=e.clipboardData.getData('text/plain');
  insertPlainText(text);
});
document.addEventListener('selectionchange',syncEditorSelectionUI);
for(const type of ['pointerdown','mousedown','pointerup','mouseup','click','pointercancel'])window.addEventListener(type,noticeDismissPress,true);
document.addEventListener('pointerdown',retainTypingFocus,true);
document.addEventListener('mousedown',retainTypingFocus,true);
menuDismissLayer?.addEventListener('pointerdown',holdDismissPress);
menuDismissLayer?.addEventListener('mousedown',holdDismissPress);
menuDismissLayer?.addEventListener('click',event=>{
  event.preventDefault();
  event.stopPropagation();
  closePanels();
});
all('#typebar [data-cmd], [data-plus-submenu] [data-cmd], #listMenu [data-cmd]').forEach(btn => btn.addEventListener('click', ()=>{try{exec(btn.dataset.cmd);closePanels();}catch(err){showToast(err.message);}}));
all('#typebar [data-block], #headingMenu [data-block], #quoteMenu [data-block]').forEach(btn => btn.addEventListener('click', ()=>{try{formatBlock(btn.dataset.block);}catch(err){showToast(err.message);}}));
document.querySelectorAll('[data-plus-submenu] [data-insert], #quoteMenu [data-insert], #listMenu [data-insert]').forEach(btn => btn.addEventListener('click', ()=>{void insertFeature(btn.dataset.insert).catch(err=>showToast(err.message));}));
export const tableActions=Object.freeze({
  'add-row':()=>requireEditorCore().addTableRow(),
  'remove-row':()=>requireEditorCore().removeTableRow(),
  'add-column':()=>requireEditorCore().addTableColumn(),
  'remove-column':()=>requireEditorCore().removeTableColumn(),
  'delete-table':()=>requireEditorCore().deleteTable()
});
document.querySelectorAll('[data-table-action]').forEach(btn=>btn.addEventListener('click',()=>{
  try{
    restoreSel();
    const action=tableActions[btn.dataset.tableAction];
    if(typeof action!=='function'||!action())throw new Error('Posicione o cursor dentro da tabela');
    closePanels();syncEditorSelectionUI();
  }catch(err){showToast(err.message||'Não foi possível alterar a tabela');}
}));
export const linkActions=Object.freeze({
  hyperlink:insertHyperlink,
  url:insertVisibleLink,
  button:insertLinkButton
});
one('#plusBtn')?.addEventListener('click',()=>togglePanel('#plusMenu',one('#plusBtn')));
one('#headingBtn')?.addEventListener('click',()=>togglePanel('#headingMenu',one('#headingBtn')));
one('#listBtn')?.addEventListener('click',()=>togglePanel('#listMenu',one('#listBtn')));
one('#quoteBtn')?.addEventListener('click',()=>togglePanel('#quoteMenu',one('#quoteBtn')));
linkBtn.addEventListener('click',()=>togglePanel('#linkMenu',linkBtn));
all('#linkMenu [data-link-kind]').forEach(btn=>btn.addEventListener('click',()=>{
  const action=linkActions[btn.dataset.linkKind];
  closePanel(one('#linkMenu'));
  if(typeof action==='function')void action().catch(err=>showToast(err.message||'Não foi possível inserir o link'));
}));
one('#undoBtn').addEventListener('click', ()=>{ if(histUndo())flashBtn(one('#undoBtn')); });
one('#redoBtn').addEventListener('click', ()=>{ histRedo(); flashBtn(one('#redoBtn')); });
one('#themeBtn').addEventListener('click',()=>setTheme(document.documentElement.classList.contains('light')?'dark':'light'));
one('#publishBtn').addEventListener('click',()=>{void publishCurrent();});
one('#destBtn').addEventListener('click', ()=>setDestination(S.dest === 'telegram' ? 'telegraph' : 'telegram'));
one('#exportBtn').addEventListener('click', ()=>{
  if(S.session==='pending'){showToast('Aguarde a validação da sessão Telegram');return;}
  if(S.session==='invalid'){showToast('Sessão inválida ou expirada. Reabra o Mini App.');return;}
  const library=one('#libraryMenu');
  if(panelIsOpen(library)){
    closePanel(library,true);
    syncBackButton();
    return;
  }
  togglePanel('#exportMenu',one('#exportBtn'));
});
docName.addEventListener('input',markDirty);
one('#importMdBtn').addEventListener('click', ()=>{ fileInput.accept='.md,text/markdown'; fileInput.click(); closePanels(); });
one('#importTxtBtn').addEventListener('click', ()=>{ fileInput.accept='.txt,text/plain'; fileInput.click(); closePanels(); });
one('#exportTxtBtn').addEventListener('click', ()=>exportFile('txt'));
one('#exportMdBtn').addEventListener('click', ()=>exportFile('md'));
// Anexo = mídia que o usuário enviou ao bot (o Telegram só aceita file_id existente no envio).
async function attachBotMedia(kinds){
  closePanels();
  try{
    const {media}=await call('mediaList');
    const used=new Set([...editor.querySelectorAll('[data-media-id]')].map(node=>node.getAttribute('data-media-id')));
    if(used.size>=50){showToast('O Telegram aceita no máximo 50 mídias por mensagem');return;}
    const item=media.find(entry=>kinds.includes(entry.kind)&&!used.has(entry.id));
    if(!item){showToast('Envie a mídia ao bot, no chat, e toque aqui de novo');return;}
    const tag={image:'img',video:'video',audio:'audio',voice:'audio',document:'tg-document'}[item.kind];
    insertHTML('<figure><'+tag+' data-media-id="'+item.id+'"></'+tag+'><figcaption>'+escapeHTML(item.name||'')+'</figcaption></figure>',true);
    S.mediaFiles.set(item.id,{id:item.id,kind:item.kind});
    saveLocal();
    showToast('Última mídia enviada ao bot anexada');
  }catch(err){showToast(err.message||'Não foi possível anexar a mídia');}
}
one('#mediaBtn').addEventListener('click',()=>void attachBotMedia(['image','video','audio','document']));
one('#voiceBtn').addEventListener('click',()=>void attachBotMedia(['voice']));
one('#libraryBtn')?.addEventListener('click',()=>openLibrary());
one('#libraryClose')?.addEventListener('click',closeLibrary);
one('#libraryNew')?.addEventListener('click',()=>{if(storageBlocked())closePanels();void createNewDocumentLaunch();});
one('#publicationToggle')?.addEventListener('click',()=>setPublicationsExpanded(!ui.getState().library.publicationsOpen));
one('#draftToggle')?.addEventListener('click',()=>setDraftsExpanded(!ui.getState().library.draftsOpen));
one('#libraryMenu')?.addEventListener('keydown',event=>{
  if(!librarySubmenuOpen()||event.key!=='Tab')return;
  const items=libraryFocusables();
  if(!items.length){event.preventDefault();return;}
  const at=items.indexOf(document.activeElement);
  const next=event.shiftKey?(at<=0?items.length-1:at-1):(at<0||at===items.length-1?0:at+1);
  event.preventDefault();
  focusControl(items[next]);
});
one('#findBtn').addEventListener('click', ()=>{saveSel();const anchor=one('#plusBtn');closePanels();openPanel('#findMenu',anchor);one('#findText').focus({preventScroll:true});});
one('#findNext').addEventListener('click',()=>{
  const term=one('#findText').value;
  if(!term||!requireEditorCore().findNext(term))showToast('Nenhuma ocorrência');
});
one('#replaceOne').addEventListener('click',()=>{
  const term=one('#findText').value;if(!term)return;
  const core=requireEditorCore();
  if(!core.selectionMatches(term)&&!core.findNext(term))return showToast('Nenhuma ocorrência');
  if(!core.selectionMatches(term))return;
  core.replaceSelection(one('#replaceText').value);
  core.findNext(term);
});
one('#replaceAll').addEventListener('click',()=>{
  const term=one('#findText').value,replace=one('#replaceText').value;
  const count=term?requireEditorCore().replaceAllLiteral(term,replace):0;
  showToast(count+' substituições');
});
async function importText(fileName,text){
  if(!/\.(md|txt)$/i.test(fileName)) throw new Error('Escolha um arquivo Markdown ou TXT');
  const normalized=text.replace(/^\uFEFF/,'');
  const html = /\.md$/i.test(fileName) ? mdToBasicHTML(normalized) : '<p>'+escapeHTML(normalized).replace(/\n/g,'<br>')+'</p>';
  const nextName=fileName.replace(/\.(md|txt)$/i,'').slice(0,256);
  clearRuntimeMedia();
  docName.value=nextName;
  if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
  S.editorCore.resetHTML(html,{silent:true});
  S.importedMd=/\.md$/i.test(fileName)?normalized:'';
  S.importedTxt=/\.txt$/i.test(fileName)?normalized:'';
  S.importedHtml=requireEditorCore().html();
  advanceDocumentGeneration();
  S.telegraphPath='';S.docId=crypto.randomUUID();S.docRevision=0;S.savedRange=null;
  decorateSpecials();saveLocal();closePanels();syncEditorSelectionUI();
}
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0]; if(!file) return;
  try{ await importText(file.name,await file.text()); }
  catch(err){ showToast(err.message || 'Não foi possível importar o arquivo'); }
  fileInput.value='';
});
function consumeImportParam(){
  let value='';
  try{value=new URL(location.href).searchParams.get('import')||'';}catch{}
  if(!/^\d+$/.test(value))return 0;
  try{const url=new URL(location.href);url.searchParams.delete('import');history.replaceState(history.state,'',url.href);}catch{}
  return Number(value);
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',scheduleBrowserViewport);
  window.visualViewport.addEventListener('scroll',scheduleBrowserViewport);
}
window.addEventListener('resize',scheduleBrowserViewport);
document.addEventListener('focusin',scheduleBrowserViewport);
document.addEventListener('focusout',scheduleBrowserViewport);
syncBrowserViewport();
editor.addEventListener('pointerdown',()=>{if(S.draftRecoveryPending&&!S.dialogResolve)void offerDraftRecovery();});
export function boot(){
  const factory=window.MDTXTRTEditorCore?.createEditorCore;
  if(typeof factory!=='function')throw new Error('Núcleo de edição indisponível');
  S.editorCore=factory({
    element:editor,
    onChange:()=>{markDirty();syncHistoryButtons();},
    onSelectionChange:()=>queueMicrotask(syncEditorSelectionUI)
  });

  let notice='',createdNew=false,preservedPrevious=false,loadedLocal=false;
  const requestedView=consumeLibraryView();
  const botLaunch=consumeBotLaunchAction();
  const requestedDoc=botLaunch?'':consumeLaunchDocument();
  const requestedDest=consumeLaunchDestination();
  const requestedImport=consumeImportParam();
  const newToken=consumeNewDocumentToken();
  if(newToken){
    try{preservedPrevious=startRequestedNewDocument(newToken);createdNew=true;}
    catch(err){
      notice=err.message;
      try{loadedLocal=loadLocal();}catch(loadError){notice=notice+' '+(loadError.message||'');}
    }
  }else{
    try{loadedLocal=loadLocal();}catch(err){notice=err.message;}
  }
  setDestination(S.dest,false,false);syncEditorSelectionUI();
  if(createdNew){
    const persisted=saveLocal();
    notice=persisted
      ?(preservedPrevious?'Novo documento criado. O anterior foi preservado neste dispositivo.':'Novo documento criado.')
      :'Novo documento criado, mas não foi possível persistir o novo rascunho neste dispositivo.';
  }
  
  
  
  const blocked=storageBlocked();
  if(blocked)void notifyDialog(STORAGE_BLOCKED_NOTICE);
  else if(notice)showToast(notice);
  syncDocMeta(true);
  const recoverVolume=!createdNew&&!loadedLocal&&remoteDraftsAvailable();
  if(recoverVolume)editor.setAttribute('contenteditable','false');
  void (async()=>{
    try{
      if(recoverVolume)await recoverPersistentDraft();
      await verifyTelegram();
      if(botLaunch)await runBotLaunchAction(botLaunch);
      if(requestedImport){
        const opened=await call('importOpen',{id:requestedImport});
        archiveStoredDraftForNew(String(requestedImport));
        await importText(opened.fileName,opened.text);
        showToast('Arquivo importado aberto como novo documento');
      }
      if(requestedDoc){
        const loaded=await loadRemoteDraft(requestedDoc);
        if(!loaded)throw new Error('O rascunho selecionado não foi encontrado para esta conta Telegram');
        showToast('Rascunho aberto');
      }
      if(requestedDest){
        setDestination(requestedDest,true,false);
        showToast('Destino: '+(requestedDest==='telegraph'?'Telegraph':'Telegram'));
      }
      if(requestedView)openLibrary(requestedView);
    }catch(err){showToast(err.message||'Não foi possível restaurar o documento');}
  })();
}
boot();
