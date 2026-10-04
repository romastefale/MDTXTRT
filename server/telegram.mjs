// Bot API: chamadas, validação de Rich Messages e publicação no Telegram.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { openAsBlob } from "node:fs";
import { DomUtils, parseDocument } from "htmlparser2";
import { BOT_TOKEN, DeliveryError, HttpError, asHttpError, htmlEscape } from "./config.mjs";
import { draftOwner, userFromInitData } from "./identity.mjs";
import { readPersistentDraft, savePersistentDraft, validateTelegramUpload, writePersistentRecord } from "./storage.mjs";

export async function telegramCall(method, body, messages={}) {
  let res;
  try {
    const options = { method: "POST", signal: AbortSignal.timeout(15000) };
    if (body instanceof FormData) options.body = body;
    else {
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, options);
  } catch (error) {
    console.error("Telegram", method, error);
    throw new DeliveryError(messages.connection||"Não foi possível conectar ao Telegram","uncertain");
  }
  let json;
  try { json = await res.json(); } catch { throw new DeliveryError(messages.invalidResponse||"O Telegram retornou uma resposta inválida","uncertain"); }
  if (!json.ok) {
    console.error("Telegram", method, json.description || "Falha na chamada");
    throw telegramRejection(json,messages.failed||"O Telegram não aceitou a publicação");
  }
  return json.result;
}

// Recusas que a pessoa consegue resolver ganham mensagem própria (Bot API, ResponseParameters):
// 429 traz parameters.retry_after, em segundos, e nada foi entregue; 403 significa que o bot
// não pode escrever no chat, quase sempre porque foi bloqueado ou nunca foi iniciado.
export function telegramRejection(json,fallback){
  const code=Number(json?.error_code||0);
  const description=String(json?.description||"");
  if(code===429){
    const wait=Number(json?.parameters?.retry_after);
    const seconds=Number.isSafeInteger(wait)&&wait>0?wait:0;
    const error=new DeliveryError(seconds
      ?"O Telegram limitou os envios por um momento; tente de novo em "+seconds+" s"
      :"O Telegram limitou os envios por um momento; tente de novo daqui a pouco","failed");
    error.retryAfter=seconds||1;
    return error;
  }
  if(code===403){
    return new DeliveryError(/blocked/i.test(description)
      ?"Você bloqueou o bot MDTXTRT no Telegram; desbloqueie-o no chat do bot e tente de novo"
      :"O bot MDTXTRT não pode escrever nesta conversa; abra o chat do bot, toque em Iniciar e tente de novo","failed");
  }
  return new DeliveryError(fallback,"failed");
}

function richEmojiImage(value){
  let url;
  try{url=new URL(String(value||""));}catch{return false;}
  return url.protocol==="tg:"&&url.hostname==="emoji"&&/^\d+$/.test(url.searchParams.get("id")||"")&&[...url.searchParams.keys()].every(key=>key==="id");
}

