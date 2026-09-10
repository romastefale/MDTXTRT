const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const editor = $("#editor");
const statusEl = $("#status");
const nameEl = $("#draft-name");
const initData = tg?.initData || "";
const state = {
  draft: null,
  lastSaved: "",
  saveTimer: null,
  sessionTimer: null,
  pendingInline: new Map(),
  editingPublication: null,
  archivedView: false,
  reviewAction: null,
  pendingMediaKind: null,
  pendingLocationRequest: sessionStorage.getItem("mdtxtrt:location-request") || null,
};

const uid = () => crypto.randomUUID();
const enc = new TextEncoder();
const deepClone = value => JSON.parse(JSON.stringify(value));
const domNodeIds = new WeakMap();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function setStatus(text) { statusEl.textContent = text; }
function closeMenus() { $$(".toolbar details[open]").forEach(x => x.removeAttribute("open")); }
function currentUserHeader() { return {"X-Telegram-Init-Data": initData}; }

async function api(path, options = {}) {
  const headers = {...currentUserHeader(), ...(options.headers || {})};
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, {...options, headers});
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function showMessage(title, body) {
  $("#message-title").textContent = title;
  $("#message-body").textContent = body;
  $("#message-dialog").showModal();
}

function node(kind, {text = null, attrs = {}, children = []} = {}) {
  return {id: uid(), kind, text, attrs, children};
}

function textNode(text) { return node("text", {text}); }

function rememberDomNodeId(dom, preferred = null) {
  let id = domNodeIds.get(dom);
  if (!id) {
    id = preferred || uid();
    domNodeIds.set(dom, id);
  }
  return id;
}

function renderTextNode(n) {
  const dom = document.createTextNode(n?.text || "");
  rememberDomNodeId(dom, n?.id || uid());
  return dom;
}

function serializedTextNode(dom, text) {
  return {id: rememberDomNodeId(dom), kind: "text", text, attrs: {}, children: []};
}

const inlineTags = {
  bold: "strong", italic: "em", underline: "u", strikethrough: "s",
  marked: "mark", subscript: "sub", superscript: "sup", code: "code",
};

function renderInline(n) {
  if (!n || n.kind === "text" || n.kind === "plain") return renderTextNode(n || textNode(""));
  let el;
  if (inlineTags[n.kind]) el = document.createElement(inlineTags[n.kind]);
  else if (["url","link","text_mention","anchor_link","reference_link"].includes(n.kind)) {
    el = document.createElement("a");
    if (n.kind === "url" || n.kind === "link") el.href = n.attrs?.url || "#";
    else if (n.kind === "text_mention") el.href = `tg://user?id=${n.attrs?.user_id || ""}`;
    else el.href = `#${n.attrs?.name || ""}`;
  } else {
    el = document.createElement("span");
  }
  el.dataset.inline = n.kind;
  el.dataset.nodeId = n.id || uid();
  el.__attrs = deepClone(n.attrs || {});
  if (n.kind === "spoiler") el.dataset.inline = "spoiler";
  if (n.kind === "math_inline" || n.kind === "mathematical_expression") {
    el.textContent = n.text || "";
    el.title = "Fórmula LaTeX";
    return el;
  }
  const children = n.children?.length ? n.children : [textNode(n.text || "")];
  children.forEach(child => el.append(renderInline(child)));
  return el;
}

const simpleBlockKinds = new Set([
  "paragraph","heading","code_block","footer","blockquote","expandable_blockquote","pullquote"
]);

function blockElement(n) {
  let tag = "p";
  if (n.kind === "heading") tag = `h${Math.min(6, Math.max(1, Number(n.attrs?.level || 1)))}`;
  else if (n.kind === "code_block") tag = "pre";
  else if (["blockquote","expandable_blockquote"].includes(n.kind)) tag = "blockquote";
  else if (n.kind === "pullquote") tag = "aside";
  else if (n.kind === "footer") tag = "footer";
  const el = document.createElement(tag);
  el.dataset.block = n.id || uid();
  el.dataset.kind = n.kind;
  el.__attrs = deepClone(n.attrs || {});
  if (n.kind === "code_block") el.textContent = n.text || n.children?.map(plainNode).join("") || "";
  else if (n.children?.length) n.children.forEach(child => el.append(renderInline(child)));
  else if (n.text) el.append(renderTextNode(textNode(n.text)));
  return el;
}

function plainNode(n) {
  if (!n) return "";
  if (n.children?.length) return n.children.map(plainNode).join("");
  return n.text || "";
}

function nodeSummary(n) {
  if (n.kind === "divider") return "Divisor horizontal";
  if (n.kind === "map") return `${n.attrs?.name || "Mapa"}: ${n.attrs?.lat || "?"}, ${n.attrs?.long || "?"}`;
  if (["photo","video","audio","voice_note","animation","document"].includes(n.kind)) return n.attrs?.caption || n.attrs?.filename || n.attrs?.src || n.kind;
  if (n.kind === "list") return `${n.children?.length || 0} itens`;
  if (n.kind === "table") return `${n.children?.length || 0} linhas`;
  if (n.kind === "details") return n.attrs?.summary || "Detalhes";
  if (n.kind === "math_block") return n.text || "Fórmula";
  if (n.kind === "anchor" || n.kind === "reference") return n.attrs?.name || n.kind;
  if (n.kind === "button_row") return `${n.children?.length || 0} botões — ${n.attrs?.align || "padrão"}`;
  if (["collage","slideshow"].includes(n.kind)) return `${n.children?.length || 0} mídias`;
  if (n.kind === "raw_markdown") return (n.text || "Markdown cru").slice(0, 90);
  return plainNode(n).slice(0, 90) || n.kind;
}

