import { db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { drafts, telegraphPages } from '../schema.js';
import { ownerId } from '../lib/common.js';

const preview = (html) => Array.from(String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 280).join('');

export default async function (_input, ctx) {
  const owner = ownerId(ctx);
  const rows = await db.select().from(drafts).where(eq(drafts.ownerId, owner)).orderBy(desc(drafts.updatedAt));
  const pages = await db.select().from(telegraphPages).where(eq(telegraphPages.ownerId, owner));
  const byDoc = new Map(rows.map((row) => [row.docId, row]));
  const items = rows.map((row) => ({
    docId: row.docId, name: row.name, dest: row.dest, revision: row.revision, telegraphPath: row.telegraphPath,
    preview: preview(row.html), createdAt: row.createdAt, updatedAt: row.updatedAt, hasMedia: false,
  }));
  const telegram = rows.filter((row) => row.publication).map((row) => {
    const history = Array.isArray(row.publication.history) ? row.publication.history : [];
    return {
      docId: row.docId, name: row.name, status: row.publication.status, revision: row.publication.revision,
      messageId: row.publication.messageId, historyCount: history.length,
      publishedAt: history.at(-1)?.publishedAt || row.publication.updatedAt,
      preview: preview(row.html), createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  });
  const telegraph = pages.filter((page) => page.status === 'succeeded' || page.status === 'pending').map((page) => {
    const draft = byDoc.get(page.docId);
    return {
      docId: page.docId, path: page.path, status: page.status, name: draft?.name || page.path || 'Página Telegraph',
      revision: draft?.revision || 0, preview: draft ? preview(draft.html) : '',
      createdAt: draft?.createdAt || 0, updatedAt: draft?.updatedAt || 0,
    };
  });
  return { drafts: items, telegram, telegraph };
}
