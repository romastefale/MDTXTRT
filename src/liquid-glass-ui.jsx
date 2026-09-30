import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Glass } from "@samasante/liquid-glass";

/**
 * Component architecture copied and adapted from:
 * https://github.com/romastefale/liquid-glass/blob/main/examples/GlassContextMenu.tsx
 *
 * Optical rendering is provided exclusively by @samasante/liquid-glass.
 * MDTXTRT owns only this application-specific React shell.
 */
// Normativa do fork (src/GlassMaterial.tsx › MATERIAL_OPTICS) e do site
// romastefale/HTML (src/lib/optics.ts): as barras e o toast usam o frost do
// material (6px, saturate 1.15); menus e diálogos, o de painel de leitura (22px,
// saturate 1.4). specular 0 desliga a borda da biblioteca: o brilho de topo e o
// aro hairline uniforme vêm do CSS (index.html), finos em telas 2x.
const NO_SHINE = { specular: 0, sheen: 0, glow: 0 };

export const MENU_LENS = {
  ...NO_SHINE,
  frost: 22,
  saturate: 1.4,
};

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
      backdrop.img = img;
      backdrop.src = src;
      backdrop.key = "";
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}
function paintFade(ctx, rect, bgRect, edge, down) {
  if (!rect || !rect.height) return;
  const top = rect.top - bgRect.top;
  const g = ctx.createLinearGradient(0, down ? top : top + rect.height, 0, down ? top + rect.height : top);
  const alpha = a => `color-mix(in srgb, ${edge} ${a}%, transparent)`;
  const stops = [[0, 100], [Math.min(0.2, 12 / rect.height), 100], [0.52, 60], [0.76, 26], [1, 0]];
  for (const [at, a] of stops) {
    try { g.addColorStop(at, alpha(a)); } catch { g.addColorStop(at, a > 0 ? edge : "transparent"); }
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, top, bgRect.width, rect.height);
}
function backdropCanvas(bgRect) {
  const fadeTop = document.querySelector(".fade-top")?.getBoundingClientRect();
  const fadeBot = document.querySelector(".fade-bot")?.getBoundingClientRect();
  const w = Math.max(1, Math.round(bgRect.width));
  const h = Math.max(1, Math.round(bgRect.height));
  const key = [backdrop.src, w, h, fadeTop?.height, fadeBot?.top].join("|");
  if (backdrop.canvas && backdrop.key === key) return backdrop.canvas;
  const canvas = backdrop.canvas || document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const edge = getComputedStyle(document.documentElement).getPropertyValue("--edge").trim() || "#1b1646";
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(backdrop.img, 0, 0, w, h);
  paintFade(ctx, fadeTop, bgRect, edge, false);
  paintFade(ctx, fadeBot, bgRect, edge, true);
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
function ChromeLens() {
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
    const viewport = window.visualViewport;
    window.addEventListener("resize", wake);
    viewport?.addEventListener("resize", wake);
    viewport?.addEventListener("scroll", wake);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
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
      className="lens"
      aria-hidden="true"
      data-live={live ? "" : undefined}
      data-frozen={frozen ? "" : undefined}
    >
      <canvas ref={snapRef} />
      {live && lenses.length > 0 && (
        <Glass
          className="lens-surface"
          draw={draw}
          optics={CHROME_LENS}
          lenses={lenses}
          maxDpr={2}
          style={{ position: "absolute", inset: 0 }}
        />
      )}
    </span>
  );
}

const MENU_RADIUS = 9;

function Icon({ name }) {
  return <span className="ui-icon" data-icon={name} aria-hidden="true" />;
}

function MenuItem({ icon, className = "", children, ...props }) {
  return (
    <button type="button" className={className} {...props}>
      <span className="sheet-ico"><Icon name={icon} /></span>
      {children}
    </button>
  );
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
  return (
    <div
      id={id}
      popover={popover || undefined}
      data-menu-surface={popover ? undefined : ""}
      data-anchor={anchorId}
      data-placement={placement}
      className={`glass-menu ${className}`.trim()}
      {...props}
    >
      <Glass
        optics={MENU_LENS}
        className="glass-menu-material"
        style={{ display: "block", width: "100%" }}
      >
        <div className="glass-menu-content">{children}</div>
      </Glass>
    </div>
  );
}

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
        <MenuItem icon="h1" className="h-opt h1" data-block="h1">Título H1</MenuItem>
        <MenuItem icon="h2" className="h-opt h2" data-block="h2">Título H2</MenuItem>
        <MenuItem icon="h3" className="h-opt h3" data-block="h3">Título H3</MenuItem>
        <MenuItem icon="h4" className="h-opt h4" data-block="h4">Título H4</MenuItem>
        <MenuItem icon="h5" className="h-opt h5" data-block="h5">Título H5</MenuItem>
        <MenuItem icon="h6" className="h-opt h6" data-block="h6">Título H6</MenuItem>
        <MenuItem icon="paragraph" data-block="p">Corpo</MenuItem>
        <MenuItem icon="footer" className="h-opt footer" data-block="footer">Rodapé</MenuItem>
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
        <MenuItem icon="quote" data-block="blockquote">Citação</MenuItem>
        <MenuItem icon="pullquote" data-insert="pullquote">Citação em destaque</MenuItem>
        <MenuItem icon="expandquote" data-insert="expandquote">Citação expansível</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

