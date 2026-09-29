import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { DomUtils, parseDocument } from "htmlparser2";
import { marked } from "marked";
import Busboy from "busboy";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
function required(name){
  const value=String(process.env[name]??"").trim();
  if(!value)throw new Error("Configuração ausente: "+name);
  return value;
}
class HttpError extends Error{
  constructor(status,message){
    super(message);
    this.name="HttpError";
    this.status=status;
  }
}
class DeliveryError extends Error{
  constructor(message,outcome="uncertain"){
    super(message);
    this.name="DeliveryError";
    this.outcome=outcome;
  }
}
function asHttpError(error,status,fallback){
  if(error instanceof HttpError)return error;
  return new HttpError(status,error instanceof Error&&error.message?error.message:fallback);
}

function httpsUrl(name){
  const value=required(name);
  let url;
  try{url=new URL(value);}catch{throw new Error("Configuração inválida: "+name);}
  if(url.protocol!=="https:")throw new Error("Configuração inválida: "+name);
  return url;
}
const PORT=Number(required("PORT"));
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error("Configuração inválida: PORT");
const DATA=required("RAILWAY_VOLUME_MOUNT_PATH").replace(/\/+$/,"");
if(!DATA.startsWith("/"))throw new Error("Configuração inválida: RAILWAY_VOLUME_MOUNT_PATH");
const MINI_APP=new URL(httpsUrl("MINI_APP_URL"));
const PUBLIC_BASE=new URL(httpsUrl("PUBLIC_BASE_URL"));
const MINI_APP_URL=MINI_APP.href;
const WEBHOOK_BASE=PUBLIC_BASE.href.replace(/\/+$/,"");
const ALLOW_ORIGINS=new Set([MINI_APP.origin,PUBLIC_BASE.origin]);
const TELEGRAPH_FILE = DATA + "/telegraph-token";
const PAGES_FILE = TELEGRAPH_FILE + "-pages.json";
const HANDOFF_DIR = DATA + "/handoffs";
const DRAFT_DIR = DATA + "/drafts";
const HANDOFF_TTL = 15 * 60 * 1000;
const BOT_IMPORT_DOWNLOAD_MAX = 20_000_000;
const BOT_IMPORT_SOURCE_MAX = 240_000;
const SERVER_BOOT_ID = randomUUID();
const ACTIVE_HANDOFF_SENDS = new Set();
const BOT_TOKEN=required("TOKEN");
if(!BOT_TOKEN_RE.test(BOT_TOKEN))throw new Error("Configuração inválida: TOKEN");
let telegraphToken="";
let telegraphQueue = Promise.resolve();
let botLink;
mkdirSync(HANDOFF_DIR, { recursive: true });
mkdirSync(DRAFT_DIR, { recursive: true });
if(existsSync(TELEGRAPH_FILE)){
  telegraphToken=readFileSync(TELEGRAPH_FILE,"utf8").trim();
  if(!telegraphToken)throw new Error("Credencial Telegraph persistida está vazia");
}
const BOT_COMMANDS = [
  { command: "start", description: "Abrir o MDTXTRT" },
  { command: "app", description: "Abrir o Mini App" },
  { command: "novo", description: "Criar um documento" },
  { command: "ajuda", description: "Ver os comandos" },
  { command: "enviar", description: "Enviar texto rico" },
  { command: "exportar", description: "Exportar texto como arquivo" },
  { command: "importar", description: "Importar Markdown ou TXT" },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
const PUBLIC = new Set([
  "index.html",
  "app.js",
  "ui.js",
  "marked.js",
  "turndown.js",
  "favicon.svg",
  "logo.svg",
  "pwa-192.svg",
  "pwa-512.svg",
  "manifest.webmanifest",
  "og.jpg",
  "x-banner.jpg",
  ...["arrow_back","bold","buttons","chevron_right","dark_mode","details","export","file","footer","h1","h2","h3","h4","h5","h6","heading","italic","light_mode","link","list","paragraph","plus","quote","redo","table","task","telegram","telegraph","underline","undo"].map(name=>`icons/${name}.svg`),
  ...["anchor","attach_file","calculate","code","expandquote","format_list_numbered","functions","horizontal_rule","image","ink_highlighter","location_on","markdown","mood","movie","music_note","pullquote","schedule","search","slideshow","sticky_note_2","strikethrough_s","subscript","superscript","text_fields","view_comfy","visibility_off","web"].map(name=>`icons/${name}.svg`),
]);

function corsOrigin(req) {
  const origin = req.headers.origin || "";
  return ALLOW_ORIGINS.has(origin) ? origin : "";
}

function setCors(req, res) {
  const allow = corsOrigin(req);
  if (!allow) return false;
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  return true;
}

function userFromInitData(initData) {
  if (!initData.trim()) throw new Error("Abra pelo bot no Telegram");
  const params = new URLSearchParams(initData);
  if (initData.length > 8192 || [...params.keys()].length !== new Set(params.keys()).size) throw new Error("Sessão Telegram inválida");
  const hash = params.get("hash") || "";
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const check = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const actual = Buffer.from(check, "hex");
  const expected = /^[a-f0-9]{64}$/i.test(hash) ? Buffer.from(hash, "hex") : Buffer.alloc(0);
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) throw new Error("Sessão Telegram inválida");
  const authDate = Number(params.get("auth_date") || "0");
  const now = Date.now() / 1000;
  if (!authDate || authDate > now + 60 || now - authDate > 86400) {
    throw new Error("Sessão Telegram expirada");
  }
  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Usuário Telegram ausente");
  let user;
  try { user = JSON.parse(userRaw); } catch { throw new Error("Dados da sessão inválidos"); }
  if (!user?.id) throw new Error("Usuário Telegram ausente");
  return { chatId: String(user.id), userId: String(user.id) };
}

function telegraphOwner(body){
  const initData=typeof body?.initData==="string"?body.initData.trim():"";
  const browserKey=typeof body?.browserKey==="string"?body.browserKey.trim():"";
  if(initData&&browserKey)throw new HttpError(400,"Identidade de publicação ambígua");
  if(initData){
    try{return userFromInitData(initData).chatId;}
    catch(error){throw asHttpError(error,400,"Sessão Telegram inválida");}
  }
  if(!/^[a-f0-9]{64}$/.test(browserKey))throw new HttpError(400,"Identidade do navegador inválida");
  return "browser:"+createHash("sha256").update(browserKey).digest("hex");
}
function draftOwner(body){
  const initData=typeof body?.initData==="string"?body.initData.trim():"";
  const browserKey=typeof body?.browserKey==="string"?body.browserKey.trim():"";
  if(initData&&browserKey)throw new HttpError(400,"Identidade de rascunho ambígua");
  if(initData){
    try{
      const {chatId,userId}=userFromInitData(initData);
      return {key:"telegram:"+userId,kind:"telegram",telegramUserId:userId,chatId};
    }catch(error){throw asHttpError(error,400,"Sessão Telegram inválida");}
  }
  if(!/^[a-f0-9]{64}$/.test(browserKey))throw new HttpError(400,"Identidade do navegador inválida");
  const fingerprint=createHash("sha256").update(browserKey).digest("hex");
  return {key:"browser:"+fingerprint,kind:"browser",telegramUserId:"",chatId:""};
}
function ownerFingerprint(owner){
  return createHash("sha256").update(owner.key).digest("hex");
}
function telegraphRevision(value){
  if(value===undefined)return 0;
  if(!Number.isSafeInteger(value)||value<0)throw new HttpError(400,"Revisão do documento inválida");
  return value;
}

async function telegramCall(method, body, messages={}) {
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
    throw new DeliveryError(messages.failed||"O Telegram não aceitou a publicação","failed");
  }
  return json.result;
}

async function readJson(req, maxBytes = 80_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("A solicitação é grande demais");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) throw new Error("A solicitação está vazia");
  try { return JSON.parse(raw); } catch { throw new Error("Não foi possível ler os dados recebidos"); }
}

