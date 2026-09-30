import { readFileSync } from 'node:fs';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const fail=message=>{throw new Error(message);};
const requireText=(text,fragment,label)=>{if(!text.includes(fragment))fail(label+': caminho funcional ausente');};

const ui=read('src/liquid-glass-ui.jsx');
const app=read('app.js');
const server=read('server.mjs');
const pwa=JSON.parse(read('manifest.webmanifest'));

const requiredIds=[
  'undoBtn','redoBtn','themeBtn','destBtn','exportBtn','openAppBtn','exportMdBtn','exportTxtBtn',
  'plusBtn','linkBtn','headingBtn','listBtn','quoteBtn','docName','libraryBtn','libraryMenu','libraryClose','libraryNew','publicationToggle','draftList','telegraphList','importMdBtn','importTxtBtn','findBtn',
  'mediaBtn','voiceBtn','dialogMenu','findMenu','fileInput','mediaInput'
];
for(const id of requiredIds){
  if(!ui.includes('id="'+id+'"')&&!ui.includes('id: "'+id+'"'))fail('UI '+id+': caminho funcional ausente');
}

for(const [id,fragment] of Object.entries({
  undoBtn:"one('#undoBtn').addEventListener",
  redoBtn:"one('#redoBtn').addEventListener",
  themeBtn:"one('#themeBtn').addEventListener",
  destBtn:"one('#destBtn').addEventListener",
  exportBtn:"one('#exportBtn').addEventListener",
  openAppBtn:"one('#openAppBtn').addEventListener",
  exportMdBtn:"one('#exportMdBtn').addEventListener",
  exportTxtBtn:"one('#exportTxtBtn').addEventListener",
  importMdBtn:"one('#importMdBtn').addEventListener",
  importTxtBtn:"one('#importTxtBtn').addEventListener",
  libraryBtn:"one('#libraryBtn')?.addEventListener",
  libraryClose:"one('#libraryClose')?.addEventListener",
  libraryNew:"one('#libraryNew')?.addEventListener",
  publicationToggle:"one('#publicationToggle')?.addEventListener",
  findBtn:"one('#findBtn').addEventListener",
  mediaBtn:"one('#mediaBtn').addEventListener",
  voiceBtn:"one('#voiceBtn').addEventListener"
}))requireText(app,fragment,'handler '+id);

requireText(app,"linkBtn.addEventListener('click'","handler linkBtn");
requireText(app,"[data-plus-submenu] [data-insert]","generic insertion handler");
requireText(app,"[data-plus-submenu] [data-cmd]","generic command handler");
requireText(app,"#headingMenu [data-block]","block-format handler");
requireText(app,"#linkMenu [data-link-kind]","link-kind handler");
requireText(app,"hyperlink:insertHyperlink","hyperlink action");
requireText(app,"url:insertVisibleLink","visible URL action");
requireText(app,"button:insertLinkButton","button-link action");

const insertionBlock=app.slice(app.indexOf('async function insertFeature(kind)'),app.indexOf('function insertPlainText',app.indexOf('async function insertFeature(kind)')));
if(!insertionBlock)fail('insertFeature não encontrado');
const declaredInsertions=[...new Set([...ui.matchAll(/(?:data-insert="|"data-insert": ")([^"]+)/g)].map(match=>match[1]))];
for(const kind of declaredInsertions)requireText(insertionBlock,"'"+kind+"'","inserção "+kind);

const declaredCommands=[...new Set([...ui.matchAll(/(?:data-cmd="|"data-cmd": ")([^"]+)/g)].map(match=>match[1]))];
const core=read('src/editor-core.mjs');
for(const cmd of declaredCommands){
  if(cmd==='insertUnorderedList')requireText(app,"cmd==='insertUnorderedList'","comando "+cmd);
  else requireText(core,cmd+':',"comando "+cmd);
}

const botCommands=[...server.matchAll(/\{ command: "([^"]+)"/g)].map(match=>match[1]);
const expectedBot=['start','app','novo','rascunhos','telegraph','ajuda','enviar','exportar','importar'];
if(JSON.stringify(botCommands)!==JSON.stringify(expectedBot))fail('Comandos anunciados do bot divergentes');
for(const command of ['start','app','novo','rascunhos','telegraph','ajuda','enviar','exportar'])requireText(server,'command === "'+command+'"','bot /'+command);
requireText(server,'command==="importar"','bot /importar');
requireText(server,'importIntent','fluxo de importação do bot');

for(const route of [
  '/api/telegram/session','/api/telegram/send','/api/telegraph/publish','/api/telegraph/recover','/api/telegraph/load',
  '/api/library/list','/api/handoff','/api/handoff/claim','/api/handoff/publish','/api/drafts/save','/api/drafts/load','/api/drafts/file'
])requireText(server,route,'rota '+route);

requireText(app,"void openMiniApp()","handoff browser/PWA → Mini App");
requireText(app,"await publishTelegram()","publicação Telegram");
requireText(app,"await publishTelegraph()","publicação Telegraph");
requireText(server,'sendTelegramRevisionNotice','aviso de revisão Telegram');
requireText(server,'history:nextHistory','histórico de publicação Telegram');
if(server.includes('telegramCall("editMessageText"'))fail('publicação Telegram ainda edita mensagem existente');
requireText(server,'publishTelegramPersistent','proveniência Telegram');
requireText(app,'function openLibrary','biblioteca de rascunhos/Telegraph');
requireText(app,"API+'/api/telegraph/load'",'edição Telegraph pela biblioteca');
requireText(server,'const DRAFT_DIR = DATA + "/drafts"','persistência de rascunhos');

if(pwa.display!=='standalone'||pwa.start_url!=='./'||pwa.scope!=='./')fail('Manifesto PWA não declara a superfície standalone esperada');
if(!Array.isArray(pwa.icons)||pwa.icons.length<2)fail('Manifesto PWA sem ícones mínimos');

console.log(JSON.stringify({
  ok:true,
  uiControls:requiredIds.length,
  insertions:declaredInsertions.length,
  commands:declaredCommands.length,
  botCommands,
  pwa:{display:pwa.display,start_url:pwa.start_url}
},null,2));
