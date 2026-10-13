// Armazenamento do runtime Railway: tabelas em memória, gravadas em um arquivo JSON no volume.
// Uma instância só (o Railway com volume já é assim). A gravação é atômica (arquivo temporário + rename).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const FILE = process.env.DB_FILE || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? process.env.RAILWAY_VOLUME_MOUNT_PATH.replace(/\/+$/, '') + '/mdtxtrt-db.json' : '');

export const STORE = {};
export const IDS = {};
export const UNIQUE = {};

if (FILE && existsSync(FILE)) {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  Object.assign(STORE, saved.tables || {});
  Object.assign(IDS, saved.ids || {});
}

let timer = null;
let writing = false;
export function flush() {
  if (!FILE) return;
  if (writing) { schedule(); return; }
  writing = true;
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify({ tables: STORE, ids: IDS }));
    renameSync(tmp, FILE);
  } finally { writing = false; }
}
function schedule() {
  if (!FILE || timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 150);
  timer.unref?.();
}
export const changed = schedule;
export const dbFile = FILE;