async function readMedia(req) {
  if (!/^multipart\/form-data;\s*boundary=/i.test(req.headers["content-type"] || "")) throw new Error("Formato de mídia inválido");
  return new Promise((resolve, reject) => {
    const fields = {}, files = [];
    const bus = Busboy({headers:req.headers,limits:{files:1,fileSize:20_000_000,fields:6,fieldSize:400000}});
    bus.on("field",(key,value)=>{fields[key]=value;});
    bus.on("file",(key,stream,info)=>{
      if (key !== "upload") {stream.resume();reject(new Error("Mídia inválida"));return;}
      const chunks=[];
      stream.on("data",chunk=>chunks.push(chunk));
      stream.on("limit",()=>reject(new Error("Mídia grande demais")));
      stream.on("end",()=>files.push({bytes:Buffer.concat(chunks),mime:info.mimeType,name:info.filename.slice(0,100)}));
    });
    bus.on("error",reject);
    bus.on("close",()=>resolve({fields,file:files[0]}));
    req.pipe(bus);
  });
}

function cleanFileName(value){
  if(typeof value!=="string")throw new Error("Nome de arquivo inválido");
  const name=value.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"-").replace(/^\.+|\.+$/g,"").trim().slice(0,120);
  if(!name)throw new Error("Nome de arquivo inválido");
  return name;
}

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
    if(Object.hasOwn(node.attribs,"class")){
      const kept=String(node.attribs.class||"").split(/\s+/).filter(Boolean).filter(name=>name!=="ProseMirror-selectednode");
      if(kept.length)node.attribs.class=kept.join(" ");else delete node.attribs.class;
    }
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
    media:null
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
  const token=saveHandoff(draft,null,null,"import",String(chatId));
  return {draft,token};
}

function draftValid(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("Rascunho inválido");
  if(draft.version!==2)throw new Error("Versão do rascunho incompatível");
  const json = JSON.stringify(draft);
  if (Buffer.byteLength(json, "utf8") > 350_000) throw new Error("Rascunho grande demais");
  if (typeof draft.html !== "string" || Buffer.byteLength(draft.html, "utf8") > 160_000) throw new Error("Conteúdo do rascunho inválido");
  if (typeof draft.name !== "string" || draft.name.length > 120) throw new Error("Nome do rascunho inválido");
  if (!["telegram", "telegraph"].includes(draft.dest)) throw new Error("Destino do rascunho inválido");
  if (draft.action !== undefined && draft.action !== "publish") throw new Error("Ação do rascunho inválida");
  if (draft.revision !== undefined && (!Number.isSafeInteger(draft.revision) || draft.revision < 0)) throw new Error("Revisão do rascunho inválida");
  if (!/^[a-f0-9-]{36}$/i.test(String(draft.docId || ""))) throw new Error("Documento inválido");
  if (typeof draft.telegraphPath !== "string" || draft.telegraphPath.length > 256) throw new Error("Página do rascunho inválida");
  if (typeof draft.importedMd !== "string" || typeof draft.importedTxt !== "string" || typeof draft.importedHtml !== "string") throw new Error("Origem importada do rascunho inválida");
  if (Buffer.byteLength(draft.importedMd,"utf8")+Buffer.byteLength(draft.importedTxt,"utf8")+Buffer.byteLength(draft.importedHtml,"utf8") > 240_000) throw new Error("Origem importada do rascunho grande demais");
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
  if(localMedia.length>1)throw new Error("O rascunho contém mais de um anexo local");
  if(draft.media!==null&&draft.media!==undefined){
    if(!draft.media||typeof draft.media!=="object"||Array.isArray(draft.media)||!/^[A-Za-z0-9_-]{1,64}$/.test(String(draft.media.id||""))||!["image","video","audio","voice","document"].includes(draft.media.kind))throw new Error("Metadados de mídia do rascunho inválidos");
  }
  if(localMedia.length===1){
    if(!draft.media||draft.media.id!==localMedia[0])throw new Error("Metadados de mídia do rascunho não correspondem ao anexo");
  }else if(draft.media!==null&&draft.media!==undefined){
    throw new Error("Metadados de mídia sem anexo local");
  }
  return draft;
}


function persistentDraftPaths(owner,doc){
  const ownerDir=DRAFT_DIR+"/"+ownerFingerprint(owner);
  return {dir:ownerDir,active:ownerDir+"/active",meta:ownerDir+"/"+doc+".json",file:ownerDir+"/"+doc+".bin"};
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
}
function persistentRecordValid(record,owner,doc){
  if(!record||typeof record!=="object"||Array.isArray(record)||record.schema!==1)throw new Error("Rascunho persistido inválido");
  if(record.ownerFingerprint!==ownerFingerprint(owner))throw new HttpError(403,"Este rascunho pertence a outra identidade");
  if(!record.owner||record.owner.kind!==owner.kind)throw new HttpError(403,"Este rascunho pertence a outra identidade");
  if(owner.kind==="telegram"&&record.owner.telegramUserId!==owner.telegramUserId)throw new HttpError(403,"Este rascunho pertence a outro usuário Telegram");
  if(!Number.isFinite(record.updatedAt)||record.updatedAt<0)throw new Error("Rascunho persistido inválido");
  draftValid(record.draft);
  if(doc&&record.draft.docId!==doc)throw new Error("Documento persistido incompatível");
  if(!record.publication||typeof record.publication!=="object"||Array.isArray(record.publication))throw new Error("Proveniência persistida inválida");
  telegramPublicationValid(record.publication.telegram);
  if(record.media!==null){
    const media=record.media;
    if(!media||typeof media!=="object"||Array.isArray(media)||!/^[A-Za-z0-9_-]{1,64}$/.test(String(media.id||""))||!["image","video","audio","voice","document"].includes(media.kind)||typeof media.name!=="string"||!media.name||typeof media.mime!=="string"||!media.mime||!Number.isInteger(media.size)||media.size<1||media.size>20_000_000)throw new Error("Anexo persistido inválido");
  }
  return record;
}
function readPersistentDraft(owner,doc=""){
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
  persistentRecordValid(record,owner,target);
  if(record.media!==null&&(!existsSync(paths.file)||statSync(paths.file).size!==record.media.size))throw new Error("Anexo persistido indisponível");
  return record;
}
function writePersistentRecord(owner,record){
  persistentRecordValid(record,owner,record.draft.docId);
  const paths=persistentDraftPaths(owner,record.draft.docId);
  mkdirSync(paths.dir,{recursive:true});
  atomicWrite(paths.meta,JSON.stringify(record));
  atomicWrite(paths.active,record.draft.docId);
}
function persistentDraftView(record){
  return {
    draft:record.draft,
    media:record.media,
    publication:record.publication.telegram,
    updatedAt:record.updatedAt,
    owner:{
      kind:record.owner.kind,
      ...(record.owner.kind==="telegram"?{telegramUserId:record.owner.telegramUserId}:{})
    }
  };
}
function savePersistentDraft(owner,draft,file=null){
  draftValid(draft);
  if(!/^[a-f0-9-]{36}$/i.test(String(draft.docId||"")))throw new HttpError(400,"Documento inválido");
  const paths=persistentDraftPaths(owner,draft.docId);
  let existing=readPersistentDraft(owner,draft.docId);
  if(existing&&draft.revision<existing.draft.revision)throw new HttpError(409,"Uma revisão mais recente deste rascunho já está persistida");
  let media=null;
  if(draft.media){
    if(file){
      if(file.id!==draft.media.id||file.kind!==draft.media.kind)throw new HttpError(400,"O anexo não corresponde ao rascunho");
      if(!file.bytes?.length||file.bytes.length>20_000_000)throw new HttpError(400,"Mídia grande demais");
      if(typeof file.mime!=="string"||!file.mime.trim())throw new HttpError(400,"Tipo de mídia inválido");
      mkdirSync(paths.dir,{recursive:true});
      atomicWrite(paths.file,file.bytes);
      media={id:draft.media.id,kind:draft.media.kind,name:cleanFileName(file.name),mime:file.mime,size:file.bytes.length};
    }else if(existing?.media?.id===draft.media.id&&existsSync(paths.file)&&statSync(paths.file).size===existing.media.size){
      media=existing.media;
    }else{
      throw new HttpError(409,"O anexo do rascunho precisa ser persistido junto com o documento");
    }
  }else{
    try{if(existsSync(paths.file))unlinkSync(paths.file);}catch(error){console.error("Persistent media cleanup",error);}
  }
  const record={
    schema:1,
    ownerFingerprint:ownerFingerprint(owner),
    owner:{kind:owner.kind,telegramUserId:owner.kind==="telegram"?owner.telegramUserId:""},
    updatedAt:Date.now(),
    draft:{...draft},
    media,
    publication:existing?.publication||{telegram:null}
  };
  writePersistentRecord(owner,record);
  return record;
}

