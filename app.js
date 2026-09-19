const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const editor = $('#editor');
const preview = $('#preview');
const docName = $('#docName');
const toast = $('#toast');
const backdrop = $('#backdrop');
const fileInput = $('#fileInput');
const sheets = ['#plusMenu','#publishSheet','#headingMenu','#quoteMenu','#importMenu'];
let savedRange = null, hist = [], histI = -1, histLock = false, composing = false, saveTimer = null;
const ICON_EXTS = ['svg','png','webp','SVG','PNG','WEBP'];
function assetExists(url){
  return new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = url; });
}
async function probeFolder(stem, exts){
  const t = Date.now();
  for(const ext of exts){
    const url = stem + '.' + ext + '?v=' + t;
    if(await assetExists(url)) return url;
  }
  return stem + '.' + exts[0] + '?v=' + t;
}
function applyIcon(el, url){
  el.style.setProperty('--ui-icon', 'url("' + url + '")');
  if(!/\.svg(\?|$)/i.test(url)) el.classList.add('is-bitmap');
  else el.classList.remove('is-bitmap');
}
function setWash(kind, url){
  const el = document.querySelector('iframe.wash-' + kind);
  if(el && url) el.src = url;
}
function applyFolderManifest(man){
  $$('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    const meta = man.icons && man.icons[name];
    if(!name || !meta) return;
    applyIcon(el, 'icons/' + meta.file + '?v=' + meta.v);
  });
  const bg = man.backgrounds || {};
  setWash('light', 'backgrounds/' + (bg.light && bg.light.file ? bg.light.file : 'light.html') + '?v=' + ((bg.light && bg.light.v) || Date.now()));
  setWash('dark', 'backgrounds/' + (bg.dark && bg.dark.file ? bg.dark.file : 'dark.html') + '?v=' + ((bg.dark && bg.dark.v) || Date.now()));
}
async function bindFolderAssets(){
  try{
    const res = await fetch('assets-manifest.json?t=' + Date.now(), { cache: 'no-store' });
    if(res.ok){
      applyFolderManifest(await res.json());
      return;
    }
  }catch(e){}
  $$('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    if(!name) return;
    probeFolder('icons/' + name, ICON_EXTS).then(url => applyIcon(el, url));
  });
  const t = Date.now();
  setWash('light', 'backgrounds/light.html?v=' + t);
  setWash('dark', 'backgrounds/dark.html?v=' + t);
}
bindFolderAssets();
function applyScheme(){
  const tg = window.Telegram?.WebApp;
  const inTg = !!(tg && ((tg.initData && tg.initData.length) || tg.initDataUnsafe?.user?.id));
  const light = inTg && tg.colorScheme ? tg.colorScheme === 'light' : window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.classList.toggle('light', light);
  document.documentElement.classList.toggle('dark', !light);
  if(inTg){
    const header = light ? '#f8fbff' : '#12131c';
    tg?.setHeaderColor?.(header);
  }
}
applyScheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyScheme);
function getTg(){ return window.Telegram?.WebApp; }
function isInsideTelegram(){
  const tg = getTg();
  if(!tg) return false;
  if(tg.initData && tg.initData.length > 0) return true;
  return Boolean(tg.initDataUnsafe?.user?.id);
}
const inTg = isInsideTelegram();
const RAILWAY = 'https://mdtxtrt.up.railway.app';
function botApi(){
  return location.hostname.endsWith('railway.app') ? location.origin : RAILWAY;
}
let lastPage = localStorage.getItem('rmdtxtml_last_page') || '';
if (inTg) {
  const tg = getTg();
  document.body.classList.add('tg');
  tg.ready(); tg.expand();
  const applySafe = () => {
    const top = Math.max(tg.contentSafeAreaInset?.top || 0, tg.safeAreaInset?.top || 0, 72);
    document.documentElement.style.setProperty('--tg-top', top + 'px');
  };
  applySafe(); applyScheme();
  tg.onEvent?.('safeAreaChanged', applySafe);
  tg.onEvent?.('contentSafeAreaChanged', applySafe);
  tg.onEvent?.('themeChanged', applyScheme);
  tg.BackButton?.hide?.();
  tg.disableVerticalSwipes?.();
  tg.MainButton?.setText?.('Publicar');
  tg.MainButton?.show?.();
  tg.MainButton?.onClick?.(() => openPanel('#publishSheet', $('#publishBtn')));
}
function showToast(msg){
  toast.textContent = msg; toast.classList.add('on');
  clearTimeout(showToast.t); showToast.t = setTimeout(()=>toast.classList.remove('on'), 1600);
}
function openPanel(sel, anchor){
  const panel = $(sel);
  const ref = anchor || document.activeElement;
  const rect = ref?.getBoundingClientRect?.();
  sheets.forEach(s => { const el = $(s); el.classList.remove('on'); el.classList.remove('is-top'); });
  const placeTop = sel === '#importMenu' || sel === '#publishSheet';
  panel.classList.toggle('is-top', placeTop);
  if(placeTop && rect){
    panel.style.setProperty('--sheet-top', Math.round(rect.bottom + 8) + 'px');
  }else{
    panel.style.removeProperty('--sheet-top');
  }
  panel.style.visibility = 'hidden';
  panel.classList.add('on');
  const width = Math.min(panel.offsetWidth || 0, innerWidth - 28) || Math.min(280, innerWidth - 28);
  const center = rect ? rect.left + rect.width / 2 : innerWidth / 2;
  const left = Math.max(14, Math.min(innerWidth - width - 14, center - width / 2));
  panel.style.setProperty('--sheet-left', left + 'px');
  panel.style.setProperty('--sheet-origin', Math.max(20, Math.min(width - 20, center - left)) + 'px');
  panel.style.visibility = '';
  backdrop.classList.add('on');
  document.dispatchEvent(new Event('selectionchange'));
}
function closePanels(){
  sheets.forEach(s => { const el = $(s); el.classList.remove('on','is-top'); });
  backdrop.classList.remove('on');
  document.dispatchEvent(new Event('selectionchange'));
}
backdrop.addEventListener('click', closePanels);
function saveSel(){
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount) return;
  const n = sel.anchorNode;
  if(n && editor.contains(n)) savedRange = sel.getRangeAt(0).cloneRange();
}
function restoreSel(){
  editor.focus();
  const sel = window.getSelection();
  if(savedRange){ sel.removeAllRanges(); sel.addRange(savedRange); return; }
  const last = editor.lastElementChild;
  if(!last) return;
  const range = document.createRange();
  range.setStartAfter(last); range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
}
function pushHist(){
  if(histLock) return;
  const html = editor.innerHTML;
  if(hist[histI] === html) return;
  hist = hist.slice(0, histI + 1);
  hist.push(html); if(hist.length > 80) hist.shift();
  histI = hist.length - 1;
}
function applyHist(html){ histLock = true; editor.innerHTML = html; histLock = false; markDirty(); }
function histUndo(){ if(histI > 0){ histI--; applyHist(hist[histI]); } }
function histRedo(){ if(histI < hist.length - 1){ histI++; applyHist(hist[histI]); } }
function expandWord(){
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount || !sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  const text = r.startContainer; if(text.nodeType !== 3) return;
  const v = text.textContent, i = r.startOffset;
  let a = i, b = i;
  while(a > 0 && /\S/.test(v[a-1])) a--;
  while(b < v.length && /\S/.test(v[b])) b++;
  if(a === b) return;
  r.setStart(text, a); r.setEnd(text, b); sel.removeAllRanges(); sel.addRange(r);
  savedRange = r.cloneRange();
}
function exec(cmd, value=null){
  restoreSel(); expandWord();
  document.execCommand(cmd, false, value);
  saveSel(); pushHist(); markDirty();
}
function formatBlock(tag){
  restoreSel();
  const node = document.getSelection()?.anchorNode;
  const fromEl = node && (node.nodeType === 1 ? node : node.parentElement);
  const block = fromEl && fromEl.closest('p,h1,h2,h3,h4,h5,h6,blockquote,footer,div,li');
  const unwrapBold = el => {
    el.querySelectorAll('strong,b').forEach(n => {
      while(n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
      n.remove();
    });
  };
  const placeCaret = el => {
    const sel = window.getSelection();
    if(!sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange = range.cloneRange();
  };
  const currentKind = () => {
    if(!block || block === editor) return 'p';
    if(block.classList.contains('tg-footer') || block.tagName === 'FOOTER') return 'footer';
    return block.tagName.toLowerCase();
  };
  let nextKind = tag;
  if(currentKind() === tag) nextKind = 'p';
  const isFooter = nextKind === 'footer';
  const nextTag = isFooter ? 'p' : nextKind;
  const finish = el => {
    if(isFooter){ el.classList.add('tg-footer'); unwrapBold(el); }
    else {
      el.classList.remove('tg-footer');
      if(/^h[1-6]$/.test(nextKind)) unwrapBold(el);
    }
    placeCaret(el);
  };
  const replace = src => {
    const next = document.createElement(nextTag);
    next.innerHTML = src.innerHTML;
    src.replaceWith(next);
    finish(next);
  };
  if(!block || block === editor || block.tagName === 'LI'){
    document.execCommand('formatBlock', false, nextTag);
    const afterNode = document.getSelection()?.anchorNode;
    const afterEl = afterNode && (afterNode.nodeType === 1 ? afterNode : afterNode.parentElement);
    const after = afterEl && afterEl.closest('p,h1,h2,h3,h4,h5,h6,blockquote,footer,div');
    if(after && after !== editor){
      if(after.tagName.toLowerCase() !== nextTag) replace(after);
      else finish(after);
    }
  } else {
    replace(block);
  }
  saveSel(); pushHist(); markDirty(); closePanels();
}
function insertHTML(html){
  restoreSel();
  document.execCommand('insertHTML', false, html);
  saveSel(); pushHist(); markDirty(); closePanels();
}
function insertFeature(kind){
  const last = editor.lastElementChild;
  if(last){
    const range = document.createRange();
    range.setStartAfter(last); range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    savedRange = range.cloneRange();
  }
  if(kind === 'task') return insertHTML('<p>☐ Nova tarefa</p>');
  if(kind === 'table') return insertHTML('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>—</td><td>—</td></tr></tbody></table>');
  if(kind === 'expandquote') return insertHTML('<blockquote data-expandable="true"><p>Citação expansível 10.3</p></blockquote>');
  if(kind === 'details') return insertHTML('<details open><summary>Detalhes</summary><p>Conteúdo</p></details>');
  if(kind === 'document') return insertHTML('<div class="block-card" data-kind="document" data-file="tg://document?id=file_1"><div class="block-label">Documento</div>tg://document?id=file_1</div>');
  if(kind === 'button') return insertHTML('<div class="block-card" data-kind="buttons"><div class="block-label">Botões</div>Publicar · Mini App</div>');
}
function markDirty(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 400);
}
function saveLocal(){
  localStorage.setItem('rmdtxtml', JSON.stringify({name: docName.value, html: editor.innerHTML}));
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem('rmdtxtml') || 'null');
    if(d?.html){ editor.innerHTML = d.html; docName.value = d.name || 'Ideia'; }
  }catch{}
}
function setMode(mode){
  $('#editTab')?.classList.toggle('active', true);
  editor.classList.remove('off');
  preview?.classList.remove('on');
}
function escapeHTML(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function htmlToText(html){ const d = document.createElement('div'); d.innerHTML = html; return d.innerText; }
function htmlToMarkdown(html){
  const d = document.createElement('div'); d.innerHTML = html;
  const walk = n => {
    if(n.nodeType === 3) return n.textContent;
    if(n.nodeType !== 1) return '';
    const t = n.tagName.toLowerCase();
    const inner = Array.from(n.childNodes).map(walk).join('');
    if(t === 'strong' || t === 'b') return '**'+inner+'**';
    if(t === 'em' || t === 'i') return '*'+inner+'*';
    if(t === 'a') return '['+inner+']('+(n.getAttribute('href')||'')+')';
    if(/^h[1-6]$/.test(t)) return '\n'+'#'.repeat(+t[1])+' '+inner+'\n';
    if(t === 'p') return '\n'+inner+'\n';
    if(t === 'li') return '- '+inner+'\n';
    if(t === 'blockquote') return '\n> '+inner.trim()+'\n';
    return inner;
  };
  return walk(d).trim();
}
function mdToBasicHTML(md){
  return md.split(/\n{2,}/).map(b => {
    if(/^######\s/.test(b)) return '<h6>'+escapeHTML(b.replace(/^######\s/,''))+'</h6>';
    if(/^#####\s/.test(b)) return '<h5>'+escapeHTML(b.replace(/^#####\s/,''))+'</h5>';
    if(/^####\s/.test(b)) return '<h4>'+escapeHTML(b.replace(/^####\s/,''))+'</h4>';
    if(/^### /.test(b)) return '<h3>'+escapeHTML(b.slice(4))+'</h3>';
    if(/^## /.test(b)) return '<h2>'+escapeHTML(b.slice(3))+'</h2>';
    if(/^# /.test(b)) return '<h1>'+escapeHTML(b.slice(2))+'</h1>';
    if(/^> /.test(b)) return '<blockquote><p>'+escapeHTML(b.replace(/^> /gm,''))+'</p></blockquote>';
    return '<p>'+escapeHTML(b).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')+'</p>';
  }).join('');
}
function download(name, content, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click();
}
function telegraphNodes(html){
  const d = document.createElement('div'); d.innerHTML = html;
  const allow = new Set(['a','aside','b','blockquote','br','code','em','figcaption','figure','h3','h4','hr','i','iframe','img','li','ol','p','pre','s','strong','u','ul','video']);
  const conv = el => {
    if(el.nodeType === 3) return el.textContent;
    if(el.nodeType !== 1) return null;
    let tag = el.tagName.toLowerCase();
    if(tag === 'h1' || tag === 'h2') tag = 'h3';
    if(tag === 'h5' || tag === 'h6') tag = 'h4';
    if(tag === 'footer' || el.classList.contains('tg-footer')) tag = 'aside';
    if(tag === 'div' || tag === 'article' || tag === 'section') return Array.from(el.childNodes).map(conv).flat().filter(Boolean);
    if(!allow.has(tag)) return Array.from(el.childNodes).map(conv).flat().filter(Boolean);
    const node = {tag};
    if(tag === 'a') node.attrs = {href: el.getAttribute('href') || ''};
    const children = Array.from(el.childNodes).map(conv).flat().filter(v => v !== null && v !== '');
    if(children.length) node.children = children;
    return node;
  };
  return Array.from(d.childNodes).map(conv).flat().filter(Boolean);
}
function toRichHTML(root){
  const inline = n => {
    if(n.nodeType === 3) return escapeHTML(n.textContent||'');
    if(n.nodeType !== 1) return '';
    const t = n.tagName.toLowerCase();
    const inner = Array.from(n.childNodes).map(inline).join('');
    if(t==='strong'||t==='b') return '<b>'+inner+'</b>';
    if(t==='em'||t==='i') return '<i>'+inner+'</i>';
    if(t==='u') return '<u>'+inner+'</u>';
    if(t==='s'||t==='del') return '<s>'+inner+'</s>';
    if(t==='code') return '<code>'+inner+'</code>';
    if(t==='a') return '<a href="'+escapeHTML(n.getAttribute('href')||'')+'">'+inner+'</a>';
    if(t==='br') return '<br/>';
    return inner;
  };
  const blocks = [];
  Array.from(root.childNodes).forEach(n => {
    if(n.nodeType === 3){ if((n.textContent||'').trim()) blocks.push('<p>'+escapeHTML(n.textContent)+'</p>'); return; }
    if(n.nodeType !== 1) return;
    const t = n.tagName.toLowerCase();
    const inner = Array.from(n.childNodes).map(inline).join('');
    if(/^h[1-6]$/.test(t)) blocks.push('<'+t+'>'+inner+'</'+t+'>');
    else if(t==='footer' || n.classList.contains('tg-footer')) blocks.push('<footer>'+inner+'</footer>');
    else if(t==='blockquote'){
      const exp = n.getAttribute('data-expandable') === 'true';
      blocks.push(exp ? '<blockquote expandable>'+inner+'</blockquote>' : '<blockquote>'+inner+'</blockquote>');
    } else if(t==='ul'||t==='ol'){
      blocks.push('<'+t+'>'+Array.from(n.children).map(li => '<li>'+inline(li)+'</li>').join('')+'</'+t+'>');
    } else if(t==='pre') blocks.push('<pre>'+escapeHTML(n.innerText)+'</pre>');
    else if(t==='table') blocks.push('<p>'+escapeHTML(n.innerText.replace(/\s+/g,' ').trim())+'</p>');
    else blocks.push('<p>'+inner+'</p>');
  });
  return blocks.join('') || '<p></p>';
}
function buildRich(){
  return {
    method: 'sendRichMessage',
    title: docName.value || 'Ideia',
    rich_message: { html: toRichHTML(editor), skip_entity_detection: true },
    markdown: htmlToMarkdown(editor.innerHTML)
  };
}
async function telegraphCall(method, body){
  const res = await fetch('https://api.telegra.ph/'+method, {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams(body)
  });
  const json = await res.json();
  if(!json.ok) throw new Error(json.error || method);
  return json.result;
}
function buildTelegraph(){
  return {method:'createPage', title: docName.value || 'Ideia', content: telegraphNodes(editor.innerHTML)};
}
function showPayload(obj){
  const box = $('#payloadBox'); box.hidden = false; box.textContent = JSON.stringify(obj, null, 2); return obj;
}
editor.addEventListener('input', ()=>{ if(!composing){ markDirty(); pushHist(); }});
editor.addEventListener('compositionstart', ()=> composing = true);
editor.addEventListener('compositionend', ()=>{ composing = false; markDirty(); pushHist(); });
editor.addEventListener('keyup', saveSel);
editor.addEventListener('mouseup', saveSel);
editor.addEventListener('paste', e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});
document.addEventListener('selectionchange', ()=>{
  saveSel();
  const node = document.getSelection()?.anchorNode;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const headingEl = el && el.closest('h1,h2,h3,h4,h5,h6,footer,.tg-footer');
  const block = el && el.closest('p,h1,h2,h3,h4,h5,h6,blockquote,footer,div');
  let kind = 'p';
  if(block){
    if(block.classList.contains('tg-footer') || block.tagName === 'FOOTER') kind = 'footer';
    else kind = block.tagName.toLowerCase();
  }
  $$('#typebar [data-cmd]').forEach(btn => {
    try{
      let on = document.queryCommandState(btn.dataset.cmd);
      if(btn.dataset.cmd === 'bold' && headingEl && !el.closest('strong,b')) on = false;
      btn.classList.toggle('on', on);
    }catch{}
  });
  $('#quoteBtn')?.classList.toggle('on', !!(el && el.closest('blockquote')) || $('#quoteMenu')?.classList.contains('on'));
  $('#headingBtn')?.classList.toggle('on', !!(headingEl || $('#headingMenu')?.classList.contains('on')));
  $('#linkBtn')?.classList.toggle('on', !!(el && el.closest('a')));
  $('#plusBtn')?.classList.toggle('on', $('#plusMenu')?.classList.contains('on'));
  $$('#headingMenu [data-block]').forEach(btn => btn.classList.toggle('is-current', btn.dataset.block === kind));
});
$('#typebar').addEventListener('mousedown', e => e.preventDefault());
$$('#typebar [data-cmd]').forEach(btn => btn.addEventListener('click', ()=>exec(btn.dataset.cmd)));
$$('#typebar [data-block], #headingMenu [data-block], #quoteMenu [data-block]').forEach(btn => btn.addEventListener('click', ()=>formatBlock(btn.dataset.block)));
$$('#plusMenu [data-insert], #quoteMenu [data-insert]').forEach(btn => btn.addEventListener('click', ()=>insertFeature(btn.dataset.insert)));
$('#linkBtn').addEventListener('click', ()=>{
  restoreSel(); expandWord();
  const url = prompt('URL','https://'); if(!url) return;
  const sel = window.getSelection();
  if(!sel || sel.isCollapsed) insertHTML('<a href="'+escapeHTML(url)+'">'+escapeHTML(url)+'</a>');
  else exec('createLink', url);
});
function flashBtn(btn){
  if(!btn) return;
  btn.classList.remove('is-flash');
  void btn.offsetWidth;
  btn.classList.add('is-flash');
  clearTimeout(btn._flash);
  btn._flash = setTimeout(()=>btn.classList.remove('is-flash'), 1400);
}
$('#undoBtn').addEventListener('click', ()=>{ histUndo(); flashBtn($('#undoBtn')); });
$('#redoBtn').addEventListener('click', ()=>{ histRedo(); flashBtn($('#redoBtn')); });
$('#undoBtn').addEventListener('mousedown', e => e.preventDefault());
$('#redoBtn').addEventListener('mousedown', e => e.preventDefault());
$('#plusBtn').addEventListener('click', e=>openPanel('#plusMenu', e.currentTarget));
$('#headingBtn')?.addEventListener('click', e=>openPanel('#headingMenu', e.currentTarget));
$('#quoteBtn')?.addEventListener('click', e=>openPanel('#quoteMenu', e.currentTarget));
$('#publishBtn').addEventListener('click', e=>openPanel('#publishSheet', e.currentTarget));
$('#brandBtn')?.addEventListener('click', e=>openPanel('#importMenu', e.currentTarget));
$('#editTab').addEventListener('click', ()=>setMode('edit'));
$('#importMdBtn')?.addEventListener('click', ()=>{ fileInput.accept='.md,text/markdown'; fileInput.click(); closePanels(); });
$('#importTxtBtn')?.addEventListener('click', ()=>{ fileInput.accept='.txt,text/plain'; fileInput.click(); closePanels(); });
$('#exportTxtBtn')?.addEventListener('click', ()=>{ download((docName.value||'doc')+'.txt', htmlToText(editor.innerHTML), 'text/plain'); closePanels(); });
$('#exportMdBtn')?.addEventListener('click', ()=>{ download((docName.value||'doc')+'.md', htmlToMarkdown(editor.innerHTML), 'text/markdown'); closePanels(); });
$('#telegramPublishBtn')?.addEventListener('click', async ()=>{
  const p = showPayload(buildRich());
  const initData = getTg()?.initData || '';
  if(!initData){
    const raw = JSON.stringify(p);
    if(inTg && getTg()?.sendData && new TextEncoder().encode(raw).length <= 4096){
      getTg().sendData(raw); showToast('sendData Mini App'); return;
    }
    showToast('Abra pelo bot no Telegram'); return;
  }
  try{
    const res = await fetch(botApi()+'/api/telegram/send', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ initData, html: p.rich_message.html })
    });
    const json = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(json.error || 'Falha no Telegram');
    showToast(json.via === 'sendRichMessage' ? 'sendRichMessage 10.3' : (json.via || 'Enviado'));
  }catch(err){
    const raw = JSON.stringify(p);
    if(inTg && getTg()?.sendData && new TextEncoder().encode(raw).length <= 4096){
      getTg().sendData(raw); showToast('sendData Mini App'); return;
    }
    showToast(err.message || 'Falha no Telegram');
  }
});
$('#telegraphPublishBtn')?.addEventListener('click', async ()=>{
  const payload = showPayload(buildTelegraph());
  try{
    let token = localStorage.getItem('rmdtxtml_tgph') || '';
    if(!token){
      const acc = await telegraphCall('createAccount', {short_name:'MDTXTRT', author_name:'MDTXTRT'});
      token = acc.access_token;
      localStorage.setItem('rmdtxtml_tgph', token);
    }
    const page = await telegraphCall('createPage', {
      access_token: token,
      title: payload.title,
      author_name: 'MDTXTRT',
      content: JSON.stringify(payload.content),
      return_content: 'false'
    });
    lastPage = page.url;
    localStorage.setItem('rmdtxtml_last_page', lastPage);
    showToast('Telegraph no ar');
    if(inTg) getTg().openLink(page.url, {try_instant_view:true});
    else window.open(page.url, '_blank','noopener');
  }catch(err){ showToast(err.message || 'Telegraph falhou'); }
});
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0]; if(!file) return;
  const text = await file.text();
  const snap = text.match(/<!--RMDTXTML_SNAPSHOT:([A-Za-z0-9+/=]+)-->/);
  if(snap){
    try{
      const data = JSON.parse(decodeURIComponent(escape(atob(snap[1]))));
      editor.innerHTML = data.html || ''; docName.value = data.name || 'Ideia'; markDirty(); closePanels(); fileInput.value=''; return;
    }catch{}
  }
  docName.value = file.name.replace(/\.(md|txt)$/i,'');
  editor.innerHTML = /\.md$/i.test(file.name) ? mdToBasicHTML(text) : '<p>'+escapeHTML(text).replace(/\n/g,'<br>')+'</p>';
  markDirty(); closePanels(); fileInput.value='';
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && backdrop.classList.contains('on')){ closePanels(); return; }
  if(!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if(k==='b'){ e.preventDefault(); exec('bold'); }
  if(k==='i'){ e.preventDefault(); exec('italic'); }
  if(k==='u'){ e.preventDefault(); exec('underline'); }
  if(k==='z' && !e.shiftKey){ e.preventDefault(); histUndo(); flashBtn($('#undoBtn')); }
  if(k==='z' && e.shiftKey || k==='y'){ e.preventDefault(); histRedo(); flashBtn($('#redoBtn')); }
});
const vv = window.visualViewport;
const fit = ()=>{
  const vh = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  document.documentElement.style.setProperty('--kb', Math.max(0, window.innerHeight - vh - top) + 'px');
  document.documentElement.style.setProperty('--vv-h', Math.max(0, vh) + 'px');
};
fit();
vv?.addEventListener('resize', fit);
vv?.addEventListener('scroll', fit);
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
if(inTg) getTg()?.onEvent?.('viewportChanged', fit);
loadLocal(); pushHist();
const canvasEl = document.getElementById('canvas');
canvasEl?.addEventListener('scroll', () => {
  document.documentElement.style.setProperty('--top-blur', String(Math.min(1, canvasEl.scrollTop / 52)));
}, {passive:true});
