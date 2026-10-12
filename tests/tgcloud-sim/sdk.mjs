export const STORE = {}; export const calls = []; export const botScript = { fail: null };
let ids = {};
const rows = (t) => (STORE[t.__name] ||= []);
const uniq = { drafts: ['ownerId','docId'], telegraph_pages: ['ownerId','docId'], telegraph_account: ['id'] };
function sel(t) {
  const q = { w: null, ord: null, lim: null };
  const run = () => { let r = rows(t).filter((x) => !q.w || q.w.f(x)); if (q.ord) r = [...r].sort((a,b)=>q.ord.dir*((a[q.ord.key]>b[q.ord.key])-(a[q.ord.key]<b[q.ord.key]))); if (q.lim!=null) r = r.slice(0,q.lim); return r.map((x)=>({...x})); };
  const b = { where: (w) => ((q.w = w), b), orderBy: (o) => ((q.ord = o), b), limit: (n) => ((q.lim = n), b), get: async () => run()[0] ?? null, all: async () => run(), then: (res, rej) => b.all().then(res, rej) };
  return b;
}
export const db = {
  select: () => ({ from: sel }),
  $count: async (t) => rows(t).length,
  insert: (t) => ({ values(v) {
    const list = Array.isArray(v) ? v : [v]; let ignore = false; let ret = false;
    const exec = async () => { const out = []; let n = 0; for (const item of list) {
      const keys = uniq[t.__name]; if (keys && rows(t).some((r) => keys.every((k) => r[k] === item[k]))) { if (ignore) continue; throw new Error('UNIQUE ' + t.__name); }
      const row = { ...item }; if (!('id' in row)) row.id = (ids[t.__name] = (ids[t.__name] || 0) + 1); if (t.__name==='drafts' && !('publication' in row)) row.publication = null; rows(t).push(row); out.push({ ...row }); n++; }
      return ret ? out : { rowsAffected: n, lastInsertRowid: 0, rows: [] }; };
    const b = { onConflictDoNothing: () => ((ignore = true), b), returning: () => ((ret = true), b), run: exec, then: (a, c) => exec().then(a, c) }; return b; } }),
  update: (t) => ({ set: (s) => { let w; const exec = async () => { let n = 0; for (const r of rows(t)) if (!w || w.f(r)) { Object.assign(r, s); n++; } return { rowsAffected: n }; }; const b = { where: (x) => ((w = x), b), run: exec, then: (a, c) => exec().then(a, c) }; return b; } }),
  delete: (t) => { let w; const exec = async () => { const keep = rows(t).filter((r) => w && !w.f(r)); STORE[t.__name] = keep; return {}; }; const b = { where: (x) => ((w = x), b), run: exec, then: (a, c) => exec().then(a, c) }; return b; },
};
export class EndpointError extends Error { constructor(m, p = {}) { super(m); this.name = 'EndpointError'; this.parameters = p; } }
export class BotApiError extends Error { constructor(code, description, p = {}) { super(description); this.name = 'BotApiError'; this.code = code; this.description = description; this.parameters = p; } }
let mid = 100;
export const api = new Proxy({}, { get: (_, method) => async (params) => { calls.push({ method, params }); if (botScript.fail) { const f = botScript.fail; botScript.fail = null; throw f; } if (method === 'sendRichMessage') return { message_id: ++mid }; if (method === 'getFileContent') return new TextEncoder().encode('# Olá\n'); return true; } });
export const tg = { responses: [] };
export const fetch = async (url, opts) => { calls.push({ method: 'fetch', params: { url, body: opts?.body } }); const r = tg.responses.shift() || { ok: true, result: {} }; return { ok: true, json: async () => r }; };
export class InputFile {}
