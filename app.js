const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const editor = $('#editor');
const docName = $('#docName');
const toast = $('#toast');
const backdrop = $('#backdrop');
const fileInput = $('#fileInput');
let dest = 'telegram';
let inTg = false, session = 'browser', busy = false;
const sheets = ['#plusMenu','#headingMenu','#quoteMenu','#listMenu','#importMenu','#exportMenu','#findMenu'];
let savedRange = null, hist = [], histI = -1, histLock = false, composing = false, saveTimer = null, telegraphPath = '', docId = crypto.randomUUID(), importedMd = '', importedTxt = '', importedHtml = '', mediaFile = null;
function applyAssets(){
  $$('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    el.style.setProperty('--ui-icon', 'url("icons/' + name + '.svg")');
  });
}
applyAssets();
function applyScheme(){
  const tg = isInsideTelegram() ? window.Telegram.WebApp : null;
  const light = tg?.colorScheme ? tg.colorScheme === 'light' : window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.classList.toggle('light', light);
  document.documentElement.classList.toggle('dark', !light);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f8fbff' : '#000000');
  window.dispatchEvent(new CustomEvent('mdtxtrt:themechange', {detail:{scheme:light?'light':'dark'}}));
  if(tg){
    const header = light ? '#f8fbff' : '#000000';
    tg.setHeaderColor?.(header);
    tg.setBackgroundColor?.(header);
    tg.setBottomBarColor?.(header);
  }
}
applyScheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyScheme);
function getTg(){ return window.Telegram?.WebApp; }
function isInsideTelegram(){ return inTg; }
const API = 'https://mdtxtrt.up.railway.app';
async function verifyTelegram(){
  const initData=getTg()?.initData;
  if(!initData)return;
  session='pending';
  try{
    const res=await fetch(API+'/api/telegram/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData})});
    if(!res.ok)throw new Error('Sessão Telegram inválida ou expirada');
    setupTelegram();
  }catch(err){session='invalid';showToast(err.message||'Não foi possível validar a sessão Telegram');}
}
function setupTelegram(){
  inTg=true;session='ready';
  const tg = getTg();
  document.body.classList.add('tg');
  tg.ready(); tg.expand();
  if(!tg.isFullscreen)tg.requestFullscreen?.();
  const applySafe = () => {
    const safe = tg.safeAreaInset?.top || 0;
    const top = tg.isFullscreen ? Math.max(safe + 52, tg.contentSafeAreaInset?.top || 0) : Math.max(safe, tg.contentSafeAreaInset?.top || 0);
    document.documentElement.style.setProperty('--tg-top', top + 'px');
    document.documentElement.style.setProperty('--tg-bottom', Math.max(tg.contentSafeAreaInset?.bottom || 0, tg.safeAreaInset?.bottom || 0) + 'px');
  };
  applySafe(); applyScheme();
  tg.onEvent?.('safeAreaChanged', applySafe);
  tg.onEvent?.('contentSafeAreaChanged', applySafe);
  tg.onEvent?.('fullscreenChanged', ()=>{applySafe();fit();});
  tg.onEvent?.('viewportChanged', fit);
  tg.onEvent?.('themeChanged', applyScheme);
  tg.BackButton?.hide?.();
  tg.disableVerticalSwipes?.();
  tg.MainButton?.hide?.();
}
function showToast(msg){
  toast.textContent = msg; toast.classList.add('on');
  clearTimeout(showToast.t); showToast.t = setTimeout(()=>toast.classList.remove('on'), 1600);
}
function setDestination(value, notify=true){
  dest = value;
  const btn = $('#destBtn');
  const name = dest === 'telegram' ? 'Telegram' : 'Telegraph';
  const icon = btn.querySelector('[data-icon]');
  icon.setAttribute('data-icon', dest === 'telegram' ? 'telegram' : 'document');
  btn.setAttribute('aria-label', 'Destino: ' + name);
  btn.setAttribute('aria-pressed', String(dest === 'telegraph'));
  btn.classList.toggle('active', dest === 'telegraph');
  btn.title = 'Destino: ' + name;
  applyAssets();
  $$('#headingMenu [data-block]').forEach(item => {
    item.hidden = dest === 'telegraph' && !['p','h3','h4','footer'].includes(item.dataset.block);
  });
  $('#quoteMenu [data-insert="expandquote"]').hidden = dest === 'telegraph';
  $$('[data-tg="no"]').forEach(item => item.hidden = dest === 'telegraph');
  $$('[data-telegraph="only"]').forEach(item => item.hidden = dest !== 'telegraph');
  document.body.dataset.destination = dest;
  closePanels();
  saveLocal();
  if(notify) showToast('Destino: ' + name);
}
function openPanel(sel, anchor){
  const panel = $(sel);
  const ref = anchor || document.activeElement;
  const rect = ref?.getBoundingClientRect?.();
  sheets.forEach(s => { const el = $(s); el.classList.remove('on'); el.classList.remove('is-top'); });
  const placeTop = sel === '#importMenu' || sel === '#exportMenu' || sel === '#findMenu';
  panel.classList.toggle('is-top', placeTop);
  if(placeTop && rect){
    panel.style.setProperty('--sheet-top', Math.round(rect.bottom + 8) + 'px');
  }else{
    panel.style.removeProperty('--sheet-top');
  }
  panel.style.visibility = 'hidden';
  panel.classList.add('on');
  const list = panel.querySelector('.menu-list');
  if(list) list.scrollTop = 0;
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
  if(!sel) return;
  if(savedRange && editor.contains(savedRange.startContainer) && editor.contains(savedRange.endContainer)){ sel.removeAllRanges(); sel.addRange(savedRange); return; }
  const last = editor.lastElementChild;
  const range = document.createRange();
  if(last) range.setStartAfter(last);
  else range.selectNodeContents(editor);
  range.collapse(true);
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
function applyHist(html){ histLock = true; editor.innerHTML = html; savedRange=null; restoreSel(); saveSel(); histLock = false; markDirty(); }
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
  if(cmd === 'insertUnorderedList') return toggleList();
  const tag = {bold:'strong',italic:'em',underline:'u',strike:'s',mark:'mark',sub:'sub',sup:'sup',spoiler:'tg-spoiler',code:'code',math:'tg-math',createLink:'a'}[cmd];
  if(!tag) throw new Error('Ação de edição indisponível');
  restoreSel(); expandWord();
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount) throw new Error('Selecione o texto para formatar');
  const range = sel.getRangeAt(0);
  if(range.collapsed){
    const mark=document.createElement(tag);if(value)mark.setAttribute('href',value);
    mark.append(document.createElement('br'));range.insertNode(mark);range.selectNodeContents(mark);range.collapse(false);
  }else{
    const start=document.createComment(''),end=document.createComment('');
    const tail=range.cloneRange();tail.collapse(false);tail.insertNode(end);
    const head=range.cloneRange();head.collapse(true);head.insertNode(start);
    range.setStartAfter(start);range.setEndBefore(end);
    const walk=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT),texts=[];let text;
    while((text=walk.nextNode()))if(text.length&&range.intersectsNode(text))texts.push(text);
    const remove=cmd!=='createLink'&&texts.length&&texts.every(text=>text.parentElement.closest(tag));
    if(remove){
      for(const [marker,before] of [[start,true],[end,false]]){
        const mark=marker.parentElement?.closest(tag);if(!mark||!editor.contains(mark))continue;
        const part=document.createRange();part.selectNodeContents(mark);
        if(before)part.setEndBefore(marker);else part.setStartAfter(marker);
        const content=part.extractContents();
        if(content.textContent||content.querySelector('*')){const copy=mark.cloneNode(false);copy.append(content);if(before)mark.before(copy);else mark.after(copy);}
      }
      range.setStartAfter(start);range.setEndBefore(end);
      for(const mark of [...editor.querySelectorAll(tag)])if(range.intersectsNode(mark))mark.replaceWith(...mark.childNodes);
    }else{
      for(const text of texts){const active=text.parentElement.closest(tag);if(active){if(value)active.setAttribute('href',value);continue;}
        const mark=document.createElement(tag);if(value)mark.setAttribute('href',value);text.replaceWith(mark);mark.append(text);
      }
    }
    range.setStartAfter(start);range.setEndBefore(end);start.remove();end.remove();
  }
  sel.removeAllRanges();sel.addRange(range);
  saveSel(); pushHist(); markDirty();
}
function normalizeBlocks(){
  const sel=window.getSelection(),range=sel?.rangeCount?sel.getRangeAt(0):null;
  if(!range || !editor.contains(range.commonAncestorContainer))return;
  const start=[range.startContainer,range.startOffset,editor.childNodes[range.startOffset]],end=[range.endContainer,range.endOffset,editor.childNodes[range.endOffset]];
  let p=null;
  const blocks=new Set('P DIV H1 H2 H3 H4 H5 H6 BLOCKQUOTE FOOTER ASIDE PRE UL OL TABLE FIGURE DETAILS HR TG-MAP TG-COLLAGE TG-SLIDESHOW TG-MATH-BLOCK TG-BUTTON-ROW'.split(' '));
  for(const node of [...editor.childNodes]){
    if(node.nodeType===1&&blocks.has(node.tagName)){p=null;continue;}
    if(!p){p=document.createElement('p');editor.insertBefore(p,node);}
    p.append(node);
  }
  for(const [point,[node,offset,next]] of [['Start',start],['End',end]]){
    if(node===editor){if(next?.parentNode)range['set'+point+'Before'](next);else range['set'+point](editor,editor.childNodes.length);}
    else range['set'+point](node,offset);
  }
  sel.removeAllRanges();sel.addRange(range);saveSel();
}
function toggleList(type='ul'){
  restoreSel();normalizeBlocks();
  const sel=window.getSelection(),range=sel?.rangeCount?sel.getRangeAt(0):null;
  if(!range || !editor.contains(range.commonAncestorContainer))throw new Error('Selecione o trecho da lista');
  const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const list=node?.closest('ul,ol');let last;
  if(list&&editor.contains(list)){
    if(list.localName===type){
      const frag=document.createDocumentFragment();
      for(const li of [...list.children]){last=document.createElement('p');while(li.firstChild)last.append(li.firstChild);frag.append(last);}
      list.replaceWith(frag);
    }else{const next=document.createElement(type);while(list.firstChild)next.append(list.firstChild);list.replaceWith(next);last=next.lastElementChild;}
  }else{
    const selected=[...editor.children].filter(el=>range.intersectsNode(el));
    if(selected.some(el=>!['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','FOOTER'].includes(el.tagName)))throw new Error('Selecione parágrafos para criar a lista');
    const ul=document.createElement(type);
    if(selected.length){selected[0].before(ul);for(const block of selected){last=document.createElement('li');while(block.firstChild)last.append(block.firstChild);ul.append(last);block.remove();}}
    else{last=document.createElement('li');last.append(document.createElement('br'));ul.append(last);range.insertNode(ul);}
  }
  if(last){range.selectNodeContents(last);range.collapse(false);sel.removeAllRanges();sel.addRange(range);}
  saveSel();pushHist();markDirty();closePanels();
}
function formatBlock(tag){
  restoreSel();normalizeBlocks();
  const node = document.getSelection()?.anchorNode;
  const fromEl = node && (node.nodeType === 1 ? node : node.parentElement);
  const found = fromEl && fromEl !== editor ? fromEl.closest('p,h1,h2,h3,h4,h5,h6,blockquote,footer,div,li') : null;
  const block = found && editor.contains(found) ? found : null;
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
    const next = document.createElement(nextTag);
    if(block && block.tagName === 'LI'){
      while(block.firstChild) next.append(block.firstChild);
      block.append(next);
    }else if(block && block !== editor){
      while(block.firstChild) next.append(block.firstChild);
      block.replaceWith(next);
    }else{
      next.append(document.createElement('br'));
      const range=document.getSelection()?.rangeCount?document.getSelection().getRangeAt(0):null;
      if(range && editor.contains(range.commonAncestorContainer)) range.insertNode(next); else editor.append(next);
    }
    finish(next);
  } else {
    replace(block);
  }
  saveSel(); pushHist(); markDirty(); closePanels();
}
function insertHTML(html, asBlock=false){
  restoreSel();
  const sel=window.getSelection(),range=sel?.rangeCount?sel.getRangeAt(0):null;
  if(!range || !editor.contains(range.commonAncestorContainer)) throw new Error('Posicione o cursor no texto');
  const t=document.createElement('template'); t.innerHTML=html;
  const frag=t.content;
  if(asBlock){
    range.deleteContents();
    let node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    let block=node?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,footer,aside,div,li,ul,ol,table,figure,details,tg-map,tg-collage,tg-slideshow,tg-math-block');
    while(block&&block.parentElement!==editor)block=block.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,blockquote,footer,aside,div,li,ul,ol,table,figure,details,tg-map,tg-collage,tg-slideshow,tg-math-block');
    if(block?.tagName==='LI')block=block.parentElement;
    if(block&&block.parentElement===editor&&['P','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','FOOTER','ASIDE','DIV'].includes(block.tagName)){
      const left=range.cloneRange(),right=range.cloneRange();
      left.selectNodeContents(block);left.setEnd(range.startContainer,range.startOffset);
      right.selectNodeContents(block);right.setStart(range.startContainer,range.startOffset);
      const before=left.cloneContents(),after=right.cloneContents();
      const meaningful=part=>Boolean(part.textContent||part.querySelector('img,video,audio,iframe,input,tg-button,tg-map,hr'))||[...part.childNodes].some(child=>child.nodeType===1&&child.tagName!=='BR');
      const a=meaningful(before)?block.cloneNode(false):null,b=meaningful(after)?block.cloneNode(false):null;
      if(a)a.append(before);if(b)b.append(after);
      const inserted=frag.lastChild;
      if(a)block.before(a);block.before(frag);if(b)block.before(b);block.remove();
      if(inserted){range.setStartAfter(inserted);range.collapse(true);sel.removeAllRanges();sel.addRange(range);}
      saveSel();pushHist();markDirty();closePanels();return;
    }
    if(block&&block.parentElement===editor){range.setStartAfter(block);range.collapse(true);}
  }
  range.deleteContents();
  const last=frag.lastChild;
  range.insertNode(frag);
  if(last){range.setStartAfter(last);range.collapse(true);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);}
  saveSel(); pushHist(); markDirty(); closePanels();
}
function mediaTag(url){
  const path = (()=>{try{return new URL(url).pathname.toLowerCase();}catch{return '';}})();
  return /\.(mp4|mov|webm|m4v|gif)$/.test(path) ? 'video' : 'img';
}
function askUrl(label){
  const value = prompt(label, 'https://');
  if(!value) return '';
  try{
    const url = new URL(value.trim());
    if(!['http:','https:','tg:'].includes(url.protocol)) throw new Error();
    return url.href;
  }catch{
    showToast('Use um link válido');
    return '';
  }
}
function mediaUrl(){
  const value = prompt('Link da mídia', 'https://');
  if(!value) return '';
  try{
    const url = new URL(value.trim());
    if(!['http:','https:'].includes(url.protocol)) throw new Error();
    return url.href;
  }catch{
    showToast('A mídia precisa usar HTTP ou HTTPS');
    return '';
  }
}
function figure(kind){
  const url = mediaUrl();
  if(!url) return;
  const caption = prompt('Legenda', '') || '';
  const credit = caption ? prompt('Crédito', '') || '' : '';
  const cap = caption ? '<figcaption>'+escapeHTML(caption)+(credit?'<cite>'+escapeHTML(credit)+'</cite>':'')+'</figcaption>' : '';
  const tag = kind === 'image' ? '<img src="'+escapeHTML(url)+'"/>' :
    kind === 'video' ? '<video src="'+escapeHTML(url)+'"></video>' :
    kind === 'audio' ? '<audio src="'+escapeHTML(url)+'"></audio>' :
    '<tg-document src="'+escapeHTML(url)+'"></tg-document>';
  insertHTML('<figure>'+tag+cap+'</figure>',true);
}
function insertFeature(kind){
  if(kind === 'task') return insertHTML('<ul><li><input type="checkbox">Nova tarefa</li></ul>',true);
  if(kind === 'ordered') return toggleList('ol');
  if(kind === 'divider') return insertHTML('<hr/>',true);
  if(kind === 'table'){
    const caption = prompt('Legenda da tabela', '') || '';
    return insertHTML('<table bordered striped compact>'+(caption?'<caption>'+escapeHTML(caption)+'</caption>':'')+'<tr><th>A</th><th>B</th></tr><tr><td>—</td><td>—</td></tr></table>',true);
  }
  if(kind === 'expandquote') return insertHTML('<blockquote data-expandable="true"><p>Citação expansível</p></blockquote>',true);
  if(kind === 'pullquote') return insertHTML('<aside>Citação em destaque</aside>',true);
  if(kind === 'details') return insertHTML('<details open><summary>Conteúdo</summary><p>Texto expansível</p></details>',true);
  if(kind === 'mathblock'){
    const value = prompt('Fórmula LaTeX', 'E = mc^2');
    if(value) return insertHTML('<tg-math-block>'+escapeHTML(value)+'</tg-math-block>',true);
    return;
  }
  if(kind === 'anchor'){
    const name = (prompt('Nome da âncora', 'secao') || '').trim().replace(/[^A-Za-z0-9_-]/g,'-');
    if(name) return insertHTML('<a name="'+escapeHTML(name)+'"></a>');
    return;
  }
  if(kind === 'reference'){
    const name = (prompt('Nome da referência', 'nota-1') || '').trim().replace(/[^A-Za-z0-9_-]/g,'-');
    if(!name) return;
    const text = prompt('Texto da referência', 'Referência') || '';
    return insertHTML('<tg-reference name="'+escapeHTML(name)+'">'+escapeHTML(text)+'</tg-reference>');
  }
  if(kind === 'time'){
    const unix = (prompt('Timestamp Unix', String(Math.floor(Date.now()/1000))) || '').trim();
    if(!/^\d+$/.test(unix)) return showToast('Timestamp inválido');
    const format = (prompt('Formato Telegram', 'wDT') || 'wDT').trim();
    const label = prompt('Texto exibido', 'Data e hora') || 'Data e hora';
    return insertHTML('<tg-time unix="'+escapeHTML(unix)+'" format="'+escapeHTML(format)+'">'+escapeHTML(label)+'</tg-time>');
  }
  if(kind === 'emoji'){
    const id = (prompt('ID do emoji personalizado', '') || '').trim();
    if(!/^\d+$/.test(id)) return showToast('ID inválido');
    const alt = prompt('Emoji alternativo', '🙂') || '🙂';
    return insertHTML('<tg-emoji emoji-id="'+escapeHTML(id)+'">'+escapeHTML(alt)+'</tg-emoji>');
  }
  if(kind === 'image') return figure('image');
  if(kind === 'video') return figure('video');
  if(kind === 'audio') return figure('audio');
  if(kind === 'document') return figure('document');
  if(kind === 'embed'){
    const url = askUrl('Link do conteúdo incorporado');
    if(url) return insertHTML('<figure><iframe src="'+escapeHTML(url)+'"></iframe></figure>',true);
    return;
  }
  if(kind === 'map'){
    const lat = Number(prompt('Latitude', '0'));
    const lon = Number(prompt('Longitude', '0'));
    const zoom = Number(prompt('Zoom 0–24', '14'));
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180||!Number.isInteger(zoom)||zoom<0||zoom>24) return showToast('Mapa inválido');
    const caption = prompt('Legenda', '') || '';
    const map = '<tg-map lat="'+lat+'" long="'+lon+'" zoom="'+zoom+'"/>';
    return insertHTML(caption?'<figure>'+map+'<figcaption>'+escapeHTML(caption)+'</figcaption></figure>':map,true);
  }
  if(kind === 'collage' || kind === 'slideshow'){
    const value = prompt('Links de imagens ou vídeos, um por linha', '');
    if(!value) return;
    const urls = value.split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean).slice(0,50);
    const tags=[];
    for(const raw of urls){
      let url;
      try{url=new URL(raw);if(!['http:','https:'].includes(url.protocol))throw new Error();}catch{return showToast('Há um link inválido');}
      const tag=mediaTag(url.href);
      tags.push(tag==='video'?'<video src="'+escapeHTML(url.href)+'"></video>':'<img src="'+escapeHTML(url.href)+'"/>');
    }
    if(!tags.length) return;
    const caption=prompt('Legenda','')||'';
    const tag=kind==='collage'?'tg-collage':'tg-slideshow';
    return insertHTML('<'+tag+'>'+tags.join('')+(caption?'<figcaption>'+escapeHTML(caption)+'</figcaption>':'')+'</'+tag+'>',true);
  }
  if(kind === 'button') {
    const type=(prompt('Tipo: url, callback_data, web_app, copy_text, disabled','url')||'url').trim();
    const types=new Set(['url','callback_data','web_app','copy_text','disabled']);
    if(!types.has(type)) return showToast('Tipo de botão inválido');
    const label=(prompt('Texto do botão','Abrir')||'').trim();
    if(!label) return;
    const style=(prompt('Estilo: link, primary, success ou danger','primary')||'').trim();
    if(style && !['link','primary','success','danger'].includes(style)) return showToast('Estilo inválido');
    if(style==='link' && type!=='callback_data') return showToast('O estilo link exige um botão de callback');
    let attr=' type="'+type+'"'+(style?' style="'+style+'"':'');
    if(type==='url'||type==='web_app'){
      const url=askUrl('Link do botão'); if(!url) return; attr+=' url="'+escapeHTML(url)+'"';
    }else if(type==='callback_data'){
      const data=(prompt('Callback data','action')||'').trim(); if(!data) return;
      if(new TextEncoder().encode(data).length>64) return showToast('O callback aceita até 64 bytes');
      attr+=' data="'+escapeHTML(data)+'"';
    }else if(type==='copy_text'){
      const text=prompt('Texto para copiar','')||''; if(!text) return; attr+=' text="'+escapeHTML(text)+'"';
    }
    return insertHTML('<tg-button-row align="center"><tg-button'+attr+'>'+escapeHTML(label)+'</tg-button></tg-button-row>',true);
  }
}
function insertPlainText(text){
  const sel=window.getSelection();
  if(!sel || !sel.rangeCount) throw new Error('Posicione o cursor no texto');
  const range=sel.getRangeAt(0);
  if(!editor.contains(range.commonAncestorContainer)) throw new Error('Posicione o cursor no texto');
  range.deleteContents();
  const frag=document.createDocumentFragment();
  const parts=String(text).split(/\r\n|\r|\n/);
  parts.forEach((part,i)=>{if(i)frag.append(document.createElement('br'));if(part)frag.append(document.createTextNode(part));});
  const last=frag.lastChild;range.insertNode(frag);
  if(last){range.setStartAfter(last);range.collapse(true);sel.removeAllRanges();sel.addRange(range);}
  saveSel();pushHist();markDirty();
}
function markDirty(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 400);
}
function saveLocal(){
  try{ localStorage.setItem('rmdtxtml', JSON.stringify({name: docName.value, html: editor.innerHTML, dest, telegraphPath, docId, importedMd, importedTxt, importedHtml})); }
  catch{ showToast('Não foi possível salvar neste dispositivo'); }
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem('rmdtxtml') || 'null');
    if(typeof d?.html === 'string'){ editor.innerHTML = d.html; docName.value = d.name || 'Ideia'; telegraphPath = d.telegraphPath || ''; docId = d.docId || docId; importedMd = d.importedMd || ''; importedTxt = d.importedTxt || ''; importedHtml = d.importedHtml || ''; if(d.dest === 'telegram' || d.dest === 'telegraph') dest = d.dest; }
  }catch{ showToast('O rascunho salvo não pôde ser aberto'); }
}
function escapeHTML(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function htmlToText(html){
  if(importedTxt && editor.innerHTML===importedHtml)return importedTxt;
  const d=document.createElement('div');d.innerHTML=html;
  if(d.querySelector('img,video,audio,iframe,tg-document,tg-map,tg-collage,tg-slideshow,tg-button'))throw new Error('TXT não comporta mídia ou botões');
  const block=new Set(['P','DIV','H1','H2','H3','H4','H5','H6','FOOTER','BLOCKQUOTE','PRE','UL','OL','LI','TABLE','TR','FIGURE','DETAILS','ASIDE']);
  const read=node=>{
    if(node.nodeType===3)return node.nodeValue||'';
    if(node.nodeType!==1)return '';
    if(node.tagName==='BR')return '\n';
    const children=Array.from(node.childNodes);
    if(node.tagName==='TABLE')return Array.from(node.rows).map(row=>Array.from(row.cells).map(read).join('\t')).join('\n');
    const value=children.map(read).join('');
    return block.has(node.tagName)?'\n'+value+'\n':value;
  };
  return Array.from(d.childNodes).map(read).join('').replace(/^\n+|\n+$/g,'').replace(/\n{3,}/g,'\n\n');
}
function txtLosesStructure(){return Boolean(editor.querySelector('h1,h2,h3,h4,h5,h6,strong,b,em,i,u,ins,s,strike,del,code,mark,sub,sup,tg-spoiler,tg-reference,tg-emoji,tg-time,tg-math,tg-math-block,hr,ul,ol,li,blockquote,aside,footer,table,details,summary,a[href],figure,figcaption,input'))||Boolean(editor.querySelector('.tg-footer,[data-expandable]'));}
function htmlToMarkdown(html){
  if(importedMd && editor.innerHTML === importedHtml) return importedMd;
  if(editor.querySelector('[data-media-id]')) throw new Error('Anexos locais precisam de URL pública para exportar Markdown');
  if(!window.TurndownService) throw new Error('Conversão Markdown indisponível');
  const svc = new TurndownService({headingStyle:'atx', codeBlockStyle:'fenced', bulletListMarker:'-', emDelimiter:'*'});
  svc.addRule('special', {filter: node => ['TG-SPOILER','TG-REFERENCE','TG-EMOJI','TG-TIME','TG-MATH','TG-MATH-BLOCK','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-BUTTON','TG-BUTTON-ROW','DETAILS','TABLE','FIGURE','ASIDE','FOOTER','SUB','SUP','MARK','U','INPUT','IFRAME','VIDEO','AUDIO'].includes(node.nodeName) || node.nodeName==='BLOCKQUOTE' && node.dataset.expandable==='true' || node.classList?.contains('tg-footer') || node.nodeName === 'A' && node.hasAttribute('name'), replacement: (_,node)=>['DETAILS','TABLE','FIGURE','ASIDE','FOOTER','IFRAME','VIDEO','AUDIO','BLOCKQUOTE','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-MATH-BLOCK','TG-BUTTON-ROW','P'].includes(node.nodeName)?'\n\n'+node.outerHTML+'\n\n':node.outerHTML});
  return svc.turndown(html);

}
function mdToBasicHTML(md){
  if(!window.marked) throw new Error('Importação Markdown indisponível');
  const box = document.createElement('div');
  box.innerHTML = window.marked.parse(md, {gfm:true, breaks:false});
  const allowed = new Set('a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div'.split(' '));
  const attrs = new Set('href name class style src alt tg-spoiler start type reversed value checked disabled expandable data-expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats'.split(' '));
  for(const el of box.querySelectorAll('*')){
    const tag = el.localName;
    if(!allowed.has(tag)) throw new Error('Elemento Markdown não suportado: '+tag);
    for(const a of [...el.attributes]) {
      if(!attrs.has(a.name) || a.name==='class' && !(tag==='code'&&/^language-[a-z0-9+-]+$/i.test(a.value)||['p','footer'].includes(tag)&&a.value==='tg-footer') || a.name==='style' && !(tag==='tg-button'&&['link','primary','success','danger'].includes(a.value))) throw new Error('Atributo Markdown não suportado: '+a.name);
      if(['src','href','url'].includes(a.name) && !/^(https?:|mailto:|tel:|tg:|#)/i.test(a.value)) throw new Error('Link Markdown inválido');
    }
    if(tag==='input'&&el.getAttribute('type')==='checkbox')el.removeAttribute('disabled');
    if(tag==='blockquote'&&el.hasAttribute('expandable')){el.dataset.expandable='true';el.removeAttribute('expandable');}
  }
  return box.innerHTML;

}
function download(name, content, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.hidden = true; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
function telegraphNodes(root){
  const allow = new Set(['a','aside','b','blockquote','br','code','em','figcaption','figure','h3','h4','hr','i','iframe','img','li','ol','p','pre','s','strong','u','ul','video']);
  const conv = (el, standalone=false) => {
    if(el.nodeType === 3){const text=el.textContent;if(standalone&&!text.trim())return null;return standalone?{tag:'p',children:[text]}:text;}
    if(el.nodeType !== 1) return null;
    let tag = el.tagName.toLowerCase();
    if(el.hasAttribute('data-media-id')) throw new Error('O Telegraph precisa de uma URL pública para mídia');
    if(tag === 'footer' || el.classList.contains('tg-footer')) tag = 'aside';
    if(['div','article','section','span','thead','tbody','tfoot'].includes(tag)) return Array.from(el.childNodes).map(child=>conv(child,standalone)).flat().filter(Boolean);
    if(!allow.has(tag)) throw new Error('O conteúdo contém um elemento que o Telegraph não aceita: ' + tag);
    const node = {tag};
    if(tag === 'a'){const href=el.getAttribute('href');if(!href)throw new Error('Âncoras do Telegram não podem ser publicadas no Telegraph');node.attrs={href};}
    if(['img','video','iframe'].includes(tag)){const src=el.getAttribute('src');if(!src)throw new Error('A mídia precisa de um endereço');node.attrs={src};}
    const children = Array.from(el.childNodes).map(child=>conv(child,false)).flat().filter(v => v !== null && v !== '');
    if(children.length) node.children = children;
    return node;
  };
  return Array.from(root.childNodes).map(el=>conv(el,true)).flat().filter(Boolean);
}
function toRichHTML(root){
  const allow=new Set(['a','b','strong','i','em','u','ins','s','strike','del','code','mark','sub','sup','tg-spoiler','tg-reference','tg-emoji','tg-time','tg-math','h1','h2','h3','h4','h5','h6','p','pre','footer','hr','ul','ol','li','input','blockquote','aside','cite','img','video','audio','tg-document','figure','figcaption','tg-map','tg-collage','tg-slideshow','table','caption','tr','th','td','details','summary','tg-math-block','tg-button','tg-button-row','br']);
  const unwrap=new Set(['div','article','section','span','thead','tbody','tfoot']);
  const amap={
    a:['href','name'],ol:['start','type','reversed'],li:['value','type'],input:['type','checked'],
    img:['src','alt','tg-spoiler'],video:['src','tg-spoiler'],audio:['src'],'tg-document':['src'],
    'tg-map':['lat','long','zoom','width','height'],table:['bordered','striped','compact'],
    th:['colspan','rowspan','align','valign'],td:['colspan','rowspan','align','valign'],
    'tg-button-row':['align'],'tg-button':['type','style','url','data','query','text','forward-text','request-write-access','allow-user-chats','allow-bot-chats','allow-group-chats','allow-channel-chats'],
    'tg-reference':['name'],'tg-emoji':['emoji-id'],'tg-time':['unix','format']
  };
  const bool=new Set(['reversed','checked','tg-spoiler','bordered','striped','compact','request-write-access','allow-user-chats','allow-bot-chats','allow-group-chats','allow-channel-chats','expandable','open']);
  const empty=new Set(['hr','br','img','input','tg-map']);
  const walk=n=>{
    if(n.nodeType===3)return escapeHTML(n.textContent||'');
    if(n.nodeType!==1)return '';
    let tag=n.tagName.toLowerCase();
    if(n.classList?.contains('tg-footer')) tag='footer';
    if(unwrap.has(tag)) return Array.from(n.childNodes).map(walk).join('');
    if(!allow.has(tag)) throw new Error('O conteúdo contém um elemento que o Telegram não aceita: '+tag);
    const attrs=[];
    if(tag==='blockquote'&&n.dataset.expandable==='true') attrs.push('expandable');
    if(tag==='details'&&n.open) attrs.push('open');
    for(const name of amap[tag]||[]){
      if(bool.has(name)){
        if(n.hasAttribute(name)) attrs.push(name);
      }else{
        const value=name==='src' && n.hasAttribute('data-media-id') ? 'tg://'+({img:'photo',video:'video',audio:'audio','tg-document':'document'}[tag])+'?id='+n.getAttribute('data-media-id') : n.getAttribute(name);
        if(value!==null&&value!=='') attrs.push(name+'="'+escapeHTML(value)+'"');
      }
    }
    const open='<'+tag+(attrs.length?' '+attrs.join(' '):'')+'>';
    if(empty.has(tag)) return open.slice(0,-1)+'/>';
    return open+Array.from(n.childNodes).map(walk).join('')+'</'+tag+'>';
  };
  return Array.from(root.childNodes).map(walk).join('')||'<p></p>';
}
function buildRich(){
  return {rich_message: {html:toRichHTML(editor)}};
}
function buildTelegraph(){
  const title=docName.value.trim();
  if(!title) throw new Error('Dê um nome à página antes de publicar');
  return {title, content: telegraphNodes(editor), path: telegraphPath, doc: docId, initData: getTg()?.initData || ''};
}
editor.addEventListener('input', ()=>{ if(!composing){ markDirty(); pushHist(); }});
editor.addEventListener('change',e=>{if(e.target.matches('input[type=checkbox]')){e.target.toggleAttribute('checked',e.target.checked);pushHist();markDirty();}});
editor.addEventListener('compositionstart', ()=> composing = true);
editor.addEventListener('compositionend', ()=>{ composing = false; markDirty(); pushHist(); });
editor.addEventListener('keyup', saveSel);
editor.addEventListener('mouseup', saveSel);
editor.addEventListener('paste', e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  insertPlainText(text);
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
    const marks={bold:'strong,b',italic:'em,i',underline:'u',insertUnorderedList:'ul'};
    btn.classList.toggle('on', Boolean(el && el.closest(marks[btn.dataset.cmd] || '')));
  });
  $('#listBtn').classList.toggle('on', !!(el && el.closest('ul,ol')) || $('#listMenu').classList.contains('on'));
  $('#quoteBtn')?.classList.toggle('on', !!(el && el.closest('blockquote,aside')) || $('#quoteMenu')?.classList.contains('on'));
  $('#headingBtn')?.classList.toggle('on', !!(headingEl || $('#headingMenu')?.classList.contains('on')));
  $('#linkBtn')?.classList.toggle('on', !!(el && el.closest('a')));
  $('#plusBtn')?.classList.toggle('on', $('#plusMenu')?.classList.contains('on'));
  $$('#headingMenu [data-block]').forEach(btn => btn.classList.toggle('is-current', btn.dataset.block === kind));
});
$('#typebar').addEventListener('mousedown', e => e.preventDefault());
$$('#typebar [data-cmd], #plusMenu [data-cmd], #listMenu [data-cmd]').forEach(btn => btn.addEventListener('click', ()=>{try{exec(btn.dataset.cmd);closePanels();}catch(err){showToast(err.message);}}));
$$('#typebar [data-block], #headingMenu [data-block], #quoteMenu [data-block]').forEach(btn => btn.addEventListener('click', ()=>{try{formatBlock(btn.dataset.block);}catch(err){showToast(err.message);}}));
$$('#plusMenu [data-insert], #quoteMenu [data-insert], #listMenu [data-insert]').forEach(btn => btn.addEventListener('click', ()=>{try{insertFeature(btn.dataset.insert);}catch(err){showToast(err.message);}}));
$('#linkBtn').addEventListener('click', ()=>{
  restoreSel(); expandWord();
  const value=prompt('Link','https://');if(!value)return;
  let url;try{url=new URL(value.trim(),location.href);if(!['http:','https:','mailto:','tel:','tg:'].includes(url.protocol))throw new Error('Use um link válido');}catch(err){showToast(err.message||'Link inválido');return;}
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed)insertHTML('<a href="'+escapeHTML(url.href)+'">'+escapeHTML(value.trim())+'</a>');
  else exec('createLink',url.href);
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
$('#listBtn').addEventListener('click',e=>openPanel('#listMenu',e.currentTarget));
$('#openAppBtn').addEventListener('click',()=>{saveLocal();window.location.assign(API+'/telegram/open');});
$('#quoteBtn')?.addEventListener('click', e=>openPanel('#quoteMenu', e.currentTarget));
$('#destBtn').addEventListener('click', ()=>setDestination(dest === 'telegram' ? 'telegraph' : 'telegram'));
$('#exportBtn').addEventListener('click', e=>{
  if(getTg()?.initData && !inTg){showToast(session==='invalid'?'Sessão inválida ou expirada. Reabra o Mini App.':'Aguarde a validação da sessão Telegram');return;}
  if(inTg) return publishCurrent();
  openPanel('#exportMenu', e.currentTarget);
});
docName.addEventListener('input',markDirty);
$('#brandBtn')?.addEventListener('click', e=>openPanel('#importMenu', e.currentTarget));
$('#importMdBtn')?.addEventListener('click', ()=>{ fileInput.accept='.md,text/markdown'; fileInput.click(); closePanels(); });
$('#importTxtBtn')?.addEventListener('click', ()=>{ fileInput.accept='.txt,text/plain'; fileInput.click(); closePanels(); });
$('#exportTxtBtn')?.addEventListener('click', ()=>exportFile('txt'));
$('#exportMdBtn')?.addEventListener('click', ()=>exportFile('md'));
$('#mediaBtn').addEventListener('click',()=>{$('#mediaInput').click();closePanels();});
$('#mediaInput').addEventListener('change',()=>{
  const file=$('#mediaInput').files?.[0];if(!file)return;
  if(file.size>20_000_000){showToast('Arquivo acima de 20 MB');return;}
  const kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';
  const id=crypto.randomUUID().replace(/-/g,'');
  if(mediaFile)URL.revokeObjectURL(mediaFile.url);
  mediaFile={file,id,kind,url:URL.createObjectURL(file)};
  editor.querySelectorAll('[data-media-id]').forEach(el=>el.closest('figure')?.remove());
  const tag={image:'img',video:'video',audio:'audio',document:'tg-document'}[kind];
  insertHTML('<figure><'+tag+' data-media-id="'+id+'" src="'+mediaFile.url+'"></'+tag+'><figcaption>'+escapeHTML(file.name)+'</figcaption></figure>',true);
  $('#mediaInput').value='';
});
$('#findBtn').addEventListener('click', ()=>openPanel('#findMenu', $('#brandBtn')));
function matches(){
  const term=$('#findText').value;if(!term)return [];
  const walk=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT),groups=[];let node,group;
  while((node=walk.nextNode())){
    const block=node.parentElement.closest('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,summary,figcaption,footer')||editor;
    if(!group||group.block!==block){group={block,text:'',nodes:[]};groups.push(group);}
    group.nodes.push({node,start:group.text.length,end:group.text.length+node.length});group.text+=node.textContent;
  }
  const found=[];
  for(const group of groups){let at=0;while((at=group.text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase(),at))>=0){
    const start=group.nodes.find(x=>x.end>at),end=group.nodes.find(x=>x.end>=at+term.length);
    if(start&&end){const r=document.createRange();r.setStart(start.node,at-start.start);r.setEnd(end.node,at+term.length-end.start);found.push(r);}
    at+=term.length;
  }}
  return found;
}
$('#findNext').addEventListener('click',()=>{
  const all=matches();if(!all.length)return showToast('Nenhuma ocorrência');
  const sel=window.getSelection(),cur=savedRange&&editor.contains(savedRange.startContainer)?savedRange:null;
  const range=all.find(r=>!cur||cur.comparePoint(r.startContainer,r.startOffset)>0||cur.collapsed&&cur.comparePoint(r.startContainer,r.startOffset)===0)||all[0];
  sel.removeAllRanges();sel.addRange(range);savedRange=range.cloneRange();range.startContainer.parentElement.scrollIntoView({block:'nearest'});
});
$('#replaceOne').addEventListener('click',()=>{
  const sel=window.getSelection();
  if(savedRange&&editor.contains(savedRange.startContainer)){sel.removeAllRanges();sel.addRange(savedRange);}
  if(!sel.rangeCount||sel.toString().toLocaleLowerCase()!==$('#findText').value.toLocaleLowerCase())$('#findNext').click();
  if(sel.toString().toLocaleLowerCase()!==$('#findText').value.toLocaleLowerCase()||!$('#findText').value)return;
  const r=sel.getRangeAt(0),text=document.createTextNode($('#replaceText').value);r.deleteContents();r.insertNode(text);r.setStartAfter(text);r.collapse(true);savedRange=r.cloneRange();pushHist();markDirty();$('#findNext').click();
});
$('#replaceAll').addEventListener('click',()=>{
  const all=matches(),replace=$('#replaceText').value;
  for(const r of all.reverse()){r.deleteContents();r.insertNode(document.createTextNode(replace));}
  if(all.length){savedRange=null;pushHist();markDirty();}showToast(all.length+' substituições');
});

