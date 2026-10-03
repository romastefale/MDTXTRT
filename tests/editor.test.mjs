import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {randomUUID} from 'node:crypto';
import {TextEncoder} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';

const root=new URL('../',import.meta.url);
const wait=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));

function memoryIndexedDB(){
  const rows=new Map();
  return {
    rows,
    open(){
      const req={};
      queueMicrotask(()=>{
        const store={
          put(value){rows.set(value.id,value);return {};},
          clear(){rows.clear();return {};},
          delete(id){rows.delete(id);return {};},
          get(id){const out={};queueMicrotask(()=>{out.result=rows.get(id);out.onsuccess?.();});return out;}
        };
        const db={
          objectStoreNames:{contains:()=>true},
          transaction(){
            const tx={objectStore:()=>store};
            queueMicrotask(()=>tx.oncomplete?.());
            return tx;
          },
          close(){}
        };
        req.result=db;req.onsuccess?.();
      });
      return req;
    }
  };
}

// A interface real (src/chrome.jsx), empacotada para rodar dentro da janela
// JSDOM como um script clássico, no lugar de uma marcação escrita à mão.
const chromeBundle=buildSync({
  stdin:{contents:'import {mountChrome} from "./src/chrome.jsx";mountChrome(document.getElementById("ux-root"));',resolveDir:fileURLToPath(root),loader:'js'},
  bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,logLevel:'silent',
  define:{'process.env.NODE_ENV':'"production"'}
}).outputFiles[0].text;

// O editor (src/app/*.js), empacotado como em ui.js e avaliado como script
// clássico. Para os testes inspecionarem o editor como faziam com o antigo
// app.js, as funções e constantes dos módulos e o estado (S) ficam visíveis na
// janela; a entrada é src/app/main.js, avaliada primeiro, como em produção.
const appModules=['main.js',...readdirSync(new URL('src/app/',root)).filter(name=>name.endsWith('.js')&&name!=='main.js').sort()];
const appBundle=buildSync({
  stdin:{contents:appModules.map((name,index)=>'import * as m'+index+' from "./src/app/'+name+'";').join('\n')+`
const expose=(name,descriptor)=>Object.defineProperty(window,name,{configurable:true,enumerable:true,...descriptor});
for(const module of [${appModules.map((_,index)=>'m'+index).join(',')}])for(const [name,value] of Object.entries(module))if(name!=='S')expose(name,{value,writable:true});
for(const name of Object.keys(m${appModules.indexOf('state.js')}.S))expose(name,{get:()=>m${appModules.indexOf('state.js')}.S[name],set:value=>{m${appModules.indexOf('state.js')}.S[name]=value;}});
`,resolveDir:fileURLToPath(root),loader:'js'},
  bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,logLevel:'silent'
}).outputFiles[0].text;

function page(setup={}){
  // Como o console padrão do JSDOM, mais o registro das navegações para outro
  // documento (location.assign), que o JSDOM não executa.
  const navigations=[];
  const virtualConsole=new VirtualConsole().forwardTo(console);
  virtualConsole.on('jsdomError',error=>{if(/navigation to another Document/.test(error.message))navigations.push(error);});
  const dom=new JSDOM(readFileSync(new URL('index.html',root),'utf8'),{
    virtualConsole,
    url:setup.url||'https://mdtxtrt.example/',
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const w=dom.window;
  w.__navigations=navigations;
  const timeouts=new Set(),intervals=new Set(),frames=new Set();
  const nativeSetTimeout=w.setTimeout.bind(w),nativeClearTimeout=w.clearTimeout.bind(w);
  const nativeSetInterval=w.setInterval.bind(w),nativeClearInterval=w.clearInterval.bind(w);
  const nativeRequestAnimationFrame=w.requestAnimationFrame.bind(w),nativeCancelAnimationFrame=w.cancelAnimationFrame.bind(w);
  w.setTimeout=(...args)=>{const id=nativeSetTimeout(...args);timeouts.add(id);return id;};
  w.clearTimeout=id=>{timeouts.delete(id);return nativeClearTimeout(id);};
  w.setInterval=(...args)=>{const id=nativeSetInterval(...args);intervals.add(id);return id;};
  w.clearInterval=id=>{intervals.delete(id);return nativeClearInterval(id);};
  w.requestAnimationFrame=callback=>{const id=nativeRequestAnimationFrame(callback);frames.add(id);return id;};
  w.cancelAnimationFrame=id=>{frames.delete(id);return nativeCancelAnimationFrame(id);};
  w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID,configurable:true});
  w.matchMedia=setup.matchMedia||(()=>({matches:true,addEventListener(){},removeEventListener(){}}));
  Object.defineProperty(w,'visualViewport',{value:{
    offsetLeft:0,offsetTop:0,width:390,height:800,
    addEventListener(){},removeEventListener(){},
    ...(setup.visualViewport||{})
  },configurable:true});
  if(!w.AbortSignal.timeout)w.AbortSignal.timeout=()=>new w.AbortController().signal;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.Range.prototype.getClientRects=function(){return [];};
  w.Range.prototype.getBoundingClientRect=function(){return {left:0,right:0,top:0,bottom:0,width:0,height:0};};
  w.HTMLElement.prototype.getClientRects=function(){return [];};
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,right:0,top:0,bottom:0,width:0,height:0};};
  w.URL.createObjectURL=setup.objectURL||(()=> 'blob:test');
  w.URL.revokeObjectURL=()=>{};
  if(setup.indexedDB)Object.defineProperty(w,'indexedDB',{value:setup.indexedDB,configurable:true});

  const realMatches=w.Element.prototype.matches;
  w.Element.prototype.matches=function(selector){
    if(selector===':popover-open')return this.hasAttribute('data-test-popover-open');
    return realMatches.call(this,selector);
  };
  const toggle=(el,state)=>{
    const ev=new w.Event('toggle');
    Object.defineProperty(ev,'newState',{value:state});
    el.dispatchEvent(ev);
  };
  w.HTMLElement.prototype.showPopover=function(){
    if(this.hasAttribute('data-test-popover-open'))return;
    if(setup.popoverBlursTyping&&w.document.activeElement?.blur)w.document.activeElement.blur();
    this.setAttribute('data-test-popover-open','');
    toggle(this,'open');
  };
  w.HTMLElement.prototype.hidePopover=function(){
    if(!this.hasAttribute('data-test-popover-open'))return;
    this.removeAttribute('data-test-popover-open');
    toggle(this,'closed');
  };

  for(const [key,value] of Object.entries(setup.local||{}))w.localStorage.setItem(key,value);
  w.__requests=[];
  w.fetch=setup.fetch||(async(url,options={})=>{
    w.__requests.push({url:String(url),options});
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  });

  if(setup.tg){
    const back={show(){},hide(){},onClick(){}};
    const settings={show(){},onClick(){}};
    const main={hide(){}};
    w.Telegram={WebApp:{
      initData:'signed-payload',
      colorScheme:'dark',
      ready(){},expand(){},
      setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},
      onEvent(){},
      SettingsButton:settings,
      BackButton:back,
      MainButton:main,
      openLink(){},
      ...setup.tg
    }};
  }

  for(const script of w.document.querySelectorAll('script:not([src])'))w.eval(script.textContent);
  w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.ResizeObserver??=class{observe(){}unobserve(){}disconnect(){}};
  w.eval(chromeBundle);
  w.eval(readFileSync(new URL('marked.js',root),'utf8'));
  w.eval(readFileSync(new URL('turndown.js',root),'utf8'));
  w.eval(readFileSync(new URL('editor-core.js',root),'utf8'));
  w.eval(appBundle);
  w.close=()=>{
    for(const id of timeouts)nativeClearTimeout(id);
    for(const id of intervals)nativeClearInterval(id);
    for(const id of frames)nativeCancelAnimationFrame(id);
    timeouts.clear();intervals.clear();frames.clear();
    try{w.eval('(()=>{clearTimeout(saveTimer);clearTimeout(remoteSaveTimer);const core=currentEditorCore?.();if(core)core.destroy();})()');}catch{}
    // Keep the JSDOM realm alive until the runner releases it so already-queued
    // MutationObserver/promise callbacks cannot dereference a closed document.
  };
  return w;
}

test('novo launch preserves the previous local draft and creates a distinct active document',async()=>{
  const token='a'.repeat(32);
  const oldDoc='12345678-1234-4123-8123-123456789abc';
  const raw=JSON.stringify({version:2,name:'Anterior',html:'<p>preservar</p>',dest:'telegraph',telegraphPath:'pagina-anterior',docId:oldDoc,revision:7,importedMd:'',importedTxt:'',importedHtml:'',media:[]});
  const w=page({url:'https://mdtxtrt.example/?new='+token,local:{rmdtxtml:raw}}),d=w.document;
  await wait(5);
  const active=JSON.parse(w.localStorage.getItem('rmdtxtml'));
  assert.notEqual(active.docId,oldDoc);
  assert.equal(active.name,'Ideia');
  assert.equal(active.dest,'telegram');
  assert.equal(active.telegraphPath,'');
  assert.equal(active.revision,0);
  assert.equal(w.localStorage.getItem('rmdtxtml-document:'+oldDoc),raw);
  assert.equal(new URL(w.location.href).searchParams.has('new'),false);
  assert.equal(d.querySelector('#docName').value,'Ideia');
  assert.equal(d.querySelector('#editor').textContent,'');
  assert.match(d.querySelector('#toast').textContent,/anterior foi preservado/i);
  w.close();
});

test('novo launch archives an unreadable draft byte-for-byte before replacing the active slot',async()=>{
  const token='b'.repeat(32),raw='{"version":2';
  const w=page({url:'https://mdtxtrt.example/?new='+token,local:{rmdtxtml:raw}});
  await wait(5);
  assert.equal(w.localStorage.getItem('rmdtxtml-document:unreadable-'+token),raw);
  const active=JSON.parse(w.localStorage.getItem('rmdtxtml'));
  assert.equal(active.version,2);
  assert.match(active.docId,/^[a-f0-9-]{36}$/i);
  w.dispatchEvent(new w.Event('pagehide'));
  assert.doesNotThrow(()=>JSON.parse(w.localStorage.getItem('rmdtxtml')));
  assert.equal(w.localStorage.getItem('rmdtxtml-document:unreadable-'+token),raw);
  w.close();
});

test('novo preserves archived attachment records when the new document stores another attachment',async()=>{
  const token='c'.repeat(32),db=memoryIndexedDB(),oldMedia='oldmedia',oldDoc='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  db.rows.set(oldMedia,{id:oldMedia,file:{},kind:'image',name:'old.png',type:'image/png',lastModified:0});
  const raw=JSON.stringify({version:2,name:'Com mídia',html:'<figure><img data-media-id="'+oldMedia+'"><figcaption>old.png</figcaption></figure>',dest:'telegram',telegraphPath:'',docId:oldDoc,revision:1,importedMd:'',importedTxt:'',importedHtml:'',media:[{id:oldMedia,kind:'image'}]});
  const w=page({url:'https://mdtxtrt.example/?new='+token,local:{rmdtxtml:raw},indexedDB:db}),d=w.document;
  await wait(5);
  const mediaInput=d.querySelector('#mediaInput');
  const attachment=new w.File([new Uint8Array([1,2,3])],'new.png',{type:'image/png'});
  Object.defineProperty(mediaInput,'files',{configurable:true,value:[attachment]});
  mediaInput.dispatchEvent(new w.Event('change'));
  await wait(10);
  assert.equal(db.rows.has(oldMedia),true);
  assert.equal(db.rows.size,2);
  assert.equal(w.localStorage.getItem('rmdtxtml-document:'+oldDoc),raw);
  w.close();
});


test('volume recovery restores a missing local draft by persistent browser identity',async()=>{
  const doc='90909090-9090-4090-8090-909090909090';
  const browserKey='ab'.repeat(32);
  const remote={version:2,name:'Do volume',html:'<p>recuperado</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:4,importedMd:'',importedTxt:'',importedHtml:'',media:[]};
  const requests=[];
  const fetch=async(url,options={})=>{
    const target=String(url);requests.push({url:target,options});
    if(target.endsWith('/api/drafts/load')){
      const body=JSON.parse(options.body);
      assert.equal(body.browserKey,browserKey);
      return {ok:true,status:200,json:async()=>({draft:remote,media:[],publication:null,updatedAt:1,owner:{kind:'browser'}})};
    }
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,local:{'mdtxtrt-browser-owner':browserKey}}),d=w.document;
  await wait(25);
  assert.equal(d.querySelector('#docName').value,'Do volume');
  assert.equal(d.querySelector('#editor').textContent,'recuperado');
  assert.equal(w.eval('draftState().docId'),doc);
  assert.equal(w.eval('draftState().revision'),4);
  assert.equal(JSON.parse(w.localStorage.getItem('rmdtxtml')).docId,doc);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/drafts/load')).length,1);
  w.close();
});

test('volume recovery failure pauses editing and offers retry or a new draft',async()=>{
  const browserKey='aa'.repeat(32);
  let volumeUp=false;
  const fetch=async(url)=>{
    const target=String(url);
    if(target.endsWith('/api/drafts/load')){
      if(!volumeUp)throw new TypeError('volume unavailable');
      return {ok:false,status:404,json:async()=>({error:'not found'})};
    }
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,local:{'mdtxtrt-browser-owner':browserKey}}),d=w.document;
  await wait(30);
  assert.equal(d.querySelector('#editor').getAttribute('contenteditable'),'false');
  assert.match(d.querySelector('#dialogLabel').textContent,/edição fica pausada/i);
  assert.equal(d.querySelector('#dialogOk').textContent,'Tentar de novo');
  assert.equal(d.querySelector('#dialogCancel').textContent,'Começar rascunho novo');
  assert.equal(w.localStorage.getItem('rmdtxtml'),null);
  volumeUp=true;
  d.querySelector('#dialogOk').click();
  await wait(30);
  assert.equal(d.querySelector('#editor').getAttribute('contenteditable'),'true');
  w.close();
});

