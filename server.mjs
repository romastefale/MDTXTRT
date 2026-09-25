import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
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
let telegraphToken = (process.env.TELEGRAPH_ACCESS_TOKEN || "").trim();
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
  "favicon.svg",
  "logo.png",
  "og.jpg",
  "x-banner.jpg",
  "glass-map.png",
  "backgrounds/light.html",
  "backgrounds/dark.html",
  ...["bold","buttons","details","document","export","file","footer","h1","h2","h3","h4","h5","h6","heading","import","italic","link","list","more","open","paragraph","plus","quote","redo","send","table","task","telegram","underline","undo"].map(name=>`icons/${name}.svg`),
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

async function sendRich(initData, html) {
  const token = botToken();
  if (!token) throw new Error("O envio para o Telegram não está configurado");
  if (!html || !String(html).replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim()) throw new Error("Escreva algo antes de publicar");
  if (Buffer.byteLength(String(html), "utf8") > 32768) throw new Error("Mensagem rica acima de 32.768 caracteres");
  const { chatId, queryId } = userFromInitData(String(initData || ""), token);
  const rich_message = { html: String(html) };
  if (queryId) {
    await telegramCall(token, "answerWebAppQuery", {
      web_app_query_id: queryId,
      result: {
        type: "article",
        id: "rmdtxtml",
        title: "MDTXTRT",
        input_message_content: { rich_message },
      },
    });
    return { via: "answerWebAppQuery" };
  }
  const msg = await telegramCall(token, "sendRichMessage", { chat_id: chatId, rich_message });
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
  return "<tg-button-row align=\"center\"><tg-button type=\"web_app\" url=\"" + htmlEscape(MINI_APP_URL) + "\">Abrir MDTXTRT</tg-button></tg-button-row>";
}

function appMessage(title) {
  return "<h1>MDTXTRT</h1><p>" + title + "</p>" + appButton() + "<p><a href=\"" + htmlEscape(MINI_APP_URL) + "\">Abrir no navegador</a></p>";
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
    ["setChatMenuButton", { menu_button: { type: "web_app", text: "Abrir MDTXTRT", web_app: { url: MINI_APP_URL } } }],
    ["setWebhook", { url: WEBHOOK_BASE + "/telegram/webhook", secret_token: secret, allowed_updates: ["message"] }],
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

async function publishTelegraph(title, content) {
  const pageTitle = String(title || "").trim();
  if (!pageTitle) throw new Error("Dê um nome à página antes de publicar");
  if (pageTitle.length > 256) throw new Error("O nome da página deve ter até 256 caracteres");
  if (!Array.isArray(content) || !content.length) throw new Error("Escreva algo antes de publicar");
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > 65536) throw new Error("O conteúdo excede o limite do Telegraph");
  if (!telegraphToken) {
    const account = await telegraphCall("createAccount", { short_name: "MDTXTRT", author_name: "MDTXTRT" });
    telegraphToken = account.access_token;
  }
  return telegraphCall("createPage", {
    access_token: telegraphToken,
    title: pageTitle,
    author_name: "MDTXTRT",
    content: JSON.stringify(content),
    return_content: "false",
  });
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
    if (url.pathname === "/api/telegram/export" && req.method === "POST") {
      if (!setCors(req, res)) {
        res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Acesso não autorizado" }));
        return;
      }
      try {
        const body = await readJson(req, 2_000_000);
        if (!body || typeof body !== "object" || typeof body.initData !== "string" || typeof body.name !== "string" || typeof body.content !== "string") throw new Error("Os dados da exportação estão incompletos");
        const token = botToken();
        if (!token) throw new Error("O envio para o Telegram não está configurado");
        const { chatId } = userFromInitData(body.initData, token);
        const type = body.name.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain";
        const result = await sendDocument(chatId, body.name, body.content, type);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível exportar o arquivo";
        const code = /inválid[ao]s?|expirada|ausente|Abra pelo|solicitação|dados da exportação|texto para exportar|limite de exportação/i.test(msg) ? 400 : 500;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg }));
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
        const body = await readJson(req);
        if (!body || typeof body !== "object" || typeof body.initData !== "string" || typeof body.html !== "string") throw new Error("Os dados do envio estão incompletos");
        const result = await sendRich(body.initData, body.html);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível publicar no Telegram";
        const code = /inválid[ao]s?|expirada|ausente|Abra pelo|solicitação|dados do envio|Escreva algo/i.test(msg) ? 400 : 500;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg }));
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
        const body = await readJson(req);
        if (!body || typeof body !== "object" || typeof body.title !== "string" || !Array.isArray(body.content)) throw new Error("Os dados da página estão incompletos");
        const page = await publishTelegraph(body.title, body.content);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ url: page.url }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Não foi possível publicar no Telegraph";
        const code = /nome (?:da|à) página|escreva algo|excede o limite|solicitação|dados da página|não foi possível ler/i.test(msg) ? 400 : 502;
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
