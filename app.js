const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const editor = $('#editor');
const docName = $('#docName');
const toast = $('#toast');
const backdrop = $('#backdrop');
const fileInput = $('#fileInput');
let dest = 'telegram';
const sheets = ['#plusMenu','#headingMenu','#quoteMenu','#importMenu','#exportMenu'];
let savedRange = null, hist = [], histI = -1, histLock = false, composing = false, saveTimer = null;
function applyAssets(){
  $$('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    el.style.setProperty('--ui-icon', 'url("icons/' + name + '.svg")');
  });
}
applyAssets();
function applyScheme(){
  const tg = window.Telegram?.WebApp;
  const light = tg?.colorScheme ? tg.colorScheme === 'light' : window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.classList.toggle('light', light);
  document.documentElement.classList.toggle('dark', !light);
  if(tg){
    const header = light ? '#f8fbff' : '#12131c';
    tg.setHeaderColor?.(header);
  }
}
applyScheme();
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyScheme);
function getTg(){ return window.Telegram?.WebApp; }
function isInsideTelegram(){ return Boolean(getTg()); }
const inTg = isInsideTelegram();
const API = 'https://mdtxtrt.up.railway.app';
if (inTg) {
  const tg = getTg();
  document.body.classList.add('tg');
  tg.ready(); tg.expand();
  const applySafe = () => {
    const top = Math.max(tg.contentSafeAreaInset?.top || 0, tg.safeAreaInset?.top || 0);
    document.documentElement.style.setProperty('--tg-top', top + 'px');
  };
  applySafe(); applyScheme();
  tg.onEvent?.('safeAreaChanged', applySafe);
  tg.onEvent?.('contentSafeAreaChanged', applySafe);
  tg.onEvent?.('themeChanged', applyScheme);
  tg.BackButton?.hide?.();
  tg.disableVerticalSwipes?.();
  tg.MainButton?.setText?.('Publicar no Telegram');
  tg.MainButton?.show?.();
  tg.MainButton?.onClick?.(()=>publishCurrent());
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
  getTg()?.MainButton?.setText?.('Publicar no ' + name);
  applyAssets();
  $$('#headingMenu [data-block]').forEach(item => {
    item.hidden = dest === 'telegraph' && !['p','h3','h4','footer'].includes(item.dataset.block);
  });
  $('#quoteMenu [data-insert="expandquote"]').hidden = dest === 'telegraph';
  $$('#plusMenu [data-insert]').forEach(item => {
    item.hidden = dest === 'telegraph' && ['table','details','button'].includes(item.dataset.insert);
  });
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
  const placeTop = sel === '#importMenu' || sel === '#exportMenu';
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
  if(!sel) return;
  if(savedRange){ sel.removeAllRanges(); sel.addRange(savedRange); return; }
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
  if(cmd === 'insertUnorderedList') return toggleList();
  const tag = {bold:'strong',italic:'em',underline:'u',createLink:'a'}[cmd];
  if(!tag) throw new Error('Ação de edição indisponível');
  restoreSel(); expandWord();
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount) throw new Error('Selecione o texto para formatar');
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const active = range.collapsed && node?.closest(tag);
  if(active){
    const next = document.createRange();
    next.setStartAfter(active); next.collapse(true);
    sel.removeAllRanges(); sel.addRange(next);
  }else{
    const mark = document.createElement(tag);
    if(cmd==='createLink')mark.setAttribute('href',value);
    if(range.collapsed){ mark.append(document.createElement('br')); range.insertNode(mark); }
    else mark.append(range.extractContents()), range.insertNode(mark);
    const next = document.createRange();
    next.selectNodeContents(mark); next.collapse(false);
    sel.removeAllRanges(); sel.addRange(next);
  }
  saveSel(); pushHist(); markDirty();
}
function toggleList(){
  restoreSel();
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount) throw new Error('Selecione o trecho da lista');
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const list = node?.closest('ul');
  if(list){
    const frag = document.createDocumentFragment();
    Array.from(list.children).forEach(li=>{const p=document.createElement('p');while(li.firstChild)p.append(li.firstChild);frag.append(p);});
    list.replaceWith(frag);
  }else{
    const block = node?.closest('p,div,h1,h2,h3,h4,h5,h6');
    const li = document.createElement('li');
    if(block){while(block.firstChild)li.append(block.firstChild);const ul=document.createElement('ul');ul.append(li);block.replaceWith(ul);}
    else{const ul=document.createElement('ul');ul.append(li);range.insertNode(ul);}
    const next=document.createRange();next.selectNodeContents(li);next.collapse(false);sel.removeAllRanges();sel.addRange(next);
  }
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
function insertHTML(html){
  restoreSel();
  const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
  if(!range || !editor.contains(range.commonAncestorContainer)) throw new Error('Posicione o cursor no texto');
  range.deleteContents();
  const t=document.createElement('template'); t.innerHTML=html;
  const frag=t.content; const last=frag.lastChild;
  range.insertNode(frag);
  if(last){range.setStartAfter(last);range.collapse(true);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);}
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
  if(kind === 'expandquote') return insertHTML('<blockquote data-expandable="true"><p>Citação expansível</p></blockquote>');
  if(kind === 'details') return insertHTML('<details open><summary>Conteúdo</summary><p>Texto expansível</p></details>');
  if(kind === 'button') {
    const label = prompt('Texto do botão', 'Abrir');
    if(!label?.trim()) return;
    const value = prompt('Link do botão', 'https://');
    if(!value) return;
    let url;
    try{ url = new URL(value); }catch{ showToast('Link inválido'); return; }
    if(!['http:','https:','tg:'].includes(url.protocol)){ showToast('Use um link válido'); return; }
    return insertHTML('<tg-button-row align="center"><tg-button type="url" style="danger" url="'+escapeHTML(url.href)+'">'+escapeHTML(label.trim())+'</tg-button></tg-button-row>');
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
  try{ localStorage.setItem('rmdtxtml', JSON.stringify({name: docName.value, html: editor.innerHTML, dest})); }
  catch{ showToast('Não foi possível salvar neste dispositivo'); }
}
function loadLocal(){
  try{
    const d = JSON.parse(localStorage.getItem('rmdtxtml') || 'null');
    if(d?.html){ editor.innerHTML = d.html; docName.value = d.name || 'Ideia'; if(d.dest === 'telegram' || d.dest === 'telegraph') dest = d.dest; }
  }catch{ showToast('O rascunho salvo não pôde ser aberto'); }
}
function escapeHTML(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function htmlToText(html){ const d = document.createElement('div'); d.innerHTML = html; return d.innerText; }
function htmlToMarkdown(html){
  const d=document.createElement('div');d.innerHTML=html;
  const walk=n=>{
    if(n.nodeType===3)return n.textContent;
    if(n.nodeType!==1)return '';
    const t=n.tagName.toLowerCase(),children=Array.from(n.childNodes),inner=children.map(walk).join('');
    if(t==='strong'||t==='b')return '**'+inner+'**';
    if(t==='em'||t==='i')return '*'+inner+'*';
    if(t==='s'||t==='del')return '~~'+inner+'~~';
    if(t==='code')return '`'+n.textContent.replace(/`/g,'\\`')+'`';
    if(t==='a'){const href=n.getAttribute('href');if(!href)throw new Error('Adicione um endereço ao link antes de exportar');return '['+inner+'](<'+href+'>)';}
    if(/^h[1-6]$/.test(t))return '\n'+'#'.repeat(Number(t[1]))+' '+inner+'\n';
    if(t==='p')return n.classList.contains('tg-footer')?'\n<aside>'+inner+'</aside>\n':'\n'+inner+'\n';
    if(t==='br')return '  \n';
    if(t==='hr')return '\n---\n';
    if(t==='blockquote')return '\n> '+inner.trim().replace(/\n/g,'\n> ')+'\n';
    if(t==='ul'||t==='ol')return '\n'+Array.from(n.children).map((li,i)=>(t==='ol'?(i+1)+'. ':'- ')+Array.from(li.childNodes).map(walk).join('').trim()).join('\n')+'\n';
    if(t==='li')return inner;
    if(t==='div'||t==='article'||t==='section'||t==='span')return inner;
    if(['u','sub','sup','mark','details','table','tg-button','tg-button-row','footer','aside'].includes(t))return '\n'+n.outerHTML+'\n';
    if(t==='pre')return '\n'+n.outerHTML+'\n';
    throw new Error('O conteúdo não pode ser exportado em Markdown: '+t);
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
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
function telegraphNodes(root){
  const allow = new Set(['a','aside','b','blockquote','br','code','em','h3','h4','hr','i','li','ol','p','pre','s','strong','u','ul']);
  const conv = (el, standalone=false) => {
    if(el.nodeType === 3){const text=el.textContent;if(!text.trim())return null;return standalone?{tag:'p',children:[text]}:text;}
    if(el.nodeType !== 1) return null;
    let tag = el.tagName.toLowerCase();
    if(tag === 'footer' || el.classList.contains('tg-footer')) tag = 'aside';
    if(tag === 'div' || tag === 'article' || tag === 'section') return Array.from(el.childNodes).map(child=>conv(child,true)).flat().filter(Boolean);
    if(!allow.has(tag)) throw new Error('O conteúdo contém um elemento que o Telegraph não aceita: ' + tag);
    if(tag === 'blockquote' && el.dataset.expandable === 'true') throw new Error('Remova a citação expansível antes de publicar no Telegraph');
    const node = {tag};
    if(tag === 'a'){const href=el.getAttribute('href');if(!href)throw new Error('Adicione um endereço ao link antes de publicar');node.attrs={href};}
    const children = Array.from(el.childNodes).map(child=>conv(child,false)).flat().filter(v => v !== null && v !== '');
    if(children.length) node.children = children;
    return node;
  };
  return Array.from(root.childNodes).map(el=>conv(el,true)).flat().filter(Boolean);
}
function toRichHTML(root){
  const inline = n => {
    if(n.nodeType===3)return escapeHTML(n.textContent||'');
    if(n.nodeType!==1)return '';
    const t=n.tagName.toLowerCase(), inner=Array.from(n.childNodes).map(inline).join('');
    if(t==='strong'||t==='b')return '<b>'+inner+'</b>';
    if(t==='em'||t==='i')return '<i>'+inner+'</i>';
    if(t==='u')return '<u>'+inner+'</u>';
    if(t==='s'||t==='del')return '<s>'+inner+'</s>';
    if(t==='code')return '<code>'+inner+'</code>';
    if(t==='a'){const href=n.getAttribute('href');if(!href)throw new Error('Adicione um endereço ao link antes de publicar');return '<a href="'+escapeHTML(href)+'">'+inner+'</a>';}
    if(t==='br')return '<br/>';
    if(t==='li'||t==='p'||t==='summary'||/^h[1-6]$/.test(t)||t==='div')return inner;
    if(t==='tg-button')return '<tg-button type="url" style="danger" url="'+escapeHTML(n.getAttribute('url')||'')+'">'+escapeHTML(n.textContent||'')+'</tg-button>';
    throw new Error('O conteúdo contém um elemento que o Telegram não aceita: '+t);
  };
  const blocks = node => {
    if(node.nodeType===3)return node.textContent.trim()?'<p>'+escapeHTML(node.textContent)+'</p>':'';
    if(node.nodeType!==1)return '';
    const t=node.tagName.toLowerCase(), inner=()=>Array.from(node.childNodes).map(inline).join('');
    if(/^h[1-6]$/.test(t)||t==='p')return '<'+t+'>'+inner()+'</'+t+'>';
    if(t==='tg-button-row')return '<tg-button-row align="center">'+Array.from(node.children).map(inline).join('')+'</tg-button-row>';
    if(t==='footer'||node.classList.contains('tg-footer'))return '<footer>'+inner()+'</footer>';
    if(t==='blockquote')return '<blockquote'+(node.dataset.expandable==='true'?' expandable':'')+'>'+inner()+'</blockquote>';
    if(t==='ul'||t==='ol')return '<'+t+'>'+Array.from(node.children).map(li=>'<li>'+Array.from(li.childNodes).map(inline).join('')+'</li>').join('')+'</'+t+'>';
    if(t==='pre')return '<pre>'+escapeHTML(node.innerText)+'</pre>';
    if(t==='details'){
      const sum=Array.from(node.children).find(x=>x.tagName.toLowerCase()==='summary');
      if(!sum)throw new Error('O conteúdo expansível precisa de um título');
      const body=Array.from(node.children).filter(x=>x!==sum).map(x=>blocks(x)).join('');
      return '<details'+(node.open?' open':'')+'><summary>'+Array.from(sum.childNodes).map(inline).join('')+'</summary>'+body+'</details>';
    }
    if(t==='table'){
      const rows=Array.from(node.rows).map(row=>'<tr>'+Array.from(row.cells).map(cell=>{const tag=cell.tagName.toLowerCase()==='th'?'th':'td';return '<'+tag+'>'+Array.from(cell.childNodes).map(inline).join('')+'</'+tag+'>';}).join('')+'</tr>').join('');
      return '<table>'+rows+'</table>';
    }
    if(t==='div'||t==='article'||t==='section'){
      const children=Array.from(node.childNodes);
      if(children.every(x=>x.nodeType===3||x.nodeType===1&&!/^(p|h[1-6]|ul|ol|blockquote|pre|table|details|footer|tg-button-row|div|article|section)$/.test(x.tagName.toLowerCase())))return '<p>'+children.map(inline).join('')+'</p>';
      return children.map(blocks).join('');
    }
    if(['a','b','strong','i','em','u','s','del','code','span'].includes(t))return '<p>'+inner()+'</p>';
    throw new Error('O conteúdo contém um elemento que o Telegram não aceita: '+t);
  };
  return Array.from(root.childNodes).map(blocks).join('')||'<p></p>';
}
function buildRich(){
  return {rich_message: {html:toRichHTML(editor),skip_entity_detection:true}};
}
function buildTelegraph(){
  const title=docName.value.trim();
  if(!title) throw new Error('Dê um nome à página antes de publicar');
  return {title, content: telegraphNodes(editor)};
}
editor.addEventListener('input', ()=>{ if(!composing){ markDirty(); pushHist(); }});
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
  $('#quoteBtn')?.classList.toggle('on', !!(el && el.closest('blockquote')) || $('#quoteMenu')?.classList.contains('on'));
  $('#headingBtn')?.classList.toggle('on', !!(headingEl || $('#headingMenu')?.classList.contains('on')));
  $('#linkBtn')?.classList.toggle('on', !!(el && el.closest('a')));
  $('#plusBtn')?.classList.toggle('on', $('#plusMenu')?.classList.contains('on'));
  $$('#headingMenu [data-block]').forEach(btn => btn.classList.toggle('is-current', btn.dataset.block === kind));
});
$('#typebar').addEventListener('mousedown', e => e.preventDefault());
$$('#typebar [data-cmd]').forEach(btn => btn.addEventListener('click', ()=>{try{exec(btn.dataset.cmd);}catch(err){showToast(err.message);}}));
$$('#typebar [data-block], #headingMenu [data-block], #quoteMenu [data-block]').forEach(btn => btn.addEventListener('click', ()=>{try{formatBlock(btn.dataset.block);}catch(err){showToast(err.message);}}));
$$('#plusMenu [data-insert], #quoteMenu [data-insert]').forEach(btn => btn.addEventListener('click', ()=>{try{insertFeature(btn.dataset.insert);}catch(err){showToast(err.message);}}));
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
$('#quoteBtn')?.addEventListener('click', e=>openPanel('#quoteMenu', e.currentTarget));
$('#destBtn').addEventListener('click', ()=>setDestination(dest === 'telegram' ? 'telegraph' : 'telegram'));
$('#exportBtn').addEventListener('click', e=>openPanel('#exportMenu', e.currentTarget));
$('#brandBtn')?.addEventListener('click', e=>openPanel('#importMenu', e.currentTarget));
$('#importMdBtn')?.addEventListener('click', ()=>{ fileInput.accept='.md,text/markdown'; fileInput.click(); closePanels(); });
$('#importTxtBtn')?.addEventListener('click', ()=>{ fileInput.accept='.txt,text/plain'; fileInput.click(); closePanels(); });
$('#exportTxtBtn')?.addEventListener('click', ()=>{ download((docName.value||'doc')+'.txt', htmlToText(editor.innerHTML), 'text/plain'); closePanels(); });
$('#exportMdBtn')?.addEventListener('click', ()=>{try{download((docName.value||'doc')+'.md',htmlToMarkdown(editor.innerHTML),'text/markdown');closePanels();}catch(err){showToast(err.message);}});
async function readResponse(res){
  try{return await res.json();}catch{throw new Error('A resposta do serviço não pôde ser lida');}
}
async function publishCurrent(){
  if(dest === 'telegram') return publishTelegram();
  return publishTelegraph();
}
async function publishTelegram(){
  if(!editor.textContent.trim()){ showToast('Escreva algo antes de publicar'); return; }
  const initData = getTg()?.initData || '';
  if(!initData){ showToast('Abra pelo bot no Telegram'); return; }
  try{
    const p = buildRich();
    const res = await fetch(API+'/api/telegram/send', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ initData, html: p.rich_message.html })
    });
    const json = await readResponse(res);
    if(!res.ok) throw new Error(json.error || 'Não foi possível publicar no Telegram');
    showToast('Publicado no Telegram');
  }catch(err){
    showToast(err instanceof TypeError?'Não foi possível conectar ao Telegram':err.message || 'Não foi possível publicar no Telegram');
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
    showToast('Publicado no Telegraph');
    if(inTg)getTg().openLink(result.url,{try_instant_view:true});
    else window.location.assign(result.url);
  }catch(err){ showToast(err instanceof TypeError?'Não foi possível conectar ao Telegraph':err.message || 'Não foi possível publicar no Telegraph'); }
}
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0]; if(!file) return;
  try{
    if(!/\.(md|txt)$/i.test(file.name)) throw new Error('Escolha um arquivo Markdown ou TXT');
    const text = await file.text();
    docName.value = file.name.replace(/\.(md|txt)$/i,'');
    editor.innerHTML = /\.md$/i.test(file.name) ? mdToBasicHTML(text) : '<p>'+escapeHTML(text).replace(/\n/g,'<br>')+'</p>';
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
  document.documentElement.style.setProperty('--vv-h', Math.max(0, vh) + 'px');
};
fit();
vv?.addEventListener('resize', fit);
vv?.addEventListener('scroll', fit);
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
if(inTg) getTg()?.onEvent?.('viewportChanged', fit);
loadLocal();
setDestination(dest, false);
pushHist();
const canvasEl = document.getElementById('canvas');
canvasEl?.addEventListener('scroll', () => {
  document.documentElement.style.setProperty('--top-blur', String(Math.min(1, canvasEl.scrollTop / 52)));
}, {passive:true});