const labels = {
  divider:"Divisor",list:"Lista",table:"Tabela",details:"Detalhes",math_block:"Fórmula",
  anchor:"Âncora",reference:"Referência",map:"Mapa",photo:"Foto",video:"Vídeo",
  animation:"Animação",audio:"Áudio",voice_note:"Mensagem de voz",document:"Documento",
  collage:"Collage",slideshow:"Slideshow",button_row:"Linha de botões",raw_markdown:"Markdown cru",
};

function cardElement(n) {
  const el = document.createElement("div");
  el.className = "node-card";
  el.contentEditable = "false";
  el.dataset.block = n.id || uid();
  el.dataset.kind = n.kind;
  el.__node = deepClone({...n, id: n.id || el.dataset.block});
  const title = document.createElement("strong");
  title.textContent = labels[n.kind] || n.kind;
  const summary = document.createElement("span");
  summary.className = "summary";
  summary.textContent = nodeSummary(n);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Editar";
  edit.addEventListener("click", () => editStructuredCard(el));
  el.append(title, summary, edit);
  return el;
}

function renderBlock(n) {
  return simpleBlockKinds.has(n.kind) ? blockElement(n) : cardElement(n);
}

function renderDocument(doc) {
  editor.replaceChildren();
  (doc?.blocks || []).forEach(b => editor.append(renderBlock(b)));
  if (!editor.children.length) editor.append(blockElement(node("paragraph")));
}

function elementInlineKind(el) {
  return el.dataset?.inline || ({STRONG:"bold",B:"bold",EM:"italic",I:"italic",U:"underline",S:"strikethrough",STRIKE:"strikethrough",DEL:"strikethrough",MARK:"marked",SUB:"subscript",SUP:"superscript",CODE:"code",A:"url"}[el.tagName]);
}

function serializeInline(root) {
  const out = [];
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.nodeValue) out.push(serializedTextNode(child, child.nodeValue));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (child.tagName === "BR") { out.push(serializedTextNode(child, "\n")); continue; }
    const kind = elementInlineKind(child) || "text";
    if (kind === "text") {
      out.push({id: child.dataset?.nodeId || rememberDomNodeId(child), kind: "text", text: child.textContent || "", attrs: {}, children: []});
      continue;
    }
    const attrs = deepClone(child.__attrs || {});
    if (kind === "url" && child.tagName === "A") attrs.url = attrs.url || child.getAttribute("href") || "";
    const n = {id: child.dataset.nodeId || uid(), kind, text: null, attrs, children: []};
    if (["math_inline","mathematical_expression"].includes(kind)) n.text = child.textContent || "";
    else n.children = serializeInline(child);
    out.push(n);
  }
  return out;
}

function serializeBlock(el) {
  if (el.__node) return deepClone(el.__node);
  const kind = el.dataset.kind || "paragraph";
  const attrs = deepClone(el.__attrs || {});
  if (kind === "heading") attrs.level = Number(el.tagName.slice(1)) || attrs.level || 1;
  const result = {id: el.dataset.block || uid(), kind, text: null, attrs, children: []};
  if (kind === "code_block") result.text = el.textContent || "";
  else result.children = serializeInline(el);
  return result;
}

function normalizeTopLevel() {
  [...editor.childNodes].forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!child.nodeValue?.trim()) return;
      const p = blockElement(node("paragraph", {text: child.nodeValue}));
      editor.replaceChild(p, child);
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    if (!child.dataset.block) child.dataset.block = uid();
    if (!child.dataset.kind) {
      if (/^H[1-6]$/.test(child.tagName)) { child.dataset.kind = "heading"; child.__attrs = {level:Number(child.tagName[1])}; }
      else if (child.tagName === "PRE") child.dataset.kind = "code_block";
      else if (child.tagName === "BLOCKQUOTE") child.dataset.kind = "blockquote";
      else child.dataset.kind = "paragraph";
    }
  });
}

function canonicalDocument() {
  normalizeTopLevel();
  return {
    schema_version: state.draft?.document?.schema_version || 1,
    id: state.draft?.document?.id || uid(),
    blocks: [...editor.children].map(serializeBlock),
    metadata: deepClone(state.draft?.document?.metadata || {}),
  };
}

function mirrorKey() { return state.draft ? `mdtxtrt:mirror:${state.draft.id}` : null; }
function saveMirror() {
  if (!state.draft) return;
  const payload = {revision_id: state.draft.active_revision_id, document: canonicalDocument(), saved_at: Date.now()};
  localStorage.setItem(mirrorKey(), JSON.stringify(payload));
}

function scheduleSave() {
  if (!state.draft) return;
  setStatus("editando");
  saveMirror();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => commitNow("typing-pause"), 2000);
}

async function commitNow(reason = "edit") {
  if (!state.draft) return;
  clearTimeout(state.saveTimer);
  const document = canonicalDocument();
  const snapshot = JSON.stringify(document);
  if (snapshot === state.lastSaved) { setStatus("salvo"); return; }
  setStatus("salvando…");
  try {
    const data = await api(`/api/drafts/${state.draft.id}/revisions`, {method:"POST", body:{document, reason}});
    state.draft = data.draft;
    state.lastSaved = JSON.stringify(state.draft.document);
    saveMirror();
    setStatus("salvo");
  } catch (error) {
    setStatus("não salvo");
    showMessage("Falha ao salvar", error.message);
  }
}

function activeBlock() {
  const sel = window.getSelection();
  const start = sel?.anchorNode?.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel?.anchorNode?.parentElement;
  return start?.closest?.("[data-block]") || null;
}

function pathWithin(root, target) {
  const path = [];
  let current = target;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) return null;
    const index = [...parent.childNodes].indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function nodeAtPath(root, path) {
  let current = root;
  for (const index of path || []) {
    current = current?.childNodes?.[index];
    if (!current) return null;
  }
  return current;
}

