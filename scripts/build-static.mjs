// Monta docs/ com a versão estática (GitHub Pages): sem Telegram e sem servidor.
// Uso: npm run build:static   (ou: node scripts/build-static.mjs [pasta-com-ui.js-e-editor-core.js])
// Pré-requisito: ui.js e editor-core.js já gerados (npm run build:editor && npm run build:ui).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLES = process.argv[2] || ".";
const OUT = "docs";
const FILES = ["styles.css", "marked.js", "turndown.js", "favicon.svg", "logo.svg", "og.jpg", "x-banner.jpg", "manifest.webmanifest", "pwa-192.svg", "pwa-512.svg"];
const DIRS = ["icons"];
const PRODUTO = ["fundo-organico-claro.svg", "fundo-organico-escuro.svg"];
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
mkdirSync(join(OUT, "produto"), { recursive: true });
for (const name of PRODUTO) {
  if (!existsSync(join("produto", name))) throw new Error("Falta produto/" + name);
  cpSync(join("produto", name), join(OUT, "produto", name));
}

let html = readFileSync("index.html", "utf8");
const TELEGRAM_SCRIPT = '<script src="https://telegram.org/js/telegram-web-app.js?63"></script>';
if (!html.includes(TELEGRAM_SCRIPT)) throw new Error("Script do Telegram não encontrado no index.html");
// A versão estática nunca carrega o script do Telegram e liga o modo local antes de qualquer outro script.
html = html.replace(TELEGRAM_SCRIPT, "<script>window.MDTXTRT_STATIC=true;document.documentElement.setAttribute('data-static','')</script>");
html = html.replace('content="Editor de texto para Telegram e Telegraph."', 'content="Editor de texto com Markdown, direto no navegador. Os rascunhos ficam no seu aparelho."');
html = html.replace('content="Editor de texto para Telegram e Telegraph"', 'content="Editor de texto com Markdown, direto no navegador"');
// Cores de borda da versão estática (as do repositório HTML): #8b82e6 no claro e #1b1646 no escuro, iguais ao
// theme-color. Primeira pintura: o body já nasce na cor do canvas, antes do CSS carregar.
const EDGE_LIGHT = "#8b82e6", EDGE_DARK = "#1b1646";
const EARLY = ['m.setAttribute("content",l?"#d9d2f6":"#171a26")', 's.content=l?"default":"black-translucent"'];
for (const piece of EARLY) if (!html.includes(piece)) throw new Error("Script de tema inicial mudou: " + piece);
html = html.replace(EARLY[0], `m.setAttribute("content",l?"${EDGE_LIGHT}":"${EDGE_DARK}")`).replace(EARLY[1], 's.content="black-translucent"');
if (!html.includes('<meta name="theme-color" id="themeColor" content="#d9d2f6" />')) throw new Error("theme-color inicial não encontrado");
html = html.replace('<meta name="theme-color" id="themeColor" content="#d9d2f6" />', `<meta name="theme-color" id="themeColor" content="${EDGE_LIGHT}" />`);
html = html.replace('<link rel="stylesheet" href="styles.css', `<style>html,body{margin:0}body{background-color:${EDGE_LIGHT}}html[data-theme=dark] body{background-color:${EDGE_DARK}}</style>\n  <link rel="stylesheet" href="styles.css`);
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
