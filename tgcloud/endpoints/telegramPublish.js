import { db, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { drafts } from '../schema.js';
import { ownerId } from '../lib/common.js';
import { getDraft, mediaRows, saveDraft } from '../lib/drafts.js';
import { richMedia } from '../lib/media.js';
import { revisionNoticeHtml } from '../lib/chat.js';
import { sendRich } from '../lib/chat.js';

// Falha confirmada pelo Telegram (nada foi enviado). Qualquer outro erro deixa o resultado incerto.
const CERTAIN = new Set(['RATE_LIMITED', 'BOT_BLOCKED', 'BOT_API', 'EMPTY', 'TOO_LARGE']);
const certain = (error) => error instanceof EndpointError && CERTAIN.has(error.parameters?.code);

async function setPublication(owner, doc, publication) {
  await db.update(drafts).set({ publication, updatedAt: Date.now() }).where(and(eq(drafts.ownerId, owner), eq(drafts.docId, doc)));
}

// Publica o rascunho no chat privado do usuário (chat_id == user.id em chats privados).
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const saved = await saveDraft(owner, input.draft);
  const doc = saved.docId;
  const html = String(input.html || '');
  const media = richMedia(html, await mediaRows(owner, saved.media || []));
  const prior = (await getDraft(owner, doc)).publication;
  if (prior && (prior.status === 'pending' || prior.status === 'uncertain' || prior.pendingUpdate?.status === 'pending' || prior.pendingUpdate?.status === 'uncertain')) {
    throw new EndpointError(prior.error || prior.pendingUpdate?.error || 'O resultado da publicação anterior é incerto; confira o chat antes de publicar novamente', { code: 'UNCERTAIN' });
  }
  const revision = saved.revision;
  const history = prior?.status === 'succeeded' ? (prior.history || []).slice(-99) : [];
  let replyTo = 0;
  let noticeMessageId = 0;
  if (prior?.status === 'succeeded') {
    await setPublication(owner, doc, { ...prior, history, pendingUpdate: { status: 'pending', phase: 'notice', revision, noticeMessageId: 0, startedAt: Date.now(), error: '' } });
    try {
      noticeMessageId = await sendRich(owner, revisionNoticeHtml(saved.name), { replyTo: prior.messageId });
    } catch (error) {
      await setPublication(owner, doc, { ...prior, history, pendingUpdate: { status: certain(error) ? 'failed' : 'uncertain', phase: 'notice', revision, noticeMessageId: 0, startedAt: Date.now(), error: error.message } });
      throw error;
    }
    replyTo = noticeMessageId;
  } else {
    await setPublication(owner, doc, { status: 'pending', messageId: 0, revision, updatedAt: Date.now(), error: '', history: [], pendingUpdate: null });
  }
  let messageId;
  try {
    messageId = await sendRich(owner, html, { replyTo, media });
  } catch (error) {
    if (prior?.status === 'succeeded') {
      await setPublication(owner, doc, { ...prior, history, pendingUpdate: { status: certain(error) ? 'failed' : 'uncertain', phase: 'content', revision, noticeMessageId, startedAt: Date.now(), error: error.message } });
    } else {
      await setPublication(owner, doc, certain(error) ? null : { status: 'uncertain', messageId: 0, revision, updatedAt: Date.now(), error: error.message, history: [], pendingUpdate: null });
    }
    throw error;
  }
  const publishedAt = Date.now();
  await setPublication(owner, doc, {
    status: 'succeeded', messageId, revision, updatedAt: publishedAt, error: '',
    snapshot: { revision, name: saved.name, html: saved.html },
    history: [...history, { messageId, revision, publishedAt, noticeMessageId }].slice(-100),
    pendingUpdate: null,
  });
  return { via: 'sendRichMessage', messageId, revision, ...(prior?.status === 'succeeded' ? { previousMessageId: prior.messageId, noticeMessageId } : {}) };
}