async function sendRichToChat(chatId,html,files=[],replyTo=0){
  let body;
  try{
    richValid(html);
    chatId=String(chatId||"");
    if(!/^\d+$/.test(chatId))throw new Error("Chat Telegram inválido");
    if(!Array.isArray(files)||files.length>50)throw new Error("Mídias inválidas");
    const fileMap=new Map();
    for(const file of files){
      if(fileMap.has(file.id))throw new Error("Mídias duplicadas");
      validateTelegramUpload(file,file.kind);
      fileMap.set(file.id,file);
    }
    const replying=Number.isInteger(replyTo)&&replyTo>0;
    const doc=parseDocument(String(html));
    const media=[],attached=new Set();
    const kinds={img:"photo",video:"video",audio:"audio","tg-document":"document"};
    const visit=node=>{
      if(node.type==="tag"&&kinds[node.name]){
        const kind=kinds[node.name],src=node.attribs.src||"";
        if(node.name==="img"&&richEmojiImage(src)){node.children?.forEach(visit);return;}
        let id,source,mediaType=kind;
        if(/^https?:\/\//i.test(src)){
          id=randomUUID().replace(/-/g,"");
          source=src;
        }else if(src.startsWith("tg://")){
          const url=new URL(src);
          id=url.searchParams.get("id")||"";
          if(url.hostname!==kind)throw new Error("Tipo de mídia incompatível");
          const file=fileMap.get(id);
          if(!file)throw new Error("Anexe a mídia novamente antes de publicar");
          const expected=kind==="audio"?(file.kind==="voice"?"voice":"audio"):({photo:"image",video:"video",document:"document"})[kind];
          if(file.kind!==expected)throw new Error("Tipo de mídia incompatível");
          source="attach://upload_"+id;
          if(file.kind==="voice")mediaType="voice_note";
          attached.add(id);
        }else throw new Error("Endereço de mídia inválido");
        if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new Error("Identificador de mídia inválido");
        node.attribs.src="tg://"+kind+"?id="+id;
        media.push({id,media:{type:mediaType,media:source}});
      }
      node.children?.forEach(visit);
    };
    doc.children.forEach(visit);
    if(attached.size!==fileMap.size||[...fileMap.keys()].some(id=>!attached.has(id)))throw new Error("Há mídia anexada que não está no documento");
    const rich={html:DomUtils.getInnerHTML(doc,{encodeEntities:"utf8"})};
    if(media.length)rich.media=media;
    if(files.length){
      const form=new FormData();
      form.set("chat_id",chatId);
      if(replying)form.set("reply_parameters",JSON.stringify({message_id:replyTo}));
      form.set("rich_message",JSON.stringify(rich));
      for(const file of files){
        const blob=await openAsBlob(file.path,{type:file.mime});
        form.set("upload_"+file.id,blob,file.name);
      }
      body=form;
    }else body={chat_id:chatId,...(replying?{reply_parameters:{message_id:replyTo}}:{}),rich_message:rich};
  }catch(error){
    throw asHttpError(error,400,"Dados inválidos para publicação");
  }
  const msg=await telegramCall("sendRichMessage",body);
  const returnedId=Number(msg?.message_id||0);
  if(!Number.isInteger(returnedId)||returnedId<=0)throw new DeliveryError("O Telegram não confirmou o identificador da mensagem","uncertain");
  return {via:"sendRichMessage",messageId:returnedId,...(replyTo>0?{replyTo}:{})};
}

async function sendRich(initData,html,files=[],replyTo=0){
  let chatId;
  try{({chatId}=userFromInitData(String(initData||"")));}
  catch(error){throw asHttpError(error,400,"Dados inválidos para publicação");}
  return sendRichToChat(chatId,html,files,replyTo);
}

async function sendTelegramRevisionNotice(owner,draft,previousMessageId){
  const title=String(draft?.name||"Documento").trim()||"Documento";
  const html="<p><b>Atualização de publicação</b></p><p><b>"+htmlEscape(title)+"</b> recebeu uma nova versão. A versão anterior permanece no histórico desta conversa; o conteúdo atualizado será enviado na próxima mensagem.</p>";
  const body={chat_id:owner.chatId,reply_parameters:{message_id:previousMessageId},rich_message:{html}};
  const msg=await telegramCall("sendRichMessage",body);
  const messageId=Number(msg?.message_id||0);
  if(!Number.isInteger(messageId)||messageId<=0)throw new DeliveryError("O Telegram não confirmou o aviso da atualização","uncertain");
  return messageId;
}

