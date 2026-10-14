
import { S } from "./state.js";
import { THEME_KEY } from "./constants.js";
import { all, one } from "./dom.js";
import { scheme } from "./main.js";
import { storageBlocked } from "./storage.js";
import { STATIC } from "./mode.js";

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



const EDGE_FALLBACK=STATIC?{light:'#8b82e6',dark:'#1b1646'}:{light:'#d9d2f6',dark:'#171a26'};
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
// Safari 26 amostra a cor das barras de um elemento fixo real que encosta na borda de cima. Depois de trocar o tema,
// 11px -> 12px -> 11px em dois quadros força uma nova amostra (mesma técnica do repositório HTML; não verificada aqui).
let sampleRefreshing=false;
function refreshSafariChromeSample(){
  if(!STATIC||!document.body)return;
  if(!document.querySelector('[data-safari-chrome-sample]')){
    const sample=document.createElement('div');
    sample.className='safari-chrome-sample';
    sample.dataset.safariChromeSample='';
    sample.setAttribute('aria-hidden','true');
    document.body.prepend(sample);
  }
  if(sampleRefreshing)return;
  sampleRefreshing=true;
  const root=document.documentElement;
  root.dataset.chromeSampleRefresh='';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{delete root.dataset.chromeSampleRefresh;sampleRefreshing=false;}));
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
  // Versão estática: a borda clara é roxa (#8b82e6), então a barra de status fica translúcida/branca nos dois modos.
  if(statusMeta)statusMeta.content=light&&!STATIC?'default':'black-translucent';
  const btn=one('#themeBtn');
  if(btn){
    const icon=btn.querySelector('[data-icon]');
    if(icon)icon.setAttribute('data-icon',light?'dark_mode':'light_mode');
    const label=light?'Ativar modo escuro':'Ativar modo claro';
    btn.setAttribute('aria-label',label);btn.title=label;
    const text=one('#themeLabel');if(text)text.textContent=light?'Tema escuro':'Tema claro';
  }
  applyAssets();
  refreshSafariChromeSample();
  const tg=getTg();
  if(S.session==='ready'&&tg){
    tg.setHeaderColor(color);
    tg.setBackgroundColor(color);
    tg.setBottomBarColor(color);
  }
}



export function isInstalledApp(){
  return navigator.standalone===true||Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
}
export function setTheme(mode){
  if(mode!=='light'&&mode!=='dark')throw new Error('Tema inválido');
  S.themePreference=mode;
  
  
  if(storageBlocked()){applyScheme();return;}
  try{localStorage.setItem(THEME_KEY,mode);}catch{}
  if(isInstalledApp()){window.location.reload();return;}
  applyScheme(mode);
}
