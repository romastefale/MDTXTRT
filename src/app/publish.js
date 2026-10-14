
import { S } from "./state.js";
import { FORMAT_CONTRACT } from "./constants.js";
import { docName, editor, one, ui } from "./dom.js";
import { applyAssets } from "./theme.js";
import { bumpDocumentRevision, draftState, requestMatchesDocument, saveLocal } from "./draft.js";
import { call } from "./serverless.js";
import { closePanels, showToast } from "./panels.js";
import { approve } from "./dialog.js";
import { buildRich, buildTelegraph, conversionWarning, download, exportDocumentHTML, exportName, htmlToMarkdown, htmlToText } from "./convert.js";
import { STATIC } from "./mode.js";

export function setDestination(value, notify=true, persist=true){
  const changed=S.dest!==value;
  S.dest = value;
  const name = S.dest === 'telegram' ? 'Telegram' : 'Telegraph';
  const publishLabel=STATIC?'Encaminhar':'Publicar no '+name;
  
  ui.update({dest:S.dest,publishLabel});
  
  
  document.documentElement.setAttribute('data-dest',S.dest);
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
    let content, ext;
    if (format === "md") {
      content = htmlToMarkdown(html);
      ext = "md";
    } else {
      content = htmlToText(html);
      ext = "txt";
    }
    const name=exportName(ext);
    if(STATIC){
      download(name,content,ext==='md'?'text/markdown;charset=utf-8':'text/plain;charset=utf-8');
      showToast('Arquivo '+name+' baixado');
      closePanels();
      return;
    }
    await call('exportSend',{format:ext,name,content});
    showToast('Arquivo enviado no chat do bot');
    closePanels();
  } catch (err) {
    showToast(err.message||'Não foi possível exportar o arquivo');
  }
}


export async function publishCurrent(){
  if(S.busy)return;
  if(S.dest==='telegraph'&&!docName.value.trim()){
    one('#scroll')?.scrollTo?.({top:0});docName.focus();
    showToast('O Telegraph precisa de um título');
    return;
  }
  S.busy=true;one('#exportBtn').disabled=true;one('#publishBtn').disabled=true;
  try{if(S.dest==='telegram')await publishTelegram();else await publishTelegraph();}
  finally{S.busy=false;one('#exportBtn').disabled=false;one('#publishBtn').disabled=false;}
}
export async function publishTelegram(){
  if(!editor.childNodes.length){ showToast('Escreva algo antes de enviar'); return; }
  if(S.session!=='ready'){showToast('Abra pelo bot no Telegram');return;}
  try{
    const p=buildRich();
    const draft=draftState();
    const json=await call('telegramPublish',{draft,html:p.rich_message.html});
    if(json.via!=='sendRichMessage'||!Number.isInteger(json.messageId)||json.messageId<=0)throw new Error('Resposta do Telegram inválida');
    showToast(Number.isInteger(json.previousMessageId)&&json.previousMessageId>0?'Nova versão enviada; a anterior foi preservada no chat':'Mensagem enviada no chat do bot');
  }catch(err){
    showToast(err.code==='UNCERTAIN'?(err.message||'O resultado do envio é incerto. Confira o chat antes de tentar novamente.'):err.message||'Não foi possível enviar a mensagem');
  }
}
export async function publishTelegraph(){
  let payload;
  try{ payload = buildTelegraph(); }catch(err){ showToast(err.message); return; }
  const requestDoc=payload.doc,requestRevision=payload.revision;
  try{
    const result = await call('telegraphPublish',payload);
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
  }catch(err){ showToast(err.message || 'Não foi possível publicar no Telegraph'); }
}

// Versão estática: "publicar" vira encaminhar o texto a um destino pelo navegador. Não há token nem servidor:
// o app só abre o endereço público de compartilhamento do Telegram, o editor do Telegraph (texto copiado) ou o
// compartilhamento do sistema. Quem confirma o envio é o próprio destino.
const TELEGRAM_SHARE_LIMIT=3000;
function forwardText(){
  const html=exportDocumentHTML();
  if(!html.trim()||!editor.textContent.trim()&&!editor.querySelector('img,video,hr,table'))throw new Error('Escreva algo antes de encaminhar');
  return htmlToMarkdown(html);
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true;}catch{return false;}
}
export async function forwardTo(kind){
  let text;
  try{text=forwardText();}catch(err){showToast(err.message||'Não foi possível preparar o texto');return;}
  closePanels();
  if(kind==='copy'){
    showToast(await copyText(text)?'Markdown copiado':'Não foi possível copiar neste navegador');
    return;
  }
  if(kind==='share'){
    if(typeof navigator.share!=='function'){showToast('Este navegador não tem compartilhamento do sistema');return;}
    try{await navigator.share({title:docName.value.trim()||'MDTXTRT',text});}
    catch(err){if(err?.name!=='AbortError')showToast('Não foi possível compartilhar');}
    return;
  }
  if(kind==='telegram'){
    const link='https://t.me/share/url?url=%20&text='+encodeURIComponent(text);
    if(link.length<=TELEGRAM_SHARE_LIMIT){window.open(link,'_blank','noopener');return;}
    const copied=await copyText(text);
    window.open('https://t.me/','_blank','noopener');
    showToast(copied?'Texto longo: copiado. Cole na conversa do Telegram':'Texto longo demais para o link e a cópia falhou');
    return;
  }
  if(kind==='telegraph'){
    const copied=await copyText(text);
    window.open('https://telegra.ph/','_blank','noopener');
    showToast(copied?'Texto copiado. Cole no editor do Telegraph':'Abra o Telegraph e cole o texto (a cópia falhou)');
    return;
  }
}
