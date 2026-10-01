// Bot: comandos, importação de arquivos, listas de Mini App e configuração do webhook.
import { randomUUID } from "node:crypto";
import { DomUtils, parseDocument } from "htmlparser2";
import { marked } from "marked";
import { extname } from "node:path";
import { BOT_IMPORT_DOWNLOAD_MAX, BOT_IMPORT_SOURCE_MAX, BOT_TOKEN, DeliveryError, MINI_APP_URL, WEBHOOK_BASE, htmlEscape } from "./config.mjs";
import { ownerFromBotMessage } from "./identity.mjs";
import { draftValid, listPersistentDrafts, listTelegramPublications, listTelegraphPages, readPersistentDraft, saveHandoff, telegraphOwnerFromDraftOwner } from "./storage.mjs";
import { telegramCall, webhookSecret } from "./telegram.mjs";
import { readPages, telegraphContentHTML, verifyTelegraphPage } from "./telegraph.mjs";

export let botLink;
const BOT_COMMANDS = [
  { command: "start", description: "Abrir o MDTXTRT" },
  { command: "app", description: "Abrir o Mini App" },
  { command: "novo", description: "Criar um documento" },
  { command: "rascunhos", description: "Listar e editar rascunhos salvos" },
  { command: "telegraph", description: "Abrir o editor Telegraph" },
  { command: "ajuda", description: "Ver os comandos" },
  { command: "enviar", description: "Escolher e enviar um rascunho" },
  { command: "exportar", description: "Escolher e exportar conteúdo" },
  { command: "importar", description: "Importar Markdown ou TXT" },
];

const PORTABLE_TAGS=new Set("a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div".split(" "));
const PORTABLE_ATTRS=new Set("href name class style src alt tg-spoiler start type reversed value checked disabled controls expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats".split(" "));

function importFileName(value){
  if(typeof value!=="string"||value!==value.trim()||value.length<4||value.length>124||/[\\/\u0000-\u001f]/.test(value))throw new Error("Nome de arquivo inválido");
  const extension=extname(value).toLowerCase();
  if(![".md",".txt"].includes(extension))throw new Error("Extensão inválida: envie apenas arquivos .md ou .txt");
  const name=value.slice(0,-extension.length);
  if(!name||name.length>120||/^\.+$/.test(name))throw new Error("Nome de arquivo inválido");
  return {fileName:value,name,extension};
}

function strictUTF8(bytes){
  if(!Buffer.isBuffer(bytes))throw new Error("Conteúdo do arquivo inválido");
  const source=bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?bytes.subarray(3):bytes;
  try{return new TextDecoder("utf-8",{fatal:true}).decode(source);}
  catch{throw new Error("Conteúdo inválido: o arquivo deve usar UTF-8");}
}

