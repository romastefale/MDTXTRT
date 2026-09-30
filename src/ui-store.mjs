// Estado da interface (menus, diálogo e biblioteca) consumido pelo React.
// app.js descreve o que deve aparecer; os componentes em src/chrome.jsx
// renderizam. Cada atualização é aplicada com flushSync para que app.js possa
// medir o painel logo em seguida (placePanel) sem esperar um quadro.
import { flushSync } from "react-dom";

const CLOSED_MENU = Object.freeze({ open: false, anchor: null });

let state = Object.freeze({
  dest: "telegram",
  publishLabel: "Publicar no Telegram",
  blockKind: "",
  menus: Object.freeze({}),
  dialog: Object.freeze({
    open: false,
    serial: 0,
    label: "",
    value: "",
    rows: 1,
    confirm: false,
    ok: "OK",
    cancel: "Cancelar",
  }),
  library: Object.freeze({
    status: "",
    publicationCount: 0,
    draftCount: 0,
    publicationsOpen: false,
    draftsOpen: false,
    drafts: Object.freeze({ items: [], empty: "" }),
    telegram: Object.freeze({ items: [], empty: "" }),
    telegraph: Object.freeze({ items: [], empty: "" }),
  }),
});

const listeners = new Set();

function sameShallow(a, b) {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => Object.is(a[key], b[key]));
}

export function getUIState() {
  return state;
}

export function subscribeUI(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateUI(recipe) {
  if (typeof recipe !== "function" && Object.keys(recipe).every(key => Object.is(state[key], recipe[key]))) return state;
  const next = typeof recipe === "function" ? recipe(state) : { ...state, ...recipe };
  if (!next || next === state) return state;
  state = Object.freeze(next);
  flushSync(() => {
    for (const listener of [...listeners]) listener();
  });
  return state;
}

export function menuState(id) {
  return state.menus[id] || CLOSED_MENU;
}

export function setMenu(id, patch) {
  return updateUI(current => {
    const previous = current.menus[id] || CLOSED_MENU;
    const next = { ...previous, ...patch };
    if (sameShallow(previous, next)) return current;
    return { ...current, menus: Object.freeze({ ...current.menus, [id]: Object.freeze(next) }) };
  });
}

export function setDialog(patch) {
  return updateUI(current => ({ ...current, dialog: Object.freeze({ ...current.dialog, ...patch }) }));
}

export function setLibrary(patch) {
  return updateUI(current => {
    const next = { ...current.library, ...patch };
    if (sameShallow(current.library, next)) return current;
    return { ...current, library: Object.freeze(next) };
  });
}

export const uiStore = Object.freeze({
  getState: getUIState,
  subscribe: subscribeUI,
  update: updateUI,
  menu: menuState,
  setMenu,
  setDialog,
  setLibrary,
});