test('Telegram back button closes the draft recovery choice without starting a new draft',async()=>{
  let backHandler=null;
  const fetch=async(url)=>{
    if(String(url).endsWith('/api/drafts/load'))throw new TypeError('volume unavailable');
    if(String(url).endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{BackButton:{show(){},hide(){},onClick(handler){backHandler=handler;}}}}),d=w.document;
  await wait(30);
  // "Começar rascunho novo" navega para ?new=<token> (createNewDocumentLaunch).
  const launches=()=>w.__navigations.length;
  const before=launches();
  assert.equal(d.querySelector('#dialogCancel').textContent,'Começar rascunho novo');
  assert.equal(typeof backHandler,'function');
  backHandler();
  await wait(30);
  assert.equal(launches()-before,0,'Voltar não pode escolher "Começar rascunho novo"');
  assert.equal(d.querySelector('#dialogMenu').hasAttribute('data-test-popover-open'),false);
  assert.equal(d.querySelector('#editor').getAttribute('contenteditable'),'false');
  d.querySelector('#editor').dispatchEvent(new w.PointerEvent('pointerdown',{bubbles:true}));
  await wait(10);
  assert.equal(d.querySelector('#dialogOk').textContent,'Tentar de novo');
  d.querySelector('#dialogCancel').click();
  await wait(10);
  assert.equal(launches()-before,1,'o botão explícito continua começando um rascunho novo');
  w.close();
});

// Toque fora de um diálogo de escolha = Cancelar (dismissDialog), como o Voltar e o Esc.
const outsideTap=(w,target,pointerType='touch')=>{
  const fire=type=>{const e=new w.Event(type,{bubbles:true,cancelable:true});if(type==='pointerdown')Object.defineProperty(e,'pointerType',{value:pointerType});target.dispatchEvent(e);return e;};
  const down=fire('pointerdown'),mouse=fire('mousedown');
  let reached=false;const seen=()=>{reached=true;};
  target.addEventListener('click',seen);target.click();target.removeEventListener('click',seen);
  return {down:down.defaultPrevented,mouse:mouse.defaultPrevented,reached};
};
test('outside tap on the draft recovery choice cancels through dismissDialog and never retries or starts a new draft',async()=>{
  let loads=0;
  const fetch=async(url)=>{
    if(String(url).endsWith('/api/drafts/load')){loads++;throw new TypeError('volume unavailable');}
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch}),d=w.document,dialog=d.querySelector('#dialogMenu');
  await wait(30);
  const launches=()=>w.__navigations.length,before=launches(),loadsBefore=loads;
  assert.equal(d.querySelector('#dialogOk').textContent,'Tentar de novo');
  assert.equal(d.querySelector('#dialogCancel').textContent,'Começar rascunho novo');
  // Espiona o caminho: o fechamento passa por finishDialog(null), o mesmo do Esc.
  for(const pointerType of ['touch','mouse']){
    if(!dialog.matches(':popover-open')){
      d.querySelector('#editor').dispatchEvent(new w.PointerEvent('pointerdown',{bubbles:true}));
      await wait(10);
    }
    assert.equal(dialog.matches(':popover-open'),true,pointerType);
    const t=outsideTap(w,d.querySelector('.topbar')||d.body,pointerType);
    await wait(30);
    assert.equal(dialog.matches(':popover-open'),false,'o toque fora fecha o diálogo ('+pointerType+')');
    assert.deepEqual({mouse:t.mouse,reached:t.reached,down:t.down},{mouse:true,reached:false,down:pointerType==='mouse'},pointerType);
    assert.equal(launches()-before,0,'nunca "Começar rascunho novo" ('+pointerType+')');
    assert.equal(loads-loadsBefore,0,'nunca "Tentar de novo" ('+pointerType+')');
    assert.equal(d.querySelector('#editor').getAttribute('contenteditable'),'false','a edição continua pausada');
  }
  // O toque no texto que reabre a escolha não a fecha logo em seguida.
  const editor=d.querySelector('#editor');
  editor.dispatchEvent(new w.PointerEvent('pointerdown',{bubbles:true}));
  editor.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,cancelable:true}));
  await wait(10);
  editor.click();
  await wait(10);
  assert.equal(dialog.matches(':popover-open'),true,'o toque que abriu o diálogo não conta como toque fora');
  // Toques dentro do diálogo continuam valendo: o botão explícito ainda começa o rascunho novo.
  d.querySelector('#dialogCancel').click();
  await wait(10);
  assert.equal(launches()-before,1);
  w.close();
});

test('outside tap on a confirmation resolves it as cancel, and on a one-button notice just closes it, keeping the field focused',async()=>{
  const w=page(),d=w.document,dialog=d.querySelector('#dialogMenu');
  const settled=promise=>Promise.race([promise,wait(500).then(()=>'ainda aberto')]);
  await wait(20);
  // Confirmação: o toque fora nunca confirma.
  const confirm=w.eval('approve("Publicar mesmo assim?")');
  await wait(5);
  assert.equal(dialog.matches(':popover-open'),true);
  outsideTap(w,d.querySelector('#editor'));
  assert.equal(await settled(confirm),false,'toque fora = Cancelar');
  assert.equal(dialog.matches(':popover-open'),false);
  // Aviso de um botão ("Entendi"): só fecha.
  const notice=w.eval('notifyDialog("Este navegador está bloqueando o armazenamento.")');
  await wait(5);
  assert.equal(d.querySelector('#dialogCancel').hidden||d.querySelector('#dialogCancel').textContent==='',true);
  outsideTap(w,d.body,'mouse');
  assert.equal(await settled(notice),null);
  assert.equal(dialog.matches(':popover-open'),false);
  // Pergunta com campo: o toque fora não tira o foco do campo antes de fechar (o
  // mousedown é cancelado) e resolve como Cancelar.
  const answer=w.eval('ask("URL do link","https://")');
  await wait(5);
  const input=d.querySelector('#dialogInput');
  assert.equal(d.activeElement,input);
  const e=new w.Event('mousedown',{bubbles:true,cancelable:true});
  const down=new w.Event('pointerdown',{bubbles:true,cancelable:true});Object.defineProperty(down,'pointerType',{value:'touch'});
  d.body.dispatchEvent(down);d.body.dispatchEvent(e);
  assert.equal(e.defaultPrevented,true);
  assert.equal(d.activeElement,input,'o campo continua focado até o clique');
  d.body.click();
  assert.equal(await settled(answer),null);
  w.close();
});

