import React, { useLayoutEffect, useRef, useState } from "react";
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

function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

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

export function GlassContextMenu({ id, children, className = "", popover = "auto", ...props }) {
  const [ref, { w, h }] = useSize();
  return (
    <div
      ref={ref}
      id={id}
      popover={popover}
      className={`glass-menu ${className}`.trim()}
      {...props}
    >
      {w > 0 && h > 0 && (
        <Glass
          aria-hidden="true"
          optics={MENU_LENS}
          brightnessInFilter
          width={w}
          height={h}
          radius={MENU_RADIUS}
          className="glass-menu-lens"
        />
      )}
      <div className="glass-menu-content">{children}</div>
    </div>
  );
}

function GlassControl({ className = "", children, ...props }) {
  return (
    <Glass optics={MENU_LENS} className={className} {...props}>
      {children}
    </Glass>
  );
}

function HeadingMenu() {
  return (
    <GlassContextMenu id="headingMenu" className="heading-menu">
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
    <GlassContextMenu id="listMenu">
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
    <GlassContextMenu id="quoteMenu">
      <div className="menu-list">
        <MenuItem icon="quote" data-block="blockquote">Citação</MenuItem>
        <MenuItem icon="pullquote" data-insert="pullquote">Citação em destaque</MenuItem>
        <MenuItem icon="expandquote" data-insert="expandquote">Citação expansível</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

function ImportMenu() {
  return (
    <GlassContextMenu id="importMenu" className="wide-menu">
      <div className="tools">
        <input id="docName" defaultValue="Ideia" aria-label="Nome do documento" maxLength={120} />
      </div>
      <div className="menu-list">
        <MenuItem icon="markdown" id="importMdBtn">Importar Markdown</MenuItem>
        <MenuItem icon="text_fields" id="importTxtBtn">Importar TXT</MenuItem>
        <MenuItem icon="search" id="findBtn">Localizar e substituir</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

function ExportMenu() {
  return (
    <GlassContextMenu id="exportMenu" className="wide-menu">
      <p className="hint">Exporte um arquivo ou publique no destino selecionado.</p>
      <div className="menu-list">
        <MenuItem icon="telegram" id="openAppBtn"><span id="openAppLabel">Publicar no Telegram</span></MenuItem>
        <MenuItem icon="markdown" id="exportMdBtn">Baixar Markdown</MenuItem>
        <MenuItem icon="text_fields" id="exportTxtBtn">Baixar TXT</MenuItem>
      </div>
    </GlassContextMenu>
  );
}

const extraItems = [
  ["strikethrough_s", "Riscado", { "data-cmd": "strike" }],
  ["ink_highlighter", "Marca-texto", { "data-cmd": "mark", "data-telegram-only": "" }],
  ["visibility_off", "Spoiler", { "data-cmd": "spoiler", "data-telegram-only": "" }],
  ["code", "Código", { "data-cmd": "code" }],
  ["subscript", "Subscrito", { "data-cmd": "sub", "data-telegram-only": "" }],
  ["superscript", "Sobrescrito", { "data-cmd": "sup", "data-telegram-only": "" }],
  ["functions", "Fórmula inline", { "data-cmd": "math", "data-telegram-only": "" }],
  ["calculate", "Fórmula em bloco", { "data-insert": "mathblock", "data-telegram-only": "" }],
  ["horizontal_rule", "Divisor", { "data-insert": "divider" }],
  ["table", "Tabela", { "data-insert": "table", "data-telegram-only": "" }],
  ["details", "Conteúdo expansível", { "data-insert": "details", "data-telegram-only": "" }],
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
  ["anchor", "Âncora", { "data-insert": "anchor", "data-telegram-only": "" }],
  ["sticky_note_2", "Referência", { "data-insert": "reference", "data-telegram-only": "" }],
  ["schedule", "Data e hora", { "data-insert": "time", "data-telegram-only": "" }],
  ["mood", "Emoji personalizado", { "data-insert": "emoji", "data-telegram-only": "" }],
  ["buttons", "Botão", { "data-insert": "button", "data-telegram-only": "" }],
];

function PlusMenu() {
  return (
    <GlassContextMenu id="plusMenu" className="wide-menu">
      <div className="menu-list">
        {extraItems.map(([icon, label, props]) => (
          <MenuItem key={label} icon={icon} {...props}>{label}</MenuItem>
        ))}
      </div>
    </GlassContextMenu>
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
    <GlassContextMenu id="findMenu" className="find-menu wide-menu">
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

function Toast() {
  const [ref, { w, h }] = useSize();
  return (
    <div ref={ref} className="toast" id="toast" role="status" aria-live="polite" aria-atomic="true">
      {w > 0 && h > 0 && (
        <Glass
          aria-hidden="true"
          optics={MENU_LENS}
          brightnessInFilter
          width={w}
          height={h}
          radius={MENU_RADIUS}
          className="glass-menu-lens"
        />
      )}
      <span className="toast-content" id="toastTextHost" />
    </div>
  );
}

function Chrome() {
  return (
    <>
      <div className="chrome-top">
        <header className="topbar">
          <GlassControl className="brand-glass">
            <button type="button" className="brand" id="brandBtn" popoverTarget="importMenu">MDTXTRT</button>
          </GlassControl>
        </header>
        <div className="meta">
          <GlassControl className="seg">
            <button type="button" id="undoBtn" aria-label="Desfazer"><Icon name="undo" /></button>
            <button type="button" id="redoBtn" aria-label="Refazer"><Icon name="redo" /></button>
          </GlassControl>
          <GlassControl className="seg">
            <button type="button" id="destBtn" aria-label="Destino: Telegram" title="Destino: Telegram"><Icon name="telegram" /></button>
            <button type="button" className="export" id="exportBtn" aria-label="Exportar" title="Exportar">
              <span className="action-dot"><Icon name="export" /></span>
            </button>
          </GlassControl>
        </div>
      </div>

      <HeadingMenu />
      <ListMenu />
      <QuoteMenu />
      <ImportMenu />
      <ExportMenu />
      <PlusMenu />
      <input id="fileInput" type="file" accept=".txt,.md,text/plain,text/markdown" hidden />
      <input id="mediaInput" type="file" accept="image/*,video/*,audio/*,.pdf,.zip" hidden />
      <Toast />
      <DialogMenu />
      <FindMenu />

      <div className="bar-wrap">
        <GlassControl className="bar" id="typebar">
          <button type="button" className="plus" id="plusBtn" aria-label="Mais" popoverTarget="plusMenu"><Icon name="plus" /></button>
          <button type="button" data-cmd="bold" aria-label="Negrito"><Icon name="bold" /></button>
          <button type="button" data-cmd="italic" aria-label="Itálico"><Icon name="italic" /></button>
          <button type="button" data-cmd="underline" aria-label="Sublinhado"><Icon name="underline" /></button>
          <button type="button" id="quoteBtn" aria-label="Citação" popoverTarget="quoteMenu"><Icon name="quote" /></button>
          <button type="button" id="linkBtn" aria-label="Link"><Icon name="link" /></button>
          <button type="button" id="headingBtn" aria-label="Título" popoverTarget="headingMenu"><Icon name="heading" /></button>
          <button type="button" id="listBtn" aria-label="Lista" popoverTarget="listMenu"><Icon name="list" /></button>
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
