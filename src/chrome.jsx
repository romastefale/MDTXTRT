import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Glass } from "@samasante/liquid-glass";
import { getUIState, subscribeUI, uiStore } from "./ui-store.mjs";

/**
 * Component architecture copied and adapted from:
 * https://github.com/romastefale/liquid-glass/blob/main/examples/GlassContextMenu.tsx
 *
 * Optical rendering is provided exclusively by @samasante/liquid-glass.
 * MDTXTRT owns only this application-specific React shell.
 */
// Normativa do fork (src/GlassMaterial.tsx › MATERIAL_OPTICS) e do site
// romastefale/HTML (src/lib/optics.ts): as barras usam o frost do material (6px,
// saturate 1.15); menus, diálogos e os avisos efêmeros, o de painel de leitura
// (22px, saturate 1.4). specular 0 desliga a borda da biblioteca (o brilho de topo e o
// aro dela): não há brilho de topo, e o único aro, hairline e uniforme, vem do CSS
// (styles.css › --glass-edge), 0,5px em telas 2x ou mais.
const NO_SHINE = { specular: 0, sheen: 0, glow: 0 };

export const MENU_LENS = {
  ...NO_SHINE,
  frost: 22,
  saturate: 1.4,
};

// O toast fica sobre o texto do documento: o fosco de painel de leitura do site
// (src/lib/optics.ts › PANEL: frost 22, saturate 1.4), o mesmo da lista de páginas.
const NOTICE_LENS = MENU_LENS;

const BAR_LENS = {
  ...NO_SHINE,
  frost: 6,
  saturate: 1.15,
};

// Lente dos botões em destaque (+ e ☰): PLAYER_OPTICS de
// examples/GlassVideoControls.tsx do fork, o mesmo usado na galeria do site.
const CHROME_LENS = {
  mapSize: 256,
  clipToShape: true,
  softEdge: true,
  strength: 0.16,
  depth: 0.2,
  curvature: 0.55,
  bend: 0.25,
  bendWidth: 0.08,
  dispersion: 0.15,
  ...NO_SHINE,
  frost: 3,
  brightness: 0,
};

// Refração por mapa de deslocamento nas barras (superior e inferior): os valores
// do material do fork (src/GlassMaterial.tsx › MATERIAL_OPTICS, o mesmo material
// dos controles do site romastefale/HTML), sem brilho, com o frost das barras.
// Onde a biblioteca já dobra a página ao vivo com o filtro de deslocamento, a
// lente soma-se a ela; no navegador do iPhone, que não aplica esse filtro, a
// lente WebGL 2 do fork desenha a mesma refração sobre o fundo. Sem WebGL 2 fica
// o vidro em CSS.
const BAR_REFRACTION = {
  mapSize: 256,
  clipToShape: true,
  softEdge: true,
  strength: 0.05,
  depth: 0.5,
  curvature: 0.3,
  bend: 0.45,
  bendWidth: 0.16,
  dispersion: 0.32,
  ...NO_SHINE,
  frost: 6,
  saturate: 1.15,
  brightness: 0,
};

// Quanto tempo o laço WebGL fica vivo depois de cada mudança (carga, resize,
// teclado, volta à aba). Depois o último quadro fica congelado num canvas 2D e o
// renderizador é desmontado: nenhum laço contínuo.
const LENS_SETTLE_MS = 1200;

let webgl2Support = null;
function hasWebGL2() {
  if (webgl2Support !== null) return webgl2Support;
  webgl2Support = false;
  try {
    if (typeof WebGL2RenderingContext === "undefined") return false;
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2Support = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2Support = false;
  }
  return webgl2Support;
}

