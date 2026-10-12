import { api, InputFile, EndpointError } from 'sdk';
import { botFailure, byteLength, ownerId } from '../lib/common.js';

const FORMATS = { md: 'text/markdown', txt: 'text/plain' };
const MAX_BYTES = 1_000_000;

function fileName(value, format) {
  const base = String(value || '').replace(/\.(md|txt)$/i, '').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '-').replace(/^\.+|\.+$/g, '').trim().slice(0, 80);
  if (!base) throw new EndpointError('Nome do arquivo inválido', { code: 'BAD_NAME' });
  return `${base}.${format}`;
}

// Exportação: entrega o arquivo .md/.txt como documento no chat privado do usuário (sendDocument).
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const format = String(input.format || '');
  if (!Object.hasOwn(FORMATS, format)) throw new EndpointError('Formato de exportação inválido', { code: 'BAD_FORMAT' });
  if (typeof input.content !== 'string' || !input.content.length) throw new EndpointError('Conteúdo da exportação inválido', { code: 'BAD_CONTENT' });
  if (byteLength(input.content) > MAX_BYTES) throw new EndpointError('O arquivo é grande demais para exportar pelo Telegram', { code: 'TOO_LARGE' });
  const name = fileName(input.name, format);
  const bytes = new TextEncoder().encode(input.content);
  try {
    const message = await api.sendDocument({ chat_id: owner, document: new InputFile(bytes, name, { type: FORMATS[format] }) });
    return { messageId: message?.message_id ?? 0, fileName: name };
  } catch (error) {
    throw botFailure(error, 'O Telegram não aceitou o arquivo');
  }
}
