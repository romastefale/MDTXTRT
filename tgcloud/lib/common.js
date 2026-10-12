import { EndpointError } from 'sdk';

export const DOC_ID_RE = /^[a-f0-9-]{36}$/i;
export const DRAFT_MAX_BYTES = 350_000;
export const HTML_MAX_BYTES = 160_000;
export const IMPORT_SOURCE_MAX = 240_000;

const encoder = new TextEncoder();
export const byteLength = (value) => encoder.encode(String(value)).length;

// O dono é sempre o usuário já verificado pela plataforma (ctx.initData).
export function ownerId(ctx) {
  const id = ctx?.initData?.user?.id;
  if (!Number.isSafeInteger(id) || id <= 0) throw new EndpointError('Usuário Telegram ausente', { code: 'NO_USER' });
  return id;
}

export function docId(value) {
  if (!DOC_ID_RE.test(String(value ?? ''))) throw new EndpointError('Documento inválido', { code: 'BAD_DOC' });
  return String(value).toLowerCase();
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// BotApiError -> EndpointError com mensagem legível; demais erros sobem como INTERNAL.
export function botFailure(error, fallback) {
  if (error && error.name === 'BotApiError') {
    if (error.code === 429) {
      const wait = Number(error.parameters?.retry_after) || 0;
      return new EndpointError(
        wait ? `O Telegram limitou os envios; tente de novo em ${wait} s` : 'O Telegram limitou os envios; tente de novo daqui a pouco',
        { code: 'RATE_LIMITED', retryAfter: wait || 1 });
    }
    if (error.code === 403) {
      return new EndpointError('O bot não pode escrever nesta conversa; abra o chat do bot e toque em Iniciar', { code: 'BOT_BLOCKED' });
    }
    return new EndpointError(`${fallback}: ${error.description || 'falha na chamada'}`, { code: 'BOT_API', botCode: error.code });
  }
  return error;
}