// O que fica atrás do botão: o fundo orgânico do tema, esticado como o .bg, com
// os degradês de borda (.fade-top / .fade-bot) por cima. Rasterizado uma vez por
// tema e tamanho de tela; cada quadro só recorta a região sob o botão.
const backdrop = { key: "", canvas: null, img: null, src: "" };
function backdropSource() {
  const light = document.documentElement.classList.contains("light");
  return light ? "produto/fundo-claro.svg" : "produto/fundo-escuro.svg";
}
function loadBackdrop() {
  const src = backdropSource();
  if (backdrop.img && backdrop.src === src) return Promise.resolve(backdrop.img);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      // Se o tema mudou de novo durante o carregamento, este fundo já não serve.
      if (backdropSource() === src) {
        backdrop.img = img;
        backdrop.src = src;
        backdrop.key = "";
      }
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}
// Paradas dos degradês de borda (styles.css › .fade-top/.fade-bot): [t, alfa%],
// alfa = (1-t)², t de 0 (fim da faixa sólida: área segura + --gap) a 1 (lado do
// conteúdo).
export const FADE_STOPS = [[0, 100], [0.1, 81], [0.2, 64], [0.3, 49], [0.4, 36], [0.5, 25], [0.6, 16], [0.7, 9], [0.8, 4], [0.9, 1], [1, 0]];
// Altura em px da faixa sólida (--fade-solid: área segura em env() + --gap).
function fadeSolid(el) {
  if (!el) return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;width:0;height:var(--fade-solid,0px)";
  el.append(probe);
  const value = probe.getBoundingClientRect().height || 0;
  probe.remove();
  return value;
}
// O canvas não entende color-mix(): a cor da borda vira rgba() com o alfa da parada.
function edgeRGBA(ctx, edge) {
  ctx.fillStyle = "#000";
  ctx.fillStyle = edge;
  const hex = String(ctx.fillStyle);
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m) {
    const [r, g, b] = [m[1], m[2], m[3]].map(v => parseInt(v, 16));
    return a => `rgba(${r},${g},${b},${a / 100})`;
  }
  const rgb = /^rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(hex.replace(/\s/g, ""));
  if (rgb) return a => `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a / 100})`;
  return a => (a > 50 ? edge : "transparent");
}
function paintFade(ctx, rect, bgRect, edge, down, solid) {
  if (!rect || !rect.height) return;
  const top = rect.top - bgRect.top;
  const g = ctx.createLinearGradient(0, down ? top + rect.height : top, 0, down ? top : top + rect.height);
  const color = edgeRGBA(ctx, edge);
  const s = Math.min(Math.max(0, solid), rect.height) / rect.height;
  g.addColorStop(0, color(100));
  for (const [t, a] of FADE_STOPS) g.addColorStop(s + (1 - s) * t, color(a));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, bgRect.width, rect.height);
}
function backdropCanvas(bgRect) {
  const fadeTopEl = document.querySelector(".fade-top");
  const fadeBotEl = document.querySelector(".fade-bot");
  const fadeTop = fadeTopEl?.getBoundingClientRect();
  const fadeBot = fadeBotEl?.getBoundingClientRect();
  const w = Math.max(1, Math.round(bgRect.width));
  const h = Math.max(1, Math.round(bgRect.height));
  const key = [backdrop.src, w, h, fadeTop?.height, fadeBot?.top, document.documentElement.className].join("|");
  if (backdrop.canvas && backdrop.key === key) return backdrop.canvas;
  const canvas = backdrop.canvas || document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const edge = getComputedStyle(document.documentElement).getPropertyValue("--edge").trim() || "#151137";
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(backdrop.img, 0, 0, w, h);
  // A mesma sombra que escurece o fundo do tema escuro (.bg, --bg-shade).
  const shade = getComputedStyle(document.documentElement).getPropertyValue("--bg-shade").trim();
  if (shade && shade !== "transparent") {
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
  }
  paintFade(ctx, fadeTop, bgRect, edge, false, fadeSolid(fadeTopEl));
  paintFade(ctx, fadeBot, bgRect, edge, true, fadeSolid(fadeBotEl));
  backdrop.canvas = canvas;
  backdrop.key = key;
  return canvas;
}

/**
 * Lente de refração WebGL 2 do fork (<Glass draw lenses>) dentro de um botão.
 * Exige WebGL 2; sem ele o elemento fica oculto e vale o vidro em CSS. O canvas
 * não recebe ponteiro nem foco (aria-hidden, pointer-events:none), então o
 * preventDefault delegado do teclado continua valendo. Renderiza só enquanto algo
 * muda e pausa com a aba oculta.
 */
