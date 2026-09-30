import { execFileSync } from 'node:child_process';

const fail=message=>{throw new Error(message);};
const anchor=(process.env.RELEASE_EVIDENCE_SHA||'').trim();
const token=(process.env.GITHUB_TOKEN||'').trim();
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(anchor))fail('Release evidence SHA ausente ou inválido');
if(head!==anchor)fail(`Workflow executado em ${head}, mas o Release evidence SHA informado é ${anchor}`);
if(!token)fail('GITHUB_TOKEN ausente; não é possível auditar o registro de evidências');

const fields=[
  'AUTHORIZATION_EVIDENCE_REF','VISUAL_EVIDENCE_REF','DRAFT_PERSISTENCE_EVIDENCE_REF','IMPORT_EXPORT_EVIDENCE_REF',
  'TELEGRAPH_EVIDENCE_REF','TELEGRAM_EVIDENCE_REF','DEVICE_MATRIX_EVIDENCE_REF','FAULT_MATRIX_EVIDENCE_REF','ROLLBACK_EVIDENCE_REF'
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
function requireYes(label){
  const value=requireValue(label);
  if(!/^(yes|sim|true|pass)$/i.test(value))fail(`${label} deve confirmar YES/SIM/TRUE/PASS`);
}
function tableRow(label){
  const line=body.split(/\r?\n/).find(item=>item.trim().startsWith('| '+label+' |'));
  if(!line)fail(`Linha obrigatória ausente na matriz: ${label}`);
  return line.split('|').slice(1,-1).map(cell=>cell.trim());
}

if(!body.includes(anchor))fail('O registro de evidências não referencia o Release evidence SHA exato');
if(requireValue('Final status').toUpperCase()!=='RELEASE APPROVED')fail('Registro de evidências não está em RELEASE APPROVED');

for(const label of [
  'Regression/build','Surface contract','Visual','Draft persistence','Telegraph','Telegram Rich Message',
  'Physical devices','Import/export','Fault matrix','Authorization/config','Rollback','Evidence completeness'
])requirePass(label);

for(const label of [
  'Authorization evidence reference','Authorized candidate deployment','Authorized Telegraph test destination/account reference',
  'Authorized Telegram test bot/chat reference','Authorizer','Authorization timestamp','Environment classification (staging/production)',
  'Confirmation that every external destination used is intentionally authorized',
  'Draft document UUID','Draft revision before restart','Owner type (browser/Telegram)','Recovery with local active slot absent',
  'Backend restart/deploy timestamp','Draft persistent volume retained','Recovery result after restart','Cross-owner isolation result',
  'Final document/revision unchanged as expected','Draft evidence reference',
  'Telegraph initial revision','Telegraph test path/URL','Backend restart timestamp','Durable volume retained','Telegraph evidence reference',
  'Document UUID','Telegram initial revision','Returned messageId','Delivery timestamp','Receiving device/client','Rendering result',
  'Later revised revision','Original message preserved','Revision notice messageId','Revised content messageId','Revision notice linked to original','Unintended duplicate check','Reload/reopen duplicate check',
  'Cross-owner/document binding isolation','Telegram evidence reference',
  'Light mode evidence','Dark mode evidence','Menus/dialogs evidence','Title-label evidence',
  'Last known-good deployment SHA','Candidate deployment ID/SHA','Rollback deployment procedure exercised',
  'Rolled-back deployment ID/SHA','Persistent volume retained','Persistent draft still recoverable after rollback',
  'Forward redeploy procedure exercised','Rollback evidence reference'
])requireValue(label);

if(!/^[1-9]\d*$/.test(requireValue('Returned messageId')))fail('Returned messageId deve ser inteiro positivo');
if(!/^[0-9]+$/.test(requireValue('Draft revision before restart')))fail('Draft revision before restart deve ser inteiro não negativo');
if(!/^[0-9]+$/.test(requireValue('Telegraph initial revision')))fail('Telegraph initial revision deve ser inteiro não negativo');
if(!/^[0-9]+$/.test(requireValue('Telegram initial revision')))fail('Telegram initial revision deve ser inteiro não negativo');
if(!/^[0-9]+$/.test(requireValue('Later revised revision')))fail('Later revised revision deve ser inteiro não negativo');
if(!/^[1-9]\d*$/.test(requireValue('Revision notice messageId')))fail('Revision notice messageId deve ser inteiro positivo');
if(!/^[1-9]\d*$/.test(requireValue('Revised content messageId')))fail('Revised content messageId deve ser inteiro positivo');
if(requireValue('Returned messageId')===requireValue('Revised content messageId'))fail('Revised content messageId deve ser novo e diferente do messageId inicial');

requireYes('Confirmation that every external destination used is intentionally authorized');
requireYes('Draft persistent volume retained');
requireYes('Final document/revision unchanged as expected');
requireYes('Durable volume retained');
requireYes('Final path unchanged');
requireYes('Original message preserved');
requireYes('Revision notice linked to original');
requireYes('Unintended duplicate check');
requireYes('Reload/reopen duplicate check');
requireYes('Cross-owner/document binding isolation');
requireYes('Persistent volume retained');
requireYes('Persistent draft still recoverable after rollback');
if(!requireValue('Candidate deployment ID/SHA').includes(anchor))fail('Candidate deployment ID/SHA deve conter o Release evidence SHA exato');

for(const label of [
  'iOS browser','iOS PWA','iOS Telegram Mini App',
  'Android browser','Android PWA','Android Telegram Mini App'
]){
  const cells=tableRow(label);
  if(cells.length!==7)fail(`Matriz física inválida para ${label}`);
  for(const [index,name] of [[1,'device'],[2,'OS'],[3,'version'],[6,'evidence']])if(!cells[index])fail(`${label}: ${name} ausente`);
  if(cells[4].toUpperCase()!=='PASS'||cells[5].toUpperCase()!=='PASS')fail(`${label}: teclado fechado/aberto deve ser PASS`);
}

const importRows=[
  'Web/PWA import','Web/PWA export','Mini App import','Mini App export','Bot /importar','Bot /exportar',
  'Edited Markdown round-trip','Structured document → TXT warning'
];
for(const label of importRows){
  const cells=tableRow(label);
  if(cells.length!==5)fail(`Matriz de importação/exportação inválida para ${label}`);
  if(!cells[4])fail(`${label}: evidência ausente`);
  if(cells[3].toUpperCase()!=='PASS')fail(`${label}: resultado deve ser PASS`);
  if(label==='Edited Markdown round-trip'){
    if(cells[1].toUpperCase()!=='PASS')fail(`${label}: Markdown deve ser PASS`);
  }else if(label==='Structured document → TXT warning'){
    if(cells[2].toUpperCase()!=='PASS')fail(`${label}: TXT deve ser PASS`);
  }else if(cells[1].toUpperCase()!=='PASS'||cells[2].toUpperCase()!=='PASS'){
    fail(`${label}: Markdown e TXT devem ser PASS`);
  }
}

const faultLabels=[
  'localStorage read failure','identity write/read-back failure','/novo archive storage failure','IndexedDB unavailable with attachment',
  'Railway draft-volume write failure','Railway draft unavailable after restart','offline before request',
  'Telegram unknown timeout on first send','Telegram revision notice/content timeout','backend restart during sending',
  'response lost after possible acceptance','Telegraph ownership without credential','reload succeeded handoff',
  'reload uncertain handoff','explicit Telegram rejection','stale persistent draft revision'
];
for(const label of faultLabels){
  const cells=tableRow(label);
  if(cells.length!==6)fail(`Matriz de falhas inválida para ${label}`);
  if(!cells[1]||!cells[3]||!cells[5])fail(`${label}: ambiente, observado e evidência são obrigatórios`);
  if(cells[4].toUpperCase()!=='PASS')fail(`${label}: resultado deve ser PASS`);
}

console.log(JSON.stringify({
  ok:true,
  releaseAnchor:anchor,
  certification:'RELEASE APPROVED',
  auditedReferences:[...new Set(Object.values(refs))],
  physicalRows:6,
  importExportRows:importRows.length,
  faultRows:faultLabels.length
},null,2));
