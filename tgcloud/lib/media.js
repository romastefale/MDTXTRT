import { EndpointError } from 'sdk';

// Tag tg:// do HTML Rich -> tipo de InputMedia* do Bot API.
const TYPE = { image: 'photo', video: 'video', audio: 'audio', voice: 'voice_note', document: 'document' };
const LINK_RE = /tg:\/\/(photo|video|audio|document)\?id=([A-Za-z0-9_-]{1,64})/g;
const TAG_FOR = { image: 'photo', video: 'video', audio: 'audio', voice: 'audio', document: 'document' };

// Monta `rich_message.media` a partir das mídias referenciadas no HTML (file_id guardado pelo bot).
export function richMedia(html, rows) {
  const byId = new Map(rows.map((row) => [row.mediaId, row]));
  const used = new Set();
  const media = [];
  for (const [, tag, id] of html.matchAll(LINK_RE)) {
    const row = byId.get(id);
    if (!row) throw new EndpointError('Há mídia no documento que não foi enviada ao bot', { code: 'MEDIA_MISSING' });
    if (TAG_FOR[row.kind] !== tag) throw new EndpointError('Tipo de mídia incompatível', { code: 'BAD_MEDIA' });
    if (used.has(id)) continue;
    used.add(id);
    media.push({ id, media: { type: TYPE[row.kind], media: row.fileId } });
  }
  if (rows.some((row) => !used.has(row.mediaId))) throw new EndpointError('Há mídia anexada que não está no documento', { code: 'BAD_MEDIA' });
  return media;
}

// Extrai a mídia de uma mensagem do Telegram (maior foto; documento exceto .md/.txt é tratado fora).
export function mediaFromMessage(message) {
  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    return { kind: 'image', fileId: photo.file_id, fileName: '', mime: 'image/jpeg', size: photo.file_size || 0 };
  }
  const pick = (kind, v) => v?.file_id ? { kind, fileId: v.file_id, fileName: v.file_name || '', mime: v.mime_type || '', size: v.file_size || 0 } : null;
  return pick('video', message.video) || pick('audio', message.audio) || pick('voice', message.voice) || pick('document', message.document);
}
