import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {parseDocument} from 'htmlparser2';

const token='123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
const port=18137;
const origin='https://mdtxtrt.example';
let child,dir;

function init(user=7){
  const q=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:user})});
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  q.set('hash',createHmac('sha256',secret).update([...q].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  return q.toString();
}
function calls(){
  try{return readFileSync(join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}
  catch{return [];}
}
function lastCall(method){return calls().filter(call=>call.method===method).at(-1);}
function find(node,tag,out=[]){for(const item of node.children||[]){if(item.name===tag)out.push(item);find(item,tag,out);}return out;}

async function start(){
  child=spawn(process.execPath,['--import','./tests/mocks.mjs','server.mjs'],{
    cwd:new URL('../',import.meta.url),
    env:{
      ...process.env,
      PORT:String(port),
      TOKEN:token,
      RAILWAY_VOLUME_MOUNT_PATH:dir,
      MINI_APP_URL:origin+'/',
      PUBLIC_BASE_URL:origin+'/',
      TEST_CALLS:join(dir,'calls')
    },
    stdio:['ignore','pipe','pipe']
  });
  let stderr='';
  child.stderr.on('data',chunk=>stderr+=chunk);
  for(let i=0;i<50;i++){
    try{const res=await fetch(`http://127.0.0.1:${port}/`);if(res.ok)return;}
    catch{}
    if(child.exitCode!==null)throw new Error('Server exited: '+stderr);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Server did not start: '+stderr);
}
async function formPost(path,fields,file){
  const form=new FormData();
  for(const [key,value] of Object.entries(fields))form.set(key,String(value));
  if(file)form.set('upload',file.blob,file.name);
  const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{origin},body:form});
  return {status:res.status,data:await res.json()};
}
async function jsonPost(path,body){
  const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:res.status,data:await res.json()};
}

before(async()=>{
  dir=mkdtempSync(join(process.cwd(),'.test-data-'));
  mkdirSync(join(dir,'handoffs'),{recursive:true});
  await start();
});
after(async()=>{
  if(child){
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve)).catch(()=>{});
  }
  if(dir)rmSync(dir,{recursive:true,force:true});
});

test('serves vector app icon and no raster app icon',async()=>{
  assert.equal((await fetch(`http://127.0.0.1:${port}/logo.svg`)).status,200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/logo.png`)).status,404);
});

test('session endpoint accepts current signed initData and rejects invalid data',async()=>{
  assert.equal((await jsonPost('/api/telegram/session',{initData:init()})).status,200);
  assert.equal((await jsonPost('/api/telegram/session',{initData:'wrong'})).status,401);
});

test('HTTP media URLs become native Rich Message media references',async()=>{
  const html='<figure><img src="https://cdn.example/photo.png"><video src="https://cdn.example/clip.mp4"></video><audio src="https://cdn.example/sound.mp3"></audio><tg-document src="https://cdn.example/file.pdf"></tg-document></figure>';
  const res=await formPost('/api/telegram/send',{initData:init(),html});
  assert.equal(res.status,200);
  const rich=lastCall('sendRichMessage').body.rich_message;
  assert.deepEqual(rich.media.map(item=>item.media.type),['photo','video','audio','document']);
  assert.deepEqual(rich.media.map(item=>item.media.media),[
    'https://cdn.example/photo.png',
    'https://cdn.example/clip.mp4',
    'https://cdn.example/sound.mp3',
    'https://cdn.example/file.pdf'
  ]);
  const tree=parseDocument(rich.html);
  const refs=find(tree,'img').concat(find(tree,'video'),find(tree,'audio'),find(tree,'tg-document'));
  assert.equal(refs.length,4);
  for(const [index,node] of refs.entries()){
    const id=new URL(node.attribs.src).searchParams.get('id');
    assert.equal(id,rich.media[index].id);
    assert.match(node.attribs.src,/^tg:\/\/(photo|video|audio|document)\?id=/);
  }
});

test('local attachment is represented as attach upload and stale tg media is rejected',async()=>{
  const id='media1';
  const html=`<figure><img src="tg://photo?id=${id}"><figcaption>Imagem</figcaption></figure>`;
  const file={name:'photo.png',blob:new Blob([new Uint8Array([0x89,0x50,0x4e,0x47])],{type:'image/png'})};
  const sent=await formPost('/api/telegram/send',{initData:init(),html,kind:'image',id},file);
  assert.equal(sent.status,200);
  const call=lastCall('sendRichMessage');
  const rich=JSON.parse(call.body.rich_message);
  assert.deepEqual(rich.media,[{id,media:{type:'photo',media:'attach://upload'}}]);
  const stale=await formPost('/api/telegram/send',{initData:init(),html:'<img src="tg://photo?id=missing">'});
  assert.equal(stale.status,400);
});

test('server rejects invalid web-app, copy-text and reference contracts before Telegram',async()=>{
  const badWeb=await formPost('/api/telegram/send',{initData:init(),html:'<tg-button-row><tg-button type="web_app" url="http://example.com">Open</tg-button></tg-button-row>'});
  assert.equal(badWeb.status,400);
  const long='x'.repeat(257);
  const badCopy=await formPost('/api/telegram/send',{initData:init(),html:`<tg-button-row><tg-button type="copy_text" text="${long}">Copy</tg-button></tg-button-row>`});
  assert.equal(badCopy.status,400);
  const badRef=await formPost('/api/telegram/send',{initData:init(),html:'<p><tg-reference name="bad space">Ref</tg-reference></p>'});
  assert.equal(badRef.status,400);
});

test('corrupt persisted handoff is discarded instead of breaking requests',async()=>{
  const handoff='a'.repeat(32);
  writeFileSync(join(dir,'handoffs',handoff+'.json'),'{bad json');
  const res=await fetch(`http://127.0.0.1:${port}/telegram/open?handoff=${handoff}`,{redirect:'manual'});
  assert.equal(res.status,410);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);
});