function normalizedPortableHTML(html,label="Markdown"){
  const doc=parseDocument(String(html??""));
  const walk=node=>{
    if(node.type==="text")return;
    if(node.type!=="tag")throw new Error("Conteúdo "+label+" não suportado");
    const tag=node.name;
    if(!PORTABLE_TAGS.has(tag))throw new Error("Elemento "+label+" não suportado: "+tag);
    delete node.attribs.contenteditable;
    delete node.attribs.draggable;
    for(const [key,value] of Object.entries({...node.attribs})){
      if(key==="controls"&&["video","audio"].includes(tag)){delete node.attribs[key];continue;}
      if(key==="disabled"&&tag==="input"&&node.attribs.type==="checkbox"){delete node.attribs[key];continue;}
      if(!PORTABLE_ATTRS.has(key) ||
        key==="class"&&!((tag==="code"&&/^language-[a-z0-9+-]+$/i.test(value))||(["p","footer"].includes(tag)&&value==="tg-footer")) ||
        key==="style"&&!(tag==="tg-button"&&["link","primary","success","danger"].includes(value)))throw new Error("Atributo "+label+" não suportado: "+key);
      if(["src","href","url"].includes(key)&&!/^(https?:|mailto:|tel:|tg:|#)/i.test(value))throw new Error("Link "+label+" inválido");
    }
    node.children?.forEach(walk);
  };
  doc.children.forEach(walk);
  return DomUtils.getInnerHTML(doc,{encodeEntities:"utf8"});
}

function importedDraft(fileName,text){
  const file=importFileName(fileName);
  const html=file.extension===".md"
    ?normalizedPortableHTML(marked.parse(text,{gfm:true,breaks:false}),"Markdown")
    :"<p>"+htmlEscape(text).replace(/\n/g,"<br>")+"</p>";
  const draft={
    version:2,
    name:file.name,
    html,
    dest:"telegram",
    telegraphPath:"",
    docId:randomUUID(),
    revision:0,
    importedMd:file.extension===".md"?text:"",
    importedTxt:file.extension===".txt"?text:"",
    importedHtml:html,
    media:[]
  };
  draftValid(draft);
  return draft;
}

async function downloadTelegramFile(filePath){
  if(typeof filePath!=="string"||!filePath)throw new Error("O Telegram não forneceu o caminho do arquivo");
  let response;
  try{
    response=await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`,{method:"GET",signal:AbortSignal.timeout(20000)});
  }catch(error){
    console.error("Telegram file download",error);
    throw new DeliveryError("Falha de rede ao baixar o arquivo do Telegram; o resultado do download é incerto","uncertain");
  }
  if(!response.ok)throw new DeliveryError("O Telegram confirmou falha no download do arquivo (HTTP "+response.status+")","failed");
  let bytes;
  try{bytes=Buffer.from(await response.arrayBuffer());}
  catch(error){
    console.error("Telegram file body",error);
    throw new DeliveryError("A resposta de download do Telegram não pôde ser lida","uncertain");
  }
  if(bytes.length>BOT_IMPORT_DOWNLOAD_MAX)throw new Error("Arquivo acima do limite de 20 MB do Telegram Bot API");
  if(bytes.length>BOT_IMPORT_SOURCE_MAX)throw new Error("Arquivo grande demais para o contrato de importação do MDTXTRT");
  return bytes;
}

async function importTelegramDocument(document,chatId){
  if(!document||typeof document!=="object"||Array.isArray(document))throw new Error("Documento sem arquivo");
  const file=importFileName(document.file_name);
  if(typeof document.file_id!=="string"||!document.file_id)throw new Error("Documento sem arquivo identificável");
  if(document.file_size!==undefined){
    if(!Number.isSafeInteger(document.file_size)||document.file_size<0)throw new Error("Tamanho de arquivo inválido");
    if(document.file_size>BOT_IMPORT_DOWNLOAD_MAX)throw new Error("Arquivo acima do limite de 20 MB do Telegram Bot API");
    if(document.file_size>BOT_IMPORT_SOURCE_MAX)throw new Error("Arquivo grande demais para o contrato de importação do MDTXTRT");
  }
  const remote=await telegramCall("getFile",{file_id:document.file_id},{
    connection:"Falha de rede ao solicitar o arquivo ao Telegram",
    invalidResponse:"O Telegram retornou metadados de arquivo inválidos",
    failed:"O Telegram confirmou que o arquivo não está disponível para download"
  });
  if(!remote||typeof remote!=="object"||typeof remote.file_path!=="string"||!remote.file_path)throw new Error("O Telegram não forneceu o caminho do arquivo");
  if(remote.file_size!==undefined){
    if(!Number.isSafeInteger(remote.file_size)||remote.file_size<0)throw new Error("Tamanho de arquivo retornado pelo Telegram inválido");
    if(remote.file_size>BOT_IMPORT_DOWNLOAD_MAX)throw new Error("Arquivo acima do limite de 20 MB do Telegram Bot API");
    if(remote.file_size>BOT_IMPORT_SOURCE_MAX)throw new Error("Arquivo grande demais para o contrato de importação do MDTXTRT");
  }
  const bytes=await downloadTelegramFile(remote.file_path);
  const expected=document.file_size??remote.file_size;
  if(expected!==undefined&&bytes.length!==expected)throw new Error("Download incompleto: o tamanho recebido não corresponde ao documento");
  const text=strictUTF8(bytes);
  const draft=importedDraft(file.fileName,text);
  const token=saveHandoff(draft,[],null,"import",String(chatId));
  return {draft,token};
}

async function sendBotRich(chatId,html,replyTo){
  const body = { chat_id: chatId, rich_message: { html } };
  if (replyTo) body.reply_parameters = { message_id: replyTo };
  return telegramCall("sendRichMessage", body);
}

function documentLaunchURL(base,newToken="",view="") {
  const url=new URL(base);
  if(newToken){
    if(!/^[a-f0-9]{32}$/.test(newToken))throw new Error("Token de novo documento inválido");
    url.searchParams.set("new",newToken);
  }
  if(view){
    if(!["library","telegraph"].includes(view))throw new Error("Tela do Mini App inválida");
    url.searchParams.set("view",view);
  }
  return url.href;
}

function appButton(newToken="",view="") {
  const miniURL=documentLaunchURL(MINI_APP_URL,newToken,view);
  const miniLabel=newToken?"Criar novo documento no Mini App":view==="telegraph"?"Abrir Telegraph no Mini App":view==="library"?"Abrir rascunhos no Mini App":"Mini App MDTXTRT";
  return "<tg-button-row align=\"center\"><tg-button type=\"web_app\" style=\"success\" url=\"" + htmlEscape(miniURL) + "\">"+miniLabel+"</tg-button></tg-button-row>";
}

function appMessage(title,newToken="",view="") {
  return "<h1>MDTXTRT</h1><p>" + title + "</p>" + appButton(newToken,view);
}

const BOT_WEB_APP_LIST_SIZE=8;

function botButtonLabel(value,prefix=""){
  const text=(prefix+String(value||"Sem título")).replace(/\s+/g," ").trim();
  return Array.from(text).slice(0,58).join("");
}

function botWebAppRow(label,url,style="success"){
  const parsed=new URL(String(url||""));
  if(parsed.protocol!=="https:")throw new Error("Link do Mini App inválido");
  return "<tg-button-row align=\"center\"><tg-button type=\"web_app\" style=\""+style+"\" url=\""+htmlEscape(parsed.href)+"\">"+htmlEscape(botButtonLabel(label))+"</tg-button></tg-button-row>";
}

function draftLaunchURL(base,doc){
  if(!/^[a-f0-9-]{36}$/i.test(String(doc||"")))throw new Error("Documento inválido");
  const url=new URL(base);
  url.searchParams.set("doc",String(doc));
  return url.href;
}

function telegraphEditorLaunchURL(base){
  const url=new URL(base);
  url.searchParams.set("dest","telegraph");
  return url.href;
}

function botActionLaunchURL(base,action,kind,doc){
  if(!["send","export"].includes(action))throw new Error("Ação do Mini App inválida");
  if(!/^[a-f0-9-]{36}$/i.test(String(doc||"")))throw new Error("Documento inválido");
  if(action==="send"&&kind!=="d")throw new Error("Origem de envio inválida");
  if(action==="export"&&!["d","t","g"].includes(kind))throw new Error("Origem de exportação inválida");
  const url=new URL(base);
  url.searchParams.set("botAction",action);
  url.searchParams.set("source",kind);
  url.searchParams.set("doc",String(doc));
  return url.href;
}

function botWebAppPages(title,intro,items,tail=""){
  if(!items.length)return ["<h1>"+htmlEscape(title)+"</h1><p>Nenhum item foi encontrado.</p>"+(tail||appButton())];
  const pages=[];
  for(let start=0;start<items.length;start+=BOT_WEB_APP_LIST_SIZE){
    const page=Math.floor(start/BOT_WEB_APP_LIST_SIZE)+1;
    const total=Math.ceil(items.length/BOT_WEB_APP_LIST_SIZE);
    let html="<h1>"+htmlEscape(title)+"</h1><p>"+intro+(total>1?" Página "+page+" de "+total+".":"")+"</p>";
    for(const item of items.slice(start,start+BOT_WEB_APP_LIST_SIZE))html+=botWebAppRow(item.label,item.url,item.style||"success");
    if(start+BOT_WEB_APP_LIST_SIZE>=items.length&&tail)html+=tail;
    pages.push(html);
  }
  return pages;
}

async function sendBotRichPages(chatId,pages,replyTo=0){
  for(let index=0;index<pages.length;index++)await sendBotRich(chatId,pages[index],index===0?replyTo:0);
}

function botDraftListPages(owner){
  const drafts=listPersistentDrafts(owner);
  if(!drafts.length)return ["<h1>Rascunhos</h1><p>Nenhum rascunho persistido foi encontrado. Use <b>/novo</b> para começar.</p>"+appButton()];
  const items=drafts.map(item=>({
    label:"Editar · "+item.name,
    url:draftLaunchURL(MINI_APP_URL,item.docId)
  }));
  return botWebAppPages(
    "Rascunhos",
    "Escolha um rascunho para abri-lo diretamente no editor do Mini App.",
    items,
    botWebAppRow("Abrir biblioteca completa",documentLaunchURL(MINI_APP_URL,"","library"),"link")
  );
}

function botSendListPages(owner){
  const drafts=listPersistentDrafts(owner);
  if(!drafts.length)return ["<h1>Enviar rascunho</h1><p>Nenhum rascunho persistido foi encontrado.</p>"+appButton()];
  const items=drafts.map(item=>({
    label:"Enviar · "+item.name,
    url:botActionLaunchURL(MINI_APP_URL,"send","d",item.docId),
    style:"success"
  }));
  return botWebAppPages("Enviar rascunho","Qual rascunho você quer enviar nesta conversa?",items);
}

function exportChoices(owner){
  const drafts=listPersistentDrafts(owner);
  const telegram=listTelegramPublications(owner,drafts);
  const telegraph=listTelegraphPages(owner,drafts);
  return [
    ...drafts.map(item=>({kind:"d",docId:item.docId,name:item.name,label:"Rascunho · "+item.name})),
    ...telegram.map(item=>({kind:"t",docId:item.docId,name:item.name,label:"Telegram · "+item.name})),
    ...telegraph.map(item=>({kind:"g",docId:item.docId,name:item.name,label:"Telegraph · "+item.name}))
  ];
}

function botExportListPages(owner){
  const choices=exportChoices(owner);
  if(!choices.length)return ["<h1>Exportar</h1><p>Nenhum rascunho ou publicação foi encontrado.</p>"+appButton()];
  const items=choices.map(item=>({
    label:item.label,
    url:botActionLaunchURL(MINI_APP_URL,"export",item.kind,item.docId),
    style:"success"
  }));
  return botWebAppPages(
    "Exportar",
    "Qual rascunho ou publicação você quer exportar?",
    items
  );
}

export async function selectedExportDocument(owner,kind,doc){
  if(!["d","t","g"].includes(kind)||!/^[a-f0-9-]{36}$/i.test(doc))throw new Error("Seleção de exportação inválida");
  if(kind==="g"){
    const mapped=readPages()[telegraphOwnerFromDraftOwner(owner)+":"+doc]||"";
    if(mapped&&typeof mapped!=="string")throw new Error("A publicação Telegraph ainda precisa de confirmação");
    if(!mapped)throw new Error("Publicação Telegraph não encontrada");
    const page=await verifyTelegraphPage(mapped);
    if(!Array.isArray(page.content))throw new Error("O Telegraph não retornou o conteúdo da página");
    return {name:String(page.title||"Página Telegraph").slice(0,256),html:telegraphContentHTML(page.content)};
  }
  const record=readPersistentDraft(owner,doc);
  if(!record)throw new Error("Rascunho não encontrado");
  if(kind==="d")return {name:record.draft.name,html:record.draft.html};
  const publication=record.publication.telegram;
  if(!publication||publication.status!=="succeeded")throw new Error("Publicação Telegram não encontrada");
  if(!publication.snapshot)throw new Error("Esta publicação Telegram não possui snapshot exato da revisão publicada");
  return {name:publication.snapshot.name,html:publication.snapshot.html};
}

function telegraphEditorButton(){
  return botWebAppRow("Abrir editor Telegraph",telegraphEditorLaunchURL(MINI_APP_URL),"success");
}

function importAppButton(token){
  if(!/^[a-f0-9]{32}$/.test(token))throw new Error("Token de importação inválido");
  const url=new URL(MINI_APP_URL);
  url.searchParams.set("handoff",token);
  return botWebAppRow("Continuar no Mini App",url.href,"success");
}

async function replyImportResult(message,document){
  const chatId=message.chat.id;
  try{
    const result=await importTelegramDocument(document,chatId);
    const source=extname(document.file_name).toLowerCase()===".md"?"Markdown":"TXT";
    const html="<h1>Arquivo importado</h1><p><b>"+htmlEscape(document.file_name)+"</b> foi validado como "+source+" e preparado como um novo documento.</p><p>Nenhum conteúdo foi publicado. Ao continuar, o Mini App preserva o documento local ativo antes de abrir esta importação.</p>"+importAppButton(result.token);
    await sendBotRich(chatId,html,message.message_id);
  }catch(error){
    const messageText=error instanceof Error?error.message:"Não foi possível importar o arquivo";
    await sendBotRich(chatId,"<h1>Importação não concluída</h1><p>"+htmlEscape(messageText)+"</p><p>Envie um arquivo UTF-8 com extensão <b>.md</b> ou <b>.txt</b>.</p>",message.message_id);
  }
}

export async function handleBotUpdate(update) {
  const message = update.message;
  if (!message || !message.chat) return;
  const text=typeof message.text==="string"?message.text:"";
  const caption=typeof message.caption==="string"?message.caption:"";
  const textMatch = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+[\s\S]*)?$/i.exec(text);
  const captionMatch = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+[\s\S]*)?$/i.exec(caption);
  const command=(textMatch?.[1]||captionMatch?.[1]||"").toLowerCase();
  const directDocument=message.document&&(!captionMatch||command==="importar");
  const importIntent=Boolean(directDocument)||command==="importar";
  const chatId = message.chat.id;
  if (message.chat.type !== "private") {
    if(importIntent||textMatch)await sendBotRich(chatId, "<p>Abra o chat privado do MDTXTRT para usar o Mini App, importar e exportar arquivos.</p>");
    return;
  }
  if(importIntent){
    const document=message.document||message.reply_to_message?.document;
    if(!document){
      await sendBotRich(chatId,"<p>Envie um arquivo <b>.md</b> ou <b>.txt</b>, ou responda a um documento com <b>/importar</b>.</p>",message.message_id);
      return;
    }
    await replyImportResult(message,document);
    return;
  }
  if(message.document&&captionMatch){
    await sendBotRich(chatId,"<p>O documento anexado só pode ser usado com <b>/importar</b>. <b>/enviar</b> e <b>/exportar</b> trabalham exclusivamente com rascunhos e publicações persistidos.</p>",message.message_id);
    return;
  }
  if(!textMatch)return;
  if (command === "start" || command === "app") {
    await sendBotRich(chatId, appMessage("Edite, publique e exporte seus textos do Telegram."), message.message_id);
    return;
  }
  if (command === "novo") {
    const newToken=randomUUID().replace(/-/g,"");
    await sendBotRich(chatId, appMessage("Crie outro documento sem substituir o rascunho local atual.",newToken), message.message_id);
    return;
  }
  if (command === "rascunhos") {
    const owner=ownerFromBotMessage(message);
    await sendBotRichPages(chatId,botDraftListPages(owner),message.message_id);
    return;
  }
  if (command === "telegraph") {
    await sendBotRich(chatId,"<h1>Telegraph</h1><p>Abra o Mini App já no editor configurado para Telegraph.</p>"+telegraphEditorButton(),message.message_id);
    return;
  }
  if (command === "ajuda") {
    const html = "<h1>Comandos</h1><p><b>/app</b> abre o Mini App.</p><p><b>/novo</b> cria outro documento sem substituir o rascunho local atual.</p><p><b>/rascunhos</b> lista os rascunhos no chat e abre o documento escolhido diretamente no Mini App.</p><p><b>/telegraph</b> abre o Mini App já no editor Telegraph.</p><p><b>/enviar</b> lista os rascunhos para escolher qual será enviado.</p><p><b>/exportar</b> lista rascunhos e publicações para escolher o que exportar em TXT ou Markdown.</p><p><b>/importar</b> importa um documento .md ou .txt anexado ou respondido e continua diretamente no Mini App.</p>" + appButton();
    await sendBotRich(chatId, html, message.message_id);
    return;
  }
  if (command === "enviar") {
    const owner=ownerFromBotMessage(message);
    await sendBotRichPages(chatId,botSendListPages(owner),message.message_id);
    return;
  }
  if (command === "exportar") {
    const owner=ownerFromBotMessage(message);
    await sendBotRichPages(chatId,botExportListPages(owner),message.message_id);
    return;
  }
}

export async function configureBot(){
  const bot=await telegramCall("getMe",{});
  if(!/^[A-Za-z0-9_]{5,32}$/.test(bot.username||""))throw new Error("Bot sem nome de usuário");
  botLink="https://t.me/"+bot.username;
  const secret=webhookSecret();
  await telegramCall("setMyCommands",{commands:BOT_COMMANDS,scope:{type:"all_private_chats"}});
  await telegramCall("deleteMyCommands",{scope:{type:"default"}});
  await telegramCall("setChatMenuButton",{menu_button:{type:"web_app",text:"Mini App MDTXTRT",web_app:{url:MINI_APP_URL}}});
  await telegramCall("setWebhook",{url:WEBHOOK_BASE+"/telegram/webhook",secret_token:secret,allowed_updates:["message"]});
  console.log("Telegram ready");
}
