// Runtime do Railway para o módulo `sdk` da plataforma: banco em arquivo + Bot API real.
import { IDS, STORE, UNIQUE, changed } from './store.mjs';

const rows = (t) => (STORE[t.__name] ||= []);
const clone = (x) => structuredClone(x);

function select(t) {
  const q = { w: null, ord: null, lim: null };
  const run = () => {
    let r = rows(t).filter((x) => !q.w || q.w.f(x));
    if (q.ord) r = [...r].sort((a, b) => q.ord.dir * ((a[q.ord.key] > b[q.ord.key]) - (a[q.ord.key] < b[q.ord.key])));
    if (q.lim != null) r = r.slice(0, q.lim);
    return r.map(clone);
  };
  const b = {
    where: (w) => ((q.w = w), b), orderBy: (o) => ((q.ord = o), b), limit: (n) => ((q.lim = n), b),
    get: async () => run()[0] ?? null, all: async () => run(), then: (res, rej) => b.all().then(res, rej),
  };
  return b;
}

export const db = {
  select: () => ({ from: select }),
  $count: async (t) => rows(t).length,
  insert: (t) => ({
    values(v) {
      const list = Array.isArray(v) ? v : [v];
      let ignore = false; let ret = false;
      const exec = async () => {
        const out = []; let n = 0;
        for (const item of list) {
          const keys = (UNIQUE[t.__name] || []).find((cols) => rows(t).some((r) => cols.every((k) => r[k] === item[k])));
          if (keys) { if (ignore) continue; throw new Error('UNIQUE ' + t.__name); }
          const row = clone(item);
          if (!('id' in row)) row.id = (IDS[t.__name] = (IDS[t.__name] || 0) + 1);
          if (t.__name === 'drafts' && !('publication' in row)) row.publication = null;
          rows(t).push(row); out.push(clone(row)); n++;
        }
        if (n) changed();
        return ret ? out : { rowsAffected: n, lastInsertRowid: 0, rows: [] };
      };
      const b = { onConflictDoNothing: () => ((ignore = true), b), returning: () => ((ret = true), b), run: exec, then: (a, c) => exec().then(a, c) };
      return b;
    },
  }),
  update: (t) => ({
    set: (s) => {
      let w;
      const exec = async () => { let n = 0; for (const r of rows(t)) if (!w || w.f(r)) { Object.assign(r, clone(s)); n++; } if (n) changed(); return { rowsAffected: n }; };
      const b = { where: (x) => ((w = x), b), run: exec, then: (a, c) => exec().then(a, c) };
      return b;
    },
  }),
  delete: (t) => {
    let w;
    const exec = async () => { STORE[t.__name] = rows(t).filter((r) => w && !w.f(r)); changed(); return {}; };
    const b = { where: (x) => ((w = x), b), run: exec, then: (a, c) => exec().then(a, c) };
    return b;
  },
};

export class EndpointError extends Error {
  constructor(message, parameters = {}) { super(message); this.name = 'EndpointError'; this.parameters = parameters; }
}
export class BotApiError extends Error {
  constructor(code, description, parameters = {}) { super(description); this.name = 'BotApiError'; this.code = code; this.description = description; this.parameters = parameters; }
}

// Arquivo a enviar por multipart (ex.: sendDocument).
export class InputFile {
  constructor(bytes, name, options = {}) { this.bytes = bytes; this.name = name; this.type = options.type || 'application/octet-stream'; }
}

const TOKEN = () => process.env.TOKEN || '';
const BASE = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');

async function botCall(method, params = {}) {
  const hasFile = Object.values(params).some((v) => v instanceof InputFile);
  let body; const headers = {};
  if (hasFile) {
    body = new FormData();
    for (const [k, v] of Object.entries(params)) {
      if (v instanceof InputFile) body.set(k, new Blob([v.bytes], { type: v.type }), v.name);
      else body.set(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
    }
  } else {
    body = JSON.stringify(params);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${BASE()}/bot${TOKEN()}/${method}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(method === 'sendDocument' ? 60000 : 20000) });
  let json;
  try { json = await res.json(); } catch { throw new Error('Resposta inválida do Telegram'); }
  if (!json.ok) throw new BotApiError(json.error_code || res.status, json.description || 'Falha na chamada', json.parameters || {});
  return json.result;
}

async function getFileContent(fileId) {
  const file = await botCall('getFile', { file_id: fileId });
  if (!file?.file_path) throw new Error('O Telegram não informou o caminho do arquivo');
  const res = await fetch(`${BASE()}/file/bot${TOKEN()}/${file.file_path}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('Download do arquivo falhou');
  return new Uint8Array(await res.arrayBuffer());
}

export const api = new Proxy({}, {
  get: (_, method) => (method === 'getFileContent' ? getFileContent : (params) => botCall(String(method), params)),
});
const sdkFetch = (...args) => fetch(...args);
export { sdkFetch as fetch };
