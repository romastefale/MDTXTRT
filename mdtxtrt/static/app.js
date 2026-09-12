import {comparisonDialog,confirmDialog,noticeDialog} from "/static/dialogs.js";
import {createImportChosen} from "/static/import_ui.js";

const tg=window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.disableVerticalSwipes?.();

function applyTheme(){
  const p=tg?.themeParams||{};
  const root=document.documentElement;
  if(p.bg_color) root.style.setProperty("--bg",p.bg_color);
  if(p.text_color) root.style.setProperty("--text",p.text_color);
  if(p.hint_color) root.style.setProperty("--hint",p.hint_color);
  if(p.secondary_bg_color) root.style.setProperty("--surface",p.secondary_bg_color);
  if(p.button_color) root.style.setProperty("--accent",p.button_color);
  if(p.button_text_color) root.style.setProperty("--accent-text",p.button_text_color);
  tg?.setHeaderColor?.(p.bg_color||"secondary_bg_color");
  tg?.setBackgroundColor?.(p.bg_color||"#ffffff");
  tg?.setBottomBarColor?.(p.bg_color||"#ffffff");
}
applyTheme();
tg?.onEvent?.("themeChanged",applyTheme);

function setAppHeight(){
  const h=tg?.viewportStableHeight||window.innerHeight;
  document.documentElement.style.setProperty("--app-height",`${h}px`);
}
function layoutToolbar(){
  const bar=$(".toolbar");
  const fam=$("#toolbar-families");
  const more=$("#tool-more");
  const bucket=$("#tool-more-body");
  if(!bar||!fam||!more||!bucket) return;
  for(const el of [...bucket.querySelectorAll(":scope > details")]) fam.appendChild(el);
  more.hidden=true;
  const fits=()=>bar.scrollWidth<=bar.clientWidth+1;
  if(fits()) return;
  more.hidden=false;
  const items=[...fam.querySelectorAll(":scope > details")];
  for(let i=items.length-1;i>=0;i-=1){
    if(fits()) break;
    bucket.prepend(items[i]);
  }
  if(!bucket.children.length) more.hidden=true;
}
setAppHeight();
tg?.onEvent?.("viewportChanged",()=>{setAppHeight();layoutToolbar()});

let backClick=null;
function bindBackButton(open){
  if(!tg?.BackButton) return;
  if(backClick){
    tg.BackButton.offClick(backClick);
    backClick=null;
  }
  if(open){
    backClick=()=>{
      document.querySelectorAll("dialog[open]").forEach(d=>d.close());
      const lib=document.getElementById("library-menu");
      if(lib) lib.hidden=true;
      bindBackButton(false);
    };
    tg.BackButton.onClick(backClick);
    tg.BackButton.show();
  }else{
    tg.BackButton.hide();
  }
}

function syncBackButton(){
  const dialogOpen=[...document.querySelectorAll("dialog")].some(d=>d.open);
  const lib=document.getElementById("library-menu");
  bindBackButton(dialogOpen||(Boolean(lib)&&!lib.hidden));
}

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const editor=$("#editor");
const telegramPreview=$("#telegram-preview");
const statusEl=$("#status");
const nameEl=$("#draft-name");
const initData=tg?.initData||"";

const state={
  draft:null,
  lastSaved:"",
  saveTimer:null,
  sessionTimer:null,
  pendingInline:new Map(),
  editingPublication:null,
  archivedView:false,
  reviewAction:null,
  pendingMediaKind:null,
  pendingLocationRequest:sessionStorage.getItem("mdtxtrt:location-request")||null,
  draggedBlock:null,
  undoToastTimer:null,
  preferences:{},
  outputOverride:null,
  authExpired:false,
};

const uid=()=>crypto.randomUUID();
const clone=value=>JSON.parse(JSON.stringify(value));
const enc=new TextEncoder();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const domNodeIds=new WeakMap();

function setStatus(value){statusEl.textContent=value}
function closeMenus(){$$(".toolbar details[open]").forEach(item=>item.removeAttribute("open"))}
function updateFormatState(){
  $$('[data-format]').forEach(button=>{
    const active=state.pendingInline.has(button.dataset.format);
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",active?"true":"false");
  });
}
function selectView(view){
  const preview=view==="preview";
  $$('[role="tab"][data-view]').forEach(tab=>tab.setAttribute("aria-selected",tab.dataset.view===view?"true":"false"));
  if(preview){
    const clone=editor.cloneNode(true);
    clone.removeAttribute("id"); clone.removeAttribute("contenteditable");
    clone.querySelectorAll("[contenteditable]").forEach(node=>node.removeAttribute("contenteditable"));
    telegramPreview.replaceChildren(...clone.childNodes);
  }
  editor.classList.toggle("hidden",preview); telegramPreview.classList.toggle("hidden",!preview); closeMenus();
}
function headers(){return {"X-Telegram-Init-Data":initData}}
function mirrorKey(){return state.draft?`mdtxtrt:mirror:${state.draft.id}`:null}

function rememberDomNodeId(dom,id=null){
  let value=domNodeIds.get(dom);
  if(!value){value=id||uid();domNodeIds.set(dom,value)}
  return value;
}

function saveMirror(){
  if(!state.draft) return;
  localStorage.setItem(mirrorKey(),JSON.stringify({
    revision_id:state.draft.active_revision_id,
    document:snapshotDocument(),
    saved_at:Date.now(),
  }));
}

function showMessage(title,body){
  $("#message-title").textContent=title;
  $("#message-body").textContent=body;
  const dialog=$("#message-dialog");
  if(!dialog.open) dialog.showModal();
}

function authExpired(){
  if(state.authExpired) return;
  state.authExpired=true;
  saveMirror();
  setStatus("sessão expirada");
  showMessage(
    "Sessão expirada",
    "O espelho local foi preservado. Reabra o Mini App pelo Telegram para obter uma nova autenticação; ao abrir, o MDTXTRT compara o servidor com o espelho local e pede qual versão usar.",
  );
}

async function api(path,options={}){
  const requestHeaders={...headers(),...(options.headers||{})};
  const next={...options};
  if(next.body&&!(next.body instanceof FormData)&&typeof next.body!=="string"){
    requestHeaders["Content-Type"]="application/json";
    next.body=JSON.stringify(next.body);
  }
  const response=await fetch(path,{...next,headers:requestHeaders});
  let data={};
  try{data=await response.json()}catch{}
  if(response.status===401){
    authExpired();
    const error=new Error(data.error||"authentication_expired");
    error.status=401;
    error.data=data;
    throw error;
  }
  if(!response.ok||data.ok===false){
    const error=new Error(data.detail||data.error||`HTTP ${response.status}`);
    error.status=response.status;
    error.data=data;
    throw error;
  }
  return data;
}

async function authenticatedDownload(path,filename){
  const response=await fetch(path,{headers:headers()});
  if(response.status===401){authExpired();return false}
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob=await response.blob();
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");
  anchor.href=url;
  anchor.download=filename||"arquivo";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  return true;
}

function showUndoToast(message,undo,timeout=9000){
  clearTimeout(state.undoToastTimer);
  $("#mdtxtrt-undo-toast")?.remove();
  const toast=document.createElement("div");
  toast.id="mdtxtrt-undo-toast";
  toast.style.cssText="position:fixed;left:12px;right:12px;bottom:78px;z-index:90;display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;background:var(--surface);color:var(--text);border:1px solid var(--line);box-shadow:0 12px 38px #0004";
  const text=document.createElement("span");
  text.textContent=message;
  text.style.flex="1";
  const button=document.createElement("button");
  button.type="button";
  button.textContent="Desfazer";
  button.style.cssText="border:0;background:transparent;color:var(--accent);font-weight:700";
  button.onclick=()=>{clearTimeout(state.undoToastTimer);toast.remove();undo()};
  toast.append(text,button);
  document.body.append(toast);
  state.undoToastTimer=setTimeout(()=>toast.remove(),timeout);
}

function node(kind,{text=null,attrs={},children=[]}={}){return {id:uid(),kind,text,attrs,children}}
function textNode(text){return node("text",{text})}
function plainNode(value){if(!value)return"";return value.children?.length?value.children.map(plainNode).join(""):(value.text||"")}

const inlineTags={
  bold:"strong",
  italic:"em",
  underline:"u",
  strikethrough:"s",
  marked:"mark",
  subscript:"sub",
  superscript:"sup",
  code:"code",
};

function renderTextNode(value){
  const dom=document.createTextNode(value?.text||"");
  rememberDomNodeId(dom,value?.id||uid());
  return dom;
}

function renderInline(value){
  if(!value||value.kind==="text"||value.kind==="plain") return renderTextNode(value||textNode(""));
  let element;
  if(inlineTags[value.kind]) element=document.createElement(inlineTags[value.kind]);
  else if(["url","link","text_mention","anchor_link","reference_link"].includes(value.kind)){
    element=document.createElement("a");
    if(value.kind==="text_mention") element.href=`tg://user?id=${value.attrs?.user_id||""}`;
    else if(["anchor_link","reference_link"].includes(value.kind)) element.href=`#${value.attrs?.name||""}`;
    else element.href=value.attrs?.url||"#";
  }else element=document.createElement("span");
  element.dataset.inline=value.kind;
  element.dataset.nodeId=value.id||uid();
  element.__attrs=clone(value.attrs||{});
  if(["math_inline","mathematical_expression"].includes(value.kind)){
    element.textContent=value.text||"";
    return element;
  }
  (value.children?.length?value.children:[textNode(value.text||"")]).forEach(child=>element.append(renderInline(child)));
  return element;
}

