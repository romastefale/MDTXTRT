
import { randomBytes } from "node:crypto";
import { HttpError, WEBHOOK_BASE } from "./config.mjs";

export const DOWNLOAD_TTL = 5 * 60 * 1000;
export const DOWNLOAD_MAX_BYTES = 1_000_000;
const DOWNLOAD_MAX_ENTRIES = 200;
const FORMATS = { md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8" };
const downloads = new Map();

function sweep(now = Date.now()) {
  for (const [token, item] of downloads) if (item.expires <= now) downloads.delete(token);
  while (downloads.size >= DOWNLOAD_MAX_ENTRIES) downloads.delete(downloads.keys().next().value);
}

export function downloadName(value, format) {
  const base = String(value || "").replace(/\.(md|txt)$/i, "").replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, "-").replace(/^\.+|\.+$/g, "").trim().slice(0, 80);
  if (!base) throw new HttpError(400, "Nome do arquivo inválido");
  return base + "." + format;
}

export function prepareDownload(chatId, body) {
  const format = String(body?.format || "");
  if (!Object.hasOwn(FORMATS, format)) throw new HttpError(400, "Formato de download inválido");
  if (typeof body?.content !== "string") throw new HttpError(400, "Conteúdo do download inválido");
  const data = Buffer.from(body.content, "utf8");
  if (data.length > DOWNLOAD_MAX_BYTES) throw new HttpError(413, "O arquivo é grande demais para baixar pelo Telegram");
  const name = downloadName(body?.name, format);
  sweep();
  const token = randomBytes(16).toString("hex");
  downloads.set(token, { chatId, name, mime: FORMATS[format], data, expires: Date.now() + DOWNLOAD_TTL });
  return { url: WEBHOOK_BASE + "/api/export/download/" + token, file_name: name, expires_in: DOWNLOAD_TTL / 1000 };
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function serveDownload(req, res, token) {
  const item = /^[a-f0-9]{32}$/.test(token) ? downloads.get(token) : null;
  if (!item || item.expires <= Date.now()) {
    if (item) downloads.delete(token);
    res.writeHead(410, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("O download expirou ou é inválido.");
    return;
  }
  res.writeHead(200, {
    "content-type": item.mime,
    "content-length": item.data.length,
    "content-disposition": contentDisposition(item.name),
    "access-control-allow-origin": "https://web.telegram.org",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  res.end(req.method === "HEAD" ? undefined : item.data);
}
