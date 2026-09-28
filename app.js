const one=s=>document.querySelector(s);
const all=s=>Array.from(document.querySelectorAll(s));
const editor = one('#editor');
const docName = one('#docName');
const toast = one('#toast');
const toastTextHost = one('#toastTextHost');
if(!toast||!toastTextHost)throw new Error('Interface React incompleta: toast');
const toastText = document.createTextNode('');
toastTextHost.append(toastText);
const fileInput = one('#fileInput');
const STATE_VERSION=2;
let dest = 'telegram';
let session='browser',busy=false;
const plusSubmenus=['#plus-file-menu','#plus-format-menu','#plus-structure-menu','#plus-media-menu','#plus-interaction-menu'];
const sheets=['#plusMenu',...plusSubmenus,'#headingMenu','#quoteMenu','#listMenu','#exportMenu','#findMenu'];
let savedRange = null, editorCore = null, composing = false, saveTimer = null, telegraphPath = '', docId = crypto.randomUUID(), docRevision = 0, importedMd = '', importedTxt = '', importedHtml = '', mediaFile = null, mediaChoice = null, draftWriteBlocked = false, draftBlockNoticeShown = false, activeHandoff = '', handoffAction = null;
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
  window.location.reload();
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
function draftHTML(){
  const clone=editor.cloneNode(true);
  clone.querySelectorAll('[data-media-id]').forEach(node=>{if(/^blob:/i.test(node.getAttribute('src')||''))node.removeAttribute('src');});
  return clone.innerHTML;
}
function activeMedia(){
  const node=editor.querySelector('[data-media-id]');
  return node&&mediaFile&&node.getAttribute('data-media-id')===mediaFile.id?mediaFile:null;
}
function draftState(action=''){
  const active=activeMedia();
  const state={version:STATE_VERSION,name:docName.value,html:draftHTML(),dest,telegraphPath,docId,revision:docRevision,importedMd,importedTxt,importedHtml,media:active?{id:active.id,kind:active.kind}:null};
  if(action)state.action=action;
  return state;
}
function cleanDraftHTML(html){
  if(typeof html!=='string')throw new Error('Rascunho inválido');
  const box=document.createElement('div');box.innerHTML=html;
  const allowed=new Set('a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div'.split(' '));
  const attrs=new Set('href name class style src alt tg-spoiler start type reversed value checked disabled controls expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats data-media-id data-media-missing'.split(' '));
  const localMedia=[...box.querySelectorAll('[data-media-id]')];
  if(localMedia.length>1)throw new Error('O rascunho contém mais de um anexo local');
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
function restoreActiveMediaVisual(){
  if(!mediaFile?.id||!mediaFile.url)return false;
  if(editorCore)return editorCore.patchMedia(mediaFile.id,{src:mediaFile.url,'data-media-missing':''});
  const node=mediaNode(mediaFile.id);if(!node)return false;
  node.setAttribute('src',mediaFile.url);node.removeAttribute('data-media-missing');return true;
}
async function restoreMedia(){
  const node=editor.querySelector('[data-media-id]');
  if(!node)return;
  const id=node.getAttribute('data-media-id');
  try{
    const saved=await mediaLoad(id);
    if(!saved||saved.id!==id||!['image','video','audio','voice','document'].includes(saved.kind)||typeof saved.name!=='string'||!saved.name||typeof saved.type!=='string'||!saved.type||!(saved.file instanceof Blob))throw new Error('Anexo persistido incompatível');
    if(mediaFile?.url)URL.revokeObjectURL(mediaFile.url);
    const file=saved.file instanceof File?saved.file:new File([saved.file],saved.name,{type:saved.type,lastModified:Number.isFinite(saved.lastModified)?saved.lastModified:0});
    const url=URL.createObjectURL(file);
    mediaFile={file,id,kind:saved.kind,url};
    restoreActiveMediaVisual();
    decorateSpecials();
  }catch(err){
    try{await mediaClear();}catch(cleanupError){console.error('Media cleanup',cleanupError);}
    if(editorCore)editorCore.patchMedia(id,{src:'','data-media-missing':'true'});
    else{node.removeAttribute('src');node.setAttribute('data-media-missing','true');}
    showToast(err.message||'Não foi possível recuperar o anexo');
  }
}
async function installMedia(file,id,kind){
  if(mediaFile?.url)URL.revokeObjectURL(mediaFile.url);
  const url=URL.createObjectURL(file);
  mediaFile={file,id,kind,url};
  await mediaClear();
  await mediaStore({id,file,kind,name:file.name,type:file.type,lastModified:file.lastModified});
  const node=mediaNode(id);
  if(!node)throw new Error('Anexo não encontrado no documento');
  restoreActiveMediaVisual();
  decorateSpecials();
}
function decorateSpecials(){
  if(editorCore)return;
  editor.querySelectorAll('video,audio').forEach(node=>node.setAttribute('controls',''));
}
function handoffToken(){
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
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string')throw new Error('Rascunho transferido incompatível');
  const handoffHTML=cleanDraftHTML(d.html);if(editorCore)editorCore.resetHTML(handoffHTML,{silent:true});else editor.innerHTML=handoffHTML;docName.value=d.name;
  dest=d.dest;telegraphPath=d.telegraphPath;docId=d.docId;docRevision=normalizedRevision(d.revision);
  importedMd=d.importedMd;importedTxt=d.importedTxt;importedHtml=d.importedHtml;
  if(data.file){
    const fileRes=await fetch(API+'/api/handoff/file',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json'},body:JSON.stringify({initData,token})});
    if(!fileRes.ok)throw new Error('Não foi possível recuperar o anexo transferido');
    if(typeof data.file.name!=='string'||!data.file.name||typeof data.file.mime!=='string'||!data.file.mime||!['image','video','audio','voice','document'].includes(data.file.kind)||!/^[A-Za-z0-9_-]{1,64}$/.test(data.file.id))throw new Error('Metadados do anexo transferido inválidos');
    const blob=await fileRes.blob();
    const file=new File([blob],data.file.name,{type:data.file.mime,lastModified:Date.now()});
    await installMedia(file,data.file.id,data.file.kind);
  }else{
    if(mediaFile?.url)URL.revokeObjectURL(mediaFile.url);
    mediaFile=null;
    try{await mediaClear();}catch(error){console.error('Media cleanup',error);}
  }
  activeHandoff=token;
  handoffAction=normalizedHandoffAction(data.action);
  decorateSpecials();setDestination(dest,false,false);saveLocal();
  showToast(handoffActionNotice(handoffAction,true));
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
    const local=editor.querySelector('[data-media-id]');
    const active=activeMedia();
    if(local&&!active)throw new Error('O anexo local não pôde ser recuperado');
    const rich=buildRich();
    const form=new FormData();
    form.set('draft',JSON.stringify(draftState()));
    form.set('action',JSON.stringify({type:'publish',html:rich.rich_message.html,kind:active?.kind||'',id:active?.id||''}));
    if(active)form.set('upload',active.file,active.file.name);
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
const portraitQuery=matchMedia('(orientation: portrait)');
const telegramPhonePlatforms=new Set(['android','ios']);
const telegramInsetFields=['top','right','bottom','left'];
function validTelegramInsets(value){
  return value&&telegramInsetFields.every(field=>Number.isInteger(value[field])&&value[field]>=0);
}
function syncTelegramContentSafeArea(){
  const tg=getTg(),root=document.documentElement;
  if(typeof tg?.isVersionAtLeast!=='function'||!tg.isVersionAtLeast('8.0'))return false;
  if(!validTelegramInsets(tg.contentSafeAreaInset))return false;
  for(const field of telegramInsetFields){
    root.style.setProperty('--app-tg-content-safe-'+field,tg.contentSafeAreaInset[field]+'px');
  }
  root.classList.add('tg-shell');
  scheduleBrowserViewport();
  return true;
}
function handleTelegramContentSafeAreaChange(){
  if(!syncTelegramContentSafeArea())setDeviceGate('version');
}
function setDeviceGate(reason=''){
  const root=document.documentElement;
  const text=one('#deviceGateText');
  if(!reason){
    root.removeAttribute('data-device-gate');
    if(text)text.textContent='Este WebApp funciona apenas em smartphones no modo retrato. Gire o aparelho para continuar.';
    return;
  }
  root.setAttribute('data-device-gate',reason);
  if(!text)return;
  if(reason==='platform')text.textContent='Abra este WebApp no Telegram em um smartphone.';
  else if(reason==='version')text.textContent='Atualize o Telegram para uma versão compatível com bloqueio de orientação.';
  else text.textContent='Este WebApp funciona apenas em smartphones no modo retrato. Gire o aparelho para continuar.';
}
function syncDeviceContract(){
  if(session!=='ready')return;
  const tg=getTg();
  if(!telegramPhonePlatforms.has(tg.platform)){setDeviceGate('platform');return;}
  if(typeof tg.isVersionAtLeast!=='function'||!tg.isVersionAtLeast('8.0')||typeof tg.lockOrientation!=='function'||!syncTelegramContentSafeArea()){
    setDeviceGate('version');return;
  }
  if(!portraitQuery.matches){setDeviceGate('portrait');return;}
  setDeviceGate();
  if(!tg.isOrientationLocked)tg.lockOrientation();
}
function setupTelegram(){
  const tg=getTg();
  session='ready';
  document.body.classList.add('tg');
  tg.ready();
  tg.expand();
  applyScheme();
  if(!syncTelegramContentSafeArea()){setDeviceGate('version');return;}
  tg.onEvent('themeChanged',applyScheme);
  tg.onEvent('viewportChanged',scheduleBrowserViewport);
  tg.onEvent('contentSafeAreaChanged',handleTelegramContentSafeAreaChange);
  portraitQuery.addEventListener('change',syncDeviceContract);
  syncDeviceContract();
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
  if(openLabel)openLabel.textContent='Publicar no '+name;
  btn.setAttribute('aria-label', 'Destino: ' + name);
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
function hasOpenLayer(){
  return one('#dialogMenu').matches(':popover-open')||sheets.some(sel=>one(sel).matches(':popover-open'));
}
function syncBackButton(){
  if(session!=='ready')return;
  if(hasOpenLayer())getTg().BackButton.show();
  else getTg().BackButton.hide();
}
function closeTopLayer(){
  const dialog=one('#dialogMenu');
  if(dialog.matches(':popover-open')){finishDialog(dialogConfirm?false:null);return;}
  const sel=sheets.find(name=>one(name).matches(':popover-open'));
  if(sel)one(sel).hidePopover();
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function placePanel(panel,anchorRect=null){
  const anchorId=panel.dataset.anchor;
  if(!anchorId)return;
  const anchor=one('#'+anchorId);
  const rect=anchorRect||anchor?.getBoundingClientRect();
  if(!rect)return;
  const box=panel.getBoundingClientRect();
  const viewport=window.visualViewport;
  const vx=viewport?.offsetLeft||0,vy=viewport?.offsetTop||0;
  const vw=viewport?.width||window.innerWidth,vh=viewport?.height||window.innerHeight;
  const edge=8,gap=8;
  const left=clamp(rect.left+rect.width/2-box.width/2,vx+edge,vx+vw-box.width-edge);
  const above=rect.top-box.height-gap,below=rect.bottom+gap;
  const preference=panel.dataset.placement||'auto';
  let top=preference==='top'?above:(above>=vy+edge?above:below);
  if(top<vy+edge||top+box.height>vy+vh-edge){
    const alternate=top===above?below:above;
    if(alternate>=vy+edge&&alternate+box.height<=vy+vh-edge)top=alternate;
    else top=clamp(top,vy+edge,vy+vh-box.height-edge);
  }
  panel.style.setProperty('--menu-left',left+'px');
  panel.style.setProperty('--menu-top',top+'px');
}
function openPanel(sel){
  const panel=one(sel);
  if(!panel)throw new Error('Painel indisponível: '+sel);
  const anchor=panel.dataset.anchor?one('#'+panel.dataset.anchor):null;
  const anchorRect=anchor?.getBoundingClientRect()||null;
  panel.showPopover();
  placePanel(panel,anchorRect);
}
function openPlusSubmenu(key){
  const sel='#plus-'+key+'-menu';
  if(!plusSubmenus.includes(sel))throw new Error('Categoria indisponível');
  const root=one('#plusMenu');
  if(root.matches(':popover-open'))root.hidePopover();
  openPanel(sel);
}
function openPlusRoot(){
  for(const sel of plusSubmenus){
    const panel=one(sel);
    if(panel.matches(':popover-open'))panel.hidePopover();
  }
  openPanel('#plusMenu');
}
function closePanels(){
  for(const sel of sheets){
    const panel=one(sel);
    if(panel.matches(':popover-open'))panel.hidePopover();
  }
}
let dialogResolve=null,dialogConfirm=false;
function finishDialog(value){
  const resolve=dialogResolve;
  dialogResolve=null;
  const dialog=one('#dialogMenu');
  if(dialog.matches(':popover-open'))dialog.hidePopover();
  syncBackButton();
  if(resolve)resolve(value);
}
function dialogOpen(label,value='',rows=1,confirmMode=false){
  if(dialogResolve)finishDialog(null);
  closePanels();
  const dialog=one('#dialogMenu');
  const input=one('#dialogInput');
  one('#dialogLabel').textContent=label;
  dialogConfirm=confirmMode;
  input.hidden=confirmMode;
  input.value=confirmMode?'':String(value===null||value===undefined?'':value);
  input.rows=Math.max(1,Math.min(5,rows));
  one('#dialogOk').textContent=confirmMode?'Continuar':'OK';
  dialog.showPopover();
  syncBackButton();
  return new Promise(resolve=>{
    dialogResolve=resolve;
    if(!confirmMode){
      input.focus({preventScroll:true});
      if(rows===1)input.select();
    }
  });
}
function ask(label,value='',rows=1){return dialogOpen(label,value,rows,false);}
async function approve(label){return await dialogOpen(label,'',1,true)===true;}
one('#dialogOk').addEventListener('click',()=>finishDialog(dialogConfirm?true:one('#dialogInput').value));
one('#dialogCancel').addEventListener('click',()=>finishDialog(dialogConfirm?false:null));
one('#dialogInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&e.currentTarget.rows===1){e.preventDefault();finishDialog(e.currentTarget.value);}});
for(const sel of sheets){
  one(sel).addEventListener('toggle',event=>{
    if(event.newState==='open'){
      const list=event.currentTarget.querySelector('.menu-list');
      if(list)list.scrollTop=0;
      placePanel(event.currentTarget);
    }
    syncBackButton();
    document.dispatchEvent(new Event('selectionchange'));
  });
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&one('#dialogMenu').matches(':popover-open')){event.preventDefault();finishDialog(dialogConfirm?false:null);}});
function currentEditorCore(){return editorCore;}
function saveSel(){
  if(editorCore){savedRange=editorCore.captureSelection();return;}
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount)return;
  const n=sel.anchorNode;
  if(n&&editor.contains(n))savedRange=sel.getRangeAt(0).cloneRange();
}
function restoreSel(){
  if(editorCore){editorCore.restoreSelection();return;}
  editor.focus();
  const sel=window.getSelection();
  if(!sel)return;
  if(savedRange&&savedRange.startContainer&&editor.contains(savedRange.startContainer)&&editor.contains(savedRange.endContainer)){sel.removeAllRanges();sel.addRange(savedRange);return;}
  const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);sel.removeAllRanges();sel.addRange(range);
}
function pushHist(){if(editorCore)editorCore.syncFromDOM({addToHistory:true});}
function histUndo(){if(editorCore&&editorCore.undo()){restoreActiveMediaVisual();syncEditorSelectionUI();}}
function histRedo(){if(editorCore&&editorCore.redo()){restoreActiveMediaVisual();syncEditorSelectionUI();}}
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
  if(kind==='task')return insertHTML('<ul><li><input type="checkbox">Nova tarefa</li></ul>',true);
  if(kind==='ordered')return toggleList('ol');
  if(kind==='divider')return insertHTML('<hr/>',true);
  if(kind==='table'){
    const caption=await ask('Legenda da tabela','');
    if(caption===null)return;
    return insertHTML('<table bordered striped compact>'+(caption?'<caption>'+escapeHTML(caption)+'</caption>':'')+'<tr><th>A</th><th>B</th></tr><tr><td>—</td><td>—</td></tr></table>',true);
  }
  if(kind==='expandquote')return insertHTML('<blockquote expandable>Citação expansível</blockquote>',true);
  if(kind==='pullquote')return insertHTML('<aside>Citação em destaque</aside>',true);
  if(kind==='details')return insertHTML('<details open><summary>Conteúdo</summary><p>Texto expansível</p></details>',true);
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
  bumpDocumentRevision();
  decorateSpecials();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 400);
}
window.addEventListener('pagehide',saveLocal);
function saveLocal(){
  clearTimeout(saveTimer);
  if(draftWriteBlocked){
    if(!draftBlockNoticeShown){draftBlockNoticeShown=true;showToast('O rascunho recuperável foi preservado; alterações desta sessão não substituirão essa cópia');}
    return false;
  }
  try{localStorage.setItem(DRAFT_KEY,JSON.stringify(draftState()));return true;}
  catch{showToast('Não foi possível salvar neste dispositivo');return false;}
}
function loadLocal(){
  let raw;
  try{raw=localStorage.getItem(DRAFT_KEY);}
  catch{draftWriteBlocked=true;throw new Error('Não foi possível acessar o rascunho local; nenhuma cópia foi alterada');}
  if(raw===null)return;
  let d;
  try{d=JSON.parse(raw);}
  catch{draftWriteBlocked=true;throw new Error('Rascunho local inválido preservado para recuperação');}
  if(!d||d.version!==STATE_VERSION||typeof d.html!=='string'||typeof d.name!=='string'||d.name.length>120||!['telegram','telegraph'].includes(d.dest)||typeof d.telegraphPath!=='string'||!/^[a-f0-9-]{36}$/i.test(d.docId)||(d.revision!==undefined&&(!Number.isSafeInteger(d.revision)||d.revision<0))||typeof d.importedMd!=='string'||typeof d.importedTxt!=='string'||typeof d.importedHtml!=='string'){
    draftWriteBlocked=true;
    throw new Error('Rascunho local incompatível preservado para recuperação');
  }
  let html;
  try{html=cleanDraftHTML(d.html);}
  catch(error){draftWriteBlocked=true;throw new Error((error.message||'Rascunho local inválido')+'. A cópia local foi preservada para recuperação');}
  editor.innerHTML=html;docName.value=d.name;telegraphPath=d.telegraphPath;docId=d.docId;docRevision=normalizedRevision(d.revision);importedMd=d.importedMd;importedTxt=d.importedTxt;importedHtml=d.importedHtml;dest=d.dest;
  draftWriteBlocked=false;
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
function txtLosesStructure(){return Boolean(editor.querySelector('h1,h2,h3,h4,h5,h6,strong,b,em,i,u,ins,s,strike,del,code,mark,sub,sup,tg-spoiler,tg-reference,tg-emoji,tg-time,tg-math,tg-math-block,hr,ul,ol,li,blockquote,aside,footer,table,details,summary,a[href],figure,figcaption,input'))||Boolean(editor.querySelector('.tg-footer,blockquote[expandable]'));}
function htmlToMarkdown(html){
  if(importedMd && editor.innerHTML === importedHtml) return importedMd;
  if(editor.querySelector('[data-media-id]')) throw new Error('Anexos locais precisam de URL pública para exportar Markdown');
  if(!window.TurndownService) throw new Error('Conversão Markdown indisponível');
  const svc = new TurndownService({headingStyle:'atx', codeBlockStyle:'fenced', bulletListMarker:'-', emDelimiter:'*'});
  svc.addRule('special', {filter: node => ['TG-SPOILER','TG-REFERENCE','TG-EMOJI','TG-TIME','TG-MATH','TG-MATH-BLOCK','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-BUTTON','TG-BUTTON-ROW','DETAILS','TABLE','FIGURE','ASIDE','FOOTER','SUB','SUP','MARK','U','INPUT','IFRAME','VIDEO','AUDIO'].includes(node.nodeName) || node.nodeName==='BLOCKQUOTE' && node.hasAttribute('expandable') || node.classList?.contains('tg-footer') || node.nodeName === 'A' && node.hasAttribute('name'), replacement: (_,node)=>['DETAILS','TABLE','FIGURE','ASIDE','FOOTER','IFRAME','VIDEO','AUDIO','BLOCKQUOTE','TG-MAP','TG-COLLAGE','TG-SLIDESHOW','TG-DOCUMENT','TG-MATH-BLOCK','TG-BUTTON-ROW','P'].includes(node.nodeName)?'\n\n'+node.outerHTML+'\n\n':node.outerHTML});
  return svc.turndown(html);

}
function mdToBasicHTML(md){
  if(!window.marked) throw new Error('Importação Markdown indisponível');
  const box = document.createElement('div');
  box.innerHTML = window.marked.parse(md, {gfm:true, breaks:false});
  const allowed = new Set('a b strong i em u ins s strike del code mark sub sup tg-spoiler tg-reference tg-emoji tg-time tg-math h1 h2 h3 h4 h5 h6 p pre footer hr ul ol li input blockquote aside cite img video audio tg-document figure figcaption iframe tg-map tg-collage tg-slideshow table caption thead tbody tfoot tr th td details summary tg-math-block tg-button tg-button-row br div'.split(' '));
  const attrs = new Set('href name class style src alt tg-spoiler start type reversed value checked disabled expandable unix format emoji-id lat long zoom width height bordered striped compact colspan rowspan align valign open url data query text forward-text request-write-access allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats'.split(' '));
  for(const el of box.querySelectorAll('*')){
    const tag = el.localName;
    if(!allowed.has(tag)) throw new Error('Elemento Markdown não suportado: '+tag);
    for(const a of [...el.attributes]) {
      if(!attrs.has(a.name) || a.name==='class' && !(tag==='code'&&/^language-[a-z0-9+-]+$/i.test(a.value)||['p','footer'].includes(tag)&&a.value==='tg-footer') || a.name==='style' && !(tag==='tg-button'&&['link','primary','success','danger'].includes(a.value))) throw new Error('Atributo Markdown não suportado: '+a.name);
      if(['src','href','url'].includes(a.name) && !/^(https?:|mailto:|tel:|tg:|#)/i.test(a.value)) throw new Error('Link Markdown inválido');
    }
    if(tag==='input'&&el.getAttribute('type')==='checkbox')el.removeAttribute('disabled');
      }
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
function markdownCaret(target,offset=null){
  const sel=window.getSelection();
  if(!sel)return;
  const range=document.createRange();
  if(offset===null){range.selectNodeContents(target);range.collapse(true);}
  else range.setStart(target,offset),range.collapse(true);
  sel.removeAllRanges();sel.addRange(range);savedRange=range.cloneRange();
}
function markdownCaretAtTextOffset(target,offset){
  const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);
  let left=Math.max(0,offset),node;
  while((node=walker.nextNode())){
    if(left<=node.length){markdownCaret(node,left);return;}
    left-=node.length;
  }
  const sel=window.getSelection();
  if(!sel)return;
  const range=document.createRange();
  range.selectNodeContents(target);range.collapse(false);
  sel.removeAllRanges();sel.addRange(range);savedRange=range.cloneRange();
}
function editorSelectionElement(){
  const node=window.getSelection()?.anchorNode;
  return node&&(node.nodeType===1?node:node.parentElement);
}
function editorTopLevelBlock(){
  let el=editorSelectionElement();
  while(el&&el!==editor){
    if(el.parentElement===editor&&el.matches('p,div,h1,h2,h3,h4,h5,h6,blockquote,footer,aside,ul,ol'))return el;
    el=el.parentElement;
  }
  return null;
}
function editorBlockKind(block=editorTopLevelBlock()){
  if(!block)return 'p';
  if(block.classList?.contains('tg-footer')||block.tagName==='FOOTER')return 'footer';
  if(['UL','OL'].includes(block.tagName))return 'p';
  return block.tagName.toLowerCase();
}
function markdownBlockContext(){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount||!sel.isCollapsed)return null;
  let range=sel.getRangeAt(0),node=range.startContainer;
  if(!node||!editor.contains(node))return null;
  if(node.nodeType===3&&node.parentNode===editor){
    normalizeBlocks();
    const current=window.getSelection();
    if(!current||!current.rangeCount)return null;
    range=current.getRangeAt(0);node=range.startContainer;
  }
  const block=editorTopLevelBlock();
  if(!block||!['P','DIV'].includes(block.tagName))return null;
  const prefixRange=document.createRange();
  prefixRange.selectNodeContents(block);
  try{prefixRange.setEnd(range.startContainer,range.startOffset);}catch{return null;}
  const normalize=s=>s.replace(/\u00a0/g,' ');
  return {block,prefix:normalize(prefixRange.toString()),text:normalize(block.textContent||'')};
}
const markdownEscapedBlocks=new WeakSet();
function markdownBlockRule(){
  const ctx=markdownBlockContext();
  if(!ctx)return false;
  const {block,prefix,text}=ctx;
  const deletePrefix=count=>{
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
    let left=count,node=walker.nextNode();
    while(node&&left>0){
      const take=Math.min(left,node.length);
      node.deleteData(0,take);left-=take;
      node=walker.nextNode();
    }
  };
  const literal=/^(#{1,6}|>|[-*+]|\d+\.) /.test(text);
  if(markdownEscapedBlocks.has(block)){
    if(literal)return false;
    markdownEscapedBlocks.delete(block);
  }
  const escaped=prefix.match(/^\\(#{1,6}|>|[-*+]|\d+\.) $/);
  if(escaped){
    deletePrefix(1);markdownEscapedBlocks.add(block);
    const textNode=document.createTreeWalker(block,NodeFilter.SHOW_TEXT).nextNode();
    if(textNode)markdownCaret(textNode,Math.min(textNode.length,prefix.length-1));
    return true;
  }
  const replaceBlock=(tag,markerLength,{start=null,task=null}={})=>{
    if(prefix.length<markerLength)return false;
    const caretOffset=Math.max(0,prefix.length-markerLength);
    deletePrefix(markerLength);
    if(tag==='ul'||tag==='ol'){
      const list=document.createElement(tag);
      if(tag==='ol'&&start!==null&&start!==1)list.setAttribute('start',String(start));
      const li=document.createElement('li');
      if(task!==null){
        const input=document.createElement('input');input.type='checkbox';
        if(task){input.checked=true;input.setAttribute('checked','');}
        li.append(input);
      }
      while(block.firstChild)li.append(block.firstChild);
      if(!li.childNodes.length)li.append(document.createElement('br'));
      list.append(li);block.replaceWith(list);
      markdownCaretAtTextOffset(li,caretOffset);
      return true;
    }
    const next=document.createElement(tag);
    while(block.firstChild)next.append(block.firstChild);
    if(!next.childNodes.length)next.append(document.createElement('br'));
    block.replaceWith(next);markdownCaretAtTextOffset(next,caretOffset);return true;
  };
  const task=dest==='telegram'&&text.match(/^- \[([ xX])\] (?=\S)/);
  if(task)return replaceBlock('ul',task[0].length,{task:task[1].toLowerCase()==='x'});
  const heading=text.match(/^(#{1,6}) (?=\S)/);
  if(heading)return replaceBlock('h'+heading[1].length,heading[0].length);
  const quote=text.match(/^> (?=\S)/);
  if(quote)return replaceBlock('blockquote',quote[0].length);
  const bullet=text.match(/^[-*+] (?=\S)/);
  if(bullet)return replaceBlock('ul',bullet[0].length);
  const ordered=text.match(/^(\d+)\. (?=\S)/);
  if(ordered)return replaceBlock('ol',ordered[0].length,{start:Number(ordered[1])});
  return false;
}
function markdownInlineWrap(textNode,offset,marker,tag,{single=false}={}){
  const text=textNode.data,before=text.slice(0,offset);
  if(!before.endsWith(marker))return false;
  const bodyEnd=offset-marker.length,beforeClose=text.slice(0,bodyEnd);
  const open=beforeClose.lastIndexOf(marker);
  if(open<0)return false;
  if(single&&(text[open-1]===marker||text[open+1]===marker||text[bodyEnd-1]===marker))return false;
  const value=text.slice(open+marker.length,bodyEnd);
  if(!value||value.includes('\n'))return false;
  if(text[open-1]==='\\'){
    textNode.deleteData(open-1,1);markdownCaret(textNode,offset-1);return true;
  }
  const range=document.createRange();
  range.setStart(textNode,open);range.setEnd(textNode,offset);range.deleteContents();
  const mark=document.createElement(tag);mark.textContent=value;range.insertNode(mark);
  const sel=window.getSelection();range.setStartAfter(mark);range.collapse(true);sel.removeAllRanges();sel.addRange(range);savedRange=range.cloneRange();
  return true;
}
function markdownInlineRule(){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount||!sel.isCollapsed)return false;
  const text=sel.anchorNode;
  if(!text||text.nodeType!==3||!editor.contains(text))return false;
  const parent=text.parentElement;
  if(parent?.closest('a,strong,b,em,i,s,strike,del,code,pre,tg-math,tg-math-block'))return false;
  const offset=sel.anchorOffset;
  return markdownInlineWrap(text,offset,'**','strong')||
    markdownInlineWrap(text,offset,'~~','s')||
    markdownInlineWrap(text,offset,'`','code')||
    markdownInlineWrap(text,offset,'*','em',{single:true});
}
function applyMarkdownInputRule(){
  return markdownBlockRule()||markdownInlineRule();
}
function blockIsEmpty(block){
  return !String(block?.textContent||'').replace(/\u200b/g,'').trim()&&!block?.querySelector('img,video,audio,iframe,input,tg-button,tg-map,hr');
}
function normalizeEmptyFormattedBlock(event){
  if(!String(event?.inputType||'').startsWith('delete'))return false;
  const block=editorTopLevelBlock();
  if(!block||!(/H[1-6]/.test(block.tagName)||block.tagName==='BLOCKQUOTE')||!blockIsEmpty(block))return false;
  const p=document.createElement('p');p.append(document.createElement('br'));block.replaceWith(p);markdownCaret(p);
  return true;
}
function fragmentHasContent(fragment){
  return Boolean(fragment.textContent?.trim()||fragment.querySelector?.('img,video,audio,iframe,input,tg-button,tg-map,hr'));
}
function exitFormattedBlockOnParagraph(event){
  if(composing||event.inputType!=='insertParagraph')return;
  const sel=window.getSelection(),block=editorTopLevelBlock();
  if(!sel||!sel.rangeCount||!sel.isCollapsed||!block||!(/H[1-6]/.test(block.tagName)||block.tagName==='BLOCKQUOTE'))return;
  if(block.tagName==='BLOCKQUOTE'&&block.querySelector(':scope > p,:scope > div,:scope > blockquote'))return;
  const caret=sel.getRangeAt(0),before=document.createRange();
  before.selectNodeContents(block);
  try{before.setEnd(caret.startContainer,caret.startOffset);}catch{return;}
  event.preventDefault();
  const p=document.createElement('p');
  if(!fragmentHasContent(before.cloneContents())){
    p.append(document.createElement('br'));block.before(p);
  }else{
    const tail=document.createRange();tail.selectNodeContents(block);tail.setStart(caret.startContainer,caret.startOffset);
    const content=tail.extractContents();
    if(fragmentHasContent(content))p.append(content);else p.append(document.createElement('br'));
    block.after(p);
  }
  markdownCaret(p);
  if(editorCore)editorCore.syncFromDOM({addToHistory:true});
  syncEditorSelectionUI();
}
function commitEditorInput(event){
  const transformed=applyMarkdownInputRule();
  const normalized=normalizeEmptyFormattedBlock(event);
  if(editorCore)editorCore.syncFromDOM({addToHistory:true});
  if(transformed||normalized)syncEditorSelectionUI();
}
editor.addEventListener('beforeinput',exitFormattedBlockOnParagraph);
editor.addEventListener('input', event=>{ if(!composing)commitEditorInput(event); });
editor.addEventListener('change',e=>{if(e.target.matches('input[type=checkbox]')){e.target.toggleAttribute('checked',e.target.checked);editorCore?.syncFromDOM({addToHistory:true});syncEditorSelectionUI();}});
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
  saveSel();
  const kind=editorCore?editorCore.currentBlockKind():editorBlockKind();
  all('#typebar [data-cmd]').forEach(btn=>toggleToolbarState(btn,Boolean(editorCore&&editorCore.activeMark(btn.dataset.cmd))));
  toggleToolbarState(one('#listBtn'),Boolean(editorCore&&['li'].includes(kind))||one('#listMenu').matches(':popover-open'));
  toggleToolbarState(one('#quoteBtn'),kind==='blockquote'||kind==='aside'||one('#quoteMenu')?.matches(':popover-open'));
  toggleToolbarState(one('#headingBtn'),/^(h[1-6]|footer)$/.test(kind)||one('#headingMenu')?.matches(':popover-open'));
  toggleToolbarState(one('#linkBtn'),Boolean(editorCore?.linkHref()));
  one('#plusBtn')?.classList.toggle('on',one('#plusMenu')?.matches(':popover-open')||plusSubmenus.some(sel=>one(sel).matches(':popover-open')));
  all('#headingMenu [data-block]').forEach(btn=>btn.classList.toggle('is-current',btn.dataset.block===kind));
}
document.addEventListener('selectionchange',syncEditorSelectionUI);
one('#typebar').addEventListener('mousedown', e => e.preventDefault());
all('#typebar [data-cmd], [data-plus-submenu] [data-cmd], #listMenu [data-cmd]').forEach(btn => btn.addEventListener('click', ()=>{try{exec(btn.dataset.cmd);closePanels();}catch(err){showToast(err.message);}}));
all('#typebar [data-block], #headingMenu [data-block], #quoteMenu [data-block]').forEach(btn => btn.addEventListener('click', ()=>{try{formatBlock(btn.dataset.block);}catch(err){showToast(err.message);}}));
document.querySelectorAll('[data-plus-submenu] [data-insert], #quoteMenu [data-insert], #listMenu [data-insert]').forEach(btn => btn.addEventListener('click', ()=>{void insertFeature(btn.dataset.insert).catch(err=>showToast(err.message));}));
all('#plusMenu [data-plus-category]').forEach(btn=>btn.addEventListener('click',()=>openPlusSubmenu(btn.dataset.plusCategory)));
all('[data-plus-submenu] [data-plus-back]').forEach(btn=>btn.addEventListener('click',()=>openPlusRoot()));
one('#linkBtn').addEventListener('click',async()=>{
  restoreSel();editorCore?.expandWord();
  const current=editorCore?.linkHref()||'https://';
  const value=await ask('Link',current);
  if(value===null||!value.trim())return;
  let url;
  try{
    url=new URL(value.trim(),location.href);
    const protocols=dest==='telegraph'?['http:','https:']:['http:','https:','mailto:','tel:','tg:'];
    if(!protocols.includes(url.protocol))throw new Error(dest==='telegraph'?'O Telegraph exige link HTTP ou HTTPS':'Use um link válido');
  }catch(err){showToast(err.message||'Link inválido');return;}
  try{
    restoreSel();
    if(editorCore?.selectionEmpty())insertHTML('<a href="'+escapeHTML(url.href)+'">'+escapeHTML(value.trim())+'</a>');
    else exec('createLink',url.href);
  }catch(err){showToast(err.message||'Não foi possível criar o link');}
});
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
one('#undoBtn').addEventListener('mousedown', e => e.preventDefault());
one('#redoBtn').addEventListener('mousedown', e => e.preventDefault());
one('#themeBtn').addEventListener('click',()=>setTheme(document.documentElement.classList.contains('light')?'dark':'light'));
one('#openAppBtn').addEventListener('click',()=>{if(dest==='telegram')void openMiniApp();else void publishCurrent();});
one('#destBtn').addEventListener('click', ()=>setDestination(dest === 'telegram' ? 'telegraph' : 'telegram'));
one('#exportBtn').addEventListener('click', e=>{
  if(session==='pending'){showToast('Aguarde a validação da sessão Telegram');return;}
  if(session==='invalid'){showToast('Sessão inválida ou expirada. Reabra o Mini App.');return;}
  if(session==='ready')return publishCurrent();
  openPanel('#exportMenu');
});
docName.addEventListener('input',markDirty);
one('#importMdBtn').addEventListener('click', ()=>{ fileInput.accept='.md,text/markdown'; fileInput.click(); closePanels(); });
one('#importTxtBtn').addEventListener('click', ()=>{ fileInput.accept='.txt,text/plain'; fileInput.click(); closePanels(); });
one('#exportTxtBtn').addEventListener('click', ()=>exportFile('txt'));
one('#exportMdBtn').addEventListener('click', ()=>exportFile('md'));
one('#mediaBtn').addEventListener('click',()=>{mediaChoice=null;one('#mediaInput').accept='image/*,video/*,audio/*,.pdf,.zip';one('#mediaInput').click();closePanels();});
one('#voiceBtn').addEventListener('click',()=>{mediaChoice='voice';one('#mediaInput').accept='audio/*,.ogg,.oga,.opus';one('#mediaInput').click();closePanels();});
one('#mediaInput').addEventListener('change',async()=>{
  const file=one('#mediaInput').files?.[0];if(!file){mediaChoice=null;return;}
  one('#mediaInput').value='';
  if(file.size>20_000_000){mediaChoice=null;showToast('Arquivo acima de 20 MB');return;}
  if(editor.querySelector('[data-media-id]')){mediaChoice=null;showToast('Há um anexo no documento. Remova-o antes de anexar outro.');return;}
  let kind=mediaChoice;
  mediaChoice=null;
  if(kind==='voice'&&!file.type.startsWith('audio/')){showToast('Escolha um arquivo de áudio para a mensagem de voz');return;}
  if(!kind)kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'document';
  const id=crypto.randomUUID().replace(/-/g,'');
  const tag={image:'img',video:'video',audio:'audio',voice:'audio',document:'tg-document'}[kind];
  try{
    insertHTML('<figure><'+tag+' data-media-id="'+id+'"></'+tag+'><figcaption>'+escapeHTML(file.name)+'</figcaption></figure>',true);
    await installMedia(file,id,kind);saveLocal();
  }catch(err){
    mediaNode(id)?.closest('figure')?.remove();
    showToast(err.message||'Não foi possível salvar o anexo');
  }
});
one('#findBtn').addEventListener('click', ()=>{closePanels();openPanel('#findMenu');});
function literalMatches(term){return editorCore?editorCore.findLiteral(term):[];}
one('#findNext').addEventListener('click',()=>{
  const term=one('#findText').value;
  if(!term||!editorCore?.findNext(term))showToast('Nenhuma ocorrência');
});
one('#replaceOne').addEventListener('click',()=>{
  const term=one('#findText').value;if(!term||!editorCore)return;
  if(!editorCore.selectionMatches(term)&&!editorCore.findNext(term))return showToast('Nenhuma ocorrência');
  if(!editorCore.selectionMatches(term))return;
  editorCore.replaceSelection(one('#replaceText').value);
  editorCore.findNext(term);
});
one('#replaceAll').addEventListener('click',()=>{
  const term=one('#findText').value,replace=one('#replaceText').value;
  const count=term&&editorCore?editorCore.replaceAllLiteral(term,replace):0;
  showToast(count+' substituições');
});
function exportName(ext){
  const base=docName.value.trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/^\.+|\.+$/g,"").slice(0,80);
  if(!base)throw new Error('Dê um nome ao documento antes de exportar');
  return base+"."+ext;
}
async function exportFile(format) {
  try {
    if(format!=='md'&&format!=='txt')throw new Error('Formato de exportação inválido');
    let content, type, ext;
    if (format === "md") {
      content = htmlToMarkdown(editor.innerHTML);
      type = "text/markdown";
      ext = "md";
    } else {
      if(txtLosesStructure()&&!await approve('TXT não preserva formatação nem estrutura. Exportar como texto simples?'))return;
      content = htmlToText(editor.innerHTML);
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
    const p = buildRich();
    const data=activeMedia();
    if(editor.querySelector('[data-media-id]')&&!data)throw new Error('Anexe a mídia novamente antes de publicar');
    const form=new FormData();
    form.set('initData',initData);
    form.set('html',p.rich_message.html);
    if(data){form.set('kind',data.kind);form.set('id',data.id);form.set('upload',data.file,data.file.name);}
    const res=await fetch(API+'/api/telegram/send',{method:'POST',signal:AbortSignal.timeout(60000),body:form});
    const json=await readResponse(res);
    if(!res.ok)throw new Error(json.error||'Não foi possível enviar a mensagem');
    if(json.via!=='sendRichMessage'||!Number.isInteger(json.messageId)||json.messageId<=0)throw new Error('Resposta do Telegram inválida');
    showToast('Mensagem enviada no chat do bot');
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
    const nextName=file.name.replace(/\.(md|txt)$/i,'').slice(0,120);
    const hadLocalMedia=Boolean(mediaFile||editor.querySelector('[data-media-id]'));
    if(hadLocalMedia)await mediaClear();
    if(mediaFile?.url)URL.revokeObjectURL(mediaFile.url);
    mediaFile=null;
    docName.value=nextName;
    if(!editorCore)throw new Error('Núcleo de edição indisponível');
    editorCore.resetHTML(html,{silent:true});
    importedMd=/\.md$/i.test(file.name)?normalized:'';
    importedTxt=/\.txt$/i.test(file.name)?normalized:'';
    importedHtml=editor.innerHTML;
    telegraphPath='';docId=crypto.randomUUID();docRevision=0;savedRange=null;
    decorateSpecials();saveLocal();closePanels();syncEditorSelectionUI();
  }catch(err){ showToast(err.message || 'Não foi possível importar o arquivo'); }
  fileInput.value='';
});
let viewportFrame=0,inset=0;
function keyboardTarget(){
  const active=document.activeElement;
  return active===editor||active===docName||active===one('#dialogInput')||active===one('#findText')||active===one('#replaceText');
}
function syncBrowserViewport(){
  const root=document.documentElement,viewport=window.visualViewport;
  const top=viewport?Math.max(0,viewport.offsetTop):0;
  const height=viewport?viewport.height:root.clientHeight;
  const bottom=Math.max(0,root.clientHeight-top-height);
  inset=keyboardTarget()||inset>0?bottom:0;
  root.toggleAttribute('data-keyboard',inset>0);
  root.style.setProperty('--vv-top',top+'px');
  root.style.setProperty('--vv-bottom',inset+'px');
  root.style.setProperty('--vv-height',Math.max(0,root.clientHeight-top-inset)+'px');
  for(const sel of sheets){const panel=one(sel);if(panel?.matches(':popover-open'))placePanel(panel);}
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
  let notice='';
  try{loadLocal();}catch(err){notice=err.message;}
  decorateSpecials();
  const factory=window.MDTXTRTEditorCore?.createEditorCore;
  if(typeof factory!=='function')throw new Error('Núcleo de edição indisponível');
  editorCore=factory({
    element:editor,
    onChange:()=>{markDirty();restoreActiveMediaVisual();},
    onSelectionChange:()=>queueMicrotask(syncEditorSelectionUI)
  });
  setDestination(dest,false,false);syncEditorSelectionUI();
  if(notice)showToast(notice);
  void restoreMedia().then(()=>verifyTelegram()).catch(err=>showToast(err.message||'Não foi possível restaurar o documento'));
}
boot();
