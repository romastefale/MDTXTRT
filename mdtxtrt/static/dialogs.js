const css = `
.mdtxtrt-dialog{width:min(880px,calc(100% - 24px));max-height:86vh;border:1px solid var(--line);border-radius:16px;background:var(--bg);color:var(--text);padding:0;box-shadow:0 28px 80px #0004}
.mdtxtrt-dialog::backdrop{background:#0007}
.mdtxtrt-dialog .dialog-body{display:grid;gap:12px}
.mdtxtrt-dialog .semantic-summary{display:grid;gap:6px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.mdtxtrt-dialog .semantic-summary strong{font-size:13px}
.mdtxtrt-dialog .semantic-list{margin:0;padding-left:18px;font-size:13px;color:var(--hint)}
.mdtxtrt-dialog .compare-grid{display:grid;gap:10px}
.mdtxtrt-dialog .compare-pane{display:grid;gap:6px;min-width:0}
.mdtxtrt-dialog .compare-pane label{font-size:12px;color:var(--hint)}
.mdtxtrt-dialog .compare-pane textarea{width:100%;min-height:220px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surface);color:var(--text);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
.mdtxtrt-dialog .choice-grid{display:grid;gap:7px}
.mdtxtrt-dialog .choice-item{display:flex;gap:8px;align-items:flex-start;padding:9px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.mdtxtrt-dialog .choice-item input{margin-top:3px}
.mdtxtrt-dialog .choice-item span{display:grid;gap:2px}
.mdtxtrt-dialog .choice-item small{color:var(--hint)}
.mdtxtrt-dialog .danger-action{color:#fff;background:#b42318!important;border-color:#b42318!important}
@media(min-width:760px){.mdtxtrt-dialog .compare-grid{grid-template-columns:1fr 1fr}}
`;

function installStyle(){
  if(document.getElementById("mdtxtrt-dialog-style")) return;
  const style=document.createElement("style");
  style.id="mdtxtrt-dialog-style";
  style.textContent=css;
  document.head.append(style);
}

function shell(title){
  installStyle();
  const dialog=document.createElement("dialog");
  dialog.className="mdtxtrt-dialog";
  const head=document.createElement("div");
  head.className="dialog-head";
  const heading=document.createElement("h2");
  heading.textContent=title;
  head.append(heading);
  const body=document.createElement("div");
  body.className="dialog-body";
  const actions=document.createElement("div");
  actions.className="dialog-actions";
  dialog.append(head,body,actions);
  document.body.append(dialog);
  dialog.addEventListener("close",()=>dialog.remove(),{once:true});
  return {dialog,body,actions};
}

function button(label,{primary=false,danger=false}={}){
  const el=document.createElement("button");
  el.type="button";
  el.textContent=label;
  if(primary) el.classList.add("primary");
  if(danger) el.classList.add("danger-action");
  return el;
}

function paragraph(text){
  const p=document.createElement("p");
  p.textContent=text;
  return p;
}

function summaryBlock(lines=[]){
  const box=document.createElement("section");
  box.className="semantic-summary";
  const title=document.createElement("strong");
  title.textContent="Resumo semântico";
  const list=document.createElement("ul");
  list.className="semantic-list";
  for(const line of lines){
    const li=document.createElement("li");
    li.textContent=line;
    list.append(li);
  }
  if(!lines.length){
    const li=document.createElement("li");
    li.textContent="Nenhuma diferença semântica identificada pelo comparador.";
    list.append(li);
  }
  box.append(title,list);
  return box;
}

export async function noticeDialog(title,message,{buttonLabel="OK"}={}){
  const {dialog,body,actions}=shell(title);
  body.append(paragraph(message));
  const ok=button(buttonLabel,{primary:true});
  actions.append(ok);
  return new Promise(resolve=>{
    ok.onclick=()=>dialog.close();
    dialog.addEventListener("close",()=>resolve(),{once:true});
    dialog.showModal();
  });
}

export async function confirmDialog(title,message,{confirmLabel="Confirmar",cancelLabel="Cancelar",danger=false,details=[]}={}){
  const {dialog,body,actions}=shell(title);
  body.append(paragraph(message));
  if(details.length) body.append(summaryBlock(details));
  const cancel=button(cancelLabel);
  const confirm=button(confirmLabel,{primary:!danger,danger});
  actions.append(cancel,confirm);
  return new Promise(resolve=>{
    cancel.onclick=()=>{dialog.returnValue="cancel";dialog.close()};
    confirm.onclick=()=>{dialog.returnValue="confirm";dialog.close()};
    dialog.addEventListener("close",()=>resolve(dialog.returnValue==="confirm"),{once:true});
    dialog.showModal();
  });
}