test('handoff persists valid document metadata and attachment',async()=>{
  const id='handoffmedia1',doc='44444444-4444-4444-8444-444444444444';
  const draft={version:2,name:'Continuidade',html:`<p>Texto</p><figure><img data-media-id="${id}"><figcaption>foto.png</figcaption></figure>`,dest:'telegram',telegraphPath:'',docId:doc,importedMd:'',importedTxt:'',importedHtml:'',media:{id,kind:'image'}};
  const file={name:'foto.png',blob:new Blob([new Uint8Array([1,2,3,4,5])],{type:'image/png'})};
  const form=new FormData();
  form.set('draft',JSON.stringify(draft));
  form.set('upload',file.blob,file.name);
  const res=await fetch(`http://127.0.0.1:${port}/api/handoff`,{method:'POST',headers:{origin},body:form});
  assert.equal(res.status,200);
  const made=await res.json();
  assert.match(made.token,/^[a-f0-9]{32}$/);
  const claimed=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(claimed.status,200);
  assert.equal(claimed.data.draft.name,'Continuidade');
  assert.equal(claimed.data.file.id,id);
});

test('Telegraph ownership mapping survives create and edit on same document',async()=>{
  const page={title:'Página',doc:'33333333-3333-4333-8333-333333333333',content:[{tag:'h3',children:['Título']},{tag:'p',children:['texto']}],initData:init()};
  const created=await jsonPost('/api/telegraph/publish',page);
  assert.equal(created.status,200);
  assert.equal(created.data.path,'test-page-regression');
  const edited=await jsonPost('/api/telegraph/publish',{...page,title:'Página revisada',path:created.data.path});
  assert.equal(edited.status,200);
  assert.equal(edited.data.path,created.data.path);
});


test('handoff rejects draft media metadata that cannot be restored by the client',async()=>{
  const doc='55555555-5555-4555-8555-555555555555';
  const base={version:2,name:'Draft',dest:'telegram',telegraphPath:'',docId:doc,importedMd:'',importedTxt:'',importedHtml:''};
  const stale={...base,html:'<p>texto</p>',media:{id:'ghost',kind:'image'}};
  const staleForm=new FormData();staleForm.set('draft',JSON.stringify(stale));
  const staleRes=await fetch(`http://127.0.0.1:${port}/api/handoff`,{method:'POST',headers:{origin},body:staleForm});
  assert.equal(staleRes.status,400);

  const multiple={...base,html:'<figure><img data-media-id="one"></figure><figure><img data-media-id="two"></figure>',media:{id:'one',kind:'image'}};
  const multiForm=new FormData();multiForm.set('draft',JSON.stringify(multiple));
  const multiRes=await fetch(`http://127.0.0.1:${port}/api/handoff`,{method:'POST',headers:{origin},body:multiForm});
  assert.equal(multiRes.status,400);
});