test('remote draft save sends the active canonical document and stable browser identity',async()=>{
  const doc='91919191-9191-4191-8191-919191919191';
  const browserKey='cd'.repeat(32);
  const local=JSON.stringify({version:2,name:'Persistir',html:'<p>estado</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:2,importedMd:'',importedTxt:'',importedHtml:'',media:[]});
  let saved=null;
  const fetch=async(url,options={})=>{
    const target=String(url);
    if(target.endsWith('/api/drafts/save')){
      const draft=JSON.parse(options.body.get('draft'));
      saved={draft,browserKey:options.body.get('browserKey')};
      return {ok:true,status:200,json:async()=>({draft,media:[],publication:null,owner:{kind:'browser'}})};
    }
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,local:{rmdtxtml:local,'mdtxtrt-browser-owner':browserKey}});
  await w.eval('persistRemoteDraft(false)');
  assert.equal(saved.browserKey,browserKey);
  assert.equal(saved.draft.docId,doc);
  assert.equal(saved.draft.revision,2);
  assert.equal(saved.draft.name,'Persistir');
  w.close();
});

test('Telegram publish sends document identity and accepts a new revision while preserving the prior message',async()=>{
  const doc='92929292-9292-4292-8292-929292929292';
  const local=JSON.stringify({version:2,name:'Publicável',html:'<p>versão nova</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:5,importedMd:'',importedTxt:'',importedHtml:'',media:[]});
  let publishForm=null;
  const fetch=async(url,options={})=>{
    const target=String(url);
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    if(target.endsWith('/api/telegram/send')){
      publishForm=options.body;
      return {ok:true,status:200,json:async()=>({via:'sendRichMessage',messageId:44,previousMessageId:42,noticeMessageId:43,revision:5})};
    }
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{initData:'signed-payload'},local:{rmdtxtml:local}}),d=w.document;
  await wait(20);
  await w.eval('publishTelegram()');
  assert.ok(publishForm);
  assert.equal(publishForm.get('initData'),'signed-payload');
  const sentDraft=JSON.parse(publishForm.get('draft'));
  assert.equal(sentDraft.docId,doc);
  assert.equal(sentDraft.revision,5);
  assert.equal(sentDraft.name,'Publicável');
  assert.match(d.querySelector('#toast').textContent,/anterior foi preservada/i);
  w.close();
});

test('Telegram uses official fullscreen, viewport and safe-area state without orientation gates',async()=>{
  const handlers=new Map();
  const fetch=async(url)=>{
    const target=String(url);
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  let requests=0,locks=0;
  const tg={
    platform:'android',isFullscreen:false,isOrientationLocked:false,
    viewportHeight:390,viewportStableHeight:390,
    safeAreaInset:{top:20,right:1,bottom:5,left:2},
    contentSafeAreaInset:{top:42,right:3,bottom:12,left:4},
    isVersionAtLeast:version=>version==='8.0',
    requestFullscreen(){requests++;},
    lockOrientation(){locks++;},
    onEvent(type,fn){handlers.set(type,fn);}
  };
  const w=page({fetch,tg,matchMedia:query=>({matches:query==='(orientation:landscape)',addEventListener(){},removeEventListener(){}})}),root=w.document.documentElement;
  for(let i=0;i<20&&root.style.getPropertyValue('--vv-height')!=='390px';i++)await wait(10);
  assert.equal(requests,1);
  assert.equal(locks,0);
  assert.equal(root.hasAttribute('data-device-gate'),false);
  assert.equal(root.style.getPropertyValue('--app-tg-content-safe-top'),'42px');
  assert.equal(root.style.getPropertyValue('--app-tg-safe-top'),'20px');
  assert.equal(root.style.getPropertyValue('--vv-height'),'390px');
  assert.equal(typeof handlers.get('fullscreenChanged'),'function');
  assert.equal(typeof handlers.get('fullscreenFailed'),'function');
  assert.equal(typeof handlers.get('viewportChanged'),'function');
  w.Telegram.WebApp.isFullscreen=true;
  w.Telegram.WebApp.viewportStableHeight=800;
  w.Telegram.WebApp.contentSafeAreaInset={top:5,right:0,bottom:10,left:0};
  handlers.get('fullscreenChanged')();
  handlers.get('viewportChanged')({isStateStable:true});
  handlers.get('contentSafeAreaChanged')();
  for(let i=0;i<20&&root.style.getPropertyValue('--vv-height')!=='800px';i++)await wait(10);
  assert.equal(root.style.getPropertyValue('--vv-height'),'800px');
  assert.equal(root.style.getPropertyValue('--app-tg-content-safe-top'),'5px');
  assert.equal(locks,0);
  w.close();
});

test('optional fullscreen unavailable does not block Mini App editing',async()=>{
  const handlers=new Map();
  const fetch=async(url)=>{
    const target=String(url);
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{
    platform:'ios',isFullscreen:false,viewportStableHeight:600,
    isVersionAtLeast:()=>false,onEvent(type,fn){handlers.set(type,fn);}
  }});
  await wait(40);
  assert.equal(w.document.documentElement.hasAttribute('data-device-gate'),false);
  assert.equal(w.document.body.classList.contains('tg'),true);
  assert.equal(w.document.documentElement.style.getPropertyValue('--vv-height'),'600px');
  handlers.get('fullscreenFailed')({error:'UNSUPPORTED'});
  assert.match(w.document.querySelector('#toast').textContent,/Fullscreen indisponível/);
  w.close();
});

test('Telegram launch already fullscreen and a rejected optional request keep the editor available',async()=>{
  const fetch=async(url)=>{
    const target=String(url);
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  let requests=0;
  const shared={platform:'ios',viewportStableHeight:700,isVersionAtLeast:version=>version==='8.0',onEvent(){}};
  const full=page({fetch,tg:{...shared,isFullscreen:true,requestFullscreen(){requests++;}}});
  await wait(40);
  assert.equal(requests,0);
  assert.equal(full.document.body.classList.contains('tg'),true);
  assert.equal(full.document.documentElement.hasAttribute('data-device-gate'),false);
  full.close();

  const rejected=page({fetch,tg:{...shared,isFullscreen:false,requestFullscreen(){requests++;throw new Error('platform refusal');}}});
  await wait(40);
  assert.equal(requests,1);
  assert.equal(rejected.document.body.classList.contains('tg'),true);
  assert.match(rejected.document.querySelector('#toast').textContent,/Não foi possível abrir em fullscreen/);
  rejected.close();
});

test('mobile editor controls preserve active focus without reopening a dismissed keyboard',async()=>{
  const w=page({visualViewport:{height:410}}),d=w.document,editor=d.querySelector('#editor');
  await wait(40);
  editor.focus();
  const bold=d.querySelector('#typebar [data-cmd="bold"]');
  const activePress=new w.Event('pointerdown',{bubbles:true,cancelable:true});
  bold.dispatchEvent(activePress);
  assert.equal(activePress.defaultPrevented,true);
  assert.equal(d.activeElement,editor);

  const theme=d.querySelector('#themeBtn');
  const initial=d.documentElement.classList.contains('light');
  theme.dispatchEvent(new w.Event('pointerdown',{bubbles:true,cancelable:true}));
  theme.click();
  assert.equal(w.localStorage.getItem('mdtxtrt-theme'),initial?'dark':'light');
  assert.equal(d.activeElement,editor);

  w.visualViewport.height=800;
  w.dispatchEvent(new w.Event('resize'));
  const outside=d.querySelector('#destBtn');
  outside.focus();
  assert.equal(d.activeElement,outside);
  const dismissedPress=new w.Event('pointerdown',{bubbles:true,cancelable:true});
  bold.dispatchEvent(dismissedPress);
  assert.equal(dismissedPress.defaultPrevented,false);
  bold.click();
  assert.equal(d.activeElement,outside);
  w.close();
});

test('pointer-based editor controls keep the active typing focus while navigating menus',async()=>{
  const fetch=async(url)=>{
    const target=String(url);
    if(target.endsWith('/api/library/list'))return {ok:true,status:200,json:async()=>({drafts:[],telegram:[],telegraph:[]})};
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,visualViewport:{height:360}}),d=w.document,editor=d.querySelector('#editor');
  await wait(40);
  // Este ambiente abre com o aviso de retrato; o primeiro toque só o fecharia.
  d.documentElement.removeAttribute('data-device-gate');
  editor.focus();

  const press=element=>{
    const pointer=new w.Event('pointerdown',{bubbles:true,cancelable:true});
    element.dispatchEvent(pointer);
    assert.equal(pointer.defaultPrevented,true);
    element.click();
    assert.equal(d.activeElement,editor);
  };

  press(d.querySelector('#exportBtn'));
  assert.equal(d.querySelector('#exportMenu').hasAttribute('data-menu-open'),true);
  press(d.querySelector('#libraryBtn'));
  await wait(5);
  assert.equal(d.querySelector('#libraryMenu').hasAttribute('data-menu-open'),true);

  press(d.querySelector('#libraryClose'));
  assert.equal(d.querySelector('#exportMenu').hasAttribute('data-menu-open'),true);
  press(d.querySelector('#plusBtn'));
  assert.equal(d.querySelector('#plusMenu').hasAttribute('data-menu-open'),true);
  press(d.querySelector('#plusMenu [data-plus-category="format"]'));
  assert.equal(d.querySelector('#plus-format-menu').hasAttribute('data-menu-open'),true);
  press(d.querySelector('#plus-format-menu [data-plus-back]'));
  assert.equal(d.querySelector('#plusMenu').hasAttribute('data-menu-open'),true);
  press(d.querySelector('#linkBtn'));
  assert.equal(d.querySelector('#linkMenu').hasAttribute('data-menu-open'),true);
  assert.equal(d.activeElement,editor);
  w.close();
});

test('library uses the standard submenu lifecycle, stays scrollable with keyboard viewport and menu trigger toggles closed',async()=>{
  const fetch=async(url)=>{
    const target=String(url);
    if(target.endsWith('/api/library/list'))return {ok:true,status:200,json:async()=>({drafts:[],telegram:[],telegraph:[]})};
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch}),d=w.document,root=d.querySelector('#exportMenu'),library=d.querySelector('#libraryMenu');

  d.querySelector('#exportBtn').click();
  assert.equal(root.hasAttribute('data-menu-open'),true);
  d.querySelector('#libraryBtn').click();
  await wait(5);
  assert.equal(root.hasAttribute('data-menu-open'),false);
  assert.equal(library.hasAttribute('data-menu-open'),true);
  assert.match(d.querySelector('#libraryStatus').textContent,/0 publicações · 0 rascunhos/);
  assert.ok(library.classList.contains('plus-submenu'));
  assert.ok(library.querySelector('.menu-list'));
  assert.equal(library.querySelector('#libraryClose').closest('.menu-list'),library.querySelector('.menu-list'));
  assert.equal(library.querySelector('#libraryNew').closest('.menu-list'),library.querySelector('.menu-list'));

  const publicationsToggle=d.querySelector('#publicationToggle');
  const publicationLists=d.querySelector('#publicationLists');
  assert.equal(publicationsToggle.getAttribute('aria-expanded'),'false');
  assert.equal(publicationLists.hidden,true);
  publicationsToggle.click();
  assert.equal(publicationsToggle.getAttribute('aria-expanded'),'true');
  assert.equal(publicationLists.hidden,false);
  publicationsToggle.click();
  assert.equal(publicationsToggle.getAttribute('aria-expanded'),'false');
  assert.equal(publicationLists.hidden,true);

  const draftToggle=d.querySelector('#draftToggle');
  const draftLists=d.querySelector('#draftLists');
  assert.equal(draftToggle.getAttribute('aria-expanded'),'false');
  assert.equal(draftLists.hidden,true);
  draftToggle.click();
  assert.equal(draftToggle.getAttribute('aria-expanded'),'true');
  assert.equal(draftLists.hidden,false);
  draftToggle.click();
  assert.equal(draftToggle.getAttribute('aria-expanded'),'false');
  assert.equal(draftLists.hidden,true);

  d.querySelector('#libraryClose').click();
  await wait(0);
  assert.equal(library.hasAttribute('data-menu-open'),false);
  assert.equal(root.hasAttribute('data-menu-open'),true);

  d.querySelector('#libraryBtn').click();
  await wait(0);
  assert.equal(library.hasAttribute('data-menu-open'),true);
  assert.equal(root.hasAttribute('data-menu-open'),false);
  assert.equal(parseFloat(library.style.getPropertyValue('--menu-max-height')),420);

  w.visualViewport.height=360;
  w.eval('syncBrowserViewport()');
  const keyboardHeight=parseFloat(library.style.getPropertyValue('--menu-max-height'));
  const expectedKeyboardMax=Math.ceil(w.visualViewport.height*.55);
  assert.ok(keyboardHeight>0&&keyboardHeight<=expectedKeyboardMax);

  d.querySelector('#exportBtn').click();
  assert.equal(library.hasAttribute('data-menu-open'),false);
  assert.equal(root.hasAttribute('data-menu-open'),false);

  d.querySelector('#exportBtn').click();
  assert.equal(root.hasAttribute('data-menu-open'),true);
  d.querySelector('#exportBtn').click();
  assert.equal(root.hasAttribute('data-menu-open'),false);
  w.close();
});

test('browser export flow labels Telegram transfer as opening the Mini App rather than publishing',()=>{
  const w=page(),d=w.document;
  assert.equal(d.querySelector('#openAppLabel').textContent,'Abrir no Mini App');
  assert.equal(d.querySelector('#openAppBtn').getAttribute('aria-label'),'Abrir no Mini App');
  assert.equal(d.querySelector('#exportBtn').title,'Abrir menu de publicação, exportação e biblioteca');
  w.close();
});

test('destination controls remain functional without changing editor shell',()=>{
  const w=page(),d=w.document;
  assert.equal(d.querySelector('#destBtn').title,'Destino: Telegram');
  d.querySelector('#destBtn').click();
  assert.equal(d.querySelector('#destBtn').title,'Destino: Telegraph');
  assert.ok(d.querySelector('#editor'));
  assert.ok(d.querySelector('#typebar'));
  w.close();
});

test('document name stays in export flow and becomes the Telegraph title',async()=>{
  const w=page(),d=w.document,slot=d.querySelector('#telegraphTitleSlot'),input=d.querySelector('#docName');
  const tools=input.closest('.document-tools'),exportMenu=d.querySelector('#exportMenu');
  await wait(0);
  assert.equal(slot.hidden,true);
  assert.equal(tools.parentElement,exportMenu.querySelector('.glass-menu-content'));
  d.querySelector('#destBtn').click();
  await wait(0);
  assert.equal(slot.hidden,false);
  assert.equal(tools.parentElement,slot);
  assert.equal(tools.hasAttribute('data-field-label'),false);
  assert.equal(input.getAttribute('placeholder'),'Título');
  assert.equal(input.getAttribute('aria-label'),'Título da página no Telegraph');
  input.value='Minha página';
  input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(w.eval('buildTelegraph().title'),'Minha página');
  d.querySelector('#destBtn').click();
  await wait(0);
  assert.equal(slot.hidden,true);
  assert.equal(tools.parentElement,exportMenu.querySelector('.glass-menu-content'));
  assert.equal(tools.getAttribute('data-field-label'),'Título do documento');
  assert.equal(input.getAttribute('placeholder'),'Título do documento');
  assert.equal(input.getAttribute('aria-label'),'Título do documento');
  w.close();
});

test('Markdown block markers convert on the space after the marker, in either typing order, and preserve semantics',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const apply=async(html,offset=null,inputType='insertText')=>{
    w.eval('currentEditorCore().resetHTML('+JSON.stringify(html)+',{silent:true})');
    const block=e.firstElementChild,node=block.firstChild;
    assert.ok(node);
    const range=d.createRange();
    range.setStart(node,offset===null?node.length:offset);range.collapse(true);
    w.getSelection().removeAllRanges();w.getSelection().addRange(range);
    d.dispatchEvent(new w.Event('selectionchange'));
    const event=new w.InputEvent('input',{bubbles:true,inputType});
    e.dispatchEvent(event);
    await wait();
  };
  // Decisão do dono: "# " no início da linha já vira título, como no Markdown.
  await apply('<p># </p>');
  assert.equal(e.firstElementChild.tagName,'H1');
  assert.equal(e.textContent,'');
  assert.ok(e.querySelector('h1 > br'),'o título vazio tem altura para o cursor');

  await apply('<p># Palavra</p>');
  assert.equal(e.querySelector('h1')?.textContent,'Palavra');
  assert.equal(d.querySelector('#headingBtn').classList.contains('on'),true);
  assert.equal(d.querySelector('#headingBtn').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelector('#headingMenu [data-block="h1"]').classList.contains('is-current'),true);

  await apply('<p>## Palavra</p>',3);
  assert.equal(e.querySelector('h2')?.textContent,'Palavra');
  await apply('<p>&gt; Citação</p>');
  assert.equal(e.querySelector('blockquote')?.textContent,'Citação');
  assert.equal(d.querySelector('#quoteBtn').classList.contains('on'),true);
  await apply('<p>- Item</p>');
  assert.ok(e.querySelector('ul > li'));
  await apply('<p>3. Item</p>');
  assert.equal(e.querySelector('ol')?.getAttribute('start'),'3');
  await apply('<p>- [x] Tarefa</p>');
  assert.equal(e.querySelector('li input[type="checkbox"]')?.checked,true);
  await apply('<p>\\# Literal</p>',3);
  assert.equal(e.querySelector('p')?.textContent,'# Literal');
  assert.equal(e.querySelector('h1'),null);
  w.close();
});

test('Markdown block conversion preserves the logical caret while typing',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p># </p>',{silent:true})");
  const first=e.querySelector('p').firstChild,initial=d.createRange();
  initial.setStart(first,first.length);initial.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(initial);

  const type=async char=>{
    const sel=w.getSelection(),range=sel.getRangeAt(0);
    let text=range.startContainer,offset=range.startOffset;
    if(text.nodeType!==3){
      text=d.createTextNode('');
      range.insertNode(text);offset=0;
    }
    text.insertData(offset,char);
    range.setStart(text,offset+char.length);range.collapse(true);
    sel.removeAllRanges();sel.addRange(range);
    e.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertText',data:char}));
    await wait();
  };

  for(const char of 'teste')await type(char);
  assert.equal(e.firstElementChild.tagName,'H1');
  assert.equal(e.firstElementChild.textContent,'teste');
  const sel=w.getSelection();
  assert.equal(sel.anchorNode,e.firstElementChild.firstChild);
  assert.equal(sel.anchorOffset,5);
  w.close();
});

test('Markdown block markers accept element-anchored carets and non-breaking spaces once content exists',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<div>#&nbsp;Palavra</div>',{silent:true})");
  const block=e.firstElementChild,range=d.createRange();
  range.setStart(block,1);range.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  d.dispatchEvent(new w.Event('selectionchange'));
  e.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertText'}));
  await wait();
  assert.equal(e.querySelector('h1')?.textContent,'Palavra');
  w.close();
});

test('Enter preserves heading and quote formatting until the empty formatted line is submitted',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const startAtEnd=(html,label)=>{
    w.eval('currentEditorCore().resetHTML('+JSON.stringify(html)+',{silent:true})');
    w.eval('(()=>{const core=currentEditorCore(),r=core.findLiteral('+JSON.stringify(label)+')[0];core.selectRange({from:r.to,to:r.to},{focus:true})})()');
  };
  const enter=async()=>{
    const before=new w.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertParagraph'});
    e.dispatchEvent(before);
    await wait();
    assert.equal(before.defaultPrevented,true);
  };

  startAtEnd('<h1>Título</h1>','Título');
  await enter();
  assert.equal(e.children[0]?.tagName,'H1');
  assert.equal(e.children[1]?.tagName,'H1');
  assert.equal(d.querySelector('#headingBtn').classList.contains('on'),true);
  assert.equal(d.querySelector('#headingMenu [data-block="h1"]').classList.contains('is-current'),true);
  await enter();
  assert.equal(e.children[0]?.tagName,'H1');
  assert.equal(e.children[1]?.tagName,'P');
  assert.equal(d.querySelector('#headingBtn').classList.contains('on'),false);
  assert.equal(d.querySelector('#headingMenu [data-block="p"]').classList.contains('is-current'),true);

  startAtEnd('<blockquote>Citação</blockquote>','Citação');
  await enter();
  assert.equal(e.children[0]?.tagName,'BLOCKQUOTE');
  assert.equal(e.children[1]?.tagName,'BLOCKQUOTE');
  assert.equal(d.querySelector('#quoteBtn').classList.contains('on'),true);
  await enter();
  assert.equal(e.children[0]?.tagName,'BLOCKQUOTE');
  assert.equal(e.children[1]?.tagName,'P');
  assert.equal(d.querySelector('#quoteBtn').classList.contains('on'),false);
  w.close();
});

test('deleting the last character of a heading or quote returns the block to body',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const reset=async html=>{
    w.eval('currentEditorCore().resetHTML('+JSON.stringify(html)+',{silent:true})');
    w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral('x')[0],{focus:true})");
    const event=new w.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'deleteContentBackward'});
    e.dispatchEvent(event);
    await wait();
    assert.equal(event.defaultPrevented,true);
    assert.equal(e.firstElementChild.tagName,'P');
    assert.equal(e.textContent,'');
  };
  await reset('<h2>x</h2>');
  await reset('<blockquote>x</blockquote>');
  assert.equal(d.querySelector('#headingBtn').classList.contains('on'),false);
  assert.equal(d.querySelector('#quoteBtn').classList.contains('on'),false);
  w.close();
});

test('Markdown inline markers become semantic rich-text marks and support escaping',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const run=async text=>{
    const escaped=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    w.eval('currentEditorCore().resetHTML('+JSON.stringify('<p>'+escaped+'</p>')+',{silent:true})');
    w.eval('(()=>{const core=currentEditorCore(),r=core.findLiteral('+JSON.stringify(text)+')[0];core.selectRange({from:r.to,to:r.to},{focus:true})})()');
    e.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertText'}));
    await wait();
  };
  await run('**forte**');assert.equal(e.querySelector('strong')?.textContent,'forte');
  await run('*ênfase*');assert.equal(e.querySelector('em')?.textContent,'ênfase');
  await run('~~riscado~~');assert.equal(e.querySelector('s,del,strike')?.textContent,'riscado');
  await run('`código`');assert.equal(e.querySelector('code')?.textContent,'código');
  await run('\\*literal*');assert.equal(e.querySelector('em'),null);assert.equal(e.textContent,'*literal*');
  w.close();
});

test('Markdown input rules stay idle during IME composition',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p># Palavra</p>',{silent:true})");
  const node=e.querySelector('p').firstChild,range=d.createRange();
  range.setStart(node,node.length);range.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  e.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));
  e.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertText'}));
  assert.equal(e.querySelector('h1'),null);
  e.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true}));
  assert.ok(e.querySelector('h1'));
  w.close();
});

