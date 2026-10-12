import { db, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { drafts, telegraphPages } from '../schema.js';
import { docId, ownerId } from '../lib/common.js';
import { getDraft } from '../lib/drafts.js';
import { pageRow } from '../lib/telegraph.js';

// kind: 'draft' | 'telegram' | 'telegraph' (telegram/telegraph só tiram da lista; a mensagem/página continua existindo).
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const doc = docId(input.doc);
  const kind = String(input.kind || '');
  if (kind === 'draft') {
    const row = await getDraft(owner, doc);
    if (!row) throw new EndpointError('Rascunho não encontrado', { code: 'NOT_FOUND' });
    if (row.publication?.status === 'pending' || row.publication?.pendingUpdate?.status === 'pending') {
      throw new EndpointError('Há um envio ao Telegram em andamento neste rascunho; espere terminar para excluir', { code: 'IN_PROGRESS' });
    }
    await db.delete(drafts).where(and(eq(drafts.ownerId, owner), eq(drafts.docId, doc)));
    return { ok: true, kind, doc, telegramPublication: Boolean(row.publication) };
  }
  if (kind === 'telegram') {
    const row = await getDraft(owner, doc);
    if (!row?.publication) throw new EndpointError('Publicação Telegram não encontrada', { code: 'NOT_FOUND' });
    if (row.publication.status === 'pending' || row.publication.pendingUpdate?.status === 'pending') {
      throw new EndpointError('Há um envio ao Telegram em andamento nesta publicação; espere terminar', { code: 'IN_PROGRESS' });
    }
    await db.update(drafts).set({ publication: null }).where(and(eq(drafts.ownerId, owner), eq(drafts.docId, doc)));
    return { ok: true, kind, doc };
  }
  if (kind === 'telegraph') {
    const page = await pageRow(owner, doc);
    if (!page) throw new EndpointError('Publicação Telegraph não encontrada', { code: 'NOT_FOUND' });
    if (page.status === 'pending') throw new EndpointError('A publicação no Telegraph ainda espera confirmação', { code: 'UNCERTAIN' });
    await db.delete(telegraphPages).where(and(eq(telegraphPages.ownerId, owner), eq(telegraphPages.docId, doc)));
    return { ok: true, kind, doc, path: page.path, mode: 'list' };
  }
  throw new EndpointError('Tipo de item inválido', { code: 'BAD_KIND' });
}
