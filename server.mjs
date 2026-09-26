import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { DomUtils, parseDocument } from "htmlparser2";
import Busboy from "busboy";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
const ALLOW_ORIGINS = new Set([
  "https://romastefale.github.io",
  "https://mdtxtrt.up.railway.app",
]);
const TELEGRAPH_FILE = ((process.env.RAILWAY_VOLUME_MOUNT_PATH || "/data").replace(/\/+$/, "") || "/data") + "/telegraph-token";
const PAGES_FILE = TELEGRAPH_FILE + "-pages.json";
let telegraphToken = (process.env.TELEGRAPH_ACCESS_TOKEN || "").trim();
let telegraphQueue = Promise.resolve();
if (!telegraphToken && existsSync(TELEGRAPH_FILE)) {
  try { telegraphToken = readFileSync(TELEGRAPH_FILE, "utf8").trim(); } catch {}
}
const MINI_APP_URL = (process.env.MINI_APP_URL || "https://romastefale.github.io/MDTXTRT/").trim();
const WEBHOOK_BASE = (process.env.PUBLIC_BASE_URL || "https://" + (process.env.RAILWAY_PUBLIC_DOMAIN || "mdtxtrt.up.railway.app")).replace(/\/+$/, "");
const BOT_COMMANDS = [
  { command: "start", description: "Abrir o MDTXTRT" },
  { command: "app", description: "Abrir o Mini App" },
  { command: "novo", description: "Criar um documento" },
  { command: "ajuda", description: "Ver os comandos" },
  { command: "enviar", description: "Enviar texto rico" },
  { command: "exportar", description: "Exportar texto como arquivo" },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const PUBLIC = new Set([
  "index.html",
  "app.js",
  "marked.js",
  "turndown.js",
  "favicon.svg",
  "logo.png",
  "og.jpg",
  "x-banner.jpg",
  "glass-map.png",
  "backgrounds/light.html",
  "backgrounds/dark.html",
  ...["bold","buttons","details","document","export","file","footer","h1","h2","h3","h4","h5","h6","heading","import","italic","link","list","more","open","paragraph","plus","quote","redo","send","table","task","telegram","underline","undo"].map(name=>`icons/${name}.svg`),
  ...["anchor","attach_file","calculate","code","format_list_numbered","functions","horizontal_rule","image","ink_highlighter","location_on","markdown","mood","movie","music_note","schedule","search","slideshow","sticky_note_2","strikethrough_s","subscript","superscript","text_fields","view_comfy","visibility_off","web"].map(name=>`icons/${name}.svg`),
]);

function botToken() {
  const token = (process.env.TOKEN || "").trim();
  if (!token || !BOT_TOKEN_RE.test(token)) return "";
  return token;
}

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

function userFromInitData(initData, token) {
  if (!initData.trim()) throw new Error("Abra pelo bot no Telegram");
  const params = new URLSearchParams(initData);
  if (initData.length > 8192 || [...params.keys()].length !== new Set(params.keys()).size) throw new Error("Sessão Telegram inválida");
  const hash = params.get("hash") || "";
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
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
  return { chatId: String(user.id), queryId: params.get("query_id") || "" };
}

async function telegramCall(token, method, body) {
  let res;
  try {
    const options = { method: "POST", signal: AbortSignal.timeout(15000) };
    if (body instanceof FormData) options.body = body;
    else {
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(body);
    }
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, options);
  } catch (error) {
    console.error("Telegram", method, error);
    throw new Error("Não foi possível conectar ao Telegram");
  }
  let json;
  try { json = await res.json(); } catch { throw new Error("O Telegram retornou uma resposta inválida"); }
  if (!json.ok) {
    console.error("Telegram", method, json.description || "Falha no envio");
    throw new Error("O Telegram não aceitou a publicação");
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
    const bus = Busboy({headers:req.headers,limits:{files:1,fileSize:20_000_000,fields:4,fieldSize:40000}});
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

async function sendRich(initData, html, file = null) {
  const token = botToken();
  if (!token) throw new Error("O envio para o Telegram não está configurado");
  richValid(html);
  const { chatId } = userFromInitData(String(initData || ""), token);
  const doc = parseDocument(String(html));
  const media = [];
  let attached = false;
  const kinds = { img:"photo",video:"video",audio:"audio","tg-document":"document" };
  const visit = node => {
    if (node.type === "tag" && kinds[node.name]) {
      const kind = kinds[node.name], src = node.attribs.src;
      let id, source;
      if (/^https?:\/\//i.test(src)) {
        id = randomUUID().replace(/-/g, "");
        source = src;
      } else if (src.startsWith("tg://")) {
        const url = new URL(src);
        id = url.searchParams.get("id") || "";
        if (file && id === file.id && url.hostname === kind && file.kind === ({photo:"image",video:"video",audio:"audio",document:"document"})[kind]) {
          source = "attach://upload";
          attached = true;
        } else {
          throw new Error("Anexe a mídia novamente antes de publicar");
        }
      } else {
        throw new Error("Endereço de mídia inválido");
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("Identificador de mídia inválido");
      node.attribs.src = `tg://${kind}?id=${id}`;
      media.push({id,media:{type:kind,media:source}});
    }
    node.children?.forEach(visit);
  };
  doc.children.forEach(visit);
  if (file && !attached) throw new Error("A mídia anexada não está no documento");
  const rich = { html: DomUtils.getInnerHTML(doc) };
  if (media.length) rich.media = media;
  let body = { chat_id: chatId, rich_message: rich };
  if (file) {
    const kind = {image:"photo",video:"video",audio:"audio",document:"document"}[file.kind];
    if (!kind || !/^[A-Za-z0-9_-]{1,64}$/.test(file.id) || !["image/", "video/", "audio/", "application/", "text/"].some(prefix=>file.mime.startsWith(prefix))) throw new Error("Mídia inválida");
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("rich_message", JSON.stringify(body.rich_message));
    form.set("upload", new Blob([file.bytes], {type:file.mime}), file.name);
    body = form;
  }
  const msg = await telegramCall(token, "sendRichMessage", body);
  return { via: "sendRichMessage", messageId: msg.message_id };
}


function webhookSecret(token) {
  const value = (process.env.TELEGRAM_WEBHOOK_SECRET || createHmac("sha256", token).update("MDTXTRT_WEBHOOK").digest("hex")).trim();
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error("A chave do webhook do Telegram é inválida");
  return value;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function richValid(html) {
  const tags = new Set("a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption tg-map tg-collage tg-slideshow table caption tr th td details summary tg-math-block tg-button tg-button-row br".split(" "));
  const attrs = new Set("href name class src alt tg-spoiler start type reversed value checked expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open style url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats".split(" "));
  const media = new Set(["img", "video", "audio", "tg-document"]);
  const walk = node => {
    if (node.type === "text") return;
    if (node.type !== "tag") throw new Error("O conteúdo contém marcação não aceita");
    if (!tags.has(node.name)) throw new Error("O conteúdo contém elemento inválido: " + node.name);
    for (const [key, value] of Object.entries(node.attribs)) {
      if (!attrs.has(key) || key === "class" && !(node.name === "code" && /^language-[a-z0-9+-]+$/i.test(value))) throw new Error("O conteúdo contém atributo inválido: " + key);
      if (["href", "src", "url"].includes(key)) {
        if (value.startsWith("#") && key === "href") continue;
        let url;
        try { url = new URL(value); } catch { throw new Error("Link inválido"); }
        if (media.has(node.name) && key === "src" ? !["https:", "http:"].includes(url.protocol) && !(url.protocol === "tg:" && /^(photo|video|audio|document)$/.test(url.hostname)) : !["https:", "http:", "tg:", "mailto:", "tel:"].includes(url.protocol)) throw new Error("Link inválido");
      }
    }
    if (media.has(node.name) && !node.attribs.src) throw new Error("Mídia sem endereço");
    node.children.forEach(walk);
  };
  if (typeof html !== "string" || !html.trim() || Buffer.byteLength(html) > 32768) throw new Error("Conteúdo vazio ou grande demais");
  parseDocument(html).children.forEach(walk);
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

function safeLink(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "tg:", "mailto:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
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
  const text = String(reply.text || reply.caption || "").trim();
  return { text, entities: reply.entities || reply.caption_entities || [] };
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

async function sendBotRich(chatId, html, replyTo) {
  const token = botToken();
  if (!token) throw new Error("O envio para o Telegram não está configurado");
  const body = { chat_id: chatId, rich_message: { html } };
  if (replyTo) body.reply_parameters = { message_id: replyTo };
  return telegramCall(token, "sendRichMessage", body);
}

function appButton() {
  return "<tg-button-row align=\"center\"><tg-button type=\"web_app\" style=\"success\" url=\"" + htmlEscape(MINI_APP_URL) + "\">Mini App MDTXTRT</tg-button></tg-button-row>" +
    "<tg-button-row align=\"center\"><tg-button type=\"url\" style=\"danger\" url=\"" + htmlEscape(WEBHOOK_BASE + "/") + "\">Abrir MDTXTRT no browser</tg-button></tg-button-row>";
}

function appMessage(title) {
  return "<h1>MDTXTRT</h1><p>" + title + "</p>" + appButton();
}

async function sendDocument(chatId, name, content, type) {
  const token = botToken();
  if (!token) throw new Error("O envio para o Telegram não está configurado");
  const data = String(content || "");
  if (!data.trim()) throw new Error("Não há texto para exportar");
  if (Buffer.byteLength(data, "utf8") > 1_500_000) throw new Error("O arquivo excede o limite de exportação");
  const fileName = String(name || "texto.txt").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 120) || "texto.txt";
  const mime = type === "text/markdown" ? "text/markdown" : "text/plain";
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", "Exportado pelo MDTXTRT");
  form.set("document", new Blob([data], { type: mime }), fileName);
  const sent = await telegramCall(token, "sendDocument", form);
  return { messageId: sent.message_id, fileName };
}

async function handleBotUpdate(update) {
  if (update.callback_query) {
    const q = update.callback_query;
    const token = botToken();
    if (!token) return;
    await telegramCall(token, "answerCallbackQuery", {
      callback_query_id: q.id,
      text: q.data ? String(q.data).slice(0, 200) : "OK"
    });
    return;
  }
  const message = update.message;
  if (!message?.text || !message.chat) return;
  const match = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+[\s\S]*)?$/i.exec(message.text);
  if (!match) return;
  const command = match[1].toLowerCase();
  const chatId = message.chat.id;
  if (message.chat.type !== "private") {
    await sendBotRich(chatId, "<p>Abra o chat privado do MDTXTRT para usar o Mini App e exportar arquivos.</p>");
    return;
  }
  const body = commandBody(message);
  if (command === "start" || command === "app" || command === "novo") {
    await sendBotRich(chatId, appMessage("Edite, publique e exporte seus textos do Telegram."), message.message_id);
    return;
  }
  if (command === "ajuda" || command === "help") {
    const html = "<h1>Comandos</h1><p><b>/app</b> abre o Mini App.</p><p><b>/novo</b> começa um documento.</p><p><b>/enviar texto</b> envia o texto como mensagem rica. Também pode responder a uma mensagem com <b>/enviar</b>.</p><p><b>/exportar [txt|md]</b> exporta o texto da mensagem respondida como arquivo.</p>" + appButton();
    await sendBotRich(chatId, html, message.message_id);
    return;
  }
  if (command === "enviar") {
    const content = body.text ? body : repliedBody(message);
    if (!content.text) {
      await sendBotRich(chatId, "<p>Use <b>/enviar texto</b> ou responda a uma mensagem com <b>/enviar</b>.</p>" + appButton(), message.message_id);
      return;
    }
    await sendBotRich(chatId, richHTML(content.text, content.entities), message.message_id);
    return;
  }
  if (command === "exportar" || command === "export") {
    let content = body;
    let type = "txt";
    const choice = /^(txt|md|markdown)(?:\s+|$)/i.exec(body.text);
    if (choice) {
      type = choice[1].toLowerCase() === "txt" ? "txt" : "md";
      content = cutBody(body, choice[0].length);
    }
    if (!content.text) content = repliedBody(message);
    if (!content.text) {
      await sendBotRich(chatId, "<p>Responda a uma mensagem com <b>/exportar</b> ou envie <b>/exportar txt texto</b> ou <b>/exportar md texto</b>.</p>" + appButton(), message.message_id);
      return;
    }
    const output = type === "md" ? formatText(content.text, content.entities, "md") : content.text;
    await sendDocument(chatId, "mdtxtrt." + type, output, type === "md" ? "text/markdown" : "text/plain");
  }
}

async function configureBot() {
  const token = botToken();
  if (!token) {
    console.error("Telegram bot não configurado");
    return;
  }
  let secret;
  try { secret = webhookSecret(token); } catch (error) { console.error("Telegram webhook", error); return; }
  const steps = [
    ["setMyCommands", { commands: BOT_COMMANDS }],
    ["setChatMenuButton", { menu_button: { type: "web_app", text: "Mini App MDTXTRT", web_app: { url: MINI_APP_URL } } }],
    ["setWebhook", { url: WEBHOOK_BASE + "/telegram/webhook", secret_token: secret, allowed_updates: ["message", "callback_query"] }],
  ];
  for (const [method, body] of steps) {
    try { await telegramCall(token, method, body); }
    catch (error) { console.error("Telegram", method, error); }
  }
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
    throw new Error("Não foi possível conectar ao Telegraph");
  }
  let json;
  try { json = await res.json(); } catch { throw new Error("O Telegraph retornou uma resposta inválida"); }
  if (!res.ok || !json.ok) {
    console.error("Telegraph", method, json.error || "Falha na publicação");
    throw new Error("O Telegraph não aceitou a publicação");
  }
  return json.result;
}

async function publishTelegraphOne(title, content, path = "", user = "", doc = "") {
  const pageTitle = String(title || "").trim();
  if (!pageTitle) throw new Error("Dê um nome à página antes de publicar");
  if (pageTitle.length > 256) throw new Error("O nome da página deve ter até 256 caracteres");
  telegraphValid(content);
  if (!/^[a-f0-9-]{36}$/i.test(doc)) throw new Error("Documento inválido");
  let pages = {};
  if (existsSync(PAGES_FILE)) pages = JSON.parse(readFileSync(PAGES_FILE, "utf8"));
  const key = user + ":" + doc;
  if (path && pages[key] !== path) throw new Error("Esta página não pertence a este documento");
  if (!path && pages[key]) throw new Error("Este documento já possui uma página");
  if (!telegraphToken) {
    const account = await telegraphCall("createAccount", { short_name: "MDTXTRT", author_name: "MDTXTRT" });
    telegraphToken = account.access_token;
    mkdirSync(TELEGRAPH_FILE.slice(0, TELEGRAPH_FILE.lastIndexOf("/")), { recursive: true });
    writeFileSync(TELEGRAPH_FILE, telegraphToken, { mode: 0o600 });
  }
  const body = {
    access_token: telegraphToken,
    title: pageTitle,
    author_name: "MDTXTRT",
    content: JSON.stringify(content),
    return_content: "false",
  };
  if (String(path || "").trim()) {
    body.path = String(path).trim();
    return telegraphCall("editPage", body);
  }
  const page = await telegraphCall("createPage", body);
  pages[key] = page.path;
  writeFileSync(PAGES_FILE + ".tmp", JSON.stringify(pages), { mode: 0o600 });
  renameSync(PAGES_FILE + ".tmp", PAGES_FILE);
  return page;
}

function publishTelegraph(...args) {
  const next = telegraphQueue.then(() => publishTelegraphOne(...args));
  telegraphQueue = next.catch(() => {});
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
    if (url.pathname === "/telegram/webhook" && req.method === "POST") {
      const token = botToken();
      if (!token) {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Bot do Telegram não configurado" }));
        return;
      }
      if (!sameSecret(req.headers["x-telegram-bot-api-secret-token"], webhookSecret(token))) {
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
        const media = /^multipart\/form-data/i.test(req.headers["content-type"] || "") ? await readMedia(req) : null;
        const body = media?.fields || await readJson(req);
        if (!body || typeof body !== "object" || typeof body.initData !== "string" || typeof body.html !== "string") throw new Error("Os dados do envio estão incompletos");
        const result = await sendRich(body.initData, body.html, media?.file ? {...media.file,kind:body.kind,id:body.id} : null);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível publicar no Telegram";
        const code = /inválid[ao]s?|expirada|ausente|Abra pelo|solicitação|dados do envio|Escreva algo|Anexe a mídia|identificador de mídia|endereço de mídia|mídia anexada/i.test(msg) ? 400 : 500;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg }));
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
        const body = await readJson(req, 10000);
        const token = botToken();
        if (!token) throw new Error("O Telegram não está configurado");
        userFromInitData(String(body?.initData || ""), token);
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
        const body = await readJson(req, 150_000);
        if (!body || typeof body !== "object" || typeof body.title !== "string" || !Array.isArray(body.content) || (body.path !== undefined && typeof body.path !== "string")) throw new Error("Os dados da página estão incompletos");
        const token = botToken();
        if (!token || typeof body.initData !== "string") throw new Error("Abra pelo bot no Telegram para publicar no Telegraph");
        const { chatId } = userFromInitData(body.initData, token);
        const page = await publishTelegraph(body.title, body.content, body.path || "", chatId, body.doc);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ url: page.url, path: page.path }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível publicar no Telegraph";
        const code = /nome (?:da|à) página|escreva algo|excede o limite|solicitação|dados da página|não foi possível ler|Documento inválido|pertence|já possui|Abra pelo|inválida|expirada|Telegraph inválido/i.test(msg) ? 400 : 502;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg }));
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MDTXTRT on ${PORT}`);
  void configureBot();
});
