// Versão estática (GitHub Pages): sem Telegram e sem servidor. O index.html da versão estática
// define window.MDTXTRT_STATIC; sem isso o app roda como Mini App (Telegram/Railway), como antes.
export const STATIC=typeof window!=='undefined'&&window.MDTXTRT_STATIC===true;