// memo: as lentes não dependem do estado dos menus; abrir um menu não pode
// redesenhar o vidro do + e do ☰.
const ChromeLens = React.memo(function ChromeLens({ optics = CHROME_LENS, variant = "control" }) {
  const hostRef = useRef(null);
  const snapRef = useRef(null);
  const frozenRef = useRef(false);
  const [live, setLive] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });

  const copyOut = useCallback(() => {
    const host = hostRef.current;
    const snap = snapRef.current;
    const out = host?.querySelector(".lens-surface canvas");
    if (!out || !snap || out.style.display === "none" || !out.width || !out.height) return;
    if (snap.width !== out.width || snap.height !== out.height) {
      snap.width = out.width;
      snap.height = out.height;
    }
    const ctx = snap.getContext("2d");
    ctx.clearRect(0, 0, snap.width, snap.height);
    ctx.drawImage(out, 0, 0);
    if (!frozenRef.current) {
      frozenRef.current = true;
      setFrozen(true);
      host.closest("button")?.setAttribute("data-lens", "webgl2");
    }
  }, []);

  const draw = useCallback((ctx) => {
    const host = hostRef.current;
    const bg = document.querySelector(".bg")?.getBoundingClientRect();
    const r = host?.getBoundingClientRect();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!host || !bg || !r || !r.width || !backdrop.img) return;
    const source = backdropCanvas(bg);
    const sx = ctx.canvas.width / r.width;
    const sy = ctx.canvas.height / r.height;
    ctx.drawImage(source, (bg.left - r.left) * sx, (bg.top - r.top) * sy, bg.width * sx, bg.height * sy);
    // Depois do render do mesmo quadro (microtarefa), antes da composição.
    queueMicrotask(copyOut);
  }, [copyOut]);

  useEffect(() => {
    const host = hostRef.current;
    const button = host?.closest("button");
    if (!hasWebGL2()) {
      button?.setAttribute("data-lens", "css");
      return undefined;
    }
    let timer = 0;
    let cancelled = false;
    let ready = false;
    const measure = () => {
      // O host fica oculto (display:none) até a primeira lente: mede o botão.
      const frame = host?.parentElement;
      if (!frame) return;
      const w = frame.clientWidth;
      const h = frame.clientHeight;
      setBox(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const settle = () => {
      setLive(false);
      if (!frozenRef.current) button?.setAttribute("data-lens", "css");
    };
    const wake = () => {
      if (cancelled || !ready || document.hidden) return;
      measure();
      setLive(true);
      clearTimeout(timer);
      timer = setTimeout(settle, LENS_SETTLE_MS);
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        setLive(false);
      } else wake();
    };
    loadBackdrop().then(() => {
      ready = true;
      wake();
    }).catch(() => button?.setAttribute("data-lens", "css"));
    // Troca de tema sem recarregar (botão, tema do sistema ou do Telegram): carrega
    // o fundo do tema novo e redesenha; sem isso o quadro congelado mantinha a cor
    // do tema anterior.
    let theme = backdropSource();
    const themeObserver = new MutationObserver(() => {
      const next = backdropSource();
      if (next === theme) return;
      theme = next;
      loadBackdrop().then(() => {
        if (backdropSource() === next) wake();
      }).catch(() => {});
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const viewport = window.visualViewport;
    window.addEventListener("resize", wake);
    viewport?.addEventListener("resize", wake);
    viewport?.addEventListener("scroll", wake);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      themeObserver.disconnect();
      window.removeEventListener("resize", wake);
      viewport?.removeEventListener("resize", wake);
      viewport?.removeEventListener("scroll", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const lenses = box.w > 0 && box.h > 0
    ? [{ x: 0.5, y: 0.5, w: box.w, h: box.h, radius: Math.min(box.w, box.h) / 2 }]
    : [];
  return (
    <span
      ref={hostRef}
      className={variant === "bar" ? "lens lens-bar" : "lens"}
      aria-hidden="true"
      data-live={live ? "" : undefined}
      data-frozen={frozen ? "" : undefined}
    >
      <canvas ref={snapRef} />
      {live && lenses.length > 0 && (
        <Glass
          className="lens-surface"
          draw={draw}
          optics={optics}
          lenses={lenses}
          maxDpr={2}
          style={{ position: "absolute", inset: 0 }}
        />
      )}
    </span>
  );
});

const MENU_RADIUS = 9;

// Estado de menus, diálogo e biblioteca vem de src/ui-store.mjs; app.js só
// descreve o estado e nunca altera a marcação destes componentes.
function useUI(select) {
  const read = () => select(getUIState());
  return useSyncExternalStore(subscribeUI, read, read);
}

// Um controle que ancora menus expõe aria-expanded depois do primeiro menu
// aberto a partir dele, como antes.
function useAnchorExpanded(id) {
  return useUI(state => {
    if (!id) return undefined;
    let anchored = false;
    for (const menu of Object.values(state.menus)) {
      if (menu.anchor !== id) continue;
      if (menu.open) return "true";
      anchored = true;
    }
    return anchored ? "false" : undefined;
  });
}

function Icon({ name }) {
  return <span className="ui-icon" data-icon={name} aria-hidden="true" />;
}

// Itens marcados como exclusivos de um destino somem no outro; hideOnTelegraph
// cobre os blocos que o Telegraph não aceita; currentKey marca o bloco atual.
function MenuItem({ icon, className = "", children, hideOnTelegraph = false, currentKey, ...props }) {
  const telegraph = useUI(state => state.dest === "telegraph");
  const current = useUI(state => currentKey !== undefined && state.blockKind === currentKey);
  const expanded = useAnchorExpanded(props.id);
  let hidden;
  if (hideOnTelegraph || "data-telegram-only" in props) hidden = telegraph;
  else if ("data-telegraph-only" in props) hidden = !telegraph;
  return (
    <button
      type="button"
      className={current ? `${className} is-current`.trim() : className}
      hidden={hidden}
      aria-expanded={expanded}
      {...props}
    >
      <span className="sheet-ico"><Icon name={icon} /></span>
      {children}
    </button>
  );
}

function px(value) {
  return value === undefined ? undefined : value + "px";
}

export function GlassContextMenu({
  id,
  children,
  className = "",
  popover = null,
  anchorId,
  placement = "auto",
  ...props
}) {
  const menu = useUI(state => state.menus[id]);
  const open = Boolean(menu?.open);
  const surface = useRef(null);
  useLayoutEffect(() => {
    if (!open) return;
    const list = surface.current?.querySelector(".menu-list");
    if (list) list.scrollTop = 0;
  }, [open]);
  const style = {};
  if (menu?.left !== undefined) style["--menu-left"] = px(menu.left);
  if (menu?.top !== undefined) style["--menu-top"] = px(menu.top);
  if (menu?.maxHeight !== undefined) style["--menu-max-height"] = px(menu.maxHeight);
  if (menu?.maxWidth !== undefined) style["--menu-max-width"] = px(menu.maxWidth);
  return (
    <div
      ref={surface}
      id={id}
      popover={popover || undefined}
      data-menu-surface={popover ? undefined : ""}
      data-anchor={anchorId}
      data-placement={placement}
      data-menu-open={open ? "" : undefined}
      data-runtime-positioned={menu?.positioned ? "" : undefined}
      className={`glass-menu ${className}`.trim()}
      style={style}
      {...props}
    >
      <MenuMaterial>{children}</MenuMaterial>
    </div>
  );
}

// O material só muda quando o conteúdo muda: abrir, posicionar ou fechar um
// menu não redesenha o vidro (os filhos chegam com a mesma referência).
const MENU_MATERIAL_STYLE = { display: "block", width: "100%" };
const MenuMaterial = React.memo(function MenuMaterial({ children }) {
  return (
    <Glass optics={MENU_LENS} className="glass-menu-material" style={MENU_MATERIAL_STYLE}>
      <div className="glass-menu-content">{children}</div>
    </Glass>
  );
});

function GlassControl({ className = "", children, style, ...props }) {
  return (
    <Glass
      optics={BAR_LENS}
      className={className}
      style={{ display: "flex", alignItems: "center", ...style }}
      {...props}
    >
      {children}
    </Glass>
  );
}

function LinkMenu() {
  return (
    <GlassContextMenu id="linkMenu" anchorId="linkBtn" placement="top">
      <div className="menu-list">
        <MenuItem icon="link" data-link-kind="hyperlink">Hiperlink</MenuItem>
        <MenuItem icon="link" data-link-kind="url">Link</MenuItem>
        <MenuItem icon="buttons" data-link-kind="button" data-telegram-only="">Botão com link</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

function HeadingMenu() {
  return (
    <GlassContextMenu id="headingMenu" className="heading-menu" anchorId="headingBtn" placement="top">
      <div className="menu-list heading-list">
        <MenuItem icon="h1" className="h-opt h1" data-block="h1" currentKey="h1" hideOnTelegraph>Título H1</MenuItem>
        <MenuItem icon="h2" className="h-opt h2" data-block="h2" currentKey="h2" hideOnTelegraph>Título H2</MenuItem>
        <MenuItem icon="h3" className="h-opt h3" data-block="h3" currentKey="h3">Título H3</MenuItem>
        <MenuItem icon="h4" className="h-opt h4" data-block="h4" currentKey="h4">Título H4</MenuItem>
        <MenuItem icon="h5" className="h-opt h5" data-block="h5" currentKey="h5" hideOnTelegraph>Título H5</MenuItem>
        <MenuItem icon="h6" className="h-opt h6" data-block="h6" currentKey="h6" hideOnTelegraph>Título H6</MenuItem>
        <MenuItem icon="paragraph" data-block="p" currentKey="p">Corpo</MenuItem>
        <MenuItem icon="footer" className="h-opt footer" data-block="footer" currentKey="footer" hideOnTelegraph>Rodapé</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

function ListMenu() {
  return (
    <GlassContextMenu id="listMenu" anchorId="listBtn" placement="top">
      <div className="menu-list">
        <MenuItem icon="list" data-cmd="insertUnorderedList">Lista com marcadores</MenuItem>
        <MenuItem icon="format_list_numbered" data-insert="ordered">Lista ordenada</MenuItem>
        <MenuItem icon="task" data-insert="task" data-telegram-only="">Checklist</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

function QuoteMenu() {
  return (
    <GlassContextMenu id="quoteMenu" anchorId="quoteBtn" placement="top">
      <div className="menu-list">
        <MenuItem icon="quote" data-block="blockquote" currentKey="blockquote">Citação</MenuItem>
        <MenuItem icon="pullquote" data-insert="pullquote" currentKey="pullquote">Citação em destaque</MenuItem>
        <MenuItem icon="expandquote" data-insert="expandquote" currentKey="expandquote" hideOnTelegraph>Citação expansível</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

function PublishItem() {
  const dest = useUI(state => state.dest);
  const publishLabel = useUI(state => state.publishLabel);
  return (
    <MenuItem icon={dest === "telegram" ? "telegram" : "telegraph"} id="openAppBtn" aria-label={publishLabel} title={publishLabel}>
      <span id="openAppLabel">{publishLabel}</span>
    </MenuItem>
  );
}

function ExportMenu() {
  return (
    <GlassContextMenu id="exportMenu" className="wide-menu export-menu" anchorId="exportBtn" placement="auto">
      <div className="menu-list">
        <MenuItem icon="file" id="libraryBtn">Rascunhos e publicações</MenuItem>
        <div className="menu-divider" role="separator" />
        <PublishItem />
        <MenuItem icon="markdown" id="exportMdBtn">Baixar Markdown</MenuItem>
        <MenuItem icon="text_fields" id="exportTxtBtn">Baixar TXT</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

const plusSections = [
  {
    id: "file",
    icon: "markdown",
    label: "Arquivo",
    items: [
      ["markdown", "Importar Markdown", { id: "importMdBtn" }],
      ["text_fields", "Importar TXT", { id: "importTxtBtn" }],
      ["search", "Localizar e substituir", { id: "findBtn" }],
    ],
  },
  {
    id: "format",
    icon: "text_fields",
    label: "Formatação",
    items: [
      ["strikethrough_s", "Riscado", { "data-cmd": "strike" }],
      ["ink_highlighter", "Marca-texto", { "data-cmd": "mark", "data-telegram-only": "" }],
      ["visibility_off", "Spoiler", { "data-cmd": "spoiler", "data-telegram-only": "" }],
      ["code", "Código", { "data-cmd": "code" }],
      ["subscript", "Subscrito", { "data-cmd": "sub", "data-telegram-only": "" }],
      ["superscript", "Sobrescrito", { "data-cmd": "sup", "data-telegram-only": "" }],
    ],
  },
  {
    id: "structure",
    icon: "table",
    label: "Estrutura",
    items: [
      ["functions", "Fórmula inline", { "data-cmd": "math", "data-telegram-only": "" }],
      ["calculate", "Fórmula em bloco", { "data-insert": "mathblock", "data-telegram-only": "" }],
      ["horizontal_rule", "Divisor", { "data-insert": "divider" }],
      ["table", "Tabela", { "data-insert": "table", "data-telegram-only": "" }],
      ["plus", "Adicionar linha", { "data-table-action": "add-row", "data-telegram-only": "" }],
      ["horizontal_rule", "Remover linha", { "data-table-action": "remove-row", "data-telegram-only": "" }],
      ["plus", "Adicionar coluna", { "data-table-action": "add-column", "data-telegram-only": "" }],
      ["horizontal_rule", "Remover coluna", { "data-table-action": "remove-column", "data-telegram-only": "" }],
      ["table", "Apagar tabela", { "data-table-action": "delete-table", "data-telegram-only": "" }],
      ["details", "Conteúdo expansível", { "data-insert": "details", "data-telegram-only": "" }],
    ],
  },
  {
    id: "media",
    icon: "image",
    label: "Mídia",
    items: [
      ["image", "Imagem", { "data-insert": "image" }],
      ["attach_file", "Anexar mídia", { id: "mediaBtn", "data-telegram-only": "" }],
      ["music_note", "Anexar voz", { id: "voiceBtn", "data-telegram-only": "" }],
      ["movie", "Vídeo", { "data-insert": "video" }],
      ["web", "Incorporar", { "data-insert": "embed", "data-telegraph-only": "" }],
      ["music_note", "Áudio", { "data-insert": "audio", "data-telegram-only": "" }],
      ["file", "Documento", { "data-insert": "document", "data-telegram-only": "" }],
      ["location_on", "Mapa", { "data-insert": "map", "data-telegram-only": "" }],
      ["view_comfy", "Colagem", { "data-insert": "collage", "data-telegram-only": "" }],
      ["slideshow", "Slideshow", { "data-insert": "slideshow", "data-telegram-only": "" }],
    ],
  },
  {
    id: "interaction",
    icon: "buttons",
    label: "Interações",
    telegramOnly: true,
    items: [
      ["anchor", "Âncora", { "data-insert": "anchor", "data-telegram-only": "" }],
      ["sticky_note_2", "Referência", { "data-insert": "reference", "data-telegram-only": "" }],
      ["schedule", "Data e hora", { "data-insert": "time", "data-telegram-only": "" }],
      ["mood", "Emoji personalizado", { "data-insert": "emoji", "data-telegram-only": "" }],
      ["buttons", "Botão", { "data-insert": "button", "data-telegram-only": "" }],
    ],
  },
];

function PlusCategory({ section }) {
  const categoryProps = section.telegramOnly ? { "data-telegram-only": "" } : {};
  return (
    <MenuItem icon={section.icon} data-plus-category={section.id} {...categoryProps}>
      <span className="menu-label">{section.label}</span>
      <span className="menu-chevron"><Icon name="chevron_right" /></span>
    </MenuItem>
  );
}

function PlusSubmenu({ section }) {
  return (
    <GlassContextMenu
      id={`plus-${section.id}-menu`}
      className="wide-menu plus-submenu"
      anchorId="plusBtn"
      placement="top"
      data-plus-submenu={section.id}
    >
      <div className="menu-list">
        <MenuItem icon="arrow_back" className="submenu-back" data-plus-back="">
          <span className="menu-label">{section.label}</span>
        </MenuItem>
        <div className="menu-divider" role="separator" />
        {section.items.map(([icon, label, props]) => (
          <MenuItem key={label} icon={icon} {...props}>{label}</MenuItem>
        ))}
      </div>
    </GlassContextMenu>
  );
}

function PlusMenu() {
  return (
    <>
      <GlassContextMenu id="plusMenu" className="wide-menu" anchorId="plusBtn" placement="top">
        <div className="tools document-tools">
          <input id="docName" defaultValue="Ideia" aria-label="Nome do documento" maxLength={256} />
        </div>
        <div className="menu-list">
          {plusSections.map(section => <PlusCategory key={section.id} section={section} />)}
        </div>
      </GlassContextMenu>
      {plusSections.map(section => <PlusSubmenu key={section.id} section={section} />)}
    </>
  );
}

function DialogBody() {
  const dialog = useUI(state => state.dialog);
  const input = useRef(null);
  // Cada abertura (serial) recebe o valor inicial; o texto digitado depois é do usuário.
  useLayoutEffect(() => {
    if (input.current) input.current.value = dialog.value;
  }, [dialog.serial]);
  useLayoutEffect(() => {
    const surface = document.getElementById("dialogMenu");
    if (!surface) return;
    const shown = surface.matches(":popover-open");
    if (dialog.open && !shown) surface.showPopover();
    else if (!dialog.open && shown) surface.hidePopover();
  }, [dialog.open, dialog.serial]);
  return (
    <div className="dialog">
      <div className="dialog-label" id="dialogLabel">{dialog.label}</div>
      <textarea
        ref={input}
        id="dialogInput"
        rows={dialog.rows}
        hidden={dialog.confirm}
        spellCheck={false}
        aria-labelledby="dialogLabel"
      />
      <div className="dialog-actions">
        <button type="button" id="dialogCancel" hidden={!dialog.cancel}>{dialog.cancel}</button>
        <button type="button" id="dialogOk">{dialog.ok}</button>
      </div>
    </div>
  );
}

function DialogMenu() {
  return (
    <GlassContextMenu
      id="dialogMenu"
      popover="manual"
      className="dialog-menu"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialogLabel"
    >
      <DialogBody />
    </GlassContextMenu>
  );
}

function FindMenu() {
  return (
    <GlassContextMenu id="findMenu" className="find-menu wide-menu" anchorId="findBtn" placement="auto">
      <div className="menu-list">
        <div className="tools"><input id="findText" placeholder="Localizar" aria-label="Localizar" /></div>
        <div className="tools"><input id="replaceText" placeholder="Substituir" aria-label="Substituir por" /></div>
        <div className="tools">
          <button type="button" id="findNext">Próximo</button>
          <button type="button" id="replaceOne">Substituir</button>
          <button type="button" id="replaceAll">Substituir tudo</button>
        </div>
      </div>
    </GlassContextMenu>
  );
}

function libraryTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function LibraryEntry({ entry }) {
  return (
    <article className="library-entry">
      <div className="library-entry-text">
        <div className="library-entry-head">
          <strong>{entry.title || "Sem título"}</strong>
          {entry.platform ? <span className="library-badge">{entry.platform}</span> : null}
        </div>
        <p className="library-preview">{entry.preview || "Sem conteúdo para pré-visualização."}</p>
        <span className="library-meta">{entry.meta || ""}</span>
        <div className="library-dates">
          <span>{"Criado: " + (libraryTime(entry.createdAt) || "—")}</span>
          <span>{"Modificado: " + (libraryTime(entry.updatedAt) || "—")}</span>
        </div>
      </div>
      <button type="button" disabled={Boolean(entry.disabled)} onClick={entry.onSelect}>
        {entry.label || "Editar"}
      </button>
    </article>
  );
}

function LibraryList({ list, ...props }) {
  return (
    <div className="library-list" {...props}>
      {list.items.length
        ? list.items.map(entry => <LibraryEntry key={entry.key} entry={entry} />)
        : list.empty
          ? <div className="library-empty">{list.empty}</div>
          : null}
    </div>
  );
}

function LibraryStatus() {
  const status = useUI(state => state.library.status);
  return <div id="libraryStatus" className="library-status" role="status" aria-live="polite">{status}</div>;
}

function LibraryCount({ id, field }) {
  const count = useUI(state => state.library[field]);
  return <span id={id} className="library-section-count">{String(count)}</span>;
}

function LibraryToggle({ field, children, ...props }) {
  const open = useUI(state => state.library[field]);
  return (
    <MenuItem className="library-section-toggle" aria-expanded={String(open)} {...props}>
      {children}
      <span className="menu-chevron"><Icon name="chevron_right" /></span>
    </MenuItem>
  );
}

function LibraryGroup({ field, children, ...props }) {
  const open = useUI(state => state.library[field]);
  return <div hidden={!open} {...props}>{children}</div>;
}

function LibrarySection({ field, ...props }) {
  const list = useUI(state => state.library[field]);
  return <LibraryList list={list} {...props} />;
}

function LibrarySubmenu() {
  return (
    <GlassContextMenu
      id="libraryMenu"
      className="wide-menu plus-submenu library-menu"
      anchorId="exportBtn"
      placement="auto"
      data-library-submenu=""
    >
      <div className="menu-list library-menu-list">
        <MenuItem icon="arrow_back" className="submenu-back" id="libraryClose">
          <span className="menu-label">Rascunhos e publicações</span>
        </MenuItem>
        <MenuItem icon="sticky_note_2" id="libraryNew">Novo documento</MenuItem>
        <div className="menu-divider" role="separator" />
        <LibraryStatus />
        <LibraryToggle icon="file" id="publicationToggle" field="publicationsOpen" aria-controls="publicationLists">
          <span id="publicationLibraryTitle" className="menu-label">Publicações</span>
          <LibraryCount id="publicationCount" field="publicationCount" />
        </LibraryToggle>
        <LibraryGroup id="publicationLists" className="library-publication-groups" field="publicationsOpen">
          <section className="library-platform-group" id="telegramLibrarySection" aria-labelledby="telegramLibraryTitle">
            <h3 id="telegramLibraryTitle">Telegram</h3>
            <LibrarySection id="telegramList" field="telegram" />
          </section>
          <section className="library-platform-group" id="telegraphLibrarySection" aria-labelledby="telegraphLibraryTitle">
            <h3 id="telegraphLibraryTitle">Telegraph</h3>
            <LibrarySection id="telegraphList" field="telegraph" />
          </section>
        </LibraryGroup>
        <div className="menu-divider" role="separator" />
        <LibraryToggle icon="sticky_note_2" id="draftToggle" field="draftsOpen" aria-controls="draftLists">
          <span id="draftLibraryTitle" className="menu-label">Rascunhos</span>
          <LibraryCount id="draftCount" field="draftCount" />
        </LibraryToggle>
        <LibraryGroup id="draftLists" className="library-draft-groups" field="draftsOpen">
          <LibrarySection id="draftList" field="drafts" aria-labelledby="draftLibraryTitle" />
        </LibraryGroup>
      </div>
    </GlassContextMenu>
  );
}

// Aviso efêmero: o texto e a visibilidade vêm do estado (setToast). Só o texto
// e a classe "on" mudam; o vidro (ToastMaterial) não volta a renderizar.
function ToastText() {
  return useUI(state => state.toast.text);
}

const ToastMaterial = React.memo(function ToastMaterial() {
  return (
    <Glass optics={NOTICE_LENS} className="toast-material">
      <span className="toast-content" id="toastTextHost"><ToastText /></span>
    </Glass>
  );
});

function Toast() {
  const visible = useUI(state => state.toast.visible);
  return (
    <div className={visible ? "toast on" : "toast"} id="toast" role="status" aria-live="polite" aria-atomic="true">
      <ToastMaterial />
    </div>
  );
}

// Controles da barra que refletem estado: cada um assina só o que usa, e o
// Chrome (com os vidros das barras) nunca volta a renderizar.
// O seletor de plataforma é uma escolha efêmera: só alterna entre Telegram e
// Telegraph (o logotipo mostra o destino atual). Não tem estado "ligado" nem
// pill selecionado persistente; o retorno é só o da pressão (:active).
function DestButton() {
  const dest = useUI(state => state.dest);
  const destName = dest === "telegram" ? "Telegram" : "Telegraph";
  return (
    <button
      type="button"
      id="destBtn"
      data-dest={dest}
      aria-label={"Alternar destino. Atual: " + destName}
      title={"Destino: " + destName}
    >
      <Icon name={dest === "telegram" ? "telegram" : "telegraph"} />
    </button>
  );
}

const EXPORT_LABEL = "Abrir menu de publicação, exportação e biblioteca";

function ExportButton() {
  const expanded = useAnchorExpanded("exportBtn");
  return (
    <button type="button" className="export" id="exportBtn" aria-label={EXPORT_LABEL} title={EXPORT_LABEL} aria-expanded={expanded}>
      <span className="action-dot"><ChromeLens /><Icon name="menu" /></span>
    </button>
  );
}

function DismissLayer() {
  const menuOpen = useUI(state => Object.values(state.menus).some(menu => menu.open));
  return <div id="menuDismissLayer" className="menu-dismiss-layer" hidden={!menuOpen} aria-hidden="true" />;
}

function PlusButton() {
  const plusOpen = useUI(state => Object.entries(state.menus).some(([id, menu]) => menu.open && (id === "plusMenu" || id.startsWith("plus-"))));
  const expanded = useAnchorExpanded("plusBtn");
  return (
    <button type="button" className={plusOpen ? "more on" : "more"} id="plusBtn" aria-label="Mais opções" title="Mais opções" aria-haspopup="menu" aria-expanded={expanded}>
      <ChromeLens /><Icon name="plus" />
    </button>
  );
}

function AnchorButton({ id, icon, ...props }) {
  const expanded = useAnchorExpanded(id);
  return (
    <button type="button" id={id} aria-expanded={expanded} {...props}><Icon name={icon} /></button>
  );
}

function Chrome() {
  return (
    <>
      <header className="topbar">
        <div className="top-slot top-left">
          <GlassControl className="seg top-pill">
            <ChromeLens optics={BAR_REFRACTION} variant="bar" />
            <button type="button" className="strategic" id="undoBtn" aria-label="Desfazer" title="Desfazer">
              <span className="action-dot"><ChromeLens /><Icon name="undo" /></span>
            </button>
            <button type="button" id="redoBtn" aria-label="Refazer" title="Refazer"><Icon name="redo" /></button>
          </GlassControl>
        </div>

        <div className="top-center">
          <button type="button" className="theme-switch" id="themeBtn" aria-label="Ativar modo claro" title="Ativar modo claro">
            <span className="app-title">MDTXTRT</span>
            <Icon name="light_mode" />
          </button>
        </div>

        <div className="top-slot top-right">
          <GlassControl className="seg top-pill">
            <ChromeLens optics={BAR_REFRACTION} variant="bar" />
            <DestButton />
            <ExportButton />
          </GlassControl>
        </div>
      </header>

      <DismissLayer />
      <LinkMenu />
      <HeadingMenu />
      <ListMenu />
      <QuoteMenu />
      <ExportMenu />
      <LibrarySubmenu />
      <PlusMenu />
      <input id="fileInput" type="file" accept=".txt,.md,text/plain,text/markdown" hidden />
      <input id="mediaInput" type="file" accept="image/*,video/*,audio/*,.pdf,.zip" multiple hidden />
      <Toast />
      <DialogMenu />
      <FindMenu />

      <div className="bar-wrap">
        <GlassControl className="bar" id="typebar">
          <ChromeLens optics={BAR_REFRACTION} variant="bar" />
          <PlusButton />
          <button type="button" data-cmd="bold" aria-label="Negrito"><Icon name="bold" /></button>
          <button type="button" data-cmd="italic" aria-label="Itálico"><Icon name="italic" /></button>
          <button type="button" data-cmd="underline" aria-label="Sublinhado"><Icon name="underline" /></button>
          <AnchorButton id="linkBtn" icon="link" aria-label="Link" />
          <AnchorButton id="headingBtn" icon="heading" aria-label="Título" aria-haspopup="menu" />
          <AnchorButton id="listBtn" icon="list" aria-label="Lista" aria-haspopup="menu" />
          <AnchorButton id="quoteBtn" icon="quote" aria-label="Citação" aria-haspopup="menu" />
        </GlassControl>
      </div>
    </>
  );
}

// Monta a interface e expõe o estado para app.js (window.MDTXTRT_UI).
export function mountChrome(rootNode) {
  if (!rootNode) throw new Error("Raiz da interface ausente");
  const root = createRoot(rootNode);
  flushSync(() => root.render(<Chrome />));
  window.MDTXTRT_UI = uiStore;
  return root;
}
