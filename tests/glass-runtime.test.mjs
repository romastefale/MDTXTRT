import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {TextEncoder} from "node:util";
import {JSDOM} from "jsdom";

const root = new URL("../", import.meta.url);
const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

function installBrowserGlobals(window) {
  const previous = new Map();
  const put = (name, value) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  };

  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  for (const [name, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    crypto: window.crypto,
    MutationObserver: window.MutationObserver,
    ResizeObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    SVGElement: window.SVGElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    AbortController: window.AbortController,
    AbortSignal: window.AbortSignal,
    Blob: window.Blob,
    File: window.File,
    FormData: window.FormData,
    URL: window.URL,
    fetch: window.fetch,
    TextEncoder,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    matchMedia: window.matchMedia.bind(window),
  })) put(name, value);

  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

function brightnessLayer(material) {
  return [...material.children].find(
    child => child.hasAttribute?.("data-lg-layer") && child.style?.opacity,
  );
}

function edgeLayer(material) {
  return [...material.children].find(
    child => child.hasAttribute?.("data-lg-layer") && child.style?.boxShadow,
  );
}

test("bar and menu Glass materials keep the standardized neutral surface across themes", async () => {
  const dom = new JSDOM(readFileSync(new URL("index.html", root), "utf8"), {
    url: "https://mdtxtrt.example/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;

  w.TextEncoder = TextEncoder;
  Object.defineProperty(w.crypto, "randomUUID", {
    value: randomUUID,
    configurable: true,
  });
  w.matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  Object.defineProperty(w, "visualViewport", {
    value: {
      offsetTop: 0,
      height: 800,
      addEventListener() {},
      removeEventListener() {},
    },
    configurable: true,
  });
  if (!w.AbortSignal.timeout) {
    w.AbortSignal.timeout = () => new w.AbortController().signal;
  }
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.Range.prototype.getClientRects = function() { return []; };
  w.Range.prototype.getBoundingClientRect = function() { return {left:0,right:0,top:0,bottom:0,width:0,height:0}; };
  w.HTMLElement.prototype.getClientRects = function() { return []; };
  w.HTMLElement.prototype.getBoundingClientRect = function() { return {left:0,right:0,top:0,bottom:0,width:0,height:0}; };
  w.URL.createObjectURL = () => "blob:test";
  w.URL.revokeObjectURL = () => {};
  w.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({error: "not found"}),
  });

  const realMatches = w.Element.prototype.matches;
  w.Element.prototype.matches = function(selector) {
    if (selector === ":popover-open") {
      return this.hasAttribute("data-test-popover-open");
    }
    return realMatches.call(this, selector);
  };
  w.HTMLElement.prototype.showPopover = function() {
    this.setAttribute("data-test-popover-open", "");
  };
  w.HTMLElement.prototype.hidePopover = function() {
    this.removeAttribute("data-test-popover-open");
  };

  w.localStorage.setItem("mdtxtrt-theme", "light");
  const restore = installBrowserGlobals(w);

  try {
    w.eval(readFileSync(new URL("editor-core.js", root), "utf8"));
    await import(new URL("../ui.js?glass-runtime-theme", import.meta.url).href);
    await wait();
    await wait();

    const bar = w.document.querySelector(
      ".seg.top-pill[data-liquid-glass=\"material\"]",
    );
    const menu = w.document.querySelector(
      ".glass-menu-material[data-liquid-glass=\"material\"]",
    );
    const themeButton = w.document.querySelector("#themeBtn");

    assert.ok(bar, "bar must be rendered by the package Glass material");
    assert.ok(menu, "menu must be rendered by the package Glass material");
    assert.ok(themeButton, "the real app theme control must be mounted");
    assert.equal(w.document.documentElement.dataset.theme, "light");

    assert.equal(brightnessLayer(bar), undefined);
    assert.match(edgeLayer(bar)?.style.boxShadow || "", /0\.000/);
    assert.equal(brightnessLayer(menu), undefined);
    assert.match(edgeLayer(menu)?.style.boxShadow || "", /0\.000/);

    themeButton.click();
    await wait();
    await wait();

    assert.equal(w.localStorage.getItem("mdtxtrt-theme"), "dark");
    assert.equal(w.document.documentElement.dataset.theme, "light");
    assert.equal(brightnessLayer(bar), undefined);
    assert.match(edgeLayer(bar)?.style.boxShadow || "", /0\.000/);
    assert.equal(brightnessLayer(menu), undefined);
    assert.match(
      edgeLayer(menu)?.style.boxShadow || "",
      /0\.000/,
      "menu optics must stay aligned with the neutral chrome material",
    );
  } finally {
    restore();
    w.close();
  }
});
