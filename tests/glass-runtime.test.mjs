import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {JSDOM} from "jsdom";

const rootUrl = new URL("../", import.meta.url);
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
    MutationObserver: window.MutationObserver,
    ResizeObserver,
    matchMedia: window.matchMedia.bind(window),
    fetch: window.fetch,
    getComputedStyle: window.getComputedStyle.bind(window),
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    SVGElement: window.SVGElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
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

test("bar Glass material changes real optical veil and edge with the live theme", async () => {
  const dom = new JSDOM(readFileSync(new URL("index.html", rootUrl), "utf8"), {
    url: "https://mdtxtrt.example/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;

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
    configurable: true,
    value: {
      offsetLeft: 0,
      offsetTop: 0,
      width: 390,
      height: 800,
      addEventListener() {},
      removeEventListener() {},
    },
  });
  w.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({error: "not found"}),
    text: async () => "",
  });

  const realMatches = w.Element.prototype.matches;
  w.Element.prototype.matches = function(selector) {
    if (selector === ":popover-open") return this.hasAttribute("data-test-popover-open");
    return realMatches.call(this, selector);
  };
  w.HTMLElement.prototype.showPopover = function() {
    this.setAttribute("data-test-popover-open", "");
  };
  w.HTMLElement.prototype.hidePopover = function() {
    this.removeAttribute("data-test-popover-open");
  };

  const html = w.document.documentElement;
  html.classList.remove("dark");
  html.classList.add("light");
  html.dataset.theme = "light";

  const restore = installBrowserGlobals(w);

  try {
    await import(new URL("../ui.js?glass-runtime-theme", import.meta.url).href);
    await wait();
    await wait();

    const bar = w.document.querySelector(
      ".seg.top-pill[data-liquid-glass=\"material\"]",
    );
    const menu = w.document.querySelector(
      ".glass-menu-material[data-liquid-glass=\"material\"]",
    );

    assert.ok(bar, "bar must be rendered by the package Glass material");
    assert.ok(menu, "menu must be rendered by the package Glass material");

    assert.equal(brightnessLayer(bar)?.style.opacity, "0.34");
    assert.match(edgeLayer(bar)?.style.boxShadow || "", /0\.374/);
    assert.equal(brightnessLayer(menu)?.style.opacity, "0.55");

    html.classList.remove("light");
    html.classList.add("dark");
    html.dataset.theme = "dark";
    await wait();
    await wait();

    assert.equal(brightnessLayer(bar)?.style.opacity, "0.2");
    assert.match(edgeLayer(bar)?.style.boxShadow || "", /0\.275/);
    assert.equal(
      brightnessLayer(menu)?.style.opacity,
      "0.55",
      "menu optics must remain independent from bar theme tuning",
    );

    html.classList.remove("dark");
    html.classList.add("light");
    html.dataset.theme = "light";
    await wait();
    await wait();

    assert.equal(
      brightnessLayer(bar)?.style.opacity,
      "0.34",
      "bar optics must react when the running app switches theme again",
    );
  } finally {
    restore();
    dom.window.close();
  }
});
