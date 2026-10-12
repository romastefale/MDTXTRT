import { ownerId } from '../lib/common.js';
import { saveDraft } from '../lib/drafts.js';

export default async function (input, ctx) {
  const row = await saveDraft(ownerId(ctx), input.draft);
  return { draft: { docId: row.docId, revision: row.revision }, updatedAt: row.updatedAt };
}
