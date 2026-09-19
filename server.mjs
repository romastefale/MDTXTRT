import { createHmac } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
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
    body: JSON.stringify(body),
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
    if (url.pathname === "/api/health" && req.method === "GET") {
      setCors(req, res);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, bot: Boolean(botToken()) }));
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
    res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=600" });
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
});
