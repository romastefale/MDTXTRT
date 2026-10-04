// Mini App do Telegram: sessão, transferências (handoff), áreas seguras e botões nativos.
import { S } from "./state.js";
import { API, STATE_VERSION, telegramInsetFields } from "./constants.js";
import { docName, editor } from "./dom.js";
import { applyScheme, getTg } from "./theme.js";
import { clearRuntimeMedia, decorateSpecials, installMedia, mediaDelete } from "./media.js";
import { activeMedia, archiveStoredDraftForNew, browserOwnerKey, cleanDraftHTML, draftState, normalizedRevision, requestMatchesDocument, saveLocal } from "./draft.js";
import { closeTopLayer, openPlusRoot, showToast } from "./panels.js";
import { requireEditorCore } from "./editing.js";
import { buildRich } from "./convert.js";
import { readResponse, setDestination } from "./publish.js";
import { scheduleBrowserViewport } from "./viewport.js";

export function handoffToken(){
  try{
    const direct=new URL(location.href).searchParams.get('handoff')||'';
    if(/^[a-f0-9]{32}$/.test(direct))return direct;
  }catch{}
  const initData=getTg()?.initData;
  if(typeof initData!=='string'||!initData)return '';
  const raw=new URLSearchParams(initData).get('start_param');
  if(typeof raw!=='string')return '';
  const match=/^h_([a-f0-9]{32})$/.exec(raw);
  return match?match[1]:'';
}
export function normalizedHandoffAction(value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||value.type!=='publish'||!['pending','sending','succeeded','failed','uncertain'].includes(value.status)||!Number.isInteger(value.attempts)||value.attempts<0||typeof value.error!=='string'||!/^[a-f0-9-]{36}$/i.test(String(value.doc||''))||!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('Estado da publicação transferida inválido');
  if(value.status==='succeeded'&&(!value.result||value.result.via!=='sendRichMessage'||!Number.isInteger(value.result.messageId)||value.result.messageId<=0))throw new Error('Resultado da publicação transferida inválido');
  return value;
}
export function handoffActionNotice(action,recovered=false){
  if(!action)return recovered?'Rascunho aberto no Mini App':'Transferência sem ação pendente';
  if(action.status==='succeeded')return 'Esta transferência já foi publicada no chat do bot';
  if(action.status==='sending')return 'A publicação desta transferência ainda está em andamento. Não reenvie.';
  if(action.status==='uncertain')return action.error||'O resultado desta publicação é incerto. Confira o chat antes de iniciar outra publicação.';
  if(action.status==='failed')return action.error?('A publicação anterior falhou: '+action.error+'. Toque em Publicar para tentar novamente.'):'A publicação anterior falhou. Toque em Publicar para tentar novamente.';
  return 'Rascunho recuperado. Toque em Publicar para autorizar o envio.';
}
export async function claimHandoff(){
  const token=handoffToken();
  if(!token)throw new Error('Transferência inválida');
  const initData=getTg().initData;
  const res=await fetch(API+'/api/handoff/claim',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},body:JSON.stringify({initData,token})});
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível recuperar o rascunho');
  const d=data.draft;
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string'||!Array.isArray(d.media))throw new Error('Rascunho transferido incompatível');
  const purpose=data.purpose===undefined?'transfer':data.purpose;
  if(!['transfer','import'].includes(purpose))throw new Error('Finalidade da transferência incompatível');
  if(purpose==='import')archiveStoredDraftForNew(token);
  const priorIds=[...S.mediaFiles.keys()];
  clearRuntimeMedia();
  const handoffHTML=cleanDraftHTML(d.html);requireEditorCore().resetHTML(handoffHTML,{silent:true});docName.value=d.name;
  S.dest=d.dest;S.telegraphPath=d.telegraphPath;S.docId=d.docId;S.docRevision=normalizedRevision(d.revision);
  S.importedMd=d.importedMd;S.importedTxt=d.importedTxt;S.importedHtml=d.importedHtml;
  const files=Array.isArray(data.files)?data.files:[];
  if(files.length!==d.media.length)throw new Error('Anexos da transferência incompatíveis');
  for(const meta of files){
    if(typeof meta.name!=='string'||!meta.name||typeof meta.mime!=='string'||!meta.mime||!['image','video','audio','voice','document'].includes(meta.kind)||!/^[A-Za-z0-9_-]{1,64}$/.test(meta.id))throw new Error('Metadados do anexo transferido inválidos');
    const fileRes=await fetch(API+'/api/handoff/file',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json'},body:JSON.stringify({initData,token,id:meta.id})});
    if(!fileRes.ok)throw new Error('Não foi possível recuperar um anexo transferido');
    const blob=await fileRes.blob();
    const file=new File([blob],meta.name,{type:meta.mime,lastModified:Date.now()});
    await installMedia(file,meta.id,meta.kind);
  }
  for(const id of priorIds)if(!S.mediaFiles.has(id))try{await mediaDelete(id);}catch(error){console.error('Media cleanup',error);}
  S.activeHandoff=token;
  S.handoffAction=normalizedHandoffAction(data.action);
  decorateSpecials();setDestination(S.dest,false,false);saveLocal();
  showToast(purpose==='import'?'Arquivo importado aberto como novo documento':handoffActionNotice(S.handoffAction,true));
}
export async function refreshHandoffAction(){
  if(!S.activeHandoff||S.session!=='ready')return null;
  const res=await fetch(API+'/api/handoff/status',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({initData:getTg().initData,token:S.activeHandoff})});
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível consultar a transferência');
  S.handoffAction=normalizedHandoffAction(data.action);
  return S.handoffAction;
}
export async function publishHandoff(){
  if(!S.activeHandoff||!S.handoffAction)return false;
  if(S.handoffAction.doc!==S.docId||S.handoffAction.revision!==S.docRevision){
    showToast('O documento mudou desde a transferência. Inicie uma nova publicação para enviar esta versão.');
    return true;
  }
  const body=JSON.stringify({initData:getTg().initData,token:S.activeHandoff});
  try{
    const res=await fetch(API+'/api/handoff/publish',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json'},body});
    const data=await readResponse(res);
    if(data.action)S.handoffAction=normalizedHandoffAction(data.action);
    if(S.handoffAction?.status==='succeeded'){
      showToast(data.reused?'Esta transferência já foi publicada no chat do bot':'Mensagem enviada no chat do bot');
      return true;
    }
    if(S.handoffAction?.status==='sending'){
      showToast('A publicação está em andamento. Não reenvie; consulte o estado desta transferência.');
      return true;
    }
    if(S.handoffAction?.status==='uncertain'){
      showToast(S.handoffAction.error||'O resultado do envio é incerto. Confira o chat antes de iniciar outra publicação.');
      return true;
    }
    if(S.handoffAction?.status==='failed'){
      showToast(handoffActionNotice(S.handoffAction));
      return true;
    }
    if(!res.ok)throw new Error(data.error||'Não foi possível publicar a transferência');
    showToast(handoffActionNotice(S.handoffAction));
    return true;
  }catch(err){
    if(err.name==='TimeoutError'||err instanceof TypeError){
      try{
        const action=await refreshHandoffAction();
        showToast(handoffActionNotice(action));
      }catch{
        showToast('O resultado do envio é incerto. Nenhum reenvio foi feito; confira o chat ou reabra esta transferência antes de tentar outra publicação.');
      }
      return true;
    }
    showToast(err.message||'Não foi possível publicar a transferência');
    return true;
  }
}
export async function recoverTelegraph(){
  if(!/^[a-f0-9-]{36}$/i.test(S.docId))throw new Error('Documento inválido');
  const requestDoc=S.docId,requestRevision=S.docRevision;
  const identity=S.session==='ready'?{initData:getTg().initData}:{browserKey:browserOwnerKey()};
  const res=await fetch(API+'/api/telegraph/recover',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({...identity,doc:requestDoc,revision:requestRevision})});
  if(res.status===404)return false;
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível recuperar a página do Telegraph');
  if(typeof data.path!=='string'||!data.path||data.doc!==requestDoc||data.revision!==requestRevision)throw new Error('Resposta de recuperação do Telegraph inválida');
  if(!requestMatchesDocument(requestDoc,requestRevision))return false;
  S.telegraphPath=data.path;
  saveLocal();
  return true;
}
export async function openMiniApp(){
  if(S.busy)return;S.busy=true;
  try{
    saveLocal();
    const active=activeMedia();
    const localIds=[...editor.querySelectorAll('[data-media-id]')].map(node=>node.getAttribute('data-media-id'));
    if(localIds.some(id=>!S.mediaFiles.has(id)))throw new Error('Há mídia local que precisa ser anexada novamente');
    const rich=buildRich();
    const form=new FormData();
    form.set('draft',JSON.stringify(draftState()));
    form.set('action',JSON.stringify({type:'publish',html:rich.rich_message.html}));
    for(const media of active)form.set('upload_'+media.id,media.file,media.file.name);
    const res=await fetch(API+'/api/handoff',{method:'POST',signal:AbortSignal.timeout(60000),body:form});
    const data=await readResponse(res);
    if(!res.ok)throw new Error(data.error||'Não foi possível abrir o Mini App');
    if(typeof data.open!=='string')throw new Error('Resposta de transferência inválida');
    const open=new URL(data.open);
    const api=new URL(API);
    if(open.origin!==api.origin||open.pathname!=='/telegram/open'||!/^[a-f0-9]{32}$/.test(open.searchParams.get('handoff')||''))throw new Error('Resposta de transferência inválida');
    window.location.assign(open.href);
  }catch(err){showToast(err.name==='TimeoutError'?'Tempo de transferência esgotado':err.message||'Não foi possível abrir o Mini App');}
  finally{S.busy=false;}
}
export async function verifyTelegram(){
  const initData=getTg()?.initData;
  if(!initData){
    try{await recoverTelegraph();}catch(err){if(!/não encontrada/i.test(err.message||''))console.error('Telegraph browser recovery',err);}
    return;
  }
  S.session='pending';
  try{
    const res=await fetch(API+'/api/telegram/session',{signal:AbortSignal.timeout(15000),method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData})});
    if(!res.ok)throw new Error('Sessão Telegram inválida ou expirada');
    setupTelegram();
  }catch(err){
    S.session='invalid';
    document.body.classList.remove('tg');
    applyScheme();
    showToast(err.message||'Não foi possível validar a sessão Telegram');
    return;
  }
  if(handoffToken()){
    try{await claimHandoff();}catch(err){showToast(err.message||'Não foi possível recuperar o rascunho');}
    return;
  }
  try{await recoverTelegraph();}catch(err){showToast(err.message||'Não foi possível recuperar a página do Telegraph');}
}
export function validTelegramInsets(value){
  return value&&telegramInsetFields.every(field=>Number.isInteger(value[field])&&value[field]>=0);
}
export function syncTelegramSafeAreas(){
  const tg=getTg(),root=document.documentElement;
  if(validTelegramInsets(tg?.safeAreaInset)){
    for(const field of telegramInsetFields)root.style.setProperty('--app-tg-safe-'+field,tg.safeAreaInset[field]+'px');
  }
  if(validTelegramInsets(tg?.contentSafeAreaInset)){
    for(const field of telegramInsetFields)root.style.setProperty('--app-tg-content-safe-'+field,tg.contentSafeAreaInset[field]+'px');
    root.classList.add('tg-shell');
  }else{
    root.classList.remove('tg-shell');
  }
}
export function handleTelegramViewportChange(event){
  if(event?.isStateStable===true)syncTelegramSafeAreas();
  scheduleBrowserViewport();
}
export function setupTelegram(){
  const tg=getTg();
  S.session='ready';
  document.body.classList.add('tg');
  setDestination(S.dest,false,false);
  tg.onEvent('themeChanged',applyScheme);
  tg.onEvent('viewportChanged',handleTelegramViewportChange);
  tg.onEvent('safeAreaChanged',syncTelegramSafeAreas);
  tg.onEvent('contentSafeAreaChanged',syncTelegramSafeAreas);
  tg.onEvent('fullscreenChanged',()=>{syncTelegramSafeAreas();scheduleBrowserViewport();});
  tg.onEvent('fullscreenFailed',event=>{
    if(event?.error==='ALREADY_FULLSCREEN'&&tg.isFullscreen)return;
    showToast(event?.error==='UNSUPPORTED'?'Tela cheia indisponível neste Telegram':'Não foi possível abrir em tela cheia');
  });
  tg.ready();
  tg.expand();
  applyScheme();
  syncTelegramSafeAreas();
  if(typeof tg.isVersionAtLeast==='function'&&tg.isVersionAtLeast('8.0')&&typeof tg.requestFullscreen==='function'&&!tg.isFullscreen){
    try{tg.requestFullscreen();}
    catch(error){console.error('Telegram fullscreen',error);showToast('Não foi possível abrir em tela cheia');}
  }
  // O editor rola e seleciona texto com gestos verticais; o swipe de fechar/minimizar
  // do Telegram (Bot API 7.7+) conflita com eles. O cabeçalho continua fechando o app.
  if(typeof tg.isVersionAtLeast==='function'&&tg.isVersionAtLeast('7.7')&&typeof tg.disableVerticalSwipes==='function'){
    try{tg.disableVerticalSwipes();}catch(error){console.error('Telegram vertical swipes',error);}
  }
  scheduleBrowserViewport();
  tg.SettingsButton.show();
  tg.SettingsButton.onClick(openPlusRoot);
  tg.BackButton.onClick(closeTopLayer);
  tg.BackButton.hide();
  tg.MainButton.hide();
}
