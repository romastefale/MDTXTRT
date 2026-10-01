// Destino, exportação de arquivos e publicação no Telegram/Telegraph.
import { S } from "./state.js";
import { API, FORMAT_CONTRACT } from "./constants.js";
import { editor, one, ui } from "./dom.js";
import { applyAssets, getTg } from "./theme.js";
import { activeMedia, bumpDocumentRevision, draftState, requestMatchesDocument, saveLocal } from "./draft.js";
import { publishHandoff } from "./telegram.js";
import { closePanels, showToast } from "./panels.js";
import { approve } from "./dialog.js";
import { buildRich, buildTelegraph, conversionWarning, download, exportDocumentHTML, exportName, htmlToMarkdown, htmlToText } from "./convert.js";

export function setDestination(value, notify=true, persist=true){
  const changed=S.dest!==value;
  S.dest = value;
  const name = S.dest === 'telegram' ? 'Telegram' : 'Telegraph';
  const publishLabel=S.dest==='telegram'&&S.session!=='ready'?'Abrir no Mini App':'Publicar no '+name;
  // O React troca ícones, rótulos e os itens exclusivos de cada destino.
  ui.update({dest:S.dest,publishLabel});
  applyAssets();
  closePanels();
  if(changed)bumpDocumentRevision();
  if(persist)saveLocal();
  if(notify) showToast('Destino: ' + name);
}
export async function exportFile(format) {
  try {
    const contract=FORMAT_CONTRACT.files[format];
    if(!contract?.export)throw new Error('Formato de exportação inválido');
    const html=exportDocumentHTML();
    const warning=conversionWarning(format,html);
    if(warning&&!await approve(warning))return;
    let content, type, ext;
    if (format === "md") {
      content = htmlToMarkdown(html);
      type = "text/markdown";
      ext = "md";
    } else {
      content = htmlToText(html);
      type = "text/plain";
      ext = "txt";
    }
    const name=exportName(ext);
    if(!await telegramDownload(name,content,ext))download(name,content,type);
    showToast('Download iniciado');
    closePanels();
  } catch (err) {
    showToast(err.message||'Não foi possível exportar o arquivo');
  }
}
// Dentro do Telegram (Bot API 8.0+), o download passa pelo popup nativo WebApp.downloadFile,
// com um link HTTPS curto preparado pelo servidor. Fora dele, segue o download local.
export async function telegramDownload(name,content,format){
  const tg=getTg();
  if(!tg||S.session!=='ready'||typeof tg.downloadFile!=='function'||typeof tg.isVersionAtLeast!=='function'||!tg.isVersionAtLeast('8.0'))return false;
  const res=await fetch(API+'/api/export/download',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},body:JSON.stringify({initData:tg.initData,format,name,content})});
  const data=await readResponse(res);
  if(!res.ok||typeof data.url!=='string'||typeof data.file_name!=='string')throw new Error(data.error||'Não foi possível preparar o download');
  tg.downloadFile({url:data.url,file_name:data.file_name});
  return true;
}
export async function readResponse(res){
  try{return await res.json();}catch{throw new Error('A resposta do serviço não pôde ser lida');}
}
export async function publishCurrent(){
  if(S.busy)return;
  S.busy=true;one('#exportBtn').disabled=true;
  try{if(S.dest==='telegram')await publishTelegram();else await publishTelegraph();}
  finally{S.busy=false;one('#exportBtn').disabled=false;}
}
export async function publishTelegram(){
  if(!editor.childNodes.length){ showToast('Escreva algo antes de enviar'); return; }
  if(S.session!=='ready'){showToast('Abra pelo bot no Telegram');return;}
  if(S.activeHandoff&&S.handoffAction){
    await publishHandoff();
    return;
  }
  const initData=getTg().initData;
  try{
    const p=buildRich();
    const data=activeMedia();
    const localIds=[...editor.querySelectorAll('[data-media-id]')].map(node=>node.getAttribute('data-media-id'));
    if(localIds.some(id=>!S.mediaFiles.has(id)))throw new Error('Há mídia local que precisa ser anexada novamente');
    const form=new FormData();
    form.set('initData',initData);
    form.set('html',p.rich_message.html);
    form.set('draft',JSON.stringify(draftState()));
    for(const media of data)form.set('upload_'+media.id,media.file,media.file.name);
    const res=await fetch(API+'/api/telegram/send',{method:'POST',signal:AbortSignal.timeout(120000),body:form});
    const json=await readResponse(res);
    if(!res.ok)throw new Error(json.error||'Não foi possível enviar a mensagem');
    if(json.via!=='sendRichMessage'||!Number.isInteger(json.messageId)||json.messageId<=0)throw new Error('Resposta do Telegram inválida');
    S.remoteMediaSyncedIds=new Set(data.map(media=>media.id));
    showToast(Number.isInteger(json.previousMessageId)&&json.previousMessageId>0?'Nova versão enviada; a anterior foi preservada no chat':'Mensagem enviada no chat do bot');
  }catch(err){
    showToast(err.name==='TimeoutError'?'Tempo de envio esgotado. Confira o chat antes de tentar novamente.':err instanceof TypeError?'Não foi possível conectar ao Telegram':err.message || 'Não foi possível enviar a mensagem');
  }
}
export async function publishTelegraph(){
  let payload;
  try{ payload = buildTelegraph(); }catch(err){ showToast(err.message); return; }
  const requestDoc=payload.doc,requestRevision=payload.revision;
  try{
    const res = await fetch(API+'/api/telegraph/publish', {
      method:'POST',signal:AbortSignal.timeout(60000),
      headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const result = await readResponse(res);
    if(!res.ok)throw new Error(result.error||'Não foi possível publicar no Telegraph');
    if(typeof result.path!=='string'||!result.path||typeof result.url!=='string'||!/^https:\/\//.test(result.url)||result.doc!==requestDoc||result.revision!==requestRevision)throw new Error('Resposta do Telegraph inválida');
    if(!requestMatchesDocument(requestDoc,requestRevision)){
      showToast('A página foi salva, mas o documento mudou durante a publicação; o resultado não foi aplicado ao documento atual');
      return;
    }
    S.telegraphPath=result.path;
    saveLocal();
    showToast('Página salva no Telegraph');
    if(S.session==='ready'&&typeof getTg()?.openLink==='function')getTg().openLink(result.url,{try_instant_view:true});
    else window.location.assign(result.url);
  }catch(err){ showToast(err.name==='TimeoutError'?'Tempo de publicação esgotado. Confira a página antes de tentar novamente.':err instanceof TypeError?'Não foi possível conectar ao Telegraph':err.message || 'Não foi possível publicar no Telegraph'); }
}