test('formatting undo and redo restore semantic document states',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>texto selecionado</p>',{silent:true})");
  const text=e.querySelector('p').firstChild,range=d.createRange();
  range.setStart(text,0);range.setEnd(text,text.length);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  d.dispatchEvent(new w.Event('selectionchange'));
  d.querySelector('[data-cmd="bold"]').click();
  assert.equal(e.querySelector('strong')?.textContent,'texto selecionado');
  d.querySelector('#undoBtn').click();
  assert.equal(e.querySelector('strong'),null);
  assert.equal(e.textContent,'texto selecionado');
  d.querySelector('#redoBtn').click();
  assert.equal(e.querySelector('strong')?.textContent,'texto selecionado');
  w.close();
});

test('Unicode-safe replace keeps ranges aligned and semantic formatting intact',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>İxA <strong>axa</strong></p>',{silent:true})");
  d.querySelector('#findText').value='a';
  d.querySelector('#replaceText').value='Z';
  d.querySelector('#replaceAll').click();
  assert.equal(e.textContent,'İxZ ZxZ');
  assert.equal(e.querySelector('strong')?.textContent,'ZxZ');
  w.close();
});

test('Telegram serializer preserves language class on code',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<pre><code class="language-js">const x=1;</code></pre>';
  const html=w.eval('buildRich().rich_message.html');
  assert.match(html,/<code class="language-js">/);
  w.close();
});

test('Telegraph keeps the quote and caption credit as plain text, never as <cite> and never dropped',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<blockquote>Citação<cite>Ana Souza</cite></blockquote><aside>Destaque<cite>Rui <b>Lima</b></cite></aside>'+
    '<figure><img src="https://example.com/a.jpg"><figcaption>Legenda<cite>Foto: Bia</cite></figcaption></figure><blockquote><cite>Só o autor</cite></blockquote>';
  const nodes=JSON.parse(w.eval('JSON.stringify(telegraphNodes(document.querySelector("#editor")))'));
  const tags=n=>typeof n==='string'?[]:[n.tag,...(n.children||[]).flatMap(tags)];
  assert.ok(!nodes.flatMap(tags).includes('cite'));
  assert.deepEqual(nodes[0],{tag:'blockquote',children:['Citação',{tag:'br'},'Ana Souza']});
  assert.deepEqual(nodes[1],{tag:'aside',children:['Destaque',{tag:'br'},'Rui ',{tag:'b',children:['Lima']}]});
  assert.deepEqual(nodes[2].children[1],{tag:'figcaption',children:['Legenda',{tag:'br'},'Foto: Bia']});
  assert.deepEqual(nodes[3],{tag:'blockquote',children:['Só o autor']});
  w.close();
});

test('Telegraph serializer rejects non-http links locally',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<p><a href="mailto:test@example.com">mail</a></p>';
  assert.throws(()=>w.eval('telegraphNodes(document.querySelector("#editor"))'),/HTTP ou HTTPS/);
  w.close();
});

test('invalid import leaves current document identity and content intact',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor'),input=d.querySelector('#fileInput');
  d.querySelector('#docName').value='Atual';
  e.innerHTML='<p>preservar</p>';
  const before=w.eval('draftState().docId');
  Object.defineProperty(input,'files',{configurable:true,value:[{name:'bad.pdf',text:async()=> 'novo'}]});
  input.dispatchEvent(new w.Event('change'));
  await wait(5);
  assert.equal(d.querySelector('#docName').value,'Atual');
  assert.equal(e.innerHTML,'<p>preservar</p>');
  assert.equal(w.eval('draftState().docId'),before);
  w.close();
});

test('import bounds document name to persisted draft contract',async()=>{
  const w=page(),d=w.document,input=d.querySelector('#fileInput');
  const name='x'.repeat(140)+'.txt';
  Object.defineProperty(input,'files',{configurable:true,value:[{name,text:async()=> 'texto'}]});
  input.dispatchEvent(new w.Event('change'));
  await wait(5);
  assert.equal(d.querySelector('#docName').value.length,140);
  assert.doesNotThrow(()=>w.eval('JSON.stringify(draftState())'));
  w.close();
});

test('empty export name is handled without an unhandled rejection',async()=>{
  const w=page(),d=w.document;
  d.querySelector('#docName').value='';
  d.querySelector('#editor').innerHTML='<p>texto</p>';
  await w.eval('exportFile("md")');
  assert.match(d.querySelector('#toast').textContent,/nome ao documento/);
  w.close();
});

test('local media remains coherent through undo and redo',async()=>{
  const db=memoryIndexedDB();
  let n=0;
  const w=page({indexedDB:db,objectURL:()=> 'blob:media-'+(++n)}),d=w.document,input=d.querySelector('#mediaInput');
  const file=new w.File([new Uint8Array([1,2,3])],'foto.png',{type:'image/png'});
  Object.defineProperty(input,'files',{configurable:true,value:[file]});
  input.dispatchEvent(new w.Event('change'));
  await wait(10);
  const node=d.querySelector('[data-media-id]');
  assert.ok(node);
  const id=node.getAttribute('data-media-id'),src=node.getAttribute('src');
  assert.match(src,/^blob:media-/);
  d.querySelector('#undoBtn').click();
  assert.equal(d.querySelector('[data-media-id]'),null);
  d.querySelector('#redoBtn').click();
  const restored=d.querySelector('[data-media-id]');
  assert.equal(restored?.getAttribute('data-media-id'),id);
  assert.equal(restored?.getAttribute('src'),src);
  w.close();
});

test('multiple local attachments are retained up to the Telegram Rich Message media contract',async()=>{
  const db=memoryIndexedDB();
  let seq=0;
  const w=page({indexedDB:db,objectURL:()=> 'blob:media-'+(++seq)}),d=w.document,input=d.querySelector('#mediaInput');
  const first=new w.File([new Uint8Array([1])],'one.png',{type:'image/png'});
  const second=new w.File([new Uint8Array([2])],'two.png',{type:'image/png'});
  Object.defineProperty(input,'files',{configurable:true,value:[first,second]});
  input.dispatchEvent(new w.Event('change'));
  await wait(15);
  const media=[...d.querySelectorAll('[data-media-id]')];
  assert.equal(media.length,2);
  assert.equal(JSON.stringify(w.eval('draftState().media.map(item=>item.kind)')),JSON.stringify(['image','image']));
  assert.equal(new Set(media.map(node=>node.getAttribute('data-media-id'))).size,2);
  w.close();
});

test('rapid publish calls are serialized by busy state',async()=>{
  let sendResolve,sendCount=0;
  const fetch=async(url)=>{
    if(String(url).endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(String(url).endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({})};
    if(String(url).endsWith('/api/telegram/send')){
      sendCount++;
      return await new Promise(resolve=>{sendResolve=()=>resolve({ok:true,status:200,json:async()=>({via:'sendRichMessage',messageId:42})});});
    }
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{}}),d=w.document;
  await wait(10);
  d.querySelector('#editor').innerHTML='<p>texto</p>';
  const first=w.eval('publishCurrent()');
  const second=w.eval('publishCurrent()');
  await wait(0);
  assert.equal(sendCount,1);
  sendResolve();
  await first;await second;
  assert.equal(sendCount,1);
  w.close();
});

test('draft sanitizer rejects malformed media identifiers before persistence',()=>{
  const w=page();
  assert.throws(()=>w.eval("cleanDraftHTML('<img data-media-id=\"bad id\">')"),/identificador de mídia/);
  w.close();
});


test('draft sanitizer accepts multiple unique local attachment identifiers within Telegram Rich Message capacity',()=>{
  const w=page();
  assert.doesNotThrow(()=>w.eval("cleanDraftHTML('<figure><img data-media-id=\"one\"></figure><figure><img data-media-id=\"two\"></figure>')"));
  const fifty=Array.from({length:50},(_,index)=>'<figure><img data-media-id="m'+index+'"></figure>').join('');
  assert.doesNotThrow(()=>w.eval('cleanDraftHTML('+JSON.stringify(fifty)+')'));
  const fiftyOne=fifty+'<figure><img data-media-id="overflow"></figure>';
  assert.throws(()=>w.eval('cleanDraftHTML('+JSON.stringify(fiftyOne)+')'),/50 mídias/);
  w.close();
});

test('Rich Message serializer rejects unsupported editor markup',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<p>ok</p><svg></svg>';
  assert.throws(()=>w.eval('buildRich()'),/não aceita/);
  w.close();
});

test('native table editing reaches Telegram 20-column capacity and selected table deletes with Backspace',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<table><tr><td>x</td></tr></table><p>after</p>',{silent:true})");
  const cell=e.querySelector('td'),selection=d.getSelection(),range=d.createRange();
  e.focus();range.selectNodeContents(cell);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
  for(let i=1;i<20;i++)assert.equal(w.eval('currentEditorCore().addTableColumn()'),true);
  assert.equal(e.querySelector('tr').cells.length,20);
  assert.throws(()=>w.eval('currentEditorCore().addTableColumn()'),/20 colunas/);
  assert.equal(w.eval('currentEditorCore().selectTable()'),true);
  const backspace=new w.KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true});
  e.dispatchEvent(backspace);
  assert.equal(backspace.defaultPrevented,true);
  assert.equal(e.querySelector('table'),null);
  assert.equal(e.querySelector('p')?.textContent,'after');
  w.close();
});

test('Markdown conversion retains supported semantic structures',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const source='# Nome\n\n- [x] tarefa\n- [ ] próxima\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**forte** e [site](https://example.com)';
  const html=w.eval('mdToBasicHTML('+JSON.stringify(source)+')');
  const box=d.createElement('div');box.innerHTML=html;
  assert.equal(box.querySelector('h1')?.textContent,'Nome');
  assert.equal(box.querySelectorAll('input[type="checkbox"]').length,2);
  assert.equal(box.querySelectorAll('table tr').length,2);
  assert.equal(box.querySelector('strong')?.textContent,'forte');
  assert.equal(box.querySelector('a')?.getAttribute('href'),'https://example.com');
  e.innerHTML=html;
  const out=w.eval('htmlToMarkdown(document.querySelector("#editor").innerHTML)');
  assert.match(out,/Nome/);
  assert.match(out,/forte/);
  assert.match(out,/https:\/\/example\.com/);
  w.close();
});

test('TXT conversion remains literal and detects lossy semantic structure',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<p>literal &lt;texto&gt;<br>linha dois</p>';
  assert.equal(w.eval('htmlToText(document.querySelector("#editor").innerHTML)'),'literal <texto>\nlinha dois');
  assert.equal(w.eval('txtLosesStructure()'),false);
  e.innerHTML='<p><strong>formato</strong></p>';
  assert.equal(w.eval('txtLosesStructure()'),true);
  assert.equal(w.eval('htmlToText(document.querySelector("#editor").innerHTML)'),'formato');
  w.close();
});

test('pagehide persists the last edit immediately and empty drafts restore identity',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  d.querySelector('#docName').value='Última';
  e.innerHTML='<p>edição final</p>';
  e.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.dispatchEvent(new w.Event('pagehide'));
  const saved=JSON.parse(w.localStorage.getItem('rmdtxtml'));
  assert.equal(saved.name,'Última');
  assert.match(saved.html,/edição final/);
  w.close();

  const doc='99999999-9999-4999-8999-999999999999';
  const restored=page({local:{rmdtxtml:JSON.stringify({version:2,name:'Vazio',html:'',dest:'telegraph',telegraphPath:'',docId:doc,importedMd:'',importedTxt:'',importedHtml:'',media:[]})}});
  assert.equal(restored.document.querySelector('#docName').value,'Vazio');
  assert.equal(restored.document.querySelector('#editor').innerHTML,'');
  assert.equal(restored.document.querySelector('#destBtn').title,'Destino: Telegraph');
  assert.equal(restored.eval('draftState().docId'),doc);
  restored.close();
});


test('block insertions respect caret position and ordered list preserves paragraph text',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>Antes</p><p>Depois</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('Antes')[0];currentEditorCore().selectRange({from:r.to,to:r.to},{focus:true})})()");
  w.eval('saveSel();insertFeature("divider")');
  assert.equal(JSON.stringify([...e.children].map(el=>el.tagName)),JSON.stringify(['P','HR','P']));

  w.eval("currentEditorCore().resetHTML('<p>antes depois</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('antes depois')[0];currentEditorCore().selectRange({from:r.from+6,to:r.from+6},{focus:true})})()");
  w.eval('insertFeature("ordered")');
  assert.equal(JSON.stringify([...e.children].map(node=>node.tagName)),JSON.stringify(['OL']));
  assert.equal(e.querySelector('ol > li')?.textContent,'antes depois');
  assert.equal(e.querySelector('p ol'),null);
  w.close();
});

test('find advances, wraps and replace-one survives focus moving to controls',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>ação ação ação</p>',{silent:true})");
  d.querySelector('#findText').value='ação';
  const starts=[];
  for(let i=0;i<4;i++){
    d.querySelector('#findNext').click();
    starts.push(w.eval('currentEditorCore().selectionOffsets().from'));
  }
  assert.deepEqual(starts,[0,5,10,0]);
  d.querySelector('#replaceText').focus();
  d.querySelector('#replaceText').value='feito';
  d.querySelector('#replaceOne').click();
  assert.equal(e.textContent,'feito ação ação');
  w.close();
});

test('Markdown round-trip preserves styled rich buttons and footer semantics',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<p class="tg-footer">Rodapé</p><tg-button-row><tg-button type="url" style="danger" url="https://example.com">Abrir</tg-button></tg-button-row>';
  const md=w.eval('htmlToMarkdown(document.querySelector("#editor").innerHTML)');
  const html=w.eval('mdToBasicHTML('+JSON.stringify(md)+')');
  const box=w.document.createElement('div');box.innerHTML=html;
  assert.equal(box.querySelector('tg-button')?.getAttribute('style'),'danger');
  assert.equal(box.querySelector('.tg-footer')?.textContent,'Rodapé');
  w.close();
});

test('local attachments are blocked from lossy file exports',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<figure><img data-media-id="media1" src="blob:https://example.com/local"></figure>';
  assert.throws(()=>w.eval('htmlToMarkdown(document.querySelector("#editor").innerHTML)'),/URL pública/);
  assert.throws(()=>w.eval('htmlToText(document.querySelector("#editor").innerHTML)'),/TXT não comporta/);
  w.close();
});

test('oversized galleries are rejected without changing the document',async()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<p>Original</p>';
  const promise=w.eval('insertFeature("collage")');
  await wait(0);
  const input=w.document.querySelector('#dialogInput');
  input.value=Array.from({length:51},(_,i)=>'https://example.com/'+i+'.jpg').join('\n');
  w.document.querySelector('#dialogOk').click();
  await promise;
  assert.equal(e.innerHTML,'<p>Original</p>');
  assert.match(w.document.querySelector('#toast').textContent,/no máximo 50/);
  w.close();
});


