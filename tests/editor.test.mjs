import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {randomUUID} from 'node:crypto';
import {TextEncoder} from 'node:util';

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

function page(setup={}){
  const dom=new JSDOM(readFileSync(new URL('index.html',root),'utf8'),{
    url:'https://mdtxtrt.example/',
    runScripts:'outside-only',
    pretendToBeVisual:true
  });
  const w=dom.window;
  w.TextEncoder=TextEncoder;
  Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID,configurable:true});
  w.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  Object.defineProperty(w,'visualViewport',{value:{
    offsetTop:0,height:800,
    addEventListener(){},removeEventListener(){}
  },configurable:true});
  if(!w.AbortSignal.timeout)w.AbortSignal.timeout=()=>new w.AbortController().signal;
  w.HTMLElement.prototype.scrollIntoView=function(){};
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
  w.eval(readFileSync(new URL('marked.js',root),'utf8'));
  w.eval(readFileSync(new URL('turndown.js',root),'utf8'));
  w.eval(readFileSync(new URL('app.js',root),'utf8'));
  return w;
}

test('destination controls remain functional without changing editor shell',()=>{
  const w=page(),d=w.document;
  assert.equal(d.querySelector('#destBtn').title,'Destino: Telegram');
  d.querySelector('#destBtn').click();
  assert.equal(d.querySelector('#destBtn').title,'Destino: Telegraph');
  assert.ok(d.querySelector('#editor'));
  assert.ok(d.querySelector('#typebar'));
  w.close();
});

test('formatting undo and redo restore semantic document states',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  e.innerHTML='<p>texto selecionado</p>';
  e.dispatchEvent(new w.Event('input',{bubbles:true}));
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
  e.innerHTML='<p>İxA <strong>axa</strong></p>';
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
  assert.equal(d.querySelector('#docName').value.length,120);
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

test('a second local attachment does not remove the existing attachment',async()=>{
  const db=memoryIndexedDB();
  const w=page({indexedDB:db,objectURL:()=> 'blob:media'}),d=w.document,input=d.querySelector('#mediaInput');
  const first=new w.File([new Uint8Array([1])],'one.png',{type:'image/png'});
  Object.defineProperty(input,'files',{configurable:true,value:[first]});
  input.dispatchEvent(new w.Event('change'));
  await wait(10);
  const id=d.querySelector('[data-media-id]')?.getAttribute('data-media-id');
  const second=new w.File([new Uint8Array([2])],'two.png',{type:'image/png'});
  Object.defineProperty(input,'files',{configurable:true,value:[second]});
  input.dispatchEvent(new w.Event('change'));
  await wait(5);
  assert.equal(d.querySelector('[data-media-id]')?.getAttribute('data-media-id'),id);
  assert.match(d.querySelector('#toast').textContent,/Há um anexo/);
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
