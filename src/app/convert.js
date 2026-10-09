
import { S } from "./state.js";
import { PORTABLE_ATTRS, PORTABLE_TAGS } from "./constants.js";
import { docName, editor } from "./dom.js";
import { getTg } from "./theme.js";
import { browserOwnerKey } from "./draft.js";
import { requireEditorCore } from "./editing.js";

export function escapeHTML(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function htmlToText(html){
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
export function txtLosesStructure(html=''){
  let root=editor;
  if(html){
    root=document.createElement('div');
    root.innerHTML=html;
  }
  return Boolean(root.querySelector('h1,h2,h3,h4,h5,h6,strong,b,em,i,u,ins,s,strike,del,code,mark,sub,sup,tg-spoiler,tg-reference,tg-emoji,tg-time,tg-math,tg-math-block,hr,ul,ol,li,blockquote,aside,footer,table,details,summary,a[href],figure,figcaption,input'))||Boolean(root.querySelector('.tg-footer,blockquote[expandable]'));
}
export function conversionWarning(format,html=''){
  if(format==='txt'&&txtLosesStructure(html))return 'TXT preserva apenas texto simples. Formatação, links e estrutura detectados serão perdidos. Exportar mesmo assim?';
  return '';
}
export function normalizePortableHTML(root,label='conteúdo'){
  for(const el of root.querySelectorAll('*')){
    const tag=el.localName;
    if(!PORTABLE_TAGS.has(tag))throw new Error('Elemento '+label+' não suportado: '+tag);
    el.removeAttribute('contenteditable');
    el.removeAttribute('draggable');
    for(const a of [...el.attributes]){
      if(a.name==='controls'&&['video','audio'].includes(tag)){el.removeAttribute(a.name);continue;}
      if(a.name==='disabled'&&tag==='input'&&el.getAttribute('type')==='checkbox'){el.removeAttribute(a.name);continue;}
      if(!PORTABLE_ATTRS.has(a.name) || a.name==='class' && !(tag==='code'&&/^language-[a-z0-9+-]+$/i.test(a.value)||['p','footer'].includes(tag)&&a.value==='tg-footer') || a.name==='style' && !(tag==='tg-button'&&['link','primary','success','danger'].includes(a.value))) throw new Error('Atributo '+label+' não suportado: '+a.name);
      if(['src','href','url'].includes(a.name) && !/^(https?:|mailto:|tel:|tg:|#)/i.test(a.value)) throw new Error('Link '+label+' inválido');
    }
  }
  return root;
}
export function portableExportHTML(html){
  const box=document.createElement('div');box.innerHTML=String(html||'');
  if(box.querySelector('[data-media-id]'))throw new Error('Anexos locais precisam de URL pública para exportar Markdown');
  normalizePortableHTML(box,'do documento');
  return box.innerHTML;
}
export function htmlToMarkdown(html){
  if(!window.TurndownService) throw new Error('Conversão Markdown indisponível');
  const portable=portableExportHTML(html);
  const svc = new TurndownService({headingStyle:'atx', codeBlockStyle:'fenced', bulletListMarker:'-', emDelimiter:'*'});
  svc.addRule('strikethrough',{filter:['s','strike','del'],replacement:content=>content?'~~'+content+'~~':''});
  svc.addRule('special', {filter: node => ['TG-SPOILER','TG-REFERENCE','TG-EMOJI','TG-TIME','TG-MATH','TG-MATH-BLOCK','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-BUTTON','TG-BUTTON-ROW','DETAILS','TABLE','FIGURE','ASIDE','FOOTER','SUB','SUP','MARK','U','INPUT','IFRAME','VIDEO','AUDIO'].includes(node.nodeName) || node.nodeName==='BLOCKQUOTE' && node.hasAttribute('expandable') || node.classList?.contains('tg-footer') || node.nodeName === 'A' && node.hasAttribute('name'), replacement: (_,node)=>['DETAILS','TABLE','FIGURE','ASIDE','FOOTER','IFRAME','VIDEO','AUDIO','BLOCKQUOTE','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-MATH-BLOCK','TG-BUTTON-ROW','P'].includes(node.nodeName)?'\n\n'+node.outerHTML+'\n\n':node.outerHTML});
  return svc.turndown(portable);
}
export function mdToBasicHTML(md){
  if(!window.marked) throw new Error('Importação Markdown indisponível');
  const box = document.createElement('div');
  box.innerHTML = window.marked.parse(md, {gfm:true, breaks:false});
  normalizePortableHTML(box,'Markdown');
  return box.innerHTML;
}
export function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');
  a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
export function telegraphURL(value){
  let url;try{url=new URL(value,location.href);}catch{throw new Error('Link do Telegraph inválido');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('O Telegraph exige links HTTP ou HTTPS');
  return url.href;
}
function telegraphCredit(el, standalone, conv){
  
  
  if(!el.textContent.trim()) return null;
  const children=Array.from(el.childNodes).map(conv).flat().filter(v => v !== null && v !== '');
  if(!children.length) return null;
  if(standalone) return {tag:'p', children};
  let prev=el.previousSibling;
  while(prev && prev.nodeType !== 1 && !(prev.nodeType === 3 && prev.textContent.trim())) prev=prev.previousSibling;
  return prev && prev.nodeName.toLowerCase() !== 'br' ? [{tag:'br'}, ...children] : children;
}
export function telegraphNodes(root){
  const allow = new Set(['a','aside','b','blockquote','br','code','em','figcaption','figure','h3','h4','hr','i','iframe','img','li','ol','p','pre','s','strong','u','ul','video']);
  const conv = (el, standalone=false) => {
    if(el.nodeType === 3){const text=el.textContent;if(standalone&&!text.trim())return null;return standalone?{tag:'p',children:[text]}:text;}
    if(el.nodeType !== 1) return null;
    let tag = el.tagName.toLowerCase();
    if(el.hasAttribute('data-media-id')) throw new Error('O Telegraph precisa de uma URL pública para mídia');
    if(['div','article','section','span','thead','tbody','tfoot'].includes(tag)) return Array.from(el.childNodes).map(child=>conv(child,standalone)).flat().filter(Boolean);
    
    
    if(tag === 'cite') return telegraphCredit(el, standalone, child=>conv(child,false));
    if(!allow.has(tag)) throw new Error('O conteúdo contém um elemento que o Telegraph não aceita: ' + tag);
    const node = {tag};
    if(tag === 'a'){const href=el.getAttribute('href');if(!href)throw new Error('Âncoras do Telegram não podem ser publicadas no Telegraph');node.attrs={href:telegraphURL(href)};}
    if(['img','video','iframe'].includes(tag)){const src=el.getAttribute('src');if(!src)throw new Error('A mídia precisa de um endereço');node.attrs={src:telegraphURL(src)};}
    const children = Array.from(el.childNodes).map(child=>conv(child,false)).flat().filter(v => v !== null && v !== '');
    if(children.length) node.children = children;
    return node;
  };
  return Array.from(root.childNodes).map(el=>conv(el,true)).flat().filter(Boolean);
}
export function toRichHTML(root){
  const allow=new Set(['a','b','strong','i','em','u','ins','s','strike','del','code','mark','sub','sup','tg-spoiler','tg-reference','tg-emoji','tg-time','tg-math','h1','h2','h3','h4','h5','h6','p','pre','footer','hr','ul','ol','li','input','blockquote','aside','cite','img','video','audio','tg-document','figure','figcaption','tg-map','tg-collage','tg-slideshow','table','caption','tr','th','td','details','summary','tg-math-block','tg-button','tg-button-row','br']);
  const unwrap=new Set(['div','article','section','span','thead','tbody','tfoot']);
  const amap={
    a:['href','name'],code:['class'],ol:['start','type','reversed'],li:['value','type'],input:['type','checked'],
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
    
    if(tag==='cite'&&!(n.textContent||'').trim()) return '';
    if(!allow.has(tag)) throw new Error('O conteúdo contém um elemento que o Telegram não aceita: '+tag);
    const attrs=[];
    if(tag==='blockquote'&&n.hasAttribute('expandable')) attrs.push('expandable');
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
  const html=Array.from(root.childNodes).map(walk).join('');
  if(!html.trim())throw new Error('Escreva algo antes de enviar');
  return html;
}
export function buildRich(){
  return {rich_message: {html:toRichHTML(editor)}};
}
export function buildTelegraph(){
  const title=docName.value.trim();
  if(!title) throw new Error('Dê um nome à página antes de publicar');
  const identity=S.session==='ready'?{initData:getTg().initData}:{browserKey:browserOwnerKey()};
  return {title, content: telegraphNodes(editor), path: S.telegraphPath, doc: S.docId, revision: S.docRevision, ...identity};
}
export function exportDocumentHTML(){
  return S.exportOverride?.html??requireEditorCore().html();
}
export function exportName(ext){
  const sourceName=S.exportOverride?.name??docName.value;
  const base=sourceName.trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/^\.+|\.+$/g,"").slice(0,80);
  if(!base)throw new Error('Dê um nome ao documento antes de exportar');
  return base+"."+ext;
}