for(const [caseName,raw] of [
  ['JSON inválido','{"version":2'],
  ['versão incompatível',JSON.stringify({version:1,name:'Antigo',html:'<p>recuperar</p>',dest:'telegram',telegraphPath:'',docId:'11111111-1111-4111-8111-111111111111',importedMd:'',importedTxt:'',importedHtml:'',media:[]})],
  ['sanitização incompatível',JSON.stringify({version:2,name:'Recuperar',html:'<script>preservar()</script>',dest:'telegram',telegraphPath:'',docId:'22222222-2222-4222-8222-222222222222',importedMd:'',importedTxt:'',importedHtml:'',media:[]})]
]){
  test('unreadable local draft is preserved after '+caseName,()=>{
    const w=page({local:{rmdtxtml:raw}});
    assert.equal(w.localStorage.getItem('rmdtxtml'),raw);
    w.dispatchEvent(new w.Event('pagehide'));
    assert.equal(w.localStorage.getItem('rmdtxtml'),raw);
    assert.match(w.document.querySelector('#toast').textContent,/preservad|recupera/i);
    w.close();
  });
}

test('browser Telegraph publishing stops before the external request when identity cannot persist',async()=>{
  const w=page(),d=w.document;
  await wait(10);
  w.localStorage.removeItem('mdtxtrt-browser-owner');
  const original=w.Storage.prototype.setItem;
  w.Storage.prototype.setItem=function(key,value){
    if(key==='mdtxtrt-browser-owner')throw new Error('storage denied');
    return original.call(this,key,value);
  };
  d.querySelector('#docName').value='Sem identidade';
  d.querySelector('#editor').innerHTML='<p>texto</p>';
  await w.eval('publishTelegraph()');
  assert.equal(w.__requests.filter(request=>request.url.endsWith('/api/telegraph/publish')).length,0);
  assert.match(d.querySelector('#toast').textContent,/persistir a identidade/);
  w.Storage.prototype.setItem=original;
  w.close();
});

test('import starts a new document history and undo cannot restore prior identity, page or attachment',async()=>{
  const db=memoryIndexedDB();
  const oldDoc='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const local=JSON.stringify({version:2,name:'Documento A',html:'<p>texto A</p>',dest:'telegraph',telegraphPath:'pagina-a',docId:oldDoc,revision:3,importedMd:'',importedTxt:'',importedHtml:'',media:[]});
  const w=page({local:{rmdtxtml:local},indexedDB:db,objectURL:()=> 'blob:old-media'}),d=w.document,e=d.querySelector('#editor');
  assert.equal(w.eval('draftState().docId'),oldDoc);
  assert.equal(w.eval('draftState().telegraphPath'),'pagina-a');
  const mediaInput=d.querySelector('#mediaInput');
  const attachment=new w.File([new Uint8Array([1,2,3])],'a.png',{type:'image/png'});
  Object.defineProperty(mediaInput,'files',{configurable:true,value:[attachment]});
  mediaInput.dispatchEvent(new w.Event('change'));
  await wait(10);
  assert.ok(d.querySelector('[data-media-id]'));
  assert.equal(db.rows.size,1);

  const fileInput=d.querySelector('#fileInput');
  Object.defineProperty(fileInput,'files',{configurable:true,value:[{name:'Documento B.txt',text:async()=> 'texto B'}]});
  fileInput.dispatchEvent(new w.Event('change'));
  await wait(10);
  const newDoc=w.eval('draftState().docId');
  assert.notEqual(newDoc,oldDoc);
  assert.equal(d.querySelector('#docName').value,'Documento B');
  assert.equal(e.textContent,'texto B');
  assert.equal(w.eval('draftState().telegraphPath'),'');
  assert.equal(d.querySelector('[data-media-id]'),null);
  assert.equal(db.rows.size,0);

  d.querySelector('#undoBtn').click();
  assert.equal(w.eval('draftState().docId'),newDoc);
  assert.equal(d.querySelector('#docName').value,'Documento B');
  assert.equal(e.textContent,'texto B');
  assert.equal(w.eval('draftState().telegraphPath'),'');
  assert.equal(d.querySelector('[data-media-id]'),null);
  w.close();
});

test('late Telegraph publish response cannot attach document A page to imported document B',async()=>{
  let resolvePublish,publishedBody;
  const fetch=async(url,options={})=>{
    const target=String(url);
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    if(target.endsWith('/api/telegraph/publish')){
      publishedBody=JSON.parse(options.body);
      return await new Promise(resolve=>{resolvePublish=()=>resolve({ok:true,status:200,json:async()=>({path:'pagina-a',url:'https://telegra.ph/pagina-a',doc:publishedBody.doc,revision:publishedBody.revision})});});
    }
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch}),d=w.document,e=d.querySelector('#editor');
  await wait(10);
  d.querySelector('#docName').value='Documento A';
  e.innerHTML='<p>A</p>';
  const oldDoc=w.eval('draftState().docId');
  const publishing=w.eval('publishTelegraph()');
  await wait(0);
  assert.equal(publishedBody.doc,oldDoc);

  const input=d.querySelector('#fileInput');
  Object.defineProperty(input,'files',{configurable:true,value:[{name:'Documento B.txt',text:async()=> 'B'}]});
  input.dispatchEvent(new w.Event('change'));
  await wait(10);
  const newDoc=w.eval('draftState().docId');
  assert.notEqual(newDoc,oldDoc);
  resolvePublish();
  await publishing;

  assert.equal(w.eval('draftState().docId'),newDoc);
  assert.equal(w.eval('draftState().telegraphPath'),'');
  assert.match(d.querySelector('#toast').textContent,/documento mudou/);
  w.close();
});

test('late Telegraph recovery response is ignored after the same document advances revision',async()=>{
  let resolveRecover,recoverBody;
  const fetch=async(url,options={})=>{
    const target=String(url);
    if(target.endsWith('/api/telegraph/recover')){
      recoverBody=JSON.parse(options.body);
      return await new Promise(resolve=>{resolveRecover=()=>resolve({ok:true,status:200,json:async()=>({path:'pagina-antiga',url:'https://telegra.ph/pagina-antiga',doc:recoverBody.doc,revision:recoverBody.revision})});});
    }
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch}),d=w.document;
  await wait(10);
  assert.ok(recoverBody);
  const beforeRevision=recoverBody.revision;
  const name=d.querySelector('#docName');
  name.value='Revisão nova';
  name.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.ok(w.eval('draftState().revision')>beforeRevision);
  resolveRecover();
  await wait(10);
  assert.equal(w.eval('draftState().telegraphPath'),'');
  w.close();
});


test('bot import handoff preserves the active local document before opening the imported document',async()=>{
  const token='e5'.repeat(16);
  const oldDoc='75757575-7575-4757-8757-757575757575';
  const newDoc='76767676-7676-4767-8767-767676767676';
  const initData='start_param=h_'+token;
  const previous=JSON.stringify({version:2,name:'Documento local',html:'<p>não substituir</p>',dest:'telegram',telegraphPath:'',docId:oldDoc,revision:4,importedMd:'',importedTxt:'',importedHtml:'',media:[]});
  const requests=[];
  const imported={version:2,name:'Importado',html:'<p>arquivo do bot</p>',dest:'telegram',telegraphPath:'',docId:newDoc,revision:0,importedMd:'',importedTxt:'arquivo do bot',importedHtml:'<p>arquivo do bot</p>',media:[]};
  const fetch=async(url,options={})=>{
    const target=String(url);requests.push({url:target,options});
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:imported,files:[],purpose:'import',action:null})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{initData},local:{rmdtxtml:previous}}),d=w.document;
  await wait(15);
  assert.equal(w.localStorage.getItem('rmdtxtml-document:'+oldDoc),previous);
  const active=JSON.parse(w.localStorage.getItem('rmdtxtml'));
  assert.equal(active.docId,newDoc);
  assert.equal(active.name,'Importado');
  assert.equal(d.querySelector('#editor').textContent,'arquivo do bot');
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/claim')).length,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/publish')).length,0);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/telegram/send')).length,0);
  assert.match(d.querySelector('#toast').textContent,/Arquivo importado aberto/);
  w.close();
});

test('handoff claim restores draft without authorizing publication automatically',async()=>{
  const token='a1'.repeat(16);
  const doc='71717171-7171-4717-8717-717171717171';
  const initData='start_param=h_'+token;
  const requests=[];
  const pending={type:'publish',status:'pending',attempts:0,result:null,error:'',startedAt:0,finishedAt:0,doc,revision:0};
  const succeeded={...pending,status:'succeeded',attempts:1,result:{via:'sendRichMessage',messageId:42},finishedAt:1};
  const fetch=async(url,options={})=>{
    const target=String(url);requests.push({url:target,options});
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Transferido',html:'<p>conteúdo</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:[]},files:[],action:pending})};
    if(target.endsWith('/api/handoff/publish'))return {ok:true,status:200,json:async()=>({action:succeeded,result:succeeded.result,reused:false})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{initData}}),d=w.document;
  await wait(15);
  assert.equal(d.querySelector('#docName').value,'Transferido');
  assert.equal(d.querySelector('#editor').textContent,'conteúdo');
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/claim')).length,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/publish')).length,0);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/telegram/send')).length,0);
  assert.match(d.querySelector('#toast').textContent,/Toque em Publicar/);

  await w.eval('publishCurrent()');
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/publish')).length,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/telegram/send')).length,0);
  assert.match(d.querySelector('#toast').textContent,/Mensagem enviada/);
  w.close();
});

test('completed handoff reload recovers confirmed result without sending again',async()=>{
  const token='b2'.repeat(16);
  const doc='72727272-7272-4727-8727-727272727272';
  const initData='start_param=h_'+token;
  const requests=[];
  const action={type:'publish',status:'succeeded',attempts:1,result:{via:'sendRichMessage',messageId:42},error:'',startedAt:1,finishedAt:2,doc,revision:0};
  const fetch=async(url,options={})=>{
    const target=String(url);requests.push({url:target,options});
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Já enviado',html:'<p>confirmado</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:[]},files:[],action})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{initData}}),d=w.document;
  await wait(15);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/claim')).length,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/publish')).length,0);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/telegram/send')).length,0);
  assert.match(d.querySelector('#toast').textContent,/já foi publicada/);
  w.close();
});

test('handoff publish timeout checks status once and never retries the send silently',async()=>{
  const token='c3'.repeat(16);
  const doc='73737373-7373-4737-8737-737373737373';
  const initData='start_param=h_'+token;
  const requests=[];
  const pending={type:'publish',status:'pending',attempts:0,result:null,error:'',startedAt:0,finishedAt:0,doc,revision:0};
  const uncertain={...pending,status:'uncertain',attempts:1,error:'Resultado potencialmente incerto',finishedAt:2};
  const fetch=async(url,options={})=>{
    const target=String(url);requests.push({url:target,options});
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Timeout',html:'<p>texto</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:[]},files:[],action:pending})};
    if(target.endsWith('/api/handoff/publish')){const error=new Error('timeout');error.name='TimeoutError';throw error;}
    if(target.endsWith('/api/handoff/status'))return {ok:true,status:200,json:async()=>({action:uncertain})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{initData}}),d=w.document;
  await wait(15);
  await w.eval('publishCurrent()');
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/publish')).length,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/status')).length,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/telegram/send')).length,0);
  assert.match(d.querySelector('#toast').textContent,/potencialmente incerto/);
  w.close();
});

test('editing recovered handoff prevents publishing a stale transferred action',async()=>{
  const token='d4'.repeat(16);
  const doc='74747474-7474-4747-8747-747474747474';
  const initData='start_param=h_'+token;
  const requests=[];
  const pending={type:'publish',status:'pending',attempts:0,result:null,error:'',startedAt:0,finishedAt:0,doc,revision:0};
  const fetch=async(url,options={})=>{
    const target=String(url);requests.push({url:target,options});
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Original',html:'<p>original</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:[]},files:[],action:pending})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{initData}}),d=w.document;
  await wait(15);
  const editor=d.querySelector('#editor');
  editor.innerHTML='<p>editado</p>';
  editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  await w.eval('publishCurrent()');
  assert.equal(requests.filter(r=>r.url.endsWith('/api/handoff/publish')).length,0);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/telegram/send')).length,0);
  assert.match(d.querySelector('#toast').textContent,/documento mudou/);
  w.close();
});


test('native editor applies and removes semantic marks on the actual DOM selection',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>bold italic underline strike</p>',{silent:true})");
  for(const [word,command,selector] of [['bold','bold','strong'],['italic','italic','em'],['underline','underline','u'],['strike','strike','s']]){
    w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral("+JSON.stringify(word)+")[0],{focus:true})");
    w.eval("exec("+JSON.stringify(command)+")");
    assert.equal(e.querySelector(selector)?.textContent,word);
    w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral("+JSON.stringify(word)+")[0],{focus:true})");
    w.eval("exec("+JSON.stringify(command)+")");
    assert.equal(e.querySelector(selector),null);
  }
  w.close();
});

test('collapsed Bold Italic and Underline states apply to subsequently typed text',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p></p>',{silent:true})");
  const p=e.querySelector('p');
  const range=d.createRange();range.selectNodeContents(p);range.collapse(true);
  const selection=d.getSelection();selection.removeAllRanges();selection.addRange(range);
  e.focus();
  for(const cmd of ['bold','italic','underline'])w.eval("exec("+JSON.stringify(cmd)+")");
  const input=new w.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:'X'});
  e.dispatchEvent(input);
  assert.equal(e.querySelector('strong')?.textContent,'X');
  assert.equal(e.querySelector('em')?.textContent,'X');
  assert.equal(e.querySelector('u')?.textContent,'X');
  assert.equal(e.textContent,'X');
  w.close();
});

test('typing in a media caption remains continuous without inserted line breaks',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<figure><img src=\"https://example.com/a.png\"><figcaption></figcaption></figure>',{silent:true})");
  const caption=e.querySelector('figcaption');
  caption.focus();
  const selection=d.getSelection();
  for(const char of 'Legenda'){
    const range=d.createRange();range.selectNodeContents(caption);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
    range.insertNode(d.createTextNode(char));range.collapse(false);selection.removeAllRanges();selection.addRange(range);
    e.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertText',data:char}));
  }
  assert.equal(caption.textContent,'Legenda');
  assert.equal(caption.querySelector('br'),null);
  w.close();
});

