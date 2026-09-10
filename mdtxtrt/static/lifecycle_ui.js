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
    // The primary editor remains usable; lifecycle errors are surfaced when the
    // explicit action itself is invoked rather than replacing the main UI.
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
        current.attrs.media_blob_id = result.media.id;
        current.attrs.filename = result.media.filename;
        current.attrs.mime_type = result.media.mime_type;
        delete current.attrs.src;
        card.__node = structuredClone(current);
        const summary = card.querySelector(".summary");
        if (summary) summary.textContent = current.attrs.caption || current.attrs.filename || current.kind;
        editor.dispatchEvent(new Event("input", {bubbles:true}));
      } catch (error) {
        alert(`Falha ao substituir mídia: ${error.message}`);
      }
    });
    card.append(replace);
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

// When text is selected, top-level block dragging is suspended so the browser's
// native contenteditable drag/drop can move the selected text as a unit. When
// the selection collapses, block dragging becomes available again.
document.addEventListener("selectionchange", () => {
  if (!editor) return;
  const textMove = selectionInsideEditor(window.getSelection());
  for (const block of editor.children) block.draggable = !textMove;
});
