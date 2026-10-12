import { EndpointError } from 'sdk';
import { docId, ownerId } from '../lib/common.js';
import { getDraft } from '../lib/drafts.js';
import { contentHtml, getPage, pageRow } from '../lib/telegraph.js';

// Abre para edição a página Telegraph do próprio usuário (a posse vem do mapeamento owner+doc).
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const doc = docId(input.doc);
  const row = await pageRow(owner, doc);
  if (!row || row.status !== 'succeeded') throw new EndpointError('Página não encontrada nesta conta', { code: 'NOT_FOUND' });
  const page = await getPage(row.path);
  const draft = await getDraft(owner, doc);
  return { doc, path: page.path, url: page.url, title: page.title, html: contentHtml(page.content), revision: draft?.revision ?? 0 };
}
