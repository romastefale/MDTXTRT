// Configuração lida do ambiente, diretórios do volume, erros HTTP/entrega e utilitários comuns.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Raiz do repositório (este arquivo fica em server/).
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
function required(name){
  const value=String(process.env[name]??"").trim();
  if(!value)throw new Error("Configuração ausente: "+name);
  return value;
}
export class HttpError extends Error{
  constructor(status,message){
    super(message);
    this.name="HttpError";
    this.status=status;
  }
}
export class DeliveryError extends Error{
  constructor(message,outcome="uncertain"){
    super(message);
    this.name="DeliveryError";
    this.outcome=outcome;
  }
}
export function asHttpError(error,status,fallback){
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
export const PORT=Number(required("PORT"));
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error("Configuração inválida: PORT");
export const DATA=required("RAILWAY_VOLUME_MOUNT_PATH").replace(/\/+$/,"");
if(!DATA.startsWith("/"))throw new Error("Configuração inválida: RAILWAY_VOLUME_MOUNT_PATH");
const MINI_APP=new URL(httpsUrl("MINI_APP_URL"));
const PUBLIC_BASE=new URL(httpsUrl("PUBLIC_BASE_URL"));
export const MINI_APP_URL=MINI_APP.href;
export const WEBHOOK_BASE=PUBLIC_BASE.href.replace(/\/+$/,"");
export const ALLOW_ORIGINS=new Set([MINI_APP.origin,PUBLIC_BASE.origin]);
export const TELEGRAPH_FILE = DATA + "/telegraph-token";
export const PAGES_FILE = TELEGRAPH_FILE + "-pages.json";
export const HANDOFF_DIR = DATA + "/handoffs";
export const DRAFT_DIR = DATA + "/drafts";
export const TMP_DIR = DATA + "/tmp";
export const HANDOFF_TTL = 15 * 60 * 1000;
export const BOT_IMPORT_DOWNLOAD_MAX = 20_000_000;
export const BOT_IMPORT_SOURCE_MAX = 240_000;
export const SERVER_BOOT_ID = randomUUID();
export const ACTIVE_HANDOFF_SENDS = new Set();
export const BOT_TOKEN=required("TOKEN");
if(!BOT_TOKEN_RE.test(BOT_TOKEN))throw new Error("Configuração inválida: TOKEN");
mkdirSync(HANDOFF_DIR, { recursive: true });
mkdirSync(DRAFT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

export function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
