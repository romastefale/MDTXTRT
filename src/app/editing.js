// Edição: comandos de formatação, links, inserções e seleção.
import { S } from "./state.js";
import { all, editor, linkBtn, one, ui } from "./dom.js";
import { restoreActiveMediaVisual } from "./media.js";
import { closePanels, panelIsOpen, showToast } from "./panels.js";
import { approve, ask } from "./dialog.js";
import { escapeHTML } from "./convert.js";
import { scheduleCaretVisible } from "./viewport.js";

export function requireEditorCore(){
  if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
  return S.editorCore;
}
export function currentEditorCore(){return requireEditorCore();}
export function saveSel(){
  const core=requireEditorCore(),next=core.saveSelection();
  if(next)S.savedRange=next;
  core.rememberSelection?.();
  return S.savedRange;
}
export function restoreSel(){
  const core=requireEditorCore(),current=core.saveSelection();
  if(current){S.savedRange=current;core.rememberSelection?.();return true;}
  return S.savedRange?core.restoreSelection(S.savedRange):false;
}
export function histUndo(){const done=requireEditorCore().undo();if(done){restoreActiveMediaVisual();syncEditorSelectionUI();}return done;}
export function histRedo(){if(requireEditorCore().redo()){restoreActiveMediaVisual();syncEditorSelectionUI();}}
export function expandWord(){
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
  S.savedRange = r.cloneRange();
}
export function exec(cmd,value=null){
  if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
  restoreSel();
  if(cmd==='insertUnorderedList')return toggleList();
  S.editorCore.exec(cmd,value);
  syncEditorSelectionUI();
}
export function toggleList(type='ul'){
  if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
  restoreSel();
  if(!S.editorCore.toggleList(type))throw new Error('Selecione parágrafos para criar a lista');
  syncEditorSelectionUI();closePanels();
}
export function formatBlock(tag){
  if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
  restoreSel();
  if(!S.editorCore.formatBlock(tag))throw new Error('Não foi possível alterar o bloco');
  syncEditorSelectionUI();closePanels();
}
export function insertHTML(html,asBlock=false){
  if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
  restoreSel();
  if(!S.editorCore.insertHTML(html,asBlock))throw new Error('Não foi possível inserir o conteúdo');
  closePanels();syncEditorSelectionUI();
}
export function mediaTag(url){
  const path=new URL(url).pathname.toLowerCase();
  return /\.(mp4|mov|webm|m4v|gif)$/.test(path)?'video':'img';
}
export async function askUrl(label,value='https://',protocols=['http:','https:','tg:']){
  const answer=await ask(label,value);
  if(answer===null||!answer.trim())return '';
  try{
    const url=new URL(answer.trim());
    if(!protocols.includes(url.protocol))throw new Error();
    return url.href;
  }catch{
    showToast(protocols.length===2?'A mídia precisa usar HTTP ou HTTPS':'Use um link válido');
    return '';
  }
}
export function inlineLinkProtocols(destination=S.dest){
  return destination==='telegraph'?['http:','https:']:['http:','https:','mailto:','tel:','tg:'];
}
export async function askInlineLink(label,value='https://',{destination=S.dest,protocols=inlineLinkProtocols(destination),anchor=linkBtn}={}){
  const answer=await ask(label,value,1,anchor);
  if(answer===null||!answer.trim())return null;
  const text=answer.trim();
  try{
    const url=new URL(text);
    if(!protocols.includes(url.protocol))throw new Error();
    return {href:url.href,text};
  }catch{
    showToast(destination==='telegraph'?'O Telegraph exige link HTTP ou HTTPS':'Use um link válido');
    return null;
  }
}
export async function insertHyperlink(){
  const destination=S.dest;
  restoreSel();
  if(requireEditorCore().selectionEmpty())S.editorCore.expandWord();
  if(requireEditorCore().selectionEmpty())return showToast('Selecione um texto para criar o hiperlink');
  const current=requireEditorCore().linkHref()||'https://';
  const link=await askInlineLink('URL do hiperlink',current,{destination,anchor:linkBtn});
  if(!link)return;
  restoreSel();
  if(requireEditorCore().selectionEmpty())return showToast('Selecione um texto para criar o hiperlink');
  exec('createLink',link.href);
}
export async function insertVisibleLink(){
  const destination=S.dest;
  const link=await askInlineLink('Link','https://',{destination,anchor:linkBtn});
  if(!link)return;
  restoreSel();
  insertHTML('<a href="'+escapeHTML(link.href)+'">'+escapeHTML(link.text)+'</a>');
}
export async function insertLinkButton(){
  const destination=S.dest;
  if(destination!=='telegram')return showToast('Botões com link estão disponíveis apenas no Telegram');
  const labelAnswer=await ask('Texto do botão','Abrir',1,linkBtn);
  if(labelAnswer===null)return;
  const label=labelAnswer.trim();
  if(!label)return;
  const link=await askInlineLink('Link do botão','https://',{destination,protocols:['http:','https:','tg:'],anchor:linkBtn});
  if(!link)return;
  restoreSel();
  insertHTML('<tg-button-row align="center"><tg-button type="url" url="'+escapeHTML(link.href)+'">'+escapeHTML(label)+'</tg-button></tg-button-row>',true);
}
export async function mediaUrl(){
  return askUrl('Link da mídia','https://',['http:','https:']);
}
export async function figure(kind){
  const url=await mediaUrl();
  if(!url)return;
  const caption=await ask('Legenda','');
  if(caption===null)return;
  const credit=caption?await ask('Crédito',''):'';
  if(credit===null)return;
  const cap=caption?'<figcaption>'+escapeHTML(caption)+(credit?'<cite>'+escapeHTML(credit)+'</cite>':'')+'</figcaption>':'';
  const tag=kind==='image'?'<img src="'+escapeHTML(url)+'"/>' :
    kind==='video'?'<video src="'+escapeHTML(url)+'"></video>' :
    kind==='audio'?'<audio src="'+escapeHTML(url)+'"></audio>' :
    '<tg-document src="'+escapeHTML(url)+'"></tg-document>';
  insertHTML('<figure>'+tag+cap+'</figure>',true);
}
export async function insertFeature(kind){
  if(kind==='task')return insertHTML('<ul><li><input type="checkbox"></li></ul>',true);
  if(kind==='ordered')return toggleList('ol');
  if(kind==='divider')return insertHTML('<hr/>',true);
  if(kind==='table'){
    const columnsAnswer=await ask('Colunas (1–20)','1');
    if(columnsAnswer===null)return;
    const columns=Number(columnsAnswer.trim());
    if(!Number.isSafeInteger(columns)||columns<1||columns>20)return showToast('O Telegram aceita de 1 a 20 colunas por tabela');
    const rowsAnswer=await ask('Linhas','1');
    if(rowsAnswer===null)return;
    const rows=Number(rowsAnswer.trim());
    if(!Number.isSafeInteger(rows)||rows<1)return showToast('Informe ao menos uma linha');
    const caption=await ask('Legenda da tabela','');
    if(caption===null)return;
    const head='<tr>'+Array.from({length:columns},()=>'<th></th>').join('')+'</tr>';
    const body=Array.from({length:Math.max(0,rows-1)},()=>'<tr>'+Array.from({length:columns},()=>'<td></td>').join('')+'</tr>').join('');
    return insertHTML('<table bordered striped compact>'+(caption?'<caption>'+escapeHTML(caption)+'</caption>':'')+head+body+'</table>',true);
  }
  if(kind==='expandquote')return formatBlock('expandquote');
  if(kind==='pullquote')return formatBlock('pullquote');
  if(kind==='details')return insertHTML('<details open><summary></summary><p></p></details>',true);
  if(kind==='mathblock'){
    const value=await ask('Fórmula LaTeX','E = mc^2');
    if(value)return insertHTML('<tg-math-block>'+escapeHTML(value)+'</tg-math-block>',true);
    return;
  }
  if(kind==='anchor'){
    const answer=await ask('Nome da âncora','secao');
    const name=(answer||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64);
    if(name)return insertHTML('<a name="'+escapeHTML(name)+'"></a>');
    return;
  }
  if(kind==='reference'){
    const answer=await ask('Nome da referência','nota-1');
    const name=(answer||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64);
    if(!name)return;
    const text=await ask('Texto da referência','Referência');
    if(text===null)return;
    return insertHTML('<tg-reference name="'+escapeHTML(name)+'">'+escapeHTML(text)+'</tg-reference>');
  }
  if(kind==='time'){
    const answer=await ask('Timestamp Unix',String(Math.floor(Date.now()/1000)));
    const unix=(answer||'').trim();
    if(!/^\d+$/.test(unix))return showToast('Timestamp inválido');
    const format=await ask('Formato Telegram','wDT');
    if(format===null)return;
    if(!/^(?:r|w?[dD]?[tT]?)$/.test(format.trim()))return showToast('Formato de data inválido');
    const label=await ask('Texto exibido','Data e hora');
    if(label===null)return;
    return insertHTML('<tg-time unix="'+escapeHTML(unix)+'" format="'+escapeHTML(format.trim())+'">'+escapeHTML(label)+'</tg-time>');
  }
  if(kind==='emoji'){
    const answer=await ask('ID do emoji personalizado','');
    const id=(answer||'').trim();
    if(!/^\d+$/.test(id))return showToast('ID inválido');
    const alt=await ask('Emoji alternativo','🙂');
    if(alt===null)return;
    return insertHTML('<tg-emoji emoji-id="'+escapeHTML(id)+'">'+escapeHTML(alt)+'</tg-emoji>');
  }
  if(kind==='image')return figure('image');
  if(kind==='video')return figure('video');
  if(kind==='audio')return figure('audio');
  if(kind==='document')return figure('document');
  if(kind==='embed'){
    const url=await askUrl('Link do conteúdo incorporado');
    if(url)return insertHTML('<figure><iframe src="'+escapeHTML(url)+'"></iframe></figure>',true);
    return;
  }
  if(kind==='map'){
    const values=[];
    for(const [label,value] of [['Latitude','0'],['Longitude','0'],['Zoom 0–24','14']]){
      const answer=await ask(label,value);
      if(answer===null)return;
      if(!answer.trim())return showToast('Preencha os dados do mapa');
      values.push(Number(answer));
    }
    const [lat,lon,zoom]=values;
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180||!Number.isInteger(zoom)||zoom<0||zoom>24)return showToast('Mapa inválido');
    const caption=await ask('Legenda','');
    if(caption===null)return;
    const map='<tg-map lat="'+lat+'" long="'+lon+'" zoom="'+zoom+'"/>';
    return insertHTML(caption?'<figure>'+map+'<figcaption>'+escapeHTML(caption)+'</figcaption></figure>':map,true);
  }
  if(kind==='collage'||kind==='slideshow'){
    const value=await ask('Links de imagens ou vídeos, um por linha','',4);
    if(!value)return;
    const urls=value.split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);
    if(urls.length>50)return showToast('Use no máximo 50 itens por galeria');
    const tags=[];
    for(const raw of urls){
      let url;
      try{url=new URL(raw);if(!['http:','https:'].includes(url.protocol))throw new Error();}catch{return showToast('Há um link inválido');}
      const tag=mediaTag(url.href);
      tags.push(tag==='video'?'<video src="'+escapeHTML(url.href)+'"></video>':'<img src="'+escapeHTML(url.href)+'"/>');
    }
    if(!tags.length)return;
    const caption=await ask('Legenda','');
    if(caption===null)return;
    const tag=kind==='collage'?'tg-collage':'tg-slideshow';
    return insertHTML('<'+tag+'>'+tags.join('')+(caption?'<figcaption>'+escapeHTML(caption)+'</figcaption>':'')+'</'+tag+'>',true);
  }
  if(kind==='button'){
    const answer=await ask('Tipo: url, callback_data, web_app, login_url, switch_inline_query, switch_inline_query_current_chat, switch_inline_query_chosen_chat, copy_text ou disabled','url');
    if(answer===null)return;
    const type=answer.trim();
    const types=new Set(['url','callback_data','web_app','login_url','switch_inline_query','switch_inline_query_current_chat','switch_inline_query_chosen_chat','copy_text','disabled']);
    if(!types.has(type))return showToast('Tipo de botão inválido');
    const labelAnswer=await ask('Texto do botão','Abrir');
    if(labelAnswer===null)return;
    const label=labelAnswer.trim();
    if(!label)return;
    const styleAnswer=await ask('Estilo: link, primary, success ou danger','primary');
    if(styleAnswer===null)return;
    const style=styleAnswer.trim();
    if(style&&!['link','primary','success','danger'].includes(style))return showToast('Estilo inválido');
    if(style==='link'&&type!=='callback_data')return showToast('O estilo link exige um botão de callback');
    let attr=' type="'+type+'"'+(style?' style="'+style+'"':'');
    if(type==='url'||type==='web_app'||type==='login_url'){
      const protocols=type==='url'?['http:','https:','tg:']:['https:'];
      const url=await askUrl('Link do botão','https://',protocols);
      if(!url)return;
      attr+=' url="'+escapeHTML(url)+'"';
      if(type==='login_url'){
        const forward=await ask('Texto ao encaminhar (opcional)','');
        if(forward===null)return;
        if(forward.trim())attr+=' forward-text="'+escapeHTML(forward.trim())+'"';
        if(await approve('Solicitar permissão para o bot enviar mensagens?'))attr+=' request-write-access';
      }
    }else if(type==='callback_data'){
      const data=((await ask('Callback data','action'))||'').trim();
      if(!data)return;
      if(new TextEncoder().encode(data).length>64)return showToast('O callback aceita até 64 bytes');
      attr+=' data="'+escapeHTML(data)+'"';
    }else if(type==='copy_text'){
      const answer=await ask('Texto para copiar','');
      if(answer===null)return;
      const text=answer.trim();
      if(!text||Array.from(text).length>256)return showToast('O texto para copiar deve ter de 1 a 256 caracteres');
      attr+=' text="'+escapeHTML(text)+'"';
    }else if(type.startsWith('switch_inline_query')){
      const query=await ask('Consulta inline','');
      if(query===null)return;
      attr+=' query="'+escapeHTML(query)+'"';
      if(type==='switch_inline_query_chosen_chat'){
        const chats=await ask('Chats permitidos: user, bot, group, channel (separados por vírgula; vazio = todos)','');
        if(chats===null)return;
        const values=chats.split(',').map(value=>value.trim()).filter(Boolean);
        const allowed=new Set(['user','bot','group','channel']);
        if(values.some(value=>!allowed.has(value)))return showToast('Tipo de chat inválido');
        const names={user:'allow-user-chats',bot:'allow-bot-chats',group:'allow-group-chats',channel:'allow-channel-chats'};
        for(const value of values)attr+=' '+names[value];
      }
    }
    return insertHTML('<tg-button-row align="center"><tg-button'+attr+'>'+escapeHTML(label)+'</tg-button></tg-button-row>',true);
  }
}
export function insertPlainText(text){
  if(!S.editorCore)throw new Error('Núcleo de edição indisponível');
  S.editorCore.insertText(text);
}
export function commitEditorInput(event){
  if(!S.editorCore)return;
  S.editorCore.syncFromDOM({addToHistory:true});
  const blockTransformed=S.editorCore.applyMarkdownBlockRule({allowTask:S.dest==='telegram'});
  const inlineTransformed=!blockTransformed&&S.editorCore.applyMarkdownInlineRule();
  const normalized=!blockTransformed&&!inlineTransformed&&S.editorCore.normalizeEmptyFormattedBlock(event?.inputType||'');
  if(blockTransformed||inlineTransformed||normalized)syncEditorSelectionUI();
  scheduleCaretVisible();
}
export function toggleToolbarState(btn,on){
  if(!btn)return;
  btn.classList.toggle('on',on);
  btn.setAttribute('aria-pressed',String(on));
}
export function syncEditorSelectionUI(){
  const core=requireEditorCore();
  saveSel();
  const kind=core.currentBlockKind();
  all('#typebar [data-cmd]').forEach(btn=>toggleToolbarState(btn,Boolean(core.activeMark(btn.dataset.cmd))));
  toggleToolbarState(one('#listBtn'),Boolean(core.inBlock('li'))||panelIsOpen(one('#listMenu')));
  toggleToolbarState(one('#quoteBtn'),Boolean(core.inBlock('blockquote')||core.inBlock('aside'))||panelIsOpen(one('#quoteMenu')));
  toggleToolbarState(one('#headingBtn'),/^(h[1-6]|footer)$/.test(kind)||panelIsOpen(one('#headingMenu')));
  toggleToolbarState(one('#linkBtn'),Boolean(core.linkHref())||Boolean(panelIsOpen(one('#linkMenu'))));
  syncHistoryButtons(core);
  // O React marca is-current nos menus de título e citação e o estado do botão +.
  ui.update({blockKind:kind});
}
// Desfazer sem nada a desfazer fica esmaecido. aria-disabled em vez de disabled:
// o botão continua recebendo o toque e o preventDefault que segura o teclado.
export function syncHistoryButtons(core=S.editorCore){
  const undo=one('#undoBtn');
  if(undo&&typeof core?.canUndo==='function')undo.setAttribute('aria-disabled',String(!core.canUndo()));
}
export function flashBtn(btn){
  if(!btn) return;
  btn.classList.remove('is-flash');
  void btn.offsetWidth;
  btn.classList.add('is-flash');
  clearTimeout(btn._flash);
  btn._flash = setTimeout(()=>btn.classList.remove('is-flash'), 1400);
}
