// Arquivos públicos (lista fechada), tipos MIME e entrega estática.
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { ROOT } from "./config.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
const PUBLIC = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "ui.js",
  "editor-core.js",
  "marked.js",
  "turndown.js",
  "favicon.svg",
  "logo.svg",
  "pwa-192.svg",
  "pwa-512.svg",
  "manifest.webmanifest",
  "og.jpg",
  "x-banner.jpg",
  "produto/fundo-claro.svg",
  "produto/fundo-escuro.svg",
  ...["arrow_back","bold","buttons","chevron_right","dark_mode","details","export","file","footer","h1","h2","h3","h4","h5","h6","heading","italic","light_mode","link","list","menu","paragraph","plus","quote","redo","table","task","telegram","telegraph","underline","undo"].map(name=>`icons/${name}.svg`),
  ...["anchor","attach_file","calculate","code","expandquote","format_list_numbered","functions","horizontal_rule","image","ink_highlighter","location_on","markdown","mood","movie","music_note","pullquote","schedule","search","slideshow","sticky_note_2","strikethrough_s","subscript","superscript","text_fields","view_comfy","visibility_off","web"].map(name=>`icons/${name}.svg`),
]);

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

export function serveStatic(req, res, url) {
  const file = safeFile(url.pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Página não encontrada");
    return;
  }
  const ext = extname(file).toLowerCase();
  const type = MIME[ext];
  if (!type) throw new Error("Tipo de arquivo não configurado");
  const live = ext === ".html" || ext === ".js" || ext === ".css";
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
}
