import assert from 'node:assert/strict';
const T = new URL('../../tgcloud/', import.meta.url).pathname;
const sdk = await import('sdk');
const ep = async (n) => (await import(T + 'endpoints/' + n + '.js')).default;
const ctx = (id = 7) => ({ initData: { user: { id } } });
const D = (o = {}) => ({ version: 2, name: 'Doc', html: '<p>oi</p>', dest: 'telegram', telegraphPath: '', docId: '11111111-1111-1111-1111-111111111111', revision: 1, importedMd: '', importedTxt: '', importedHtml: '', media: [], ...o });
const fails = async (p, code) => { try { await p; } catch (e) { assert.equal(e.parameters?.code, code, e.message); return; } assert.fail('esperava erro ' + code); };
let n = 0; const ok = (name) => console.log('ok', ++n, name);

await (await ep('draftSave'))({ draft: D() }, ctx()); ok('draftSave cria');
await (await ep('draftSave'))({ draft: D({ revision: 2, html: '<p>v2</p>' }) }, ctx()); ok('draftSave atualiza');
await fails((await ep('draftSave'))({ draft: D({ revision: 1 }) }, ctx()), 'STALE_REVISION'); ok('revisão antiga recusada');
await fails((await ep('draftSave'))({ draft: D({ media: [{ id: 'a', kind: 'image' }] }) }, ctx()), 'MEDIA_MISSING'); ok('mídia não enviada ao bot é recusada');
await fails((await ep('draftSave'))({ draft: D({ docId: 'x' }) }, ctx()), 'BAD_DOC'); ok('docId inválido');
const loaded = await (await ep('draftLoad'))({}, ctx()); assert.equal(loaded.draft.html, '<p>v2</p>'); ok('draftLoad mais recente');
await fails((await ep('draftLoad'))({}, ctx(8)), 'NOT_FOUND'); ok('isolamento entre usuários');
await fails((await ep('draftSave'))({ draft: D() }, { initData: {} }), 'NO_USER'); ok('sem usuário');

const pub = await ep('telegramPublish');
const r1 = await pub({ draft: D({ revision: 3 }), html: '<p>v3</p>' }, ctx()); assert.equal(r1.messageId, 101); ok('publicação nova');
const r2 = await pub({ draft: D({ revision: 4 }), html: '<p>v4</p>' }, ctx());
assert.equal(r2.previousMessageId, 101); assert.equal(r2.noticeMessageId, 102); assert.equal(r2.messageId, 103); ok('republicação: aviso + conteúdo, em resposta');
const sent = sdk.calls.filter((c) => c.method === 'sendRichMessage'); assert.equal(sent[2].params.reply_parameters.message_id, 102); ok('reply_parameters encadeado');
const lib = await (await ep('libraryList'))({}, ctx()); assert.equal(lib.telegram[0].historyCount, 2); ok('libraryList reflete histórico');
sdk.botScript.fail = new sdk.BotApiError(403, 'Forbidden: bot was blocked by the user');
await fails(pub({ draft: D({ revision: 5 }), html: '<p>v5</p>' }, ctx()), 'BOT_BLOCKED'); ok('403 vira BOT_BLOCKED');
const after = (await (await ep('draftLoad'))({}, ctx())).publication; assert.equal(after.pendingUpdate.status, 'failed'); assert.equal(after.pendingUpdate.phase, 'notice'); ok('falha confirmada marca pendingUpdate=failed');
const r5 = await pub({ draft: D({ revision: 5 }), html: '<p>v5</p>' }, ctx()); assert.equal(r5.revision, 5); ok('após falha confirmada, retry publica');
sdk.botScript.fail = new Error('socket hang up');
await fails(pub({ draft: D({ revision: 6 }), html: '<p>v6</p>' }, ctx()), undefined).catch(()=>{}); 
const unc = (await (await ep('draftLoad'))({}, ctx())).publication; assert.equal(unc.pendingUpdate.status, 'uncertain'); ok('erro de rede deixa estado incerto');
await fails(pub({ draft: D({ revision: 7 }), html: '<p>v7</p>' }, ctx()), 'UNCERTAIN'); ok('incerto bloqueia nova publicação');

const ex = await ep('exportSource'); const e1 = await ex({ source: 't', doc: D().docId, revision: 1 }, ctx()); assert.equal(e1.html, '<p>oi</p>'); ok('exportSource snapshot publicado');

