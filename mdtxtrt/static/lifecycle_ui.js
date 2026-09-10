const tg = window.Telegram?.WebApp;
const initData = tg?.initData || "";
const $ = (selector, root = document) => root.querySelector(selector);
const editor = $("#editor");

async function api(path, options = {}) {
  const headers = {"X-Telegram-Init-Data": initData, ...(options.headers || {})};
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== "string") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, {...options, headers});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function archivedView() {
  return $("#toggle-archived")?.textContent?.trim() === "Ver ativos";
}

let enhancingDrafts = false;
async function enhanceDraftRows() {
  if (enhancingDrafts || !initData) return;
  const box = $("#drafts-list");
  const rows = box ? [...box.querySelectorAll(".list-row")] : [];
  if (!rows.length || rows.every(row => row.dataset.lifecycleEnhanced === "1")) return;
  enhancingDrafts = true;
  try {
    const result = await api(`/api/drafts?archived=${archivedView() ? 1 : 0}`);
    if (result.drafts.length !== rows.length) return;
    rows.forEach((row, index) => {
      if (row.dataset.lifecycleEnhanced === "1") return;
      const draft = result.drafts[index];
      row.dataset.lifecycleEnhanced = "1";
      row.dataset.draftId = draft.id;
      const actions = row.querySelector(".list-actions");
      if (!actions) return;
      const duplicate = document.createElement("button");
      duplicate.type = "button";
      duplicate.textContent = "Duplicar";
      duplicate.addEventListener("click", async () => {
        if (!confirm(`Duplicar “${draft.name}” como rascunho independente?`)) return;
        try {
          const created = await api(`/api/drafts/${draft.id}/duplicate`, {method:"POST", body:{confirm:true}});
          const target = created.draft.id;
          const url = new URL(location.href);
          url.searchParams.set("draft", target);
          location.assign(url.toString());
        } catch (error) {
          alert(`Falha ao duplicar: ${error.message}`);
        }
      });
      actions.append(duplicate);
    });
  } catch (_) {
    // The primary editor remains usable; the explicit action surfaces failures.
  } finally {
    enhancingDrafts = false;
  }
}

const draftObserver = new MutationObserver(() => queueMicrotask(enhanceDraftRows));
const draftList = $("#drafts-list");
if (draftList) draftObserver.observe(draftList, {childList:true});
$("#toggle-archived")?.addEventListener("click", () => setTimeout(enhanceDraftRows, 0));

function mediaAccept(kind) {
  if (kind === "photo") return "image/*";
  if (kind === "video") return "video/*";
  if (kind === "animation") return "image/gif,video/mp4";
  if (kind === "audio" || kind === "voice_note") return "audio/*";
  return "*/*";
}

function chooseFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    document.body.append(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0] || null;
      input.remove();
      resolve(file);
    }, {once:true});
    input.click();
  });
}

function mediaCardNode(card) {
  const node = card.__node;
  if (!node?.attrs?.media_blob_id) return null;
  if (!["photo","video","animation","audio","voice_note","document"].includes(node.kind)) return null;
  return node;
}

function applyMediaVersionToCard(card, canonical, media) {
  canonical.attrs.media_blob_id = media.id;
  canonical.attrs.filename = media.filename;
  canonical.attrs.mime_type = media.mime_type;
  delete canonical.attrs.src;
  card.__node = structuredClone(canonical);
  const summary = card.querySelector(".summary");
  if (summary) summary.textContent = canonical.attrs.caption || canonical.attrs.filename || canonical.kind;
  editor.dispatchEvent(new Event("input", {bubbles:true}));
}

