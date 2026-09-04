(function(){
const tg=window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
const editor=document.getElementById('editor');
if(!editor)return;
const CACHE_KEY='mdtxtrt_draft';
const LOCAL_MEDIA=/!\[[^\]\r\n]*\]\(\s*mdtxtrt:\/\/(?:media|photo|video|audio|voice|animation|document)\/[A-Za-z0-9_-]+(?:\s+"[^"\r\n]*")?\s*\)/gi;
let lastSent=null,saveTimer=null;
function durable(value){return String(value||'').replace(LOCAL_MEDIA,'')}
function initData(){return tg?String(tg.initData||'').trim():''}
function cache(text){try{localStorage.setItem(CACHE_KEY,durable(text))}catch(e){}return durable(text)}
async function request(endpoint,payload,keepalive){const auth=initData();if(!auth)return null;const body=JSON.stringify(Object.assign({init_data:auth},payload||{}));const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'tma '+auth,'X-Telegram-Init-Data':auth},body,keepalive:!!keepalive});const json=await response.json().catch(()=>({}));if(!response.ok||json.ok===false)throw new Error(json.error||('HTTP '+response.status));return json}
async function saveNow(keepalive){const auth=initData();const text=cache(editor.value);if(!auth||text===lastSent)return;try{const saved=await request('/api/draft/save',{content:text},keepalive);if(saved)lastSent=durable(saved.content)}catch(error){console.warn('draft save',error)}}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow(false),700)}
editor.addEventListener('input',()=>{cache(editor.value);scheduleSave()});
setInterval(()=>{const text=cache(editor.value);if(text!==lastSent)scheduleSave()},1200);
async function loadDraft(){let local=durable(editor.value);if(local!==editor.value)editor.value=local;cache(local);if(!initData())return;try{const remote=await request('/api/draft/load',{},false);if(!remote)return;const server=durable(remote.content||'');if(remote.updated_at!==null&&remote.updated_at!==undefined){editor.value=server;cache(server);lastSent=server;return}if(local){await saveNow(false)}else lastSent=''}catch(error){console.warn('draft load',error)}}
window.addEventListener('pagehide',()=>{clearTimeout(saveTimer);saveNow(true)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){clearTimeout(saveTimer);saveNow(true)}});
loadDraft();
})();