async function publishTelegramPersistentForOwner(owner,draft,html,files=[]){
  if(!owner||owner.kind!=="telegram"||!/^\d+$/.test(String(owner.telegramUserId||""))||!/^\d+$/.test(String(owner.chatId||"")))throw new HttpError(400,"Publicação Telegram exige identidade Telegram");
  let record=savePersistentDraft(owner,draft,files);
  let prior=record.publication.telegram;
  if(prior?.status==="pending"||prior?.status==="uncertain"){
    throw new HttpError(409,prior.error||"O resultado da publicação anterior é incerto; confira o chat antes de publicar novamente");
  }
  if(prior?.pendingUpdate?.status==="pending"||prior?.pendingUpdate?.status==="uncertain"){
    throw new HttpError(409,prior.pendingUpdate.error||"Uma atualização anterior ainda não foi confirmada; confira o chat antes de publicar novamente");
  }

  if(prior?.status==="succeeded"){
    const history=Array.isArray(prior.history)&&prior.history.length
      ?prior.history.slice(-99)
      :[{messageId:prior.messageId,revision:prior.revision,publishedAt:prior.updatedAt,noticeMessageId:0}];
    let pending=prior.pendingUpdate||null;
    if(!pending||pending.revision!==draft.revision||pending.phase!=="content"||pending.status!=="failed"){
      pending={status:"pending",phase:"notice",revision:draft.revision,noticeMessageId:0,startedAt:Date.now(),error:""};
      prior={...prior,history,pendingUpdate:pending,updatedAt:Date.now()};
      record.publication.telegram=prior;
      record.updatedAt=Date.now();
      writePersistentRecord(owner,record);
      try{
        pending.noticeMessageId=await sendTelegramRevisionNotice(owner,draft,prior.messageId);
        pending.phase="content";
        pending.status="pending";
        pending.error="";
        record.publication.telegram={...prior,pendingUpdate:{...pending},updatedAt:Date.now()};
        record.updatedAt=Date.now();
        writePersistentRecord(owner,record);
      }catch(error){
        record=readPersistentDraft(owner,draft.docId)||record;
        prior=record.publication.telegram||prior;
        const failed=error instanceof DeliveryError&&error.outcome==="failed";
        prior.pendingUpdate={...pending,status:failed?"failed":"uncertain",error:error instanceof Error?error.message:"Resultado do aviso incerto"};
        prior.updatedAt=Date.now();
        record.publication.telegram=prior;
        record.updatedAt=Date.now();
        try{writePersistentRecord(owner,record);}catch(storageError){console.error("Telegram revision notice provenance",storageError);}
        throw error;
      }
    }else{
      pending={...pending,status:"pending",error:"",startedAt:Date.now()};
      prior={...prior,history,pendingUpdate:pending,updatedAt:Date.now()};
      record.publication.telegram=prior;
      record.updatedAt=Date.now();
      writePersistentRecord(owner,record);
    }

    let result;
    try{
      result=await sendRichToChat(owner.chatId,html,files,pending.noticeMessageId);
    }catch(error){
      record=readPersistentDraft(owner,draft.docId)||record;
      prior=record.publication.telegram||prior;
      const failed=error instanceof DeliveryError&&error.outcome==="failed"||error instanceof HttpError;
      prior.pendingUpdate={...pending,status:failed?"failed":"uncertain",phase:"content",error:error instanceof Error?error.message:"Resultado da nova versão incerto"};
      prior.updatedAt=Date.now();
      record.publication.telegram=prior;
      record.updatedAt=Date.now();
      try{writePersistentRecord(owner,record);}catch(storageError){console.error("Telegram revision provenance",storageError);}
      throw error;
    }

    record=readPersistentDraft(owner,draft.docId)||record;
    prior=record.publication.telegram||prior;
    const nextHistory=[...(Array.isArray(prior.history)?prior.history:history),{
      messageId:result.messageId,
      revision:draft.revision,
      publishedAt:Date.now(),
      noticeMessageId:pending.noticeMessageId
    }].slice(-100);
    record.publication.telegram={
      status:"succeeded",
      telegramUserId:owner.telegramUserId,
      chatId:owner.chatId,
      messageId:result.messageId,
      revision:draft.revision,
      updatedAt:Date.now(),
      error:"",
      snapshot:{revision:draft.revision,name:draft.name,html:draft.html},
      history:nextHistory,
      pendingUpdate:null
    };
    record.updatedAt=Date.now();
    try{writePersistentRecord(owner,record);}
    catch(error){
      console.error("Telegram revision provenance",error);
      throw new DeliveryError("A nova versão foi enviada, mas seu vínculo persistente não pôde ser confirmado; não repita o envio","uncertain");
    }
    return {...result,previousMessageId:prior.messageId,noticeMessageId:pending.noticeMessageId,revision:draft.revision};
  }

  record.publication.telegram={
    status:"pending",
    telegramUserId:owner.telegramUserId,
    chatId:owner.chatId,
    messageId:0,
    revision:draft.revision,
    updatedAt:Date.now(),
    error:"",
    history:[],
    pendingUpdate:null
  };
  record.updatedAt=Date.now();
  writePersistentRecord(owner,record);
  let result;
  try{
    result=await sendRichToChat(owner.chatId,html,files);
  }catch(error){
    record=readPersistentDraft(owner,draft.docId)||record;
    if(error instanceof DeliveryError&&error.outcome==="failed"||error instanceof HttpError){
      record.publication.telegram=null;
    }else{
      record.publication.telegram={
        status:"uncertain",
        telegramUserId:owner.telegramUserId,
        chatId:owner.chatId,
        messageId:0,
        revision:draft.revision,
        updatedAt:Date.now(),
        error:error instanceof Error?error.message:"Resultado da publicação incerto",
        history:[],
        pendingUpdate:null
      };
    }
    record.updatedAt=Date.now();
    try{writePersistentRecord(owner,record);}catch(storageError){console.error("Telegram provenance failure",storageError);}
    throw error;
  }
  record=readPersistentDraft(owner,draft.docId)||record;
  const publishedAt=Date.now();
  record.publication.telegram={
    status:"succeeded",
    telegramUserId:owner.telegramUserId,
    chatId:owner.chatId,
    messageId:result.messageId,
    revision:draft.revision,
    updatedAt:publishedAt,
    error:"",
    snapshot:{revision:draft.revision,name:draft.name,html:draft.html},
    history:[{messageId:result.messageId,revision:draft.revision,publishedAt,noticeMessageId:0}],
    pendingUpdate:null
  };
  record.updatedAt=publishedAt;
  try{writePersistentRecord(owner,record);}
  catch(error){
    console.error("Telegram publication provenance",error);
    throw new DeliveryError("Mensagem enviada, mas o vínculo com o publicador não pôde ser persistido; não repita o envio","uncertain");
  }
  return result;
}

