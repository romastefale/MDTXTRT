// Tema claro/escuro, cores do navegador e do Telegram e ícones.
import { S } from "./state.js";
import { THEME_KEY } from "./constants.js";
import { all, one } from "./dom.js";
import { scheme } from "./main.js";

export function applyAssets(){
  all('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    el.style.setProperty('--ui-icon', 'url("icons/' + name + '.svg")');
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
export function applyScheme(mode=resolvedTheme()){
  const next=mode==='light'?'light':'dark',light=next==='light';
  const root=document.documentElement,color=light?'#8b82e6':'#151137';
  root.classList.remove(light?'dark':'light');
  root.classList.add(next);
  root.dataset.theme=next;
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
export function setTheme(mode){
  if(mode!=='light'&&mode!=='dark')throw new Error('Tema inválido');
  S.themePreference=mode;
  try{localStorage.setItem(THEME_KEY,mode);}catch{}
  window.location.reload();
}