export async function choiceDialog(title,message,options,{defaultValue=null,confirmLabel="Continuar",cancelLabel="Cancelar"}={}){
  const {dialog,body,actions}=shell(title);
  if(message) body.append(paragraph(message));
  const group=document.createElement("div");
  group.className="choice-grid";
  const name=`choice-${crypto.randomUUID()}`;
  let first=null;
  for(const option of options){
    const label=document.createElement("label");
    label.className="choice-item";
    const input=document.createElement("input");
    input.type="radio";
    input.name=name;
    input.value=String(option.value);
    if(String(option.value)===String(defaultValue)) input.checked=true;
    if(!first) first=input;
    const text=document.createElement("span");
    const strong=document.createElement("strong");
    strong.textContent=option.label;
    text.append(strong);
    if(option.detail){const small=document.createElement("small");small.textContent=option.detail;text.append(small)}
    label.append(input,text);
    group.append(label);
  }
  if(!group.querySelector("input:checked")&&first) first.checked=true;
  body.append(group);
  const cancel=button(cancelLabel);
  const confirm=button(confirmLabel,{primary:true});
  actions.append(cancel,confirm);
  return new Promise(resolve=>{
    cancel.onclick=()=>{dialog.returnValue="cancel";dialog.close()};
    confirm.onclick=()=>{dialog.returnValue="confirm";dialog.close()};
    dialog.addEventListener("close",()=>{
      if(dialog.returnValue!=="confirm"){resolve(null);return}
      resolve(group.querySelector("input:checked")?.value??null);
    },{once:true});
    dialog.showModal();
  });
}

export async function comparisonDialog({
  title,
  summary=[],
  leftLabel,
  leftValue,
  leftEditable=false,
  rightLabel,
  rightValue,
  rightEditable=false,
  choices=[],
  defaultChoice=null,
  rememberLabel=null,
  confirmLabel="Continuar",
  cancelLabel="Cancelar",
}){
  const {dialog,body,actions}=shell(title);
  body.append(summaryBlock(summary));
  const grid=document.createElement("div");
  grid.className="compare-grid";
  const makePane=(labelText,value,editable)=>{
    const pane=document.createElement("div");
    pane.className="compare-pane";
    const label=document.createElement("label");
    label.textContent=labelText;
    const textarea=document.createElement("textarea");
    textarea.value=value??"";
    textarea.readOnly=!editable;
    pane.append(label,textarea);
    return {pane,textarea};
  };
  const left=makePane(leftLabel,leftValue,leftEditable);
  const right=makePane(rightLabel,rightValue,rightEditable);
  grid.append(left.pane,right.pane);
  body.append(grid);

  let choiceInputs=[];
  if(choices.length){
    const choiceBox=document.createElement("div");
    choiceBox.className="choice-grid";
    const name=`compare-choice-${crypto.randomUUID()}`;
    for(const option of choices){
      const label=document.createElement("label");
      label.className="choice-item";
      const input=document.createElement("input");
      input.type="radio";
      input.name=name;
      input.value=String(option.value);
      input.checked=String(option.value)===String(defaultChoice);
      const text=document.createElement("span");
      const strong=document.createElement("strong");
      strong.textContent=option.label;
      text.append(strong);
      if(option.detail){const small=document.createElement("small");small.textContent=option.detail;text.append(small)}
      label.append(input,text);
      choiceBox.append(label);
      choiceInputs.push(input);
    }
    if(!choiceInputs.some(input=>input.checked)&&choiceInputs[0]) choiceInputs[0].checked=true;
    body.append(choiceBox);
  }

  let remember=null;
  if(rememberLabel){
    const wrap=document.createElement("label");
    wrap.className="check";
    remember=document.createElement("input");
    remember.type="checkbox";
    const text=document.createElement("span");
    text.textContent=rememberLabel;
    wrap.append(remember,text);
    body.append(wrap);
  }

  const cancel=button(cancelLabel);
  const confirm=button(confirmLabel,{primary:true});
  actions.append(cancel,confirm);
  return new Promise(resolve=>{
    cancel.onclick=()=>{dialog.returnValue="cancel";dialog.close()};
    confirm.onclick=()=>{dialog.returnValue="confirm";dialog.close()};
    dialog.addEventListener("close",()=>{
      if(dialog.returnValue!=="confirm"){resolve(null);return}
      resolve({
        left:left.textarea.value,
        right:right.textarea.value,
        choice:choiceInputs.find(input=>input.checked)?.value??null,
        remember:Boolean(remember?.checked),
      });
    },{once:true});
    dialog.showModal();
  });
}
