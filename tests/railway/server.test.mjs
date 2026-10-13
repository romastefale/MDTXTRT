// Testa o servidor do Railway de ponta a ponta com um Bot API simulado (HTTP local).
// Rode com: node --import ./railway/register.mjs tests/railway/server.test.mjs  (npm test faz isso)
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const dir = mkdtempSync(join(tmpdir(), 'mdtxtrt-'));

// Bot API simulado
const botCalls = [];
let nextFail = null;
let messageId = 500;
const bot = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const url = req.url || '';
  if (url.startsWith(`/file/bot${TOKEN}/`)) { res.writeHead(200); res.end('# Olá\n'); return; }
  const method = url.replace(`/bot${TOKEN}/`, '');
  const ctype = String(req.headers['content-type'] || '');
  botCalls.push({ method, json: ctype.includes('json') ? JSON.parse(raw.toString() || '{}') : null, multipart: ctype.startsWith('multipart/'), size: raw.length });
  res.writeHead(200, { 'content-type': 'application/json' });
  if (nextFail) { const f = nextFail; nextFail = null; res.end(JSON.stringify(f)); return; }
  if (method === 'getFile') { res.end(JSON.stringify({ ok: true, result: { file_path: 'docs/a.md' } })); return; }
  if (method === 'sendRichMessage' || method === 'sendDocument') { res.end(JSON.stringify({ ok: true, result: { message_id: ++messageId } })); return; }
  res.end(JSON.stringify({ ok: true, result: true }));
});
await new Promise((r) => bot.listen(0, '127.0.0.1', r));

process.env.TOKEN = TOKEN;
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${bot.address().port}`;
process.env.DB_FILE = join(dir, 'db.json');
process.env.MINI_APP_URL = 'https://mdtxtrt.example/';

const { createApp, userFromInitData, webhookSecret } = await import('../../railway/server.mjs');
const { flush } = await import('../../railway/store.mjs');
const { server, secret } = await createApp({ token: TOKEN });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

function initData(userId = 42, authDate = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAA', user: JSON.stringify({ id: userId, first_name: 'Ana' }) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return p.toString();
}
const call = async (name, input = {}, data = initData()) => {
  const res = await fetch(`${base}/api/call/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: data, input }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const DOC = '11111111-2222-3333-4444-555555555555';
const draft = (over = {}) => ({ version: 2, name: 'Notas', html: '<h1>Oi</h1>', dest: 'telegram', telegraphPath: '', docId: DOC, revision: 1, importedMd: '', importedTxt: '', importedHtml: '', media: [], ...over });

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

await t('initData: assinatura, expiração e usuário', () => {
  assert.equal(userFromInitData(initData(7), TOKEN).user.id, 7);
  assert.throws(() => userFromInitData(initData(7).replace('hash=', 'hash=0'), TOKEN), /inválida/);
  assert.throws(() => userFromInitData(initData(7, 1000), TOKEN), /expirada/);
  assert.throws(() => userFromInitData('', TOKEN), /Abra pelo bot/);
});

await t('sem sessão válida: 401; endpoint inexistente: 404', async () => {
  assert.equal((await call('draftLoad', {}, 'hash=x')).status, 401);
  assert.equal((await call('naoExiste')).status, 404);
  assert.equal((await call('..%2Fschema')).status, 404);
});

await t('rascunho: salvar, carregar, listar', async () => {
  const saved = await call('draftSave', { draft: draft() });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.result.draft.docId, DOC);
  const loaded = await call('draftLoad', {});
  assert.equal(loaded.body.result.draft.name, 'Notas');
  const list = await call('libraryList');
  assert.equal(list.body.result.drafts.length, 1);
  assert.equal((await call('draftLoad', {}, initData(99))).status, 400, 'outro usuário não vê o rascunho');
});

await t('revisão antiga é recusada com código estável', async () => {
  await call('draftSave', { draft: draft({ revision: 5 }) });
  const stale = await call('draftSave', { draft: draft({ revision: 2 }) });
  assert.equal(stale.status, 400);
  assert.equal(stale.body.error.parameters.code, 'STALE_REVISION');
});

await t('banco é gravado no arquivo do volume', () => {
  flush();
  assert.ok(existsSync(process.env.DB_FILE));
  assert.equal(JSON.parse(readFileSync(process.env.DB_FILE, 'utf8')).tables.drafts.length, 1);
});

await t('exportSend: envia o arquivo por multipart', async () => {
  const r = await call('exportSend', { format: 'md', name: 'Notas', content: '# Oi' });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.fileName, 'Notas.md');
  const sent = botCalls.filter((c) => c.method === 'sendDocument').at(-1);
  assert.ok(sent.multipart);
});

await t('telegramPublish: envia rich_message e guarda a publicação', async () => {
  const r = await call('telegramPublish', { draft: draft({ revision: 6 }), html: '<h1>Oi</h1>' });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.via, 'sendRichMessage');
  const sent = botCalls.filter((c) => c.method === 'sendRichMessage').at(-1);
  assert.equal(sent.json.chat_id, 42);
  assert.equal(sent.json.rich_message.html, '<h1>Oi</h1>');
  const list = await call('libraryList');
  assert.equal(list.body.result.telegram[0].status, 'succeeded');
});

await t('erro 429 do Telegram vira RATE_LIMITED', async () => {
  nextFail = { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 } };
  const r = await call('exportSend', { format: 'txt', name: 'x', content: 'a' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.parameters.code, 'RATE_LIMITED');
});

await t('webhook: segredo errado é recusado', async () => {
  const res = await fetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'errado' }, body: '{}' });
  assert.equal(res.status, 401);
});

await t('webhook: /start configura o bot e responde; update repetido é ignorado', async () => {
  const update = { update_id: 9001, message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: '/start' } };
  const post = () => fetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(update) });
  const before = botCalls.length;
  assert.equal((await post()).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const mine = botCalls.slice(before).map((c) => c.method);
  assert.deepEqual(mine, ['setMyCommands', 'setChatMenuButton', 'sendRichMessage']);
  assert.equal(botCalls.slice(before).find((c) => c.method === 'setChatMenuButton').json.menu_button.web_app.url, 'https://mdtxtrt.example/');
  assert.equal((await post()).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(botCalls.length - before, 3, 'a repetição não reprocessa');
});

await t('webhook: arquivo .md vira importação e importOpen lê o conteúdo', async () => {
  const update = { update_id: 9002, message: { message_id: 2, chat: { id: 42, type: 'private' }, from: { id: 42 }, document: { file_id: 'F1', file_name: 'a.md', file_size: 10 } } };
  await fetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(update) });
  await new Promise((r) => setTimeout(r, 300));
  const r = await call('importOpen', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.result.text, '# Olá\n');
});

await t('/health responde', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

assert.equal(typeof webhookSecret(TOKEN), 'string');
server.close(); bot.close();
console.log(`${n} testes do servidor Railway passaram`);
process.exit(0);
