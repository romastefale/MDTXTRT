import { db, fetch, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { telegraphAccount, telegraphPages } from '../schema.js';
import { docId } from './common.js';

const API = 'https://api.telegra.ph/';
const TAGS = new Set('a aside b blockquote br code em figcaption figure h3 h4 hr i iframe img li ol p pre s strong u ul video'.split(' '));
const CONTENT_MAX = 65536;

async function call(method, params) {
  let res;
  try {
    res = await fetch(API + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new EndpointError('Resultado incerto no Telegraph após falha de conexão; confira a página antes de tentar novamente', { code: 'UNCERTAIN' });
  }
  let json;
  try { json = await res.json(); } catch {
    throw new EndpointError('Resultado incerto no Telegraph: resposta inválida; confira a página antes de tentar novamente', { code: 'UNCERTAIN' });
  }
  if (!res.ok || !json.ok) throw new EndpointError(`O Telegraph não aceitou a operação${json?.error ? ': ' + json.error : ''}`, { code: 'TELEGRAPH', failed: true });
  return json.result;
}

// Conteúdo = Array<Node>; tags e atributos conforme a Telegraph API (a, img, video, iframe: só href/src).
export function contentChecked(content) {
  const walk = (node) => {
    if (typeof node === 'string') return;
    if (!node || typeof node !== 'object' || Array.isArray(node) || !TAGS.has(node.tag)) throw new Error('Elemento do Telegraph inválido');
    for (const [key, value] of Object.entries(node.attrs || {})) {
      const ok = (key === 'href' && node.tag === 'a') || (key === 'src' && ['img', 'video', 'iframe'].includes(node.tag));
      if (!ok || typeof value !== 'string') throw new Error('Atributo do Telegraph inválido');
      let url; try { url = new URL(value); } catch { throw new Error('Link do Telegraph inválido'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Link do Telegraph inválido');
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error('Conteúdo do Telegraph inválido');
      node.children.forEach(walk);
    }
  };
  try {
    if (!Array.isArray(content) || !content.length || JSON.stringify(content).length > CONTENT_MAX) throw new Error('Conteúdo do Telegraph inválido');
    content.forEach(walk);
  } catch (error) {
    throw new EndpointError(error.message, { code: 'BAD_CONTENT' });
  }
  return content;
}

async function accessToken() {
  const row = await db.select().from(telegraphAccount).where(eq(telegraphAccount.id, 1)).get();
  if (row) return row.accessToken;
  const pages = await db.$count(telegraphPages);
  if (pages) throw new EndpointError('Credencial Telegraph ausente para páginas persistidas', { code: 'NO_TOKEN' });
  const account = await call('createAccount', { short_name: 'MDTXTRT', author_name: 'MDTXTRT' });
  const token = String(account?.access_token || '').trim();
  if (!token) throw new EndpointError('O Telegraph não retornou uma credencial válida', { code: 'TELEGRAPH' });
  await db.insert(telegraphAccount).values({ id: 1, accessToken: token }).onConflictDoNothing({ target: telegraphAccount.id });
  return (await db.select().from(telegraphAccount).where(eq(telegraphAccount.id, 1)).get()).accessToken;
}

export const pageRow = (owner, doc) =>
  db.select().from(telegraphPages).where(and(eq(telegraphPages.ownerId, owner), eq(telegraphPages.docId, doc))).get();

export async function getPage(path) {
  const page = await call('getPage', { path, return_content: 'true' });
  if (!page?.path || page.path !== path || !page.url) throw new EndpointError('O Telegraph não confirmou a página', { code: 'TELEGRAPH' });
  return page;
}

export async function publishPage(owner, { title, content, path = '', doc }) {
  const pageTitle = String(title || '').trim();
  if (!pageTitle) throw new EndpointError('Dê um nome à página antes de publicar', { code: 'BAD_TITLE' });
  if (Array.from(pageTitle).length > 256) throw new EndpointError('O nome da página deve ter até 256 caracteres', { code: 'BAD_TITLE' });
  contentChecked(content);
  const id = docId(doc);
  const known = await pageRow(owner, id);
  if (known?.status === 'pending') throw new EndpointError('Resultado anterior incerto no Telegraph; confira a página antes de criar outra', { code: 'UNCERTAIN' });
  if (path && (!known || known.path !== path)) throw new EndpointError('Esta página não pertence a este documento', { code: 'BAD_PAGE' });
  const token = await accessToken();
  const body = { access_token: token, title: pageTitle, author_name: 'MDTXTRT', content: JSON.stringify(content), return_content: 'true' };
  let page;
  if (known) {
    page = await call('editPage', { ...body, path: known.path });
  } else {
    // Marca pendente antes de criar; a unique (owner, doc) serializa chamadas concorrentes.
    const claim = await db.insert(telegraphPages).values({ ownerId: owner, docId: id, path: '', status: 'pending' }).onConflictDoNothing({ target: [telegraphPages.ownerId, telegraphPages.docId] }).run();
    if (!claim.rowsAffected) throw new EndpointError('Há uma publicação deste documento em andamento no Telegraph', { code: 'IN_PROGRESS' });
    try {
      page = await call('createPage', body);
    } catch (error) {
      if (error.parameters?.failed) await db.delete(telegraphPages).where(and(eq(telegraphPages.ownerId, owner), eq(telegraphPages.docId, id)));
      throw error;
    }
    if (!page?.path || typeof page.path !== 'string') throw new EndpointError('Resultado incerto no Telegraph: página criada sem caminho confirmado', { code: 'UNCERTAIN' });
    await db.update(telegraphPages).set({ path: page.path, status: 'succeeded' }).where(and(eq(telegraphPages.ownerId, owner), eq(telegraphPages.docId, id)));
  }
  const verified = await getPage(page.path);
  return { ...page, url: verified.url, path: verified.path };
}
