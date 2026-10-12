import { api, db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { drafts, imports, media } from '../schema.js';
import { mediaFromMessage } from '../lib/media.js';
import { escapeHtml } from '../lib/common.js';
import { sendRich } from '../lib/chat.js';
import { miniAppUrl } from '../lib/config.js';

const COMMAND_RE = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:\s+[\s\S]*)?$/i;
const LIST_SIZE = 8;

function button(label, url, style = 'success') {
  const text = Array.from(String(label || 'Sem título').replace(/\s+/g, ' ').trim()).slice(0, 58).join('');
  return `<tg-button-row align="center"><tg-button type="web_app" style="${style}" url="${escapeHtml(url)}">${escapeHtml(text)}</tg-button></tg-button-row>`;
}
const appMessage = (text, params) => `<h1>MDTXTRT</h1><p>${text}</p>${button('Mini App MDTXTRT', miniAppUrl(params))}`;

function listPages(title, intro, items, empty) {
  if (!items.length) return [`<h1>${escapeHtml(title)}</h1><p>${empty}</p>${button('Mini App MDTXTRT', miniAppUrl())}`];
  const pages = [];
  const total = Math.ceil(items.length / LIST_SIZE);
  for (let start = 0; start < items.length; start += LIST_SIZE) {
    const n = start / LIST_SIZE + 1;
    pages.push(`<h1>${escapeHtml(title)}</h1><p>${intro}${total > 1 ? ` Página ${n} de ${total}.` : ''}</p>` +
      items.slice(start, start + LIST_SIZE).map((item) => button(item.label, item.url)).join(''));
  }
  return pages;
}

const COMMANDS = [
  { command: 'start', description: 'Abrir o MDTXTRT' },
  { command: 'app', description: 'Abrir o Mini App' },
  { command: 'novo', description: 'Criar um documento' },
  { command: 'rascunhos', description: 'Listar e editar rascunhos salvos' },
  { command: 'telegraph', description: 'Abrir o editor Telegraph' },
  { command: 'enviar', description: 'Escolher e enviar um rascunho' },
  { command: 'exportar', description: 'Escolher e exportar conteúdo' },
  { command: 'importar', description: 'Importar Markdown ou TXT' },
  { command: 'ajuda', description: 'Ver os comandos' },
];

// Configuração idempotente do bot (comandos e botão de menu), feita no /start.
async function configureBot() {
  await api.setMyCommands({ commands: COMMANDS, scope: { type: 'all_private_chats' } });
  await api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Mini App MDTXTRT', web_app: { url: miniAppUrl() } } });
}

const HELP = '<h1>Comandos</h1><p><b>/app</b> abre o Mini App.</p><p><b>/novo</b> cria outro documento.</p><p><b>/rascunhos</b> lista os rascunhos e abre o escolhido no Mini App.</p><p><b>/telegraph</b> abre o Mini App no editor Telegraph.</p><p><b>/enviar</b> lista os rascunhos para escolher qual enviar.</p><p><b>/exportar</b> lista rascunhos e publicações para exportar em TXT ou Markdown.</p><p><b>/importar</b> importa um documento .md ou .txt anexado ou respondido.</p>';

async function importFile(message, document) {
  const name = String(document?.file_name || '');
  const extension = name.toLowerCase().slice(name.lastIndexOf('.'));
  const chatId = message.chat.id;
  if (!document?.file_id || name.length < 4 || name.length > 124 || !['.md', '.txt'].includes(extension)) {
    await sendRich(chatId, '<h1>Importação não concluída</h1><p>Envie um arquivo UTF-8 com extensão <b>.md</b> ou <b>.txt</b>.</p>', { replyTo: message.message_id });
    return;
  }
  if (document.file_size > 240_000) {
    await sendRich(chatId, '<h1>Importação não concluída</h1><p>Arquivo acima do limite de 240 KB para importação.</p>', { replyTo: message.message_id });
    return;
  }
  const row = await db.insert(imports).values({ ownerId: message.from?.id ?? chatId, fileId: document.file_id, fileName: name, createdAt: Date.now() }).returning({ id: imports.id });
  const html = `<h1>Arquivo recebido</h1><p><b>${escapeHtml(name)}</b> está pronto para abrir como novo documento. Nada foi publicado.</p>${button('Continuar no Mini App', miniAppUrl({ import: row[0].id }))}`;
  await sendRich(chatId, html, { replyTo: message.message_id });
}