function exportName(ext) {
  const base = (docName.value || "document").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+|\.+$/g, "").slice(0, 80) || "document";
  return base + "." + ext;
}
async function exportFile(format) {
  if (inTg) {
    closePanels();
    return publishCurrent();
  }
  let content, type, ext;
  try {
    if (format === "md") {
      content = htmlToMarkdown(editor.innerHTML);
      type = "text/markdown";
      ext = "md";
    } else {
      if (txtLosesStructure() && !confirm('TXT não preserva formatação nem estrutura. Deseja exportar como texto simples?')) return;
      content = htmlToText(editor.innerHTML);
      type = "text/plain";
      ext = "txt";
    }
  } catch (err) {
    showToast(err.message);
    return;
  }
  download(exportName(ext), content, type);
  closePanels();
}
async function readResponse(res){
  try{return await res.json();}catch{throw new Error('A resposta do serviço não pôde ser lida');}
}
async function publishCurrent(){
  if(busy)return;
  busy=true;$('#exportBtn').disabled=true;
  try{if(dest==='telegram')await publishTelegram();else await publishTelegraph();}
  finally{busy=false;$('#exportBtn').disabled=false;}
}
async function publishTelegram(){
  if(!editor.childNodes.length){ showToast('Escreva algo antes de enviar'); return; }
  const initData = getTg()?.initData || '';
  if(!initData){ showToast('Abra pelo bot no Telegram'); return; }
  try{
    const p = buildRich();
    const data=mediaFile;
    if(editor.querySelector('[data-media-id]') && (!data || !editor.querySelector('[data-media-id="'+data.id+'"]'))) throw new Error('Anexe a mídia novamente antes de publicar');
    const form = data ? new FormData() : null;
    if(form){form.set('initData',initData);form.set('html',p.rich_message.html);form.set('kind',data.kind);form.set('id',data.id);form.set('upload',data.file,data.file.name);}
    const res = await fetch(API+'/api/telegram/send', {
      method:'POST',
      ...(form?{}:{headers:{'content-type':'application/json'}}),
      body: form || JSON.stringify({ initData, html: p.rich_message.html })
    });
    const json = await readResponse(res);
    if(!res.ok) throw new Error(json.error || 'Não foi possível enviar a mensagem');
    showToast('Mensagem enviada no chat do bot');
  }catch(err){
    showToast(err instanceof TypeError?'Não foi possível conectar ao Telegram':err.message || 'Não foi possível enviar a mensagem');
  }
}
async function publishTelegraph(){
  let payload;
  try{ payload = buildTelegraph(); }catch(err){ showToast(err.message); return; }
  try{
    const res = await fetch(API+'/api/telegraph/publish', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const result = await readResponse(res);
    if(!res.ok) throw new Error(result.error || 'Não foi possível publicar no Telegraph');
    telegraphPath = result.path || telegraphPath;
    saveLocal();
    showToast(telegraphPath ? 'Página salva no Telegraph' : 'Publicado no Telegraph');
    if(inTg)getTg().openLink(result.url,{try_instant_view:true});
    else window.location.assign(result.url);
  }catch(err){ showToast(err instanceof TypeError?'Não foi possível conectar ao Telegraph':err.message || 'Não foi possível publicar no Telegraph'); }
}
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0]; if(!file) return;
  try{
    if(!/\.(md|txt)$/i.test(file.name)) throw new Error('Escolha um arquivo Markdown ou TXT');
    const text = await file.text();
    const html = /\.md$/i.test(file.name) ? mdToBasicHTML(text.replace(/^\uFEFF/,'')) : '<p>'+escapeHTML(text.replace(/^\uFEFF/,'')).replace(/\n/g,'<br>')+'</p>';
    docName.value = file.name.replace(/\.(md|txt)$/i,'');
    editor.innerHTML = html;
    importedMd = /\.md$/i.test(file.name) ? text.replace(/^\uFEFF/,'') : '';
    importedTxt = /\.txt$/i.test(file.name) ? text.replace(/^\uFEFF/,'') : '';
    importedHtml = editor.innerHTML;
    telegraphPath = '';docId=crypto.randomUUID();mediaFile=null;pushHist();
    markDirty(); closePanels();
  }catch(err){ showToast(err.message || 'Não foi possível importar o arquivo'); }
  fileInput.value='';
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && backdrop.classList.contains('on')){ closePanels(); return; }
  if(!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if(k==='b'||k==='i'||k==='u'){e.preventDefault();try{exec({b:'bold',i:'italic',u:'underline'}[k]);}catch(err){showToast(err.message);}}
  if(k==='z' && !e.shiftKey){ e.preventDefault(); histUndo(); flashBtn($('#undoBtn')); }
  if(k==='z' && e.shiftKey || k==='y'){ e.preventDefault(); histRedo(); flashBtn($('#redoBtn')); }
});
const vv = window.visualViewport;
const fit = ()=>{
  const vh = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  document.documentElement.style.setProperty('--kb', Math.max(0, window.innerHeight - vh - top) + 'px');
  document.documentElement.style.setProperty('--vv-top', Math.max(0, top) + 'px');
  document.documentElement.style.setProperty('--vv-h', Math.max(0, vh) + 'px');
  document.documentElement.style.setProperty('--vv-end', Math.max(0, top + vh) + 'px');
};
fit();
vv?.addEventListener('resize', fit);
vv?.addEventListener('scroll', fit);
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
loadLocal();
setDestination(dest, false);
pushHist();
void verifyTelegram();