// Telegraph
const th = await ep('telegraphPublish'); const content = [{ tag: 'p', children: ['olá'] }];
sdk.tg.responses.push({ ok: true, result: { access_token: 'TOK' } }, { ok: true, result: { path: 'abc-10-10', url: 'https://telegra.ph/abc-10-10' } }, { ok: true, result: { path: 'abc-10-10', url: 'https://telegra.ph/abc-10-10', content } });
const p1 = await th({ title: 'T', content, doc: D().docId, revision: 1 }, ctx()); assert.equal(p1.path, 'abc-10-10'); ok('telegraph cria conta + página');
sdk.tg.responses.push({ ok: true, result: { path: 'abc-10-10', url: 'u' } }, { ok: true, result: { path: 'abc-10-10', url: 'u', content } });
await th({ title: 'T2', content, doc: D().docId, revision: 1 }, ctx()); assert.ok(sdk.calls.some((c) => c.method === 'fetch' && String(c.params.url).endsWith('/editPage'))); ok('segunda publicação usa editPage');
await fails(th({ title: 'T', content: [{ tag: 'script' }], doc: D().docId, revision: 1 }, ctx()), 'BAD_CONTENT'); ok('tag inválida recusada');
await fails(th({ title: 'T', content, path: 'outra', doc: D().docId, revision: 1 }, ctx()), 'BAD_PAGE'); ok('path de outro documento recusado');
const lg = await (await ep('libraryList'))({}, ctx()); assert.equal(lg.telegraph.length, 1); ok('library lista telegraph');
await (await ep('libraryDelete'))({ kind: 'telegraph', doc: D().docId, revision: 1 }, ctx()); assert.equal((await (await ep('libraryList'))({}, ctx())).telegraph.length, 0); ok('libraryDelete telegraph');
const del = await (await ep('libraryDelete'))({ kind: 'draft', doc: D().docId, revision: 1 }, ctx()); assert.equal(del.telegramPublication, true); await fails((await ep('draftLoad'))({ doc: D().docId, revision: 1 }, ctx()), 'NOT_FOUND'); ok('libraryDelete draft remove');

// Handler
const h = (await import(T + 'handlers/message.js')).default;
const cfg = await import(T + 'lib/config.js');
let threw = false; try { await h({ chat: { id: 7, type: 'private' }, from: { id: 7 }, message_id: 1, text: '/app' }); } catch (e) { threw = /MINI_APP_URL/.test(e.message); }
assert.ok(threw); ok('handler falha alto sem MINI_APP_URL configurada');
process.exitCode = 0;
console.log('total', n);
// novos endpoints
{
  const sdk2 = await import('sdk');
  const send = await ep('exportSend');
  const out = await send({ format: 'md', name: 'a/b:c.md', content: '# oi' }, ctx());
  assert.equal(out.fileName, 'a-b-c.md'); assert.equal(sdk2.calls.at(-1).method, 'sendDocument'); assert.equal(sdk2.calls.at(-1).params.chat_id, 7); ok('exportSend envia documento ao chat');
  await fails(send({ format: 'pdf', name: 'x', content: 'y' }, ctx()), 'BAD_FORMAT'); ok('exportSend formato inválido');
  sdk2.tg.responses.push({ ok: true, result: { path: 'p-1', url: 'https://telegra.ph/p-1' } }, { ok: true, result: { path: 'p-1', url: 'https://telegra.ph/p-1', content: [{ tag: 'p', children: ['a'] }] } });
  const dd = '55555555-5555-5555-5555-555555555555';
  const pub2 = await (await ep('telegraphPublish'))({ title: 'X', content: [{ tag: 'p', children: ['a'] }], doc: dd, revision: 3 }, ctx());
  assert.equal(pub2.doc, dd); assert.equal(pub2.revision, 3); ok('telegraphPublish ecoa doc/revision');
  const rec = await (await ep('telegraphRecover'))({ doc: dd, revision: 3 }, ctx()); assert.equal(rec.path, 'p-1'); ok('telegraphRecover');
  sdk2.tg.responses.push({ ok: true, result: { path: 'p-1', url: 'u', title: 'X', content: [{ tag: 'p', children: ['<a>'] }] } });
  const ld = await (await ep('telegraphLoad'))({ doc: dd }, ctx()); assert.equal(ld.html, '<p>&lt;a&gt;</p>'); assert.equal(ld.doc, dd); ok('telegraphLoad devolve html escapado');
  await fails((await ep('telegraphLoad'))({ doc: dd }, ctx(99)), 'NOT_FOUND'); ok('telegraphLoad isola por usuário');
  const dl = await (await ep('libraryDelete'))({ kind: 'telegraph', doc: dd }, ctx()); assert.deepEqual([dl.ok, dl.kind, dl.doc], [true, 'telegraph', dd]); ok('libraryDelete devolve ok/kind/doc');
}
