(function(){
const editor=document.getElementById('editor');
const legacyToolbar=document.getElementById('toolbar');
const quickToolbar=document.getElementById('quickToolbar');
const popover=document.getElementById('popover');
const popoverBody=document.getElementById('popoverBody');
const popoverTitle=document.getElementById('popoverTitle');
const popoverClose=document.getElementById('popoverClose');
if(!editor||!legacyToolbar||!quickToolbar||!popover||!popoverBody||!popoverTitle)return;

const families={
 'text-extra':{legacy:'text',title:'Texto',allowed:['Marcado','Spoiler','Subscrito','Sobrescrito']},
 heading:{legacy:'heading',title:'Título'},
 quote:{legacy:'quote',title:'Citação'},
 code:{legacy:'code',title:'Código'},
 math:{legacy:'math',title:'Matemática'},
 list:{legacy:'list',title:'Lista'},
 media:{legacy:'media',title:'Mídia'},
 structure:{legacy:'structure',title:'Estrutura'}
};
let visibleFamily='';

function esc(value){return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function svg(body){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+body+'</svg>'}
function glyph(text){return '<span class="menu-glyph" aria-hidden="true">'+esc(text)+'</span>'}
function familyIcon(key){
 if(key==='text-extra')return glyph('Aa');
 if(key==='heading')return glyph('H');
 if(key==='quote')return svg('<path d="M5 7h5v5H7.5A3.5 3.5 0 0 1 4 8.5V7h1Zm9 0h5v5h-2.5A3.5 3.5 0 0 1 13 8.5V7h1Z"/>');
 if(key==='code')return glyph('</>');
 if(key==='math')return glyph('Σ');
 if(key==='list')return svg('<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4" cy="7" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17" r="1"/>');
 if(key==='media')return svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4.5-4 3 2.5 2.5-2 4 3.5"/>');
 return svg('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>');
}
function optionIcon(family,label){
 if(family==='text-extra'){
  if(label==='Marcado')return glyph('==');
  if(label==='Spoiler')return svg('<path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z"/><path d="M5 19 19 5"/>');
  if(label==='Subscrito')return glyph('A₂');
  if(label==='Sobrescrito')return glyph('A²');
 }
 if(family==='heading')return glyph(label);
 if(family==='quote'){
  if(label==='Expandível')return svg('<path d="M5 7h5v5H7.5A3.5 3.5 0 0 1 4 8.5V7h1Zm9 0h5v5h-2.5A3.5 3.5 0 0 1 13 8.5V7h1Z"/><path d="m9 18 3 3 3-3"/>');
  if(label==='Pull quote')return svg('<path d="M5 7h5v5H7.5A3.5 3.5 0 0 1 4 8.5V7h1Zm9 0h5v5h-2.5A3.5 3.5 0 0 1 13 8.5V7h1Z"/><path d="M7 18h10"/>');
  return familyIcon('quote');
 }
 if(family==='code'){
  if(label==='Inline')return glyph('`x`');
  if(label==='Com linguagem')return glyph('{ }');
  return glyph('</>');
 }
 if(family==='math'){
  if(label==='Inline')return glyph('$x$');
  if(label==='Bloco math')return glyph('∑');
  return glyph('Σ');
 }
 if(family==='list'){
  if(label==='Marcadores')return svg('<path d="M8 7h12M8 12h12M8 17h12"/><circle cx="4" cy="7" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="17" r="1"/>');
  if(label==='Numerada')return glyph('1.');
  if(label==='Tarefa')return svg('<rect x="4" y="5" width="5" height="5"/><rect x="4" y="14" width="5" height="5"/><path d="M12 7.5h8M12 16.5h8"/>');
  return svg('<rect x="4" y="5" width="5" height="5"/><path d="m5.5 7.5 1.2 1.2L9 6"/><rect x="4" y="14" width="5" height="5"/><path d="m5.5 16.5 1.2 1.2L9 15"/><path d="M12 7.5h8M12 16.5h8"/>');
 }
 if(family==='media'){
  if(label==='URL')return svg('<path d="M9.5 14.5 14.5 9.5M7.2 16.8l-1 1a3.5 3.5 0 0 1-5-5l3.2-3.2a3.5 3.5 0 0 1 5 0M16.8 7.2l1-1a3.5 3.5 0 1 1 5 5l-3.2 3.2a3.5 3.5 0 0 1-5 0"/>');
  if(label==='Upload')return svg('<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 15.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5"/>');
  if(label==='Collage')return svg('<rect x="3" y="4" width="8" height="7"/><rect x="13" y="4" width="8" height="7"/><rect x="3" y="13" width="8" height="7"/><rect x="13" y="13" width="8" height="7"/>');
  return svg('<rect x="4" y="5" width="14" height="12" rx="1"/><path d="M8 20h12V9"/>');
 }
 if(family==='structure'){
  if(label==='Tabela')return svg('<rect x="3" y="4" width="18" height="16"/><path d="M3 10h18M9 4v16M15 4v16"/>');
  if(label==='Referência')return glyph('¶');
  if(label==='Âncora')return svg('<circle cx="12" cy="5" r="2"/><path d="M12 7v13M6 12H3a9 9 0 0 0 18 0h-3"/>');
  if(label==='Detalhes')return svg('<rect x="4" y="5" width="16" height="14" rx="1"/><path d="m8 10 4 4 4-4"/>');
  if(label==='Mapa')return svg('<path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/>');
  if(label==='Botão URL')return svg('<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M9 12h6"/>');
  if(label==='Botão copiar')return svg('<rect x="8" y="8" width="11" height="11" rx="1"/><path d="M5 16H4V5a1 1 0 0 1 1-1h11v1"/>');
  if(label==='Mini App')return svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>');
  if(label==='Divisor')return svg('<path d="M4 12h16"/>');
  if(label==='Rodapé')return svg('<path d="M4 6h16M4 16h16M8 19h8"/>');
 }
 return familyIcon(family);
}
function legacyButton(key){return legacyToolbar.querySelector('[data-menu="'+key+'"]')}
function menuButtons(){return Array.from(popoverBody.querySelectorAll('.grid button'))}
function clearFamily(){
 visibleFamily='';
 quickToolbar.querySelectorAll('[data-family]').forEach(button=>{button.classList.remove('on');button.setAttribute('aria-expanded','false')});
}
function markFamily(key){
 visibleFamily=key;
 quickToolbar.querySelectorAll('[data-family]').forEach(button=>{const on=button.dataset.family===key;button.classList.toggle('on',on);button.setAttribute('aria-expanded',on?'true':'false')});
}
function decorateMenu(key){
 const spec=families[key];
 if(!spec)return;
 popoverTitle.innerHTML='<span class="menu-title-icon">'+familyIcon(key)+'</span><span>'+esc(spec.title)+'</span>';
 menuButtons().forEach(button=>{
  const label=button.textContent.trim();
  if(spec.allowed&&!spec.allowed.includes(label)){button.remove();return}
  button.classList.add('menu-option');
  button.setAttribute('aria-label',label);
  button.innerHTML='<span class="menu-option-icon">'+optionIcon(key,label)+'</span><span>'+esc(label)+'</span>';
 });
}
function openFamily(key){
 const spec=families[key],trigger=spec&&legacyButton(spec.legacy);
 if(!trigger)return;
 if(visibleFamily===key&&popover.classList.contains('on')){trigger.click();clearFamily();return}
 trigger.click();
 markFamily(key);
 decorateMenu(key);
}
function runDirect(label){
 if(popover.classList.contains('on')&&popoverClose)popoverClose.click();
 clearFamily();
 const trigger=legacyButton('text');
 if(!trigger)return;
 trigger.click();
 const target=menuButtons().find(button=>button.textContent.trim()===label);
 if(target)target.click();
 requestAnimationFrame(updatePressed);
}

function markerPositions(value,token,singleStar){
 const out=[];
 for(let i=0;i<=value.length-token.length;){
  if(value.slice(i,i+token.length)!==token){i++;continue}
  if(i>0&&value[i-1]==='\\'){i+=token.length;continue}
  if(singleStar&&(value[i-1]==='*'||value[i+1]==='*')){i++;continue}
  out.push(i);i+=token.length;
 }
 return out;
}
function tokenActive(token,singleStar){
 const value=editor.value,s=editor.selectionStart,e=editor.selectionEnd,selected=value.slice(s,e);
 if(e>s&&selected.startsWith(token)&&selected.endsWith(token)&&selected.length>=token.length*2)return true;
 if(e>s&&value.slice(Math.max(0,s-token.length),s)===token&&value.slice(e,e+token.length)===token)return true;
 const positions=markerPositions(value,token,!!singleStar);
 for(let i=0;i+1<positions.length;i+=2){
  const left=positions[i]+token.length,right=positions[i+1];
  if(s>=left&&e<=right)return true;
 }
 return false;
}
function htmlActive(open,close){
 const value=editor.value,s=editor.selectionStart,e=editor.selectionEnd,selected=value.slice(s,e);
 if(e>s&&selected.startsWith(open)&&selected.endsWith(close))return true;
 if(e>s&&value.slice(Math.max(0,s-open.length),s)===open&&value.slice(e,e+close.length)===close)return true;
 const left=value.lastIndexOf(open,s),right=value.indexOf(close,Math.max(s,e));
 return left>=0&&left+open.length<=s&&right>=e;
}
function formatActive(format){
 if(format==='bold')return tokenActive('**',false);
 if(format==='italic')return tokenActive('*',true);
 if(format==='underline')return htmlActive('<u>','</u>');
 if(format==='strike')return tokenActive('~~',false);
 return false;
}
function updatePressed(){
 quickToolbar.querySelectorAll('[data-format]').forEach(button=>{
  const active=formatActive(button.dataset.format);
  button.classList.toggle('on',active);
  button.setAttribute('aria-pressed',active?'true':'false');
 });
}

quickToolbar.addEventListener('pointerdown',event=>{
 const button=event.target.closest('button');
 if(button&&quickToolbar.contains(button))event.preventDefault();
});
quickToolbar.addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button||!quickToolbar.contains(button))return;
 if(button.dataset.direct){runDirect(button.dataset.direct);return}
 if(button.dataset.family)openFamily(button.dataset.family);
});
['select','keyup','mouseup','touchend','input','focus','click'].forEach(name=>editor.addEventListener(name,updatePressed));
if(popoverClose)popoverClose.addEventListener('click',()=>requestAnimationFrame(clearFamily));
new MutationObserver(()=>{if(!popover.classList.contains('on'))clearFamily()}).observe(popover,{attributes:true,attributeFilter:['class']});
updatePressed();
})();
