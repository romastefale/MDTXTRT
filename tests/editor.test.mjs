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

function mountReactContract(document){
  const root=document.querySelector('#ux-root');
  root.innerHTML=`
    <header class="topbar">
      <div class="top-left"><div class="seg"><button id="undoBtn"></button><button id="redoBtn"></button></div></div>
      <div class="top-center"><span class="app-title">MDTXTRT</span><div class="theme-control"><button id="themeBtn"><span data-icon="light_mode"></span></button></div></div>
      <div class="top-right"><div class="seg"><button id="destBtn" title="Destino: Telegram"><span data-icon="telegram"></span></button><button id="exportBtn"></button></div></div>
    </header>
    <div id="headingMenu" popover="auto" data-anchor="headingBtn" data-placement="top"><div class="menu-list">
      <button data-block="h1"></button><button data-block="h2"></button><button data-block="h3"></button>
      <button data-block="h4"></button><button data-block="h5"></button><button data-block="h6"></button>
      <button data-block="p"></button><button data-block="footer"></button>
    </div></div>
    <div id="listMenu" popover="auto" data-anchor="listBtn" data-placement="top"><div class="menu-list">
      <button data-cmd="insertUnorderedList"></button><button data-insert="ordered"></button><button data-insert="task" data-telegram-only></button>
    </div></div>
    <div id="quoteMenu" popover="auto" data-anchor="quoteBtn" data-placement="top"><div class="menu-list">
      <button data-block="blockquote"></button><button data-insert="pullquote"></button><button data-insert="expandquote"></button>
    </div></div>
    <div id="exportMenu" popover="auto" data-anchor="exportBtn" data-placement="auto">
      <button id="openAppBtn"><span data-icon="telegram"></span><span id="openAppLabel">Publicar no Telegram</span></button>
      <button id="exportMdBtn"></button><button id="exportTxtBtn"></button>
    </div>
    <div id="plusMenu" popover="auto" data-anchor="plusBtn" data-placement="top">
      <div class="document-tools"><input id="docName" value="Ideia"></div>
      <div class="menu-list">
        <button data-plus-category="file"></button>
        <button data-plus-category="format"></button>
        <button data-plus-category="structure"></button>
        <button data-plus-category="media"></button>
        <button data-plus-category="interaction" data-telegram-only></button>
      </div>
    </div>
    <div id="plus-file-menu" popover="auto" data-anchor="plusBtn" data-placement="top" data-plus-submenu="file"><div class="menu-list">
      <button data-plus-back></button>
      <button id="importMdBtn"></button><button id="importTxtBtn"></button><button id="findBtn"></button>
    </div></div>
    <div id="plus-format-menu" popover="auto" data-anchor="plusBtn" data-placement="top" data-plus-submenu="format"><div class="menu-list">
      <button data-plus-back></button>
      <button data-cmd="strike"></button><button data-cmd="mark" data-telegram-only></button>
      <button data-cmd="spoiler" data-telegram-only></button><button data-cmd="code"></button>
      <button data-cmd="sub" data-telegram-only></button><button data-cmd="sup" data-telegram-only></button>
    </div></div>
    <div id="plus-structure-menu" popover="auto" data-anchor="plusBtn" data-placement="top" data-plus-submenu="structure"><div class="menu-list">
      <button data-plus-back></button>
      <button data-cmd="math" data-telegram-only></button><button data-insert="mathblock" data-telegram-only></button>
      <button data-insert="divider"></button><button data-insert="table" data-telegram-only></button>
      <button data-insert="details" data-telegram-only></button>
    </div></div>
    <div id="plus-media-menu" popover="auto" data-anchor="plusBtn" data-placement="top" data-plus-submenu="media"><div class="menu-list">
      <button data-plus-back></button>
      <button data-insert="image"></button><button id="mediaBtn" data-telegram-only></button>
      <button id="voiceBtn" data-telegram-only></button><button data-insert="video"></button>
      <button data-insert="embed" data-telegraph-only></button><button data-insert="audio" data-telegram-only></button>
      <button data-insert="document" data-telegram-only></button><button data-insert="map" data-telegram-only></button>
      <button data-insert="collage" data-telegram-only></button><button data-insert="slideshow" data-telegram-only></button>
    </div></div>
    <div id="plus-interaction-menu" popover="auto" data-anchor="plusBtn" data-placement="top" data-plus-submenu="interaction"><div class="menu-list">
      <button data-plus-back></button>
      <button data-insert="anchor" data-telegram-only></button><button data-insert="reference" data-telegram-only></button>
      <button data-insert="time" data-telegram-only></button><button data-insert="emoji" data-telegram-only></button>
      <button data-insert="button" data-telegram-only></button>
    </div></div>
    <input id="fileInput" type="file" hidden><input id="mediaInput" type="file" hidden>
    <div id="toast" role="status"><span id="toastTextHost"></span></div>
    <div id="dialogMenu" popover="manual"><div id="dialogLabel"></div><textarea id="dialogInput"></textarea><button id="dialogCancel"></button><button id="dialogOk"></button></div>
    <div id="findMenu" popover="auto" data-anchor="findBtn" data-placement="auto"><input id="findText"><input id="replaceText"><button id="findNext"></button><button id="replaceOne"></button><button id="replaceAll"></button></div>
    <div class="bar-wrap"><div id="typebar">
      <button id="plusBtn" class="more" popovertarget="plusMenu"></button>
      <button data-cmd="bold"></button><button data-cmd="italic"></button><button data-cmd="underline"></button>
      <button id="linkBtn"></button><button id="headingBtn" popovertarget="headingMenu"></button>
      <button id="listBtn" popovertarget="listMenu"></button><button id="quoteBtn" popovertarget="quoteMenu"></button>
    </div></div>
  `;
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
  mountReactContract(w.document);
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

test('Telegraph moves the existing document-name input into the editor title slot',async()=>{
  const w=page(),d=w.document,slot=d.querySelector('#telegraphTitleSlot'),input=d.querySelector('#docName');
  const tools=input.closest('.document-tools'),menu=tools.parentElement;
  await wait(0);
  assert.equal(slot.hidden,true);
  assert.equal(tools.parentElement,menu);
  d.querySelector('#destBtn').click();
  await wait(0);
  assert.equal(slot.hidden,false);
  assert.equal(tools.parentElement,slot);
  assert.equal(input.getAttribute('placeholder'),'Título');
  assert.equal(input.getAttribute('aria-label'),'Título da página Telegraph');
  input.value='Minha página';
  input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(w.eval('buildTelegraph().title'),'Minha página');
  d.querySelector('#destBtn').click();
  await wait(0);
  assert.equal(slot.hidden,true);
  assert.equal(tools.parentElement,menu);
  assert.equal(input.hasAttribute('placeholder'),false);
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


test('draft sanitizer rejects multiple local attachment identifiers',()=>{
  const w=page();
  assert.throws(()=>w.eval("cleanDraftHTML('<figure><img data-media-id=\"one\"></figure><figure><img data-media-id=\"two\"></figure>')"),/mais de um anexo local/);
  w.close();
});


test('Rich Message serializer rejects unsupported editor markup',()=>{
  const w=page(),e=w.document.querySelector('#editor');
  e.innerHTML='<p>ok</p><svg></svg>';
  assert.throws(()=>w.eval('buildRich()'),/não aceita/);
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
  const restored=page({local:{rmdtxtml:JSON.stringify({version:2,name:'Vazio',html:'',dest:'telegraph',telegraphPath:'',docId:doc,importedMd:'',importedTxt:'',importedHtml:'',media:null})}});
  assert.equal(restored.document.querySelector('#docName').value,'Vazio');
  assert.equal(restored.document.querySelector('#editor').innerHTML,'');
  assert.equal(restored.document.querySelector('#destBtn').title,'Destino: Telegraph');
  assert.equal(restored.eval('draftState().docId'),doc);
  restored.close();
});


test('block insertions respect caret position and ordered list preserves paragraph text',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  e.innerHTML='<p>Antes</p><p>Depois</p>';
  let range=d.createRange();range.setStartAfter(e.firstElementChild);range.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  w.eval('saveSel();insertFeature("divider")');
  assert.deepEqual([...e.children].map(el=>el.tagName),['P','HR','P']);

  e.innerHTML='<p>antes depois</p>';
  const text=e.querySelector('p').firstChild;
  range=d.createRange();range.setStart(text,6);range.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  d.dispatchEvent(new w.Event('selectionchange'));
  w.eval('insertFeature("ordered")');
  assert.deepEqual([...e.children].map(node=>node.tagName),['OL']);
  assert.equal(e.querySelector('ol > li')?.textContent,'antes depois');
  assert.equal(e.querySelector('p ol'),null);
  w.close();
});

test('find advances, wraps and replace-one survives focus moving to controls',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  e.innerHTML='<p>ação ação ação</p>';
  d.querySelector('#findText').value='ação';
  const offsets=[];
  for(let i=0;i<4;i++){
    d.querySelector('#findNext').click();
    offsets.push(w.getSelection().getRangeAt(0).startOffset);
  }
  assert.deepEqual(offsets,[0,5,10,0]);
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
