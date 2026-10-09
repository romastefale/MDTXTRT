
import { S } from "./state.js";
import { THEME_KEY, sheets } from "./constants.js";
import { all, docName, editor, fileInput, linkBtn, menuDismissLayer, one, ui } from "./dom.js";
import { applyAssets, applyScheme, setTheme } from "./theme.js";
import { clearRuntimeMedia, decorateSpecials, installMedia, mediaDelete, mediaNode, restoreActiveMediaVisual, restoreMedia, telegramUploadLimit } from "./media.js";
import { advanceDocumentGeneration, consumeNewDocumentToken, createNewDocumentLaunch, loadLocal, loadRemoteDraft, markDirty, offerDraftRecovery, persistRemoteDraft, recoverPersistentDraft, remoteDraftsAvailable, saveLocal, startRequestedNewDocument } from "./draft.js";
import { handoffToken, openMiniApp, verifyTelegram } from "./telegram.js";
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
all('#plusMenu [data-plus-category]').forEach(btn=>btn.addEventListener('click',()=>openPlusSubmenu(btn.dataset.plusCategory)));
all('[data-plus-submenu] [data-plus-back]').forEach(btn=>btn.addEventListener('click',()=>openPlusRoot()));
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
one('#openAppBtn').addEventListener('click',()=>{if(S.dest==='telegram'&&S.session!=='ready')void openMiniApp();else void publishCurrent();});
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
one('#mediaBtn').addEventListener('click',()=>{S.mediaChoice=null;one('#mediaInput').accept='image/*,video/*,audio/*,.pdf,.zip';one('#mediaInput').click();closePanels();});
one('#voiceBtn').addEventListener('click',()=>{S.mediaChoice='voice';one('#mediaInput').accept='audio/*,.ogg,.oga,.opus';one('#mediaInput').click();closePanels();});
one('#mediaInput').addEventListener('change',async()=>{
  const input=one('#mediaInput'),files=[...(input.files||[])];
  input.value='';
  const requestedKind=S.mediaChoice;
  S.mediaChoice=null;
  if(!files.length)return;
  const currentMedia=[...editor.querySelectorAll('img,video,audio,tg-document')].filter(node=>!(node.localName==='img'&&/^tg:\/\/emoji\?id=\d+$/.test(node.getAttribute('src')||''))).length;
  if(currentMedia+files.length>50){showToast('O Telegram aceita no máximo 50 mídias por mensagem');return;}
  for(const file of files){
    let kind=requestedKind;
    if(kind==='voice'&&!file.type.startsWith('audio/')){showToast('Escolha arquivos de áudio para mensagens de voz');continue;}
    if(!kind)kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';
    const limit=telegramUploadLimit(kind);
    if(file.size>limit){showToast(kind==='image'?'Fotos podem ter até 10 MB':'Arquivos podem ter até 50 MB');continue;}
    const id=crypto.randomUUID().replace(/-/g,'');
    const tag={image:'img',video:'video',audio:'audio',voice:'audio',document:'tg-document'}[kind];
    try{
      insertHTML('<figure><'+tag+' data-media-id="'+id+'"></'+tag+'><figcaption>'+escapeHTML(file.name)+'</figcaption></figure>',true);
      await installMedia(file,id,kind);
    }catch(err){
      mediaNode(id)?.closest('figure')?.remove();
      try{await mediaDelete(id);}catch{}
      showToast(err.message||'Não foi possível salvar um anexo');
    }
  }
  saveLocal();
});
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
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0]; if(!file) return;
  try{
    if(!/\.(md|txt)$/i.test(file.name)) throw new Error('Escolha um arquivo Markdown ou TXT');
    const text = await file.text();
    const normalized=text.replace(/^\uFEFF/,'');
    const html = /\.md$/i.test(file.name) ? mdToBasicHTML(normalized) : '<p>'+escapeHTML(normalized).replace(/\n/g,'<br>')+'</p>';
    const nextName=file.name.replace(/\.(md|txt)$/i,'').slice(0,256);
    const priorMediaIds=[...S.mediaFiles.keys()];
    for(const id of priorMediaIds)await mediaDelete(id);
    clearRuntimeMedia();
    docName.value=nextName;
    if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
    S.editorCore.resetHTML(html,{silent:true});
    S.importedMd=/\.md$/i.test(file.name)?normalized:'';
    S.importedTxt=/\.txt$/i.test(file.name)?normalized:'';
    S.importedHtml=requireEditorCore().html();
    advanceDocumentGeneration();
    S.telegraphPath='';S.docId=crypto.randomUUID();S.docRevision=0;S.savedRange=null;
    decorateSpecials();saveLocal();closePanels();syncEditorSelectionUI();
  }catch(err){ showToast(err.message || 'Não foi possível importar o arquivo'); }
  fileInput.value='';
});
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
    onChange:()=>{markDirty();restoreActiveMediaVisual();syncHistoryButtons();},
    onSelectionChange:()=>queueMicrotask(syncEditorSelectionUI)
  });

  let notice='',createdNew=false,preservedPrevious=false,loadedLocal=false;
  const requestedView=consumeLibraryView();
  const botLaunch=consumeBotLaunchAction();
  const requestedDoc=botLaunch?'':consumeLaunchDocument();
  const requestedDest=consumeLaunchDestination();
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
  const recoverVolume=!createdNew&&!loadedLocal&&!handoffToken()&&remoteDraftsAvailable();
  if(recoverVolume)editor.setAttribute('contenteditable','false');
  void (async()=>{
    try{
      if(recoverVolume)await recoverPersistentDraft();
      await restoreMedia();
      await verifyTelegram();
      if(botLaunch)await runBotLaunchAction(botLaunch);
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
