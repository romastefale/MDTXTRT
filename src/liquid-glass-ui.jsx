import React, { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Glass } from "@samasante/liquid-glass";

/**
 * UX reference:
 * https://github.com/romastefale/liquid-glass/blob/main/examples/GlassContextMenu.tsx
 *
 * The optical engine is imported from @samasante/liquid-glass. MDTXTRT owns only
 * the application shell and the copied/restyled example-level component.
 */
export const MENU_LENS = {
  mapSize: 256,
  clipToShape: true,
  softEdge: true,
  depth: 0.65,
  curvature: 0.26,
  dispersion: 0.16,
  strength: 0.22,
  bend: 0.65,
  bendWidth: 0.07,
  frost: 3.5,
  brightness: 0.55,
  specular: 0.8,
  sheenAngle: 45,
  glow: 0.06,
  glowSpread: 1,
  glowFalloff: 0.8,
  sheen: 0.4,
  sheenWidth: 1,
};

const MENU_RADIUS = 9;
const PANEL_IDS = [
  "headingMenu",
  "listMenu",
  "quoteMenu",
  "importMenu",
  "exportMenu",
  "plusMenu",
  "dialogMenu",
  "findMenu",
];

function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () =>
      setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export function GlassContextPanel({ html }) {
  const [ref, { w, h }] = useSize();
  const ready = w > 0 && h > 0;
  return (
    <div ref={ref} className="lg-context-panel">
      {ready && (
        <Glass
          aria-hidden="true"
          optics={MENU_LENS}
          brightnessInFilter
          width={w}
          height={h}
          radius={MENU_RADIUS}
          className="lg-context-lens"
        />
      )}
      <div
        className="lg-context-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function adoptPanel(id) {
  const host = document.getElementById(id);
  if (!host) throw new Error(`Painel ausente: ${id}`);
  const html = host.innerHTML;
  host.replaceChildren();
  host.classList.add("lg-official");
  const mount = document.createElement("div");
  mount.className = "lg-react-mount";
  host.append(mount);
  const root = createRoot(mount);
  flushSync(() => root.render(<GlassContextPanel html={html} />));
}

for (const id of PANEL_IDS) adoptPanel(id);

await import("./app.js?v=5c865842be50");
