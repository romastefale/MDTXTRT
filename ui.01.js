laceSelection('$','$')],['Bloco',()=>wrapBlock('$$\n','\n$$')],['Bloco math',()=>wrapBlock('```math\n','\n```')]]},
 list:{title:'Lista',items:[['Marcadores',()=>prefixLines('- ')],['Numerada',()=>prefixLines('1. ')],['Tarefa',()=>prefixLines('- [ ] ')],['Tarefa concluída',()=>prefixLines('- [x] ')]]},
 media:{title:'Mídia',items:[['URL',()=>mediaUrlForm()],['Upload',()=>mediaUploadForm()],['Collage',()=>collectionForm('tg-collage')],['Slideshow',()=>collectionForm('tg-slideshow')]]},
 structure:{title:'Estrutura',items:[['Tabela',()=>tableForm()],['Referência',()=>referenceForm()],['Âncora',()=>openForm('Âncora',[['name','Nome','secao']],v=>replaceSelection('<a name="'+escapeAttr(v.name)+'"></a>','',{cursorInside:false}))],['Detalhes',()=>detailsForm()],['Mapa',()=>mapForm()],['Botão URL',()=>buttonForm('url')],['Botão copiar',()=>buttonForm('copy_text')],['Mini App',()=>buttonForm('web_app')],['Divisor',()=>wrapBlock('---','')],['Rodapé',()=>replaceSelection('<footer>','</footer>')]]}
};
menus['text-extra']={title:'Texto',items:menus.text.items.filter(([label])=>['Marcado','Spoiler','Subscrito','Sobrescrito'].includes(label))};
const linkAction=menus.text.items.find(([label])=>label==='Link')[1];
const directActions={
 'Negrito':()=>replaceSelection('**','**',{keepSelected:true}),
 'Itálico':()=>replaceSelection('*','*',{keepSelected:true}),
 'Sublinhado':()=>replaceSelection('<u>','</u>',{keepSelected:true}),
 'Riscado':()=>replaceSelection('~~','~~',{keepSelected:true}),
 'Link':linkAction
};
function escapeHtml(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function menuSvg(body){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+body+'</svg>'}
function menuGlyph(text){return '<span class="menu-glyph" aria-hidden="true">'+escapeHtml(text)+'</span>'}
function familyIcon(key){
 if(key==='text-extra')return menuGlyph('Aa');
 if(key==='heading')return menuGlyph('H');
 if(key==='quote')return menuSvg('<path d="M5 7h5v5H7.5A3.5 3.5 0 0 1 4 8.5V7h1Zm9 0h5v5h-2.5A3.5 3.5 0 0 1 13 8.5V7h1Z"/>');
 if(key==='code')return menuGlyph('</>');
 if(key==='math')return menuGlyph('Σ');
 if(key==='list')return menuSvg('<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4" cy="7" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17" r="1"/>');
 if(key==='media')return menuSvg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4.5-4 3 2.5 2.5-2 4 3.5"/>');
 return menuSvg('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>');
}
function optionIcon(family,label){
 if(family==='text-extra'){
  if(label==='Marcado')return menuGlyph('==');
  if(label==='Spoiler')return menuSvg('<path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z"/><path d="M5 19 19 5"/>');
  if(label==='Subscrito')return menuGlyph('A₂');
  if(label==='Sobrescrito')return menuGlyph('A²');
 }
 if(family==='heading')return menuGlyph(label);
 if(family==='quote'){
  if(label==='Expandível')return menuSvg('<path d="M5 7h5v5H7.5A3.5 3.5 0 0 1 4 8.5V7h1Zm9 0h5v5h-2.5A3.5 3.5 0 0 1 13 8.5V7h1Z"/><path d="m9 18 3 3 3-3"/>');
  if(label==='Pull quote')return menuSvg('<path d="M5 7h5v5H7.5A3.5 3.5 0 0 1 4 8.5V7h1Zm9 0h5v5h-2.5A3.5 3.5 0 0 1 13 8.5V7h1Z"/><path d="M7 18h10"/>');
  return familyIcon('quote');
 }
 if(family==='code'){
  if(label==='Inline')return menuGlyph('`x`');
  if(label==='Com linguagem')return menuGlyph('{ }');
  return menuGlyph('</>');
 }
 if(family==='math'){
  if(label==='Inline')return menuGlyph('$x$');
  if(label==='Bloco math')return menuGlyph('∑');
  return menuGlyph('Σ');
 }
 if(family==='list'){
  if(label==='Marcadores')return menuSvg('<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4" cy="7" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17" r="1"/>');
  if(label==='Numerada')return menuGlyph('1.');
  if(label==='Tarefa')return menuSvg('<rect x="4" y="5" width="5" height="5"/><rect x="4" y="14" width="5" height="5"/><path d="M12 7.5h8M12 16.5h8"/>');
  return menuSvg('<rect x="4" y="5" width="5" height="5"/><path d="m5.5 7.5 1.2 1.2L9 6"/><rect x="4" y="14" width="5" height="5"/><path d="m5.5 16.5 1.2 1.2L9 15"/><path d="M12 7.5h8M12 16.5h8"/>');
 }
 if(family==='media'){
  if(label==='URL')return menuSvg('<path d="M9.5 14.5 14.5 9.5M7.2 16.8l-1 1a3.5 3.5 0 0 1-5-5l3.2-3.2a3.5 3.5 0 0 1 5 0M16.8 7.2l1-1a3.5 3.5 0 1 1 5 5l-3.2 3.2a3.5 3.5 0 0 1-5 0"/>');
  if(label==='Upload')return menuSvg('<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 15.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5"/>');
  if(label==='Collage')return menuSvg('<rect x="3" y="4" width="8" height="7"/><rect x="13" y="4" width="8" height="7"/><rect x="3" y="13" width="8" height="7"/><rect x="13" y="13" width="8" height="7"/>');
  return menuSvg('<rect x="4" y="5" width="14" height="12" rx="1"/><path d="M8 20h12V9"/>');
 }
 if(family==='structure'){
  if(label==='Tabela')return menuSvg('<rect x="3" y="4" width="18" height="16"/><path d="M3 10h18M9 4v16M15 4v16"/>');
  if(label==='Referência')return menuGlyph('¶');
  if(label==='Âncora')return menuSvg('<circle cx="12" cy="5" r="2"/><path d="M12 7v13M6 12H3a9 9 0 0 0 18 0h-3"/>');
  if(label==='Detalhes')return menuSvg('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="m8 10 4 4 4-4"/>');
  if(label==='Mapa')return menuSvg('<path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/>');
  if(label==='Botão URL')return menuSvg('<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M9 12h6"/>');
  if(label==='Botão copiar')return menuSvg('<rect x="8" y="8" width="11" height="11" rx="1"/><path d="M5 16H4V5a1 1 0 0 1 1-1h11v1"/>');
  if(label==='Mini App')return menuSvg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>');
  if(label==='Divisor')return menuSvg('<path d="M4 12h16"/>');
  if(label==='Rodapé')return menuSvg('<path d="M4 6h16M4 16h16M8 19h8"/>');
 }
 return familyIcon(family);
}
function openMenu(key){remember();activeMenu=key;toolbar.querySelectorAll('[data-menu]').forEach(b=>{const on=b.dataset.menu===key;b.classList.toggle('on',on);b.setAttribute('aria-expanded',on?'true':'false')});popoverTitle.innerHTML='<span class="menu-title-icon">'+familyIcon(key)+'</span><span>'+escapeHtml(menus[key].title)+'</span>';popoverBody.innerHTML='';const grid=document.createElement('div');grid.className='grid';menus[key].items.forEach(([label,fn])=>{const b=document.createElement('button');b.type='button';b.className='menu-option';b.setAttribute('aria-label',label);b.innerHTML='<span class="menu-option-icon">'+optionIcon(key,label)+'</span><span>'+escapeHtml(label)+'</span>';b.addEventListener('pointerdown',e=>e.preventDefault());b.onclick=fn;grid.appendChild(b)});popoverBody.appendChild(grid);popover.classList.add('on');popover.setAttribute('aria-hidden','false');positionPopover()}
function closePopover(){popover.classList.remove('on');popover.setAttribute('aria-hidden','true');toolbar.querySelectorAll('[data-menu]').forEach(b=>{b.classList.remove('on');b.setAttribute('aria-expanded','false')});activeMenu=''}
function markerPositions(value,token,singleStar){const out=[];for(let i=0;i<=value.length-token.length;){if(value.slice(i,i+token.length)!==token){i++;continue}if(i>0&&value[i-1]==='\\'){i+=token.length;continue}if(singleStar&&(value[i-1]==='*'||value[i+1]==='*')){i++;continue}out.push(i);i+=token.length}return out}
function tokenActive(token,singleStar){const value=editor.value,s=editor.selectionStart,e=editor.selectionEnd,selected=value.slice(s,e);if(e>s&&selected.startsWith(token)&&selected.endsWith(token)&&selected.length>=token.length*2)return true;if(e>s&&value.slice(Math.max(0,s-token.length),s)===token&&value.slice(e,e+token.length)===token)return true;const positions=markerPositions(value,token,!!singleStar);for(let i=0;i+1<positions.length;i+=2){const left=positions[i]+token.length,right=positions[i+1];if(s>=left&&e<=right)return true}return false}
function htmlActive(open,close){const value=editor.value,s=editor.selectionStart,e=editor.selectionEnd,selected=value.slice(s,e);if(e>s&&selected.startsWith(open)&&selected.endsWith(close))return true;if(e>s&&value.slice(Math.max(0,s-open.length),s)===open&&value.slice(e,e+close.length)===close)return true;const left=value.lastIndexOf(open,s),right=value.indexOf(close,Math.max(s,e));return left>=0&&left+open.length<=s&&right>=e}
function formatActive(format){if(format==='bold')return tokenActive('**',false);if(format==='italic')return tokenActive('*',true);if(format==='underline')return htmlActive('<u>','</u>');if(format==='strike')return tokenActive('~~',false);return false}
function updatePressed(){toolbar.querySelectorAll('[data-format]').forEach(button=>{const active=formatActive(button.dataset.format);button.setAttribute('aria-pressed',active?'true':'false')})}
toolbar.querySelectorAll('[data-menu]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();remember()});b.onclick=()=>activeMenu===b.dataset.menu?closePopover():openMenu(b.dataset.menu)});
toolbar.querySelectorAll('[data-direct]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();remember()});b.onclick=()=>{if(activeMenu)closePopover();const fn=directActions[b.dataset.direct];if(fn)fn();requestAnimationFrame(updatePressed)}});
['select','keyup','mouseup','touchend','input','focus','click'].forEach(ev=>editor.addEventListener(ev,updatePressed));
document.getElementById('popoverClose').onclick=()=>{closePopover();restore();requestAnimationFrame(updatePressed)};updatePressed();
function escapeAttr(v){return String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function openForm(title,fields,onSubmit,extra){remember();popoverTitle.textContent=title;popoverBody.innerHTML='';const f=document.createElement('form');f.className='form';fields.forEach(([name,label,placeholder,type])=>{const l=document.createElement('label');l.textContent=label;const i=document.createElement(type==='select'?'select':'input');i.name=name;if(type==='select'&&extra&&extra[name])extra[name].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;i.appendChild(o)});else i.placeholder=placeholder||'';l.appendChild(i);f.appendChild(l)});const submit=document.createElement('button');submit.className='primary';submit.textContent='Aplicar';f.appendChild(submit);f.onsubmit=e=>{e.preventDefault();const vals={};fields.forEach(x=>vals[x[0]]=String(f.elements[x[0]].value||'').trim());onSubmit(vals)};popoverBody.appendChild(f);popover.classList.add('on');popover.setAttribute('aria-hidden','false');positionPopover()}
function mediaUrlForm(){openForm('Mídia Rich por URL',[['url','URL HTTPS','https://…'],['caption','Legenda','Opcional']],v=>{if(!/^https:\/\//i.test(v.url)){status('A mídia Rich por URL precisa usar HTTPS.','error');return}const cap=v.caption?' \"'+v.caption.replace(/\"/g,'')+'\"':'';wrapBlock('![]('+v.url+cap+')','')})}
let pendingMediaKind='auto';function mediaUploadForm(){openForm('Upload para Telegram',[['kind','Tipo','','select'],['caption','Legenda','Opcional']],v=>{pendingMediaKind=v.kind||'auto';document.getElementById('mediaFile').dataset.caption=v.caption||'';closePopover();document.getElementById('mediaFile').click()},{kind:[['auto','Automático'],['photo','Foto'],['video','Vídeo'],['animation','Animação'],['audio','Áudio'],['document','Documento']]})}
document.getElementById('mediaFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;const fd=new FormData();fd.append('file',file);fd.append('kind',pendingMediaKind);const auth=initData();if(auth)fd.append('init_data',auth);try{status('Enviando mídia…','warn');const r=await fetch('/api/media',{method:'POST',body:fd});const j=await r.json().catch(()=>({}));if(!r.ok||!j.id)throw new Error(j.error||('HTTP '+r.status));const cap=e.target.dataset.caption||'';const title=cap?' \"'+cap.replace(/\"/g,'')+'\"':'';restore(false);const s=editor.selectionStart,v=editor.value,tag='![](mdtxtrt://'+j.kind+'/'+j.id+title+')';editor.value=v.slice(0,s)+tag+v.slice(editor.selectionEnd);const p=s+tag.length;editor.focus();editor.setSelectionRange(p,p);savedSel={start:p,end:p};save();status('Mídia pronta para Telegram Rich 10.3.','warn')}catch(err){status(err.message||'Falha no upload.','error')}e.target.value=''};
function collectionForm(tag){openForm(tag==='tg-collage'?'Collage':'Slideshow',[['urls','URLs HTTPS separadas por espaço','https://… https://…']],v=>{const urls=v.urls.split(/\s+/).filter(Boolean);if(!urls.length||urls.some(u=>!/^https:\/\//i.test(u))){status('Informe URLs HTTPS válidas.','error');return}wrapBlock('<'+tag+'>\n\n'+urls.map(u=>'![]('+u+')').join('\n\n')+'\n\n','\n</'+tag+'>')})}
function tableForm(){openForm('Tabela',[['rows','Linhas','2'],['cols','Colunas','2']],v=>{let r=Math.max(1,Math.min(20,parseInt(v.rows||'2',10))),c=Math.max(1,Math.min(20,parseInt(v.cols||'2',10)));const blank='| '+Array(c).fill(' ').join(' | ')+' |',sep='| '+Array(c).fill('---').join(' | ')+' |';const rows=[blank,sep];for(let i=1;i<r;i++)rows.push(blank);wrapBlock(rows.join('\n'),'')})}
function referenceForm(){remember();const selected=editor.value.slice(savedSel.start,savedSel.end);openForm('Referência',[['name','Identificador','nota'],['label','Texto do link',selected?'Seleção atual':''],['body','Conteúdo da referência','']],v=>{const name=(v.name||'').replace(/[^A-Za-z0-9_.:-]/g,'-');const