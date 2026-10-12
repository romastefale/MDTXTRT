import { EndpointError } from 'sdk';
import { docId, ownerId } from '../lib/common.js';
import { publishPage } from '../lib/telegraph.js';

export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const doc = docId(input.doc);
  const revision = input.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new EndpointError('Revisão do documento inválida', { code: 'BAD_REVISION' });
  const page = await publishPage(owner, { title: input.title, content: input.content, path: String(input.path || ''), doc });
  return { path: page.path, url: page.url, title: page.title, doc, revision };
}