const simpleBlocks=new Set(["paragraph","heading","code_block","footer","blockquote","expandable_blockquote","pullquote"]);
const labels={
  divider:"Divisor",list:"Lista",table:"Tabela",details:"Detalhes",math_block:"Fórmula",
  anchor:"Âncora",reference:"Referência",map:"Localização",location:"Localização",venue:"Venue",photo:"Foto",video:"Vídeo",
  animation:"Animação",audio:"Áudio",voice_note:"Mensagem de voz",document:"Documento",
  collage:"Collage",slideshow:"Slideshow",button_row:"Linha de botões",raw_markdown:"Markdown cru",
};

function blockElement(value){
  let tag="p";
  if(value.kind==="heading") tag=`h${Math.min(6,Math.max(1,Number(value.attrs?.level||1)))}`;
  else if(value.kind==="code_block") tag="pre";
  else if(["blockquote","expandable_blockquote"].includes(value.kind)) tag="blockquote";
  else if(value.kind==="pullquote") tag="aside";
  else if(value.kind==="footer") tag="footer";
  const element=document.createElement(tag);
  element.dataset.block=value.id||uid();
  element.dataset.kind=value.kind;
  element.__attrs=clone(value.attrs||{});
  if(value.kind==="code_block") element.textContent=value.text||plainNode(value);
  else if(value.children?.length) value.children.forEach(child=>element.append(renderInline(child)));
  else if(value.text) element.append(renderTextNode(textNode(value.text)));
  element.draggable=true;
  return element;
}

function nodeSummary(value){
  if(value.kind==="divider") return "Divisor horizontal";
  if(["map","location","venue"].includes(value.kind)) return `${value.attrs?.name||value.attrs?.address||"Localização"}: ${value.attrs?.lat??"?"}, ${value.attrs?.long??"?"}`;
  if(["photo","video","animation","audio","voice_note","document"].includes(value.kind)) return value.attrs?.caption||value.attrs?.filename||value.attrs?.src||value.kind;
  if(value.kind==="list") return `${value.children?.length||0} itens`;
  if(value.kind==="table") return `${value.children?.length||0} linhas`;
  if(value.kind==="details") return value.attrs?.summary||"Detalhes";
  if(value.kind==="button_row") return `${value.children?.length||0} botões`;
  return (value.text||plainNode(value)||value.kind).slice(0,100);
}

function cardElement(value){
  const element=document.createElement("div");
  element.className="node-card";
  element.contentEditable="false";
  element.dataset.block=value.id||uid();
  element.dataset.kind=value.kind;
  element.__node=clone({...value,id:value.id||element.dataset.block});
  element.draggable=true;
  const title=document.createElement("strong");
  title.textContent=labels[value.kind]||value.kind;
  const summary=document.createElement("span");
  summary.className="summary";
  summary.textContent=nodeSummary(value);
  const edit=document.createElement("button");
  edit.type="button";
  edit.textContent="Editar";
  edit.onclick=()=>editStructuredCard(element);
  element.append(title,summary,edit);
  return element;
}

function renderBlock(value){return simpleBlocks.has(value.kind)?blockElement(value):cardElement(value)}
function renderDocument(documentValue){
  editor.replaceChildren();
  (documentValue?.blocks||[]).forEach(block=>editor.append(renderBlock(block)));
  if(!editor.children.length) editor.append(blockElement(node("paragraph")));
}

function inlineKind(element){
  return element.dataset?.inline||({
    STRONG:"bold",B:"bold",EM:"italic",I:"italic",U:"underline",S:"strikethrough",
    STRIKE:"strikethrough",DEL:"strikethrough",MARK:"marked",SUB:"subscript",
    SUP:"superscript",CODE:"code",A:"url",
  }[element.tagName]);
}

function serializeInline(root){
  const out=[];
  for(const child of root.childNodes){
    if(child.nodeType===Node.TEXT_NODE){
      if(child.nodeValue) out.push({id:rememberDomNodeId(child),kind:"text",text:child.nodeValue,attrs:{},children:[]});
      continue;
    }
    if(child.nodeType!==Node.ELEMENT_NODE) continue;
    if(child.tagName==="BR"){
      out.push({id:rememberDomNodeId(child),kind:"text",text:"\n",attrs:{},children:[]});
      continue;
    }
    const kind=inlineKind(child)||"text";
    const attrs=clone(child.__attrs||{});
    if(kind==="url"&&child.tagName==="A") attrs.url=attrs.url||child.getAttribute("href")||"";
    const value={id:child.dataset.nodeId||uid(),kind,text:null,attrs,children:[]};
    if(["math_inline","mathematical_expression"].includes(kind)) value.text=child.textContent||"";
    else value.children=serializeInline(child);
    out.push(value);
  }
  return out;
}

function serializeBlock(element){
  if(element.__node) return clone(element.__node);
  const kind=element.dataset.kind||"paragraph";
  const attrs=clone(element.__attrs||{});
  if(kind==="heading") attrs.level=Number(element.tagName.slice(1))||attrs.level||1;
  const value={id:element.dataset.block||uid(),kind,text:null,attrs,children:[]};
  if(kind==="code_block") value.text=element.textContent||"";
  else value.children=serializeInline(element);
  return value;
}

function normalizeTopLevel(){
  [...editor.childNodes].forEach(child=>{
    if(child.nodeType===Node.TEXT_NODE&&child.nodeValue?.trim()){
      const paragraph=blockElement(node("paragraph",{children:[textNode(child.nodeValue)]}));
      editor.replaceChild(paragraph,child);
    }else if(child.nodeType===Node.ELEMENT_NODE&&!child.dataset.block){
      child.dataset.block=uid();
      child.dataset.kind=/^H[1-6]$/.test(child.tagName)?"heading":child.tagName==="PRE"?"code_block":child.tagName==="BLOCKQUOTE"?"blockquote":"paragraph";
    }
  });
}

function snapshotDocument(){
  return {
    schema_version:state.draft?.document?.schema_version||1,
    id:state.draft?.document?.id||uid(),
    blocks:[...editor.children].map(serializeBlock),
    metadata:clone(state.draft?.document?.metadata||{}),
  };
}

function canonicalDocument(){
  normalizeTopLevel();
  return snapshotDocument();
}

