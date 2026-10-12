import { api, db, EndpointError } from 'sdk';
import { and, desc, eq } from 'sdk/db';
import { imports } from '../schema.js';
import { IMPORT_SOURCE_MAX, ownerId } from '../lib/common.js';

// Devolve o texto de um .md/.txt enviado ao bot; a conversão MD->HTML roda no Mini App (marked.js já empacotado).
export default async function (input, ctx) {
  const owner = ownerId(ctx);
  const row = input.id
    ? await db.select().from(imports).where(and(eq(imports.ownerId, owner), eq(imports.id, Number(input.id)))).get()
    : await db.select().from(imports).where(eq(imports.ownerId, owner)).orderBy(desc(imports.createdAt)).limit(1).get();
  if (!row) throw new EndpointError('Nenhuma importação pendente', { code: 'NOT_FOUND' });
  let bytes;
  try { bytes = await api.getFileContent(row.fileId); }
  catch (error) { throw new EndpointError('O Telegram não forneceu o arquivo para importação', { code: 'FILE_UNAVAILABLE' }); }
  if (bytes.length > IMPORT_SOURCE_MAX) throw new EndpointError('Arquivo acima do limite de 240 KB para importação', { code: 'TOO_LARGE' });
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes); }
  catch { throw new EndpointError('Conteúdo inválido: o arquivo deve usar UTF-8', { code: 'BAD_ENCODING' }); }
  return { id: row.id, fileName: row.fileName, text };
}
