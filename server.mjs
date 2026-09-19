import { createHmac } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
const APP_URL = "https://romastefale.github.io/MDTXTRT/";
const PUBLIC_HOST = "https://mdtxtrt.up.railway.app";
const ALLOW_ORIGINS = [
  "https://romastefale.github.io",
  "https://mdtxtrt.up.railway.app",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
};

const HELP_HTML = [
  "<h1>MDTXTRT</h1>",
  "<p>Você escreve <b>uma vez</b>. O mesmo texto vira mensagem no Telegram e página no Telegraph.</p>",
  "<table><thead><tr><th>Onde</th><th>Faz</th></tr></thead><tbody>",
  "<tr><td>Mini App</td><td>Edita o texto</td></tr>",
  "<tr><td>Laranja</td><td>Publica</td></tr>",
  "<tr><td>Telegram</td><td>Mensagem rica 10.3</td></tr>",
  "<tr><td>Telegraph</td><td>Página pública</td></tr>",
  "<tr><td>Arquivo</td><td>TXT e Markdown</td></tr>",
  "</tbody></table>",
  "<blockquote expandable><p>Verde abre o editor. Vermelho fecha este aviso.</p></blockquote>",
  "<footer>Bot API 10.3 · um rascunho, dois destinos</footer>",
].join("");

function botToken() {
  const token = (process.env.TOKEN || "").trim();
  if (!token || !BOT_TOKEN_RE.test(token)) return "";
  return token;
}

function corsOrigin(req) {
  const origin = req.headers.origin || "";
  if (!origin) return "";
  if (ALLOW_ORIGINS.includes(origin)) return origin;
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith(".grok.me") || host.endsWith(".railway.app") || host.endsWith(".github.io")) {
      return origin;
    }
  } catch {
    return "";
  }
  return "";
}

function setCors(req, res) {
  const allow = corsOrigin(req);
  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
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
  if (check !== hash) throw new Error("Sessão Telegram inválida");
  const authDate = Number(params.get("auth_date") || "0");
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 172800) {
    throw new Error("Sessão Telegram expirada");
  }
  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Usuário Telegram ausente");
  const user = JSON.parse(userRaw);
  if (!user?.id) throw new Error("Usuário Telegram ausente");
  return { chatId: String(user.id), queryId: params.get("query_id") || "" };
}

async function telegramCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || `Telegram ${method} falhou`);
  return json.result;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 80_000) throw new Error("Payload grande demais");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function editorMarkup() {
  return {
    inline_keyboard: [
      [{ text: "Abrir editor", style: "success", web_app: { url: APP_URL } }],
      [
        { text: "Ajuda", style: "primary", callback_data: "ajuda" },
        { text: "Fechar", style: "danger", callback_data: "fechar" },
      ],
    ],
  };
}

async function sendGuide(token, chatId) {
  const rich_message = { html: HELP_HTML, skip_entity_detection: true };
  try {
    return await telegramCall(token, "sendRichMessage", {
      chat_id: chatId,
      rich_message,
      reply_markup: editorMarkup(),
    });
  } catch {
    return telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: "MDTXTRT\nVocê escreve uma vez. O mesmo texto vira mensagem no Telegram e página no Telegraph.\n\nVerde abre o editor. Laranja publica.",
      reply_markup: editorMarkup(),
    });
  }
}

async function sendRich(initData, html) {
  const token = botToken();
  if (!token) throw new Error("TOKEN do bot não configurado no Railway");
  if (!html || !String(html).trim()) throw new Error("Conteúdo vazio");
  if (String(html).length > 32768) throw new Error("Mensagem rica acima de 32.768 caracteres");
  const { chatId, queryId } = userFromInitData(String(initData || ""), token);
  const rich_message = { html, skip_entity_detection: true };
  if (queryId) {
    try {
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
    } catch {
      await telegramCall(token, "answerWebAppQuery", {
        web_app_query_id: queryId,
        result: {
          type: "article",
          id: "rmdtxtml",
          title: "MDTXTRT",
          input_message_content: { message_text: String(html).slice(0, 4096), parse_mode: "HTML" },
        },
      });
      return { via: "answerWebAppQuery" };
    }
  }
  try {
    const msg = await telegramCall(token, "sendRichMessage", { chat_id: chatId, rich_message });
    return { via: "sendRichMessage", messageId: msg.message_id };
  } catch (err) {
    const hint = err instanceof Error ? err.message : "";
    if (!/not found|unknown method/i.test(hint)) throw err;
    const msg = await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: String(html).slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    return { via: "sendMessage", messageId: msg.message_id };
  }
}

