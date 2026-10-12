// URL pública do Mini App hospedado pela plataforma: https://app<app_id>.tgcloud.ai/
// O app_id é a parte pública do token (app<id>:<secret>). Preencher após o primeiro `tgcloud push`.
export const MINI_APP_URL = '';

export function miniAppUrl(params = {}) {
  if (!MINI_APP_URL) throw new Error('MINI_APP_URL não configurada em tgcloud/lib/config.js');
  const url = new URL(MINI_APP_URL);
  if (url.protocol !== 'https:') throw new Error('MINI_APP_URL deve usar HTTPS');
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
  return url.href;
}