test('selected text deletion persists exactly the browser DOM result',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>apagar manter</p>',{silent:true})");
  w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral('apagar ')[0],{focus:true})");
  const selection=d.getSelection(),range=selection.getRangeAt(0);
  range.deleteContents();range.collapse(true);selection.removeAllRanges();selection.addRange(range);
  e.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));
  assert.equal(e.textContent,'manter');
  assert.match(w.eval('draftHTML()'),/manter/);
  w.close();
});

test('editor shortcuts do not hijack document-name or find-field commands',()=>{
  const w=page(),d=w.document;
  w.eval("currentEditorCore().resetHTML('<p>texto</p>',{silent:true})");
  const before=d.querySelector('#editor').innerHTML;

  const name=d.querySelector('#docName');
  name.focus();
  const bold=new w.KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true,cancelable:true});
  name.dispatchEvent(bold);
  assert.equal(bold.defaultPrevented,false);
  assert.equal(d.querySelector('#editor').innerHTML,before);

  const find=d.querySelector('#findText');
  find.value='abc';
  find.focus();
  const undo=new w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});
  find.dispatchEvent(undo);
  assert.equal(undo.defaultPrevented,false);
  assert.equal(d.querySelector('#editor').innerHTML,before);
  w.close();
});

test('find treats punctuation and regex metacharacters literally',()=>{
  const w=page(),d=w.document;
  w.eval("currentEditorCore().resetHTML('<p>a.b C++ ( [ fim</p>',{silent:true})");
  const find=d.querySelector('#findText');
  for(const term of ['a.b','C++','(','[']){
    find.value=term;
    d.querySelector('#findNext').click();
    assert.equal(w.eval('currentEditorCore().selectedText()'),term);
  }
  w.close();
});

test('plain-text paste is one transactional history step',()=>{
  const w=page(),d=w.document;
  w.eval("currentEditorCore().resetHTML('<p>base</p>',{silent:true})");
  w.eval("const r=currentEditorCore().findLiteral('base')[0];currentEditorCore().selectRange({from:r.to,to:r.to},{focus:true})");
  const event=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{getData:type=>type==='text/plain'?' X\nY':''}});
  d.querySelector('#editor').dispatchEvent(event);
  assert.match(d.querySelector('#editor').textContent,/base X\s*Y/);
  d.querySelector('#undoBtn').click();
  assert.equal(d.querySelector('#editor').textContent,'base');
  w.close();
});


test('transaction history keeps the editor selection coherent through undo and redo',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>alpha beta</p>',{silent:true})");
  w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral('beta')[0],{focus:true})");
  d.querySelector('#typebar [data-cmd="bold"]').click();
  assert.equal(w.eval('currentEditorCore().selectedText()'),'beta');
  assert.ok(e.querySelector('strong'));

  d.querySelector('#undoBtn').click();
  assert.equal(e.querySelector('strong'),null);
  assert.equal(w.eval('currentEditorCore().selectedText()'),'beta');

  d.querySelector('#redoBtn').click();
  assert.ok(e.querySelector('strong'));
  assert.equal(w.eval('currentEditorCore().selectedText()'),'beta');
  w.close();
});

test('editor shortcuts are scoped to the editor and leave find and name fields with native commands',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>base</p>',{silent:true})");
  w.eval('currentEditorCore().selectRange({from:1,to:5},{focus:true})');
  d.querySelector('#typebar [data-cmd="bold"]').click();
  const before=e.innerHTML;

  const find=d.querySelector('#findText');
  find.value='native';
  find.focus();
  const undoEvent=new w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});
  find.dispatchEvent(undoEvent);
  assert.equal(undoEvent.defaultPrevented,false);
  assert.equal(e.innerHTML,before);

  const name=d.querySelector('#docName');
  name.focus();
  const boldEvent=new w.KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true,cancelable:true});
  name.dispatchEvent(boldEvent);
  assert.equal(boldEvent.defaultPrevented,false);
  assert.equal(e.innerHTML,before);
  w.close();
});

test('plain-text paste is a single transactional edit and never interprets pasted markup',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>x</p>',{silent:true})");
  w.eval('currentEditorCore().selectRange({from:2,to:2},{focus:true})');
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{getData:type=>type==='text/plain'?'<b>literal</b>\nline':''}});
  e.dispatchEvent(paste);
  assert.equal(paste.defaultPrevented,true);
  assert.match(e.textContent,/x<b>literal<\/b>line/);
  assert.equal(e.querySelectorAll('b,strong').length,0);
  assert.ok(e.querySelector('br'));

  d.querySelector('#undoBtn').click();
  assert.equal(e.textContent,'x');
  w.close();
});

test('find treats punctuation and regex metacharacters literally',()=>{
  const w=page(),d=w.document;
  w.eval("currentEditorCore().resetHTML('<p>a.b C++ ( [</p>',{silent:true})");
  const input=d.querySelector('#findText');
  for(const term of ['a.b','C++','(', '[']){
    input.value=term;
    d.querySelector('#findNext').click();
    assert.equal(w.eval('currentEditorCore().selectedText()'),term);
  }
  w.close();
});


test('Markdown round-trip preserves strike through edited semantic state',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>antes <del>cortado</del> depois</p>',{silent:true})");
  assert.equal(e.querySelector('s,del,strike')?.textContent,'cortado');
  const md=w.eval('htmlToMarkdown(exportDocumentHTML())');
  assert.match(md,/~~cortado~~/);
  const imported=w.eval('mdToBasicHTML('+JSON.stringify(md)+')');
  w.eval('currentEditorCore().resetHTML('+JSON.stringify(imported)+',{silent:true})');
  assert.equal(e.querySelector('s,del,strike')?.textContent,'cortado');
  const second=w.eval('htmlToMarkdown(exportDocumentHTML())');
  assert.match(second,/~~cortado~~/);
  w.close();
});

test('Markdown file boundary strips runtime media controls and remains reimportable',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const mediaHtml='<video src="https://example.com/video.mp4" controls></video><audio src="https://example.com/audio.ogg" controls></audio>';
  w.eval('currentEditorCore().resetHTML('+JSON.stringify(mediaHtml)+',{silent:true});decorateSpecials()');
  assert.equal(e.querySelector('video')?.hasAttribute('controls'),true);
  assert.equal(e.querySelector('audio')?.hasAttribute('controls'),true);
  const md=w.eval('htmlToMarkdown(exportDocumentHTML())');
  assert.doesNotMatch(md,/\scontrols(?:[\s=>]|$)/i);
  const imported=w.eval('mdToBasicHTML('+JSON.stringify(md)+')');
  const box=d.createElement('div');box.innerHTML=imported;
  assert.equal(box.querySelector('video')?.hasAttribute('controls'),false);
  assert.equal(box.querySelector('audio')?.hasAttribute('controls'),false);
  w.eval('currentEditorCore().resetHTML('+JSON.stringify(imported)+',{silent:true});decorateSpecials()');
  assert.equal(e.querySelector('video')?.hasAttribute('controls'),true);
  assert.doesNotThrow(()=>w.eval('mdToBasicHTML('+JSON.stringify(w.eval('htmlToMarkdown(exportDocumentHTML())'))+')'));
  w.close();
});

test('real Markdown import normalizes presentation attributes instead of returning original bytes',async()=>{
  const w=page(),d=w.document,input=d.querySelector('#fileInput'),e=d.querySelector('#editor');
  const original='<video src="https://example.com/video.mp4" controls></video>\n\n~~cortado~~';
  Object.defineProperty(input,'files',{configurable:true,value:[{name:'portable.md',text:async()=>original}]});
  input.dispatchEvent(new w.Event('change'));
  await wait(10);
  assert.equal(e.querySelector('video')?.hasAttribute('controls'),true);
  assert.equal(e.querySelector('s,del,strike')?.textContent,'cortado');
  const exported=w.eval('htmlToMarkdown(exportDocumentHTML())');
  assert.notEqual(exported,original);
  assert.doesNotMatch(exported,/\scontrols(?:[\s=>]|$)/i);
  assert.match(exported,/~~cortado~~/);
  assert.doesNotThrow(()=>w.eval('mdToBasicHTML('+JSON.stringify(exported)+')'));
  w.close();
});

test('lossy TXT conversion exposes a warning only when rich semantics would be dropped',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<p>texto simples</p>';
  assert.equal(w.eval('conversionWarning("txt")'),'');
  e.innerHTML='<p><strong>texto</strong> <a href="https://example.com">link</a></p>';
  assert.match(w.eval('conversionWarning("txt")'),/serão perdidos/i);
  assert.equal(w.eval('conversionWarning("md")'),'');
  w.close();
});


test('volume-backed draft recovery restores an active draft when local storage is empty',async()=>{
  const remote={version:2,name:'Do volume',html:'<p>persistido</p>',dest:'telegram',telegraphPath:'',docId:'91919191-9191-4919-8919-919191919191',revision:4,importedMd:'',importedTxt:'',importedHtml:'',media:[]};
  const requests=[];
  const fetch=async(url,options={})=>{
    const target=String(url);requests.push({url:target,options});
    if(target.endsWith('/api/drafts/load'))return {ok:true,status:200,json:async()=>({draft:remote,media:[],publication:null,owner:{kind:'browser'}})};
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch}),d=w.document;
  await wait(15);
  assert.equal(d.querySelector('#docName').value,'Do volume');
  assert.equal(d.querySelector('#editor').textContent,'persistido');
  assert.equal(JSON.parse(w.localStorage.getItem('rmdtxtml')).docId,remote.docId);
  assert.ok(requests.some(row=>row.url.endsWith('/api/drafts/load')));
  w.close();
});