function handoffFiles(token) {
  return { meta: HANDOFF_DIR + "/" + token + ".json", file: HANDOFF_DIR + "/" + token + ".bin" };
}

function writeHandoff(token,state){
  const paths=handoffFiles(token);
  writeFileSync(paths.meta + ".tmp", JSON.stringify(state), { mode: 0o600 });
  renameSync(paths.meta + ".tmp", paths.meta);
}

function dropHandoff(token){
  const paths=handoffFiles(token);
  for(const path of [paths.meta,paths.file,paths.meta+".tmp"]){
    try{if(existsSync(path))unlinkSync(path);}catch(error){console.error("Handoff cleanup",path,error);}
  }
}

function handoffPublishRequestValid(request,draft,file){
  if(!request||typeof request!=="object"||Array.isArray(request)||request.type!=="publish")throw new Error("Ação da transferência inválida");
  if(typeof request.html!=="string"||!request.html.trim()||Buffer.byteLength(request.html,"utf8")>180_000)throw new Error("Conteúdo da publicação transferida inválido");
  try{richValid(request.html);}catch(error){throw new Error(error instanceof Error?error.message:"Conteúdo da publicação transferida inválido");}
  const kind=typeof request.kind==="string"?request.kind:"";
  const id=typeof request.id==="string"?request.id:"";
  if(file){
    if(!draft.media||draft.media.id!==file.id||draft.media.kind!==file.kind)throw new Error("Anexo da transferência não corresponde ao rascunho");
    if(kind!==file.kind||id!==file.id)throw new Error("Ação da transferência não corresponde ao anexo");
  }else if(kind||id){
    throw new Error("Ação da transferência referencia anexo ausente");
  }
  return {type:"publish",html:request.html,kind,id};
}

function handoffActionValid(action,draft,file){
  if(action===null)return;
  if(!action||typeof action!=="object"||Array.isArray(action)||action.type!=="publish")throw new Error("Estado de publicação da transferência inválido");
  if(!["pending","sending","succeeded","failed","uncertain"].includes(action.status))throw new Error("Estado de publicação da transferência inválido");
  if(!Number.isInteger(action.attempts)||action.attempts<0)throw new Error("Estado de publicação da transferência inválido");
  for(const key of ["startedAt","finishedAt"]){
    if(!Number.isFinite(action[key])||action[key]<0)throw new Error("Estado de publicação da transferência inválido");
  }
  if(typeof action.serverBootId!=="string"||typeof action.error!=="string")throw new Error("Estado de publicação da transferência inválido");
  if(action.request!==null)handoffPublishRequestValid(action.request,draft,file);
  if(action.status!=="uncertain"&&action.request===null)throw new Error("Estado de publicação da transferência inválido");
  if(action.status==="succeeded"){
    if(!action.result||!["sendRichMessage","editMessageText"].includes(action.result.via)||!Number.isInteger(action.result.messageId)||action.result.messageId<=0)throw new Error("Resultado da publicação transferida inválido");
  }else if(action.result!==null){
    throw new Error("Estado de publicação da transferência inválido");
  }
}

function handoffActionView(action,draft){
  if(!action)return null;
  return {
    type:"publish",
    status:action.status,
    attempts:action.attempts,
    result:action.result,
    error:action.error,
    startedAt:action.startedAt,
    finishedAt:action.finishedAt,
    doc:draft.docId,
    revision:Number.isSafeInteger(draft.revision)&&draft.revision>=0?draft.revision:0
  };
}

function readHandoff(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const paths = handoffFiles(token);
  if (!existsSync(paths.meta)) return null;
  try{
    const meta=JSON.parse(readFileSync(paths.meta,"utf8"));
    if(!meta||typeof meta!=="object"||!Number.isFinite(meta.expires)||!meta.draft)throw new Error("Transferência persistida inválida");
    if(meta.expires<Date.now()){dropHandoff(token);return null;}
    draftValid(meta.draft);
    if(meta.claimedBy!==undefined&&typeof meta.claimedBy!=="string")throw new Error("Transferência persistida inválida");
    if(meta.file!==null&&meta.file!==undefined){
      const file=meta.file;
      if(!file||typeof file!=="object"||!/^[A-Za-z0-9_-]{1,64}$/.test(String(file.id||""))||!["image","video","audio","voice","document"].includes(file.kind)||typeof file.name!=="string"||!file.name||typeof file.mime!=="string"||!file.mime||!Number.isInteger(file.size)||file.size<1||file.size>20_000_000)throw new Error("Transferência persistida inválida");
      if(!existsSync(paths.file)||statSync(paths.file).size!==file.size)throw new Error("Arquivo da transferência inválido");
    }
    let changed=false;
    if(meta.purpose===undefined){meta.purpose="transfer";changed=true;}
    if(!["transfer","import"].includes(meta.purpose))throw new Error("Finalidade da transferência persistida inválida");
    if(meta.action===undefined){
      const legacyPublish=meta.draft.action==="publish";
      if(Object.hasOwn(meta.draft,"action")){meta.draft={...meta.draft};delete meta.draft.action;changed=true;}
      meta.action=legacyPublish?{
        type:"publish",status:"uncertain",attempts:0,request:null,result:null,
        error:"Esta transferência foi criada antes do controle idempotente. Confira o chat antes de iniciar outra publicação.",
        startedAt:0,finishedAt:Date.now(),serverBootId:""
      }:null;
      changed=true;
    }
    handoffActionValid(meta.action,meta.draft,meta.file||null);
    if(meta.purpose==="import"&&(meta.file||meta.action))throw new Error("Importação persistida contém estado incompatível");
    if(meta.action?.status==="sending"&&(meta.action.serverBootId!==SERVER_BOOT_ID||!ACTIVE_HANDOFF_SENDS.has(token))){
      meta.action.status="uncertain";
      meta.action.error=meta.action.serverBootId!==SERVER_BOOT_ID
        ?"O backend foi reiniciado durante o envio. O resultado pode ter sido aceito pelo Telegram."
        :"O envio foi interrompido antes de registrar um resultado confirmado. Confira o chat antes de iniciar outra publicação.";
      meta.action.finishedAt=Date.now();
      meta.action.serverBootId="";
      meta.expires=Date.now()+HANDOFF_TTL;
      changed=true;
    }
    if(changed){
      try{writeHandoff(token,meta);}
      catch(error){console.error("Handoff state repair",token,error);}
    }
    return meta;
  }catch(error){
    console.error("Discarding invalid handoff",token,error);
    dropHandoff(token);
    return null;
  }
}

function sweepHandoffs(){
  for(const name of readdirSync(HANDOFF_DIR)){
    const match=/^([a-f0-9]{32})\.json$/.exec(name);
    if(!match)continue;
    try{readHandoff(match[1]);}
    catch(error){
      console.error("Discarding invalid handoff",match[1],error);
      dropHandoff(match[1]);
    }
  }
}

