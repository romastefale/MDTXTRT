// URL pública do Mini App. tgcloud: preencha CONFIGURED com https://app<app_id>.tgcloud.ai/ após o primeiro `tgcloud push`.
// No Railway a URL vem da variável de ambiente MINI_APP_URL (a plataforma tgcloud não tem `process`).
const CONFIGURED = '';
export const MINI_APP_URL = CONFIGURED || (typeof process !== 'undefined' && process.env?.MINI_APP_URL) || '';

export function miniAppUrl(params = {}) {
  if (!MINI_APP_URL) throw new Error('MINI_APP_URL não configurada em tgcloud/lib/config.js');
  const url = new URL(MINI_APP_URL);
  if (url.protocol !== 'https:') throw new Error('MINI_APP_URL deve usar HTTPS');
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
  return url.href;
}
