import { EndpointError } from 'sdk';
import { docId, ownerId } from '../lib/common.js';
import { getDraft } from '../lib/drafts.js';
import { contentHtml, getPage, pageRow } from '../lib/telegraph.js';

// Fonte exportável de uma seleção do bot: d = rascunho, t = snapshot publicado no Telegram, g = página Telegraph.
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const kind = String(input.source || '');
  const doc = docId(input.doc);
  if (kind === 'g') {
    const row = await pageRow(owner, doc);
    if (!row || row.status !== 'succeeded') throw new EndpointError('Publicação Telegraph não encontrada', { code: 'NOT_FOUND' });
    const page = await getPage(row.path);
    if (!Array.isArray(page.content)) throw new EndpointError('O Telegraph não retornou o conteúdo da página', { code: 'TELEGRAPH' });
    return { name: String(page.title || 'Página Telegraph').slice(0, 256), html: contentHtml(page.content), kind, doc };
  }
  const row = await getDraft(owner, doc);
  if (!row) throw new EndpointError('Rascunho não encontrado', { code: 'NOT_FOUND' });
  if (kind === 'd') return { name: row.name, html: row.html, kind, doc };
  if (kind === 't') {
    const snapshot = row.publication?.status === 'succeeded' ? row.publication.snapshot : null;
    if (!snapshot) throw new EndpointError('Esta publicação Telegram não possui snapshot da revisão publicada', { code: 'NOT_FOUND' });
    return { name: snapshot.name, html: snapshot.html, kind, doc };
  }
  throw new EndpointError('Seleção de exportação inválida', { code: 'BAD_KIND' });
}