function selectionSnapshot() {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  const startBlock = startElement?.closest?.("[data-block]");
  const endBlock = endElement?.closest?.("[data-block]");
  if (!startBlock || startBlock !== endBlock || startBlock.__node) return null;
  const startPath = pathWithin(startBlock, range.startContainer);
  const endPath = pathWithin(startBlock, range.endContainer);
  if (!startPath || !endPath) return null;
  return {
    block_id: startBlock.dataset.block,
    start_path: startPath,
    start_offset: range.startOffset,
    end_path: endPath,
    end_offset: range.endOffset,
  };
}

function safeOffset(target, offset) {
  if (!target) return 0;
  const limit = target.nodeType === Node.TEXT_NODE ? (target.nodeValue?.length || 0) : target.childNodes.length;
  return Math.min(Math.max(Number(offset) || 0, 0), limit);
}

function restoreSelection(session) {
  const saved = session?.selection;
  const blockId = saved?.block_id || session?.active_block_id;
  if (!blockId) return;
  const block = [...editor.querySelectorAll("[data-block]")].find(el => el.dataset.block === blockId);
  if (!block || block.__node) return;
  if (!saved) {
    block.focus();
    return;
  }
  const start = nodeAtPath(block, saved.start_path);
  const end = nodeAtPath(block, saved.end_path);
  if (!start || !end) {
    block.focus();
    return;
  }
  try {
    const range = document.createRange();
    range.setStart(start, safeOffset(start, saved.start_offset));
    range.setEnd(end, safeOffset(end, saved.end_offset));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {
    block.focus();
  }
}

async function saveSession() {
  if (!state.draft) return;
  await commitNow("checkpoint");
  try {
    await api(`/api/drafts/${state.draft.id}/session`, {
      method:"PUT",
      body:{
        revision_id:state.draft.active_revision_id,
        scroll_top:window.scrollY,
        active_block_id:activeBlock()?.dataset.block || null,
        selection:selectionSnapshot(),
      }
    });
  } catch (_) {}
}

function updateMarkButtons() {
  $$('[data-format]').forEach(button => button.classList.toggle("active", state.pendingInline.has(button.dataset.format)));
}

function wrapSelection(kind, attrs = {}, explicitText = null) {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  const startBlock = startEl?.closest?.("[data-block]");
  const endBlock = endEl?.closest?.("[data-block]");
  if (!startBlock || startBlock !== endBlock || startBlock.__node) {
    showMessage("Seleção", "A formatação inline deve permanecer dentro do mesmo bloco de texto.");
    return;
  }
  if (range.collapsed && explicitText === null) {
    if (state.pendingInline.has(kind)) state.pendingInline.delete(kind);
    else state.pendingInline.set(kind, attrs);
    updateMarkButtons();
    return;
  }
  const wrapper = document.createElement(inlineTags[kind] || (kind === "url" ? "a" : "span"));
  wrapper.dataset.inline = kind;
  wrapper.dataset.nodeId = uid();
  wrapper.__attrs = deepClone(attrs);
  if (kind === "url") wrapper.href = attrs.url || "#";
  if (kind === "spoiler") wrapper.dataset.inline = "spoiler";
  if (explicitText !== null) {
    range.deleteContents();
    const text = document.createTextNode(explicitText);
    rememberDomNodeId(text);
    wrapper.append(text);
  } else wrapper.append(range.extractContents());
  range.insertNode(wrapper);
  const after = document.createRange();
  after.selectNodeContents(wrapper);
  after.collapse(false);
  sel.removeAllRanges(); sel.addRange(after);
  scheduleSave();
}

function insertPendingText(event) {
  if (!state.pendingInline.size || event.inputType !== "insertText" || !event.data) return;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  const block = activeBlock();
  if (!block || block.__node) return;
  event.preventDefault();
  range.deleteContents();
  let leaf = document.createTextNode(event.data);
  rememberDomNodeId(leaf);
  let outer = leaf;
  for (const [kind, attrs] of [...state.pendingInline.entries()].reverse()) {
    const wrap = document.createElement(inlineTags[kind] || (kind === "url" ? "a" : "span"));
    wrap.dataset.inline = kind; wrap.dataset.nodeId = uid(); wrap.__attrs = deepClone(attrs);
    if (kind === "url") wrap.href = attrs.url || "#";
    wrap.append(outer); outer = wrap;
  }
  range.insertNode(outer);
  const caret = document.createRange();
  caret.setStart(leaf, leaf.nodeValue.length); caret.collapse(true);
  sel.removeAllRanges(); sel.addRange(caret);
  scheduleSave();
}

function replaceBlockKind(kind, level = null) {
  let old = activeBlock();
  if (!old || old.__node) {
    const n = node(kind, {attrs: level ? {level} : {}});
    editor.append(renderBlock(n)); scheduleSave(); return;
  }
  const current = serializeBlock(old);
  current.kind = kind;
  current.attrs = {...current.attrs, ...(level ? {level} : {})};
  if (kind === "code_block") { current.text = plainNode(current); current.children = []; }
  const replacement = renderBlock(current);
  old.replaceWith(replacement);
  const range = document.createRange(); range.selectNodeContents(replacement); range.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  scheduleSave();
}

function insertBlock(n, after = activeBlock()) {
  const el = renderBlock(n);
  if (after?.parentElement === editor) after.after(el); else editor.append(el);
  scheduleSave();
  return el;
}

const field = (name, label, type = "text", value = "", options = null) => ({name,label,type,value,options});

async function openForm(title, fields) {
  const dialog = $("#form-dialog"), form = $("#form"), box = $("#form-fields");
  $("#form-title").textContent = title;
  box.replaceChildren();
  for (const spec of fields) {
    const wrap = document.createElement("div");
    wrap.className = spec.type === "checkbox" ? "check" : "field";
    const label = document.createElement("label"); label.textContent = spec.label;
    let input;
    if (spec.type === "select") {
      input = document.createElement("select");
      (spec.options || []).forEach(([value,text]) => { const o=document.createElement("option");o.value=value;o.textContent=text;input.append(o); });
      input.value = spec.value ?? "";
    } else if (spec.type === "textarea") {
      input = document.createElement("textarea"); input.value = spec.value ?? "";
    } else {
      input = document.createElement("input"); input.type = spec.type; input.value = spec.type === "checkbox" ? "1" : (spec.value ?? "");
      if (spec.type === "checkbox") input.checked = Boolean(spec.value);
    }
    input.name = spec.name;
    if (spec.type === "checkbox") wrap.append(input,label); else wrap.append(label,input);
    box.append(wrap);
  }
  return new Promise(resolve => {
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      if (dialog.returnValue !== "save") return resolve(null);
      const values = {};
      for (const spec of fields) {
        const input = form.elements.namedItem(spec.name);
        values[spec.name] = spec.type === "checkbox" ? input.checked : input.value;
      }
      resolve(values);
    };
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

async function inlineForm(kind) {
  closeMenus();
  const sel = window.getSelection();
  const selected = sel?.rangeCount && !sel.getRangeAt(0).collapsed ? sel.getRangeAt(0).toString() : "";
  let fields = [];
  if (kind === "url") fields = [field("label","Texto","text",selected),field("url","URL","url","")];
  if (kind === "text_mention") fields = [field("label","Texto","text",selected),field("user_id","ID do usuário","text","")];
  if (kind === "custom_emoji") fields = [field("label","Emoji alternativo","text",selected || "🙂"),field("emoji_id","Custom emoji ID","text","")];
  if (kind === "datetime") fields = [field("label","Texto exibido","text",selected),field("unix","Unix time","number",""),field("format","Formato Telegram","text","wDT")];
  if (kind === "math_inline") fields = [field("expression","LaTeX","text",selected)];
  if (kind === "anchor_link") fields = [field("label","Texto","text",selected),field("name","Nome da âncora/referência","text","")];
  const v = await openForm("Formatação inline", fields);
  if (!v) return;
  if (kind === "math_inline") return wrapSelection(kind, {}, v.expression);
  const attrs = {};
  if (kind === "url") attrs.url = v.url;
  if (kind === "text_mention") attrs.user_id = v.user_id;
  if (kind === "custom_emoji") attrs.emoji_id = v.emoji_id;
  if (kind === "datetime") { attrs.unix = v.unix; attrs.format = v.format; }
  if (kind === "anchor_link") attrs.name = v.name;
  wrapSelection(kind, attrs, v.label || selected);
}

function parseListLines(text, preset) {
  return text.split(/\r?\n/).filter(x => x.trim()).map(line => {
    const match = line.match(/^\s*\[([ xX])\]\s*(.*)$/);
    return node("list_item", {attrs:{task:preset === "task",checked:Boolean(match && /x/i.test(match[1]))},children:[textNode(match ? match[2] : line)]});
  });
}

function listText(n) {
  return (n.children || []).map(item => `${item.attrs?.task ? `[${item.attrs?.checked ? "x":" "}] `:""}${plainNode(item)}`).join("\n");
}

function tableText(n) {
  return (n.children || []).map(row => (row.children || []).map(plainNode).join(" | ")).join("\n");
}

function mediaLines(n) {
  return (n.children || []).map(m => `${m.kind}|${m.attrs?.src || ""}`).join("\n");
}

function buttonLines(n) {
  return (n.children || []).map(b => {
    const type=b.attrs?.type||"url";
    const value=b.attrs?.url ?? b.attrs?.data ?? b.attrs?.query ?? b.attrs?.copy_text ?? "";
    return `${type}|${plainNode(b)}|${value}|${b.attrs?.style||""}`;
  }).join("\n");
}

function validateButtonNode(button) {
  const type = button.attrs?.type || "url";
  if (button.attrs?.style === "link" && type !== "callback_data") return "O estilo link só pode ser usado em botão callback_data.";
  if (type === "callback_data") {
    const size = enc.encode(button.attrs?.data || "").length;
    if (size < 1 || size > 64) return "callback_data deve ter de 1 a 64 bytes.";
  }
  return null;
}

async function buildStructured(kind, preset = "", existing = null) {
  let fields = [], v;
  if (kind === "list") {
    const p = preset || (existing?.attrs?.ordered ? "ordered" : existing?.children?.some(x=>x.attrs?.task) ? "task":"unordered");
    fields=[field("mode","Tipo","select",p,[["unordered","Marcadores"],["ordered","Numerada"],["task","Tarefas"]]),field("items","Um item por linha","textarea",existing?listText(existing):"")];
    v=await openForm("Lista",fields); if(!v)return null;
    return {...(existing||node("list")),kind:"list",attrs:{ordered:v.mode==="ordered"},children:parseListLines(v.items,v.mode)};
  }
  if (kind === "table") {
    fields=[field("caption","Legenda","text",existing?.attrs?.caption||""),field("rows","Linhas; separe células com |","textarea",existing?tableText(existing):"Cabeçalho 1 | Cabeçalho 2\nValor 1 | Valor 2"),field("header","Primeira linha é cabeçalho","checkbox",existing?.children?.[0]?.children?.some(c=>c.kind==="table_header")??true),field("bordered","Com borda","checkbox",existing?.attrs?.bordered??true),field("striped","Listrada","checkbox",existing?.attrs?.striped??false),field("compact","Compacta","checkbox",existing?.attrs?.compact??false)];
    v=await openForm("Tabela",fields); if(!v)return null;
    const rows=v.rows.split(/\r?\n/).filter(x=>x.trim()).map((line,i)=>node("table_row",{children:line.split("|").map(cell=>node(v.header&&i===0?"table_header":"table_cell",{children:[textNode(cell.trim())]}))}));
    return {...(existing||node("table")),kind:"table",attrs:{caption:v.caption,bordered:v.bordered,striped:v.striped,compact:v.compact},children:rows};
  }
  if (kind === "details") {
    fields=[field("summary","Título","text",existing?.attrs?.summary||"Detalhes"),field("open","Aberto inicialmente","checkbox",existing?.attrs?.open||false),field("body","Conteúdo","textarea",existing?.children?.map(plainNode).join("\n")||existing?.text||"")];
    v=await openForm("Detalhes",fields);if(!v)return null;
    return {...(existing||node("details")),kind:"details",attrs:{summary:v.summary,open:v.open},text:null,children:v.body.split(/\r?\n/).filter(Boolean).map(line=>node("paragraph",{children:[textNode(line)]}))};
  }
  if (kind === "math_block") {
    v=await openForm("Fórmula em bloco",[field("expression","LaTeX","textarea",existing?.text||"")]);if(!v)return null;
    return {...(existing||node("math_block")),kind:"math_block",text:v.expression,attrs:{},children:[]};
  }
  if (kind === "anchor") {
    v=await openForm("Âncora",[field("name","Nome","text",existing?.attrs?.name||"")]);if(!v)return null;
    return {...(existing||node("anchor")),kind:"anchor",attrs:{name:v.name},children:[]};
  }
  if (kind === "reference") {
    v=await openForm("Referência",[field("name","Nome","text",existing?.attrs?.name||""),field("text","Texto","textarea",existing?plainNode(existing):"")]);if(!v)return null;
    return {...(existing||node("reference")),kind:"reference",attrs:{name:v.name},children:[textNode(v.text)]};
  }
  if (kind === "map") {
    v=await openForm("Mapa manual",[field("name","Nome","text",existing?.attrs?.name||""),field("lat","Latitude","number",existing?.attrs?.lat||""),field("long","Longitude","number",existing?.attrs?.long||""),field("zoom","Zoom","number",existing?.attrs?.zoom||14)]);if(!v)return null;
    return {...(existing||node("map")),kind:"map",attrs:{name:v.name,lat:Number(v.lat),long:Number(v.long),zoom:Number(v.zoom)},children:[]};
  }
  if (["collage","slideshow"].includes(kind)) {
    v=await openForm(labels[kind],[field("caption","Legenda","text",existing?.attrs?.caption||""),field("media","Uma mídia por linha: photo|URL ou video|URL","textarea",existing?mediaLines(existing):"photo|https://\nvideo|https://")]);if(!v)return null;
    const children=v.media.split(/\r?\n/).filter(Boolean).map(line=>{const [type,...rest]=line.split("|");return node(type.trim()==="video"?"video":"photo",{attrs:{src:rest.join("|").trim()}})});
    return {...(existing||node(kind)),kind,attrs:{caption:v.caption},children};
  }
  if (kind === "button_row") {
    v=await openForm("Linha de botões",[field("align","Alinhamento","select",existing?.attrs?.align||"center",[["left","Esquerda"],["center","Centro"],["right","Direita"]]),field("buttons","type|texto|valor|style — uma linha por botão","textarea",existing?buttonLines(existing):"url|Abrir|https://|success")]);if(!v)return null;
    const children=v.buttons.split(/\r?\n/).filter(Boolean).map(line=>{const [type,label,value,style]=line.split("|");const attrs={type:(type||"url").trim(),style:(style||"").trim()};const val=(value||"").trim();if(["url","web_app","login_url"].includes(attrs.type))attrs.url=val;else if(attrs.type==="callback_data")attrs.data=val;else if(attrs.type==="copy_text")attrs.copy_text=val;else if(attrs.type.startsWith("switch_inline_query"))attrs.query=val;return node("button",{attrs,children:[textNode((label||attrs.type).trim())]});});
    for (const button of children) {
      const problem = validateButtonNode(button);
      if (problem) { showMessage("Botão inválido", problem); return null; }
    }
    return {...(existing||node("button_row")),kind:"button_row",attrs:{align:v.align},children};
  }
  return null;
}

async function structuredAction(kind, preset = "") {
  closeMenus();
  const built = await buildStructured(kind,preset,null);
  if (built) insertBlock(built);
}

async function mediaAction(kind, existing = null, replace = null) {
  closeMenus();
  if (existing?.attrs?.media_blob_id) {
    const hasPublic = /^https?:\/\//.test(existing.attrs?.src || "");
    const v = await openForm(labels[kind] || "Mídia local",[
      field("caption","Legenda","text",existing.attrs?.caption||""),
      field("credit","Crédito","text",existing.attrs?.credit||""),
      field("spoiler","Spoiler","checkbox",existing.attrs?.spoiler||false),
      field("make_public","Criar novo link público para Telegraph","checkbox",false),
      field("revoke_public",hasPublic?"Revogar links públicos e remover URL do documento":"Revogar links públicos existentes","checkbox",false),
    ]);
    if (!v) return;
    const attrs = {...existing.attrs, caption:v.caption, credit:v.credit, spoiler:v.spoiler};
    try {
      if (v.revoke_public) {
        await api(`/api/media/${attrs.media_blob_id}/public`, {method:"DELETE"});
        delete attrs.src;
      }
      if (v.make_public) {
        const result = await api(`/api/media/${attrs.media_blob_id}/public`, {method:"POST"});
        attrs.src = result.public.url;
      }
    } catch (error) {
      showMessage("Mídia local", error.message);
      return;
    }
    const n = {...existing, kind, attrs, children:[]};
    if (replace) replace(n); else insertBlock(n);
    return;
  }
  const v=await openForm(labels[kind]||"Mídia",[field("src","URL HTTP/HTTPS","url",existing?.attrs?.src||""),field("caption","Legenda","text",existing?.attrs?.caption||""),field("credit","Crédito","text",existing?.attrs?.credit||""),field("spoiler","Spoiler","checkbox",existing?.attrs?.spoiler||false)]);if(!v)return;
  const n={...(existing||node(kind)),kind,attrs:{src:v.src,caption:v.caption,credit:v.credit,spoiler:v.spoiler},children:[]};
  if(replace)replace(n);else insertBlock(n);
}

function localMediaAccept(kind) {
  if (kind === "photo") return "image/*";
  if (kind === "video") return "video/*";
  if (kind === "animation") return "image/gif,video/mp4";
  if (kind === "audio" || kind === "voice_note") return "audio/*";
  return "*/*";
}

function localMediaAction(kind) {
  closeMenus();
  if (!state.draft) { showMessage("Mídia local", "Abra ou crie um rascunho antes de adicionar mídia."); return; }
  state.pendingMediaKind = kind;
  const input = $("#media-file");
  input.accept = localMediaAccept(kind);
  input.click();
}

async function uploadLocalMedia(file, kind) {
  if (!state.draft || !file || !kind) return;
  const form = new FormData();
  form.append("draft_id", state.draft.id);
  form.append("file", file, file.name);
  setStatus("enviando mídia…");
  try {
    const result = await api("/api/media", {method:"POST", body:form});
    insertBlock(node(kind, {attrs:{
      media_blob_id: result.media.id,
      filename: result.media.filename,
      mime_type: result.media.mime_type,
      caption: "",
      credit: "",
      spoiler: false,
    }}));
    setStatus("mídia adicionada");
    showMessage("Mídia local", "O arquivo foi preservado como BLOB do seu rascunho. Telegram usa o BLOB diretamente; Telegraph só recebe uma URL pública se você criar essa URL explicitamente em Editar.");
  } catch (error) {
    setStatus("erro de mídia");
    showMessage("Falha no upload", error.message);
  }
}

async function buttonAction(type) {
  closeMenus();
  const fields=[field("label","Texto","text",type==="disabled"?"Desativado":"Botão"),field("style","Estilo","select","",[["","Padrão"],["primary","Primary"],["success","Success"],["danger","Danger"],["link","Link (callback)"]])];
  if(["url","web_app","login_url"].includes(type)) fields.push(field("value","URL","url","https://"));
  if(type==="callback_data") fields.push(field("value","Callback data (1–64 bytes)","text",""));
  if(type.startsWith("switch_inline_query")) fields.push(field("value","Query","text",""));
  if(type==="copy_text") fields.push(field("value","Texto a copiar","text",""));
  const v=await openForm("Botão Rich",fields);if(!v)return;
  const attrs={type,style:v.style};if(["url","web_app","login_url"].includes(type))attrs.url=v.value;else if(type==="callback_data")attrs.data=v.value;else if(type.startsWith("switch_inline_query"))attrs.query=v.value;else if(type==="copy_text")attrs.copy_text=v.value;
  const button=node("button",{attrs,children:[textNode(v.label)]});
  const problem=validateButtonNode(button);if(problem){showMessage("Botão inválido",problem);return;}
  insertBlock(node("button_row",{attrs:{align:"center"},children:[button]}));
}

async function nativeLocationAction() {
  closeMenus();
  if (!state.draft) { showMessage("Localização", "Abra ou crie um rascunho antes de adicionar uma localização."); return; }
  try {
    const result = await api("/api/location-requests", {method:"POST", body:{draft_id:state.draft.id}});
    state.pendingLocationRequest = result.request.id;
    sessionStorage.setItem("mdtxtrt:location-request", state.pendingLocationRequest);
    if (result.bot_url && tg?.openTelegramLink) tg.openTelegramLink(result.bot_url);
    else showMessage("Localização", "Abra a conversa com o bot e envie uma Location ou Venue pelo anexo de localização do Telegram. Depois retorne ao editor.");
    void pollLocationRequest(state.pendingLocationRequest);
  } catch (error) {
    showMessage("Localização", error.message);
  }
}

function insertFulfilledLocation(locationRequest) {
  if (!state.draft || locationRequest.draft_id !== state.draft.id) return false;
  const attrs = {
    name: locationRequest.name || locationRequest.address || "Localização",
    address: locationRequest.address || "",
    lat: Number(locationRequest.latitude),
    long: Number(locationRequest.longitude),
    zoom: 14,
    source: "telegram_native_location",
  };
  insertBlock(node("map", {attrs}));
  state.pendingLocationRequest = null;
  sessionStorage.removeItem("mdtxtrt:location-request");
  showMessage("Localização recebida", "A Location/Venue enviada ao bot foi adicionada ao rascunho.");
  return true;
}

async function checkLocationRequest(requestId, {silent = false} = {}) {
  if (!requestId) return false;
  try {
    const result = await api(`/api/location-requests/${requestId}`);
    if (result.request?.status === "fulfilled") return insertFulfilledLocation(result.request);
  } catch (error) {
    if (!silent) showMessage("Localização", error.message);
  }
  return false;
}

async function pollLocationRequest(requestId) {
  for (let attempt = 0; attempt < 60 && state.pendingLocationRequest === requestId; attempt += 1) {
    if (await checkLocationRequest(requestId, {silent:true})) return;
    await delay(2000);
  }
}

async function editStructuredCard(card) {
  const existing=deepClone(card.__node);
  const replace=n=>{card.replaceWith(cardElement(n));scheduleSave();};
  if(["photo","video","animation","audio","voice_note","document"].includes(existing.kind)) return mediaAction(existing.kind,existing,replace);
  const built=await buildStructured(existing.kind,"",existing);
  if(built) replace(built);
}

async function loadDraft(id, {fromPublication = null} = {}) {
  await commitNow("switch-draft");
  const data=await api(`/api/drafts/${id}`);
  state.draft=data.draft;
  state.editingPublication=fromPublication;
  nameEl.value=state.draft.name;
  renderDocument(state.draft.document);
  state.lastSaved=JSON.stringify(state.draft.document);
  const mirror=localStorage.getItem(mirrorKey());
  if(mirror){try{const local=JSON.parse(mirror);if(JSON.stringify(local.document)!==state.lastSaved){const useLocal=confirm("Existe um espelho local diferente do servidor. OK usa o local; Cancelar mantém o servidor. Nenhuma mesclagem será feita automaticamente.");if(useLocal){renderDocument(local.document);setStatus("espelho local");}else saveMirror();}}catch(_){}}
  requestAnimationFrame(()=>{
    if(state.draft.session?.scroll_top) window.scrollTo(0,state.draft.session.scroll_top);
    restoreSelection(state.draft.session);
  });
  setStatus("salvo");
  updatePublishLabels();
  if (state.pendingLocationRequest) void checkLocationRequest(state.pendingLocationRequest, {silent:true});
}

async function createDraft() {
  await commitNow("new-draft");
  const data=await api("/api/drafts",{method:"POST",body:{name:"Novo rascunho"}});
  await loadDraft(data.draft.id);
}

async function listDrafts() {
  const data=await api(`/api/drafts?archived=${state.archivedView?1:0}`);
  const box=$("#drafts-list");box.replaceChildren();
  if(!data.drafts.length){box.textContent=state.archivedView?"Nenhum arquivado.":"Nenhum rascunho.";return;}
  data.drafts.forEach(d=>{const row=document.createElement("div");row.className="list-row";const name=document.createElement("strong");name.textContent=d.name;const meta=document.createElement("small");meta.textContent=new Date(d.updated_at).toLocaleString();const actions=document.createElement("div");actions.className="list-actions";const open=document.createElement("button");open.textContent="Abrir";open.onclick=async()=>{$("#drafts-dialog").close();await loadDraft(d.id)};const archive=document.createElement("button");archive.textContent=state.archivedView?"Restaurar":"Arquivar";archive.onclick=async()=>{await api(`/api/drafts/${d.id}`,{method:"PATCH",body:{archived:!state.archivedView}});await listDrafts()};actions.append(open,archive);row.append(name,meta,actions);box.append(row)});
}

async function listPublications() {
  const data=await api("/api/publications");const box=$("#publications-list");box.replaceChildren();
  if(!data.publications.length){box.textContent="Nenhuma publicação.";return;}
  data.publications.forEach(p=>{const row=document.createElement("div");row.className="list-row";const name=document.createElement("strong");name.textContent=`${p.kind === "telegram"?"Telegram":"Telegraph"} — ${p.title}`;const meta=document.createElement("small");meta.textContent=p.kind==="telegram"?`chat ${p.destination_chat_id} · mensagem ${p.telegram_message_id}`:(p.telegraph_url||p.telegraph_path);const actions=document.createElement("div");actions.className="list-actions";const edit=document.createElement("button");edit.textContent="Editar";edit.onclick=async()=>{$("#publications-dialog").close();await loadDraft(p.draft_id,{fromPublication:p});showMessage("Publicação vinculada",`Este rascunho está vinculado à publicação ${p.title}. Ao publicar em ${p.kind}, o MDTXTRT atualizará a publicação existente.`)};actions.append(edit);row.append(name,meta,actions);box.append(row)});
}

function updatePublishLabels(){
  $("#publish-telegram").textContent=state.editingPublication?.kind==="telegram"?"Atualizar Telegram":"Telegram";
  $("#publish-telegraph").textContent=state.editingPublication?.kind==="telegraph"?"Atualizar Telegraph":"Telegraph";
}

async function reviewAndPublish(destination) {
  if(!state.draft)return;
  await commitNow("pre-publish");
  const editing=state.editingPublication?.kind===destination?state.editingPublication:null;
  let title=editing?.title || nameEl.value || (destination==="telegraph"?"Sem título":"Publicação Telegram");
  let target="";
  if(!editing && destination==="telegram"){
    const v=await openForm("Publicar no Telegram",[field("title","Nome interno da publicação","text",title),field("target","Chat ID ou @username; vazio = sua conversa com o bot","text","")]);if(!v)return;title=v.title;target=v.target;
  } else if(destination==="telegraph"){
    const v=await openForm(editing?"Atualizar Telegraph":"Publicar no Telegraph",[field("title","Título","text",title)]);if(!v)return;title=v.title;
  }
  let preview;
  try{preview=await api(`/api/publish/${destination}/preview`,{method:"POST",body:{draft_id:state.draft.id}})}catch(e){showMessage("Não foi possível revisar",e.message);return;}
  const review=preview.review;
  $("#review-title").textContent=`Revisão — ${destination === "telegram"?"Telegram":"Telegraph"}`;
  $("#review-content").textContent=review.content;
  $("#review-metrics").textContent=Object.entries(review.metrics||{}).map(([k,v])=>`${k}: ${v}`).join(" · ");
  const warnings=$("#review-warnings");warnings.replaceChildren();
  [...(review.blocking||[]).map(message=>({type:"Bloqueio",message})),...(review.adaptations||[]).map(x=>({type:"Adaptação",message:x.message})),...(review.unsupported||[]).map(x=>({type:"Incompatibilidade",message:x.message}))].forEach(w=>{const div=document.createElement("div");div.className="warning";const b=document.createElement("b");b.textContent=w.type;const span=document.createElement("span");span.textContent=w.message;div.append(b,span);warnings.append(div)});
  const confirmBtn=$("#review-confirm");confirmBtn.disabled=!review.publishable;
  state.reviewAction=async()=>{
    const body={title,confirmed_fingerprint:review.requires_confirmation?review.fingerprint:undefined};
    if(target)body.destination_chat_id=target;
    try{
      const result=editing
        ? await api(`/api/publications/${editing.id}/${destination}`,{method:"PUT",body})
        : await api(`/api/publish/${destination}`,{method:"POST",body:{...body,draft_id:state.draft.id}});
      $("#review-dialog").close();state.editingPublication=result.publication;updatePublishLabels();
      const where=destination==="telegraph"?(result.publication.telegraph_url||"Telegraph"):`mensagem ${result.publication.telegram_message_id}`;
      showMessage("Publicação concluída",editing?`Publicação atualizada: ${where}`:`Publicação criada: ${where}`);
    }catch(e){showMessage("Falha de publicação",e.data?.detail||e.message);}
  };
  $("#review-dialog").showModal();
}

async function importChosen(file, encoding = null) {
  const form=new FormData();form.append("file",file,file.name);if(encoding)form.append("encoding",encoding);
  try{const data=await api("/api/import",{method:"POST",body:form});await loadDraft(data.draft.id)}catch(e){if(e.data?.error==="encoding_choice_required"){const v=await openForm("Escolher encoding",[field("encoding","Encoding (não será adivinhado)","text","windows-1252")]);if(v)return importChosen(file,v.encoding);}showMessage("Falha na importação",e.message);}
}

async function bootstrap() {
  if(!initData){setStatus("fora do Telegram");showMessage("Autenticação necessária","Abra este Mini App pelo Telegram. O servidor valida Telegram.WebApp.initData e não aceita identidade fornecida pelo navegador.");return;}
  try{
    const requested=new URLSearchParams(location.search).get("draft");
    if(requested){await loadDraft(requested);return;}
    const data=await api("/api/drafts");
    if(!data.drafts.length){await createDraft();return;}
    const latest=data.drafts[0];$("#resume-summary").textContent=`${latest.name} — ${new Date(latest.updated_at).toLocaleString()}`;
    const dialog=$("#resume-dialog");dialog.showModal();
    const buttons=$$("button[value]",dialog);buttons.forEach(b=>b.onclick=()=>{dialog.close(b.value)});
    dialog.addEventListener("close",async function once(){dialog.removeEventListener("close",once);if(dialog.returnValue==="continue")await loadDraft(latest.id);else await createDraft();});
  } catch(e){setStatus("erro");showMessage("Falha ao iniciar",e.message);}
}

editor.addEventListener("beforeinput",insertPendingText);
editor.addEventListener("input",scheduleSave);
editor.addEventListener("click",event=>{if(event.target.closest("a"))event.preventDefault()});
editor.addEventListener("paste",()=>setTimeout(scheduleSave));

$$('[data-format]').forEach(button=>button.addEventListener("click",()=>{closeMenus();wrapSelection(button.dataset.format)}));
$$('[data-inline-form]').forEach(button=>button.addEventListener("click",()=>inlineForm(button.dataset.inlineForm)));
$$('[data-block-action]').forEach(button=>button.addEventListener("click",()=>{closeMenus();replaceBlockKind(button.dataset.blockAction,button.dataset.level?Number(button.dataset.level):null)}));
$$('[data-insert]').forEach(button=>button.addEventListener("click",()=>{closeMenus();insertBlock(node(button.dataset.insert))}));
$$('[data-structured]').forEach(button=>button.addEventListener("click",()=>structuredAction(button.dataset.structured,button.dataset.preset||"")));
$$('[data-media]').forEach(button=>button.addEventListener("click",()=>mediaAction(button.dataset.media)));
$$('[data-local-media]').forEach(button=>button.addEventListener("click",()=>localMediaAction(button.dataset.localMedia)));
$$('[data-button]').forEach(button=>button.addEventListener("click",()=>buttonAction(button.dataset.button)));

$("#native-location").onclick=nativeLocationAction;
$("#media-file").addEventListener("change",async event=>{const file=event.target.files?.[0];const kind=state.pendingMediaKind;event.target.value="";state.pendingMediaKind=null;if(file&&kind)await uploadLocalMedia(file,kind)});

$("#undo").onclick=async()=>{if(!state.draft)return;await commitNow("before-undo");const d=await api(`/api/drafts/${state.draft.id}/undo`,{method:"POST"});state.draft=d.draft;renderDocument(state.draft.document);state.lastSaved=JSON.stringify(state.draft.document);setStatus("desfeito")};
$("#redo").onclick=async()=>{if(!state.draft)return;const candidates=state.draft.redo_candidates||[];if(!candidates.length){showMessage("Refazer","Não há revisão posterior neste ramo.");return;}const selected=candidates.length===1?candidates[0].id:(await openForm("Escolher ramo",[field("revision_id","Revisão","select",candidates[0].id,candidates.map(c=>[c.id,`${c.reason} — ${c.created_at}`]))]))?.revision_id;if(!selected)return;const d=await api(`/api/drafts/${state.draft.id}/redo`,{method:"POST",body:{revision_id:selected}});state.draft=d.draft;renderDocument(state.draft.document);state.lastSaved=JSON.stringify(state.draft.document);setStatus("refeito")};

nameEl.addEventListener("change",async()=>{if(!state.draft)return;try{const d=await api(`/api/drafts/${state.draft.id}`,{method:"PATCH",body:{name:nameEl.value}});state.draft=d.draft;setStatus("renomeado")}catch(e){showMessage("Nome",e.message)}});
$("#new-draft").onclick=createDraft;
$("#open-drafts").onclick=async()=>{await listDrafts();$("#drafts-dialog").showModal()};
$("#toggle-archived").onclick=async()=>{state.archivedView=!state.archivedView;$("#toggle-archived").textContent=state.archivedView?"Ver ativos":"Ver arquivados";await listDrafts()};
$("#open-publications").onclick=async()=>{await listPublications();$("#publications-dialog").showModal()};
$("#import-file").onclick=()=>$("#file").click();
$("#file").addEventListener("change",async event=>{const file=event.target.files?.[0];event.target.value="";if(file)await importChosen(file)});
$("#publish-telegram").onclick=()=>reviewAndPublish("telegram");
$("#publish-telegraph").onclick=()=>reviewAndPublish("telegraph");
$("#review-confirm").onclick=()=>state.reviewAction?.();
$$('[data-close]').forEach(button=>button.addEventListener("click",()=>button.closest("dialog")?.close()));

document.addEventListener("click",event=>{if(!event.target.closest(".toolbar details"))closeMenus()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.pendingLocationRequest)void checkLocationRequest(state.pendingLocationRequest,{silent:true})});
window.addEventListener("pagehide",()=>{saveMirror()});
state.sessionTimer=setInterval(saveSession,5*60*1000);
bootstrap();
