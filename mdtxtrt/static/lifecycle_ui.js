import {choiceDialog,confirmDialog,noticeDialog} from "/static/dialogs.js";

const tg=window.Telegram?.WebApp;
const initData=tg?.initData||"";
const $=(selector,root=document)=>root.querySelector(selector);
const editor=$("#editor");

function markSessionExpired(){
  window.dispatchEvent(new CustomEvent("mdtxtrt:auth-expired",{detail:{source:"lifecycle"}}));
}

async function api(path,options={}){
  const headers={"X-Telegram-Init-Data":initData,...(options.headers||{})};
  if(options.body&&!(options.body instanceof FormData)&&typeof options.body!=="string"){
    headers["Content-Type"]="application/json";
    options.body=JSON.stringify(options.body);
  }
  const response=await fetch(path,{...options,headers});
  const data=await response.json().catch(()=>({}));
  if(response.status===401) markSessionExpired();
  if(!response.ok||data.ok===false){
    const error=new Error(data.detail||data.error||`HTTP ${response.status}`);
    error.status=response.status;
    error.data=data;
    throw error;
  }
  return data;
}

async function authenticatedDownload(path,filename){
  const response=await fetch(path,{headers:{"X-Telegram-Init-Data":initData}});
  if(response.status===401) markSessionExpired();
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob=await response.blob();
  const href=URL.createObjectURL(blob);
  const anchor=document.createElement("a");
  anchor.href=href;
  anchor.download=filename||"arquivo";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}

function archivedView(){
  return $("#toggle-archived")?.textContent?.trim()==="Ver ativos";
}

async function downloadDraftOriginal(draft){
  const result=await api(`/api/drafts/${draft.id}/imports`);
  const imports=result.imports||[];
  if(!imports.length){
    await noticeDialog("Arquivo original","Este rascunho não possui arquivo original importado.");
    return;
  }
  let chosen=imports[0];
  if(imports.length>1){
    const selected=await choiceDialog(
      "Escolher arquivo original",
      "Há mais de um arquivo original associado a este rascunho.",
      imports.map(item=>({
        value:item.id,
        label:item.filename,
        detail:`${item.encoding} · ${item.size} bytes · SHA-256 ${item.sha256}`,
      })),
      {defaultValue:imports[0].id,confirmLabel:"Baixar"},
    );
    if(!selected) return;
    chosen=imports.find(item=>item.id===selected);
    if(!chosen) return;
  }
  await authenticatedDownload(`/api/imports/${chosen.id}/original`,chosen.filename);
}

let enhancingDrafts=false;
async function enhanceDraftRows(){
  if(enhancingDrafts||!initData) return;
  const box=$("#drafts-list");
  const rows=box?[...box.querySelectorAll(".list-row")]:[];
  if(!rows.length||rows.every(row=>row.dataset.lifecycleEnhanced==="1")) return;
  enhancingDrafts=true;
  try{
    const result=await api(`/api/drafts?archived=${archivedView()?1:0}`);
    if(result.drafts.length!==rows.length) return;
    const draftsById=new Map(result.drafts.map(draft=>[String(draft.id),draft]));
    rows.forEach((row,index)=>{
      if(row.dataset.lifecycleEnhanced==="1") return;
      const draft=draftsById.get(String(row.dataset.draftId||""))||result.drafts[index];
      if(!draft) return;
      row.dataset.lifecycleEnhanced="1";
      row.dataset.draftId=draft.id;
      const actions=row.querySelector(".list-actions");
      if(!actions) return;

      const original=document.createElement("button");
      original.type="button";
      original.textContent="Original";
      original.onclick=async()=>{
        try{await downloadDraftOriginal(draft)}
        catch(error){if(error.status!==401) await noticeDialog("Falha ao baixar original",error.message)}
      };

      const duplicate=document.createElement("button");
      duplicate.type="button";
      duplicate.textContent="Duplicar";
      duplicate.onclick=async()=>{
        const allowed=await confirmDialog(
          "Duplicar rascunho",
          `Duplicar “${draft.name}” como um rascunho independente?`,
          {confirmLabel:"Duplicar"},
        );
        if(!allowed) return;
        try{
          const created=await api(`/api/drafts/${draft.id}/duplicate`,{method:"POST",body:{confirm:true}});
          const url=new URL(location.href);
          url.searchParams.set("draft",created.draft.id);
          location.assign(url.toString());
        }catch(error){
          if(error.status!==401) await noticeDialog("Falha ao duplicar",error.message);
        }
      };
      actions.append(original,duplicate);
    });
  }catch(error){
    if(error?.status!==401){
      // O editor principal continua responsável pelo fluxo base; enhancement é opcional.
    }
  }finally{
    enhancingDrafts=false;
  }
}

const draftObserver=new MutationObserver(()=>queueMicrotask(enhanceDraftRows));
const draftList=$("#drafts-list");
if(draftList) draftObserver.observe(draftList,{childList:true});
$("#toggle-archived")?.addEventListener("click",()=>setTimeout(enhanceDraftRows,0));

