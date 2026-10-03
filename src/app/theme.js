// Tema claro/escuro, cores do navegador e do Telegram e ícones.
import { S } from "./state.js";
import { THEME_KEY } from "./constants.js";
import { all, one } from "./dom.js";
import { scheme } from "./main.js";
import { storageBlocked } from "./storage.js";

export function applyAssets(){
  all('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    el.style.setProperty('--ui-icon', 'url("icons/' + name + '.svg?v=2")');
  });
}
export function getTg(){ return window.Telegram?.WebApp; }
export function resolvedTheme(){
  if(S.themePreference)return S.themePreference;
  const tg=getTg();
  if(S.session==='ready'&&(tg?.colorScheme==='light'||tg?.colorScheme==='dark'))return tg.colorScheme;
  return scheme.matches?'light':'dark';
}
export function syncBrowserChrome(mode,color){
  const root=document.documentElement,schemeMeta=one('#colorScheme'),themeMeta=one('#themeColor');
  root.style.colorScheme=mode;
  if(schemeMeta)schemeMeta.setAttribute('content',mode);
  if(themeMeta){
    const replacement=themeMeta.cloneNode();
    replacement.setAttribute('content',color);
    themeMeta.replaceWith(replacement);
  }
}
// Cor sólida da borda do tema já aplicado (--edge em styles.css), em #rrggbb, que é
// o formato que o Telegram aceita. É a mesma cor das faixas .edge-top/.edge-bot, que
// o Safari lê para tingir as barras dele; theme-color e Telegram recebem igual.
const EDGE_FALLBACK={light:'#8b82e6',dark:'#151137'};
function hexColor(value){
  const v=String(value||'').trim().toLowerCase();
  if(/^#[0-9a-f]{6}$/.test(v))return v;
  const short=/^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if(short)return '#'+short.slice(1).map(c=>c+c).join('');
  const rgb=/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*1(?:\.0*)?\s*)?\)$/.exec(v);
  return rgb?'#'+rgb.slice(1).map(n=>Math.min(255,Number(n)).toString(16).padStart(2,'0')).join(''):'';
}
export function edgeColor(mode){
  return hexColor(getComputedStyle(document.documentElement).getPropertyValue('--edge'))||EDGE_FALLBACK[mode==='light'?'light':'dark'];
}
export function applyScheme(mode=resolvedTheme()){
  const next=mode==='light'?'light':'dark',light=next==='light';
  const root=document.documentElement;
  root.classList.remove(light?'dark':'light');
  root.classList.add(next);
  root.dataset.theme=next;
  const color=edgeColor(next);
  syncBrowserChrome(next,color);
  const statusMeta=one('#statusBarStyle');
  if(statusMeta)statusMeta.content=light?'default':'black-translucent';
  const btn=one('#themeBtn');
  if(btn){
    const icon=btn.querySelector('[data-icon]');
    if(icon)icon.setAttribute('data-icon',light?'dark_mode':'light_mode');
    const label=light?'Ativar modo escuro':'Ativar modo claro';
    btn.setAttribute('aria-label',label);btn.title=label;
  }
  applyAssets();
  const tg=getTg();
  if(S.session==='ready'&&tg){
    tg.setHeaderColor(color);
    tg.setBackgroundColor(color);
    tg.setBottomBarColor(color);
  }
}
// App instalado na tela de início (iOS: navigator.standalone; demais: display-mode).
// Lá a barra de status segue o apple-mobile-web-app-status-bar-style lido na
// abertura, então a troca de tema continua recarregando a página.
export function isInstalledApp(){
  return navigator.standalone===true||Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
}
export function setTheme(mode){
  if(mode!=='light'&&mode!=='dark')throw new Error('Tema inválido');
  S.themePreference=mode;
  // Com o armazenamento bloqueado o tema não sobrevive ao recarregamento e o texto
  // da sessão se perderia: o tema muda aqui mesmo, sem recarregar.
  if(storageBlocked()){applyScheme();return;}
  try{localStorage.setItem(THEME_KEY,mode);}catch{}
  if(isInstalledApp()){window.location.reload();return;}
  applyScheme(mode);
}
