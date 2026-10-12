import { docId, ownerId } from '../lib/common.js';
import { publishPage } from '../lib/telegraph.js';

export default async function (input, ctx) {
  const owner = ownerId(ctx);
  return publishPage(owner, { title: input.title, content: input.content, path: String(input.path || ''), doc: docId(input.doc) });
}
