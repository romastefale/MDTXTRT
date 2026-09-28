import { execFileSync } from 'node:child_process';

const fail=message=>{throw new Error(message);};
const anchor=(process.env.RELEASE_ANCHOR_SHA||'').trim();
const token=(process.env.GITHUB_TOKEN||'').trim();
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(anchor))fail('Release Anchor SHA ausente ou inválido');
if(head!==anchor)fail(`Workflow executado em ${head}, mas o Release Anchor informado é ${anchor}`);
if(!token)fail('GITHUB_TOKEN ausente; não é possível auditar o registro de evidências');

const fields=[
  'AUTHORIZATION_EVIDENCE_REF','VISUAL_EVIDENCE_REF','TELEGRAPH_EVIDENCE_REF','TELEGRAM_EVIDENCE_REF',
  'DEVICE_MATRIX_EVIDENCE_REF','FAULT_MATRIX_EVIDENCE_REF','ROLLBACK_EVIDENCE_REF'
];
const pattern=/^https:\/\/github\.com\/romastefale\/MDTXTRT\/(?:issues|pull)\/(\d+)(?:#issuecomment-(\d+))?$/;
const refs={};
for(const field of fields){
  const ref=(process.env[field]||'').trim();
  if(!pattern.test(ref))fail(`${field} deve apontar para uma issue/PR/comment auditável em romastefale/MDTXTRT`);
  refs[field]=ref;
}

async function githubBody(ref){
  const match=ref.match(pattern);
  const number=match?.[1],commentId=match?.[2];
  const api=commentId
    ?`https://api.github.com/repos/romastefale/MDTXTRT/issues/comments/${commentId}`
    :`https://api.github.com/repos/romastefale/MDTXTRT/issues/${number}`;
  const res=await fetch(api,{headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'x-github-api-version':'2022-11-28'}});
  if(!res.ok)fail(`Não foi possível ler evidência ${ref}: HTTP ${res.status}`);
  const data=await res.json();
  const body=String(data.body||'');
  if(!body.trim())fail(`Evidência sem corpo auditável: ${ref}`);
  return body;
}

const bodies=[];
for(const ref of [...new Set(Object.values(refs))])bodies.push(await githubBody(ref));
const body=bodies.join('\n\n');

function fieldValue(label){
  const escaped=label.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
  const match=body.match(new RegExp('^\\s*(?:-\\s*)?'+escaped+'\\s*:\\s*(.+?)\\s*$','mi'));
  return match?.[1]?.trim()||'';
}
function requireValue(label){
  const value=fieldValue(label);
  if(!value||/^[-–—]$/.test(value))fail(`Campo obrigatório sem evidência: ${label}`);
  return value;
}
function requirePass(label){
  const value=requireValue(label).toUpperCase();
  if(value!=='PASS')fail(`${label} deve ser PASS, recebido: ${value}`);
}
function tableRow(label){
  const line=body.split(/\r?\n/).find(item=>item.trim().startsWith('| '+label+' |'));
  if(!line)fail(`Linha obrigatória ausente na matriz: ${label}`);
  return line.split('|').slice(1,-1).map(cell=>cell.trim());
}

if(!body.includes(anchor))fail('O registro de evidências não referencia o Release Anchor SHA exato');
if(requireValue('Final status').toUpperCase()!=='RELEASE APPROVED')fail('Registro de evidências não está em RELEASE APPROVED');

for(const label of ['Regression/build','Visual','Telegraph','Telegram Rich Message','Physical devices','Fault matrix','Authorization/config','Rollback','Evidence completeness'])requirePass(label);

for(const label of [
  'Authorization evidence reference','Authorized staging deployment','Authorized Telegraph test destination/account reference',
  'Authorized Telegram test bot/chat reference','Authorizer','Authorization timestamp','Confirmation that no production destination is used',
  'Telegraph test path/URL','Backend restart timestamp','Evidence reference','Returned messageId','Delivery timestamp',
  'Receiving device/client','Light mode evidence','Dark mode evidence','Menus/dialogs evidence',
  'Last known-good immutable SHA','Rollback deployment procedure exercised','Persistent volume retained'
])requireValue(label);

if(!/^[1-9]\d*$/.test(requireValue('Returned messageId')))fail('Returned messageId deve ser inteiro positivo');
if(!/^(yes|sim|true|pass)$/i.test(requireValue('Final path unchanged')))fail('Final path unchanged deve confirmar preservação do mesmo path');

for(const label of ['iOS browser','iOS Telegram Mini App','Android browser','Android Telegram Mini App']){
  const cells=tableRow(label);
  if(cells.length!==7)fail(`Matriz física inválida para ${label}`);
  for(const [index,name] of [[1,'device'],[2,'OS'],[3,'version'],[6,'evidence']])if(!cells[index])fail(`${label}: ${name} ausente`);
  if(cells[4].toUpperCase()!=='PASS'||cells[5].toUpperCase()!=='PASS')fail(`${label}: teclado fechado/aberto deve ser PASS`);
}

const faultLabels=[
  'localStorage read failure','identity write/read-back failure','/novo archive storage failure','IndexedDB unavailable with attachment',
  'offline before request','Telegram unknown timeout','backend restart during sending','response lost after possible acceptance',
  'Telegraph ownership without credential','reload succeeded handoff','reload uncertain handoff','explicit Telegram rejection'
];
for(const label of faultLabels){
  const cells=tableRow(label);
  if(cells.length!==6)fail(`Matriz de falhas inválida para ${label}`);
  if(!cells[1]||!cells[3]||!cells[5])fail(`${label}: ambiente, observado e evidência são obrigatórios`);
  if(cells[4].toUpperCase()!=='PASS')fail(`${label}: resultado deve ser PASS`);
}

console.log(JSON.stringify({ok:true,releaseAnchor:anchor,certification:'RELEASE APPROVED',auditedReferences:[...new Set(Object.values(refs))]},null,2));
