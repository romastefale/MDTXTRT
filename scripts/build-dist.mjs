// Monta dist/ com os arquivos estáticos do Mini App. `tgcloud push` não roda build: rode `npm run build` antes.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const FILES = ["index.html", "styles.css", "ui.js", "editor-core.js", "marked.js", "turndown.js", "favicon.svg", "logo.svg", "og.jpg", "x-banner.jpg"];
const DIRS = ["icons", "produto"];
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
for (const name of FILES) {
  if (!existsSync(name)) throw new Error("Arquivo ausente: " + name);
  cpSync(name, "dist/" + name);
}
for (const name of DIRS) cpSync(name, "dist/" + name, { recursive: true });
console.log("dist/ pronto");