function mediaAccept(kind){
  if(kind==="photo") return "image/*";
  if(kind==="video") return "video/*";
  if(kind==="animation") return "image/gif,video/mp4";
  if(kind==="audio"||kind==="voice_note") return "audio/*";
  return "*/*";
}

function chooseFile(accept){
  return new Promise(resolve=>{
    const input=document.createElement("input");
    input.type="file";
    input.accept=accept;
    input.hidden=true;
    document.body.append(input);
    input.addEventListener("change",()=>{
      const file=input.files?.[0]||null;
      input.remove();
      resolve(file);
    },{once:true});
    input.click();
  });
}

function mediaCardNode(card){
  const node=card.__node;
  if(!node?.attrs?.media_blob_id) return null;
  if(!["photo","video","animation","audio","voice_note","document"].includes(node.kind)) return null;
  return node;
}

function refreshMediaCard(card,canonical){
  card.__node=structuredClone(canonical);
  const summary=card.querySelector(".summary");
  if(summary) summary.textContent=canonical.attrs.caption||canonical.attrs.filename||canonical.kind;
  editor.dispatchEvent(new Event("input",{bubbles:true}));
}

function applyMediaVersionToCard(card,canonical,media){
  canonical.attrs.media_blob_id=media.id;
  canonical.attrs.filename=media.filename;
  canonical.attrs.mime_type=media.mime_type;
  delete canonical.attrs.src;
  refreshMediaCard(card,canonical);
}

function editMediaProperties(card){
  const current=mediaCardNode(card);
  if(!current) return;
  const dialog=document.createElement("dialog");
  dialog.className="mdtxtrt-dialog";
  dialog.style.width="min(560px,calc(100% - 24px))";
  const form=document.createElement("form");
  form.method="dialog";
  const head=document.createElement("div");
  head.className="dialog-head";
  const title=document.createElement("h2");
  title.textContent="Propriedades da mídia";
  head.append(title);
  const body=document.createElement("div");
  body.className="dialog-body";

  const makeField=(label,value="",type="text")=>{
    const wrap=document.createElement("div");
    wrap.className=type==="checkbox"?"check":"field";
    const lab=document.createElement("label");
    lab.textContent=label;
    const input=document.createElement("input");
    input.type=type;
    if(type==="checkbox") input.checked=Boolean(value);
    else input.value=value??"";
    if(type==="checkbox") wrap.append(input,lab);
    else wrap.append(lab,input);
    body.append(wrap);
    return input;
  };

  const caption=makeField("Legenda",current.attrs.caption||"");
  const credit=makeField("Crédito",current.attrs.credit||"");
  const spoiler=makeField("Marcar como spoiler",Boolean(current.attrs.spoiler),"checkbox");
  const actions=document.createElement("div");
  actions.className="dialog-actions";
  const cancel=document.createElement("button");
  cancel.value="cancel";
  cancel.textContent="Cancelar";
  const apply=document.createElement("button");
  apply.value="apply";
  apply.className="primary";
  apply.textContent="Aplicar";
  actions.append(cancel,apply);
  form.append(head,body,actions);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener("close",()=>{
    if(dialog.returnValue==="apply"){
      const latest=mediaCardNode(card);
      if(latest){
        latest.attrs.caption=caption.value;
        latest.attrs.credit=credit.value;
        latest.attrs.spoiler=spoiler.checked;
        refreshMediaCard(card,latest);
      }
    }
    dialog.remove();
  },{once:true});
  dialog.showModal();
}

async function chooseMediaVersion(card){
  const current=mediaCardNode(card);
  if(!current) return;
  let history;
  try{
    history=(await api(`/api/media/${current.attrs.media_blob_id}/history`)).history||[];
  }catch(error){
    if(error.status!==401) await noticeDialog("Falha ao carregar versões",error.message);
    return;
  }
  if(!history.length){
    await noticeDialog("Versões da mídia","Esta mídia ainda não possui versão anterior.");
    return;
  }

  const dialog=document.createElement("dialog");
  dialog.className="mdtxtrt-dialog";
  const head=document.createElement("div");
  head.className="dialog-head";
  const title=document.createElement("h2");
  title.textContent="Versões anteriores da mídia";
  const close=document.createElement("button");
  close.type="button";
  close.textContent="Fechar";
  close.onclick=()=>dialog.close();
  head.append(title,close);
  const body=document.createElement("div");
  body.className="dialog-body";

  history.forEach((version,index)=>{
    const row=document.createElement("div");
    row.className="list-row";
    const name=document.createElement("strong");
    name.textContent=`${index+1}. ${version.filename}`;
    const meta=document.createElement("small");
    meta.textContent=`${version.size} bytes · SHA-256 ${version.sha256}`;
    const actions=document.createElement("div");
    actions.className="list-actions";
    const restore=document.createElement("button");
    restore.type="button";
    restore.textContent="Restaurar";
    restore.onclick=async()=>{
      const allowed=await confirmDialog(
        "Restaurar versão de mídia",
        `Restaurar “${version.filename}” como uma nova versão atual?`,
        {
          confirmLabel:"Restaurar como nova versão",
          details:["A versão atualmente ativa continuará preservada.","Nenhum BLOB histórico será sobrescrito ou apagado."],
        },
      );
      if(!allowed) return;
      restore.disabled=true;
      try{
        const result=await api(`/api/media/${current.attrs.media_blob_id}/restore`,{
          method:"POST",
          body:{version_id:version.id},
        });
        applyMediaVersionToCard(card,current,result.media);
        dialog.close();
      }catch(error){
        if(error.status!==401){
          await noticeDialog("Falha ao restaurar versão",error.message);
          restore.disabled=false;
        }
      }
    };
    actions.append(restore);
    row.append(name,meta,actions);
    body.append(row);
  });

  dialog.append(head,body);
  document.body.append(dialog);
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  dialog.showModal();
}