async function chooseMediaVersion(card) {
  const current = mediaCardNode(card);
  if (!current) return;
  let history;
  try {
    history = (await api(`/api/media/${current.attrs.media_blob_id}/history`)).history || [];
  } catch (error) {
    alert(`Falha ao carregar versões: ${error.message}`);
    return;
  }
  if (!history.length) {
    alert("Esta mídia ainda não possui versão anterior.");
    return;
  }

  const dialog = document.createElement("dialog");
  dialog.style.width = "min(680px, calc(100% - 24px))";
  const head = document.createElement("div");
  head.className = "dialog-head";
  const title = document.createElement("h2");
  title.textContent = "Versões anteriores da mídia";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Fechar";
  close.onclick = () => dialog.close();
  head.append(title, close);
  const body = document.createElement("div");
  body.className = "dialog-body";
  history.forEach((version, index) => {
    const row = document.createElement("div");
    row.className = "list-row";
    const name = document.createElement("strong");
    name.textContent = `${index + 1}. ${version.filename}`;
    const meta = document.createElement("small");
    meta.textContent = `${version.size} bytes · SHA-256 ${version.sha256}`;
    const actions = document.createElement("div");
    actions.className = "list-actions";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restaurar";
    restore.onclick = async () => {
      if (!confirm(`Restaurar “${version.filename}” como uma nova versão atual? A atual continuará preservada.`)) return;
      restore.disabled = true;
      try {
        const result = await api(`/api/media/${current.attrs.media_blob_id}/restore`, {
          method:"POST",
          body:{version_id:version.id},
        });
        applyMediaVersionToCard(card, current, result.media);
        dialog.close();
      } catch (error) {
        alert(`Falha ao restaurar versão: ${error.message}`);
        restore.disabled = false;
      }
    };
    actions.append(restore);
    row.append(name, meta, actions);
    body.append(row);
  });
  dialog.append(head, body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), {once:true});
  dialog.showModal();
}

function enhanceMediaCards() {
  if (!editor) return;
  for (const card of editor.querySelectorAll(".node-card")) {
    const canonical = mediaCardNode(card);
    if (!canonical || card.dataset.mediaLifecycleEnhanced === "1") continue;
    card.dataset.mediaLifecycleEnhanced = "1";

    const replace = document.createElement("button");
    replace.type = "button";
    replace.textContent = "Substituir arquivo";
    replace.style.gridColumn = "1 / -1";
    replace.style.gridRow = "auto";
    replace.style.justifySelf = "start";
    replace.addEventListener("click", async event => {
      event.stopPropagation();
      const current = mediaCardNode(card);
      if (!current) return;
      const file = await chooseFile(mediaAccept(current.kind));
      if (!file) return;
      if (!confirm(`Substituir “${current.attrs.filename || current.kind}” por “${file.name}”? A versão anterior será preservada.`)) return;
      const form = new FormData();
      form.append("file", file, file.name);
      try {
        const result = await api(`/api/media/${current.attrs.media_blob_id}/replace`, {method:"POST", body:form});
        applyMediaVersionToCard(card, current, result.media);
      } catch (error) {
        alert(`Falha ao substituir mídia: ${error.message}`);
      }
    });

    const versions = document.createElement("button");
    versions.type = "button";
    versions.textContent = "Versões";
    versions.style.gridColumn = "1 / -1";
    versions.style.gridRow = "auto";
    versions.style.justifySelf = "start";
    versions.addEventListener("click", event => {
      event.stopPropagation();
      void chooseMediaVersion(card);
    });
    card.append(replace, versions);
  }
}

if (editor) {
  const mediaObserver = new MutationObserver(enhanceMediaCards);
  mediaObserver.observe(editor, {childList:true, subtree:false});
  enhanceMediaCards();
}

function selectionInsideEditor(selection) {
  if (!selection?.rangeCount || selection.isCollapsed || !editor) return false;
  const range = selection.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  return Boolean(start && end && editor.contains(start) && editor.contains(end));
}

// With selected text, block dragging is suspended so native contenteditable
// drag/drop moves the selected range. Collapsed selection restores block drag.
document.addEventListener("selectionchange", () => {
  if (!editor) return;
  const textMove = selectionInsideEditor(window.getSelection());
  for (const block of editor.children) block.draggable = !textMove;
});
