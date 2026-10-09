
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from "node:fs";
import { DATA, DeliveryError, HttpError, PAGES_FILE, TELEGRAPH_FILE, asHttpError, htmlEscape } from "./config.mjs";

let telegraphToken="";
let telegraphQueue = Promise.resolve();
if(existsSync(TELEGRAPH_FILE)){
  telegraphToken=readFileSync(TELEGRAPH_FILE,"utf8").trim();
  if(!telegraphToken)throw new Error("Credencial Telegraph persistida está vazia");
}

function telegraphValid(content) {
  const tags=new Set("a aside b blockquote br code em figcaption figure h3 h4 hr i iframe img li ol p pre s strong u ul video".split(" "));
  const walk=node=>{
    if(typeof node==="string")return;
    if(!node||typeof node!=="object"||Array.isArray(node)||!tags.has(node.tag))throw new Error("Elemento do Telegraph inválido");
    if(node.attrs)for(const [key,value] of Object.entries(node.attrs)){
      if(!(key==="href"&&node.tag==="a"||key==="src"&&["img","video","iframe"].includes(node.tag))||typeof value!=="string")throw new Error("Atributo do Telegraph inválido");
      let url;try{url=new URL(value);}catch{throw new Error("Link do Telegraph inválido");}
      if(!["http:","https:"].includes(url.protocol))throw new Error("Link do Telegraph inválido");
    }
    if(node.children!==undefined){
      if(!Array.isArray(node.children))throw new Error("Conteúdo do Telegraph inválido");
      node.children.forEach(walk);
    }
  };
  if(!Array.isArray(content)||!content.length||Buffer.byteLength(JSON.stringify(content))>65536)throw new Error("Conteúdo do Telegraph inválido");
  content.forEach(walk);
}






const TELEGRAPH_ORIGIN="https://telegra.ph/";
const TELEGRAPH_TAGS=new Set("a aside b blockquote br code em figcaption figure h3 h4 hr i iframe img li ol p pre s strong u ul video".split(" "));
function telegraphReadURL(value){
  if(typeof value!=="string"||!value.trim()||value.trim().startsWith("#"))return "";
  let url;try{url=new URL(value.trim(),TELEGRAPH_ORIGIN);}catch{return "";}
  return ["http:","https:"].includes(url.protocol)?url.href:"";
}
export function telegraphContentHTML(content){
  if(!Array.isArray(content)||!content.length)throw new Error("Conteúdo do Telegraph inválido");
  const voidTags=new Set(["br","hr","img"]);
  const render=node=>{
    if(typeof node==="string")return htmlEscape(node);
    if(!node||typeof node!=="object"||Array.isArray(node)||!TELEGRAPH_TAGS.has(node.tag))throw new Error("Elemento do Telegraph inválido");
    if(node.children!==undefined&&!Array.isArray(node.children))throw new Error("Conteúdo do Telegraph inválido");
    const inner=()=>(node.children||[]).map(render).join("");
    const key=node.tag==="a"?"href":["img","video","iframe"].includes(node.tag)?"src":"";
    const value=key?telegraphReadURL(node.attrs?.[key]):"";
    if(node.tag==="a"&&!value)return inner();
    if(key==="src"&&!value)return "";
    const open="<"+node.tag+(value?" "+key+'="'+htmlEscape(value)+'"':"")+">";
    if(voidTags.has(node.tag))return open;
    return open+inner()+"</"+node.tag+">";
  };
  return content.map(render).join("");
}

export async function telegraphCall(method, body) {
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

export function readPages() {
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

export async function ensureTelegraphToken() {
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

export async function verifyTelegraphPage(path) {
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







export const TELEGRAPH_REMOVAL_MODES = new Set(["list"]);

function removeTelegraphPageOne(owner, doc, mode) {
  if (!TELEGRAPH_REMOVAL_MODES.has(mode)) throw new HttpError(400,"Modo de remoção do Telegraph inválido");
  if (!/^[a-f0-9-]{36}$/i.test(String(doc||""))) throw new HttpError(400,"Documento inválido");
  const pages = readPages();
  const key = owner + ":" + doc;
  const known = pages[key];
  if (!known) throw new HttpError(404,"Publicação Telegraph não encontrada");
  if (typeof known !== "string") {
    if (known.status === "pending") throw new HttpError(409,"A publicação no Telegraph ainda espera confirmação; confira a página antes de tirá-la da lista");
    throw new Error("Mapeamento de páginas do Telegraph inválido");
  }
  delete pages[key];
  writePages(pages);
  return { path: known, mode };
}


export function removeTelegraphPage(owner, doc, mode = "list") {
  const next = telegraphQueue.then(() => removeTelegraphPageOne(owner, doc, mode));
  telegraphQueue=next.catch(error=>{console.error("Telegraph queue",error);});
  return next;
}

export function publishTelegraph(...args) {
  const next = telegraphQueue.then(() => publishTelegraphOne(...args));
  telegraphQueue=next.catch(error=>{console.error("Telegraph queue",error);});
  return next;
}
