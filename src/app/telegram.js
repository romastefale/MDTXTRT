
import { S } from "./state.js";
import { telegramInsetFields } from "./constants.js";
import { applyScheme, getTg } from "./theme.js";
import { requestMatchesDocument, saveLocal } from "./draft.js";
import { closeTopLayer, openPlusRoot, showToast } from "./panels.js";
import { setDestination } from "./publish.js";
import { call } from "./serverless.js";
import { scheduleBrowserViewport } from "./viewport.js";

export async function recoverTelegraph(){
  if(!/^[a-f0-9-]{36}$/i.test(S.docId))throw new Error('Documento inválido');
  const requestDoc=S.docId,requestRevision=S.docRevision;
  let data;
  try{data=await call('telegraphRecover',{doc:requestDoc,revision:requestRevision});}
  catch(error){
    if(error.code==='NOT_FOUND')return false;
    throw error;
  }
  if(typeof data.path!=='string'||!data.path||data.doc!==requestDoc||data.revision!==requestRevision)throw new Error('Resposta de recuperação do Telegraph inválida');
  if(!requestMatchesDocument(requestDoc,requestRevision))return false;
  S.telegraphPath=data.path;
  saveLocal();
  return true;
}
// O Mini App só funciona dentro do Telegram: sem initData não há sessão. O backend (plataforma ou
// servidor do Railway) valida o initData em cada chamada (401 UNAUTHORIZED), então não há endpoint de sessão.
export async function verifyTelegram(){
  const tg=getTg();
  if(!tg?.initData){
    S.session='invalid';
    showToast('Abra o MDTXTRT pelo bot no Telegram');
    return;
  }
  setupTelegram();
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
