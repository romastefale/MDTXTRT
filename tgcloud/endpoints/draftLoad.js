import { EndpointError } from 'sdk';
import { docId, ownerId } from '../lib/common.js';
import { getDraft, latestDraft, rowToDraft } from '../lib/drafts.js';

// Sem `doc`, devolve o rascunho mais recente do usuário.
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const row = input.doc ? await getDraft(owner, docId(input.doc)) : await latestDraft(owner);
  if (!row) throw new EndpointError('Rascunho não encontrado', { code: 'NOT_FOUND' });
  return {
    draft: rowToDraft(row), media: [], publication: row.publication ?? null,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
