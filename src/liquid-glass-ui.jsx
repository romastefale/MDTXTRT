

import { mountChrome } from "./chrome.jsx";

mountChrome(document.getElementById("ux-root"));

await import("./app/main.js");