function saveHandoff(draft, file, actionRequest=null, purpose="transfer", claimedBy="") {
  sweepHandoffs();
  if(!["transfer","import"].includes(purpose))throw new Error("Finalidade da transferência inválida");
  if(typeof claimedBy!=="string")throw new Error("Vínculo da transferência inválido");
  if(purpose==="import"&&(file||actionRequest||draft?.action==="publish"))throw new Error("Importação não pode conter publicação ou anexo local");
  draftValid(draft);
  const local = draft.html.match(/data-media-id="([A-Za-z0-9_-]{1,64})"/);
  if (local && !file) throw new Error("O anexo local precisa acompanhar o rascunho");
  if(file){
    if(!local||!draft.media||draft.media.id!==local[1]||!["image","video","audio","voice","document"].includes(draft.media.kind))throw new Error("Anexo do rascunho inválido");
    if(!file.bytes?.length||file.bytes.length>20_000_000)throw new Error("Mídia grande demais");
    if(typeof file.mime!=="string"||!file.mime.trim())throw new Error("Tipo de mídia inválido");
    cleanFileName(file.name);
  }
  const storedDraft={...draft};
  const legacyPublish=storedDraft.action==="publish";
  delete storedDraft.action;
  draftValid(storedDraft);
  let action=null;
  if(actionRequest){
    const request=handoffPublishRequestValid(actionRequest,storedDraft,file?{id:storedDraft.media.id,kind:storedDraft.media.kind}:null);
    action={type:"publish",status:"pending",attempts:0,request,result:null,error:"",startedAt:0,finishedAt:0,serverBootId:""};
  }else if(legacyPublish){
    action={
      type:"publish",status:"uncertain",attempts:0,request:null,result:null,
      error:"Esta transferência não contém uma ação idempotente. Confira o chat antes de iniciar outra publicação.",
      startedAt:0,finishedAt:Date.now(),serverBootId:""
    };
  }
  const token = randomUUID().replace(/-/g, "");
  const paths = handoffFiles(token);
  const meta = {
    expires: Date.now() + HANDOFF_TTL,
    draft:storedDraft,
    file:file?{id:storedDraft.media.id,kind:storedDraft.media.kind,name:cleanFileName(file.name),mime:file.mime,size:file.bytes.length}:null,
    claimedBy,
    purpose,
    action
  };
  try{
    if (file) writeFileSync(paths.file, file.bytes, { mode: 0o600 });
    writeHandoff(token,meta);
    return token;
  }catch(error){
    dropHandoff(token);
    throw error;
  }
}

async function publishHandoff(token,state,initData){
  const action=state.action;
  if(!action||action.type!=="publish")throw new HttpError(400,"Esta transferência não possui publicação pendente");
  if(action.status==="succeeded")return {code:200,reused:true,action:handoffActionView(action,state.draft)};
  if(action.status==="sending")return {code:202,reused:true,action:handoffActionView(action,state.draft)};
  if(action.status==="uncertain")return {code:409,reused:true,action:handoffActionView(action,state.draft)};
  if(!action.request)throw new HttpError(409,"A publicação transferida não pode ser repetida com segurança");

  action.status="sending";
  action.attempts++;
  action.result=null;
  action.error="";
  action.startedAt=Date.now();
  action.finishedAt=0;
  action.serverBootId=SERVER_BOOT_ID;
  state.expires=Date.now()+HANDOFF_TTL;
  ACTIVE_HANDOFF_SENDS.add(token);
  try{
    writeHandoff(token,state);

    let file=null;
    if(state.file){
      const path=handoffFiles(token).file;
      if(!existsSync(path))throw new HttpError(409,"Anexo da transferência indisponível");
      file={...state.file,bytes:readFileSync(path)};
    }
    try{
      const result=await publishTelegramPersistent(initData,state.draft,action.request.html,file);
      action.status="succeeded";
      action.result=result;
      action.error="";
      action.finishedAt=Date.now();
      action.serverBootId="";
      state.expires=Date.now()+HANDOFF_TTL;
      writeHandoff(token,state);
      return {code:200,reused:false,action:handoffActionView(action,state.draft)};
    }catch(error){
      const knownFailure=error instanceof HttpError || (error instanceof DeliveryError&&error.outcome==="failed");
      action.status=knownFailure?"failed":"uncertain";
      action.result=null;
      action.error=error instanceof Error?error.message:"Não foi possível confirmar a publicação";
      action.finishedAt=Date.now();
      action.serverBootId="";
      state.expires=Date.now()+HANDOFF_TTL;
      writeHandoff(token,state);
      return {code:knownFailure?(error instanceof HttpError?error.status:502):409,reused:false,action:handoffActionView(action,state.draft)};
    }
  }finally{
    ACTIVE_HANDOFF_SENDS.delete(token);
  }
}

function richEmojiImage(value){
  let url;
  try{url=new URL(String(value||""));}catch{return false;}
  return url.protocol==="tg:"&&url.hostname==="emoji"&&/^\d+$/.test(url.searchParams.get("id")||"")&&[...url.searchParams.keys()].every(key=>key==="id");
}

async function sendRich(initData,html,file=null,messageId=0){
  let body;
  try{
    richValid(html);
    const { chatId } = userFromInitData(String(initData || ""));
    const editing=Number.isInteger(messageId)&&messageId>0;
    const doc = parseDocument(String(html));
    const media = [];
    let attached = false;
    const kinds = { img:"photo",video:"video",audio:"audio","tg-document":"document" };
    const visit = node => {
      if (node.type === "tag" && kinds[node.name]) {
        const kind = kinds[node.name], src = node.attribs.src;
        if(node.name==="img"&&richEmojiImage(src)){
          node.children?.forEach(visit);
          return;
        }
        let id, source;
        if (/^https?:\/\//i.test(src)) {
          id = randomUUID().replace(/-/g, "");
          source = src;
        } else if (src.startsWith("tg://")) {
          const url = new URL(src);
          id = url.searchParams.get("id") || "";
          const fileKind=kind==="audio"&&file?.kind==="voice"?"voice":({photo:"image",video:"video",audio:"audio",document:"document"})[kind];
          if(file&&id===file.id&&url.hostname===kind&&file.kind===fileKind){
            source="attach://upload";
            attached=true;
          }else{
            throw new Error("Anexe a mídia novamente antes de publicar");
          }
        } else {
          throw new Error("Endereço de mídia inválido");
        }
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Identificador de mídia inválido");
        node.attribs.src = `tg://${kind}?id=${id}`;
        const mediaType=kind==="audio"&&file?.kind==="voice"&&source==="attach://upload"?"voice_note":kind;
        media.push({id,media:{type:mediaType,media:source}});
      }
      node.children?.forEach(visit);
    };
    doc.children.forEach(visit);
    if (file && !attached) throw new Error("A mídia anexada não está no documento");
    const rich = { html: DomUtils.getInnerHTML(doc) };
    if (media.length) rich.media = media;
    body = { chat_id: chatId, ...(editing?{message_id:messageId}:{}), rich_message: rich };
    if (file) {
      const kind={image:"photo",video:"video",audio:"audio",voice:"voice_note",document:"document"}[file.kind];
      const mimeContract={
        image:/^image\//,
        video:/^video\//,
        audio:/^audio\//,
        voice:/^audio\//,
        document:/^(?:image|video|audio|application|text)\//
      }[file.kind];
      if (!kind || !mimeContract?.test(file.mime) || !/^[A-Za-z0-9_-]{1,64}$/.test(file.id)) throw new Error("Mídia inválida");
      if(file.kind==="image"&&file.bytes.length>10_000_000)throw new Error("Fotos devem ter no máximo 10 MB");
      const form = new FormData();
      form.set("chat_id", chatId);
      if(editing)form.set("message_id",String(messageId));
      form.set("rich_message", JSON.stringify(body.rich_message));
      form.set("upload", new Blob([file.bytes], {type:file.mime}), file.name);
      body = form;
    }
  }catch(error){
    throw asHttpError(error,400,"Dados inválidos para publicação");
  }
  const method=messageId>0?"editMessageText":"sendRichMessage";
  const msg = await telegramCall(method, body);
  const returnedId=messageId>0?messageId:Number(msg?.message_id||0);
  if(!Number.isInteger(returnedId)||returnedId<=0)throw new DeliveryError("O Telegram não confirmou o identificador da mensagem","uncertain");
  return { via: method, messageId: returnedId, edited: messageId>0 };
}

