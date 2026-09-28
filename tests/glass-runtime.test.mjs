import {test} from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";

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
    MutationObserver: window.MutationObserver,
    ResizeObserver,
    matchMedia: window.matchMedia.bind(window),
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
  const dom = new JSDOM(
    "<!doctype html><html class=\"light\" data-theme=\"light\"><body><div id=\"ux-root\"></div></body></html>",
    {
      url: "https://mdtxtrt.example/",
      pretendToBeVisual: true,
    },
  );
  dom.window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  dom.window.matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  const restore = installBrowserGlobals(dom.window);

  try {
    await import(new URL("../ui.js?glass-runtime-theme", import.meta.url).href);
    await wait();
    await wait();

    const root = dom.window.document.documentElement;
    const bar = dom.window.document.querySelector(
      ".seg.top-pill[data-liquid-glass=\"material\"]",
    );
    const menu = dom.window.document.querySelector(
      ".glass-menu-material[data-liquid-glass=\"material\"]",
    );

    assert.ok(bar, "bar must be rendered by the package Glass material");
    assert.ok(menu, "menu must be rendered by the package Glass material");

    assert.equal(brightnessLayer(bar)?.style.opacity, "0.34");
    assert.match(edgeLayer(bar)?.style.boxShadow || "", /0\.374/);
    assert.equal(brightnessLayer(menu)?.style.opacity, "0.55");

    root.classList.remove("light");
    root.classList.add("dark");
    root.dataset.theme = "dark";
    await wait();
    await wait();

    assert.equal(brightnessLayer(bar)?.style.opacity, "0.2");
    assert.match(edgeLayer(bar)?.style.boxShadow || "", /0\.275/);
    assert.equal(
      brightnessLayer(menu)?.style.opacity,
      "0.55",
      "menu optics must remain independent from bar theme tuning",
    );

    root.classList.remove("dark");
    root.classList.add("light");
    root.dataset.theme = "light";
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
