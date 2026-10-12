import { table, integer, text, json, uniqueIndex, index } from 'sdk/db';

// Rascunhos do usuário (um registro por documento). Sem FK: a integridade é feita no código.
export const drafts = table('drafts', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  ownerId:      integer('owner_id').notNull(),
  docId:        text('doc_id').notNull(),
  name:         text('name').notNull(),
  dest:         text('dest').notNull(),
  revision:     integer('revision').notNull().default(0),
  telegraphPath:text('telegraph_path').notNull().default(''),
  html:         text('html').notNull(),
  importedMd:   text('imported_md').notNull().default(''),
  importedTxt:  text('imported_txt').notNull().default(''),
  importedHtml: text('imported_html').notNull().default(''),
  media:        json('media'),                  // [{id, kind}] referências a `media`
  publication:  json('publication'),            // proveniência do envio ao chat (ou null)
  createdAt:    integer('created_at').notNull(),
  updatedAt:    integer('updated_at').notNull(),
}, (t) => ({
  ownerDoc:   uniqueIndex('uidx_drafts_owner_doc').on(t.ownerId, t.docId),
  ownerOrder: index('idx_drafts_owner_updated').on(t.ownerId, t.updatedAt),
}));

// Conta Telegraph do bot (uma linha) e mapeamento documento -> página.
export const telegraphAccount = table('telegraph_account', {
  id:          integer('id').primaryKey(),
  accessToken: text('access_token').notNull(),
});
export const telegraphPages = table('telegraph_pages', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id').notNull(),
  docId:   text('doc_id').notNull(),
  path:    text('path').notNull().default(''),
  status:  text('status').notNull(),            // 'pending' | 'succeeded'
}, (t) => ({
  ownerDoc: uniqueIndex('uidx_tpages_owner_doc').on(t.ownerId, t.docId),
}));

// Arquivos .md/.txt enviados ao bot, aguardando abertura no Mini App.
export const imports = table('imports', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  ownerId:  integer('owner_id').notNull(),
  fileId:   text('file_id').notNull(),
  fileName: text('file_name').notNull(),
  createdAt:integer('created_at').notNull(),
}, (t) => ({
  ownerIdx: index('idx_imports_owner').on(t.ownerId, t.createdAt),
}));

// Mídias enviadas ao bot (file_id do Bot API). Referenciadas nos rascunhos por `mediaId`.
export const media = table('media', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  ownerId:   integer('owner_id').notNull(),
  mediaId:   text('media_id').notNull(),
  kind:      text('kind').notNull(),            // image | video | audio | voice | document
  fileId:    text('file_id').notNull(),
  fileName:  text('file_name').notNull().default(''),
  mime:      text('mime').notNull().default(''),
  size:      integer('size').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  ownerMedia: uniqueIndex('uidx_media_owner_media').on(t.ownerId, t.mediaId),
}));