async function publishTelegramPersistent(initData,draft,html,file=null){
  const owner=draftOwner({initData});
  if(owner.kind!=="telegram")throw new HttpError(400,"Publicação Telegram exige identidade Telegram");
  let record=savePersistentDraft(owner,draft,file);
  const prior=record.publication.telegram;
  if(prior?.status==="pending"||prior?.status==="uncertain"){
    throw new HttpError(409,prior.error||"O resultado da publicação anterior é incerto; confira o chat antes de publicar novamente");
  }
  if(prior?.status==="succeeded"){
    const result=await sendRich(initData,html,file,prior.messageId);
    record=readPersistentDraft(owner,draft.docId)||record;
    record.publication.telegram={
      status:"succeeded",
      telegramUserId:owner.telegramUserId,
      chatId:owner.chatId,
      messageId:prior.messageId,
      revision:draft.revision,
      updatedAt:Date.now(),
      error:""
    };
    record.updatedAt=Date.now();
    try{writePersistentRecord(owner,record);}
    catch(error){
      console.error("Telegram edit provenance",error);
      throw new DeliveryError("A mensagem foi atualizada, mas o vínculo persistente não pôde ser confirmado","uncertain");
    }
    return result;
  }
  record.publication.telegram={
    status:"pending",
    telegramUserId:owner.telegramUserId,
    chatId:owner.chatId,
    messageId:0,
    revision:draft.revision,
    updatedAt:Date.now(),
    error:""
  };
  record.updatedAt=Date.now();
  writePersistentRecord(owner,record);
  let result;
  try{
    result=await sendRich(initData,html,file);
  }catch(error){
    record=readPersistentDraft(owner,draft.docId)||record;
    if(error instanceof DeliveryError&&error.outcome==="failed"){
      record.publication.telegram=null;
    }else{
      record.publication.telegram={
        status:"uncertain",
        telegramUserId:owner.telegramUserId,
        chatId:owner.chatId,
        messageId:0,
        revision:draft.revision,
        updatedAt:Date.now(),
        error:error instanceof Error?error.message:"Resultado da publicação incerto"
      };
    }
    record.updatedAt=Date.now();
    try{writePersistentRecord(owner,record);}catch(storageError){console.error("Telegram provenance failure",storageError);}
    throw error;
  }
  record=readPersistentDraft(owner,draft.docId)||record;
  record.publication.telegram={
    status:"succeeded",
    telegramUserId:owner.telegramUserId,
    chatId:owner.chatId,
    messageId:result.messageId,
    revision:draft.revision,
    updatedAt:Date.now(),
    error:""
  };
  record.updatedAt=Date.now();
  try{writePersistentRecord(owner,record);}
  catch(error){
    console.error("Telegram publication provenance",error);
    throw new DeliveryError("Mensagem enviada, mas o vínculo com o publicador não pôde ser persistido; não repita o envio","uncertain");
  }
  return result;
}