async function handleUpdate(token, update) {
  const cb = update.callback_query;
  if (cb?.id) {
    const data = String(cb.data || "");
    const chatId = cb.message?.chat?.id;
    if (data === "fechar") {
      await telegramCall(token, "answerCallbackQuery", { callback_query_id: cb.id });
      if (chatId && cb.message?.message_id) {
        try {
          await telegramCall(token, "deleteMessage", { chat_id: chatId, message_id: cb.message.message_id });
        } catch {}
      }
      return;
    }
    await telegramCall(token, "answerCallbackQuery", { callback_query_id: cb.id });
    if (chatId) await sendGuide(token, chatId);
    return;
  }
  const msg = update.message;
  if (!msg?.chat?.id) return;
  const text = String(msg.text || "").trim();
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (cmd === "/start" || cmd === "/editor" || cmd === "/ajuda" || cmd === "/help") {
    await sendGuide(token, msg.chat.id);
  }
}

async function syncBot(token) {
  const host = (process.env.PUBLIC_URL || PUBLIC_HOST).replace(/\/$/, "");
  try {
    await telegramCall(token, "setMyCommands", {
      commands: [
        { command: "start", description: "Abrir o editor" },
        { command: "editor", description: "Mini App" },
        { command: "ajuda", description: "Como funciona" },
      ],
    });
  } catch (err) {
    console.error("setMyCommands", err instanceof Error ? err.message : err);
  }
  try {
    await telegramCall(token, "setChatMenuButton", {
      menu_button: { type: "web_app", text: "Editor", web_app: { url: APP_URL } },
    });
  } catch (err) {
    console.error("setChatMenuButton", err instanceof Error ? err.message : err);
  }
  try {
    await telegramCall(token, "setWebhook", {
      url: `${host}/api/telegram/webhook`,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
  } catch (err) {
    console.error("setWebhook", err instanceof Error ? err.message : err);
  }
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  let rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (rel.endsWith("/")) rel += "index.html";
  const abs = resolve(ROOT, rel);
  const inside = relative(ROOT, abs);
  if (!inside || inside.startsWith("..") || inside.includes("\0")) return null;
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "OPTIONS") {
      setCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }
    if ((url.pathname === "/api/health" || url.pathname === "/api/ready" || url.pathname === "/ready" || url.pathname === "/health") && req.method === "GET") {
      setCors(req, res);
      if (url.pathname === "/api/ready" || url.pathname === "/ready") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      const token = botToken();
      const payload = { ok: true, bot: Boolean(token) };
      if (token) {
        try {
          const info = await telegramCall(token, "getWebhookInfo", {});
          payload.webhook = info.url || "";
        } catch {
          payload.webhook = "";
        }
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
      return;
    }
    if (url.pathname === "/api/telegram/webhook" && req.method === "POST") {
      try {
        const token = botToken();
        const body = await readJson(req);
        if (token) await handleUpdate(token, body);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      }
      return;
    }
    if (url.pathname === "/api/telegram/send" && req.method === "POST") {
      setCors(req, res);
      try {
        const body = await readJson(req);
        const result = await sendRich(body.initData, body.html);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Falha no Telegram";
        const code = /não configurado|inválida|expirada|ausente|Abra pelo/i.test(msg) ? 400 : 500;
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: msg }));
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const file = safeFile(url.pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    const ext = extname(file).toLowerCase();
    const live = ext === ".html" || ext === ".json";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": live ? "no-cache" : "public, max-age=600",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(500);
    res.end("error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MDTXTRT on ${PORT}`);
  const token = botToken();
  if (token) syncBot(token).catch((err) => console.error(err));
});
