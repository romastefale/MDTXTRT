// Parâmetros de lançamento (documento, destino, ações do bot).
import { S } from "./state.js";
import { API } from "./constants.js";
import { one } from "./dom.js";
import { getTg } from "./theme.js";
import { loadRemoteDraft } from "./draft.js";
import { closePanels, focusMenuControl, openPanel, showToast, syncBackButton } from "./panels.js";
import { publishTelegram, readResponse } from "./publish.js";

export function consumeLaunchDocument(){
  let value='';
  try{value=new URL(location.href).searchParams.get('doc')||'';}catch{}
  if(!/^[a-f0-9-]{36}$/i.test(value))return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete('doc');
    history.replaceState(history.state,'',url.href);
  }catch{}
  return value.toLowerCase();
}
export function consumeLaunchDestination(){
  let value='';
  try{value=new URL(location.href).searchParams.get('dest')||'';}catch{}
  if(!['telegram','telegraph'].includes(value))return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete('dest');
    history.replaceState(history.state,'',url.href);
  }catch{}
  return value;
}
export function consumeBotLaunchAction(){
  let url;
  try{url=new URL(location.href);}catch{return null;}
  const action=url.searchParams.get('botAction')||'';
  if(!action)return null;
  const source=url.searchParams.get('source')||'';
  const doc=url.searchParams.get('doc')||'';
  url.searchParams.delete('botAction');
  url.searchParams.delete('source');
  url.searchParams.delete('doc');
  url.searchParams.delete('format');
  try{history.replaceState(history.state,'',url.href);}catch{}
  if(!/^[a-f0-9-]{36}$/i.test(doc))return {error:'Documento selecionado inválido'};
  if(action==='send'&&source==='d')return {action,source,doc:doc.toLowerCase()};
  if(action==='export'&&['d','t','g'].includes(source))return {action,source,doc:doc.toLowerCase()};
  return {error:'Ação selecionada pelo bot inválida'};
}
export async function loadBotExportSource(selection){
  if(S.session!=='ready')throw new Error('A exportação selecionada exige uma sessão Telegram válida');
  const initData=getTg()?.initData;
  if(!initData)throw new Error('Sessão Telegram ausente');
  const res=await fetch(API+'/api/export/source',{
    method:'POST',
    signal:AbortSignal.timeout(20000),
    headers:{'content-type':'application/json'},
    body:JSON.stringify({initData,kind:selection.source,doc:selection.doc})
  });
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível preparar a exportação selecionada');
  if(data.doc!==selection.doc||data.kind!==selection.source||typeof data.name!=='string'||typeof data.html!=='string')throw new Error('Resposta de exportação inválida');
  S.exportOverride={name:data.name||'MDTXTRT',html:data.html,kind:data.kind,doc:data.doc};
  closePanels();
  openPanel('#exportMenu',one('#exportBtn'));
  syncBackButton();
  queueMicrotask(()=>focusMenuControl(one('#exportTxtBtn')));
  showToast('Conteúdo selecionado. Escolha TXT ou Markdown.');
}
export async function runBotLaunchAction(selection){
  if(!selection)return;
  if(selection.error)throw new Error(selection.error);
  if(S.session!=='ready')throw new Error('Reabra esta ação pelo chat privado do bot');
  if(selection.action==='send'){
    const loaded=await loadRemoteDraft(selection.doc);
    if(!loaded)throw new Error('O rascunho selecionado não foi encontrado');
    showToast('Rascunho selecionado. Enviando…');
    await publishTelegram();
    return;
  }
  if(selection.action==='export'){
    await loadBotExportSource(selection);
    return;
  }
  throw new Error('Ação do bot inválida');
}
