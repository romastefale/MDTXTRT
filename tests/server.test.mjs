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
async function webhook(update,secret=true){
  const headers={'content-type':'application/json'};
  if(secret)headers['x-telegram-bot-api-secret-token']=createHmac('sha256',token).update('MDTXTRT_WEBHOOK').digest('hex');
  return fetch(`http://127.0.0.1:${port}/telegram/webhook`,{method:'POST',headers,body:JSON.stringify(update)});
}
async function restart(){
  if(child){
    child.kill();
    await new Promise(resolve=>child.once('exit',resolve));
  }
  await start();
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

test('official Rich HTML custom emoji and code-language contracts are preserved',async()=>{
  const emoji='<p>Olá <img src="tg://emoji?id=5368324170671202286" alt="👍"></p>';
  const emojiRes=await formPost('/api/telegram/send',{initData:init(),html:emoji});
  assert.equal(emojiRes.status,200);
  const emojiRich=lastCall('sendRichMessage').body.rich_message;
  assert.equal(emojiRich.media,undefined);
  assert.match(emojiRich.html,/tg:\/\/emoji\?id=5368324170671202286/);

  const noAlt=await formPost('/api/telegram/send',{initData:init(),html:'<p><img src="tg://emoji?id=5368324170671202286"></p>'});
  assert.equal(noAlt.status,400);

  const standalone=await formPost('/api/telegram/send',{initData:init(),html:'<p><code class="language-js">const x=1</code></p>'});
  assert.equal(standalone.status,400);

  const nested=await formPost('/api/telegram/send',{initData:init(),html:'<pre><code class="language-js">const x=1</code></pre>'});
  assert.equal(nested.status,200);
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

test('Rich HTML list and table attributes are validated before Telegram',async()=>{
  const badList=await formPost('/api/telegram/send',{initData:init(),html:'<ol type="z"><li>item</li></ol>'});
  assert.equal(badList.status,400);
  const badCell=await formPost('/api/telegram/send',{initData:init(),html:'<table><tr><td align="justify">x</td></tr></table>'});
  assert.equal(badCell.status,400);
  const nestedBlock=await formPost('/api/telegram/send',{initData:init(),html:'<table><tr><td><p>x</p></td></tr></table>'});
  assert.equal(nestedBlock.status,400);
  const valid=await formPost('/api/telegram/send',{initData:init(),html:'<ol start="3" type="a" reversed><li value="7" type="i">item</li></ol><table compact><tr><td colspan="2" rowspan="2" align="center" valign="middle">x</td></tr></table>'});
  assert.equal(valid.status,200);
});

test('Rich HTML details and button-row containers reject malformed structure locally',async()=>{
  const details=await formPost('/api/telegram/send',{initData:init(),html:'<details><p>x</p></details>'});
  assert.equal(details.status,400);
  const emptyRow=await formPost('/api/telegram/send',{initData:init(),html:'<tg-button-row></tg-button-row>'});
  assert.equal(emptyRow.status,400);
  const mixedRow=await formPost('/api/telegram/send',{initData:init(),html:'<tg-button-row><span>x</span><tg-button type="disabled">x</tg-button></tg-button-row>'});
  assert.equal(mixedRow.status,400);
  const valid=await formPost('/api/telegram/send',{initData:init(),html:'<details open><summary>Title</summary>Content</details><tg-button-row align="center"><tg-button type="disabled">x</tg-button></tg-button-row>'});
  assert.equal(valid.status,200);
});

test('Rich Message buttons enforce one action contract and official button URL schemes',async()=>{
  const before=calls().filter(call=>call.method==='sendRichMessage').length;
  const wrongAction=await formPost('/api/telegram/send',{initData:init(),html:'<tg-button-row><tg-button type="disabled" data="x">Disabled</tg-button></tg-button-row>'});
  assert.equal(wrongAction.status,400);
  const wrongScheme=await formPost('/api/telegram/send',{initData:init(),html:'<tg-button-row><tg-button type="url" url="mailto:user@example.com">Email</tg-button></tg-button-row>'});
  assert.equal(wrongScheme.status,400);
  const optionalQuery=await formPost('/api/telegram/send',{initData:init(),html:'<tg-button-row><tg-button type="switch_inline_query_chosen_chat" allow-user-chats>Choose chat</tg-button></tg-button-row>'});
  assert.equal(optionalQuery.status,200);
  assert.equal(calls().filter(call=>call.method==='sendRichMessage').length,before+1);
});

test('Rich Message text limits use Unicode characters and button text stays within the Bot API contract',async()=>{
  const valid=await formPost('/api/telegram/send',{initData:init(),html:'<p>'+ 'á'.repeat(20000)+'</p>'});
  assert.equal(valid.status,200);
  const tooLong=await formPost('/api/telegram/send',{initData:init(),html:'<p>'+ 'a'.repeat(32769)+'</p>'});
  assert.equal(tooLong.status,400);
  assert.match(tooLong.data.error,/32768 caracteres/);
  const invalidButton=await formPost('/api/telegram/send',{initData:init(),html:'<tg-button-row><tg-button type="callback_data" data="open"><b>Open</b></tg-button></tg-button-row>'});
  assert.equal(invalidButton.status,400);
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


test('stale signed Telegram sessions are rejected',async()=>{
  const stale=new URLSearchParams(init());
  stale.set('auth_date',String(Math.floor(Date.now()/1000)-86401));
  stale.delete('hash');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  stale.set('hash',createHmac('sha256',secret).update([...stale].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  assert.equal((await jsonPost('/api/telegram/session',{initData:stale.toString()})).status,401);
});

test('invalid Rich Message input is rejected before Telegram is called',async()=>{
  const before=calls().filter(call=>call.method==='sendRichMessage').length;
  const auth=await formPost('/api/telegram/send',{initData:'wrong',html:'<p>ok</p>'});
  assert.equal(auth.status,400);
  const markup=await formPost('/api/telegram/send',{initData:init(),html:'<script>alert(1)</script>'});
  assert.equal(markup.status,400);
  assert.equal(calls().filter(call=>call.method==='sendRichMessage').length,before);
});

test('webhook authentication and bot command responses retain their contracts',async()=>{
  assert.equal((await webhook({message:{text:'/start',message_id:1,chat:{id:7,type:'private'}}},false)).status,401);
  const registered=lastCall('setMyCommands')?.body?.commands?.map(item=>item.command)||[];
  for(const name of ['start','app','novo','ajuda','enviar','exportar'])assert.ok(registered.includes(name),name);

  for(const [text,message_id] of [['/start',11],['/app',12],['/novo',13],['/ajuda',14]]){
    const res=await webhook({message:{text,message_id,chat:{id:7,type:'private'}}});
    assert.equal(res.status,200,text);
  }
  const richCalls=calls().filter(call=>call.method==='sendRichMessage');
  const start=parseDocument(richCalls.at(-4).body.rich_message.html);
  const buttons=find(start,'tg-button');
  assert.equal(buttons.length,2);
  assert.equal(buttons[0].attribs.type,'web_app');
  assert.equal(buttons[0].attribs.url,origin+'/');
  assert.equal(buttons[1].attribs.type,'url');
  assert.equal(buttons[1].attribs.url,origin+'/');
  assert.match(richCalls.at(-1).body.rich_message.html,/\/exportar/);
});

test('enviar, exportar, callbacks and group commands produce explicit Telegram actions',async()=>{
  let res=await webhook({message:{text:'/enviar Olá forte',entities:[{type:'bold',offset:12,length:5}],message_id:21,chat:{id:7,type:'private'}}});
  assert.equal(res.status,200);
  let sent=lastCall('sendRichMessage');
  assert.deepEqual(sent.body.reply_parameters,{message_id:21});
  assert.equal(sent.body.rich_message.html,'<p>Olá <b>forte</b></p>');

  res=await webhook({message:{text:'/exportar txt linha literal',message_id:22,chat:{id:7,type:'private'}}});
  assert.equal(res.status,200);
  const document=lastCall('sendDocument');
  assert.equal(document.body.document.name,'mdtxtrt.txt');
  assert.equal(document.body.document.text,'linha literal');

  res=await webhook({callback_query:{id:'cb1',data:'abrir',from:{id:7}}});
  assert.equal(res.status,200);
  assert.deepEqual(lastCall('answerCallbackQuery').body,{callback_query_id:'cb1',text:'abrir'});

  res=await webhook({message:{text:'/app',message_id:23,chat:{id:-2,type:'group'}}});
  assert.equal(res.status,200);
  assert.match(lastCall('sendRichMessage').body.rich_message.html,/chat privado/);
});

test('Telegraph path ownership is scoped to the authenticated user and document',async()=>{
  const doc='66666666-6666-4666-8666-666666666666';
  const base={title:'Owned',doc,content:[{tag:'p',children:['texto']}],initData:init()};
  const created=await jsonPost('/api/telegraph/publish',base);
  assert.equal(created.status,200);
  const otherUser=await jsonPost('/api/telegraph/publish',{...base,initData:init(8),path:created.data.path});
  assert.equal(otherUser.status,400);
  assert.match(otherUser.data.error,/não pertence/);
  const otherDoc=await jsonPost('/api/telegraph/publish',{...base,doc:'77777777-7777-4777-8777-777777777777',path:created.data.path});
  assert.equal(otherDoc.status,400);
  assert.match(otherDoc.data.error,/não pertence/);
});

test('handoff attachment survives backend restart and remains session-bound',async()=>{
  const id='restartmedia1',doc='88888888-8888-4888-8888-888888888888';
  const draft={version:2,name:'Restart',html:`<figure><img data-media-id="${id}"><figcaption>foto.png</figcaption></figure>`,dest:'telegram',telegraphPath:'',docId:doc,importedMd:'',importedTxt:'',importedHtml:'',media:{id,kind:'image'}};
  const form=new FormData();
  form.set('draft',JSON.stringify(draft));
  form.set('upload',new Blob([new Uint8Array([1,2,3,4,5])],{type:'image/png'}),'foto.png');
  let res=await fetch(`http://127.0.0.1:${port}/api/handoff`,{method:'POST',headers:{origin},body:form});
  assert.equal(res.status,200);
  const made=await res.json();
  await restart();

  res=await fetch(`http://127.0.0.1:${port}/telegram/open?handoff=${made.token}`,{redirect:'manual'});
  assert.equal(res.status,302);
  assert.equal(res.headers.get('location'),`https://t.me/mdtxtrt_test_bot?startapp=h_${made.token}`);

  const wrong=await jsonPost('/api/handoff/claim',{initData:init(8),token:made.token});
  assert.equal(wrong.status,200);
  const ownerMismatch=await jsonPost('/api/handoff/claim',{initData:init(7),token:made.token});
  assert.equal(ownerMismatch.status,400);

  res=await fetch(`http://127.0.0.1:${port}/api/handoff/file`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({initData:init(8),token:made.token})});
  assert.equal(res.status,200);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[1,2,3,4,5]);
});