export async function publishTelegramPersistent(initData,draft,html,files=[]){
  return publishTelegramPersistentForOwner(draftOwner({initData}),draft,html,files);
}

export function webhookSecret(){
  return createHmac("sha256",BOT_TOKEN).update("MDTXTRT_WEBHOOK").digest("hex");
}

export function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

function richTextLength(nodes){
  let length=0;
  const walk=node=>{
    if(node.type==="text"){length+=Array.from(node.data||"").length;return;}
    if(node.type==="tag"&&node.name==="img"&&richEmojiImage(node.attribs?.src)){
      length+=Array.from(node.attribs.alt||"").length;
    }
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return length;
}

export function richValid(html){
  if(typeof html!=="string"||!html.trim())throw new Error("Conteúdo vazio");
  const doc=parseDocument(html);
  if(richTextLength(doc.children)>32768)throw new Error("A mensagem excede 32768 caracteres");
  const tags=new Set("a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption tg-map tg-collage tg-slideshow table caption tr th td details summary tg-math-block tg-button tg-button-row br".split(" "));
  const attrs={
    a:new Set(["href","name"]),code:new Set(["class"]),ol:new Set(["start","type","reversed"]),li:new Set(["value","type"]),input:new Set(["type","checked"]),
    blockquote:new Set(["expandable"]),img:new Set(["src","alt","tg-spoiler"]),video:new Set(["src","tg-spoiler"]),audio:new Set(["src"]),"tg-document":new Set(["src"]),
    "tg-reference":new Set(["name"]),"tg-emoji":new Set(["emoji-id"]),"tg-time":new Set(["unix","format"]),"tg-map":new Set(["lat","long","zoom","width","height"]),
    table:new Set(["bordered","striped","compact"]),th:new Set(["colspan","rowspan","align","valign"]),td:new Set(["colspan","rowspan","align","valign"]),
    details:new Set(["open"]),"tg-button-row":new Set(["align"]),"tg-button":new Set(["type","style","url","data","query","text","forward-text","request-write-access","allow-user-chats","allow-bot-chats","allow-group-chats","allow-channel-chats"])
  };
  const media=new Set(["img","video","audio","tg-document"]);
  const blocks=new Set(["h1","h2","h3","h4","h5","h6","p","pre","footer","hr","ul","ol","li","blockquote","aside","figure","tg-map","tg-collage","tg-slideshow","table","tr","details","tg-math-block","tg-button-row"]);
  const richTextContainers=new Set(["a","b","strong","i","em","u","ins","s","strike","del","code","mark","sub","sup","tg-spoiler","tg-reference","tg-emoji","tg-time","tg-math","figcaption","caption","summary","cite","aside"]);
  const buttons=new Set(["url","callback_data","web_app","login_url","switch_inline_query","switch_inline_query_current_chat","switch_inline_query_chosen_chat","copy_text","disabled"]);
  const bool=new Set(["reversed","checked","expandable","tg-spoiler","bordered","striped","compact","open","request-write-access","allow-user-chats","allow-bot-chats","allow-group-chats","allow-channel-chats"]);
  let blockCount=0,mediaCount=0;
  const urlValid=(value,mediaTag=false)=>{
    let url;try{url=new URL(value);}catch{throw new Error("Link inválido");}
    if(mediaTag){
      if(["http:","https:"].includes(url.protocol))return;
      if(url.protocol==="tg:"&&/^(photo|video|audio|document)$/.test(url.hostname)&&/^[A-Za-z0-9_-]{1,64}$/.test(url.searchParams.get("id")||""))return;
      throw new Error("Link de mídia inválido");
    }
    if(!["https:","http:","tg:","mailto:","tel:"].includes(url.protocol))throw new Error("Link inválido");
  };
  const walk=(node,depth=0,parent="",insideButton=false,insideCell=false,insideRichText=false)=>{
    if(depth>16)throw new Error("A mensagem excede 16 níveis de aninhamento");
    if(node.type==="text")return;
    if(node.type!=="tag"||!tags.has(node.name))throw new Error("O conteúdo contém elemento inválido: "+(node.name||node.type));
    if(insideButton&&!['tg-emoji','tg-time'].includes(node.name))throw new Error("Texto de botão aceita apenas texto, emoji personalizado e data/hora");
    if(blocks.has(node.name)&&++blockCount>500)throw new Error("A mensagem excede 500 blocos");
    if(insideCell&&blocks.has(node.name))throw new Error("Conteúdo de célula de tabela inválido");
    if(insideRichText&&blocks.has(node.name))throw new Error("Conteúdo RichText inválido");
    const allowed=attrs[node.name]||new Set();
    for(const [key,value] of Object.entries(node.attribs)){
      if(!allowed.has(key))throw new Error("Atributo inválido em "+node.name+": "+key);
      if(bool.has(key)&&value!=="")throw new Error("Atributo booleano inválido: "+key);
    }
    const emojiImage=node.name==="img"&&richEmojiImage(node.attribs.src);
    if(media.has(node.name)&&!emojiImage){
      if(++mediaCount>50)throw new Error("A mensagem excede 50 mídias");
      if(!["","figure","tg-collage","tg-slideshow"].includes(parent))throw new Error("Mídia precisa ser um bloco separado");
    }
    if(emojiImage&&!node.attribs.alt)throw new Error("Emoji personalizado inválido: texto alternativo ausente");
    if(node.name==="figcaption"&&!["figure","tg-collage","tg-slideshow"].includes(parent))throw new Error("Legenda fora de bloco de mídia");
    if(node.name==="cite"&&!["figcaption","blockquote","aside"].includes(parent))throw new Error("Crédito fora de citação ou legenda");
    if(node.name==="caption"&&parent!=="table")throw new Error("Legenda de tabela inválida");
    if(node.name==="tr"&&parent!=="table")throw new Error("Linha de tabela inválida");
    if(["th","td"].includes(node.name)&&parent!=="tr")throw new Error("Célula de tabela inválida");
    if(node.name==="summary"&&parent!=="details")throw new Error("Resumo expansível inválido");
    if(node.name==="li"&&!["ul","ol"].includes(parent))throw new Error("Item de lista inválido");
    if(node.name==="input"&&parent!=="li")throw new Error("Checkbox precisa estar em item de lista");
    const structuralChildren=(allowedNames,label)=>{
      for(const child of node.children){
        if(child.type==="text"){
          if((child.data||"").trim())throw new Error(label+" inválido");
          continue;
        }
        if(child.type!=="tag"||!allowedNames.has(child.name))throw new Error(label+" inválido");
      }
    };
    const textOnly=label=>{
      for(const child of node.children){
        if(child.type!=="text")throw new Error(label+" inválido");
      }
    };
    if(["ul","ol"].includes(node.name))structuralChildren(new Set(["li"]),"Conteúdo de lista");
    if(["tg-emoji","tg-math","tg-math-block"].includes(node.name))textOnly("Conteúdo textual");
    if(node.name==="tr")structuralChildren(new Set(["th","td"]),"Conteúdo de linha de tabela");
    if(node.name==="table"){
      structuralChildren(new Set(["caption","tr"]),"Conteúdo de tabela");
      if(node.children.filter(child=>child.type==="tag"&&child.name==="caption").length>1)throw new Error("Legenda de tabela inválida");
    }
    if(node.name==="details"){
      const tags=node.children.filter(child=>child.type==="tag");
      if(tags.filter(child=>child.name==="summary").length!==1||tags[0]?.name!=="summary")throw new Error("Resumo expansível inválido");
    }
    if(node.name==="tg-button-row"){
      const count=node.children.filter(child=>child.type==="tag"&&child.name==="tg-button").length;
      if(count<1||count>8)throw new Error("Linha de botões inválida: use de 1 a 8 botões");
      for(const child of node.children){
        if(child.type==="text"&&!(child.data||"").trim())continue;
        if(child.type!=="tag"||child.name!=="tg-button")throw new Error("Conteúdo de linha de botões inválido");
      }
    }
    const listType=value=>["a","A","i","I","1"].includes(value);
    if(node.name==="ol"){
      if(node.attribs.start!==undefined&&!/^-?\d+$/.test(node.attribs.start))throw new Error("Início de lista inválido");
      if(node.attribs.type!==undefined&&!listType(node.attribs.type))throw new Error("Tipo de lista inválido");
    }
    if(node.name==="li"){
      if(node.attribs.value!==undefined&&!/^-?\d+$/.test(node.attribs.value))throw new Error("Valor de item de lista inválido");
      if(node.attribs.type!==undefined&&!listType(node.attribs.type))throw new Error("Tipo de item de lista inválido");
      if(parent==="ul"&&(node.attribs.value!==undefined||node.attribs.type!==undefined))throw new Error("Atributo de lista ordenada inválido em lista não ordenada");
    }
    if(["th","td"].includes(node.name)){
      for(const name of ["colspan","rowspan"]){
        if(node.attribs[name]!==undefined){
          const span=Number(node.attribs[name]);
          if(!Number.isInteger(span)||span<1)throw new Error("Extensão de célula de tabela inválida");
        }
      }
      if(node.attribs.align!==undefined&&!["left","center","right"].includes(node.attribs.align))throw new Error("Alinhamento de célula de tabela inválido");
      if(node.attribs.valign!==undefined&&!["top","middle","bottom"].includes(node.attribs.valign))throw new Error("Alinhamento vertical de célula de tabela inválido");
    }
    if(node.name==="table"){
      const rows=node.children.filter(child=>child.type==="tag"&&child.name==="tr");
      for(const row of rows){
        let cols=0;
        for(const cell of row.children.filter(child=>child.type==="tag"&&["th","td"].includes(child.name))){
          const span=Number(cell.attribs.colspan||1);
          if(span>20)throw new Error("Colspan de tabela inválido");
          cols+=span;
        }
        if(cols>20)throw new Error("A tabela excede 20 colunas");
      }
    }
    if(node.name==="code"&&node.attribs.class){
      if(!/^language-[a-z0-9+-]+$/i.test(node.attribs.class))throw new Error("Linguagem de código inválida");
      if(parent!=="pre")throw new Error("Linguagem de código inválida fora de bloco pre");
    }
    if(node.name==="a"){
      const href=node.attribs.href,name=node.attribs.name;
      if(Boolean(href)===Boolean(name))throw new Error("Âncora ou link inválido");
      if(href&&!href.startsWith("#"))urlValid(href);
      if(name&&!/^[A-Za-z0-9_-]{1,64}$/.test(name))throw new Error("Nome de âncora inválido");
      if(name&&(parent!==""||node.children.some(child=>child.type!=="text"||(child.data||"").trim())))throw new Error("Âncora de bloco inválida");
    }
    if(node.name==="input"&&node.attribs.type!=="checkbox")throw new Error("Input Rich Message inválido");
    if(node.name==="tg-time"){
      if(!/^\d+$/.test(node.attribs.unix||""))throw new Error("Timestamp inválido");
      if(node.attribs.format!==undefined&&!/^(?:r|w?[dD]?[tT]?)$/.test(node.attribs.format))throw new Error("Formato de data inválido");
    }
    if(node.name==="tg-reference"&&!/^[A-Za-z0-9_-]{1,64}$/.test(node.attribs.name||""))throw new Error("Referência inválida");
    if(node.name==="tg-emoji"&&!/^\d+$/.test(node.attribs["emoji-id"]||""))throw new Error("Emoji personalizado inválido");
    if(node.name==="tg-map"){
      const lat=Number(node.attribs.lat),lon=Number(node.attribs.long),zoom=node.attribs.zoom===undefined?undefined:Number(node.attribs.zoom),width=node.attribs.width===undefined?undefined:Number(node.attribs.width),height=node.attribs.height===undefined?undefined:Number(node.attribs.height);
      if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180)throw new Error("Mapa inválido");
      if(zoom!==undefined&&(!Number.isInteger(zoom)||zoom<0||zoom>24))throw new Error("Zoom inválido");
      if(width!==undefined&&(!Number.isInteger(width)||width<0||width>10000))throw new Error("Largura do mapa inválida");
      if(height!==undefined&&(!Number.isInteger(height)||height<0||height>10000))throw new Error("Altura do mapa inválida");
      if((width||0)+(height||0)>10000)throw new Error("Dimensões do mapa excedem o limite");
      if(width&&height&&Math.max(width/height,height/width)>20)throw new Error("Proporção do mapa inválida");
    }
    if(node.name==="tg-button-row"&&node.attribs.align&&!["left","center","right"].includes(node.attribs.align))throw new Error("Alinhamento de botão inválido");
    if(node.name==="tg-button"){
      const type=node.attribs.type;
      if(!buttons.has(type))throw new Error("Tipo de botão inválido");
      if(node.attribs.style&&!["danger","success","primary","link"].includes(node.attribs.style))throw new Error("Estilo de botão inválido");
      if(node.attribs.style==="link"&&type!=="callback_data")throw new Error("Estilo link exige callback");
      const chatAttrs=["allow-user-chats","allow-bot-chats","allow-group-chats","allow-channel-chats"];
      const actionAttrs=new Set(["url","data","query","text","forward-text","request-write-access",...chatAttrs]);
      const allowedByType={
        url:new Set(["url"]),
        callback_data:new Set(["data"]),
        web_app:new Set(["url"]),
        login_url:new Set(["url","forward-text","request-write-access"]),
        switch_inline_query:new Set(["query"]),
        switch_inline_query_current_chat:new Set(["query"]),
        switch_inline_query_chosen_chat:new Set(["query",...chatAttrs]),
        copy_text:new Set(["text"]),
        disabled:new Set()
      }[type];
      for(const name of actionAttrs){
        if(node.attribs[name]!==undefined&&!allowedByType.has(name))throw new Error("Atributo de ação inválido para este botão");
      }
      if(["url","web_app","login_url"].includes(type)&&node.attribs.url===undefined)throw new Error("Ação de botão ausente");
      if(type==="callback_data"&&node.attribs.data===undefined)throw new Error("Ação de botão ausente");
      if(type==="copy_text"&&node.attribs.text===undefined)throw new Error("Ação de botão ausente");
      if(type==="callback_data"&&(Buffer.byteLength(node.attribs.data||"")<1||Buffer.byteLength(node.attribs.data)>64))throw new Error("Callback inválido");
      if(type==="url"){
        let url;try{url=new URL(node.attribs.url);}catch{throw new Error("URL de botão inválida");}
        if(!["http:","https:","tg:"].includes(url.protocol))throw new Error("URL de botão deve usar HTTP, HTTPS ou tg://");
      }
      if(type==="web_app"||type==="login_url"){
        let url;try{url=new URL(node.attribs.url);}catch{throw new Error(type==="web_app"?"Web App URL inválida":"Login URL inválida");}
        if(url.protocol!=="https:")throw new Error(type==="web_app"?"Web App URL deve usar HTTPS":"Login URL deve usar HTTPS");
      }
      if(type==="copy_text"){
        const text=node.attribs.text||"";
        if(Array.from(text).length<1||Array.from(text).length>256)throw new Error("Texto para copiar inválido");
      }

    }
    if(media.has(node.name)&&!emojiImage){
      if(!node.attribs.src)throw new Error("Mídia sem endereço");
      urlValid(node.attribs.src,true);
    }
    const childInsideButton=insideButton||node.name==="tg-button";
    const childInsideCell=insideCell||["th","td"].includes(node.name);
    const childInsideRichText=insideRichText||richTextContainers.has(node.name)||(node.name==="blockquote"&&node.attribs.expandable!==undefined);
    node.children.forEach(child=>walk(child,depth+1,node.name,childInsideButton,childInsideCell,childInsideRichText));
  };
  doc.children.forEach(node=>walk(node));
}
