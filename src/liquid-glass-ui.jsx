import React from "react";
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

const BAR_LENS = {
  sheen: 0,
  glow: 0,
};

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
  popover = "auto",
  anchorId,
  placement = "auto",
  ...props
}) {
  return (
    <div
      id={id}
      popover={popover}
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
    <GlassContextMenu id="exportMenu" className="wide-menu" anchorId="exportBtn" placement="auto">
      <p className="hint">Exporte um arquivo ou publique no destino selecionado.</p>
      <div className="menu-list">
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
          <input id="docName" defaultValue="Ideia" aria-label="Nome do documento" maxLength={120} />
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

function Toast() {
  return (
    <div className="toast" id="toast" role="status" aria-live="polite" aria-atomic="true">
      <Glass optics={MENU_LENS} className="toast-material">
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
              <span className="action-dot"><Icon name="export" /></span>
            </button>
          </GlassControl>
        </div>
      </header>

      <HeadingMenu />
      <ListMenu />
      <QuoteMenu />
      <ExportMenu />
      <PlusMenu />
      <input id="fileInput" type="file" accept=".txt,.md,text/plain,text/markdown" hidden />
      <input id="mediaInput" type="file" accept="image/*,video/*,audio/*,.pdf,.zip" hidden />
      <Toast />
      <DialogMenu />
      <FindMenu />

      <div className="bar-wrap">
        <GlassControl className="bar" id="typebar">
          <button type="button" className="more" id="plusBtn" aria-label="Mais opções" title="Mais opções" popoverTarget="plusMenu"><Icon name="plus" /></button>
          <button type="button" data-cmd="bold" aria-label="Negrito"><Icon name="bold" /></button>
          <button type="button" data-cmd="italic" aria-label="Itálico"><Icon name="italic" /></button>
          <button type="button" data-cmd="underline" aria-label="Sublinhado"><Icon name="underline" /></button>
          <button type="button" id="linkBtn" aria-label="Link"><Icon name="link" /></button>
          <button type="button" id="headingBtn" aria-label="Título" popoverTarget="headingMenu"><Icon name="heading" /></button>
          <button type="button" id="listBtn" aria-label="Lista" popoverTarget="listMenu"><Icon name="list" /></button>
          <button type="button" id="quoteBtn" aria-label="Citação" popoverTarget="quoteMenu"><Icon name="quote" /></button>
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
