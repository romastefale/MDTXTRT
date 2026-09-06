(function(){
const tg=window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;
const editor=document.getElementById('editor'), popover=document.getElementById('popover'), popoverBody=document.getElementById('popoverBody'), popoverTitle=document.getElementById('popoverTitle'), statusEl=document.getElementById('status');
const sheet=document.getElementById('optionsBackdrop'), sheetTitle=document.getElementById('optionsSheetTitle'), sheetBody=document.getElementById('optionsSheetBody'), fileInput=document.getElementById('file');
const legacyTitle=document.getElementById('inpTitle');
if(legacyTitle){legacyTitle.value='';legacyTitle.remove()}
try{localStorage.removeItem('mdtxtrt_title')}catch(e){}
editor.addEventListener('input',()=>{try{localStorage.removeItem('mdtxtrt_title')}catch(e){}});
let actionBusy=false;
function setStatus(message,type){statusEl.textContent=message||'';statusEl.className='status'+(message?' on':'')+(type?' '+type:'')}
function initData(){return tg?String(tg.initData||'').trim():''}
function hidePopover(){popover.classList.remove('on');popover.setAttribute('aria-hidden','true')}
function preparePopover(title){if(popover.classList.contains('on')){const close=document.getElementById('popoverClose');if(close)close.click()}popoverTitle.textContent=title;popoverBody.innerHTML='';popover.classList.add('on');popover.setAttribute('aria-hidden','false')}
function closeTitleSheet(){sheet.classList.remove('on');sheet.setAttribute('aria-hidden','true')}
function prepareTitleSheet(title){hidePopover();sheetTitle.textContent=title;sheetBody.innerHTML='';sheet.classList.add('on');sheet.setAttribute('aria-hidden','false')}
function plainTitleLine(line){return String(line||'').trim().replace(/^#{1,6}\s+/,'').replace(/^>\s?/, '').replace(/^[-*+]\s+\[[ xX]\]\s+/, '').replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]+>/g,'').replace(/[*_~=`|]+/g,'').trim()}
function suggestedTitle(){const line=editor.value.split(/\r?\n/).find(item=>item.trim());if(!line)return'Sem título';return(plainTitleLine(line)||line.trim()).slice(0,256)||'Sem título'}
function resolvedTitle(input,suggestion){return String(input.value||'').trim().slice(0,256)||suggestion}
async function postJson(endpoint,payload){const data=initData(),headers={'Content-Type':'application/json'};if(data){headers.Authorization='tma '+data;headers['X-Telegram-Init-Data']=data}const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(Object.assign({init_data:data},payload))});const json=await response.json().catch(()=>({}));if(!response.ok||json.ok===false)throw new Error(json.error||('HTTP '+response.status));return json}
async function deliver(action,title){const response=await fetch('/api/stash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,title,content:editor.value})});const json=await response.json().catch(()=>({}));if(!response.ok||!json.url)throw new Error(json.error||('HTTP '+response.status));if(tg&&tg.openTelegramLink)tg.openTelegramLink(json.url);else location.href=json.url}
function requireDocument(){if(editor.value.trim())return true;setStatus('Documento vazio.','error');return false}
function preflightReport(report){const box=document.createElement('div');box.className='form';box.dataset.telegraphPreflight='1';if(report.adaptations&&report.adaptations.length){const label=document.createElement('label');label.textContent='Adaptações antes da publicação: '+report.adaptations.join(' · ');box.appendChild(label)}if(report.unsupported&&report.unsupported.length){const label=document.createElement('label');label.textContent='Incompatibilidades com perda potencial: '+report.unsupported.join(' · ');box.appendChild(label)}return box}
function titleSheet(kind){
  if(!requireDocument())return;
  const suggestion=suggestedTitle(),isMd=kind==='md';
  prepareTitleSheet(isMd?'Exportar Markdown':'Publicar no Telegraph');
  const form=document.createElement('form');form.className='form';
  const label=document.createElement('label');label.textContent='Título';
  const input=document.createElement('input');input.type='text';input.maxLength=256;input.placeholder=suggestion;input.autocomplete='off';label.appendChild(input);form.appendChild(label);
  const actions=document.createElement('div');actions.className='sheet-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';cancel.onclick=()=>{if(!actionBusy)closeTitleSheet()};actions.appendChild(cancel);
  const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent=isMd?'Exportar':'Publicar';actions.appendChild(submit);form.appendChild(actions);
  let report=null;
  form.onsubmit=async event=>{
    event.preventDefault();if(actionBusy)return;actionBusy=true;
    const title=resolvedTitle(input,suggestion);submit.disabled=true;cancel.disabled=true;
    submit.textContent=isMd?'Exportando…':'Analisando compatibilidade…';
    setStatus(isMd?'Exportando…':'Analisando compatibilidade Telegraph…','warn');
    try{
      if(isMd){await deliver('mdrich',title);closeTitleSheet();setStatus('Arquivo .md enviado ao bot.','warn');return}
      if(!report){
        const checked=await postJson('/api/publish',{title,content:editor.value,preflight_only:true});
        if(checked.requires_confirmation){
          report=checked;const old=form.querySelector('[data-telegraph-preflight="1"]');if(old)old.remove();form.insertBefore(preflightReport(checked),actions);
          submit.disabled=false;cancel.disabled=false;submit.textContent=(checked.unsupported&&checked.unsupported.length)?'Publicar ciente da incompatibilidade':'Publicar com adaptações';setStatus('Revise o preflight antes de confirmar a publicação.','warn');return;
        }
        const page=await postJson('/api/publish',{title,content:editor.value});if(!page.url)throw new Error('O Telegraph não retornou a URL da publicação.');closeTitleSheet();renderTelegraphSuccess(page);setStatus('Publicação criada.','');return;
      }
      const page=await postJson('/api/publish',{title,content:editor.value,preflight_fingerprint:report.fingerprint,confirm_adaptations:true,confirm_unsupported:true});
      if(!page.url)throw new Error('O Telegraph não retornou a URL da publicação.');closeTitleSheet();renderTelegraphSuccess(page);setStatus('Publicação criada.','');
    }catch(error){report=null;const old=form.querySelector('[data-telegraph-preflight="1"]');if(old)old.remove();submit.disabled=false;cancel.disabled=false;submit.textContent=isMd?'Exportar':'Publicar';setStatus(error.message||'Falha não identificada.','error')}finally{actionBusy=false}
  };
  sheetBody.appendChild(form)
}
async function copyText(text){if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(text);return}const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw new Error('Não foi possível copiar o link.')}
function openPublication(url){try{if(tg&&tg.openLink)tg.openLink(url);else window.open(url,'_blank','noopener')}catch(e){window.open(url,'_blank','noopener')}}
function renderTelegraphSuccess(page){preparePopover('Publicação criada');const form=document.createElement('div');form.className='form';const titleLabel=document.createElement('label');titleLabel.textContent='Título';const titleValue=document.createElement('input');titleValue.type='text';titleValue.readOnly=true;titleValue.value=page.title||'';titleLabel.appendChild(titleValue);form.appendChild(titleLabel);const linkLabel=document.createElement('label');linkLabel.textContent='Link';const linkValue=document.createElement('input');linkValue.type='text';linkValue.readOnly=true;linkValue.value=page.url;linkLabel.appendChild(linkValue);form.appendChild(linkLabel);if(page.adaptations&&page.adaptations.length){const note=document.createElement('label');note.textContent='Adaptações Telegraph: '+page.adaptations.join(' · ');form.appendChild(note)}if(page.unsupported&&page.unsupported.length){const note=document.createElement('label');note.textContent='Incompatibilidades confirmadas: '+page.unsupported.join(' · ');form.appendChild(note)}const copy=document.createElement('button');copy.type='button';copy.className='tool';copy.textContent='Copiar link';copy.onclick=async()=>{try{await copyText(page.url);setStatus('Link copiado.','')}catch(error){setStatus(error.message||'Não foi possível copiar o link.','error')}};form.appendChild(copy);const open=document.createElement('button');open.type='button';open.className='primary';open.textContent='Abrir publicação';open.onclick=()=>openPublication(page.url);form.appendChild(open);const share=document.createElement('button');share.type='button';share.className='tool';share.textContent='Compartilhar no Telegram';share.onclick=async()=>{if(!tg||typeof tg.shareMessage!=='function'){setStatus('O compartilhamento nativo exige abrir o Mini App em um cliente Telegram compatível.','error');return}if(actionBusy)return;actionBusy=true;share.disabled=true;share.textContent='Preparando compartilhamento…';try{const prepared=await postJson('/api/share-telegraph',{title:page.title||'Publicação no Telegraph',url:page.url});if(!prepared.prepared_message_id)throw new Error('O Telegram não retornou a mensagem preparada.');tg.shareMessage(prepared.prepared_message_id,ok=>{share.disabled=false;share.textContent='Compartilhar no Telegram';actionBusy=false;setStatus(ok?'Compartilhado no Telegram.':'Compartilhamento não concluído.',ok?'':'warn')})}catch(error){share.disabled=false;share.textContent='Compartilhar no Telegram';actionBusy=false;setStatus(error.message||'Falha ao preparar compartilhamento.','error')}};form.appendChild(share);popoverBody.appendChild(form)}
document.getElementById('btnOptions').onclick=()=>fileInput.click();
document.getElementById('btnChat').onclick=async()=>{if(actionBusy||!requireDocument())return;actionBusy=true;setStatus('Enviando…','warn');try{await deliver('chat','Sem título');setStatus('Conteúdo enviado ao bot para Telegram Rich 10.3.','warn')}catch(error){setStatus(error.message||'Falha não identificada.','error')}finally{actionBusy=false}};
document.getElementById('btnMd').onclick=()=>titleSheet('md');
document.getElementById('btnPub').onclick=()=>titleSheet('telegraph');
})();
