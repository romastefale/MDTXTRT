const one=s=>document.querySelector(s);
const all=s=>Array.from(document.querySelectorAll(s));
const editor = one('#editor');
const docName = one('#docName');
const linkBtn = one('#linkBtn');
const toast = one('#toast');
const toastTextHost = one('#toastTextHost');
if(!toast||!toastTextHost)throw new Error('Interface React incompleta: toast');
const toastText = document.createTextNode('');
toastTextHost.append(toastText);
const fileInput = one('#fileInput');
const menuDismissLayer = one('#menuDismissLayer');
const STATE_VERSION=2;
const FORMAT_CONTRACT=Object.freeze({
  files:Object.freeze({
    md:Object.freeze({import:true,export:true,preservation:"declared-rich-semantics",presentation:"normalized"}),
    txt:Object.freeze({import:true,export:true,preservation:"plain-text",lossy:true})
  }),
  destinations:Object.freeze({
    telegram:Object.freeze({publish:true,unsupported:"reject"}),
    telegraph:Object.freeze({publish:true,unsupported:"reject"})
  })
});
let dest = 'telegram';
let session='browser',busy=false;
const plusSubmenus=['#plus-file-menu','#plus-format-menu','#plus-structure-menu','#plus-media-menu','#plus-interaction-menu'];
const sheets=['#plusMenu',...plusSubmenus,'#linkMenu','#headingMenu','#quoteMenu','#listMenu','#exportMenu','#libraryMenu','#findMenu'];
let savedRange = null, editorCore = null, composing = false, saveTimer = null, remoteSaveTimer = null, remoteSaveQueue = Promise.resolve(), remoteMediaSyncedIds = new Set(), remoteSaveNoticeShown = false, telegraphPath = '', docId = crypto.randomUUID(), docRevision = 0, importedMd = '', importedTxt = '', importedHtml = '', mediaFiles = new Map(), mediaChoice = null, draftWriteBlocked = false, draftBlockNoticeShown = false, activeHandoff = '', handoffAction = null, exportOverride = null;
function applyAssets(){
  all('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    el.style.setProperty('--ui-icon', 'url("icons/' + name + '.svg")');
  });
}
applyAssets();
const THEME_KEY='mdtxtrt-theme';
const BROWSER_OWNER_KEY='mdtxtrt-browser-owner';
const DRAFT_KEY='rmdtxtml';
const DRAFT_ARCHIVE_PREFIX='rmdtxtml-document:';
const NEW_DOCUMENT_PARAM='new';
const scheme=window.matchMedia('(prefers-color-scheme: light)');
let themePreference='';
try{
  const stored=localStorage.getItem(THEME_KEY);
  if(stored==='light'||stored==='dark')themePreference=stored;
}catch{}
function getTg(){ return window.Telegram?.WebApp; }
function resolvedTheme(){
  if(themePreference)return themePreference;
  const tg=getTg();
  if(session==='ready'&&(tg?.colorScheme==='light'||tg?.colorScheme==='dark'))return tg.colorScheme;
  return scheme.matches?'light':'dark';
}
function syncBrowserChrome(mode,color){
  const root=document.documentElement,schemeMeta=one('#colorScheme'),themeMeta=one('#themeColor');
  root.style.colorScheme=mode;
  if(schemeMeta)schemeMeta.setAttribute('content',mode);
  if(themeMeta){
    const replacement=themeMeta.cloneNode();
    replacement.setAttribute('content',color);
    themeMeta.replaceWith(replacement);
  }
}
function applyScheme(mode=resolvedTheme()){
  const next=mode==='light'?'light':'dark',light=next==='light';
  const root=document.documentElement,color=light?'#f8fbff':'#000000';
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
  if(session==='ready'&&tg){
    tg.setHeaderColor(color);
    tg.setBackgroundColor(color);
    tg.setBottomBarColor(color);
  }
}
function setTheme(mode){
  if(mode!=='light'&&mode!=='dark')throw new Error('Tema inválido');
  themePreference=mode;
  try{localStorage.setItem(THEME_KEY,mode);}catch{}
  applyScheme(mode);
}
function normalizedRevision(value){return Number.isSafeInteger(value)&&value>=0?value:0;}
function bumpDocumentRevision(){
  if(docRevision>=Number.MAX_SAFE_INTEGER)throw new Error('O documento excedeu o limite de revisões desta sessão');
  docRevision++;
}
function requestMatchesDocument(doc,revision){return docId===doc&&docRevision===revision;}
function browserOwnerKey(){
  let key='';
  try{key=localStorage.getItem(BROWSER_OWNER_KEY)||'';}
  catch{throw new Error('Não foi possível acessar a identidade persistente do navegador');}
  if(/^[a-f0-9]{64}$/.test(key))return key;
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  key=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  try{
    localStorage.setItem(BROWSER_OWNER_KEY,key);
    if(localStorage.getItem(BROWSER_OWNER_KEY)!==key)throw new Error('A identidade não permaneceu armazenada');
  }catch{throw new Error('Não foi possível persistir a identidade do navegador');}
  return key;
}
applyScheme();
scheme.addEventListener('change',()=>{if(!themePreference)applyScheme();});
const API = 'https://mdtxtrt.up.railway.app';
const DB_NAME='mdtxtrt',DB_STORE='media';
function mediaDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('Este navegador não oferece armazenamento persistente para anexos'));return;}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DB_STORE))req.result.createObjectStore(DB_STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Não foi possível abrir o armazenamento de anexos'));
  });
}
async function mediaStore(value){
  const db=await mediaDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(value);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Não foi possível salvar o anexo'));tx.onabort=tx.onerror;
  });
  db.close();
}
async function mediaLoad(id){
  const db=await mediaDB();
  const value=await new Promise((resolve,reject)=>{
    const req=db.transaction(DB_STORE,'readonly').objectStore(DB_STORE).get(id);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('Não foi possível recuperar o anexo'));
  });
  db.close();return value;
}
async function mediaClear(){
  const db=await mediaDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).clear();
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Não foi possível limpar os anexos'));tx.onabort=tx.onerror;
  });
  db.close();
}
async function mediaDelete(id){
  if(!id)return;
  const db=await mediaDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Não foi possível remover o anexo'));tx.onabort=tx.onerror;
  });
  db.close();
}
function sanitizeDraftRuntimeDOM(box){
  for(const el of [...box.querySelectorAll('*')]){
    for(const name of ['contenteditable','draggable','spellcheck','tabindex','aria-selected'])el.removeAttribute(name);
  }
  return box;
}
function draftHTML(){
  const box=document.createElement('div');
  box.innerHTML=requireEditorCore().html();
  sanitizeDraftRuntimeDOM(box);
  box.querySelectorAll('[data-media-id]').forEach(node=>{if(/^blob:/i.test(node.getAttribute('src')||''))node.removeAttribute('src');});
  return box.innerHTML;
}
function activeMedia(){
  const result=[];
  for(const node of editor.querySelectorAll('[data-media-id]')){
    const id=node.getAttribute('data-media-id')||'';
    const media=mediaFiles.get(id);
    if(media)result.push(media);
  }
  return result;
}
function draftState(action=''){
  const active=activeMedia();
  const state={version:STATE_VERSION,name:docName.value,html:draftHTML(),dest,telegraphPath,docId,revision:docRevision,importedMd,importedTxt,importedHtml,media:active.map(item=>({id:item.id,kind:item.kind}))};
  if(action)state.action=action;
  return state;
}
function cleanDraftHTML(html){
  if(typeof html!=='string')throw new Error('Rascunho inválido');
  const box=document.createElement('div');box.innerHTML=html;
  sanitizeDraftRuntimeDOM(box);
  const allowed=new Set('a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div'.split(' '));
  const attrs=new Set('href name class style src alt tg-spoiler start type reversed value checked disabled controls expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats data-media-id data-media-missing'.split(' '));
  const localMedia=[...box.querySelectorAll('[data-media-id]')];
  if(localMedia.length>50)throw new Error('O Telegram aceita no máximo 50 mídias por Rich Message');
  if(new Set(localMedia.map(node=>node.getAttribute('data-media-id'))).size!==localMedia.length)throw new Error('O rascunho contém identificadores de mídia duplicados');
  for(const el of [...box.querySelectorAll('*')]){
    if(!allowed.has(el.localName))throw new Error('O rascunho contém um elemento não suportado');
    for(const a of [...el.attributes]){
      if(!attrs.has(a.name))throw new Error('O rascunho contém um atributo não suportado');
      if(a.name==='class'&&!(/^language-[a-z0-9+-]+$/i.test(a.value)||a.value==='tg-footer'))throw new Error('O rascunho contém uma classe não suportada');
      if(a.name==='style'&&!(el.localName==='tg-button'&&['link','primary','success','danger'].includes(a.value)))throw new Error('O rascunho contém um estilo não suportado');
      if(a.name==='data-media-id'&&!/^[A-Za-z0-9_-]{1,64}$/.test(a.value))throw new Error('O rascunho contém um identificador de mídia inválido');
      if(['href','src','url'].includes(a.name)&&a.value){
        if(a.name==='href'&&a.value.startsWith('#'))continue;
        let u;try{u=new URL(a.value,location.href);}catch{throw new Error('O rascunho contém um link inválido');}
        if(!['http:','https:','tg:','mailto:','tel:'].includes(u.protocol))throw new Error('O rascunho contém um link inválido');
      }
    }
  }
  return box.innerHTML;
}
function mediaNode(id){return [...editor.querySelectorAll('[data-media-id]')].find(node=>node.getAttribute('data-media-id')===id)||null;}
function clearRuntimeMedia(){
  for(const media of mediaFiles.values())if(media.url)URL.revokeObjectURL(media.url);
  mediaFiles.clear();
  remoteMediaSyncedIds.clear();
}
function restoreActiveMediaVisual(){
  let restored=false;
  for(const media of activeMedia()){
    if(!media.url)continue;
    restored=requireEditorCore().patchMedia(media.id,{src:media.url,'data-media-missing':''})||restored;
  }
  return restored;
}
async function restoreMedia(){
  const nodes=[...editor.querySelectorAll('[data-media-id]')];
  for(const node of nodes){
    const id=node.getAttribute('data-media-id')||'';
    try{
      const saved=await mediaLoad(id);
      if(!saved||saved.id!==id||!['image','video','audio','voice','document'].includes(saved.kind)||typeof saved.name!=='string'||!saved.name||typeof saved.type!=='string'||!saved.type||!(saved.file instanceof Blob))throw new Error('Anexo persistido incompatível');
      const prior=mediaFiles.get(id);if(prior?.url)URL.revokeObjectURL(prior.url);
      const file=saved.file instanceof File?saved.file:new File([saved.file],saved.name,{type:saved.type,lastModified:Number.isFinite(saved.lastModified)?saved.lastModified:0});
      mediaFiles.set(id,{file,id,kind:saved.kind,url:URL.createObjectURL(file)});
    }catch(err){
      try{await mediaDelete(id);}catch(cleanupError){console.error('Media cleanup',cleanupError);}
      requireEditorCore().patchMedia(id,{src:'','data-media-missing':'true'});
      showToast(err.message||'Não foi possível recuperar o anexo');
    }
  }
  restoreActiveMediaVisual();decorateSpecials();
}
async function installMedia(file,id,kind){
  const prior=mediaFiles.get(id);if(prior?.url)URL.revokeObjectURL(prior.url);
  mediaFiles.set(id,{file,id,kind,url:URL.createObjectURL(file)});
  await mediaStore({id,file,kind,name:file.name,type:file.type,lastModified:file.lastModified});
  const node=mediaNode(id);
  if(!node)throw new Error('Anexo não encontrado no documento');
  restoreActiveMediaVisual();
  decorateSpecials();
}
function telegramUploadLimit(kind){
  return kind==='image'?10_000_000:50_000_000;
}
function decorateSpecials(){
  requireEditorCore();
}
function handoffToken(){
  try{
    const direct=new URL(location.href).searchParams.get('handoff')||'';
    if(/^[a-f0-9]{32}$/.test(direct))return direct;
  }catch{}
  const initData=getTg()?.initData;
  if(typeof initData!=='string'||!initData)return '';
  const raw=new URLSearchParams(initData).get('start_param');
  if(typeof raw!=='string')return '';
  const match=/^h_([a-f0-9]{32})$/.exec(raw);
  return match?match[1]:'';
}
function normalizedHandoffAction(value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||value.type!=='publish'||!['pending','sending','succeeded','failed','uncertain'].includes(value.status)||!Number.isInteger(value.attempts)||value.attempts<0||typeof value.error!=='string'||!/^[a-f0-9-]{36}$/i.test(String(value.doc||''))||!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('Estado da publicação transferida inválido');
  if(value.status==='succeeded'&&(!value.result||value.result.via!=='sendRichMessage'||!Number.isInteger(value.result.messageId)||value.result.messageId<=0))throw new Error('Resultado da publicação transferida inválido');
  return value;
}
function handoffActionNotice(action,recovered=false){
  if(!action)return recovered?'Rascunho aberto no Mini App':'Transferência sem ação pendente';
  if(action.status==='succeeded')return 'Esta transferência já foi publicada no chat do bot';
  if(action.status==='sending')return 'A publicação desta transferência ainda está em andamento. Não reenvie.';
  if(action.status==='uncertain')return action.error||'O resultado desta publicação é incerto. Confira o chat antes de iniciar outra publicação.';
  if(action.status==='failed')return action.error?('A publicação anterior falhou: '+action.error+'. Toque em Publicar para tentar novamente.'):'A publicação anterior falhou. Toque em Publicar para tentar novamente.';
  return 'Rascunho recuperado. Toque em Publicar para autorizar o envio.';
}
async function claimHandoff(){
  const token=handoffToken();
  if(!token)throw new Error('Transferência inválida');
  const initData=getTg().initData;
  const res=await fetch(API+'/api/handoff/claim',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},body:JSON.stringify({initData,token})});
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível recuperar o rascunho');
  const d=data.draft;
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string'||!Array.isArray(d.media))throw new Error('Rascunho transferido incompatível');
  const purpose=data.purpose===undefined?'transfer':data.purpose;
  if(!['transfer','import'].includes(purpose))throw new Error('Finalidade da transferência incompatível');
  if(purpose==='import')archiveStoredDraftForNew(token);
  const priorIds=[...mediaFiles.keys()];
  clearRuntimeMedia();
  const handoffHTML=cleanDraftHTML(d.html);requireEditorCore().resetHTML(handoffHTML,{silent:true});docName.value=d.name;
  dest=d.dest;telegraphPath=d.telegraphPath;docId=d.docId;docRevision=normalizedRevision(d.revision);
  importedMd=d.importedMd;importedTxt=d.importedTxt;importedHtml=d.importedHtml;
  const files=Array.isArray(data.files)?data.files:[];
  if(files.length!==d.media.length)throw new Error('Anexos da transferência incompatíveis');
  for(const meta of files){
    if(typeof meta.name!=='string'||!meta.name||typeof meta.mime!=='string'||!meta.mime||!['image','video','audio','voice','document'].includes(meta.kind)||!/^[A-Za-z0-9_-]{1,64}$/.test(meta.id))throw new Error('Metadados do anexo transferido inválidos');
    const fileRes=await fetch(API+'/api/handoff/file',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json'},body:JSON.stringify({initData,token,id:meta.id})});
    if(!fileRes.ok)throw new Error('Não foi possível recuperar um anexo transferido');
    const blob=await fileRes.blob();
    const file=new File([blob],meta.name,{type:meta.mime,lastModified:Date.now()});
    await installMedia(file,meta.id,meta.kind);
  }
  for(const id of priorIds)if(!mediaFiles.has(id))try{await mediaDelete(id);}catch(error){console.error('Media cleanup',error);}
  activeHandoff=token;
  handoffAction=normalizedHandoffAction(data.action);
  decorateSpecials();setDestination(dest,false,false);saveLocal();
  showToast(purpose==='import'?'Arquivo importado aberto como novo documento':handoffActionNotice(handoffAction,true));
}
async function refreshHandoffAction(){
  if(!activeHandoff||session!=='ready')return null;
  const res=await fetch(API+'/api/handoff/status',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({initData:getTg().initData,token:activeHandoff})});
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível consultar a transferência');
  handoffAction=normalizedHandoffAction(data.action);
  return handoffAction;
}
async function publishHandoff(){
  if(!activeHandoff||!handoffAction)return false;
  if(handoffAction.doc!==docId||handoffAction.revision!==docRevision){
    showToast('O documento mudou desde a transferência. Inicie uma nova publicação para enviar esta versão.');
    return true;
  }
  const body=JSON.stringify({initData:getTg().initData,token:activeHandoff});
  try{
    const res=await fetch(API+'/api/handoff/publish',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json'},body});
    const data=await readResponse(res);
    if(data.action)handoffAction=normalizedHandoffAction(data.action);
    if(handoffAction?.status==='succeeded'){
      showToast(data.reused?'Esta transferência já foi publicada no chat do bot':'Mensagem enviada no chat do bot');
      return true;
    }
    if(handoffAction?.status==='sending'){
      showToast('A publicação está em andamento. Não reenvie; consulte o estado desta transferência.');
      return true;
    }
    if(handoffAction?.status==='uncertain'){
      showToast(handoffAction.error||'O resultado do envio é incerto. Confira o chat antes de iniciar outra publicação.');
      return true;
    }
    if(handoffAction?.status==='failed'){
      showToast(handoffActionNotice(handoffAction));
      return true;
    }
    if(!res.ok)throw new Error(data.error||'Não foi possível publicar a transferência');
    showToast(handoffActionNotice(handoffAction));
    return true;
  }catch(err){
    if(err.name==='TimeoutError'||err instanceof TypeError){
      try{
        const action=await refreshHandoffAction();
        showToast(handoffActionNotice(action));
      }catch{
        showToast('O resultado do envio é incerto. Nenhum reenvio foi feito; confira o chat ou reabra esta transferência antes de tentar outra publicação.');
      }
      return true;
    }
    showToast(err.message||'Não foi possível publicar a transferência');
    return true;
  }
}
async function recoverTelegraph(){
  if(!/^[a-f0-9-]{36}$/i.test(docId))throw new Error('Documento inválido');
  const requestDoc=docId,requestRevision=docRevision;
  const identity=session==='ready'?{initData:getTg().initData}:{browserKey:browserOwnerKey()};
  const res=await fetch(API+'/api/telegraph/recover',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json'},body:JSON.stringify({...identity,doc:requestDoc,revision:requestRevision})});
  if(res.status===404)return false;
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível recuperar a página do Telegraph');
  if(typeof data.path!=='string'||!data.path||data.doc!==requestDoc||data.revision!==requestRevision)throw new Error('Resposta de recuperação do Telegraph inválida');
  if(!requestMatchesDocument(requestDoc,requestRevision))return false;
  telegraphPath=data.path;
  saveLocal();
  return true;
}
async function openMiniApp(){
  if(busy)return;busy=true;
  try{
    saveLocal();
    const active=activeMedia();
    const localIds=[...editor.querySelectorAll('[data-media-id]')].map(node=>node.getAttribute('data-media-id'));
    if(localIds.some(id=>!mediaFiles.has(id)))throw new Error('Há mídia local que precisa ser anexada novamente');
    const rich=buildRich();
    const form=new FormData();
    form.set('draft',JSON.stringify(draftState()));
    form.set('action',JSON.stringify({type:'publish',html:rich.rich_message.html}));
    for(const media of active)form.set('upload_'+media.id,media.file,media.file.name);
    const res=await fetch(API+'/api/handoff',{method:'POST',signal:AbortSignal.timeout(60000),body:form});
    const data=await readResponse(res);
    if(!res.ok)throw new Error(data.error||'Não foi possível abrir o Mini App');
    if(typeof data.open!=='string')throw new Error('Resposta de transferência inválida');
    const open=new URL(data.open);
    const api=new URL(API);
    if(open.origin!==api.origin||open.pathname!=='/telegram/open'||!/^[a-f0-9]{32}$/.test(open.searchParams.get('handoff')||''))throw new Error('Resposta de transferência inválida');
    window.location.assign(open.href);
  }catch(err){showToast(err.name==='TimeoutError'?'Tempo de transferência esgotado':err.message||'Não foi possível abrir o Mini App');}
  finally{busy=false;}
}
async function verifyTelegram(){
  const initData=getTg()?.initData;
  if(!initData){
    try{await recoverTelegraph();}catch(err){if(!/não encontrada/i.test(err.message||''))console.error('Telegraph browser recovery',err);}
    return;
  }
  session='pending';
  try{
    const res=await fetch(API+'/api/telegram/session',{signal:AbortSignal.timeout(15000),method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData})});
    if(!res.ok)throw new Error('Sessão Telegram inválida ou expirada');
    setupTelegram();
  }catch(err){
    session='invalid';
    document.body.classList.remove('tg');
    applyScheme();
    showToast(err.message||'Não foi possível validar a sessão Telegram');
    return;
  }
  if(handoffToken()){
    try{await claimHandoff();}catch(err){showToast(err.message||'Não foi possível recuperar o rascunho');}
    return;
  }
  try{await recoverTelegraph();}catch(err){showToast(err.message||'Não foi possível recuperar a página do Telegraph');}
}
const telegramInsetFields=['top','right','bottom','left'];
function validTelegramInsets(value){
  return value&&telegramInsetFields.every(field=>Number.isInteger(value[field])&&value[field]>=0);
}
function syncTelegramSafeAreas(){
  const tg=getTg(),root=document.documentElement;
  if(validTelegramInsets(tg?.safeAreaInset)){
    for(const field of telegramInsetFields)root.style.setProperty('--app-tg-safe-'+field,tg.safeAreaInset[field]+'px');
  }
  if(validTelegramInsets(tg?.contentSafeAreaInset)){
    for(const field of telegramInsetFields)root.style.setProperty('--app-tg-content-safe-'+field,tg.contentSafeAreaInset[field]+'px');
    root.classList.add('tg-shell');
  }else{
    root.classList.remove('tg-shell');
  }
}
function handleTelegramViewportChange(event){
  if(event?.isStateStable===true)syncTelegramSafeAreas();
  scheduleBrowserViewport();
}
function setupTelegram(){
  const tg=getTg();
  session='ready';
  document.body.classList.add('tg');
  setDestination(dest,false,false);
  tg.onEvent('themeChanged',applyScheme);
  tg.onEvent('viewportChanged',handleTelegramViewportChange);
  tg.onEvent('safeAreaChanged',syncTelegramSafeAreas);
  tg.onEvent('contentSafeAreaChanged',syncTelegramSafeAreas);
  tg.onEvent('fullscreenChanged',()=>{syncTelegramSafeAreas();scheduleBrowserViewport();});
  tg.onEvent('fullscreenFailed',event=>{
    if(event?.error==='ALREADY_FULLSCREEN'&&tg.isFullscreen)return;
    showToast(event?.error==='UNSUPPORTED'?'Fullscreen indisponível neste Telegram':'Não foi possível abrir em fullscreen');
  });
  tg.ready();
  tg.expand();
  applyScheme();
  syncTelegramSafeAreas();
  if(typeof tg.isVersionAtLeast==='function'&&tg.isVersionAtLeast('8.0')&&typeof tg.requestFullscreen==='function'&&!tg.isFullscreen){
    try{tg.requestFullscreen();}
    catch(error){console.error('Telegram fullscreen',error);showToast('Não foi possível abrir em fullscreen');}
  }
  scheduleBrowserViewport();
  tg.SettingsButton.show();
  tg.SettingsButton.onClick(openPlusRoot);
  tg.BackButton.onClick(closeTopLayer);
  tg.BackButton.hide();
  tg.MainButton.hide();
}
function showToast(msg){
  toastText.data = String(msg); toast.classList.add('on');
  clearTimeout(showToast.t); showToast.t = setTimeout(()=>toast.classList.remove('on'), 1600);
}
function setDestination(value, notify=true, persist=true){
  const changed=dest!==value;
  dest = value;
  const btn = one('#destBtn');
  const name = dest === 'telegram' ? 'Telegram' : 'Telegraph';
  const icon = btn.querySelector('[data-icon]');
  icon.setAttribute('data-icon', dest === 'telegram' ? 'telegram' : 'telegraph');
  const open=one('#openAppBtn');
  const openIcon=open.querySelector('[data-icon]');
  openIcon.setAttribute('data-icon',dest==='telegram'?'telegram':'telegraph');
  const openLabel=one('#openAppLabel');
  const actionLabel=dest==='telegram'&&session!=='ready'?'Abrir no Mini App':'Publicar no '+name;
  if(openLabel)openLabel.textContent=actionLabel;
  open.setAttribute('aria-label',actionLabel);
  open.title=actionLabel;
  const exportControl=one('#exportBtn');
  exportControl.setAttribute('aria-label','Abrir menu de publicação, exportação e biblioteca');
  exportControl.title='Abrir menu de publicação, exportação e biblioteca';
  btn.setAttribute('aria-label', 'Alternar destino. Atual: ' + name);
  btn.setAttribute('aria-pressed', String(dest === 'telegraph'));
  btn.classList.toggle('active', dest === 'telegraph');
  btn.title = 'Destino: ' + name;
  applyAssets();
  all('#headingMenu [data-block]').forEach(item => {
    item.hidden=dest==='telegraph'&&!['p','h3','h4'].includes(item.dataset.block);
  });
  one('#quoteMenu [data-insert="expandquote"]').hidden = dest === 'telegraph';
  all('[data-telegram-only]').forEach(item=>item.hidden=dest==='telegraph');
  all('[data-telegraph-only]').forEach(item=>item.hidden=dest!=='telegraph');
  closePanels();
  if(changed)bumpDocumentRevision();
  if(persist)saveLocal();
  if(notify) showToast('Destino: ' + name);
}
function panelIsOpen(panel){
  if(!panel)return false;
  if(panel.hasAttribute('data-menu-open'))return true;
  return panel.hasAttribute('popover')&&panel.matches(':popover-open');
}
function librarySubmenuOpen(){
  return panelIsOpen(one('#libraryMenu'));
}
function hasOpenLayer(){
  return panelIsOpen(one('#dialogMenu'))||sheets.some(sel=>panelIsOpen(one(sel)));
}
function syncBackButton(){
  if(session!=='ready')return;
  if(hasOpenLayer())getTg().BackButton.show();
  else getTg().BackButton.hide();
}
function closeTopLayer(){
  const dialog=one('#dialogMenu');
  if(panelIsOpen(dialog)){finishDialog(dialogConfirm?false:null);return;}
  if(librarySubmenuOpen()){closeLibrary();return;}
  const sel=sheets.find(name=>panelIsOpen(one(name)));
  if(sel)closePanel(one(sel),true);
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
const panelAnchors=new WeakMap(),panelOpeners=new WeakMap();
let dialogReturnFocus=null,dialogInerted=[];
function visualViewportBounds(){
  const root=document.documentElement,viewport=window.visualViewport;
  if(session==='ready'){
    const stable=Number(getTg()?.viewportStableHeight);
    if(Number.isFinite(stable)&&stable>0){
      const width=root.clientWidth||window.innerWidth;
      return {left:0,top:0,width,height:stable,right:width,bottom:stable};
    }
  }
  const left=viewport&&Number.isFinite(viewport.offsetLeft)?Math.max(0,viewport.offsetLeft):0;
  const top=viewport&&Number.isFinite(viewport.offsetTop)?Math.max(0,viewport.offsetTop):0;
  const width=viewport&&Number.isFinite(viewport.width)&&viewport.width>0?viewport.width:(root.clientWidth||window.innerWidth);
  const height=viewport&&Number.isFinite(viewport.height)&&viewport.height>0?viewport.height:(root.clientHeight||window.innerHeight);
  return {left,top,width,height,right:left+width,bottom:top+height};
}
function panelViewportBounds(base=visualViewportBounds()){
  const bar=one('.bar-wrap');
  const rect=bar?.getBoundingClientRect?.();
  const bottom=rect&&Number.isFinite(rect.top)&&rect.top>base.top&&rect.top<base.bottom?Math.max(base.top,rect.top-8):base.bottom;
  return {...base,height:Math.max(0,bottom-base.top),bottom};
}
function panelAnchor(panel){
  const override=panelAnchors.get(panel);
  if(override?.isConnected)return override;
  const id=panel.dataset.anchor;
  return id?one('#'+id):null;
}
function panelOrigin(element){
  if(!element||typeof element.focus!=='function')return null;
  const panel=element.closest?.('.glass-menu');
  return panel?(panelAnchor(panel)||element):element;
}
function isTypingEntry(element){
  return Boolean(element&&(element===editor||element.matches?.('textarea,input:not([type=button]):not([type=checkbox]):not([type=file]),[contenteditable="true"]')));
}
function typingFocusActive(outsidePanel=null){
  const active=document.activeElement;
  return isTypingEntry(active)&&(!outsidePanel||!outsidePanel.contains(active));
}
function focusControl(element){
  if(!element||!element.isConnected||typeof element.focus!=='function'||element.hidden||element.disabled)return false;
  try{element.focus({preventScroll:true});}catch{element.focus();}
  return true;
}
function focusMenuControl(element,outsidePanel=null){
  if(typingFocusActive(outsidePanel))return false;
  return focusControl(element);
}
function usableAnchorRect(rect,bounds){
  return Boolean(rect&&(rect.width>0||rect.height>0)&&rect.right>bounds.left&&rect.left<bounds.right&&rect.bottom>bounds.top&&rect.top<bounds.bottom);
}
function placePanel(panel,anchorRect=null){
  if(!panel)return;
  panel.setAttribute('data-runtime-positioned','');
  const viewport=visualViewportBounds(),bounds=panelViewportBounds(viewport),edge=8,gap=8;
  const fullHeight=Math.max(0,bounds.height-edge*2);
  const baseMax=Math.max(0,Math.min(420,bounds.height*.55,fullHeight));
  const maxWidth=Math.max(0,bounds.width-edge*2);
  panel.style.setProperty('--menu-max-height',baseMax+'px');
  panel.style.setProperty('--menu-max-width',maxWidth+'px');
  const anchor=panelAnchor(panel);
  const rect=anchorRect||anchor?.getBoundingClientRect()||null;
  let box=panel.getBoundingClientRect();
  if(!usableAnchorRect(rect,viewport)){
    const minLeft=bounds.left+edge,maxLeft=Math.max(minLeft,bounds.right-edge-box.width);
    const minTop=bounds.top+edge,maxTop=Math.max(minTop,bounds.bottom-edge-box.height);
    panel.style.setProperty('--menu-left',clamp(bounds.left+(bounds.width-box.width)/2,minLeft,maxLeft)+'px');
    panel.style.setProperty('--menu-top',clamp(bounds.top+(bounds.height-box.height)/2,minTop,maxTop)+'px');
    return;
  }
  const aboveSpace=Math.max(0,rect.top-gap-(bounds.top+edge));
  const belowSpace=Math.max(0,(bounds.bottom-edge)-(rect.bottom+gap));
  const wanted=Math.min(box.height||baseMax,baseMax);
  const preference=panel.dataset.placement||'auto';
  let side;
  if(preference==='top')side=aboveSpace>=wanted||aboveSpace>=belowSpace?'top':'bottom';
  else if(preference==='bottom')side=belowSpace>=wanted||belowSpace>=aboveSpace?'bottom':'top';
  else side=aboveSpace>=wanted?'top':belowSpace>=wanted?'bottom':aboveSpace>=belowSpace?'top':'bottom';
  const available=side==='top'?aboveSpace:belowSpace;
  panel.style.setProperty('--menu-max-height',Math.max(0,Math.min(baseMax,available))+'px');
  box=panel.getBoundingClientRect();
  const minLeft=bounds.left+edge,maxLeft=Math.max(minLeft,bounds.right-edge-box.width);
  const left=clamp(rect.left+rect.width/2-box.width/2,minLeft,maxLeft);
  const proposed=side==='top'?rect.top-gap-box.height:rect.bottom+gap;
  const minTop=bounds.top+edge,maxTop=Math.max(minTop,bounds.bottom-edge-box.height);
  panel.style.setProperty('--menu-left',left+'px');
  panel.style.setProperty('--menu-top',clamp(proposed,minTop,maxTop)+'px');
}
function syncMenuDismissLayer(){
  if(!menuDismissLayer)return;
  menuDismissLayer.hidden=!sheets.some(sel=>panelIsOpen(one(sel)));
}
function setMenuPanelOpen(panel,open){
  if(!panel)return;
  const next=Boolean(open);
  if(next===panel.hasAttribute('data-menu-open'))return;
  const anchor=panelAnchor(panel);
  if(next){
    panel.setAttribute('data-menu-open','');
    const list=panel.querySelector('.menu-list');
    if(list)list.scrollTop=0;
    placePanel(panel);
  }else{
    panel.removeAttribute('data-menu-open');
    panelAnchors.delete(panel);
  }
  if(anchor)anchor.setAttribute('aria-expanded',String(next));
  syncMenuDismissLayer();
  syncBackButton();
  document.dispatchEvent(new Event('selectionchange'));
}
function closePanels(except=null){
  for(const sel of sheets){
    const panel=one(sel);
    if(panel!==except&&panelIsOpen(panel))setMenuPanelOpen(panel,false);
  }
}
function openPanel(sel,anchorOverride=null){
  const panel=one(sel);
  if(!panel)throw new Error('Painel indisponível: '+sel);
  saveSel();
  closePanels(panel);
  if(anchorOverride)panelAnchors.set(panel,anchorOverride);else panelAnchors.delete(panel);
  const anchor=panelAnchor(panel);
  panelOpeners.set(panel,panelOrigin(anchor||document.activeElement));
  const anchorRect=anchor?.getBoundingClientRect()||null;
  panel.setAttribute('data-menu-open','');
  const list=panel.querySelector('.menu-list');
  if(list)list.scrollTop=0;
  placePanel(panel,anchorRect);
  if(anchor)anchor.setAttribute('aria-expanded','true');
  syncMenuDismissLayer();
  syncBackButton();
  document.dispatchEvent(new Event('selectionchange'));
}
function closePanel(panel,returnFocus=false){
  if(!panelIsOpen(panel))return;
  const target=returnFocus?panelOpeners.get(panel):null;
  const anchor=panelAnchor(panel);
  panel.removeAttribute('data-menu-open');
  panelAnchors.delete(panel);
  if(anchor)anchor.setAttribute('aria-expanded','false');
  syncMenuDismissLayer();
  syncBackButton();
  document.dispatchEvent(new Event('selectionchange'));
  if(returnFocus)focusMenuControl(target,panel);
}
function togglePanel(sel,anchorOverride=null){
  const panel=one(sel);
  if(!panel)throw new Error('Painel indisponível: '+sel);
  if(panelIsOpen(panel)){
    closePanel(panel,true);
    return false;
  }
  openPanel(sel,anchorOverride);
  return true;
}
function openPlusSubmenu(key){
  const sel='#plus-'+key+'-menu';
  if(!plusSubmenus.includes(sel))throw new Error('Categoria indisponível');
  openPanel(sel,one('#plusBtn'));
}
function openPlusRoot(){
  openPanel('#plusMenu',one('#plusBtn'));
}
function dialogOutsideBranches(dialog){
  const targets=[],seen=new Set();
  let node=dialog;
  while(node&&node!==document.body){
    const parent=node.parentElement;
    if(!parent)break;
    for(const child of parent.children){
      if(child!==node&&!seen.has(child)){seen.add(child);targets.push(child);}
    }
    node=parent;
  }
  return targets;
}
function setDialogModality(active){
  const dialog=one('#dialogMenu');
  if(active){
    dialogInerted=dialogOutsideBranches(dialog).map(element=>[element,element.hasAttribute('inert')]);
    for(const [element] of dialogInerted)element.setAttribute('inert','');
  }else{
    for(const [element,wasInert] of dialogInerted){
      if(!wasInert)element.removeAttribute('inert');
    }
    dialogInerted=[];
  }
}
function libraryFocusables(){
  const view=one('#libraryMenu');
  return view?[...view.querySelectorAll('button:not([disabled]):not([hidden]):not([tabindex="-1"]),input:not([disabled]):not([hidden]),textarea:not([disabled]):not([hidden]),select:not([disabled]):not([hidden]),[tabindex]:not([tabindex="-1"])')]:[];
}
function focusLibraryStart(){return focusMenuControl(one('#libraryClose'));}
function dialogFocusables(){
  const dialog=one('#dialogMenu');
  return [...dialog.querySelectorAll('button:not([disabled]):not([hidden]),input:not([disabled]):not([hidden]),textarea:not([disabled]):not([hidden]),select:not([disabled]):not([hidden]),[tabindex]:not([tabindex="-1"])')];
}
function focusDialogStart(selectValue=false){
  const input=one('#dialogInput');
  const target=!dialogConfirm&&!input.hidden?input:one('#dialogOk');
  if(focusControl(target)&&selectValue&&!dialogConfirm&&input.rows===1)input.select();
}
let dialogResolve=null,dialogConfirm=false,lastInteractionControl=null;
document.addEventListener('click',event=>{
  const control=event.target?.closest?.('button,input,textarea,select,[role="button"],[tabindex]');
  if(control&&!one('#dialogMenu').contains(control))lastInteractionControl=control;
},true);
function dialogOrigin(){
  const active=document.activeElement;
  if(active&&active!==document.body&&active!==editor)return panelOrigin(active);
  if(lastInteractionControl?.isConnected)return panelOrigin(lastInteractionControl);
  return editor;
}
function finishDialog(value){
  const resolve=dialogResolve,target=dialogReturnFocus;
  dialogResolve=null;dialogReturnFocus=null;
  const dialog=one('#dialogMenu');
  if(dialog.matches(':popover-open'))dialog.hidePopover();
  panelAnchors.delete(dialog);
  setDialogModality(false);
  syncBackButton();
  focusControl(target);
  if(resolve)resolve(value);
}
function dialogOpen(label,value='',rows=1,confirmMode=false,anchorOverride=null){
  if(dialogResolve)finishDialog(null);
  saveSel();
  dialogReturnFocus=dialogOrigin();
  closePanels();
  const dialog=one('#dialogMenu');
  const input=one('#dialogInput');
  const anchor=anchorOverride?.isConnected?anchorOverride:dialogReturnFocus?.isConnected?dialogReturnFocus:null;
  if(anchor)panelAnchors.set(dialog,anchor);else panelAnchors.delete(dialog);
  const anchorRect=anchor?.getBoundingClientRect()||null;
  one('#dialogLabel').textContent=label;
  dialogConfirm=confirmMode;
  input.hidden=confirmMode;
  input.value=confirmMode?'':String(value===null||value===undefined?'':value);
  input.rows=Math.max(1,Math.min(5,rows));
  one('#dialogOk').textContent=confirmMode?'Continuar':'OK';
  dialog.showPopover();
  setDialogModality(true);
  placePanel(dialog,anchorRect);
  syncBackButton();
  return new Promise(resolve=>{
    dialogResolve=resolve;
    focusDialogStart(rows===1);
  });
}
function ask(label,value='',rows=1,anchorOverride=null){return dialogOpen(label,value,rows,false,anchorOverride);}
async function approve(label){return await dialogOpen(label,'',1,true)===true;}
one('#dialogOk').addEventListener('click',()=>finishDialog(dialogConfirm?true:one('#dialogInput').value));
one('#dialogCancel').addEventListener('click',()=>finishDialog(dialogConfirm?false:null));
one('#dialogInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&e.currentTarget.rows===1){e.preventDefault();finishDialog(e.currentTarget.value);}});
one('#dialogMenu').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();finishDialog(dialogConfirm?false:null);return;}
  if(event.key!=='Tab')return;
  const items=dialogFocusables();
  if(!items.length){event.preventDefault();return;}
  const at=items.indexOf(document.activeElement);
  const next=event.shiftKey?(at<=0?items.length-1:at-1):(at<0||at===items.length-1?0:at+1);
  event.preventDefault();focusControl(items[next]);
});
document.addEventListener('focusin',event=>{
  const dialog=one('#dialogMenu');
  if(dialog.matches(':popover-open')&&!dialog.contains(event.target)){queueMicrotask(()=>focusDialogStart(false));return;}
  const menu=one('#libraryMenu');
  if(librarySubmenuOpen()&&!menu.contains(event.target)&&!isTypingEntry(event.target))queueMicrotask(focusLibraryStart);
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const dialog=one('#dialogMenu');
  if(dialog.matches(':popover-open')){event.preventDefault();finishDialog(dialogConfirm?false:null);return;}
  if(librarySubmenuOpen()){event.preventDefault();closeLibrary();return;}
  const sel=sheets.find(name=>panelIsOpen(one(name)));
  if(sel){event.preventDefault();closePanel(one(sel),true);}
});
function requireEditorCore(){
  if(!editorCore)throw new Error('Núcleo de edição indisponível');
  return editorCore;
}
function currentEditorCore(){return requireEditorCore();}
function saveSel(){savedRange=requireEditorCore().saveSelection();}
function restoreSel(){return savedRange?requireEditorCore().restoreSelection(savedRange):false;}
function pushHist(){requireEditorCore().syncFromDOM({addToHistory:true});}
function histUndo(){if(requireEditorCore().undo()){restoreActiveMediaVisual();syncEditorSelectionUI();}}
function histRedo(){if(requireEditorCore().redo()){restoreActiveMediaVisual();syncEditorSelectionUI();}}
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
function exec(cmd,value=null){
  if(!editorCore)throw new Error('Núcleo de edição indisponível');
  if(cmd==='insertUnorderedList')return toggleList();
  editorCore.exec(cmd,value);
  syncEditorSelectionUI();
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
  if(!editorCore)throw new Error('Núcleo de edição indisponível');
  if(!editorCore.toggleList(type))throw new Error('Selecione parágrafos para criar a lista');
  syncEditorSelectionUI();closePanels();
}
function formatBlock(tag){
  if(!editorCore)throw new Error('Núcleo de edição indisponível');
  if(!editorCore.formatBlock(tag))throw new Error('Não foi possível alterar o bloco');
  syncEditorSelectionUI();closePanels();
}
function insertHTML(html,asBlock=false){
  if(!editorCore)throw new Error('Núcleo de edição indisponível');
  restoreSel();
  if(!editorCore.insertHTML(html,asBlock))throw new Error('Não foi possível inserir o conteúdo');
  closePanels();syncEditorSelectionUI();
}
function mediaTag(url){
  const path=new URL(url).pathname.toLowerCase();
  return /\.(mp4|mov|webm|m4v|gif)$/.test(path)?'video':'img';
}
async function askUrl(label,value='https://',protocols=['http:','https:','tg:']){
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
function inlineLinkProtocols(destination=dest){
  return destination==='telegraph'?['http:','https:']:['http:','https:','mailto:','tel:','tg:'];
}
async function askInlineLink(label,value='https://',{destination=dest,protocols=inlineLinkProtocols(destination),anchor=linkBtn}={}){
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
async function insertHyperlink(){
  const destination=dest;
  restoreSel();
  if(requireEditorCore().selectionEmpty())editorCore.expandWord();
  if(requireEditorCore().selectionEmpty())return showToast('Selecione um texto para criar o hyperlink');
  const current=requireEditorCore().linkHref()||'https://';
  const link=await askInlineLink('URL do hyperlink',current,{destination,anchor:linkBtn});
  if(!link)return;
  restoreSel();
  if(requireEditorCore().selectionEmpty())return showToast('Selecione um texto para criar o hyperlink');
  exec('createLink',link.href);
}
async function insertVisibleLink(){
  const destination=dest;
  const link=await askInlineLink('Link','https://',{destination,anchor:linkBtn});
  if(!link)return;
  restoreSel();
  insertHTML('<a href="'+escapeHTML(link.href)+'">'+escapeHTML(link.text)+'</a>');
}
async function insertLinkButton(){
  const destination=dest;
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
async function mediaUrl(){
  return askUrl('Link da mídia','https://',['http:','https:']);
}
async function figure(kind){
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
async function insertFeature(kind){
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
function insertPlainText(text){
  if(!editorCore)throw new Error('Núcleo de edição indisponível');
  editorCore.insertText(text);
}
function markDirty(){
  exportOverride=null;
  bumpDocumentRevision();
  decorateSpecials();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 400);
}
window.addEventListener('pagehide',()=>{
  saveLocal();
  clearTimeout(remoteSaveTimer);
  void persistRemoteDraft(true).catch(error=>console.error('Persistent draft pagehide',error));
});
function saveLocal(){
  clearTimeout(saveTimer);
  if(draftWriteBlocked){
    if(!draftBlockNoticeShown){draftBlockNoticeShown=true;showToast('O rascunho recuperável foi preservado; alterações desta sessão não substituirão essa cópia');}
    return false;
  }
  try{
    localStorage.setItem(DRAFT_KEY,JSON.stringify(draftState()));
    scheduleRemoteDraftSave();
    return true;
  }catch{
    showToast('Não foi possível salvar neste dispositivo');
    scheduleRemoteDraftSave();
    return false;
  }
}

function remoteDraftIdentity(){
  const initData=getTg()?.initData;
  if(typeof initData==='string'&&initData)return {initData};
  return {browserKey:browserOwnerKey()};
}
function appendRemoteIdentity(target,identity=remoteDraftIdentity()){
  for(const [key,value] of Object.entries(identity))target.set(key,value);
  return identity;
}
function reportRemoteSaveFailure(error){
  console.error('Persistent draft',error);
  if(!remoteSaveNoticeShown){
    remoteSaveNoticeShown=true;
    showToast('A cópia no volume não pôde ser atualizada; o rascunho local foi mantido');
  }
}
async function persistRemoteDraft(pagehide=false){
  if(draftWriteBlocked)return false;
  const snapshot=draftState();
  const form=new FormData();
  appendRemoteIdentity(form);
  form.set('draft',JSON.stringify(snapshot));
  const active=activeMedia();
  const pending=active.filter(media=>!remoteMediaSyncedIds.has(media.id));
  for(const media of pending)form.set('upload_'+media.id,media.file,media.file.name);
  const options={method:'POST',body:form};
  if(!pagehide)options.signal=AbortSignal.timeout(60000);
  else if(!pending.length&&JSON.stringify(snapshot).length<60000)options.keepalive=true;
  const res=await fetch(API+'/api/drafts/save',options);
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível persistir o rascunho no volume');
  if(data?.draft?.docId!==snapshot.docId||data?.draft?.revision!==snapshot.revision)throw new Error('Confirmação de persistência inválida');
  remoteMediaSyncedIds=new Set(active.map(media=>media.id));
  remoteSaveNoticeShown=false;
  return true;
}
function scheduleRemoteDraftSave(delay=650){
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer=setTimeout(()=>{
    remoteSaveQueue=remoteSaveQueue.then(()=>persistRemoteDraft(false)).catch(error=>{reportRemoteSaveFailure(error);});
  },delay);
}
async function applyPersistentDraftData(data,identity){
  exportOverride=null;
  const d=data.draft;
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||d.name.length>256||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string'||!Array.isArray(d.media))throw new Error('Rascunho persistido incompatível');
  const html=cleanDraftHTML(d.html);
  clearRuntimeMedia();
  requireEditorCore().resetHTML(html,{silent:true});
  docName.value=d.name;
  telegraphPath=d.telegraphPath;
  docId=d.docId;
  docRevision=normalizedRevision(d.revision);
  importedMd=d.importedMd;
  importedTxt=d.importedTxt;
  importedHtml=d.importedHtml;
  dest=d.dest;
  activeHandoff='';handoffAction=null;
  draftWriteBlocked=false;
  const media=Array.isArray(data.media)?data.media:[];
  if(media.length!==d.media.length)throw new Error('Anexos persistidos incompatíveis');
  for(const meta of media){
    const expected=d.media.find(item=>item.id===meta.id&&item.kind===meta.kind);
    if(!expected||typeof meta.name!=='string'||typeof meta.mime!=='string')throw new Error('Anexo persistido incompatível');
    const fileRes=await fetch(API+'/api/drafts/file',{
      method:'POST',
      signal:AbortSignal.timeout(60000),
      headers:{'content-type':'application/json'},
      body:JSON.stringify({...identity,doc:d.docId,id:meta.id})
    });
    if(!fileRes.ok){
      let msg='Não foi possível recuperar o anexo persistido';
      try{msg=(await fileRes.json()).error||msg;}catch{}
      throw new Error(msg);
    }
    const blob=await fileRes.blob();
    const file=new File([blob],meta.name,{type:meta.mime,lastModified:0});
    await installMedia(file,meta.id,meta.kind);
    remoteMediaSyncedIds.add(meta.id);
  }
  setDestination(dest,false,false);
  syncEditorSelectionUI();
  try{localStorage.setItem(DRAFT_KEY,JSON.stringify({...d,html}));}catch(error){console.error('Local draft cache',error);}
  return true;
}
async function loadRemoteDraft(doc=''){
  const identity=remoteDraftIdentity();
  const res=await fetch(API+'/api/drafts/load',{
    method:'POST',
    signal:AbortSignal.timeout(5000),
    headers:{'content-type':'application/json'},
    body:JSON.stringify({...identity,...(doc?{doc}:{})})
  });
  if(res.status===404)return false;
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível recuperar o rascunho do volume');
  return applyPersistentDraftData(data,identity);
}

function libraryViewParam(){
  let value='';
  try{value=new URL(location.href).searchParams.get('view')||'';}catch{}
  return ['library','telegraph'].includes(value)?value:'';
}
function consumeLibraryView(){
  const value=libraryViewParam();
  if(!value)return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete('view');
    history.replaceState(history.state,'',url.href);
  }catch{}
  return value;
}
function consumeLaunchDocument(){
  let value='';
  try{value=new URL(location.href).searchParams.get('doc')||'';}catch{}
  if(!/^[a-f0-9-]{36}$/i.test(value))return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete('doc');
    history.replaceState(history.state,'',url.href);
  }catch{}
  return value.toLowerCase();
}
function consumeLaunchDestination(){
  let value='';
  try{value=new URL(location.href).searchParams.get('dest')||'';}catch{}
  if(!['telegram','telegraph'].includes(value))return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete('dest');
    history.replaceState(history.state,'',url.href);
  }catch{}
  return value;
}
function consumeBotLaunchAction(){
  let url;
  try{url=new URL(location.href);}catch{return null;}
  const action=url.searchParams.get('botAction')||'';
  if(!action)return null;
  const source=url.searchParams.get('source')||'';
  const doc=url.searchParams.get('doc')||'';
  url.searchParams.delete('botAction');
  url.searchParams.delete('source');
  url.searchParams.delete('doc');
  url.searchParams.delete('format');
  try{history.replaceState(history.state,'',url.href);}catch{}
  if(!/^[a-f0-9-]{36}$/i.test(doc))return {error:'Documento selecionado inválido'};
  if(action==='send'&&source==='d')return {action,source,doc:doc.toLowerCase()};
  if(action==='export'&&['d','t','g'].includes(source))return {action,source,doc:doc.toLowerCase()};
  return {error:'Ação selecionada pelo bot inválida'};
}
function libraryTime(value){
  if(!Number.isFinite(value)||value<=0)return '';
  try{return new Date(value).toLocaleString();}catch{return '';}
}
function emptyLibraryItem(text){
  const item=document.createElement('div');
  item.className='library-empty';
  item.textContent=text;
  return item;
}
function libraryEntry({title,preview='',meta='',createdAt=0,updatedAt=0,action,label='Editar',disabled=false,platform=''}){
  const card=document.createElement('article');
  card.className='library-entry';
  const text=document.createElement('div');
  text.className='library-entry-text';
  const head=document.createElement('div');
  head.className='library-entry-head';
  const strong=document.createElement('strong');strong.textContent=title||'Sem título';
  head.append(strong);
  if(platform){
    const badge=document.createElement('span');
    badge.className='library-badge';
    badge.textContent=platform;
    head.append(badge);
  }
  const excerpt=document.createElement('p');
  excerpt.className='library-preview';
  excerpt.textContent=preview||'Sem conteúdo para pré-visualização.';
  const details=document.createElement('span');
  details.className='library-meta';
  details.textContent=meta||'';
  const dates=document.createElement('div');
  dates.className='library-dates';
  const created=document.createElement('span');
  created.textContent='Criado: '+(libraryTime(createdAt)||'—');
  const modified=document.createElement('span');
  modified.textContent='Modificado: '+(libraryTime(updatedAt)||'—');
  dates.append(created,modified);
  text.append(head,excerpt,details,dates);
  const button=document.createElement('button');
  button.type='button';button.textContent=label;button.disabled=disabled;
  if(action)button.addEventListener('click',action);
  card.append(text,button);
  return card;
}
async function fetchLibrary(){
  const identity=remoteDraftIdentity();
  const res=await fetch(API+'/api/library/list',{
    method:'POST',signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/json'},body:JSON.stringify(identity)
  });
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível carregar a biblioteca');
  if(!Array.isArray(data.drafts)||!Array.isArray(data.telegram)||!Array.isArray(data.telegraph))throw new Error('Resposta da biblioteca inválida');
  return data;
}
async function openLibraryDraft(doc){
  const status=one('#libraryStatus');
  status.textContent='Abrindo rascunho…';
  try{
    const loaded=await loadRemoteDraft(doc);
    if(!loaded)throw new Error('Rascunho não encontrado');
    dismissLibraryMenu();
    showToast('Rascunho aberto');
  }catch(error){status.textContent=error.message||'Não foi possível abrir o rascunho';}
}
async function openTelegraphDocument(doc){
  exportOverride=null;
  const status=one('#libraryStatus');
  status.textContent='Carregando página do Telegraph…';
  try{
    const identity=remoteDraftIdentity();
    const res=await fetch(API+'/api/telegraph/load',{
      method:'POST',signal:AbortSignal.timeout(20000),
      headers:{'content-type':'application/json'},
      body:JSON.stringify({...identity,doc})
    });
    const data=await readResponse(res);
    if(!res.ok)throw new Error(data.error||'Não foi possível carregar a página do Telegraph');
    if(data.doc!==doc||typeof data.path!=='string'||!data.path||typeof data.title!=='string'||typeof data.html!=='string')throw new Error('Resposta do Telegraph inválida');
    const html=cleanDraftHTML(data.html);
    clearRuntimeMedia();
    if(!editorCore)throw new Error('Núcleo de edição indisponível');
    editorCore.resetHTML(html,{silent:true});
    docName.value=data.title.slice(0,256);
    docId=doc;
    docRevision=normalizedRevision(data.revision);
    telegraphPath=data.path;
    importedMd='';importedTxt='';importedHtml=html;
    activeHandoff='';handoffAction=null;
    draftWriteBlocked=false;
    setDestination('telegraph',false,false);
    saveLocal();
    dismissLibraryMenu();
    showToast('Página Telegraph aberta para edição');
  }catch(error){status.textContent=error.message||'Não foi possível abrir a página';}
}
async function renderLibrary(preferred=''){
  const draftList=one('#draftList'),telegramList=one('#telegramList'),telegraphList=one('#telegraphList'),status=one('#libraryStatus');
  const publicationCount=one('#publicationCount'),draftCount=one('#draftCount');
  draftList.replaceChildren();telegramList.replaceChildren();telegraphList.replaceChildren();
  status.textContent='Carregando…';
  if(publicationCount)publicationCount.textContent='0';
  if(draftCount)draftCount.textContent='0';
  try{
    const data=await fetchLibrary();
    if(publicationCount)publicationCount.textContent=String(data.telegram.length+data.telegraph.length);
    if(draftCount)draftCount.textContent=String(data.drafts.length);
    if(data.drafts.length){
      for(const item of data.drafts){
        const meta=['rev. '+item.revision,item.hasMedia?'com anexo':''].filter(Boolean).join(' · ');
        draftList.append(libraryEntry({
          title:item.name,preview:item.preview,meta,createdAt:item.createdAt,updatedAt:item.updatedAt,
          platform:item.dest==='telegraph'?'Telegraph':'Telegram',action:()=>void openLibraryDraft(item.docId),label:'Editar'
        }));
      }
    }else draftList.append(emptyLibraryItem('Nenhum rascunho persistido.'));
    if(data.telegram.length){
      for(const item of data.telegram){
        const state=item.status==='succeeded'?'publicada':item.status==='pending'?'pendente':'confirmação necessária';
        const meta=['rev. '+item.revision,item.messageId?'mensagem #'+item.messageId:'',item.historyCount>1?item.historyCount+' versões':'',state].filter(Boolean).join(' · ');
        telegramList.append(libraryEntry({
          title:item.name,preview:item.preview,meta,createdAt:item.createdAt,updatedAt:item.updatedAt,
          platform:'Telegram',action:()=>void openLibraryDraft(item.docId),label:'Editar texto'
        }));
      }
    }else telegramList.append(emptyLibraryItem('Nenhuma publicação Telegram vinculada.'));
    if(data.telegraph.length){
      for(const item of data.telegraph){
        const pending=item.status!=='succeeded';
        const meta=pending?'Publicação pendente de confirmação':['rev. '+item.revision,item.path].filter(Boolean).join(' · ');
        telegraphList.append(libraryEntry({
          title:item.name,preview:item.preview,meta,createdAt:item.createdAt,updatedAt:item.updatedAt,
          platform:'Telegraph',disabled:pending,action:()=>void openTelegraphDocument(item.docId),label:'Editar página'
        }));
      }
    }else telegraphList.append(emptyLibraryItem('Nenhuma publicação Telegraph vinculada.'));
    const publicationTotal=data.telegram.length+data.telegraph.length;
    status.textContent=publicationTotal+' '+(publicationTotal===1?'publicação':'publicações')+' · '+data.drafts.length+' '+(data.drafts.length===1?'rascunho':'rascunhos');
    if(preferred==='telegram'||preferred==='telegraph')setPublicationsExpanded(true);
    if(preferred==='telegram')one('#telegramLibrarySection')?.scrollIntoView({block:'nearest'});
    if(preferred==='telegraph')one('#telegraphLibrarySection')?.scrollIntoView({block:'nearest'});
  }catch(error){
    status.textContent=error.message||'Não foi possível carregar a biblioteca';
    draftList.append(emptyLibraryItem('Biblioteca indisponível.'));
    telegramList.append(emptyLibraryItem('Biblioteca indisponível.'));
    telegraphList.append(emptyLibraryItem('Biblioteca indisponível.'));
  }
}
function setLibrarySectionExpanded(toggleId,contentId,expanded){
  const toggle=one(toggleId),content=one(contentId);
  if(!toggle||!content)return;
  const open=Boolean(expanded);
  toggle.setAttribute('aria-expanded',String(open));
  content.hidden=!open;
}
function setPublicationsExpanded(expanded){
  setLibrarySectionExpanded('#publicationToggle','#publicationLists',expanded);
}
function setDraftsExpanded(expanded){
  setLibrarySectionExpanded('#draftToggle','#draftLists',expanded);
}
function openLibrary(preferred=''){
  setPublicationsExpanded(false);
  setDraftsExpanded(false);
  openPanel('#libraryMenu',one('#exportBtn'));
  const list=one('#libraryMenu .menu-list');
  if(list)list.scrollTop=0;
  syncBackButton();
  queueMicrotask(focusLibraryStart);
  void renderLibrary(preferred);
}
function closeLibrary(){
  const menu=one('#libraryMenu');
  if(!panelIsOpen(menu))return;
  closePanel(menu,false);
  setPublicationsExpanded(false);
  setDraftsExpanded(false);
  openPanel('#exportMenu',one('#exportBtn'));
  syncBackButton();
  queueMicrotask(()=>focusMenuControl(one('#libraryBtn')));
}
function dismissLibraryMenu(){
  const menu=one('#libraryMenu');
  if(panelIsOpen(menu))closePanel(menu,false);
  syncBackButton();
  queueMicrotask(()=>focusControl(editor));
}

function createNewDocumentLaunch(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  const token=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  const url=new URL(location.href);
  url.searchParams.set(NEW_DOCUMENT_PARAM,token);
  url.searchParams.delete('view');
  location.assign(url.href);
}
function newDocumentToken(){
  let token='';
  try{token=new URL(location.href).searchParams.get(NEW_DOCUMENT_PARAM)||'';}catch{}
  return /^[a-f0-9]{32}$/i.test(token)?token.toLowerCase():'';
}
function consumeNewDocumentToken(){
  const token=newDocumentToken();
  if(!token)return '';
  try{
    const url=new URL(location.href);
    url.searchParams.delete(NEW_DOCUMENT_PARAM);
    history.replaceState(history.state,'',url.href);
  }catch{}
  return token;
}
function archiveStoredDraftForNew(token){
  let raw;
  try{raw=localStorage.getItem(DRAFT_KEY);}
  catch{throw new Error('Não foi possível acessar o documento anterior; nenhum novo documento foi criado');}
  if(raw===null)return false;
  let suffix='unreadable-'+token;
  try{
    const parsed=JSON.parse(raw);
    if(parsed&&/^[a-f0-9-]{36}$/i.test(String(parsed.docId||'')))suffix=String(parsed.docId).toLowerCase();
  }catch{}
  const key=DRAFT_ARCHIVE_PREFIX+suffix;
  try{
    localStorage.setItem(key,raw);
    if(localStorage.getItem(key)!==raw)throw new Error('readback');
  }catch{throw new Error('Não foi possível preservar o documento anterior; nenhum novo documento foi criado');}
  return true;
}
function resetToNewDocument(){
  exportOverride=null;
  clearRuntimeMedia();
  mediaChoice=null;savedRange=null;activeHandoff='';handoffAction=null;
  requireEditorCore().resetHTML('',{silent:true});docName.value='Ideia';dest='telegram';telegraphPath='';
  docId=crypto.randomUUID();docRevision=0;importedMd='';importedTxt='';importedHtml='';
  draftWriteBlocked=false;draftBlockNoticeShown=false;
}
function startRequestedNewDocument(token){
  if(!token)return false;
  const preserved=archiveStoredDraftForNew(token);
  resetToNewDocument();
  return preserved;
}
function loadLocal(){
  let raw;
  try{raw=localStorage.getItem(DRAFT_KEY);}
  catch{draftWriteBlocked=true;throw new Error('Não foi possível acessar o rascunho local; nenhuma cópia foi alterada');}
  if(raw===null)return false;
  let d;
  try{d=JSON.parse(raw);}
  catch{draftWriteBlocked=true;throw new Error('Rascunho local inválido preservado para recuperação');}
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||d.name.length>256||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string'){
    draftWriteBlocked=true;
    throw new Error('Rascunho local incompatível preservado para recuperação');
  }
  let html;
  try{html=cleanDraftHTML(d.html);}
  catch(error){draftWriteBlocked=true;throw new Error((error.message||'Rascunho local inválido')+'. A cópia local foi preservada para recuperação');}
  requireEditorCore().resetHTML(html,{silent:true});docName.value=d.name;telegraphPath=d.telegraphPath;docId=d.docId;docRevision=normalizedRevision(d.revision);importedMd=d.importedMd;importedTxt=d.importedTxt;importedHtml=d.importedHtml;dest=d.dest;
  draftWriteBlocked=false;
  return true;
}
function escapeHTML(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function htmlToText(html){
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
function txtLosesStructure(html=''){
  let root=editor;
  if(html){
    root=document.createElement('div');
    root.innerHTML=html;
  }
  return Boolean(root.querySelector('h1,h2,h3,h4,h5,h6,strong,b,em,i,u,ins,s,strike,del,code,mark,sub,sup,tg-spoiler,tg-reference,tg-emoji,tg-time,tg-math,tg-math-block,hr,ul,ol,li,blockquote,aside,footer,table,details,summary,a[href],figure,figcaption,input'))||Boolean(root.querySelector('.tg-footer,blockquote[expandable]'));
}
function conversionWarning(format,html=''){
  if(format==='txt'&&txtLosesStructure(html))return 'TXT preserva apenas texto simples. Formatação, links e estrutura detectados serão perdidos. Exportar mesmo assim?';
  return '';
}
const PORTABLE_TAGS=new Set('a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div'.split(' '));
const PORTABLE_ATTRS=new Set('href name class style src alt tg-spoiler start type reversed value checked disabled controls expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats'.split(' '));
function normalizePortableHTML(root,label='conteúdo'){
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
function portableExportHTML(html){
  const box=document.createElement('div');box.innerHTML=String(html||'');
  if(box.querySelector('[data-media-id]'))throw new Error('Anexos locais precisam de URL pública para exportar Markdown');
  normalizePortableHTML(box,'do documento');
  return box.innerHTML;
}
function htmlToMarkdown(html){
  if(!window.TurndownService) throw new Error('Conversão Markdown indisponível');
  const portable=portableExportHTML(html);
  const svc = new TurndownService({headingStyle:'atx', codeBlockStyle:'fenced', bulletListMarker:'-', emDelimiter:'*'});
  svc.addRule('strikethrough',{filter:['s','strike','del'],replacement:content=>content?'~~'+content+'~~':''});
  svc.addRule('special', {filter: node => ['TG-SPOILER','TG-REFERENCE','TG-EMOJI','TG-TIME','TG-MATH','TG-MATH-BLOCK','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-BUTTON','TG-BUTTON-ROW','DETAILS','TABLE','FIGURE','ASIDE','FOOTER','SUB','SUP','MARK','U','INPUT','IFRAME','VIDEO','AUDIO'].includes(node.nodeName) || node.nodeName==='BLOCKQUOTE' && node.hasAttribute('expandable') || node.classList?.contains('tg-footer') || node.nodeName === 'A' && node.hasAttribute('name'), replacement: (_,node)=>['DETAILS','TABLE','FIGURE','ASIDE','FOOTER','IFRAME','VIDEO','AUDIO','BLOCKQUOTE','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-MATH-BLOCK','TG-BUTTON-ROW','P'].includes(node.nodeName)?'\n\n'+node.outerHTML+'\n\n':node.outerHTML});
  return svc.turndown(portable);
}
function mdToBasicHTML(md){
  if(!window.marked) throw new Error('Importação Markdown indisponível');
  const box = document.createElement('div');
  box.innerHTML = window.marked.parse(md, {gfm:true, breaks:false});
  normalizePortableHTML(box,'Markdown');
  return box.innerHTML;
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');
  a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
function telegraphURL(value){
  let url;try{url=new URL(value,location.href);}catch{throw new Error('Link do Telegraph inválido');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('O Telegraph exige links HTTP ou HTTPS');
  return url.href;
}
function telegraphNodes(root){
  const allow = new Set(['a','aside','b','blockquote','br','code','em','figcaption','figure','h3','h4','hr','i','iframe','img','li','ol','p','pre','s','strong','u','ul','video']);
  const conv = (el, standalone=false) => {
    if(el.nodeType === 3){const text=el.textContent;if(standalone&&!text.trim())return null;return standalone?{tag:'p',children:[text]}:text;}
    if(el.nodeType !== 1) return null;
    let tag = el.tagName.toLowerCase();
    if(el.hasAttribute('data-media-id')) throw new Error('O Telegraph precisa de uma URL pública para mídia');
    if(['div','article','section','span','thead','tbody','tfoot'].includes(tag)) return Array.from(el.childNodes).map(child=>conv(child,standalone)).flat().filter(Boolean);
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
function toRichHTML(root){
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
function buildRich(){
  return {rich_message: {html:toRichHTML(editor)}};
}
function buildTelegraph(){
  const title=docName.value.trim();
  if(!title) throw new Error('Dê um nome à página antes de publicar');
  const identity=session==='ready'?{initData:getTg().initData}:{browserKey:browserOwnerKey()};
  return {title, content: telegraphNodes(editor), path: telegraphPath, doc: docId, revision: docRevision, ...identity};
}
function exitFormattedBlockOnParagraph(event){
  if(composing||event.inputType!=='insertParagraph'||!editorCore)return;
  if(editorCore.exitFormattedBlock()){
    event.preventDefault();
    syncEditorSelectionUI();
  }
}
function commitEditorInput(event){
  if(!editorCore)return;
  editorCore.syncFromDOM({addToHistory:true});
  const blockTransformed=editorCore.applyMarkdownBlockRule({allowTask:dest==='telegram'});
  const inlineTransformed=!blockTransformed&&editorCore.applyMarkdownInlineRule();
  const normalized=!blockTransformed&&!inlineTransformed&&editorCore.normalizeEmptyFormattedBlock(event?.inputType||'');
  if(blockTransformed||inlineTransformed||normalized)syncEditorSelectionUI();
}
editor.addEventListener('beforeinput',event=>{
  if(!editorCore||composing)return;
  if(editorCore.handleBeforeInput(event))return;
  exitFormattedBlockOnParagraph(event);
});
editor.addEventListener('keydown',event=>{if(editorCore)editorCore.handleKeydown(event);});
editor.addEventListener('input', event=>{ if(!composing)commitEditorInput(event); });
editor.addEventListener('change',e=>{if(e.target.matches('input[type=checkbox]')){e.target.toggleAttribute('checked',e.target.checked);requireEditorCore().syncFromDOM({addToHistory:true});syncEditorSelectionUI();}});
editor.addEventListener('compositionstart', ()=> composing = true);
editor.addEventListener('compositionend', event=>{ composing = false; commitEditorInput(event); });
editor.addEventListener('keyup', saveSel);
editor.addEventListener('mouseup', saveSel);
editor.addEventListener('paste', e => {
  e.preventDefault();
  const text=e.clipboardData.getData('text/plain');
  insertPlainText(text);
});
function toggleToolbarState(btn,on){
  if(!btn)return;
  btn.classList.toggle('on',on);
  btn.setAttribute('aria-pressed',String(on));
}
function syncEditorSelectionUI(){
  const core=requireEditorCore();
  saveSel();
  const kind=core.currentBlockKind();
  all('#typebar [data-cmd]').forEach(btn=>toggleToolbarState(btn,Boolean(core.activeMark(btn.dataset.cmd))));
  toggleToolbarState(one('#listBtn'),Boolean(core.inBlock('li'))||panelIsOpen(one('#listMenu')));
  toggleToolbarState(one('#quoteBtn'),Boolean(core.inBlock('blockquote')||core.inBlock('aside'))||panelIsOpen(one('#quoteMenu')));
  toggleToolbarState(one('#headingBtn'),/^(h[1-6]|footer)$/.test(kind)||panelIsOpen(one('#headingMenu')));
  toggleToolbarState(one('#linkBtn'),Boolean(core.linkHref())||Boolean(panelIsOpen(one('#linkMenu'))));
  one('#plusBtn')?.classList.toggle('on',panelIsOpen(one('#plusMenu'))||plusSubmenus.some(sel=>panelIsOpen(one(sel))));
  all('#headingMenu [data-block]').forEach(btn=>btn.classList.toggle('is-current',btn.dataset.block===kind));
  all('#quoteMenu [data-block],#quoteMenu [data-insert]').forEach(btn=>{
    const requested=btn.dataset.block||btn.dataset.insert;
    btn.classList.toggle('is-current',requested===kind);
  });
}
document.addEventListener('selectionchange',syncEditorSelectionUI);
function retainedInterfaceControl(target){
  const control=target?.closest?.('#ux-root button,#ux-root [role="button"],#ux-root a[href]');
  return control&&!control.disabled?control:null;
}
document.addEventListener('pointerdown',event=>{
  if(!typingFocusActive())return;
  if(retainedInterfaceControl(event.target))event.preventDefault();
},true);


menuDismissLayer?.addEventListener('pointerdown',event=>{
  event.preventDefault();
  event.stopPropagation();
});
menuDismissLayer?.addEventListener('click',event=>{
  event.preventDefault();
  event.stopPropagation();
  closePanels();
});
all('#typebar [data-cmd], [data-plus-submenu] [data-cmd], #listMenu [data-cmd]').forEach(btn => btn.addEventListener('click', ()=>{try{exec(btn.dataset.cmd);closePanels();}catch(err){showToast(err.message);}}));
all('#typebar [data-block], #headingMenu [data-block], #quoteMenu [data-block]').forEach(btn => btn.addEventListener('click', ()=>{try{formatBlock(btn.dataset.block);}catch(err){showToast(err.message);}}));
document.querySelectorAll('[data-plus-submenu] [data-insert], #quoteMenu [data-insert], #listMenu [data-insert]').forEach(btn => btn.addEventListener('click', ()=>{void insertFeature(btn.dataset.insert).catch(err=>showToast(err.message));}));
const tableActions=Object.freeze({
  'add-row':()=>requireEditorCore().addTableRow(),
  'remove-row':()=>requireEditorCore().removeTableRow(),
  'add-column':()=>requireEditorCore().addTableColumn(),
  'remove-column':()=>requireEditorCore().removeTableColumn(),
  'delete-table':()=>requireEditorCore().deleteTable()
});
document.querySelectorAll('[data-table-action]').forEach(btn=>btn.addEventListener('click',()=>{
  try{
    restoreSel();
    const action=tableActions[btn.dataset.tableAction];
    if(typeof action!=='function'||!action())throw new Error('Posicione o cursor dentro da tabela');
    closePanels();syncEditorSelectionUI();
  }catch(err){showToast(err.message||'Não foi possível alterar a tabela');}
}));
all('#plusMenu [data-plus-category]').forEach(btn=>btn.addEventListener('click',()=>openPlusSubmenu(btn.dataset.plusCategory)));
all('[data-plus-submenu] [data-plus-back]').forEach(btn=>btn.addEventListener('click',()=>openPlusRoot()));
const linkActions=Object.freeze({
  hyperlink:insertHyperlink,
  url:insertVisibleLink,
  button:insertLinkButton
});
one('#plusBtn')?.addEventListener('click',()=>togglePanel('#plusMenu',one('#plusBtn')));
one('#headingBtn')?.addEventListener('click',()=>togglePanel('#headingMenu',one('#headingBtn')));
one('#listBtn')?.addEventListener('click',()=>togglePanel('#listMenu',one('#listBtn')));
one('#quoteBtn')?.addEventListener('click',()=>togglePanel('#quoteMenu',one('#quoteBtn')));
linkBtn.addEventListener('click',()=>togglePanel('#linkMenu',linkBtn));
all('#linkMenu [data-link-kind]').forEach(btn=>btn.addEventListener('click',()=>{
  const action=linkActions[btn.dataset.linkKind];
  closePanel(one('#linkMenu'));
  if(typeof action==='function')void action().catch(err=>showToast(err.message||'Não foi possível inserir o link'));
}));
function flashBtn(btn){
  if(!btn) return;
  btn.classList.remove('is-flash');
  void btn.offsetWidth;
  btn.classList.add('is-flash');
  clearTimeout(btn._flash);
  btn._flash = setTimeout(()=>btn.classList.remove('is-flash'), 1400);
}
one('#undoBtn').addEventListener('click', ()=>{ histUndo(); flashBtn(one('#undoBtn')); });
one('#redoBtn').addEventListener('click', ()=>{ histRedo(); flashBtn(one('#redoBtn')); });
one('#themeBtn').addEventListener('click',()=>setTheme(document.documentElement.classList.contains('light')?'dark':'light'));
one('#openAppBtn').addEventListener('click',()=>{if(dest==='telegram'&&session!=='ready')void openMiniApp();else void publishCurrent();});
one('#destBtn').addEventListener('click', ()=>setDestination(dest === 'telegram' ? 'telegraph' : 'telegram'));
one('#exportBtn').addEventListener('click', ()=>{
  if(session==='pending'){showToast('Aguarde a validação da sessão Telegram');return;}
  if(session==='invalid'){showToast('Sessão inválida ou expirada. Reabra o Mini App.');return;}
  const library=one('#libraryMenu');
  if(panelIsOpen(library)){
    closePanel(library,true);
    syncBackButton();
    return;
  }
  togglePanel('#exportMenu',one('#exportBtn'));
});
docName.addEventListener('input',markDirty);
one('#importMdBtn').addEventListener('click', ()=>{ fileInput.accept='.md,text/markdown'; fileInput.click(); closePanels(); });
one('#importTxtBtn').addEventListener('click', ()=>{ fileInput.accept='.txt,text/plain'; fileInput.click(); closePanels(); });
one('#exportTxtBtn').addEventListener('click', ()=>exportFile('txt'));
one('#exportMdBtn').addEventListener('click', ()=>exportFile('md'));
one('#mediaBtn').addEventListener('click',()=>{mediaChoice=null;one('#mediaInput').accept='image/*,video/*,audio/*,.pdf,.zip';one('#mediaInput').click();closePanels();});
one('#voiceBtn').addEventListener('click',()=>{mediaChoice='voice';one('#mediaInput').accept='audio/*,.ogg,.oga,.opus';one('#mediaInput').click();closePanels();});
one('#mediaInput').addEventListener('change',async()=>{
  const input=one('#mediaInput'),files=[...(input.files||[])];
  input.value='';
  const requestedKind=mediaChoice;
  mediaChoice=null;
  if(!files.length)return;
  const currentMedia=[...editor.querySelectorAll('img,video,audio,tg-document')].filter(node=>!(node.localName==='img'&&/^tg:\/\/emoji\?id=\d+$/.test(node.getAttribute('src')||''))).length;
  if(currentMedia+files.length>50){showToast('O Telegram aceita no máximo 50 mídias por Rich Message');return;}
  for(const file of files){
    let kind=requestedKind;
    if(kind==='voice'&&!file.type.startsWith('audio/')){showToast('Escolha arquivos de áudio para mensagens de voz');continue;}
    if(!kind)kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';
    const limit=telegramUploadLimit(kind);
    if(file.size>limit){showToast(kind==='image'?'Fotos enviadas por multipart podem ter até 10 MB':'Arquivos enviados por multipart podem ter até 50 MB');continue;}
    const id=crypto.randomUUID().replace(/-/g,'');
    const tag={image:'img',video:'video',audio:'audio',voice:'audio',document:'tg-document'}[kind];
    try{
      insertHTML('<figure><'+tag+' data-media-id="'+id+'"></'+tag+'><figcaption>'+escapeHTML(file.name)+'</figcaption></figure>',true);
      await installMedia(file,id,kind);
    }catch(err){
      mediaNode(id)?.closest('figure')?.remove();
      try{await mediaDelete(id);}catch{}
      showToast(err.message||'Não foi possível salvar um anexo');
    }
  }
  saveLocal();
});
one('#libraryBtn')?.addEventListener('click',()=>openLibrary());
one('#libraryClose')?.addEventListener('click',closeLibrary);
one('#libraryNew')?.addEventListener('click',createNewDocumentLaunch);
one('#publicationToggle')?.addEventListener('click',event=>setPublicationsExpanded(event.currentTarget.getAttribute('aria-expanded')!=='true'));
one('#draftToggle')?.addEventListener('click',event=>setDraftsExpanded(event.currentTarget.getAttribute('aria-expanded')!=='true'));
one('#libraryMenu')?.addEventListener('keydown',event=>{
  if(!librarySubmenuOpen()||event.key!=='Tab')return;
  const items=libraryFocusables();
  if(!items.length){event.preventDefault();return;}
  const at=items.indexOf(document.activeElement);
  const next=event.shiftKey?(at<=0?items.length-1:at-1):(at<0||at===items.length-1?0:at+1);
  event.preventDefault();
  focusControl(items[next]);
});
one('#findBtn').addEventListener('click', ()=>{saveSel();const anchor=one('#plusBtn');closePanels();openPanel('#findMenu',anchor);one('#findText').focus({preventScroll:true});});
function literalMatches(term){return requireEditorCore().findLiteral(term);}
one('#findNext').addEventListener('click',()=>{
  const term=one('#findText').value;
  if(!term||!requireEditorCore().findNext(term))showToast('Nenhuma ocorrência');
});
one('#replaceOne').addEventListener('click',()=>{
  const term=one('#findText').value;if(!term)return;
  const core=requireEditorCore();
  if(!core.selectionMatches(term)&&!core.findNext(term))return showToast('Nenhuma ocorrência');
  if(!core.selectionMatches(term))return;
  core.replaceSelection(one('#replaceText').value);
  core.findNext(term);
});
one('#replaceAll').addEventListener('click',()=>{
  const term=one('#findText').value,replace=one('#replaceText').value;
  const count=term?requireEditorCore().replaceAllLiteral(term,replace):0;
  showToast(count+' substituições');
});
function exportDocumentHTML(){
  return exportOverride?.html??requireEditorCore().html();
}
function exportName(ext){
  const sourceName=exportOverride?.name??docName.value;
  const base=sourceName.trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/^\.+|\.+$/g,"").slice(0,80);
  if(!base)throw new Error('Dê um nome ao documento antes de exportar');
  return base+"."+ext;
}
async function loadBotExportSource(selection){
  if(session!=='ready')throw new Error('A exportação selecionada exige uma sessão Telegram válida');
  const initData=getTg()?.initData;
  if(!initData)throw new Error('Sessão Telegram ausente');
  const res=await fetch(API+'/api/export/source',{
    method:'POST',
    signal:AbortSignal.timeout(20000),
    headers:{'content-type':'application/json'},
    body:JSON.stringify({initData,kind:selection.source,doc:selection.doc})
  });
  const data=await readResponse(res);
  if(!res.ok)throw new Error(data.error||'Não foi possível preparar a exportação selecionada');
  if(data.doc!==selection.doc||data.kind!==selection.source||typeof data.name!=='string'||typeof data.html!=='string')throw new Error('Resposta de exportação inválida');
  exportOverride={name:data.name||'MDTXTRT',html:data.html,kind:data.kind,doc:data.doc};
  closePanels();
  openPanel('#exportMenu',one('#exportBtn'));
  syncBackButton();
  queueMicrotask(()=>focusMenuControl(one('#exportTxtBtn')));
  showToast('Conteúdo selecionado. Escolha TXT ou Markdown.');
}

async function runBotLaunchAction(selection){
  if(!selection)return;
  if(selection.error)throw new Error(selection.error);
  if(session!=='ready')throw new Error('Reabra esta ação pelo chat privado do bot');
  if(selection.action==='send'){
    const loaded=await loadRemoteDraft(selection.doc);
    if(!loaded)throw new Error('O rascunho selecionado não foi encontrado');
    showToast('Rascunho selecionado. Enviando…');
    await publishTelegram();
    return;
  }
  if(selection.action==='export'){
    await loadBotExportSource(selection);
    return;
  }
  throw new Error('Ação do bot inválida');
}

async function exportFile(format) {
  try {
    const contract=FORMAT_CONTRACT.files[format];
    if(!contract?.export)throw new Error('Formato de exportação inválido');
    const html=exportDocumentHTML();
    const warning=conversionWarning(format,html);
    if(warning&&!await approve(warning))return;
    let content, type, ext;
    if (format === "md") {
      content = htmlToMarkdown(html);
      type = "text/markdown";
      ext = "md";
    } else {
      content = htmlToText(html);
      type = "text/plain";
      ext = "txt";
    }
    download(exportName(ext),content,type);
    showToast('Download iniciado');
    closePanels();
  } catch (err) {
    showToast(err.message||'Não foi possível exportar o arquivo');
  }
}
async function readResponse(res){
  try{return await res.json();}catch{throw new Error('A resposta do serviço não pôde ser lida');}
}
async function publishCurrent(){
  if(busy)return;
  busy=true;one('#exportBtn').disabled=true;
  try{if(dest==='telegram')await publishTelegram();else await publishTelegraph();}
  finally{busy=false;one('#exportBtn').disabled=false;}
}
async function publishTelegram(){
  if(!editor.childNodes.length){ showToast('Escreva algo antes de enviar'); return; }
  if(session!=='ready'){showToast('Abra pelo bot no Telegram');return;}
  if(activeHandoff&&handoffAction){
    await publishHandoff();
    return;
  }
  const initData=getTg().initData;
  try{
    const p=buildRich();
    const data=activeMedia();
    const localIds=[...editor.querySelectorAll('[data-media-id]')].map(node=>node.getAttribute('data-media-id'));
    if(localIds.some(id=>!mediaFiles.has(id)))throw new Error('Há mídia local que precisa ser anexada novamente');
    const form=new FormData();
    form.set('initData',initData);
    form.set('html',p.rich_message.html);
    form.set('draft',JSON.stringify(draftState()));
    for(const media of data)form.set('upload_'+media.id,media.file,media.file.name);
    const res=await fetch(API+'/api/telegram/send',{method:'POST',signal:AbortSignal.timeout(120000),body:form});
    const json=await readResponse(res);
    if(!res.ok)throw new Error(json.error||'Não foi possível enviar a mensagem');
    if(json.via!=='sendRichMessage'||!Number.isInteger(json.messageId)||json.messageId<=0)throw new Error('Resposta do Telegram inválida');
    remoteMediaSyncedIds=new Set(data.map(media=>media.id));
    showToast(Number.isInteger(json.previousMessageId)&&json.previousMessageId>0?'Nova versão enviada; a anterior foi preservada no chat':'Mensagem enviada no chat do bot');
  }catch(err){
    showToast(err.name==='TimeoutError'?'Tempo de envio esgotado. Confira o chat antes de tentar novamente.':err instanceof TypeError?'Não foi possível conectar ao Telegram':err.message || 'Não foi possível enviar a mensagem');
  }
}
async function publishTelegraph(){
  let payload;
  try{ payload = buildTelegraph(); }catch(err){ showToast(err.message); return; }
  const requestDoc=payload.doc,requestRevision=payload.revision;
  try{
    const res = await fetch(API+'/api/telegraph/publish', {
      method:'POST',signal:AbortSignal.timeout(60000),
      headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const result = await readResponse(res);
    if(!res.ok)throw new Error(result.error||'Não foi possível publicar no Telegraph');
    if(typeof result.path!=='string'||!result.path||typeof result.url!=='string'||!/^https:\/\//.test(result.url)||result.doc!==requestDoc||result.revision!==requestRevision)throw new Error('Resposta do Telegraph inválida');
    if(!requestMatchesDocument(requestDoc,requestRevision)){
      showToast('A página foi salva, mas o documento mudou durante a publicação; o resultado não foi aplicado ao documento atual');
      return;
    }
    telegraphPath=result.path;
    saveLocal();
    showToast('Página salva no Telegraph');
    if(session==='ready'&&typeof getTg()?.openLink==='function')getTg().openLink(result.url,{try_instant_view:true});
    else window.location.assign(result.url);
  }catch(err){ showToast(err.name==='TimeoutError'?'Tempo de publicação esgotado. Confira a página antes de tentar novamente.':err instanceof TypeError?'Não foi possível conectar ao Telegraph':err.message || 'Não foi possível publicar no Telegraph'); }
}
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0]; if(!file) return;
  try{
    if(!/\.(md|txt)$/i.test(file.name)) throw new Error('Escolha um arquivo Markdown ou TXT');
    const text = await file.text();
    const normalized=text.replace(/^\uFEFF/,'');
    const html = /\.md$/i.test(file.name) ? mdToBasicHTML(normalized) : '<p>'+escapeHTML(normalized).replace(/\n/g,'<br>')+'</p>';
    const nextName=file.name.replace(/\.(md|txt)$/i,'').slice(0,256);
    const priorMediaIds=[...mediaFiles.keys()];
    for(const id of priorMediaIds)await mediaDelete(id);
    clearRuntimeMedia();
    docName.value=nextName;
    if(!editorCore)throw new Error('Núcleo de edição indisponível');
    editorCore.resetHTML(html,{silent:true});
    importedMd=/\.md$/i.test(file.name)?normalized:'';
    importedTxt=/\.txt$/i.test(file.name)?normalized:'';
    importedHtml=requireEditorCore().html();
    telegraphPath='';docId=crypto.randomUUID();docRevision=0;savedRange=null;
    decorateSpecials();saveLocal();closePanels();syncEditorSelectionUI();
  }catch(err){ showToast(err.message || 'Não foi possível importar o arquivo'); }
  fileInput.value='';
});
let viewportFrame=0,inset=0;
function keyboardTarget(){
  return typingFocusActive();
}
function syncBrowserViewport(){
  const root=document.documentElement,viewport=window.visualViewport,bounds=visualViewportBounds();
  if(session==='ready'){
    const stable=Number(getTg()?.viewportStableHeight);
    root.style.setProperty('--vv-top','0px');
    root.style.setProperty('--vv-bottom','0px');
    root.style.setProperty('--vv-height',Number.isFinite(stable)&&stable>0?stable+'px':'var(--tg-viewport-stable-height,100dvh)');
    root.removeAttribute('data-keyboard');
    for(const sel of sheets){const panel=one(sel);if(panelIsOpen(panel))placePanel(panel);}
    const dialog=one('#dialogMenu');
    if(dialog?.matches(':popover-open'))placePanel(dialog);
    return;
  }
  const bottom=Math.max(0,root.clientHeight-bounds.top-bounds.height);
  inset=keyboardTarget()||inset>0?bottom:0;
  root.toggleAttribute('data-keyboard',inset>0);
  root.style.setProperty('--vv-top',bounds.top+'px');
  root.style.setProperty('--vv-bottom',inset+'px');
  root.style.setProperty('--vv-height',bounds.height+'px');
  for(const sel of sheets){const panel=one(sel);if(panelIsOpen(panel))placePanel(panel);}
  const dialog=one('#dialogMenu');
  if(dialog?.matches(':popover-open'))placePanel(dialog);
}
function scheduleBrowserViewport(){
  cancelAnimationFrame(viewportFrame);
  viewportFrame=requestAnimationFrame(syncBrowserViewport);
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',scheduleBrowserViewport);
  window.visualViewport.addEventListener('scroll',scheduleBrowserViewport);
}
window.addEventListener('resize',scheduleBrowserViewport);
document.addEventListener('focusin',scheduleBrowserViewport);
document.addEventListener('focusout',scheduleBrowserViewport);
syncBrowserViewport();
function boot(){
  const factory=window.MDTXTRTEditorCore?.createEditorCore;
  if(typeof factory!=='function')throw new Error('Núcleo de edição indisponível');
  editorCore=factory({
    element:editor,
    onChange:()=>{markDirty();restoreActiveMediaVisual();},
    onSelectionChange:()=>queueMicrotask(syncEditorSelectionUI)
  });

  let notice='',createdNew=false,preservedPrevious=false,loadedLocal=false;
  const requestedView=consumeLibraryView();
  const botLaunch=consumeBotLaunchAction();
  const requestedDoc=botLaunch?'':consumeLaunchDocument();
  const requestedDest=consumeLaunchDestination();
  const newToken=consumeNewDocumentToken();
  if(newToken){
    try{preservedPrevious=startRequestedNewDocument(newToken);createdNew=true;}
    catch(err){
      notice=err.message;
      try{loadedLocal=loadLocal();}catch(loadError){notice=notice+' '+(loadError.message||'');}
    }
  }else{
    try{loadedLocal=loadLocal();}catch(err){notice=err.message;}
  }
  setDestination(dest,false,false);syncEditorSelectionUI();
  if(createdNew){
    const persisted=saveLocal();
    notice=persisted
      ?(preservedPrevious?'Novo documento criado. O anterior foi preservado neste dispositivo.':'Novo documento criado.')
      :'Novo documento criado, mas não foi possível persistir o novo rascunho neste dispositivo.';
  }
  if(notice)showToast(notice);
  const recoverVolume=!createdNew&&!loadedLocal&&!handoffToken();
  if(recoverVolume)editor.setAttribute('contenteditable','false');
  void (async()=>{
    try{
      if(recoverVolume){
        try{
          const loaded=await loadRemoteDraft();
          if(loaded){
            setDestination(dest,false,false);
            syncEditorSelectionUI();
            showToast('Rascunho recuperado do volume persistente');
          }
        }catch(error){
          console.error('Persistent draft recovery',error);
          draftWriteBlocked=true;
          editor.setAttribute('contenteditable','false');
          showToast('Não foi possível recuperar a cópia persistente; edição bloqueada para não substituir um rascunho remoto');
        }finally{
          if(!draftWriteBlocked)editor.setAttribute('contenteditable','true');
        }
      }
      await restoreMedia();
      await verifyTelegram();
      if(botLaunch)await runBotLaunchAction(botLaunch);
      if(requestedDoc){
        const loaded=await loadRemoteDraft(requestedDoc);
        if(!loaded)throw new Error('O rascunho selecionado não foi encontrado para esta conta Telegram');
        showToast('Rascunho aberto');
      }
      if(requestedDest){
        setDestination(requestedDest,true,false);
        showToast('Destino: '+(requestedDest==='telegraph'?'Telegraph':'Telegram'));
      }
      if(requestedView)openLibrary(requestedView);
    }catch(err){showToast(err.message||'Não foi possível restaurar o documento');}
  })();
}
boot();