function ExportMenu() {
  return (
    <GlassContextMenu id="exportMenu" className="wide-menu export-menu" anchorId="exportBtn" placement="auto">
      <div className="menu-list">
        <MenuItem icon="file" id="libraryBtn">Rascunhos e publicações</MenuItem>
        <div className="menu-divider" role="separator" />
        <MenuItem icon="telegram" id="openAppBtn"><span id="openAppLabel">Publicar no Telegram</span></MenuItem>
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
      <div className="dialog">
        <div className="dialog-label" id="dialogLabel" />
        <textarea id="dialogInput" rows={1} spellCheck={false} aria-labelledby="dialogLabel" />
        <div className="dialog-actions">
          <button type="button" id="dialogCancel">Cancelar</button>
          <button type="button" id="dialogOk">OK</button>
        </div>
      </div>
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
        <div id="libraryStatus" className="library-status" role="status" aria-live="polite" />
        <MenuItem
          icon="file"
          id="publicationToggle"
          className="library-section-toggle"
          aria-expanded="false"
          aria-controls="publicationLists"
        >
          <span id="publicationLibraryTitle" className="menu-label">Publicações</span>
          <span id="publicationCount" className="library-section-count">0</span>
          <span className="menu-chevron"><Icon name="chevron_right" /></span>
        </MenuItem>
        <div id="publicationLists" className="library-publication-groups" hidden>
          <section className="library-platform-group" id="telegramLibrarySection" aria-labelledby="telegramLibraryTitle">
            <h3 id="telegramLibraryTitle">Telegram</h3>
            <div id="telegramList" className="library-list" />
          </section>
          <section className="library-platform-group" id="telegraphLibrarySection" aria-labelledby="telegraphLibraryTitle">
            <h3 id="telegraphLibraryTitle">Telegraph</h3>
            <div id="telegraphList" className="library-list" />
          </section>
        </div>
        <div className="menu-divider" role="separator" />
        <MenuItem
          icon="sticky_note_2"
          id="draftToggle"
          className="library-section-toggle"
          aria-expanded="false"
          aria-controls="draftLists"
        >
          <span id="draftLibraryTitle" className="menu-label">Rascunhos</span>
          <span id="draftCount" className="library-section-count">0</span>
          <span className="menu-chevron"><Icon name="chevron_right" /></span>
        </MenuItem>
        <div id="draftLists" className="library-draft-groups" hidden>
          <div id="draftList" className="library-list" aria-labelledby="draftLibraryTitle" />
        </div>
      </div>
    </GlassContextMenu>
  );
}

function Toast() {
  return (
    <div className="toast" id="toast" role="status" aria-live="polite" aria-atomic="true">
      <Glass optics={BAR_LENS} className="toast-material">
        <span className="toast-content" id="toastTextHost" />
      </Glass>
    </div>
  );
}

function Chrome() {
  return (
    <>
      <header className="topbar">
        <div className="top-slot top-left">
          <GlassControl className="seg top-pill">
            <button type="button" id="undoBtn" aria-label="Desfazer" title="Desfazer"><Icon name="undo" /></button>
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
            <button type="button" id="destBtn" aria-label="Destino: Telegram" title="Destino: Telegram"><Icon name="telegram" /></button>
            <button type="button" className="export" id="exportBtn" aria-label="Publicar ou exportar" title="Publicar ou exportar">
              <span className="action-dot"><ChromeLens /><Icon name="menu" /></span>
            </button>
          </GlassControl>
        </div>
      </header>

      <div id="menuDismissLayer" className="menu-dismiss-layer" hidden aria-hidden="true" />
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
          <button type="button" className="more" id="plusBtn" aria-label="Mais opções" title="Mais opções" aria-haspopup="menu"><ChromeLens /><Icon name="plus" /></button>
          <button type="button" data-cmd="bold" aria-label="Negrito"><Icon name="bold" /></button>
          <button type="button" data-cmd="italic" aria-label="Itálico"><Icon name="italic" /></button>
          <button type="button" data-cmd="underline" aria-label="Sublinhado"><Icon name="underline" /></button>
          <button type="button" id="linkBtn" aria-label="Link"><Icon name="link" /></button>
          <button type="button" id="headingBtn" aria-label="Título" aria-haspopup="menu"><Icon name="heading" /></button>
          <button type="button" id="listBtn" aria-label="Lista" aria-haspopup="menu"><Icon name="list" /></button>
          <button type="button" id="quoteBtn" aria-label="Citação" aria-haspopup="menu"><Icon name="quote" /></button>
        </GlassControl>
      </div>
    </>
  );
}

const rootNode = document.getElementById("ux-root");
if (!rootNode) throw new Error("Raiz da interface ausente");
const root = createRoot(rootNode);
flushSync(() => root.render(<Chrome />));

await import("../app.js");
