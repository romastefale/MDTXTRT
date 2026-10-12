import { api, EndpointError } from 'sdk';
import { botFailure, escapeHtml } from './common.js';

const RICH_TEXT_MAX = 32768;

// Envia HTML Rich ao chat privado do usuário. Validade do HTML: decidida pelo Telegram (BotApiError).
export async function sendRich(chatId, html, { replyTo = 0 } = {}) {
  if (typeof html !== 'string' || !html.trim()) throw new EndpointError('Conteúdo vazio', { code: 'EMPTY' });
  if (html.length > RICH_TEXT_MAX * 8) throw new EndpointError('A mensagem é grande demais', { code: 'TOO_LARGE' });
  const params = { chat_id: chatId, rich_message: { html } };
  if (replyTo > 0) params.reply_parameters = { message_id: replyTo };
  try {
    const message = await api.sendRichMessage(params);
    const messageId = Number(message?.message_id || 0);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      throw new EndpointError('O Telegram não confirmou o identificador da mensagem', { code: 'UNCERTAIN' });
    }
    return messageId;
  } catch (error) {
    throw botFailure(error, 'O Telegram não aceitou a publicação');
  }
}

export function revisionNoticeHtml(name) {
  const title = String(name || 'Documento').trim() || 'Documento';
  return `<p><b>Atualização de publicação</b></p><p><b>${escapeHtml(title)}</b> recebeu uma nova versão. A versão anterior permanece no histórico desta conversa; o conteúdo atualizado será enviado na próxima mensagem.</p>`;
}
