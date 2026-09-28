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
function callCount(method){return calls().filter(call=>call.method===method).length;}
async function publishHandoffFixture({doc,html='<p>Transferência</p>'}){
  const draft={version:2,name:'Transferência',html,dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:null};
  const action={type:'publish',html,kind:'',id:''};
  const form=new FormData();
  form.set('draft',JSON.stringify(draft));
  form.set('action',JSON.stringify(action));
  const res=await fetch(`http://127.0.0.1:${port}/api/handoff`,{method:'POST',headers:{origin},body:form});
  const data=await res.json();
  assert.equal(res.status,200,data.error);
  return {draft,token:data.token,open:data.open};
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

test('Telegram request errors are typed independently from upstream failures',async()=>{
  const invalid=await formPost('/api/telegram/send',{initData:init(),html:'<p><code class="language-js">x</code></p>'});
  assert.equal(invalid.status,400);
  const upstream=await formPost('/api/telegram/send',{initData:init(),html:'<p>UPSTREAM_REJECT</p>'});
  assert.equal(upstream.status,502);
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

test('Rich Message uploads enforce media-kind MIME and photo size locally',async()=>{
  const badId='badphoto1';
  const badHtml=`<figure><img src="tg://photo?id=${badId}"><figcaption>Imagem</figcaption></figure>`;
  const wrongMime={name:'not-a-photo.txt',blob:new Blob(['text'],{type:'text/plain'})};
  const wrong=await formPost('/api/telegram/send',{initData:init(),html:badHtml,kind:'image',id:badId},wrongMime);
  assert.equal(wrong.status,400);

  const largeId='largephoto1';
  const largeHtml=`<figure><img src="tg://photo?id=${largeId}"><figcaption>Grande</figcaption></figure>`;
  const large={name:'large.jpg',blob:new Blob([new Uint8Array(10_000_001)],{type:'image/jpeg'})};
  const oversized=await formPost('/api/telegram/send',{initData:init(),html:largeHtml,kind:'image',id:largeId},large);
  assert.equal(oversized.status,400);
  assert.match(oversized.data.error,/10 MB/);

  const docId='textdoc1';
  const docHtml=`<figure><tg-document src="tg://document?id=${docId}"></tg-document><figcaption>Arquivo</figcaption></figure>`;
  const documentFile={name:'notes.txt',blob:new Blob(['notes'],{type:'text/plain'})};
  const document=await formPost('/api/telegram/send',{initData:init(),html:docHtml,kind:'document',id:docId},documentFile);
  assert.equal(document.status,200,document.data.error);
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

test('Rich HTML RichText-only containers reject nested block markup locally',async()=>{
  const expandable=await formPost('/api/telegram/send',{initData:init(),html:'<blockquote expandable><p>x</p></blockquote>'});
  assert.equal(expandable.status,400);
  const pullquote=await formPost('/api/telegram/send',{initData:init(),html:'<aside><p>x</p></aside>'});
  assert.equal(pullquote.status,400);
  const caption=await formPost('/api/telegram/send',{initData:init(),html:'<figure><img src="https://example.com/x.jpg"><figcaption><p>x</p></figcaption></figure>'});
  assert.equal(caption.status,400);
  const summary=await formPost('/api/telegram/send',{initData:init(),html:'<details><summary><p>x</p></summary>Body</details>'});
  assert.equal(summary.status,400);
  const formula=await formPost('/api/telegram/send',{initData:init(),html:'<tg-math><b>x</b></tg-math>'});
  assert.equal(formula.status,400);
  const nestedAnchor=await formPost('/api/telegram/send',{initData:init(),html:'<p><a name="section"></a></p>'});
  assert.equal(nestedAnchor.status,400);
  const valid=await formPost('/api/telegram/send',{initData:init(),html:'<a name="section"></a><blockquote expandable>Quote<br><cite>Author</cite></blockquote><aside>Pull <cite>Author</cite></aside><tg-math>x^2</tg-math>'});
  assert.equal(valid.status,200,valid.data.error);
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

test('Rich Message text limits include Unicode text and custom emoji alternatives',async()=>{
  const valid=await formPost('/api/telegram/send',{initData:init(),html:'<p>'+ 'á'.repeat(20000)+'</p>'});
  assert.equal(valid.status,200);
  const emoji='<img src="tg://emoji?id=5368324170671202286" alt="👍">';
  const emojiBoundary=await formPost('/api/telegram/send',{initData:init(),html:'<p>'+ 'a'.repeat(32767)+'</p>'+emoji});
  assert.equal(emojiBoundary.status,200);
  const emojiOverflow=await formPost('/api/telegram/send',{initData:init(),html:'<p>'+ 'a'.repeat(32768)+'</p>'+emoji});
  assert.equal(emojiOverflow.status,400);
  assert.match(emojiOverflow.data.error,/32768 caracteres/);
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


test('handoff recovery is passive and confirmed publication result survives reopen and backend restart',async()=>{
  const made=await publishHandoffFixture({doc:'61616161-6161-4616-8616-616161616161'});
  const before=callCount('sendRichMessage');

  const firstClaim=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(firstClaim.status,200,firstClaim.data.error);
  assert.equal(firstClaim.data.draft.action,undefined);
  assert.equal(firstClaim.data.action.status,'pending');
  assert.equal(firstClaim.data.action.attempts,0);
  assert.equal(callCount('sendRichMessage'),before);

  await restart();
  const reopenedPending=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(reopenedPending.status,200,reopenedPending.data.error);
  assert.equal(reopenedPending.data.action.status,'pending');
  assert.equal(callCount('sendRichMessage'),before);

  const sent=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(sent.status,200,sent.data.error);
  assert.equal(sent.data.reused,false);
  assert.equal(sent.data.action.status,'succeeded');
  assert.deepEqual(sent.data.result,{via:'sendRichMessage',messageId:42});
  assert.equal(callCount('sendRichMessage'),before+1);

  const duplicate=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(duplicate.status,200,duplicate.data.error);
  assert.equal(duplicate.data.reused,true);
  assert.equal(duplicate.data.action.status,'succeeded');
  assert.deepEqual(duplicate.data.result,{via:'sendRichMessage',messageId:42});
  assert.equal(callCount('sendRichMessage'),before+1);

  await restart();
  const reopenedDone=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(reopenedDone.status,200,reopenedDone.data.error);
  assert.equal(reopenedDone.data.action.status,'succeeded');
  assert.deepEqual(reopenedDone.data.action.result,{via:'sendRichMessage',messageId:42});
  assert.equal(callCount('sendRichMessage'),before+1);

  const afterRestart=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(afterRestart.status,200,afterRestart.data.error);
  assert.equal(afterRestart.data.reused,true);
  assert.equal(callCount('sendRichMessage'),before+1);
});

test('handoff transport failure becomes uncertain and the same handoff cannot silently resend',async()=>{
  const made=await publishHandoffFixture({doc:'62626262-6262-4626-8626-626262626262',html:'<p>UPSTREAM_TIMEOUT</p>'});
  const before=callCount('sendRichMessage');
  const claimed=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(claimed.status,200);
  assert.equal(claimed.data.action.status,'pending');

  const attempt=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(attempt.status,409);
  assert.equal(attempt.data.action.status,'uncertain');
  assert.equal(attempt.data.action.attempts,1);
  assert.match(attempt.data.action.error,/conectar ao Telegram/);
  assert.equal(callCount('sendRichMessage'),before+1);

  const retry=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(retry.status,409);
  assert.equal(retry.data.reused,true);
  assert.equal(retry.data.action.status,'uncertain');
  assert.equal(callCount('sendRichMessage'),before+1);

  const status=await jsonPost('/api/handoff/status',{initData:init(),token:made.token});
  assert.equal(status.status,200);
  assert.equal(status.data.action.status,'uncertain');
  assert.equal(callCount('sendRichMessage'),before+1);
});

test('backend restart during an in-flight handoff marks delivery uncertain instead of retrying',async()=>{
  const made=await publishHandoffFixture({doc:'63636363-6363-4636-8636-636363636363'});
  const claimed=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(claimed.status,200);
  const path=join(dir,'handoffs',made.token+'.json');
  const persisted=JSON.parse(readFileSync(path,'utf8'));
  persisted.action.status='sending';
  persisted.action.attempts=1;
  persisted.action.startedAt=Date.now();
  persisted.action.finishedAt=0;
  persisted.action.serverBootId='interrupted-backend';
  persisted.action.error='';
  persisted.action.result=null;
  writeFileSync(path,JSON.stringify(persisted),{mode:0o600});
  const before=callCount('sendRichMessage');

  await restart();
  const reopened=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(reopened.status,200,reopened.data.error);
  assert.equal(reopened.data.action.status,'uncertain');
  assert.match(reopened.data.action.error,/reiniciado durante o envio/);
  assert.equal(callCount('sendRichMessage'),before);

  const blocked=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(blocked.status,409);
  assert.equal(blocked.data.action.status,'uncertain');
  assert.equal(callCount('sendRichMessage'),before);
});

test('same-process orphaned sending state becomes uncertain without another Telegram call',async()=>{
  const made=await publishHandoffFixture({doc:'65656565-6565-4656-8656-656565656565',html:'<p>UPSTREAM_DELAY</p>'});
  await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  const path=join(dir,'handoffs',made.token+'.json');
  const publishing=jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  let sending=null;
  for(let i=0;i<30;i++){
    try{
      const state=JSON.parse(readFileSync(path,'utf8'));
      if(state.action?.status==='sending'){sending=state;break;}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(sending,'sending state was not persisted before the external call');
  assert.match(sending.action.serverBootId,/^[a-f0-9-]{36}$/i);
  const bootId=sending.action.serverBootId;
  const sent=await publishing;
  assert.equal(sent.status,200,sent.data.error);
  const before=callCount('sendRichMessage');

  const orphan=JSON.parse(readFileSync(path,'utf8'));
  orphan.action.status='sending';
  orphan.action.result=null;
  orphan.action.error='';
  orphan.action.finishedAt=0;
  orphan.action.serverBootId=bootId;
  writeFileSync(path,JSON.stringify(orphan),{mode:0o600});

  const reopened=await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});
  assert.equal(reopened.status,200,reopened.data.error);
  assert.equal(reopened.data.action.status,'uncertain');
  assert.match(reopened.data.action.error,/interrompido antes de registrar/);
  assert.equal(callCount('sendRichMessage'),before);

  const blocked=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(blocked.status,409);
  assert.equal(blocked.data.action.status,'uncertain');
  assert.equal(callCount('sendRichMessage'),before);
});

test('confirmed Telegram rejection records failed state and only an explicit new authorization retries',async()=>{
  const made=await publishHandoffFixture({doc:'64646464-6464-4646-8646-646464646464',html:'<p>UPSTREAM_REJECT</p>'});
  const before=callCount('sendRichMessage');
  await jsonPost('/api/handoff/claim',{initData:init(),token:made.token});

  const failed=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(failed.status,502);
  assert.equal(failed.data.action.status,'failed');
  assert.equal(failed.data.action.attempts,1);
  assert.equal(callCount('sendRichMessage'),before+1);

  const status=await jsonPost('/api/handoff/status',{initData:init(),token:made.token});
  assert.equal(status.status,200);
  assert.equal(status.data.action.status,'failed');
  assert.equal(callCount('sendRichMessage'),before+1);

  const explicitRetry=await jsonPost('/api/handoff/publish',{initData:init(),token:made.token});
  assert.equal(explicitRetry.status,502);
  assert.equal(explicitRetry.data.action.status,'failed');
  assert.equal(explicitRetry.data.action.attempts,2);
  assert.equal(callCount('sendRichMessage'),before+2);
});

test('startup fails closed when Telegraph page ownership survives credential loss',async()=>{
  const isolated=mkdtempSync(join(process.cwd(),'.test-orphan-'));
  const isolatedPort=18138;
  mkdirSync(join(isolated,'handoffs'),{recursive:true});
  writeFileSync(join(isolated,'telegraph-token-pages.json'),JSON.stringify({
    '7:44444444-4444-4444-8444-444444444444':'owned-page'
  }),{mode:0o600});
  const callsPath=join(isolated,'calls');
  let proc,stderr='';
  try{
    proc=spawn(process.execPath,['--import','./tests/mocks.mjs','server.mjs'],{
      cwd:new URL('../',import.meta.url),
      env:{
        ...process.env,
        PORT:String(isolatedPort),
        TOKEN:token,
        RAILWAY_VOLUME_MOUNT_PATH:isolated,
        MINI_APP_URL:origin+'/',
        PUBLIC_BASE_URL:origin+'/',
        TEST_CALLS:callsPath
      },
      stdio:['ignore','pipe','pipe']
    });
    proc.stderr.on('data',chunk=>stderr+=chunk);
    const exitCode=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        proc.kill();
        reject(new Error('orphaned Telegraph state did not stop startup'));
      },8000);
      proc.once('exit',code=>{clearTimeout(timer);resolve(code);});
    });
    assert.notEqual(exitCode,0);
    assert.match(stderr,/Credencial Telegraph ausente para páginas persistidas/);
    let logged='';
    try{logged=readFileSync(callsPath,'utf8');}catch{}
    assert.doesNotMatch(logged,/"method":"createAccount"/);
  }finally{
    if(proc&&proc.exitCode===null){
      proc.kill();
      await new Promise(resolve=>proc.once('exit',resolve)).catch(()=>{});
    }
    rmSync(isolated,{recursive:true,force:true});
  }
});

test('Telegraph title limit counts Unicode characters instead of UTF-16 code units',async()=>{
  const content=[{tag:'p',children:['texto']}];
  const atLimit=await jsonPost('/api/telegraph/publish',{
    title:'😀'.repeat(256),
    doc:'55555555-5555-4555-8555-555555555555',
    content,
    initData:init()
  });
  assert.equal(atLimit.status,200,atLimit.data.error);
  const overLimit=await jsonPost('/api/telegraph/publish',{
    title:'😀'.repeat(257),
    doc:'66666666-6666-4666-8666-666666666666',
    content,
    initData:init()
  });
  assert.equal(overLimit.status,400);
  assert.match(overLimit.data.error,/256 caracteres/);
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


test('Telegraph browser capability can create, recover and edit without Telegram initData',async()=>{
  const browserKey='ab'.repeat(32);
  const otherKey='cd'.repeat(32);
  const doc='99999999-9999-4999-8999-999999999999';
  const base={title:'Browser page',doc,content:[{tag:'p',children:['texto']}],browserKey};
  const created=await jsonPost('/api/telegraph/publish',base);
  assert.equal(created.status,200,created.data.error);
  assert.equal(created.data.path,'test-page-regression');

  const recovered=await jsonPost('/api/telegraph/recover',{doc,browserKey});
  assert.equal(recovered.status,200,recovered.data.error);
  assert.equal(recovered.data.path,created.data.path);

  const edited=await jsonPost('/api/telegraph/publish',{...base,title:'Browser page edited',path:created.data.path});
  assert.equal(edited.status,200,edited.data.error);

  const wrongOwner=await jsonPost('/api/telegraph/publish',{...base,browserKey:otherKey,path:created.data.path});
  assert.equal(wrongOwner.status,400);
  assert.match(wrongOwner.data.error,/não pertence/);

  const ambiguous=await jsonPost('/api/telegraph/publish',{...base,initData:init()});
  assert.equal(ambiguous.status,400);
  assert.match(ambiguous.data.error,/ambígua/);
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

test('Telegraph request errors are typed independently from upstream failures',async()=>{
  const doc='55555555-5555-4555-8555-555555555555';
  const invalid=await jsonPost('/api/telegraph/publish',{title:'',doc,content:[{tag:'p',children:['x']}],initData:init()});
  assert.equal(invalid.status,400);
  const upstream=await jsonPost('/api/telegraph/publish',{title:'UPSTREAM_REJECT',doc,content:[{tag:'p',children:['x']}],initData:init()});
  assert.equal(upstream.status,502);
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


test('Telegraph publish and recovery responses are bound to the originating document revision',async()=>{
  const browserKey='ef'.repeat(32);
  const doc='12121212-1212-4212-8212-121212121212';
  const created=await jsonPost('/api/telegraph/publish',{
    title:'Revision-bound page',
    doc,
    revision:7,
    content:[{tag:'p',children:['texto']}],
    browserKey
  });
  assert.equal(created.status,200,created.data.error);
  assert.equal(created.data.doc,doc);
  assert.equal(created.data.revision,7);
  assert.equal(created.data.path,'test-page-regression');

  const recovered=await jsonPost('/api/telegraph/recover',{doc,revision:8,browserKey});
  assert.equal(recovered.status,200,recovered.data.error);
  assert.equal(recovered.data.doc,doc);
  assert.equal(recovered.data.revision,8);
  assert.equal(recovered.data.path,created.data.path);

  const invalid=await jsonPost('/api/telegraph/recover',{doc,revision:-1,browserKey});
  assert.equal(invalid.status,400);
  assert.match(invalid.data.error,/Revisão do documento inválida/);
});
