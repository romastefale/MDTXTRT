import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {parseDocument} from 'htmlparser2';

const token='123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
const port=18137;
const origin='https://mdtxtrt.up.railway.app';
let child,dir;
function init(user=7){
  const q=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:user})});
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  q.set('hash',createHmac('sha256',secret).update([...q].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  return q.toString();
}
async function post(path,body){
  const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:res.status,data:await res.json()};
}
function calls(){return readFileSync(join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
function lastCall(method){return calls().filter(call=>call.method===method).at(-1);}
async function webhook(update){
  const secret=createHmac('sha256',token).update('MDTXTRT_WEBHOOK').digest('hex');
  return fetch(`http://127.0.0.1:${port}/telegram/webhook`,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(update)});
}
function find(node,tag,out=[]){for(const item of node.children||[]){if(item.name===tag)out.push(item);find(item,tag,out);}return out;}
async function start(){
  child=spawn(process.execPath,['--import','./tests/mocks.mjs','server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),TOKEN:token,TELEGRAPH_ACCESS_TOKEN:'',RAILWAY_VOLUME_MOUNT_PATH:dir,TEST_CALLS:join(dir,'calls')},stdio:'ignore'});
  for(let i=0;i<30;i++){try{const res=await fetch(`http://127.0.0.1:${port}/`);if(res.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error('Server did not start');
}
before(async()=>{
  dir=mkdtempSync(join(process.cwd(),'.test-data-'));
  writeFileSync(join(dir,'telegraph-token-pages.json'),JSON.stringify({'7:11111111-1111-4111-8111-111111111111':'owned-page'}));
  await start();
});
after(()=>{child?.kill();if(dir)rmSync(dir,{recursive:true,force:true});});
test('homepage and local browser assets',async()=>{
  for(const path of ['/','/app.js','/marked.js','/turndown.js']) assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status,200);
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const icons=[...new Set([...html.matchAll(/data-icon="([\w-]+)"/g)].map(m=>m[1]))];
  for(const icon of icons) assert.equal((await fetch(`http://127.0.0.1:${port}/icons/${icon}.svg`)).status,200,icon);
});
test('session endpoint accepts signed current initData and rejects invalid or stale sessions',async()=>{
  assert.equal((await post('/api/telegram/session',{initData:init()})).status,200);
  assert.equal((await post('/api/telegram/session',{initData:'wrong'})).status,401);
  const stale=new URLSearchParams(init());stale.set('auth_date',String(Math.floor(Date.now()/1000)-86401));
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  stale.set('hash',createHmac('sha256',secret).update([...stale].filter(([key])=>key!=='hash').sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n')).digest('hex'));
  assert.equal((await post('/api/telegram/session',{initData:stale.toString()})).status,401);
});
test('send endpoint validates HTML before issuing a native Rich Message request',async()=>{
  const before=calls().filter(call=>call.method==='sendRichMessage').length;
  const bad=await post('/api/telegram/send',{initData:'wrong',html:'<p>ok</p>'});
  assert.equal(bad.status,400);
  assert.match(bad.data.error,/inválida/);
  const markup=await post('/api/telegram/send',{initData:init(),html:'<script>alert(1)</script>'});
  assert.notEqual(markup.status,200);
  assert.match(markup.data.error,/inválido|não aceita/);
  assert.equal(calls().filter(call=>call.method==='sendRichMessage').length,before);
});
test('Telegraph page ownership checked before edit',async()=>{
  const req={title:'Página',doc:'22222222-2222-4222-8222-222222222222',path:'owned-page',content:[{tag:'p',children:['texto']}],initData:init()};
  const denied=await post('/api/telegraph/publish',req);
  assert.equal(denied.status,400);
  assert.match(denied.data.error,/não pertence/);
  req.doc='11111111-1111-4111-8111-111111111111';req.initData=init(8);
  const other=await post('/api/telegraph/publish',req);
  assert.equal(other.status,400);
  assert.match(other.data.error,/não pertence/);
});
test('webhook rejects unauthenticated updates and removed export route',async()=>{
  assert.equal((await fetch(`http://127.0.0.1:${port}/telegram/webhook`,{method:'POST',body:'{}'})).status,401);
  assert.equal((await post('/api/telegram/export',{})).status,405);
});
test('start, app, novo and ajuda send usable button actions and registered commands',async()=>{
  for(const [text,message_id] of [['/start',3],['/app',4],['/novo',5],['/ajuda',6]]){
    const res=await webhook({message:{text,message_id,chat:{id:7,type:'private'}}});
    assert.equal(res.status,200,text);
  }
  const start=parseDocument(lastCall('sendRichMessage').body.rich_message.html);
  const buttons=find(start,'tg-button');
  assert.deepEqual(buttons.map(button=>[button.attribs.type,button.attribs.style,button.attribs.url,button.children[0]?.data]),[
    ['web_app','success','https://romastefale.github.io/MDTXTRT/','Mini App MDTXTRT'],
    ['url','danger','https://mdtxtrt.up.railway.app/','Abrir MDTXTRT no browser'],
  ]);
  const commandNames=lastCall('setMyCommands').body.commands.map(item=>item.command);
  for(const name of ['start','app','novo','ajuda','enviar','exportar'])assert.ok(commandNames.includes(name));
  const help=calls().filter(call=>call.method==='sendRichMessage').at(-1).body.rich_message.html;
  assert.match(help,/\/exportar/);
});
test('enviar turns command text and Telegram entities into a replied Rich Message',async()=>{
  const response=await webhook({message:{text:'/enviar Olá forte',entities:[{type:'bold',offset:12,length:5}],message_id:21,chat:{id:7,type:'private'}}});
  assert.equal(response.status,200);
  const {body}=lastCall('sendRichMessage');
  assert.deepEqual(body.reply_parameters,{message_id:21});
  assert.equal(body.chat_id,7);
  assert.equal(body.rich_message.html,'<p>Olá <b>forte</b></p>');
});
test('exportar creates actual TXT and Markdown documents from a command or reply',async()=>{
  await webhook({message:{text:'/exportar txt linha literal',message_id:31,chat:{id:7,type:'private'}}});
  let sent=lastCall('sendDocument');
  assert.equal(sent.body.document.name,'mdtxtrt.txt');
  assert.equal(sent.body.document.text,'linha literal');
  await webhook({message:{text:'/exportar md',message_id:32,chat:{id:7,type:'private'},reply_to_message:{text:'Olá forte',entities:[{type:'bold',offset:4,length:5}]}}});
  sent=lastCall('sendDocument');
  assert.equal(sent.body.document.name,'mdtxtrt.md');
  assert.equal(sent.body.document.type,'text/markdown');
  assert.equal(sent.body.document.text,'Olá **forte**');
});
test('callback and group message updates receive an explicit response',async()=>{
  assert.equal((await webhook({callback_query:{id:'cb1',data:'abrir',from:{id:7}}})).status,200);
  assert.deepEqual(lastCall('answerCallbackQuery').body,{callback_query_id:'cb1',text:'abrir'});
  assert.equal((await webhook({message:{text:'/app',message_id:41,chat:{id:-2,type:'group'}}})).status,200);
  assert.match(lastCall('sendRichMessage').body.rich_message.html,/chat privado/);
});

test('Rich Message send and Telegraph create/edit on same owned document',async()=>{
  const sent=await post('/api/telegram/send',{initData:init(),html:'<h1>Olá</h1><p><strong>Teste</strong></p>'});
  assert.equal(sent.status,200);
  assert.equal(sent.data.via,'sendRichMessage');
  const output=parseDocument(lastCall('sendRichMessage').body.rich_message.html);
  assert.equal(find(output,'h1')[0].children[0].data,'Olá');
  assert.equal(find(output,'strong')[0].children[0].data,'Teste');
  const page={title:'Página',doc:'33333333-3333-4333-8333-333333333333',content:[{tag:'h3',children:['Título']},{tag:'p',children:['texto']}],initData:init()};
  const created=await post('/api/telegraph/publish',page);
  assert.equal(created.status,200);
  assert.equal(created.data.path,'test-page-09-26');
  assert.equal(readFileSync(join(dir,'telegraph-token'),'utf8'),'persistent-test-token');
  assert.equal(lastCall('createPage').body.content,JSON.stringify(page.content));
  assert.equal(lastCall('createPage').body.access_token,'persistent-test-token');
  await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  await start();
  const edited=await post('/api/telegraph/publish',{...page,path:created.data.path,title:'Página revisada'});
  assert.equal(edited.status,200);
  assert.equal(edited.data.path,created.data.path);
  assert.equal(lastCall('editPage').body.path,created.data.path);
  assert.equal(lastCall('editPage').body.title,'Página revisada');
});
test('attached media uses native Rich Message upload',async()=>{
  const id='media1';
  const form=new FormData();
  form.set('initData',init());
  form.set('html',`<figure><img src="tg://photo?id=${id}"/><figcaption>Imagem</figcaption></figure>`);
  form.set('kind','image');form.set('id',id);
  form.set('upload',new Blob([new Uint8Array([0x89,0x50,0x4e,0x47])],{type:'image/png'}),'photo.png');
  const res=await fetch(`http://127.0.0.1:${port}/api/telegram/send`,{method:'POST',headers:{origin},body:form});
  assert.equal(res.status,200);
  assert.equal((await res.json()).via,'sendRichMessage');
  const sent=lastCall('sendRichMessage');
  assert.deepEqual(JSON.parse(sent.body.rich_message).media,[{id,media:{type:'photo',media:'attach://upload'}}]);
  assert.equal(sent.body.upload.name,'photo.png');
  assert.equal(sent.body.upload.type,'image/png');
});
test('HTTP media URLs become Bot API 10.3 rich media references for each media type',async()=>{
  const html='<figure><img src="https://cdn.example/photo.png"><video src="https://cdn.example/clip.mp4"></video><audio src="https://cdn.example/sound.mp3"></audio><tg-document src="https://cdn.example/file.pdf"></tg-document></figure>';
  const res=await post('/api/telegram/send',{initData:init(),html});
  assert.equal(res.status,200);
  const rich=lastCall('sendRichMessage').body.rich_message;
  assert.deepEqual(rich.media.map(item=>item.media.type),['photo','video','audio','document']);
  assert.deepEqual(rich.media.map(item=>item.media.media),[
    'https://cdn.example/photo.png','https://cdn.example/clip.mp4','https://cdn.example/sound.mp3','https://cdn.example/file.pdf'
  ]);
  const tree=parseDocument(rich.html);
  const refs=find(tree,'img').concat(find(tree,'video'),find(tree,'audio'),find(tree,'tg-document'));
  assert.equal(refs.length,4);
  for(const [index,node] of refs.entries()){
    const id=new URL(node.attribs.src).searchParams.get('id');
    assert.equal(id,rich.media[index].id);
    assert.match(node.attribs.src,/^tg:\/\/(photo|video|audio|document)\?id=/);
  }
  const stale=await post('/api/telegram/send',{initData:init(),html:'<img src="tg://photo?id=missing">'});
  assert.equal(stale.status,400);
});

test('browser publication entry opens the official Mini App without accepting a redirect target',async()=>{
  const res=await fetch(`http://127.0.0.1:${port}/telegram/open?url=https://example.com`,{redirect:'manual'});
  assert.equal(res.status,302);
  assert.equal(res.headers.get('location'),'https://t.me/mdtxtrt_test_bot?startapp');
});