test('pagehide writes the active draft to the volume contract as well as local storage',async()=>{
  const doc='92929292-9292-4929-8929-929292929292';
  const raw=JSON.stringify({version:2,name:'Local',html:'<p>local</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:2,importedMd:'',importedTxt:'',importedHtml:'',media:[]});
  const saved=[];
  const fetch=async(url,options={})=>{
    const target=String(url);
    if(target.endsWith('/api/drafts/save')){
      const draft=JSON.parse(options.body.get('draft'));
      saved.push({draft,browserKey:options.body.get('browserKey')});
      return {ok:true,status:200,json:async()=>({draft})};
    }
    if(target.endsWith('/api/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,local:{rmdtxtml:raw}});
  await wait(5);
  w.dispatchEvent(new w.Event('pagehide'));
  await wait(10);
  assert.ok(saved.length>=1);
  assert.equal(saved.at(-1).draft.docId,doc);
  assert.match(saved.at(-1).browserKey,/^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(w.localStorage.getItem('rmdtxtml')).docId,doc);
  w.close();
});

test('visual viewport constrains overlays and Find stays anchored to a visible control',async()=>{
  const w=page({visualViewport:{offsetLeft:0,offsetTop:100,width:390,height:300}}),d=w.document;
  const plus=d.querySelector('#plusBtn'),find=d.querySelector('#findMenu'),dialog=d.querySelector('#dialogMenu'),bar=d.querySelector('.bar-wrap');
  bar.getBoundingClientRect=()=>({left:20,top:310,width:350,height:58,right:370,bottom:368});
  plus.getBoundingClientRect=()=>({left:18,top:332,width:40,height:40,right:58,bottom:372});
  find.getBoundingClientRect=()=>{
    const limit=parseFloat(find.style.getPropertyValue('--menu-max-height'))||240;
    const height=Math.min(240,limit);
    return {left:0,top:0,width:280,height,right:280,bottom:height};
  };
  dialog.getBoundingClientRect=()=>{
    const limit=parseFloat(dialog.style.getPropertyValue('--menu-max-height'))||120;
    const height=Math.min(120,limit);
    return {left:0,top:0,width:280,height,right:280,bottom:height};
  };

  d.querySelector('#findBtn').click();
  assert.equal(find.hasAttribute('data-menu-open'),true);
  assert.equal(w.eval("panelAnchor(document.querySelector('#findMenu'))===document.querySelector('#plusBtn')"),true);
  const findLimit=parseFloat(find.style.getPropertyValue('--menu-max-height'));
  const findTop=parseFloat(find.style.getPropertyValue('--menu-top'));
  assert.ok(findLimit>0&&findLimit<=165);
  assert.ok(findTop>=108);
  assert.ok(findTop+Math.min(240,findLimit)<=302);

  const prompt=w.eval("ask('Teste','valor')");
  await wait(0);
  const dialogLimit=parseFloat(dialog.style.getPropertyValue('--menu-max-height'));
  const dialogLeft=parseFloat(dialog.style.getPropertyValue('--menu-left'));
  const dialogTop=parseFloat(dialog.style.getPropertyValue('--menu-top'));
  assert.ok(dialogLimit<=112);
  assert.ok(dialogLeft>=8&&dialogLeft+280<=382);
  assert.ok(dialogTop>=108&&dialogTop+Math.min(120,dialogLimit)<=294);
  d.querySelector('#dialogCancel').click();
  assert.equal(await prompt,null);
  w.close();
});

test('link interactions stay above the bottom trigger and expose only destination-supported actions',async()=>{
  const w=page({visualViewport:{offsetLeft:0,offsetTop:100,width:390,height:300}}),d=w.document;
  const linkBtn=d.querySelector('#linkBtn'),linkMenu=d.querySelector('#linkMenu'),dialog=d.querySelector('#dialogMenu'),barWrap=d.querySelector('.bar-wrap');
  barWrap.getBoundingClientRect=()=>({left:8,top:320,width:374,height:56,right:382,bottom:376});
  linkBtn.getBoundingClientRect=()=>({left:130,top:340,width:40,height:40,right:170,bottom:380});
  linkMenu.getBoundingClientRect=()=>{
    const limit=parseFloat(linkMenu.style.getPropertyValue('--menu-max-height'))||72;
    const height=Math.min(72,limit);
    return {left:0,top:0,width:210,height,right:210,bottom:height};
  };
  dialog.getBoundingClientRect=()=>{
    const limit=parseFloat(dialog.style.getPropertyValue('--menu-max-height'))||100;
    const height=Math.min(100,limit);
    return {left:0,top:0,width:280,height,right:280,bottom:height};
  };

  linkBtn.click();
  assert.equal(linkMenu.hasAttribute('data-menu-open'),true);
  assert.equal(w.eval("panelAnchor(document.querySelector('#linkMenu'))===document.querySelector('#linkBtn')"),true);
  const linkTop=parseFloat(linkMenu.style.getPropertyValue('--menu-top'));
  const linkHeight=Math.min(72,parseFloat(linkMenu.style.getPropertyValue('--menu-max-height'))||72);
  assert.ok(linkTop<320);
  assert.ok(linkTop+linkHeight<=312);

  const buttonChoice=linkMenu.querySelector('[data-link-kind="button"]');
  const urlChoice=linkMenu.querySelector('[data-link-kind="url"]');
  assert.equal(buttonChoice.hidden,false);

  w.eval("setDestination('telegraph',false,false)");
  assert.equal(buttonChoice.hidden,true);
  urlChoice.click();
  for(let i=0;i<10&&d.querySelector('#dialogLabel').textContent!=='Link';i++)await wait(0);
  assert.equal(d.querySelector('#dialogLabel').textContent,'Link');
  assert.equal(w.eval("panelAnchor(document.querySelector('#dialogMenu'))===document.querySelector('#linkBtn')"),true);
  const dialogTop=parseFloat(dialog.style.getPropertyValue('--menu-top'));
  const dialogHeight=Math.min(100,parseFloat(dialog.style.getPropertyValue('--menu-max-height'))||100);
  assert.ok(dialogTop<320);
  assert.ok(dialogTop+dialogHeight<=312);
  d.querySelector('#dialogInput').value='tg://resolve?domain=example';
  d.querySelector('#dialogOk').click();
  for(let i=0;i<10&&!/Telegraph exige link HTTP ou HTTPS/.test(d.querySelector('#toast').textContent);i++)await wait(0);
  assert.match(d.querySelector('#toast').textContent,/Telegraph exige link HTTP ou HTTPS/);

  w.eval("setDestination('telegram',false,false)");
  linkBtn.click();
  assert.equal(buttonChoice.hidden,false);
  w.eval("closePanel(document.querySelector('#linkMenu'))");
  w.close();
});

test('link actions distinguish hyperlink, visible URL and Telegram URL button through the user-facing menu',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor'),dialog=d.querySelector('#dialogInput'),ok=d.querySelector('#dialogOk');
  const linkBtn=d.querySelector('#linkBtn'),linkMenu=d.querySelector('#linkMenu');

  const choose=async(kind,label)=>{
    linkBtn.click();
    assert.equal(linkMenu.hasAttribute('data-menu-open'),true);
    const choice=linkMenu.querySelector('[data-link-kind="'+kind+'"]');
    assert.ok(choice&&!choice.hidden);
    choice.click();
    for(let i=0;i<10&&d.querySelector('#dialogLabel').textContent!==label;i++)await wait(0);
    assert.equal(d.querySelector('#dialogLabel').textContent,label);
    assert.equal(w.eval("panelAnchor(document.querySelector('#dialogMenu'))===document.querySelector('#linkBtn')"),true);
  };

  w.eval("currentEditorCore().resetHTML('<p>alpha beta</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('alpha')[0];currentEditorCore().selectRange({from:r.from,to:r.to},{focus:true});saveSel()})()");
  await choose('hyperlink','URL do hyperlink');
  dialog.value='https://example.com/hyper';
  ok.click();
  for(let i=0;i<10&&e.querySelector('a')?.textContent!=='alpha';i++)await wait(0);
  assert.equal(e.querySelector('a')?.textContent,'alpha');
  assert.equal(e.querySelector('a')?.getAttribute('href'),'https://example.com/hyper');

  w.eval("(()=>{const core=currentEditorCore(),pos=document.querySelector('#editor').textContent.length;core.selectRange({from:pos,to:pos},{focus:true});saveSel()})()");
  await choose('url','Link');
  dialog.value='https://example.com/visible';
  ok.click();
  for(let i=0;i<10&&[...e.querySelectorAll('a')].at(-1)?.textContent!=='https://example.com/visible';i++)await wait(0);
  const links=[...e.querySelectorAll('a')];
  assert.equal(links.at(-1)?.textContent,'https://example.com/visible');
  assert.equal(links.at(-1)?.getAttribute('href'),'https://example.com/visible');

  w.eval("setDestination('telegram',false,false)");
  w.eval("(()=>{const core=currentEditorCore(),pos=document.querySelector('#editor').textContent.length;core.selectRange({from:pos,to:pos},{focus:true});saveSel()})()");
  await choose('button','Texto do botão');
  dialog.value='Abrir site';
  ok.click();
  for(let i=0;i<10&&d.querySelector('#dialogLabel').textContent!=='Link do botão';i++)await wait(0);
  assert.equal(d.querySelector('#dialogLabel').textContent,'Link do botão');
  assert.equal(w.eval("panelAnchor(document.querySelector('#dialogMenu'))===document.querySelector('#linkBtn')"),true);
  dialog.value='https://example.com/button';
  ok.click();
  for(let i=0;i<10&&!e.querySelector('tg-button');i++)await wait(0);
  const button=e.querySelector('tg-button');
  assert.equal(button?.textContent,'Abrir site');
  assert.equal(button?.getAttribute('type'),'url');
  assert.equal(button?.getAttribute('url'),'https://example.com/button');
  assert.equal(button?.hasAttribute('style'),false);
  w.close();
});

test('dialog modality traps focus, restores its origin and preserves editor selection',async()=>{
  const w=page(),d=w.document,canvas=d.querySelector('#canvas'),origin=d.querySelector('#linkBtn');
  w.eval("currentEditorCore().resetHTML('<p>alpha beta</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('alpha')[0];currentEditorCore().selectRange({from:r.from,to:r.to},{focus:true});saveSel()})()");
  const before=w.eval('(()=>{restoreSel();return currentEditorCore().selectionOffsets()?.from})()');
  origin.focus();
  const prompt=w.eval("ask('Link','https://')");
  await wait(0);

  const input=d.querySelector('#dialogInput');
  assert.equal(d.activeElement,input);
  assert.equal(canvas.hasAttribute('inert'),true);
  assert.equal(w.eval('(()=>{restoreSel();return currentEditorCore().selectionOffsets()?.from})()'),before);

  origin.focus();
  await wait(0);
  assert.equal(d.activeElement,input);

  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}));
  assert.equal(d.activeElement,d.querySelector('#dialogOk'));
  d.querySelector('#dialogCancel').click();
  assert.equal(await prompt,null);
  assert.equal(canvas.hasAttribute('inert'),false);
  assert.equal(d.activeElement,origin);
  assert.equal(w.eval('(()=>{restoreSel();return currentEditorCore().selectionOffsets()?.from})()'),before);
  w.close();
});

test('Escape closes a programmatic menu without stealing active editor focus or selection',()=>{
  const w=page(),d=w.document,plus=d.querySelector('#plusBtn'),menu=d.querySelector('#plusMenu');
  w.eval("currentEditorCore().resetHTML('<p>alpha beta</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('beta')[0];currentEditorCore().selectRange({from:r.from,to:r.to},{focus:true});saveSel()})()");
  const before=w.eval('(()=>{restoreSel();return currentEditorCore().selectionOffsets()?.from})()');
  plus.focus();
  w.eval("openPanel('#plusMenu')");
  d.querySelector('#docName').focus();
  assert.equal(w.eval('(()=>{restoreSel();return currentEditorCore().selectionOffsets()?.from})()'),before);
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(menu.hasAttribute('data-menu-open'),false);
  assert.equal(d.activeElement,d.querySelector('#editor'));
  assert.equal(w.eval('(()=>{restoreSel();return currentEditorCore().selectionOffsets()?.from})()'),before);
  w.close();
});

test('viewport resize repositions an open dialog using the current visual area',async()=>{
  const w=page({visualViewport:{offsetLeft:0,offsetTop:20,width:390,height:700}}),d=w.document,dialog=d.querySelector('#dialogMenu');
  dialog.getBoundingClientRect=()=>({left:0,top:0,width:280,height:100,right:280,bottom:100});
  const prompt=w.eval("ask('Teste','valor')");
  await wait(0);
  assert.equal(parseFloat(dialog.style.getPropertyValue('--menu-top')),320);
  w.visualViewport.offsetTop=80;
  w.visualViewport.height=280;
  w.eval('syncBrowserViewport()');
  assert.equal(parseFloat(dialog.style.getPropertyValue('--menu-top')),170);
  // O diálogo pode ocupar toda a área livre (280px menos 8px de cada lado) para
  // mostrar o texto inteiro; os menus continuam com o teto de 55%.
  assert.equal(parseFloat(dialog.style.getPropertyValue('--menu-max-height')),264);
  d.querySelector('#dialogCancel').click();
  await prompt;
  w.close();
});

test('open menu stays on the trigger when the keyboard pans the visual viewport',async()=>{
  const w=page({visualViewport:{offsetLeft:0,offsetTop:160,width:390,height:420}}),d=w.document;
  const prev=w.HTMLElement.prototype.getBoundingClientRect;
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this.hasAttribute('data-fixed-probe'))return {left:0,top:-160,width:4,height:4,right:4,bottom:-156};
    return prev.call(this);
  };
  const heading=d.querySelector('#headingBtn'),menu=d.querySelector('#headingMenu'),bar=d.querySelector('.bar-wrap');
  bar.getBoundingClientRect=()=>({left:16,top:340,width:350,height:52,right:366,bottom:392});
  heading.getBoundingClientRect=()=>({left:180,top:348,width:40,height:40,right:220,bottom:388});
  menu.getBoundingClientRect=()=>{
    const limit=parseFloat(menu.style.getPropertyValue('--menu-max-height'))||160;
    const height=Math.min(160,limit);
    return {left:0,top:0,width:210,height,right:210,bottom:height};
  };
  heading.click();
  assert.equal(menu.hasAttribute('data-menu-open'),true);
  const top=parseFloat(menu.style.getPropertyValue('--menu-top'));
  const height=Math.min(160,parseFloat(menu.style.getPropertyValue('--menu-max-height'))||160);
  const menuBottom=top+height;
  // A barra foi medida na área visível (top 340) e o fixed é do viewport de layout,
  // deslocado por offsetTop 160. O menu encosta acima da barra, não flutua 160px acima.
  const barLayoutTop=340+160;
  assert.ok(menuBottom<=barLayoutTop-8+0.5,'base '+menuBottom);
  assert.ok(menuBottom>=barLayoutTop-40,'base longe '+menuBottom);
  assert.ok(top>=160+8,'topo '+top);
  w.close();
});

// A sonda do fixed (top:0 a bottom:0) mede a origem e a altura do bloco do
// position:fixed. Os três casos com o teclado aberto e a área visível deslocada:
function probeFrame(probe,clientHeight=844){
  const w=page({visualViewport:{offsetLeft:0,offsetTop:120,width:390,height:504}});
  Object.defineProperty(w.document.documentElement,'clientHeight',{configurable:true,get:()=>clientHeight});
  const prev=w.HTMLElement.prototype.getBoundingClientRect;
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this.hasAttribute('data-fixed-probe'))return {left:0,right:4,width:4,...probe,bottom:probe.top+probe.height};
    return prev.call(this);
  };
  const frame=w.eval('fixedFrame()');
  w.close();
  return frame;
}
test('fixed frame: fixed already following the visual area keeps the origin at 0 (no keyboard height added twice)',()=>{
  // Sonda em 0 com a altura da área visível: o fixed acompanha a área visível
  // (o caso do 86d2617). Nada de deslocamento e a altura é a da área visível.
  const frame=probeFrame({top:0,height:504});
  assert.equal(frame.visualFixed,true);
  assert.deepEqual([frame.shiftX,frame.shiftY],[0,0]);
  assert.deepEqual([frame.bounds.top,frame.bounds.height],[0,504]);
});
test('fixed frame: rect and fixed both relative to the layout viewport place the visible area at offsetTop',()=>{
  // Sonda em 0 com a altura do viewport de layout: as duas origens coincidem e a
  // área visível começa em offsetTop (antes isso era lido como fixed na área visível).
  const frame=probeFrame({top:0,height:844});
  assert.equal(frame.visualFixed,false);
  assert.deepEqual([frame.shiftX,frame.shiftY],[0,0]);
  assert.deepEqual([frame.bounds.top,frame.bounds.height],[120,504]);
});
test('fixed frame: rect relative to the visual area and fixed to the layout viewport shift by offsetTop',()=>{
  const frame=probeFrame({top:-120,height:844});
  assert.equal(frame.visualFixed,false);
  assert.deepEqual([frame.shiftX,frame.shiftY],[0,120]);
  assert.deepEqual([frame.bounds.top,frame.bounds.height],[120,504]);
});


test('special quote controls format the current content instead of inserting sample phrases',async()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>Texto real do autor</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('real')[0];currentEditorCore().selectRange({from:r.from,to:r.to},{focus:true});saveSel()})()");
  await w.eval("insertFeature('expandquote')");
  assert.equal(e.firstElementChild.tagName,'BLOCKQUOTE');
  assert.equal(e.firstElementChild.hasAttribute('expandable'),true);
  assert.equal(e.firstElementChild.textContent,'Texto real do autor');
  assert.equal(e.textContent.includes('Citação expansível'),false);
  w.eval("syncEditorSelectionUI()");
  assert.equal(d.querySelector('#quoteMenu [data-insert="expandquote"]').classList.contains('is-current'),true);

  await w.eval("insertFeature('pullquote')");
  assert.equal(e.firstElementChild.tagName,'ASIDE');
  assert.equal(e.firstElementChild.textContent,'Texto real do autor');
  assert.equal(e.textContent.includes('Citação em destaque'),false);
  w.eval("syncEditorSelectionUI()");
  assert.equal(d.querySelector('#quoteMenu [data-insert="pullquote"]').classList.contains('is-current'),true);
  w.close();
});

test('empty structural insertions do not become published-looking fixture text',async()=>{
  const w=page(),e=w.document.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p></p>',{silent:true})");
  await w.eval("insertFeature('expandquote')");
  assert.equal(e.firstElementChild.tagName,'BLOCKQUOTE');
  assert.equal(e.firstElementChild.hasAttribute('expandable'),true);
  assert.equal(e.textContent,'');

  w.eval("currentEditorCore().resetHTML('<p></p>',{silent:true})");
  await w.eval("insertFeature('pullquote')");
  assert.equal(e.firstElementChild.tagName,'ASIDE');
  assert.equal(e.textContent,'');

  w.eval("currentEditorCore().resetHTML('<p></p>',{silent:true})");
  await w.eval("insertFeature('task')");
  assert.equal(e.querySelector('input[type="checkbox"]')!==null,true);
  assert.equal(e.textContent,'');

  w.eval("currentEditorCore().resetHTML('<p></p>',{silent:true})");
  await w.eval("insertFeature('details')");
  assert.equal(e.querySelector('details summary')?.textContent,'');
  assert.equal(e.querySelector('details p')?.textContent,'');

  w.close();
});