function ensureTypingBlock(){
  if(!editor.children.length) editor.append(blockElement(node("paragraph")));
  const selection=window.getSelection();
  if(!selection) return;
  const anchor=selection.anchorNode;
  const inside=anchor&&(anchor===editor?false:Boolean((anchor.nodeType===1?anchor:anchor.parentElement)?.closest?.("[data-block]")));
  if(inside) return;
  const block=[...editor.children].find(child=>!child.__node)||editor.lastElementChild;
  if(!block||block.__node) return;
  const range=document.createRange();
  range.selectNodeContents(block);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function canonicalComparable(value){
  return {
    kind:value?.kind||"",
    text:value?.text??null,
    attrs:value?.attrs||{},
    children:(value?.children||[]).map(canonicalComparable),
  };
}

function canonicalSignature(value){return JSON.stringify(canonicalComparable(value))}

function flattenNodes(documentValue){
  const out=[];
  const walk=(value,path)=>{
    out.push({id:value.id,kind:value.kind,text:plainNode(value),signature:canonicalSignature(value),path});
    (value.children||[]).forEach((child,index)=>walk(child,`${path}.${index+1}`));
  };
  (documentValue?.blocks||[]).forEach((block,index)=>walk(block,String(index+1)));
  return out;
}

function documentOutline(documentValue){
  const blocks=documentValue?.blocks||[];
  if(!blocks.length) return "Documento sem blocos.";
  return blocks.map((block,index)=>{
    const text=plainNode(block).replace(/\s+/g," ").trim();
    const preview=text.length>110?`${text.slice(0,107)}…`:text;
    return `${index+1}. ${block.kind}${preview?` — ${preview}`:""}`;
  }).join("\n");
}

function semanticDocumentDiff(left,right){
  const leftNodes=flattenNodes(left);
  const rightNodes=flattenNodes(right);
  const leftMap=new Map(leftNodes.filter(x=>x.id).map(x=>[x.id,x]));
  const rightMap=new Map(rightNodes.filter(x=>x.id).map(x=>[x.id,x]));
  const added=rightNodes.filter(x=>x.id&&!leftMap.has(x.id));
  const removed=leftNodes.filter(x=>x.id&&!rightMap.has(x.id));
  const changed=[];
  for(const [id,leftNode] of leftMap){
    const rightNode=rightMap.get(id);
    if(rightNode&&leftNode.signature!==rightNode.signature) changed.push({left:leftNode,right:rightNode});
  }
  const leftOrder=(left?.blocks||[]).map(x=>x.id).filter(Boolean).join("|");
  const rightOrder=(right?.blocks||[]).map(x=>x.id).filter(Boolean).join("|");
  const metadataChanged=JSON.stringify(left?.metadata||{})!==JSON.stringify(right?.metadata||{});
  const summary=[
    `Blocos: servidor ${left?.blocks?.length||0}; espelho local ${right?.blocks?.length||0}.`,
    `Nós identificáveis: servidor ${leftNodes.length}; espelho local ${rightNodes.length}.`,
    `Adicionados localmente: ${added.length}; removidos localmente: ${removed.length}; alterados com o mesmo ID: ${changed.length}.`,
  ];
  if(leftOrder!==rightOrder) summary.push("A ordem dos blocos de nível superior é diferente.");
  if(metadataChanged) summary.push("Os metadados canônicos do documento são diferentes.");
  if(left?.id!==right?.id) summary.push(`Identidade do documento é diferente (${left?.id||"sem ID"} × ${right?.id||"sem ID"}).`);
  for(const item of added.slice(0,4)) summary.push(`+ ${item.path} ${item.kind}: ${item.text.slice(0,70)||"sem texto"}`);
  for(const item of removed.slice(0,4)) summary.push(`− ${item.path} ${item.kind}: ${item.text.slice(0,70)||"sem texto"}`);
  for(const item of changed.slice(0,4)) summary.push(`~ ${item.right.path} ${item.right.kind}: conteúdo/atributos alterados.`);
  return {summary,leftOutline:documentOutline(left),rightOutline:documentOutline(right)};
}

function conversionSummary(source,review){
  const documentValue=review?.converted_document||{};
  const blocks=documentValue.blocks||[];
  const kinds=new Map();
  for(const block of blocks) kinds.set(block.kind,(kinds.get(block.kind)||0)+1);
  const kindText=[...kinds.entries()].map(([kind,count])=>`${kind}×${count}`).join(", ")||"nenhum";
  const converted=review?.converted_markdown||"";
  const residual=review?.residual_raw_markdown||[];
  const summary=[
    `Original: ${source.length} caracteres; convertido: ${converted.length} caracteres.`,
    `Estrutura convertida: ${blocks.length} blocos (${kindText}).`,
    `Trechos preservados como Markdown cru: ${residual.length}.`,
    review?.lossless_visual_conversion?"Conversão visual sem resíduo cru.":"Há conteúdo que permanece cru para evitar perda silenciosa.",
  ];
  if(typeof review?.roundtrip_markdown_equal==="boolean") summary.push(review.roundtrip_markdown_equal?"O Markdown reemitido coincide com o original após normalização de bordas.":"O Markdown reemitido não é textualmente idêntico ao original.");
  for(const change of review?.apply_back_changes||[]) summary.push(change.message||String(change));
  return summary;
}

function scheduleSave(){
  if(!state.draft||state.authExpired) return;
  setStatus("editando");
  clearTimeout(state.saveTimer);
  state.saveTimer=setTimeout(()=>void commitNow("typing-pause"),2000);
}

async function commitNow(reason="edit"){
  if(!state.draft) return true;
  if(state.authExpired) return false;
  clearTimeout(state.saveTimer);
  const documentValue=canonicalDocument();
  const snapshot=JSON.stringify(documentValue);
  if(snapshot===state.lastSaved){setStatus("salvo");return true}
  setStatus("salvando…");
  try{
    const data=await api(`/api/drafts/${state.draft.id}/revisions`,{method:"POST",body:{document:documentValue,reason}});
    state.draft=data.draft;
    state.lastSaved=JSON.stringify(state.draft.document);
    saveMirror();
    setStatus("salvo");
    return true;
  }catch(error){
    setStatus("não salvo");
    if(error.status!==401) showMessage("Falha ao salvar",error.message);
    return false;
  }
}

function activeBlock(){
  const selection=window.getSelection();
  const start=selection?.anchorNode?.nodeType===Node.ELEMENT_NODE?selection.anchorNode:selection?.anchorNode?.parentElement;
  return start?.closest?.("[data-block]")||null;
}

function pathWithin(root,target){
  const path=[];
  let current=target;
  while(current&&current!==root){
    const parent=current.parentNode;
    if(!parent) return null;
    const index=[...parent.childNodes].indexOf(current);
    if(index<0) return null;
    path.unshift(index);
    current=parent;
  }
  return current===root?path:null;
}

function nodeAtPath(root,path){
  let current=root;
  for(const index of path||[]){current=current?.childNodes?.[index];if(!current)return null}
  return current;
}

function selectionSnapshot(){
  const selection=window.getSelection();
  if(!selection?.rangeCount) return null;
  const range=selection.getRangeAt(0);
  const start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
  const startBlock=start?.closest?.("[data-block]");
  const endBlock=end?.closest?.("[data-block]");
  if(!startBlock||startBlock!==endBlock||startBlock.__node) return null;
  const startPath=pathWithin(startBlock,range.startContainer);
  const endPath=pathWithin(startBlock,range.endContainer);
  return startPath&&endPath?{
    block_id:startBlock.dataset.block,
    start_path:startPath,
    start_offset:range.startOffset,
    end_path:endPath,
    end_offset:range.endOffset,
  }:null;
}

function restoreSelection(session){
  const value=session?.selection;
  const id=value?.block_id||session?.active_block_id;
  if(!id) return;
  const block=[...editor.querySelectorAll("[data-block]")].find(item=>item.dataset.block===id);
  if(!block||block.__node) return;
  if(!value){block.focus();return}
  const start=nodeAtPath(block,value.start_path);
  const end=nodeAtPath(block,value.end_path);
  if(!start||!end){block.focus();return}
  const limit=(item,offset)=>Math.min(Math.max(Number(offset)||0,0),item.nodeType===Node.TEXT_NODE?(item.nodeValue?.length||0):item.childNodes.length);
  try{
    const range=document.createRange();
    range.setStart(start,limit(start,value.start_offset));
    range.setEnd(end,limit(end,value.end_offset));
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }catch{block.focus()}
}

async function saveSession(){
  if(!state.draft||state.authExpired) return;
  if(!(await commitNow("checkpoint"))) return;
  try{
    await api(`/api/drafts/${state.draft.id}/session`,{method:"PUT",body:{
      revision_id:state.draft.active_revision_id,
      scroll_top:window.scrollY,
      active_block_id:activeBlock()?.dataset.block||null,
      selection:selectionSnapshot(),
    }});
  }catch{}
}

const field=(name,label,type="text",value="",options=null)=>({name,label,type,value,options});

async function openForm(title,fields){
  const dialog=$("#form-dialog");
  const form=$("#form");
  const box=$("#form-fields");
  $("#form-title").textContent=title;
  box.replaceChildren();
  for(const spec of fields){
    const wrap=document.createElement("div");
    wrap.className=spec.type==="checkbox"?"check":"field";
    const label=document.createElement("label");
    label.textContent=spec.label;
    let input;
    if(spec.type==="select"){
      input=document.createElement("select");
      (spec.options||[]).forEach(([value,text])=>{
        const option=document.createElement("option");
        option.value=value;
        option.textContent=text;
        input.append(option);
      });
      input.value=spec.value??"";
    }else if(spec.type==="textarea"){
      input=document.createElement("textarea");
      input.value=spec.value??"";
    }else{
      input=document.createElement("input");
      input.type=spec.type;
      input.value=spec.type==="checkbox"?"1":(spec.value??"");
      if(spec.type==="checkbox") input.checked=Boolean(spec.value);
    }
    input.name=spec.name;
    if(spec.type==="checkbox") wrap.append(input,label);
    else wrap.append(label,input);
    box.append(wrap);
  }
  return new Promise(resolve=>{
    const done=()=>{
      dialog.removeEventListener("close",done);
      if(dialog.returnValue!=="save"){resolve(null);return}
      const value={};
      for(const spec of fields){
        const input=form.elements.namedItem(spec.name);
        value[spec.name]=spec.type==="checkbox"?input.checked:input.value;
      }
      resolve(value);
    };
    dialog.addEventListener("close",done);
    dialog.showModal();
  });
}

function wrapSelection(kind,attrs={},explicit=null){
  const selection=window.getSelection();
  if(!selection?.rangeCount) return;
  const range=selection.getRangeAt(0);
  const start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
  const startBlock=start?.closest?.("[data-block]");
  const endBlock=end?.closest?.("[data-block]");
  if(!startBlock||startBlock!==endBlock||startBlock.__node){
    showMessage("Seleção","A formatação inline precisa ficar dentro do mesmo bloco de texto.");
    return;
  }
  if(range.collapsed&&explicit===null){
    state.pendingInline.has(kind)?state.pendingInline.delete(kind):state.pendingInline.set(kind,attrs);
    updateFormatState();
    return;
  }
  const wrapper=document.createElement(inlineTags[kind]||(kind==="url"?"a":"span"));
  wrapper.dataset.inline=kind;
  wrapper.dataset.nodeId=uid();
  wrapper.__attrs=clone(attrs);
  if(kind==="url") wrapper.href=attrs.url||"#";
  if(explicit!==null){range.deleteContents();wrapper.append(document.createTextNode(explicit))}
  else wrapper.append(range.extractContents());
  range.insertNode(wrapper);
  scheduleSave();
}

function insertPendingText(event){
  if(!state.pendingInline.size||event.inputType!=="insertText"||!event.data) return;
  const selection=window.getSelection();
  if(!selection?.rangeCount) return;
  const range=selection.getRangeAt(0);
  const block=activeBlock();
  if(!block||block.__node) return;
  event.preventDefault();
  range.deleteContents();
  const leaf=document.createTextNode(event.data);
  rememberDomNodeId(leaf);
  let outer=leaf;
  for(const [kind,attrs] of [...state.pendingInline.entries()].reverse()){
    const wrapper=document.createElement(inlineTags[kind]||(kind==="url"?"a":"span"));
    wrapper.dataset.inline=kind;
    wrapper.dataset.nodeId=uid();
    wrapper.__attrs=clone(attrs);
    if(kind==="url") wrapper.href=attrs.url||"#";
    wrapper.append(outer);
    outer=wrapper;
  }
  range.insertNode(outer);
  range.setStart(leaf,leaf.nodeValue.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  scheduleSave();
}

async function inlineForm(kind){
  closeMenus();
  const selection=window.getSelection();
  const selected=selection?.rangeCount&&!selection.getRangeAt(0).collapsed?selection.getRangeAt(0).toString():"";
  let fields=[];
  if(kind==="url") fields=[field("label","Texto","text",selected),field("url","URL","url","")];
  if(kind==="text_mention") fields=[field("label","Texto","text",selected),field("user_id","ID do usuário","text","")];
  if(kind==="custom_emoji") fields=[field("label","Emoji alternativo","text",selected||"🙂"),field("emoji_id","Custom emoji ID","text","")];
  if(kind==="datetime") fields=[field("label","Texto exibido","text",selected),field("unix","Unix time","number",""),field("format","Formato Telegram","text","wDT")];
  if(kind==="math_inline") fields=[field("expression","LaTeX","text",selected)];
  if(kind==="anchor_link") fields=[field("label","Texto","text",selected),field("name","Âncora/referência","text","")];
  const value=await openForm("Formatação inline",fields);
  if(!value) return;
  if(kind==="math_inline"){wrapSelection(kind,{},value.expression);return}
  const attrs={};
  if(kind==="url") attrs.url=value.url;
  if(kind==="text_mention") attrs.user_id=value.user_id;
  if(kind==="custom_emoji") attrs.emoji_id=value.emoji_id;
  if(kind==="datetime"){attrs.unix=value.unix;attrs.format=value.format}
  if(kind==="anchor_link") attrs.name=value.name;
  wrapSelection(kind,attrs,value.label||selected);
}

function replaceBlockKind(kind,level=null){
  const old=activeBlock();
  if(!old||old.__node){
    editor.append(renderBlock(node(kind,{attrs:level?{level}:{}})));
    scheduleSave();
    return;
  }
  const value=serializeBlock(old);
  value.kind=kind;
  value.attrs={...value.attrs,...(level?{level}:{})};
  if(kind==="code_block"){value.text=plainNode(value);value.children=[]}
  old.replaceWith(renderBlock(value));
  scheduleSave();
}

function insertBlock(value,after=activeBlock()){
  const element=renderBlock(value);
  after?.parentElement===editor?after.after(element):editor.append(element);
  scheduleSave();
  return element;
}

function deleteActiveBlock(){
  const target=activeBlock();
  if(!target||target.parentElement!==editor){showMessage("Excluir bloco","Selecione o bloco que deseja excluir.");return}
  const value=serializeBlock(target);
  const index=[...editor.children].indexOf(target);
  target.remove();
  scheduleSave();
  showUndoToast("Bloco excluído",()=>{
    editor.insertBefore(renderBlock(value),editor.children[index]||null);
    scheduleSave();
  });
}

function listText(value){
  return (value.children||[]).map(item=>`${item.attrs?.task?`[${item.attrs?.checked?"x":" "}] `:""}${plainNode(item)}`).join("\n");
}
function tableText(value){return (value.children||[]).map(row=>(row.children||[]).map(plainNode).join(" | ")).join("\n")}

async function buildStructured(kind,preset="",existing=null){
  let value;
  if(kind==="list"){
    value=await openForm("Lista",[
      field("mode","Tipo","select",preset||(existing?.attrs?.ordered?"ordered":"unordered"),[["unordered","Marcadores"],["ordered","Numerada"],["task","Tarefas"]]),
      field("items","Um item por linha","textarea",existing?listText(existing):""),
    ]);
    if(!value) return null;
    return {...(existing||node("list")),kind:"list",attrs:{ordered:value.mode==="ordered"},children:value.items.split(/\r?\n/).filter(Boolean).map(text=>{
      const match=text.match(/^\s*\[([ xX])\]\s*(.*)$/);
      return node("list_item",{attrs:{task:value.mode==="task",checked:Boolean(match&&/x/i.test(match[1]))},children:[textNode(match?match[2]:text)]});
    })};
  }
  if(kind==="table"){
    value=await openForm("Tabela",[
      field("rows","Linhas; células com |","textarea",existing?tableText(existing):"Cabeçalho 1 | Cabeçalho 2\nValor 1 | Valor 2"),
      field("header","Primeira linha é cabeçalho","checkbox",true),
      field("bordered","Com borda","checkbox",existing?.attrs?.bordered??true),
      field("striped","Listrada","checkbox",existing?.attrs?.striped??false),
      field("compact","Compacta","checkbox",existing?.attrs?.compact??false),
    ]);
    if(!value) return null;
    return {...(existing||node("table")),kind:"table",attrs:{bordered:value.bordered,striped:value.striped,compact:value.compact},children:value.rows.split(/\r?\n/).filter(Boolean).map((line,index)=>node("table_row",{children:line.split("|").map(cell=>node(value.header&&index===0?"table_header":"table_cell",{children:[textNode(cell.trim())]}))}))};
  }
  if(kind==="details"){
    value=await openForm("Detalhes",[
      field("summary","Título","text",existing?.attrs?.summary||"Detalhes"),
      field("open","Aberto inicialmente","checkbox",existing?.attrs?.open||false),
      field("body","Conteúdo","textarea",existing?plainNode(existing):""),
    ]);
    if(!value) return null;
    return {...(existing||node("details")),kind:"details",attrs:{summary:value.summary,open:value.open},children:value.body.split(/\r?\n/).filter(Boolean).map(text=>node("paragraph",{children:[textNode(text)]}))};
  }
  if(kind==="math_block"){
    value=await openForm("Fórmula",[field("expression","LaTeX","textarea",existing?.text||"")]);
    return value?{...(existing||node(kind)),kind,text:value.expression,attrs:{},children:[]}:null;
  }
  if(kind==="anchor"){
    value=await openForm("Âncora",[field("name","Nome","text",existing?.attrs?.name||"")]);
    return value?{...(existing||node(kind)),kind,attrs:{name:value.name},children:[]}:null;
  }
  if(kind==="reference"){
    value=await openForm("Referência",[field("name","Nome","text",existing?.attrs?.name||""),field("text","Texto","textarea",existing?plainNode(existing):"")]);
    return value?{...(existing||node(kind)),kind,attrs:{name:value.name},children:[textNode(value.text)]}:null;
  }
  if(["map","location","venue"].includes(kind)){
    showMessage("Localização","Esta localização veio da interface nativa do Telegram. Para alterar, apague o bloco e envie outra Location ou Venue.");
    return null;
  }
  if(["collage","slideshow"].includes(kind)){
    value=await openForm(labels[kind],[field("caption","Legenda","text",existing?.attrs?.caption||""),field("media","photo|URL ou video|URL por linha","textarea",existing?(existing.children||[]).map(media=>`${media.kind}|${media.attrs?.src||""}`).join("\n"):"")]);
    if(!value) return null;
    return {...(existing||node(kind)),kind,attrs:{caption:value.caption},children:value.media.split(/\r?\n/).filter(Boolean).map(line=>{
      const [type,...rest]=line.split("|");
      return node(type.trim()==="video"?"video":"photo",{attrs:{src:rest.join("|").trim()}});
    })};
  }
  if(kind==="button_row"){
    value=await openForm("Linha de botões",[
      field("align","Alinhamento","select",existing?.attrs?.align||"center",[["left","Esquerda"],["center","Centro"],["right","Direita"]]),
      field("buttons","type|texto|valor|style por linha","textarea",existing?(existing.children||[]).map(button=>`${button.attrs?.type||"url"}|${plainNode(button)}|${button.attrs?.url??button.attrs?.data??button.attrs?.query??button.attrs?.copy_text??""}|${button.attrs?.style||""}`).join("\n"):"url|Abrir|https://|success"),
    ]);
    if(!value) return null;
    return {...(existing||node(kind)),kind,attrs:{align:value.align},children:value.buttons.split(/\r?\n/).filter(Boolean).map(line=>{
      const [type,label,raw,style]=line.split("|");
      const attrs={type:(type||"url").trim(),style:(style||"").trim()};
      if(["url","web_app","login_url"].includes(attrs.type)) attrs.url=(raw||"").trim();
      else if(attrs.type==="callback_data") attrs.data=(raw||"").trim();
      else if(attrs.type==="copy_text") attrs.copy_text=(raw||"").trim();
      else attrs.query=(raw||"").trim();
      return node("button",{attrs,children:[textNode((label||attrs.type).trim())]});
    })};
  }
  return null;
}

async function structuredAction(kind,preset=""){
  closeMenus();
  const value=await buildStructured(kind,preset);
  if(value) insertBlock(value);
}

function localMediaAccept(kind){
  if(kind==="photo") return "image/*";
  if(kind==="video") return "video/*";
  if(kind==="animation") return "image/gif,video/mp4";
  if(["audio","voice_note"].includes(kind)) return "audio/*";
  return "*/*";
}

async function mediaAction(kind,existing=null,replace=null){
  closeMenus();
  if(existing?.attrs?.media_blob_id){
    const value=await openForm(labels[kind]||"Mídia",[
      field("caption","Legenda","text",existing.attrs.caption||""),
      field("download","Baixar original","checkbox",false),
      field("public","Criar link público para Telegraph","checkbox",false),
      field("revoke","Revogar link público","checkbox",false),
    ]);
    if(!value) return;
    const next=clone(existing);
    next.attrs.caption=value.caption;
    try{
      if(value.download) await authenticatedDownload(`/api/media/${next.attrs.media_blob_id}/original`,next.attrs.filename||"arquivo");
      if(value.revoke){await api(`/api/media/${next.attrs.media_blob_id}/public`,{method:"DELETE"});delete next.attrs.src}
      if(value.public){const data=await api(`/api/media/${next.attrs.media_blob_id}/public`,{method:"POST"});next.attrs.src=data.public.url}
    }catch(error){showMessage("Mídia",error.message);return}
    replace?replace(next):insertBlock(next);
    return;
  }
  const value=await openForm(labels[kind]||"Mídia",[field("src","URL HTTP/HTTPS","url",existing?.attrs?.src||""),field("caption","Legenda","text",existing?.attrs?.caption||"")]);
  if(!value) return;
  const next={...(existing||node(kind)),kind,attrs:{...(existing?.attrs||{}),src:value.src,caption:value.caption},children:[]};
  replace?replace(next):insertBlock(next);
}

function localMediaAction(kind){
  if(!state.draft){showMessage("Mídia local","Abra um rascunho primeiro.");return}
  state.pendingMediaKind=kind;
  const input=$("#media-file");
  input.accept=localMediaAccept(kind);
  input.click();
}

async function uploadLocalMedia(file,kind){
  const form=new FormData();
  form.append("draft_id",state.draft.id);
  form.append("file",file,file.name);
  try{
    const data=await api("/api/media",{method:"POST",body:form});
    insertBlock(node(kind,{attrs:{media_blob_id:data.media.id,filename:data.media.filename,mime_type:data.media.mime_type,caption:""}}));
  }catch(error){showMessage("Mídia local",error.message)}
}

async function buttonAction(type){
  const fields=[field("label","Texto","text","Botão"),field("style","Estilo","select","",[["","Padrão"],["primary","Primary"],["success","Success"],["danger","Danger"],["link","Link callback"]])];
  if(["url","web_app","login_url"].includes(type)) fields.push(field("value","URL","url","https://"));
  else if(type==="callback_data") fields.push(field("value","Callback data 1–64 bytes","text",""));
  else if(type==="copy_text") fields.push(field("value","Texto a copiar","text",""));
  else if(type.startsWith("switch_inline_query")) fields.push(field("value","Query","text",""));
  const value=await openForm("Botão Rich",fields);
  if(!value) return;
  const attrs={type,style:value.style};
  if(["url","web_app","login_url"].includes(type)) attrs.url=value.value;
  else if(type==="callback_data"){
    const size=enc.encode(value.value||"").length;
    if(size<1||size>64){showMessage("Botão inválido","callback_data deve ter de 1 a 64 bytes.");return}
    attrs.data=value.value;
  }else if(type==="copy_text") attrs.copy_text=value.value;
  else if(type.startsWith("switch_inline_query")) attrs.query=value.value;
  if(attrs.style==="link"&&type!=="callback_data"){
    showMessage("Botão inválido","O estilo link só pode ser usado em callback_data.");
    return;
  }
  insertBlock(node("button_row",{attrs:{align:"center"},children:[node("button",{attrs,children:[textNode(value.label)]})]}));
}

async function nativeLocationAction(){
  if(!state.draft) return;
  try{
    const data=await api("/api/location-requests",{method:"POST",body:{draft_id:state.draft.id}});
    state.pendingLocationRequest=data.request.id;
    sessionStorage.setItem("mdtxtrt:location-request",data.request.id);
    if(data.bot_url&&tg?.openTelegramLink) tg.openTelegramLink(data.bot_url);
    void pollLocation(data.request.id);
  }catch(error){showMessage("Localização",error.message)}
}

async function pollLocation(id){
  for(let index=0;index<60&&state.pendingLocationRequest===id&&!state.authExpired;index++){
    try{
      const data=await api(`/api/location-requests/${id}`);
      if(data.request?.status==="fulfilled"){
        const name=data.request.name||"";
        const address=data.request.address||"";
        insertBlock(node(name&&address?"venue":"location",{attrs:{
          name,
          address,
          lat:Number(data.request.latitude),
          long:Number(data.request.longitude),
          source:"telegram_native_location",
        }}));
        state.pendingLocationRequest=null;
        sessionStorage.removeItem("mdtxtrt:location-request");
        return;
      }
    }catch(error){if(error.status===401)return}
    await delay(2000);
  }
}

async function rememberPreference(key,value){
  try{
    const data=await api(`/api/preferences/conversion/${encodeURIComponent(key)}`,{method:"PUT",body:{value}});
    state.preferences=data.preferences||state.preferences;
  }catch{}
}

function outputOperationForReplace(existing,blocks){
  return {
    kind:"replace_raw",
    draftId:state.draft?.id||null,
    blockId:existing.id,
    expectedSignature:canonicalSignature(existing),
    blocks:clone(blocks),
  };
}

function outputOperationForInsert(afterBlockId,blocks){
  return {
    kind:"insert_after",
    draftId:state.draft?.id||null,
    afterBlockId:afterBlockId||null,
    blocks:clone(blocks),
  };
}

function materializeOutputOverride(baseDocument){
  const operation=state.outputOverride;
  if(!operation) return null;
  if(operation.draftId!==state.draft?.id) throw new Error("A saída temporária pertence a outro rascunho e precisa ser revisada novamente.");
  const documentValue=clone(baseDocument);
  if(operation.kind==="replace_raw"){
    const index=documentValue.blocks.findIndex(block=>block.id===operation.blockId);
    if(index<0) throw new Error("O bloco Markdown usado pela saída temporária não existe mais. Revise a conversão novamente.");
    if(canonicalSignature(documentValue.blocks[index])!==operation.expectedSignature) throw new Error("O bloco Markdown mudou depois da revisão. Revise a conversão novamente antes de publicar.");
    documentValue.blocks.splice(index,1,...clone(operation.blocks));
    return documentValue;
  }
  if(operation.kind==="insert_after"){
    if(operation.afterBlockId===null){
      documentValue.blocks.push(...clone(operation.blocks));
      return documentValue;
    }
    const index=documentValue.blocks.findIndex(block=>block.id===operation.afterBlockId);
    if(index<0) throw new Error("A âncora da inserção temporária não existe mais. Revise o Markdown colado novamente.");
    documentValue.blocks.splice(index+1,0,...clone(operation.blocks));
    return documentValue;
  }
  throw new Error("Tipo de saída temporária desconhecido.");
}

async function conversionReviewFlow(original,{existingRaw=null,insertAfterBlockId=undefined}={}){
  let source=original;
  let review=(await api("/api/conversion/raw-markdown/review",{method:"POST",body:{source}})).review;
  const canOutput=Boolean(existingRaw)||insertAfterBlockId!==undefined;
  while(true){
    const choices=[
      {value:"apply",label:"Aplicar ao documento principal",detail:"A conversão entra no rascunho e passa a fazer parte do histórico."},
      ...(canOutput?[{value:"output",label:"Usar somente nesta saída",detail:"O rascunho principal não é alterado; a transformação é re-materializada sobre a versão atual no momento da publicação."}]:[]),
      {value:"keep",label:"Manter original sem converter",detail:"Nenhuma conversão visual é aplicada."},
    ];
    const preferred=state.preferences.raw_markdown_apply_mode||"apply";
    const defaultChoice=choices.some(item=>item.value===preferred)?preferred:"apply";
    const value=await comparisonDialog({
      title:"Original ↔ convertido",
      summary:conversionSummary(source,review),
      leftLabel:"Markdown original — editável",
      leftValue:source,
      leftEditable:true,
      rightLabel:"Markdown convertido — editável",
      rightValue:review.converted_markdown,
      rightEditable:true,
      choices,
      defaultChoice,
      rememberLabel:"Memorizar esta escolha como padrão",
      confirmLabel:"Continuar com esta decisão",
    });
    if(!value) return null;
    if(value.left!==source){
      source=value.left;
      review=(await api("/api/conversion/raw-markdown/review",{method:"POST",body:{source}})).review;
      continue;
    }
    let finalReview=review;
    if(value.right!==review.converted_markdown){
      finalReview=(await api("/api/conversion/raw-markdown/review-edited",{method:"POST",body:{original:source,converted_markdown:value.right}})).review;
    }
    if(value.remember) await rememberPreference("raw_markdown_apply_mode",value.choice);
    if(value.choice==="keep") return {mode:"keep",source};
    if(value.choice==="apply"&&finalReview.requires_apply_back_confirmation){
      const details=(finalReview.apply_back_changes||[]).map(item=>item.message||String(item));
      const allowed=await confirmDialog(
        "Aplicar conversão ao documento principal",
        "A versão convertida contém mudanças que precisam de confirmação antes de substituir conteúdo do rascunho.",
        {confirmLabel:"Aplicar ao documento",details},
      );
      if(!allowed){review=finalReview;continue}
    }
    if(value.choice==="output"){
      const operation=existingRaw?
        outputOperationForReplace(existingRaw,finalReview.converted_document.blocks):
        outputOperationForInsert(insertAfterBlockId??null,finalReview.converted_document.blocks);
      return {mode:"output",operation,blocks:finalReview.converted_document.blocks};
    }
    return {mode:"apply",blocks:finalReview.converted_document.blocks,document:finalReview.converted_document};
  }
}

async function editRawMarkdown(card,existing){
  try{
    const result=await conversionReviewFlow(existing.text||"",{existingRaw:existing});
    if(!result) return;
    if(result.mode==="keep"){
      const next=clone(existing);
      next.text=result.source;
      card.replaceWith(cardElement(next));
      state.outputOverride=null;
      scheduleSave();
      return;
    }
    if(result.mode==="output"){
      state.outputOverride=result.operation;
      showMessage("Saída temporária","A conversão substituirá este bloco somente na próxima publicação. Outras edições posteriores do rascunho serão preservadas; se este bloco mudar, a publicação exigirá nova revisão.");
      return;
    }
    const rendered=(result.blocks||[]).map(renderBlock);
    rendered.length?card.replaceWith(...rendered):card.remove();
    state.outputOverride=null;
    scheduleSave();
  }catch(error){showMessage("Conversão",error.message)}
}

async function editStructuredCard(card){
  const value=clone(card.__node);
  const replace=next=>{card.replaceWith(cardElement(next));scheduleSave()};
  if(value.kind==="raw_markdown") return editRawMarkdown(card,value);
  if(["photo","video","animation","audio","voice_note","document"].includes(value.kind)) return mediaAction(value.kind,value,replace);
  const next=await buildStructured(value.kind,"",value);
  if(next) replace(next);
}

async function resolveMirror(local,server){
  const diff=semanticDocumentDiff(server,local.document);
  const compatible=server?.id&&local.document?.id&&server.id===local.document.id;
  const choices=[
    {value:"server",label:"Manter versão do servidor",detail:"O espelho local será atualizado para esta versão."},
    ...(compatible?[{value:"local",label:"Restaurar espelho local",detail:"O conteúdo e os metadados locais serão gravados como nova revisão; o servidor atual continua preservado no histórico."}]:[]),
  ];
  const result=await comparisonDialog({
    title:"Divergência servidor × espelho local",
    summary:diff.summary,
    leftLabel:"Servidor — estrutura",
    leftValue:diff.leftOutline,
    rightLabel:"Espelho local — estrutura",
    rightValue:diff.rightOutline,
    choices,
    defaultChoice:"server",
    confirmLabel:"Usar esta versão",
  });
  return result?.choice||"server";
}

async function allowLeaveWithUnsavedMirror(actionLabel){
  saveMirror();
  return confirmDialog(
    "Alterações ainda não sincronizadas",
    `Não foi possível salvar no servidor antes de ${actionLabel}. O espelho local foi preservado neste dispositivo.`,
    {
      confirmLabel:`${actionLabel} mesmo assim`,
      cancelLabel:"Permanecer neste rascunho",
      details:["Continuar pode deixar o servidor temporariamente atrás do conteúdo local.","Na próxima abertura, o MDTXTRT compara servidor e espelho local antes de escolher a versão."],
    },
  );
}

async function loadDraft(id,{fromPublication=null,skipCurrentSave=false}={}){
  if(state.draft&&!skipCurrentSave){
    const saved=await commitNow("switch-draft");
    if(!saved&&!(await allowLeaveWithUnsavedMirror("trocar de rascunho"))) return false;
  }
  const data=await api(`/api/drafts/${id}`);
  state.draft=data.draft;
  state.editingPublication=fromPublication;
  state.outputOverride=null;
  nameEl.value=state.draft.name;
  renderDocument(state.draft.document);
  state.lastSaved=JSON.stringify(state.draft.document);

  const mirror=localStorage.getItem(mirrorKey());
  if(mirror){
    try{
      const local=JSON.parse(mirror);
      if(local.document&&JSON.stringify(local.document)!==state.lastSaved){
        const choice=await resolveMirror(local,state.draft.document);
        if(choice==="local"){
          state.draft={...state.draft,document:clone(local.document)};
          renderDocument(state.draft.document);
          setStatus("restaurando espelho local…");
          const restored=await commitNow("restore-local-mirror");
          if(!restored) setStatus("espelho local não sincronizado");
        }else saveMirror();
      }else saveMirror();
    }catch{saveMirror()}
  }else saveMirror();

  requestAnimationFrame(()=>{
    if(state.draft.session?.scroll_top) window.scrollTo(0,state.draft.session.scroll_top);
    restoreSelection(state.draft.session);
  });
  updatePublishLabels();
  if(!state.authExpired&&statusEl.textContent!=="espelho local não sincronizado") setStatus("salvo");
  return true;
}

async function createDraft(){
  if(state.draft){
    const saved=await commitNow("new-draft");
    if(!saved&&!(await allowLeaveWithUnsavedMirror("criar novo rascunho"))) return;
  }
  const data=await api("/api/drafts",{method:"POST",body:{name:"Novo rascunho"}});
  await loadDraft(data.draft.id,{skipCurrentSave:true});
}

async function listDrafts(){
  const data=await api(`/api/drafts?archived=${state.archivedView?1:0}`);
  const box=$("#drafts-list");
  box.replaceChildren();
  if(!data.drafts.length){box.textContent="Nenhum rascunho.";return}
  for(const draft of data.drafts){
    const row=document.createElement("div");
    row.className="list-row";
    row.dataset.draftId=String(draft.id);
    const name=document.createElement("strong");
    name.textContent=draft.name;
    const meta=document.createElement("small");
    meta.textContent=new Date(draft.updated_at).toLocaleString();
    const actions=document.createElement("div");
    actions.className="list-actions";
    const open=document.createElement("button");
    open.textContent="Abrir";
    open.onclick=async()=>{
      const loaded=await loadDraft(draft.id);
      if(loaded) $("#drafts-dialog").close();
    };
    const archive=document.createElement("button");
    archive.textContent=state.archivedView?"Restaurar":"Arquivar";
    archive.onclick=async()=>{
      await api(`/api/drafts/${draft.id}`,{method:"PATCH",body:{archived:!state.archivedView}});
      await listDrafts();
    };
    const remove=document.createElement("button");
    remove.textContent="Excluir";
    remove.className="danger";
    remove.onclick=async()=>{
      const allowed=await confirmDialog(
        "Excluir rascunho definitivamente",
        `Excluir definitivamente “${draft.name}”?`,
        {confirmLabel:"Excluir definitivamente",danger:true,details:["Esta operação remove o rascunho e os dados dependentes previstos pelo backend.","Use Arquivar se quiser manter o conteúdo recuperável."]},
      );
      if(!allowed) return;
      await api(`/api/drafts/${draft.id}`,{method:"DELETE",body:{confirm:true}});
      if(state.draft?.id===draft.id){state.draft=null;await createDraft()}
      else await listDrafts();
    };
    actions.append(open,archive,remove);
    row.append(name,meta,actions);
    box.append(row);
  }
}

async function listPublications(){
  const data=await api("/api/publications");
  const box=$("#publications-list");
  box.replaceChildren();
  if(!data.publications.length){box.textContent="Nenhuma publicação.";return}
  for(const publication of data.publications){
    const row=document.createElement("div");
    row.className="list-row";
    const name=document.createElement("strong");
    name.textContent=`${publication.kind==="telegram"?"Telegram":"Telegraph"} — ${publication.title}`;
    const meta=document.createElement("small");
    meta.textContent=publication.kind==="telegram"?`chat ${publication.destination_chat_id} · mensagem ${publication.telegram_message_id}`:(publication.telegraph_url||publication.telegraph_path);
    const actions=document.createElement("div");
    actions.className="list-actions";
    const open=document.createElement("button");
    open.textContent="Abrir vínculo";
    open.onclick=async()=>{
      const loaded=await loadDraft(publication.draft_id,{fromPublication:publication});
      if(loaded) $("#publications-dialog").close();
    };
    actions.append(open);
    row.append(name,meta,actions);
    box.append(row);
  }
}

function updatePublishLabels(){
  $("#publish-telegram").textContent=state.editingPublication?.kind==="telegram"?"Telegram vinculado":"Telegram";
  $("#publish-telegraph").textContent=state.editingPublication?.kind==="telegraph"?"Telegraph vinculado":"Telegraph";
}

async function postPublicationAction(where){
  const value=await openForm("Após publicar",[
    field("result","Resultado","text",where),
    field("action","Próxima ação","select","continue",[["continue","Continuar editando"],["archive","Arquivar rascunho"],["new","Começar novo"]]),
  ]);
  if(!value) return;
  if(value.action==="archive"&&state.draft){
    const data=await api(`/api/drafts/${state.draft.id}`,{method:"PATCH",body:{archived:true}});
    state.draft=data.draft;
  }
  if(value.action==="new") await createDraft();
}

function fillReview(title,plan){
  $("#review-title").textContent=title;
  $("#review-content").textContent=plan.preview??plan.content??"";
  $("#review-metrics").textContent=`Representação: ${plan.label||plan.key||""}${plan.exact===false?" · adaptação necessária":""}`;
  const warnings=$("#review-warnings");
  warnings.replaceChildren();
  const items=[
    ...(plan.blocking||[]).map(message=>({type:"Bloqueio",message})),
    ...(plan.adaptations||[]).map(message=>({type:"Adaptação",message:typeof message==="string"?message:message.message})),
  ];
  for(const item of items){
    const box=document.createElement("div");
    box.className="warning";
    const titleNode=document.createElement("b");
    titleNode.textContent=item.type;
    const text=document.createElement("span");
    text.textContent=item.message;
    box.append(titleNode,text);
    warnings.append(box);
  }
}

function showReviewError(message){
  tg?.HapticFeedback?.notificationOccurred("error");
  const warnings=$("#review-warnings");
  const box=document.createElement("div");
  box.className="warning";
  const title=document.createElement("b");
  title.textContent="Operação não concluída";
  const text=document.createElement("span");
  text.textContent=message;
  box.append(title,text);
  warnings.prepend(box);
}

async function preparedOutputOverride(){
  if(!state.outputOverride) return null;
  const override=materializeOutputOverride(canonicalDocument());
  await api("/api/conversion/canonical/review",{method:"POST",body:{document:override}});
  return override;
}

async function reviewAndPublish(destination){
  if(!state.draft) return;
  const saved=await commitNow("pre-publish");
  if(!saved){
    showMessage("Publicação interrompida","O rascunho não foi sincronizado com o servidor. A publicação não prosseguiu para evitar enviar uma revisão anterior.");
    return;
  }
  let override=null;
  try{override=await preparedOutputOverride()}
  catch(error){showMessage("Saída temporária precisa de nova revisão",error.message);return}

  const editing=state.editingPublication?.kind===destination?state.editingPublication:null;
  let title=editing?.title||nameEl.value||(destination==="telegraph"?"Sem título":"Publicação Telegram");
  let target="";

  if(destination==="telegram"){
    const preview=await api("/api/publish/telegram/preview",{method:"POST",body:{draft_id:state.draft.id,document_override:override}});
    let representations=preview.representations;
    const available=Object.values(representations.options||{}).filter(item=>item.available);
    if(!available.length){showMessage("Telegram","Nenhuma representação Telegram publicável para este documento.");return}
    let operation=editing?"edit":"new";
    const value=await openForm("Publicação Telegram",[
      field("title","Nome interno","text",title),
      field("target","Chat ID/@username; vazio mantém destino atual ou usa sua conversa","text",editing?.destination_chat_id||""),
      field("representation","Representação","select",representations.recommended,available.map(item=>[item.key,`${item.label}${item.exact?" — exata":" — adaptada"}`])),
      ...(editing?[field("operation","Ação","select","edit",[["edit","Editar mensagem existente"],["republish","Republicar como nova mensagem"]])]:[]),
      field("remember","Memorizar representação preferida","checkbox",false),
    ]);
    if(!value) return;
    title=value.title;
    target=value.target;
    operation=value.operation||operation;
    // The destination is part of preflight: never confirm a plan calculated for
    // the user's private chat and then send that plan to an unrelated target.
    const contextualPreview=await api("/api/publish/telegram/preview",{
      method:"POST",
      body:{draft_id:state.draft.id,document_override:override,...(target?{destination_chat_id:target}:{})},
    });
    representations=contextualPreview.representations;
    const plan=representations.options[value.representation];
    fillReview(`Revisão — ${plan.label}`,plan);
    const confirmButton=$("#review-confirm");
    confirmButton.disabled=!plan.available||Boolean(plan.blocking?.length);
    state.reviewAction=async()=>{
      confirmButton.disabled=true;
      try{
        const body={
          title,
          representation:value.representation,
          confirmed_fingerprint:plan.requires_confirmation?plan.fingerprint:undefined,
          document_override:override,
        };
        if(target) body.destination_chat_id=target;
        let result;
        if(editing&&operation==="edit") result=await api(`/api/publications/${editing.id}/telegram`,{method:"PUT",body});
        else if(editing&&operation==="republish") result=await api(`/api/publications/${editing.id}/telegram/republish`,{method:"POST",body});
        else result=await api("/api/publish/telegram",{method:"POST",body:{...body,draft_id:state.draft.id}});
        if(value.remember) await rememberPreference("telegram_representation",value.representation);
        tg?.HapticFeedback?.notificationOccurred("success");
        $("#review-dialog").close();
        state.editingPublication=result.publication;
        state.outputOverride=null;
        updatePublishLabels();
        await postPublicationAction(`mensagem ${result.publication.telegram_message_id}`);
      }catch(error){
        if(error.data?.review) fillReview(`Revisão — ${plan.label}`,error.data.review);
        showReviewError(error.message);
        confirmButton.disabled=false;
      }
    };
    $("#review-dialog").showModal();
    return;
  }

  const value=await openForm(editing?"Atualizar Telegraph":"Publicar no Telegraph",[
    field("title","Título","text",title),
    ...(editing?[field("operation","Ação","select","edit",[["edit","Atualizar página existente"],["new","Criar nova página"]])]:[]),
  ]);
  if(!value) return;
  title=value.title;
  const preview=await api("/api/publish/telegraph/preview",{method:"POST",body:{draft_id:state.draft.id,document_override:override}});
  const review=preview.review;
  fillReview("Revisão — Telegraph",review);
  const confirmButton=$("#review-confirm");
  confirmButton.disabled=!review.publishable;
  state.reviewAction=async()=>{
    confirmButton.disabled=true;
    try{
      const body={title,confirmed_fingerprint:review.requires_confirmation?review.fingerprint:undefined,document_override:override};
      let result;
      if(editing&&value.operation==="edit") result=await api(`/api/publications/${editing.id}/telegraph`,{method:"PUT",body});
      else result=await api("/api/publish/telegraph",{method:"POST",body:{...body,draft_id:state.draft.id}});
      tg?.HapticFeedback?.notificationOccurred("success");
      $("#review-dialog").close();
      state.editingPublication=result.publication;
      state.outputOverride=null;
      updatePublishLabels();
      await postPublicationAction(result.publication.telegraph_url||"Telegraph");
    }catch(error){
      if(error.data?.review) fillReview("Revisão — Telegraph",error.data.review);
      showReviewError(error.message);
      confirmButton.disabled=false;
    }
  };
  $("#review-dialog").showModal();
}

function looksLikeMarkdown(text){
  return /(^|\n)#{1,6}\s|(^|\n)\s*[-+*]\s+|(^|\n)```|\*\*[^\n*]+\*\*|\[[^\]]+\]\([^)]+\)|(^|\n)>\s/.test(text);
}

async function handlePaste(event){
  const text=event.clipboardData?.getData("text/plain")||"";
  if(!text||!looksLikeMarkdown(text)){setTimeout(scheduleSave);return}
  event.preventDefault();
  const after=activeBlock();
  const afterBlockId=after?.dataset.block||null;
  const initial=await openForm("Texto colado com sintaxe Markdown",[
    field("source","Conteúdo","textarea",text),
    field("mode","Interpretar como","select","literal",[["literal","Texto literal"],["markdown","Markdown — revisar"]]),
  ]);
  if(!initial) return;
  if(initial.mode==="literal"){
    insertBlock(node("paragraph",{children:[textNode(initial.source)]}),after);
    return;
  }
  try{
    const result=await conversionReviewFlow(initial.source,{insertAfterBlockId:afterBlockId});
    if(!result) return;
    if(result.mode==="keep"){
      insertBlock(node("paragraph",{children:[textNode(result.source)]}),after);
      return;
    }
    if(result.mode==="output"){
      state.outputOverride=result.operation;
      showMessage("Saída temporária preparada","O Markdown colado será inserido após o bloco selecionado somente na próxima publicação. O rascunho principal permanece inalterado; outras edições posteriores continuam sendo incorporadas quando a saída for materializada.");
      return;
    }
    let cursor=after;
    for(const block of result.blocks||[]) cursor=insertBlock(block,cursor);
    state.outputOverride=null;
  }catch(error){showMessage("Markdown colado",error.message)}
}

async function bootstrap(){
  if(!initData){setStatus("fora do Telegram");showMessage("Autenticação necessária","Abra este Mini App pelo Telegram.");return}
  try{
    state.preferences=(await api("/api/preferences/conversion")).preferences||{};
    const requested=new URLSearchParams(location.search).get("draft");
    if(requested){await loadDraft(requested);return}
    const data=await api("/api/drafts");
    if(!data.drafts.length){await createDraft();return}
    const latest=data.drafts[0];
    $("#resume-summary").textContent=`${latest.name} — ${new Date(latest.updated_at).toLocaleString()}`;
    const dialog=$("#resume-dialog");
    dialog.showModal();
    $$('button[value]',dialog).forEach(button=>button.onclick=()=>dialog.close(button.value));
    dialog.addEventListener("close",async function once(){
      dialog.removeEventListener("close",once);
      dialog.returnValue==="continue"?await loadDraft(latest.id):await createDraft();
    });
  }catch(error){
    if(error.status!==401){setStatus("erro");showMessage("Falha ao iniciar",error.message)}
  }
}

function installDeleteTool(){
  const existing=$("#delete-block");
  if(existing){existing.onclick=deleteActiveBlock;return}
  const button=document.createElement("button");
  button.className="tool";
  button.id="delete-block";
  button.type="button";
  button.textContent="⌫";
  button.title="Excluir bloco";
  button.onclick=deleteActiveBlock;
  $("#undo")?.before(button);
}

editor.addEventListener("beforeinput",event=>{ensureTypingBlock();insertPendingText(event);});
editor.addEventListener("keydown",event=>{
  if(event.key!=="Enter"||event.shiftKey||event.isComposing||event.ctrlKey||event.metaKey||event.altKey) return;
  const block=activeBlock();
  if(!block||block.__node||block.parentElement!==editor) return;
  event.preventDefault();
  const selection=window.getSelection();
  if(!selection?.rangeCount) return;
  const range=selection.getRangeAt(0);
  range.deleteContents();
  const br=document.createElement("br");
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  scheduleSave();
});
editor.addEventListener("focusin",ensureTypingBlock);
editor.addEventListener("input",scheduleSave);
editor.addEventListener("paste",event=>void handlePaste(event));
editor.addEventListener("dragstart",event=>{
  const block=event.target?.closest?.("[data-block]");
  if(!block||block.parentElement!==editor) return;
  state.draggedBlock=block;
  event.dataTransfer.effectAllowed="move";
});
editor.addEventListener("dragover",event=>{
  if(state.draggedBlock){event.preventDefault();event.dataTransfer.dropEffect="move"}
});
editor.addEventListener("drop",event=>{
  if(!state.draggedBlock) return;
  event.preventDefault();
  const target=event.target?.closest?.("[data-block]");
  const moved=state.draggedBlock;
  state.draggedBlock=null;
  if(!target||target===moved||target.parentElement!==editor) return;
  const rect=target.getBoundingClientRect();
  event.clientY<rect.top+rect.height/2?target.before(moved):target.after(moved);
  scheduleSave();
});
editor.addEventListener("dragend",()=>state.draggedBlock=null);

$$('[data-format]').forEach(button=>button.onclick=()=>{closeMenus();wrapSelection(button.dataset.format)});
$$('[data-inline-form]').forEach(button=>button.onclick=()=>void inlineForm(button.dataset.inlineForm));
$$('[data-block-action]').forEach(button=>button.onclick=()=>{closeMenus();replaceBlockKind(button.dataset.blockAction,button.dataset.level?Number(button.dataset.level):null)});
$$('[data-insert]').forEach(button=>button.onclick=()=>insertBlock(node(button.dataset.insert)));
$$('[data-structured]').forEach(button=>button.onclick=()=>void structuredAction(button.dataset.structured,button.dataset.preset||""));
$$('[data-media]').forEach(button=>button.onclick=()=>void mediaAction(button.dataset.media));
$$('[data-local-media]').forEach(button=>button.onclick=()=>localMediaAction(button.dataset.localMedia));
$$('[data-button]').forEach(button=>button.onclick=()=>void buttonAction(button.dataset.button));
$$('[role="tab"][data-view]').forEach(tab=>tab.onclick=()=>selectView(tab.dataset.view));

$("#native-location").onclick=()=>void nativeLocationAction();
$("#media-file").onchange=async event=>{
  const file=event.target.files?.[0];
  const kind=state.pendingMediaKind;
  event.target.value="";
  state.pendingMediaKind=null;
  if(file&&kind) await uploadLocalMedia(file,kind);
};

$("#undo").onclick=async()=>{
  if(!state.draft) return;
  if(!(await commitNow("before-undo"))){
    await noticeDialog("Undo interrompido","A revisão atual não foi salva no servidor. O Undo não prosseguiu para não operar sobre uma revisão anterior.");
    return;
  }
  const data=await api(`/api/drafts/${state.draft.id}/undo`,{method:"POST"});
  state.draft=data.draft;
  state.outputOverride=null;
  nameEl.value=data.draft.name;
  renderDocument(data.draft.document);
  state.lastSaved=JSON.stringify(data.draft.document);
  saveMirror();
};

$("#redo").onclick=async()=>{
  if(!state.draft) return;
  const candidates=state.draft.redo_candidates||[];
  if(!candidates.length){showMessage("Refazer","Não há revisão posterior.");return}
  const revisionId=candidates.length===1?candidates[0].id:(await openForm("Escolher ramo",[
    field("revision_id","Revisão","select",candidates[0].id,candidates.map(item=>[item.id,`${item.reason} — ${item.created_at}`])),
  ]))?.revision_id;
  if(!revisionId) return;
  const data=await api(`/api/drafts/${state.draft.id}/redo`,{method:"POST",body:{revision_id:revisionId}});
  state.draft=data.draft;
  state.outputOverride=null;
  nameEl.value=data.draft.name;
  renderDocument(data.draft.document);
  state.lastSaved=JSON.stringify(data.draft.document);
  saveMirror();
};

nameEl.onchange=async()=>{
  if(!state.draft) return;
  const data=await api(`/api/drafts/${state.draft.id}`,{method:"PATCH",body:{name:nameEl.value}});
  state.draft=data.draft;
  nameEl.value=data.draft.name;
};

$("#new-draft").onclick=()=>void createDraft();
$("#open-drafts").onclick=async()=>{await listDrafts();$("#drafts-dialog").showModal()};
$("#toggle-archived").onclick=async()=>{
  state.archivedView=!state.archivedView;
  $("#toggle-archived").textContent=state.archivedView?"Ver ativos":"Ver arquivados";
  await listDrafts();
};
$("#open-publications").onclick=async()=>{await listPublications();$("#publications-dialog").showModal()};
const importChosen=createImportChosen({api,showMessage,loadDraft,openForm,field,conversionSummary});
$("#import-file").onclick=event=>{
  event.stopPropagation();
  const input=$("#file");
  input.click();
  const hideMenu=()=>{
    window.removeEventListener("focus",hideMenu);
    const menu=$("#library-menu");
    if(menu) menu.hidden=true;
    syncBackButton();
  };
  window.addEventListener("focus",hideMenu);
};
$("#file").onchange=async event=>{
  const file=event.target.files?.[0];
  event.target.value="";
  const menu=$("#library-menu");
  if(menu) menu.hidden=true;
  syncBackButton();
  if(file) await importChosen(file);
};
$("#publish-telegram").onclick=()=>void reviewAndPublish("telegram");
$("#publish-telegraph").onclick=()=>void reviewAndPublish("telegraph");
$("#open-library").onclick=event=>{
  event.stopPropagation();
  $("#library-menu").hidden=!$("#library-menu").hidden;
  syncBackButton();
};
["new-draft","open-drafts","open-publications"].forEach(id=>{
  $("#"+id).addEventListener("click",()=>{$("#library-menu").hidden=true;syncBackButton()});
});
document.addEventListener("click",event=>{
  const menu=$("#library-menu");
  if(!menu||menu.hidden) return;
  if(event.target.closest("#library-menu,#open-library")) return;
  menu.hidden=true;
  syncBackButton();
});
$("#review-confirm").onclick=()=>void state.reviewAction?.();
$$('[data-close]').forEach(button=>button.onclick=()=>button.closest("dialog")?.close());
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("close",syncBackButton));
const nativeShowModal=HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal=function(...args){
  const result=nativeShowModal.apply(this,args);
  bindBackButton(true);
  return result;
};

window.addEventListener("mdtxtrt:auth-expired",()=>authExpired());
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden&&state.pendingLocationRequest&&!state.authExpired) void pollLocation(state.pendingLocationRequest);
});
window.addEventListener("pagehide",saveMirror);
state.sessionTimer=setInterval(()=>void saveSession(),5*60*1000);
installDeleteTool();
if(window.ResizeObserver) new ResizeObserver(layoutToolbar).observe($(".toolbar"));
window.addEventListener("resize",layoutToolbar);
void bootstrap();
