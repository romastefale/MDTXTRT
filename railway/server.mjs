// Servidor HTTP do Railway: serve dist/, executa os endpoints de tgcloud/ em /api/call/<nome>
// e recebe as mensagens do bot em /telegram/webhook. Mesma lógica do backend tgcloud, outro hospedeiro.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, BotApiError, EndpointError } from './sdk.mjs';
import { dbFile, flush } from './store.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = resolve(ROOT, 'dist');
const ENDPOINTS = resolve(ROOT, 'tgcloud/endpoints');
const BODY_MAX = 2_000_000;
const AUTH_MAX_AGE = 86400;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8',
};

function env(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error('Configuração ausente: ' + name);
  return value;
}

export function userFromInitData(initData, token, now = Date.now() / 1000) {
  if (!initData || typeof initData !== 'string' || !initData.trim()) throw new Error('Abra pelo bot no Telegram');
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (initData.length > 8192 || keys.length !== new Set(keys).size) throw new Error('Sessão Telegram inválida');
  const hash = params.get('hash') || '';
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const actual = createHmac('sha256', secret).update(check).digest();
  const expected = /^[a-f0-9]{64}$/i.test(hash) ? Buffer.from(hash, 'hex') : Buffer.alloc(0);
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) throw new Error('Sessão Telegram inválida');
  const authDate = Number(params.get('auth_date') || '0');
  if (!authDate || authDate > now + 60 || now - authDate > AUTH_MAX_AGE) throw new Error('Sessão Telegram expirada');
  let user;
  try { user = JSON.parse(params.get('user') || ''); } catch { throw new Error('Dados da sessão inválidos'); }
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error('Usuário Telegram ausente');
  return { user, authDate };
}

export const webhookSecret = (token) => createHash('sha256').update('mdtxtrt-webhook:' + token).digest('hex').slice(0, 48);
const sameSecret = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_MAX) { const e = new Error('Pedido grande demais'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { const e = new Error('JSON inválido'); e.status = 400; throw e; }
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = ''; }
  rel = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
  const abs = resolve(DIST, rel);
  const inside = relative(DIST, abs);
  if (!rel || inside.startsWith('..') || inside.includes('\0') || !existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
    return;
  }
  const ext = extname(abs).toLowerCase();
  const live = ['.html', '.js', '.css'].includes(ext);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': live ? 'no-cache' : 'public, max-age=600' });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(abs).pipe(res);
}

export async function createApp({ token = env('TOKEN') } = {}) {
  const names = new Set(readdirSync(ENDPOINTS).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)));
  const handlers = new Map();
  const loadEndpoint = async (name) => {
    if (!handlers.has(name)) handlers.set(name, (await import(new URL(`../tgcloud/endpoints/${name}.js`, import.meta.url).href)).default);
    return handlers.get(name);
  };
  const messageHandler = (await import(new URL('../tgcloud/handlers/message.js', import.meta.url).href)).default;
  const secret = webhookSecret(token);
  const seen = new Set();

  async function call(req, res, name) {
    if (!names.has(name)) return send(res, 404, { ok: false, error: { message: 'Endpoint não encontrado', type: 'NOT_FOUND', status: 404 } });
    const body = await readBody(req);
    let auth;
    try { auth = userFromInitData(body.initData, token); }
    catch (error) { return send(res, 401, { ok: false, error: { message: error.message, type: 'UNAUTHORIZED', status: 401 } }); }
    const input = body.input && typeof body.input === 'object' ? body.input : {};
    try {
      const result = await (await loadEndpoint(name))(input, { initData: { user: auth.user, auth_date: auth.authDate } });
      return send(res, 200, { ok: true, result: result ?? null });
    } catch (error) {
      if (error instanceof EndpointError || error instanceof BotApiError) {
        const parameters = error.parameters || {};
        return send(res, 400, { ok: false, error: { message: error.message, type: 'ENDPOINT_ERROR', status: 400, parameters } });
      }
      console.error('endpoint', name, error);
      return send(res, 500, { ok: false, error: { message: 'Erro interno', type: 'INTERNAL', status: 500 } });
    }
  }

  async function webhook(req, res) {
    if (!sameSecret(req.headers['x-telegram-bot-api-secret-token'] || '', secret)) { res.writeHead(401); res.end(); return; }
    const update = await readBody(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    const id = update?.update_id;
    if (Number.isSafeInteger(id)) {
      if (seen.has(id)) return;
      seen.add(id);
      if (seen.size > 500) seen.delete(seen.values().next().value);
    }
    if (update?.message) {
      try { await messageHandler(update.message); }
      catch (error) { console.error('mensagem', error); }
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'POST' && url.pathname === '/telegram/webhook') return await webhook(req, res);
      const m = /^\/api\/call\/([A-Za-z0-9]+)$/.exec(url.pathname);
      if (m) {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: { message: 'Método não permitido', status: 405 } });
        return await call(req, res, m[1]);
      }
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
      res.writeHead(404); res.end();
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { ok: false, error: { message: error.status ? error.message : 'Erro interno', status: error.status || 500 } });
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  return { server, secret };
}

export async function main() {
  const port = Number(env('PORT'));
  const token = env('TOKEN');
  const base = env('PUBLIC_BASE_URL').replace(/\/+$/, '');
  env('MINI_APP_URL');
  if (!existsSync(DIST)) throw new Error('dist/ ausente: rode `npm run build` antes de iniciar');
  const { server, secret } = await createApp({ token });
  server.listen(port, '0.0.0.0', () => console.log(`MDTXTRT no Railway, porta ${port}; banco: ${dbFile || 'só em memória (defina RAILWAY_VOLUME_MOUNT_PATH)'}`));
  await api.setWebhook({ url: base + '/telegram/webhook', secret_token: secret, allowed_updates: ['message'] });
  console.log('Webhook configurado');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { try { flush(); } finally { process.exit(0); } });
}
