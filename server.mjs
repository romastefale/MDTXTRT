import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, readdirSync, copyFileSync, rmSync, openAsBlob } from "node:fs";
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
const TMP_DIR = DATA + "/tmp";
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
mkdirSync(TMP_DIR, { recursive: true });
if(existsSync(TELEGRAPH_FILE)){
  telegraphToken=readFileSync(TELEGRAPH_FILE,"utf8").trim();
  if(!telegraphToken)throw new Error("Credencial Telegraph persistida está vazia");
}
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
  ...["arrow_back","bold","buttons","chevron_right","dark_mode","details","export","file","footer","h1","h2","h3","h4","h5","h6","heading","italic","light_mode","link","list","menu","paragraph","plus","quote","redo","table","task","telegram","telegraph","underline","undo"].map(name=>`icons/${name}.svg`),
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
    const fields = {}, files = [], pending = [];
    let failed=false;
    const fail=error=>{
      if(failed)return;
      failed=true;
      for(const file of files)try{if(file.path&&existsSync(file.path))unlinkSync(file.path);}catch{}
      reject(error);
    };
    const bus = Busboy({headers:req.headers,limits:{files:50,fileSize:50_000_000,fields:8,fieldSize:400000}});
    bus.on("field",(key,value)=>{fields[key]=value;});
    bus.on("file",(key,stream,info)=>{
      if (!/^upload_[A-Za-z0-9_-]{1,64}$/.test(key)) {stream.resume();fail(new Error("Campo de mídia inválido"));return;}
      const path=TMP_DIR+"/"+randomUUID()+".upload";
      const file={field:key,id:key.slice(7),path,mime:info.mimeType,name:info.filename.slice(0,120),size:0};
      files.push(file);
      const task=new Promise((done,stop)=>{
        const out=createWriteStream(path,{mode:0o600});
        stream.on("data",chunk=>{file.size+=chunk.length;});
        stream.on("limit",()=>{out.destroy();stop(new Error("Arquivo acima do limite de 50 MB para upload multipart do Telegram"));});
        stream.on("error",error=>{out.destroy();stop(error);});
        out.on("error",stop);
        out.on("finish",done);
        stream.pipe(out);
      });
      pending.push(task);
    });
    bus.on("filesLimit",()=>fail(new Error("O Telegram aceita no máximo 50 mídias por Rich Message")));
    bus.on("error",fail);
    bus.on("close",async()=>{
      if(failed)return;
      try{
        await Promise.all(pending);
        if(files.some(file=>file.size<1))throw new Error("Arquivo vazio");
        resolve({fields,files});
      }catch(error){
        for(const file of files)try{if(file.path&&existsSync(file.path))unlinkSync(file.path);}catch{}
        reject(error);
      }
    });
    req.pipe(bus);
  });
}
function cleanupIncomingMedia(media){
  for(const file of media?.files||[])try{if(file.path&&existsSync(file.path))unlinkSync(file.path);}catch(error){console.error("Temporary upload cleanup",error);}
}
function validateTelegramUpload(file,kind){
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
  if(!Number.isInteger(file.size)||file.size<1||file.size>max)throw new Error(kind==="image"?"Fotos enviadas por multipart podem ter até 10 MB":"Arquivos enviados por multipart podem ter até 50 MB");
  return file;
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

function normalizeDraftRuntimeHTML(html){
  const doc=parseDocument(String(html||""));
  const walk=node=>{
    if(node.type!=="tag"){
      node.children?.slice().forEach(walk);
      return;
    }
    const classes=String(node.attribs?.class||"").split(/\s+/).filter(Boolean);
    const transientNode=classes.some(name=>["ProseMirror-trailingBreak","ProseMirror-separator","ProseMirror-gapcursor"].includes(name));
    if(transientNode){
      DomUtils.removeElement(node);
      return;
    }
    for(const key of ["contenteditable","draggable","spellcheck","tabindex","aria-selected"])delete node.attribs[key];
    for(const key of Object.keys(node.attribs||{}))if(key.startsWith("data-pm-"))delete node.attribs[key];
    if(classes.length){
      const kept=classes.filter(name=>!name.startsWith("ProseMirror-"));
      if(kept.length)node.attribs.class=kept.join(" ");
      else delete node.attribs.class;
    }
    node.children?.slice().forEach(walk);
  };
  doc.children.slice().forEach(walk);
  return DomUtils.getInnerHTML(doc,{encodeEntities:"utf8"});
}

function draftValid(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("Rascunho inválido");
  if(draft.version!==2)throw new Error("Versão do rascunho incompatível");
  const json = JSON.stringify(draft);
  if (Buffer.byteLength(json, "utf8") > 350_000) throw new Error("Rascunho grande demais");
  if (typeof draft.html !== "string" || Buffer.byteLength(draft.html, "utf8") > 160_000) throw new Error("Conteúdo do rascunho inválido");
  draft.html=normalizeDraftRuntimeHTML(draft.html);
  if (typeof draft.name !== "string" || draft.name.length > 120) throw new Error("Nome do rascunho inválido");
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

function persistentDraftPaths(owner,doc){
  const ownerDir=DRAFT_DIR+"/"+ownerFingerprint(owner);
  return {dir:ownerDir,active:ownerDir+"/active",meta:ownerDir+"/"+doc+".json",mediaDir:ownerDir+"/"+doc+".media",single:ownerDir+"/"+doc+".bin"};
}
function persistentMediaPath(paths,id){
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
    if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0||typeof snapshot.name!=="string"||snapshot.name.length>120||typeof snapshot.html!=="string"||Buffer.byteLength(snapshot.html,"utf8")>160_000)throw new Error("Snapshot da publicação Telegram inválido");
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
  const changed=normalizeStoredRecord(record,paths);
  persistentRecordValid(record,owner,target);
  for(const media of record.media){
    const path=persistentMediaPath(paths,media.id);
    if(!existsSync(path)||statSync(path).size!==media.size)throw new Error("Anexo persistido indisponível");
  }
  if(changed)atomicWrite(paths.meta,JSON.stringify(record));
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
function listPersistentDrafts(owner){
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
function listTelegramPublications(owner,drafts=[]){
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
function telegraphOwnerFromDraftOwner(owner){
  return owner.kind==="telegram"?owner.chatId:owner.key;
}
function listTelegraphPages(owner,drafts=[]){
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

function savePersistentDraft(owner,draft,files=[]){
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
    if(!action.result||action.result.via!=="sendRichMessage"||!Number.isInteger(action.result.messageId)||action.result.messageId<=0)throw new Error("Resultado da publicação transferida inválido");
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

async function sendRichToChat(chatId,html,file=null,replyTo=0){
  let body;
  try{
    richValid(html);
    chatId=String(chatId||"");
    if(!/^\d+$/.test(chatId))throw new Error("Chat Telegram inválido");
    const replying=Number.isInteger(replyTo)&&replyTo>0;
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
    const rich = { html: DomUtils.getInnerHTML(doc,{encodeEntities:"utf8"}) };
    if (media.length) rich.media = media;
    body = { chat_id: chatId, ...(replying?{reply_parameters:{message_id:replyTo}}:{}), rich_message: rich };
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
      if(replying)form.set("reply_parameters",JSON.stringify({message_id:replyTo}));
      form.set("rich_message", JSON.stringify(body.rich_message));
      form.set("upload", new Blob([file.bytes], {type:file.mime}), file.name);
      body = form;
    }
  }catch(error){
    throw asHttpError(error,400,"Dados inválidos para publicação");
  }
  const msg = await telegramCall("sendRichMessage", body);
  const returnedId=Number(msg?.message_id||0);
  if(!Number.isInteger(returnedId)||returnedId<=0)throw new DeliveryError("O Telegram não confirmou o identificador da mensagem","uncertain");
  return { via:"sendRichMessage", messageId:returnedId, ...(replyTo>0?{replyTo}:{}) };
}

async function sendRich(initData,html,file=null,replyTo=0){
  let chatId;
  try{({chatId}=userFromInitData(String(initData||"")));}
  catch(error){throw asHttpError(error,400,"Dados inválidos para publicação");}
  return sendRichToChat(chatId,html,file,replyTo);
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

async function publishTelegramPersistentForOwner(owner,draft,html,file=null){
  if(!owner||owner.kind!=="telegram"||!/^\d+$/.test(String(owner.telegramUserId||""))||!/^\d+$/.test(String(owner.chatId||"")))throw new HttpError(400,"Publicação Telegram exige identidade Telegram");
  let record=savePersistentDraft(owner,draft,file);
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
      result=await sendRichToChat(owner.chatId,html,file,pending.noticeMessageId);
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
    result=await sendRichToChat(owner.chatId,html,file);
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

async function publishTelegramPersistent(initData,draft,html,file=null){
  return publishTelegramPersistentForOwner(draftOwner({initData}),draft,html,file);
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

function telegraphContentHTML(content){
  telegraphValid(content);
  const voidTags=new Set(["br","hr","img"]);
  const render=node=>{
    if(typeof node==="string")return htmlEscape(node);
    const attrs=[];
    for(const [key,value] of Object.entries(node.attrs||{}))attrs.push(key+'="'+htmlEscape(value)+'"');
    const open="<"+node.tag+(attrs.length?" "+attrs.join(" "):"")+">";
    if(voidTags.has(node.tag))return open;
    return open+(node.children||[]).map(render).join("")+"</"+node.tag+">";
  };
  return content.map(render).join("");
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

function telegramPrivateOwner(userId,chatId){
  const uid=String(userId??"").trim();
  const cid=String(chatId??"").trim();
  if(!/^\d+$/.test(uid)||!/^\d+$/.test(cid))throw new Error("Identidade privada do Telegram inválida");
  return {key:"telegram:"+uid,kind:"telegram",telegramUserId:uid,chatId:cid};
}

function ownerFromBotMessage(message){
  const chatId=message?.chat?.id;
  return telegramPrivateOwner(message?.from?.id??chatId,chatId);
}

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

async function selectedExportDocument(owner,kind,doc){
  if(!["d","t","g"].includes(kind)||!/^[a-f0-9-]{36}$/i.test(doc))throw new Error("Seleção de exportação inválida");
  if(kind==="g"){
    const mapped=readPages()[telegraphOwnerFromDraftOwner(owner)+":"+doc]||"";
    if(mapped&&typeof mapped!=="string")throw new Error("A publicação Telegraph ainda precisa de confirmação");
    if(!mapped)throw new Error("Publicação Telegraph não encontrada");
    const page=await verifyTelegraphPage(mapped);
    if(!Array.isArray(page.content))throw new Error("O Telegraph não retornou o conteúdo da página");
    return {name:String(page.title||"Página Telegraph").slice(0,120),html:telegraphContentHTML(page.content)};
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

async function handleBotUpdate(update) {
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

async function configureBot(){
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


    if (url.pathname === "/api/export/source" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        if(owner.kind!=="telegram")throw new HttpError(400,"A exportação selecionada pelo bot exige identidade Telegram");
        const kind=String(body?.kind||"");
        const doc=String(body?.doc||"");
        const selected=await selectedExportDocument(owner,kind,doc);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({kind,doc,name:selected.name,html:selected.html}));
      }catch(err){
        const code=err instanceof HttpError?err.status:err instanceof DeliveryError?502:400;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível preparar a exportação"}));
      }
      return;
    }

    if (url.pathname === "/api/library/list" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const owner=draftOwner(body);
        const drafts=listPersistentDrafts(owner);
        const telegram=listTelegramPublications(owner,drafts);
        const telegraph=listTelegraphPages(owner,drafts);
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({drafts,telegram,telegraph}));
      }catch(err){
        const code=err instanceof HttpError?err.status:500;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível carregar a biblioteca"}));
      }
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

    if (url.pathname === "/api/telegraph/load" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try{
        const body=await readJson(req,20000);
        const doc=String(body?.doc||"");
        if(!/^[a-f0-9-]{36}$/i.test(doc))throw new HttpError(400,"Documento inválido");
        const ownerKey=telegraphOwner(body);
        const mapped=readPages()[ownerKey+":"+doc]||"";
        if(mapped&&typeof mapped!=="string")throw new HttpError(409,"Resultado anterior incerto no Telegraph; confira a página antes de editar");
        if(!mapped){
          res.writeHead(404,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
          res.end(JSON.stringify({error:"Página não encontrada"}));
          return;
        }
        const page=await verifyTelegraphPage(mapped);
        if(!Array.isArray(page.content))throw new Error("O Telegraph não retornou o conteúdo da página");
        const html=telegraphContentHTML(page.content);
        let revision=0,updatedAt=0;
        try{
          const owner=draftOwner(body);
          const record=readPersistentDraft(owner,doc);
          if(record){revision=record.draft.revision;updatedAt=record.updatedAt;}
        }catch(error){if(error instanceof HttpError)throw error;console.error("Telegraph draft metadata",error);}
        res.writeHead(200,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({doc,path:page.path,url:page.url,title:String(page.title||"Página Telegraph"),html,revision,updatedAt}));
      }catch(err){
        const code=err instanceof HttpError?err.status:502;
        res.writeHead(code,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
        res.end(JSON.stringify({error:err instanceof Error?err.message:"Não foi possível carregar a página"}));
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
