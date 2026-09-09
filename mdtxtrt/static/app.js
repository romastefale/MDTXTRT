const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const editor = document.querySelector("#editor");
const status = document.querySelector("#status");
const importFile = document.querySelector("#importFile");
const ACTIVE_KEY = "mdtxtrt:rebuild:active-draft";
const EMERGENCY_KEY = "mdtxtrt:rebuild:emergency";

let draft = null;
let dirty = false;

function initData() { return tg?.initData || ""; }
function newId() { return crypto.randomUUID(); }
function emptyParagraph() { return { id: newId(), kind: "paragraph", text: "", attrs: {}, children: [] }; }

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Telegram-Init-Data", initData());
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function elementFor(block) {
  const el = document.createElement("div");
  el.dataset.nodeId = block.id;
  el.dataset.nodeKind = block.kind;
  el.dataset.attrs = JSON.stringify(block.attrs || {});
  el.textContent = block.text || "";
  return el;
}

function render(documentValue) {
  editor.replaceChildren();
  const blocks = documentValue.blocks.length ? documentValue.blocks : [emptyParagraph()];
  for (const block of blocks) editor.append(elementFor(block));
}

function serialize() {
  return {
    id: draft.document.id,
    schema_version: draft.document.schema_version,
    blocks: [...editor.children].map((el) => ({
      id: el.dataset.nodeId || newId(),
      kind: el.dataset.nodeKind || "paragraph",
      text: el.textContent || "",
      attrs: JSON.parse(el.dataset.attrs || "{}"),
      children: [],
    })),
    metadata: draft.document.metadata || {},
  };
}

function activeBlock() {
  const selection = window.getSelection();
  let node = selection?.anchorNode;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
  return node?.closest?.("[data-node-id]") || null;
}

function markDirty() {
  if (!draft) return;
  dirty = true;
  status.textContent = "Alterações locais";
  localStorage.setItem(EMERGENCY_KEY, JSON.stringify({ draftId: draft.id, document: serialize(), at: Date.now() }));
}

function setBlockKind(kind) {
  const block = activeBlock();
  if (!block) return;
  block.dataset.nodeKind = kind;
  block.dataset.attrs = kind === "heading" ? JSON.stringify({ level: 1 }) : "{}";
  markDirty();
}

async function persistRevision(reason = "checkpoint-5m") {
  if (!draft || !dirty) return;
  const result = await api(`/api/drafts/${draft.id}/revisions`, {
    method: "POST",
    body: JSON.stringify({ document: serialize(), reason }),
  });
  draft = result.draft;
  dirty = false;
  localStorage.removeItem(EMERGENCY_KEY);
  status.textContent = "Salvo";
}

async function persistSession() {
  if (!draft) return;
  await api(`/api/drafts/${draft.id}/session`, {
    method: "PUT",
    body: JSON.stringify({
      revision_id: draft.active_revision_id,
      cursor: null,
      selection: null,
      scroll_top: window.scrollY,
      active_block_id: activeBlock()?.dataset.nodeId || null,
    }),
  });
}

async function loadOrCreate() {
  const savedId = localStorage.getItem(ACTIVE_KEY);
  if (savedId) {
    try { draft = (await api(`/api/drafts/${savedId}`)).draft; }
    catch { localStorage.removeItem(ACTIVE_KEY); }
  }
  if (!draft) {
    draft = (await api("/api/drafts", {
      method: "POST",
      body: JSON.stringify({ name: "Novo rascunho" }),
    })).draft;
    localStorage.setItem(ACTIVE_KEY, draft.id);
  }
  render(draft.document);
  status.textContent = "Pronto";
}

editor.addEventListener("input", markDirty);
document.querySelectorAll("[data-kind]").forEach((button) => button.addEventListener("click", () => setBlockKind(button.dataset.kind)));

document.querySelector("#undo").addEventListener("click", async () => {
  await persistRevision("autosave-before-undo");
  draft = (await api(`/api/drafts/${draft.id}/undo`, { method: "POST" })).draft;
  render(draft.document);
});

document.querySelector("#redo").addEventListener("click", async () => {
  const latest = (await api(`/api/drafts/${draft.id}`)).draft;
  const candidates = latest.redo_candidates || [];
  if (candidates.length !== 1) {
    status.textContent = candidates.length ? "Há mais de um ramo para refazer" : "Nada para refazer";
    return;
  }
  draft = (await api(`/api/drafts/${draft.id}/redo`, {
    method: "POST",
    body: JSON.stringify({ revision_id: candidates[0].id }),
  })).draft;
  render(draft.document);
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  try {
    draft = (await api("/api/import", { method: "POST", body: form })).draft;
    localStorage.setItem(ACTIVE_KEY, draft.id);
    render(draft.document);
    status.textContent = "Importado";
  } catch (error) {
    if (error.payload?.error === "encoding_choice_required") {
      status.textContent = "Escolha de encoding necessária; a importação não foi adivinhada.";
    } else throw error;
  }
});

setInterval(async () => {
  try {
    await persistRevision("checkpoint-5m");
    await persistSession();
  } catch (error) {
    status.textContent = `Falha no checkpoint: ${error.message}`;
  }
}, 5 * 60 * 1000);

await loadOrCreate();
