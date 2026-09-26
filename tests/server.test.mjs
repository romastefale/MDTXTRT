import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';

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
});
test('initData validation and Rich HTML rejection',async()=>{
  assert.equal((await post('/api/telegram/session',{initData:init()})).status,200);
  assert.equal((await post('/api/telegram/session',{initData:'wrong'})).status,401);
  const bad=await post('/api/telegram/send',{initData:'wrong',html:'<p>ok</p>'});
  assert.equal(bad.status,400);
  assert.match(bad.data.error,/inválida/);
  const markup=await post('/api/telegram/send',{initData:init(),html:'<script>alert(1)</script>'});
  assert.notEqual(markup.status,200);
  assert.match(markup.data.error,/inválido|não aceita/);
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
test('webhook and legacy export are protected',async()=>{
  assert.equal((await fetch(`http://127.0.0.1:${port}/telegram/webhook`,{method:'POST',body:'{}'})).status,401);
  assert.equal((await post('/api/telegram/export',{})).status,405);
});
test('start command offers green Mini App and red browser buttons',async()=>{
  const secret=createHmac('sha256',token).update('MDTXTRT_WEBHOOK').digest('hex');
  const res=await fetch(`http://127.0.0.1:${port}/telegram/webhook`,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify({message:{text:'/start',message_id:3,chat:{id:7,type:'private'}}})});
  assert.equal(res.status,200);
  const calls=readFileSync(join(dir,'calls'),'utf8').trim().split('\n');
  const html=JSON.parse(calls.at(-1)).rich_message.html;
  assert.match(html,/<tg-button type="web_app" style="success"[^>]+>Mini App MDTXTRT<\/tg-button>/);
  assert.match(html,/<tg-button type="url" style="danger" url="https:\/\/mdtxtrt\.up\.railway\.app\/">Abrir MDTXTRT no browser<\/tg-button>/);
  assert.doesNotMatch(html,/<a\b/);
});

test('Rich Message send and Telegraph create/edit on same owned document',async()=>{
  const sent=await post('/api/telegram/send',{initData:init(),html:'<h1>Olá</h1><p><strong>Teste</strong></p>'});
  assert.equal(sent.status,200);
  assert.equal(sent.data.via,'sendRichMessage');
  const page={title:'Página',doc:'33333333-3333-4333-8333-333333333333',content:[{tag:'h3',children:['Título']},{tag:'p',children:['texto']}],initData:init()};
  const created=await post('/api/telegraph/publish',page);
  assert.equal(created.status,200);
  assert.equal(created.data.path,'test-page-09-26');
  assert.equal(readFileSync(join(dir,'telegraph-token'),'utf8'),'persistent-test-token');
  await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  await start();
  const edited=await post('/api/telegraph/publish',{...page,path:created.data.path,title:'Página revisada'});
  assert.equal(edited.status,200);
  assert.equal(edited.data.path,created.data.path);
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
});