export default async function (message) {
  if (!message?.chat) return;
  const text = typeof message.text === 'string' ? message.text : '';
  const caption = typeof message.caption === 'string' ? message.caption : '';
  const match = COMMAND_RE.exec(text) || COMMAND_RE.exec(caption);
  const command = (match?.[1] || '').toLowerCase();
  const chatId = message.chat.id;
  const reply = message.message_id;
  if (message.chat.type !== 'private') {
    if (text && match) await sendRich(chatId, '<p>Abra o chat privado do MDTXTRT para usar o Mini App, importar e exportar arquivos.</p>');
    return;
  }
  const isText = /\.(md|txt)$/i.test(String(message.document?.file_name || ''));
  if (message.document && (isText || command === 'importar')) return importFile(message, message.document);
  const incoming = mediaFromMessage(message);
  if (incoming && !(command && command !== 'importar')) {
    if (incoming.size > (incoming.kind === 'image' ? 10_000_000 : 50_000_000)) {
      return void await sendRich(chatId, '<p>Arquivo acima do limite do Telegram (fotos até 10 MB, demais até 50 MB).</p>', { replyTo: reply });
    }
    const mediaId = crypto.randomUUID().replace(/-/g, '');
    await db.insert(media).values({ ownerId: message.from?.id ?? chatId, mediaId, ...incoming, createdAt: Date.now() });
    return void await sendRich(chatId, `<h1>Mídia recebida</h1><p>Ela já pode ser anexada a um documento no Mini App.</p>${button('Abrir Mini App', miniAppUrl())}`, { replyTo: reply });
  }
  if (command === 'importar') {
    const document = message.reply_to_message?.document;
    if (document) return importFile(message, document);
    return void await sendRich(chatId, '<p>Envie um arquivo <b>.md</b> ou <b>.txt</b>, ou responda a um documento com <b>/importar</b>.</p>', { replyTo: reply });
  }
  if (!text || !match) return;
  const owner = message.from?.id ?? chatId;
  if (command === 'start') await configureBot();
  if (command === 'start' || command === 'app') return void await sendRich(chatId, appMessage('Edite, publique e exporte seus textos do Telegram.'), { replyTo: reply });
  if (command === 'novo') return void await sendRich(chatId, appMessage('Crie outro documento sem substituir o rascunho atual.', { new: crypto.randomUUID() }), { replyTo: reply });
  if (command === 'telegraph') return void await sendRich(chatId, `<h1>Telegraph</h1><p>Abra o Mini App já no editor Telegraph.</p>${button('Abrir editor Telegraph', miniAppUrl({ dest: 'telegraph' }))}`, { replyTo: reply });
  if (command === 'ajuda' || command === 'help') return void await sendRich(chatId, HELP + button('Mini App MDTXTRT', miniAppUrl()), { replyTo: reply });
  if (['rascunhos', 'enviar', 'exportar'].includes(command)) {
    const rows = await db.select().from(drafts).where(eq(drafts.ownerId, owner)).orderBy(desc(drafts.updatedAt));
    let pages;
    if (command === 'rascunhos') {
      pages = listPages('Rascunhos', 'Escolha um rascunho para abri-lo no editor.', rows.map((r) => ({ label: 'Editar · ' + r.name, url: miniAppUrl({ doc: r.docId }) })), 'Nenhum rascunho salvo foi encontrado. Use <b>/novo</b> para começar.');
    } else if (command === 'enviar') {
      pages = listPages('Enviar rascunho', 'Qual rascunho você quer enviar nesta conversa?', rows.map((r) => ({ label: 'Enviar · ' + r.name, url: miniAppUrl({ botAction: 'send', source: 'd', doc: r.docId }) })), 'Nenhum rascunho salvo foi encontrado.');
    } else {
      const items = rows.flatMap((r) => [
        { label: 'Rascunho · ' + r.name, url: miniAppUrl({ botAction: 'export', source: 'd', doc: r.docId }) },
        ...(r.publication?.status === 'succeeded' && r.publication.snapshot ? [{ label: 'Telegram · ' + r.name, url: miniAppUrl({ botAction: 'export', source: 't', doc: r.docId }) }] : []),
      ]);
      pages = listPages('Exportar', 'Qual rascunho ou publicação você quer exportar?', items, 'Nenhum rascunho ou publicação foi encontrado.');
    }
    for (let i = 0; i < pages.length; i++) await sendRich(chatId, pages[i], { replyTo: i === 0 ? reply : 0 });
    return;
  }
  await sendRich(chatId, `<p>Não conheço o comando <b>/${escapeHtml(command)}</b>. Use <b>/ajuda</b> para ver os comandos.</p>`, { replyTo: reply });
}
