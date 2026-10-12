import { db, EndpointError } from 'sdk';
import { and, eq, desc } from 'sdk/db';
import { drafts } from '../schema.js';
import { DRAFT_MAX_BYTES, HTML_MAX_BYTES, IMPORT_SOURCE_MAX, byteLength, docId } from './common.js';

// Validação de contrato do rascunho (v2). A validade do HTML Rich é decidida pelo Telegram
// no envio (BotApiError), não duplicada aqui.
export function draftChecked(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new EndpointError('Rascunho inválido', { code: 'BAD_DRAFT' });
  if (draft.version !== 2) throw new EndpointError('Versão do rascunho incompatível', { code: 'BAD_DRAFT' });
  if (byteLength(JSON.stringify(draft)) > DRAFT_MAX_BYTES) throw new EndpointError('Rascunho grande demais', { code: 'TOO_LARGE' });
  if (typeof draft.html !== 'string' || byteLength(draft.html) > HTML_MAX_BYTES) throw new EndpointError('Conteúdo do rascunho inválido', { code: 'BAD_DRAFT' });
  if (typeof draft.name !== 'string' || draft.name.length > 256) throw new EndpointError('Nome do rascunho inválido', { code: 'BAD_DRAFT' });
  if (!['telegram', 'telegraph'].includes(draft.dest)) throw new EndpointError('Destino do rascunho inválido', { code: 'BAD_DRAFT' });
  if (draft.revision !== undefined && (!Number.isSafeInteger(draft.revision) || draft.revision < 0)) throw new EndpointError('Revisão do rascunho inválida', { code: 'BAD_DRAFT' });
  if (typeof draft.telegraphPath !== 'string' || draft.telegraphPath.length > 256) throw new EndpointError('Página do rascunho inválida', { code: 'BAD_DRAFT' });
  for (const key of ['importedMd', 'importedTxt', 'importedHtml']) {
    if (typeof draft[key] !== 'string') throw new EndpointError('Origem importada do rascunho inválida', { code: 'BAD_DRAFT' });
  }
  if (byteLength(draft.importedMd) + byteLength(draft.importedTxt) + byteLength(draft.importedHtml) > IMPORT_SOURCE_MAX) {
    throw new EndpointError('Origem importada do rascunho grande demais', { code: 'TOO_LARGE' });
  }
  if (!Array.isArray(draft.media)) throw new EndpointError('Metadados de mídia inválidos', { code: 'BAD_DRAFT' });
  if (draft.media.length) {
    throw new EndpointError('Mídia local ainda não é suportada no armazenamento Serverless', { code: 'MEDIA_UNSUPPORTED' });
  }
  return { ...draft, docId: docId(draft.docId) };
}

export function rowToDraft(row) {
  return {
    version: 2,
    name: row.name,
    html: row.html,
    dest: row.dest,
    telegraphPath: row.telegraphPath,
    docId: row.docId,
    revision: row.revision,
    importedMd: row.importedMd,
    importedTxt: row.importedTxt,
    importedHtml: row.importedHtml,
    media: [],
  };
}

export async function getDraft(owner, doc) {
  return db.select().from(drafts).where(and(eq(drafts.ownerId, owner), eq(drafts.docId, doc))).get();
}

export async function latestDraft(owner) {
  return db.select().from(drafts).where(eq(drafts.ownerId, owner)).orderBy(desc(drafts.updatedAt)).limit(1).get();
}

export async function saveDraft(owner, input) {
  const draft = draftChecked(input);
  const now = Date.now();
  const existing = await getDraft(owner, draft.docId);
  const revision = draft.revision ?? 0;
  if (existing && revision < existing.revision) {
    throw new EndpointError('Uma revisão mais recente deste rascunho já está salva', { code: 'STALE_REVISION' });
  }
  const values = {
    name: draft.name, dest: draft.dest, revision, telegraphPath: draft.telegraphPath, html: draft.html,
    importedMd: draft.importedMd, importedTxt: draft.importedTxt, importedHtml: draft.importedHtml, updatedAt: now,
  };
  if (existing) {
    await db.update(drafts).set(values).where(and(eq(drafts.ownerId, owner), eq(drafts.docId, draft.docId)));
  } else {
    await db.insert(drafts).values({ ownerId: owner, docId: draft.docId, ...values, createdAt: now });
  }
  return getDraft(owner, draft.docId);
}