function webhookSecret(){
  return createHmac("sha256",BOT_TOKEN).update("MDTXTRT_WEBHOOK").digest("hex");
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

function richValid(html){
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

function telegraphValid(content) {
  const tags = new Set("a aside b blockquote br code em figcaption figure h3 h4 hr i iframe img li ol p pre s strong u ul video".split(" "));
  let count = 0;
  const walk = (node, depth = 0) => {
    if (++count > 10000 || depth > 40) throw new Error("Conteúdo do Telegraph grande demais");
    if (typeof node === "string") return;
    if (!node || typeof node !== "object" || Array.isArray(node) || !tags.has(node.tag)) throw new Error("Elemento do Telegraph inválido");
    if (node.attrs) for (const [key, value] of Object.entries(node.attrs)) {
      if (!(key === "href" && node.tag === "a" || key === "src" && ["img", "video", "iframe"].includes(node.tag)) || typeof value !== "string") throw new Error("Atributo do Telegraph inválido");
      let url;
      try { url = new URL(value); } catch { throw new Error("Link do Telegraph inválido"); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Link do Telegraph inválido");
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error("Conteúdo do Telegraph inválido");
      node.children.forEach(child => walk(child, depth + 1));
    }
  };
  if (!Array.isArray(content) || !content.length || Buffer.byteLength(JSON.stringify(content)) > 65536) throw new Error("Conteúdo do Telegraph inválido");
  content.forEach(node => walk(node));
}

function safeLink(value){
  let url;
  try{url=new URL(value);}catch{throw new Error("Link inválido");}
  if(!["http:","https:","tg:","mailto:","tel:"].includes(url.protocol))throw new Error("Link inválido");
  return url.href;
}

function entityWrap(entity, inner, text, mode) {
  const raw = text.slice(entity.start, entity.end);
  const link = entity.type === "text_link" ? safeLink(entity.url || "") : entity.type === "url" ? safeLink(raw) : entity.type === "text_mention" && entity.user?.id ? "tg://user?id=" + entity.user.id : "";
  if (mode === "md") {
    if (entity.type === "bold") return "**" + inner + "**";
    if (entity.type === "italic") return "*" + inner + "*";
    if (entity.type === "underline") return "<u>" + inner + "</u>";
    if (entity.type === "strikethrough") return "~~" + inner + "~~";
    if (entity.type === "spoiler") return "||" + inner + "||";
    if (entity.type === "code" || entity.type === "pre") return "\`" + raw.replace(/\`/g, "\\\`") + "\`";
    if (link) return "[" + inner + "](<" + link + ">)";
    return inner;
  }
  if (entity.type === "bold") return "<b>" + inner + "</b>";
  if (entity.type === "italic") return "<i>" + inner + "</i>";
  if (entity.type === "underline") return "<u>" + inner + "</u>";
  if (entity.type === "strikethrough") return "<s>" + inner + "</s>";
  if (entity.type === "spoiler") return "<tg-spoiler>" + inner + "</tg-spoiler>";
  if (entity.type === "code" || entity.type === "pre") return "<code>" + htmlEscape(raw) + "</code>";
  if (link) return "<a href=\"" + htmlEscape(link) + "\">" + inner + "</a>";
  return inner;
}

function formatText(text, entities, mode) {
  const root = { start: 0, end: text.length, children: [] };
  const stack = [root];
  const types = new Set(["bold", "italic", "underline", "strikethrough", "spoiler", "code", "pre", "text_link", "url", "text_mention"]);
  const spans = (entities || []).filter(e => types.has(e.type) && Number.isInteger(e.offset) && Number.isInteger(e.length) && e.offset >= 0 && e.length > 0 && e.offset + e.length <= text.length)
    .map(e => ({ ...e, start: e.offset, end: e.offset + e.length }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  for (const span of spans) {
    while (stack.length > 1 && span.start >= stack[stack.length - 1].end) stack.pop();
    const parent = stack[stack.length - 1];
    if (span.start < parent.start || span.end > parent.end) continue;
    const node = { ...span, children: [] };
    parent.children.push(node);
    stack.push(node);
  }
  const render = node => {
    let out = "";
    let at = node.start;
    for (const child of node.children) {
      if (child.start < at) continue;
      out += htmlEscape(text.slice(at, child.start)) + render(child);
      at = child.end;
    }
    out += htmlEscape(text.slice(at, node.end));
    return node === root ? out : entityWrap(node, out, text, mode);
  };
  return render(root);
}

function richHTML(text, entities) {
  return "<p>" + formatText(text, entities, "html").replace(/\n/g, "<br>") + "</p>";
}

function commandBody(message) {
  const text = String(message.text || "");
  const prefix = /^\/[a-z0-9_]+(?:@[a-z0-9_]+)?(?:\s+|$)/i.exec(text)?.[0].length || text.length;
  const rest = text.slice(prefix);
  const lead = rest.length - rest.trimStart().length;
  const body = rest.trim();
  const start = prefix + lead;
  const end = start + body.length;
  const entities = (message.entities || []).filter(e => e.offset >= start && e.offset + e.length <= end).map(e => ({ ...e, offset: e.offset - start }));
  return { text: body, entities };
}

function repliedBody(message) {
  const reply = message.reply_to_message;
  if (!reply) return { text: "", entities: [] };
  const source = typeof reply.text === "string" ? reply.text : String(reply.caption || "");
  const sourceEntities = typeof reply.text === "string" ? reply.entities : reply.caption_entities;
  return { text: source, entities: sourceEntities || [] };
}

function cutBody(body, length) {
  const rest = body.text.slice(length);
  const lead = rest.length - rest.trimStart().length;
  const text = rest.slice(lead).trimEnd();
  const start = length + lead;
  const end = start + text.length;
  const entities = body.entities.filter(e => e.offset >= start && e.offset + e.length <= end).map(e => ({ ...e, offset: e.offset - start }));
  return { text, entities };
}

async function sendBotRich(chatId,html,replyTo){
  const body = { chat_id: chatId, rich_message: { html } };
  if (replyTo) body.reply_parameters = { message_id: replyTo };
  return telegramCall("sendRichMessage", body);
}

function documentLaunchURL(base,newToken="") {
  if(!newToken)return base;
  if(!/^[a-f0-9]{32}$/.test(newToken))throw new Error("Token de novo documento inválido");
  const url=new URL(base);
  url.searchParams.set("new",newToken);
  return url.href;
}

function appButton(newToken="") {
  const miniURL=documentLaunchURL(MINI_APP_URL,newToken);
  const browserURL=documentLaunchURL(WEBHOOK_BASE + "/",newToken);
  const miniLabel=newToken?"Criar novo documento no Mini App":"Mini App MDTXTRT";
  const browserLabel=newToken?"Criar novo documento no browser":"Abrir MDTXTRT no browser";
  return "<tg-button-row align=\"center\"><tg-button type=\"web_app\" style=\"success\" url=\"" + htmlEscape(miniURL) + "\">"+miniLabel+"</tg-button></tg-button-row>" +
    "<tg-button-row align=\"center\"><tg-button type=\"url\" style=\"danger\" url=\"" + htmlEscape(browserURL) + "\">"+browserLabel+"</tg-button></tg-button-row>";
}

function appMessage(title,newToken="") {
  return "<h1>MDTXTRT</h1><p>" + title + "</p>" + appButton(newToken);
}

function importAppButton(token){
  if(!/^[a-f0-9]{32}$/.test(token))throw new Error("Token de importação inválido");
  const url=WEBHOOK_BASE+"/telegram/open?handoff="+token;
  return "<tg-button-row align=\"center\"><tg-button type=\"url\" style=\"success\" url=\"" + htmlEscape(url) + "\">Continuar no Mini App</tg-button></tg-button-row>";
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

async function sendDocument(chatId,name,content,type){
  if(typeof content!=="string"||!content.trim())throw new Error("Não há texto para exportar");
  if(Buffer.byteLength(content,"utf8")>1_500_000)throw new Error("O arquivo excede o limite de exportação");
  const fileName=cleanFileName(name);
  const mime=type==="text/markdown"?"text/markdown":type==="text/plain"?"text/plain":"";
  if(!mime)throw new Error("Formato de exportação inválido");
  const ext=type==="text/markdown"?".md":".txt";
  if(!fileName.toLowerCase().endsWith(ext))throw new Error("Extensão de arquivo incompatível");
  const data=content;
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", "Exportado pelo MDTXTRT");
  form.set("document", new Blob([data], { type: mime }), fileName);
  const sent = await telegramCall("sendDocument", form);
  return { messageId: sent.message_id, fileName };
}

async function handleBotUpdate(update) {
  if(update.callback_query){
    const q=update.callback_query;
    await telegramCall("answerCallbackQuery",{
      callback_query_id: q.id,
      text: q.data ? String(q.data).slice(0, 200) : "OK"
    });
    return;
  }
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
    await sendBotRich(chatId,"<p>O documento anexado só pode ser usado com <b>/importar</b>. Para <b>/enviar</b> ou <b>/exportar</b>, responda a uma mensagem de texto.</p>",message.message_id);
    return;
  }
  if(!textMatch)return;
  const body = commandBody(message);
  if (command === "start" || command === "app") {
    await sendBotRich(chatId, appMessage("Edite, publique e exporte seus textos do Telegram."), message.message_id);
    return;
  }
  if (command === "novo") {
    const newToken=randomUUID().replace(/-/g,"");
    await sendBotRich(chatId, appMessage("Crie outro documento sem substituir o rascunho local atual.",newToken), message.message_id);
    return;
  }
  if (command === "ajuda") {
    const html = "<h1>Comandos</h1><p><b>/app</b> abre o documento local ativo no Mini App.</p><p><b>/novo</b> abre outro documento e preserva o rascunho local anterior neste dispositivo.</p><p><b>/enviar texto</b> envia o texto como mensagem rica. Também pode responder a uma mensagem com <b>/enviar</b>.</p><p><b>/exportar [txt|md]</b> exporta o texto da mensagem respondida como arquivo.</p><p><b>/importar</b> importa um documento .md ou .txt anexado ou respondido.</p>" + appButton();
    await sendBotRich(chatId, html, message.message_id);
    return;
  }
  if (command === "enviar") {
    const content = body.text ? body : repliedBody(message);
    if (!content.text.trim()) {
      await sendBotRich(chatId, "<p>Use <b>/enviar texto</b> ou responda a uma mensagem com <b>/enviar</b>.</p>" + appButton(), message.message_id);
      return;
    }
    await sendBotRich(chatId, richHTML(content.text, content.entities), message.message_id);
    return;
  }
  if (command === "exportar") {
    let content = body;
    let type = "txt";
    const choice = /^(txt|md)(?:\s+|$)/i.exec(body.text);
    if (choice) {
      type = choice[1].toLowerCase() === "txt" ? "txt" : "md";
      content = cutBody(body, choice[0].length);
    }
    if (!content.text) content = repliedBody(message);
    if (!content.text.trim()) {
      await sendBotRich(chatId, "<p>Responda a uma mensagem com <b>/exportar</b> ou envie <b>/exportar txt texto</b> ou <b>/exportar md texto</b>.</p>" + appButton(), message.message_id);
      return;
    }
    const output = type === "md" ? formatText(content.text, content.entities, "md") : content.text;
    await sendDocument(chatId, "mdtxtrt." + type, output, type === "md" ? "text/markdown" : "text/plain");
  }
}

async function configureBot(){
  const bot=await telegramCall("getMe",{});
  if(!/^[A-Za-z0-9_]{5,32}$/.test(bot.username||""))throw new Error("Bot sem nome de usuário");
  botLink="https://t.me/"+bot.username;
  const secret=webhookSecret();
  await telegramCall("setMyCommands",{commands:BOT_COMMANDS,scope:{type:"all_private_chats"}});
  await telegramCall("deleteMyCommands",{scope:{type:"default"}});
  await telegramCall("setChatMenuButton",{menu_button:{type:"web_app",text:"Mini App MDTXTRT",web_app:{url:MINI_APP_URL}}});
  await telegramCall("setWebhook",{url:WEBHOOK_BASE+"/telegram/webhook",secret_token:secret,allowed_updates:["message","callback_query"]});
  console.log("Telegram ready");
}

async function telegraphCall(method, body) {
  let res;
  try {
    res = await fetch(`https://api.telegra.ph/${method}`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  } catch (error) {
    console.error("Telegraph", method, error);
    throw new DeliveryError("Resultado incerto no Telegraph após falha de conexão; confira a página antes de tentar novamente");
  }
  let json;
  try { json = await res.json(); } catch { throw new DeliveryError("Resultado incerto no Telegraph: resposta inválida; confira a página antes de tentar novamente"); }
  if (!res.ok || !json.ok) {
    console.error("Telegraph", method, json.error || "Falha na publicação");
    throw new Error("O Telegraph não aceitou a publicação");
  }
  return json.result;
}

function readPages() {
  if (!existsSync(PAGES_FILE)) return {};
  let pages;
  try { pages = JSON.parse(readFileSync(PAGES_FILE, "utf8")); } catch { throw new Error("Não foi possível recuperar as páginas do Telegraph"); }
  if(!pages||typeof pages!=="object"||Array.isArray(pages))throw new Error("Mapeamento de páginas do Telegraph inválido");
  return pages;
}

function writePages(pages) {
  const tmp=PAGES_FILE+".tmp";
  try{
    writeFileSync(tmp, JSON.stringify(pages), { mode: 0o600 });
    renameSync(tmp, PAGES_FILE);
  }catch(error){
    try{if(existsSync(tmp))unlinkSync(tmp);}catch(cleanupError){console.error("Telegraph pages cleanup",cleanupError);}
    throw error;
  }
}

async function ensureTelegraphToken() {
  if (telegraphToken) return telegraphToken;
  if(existsSync(PAGES_FILE)&&Object.keys(readPages()).length){
    throw new Error("Credencial Telegraph ausente para páginas persistidas");
  }
  const account = await telegraphCall("createAccount", { short_name: "MDTXTRT", author_name: "MDTXTRT" });
  const token=String(account?.access_token||"").trim();
  if(!token)throw new Error("O Telegraph não retornou uma credencial válida");
  mkdirSync(DATA, { recursive: true });
  const tmp=TELEGRAPH_FILE+".tmp";
  try{
    writeFileSync(tmp, token, { mode: 0o600 });
    renameSync(tmp, TELEGRAPH_FILE);
  }catch(error){
    try{if(existsSync(tmp))unlinkSync(tmp);}catch(cleanupError){console.error("Telegraph token cleanup",cleanupError);}
    throw error;
  }
  telegraphToken=token;
  return telegraphToken;
}

async function verifyTelegraphPage(path) {
  const page = await telegraphCall("getPage", { path, return_content: "true" });
  if (!page?.path || page.path !== path || !page.url) throw new Error("O Telegraph não confirmou a página");
  return page;
}

async function publishTelegraphOne(title, content, path = "", owner = "", doc = "") {
  const pageTitle = String(title || "").trim();
  if (!pageTitle) throw new HttpError(400,"Dê um nome à página antes de publicar");
  if (Array.from(pageTitle).length > 256) throw new HttpError(400,"O nome da página deve ter até 256 caracteres");
  try{telegraphValid(content);}catch(error){throw asHttpError(error,400,"Conteúdo do Telegraph inválido");}
  if (!/^[a-f0-9-]{36}$/i.test(doc)) throw new HttpError(400,"Documento inválido");
  const pages = readPages();
  const key = owner + ":" + doc;
  const known = pages[key] || "";
  if (known && typeof known !== "string") {
    if (known.status === "pending") throw new HttpError(409,"Resultado anterior incerto no Telegraph; confira a página antes de criar outra");
    throw new Error("Mapeamento de páginas do Telegraph inválido");
  }
  if (path && known !== path) throw new HttpError(400,"Esta página não pertence a este documento");
  const target = String(path || known).trim();
  const token = await ensureTelegraphToken();
  const body = {
    access_token: token,
    title: pageTitle,
    author_name: "MDTXTRT",
    content: JSON.stringify(content),
    return_content: "true",
  };
  let page;
  if (target) {
    body.path = target;
    page = await telegraphCall("editPage", body);
  } else {
    pages[key] = {status:"pending"};
    writePages(pages);
    try {
      page = await telegraphCall("createPage", body);
    } catch (error) {
      if (!(error instanceof DeliveryError)) {
        delete pages[key];
        writePages(pages);
      }
      throw error;
    }
    if (!page?.path || typeof page.path !== "string") throw new DeliveryError("Resultado incerto no Telegraph: página criada sem caminho confirmado");
    pages[key] = page.path;
    try { writePages(pages); }
    catch (error) {
      console.error("Telegraph page mapping",error);
      throw new DeliveryError("Página criada, mas seu vínculo não pôde ser persistido; confira o Telegraph antes de tentar novamente");
    }
  }
  const verified = await verifyTelegraphPage(page.path);
  return { ...page, url: verified.url, path: verified.path };
}

function publishTelegraph(...args) {
  const next = telegraphQueue.then(() => publishTelegraphOne(...args));
  telegraphQueue=next.catch(error=>{console.error("Telegraph queue",error);});
  return next;
}

function safeFile(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent((urlPath || "/").split("?")[0]); } catch { return null; }
  let rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (rel.endsWith("/")) rel += "index.html";
  const abs = resolve(ROOT, rel);
  const inside = relative(ROOT, abs).split("\\").join("/");
  if (!inside || inside.startsWith("..") || inside.includes("\0") || !PUBLIC.has(inside)) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if(url.pathname==="/telegram/open"&&req.method==="GET"){
      const handoff=String(url.searchParams.get("handoff")||"");
      if(!/^[a-f0-9]{32}$/.test(handoff)||!readHandoff(handoff)){
        res.writeHead(410,{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"});
        res.end("A transferência expirou ou é inválida.");
        return;
      }
      res.writeHead(302,{location:botLink+"?startapp=h_"+handoff,"cache-control":"no-store"});
      res.end();
      return;
    }


    if (url.pathname === "/api/drafts/save" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const media=await readMedia(req);
        let draft;
        try{draft=JSON.parse(media.fields.draft||"");}catch{throw new HttpError(400,"Rascunho inválido");}
        const owner=draftOwner(media.fields);
        let file=null;
        if(media.file){
          if(!draft?.media)throw new HttpError(400,"Anexo sem metadados de rascunho");
          file={...media.file,id:draft.media.id,kind:draft.media.kind};
        }
        const record=savePersistentDraft(owner,draft,file);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify(persistentDraftView(record)));
      }catch(err){
        const code=err instanceof HttpError?err.status:507;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível persistir o rascunho"}));
      }
      return;
    }

    if (url.pathname === "/api/drafts/load" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        const doc=body?.doc===undefined?"":String(body.doc||"");
        if(doc&&!/^[a-f0-9-]{36}$/i.test(doc))throw new HttpError(400,"Documento inválido");
        const record=readPersistentDraft(owner,doc);
        if(!record){
          res.writeHead(404,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
          res.end(JSON.stringify({error:"Rascunho persistido não encontrado"}));
          return;
        }
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify(persistentDraftView(record)));
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível recuperar o rascunho"}));
      }
      return;
    }

    if (url.pathname === "/api/drafts/file" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        const doc=String(body?.doc||""),id=String(body?.id||"");
        if(!/^[a-f0-9-]{36}$/i.test(doc)||!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new HttpError(400,"Anexo persistido inválido");
        const record=readPersistentDraft(owner,doc);
        if(!record?.media||record.media.id!==id)throw new HttpError(404,"Anexo persistido não encontrado");
        const path=persistentDraftPaths(owner,doc).file;
        const bytes=readFileSync(path);
        res.writeHead(200,{"content-type":record.media.mime,"content-length":bytes.length,"cache-control":"no-store","x-mdtxtrt-file-name":encodeURIComponent(record.media.name),"x-mdtxtrt-file-kind":record.media.kind});
        res.end(bytes);
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível recuperar o anexo"}));
      }
      return;
    }

    if (url.pathname === "/api/handoff" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const media = await readMedia(req);
        let draft,action=null;
        try { draft = JSON.parse(media.fields.draft || ""); } catch { throw new Error("Rascunho inválido"); }
        if(media.fields.action){
          try{action=JSON.parse(media.fields.action);}catch{throw new Error("Ação da transferência inválida");}
        }
        const token = saveHandoff(draft, media.file || null, action);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ token, open: WEBHOOK_BASE + "/telegram/open?handoff=" + token }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Não foi possível transferir o rascunho" }));
      }
      return;
    }

    if (url.pathname === "/api/handoff/claim" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body = await readJson(req, 20000);
        const token = String(body?.token || "");
        const state = readHandoff(token);
        if (!state) throw new Error("Transferência expirada ou inválida");
        const { chatId } = userFromInitData(String(body?.initData || ""));
        if (state.claimedBy && state.claimedBy !== chatId) throw new Error("Transferência não pertence a esta sessão");
        state.claimedBy = chatId;
        writeHandoff(token,state);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ draft: state.draft, file: state.file, purpose: state.purpose, action: handoffActionView(state.action,state.draft) }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Não foi possível recuperar o rascunho" }));
      }
      return;
    }

    if (url.pathname === "/api/handoff/status" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body=await readJson(req,20000);
        const token=String(body?.token||"");
        const state=readHandoff(token);
        if(!state)throw new HttpError(410,"Transferência expirada ou inválida");
        const {chatId}=userFromInitData(String(body?.initData||""));
        if(!state.claimedBy||state.claimedBy!==chatId)throw new HttpError(403,"Transferência não pertence a esta sessão");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ action: handoffActionView(state.action,state.draft) }));
      } catch (err) {
        const code=err instanceof HttpError?err.status:400;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error?err.message:"Não foi possível consultar a transferência" }));
      }
      return;
    }

    if (url.pathname === "/api/handoff/publish" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body=await readJson(req,20000);
        const token=String(body?.token||"");
        const initData=String(body?.initData||"");
        const state=readHandoff(token);
        if(!state)throw new HttpError(410,"Transferência expirada ou inválida");
        const {chatId}=userFromInitData(initData);
        if(!state.claimedBy||state.claimedBy!==chatId)throw new HttpError(403,"Transferência não pertence a esta sessão");
        const outcome=await publishHandoff(token,state,initData);
        res.writeHead(outcome.code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ action: outcome.action, reused: outcome.reused, ...(outcome.action?.status==="succeeded"?{result:outcome.action.result}:{}) }));
      } catch (err) {
        const code=err instanceof HttpError?err.status:400;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error?err.message:"Não foi possível publicar a transferência" }));
      }
      return;
    }

    if (url.pathname === "/api/handoff/file" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body = await readJson(req, 20000);
        const token = String(body?.token || "");
        const state = readHandoff(token);
        if (!state?.file) throw new Error("Anexo da transferência indisponível");
        const { chatId } = userFromInitData(String(body?.initData || ""));
        if (!state.claimedBy || state.claimedBy !== chatId) throw new Error("Transferência não pertence a esta sessão");
        const path = handoffFiles(token).file;
        if (!existsSync(path)) throw new Error("Anexo da transferência indisponível");
        const bytes = readFileSync(path);
        res.writeHead(200,{"content-type":state.file.mime,"content-length":bytes.length,"cache-control":"no-store"});
        res.end(bytes);
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Não foi possível recuperar o anexo" }));
      }
      return;
    }

    if (url.pathname === "/api/telegraph/recover" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        let body;
        try{body=await readJson(req,20000);}catch(error){throw asHttpError(error,400,"Dados de recuperação inválidos");}
        const doc=String(body?.doc||"");
        if (!/^[a-f0-9-]{36}$/i.test(doc)) throw new HttpError(400,"Documento inválido");
        const revision=telegraphRevision(body?.revision);
        const owner=telegraphOwner(body);
        const path = readPages()[owner + ":" + doc] || "";
        if (path && typeof path !== "string") throw new HttpError(409,"Resultado anterior incerto no Telegraph; confira a página antes de criar outra");
        if (!path) {
          res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "Página não encontrada" }));
          return;
        }
        const page = await verifyTelegraphPage(path);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ path: page.path, url: page.url, doc, revision }));
      } catch (err) {
        const code = err instanceof HttpError ? err.status : 502;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Não foi possível recuperar a página" }));
      }
      return;
    }

    if (req.method === "OPTIONS") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if(url.pathname==="/telegram/webhook"&&req.method==="POST"){
      if (!sameSecret(req.headers["x-telegram-bot-api-secret-token"], webhookSecret())) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const update = await readJson(req);
        await handleBotUpdate(update);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
      } catch (err) {
        console.error("Telegram webhook", err);
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Não foi possível processar a mensagem" }));
      }
      return;
    }
    if (url.pathname === "/api/telegram/send" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        let media;
        try{media=await readMedia(req);}catch(error){throw asHttpError(error,400,"Mídia inválida");}
        const body=media.fields;
        if (typeof body.initData !== "string" || typeof body.html !== "string") throw new HttpError(400,"Os dados do envio estão incompletos");
        let result;
        if(typeof body.draft==="string"&&body.draft.trim()){
          let draft;
          try{draft=JSON.parse(body.draft);}catch{throw new HttpError(400,"Rascunho de publicação inválido");}
          let file=null;
          if(media.file){
            if(!draft?.media)throw new HttpError(400,"Anexo sem metadados de rascunho");
            file={...media.file,kind:draft.media.kind,id:draft.media.id};
          }
          result=await publishTelegramPersistent(body.initData,draft,body.html,file);
        }else{
          result=await sendRich(body.initData,body.html,media.file?{...media.file,kind:body.kind,id:body.id}:null);
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível publicar no Telegram";
        const code = err instanceof HttpError ? err.status : err instanceof DeliveryError && err.outcome === "uncertain" ? 409 : 502;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg, ...(err instanceof DeliveryError ? {outcome:err.outcome} : {}) }));
      }
      return;
    }
    if (url.pathname === "/api/telegram/session" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body=await readJson(req,10000);
        userFromInitData(String(body?.initData||""));
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Sessão Telegram inválida" }));
      }
      return;
    }
    if (url.pathname === "/api/telegraph/publish" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        let body;
        try{body=await readJson(req,150_000);}catch(error){throw asHttpError(error,400,"Dados da página inválidos");}
        if (!body || typeof body !== "object" || typeof body.title !== "string" || !Array.isArray(body.content) || (body.path !== undefined && typeof body.path !== "string")) throw new HttpError(400,"Os dados da página estão incompletos");
        const doc=String(body.doc||"");
        if(!/^[a-f0-9-]{36}$/i.test(doc))throw new HttpError(400,"Documento inválido");
        const revision=telegraphRevision(body.revision);
        const owner=telegraphOwner(body);
        const page = await publishTelegraph(body.title, body.content, body.path || "", owner, doc);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ url: page.url, path: page.path, doc, revision }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível publicar no Telegraph";
        const code = err instanceof HttpError ? err.status : err instanceof DeliveryError ? 409 : 502;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg, ...(err instanceof DeliveryError ? {outcome:err.outcome} : {}) }));
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Método não permitido" }));
      return;
    }
    const file = safeFile(url.pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Página não encontrada");
      return;
    }
    const ext = extname(file).toLowerCase();
    const type = MIME[ext];
    if (!type) throw new Error("Tipo de arquivo não configurado");
    const live = ext === ".html" || ext === ".js";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": live ? "no-cache" : "public, max-age=600",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).on("error", error => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      if (!res.destroyed) res.end(JSON.stringify({ error: "Não foi possível carregar este conteúdo" }));
    }).pipe(res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Não foi possível concluir a solicitação" }));
    } else if (!res.destroyed) res.destroy(error);
  }
});

async function start(){
  sweepHandoffs();
  await configureBot();
  const token=await ensureTelegraphToken();
  await telegraphCall("getAccountInfo",{access_token:token,fields:'["short_name","page_count"]'});
  console.log("Telegraph ready");
  server.listen(PORT,"0.0.0.0",()=>console.log(`MDTXTRT on ${PORT}`));
}
start().catch(error=>{
  console.error("MDTXTRT startup",error);
  process.exitCode=1;
});
