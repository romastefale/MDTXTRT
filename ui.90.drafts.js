(function(){
const tg=window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
const editor=document.getElementById('editor');
const titleInput=document.getElementById('inpTitle');
if(!editor)return;
const CACHE_KEY='mdtxtrt_draft',TITLE_KEY='mdtxtrt_title';
let lastSent=null,saveTimer=null,lastSavedAt=null,saving=false;
let autosaveEl=document.getElementById('autosaveStatus');
if(!autosaveEl){autosaveEl=document.createElement('span');autosaveEl.id='autosaveStatus';autosaveEl.setAttribute('aria-live','polite');autosaveEl.style.cssText='grid-column:4;justify-self:end;max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--muted);text-align:right';const brand=document.querySelector('.brand');if(brand)brand.appendChild(autosaveEl)}
function initData(){return tg?String(tg.initData||'').trim():''}
function state(){return{content:String(editor.value||''),title:titleInput?String(titleInput.value||''):''}}
function signature(value){return JSON.stringify([value.content,value.title])}
function cache(value){try{localStorage.setItem(CACHE_KEY,value.content);localStorage.setItem(TITLE_KEY,value.title)}catch(e){}return value}
function stamp(ts){if(!ts)return'';const d=new Date(Number(ts)*1000),now=new Date();const time=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});if(d.toDateString()===now.toDateString())return time;return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' '+time}
function paintAutosave(pending){if(!autosaveEl)return;if(saving){autosaveEl.textContent=lastSavedAt?'salvando… · último '+stamp(lastSavedAt):'salvando…';return}if(lastSavedAt){autosaveEl.textContent=(pending?'alterado · último autosave ':'último autosave ')+stamp(lastSavedAt);return}autosaveEl.textContent=pending?'autosave pendente':'autosave aguardando'}
async function request(endpoint,payload,keepalive){const auth=initData();if(!auth)return null;const body=JSON.stringify(Object.assign({init_data:auth},payload||{}));const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'tma '+auth,'X-Telegram-Init-Data':auth},body,keepalive:!!keepalive});const json=await response.json().catch(()=>({}));if(!response.ok||json.ok===false)throw new Error(json.error||('HTTP '+response.status));return json}
async function saveNow(keepalive){const auth=initData();const current=cache(state()),sig=signature(current);if(!auth){paintAutosave(sig!==lastSent);return}if(sig===lastSent){paintAutosave(false);return}saving=true;paintAutosave(true);try{const saved=await request('/api/draft/save',current,keepalive);if(saved){const confirmed={content:String(saved.content||''),title:String(saved.title||'')};lastSent=signature(confirmed);lastSavedAt=Number(saved.updated_at)||Math.floor(Date.now()/1000)}}catch(error){console.warn('draft save',error)}finally{saving=false;paintAutosave(signature(state())!==lastSent)}}
function scheduleSave(){clearTimeout(saveTimer);paintAutosave(true);saveTimer=setTimeout(()=>saveNow(false),700)}
editor.addEventListener('input',()=>{cache(state());scheduleSave()});
if(titleInput)titleInput.addEventListener('input',()=>{cache(state());scheduleSave()});
setInterval(()=>{const current=cache(state()),sig=signature(current);if(sig!==lastSent)scheduleSave();else paintAutosave(false)},1200);
async function loadDraft(){const local=cache(state());if(!initData()){paintAutosave(signature(local)!==lastSent);return}try{const remote=await request('/api/draft/load',{},false);if(!remote)return;if(remote.updated_at!==null&&remote.updated_at!==undefined){editor.value=String(remote.content||'');if(titleInput)titleInput.value=String(remote.title||'');const restored=cache(state());lastSent=signature(restored);lastSavedAt=Number(remote.updated_at)||null;paintAutosave(false);return}if(local.content||local.title){await saveNow(false)}else{lastSent=signature(local);paintAutosave(false)}}catch(error){console.warn('draft load',error);paintAutosave(signature(state())!==lastSent)}}
window.addEventListener('pagehide',()=>{clearTimeout(saveTimer);saveNow(true)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(saveTimer);saveNow(true)}});
loadDraft();
})();