test('React renders menu state described by app.js: anchors, dismiss layer, destination items, current block and dialog',async()=>{
  const w=page(),d=w.document;
  await wait(0);
  const heading=d.querySelector('#headingMenu'),headingBtn=d.querySelector('#headingBtn'),layer=d.querySelector('#menuDismissLayer');
  assert.equal(heading.hasAttribute('data-menu-open'),false);
  assert.equal(layer.hidden,true);
  headingBtn.click();
  assert.equal(heading.hasAttribute('data-menu-open'),true);
  assert.equal(heading.hasAttribute('data-runtime-positioned'),true);
  assert.match(heading.style.getPropertyValue('--menu-max-height'),/^\d+(\.\d+)?px$/);
  assert.equal(headingBtn.getAttribute('aria-expanded'),'true');
  assert.equal(layer.hidden,false);
  layer.click();
  assert.equal(heading.hasAttribute('data-menu-open'),false);
  assert.equal(headingBtn.getAttribute('aria-expanded'),'false');
  assert.equal(layer.hidden,true);

  const plusBtn=d.querySelector('#plusBtn');
  plusBtn.click();
  assert.equal(plusBtn.classList.contains('on'),true);
  d.querySelector('[data-plus-category="format"]').click();
  assert.equal(d.querySelector('#plus-format-menu').hasAttribute('data-menu-open'),true);
  assert.equal(plusBtn.classList.contains('on'),true);
  layer.click();
  assert.equal(plusBtn.classList.contains('on'),false);

  const spoiler=d.querySelector('[data-cmd="spoiler"]'),embed=d.querySelector('[data-insert="embed"]');
  const h1=d.querySelector('#headingMenu [data-block="h1"]'),h3=d.querySelector('#headingMenu [data-block="h3"]');
  const expand=d.querySelector('#quoteMenu [data-insert="expandquote"]');
  assert.deepEqual([spoiler.hidden,embed.hidden,h1.hidden,h3.hidden,expand.hidden],[false,true,false,false,false]);
  assert.equal(d.querySelector('#openAppLabel').textContent,'Abrir no Mini App');
  d.querySelector('#destBtn').click();
  assert.deepEqual([spoiler.hidden,embed.hidden,h1.hidden,h3.hidden,expand.hidden],[true,false,true,false,true]);
  // Seletor efêmero: mostra o destino, sem estado ligado/ativo persistente.
  assert.equal(d.querySelector('#destBtn').getAttribute('data-dest'),'telegraph');
  assert.equal(d.querySelector('#destBtn').hasAttribute('aria-pressed'),false);
  assert.equal(d.querySelector('#destBtn').classList.contains('active'),false);
  assert.equal(d.querySelector('#openAppLabel').textContent,'Publicar no Telegraph');
  assert.equal(d.querySelector('#openAppBtn [data-icon]').getAttribute('data-icon'),'telegraph');

  w.eval('currentEditorCore().resetHTML("<h3>Seção</h3>",{silent:true})');
  const text=d.querySelector('#editor h3').firstChild,range=d.createRange();
  range.setStart(text,2);range.collapse(true);
  d.getSelection().removeAllRanges();d.getSelection().addRange(range);
  d.dispatchEvent(new w.Event('selectionchange'));
  assert.equal(h3.classList.contains('is-current'),true);
  assert.equal(h1.classList.contains('is-current'),false);

  const answer=w.eval('ask("Nome do link","https://exemplo.test")');
  const dialog=d.querySelector('#dialogMenu');
  assert.equal(dialog.matches(':popover-open'),true);
  assert.equal(d.querySelector('#dialogLabel').textContent,'Nome do link');
  assert.equal(d.querySelector('#dialogInput').value,'https://exemplo.test');
  assert.equal(d.querySelector('#dialogInput').hidden,false);
  assert.equal(d.querySelector('#dialogOk').textContent,'OK');
  d.querySelector('#dialogInput').value='https://outro.test';
  d.querySelector('#dialogOk').click();
  assert.equal(await answer,'https://outro.test');
  assert.equal(dialog.matches(':popover-open'),false);
  const confirmation=w.eval('approve("Apagar?")');
  assert.equal(d.querySelector('#dialogInput').hidden,true);
  assert.equal(d.querySelector('#dialogOk').textContent,'Continuar');
  d.querySelector('#dialogCancel').click();
  assert.equal(await confirmation,false);
  w.close();
});

// Avisos efêmeros: um toque em qualquer ponto fecha o aviso sem tirar o foco do editor
// (o teclado continua aberto). Fora do aviso, o toque segue para o controle tocado; no
// próprio aviso, só o fecha e não chega ao que está embaixo.
test('a tap anywhere dismisses the toast or the portrait notice and keeps the typing focus; a tap on the notice reaches nothing below',async()=>{
  const w=page({visualViewport:{height:360}}),d=w.document,root=d.documentElement,editor=d.querySelector('#editor');
  await wait(40);
  editor.focus();
  const exportBtn=d.querySelector('#exportBtn'),exportMenu=d.querySelector('#exportMenu');
  const fire=(target,type,pointerType)=>{
    const event=new w.Event(type,{bubbles:true,cancelable:true});
    if(pointerType)Object.defineProperty(event,'pointerType',{value:pointerType});
    target.dispatchEvent(event);
    return event;
  };
  const noticeShown=()=>w.MDTXTRT_UI.getState().toast.visible||root.hasAttribute('data-device-gate');
  // A ordem real dos eventos: mouse (pointerdown, mousedown, pointerup, mouseup) e
  // dedo (pointerdown, pointerup e só então os de compatibilidade), depois o click.
  // atPress = o aviso continuava na tela logo depois do pointerdown (ele só some
  // quando o toque termina, então nada se mexe no meio do gesto).
  const tap=(target,pointerType)=>{
    const order=pointerType==='touch'?['pointerdown','pointerup','mousedown','mouseup']:['pointerdown','mousedown','pointerup','mouseup'];
    const prevented={};let atPress=null;
    for(const type of order){
      prevented[type]=fire(target,type,type.startsWith('pointer')?pointerType:undefined).defaultPrevented;
      if(type==='pointerdown')atPress=noticeShown();
    }
    let clicked=false;const seen=()=>{clicked=true;};
    target.addEventListener('click',seen);target.click();target.removeEventListener('click',seen);
    return {down:prevented.pointerdown,mouse:prevented.mousedown,clicked,atPress};
  };
  // Toque fora (no ☰), com mouse: os dois avisos fecham e o ☰ abre, foco no editor.
  assert.equal(root.hasAttribute('data-device-gate'),true,'este ambiente abre com o aviso de retrato');
  w.eval('showToast("Aviso de teste")');
  let t=tap(exportBtn,'mouse');
  assert.equal(t.atPress,true,'nada some no começo do toque');
  assert.equal(w.MDTXTRT_UI.getState().toast.visible,false,'o toast fecha no toque');
  assert.equal(root.hasAttribute('data-device-gate'),false,'o aviso de retrato fecha no mesmo toque');
  assert.equal(t.clicked,true);
  assert.equal(exportMenu.hasAttribute('data-menu-open'),true,'o toque fora segue para o ☰');
  assert.equal(d.activeElement,editor,'o foco continua no editor');
  exportBtn.click();
  // Toque fora com o dedo (no +).
  w.eval('showToast("Outro aviso")');
  t=tap(d.querySelector('#plusBtn'),'touch');
  assert.equal(w.MDTXTRT_UI.getState().toast.visible,false);
  assert.equal(d.querySelector('#plusMenu').hasAttribute('data-menu-open'),true);
  assert.equal(d.activeElement,editor);
  d.querySelector('#plusBtn').click();
  // Toque no próprio toast: fecha e não chega a nada (mouse: pointerdown e mousedown
  // cancelados; dedo: só o mousedown, o pointerdown não pode ser cancelado no WebKit).
  for(const pointerType of ['mouse','touch']){
    w.eval('showToast("Aviso")');
    const material=d.querySelector('#toast .toast-material');
    let reached=false;const below=()=>{reached=true;};
    d.body.addEventListener('click',below);
    t=tap(material,pointerType);
    d.body.removeEventListener('click',below);
    assert.equal(t.atPress,true,'no próprio aviso também só some ao soltar ('+pointerType+')');
    assert.equal(w.MDTXTRT_UI.getState().toast.visible,false,pointerType);
    assert.deepEqual({down:t.down,mouse:t.mouse,reached},{down:pointerType==='mouse',mouse:true,reached:false},pointerType);
    assert.equal(d.activeElement,editor,pointerType);
  }
  // Toque no cartão do aviso de retrato: fecha e não chega a nada.
  root.setAttribute('data-device-gate','');
  const card=d.querySelector('#deviceGate .device-gate-card');
  t=tap(card,'touch');
  assert.equal(root.hasAttribute('data-device-gate'),false);
  assert.equal(t.mouse,true);
  assert.equal(d.activeElement,editor);
  // Toque que começa dentro de um diálogo aberto: o aviso não some nem mexe na tela,
  // e o botão tocado dispara.
  const confirmation=w.eval('approve("Apagar?")');
  w.eval('showToast("Aviso por cima")');
  root.setAttribute('data-device-gate','');
  t=tap(d.querySelector('#dialogOk'),'touch');
  assert.equal(t.clicked,true);
  assert.equal(await confirmation,true,'o botão do diálogo dispara');
  assert.equal(w.MDTXTRT_UI.getState().toast.visible,true,'o toast continua: o toque era no diálogo');
  assert.equal(root.hasAttribute('data-device-gate'),true,'o aviso de retrato também');
  w.eval('dismissNotices()');
  // Depois de um toque no aviso que vira rolagem (pointercancel), o clique seguinte
  // não é engolido.
  w.eval('showToast("Aviso")');
  fire(d.querySelector('#toast .toast-material'),'pointerdown','touch');
  fire(d.querySelector('#toast .toast-material'),'pointercancel','touch');
  exportBtn.click();
  assert.equal(exportMenu.hasAttribute('data-menu-open'),true);
  w.close();
});

test('toast is React state: text and visibility come from the UI store and the text stays after it hides',async()=>{
  const w=page(),d=w.document;
  await wait(5);
  const toast=d.querySelector('#toast');
  w.eval('showToast("Aviso de teste")');
  assert.equal(toast.classList.contains('on'),true);
  assert.equal(d.querySelector('#toastTextHost').textContent,'Aviso de teste');
  assert.deepEqual({...w.MDTXTRT_UI.getState().toast},{text:'Aviso de teste',visible:true});
  w.eval('showToast("Segundo aviso")');
  assert.equal(d.querySelector('#toast').textContent,'Segundo aviso');
  await wait(1700);
  assert.equal(d.querySelector('#toast'),toast,'o mesmo elemento continua montado');
  assert.equal(toast.classList.contains('on'),false);
  assert.equal(toast.textContent,'Segundo aviso');
  w.close();
});

test('Mini App disables vertical swipes only when the WebApp version supports it',async()=>{
  const fetch=async(url)=>String(url).endsWith('/api/telegram/session')?{ok:true,status:200,json:async()=>({ok:true})}:{ok:false,status:404,json:async()=>({error:'not found'})};
  let calls=0;
  const w=page({fetch,tg:{isVersionAtLeast:version=>['7.7','8.0'].includes(version),disableVerticalSwipes(){calls++;}}});
  for(let i=0;i<50&&w.eval('session')!=='ready';i++)await wait(10);
  assert.equal(calls,1);
  w.close();
  let oldCalls=0;
  const old=page({fetch,tg:{isVersionAtLeast:()=>false,disableVerticalSwipes(){oldCalls++;}}});
  for(let i=0;i<50&&old.eval('session')!=='ready';i++)await wait(10);
  assert.equal(oldCalls,0);
  old.close();
  const missing=page({fetch,tg:{isVersionAtLeast:()=>true}});
  for(let i=0;i<50&&missing.eval('session')!=='ready';i++)await wait(10);
  assert.equal(missing.eval('session'),'ready');
  missing.close();
});

test('Mini App MD export uses WebApp.downloadFile with the server link; browser keeps the local download',async()=>{
  const downloads=[],posts=[];
  const fetch=async(url,options={})=>{
    const target=String(url);
    if(target.endsWith('/api/telegram/session'))return {ok:true,status:200,json:async()=>({ok:true})};
    if(target.endsWith('/api/export/download')){posts.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({url:'https://mdtxtrt.up.railway.app/api/export/download/'+'b'.repeat(32),file_name:'Notas.md'})};}
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  const w=page({fetch,tg:{isVersionAtLeast:version=>version==='8.0'||version==='7.7',downloadFile(params){downloads.push(params);}}}),d=w.document;
  for(let i=0;i<50&&w.eval('session')!=='ready';i++)await wait(10);
  let anchors=0;const realClick=w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click=function(){if(this.download)anchors++;return realClick.call(this);};
  d.querySelector('#docName').value='Notas';
  d.querySelector('#editor').innerHTML='<h1>Oi</h1><p>texto</p>';
  await w.eval('exportFile("md")');
  assert.equal(anchors,0);
  assert.equal(JSON.stringify(downloads),JSON.stringify([{url:'https://mdtxtrt.up.railway.app/api/export/download/'+'b'.repeat(32),file_name:'Notas.md'}]));
  assert.equal(posts.length,1);
  assert.equal(posts[0].initData,'signed-payload');
  assert.equal(posts[0].format,'md');
  assert.equal(posts[0].name,'Notas.md');
  assert.match(posts[0].content,/^# Oi/);
  assert.match(d.querySelector('#toast').textContent,/Download iniciado/);
  w.close();

  const old=page({fetch,tg:{isVersionAtLeast:()=>false,downloadFile(params){downloads.push(params);}}});
  for(let i=0;i<50&&old.eval('session')!=='ready';i++)await wait(10);
  let oldAnchors=0;old.HTMLAnchorElement.prototype.click=function(){if(this.download)oldAnchors++;};
  old.document.querySelector('#docName').value='Notas';
  old.document.querySelector('#editor').innerHTML='<p>texto</p>';
  await old.eval('exportFile("txt")');
  assert.equal(oldAnchors,1);
  assert.equal(downloads.length,1);
  old.close();

  const b=page();
  let browserAnchors=0;b.HTMLAnchorElement.prototype.click=function(){if(this.download)browserAnchors++;};
  b.document.querySelector('#docName').value='Notas';
  b.document.querySelector('#editor').innerHTML='<p>texto</p>';
  await b.eval('exportFile("md")');
  assert.equal(browserAnchors,1);
  assert.equal(b.__requests.some(r=>r.url.includes('/api/export/download')),false);
  b.close();
});
