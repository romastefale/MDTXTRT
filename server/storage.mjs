// Persistência no volume: rascunhos, mídias, publicações e transferências (handoffs).
import { randomUUID } from "node:crypto";
import { existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { DomUtils, parseDocument } from "htmlparser2";
import { ACTIVE_HANDOFF_SENDS, DRAFT_DIR, DeliveryError, HANDOFF_DIR, HANDOFF_TTL, HttpError, SERVER_BOOT_ID } from "./config.mjs";
import { ownerFingerprint } from "./identity.mjs";
import { publishTelegramPersistent, richValid } from "./telegram.mjs";
import { readPages } from "./telegraph.mjs";

export function validateTelegramUpload(file,kind){
  if(!file||!/^[A-Za-z0-9_-]{1,64}$/.test(String(file.id||""))||!["image","video","audio","voice","document"].includes(kind))throw new Error("Mídia inválida");
  const mimeContract={
    image:/^image\//,
    video:/^video\//,
    audio:/^audio\//,
    voice:/^audio\//,
    document:/^(?:image|video|audio|application|text)\//
  }[kind];
  if(!mimeContract?.test(file.mime||""))throw new Error("Tipo de mídia inválido");
  const max=kind==="image"?10_000_000:50_000_000;
  if(!Number.isInteger(file.size)||file.size<1||file.size>max)throw new Error(kind==="image"?"Fotos podem ter até 10 MB":"Arquivos podem ter até 50 MB");
  return file;
}
export function bindDraftFiles(files,draft){
  if(!Array.isArray(files)||!Array.isArray(draft?.media))throw new Error("Mídias inválidas");
  const metadata=new Map(draft.media.map(item=>[item.id,item]));
  if(metadata.size!==draft.media.length)throw new Error("Metadados de mídia duplicados");
  return files.map(file=>{
    const item=metadata.get(file.id);
    if(!item)throw new Error("Mídia não referenciada pelo rascunho");
    const bound={...file,kind:item.kind};
    validateTelegramUpload(bound,item.kind);
    return bound;
  });
}

function cleanFileName(value){
  if(typeof value!=="string")throw new Error("Nome de arquivo inválido");
  const name=value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").replace(/^\.+|\.+$/g,"").trim().slice(0,120);
  if(!name)throw new Error("Nome de arquivo inválido");
  return name;
}

function normalizeDraftRuntimeHTML(html){
  const doc=parseDocument(String(html||""));
  const walk=node=>{
    if(node.type!=="tag"){node.children?.slice().forEach(walk);return;}
    for(const key of ["contenteditable","draggable","spellcheck","tabindex","aria-selected"])delete node.attribs[key];
    node.children?.slice().forEach(walk);
  };
  doc.children.slice().forEach(walk);
  return DomUtils.getInnerHTML(doc,{encodeEntities:"utf8"});
}
export function draftValid(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("Rascunho inválido");
  if(draft.version!==2)throw new Error("Versão do rascunho incompatível");
  const json = JSON.stringify(draft);
  if (Buffer.byteLength(json, "utf8") > 350_000) throw new Error("Rascunho grande demais");
  if (typeof draft.html !== "string" || Buffer.byteLength(draft.html, "utf8") > 160_000) throw new Error("Conteúdo do rascunho inválido");
  draft.html=normalizeDraftRuntimeHTML(draft.html);
  if (typeof draft.name !== "string" || draft.name.length > 256) throw new Error("Nome do rascunho inválido");
  if (!["telegram", "telegraph"].includes(draft.dest)) throw new Error("Destino do rascunho inválido");
  if (draft.action !== undefined && draft.action !== "publish") throw new Error("Ação do rascunho inválida");
  if (draft.revision !== undefined && (!Number.isSafeInteger(draft.revision) || draft.revision < 0)) throw new Error("Revisão do rascunho inválida");
  if (!/^[a-f0-9-]{36}$/i.test(String(draft.docId || ""))) throw new Error("Documento inválido");
  if (typeof draft.telegraphPath !== "string" || draft.telegraphPath.length > 256) throw new Error("Página do rascunho inválida");
  if (typeof draft.importedMd !== "string" || typeof draft.importedTxt !== "string" || typeof draft.importedHtml !== "string") throw new Error("Origem importada do rascunho inválida");
  if (Buffer.byteLength(draft.importedMd,"utf8")+Buffer.byteLength(draft.importedTxt,"utf8")+Buffer.byteLength(draft.importedHtml,"utf8") > 240_000) throw new Error("Origem importada do rascunho grande demais");
  if(!Array.isArray(draft.media)||draft.media.length>50)throw new Error("Metadados de mídia do rascunho inválidos");
  const mediaIds=new Set();
  for(const media of draft.media){
    if(!media||typeof media!=="object"||Array.isArray(media)||!/^[A-Za-z0-9_-]{1,64}$/.test(String(media.id||""))||!["image","video","audio","voice","document"].includes(media.kind)||mediaIds.has(media.id))throw new Error("Metadados de mídia do rascunho inválidos");
    mediaIds.add(media.id);
  }
  const tags = new Set("a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div".split(" "));
  const attrs = new Set("href name class style src alt tg-spoiler start type reversed value checked disabled controls expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats data-media-id data-media-missing".split(" "));
  const doc = parseDocument(draft.html);
  const localMedia=[];
  const walk = node => {
    if (node.type === "text") return;
    if (node.type !== "tag" || !tags.has(node.name)) throw new Error("O rascunho contém marcação inválida");
    for (const [key, value] of Object.entries(node.attribs)) {
      if (!attrs.has(key)) throw new Error("O rascunho contém atributo inválido");
      if (key === "class" && !(/^language-[a-z0-9+-]+$/i.test(value) || value === "tg-footer")) throw new Error("O rascunho contém classe inválida");
      if (key === "style" && !(node.name === "tg-button" && ["link","primary","success","danger"].includes(value))) throw new Error("O rascunho contém estilo inválido");
      if (key === "data-media-id") {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Identificador de mídia inválido");
        localMedia.push(value);
      }
      if (["href","src","url"].includes(key) && value) {
        if (key === "href" && value.startsWith("#")) continue;
        let parsed;
        try { parsed = new URL(value); } catch { throw new Error("Link do rascunho inválido"); }
        if (!["https:","http:","tg:","mailto:","tel:"].includes(parsed.protocol)) throw new Error("Link do rascunho inválido");
      }
    }
    node.children?.forEach(walk);
  };
  doc.children.forEach(walk);
  if(localMedia.length>50||new Set(localMedia).size!==localMedia.length)throw new Error("Mídia local inválida");
  if(localMedia.length!==mediaIds.size||localMedia.some(id=>!mediaIds.has(id)))throw new Error("Metadados de mídia não correspondem ao documento");
  return draft;
}

export function persistentDraftPaths(owner,doc){
  const ownerDir=DRAFT_DIR+"/"+ownerFingerprint(owner);
  return {dir:ownerDir,active:ownerDir+"/active",meta:ownerDir+"/"+doc+".json",mediaDir:ownerDir+"/"+doc+".media",single:ownerDir+"/"+doc+".bin"};
}
export function persistentMediaPath(paths,id){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new Error("Identificador de mídia inválido");
  return paths.mediaDir+"/"+id+".bin";
}
function atomicWrite(path,data){
  const tmp=path+".tmp-"+SERVER_BOOT_ID;
  try{
    writeFileSync(tmp,data,{mode:0o600});
    renameSync(tmp,path);
  }catch(error){
    try{if(existsSync(tmp))unlinkSync(tmp);}catch(cleanupError){console.error("Persistent draft cleanup",tmp,cleanupError);}
    throw error;
  }
}
function telegramPublicationValid(value){
  if(value===null||value===undefined)return;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Proveniência Telegram inválida");
  if(!["pending","succeeded","uncertain"].includes(value.status))throw new Error("Estado da publicação Telegram inválido");
  if(!/^\d+$/.test(String(value.telegramUserId||""))||!/^\d+$/.test(String(value.chatId||"")))throw new Error("Publicador Telegram inválido");
  if(!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error("Revisão publicada inválida");
  if(!Number.isFinite(value.updatedAt)||value.updatedAt<0)throw new Error("Data da publicação inválida");
  if(value.status==="succeeded"){
    if(!Number.isInteger(value.messageId)||value.messageId<=0)throw new Error("Mensagem publicada inválida");
  }else if(value.messageId!==0){
    throw new Error("Estado da mensagem publicada inválido");
  }
  if(typeof value.error!=="string")throw new Error("Erro da publicação inválido");
  if(value.snapshot!==undefined&&value.snapshot!==null){
    const snapshot=value.snapshot;
    if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||typeof snapshot.name!=="string"||snapshot.name.length>256||typeof snapshot.html!=="string"||Buffer.byteLength(snapshot.html,"utf8")>160_000)throw new Error("Snapshot da publicação Telegram inválido");
  }
  if(value.history!==undefined){
    if(!Array.isArray(value.history)||value.history.length>100)throw new Error("Histórico Telegram inválido");
    for(const entry of value.history){
      if(!entry||typeof entry!=="object"||Array.isArray(entry)||!Number.isInteger(entry.messageId)||entry.messageId<=0||!Number.isSafeInteger(entry.revision)||entry.revision<0||!Number.isFinite(entry.publishedAt)||entry.publishedAt<0||!Number.isInteger(entry.noticeMessageId||0)||Number(entry.noticeMessageId||0)<0)throw new Error("Histórico Telegram inválido");
    }
  }
  if(value.pendingUpdate!==undefined&&value.pendingUpdate!==null){
    const pending=value.pendingUpdate;
    if(!pending||typeof pending!=="object"||Array.isArray(pending)||!["pending","failed","uncertain"].includes(pending.status)||!["notice","content"].includes(pending.phase)||!Number.isSafeInteger(pending.revision)||pending.revision<0||!Number.isInteger(pending.noticeMessageId)||pending.noticeMessageId<0||!Number.isFinite(pending.startedAt)||pending.startedAt<0||typeof pending.error!=="string")throw new Error("Atualização Telegram pendente inválida");
    if(pending.phase==="content"&&pending.noticeMessageId<=0)throw new Error("Aviso da atualização Telegram inválido");
  }
}
function mediaMetaValid(media){
  if(!media||typeof media!=="object"||Array.isArray(media)||!/^[A-Za-z0-9_-]{1,64}$/.test(String(media.id||""))||!["image","video","audio","voice","document"].includes(media.kind)||typeof media.name!=="string"||!media.name||typeof media.mime!=="string"||!media.mime||!Number.isInteger(media.size)||media.size<1)throw new Error("Anexo persistido inválido");
  const max=media.kind==="image"?10_000_000:50_000_000;
  if(media.size>max)throw new Error("Anexo persistido excede o limite do Telegram");
}
function normalizeStoredRecord(record,paths){
  let changed=false;
  if(record?.draft&&record.draft.media===null){record.draft.media=[];changed=true;}
  if(record?.draft?.media&&!Array.isArray(record.draft.media)){record.draft.media=[record.draft.media];changed=true;}
  if(record?.media===null||record?.media===undefined){record.media=[];changed=true;}
  if(record?.media&&!Array.isArray(record.media)){
    record.media=[record.media];changed=true;
    if(record.media[0]?.id&&existsSync(paths.single)){
      mkdirSync(paths.mediaDir,{recursive:true});
      const target=persistentMediaPath(paths,record.media[0].id);
      if(!existsSync(target))renameSync(paths.single,target);else unlinkSync(paths.single);
    }
  }
  return changed;
}
function persistentRecordValid(record,owner,doc){
  if(!record||typeof record!=="object"||Array.isArray(record)||record.schema!==1)throw new Error("Rascunho persistido inválido");
  if(record.ownerFingerprint!==ownerFingerprint(owner))throw new HttpError(403,"Este rascunho pertence a outra identidade");
  if(!record.owner||record.owner.kind!==owner.kind)throw new HttpError(403,"Este rascunho pertence a outra identidade");
  if(owner.kind==="telegram"&&record.owner.telegramUserId!==owner.telegramUserId)throw new HttpError(403,"Este rascunho pertence a outro usuário Telegram");
  if(!Number.isFinite(record.updatedAt)||record.updatedAt<0)throw new Error("Rascunho persistido inválido");
  if(record.createdAt!==undefined&&(!Number.isFinite(record.createdAt)||record.createdAt<0||record.createdAt>record.updatedAt))throw new Error("Data de criação do rascunho inválida");
  draftValid(record.draft);
  if(doc&&record.draft.docId!==doc)throw new Error("Documento persistido incompatível");
  if(!record.publication||typeof record.publication!=="object"||Array.isArray(record.publication))throw new Error("Proveniência persistida inválida");
  telegramPublicationValid(record.publication.telegram);
  if(!Array.isArray(record.media)||record.media.length>50)throw new Error("Anexos persistidos inválidos");
  const ids=new Set();
  for(const media of record.media){mediaMetaValid(media);if(ids.has(media.id))throw new Error("Anexos persistidos inválidos");ids.add(media.id);}
  if(record.draft.media.length!==ids.size||record.draft.media.some(item=>!ids.has(item.id)))throw new Error("Anexos persistidos não correspondem ao rascunho");
  return record;
}
export function readPersistentDraft(owner,doc=""){
  const ownerDir=DRAFT_DIR+"/"+ownerFingerprint(owner);
  let target=String(doc||"");
  if(!target){
    const active=ownerDir+"/active";
    if(!existsSync(active))return null;
    target=readFileSync(active,"utf8").trim();
  }
  if(!/^[a-f0-9-]{36}$/i.test(target))throw new Error("Índice de rascunho persistido inválido");
  const paths=persistentDraftPaths(owner,target);
  if(!existsSync(paths.meta))return null;
  let record;
  try{record=JSON.parse(readFileSync(paths.meta,"utf8"));}
  catch{throw new Error("Não foi possível recuperar o rascunho persistido");}
  const changed=normalizeStoredRecord(record,paths);
  persistentRecordValid(record,owner,target);
  for(const media of record.media){
    const path=persistentMediaPath(paths,media.id);
    if(!existsSync(path)||statSync(path).size!==media.size)throw new Error("Anexo persistido indisponível");
  }
  if(changed)atomicWrite(paths.meta,JSON.stringify(record));
  return record;
}
export function writePersistentRecord(owner,record){
  persistentRecordValid(record,owner,record.draft.docId);
  const paths=persistentDraftPaths(owner,record.draft.docId);
  mkdirSync(paths.dir,{recursive:true});
  atomicWrite(paths.meta,JSON.stringify(record));
  atomicWrite(paths.active,record.draft.docId);
}
export function persistentDraftView(record){
  return {
    draft:record.draft,
    media:record.media,
    publication:record.publication.telegram,
    createdAt:Number.isFinite(record.createdAt)?record.createdAt:record.updatedAt,
    updatedAt:record.updatedAt,
    owner:{
      kind:record.owner.kind,
      ...(record.owner.kind==="telegram"?{telegramUserId:record.owner.telegramUserId}:{})
    }
  };
}
function draftPreview(draft){
  const text=DomUtils.textContent(parseDocument(String(draft?.html||""))).replace(/\s+/g," ").trim();
  return Array.from(text).slice(0,280).join("");
}
function recordCreatedAt(record){
  return Number.isFinite(record?.createdAt)?record.createdAt:record.updatedAt;
}
export function listPersistentDrafts(owner){
  const dir=DRAFT_DIR+"/"+ownerFingerprint(owner);
  if(!existsSync(dir))return [];
  const items=[];
  for(const name of readdirSync(dir)){
    if(!/^[a-f0-9-]{36}\.json$/i.test(name))continue;
    const doc=name.slice(0,-5);
    const record=readPersistentDraft(owner,doc);
    if(!record)throw new Error("Índice de rascunho inconsistente");
    items.push({
      docId:record.draft.docId,
      name:record.draft.name,
      dest:record.draft.dest,
      revision:record.draft.revision,
      telegraphPath:record.draft.telegraphPath,
      preview:draftPreview(record.draft),
      createdAt:recordCreatedAt(record),
      updatedAt:record.updatedAt,
      hasMedia:record.media.length>0
    });
  }
  return items.sort((a,b)=>b.updatedAt-a.updatedAt||a.name.localeCompare(b.name));
}
export function listTelegramPublications(owner,drafts=[]){
  const items=[];
  for(const draft of drafts){
    const record=readPersistentDraft(owner,draft.docId);
    if(!record)throw new Error("Índice de publicação Telegram inconsistente");
    const publication=record.publication.telegram;
    if(!publication)continue;
    const history=Array.isArray(publication.history)?publication.history:[];
    const latest=history.at(-1)||null;
    items.push({
      docId:draft.docId,
      name:draft.name,
      status:publication.status,
      revision:publication.revision,
      messageId:publication.messageId,
      historyCount:history.length,
      publishedAt:latest?.publishedAt||publication.updatedAt,
      preview:draft.preview,
      createdAt:draft.createdAt,
      updatedAt:record.updatedAt
    });
  }
  return items.sort((a,b)=>b.publishedAt-a.publishedAt||b.updatedAt-a.updatedAt||a.name.localeCompare(b.name));
}
export function telegraphOwnerFromDraftOwner(owner){
  return owner.kind==="telegram"?owner.chatId:owner.key;
}
export function listTelegraphPages(owner,drafts=[]){
  const pages=readPages();
  const prefix=telegraphOwnerFromDraftOwner(owner)+":";
  const byDoc=new Map(drafts.map(item=>[item.docId,item]));
  const items=[];
  for(const [key,value] of Object.entries(pages)){
    if(!key.startsWith(prefix))continue;
    const docId=key.slice(prefix.length);
    if(!/^[a-f0-9-]{36}$/i.test(docId))continue;
    const path=typeof value==="string"?value:"";
    const status=typeof value==="string"?"succeeded":value?.status==="pending"?"pending":"invalid";
    if(status==="invalid")throw new Error("Mapeamento Telegraph persistido inválido");
    const draft=byDoc.get(docId);
    items.push({
      docId,
      path,
      status,
      name:draft?.name||path||"Página Telegraph",
      revision:draft?.revision||0,
      preview:draft?.preview||"",
      createdAt:draft?.createdAt||draft?.updatedAt||0,
      updatedAt:draft?.updatedAt||0
    });
  }
  return items.sort((a,b)=>b.updatedAt-a.updatedAt||a.name.localeCompare(b.name));
}

export function savePersistentDraft(owner,draft,files=[]){
  draftValid(draft);
  if(!/^[a-f0-9-]{36}$/i.test(String(draft.docId||"")))throw new HttpError(400,"Documento inválido");
  if(!Array.isArray(files)||files.length>50)throw new HttpError(400,"Mídias inválidas");
  const paths=persistentDraftPaths(owner,draft.docId);
  const existing=readPersistentDraft(owner,draft.docId);
  if(existing&&draft.revision<existing.draft.revision)throw new HttpError(409,"Uma revisão mais recente deste rascunho já está persistida");
  const incoming=new Map(files.map(file=>[file.id,file]));
  if(incoming.size!==files.length)throw new HttpError(400,"Mídias duplicadas");
  const media=[];
  if(draft.media.length)mkdirSync(paths.mediaDir,{recursive:true});
  for(const item of draft.media){
    const file=incoming.get(item.id);
    if(file){
      file.kind=item.kind;
      validateTelegramUpload(file,item.kind);
      const target=persistentMediaPath(paths,item.id);
      copyFileSync(file.path,target);
      media.push({id:item.id,kind:item.kind,name:cleanFileName(file.name),mime:file.mime,size:file.size});
      incoming.delete(item.id);
      continue;
    }
    const prior=existing?.media?.find(value=>value.id===item.id&&value.kind===item.kind);
    const path=persistentMediaPath(paths,item.id);
    if(!prior||!existsSync(path)||statSync(path).size!==prior.size)throw new HttpError(409,"Um anexo do rascunho precisa ser persistido junto com o documento");
    media.push(prior);
  }
  if(incoming.size)throw new HttpError(400,"Mídia não referenciada pelo rascunho");
  if(existsSync(paths.mediaDir)){
    const keep=new Set(media.map(item=>item.id+".bin"));
    for(const name of readdirSync(paths.mediaDir))if(!keep.has(name))rmSync(paths.mediaDir+"/"+name,{force:true});
    if(!keep.size)rmSync(paths.mediaDir,{recursive:true,force:true});
  }
  const now=Date.now();
  const record={
    schema:1,
    ownerFingerprint:ownerFingerprint(owner),
    owner:{kind:owner.kind,telegramUserId:owner.kind==="telegram"?owner.telegramUserId:""},
    createdAt:Number.isFinite(existing?.createdAt)?existing.createdAt:(existing?.updatedAt||now),
    updatedAt:now,
    draft:{...draft},
    media,
    publication:existing?.publication||{telegram:null}
  };
  writePersistentRecord(owner,record);
  return record;
}

export function handoffFiles(token) {
  return {meta:HANDOFF_DIR+"/"+token+".json",mediaDir:HANDOFF_DIR+"/"+token+".media"};
}
export function handoffMediaPath(paths,id){
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new Error("Identificador de mídia inválido");
  return paths.mediaDir+"/"+id+".bin";
}
export function writeHandoff(token,state){
  const paths=handoffFiles(token);
  writeFileSync(paths.meta+".tmp",JSON.stringify(state),{mode:0o600});
  renameSync(paths.meta+".tmp",paths.meta);
}
function dropHandoff(token){
  const paths=handoffFiles(token);
  for(const path of [paths.meta,paths.meta+".tmp"]){
    try{if(existsSync(path))unlinkSync(path);}catch(error){console.error("Handoff cleanup",path,error);}
  }
  try{if(existsSync(paths.mediaDir))rmSync(paths.mediaDir,{recursive:true,force:true});}catch(error){console.error("Handoff media cleanup",error);}
}
function handoffPublishRequestValid(request,draft,files){
  if(!request||typeof request!=="object"||Array.isArray(request)||request.type!=="publish")throw new Error("Ação da transferência inválida");
  if(typeof request.html!=="string"||!request.html.trim()||Buffer.byteLength(request.html,"utf8")>180_000)throw new Error("Conteúdo da publicação transferida inválido");
  richValid(request.html);
  if(!Array.isArray(files)||files.length!==draft.media.length)throw new Error("Anexos da transferência não correspondem ao rascunho");
  const ids=new Set(files.map(file=>file.id));
  if(ids.size!==files.length||draft.media.some(item=>!ids.has(item.id)))throw new Error("Anexos da transferência não correspondem ao rascunho");
  return {type:"publish",html:request.html};
}
function handoffActionValid(action,draft,files){
  if(action===null)return;
  if(!action||typeof action!=="object"||Array.isArray(action)||action.type!=="publish")throw new Error("Estado de publicação da transferência inválido");
  if(!["pending","sending","succeeded","failed","uncertain"].includes(action.status))throw new Error("Estado da publicação transferida inválido");
  if(!Number.isInteger(action.attempts)||action.attempts<0)throw new Error("Estado da publicação transferida inválido");
  for(const key of ["startedAt","finishedAt"])if(!Number.isFinite(action[key])||action[key]<0)throw new Error("Estado da publicação transferida inválido");
  if(typeof action.serverBootId!=="string"||typeof action.error!=="string")throw new Error("Estado da publicação transferida inválido");
  if(action.request!==null)handoffPublishRequestValid(action.request,draft,files);
  if(action.status!=="uncertain"&&action.request===null)throw new Error("Estado da publicação transferida inválido");
  if(action.status==="succeeded"){
    if(!action.result||action.result.via!=="sendRichMessage"||!Number.isInteger(action.result.messageId)||action.result.messageId<=0)throw new Error("Resultado da publicação transferida inválido");
  }else if(action.result!==null)throw new Error("Estado da publicação transferida inválido");
}
export function handoffActionView(action,draft){
  if(!action)return null;
  return {
    type:"publish",status:action.status,attempts:action.attempts,result:action.result,error:action.error,
    startedAt:action.startedAt,finishedAt:action.finishedAt,doc:draft.docId,
    revision:Number.isSafeInteger(draft.revision)&&draft.revision>=0?draft.revision:0
  };
}
export function readHandoff(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const paths=handoffFiles(token);
  if(!existsSync(paths.meta))return null;
  try{
    const meta=JSON.parse(readFileSync(paths.meta,"utf8"));
    if(!meta||typeof meta!=="object"||!Number.isFinite(meta.expires)||!meta.draft||!Array.isArray(meta.files))throw new Error("Transferência persistida inválida");
    if(meta.expires<Date.now()){dropHandoff(token);return null;}
    draftValid(meta.draft);
    if(meta.claimedBy!==undefined&&typeof meta.claimedBy!=="string")throw new Error("Transferência persistida inválida");
    if(meta.files.length!==meta.draft.media.length||meta.files.length>50)throw new Error("Transferência persistida inválida");
    const ids=new Set();
    for(const file of meta.files){
      mediaMetaValid(file);
      if(ids.has(file.id))throw new Error("Transferência persistida inválida");
      ids.add(file.id);
      const path=handoffMediaPath(paths,file.id);
      if(!existsSync(path)||statSync(path).size!==file.size)throw new Error("Arquivo da transferência inválido");
    }
    if(meta.draft.media.some(item=>!ids.has(item.id)))throw new Error("Transferência persistida inválida");
    if(!["transfer","import"].includes(meta.purpose))throw new Error("Finalidade da transferência persistida inválida");
    handoffActionValid(meta.action??null,meta.draft,meta.files);
    if(meta.purpose==="import"&&(meta.files.length||meta.action))throw new Error("Importação persistida contém estado incompatível");
    if(meta.action?.status==="sending"&&(meta.action.serverBootId!==SERVER_BOOT_ID||!ACTIVE_HANDOFF_SENDS.has(token))){
      meta.action.status="uncertain";
      meta.action.error="O envio foi interrompido antes de registrar um resultado confirmado. Confira o chat antes de iniciar outra publicação.";
      meta.action.finishedAt=Date.now();
      meta.action.serverBootId="";
      meta.expires=Date.now()+HANDOFF_TTL;
      writeHandoff(token,meta);
    }
    return meta;
  }catch(error){
    console.error("Discarding invalid handoff",token,error);
    dropHandoff(token);
    return null;
  }
}
export function sweepHandoffs(){
  for(const name of readdirSync(HANDOFF_DIR)){
    const match=/^([a-f0-9]{32})\.json$/.exec(name);
    if(!match)continue;
    readHandoff(match[1]);
  }
}
export function saveHandoff(draft,files=[],actionRequest=null,purpose="transfer",claimedBy=""){
  sweepHandoffs();
  if(!["transfer","import"].includes(purpose))throw new Error("Finalidade da transferência inválida");
  if(typeof claimedBy!=="string")throw new Error("Vínculo da transferência inválido");
  if(!Array.isArray(files)||files.length>50)throw new Error("Anexos da transferência inválidos");
  if(purpose==="import"&&(files.length||actionRequest||draft?.action==="publish"))throw new Error("Importação não pode conter publicação ou anexo local");
  draftValid(draft);
  const byId=new Map(files.map(file=>[file.id,file]));
  if(byId.size!==files.length||files.length!==draft.media.length||draft.media.some(item=>!byId.has(item.id)))throw new Error("Anexos do rascunho inválidos");
  const storedFiles=[];
  for(const item of draft.media){
    const file=byId.get(item.id);file.kind=item.kind;validateTelegramUpload(file,item.kind);
    storedFiles.push({id:item.id,kind:item.kind,name:cleanFileName(file.name),mime:file.mime,size:file.size});
  }
  const storedDraft={...draft};delete storedDraft.action;draftValid(storedDraft);
  const action=actionRequest?{
    type:"publish",status:"pending",attempts:0,
    request:handoffPublishRequestValid(actionRequest,storedDraft,storedFiles),
    result:null,error:"",startedAt:0,finishedAt:0,serverBootId:""
  }:null;
  const token=randomUUID().replace(/-/g,""),paths=handoffFiles(token);
  const meta={expires:Date.now()+HANDOFF_TTL,draft:storedDraft,files:storedFiles,claimedBy,purpose,action};
  try{
    if(storedFiles.length)mkdirSync(paths.mediaDir,{recursive:true});
    for(const file of files)copyFileSync(file.path,handoffMediaPath(paths,file.id));
    writeHandoff(token,meta);
    return token;
  }catch(error){dropHandoff(token);throw error;}
}
export async function publishHandoff(token,state,initData){
  const action=state.action;
  if(!action||action.type!=="publish")throw new HttpError(400,"Esta transferência não possui publicação pendente");
  if(action.status==="succeeded")return {code:200,reused:true,action:handoffActionView(action,state.draft)};
  if(action.status==="sending")return {code:202,reused:true,action:handoffActionView(action,state.draft)};
  if(action.status==="uncertain")return {code:409,reused:true,action:handoffActionView(action,state.draft)};
  if(!action.request)throw new HttpError(409,"A publicação transferida não pode ser repetida com segurança");
  action.status="sending";action.attempts++;action.result=null;action.error="";action.startedAt=Date.now();action.finishedAt=0;action.serverBootId=SERVER_BOOT_ID;
  state.expires=Date.now()+HANDOFF_TTL;ACTIVE_HANDOFF_SENDS.add(token);
  try{
    writeHandoff(token,state);
    const paths=handoffFiles(token);
    const files=state.files.map(file=>({...file,path:handoffMediaPath(paths,file.id)}));
    try{
      const result=await publishTelegramPersistent(initData,state.draft,action.request.html,files);
      action.status="succeeded";action.result=result;action.error="";action.finishedAt=Date.now();action.serverBootId="";
      state.expires=Date.now()+HANDOFF_TTL;writeHandoff(token,state);
      return {code:200,reused:false,action:handoffActionView(action,state.draft)};
    }catch(error){
      const knownFailure=error instanceof HttpError||(error instanceof DeliveryError&&error.outcome==="failed");
      action.status=knownFailure?"failed":"uncertain";action.result=null;
      action.error=error instanceof Error?error.message:"Não foi possível confirmar a publicação";
      action.finishedAt=Date.now();action.serverBootId="";state.expires=Date.now()+HANDOFF_TTL;writeHandoff(token,state);
      return {code:knownFailure?(error instanceof HttpError?error.status:502):409,reused:false,action:handoffActionView(action,state.draft)};
    }
  }finally{ACTIVE_HANDOFF_SENDS.delete(token);}
}