function enhanceMediaCards(){
  if(!editor) return;
  for(const card of editor.querySelectorAll(".node-card")){
    const canonical=mediaCardNode(card);
    if(!canonical||card.dataset.mediaLifecycleEnhanced==="1") continue;
    card.dataset.mediaLifecycleEnhanced="1";

    const properties=document.createElement("button");
    properties.type="button";
    properties.textContent="Propriedades";
    properties.style.gridColumn="1 / -1";
    properties.style.gridRow="auto";
    properties.style.justifySelf="start";
    properties.onclick=event=>{event.stopPropagation();editMediaProperties(card)};

    const replace=document.createElement("button");
    replace.type="button";
    replace.textContent="Substituir arquivo";
    replace.style.gridColumn="1 / -1";
    replace.style.gridRow="auto";
    replace.style.justifySelf="start";
    replace.onclick=async event=>{
      event.stopPropagation();
      const current=mediaCardNode(card);
      if(!current) return;
      const file=await chooseFile(mediaAccept(current.kind));
      if(!file) return;
      const allowed=await confirmDialog(
        "Substituir arquivo de mídia",
        `Substituir “${current.attrs.filename||current.kind}” por “${file.name}”?`,
        {
          confirmLabel:"Substituir",
          details:["A versão anterior será preservada no histórico.","A nova versão receberá novo BLOB e novo SHA-256."],
        },
      );
      if(!allowed) return;
      const form=new FormData();
      form.append("file",file,file.name);
      try{
        const result=await api(`/api/media/${current.attrs.media_blob_id}/replace`,{method:"POST",body:form});
        applyMediaVersionToCard(card,current,result.media);
      }catch(error){
        if(error.status!==401) await noticeDialog("Falha ao substituir mídia",error.message);
      }
    };

    const versions=document.createElement("button");
    versions.type="button";
    versions.textContent="Versões";
    versions.style.gridColumn="1 / -1";
    versions.style.gridRow="auto";
    versions.style.justifySelf="start";
    versions.onclick=event=>{event.stopPropagation();void chooseMediaVersion(card)};
    card.append(properties,replace,versions);
  }
}

if(editor){
  const mediaObserver=new MutationObserver(enhanceMediaCards);
  mediaObserver.observe(editor,{childList:true,subtree:false});
  enhanceMediaCards();
}

function selectionInsideEditor(selection){
  if(!selection?.rangeCount||selection.isCollapsed||!editor) return false;
  const range=selection.getRangeAt(0);
  const start=range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer:range.startContainer.parentElement;
  const end=range.endContainer.nodeType===Node.ELEMENT_NODE?range.endContainer:range.endContainer.parentElement;
  return Boolean(start&&end&&editor.contains(start)&&editor.contains(end));
}

document.addEventListener("selectionchange",()=>{
  if(!editor) return;
  const textMove=selectionInsideEditor(window.getSelection());
  for(const block of editor.children) block.draggable=!textMove;
});

window.addEventListener("unhandledrejection",event=>{
  const reason=event.reason;
  if(!reason||reason.status===401) return;
  const message=reason?.data?.detail||reason?.message;
  if(!message) return;
  event.preventDefault();
  void noticeDialog("Operação não concluída",message);
});

const statusNode=$("#status");
function exposeSessionRestart(){
  if(!statusNode||statusNode.textContent.trim()!=="sessão expirada") return;
  const actions=$("#message-dialog .dialog-actions");
  if(!actions||$("#restart-telegram-session")) return;
  const restart=document.createElement("button");
  restart.id="restart-telegram-session";
  restart.type="button";
  restart.className="primary";
  restart.textContent="Fechar para reabrir";
  restart.onclick=()=>tg?.close();
  actions.prepend(restart);
}
if(statusNode) new MutationObserver(exposeSessionRestart).observe(statusNode,{childList:true,characterData:true,subtree:true});
exposeSessionRestart();
