// Monta docs/ com a versão estática (GitHub Pages): sem Telegram e sem servidor.
// Uso: npm run build:static   (ou: node scripts/build-static.mjs [pasta-com-ui.js-e-editor-core.js])
// Pré-requisito: ui.js e editor-core.js já gerados (npm run build:editor && npm run build:ui).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLES = process.argv[2] || ".";
const OUT = "docs";
const FILES = ["styles.css", "marked.js", "turndown.js", "favicon.svg", "logo.svg", "og.jpg", "x-banner.jpg", "manifest.webmanifest", "pwa-192.svg", "pwa-512.svg"];
const DIRS = ["icons", "produto"];
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const name of FILES) {
  if (!existsSync(name)) throw new Error("Arquivo ausente: " + name);
  cpSync(name, join(OUT, name));
}
for (const name of ["ui.js", "editor-core.js"]) {
  const from = join(BUNDLES, name);
  if (!existsSync(from)) throw new Error("Rode o build antes: falta " + from);
  cpSync(from, join(OUT, name));
}
for (const name of DIRS) cpSync(name, join(OUT, name), { recursive: true });

let html = readFileSync("index.html", "utf8");
const TELEGRAM_SCRIPT = '<script src="https://telegram.org/js/telegram-web-app.js?63"></script>';
if (!html.includes(TELEGRAM_SCRIPT)) throw new Error("Script do Telegram não encontrado no index.html");
// A versão estática nunca carrega o script do Telegram e liga o modo local antes de qualquer outro script.
html = html.replace(TELEGRAM_SCRIPT, "<script>window.MDTXTRT_STATIC=true;document.documentElement.setAttribute('data-static','')</script>");
html = html.replace('content="Editor de texto para Telegram e Telegraph."', 'content="Editor de texto com Markdown, direto no navegador. Os rascunhos ficam no seu aparelho."');
html = html.replace('content="Editor de texto para Telegram e Telegraph"', 'content="Editor de texto com Markdown, direto no navegador"');
// Manifesto PWA: instalado, o app abre em tela cheia (display: standalone) e o fundo vai até as bordas.
if (!html.includes('<link rel="icon"')) throw new Error("Link do favicon não encontrado no index.html");
html = html.replace('<link rel="icon"', '<link rel="manifest" href="manifest.webmanifest" />\n  <link rel="icon"');
for (const [name, re] of [["styles.css", /styles\.css\?v=[0-9a-f]+/], ["editor-core.js", /editor-core\.js\?v=[0-9a-f]+/], ["ui.js", /ui\.js\?v=[0-9a-f]+/]]) {
  if (!re.test(html)) throw new Error("Referência com ?v= não encontrada: " + name);
  html = html.replace(re, name + "?v=" + hash(join(OUT, name)));
}
if (/telegram\.org|Telegram\.WebApp/.test(html.replace(/window\.Telegram\?\.WebApp\?\.initData/g, ""))) {
  throw new Error("Ainda há referência ao Telegram no index.html estático");
}
writeFileSync(join(OUT, "index.html"), html);
writeFileSync(join(OUT, ".nojekyll"), "");
console.log(OUT + "/ pronto (versão estática)");
