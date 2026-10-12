import { db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { media } from '../schema.js';
import { ownerId } from '../lib/common.js';

// Mídias que o usuário enviou ao bot, para anexar a documentos no Mini App.
export default async function (_input, ctx) {
  const rows = await db.select().from(media).where(eq(media.ownerId, ownerId(ctx))).orderBy(desc(media.createdAt)).limit(100);
  return { media: rows.map((m) => ({ id: m.mediaId, kind: m.kind, name: m.fileName, mime: m.mime, size: m.size, createdAt: m.createdAt })) };
}
