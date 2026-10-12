import { EndpointError } from 'sdk';
import { ownerId } from '../lib/common.js';
import { getPage } from '../lib/telegraph.js';
import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { telegraphPages } from '../schema.js';

// Lê uma página do próprio usuário (a posse vem do mapeamento owner+doc, nunca do caminho recebido).
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const path = String(input.path || '');
  const row = await db.select().from(telegraphPages).where(and(eq(telegraphPages.ownerId, owner), eq(telegraphPages.path, path))).get();
  if (!row || row.status !== 'succeeded') throw new EndpointError('Página não encontrada nesta conta', { code: 'NOT_FOUND' });
  const page = await getPage(path);
  return { docId: row.docId, path: page.path, url: page.url, title: page.title, content: page.content };
}
