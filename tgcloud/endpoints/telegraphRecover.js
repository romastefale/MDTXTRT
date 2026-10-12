import { EndpointError } from 'sdk';
import { docId, ownerId } from '../lib/common.js';
import { pageRow } from '../lib/telegraph.js';

// Recupera o caminho da página já criada para este documento (ex.: perda do estado local).
export default async function (input, ctx) {
  const doc = docId(input.doc);
  const row = await pageRow(ownerId(ctx), doc);
  if (!row) throw new EndpointError('Página não encontrada para este documento', { code: 'NOT_FOUND' });
  if (row.status !== 'succeeded') throw new EndpointError('A publicação no Telegraph ainda espera confirmação', { code: 'UNCERTAIN' });
  return { path: row.path, doc, revision: input.revision };
}
