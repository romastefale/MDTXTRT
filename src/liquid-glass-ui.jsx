// Ponto de entrada de ui.js: monta a interface React (src/chrome.jsx) e só
// depois carrega o editor (app.js), que encontra a marcação e o estado prontos.
import { mountChrome } from "./chrome.jsx";

mountChrome(document.getElementById("ux-root"));

await import("../app.js");
