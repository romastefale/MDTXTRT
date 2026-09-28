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
  w.eval(readFileSync(new URL('editor-core.js',root),'utf8'));
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

test('document name stays in export flow and becomes the Telegraph title',async()=>{
  const w=page(),d=w.document,slot=d.querySelector('#telegraphTitleSlot'),input=d.querySelector('#docName');
  const tools=input.closest('.document-tools'),exportMenu=d.querySelector('#exportMenu');
  await wait(0);
  assert.equal(slot.hidden,true);
  assert.equal(tools.parentElement,exportMenu);
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
  assert.equal(tools.parentElement,exportMenu);
  assert.equal(input.hasAttribute('placeholder'),false);
  w.close();
});

test('Markdown block markers wait for content, convert in either typing order and preserve semantics',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const apply=(html,offset=null,inputType='insertText')=>{
    w.eval('currentEditorCore().resetHTML('+JSON.stringify(html)+',{silent:true})');
    const block=e.firstElementChild,node=block.firstChild;
    assert.ok(node);
    const range=d.createRange();
    range.setStart(node,offset===null?node.length:offset);range.collapse(true);
    w.getSelection().removeAllRanges();w.getSelection().addRange(range);
    d.dispatchEvent(new w.Event('selectionchange'));
    const event=new w.InputEvent('input',{bubbles:true,inputType});
    e.dispatchEvent(event);
  };
  apply('<p># </p>');
  assert.equal(e.firstElementChild.tagName,'P');
  assert.equal(e.textContent,'# ');

  apply('<p># Palavra</p>');
  assert.equal(e.querySelector('h1')?.textContent,'Palavra');
  assert.equal(d.querySelector('#headingBtn').classList.contains('on'),true);
  assert.equal(d.querySelector('#headingBtn').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelector('#headingMenu [data-block="h1"]').classList.contains('is-current'),true);

  apply('<p>## Palavra</p>',3);
  assert.equal(e.querySelector('h2')?.textContent,'Palavra');
  apply('<p>&gt; Citação</p>');
  assert.equal(e.querySelector('blockquote')?.textContent,'Citação');
  assert.equal(d.querySelector('#quoteBtn').classList.contains('on'),true);
  apply('<p>- Item</p>');
  assert.ok(e.querySelector('ul > li'));
  apply('<p>3. Item</p>');
  assert.equal(e.querySelector('ol')?.getAttribute('start'),'3');
  apply('<p>- [x] Tarefa</p>');
  assert.equal(e.querySelector('li > input[type="checkbox"]')?.checked,true);
  apply('<p>\\# Literal</p>',3);
  assert.equal(e.querySelector('p')?.textContent,'# Literal');
  assert.equal(e.querySelector('h1'),null);
  w.close();
});

test('Markdown block conversion preserves the logical caret while typing',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p># </p>',{silent:true})");
  const first=e.querySelector('p').firstChild,initial=d.createRange();
  initial.setStart(first,first.length);initial.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(initial);

  const type=char=>{
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
  };

  for(const char of 'teste')type(char);
  assert.equal(e.firstElementChild.tagName,'H1');
  assert.equal(e.firstElementChild.textContent,'teste');
  const sel=w.getSelection();
  assert.equal(sel.anchorNode,e.firstElementChild.firstChild);
  assert.equal(sel.anchorOffset,5);
  w.close();
});

test('Markdown block markers accept element-anchored carets and non-breaking spaces once content exists',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  e.innerHTML='<div>#&nbsp;Palavra</div>';
  const block=e.firstElementChild,range=d.createRange();
  range.setStart(block,1);range.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  d.dispatchEvent(new w.Event('selectionchange'));
  e.dispatchEvent(new w.InputEvent('input',{bubbles:true,inputType:'insertText'}));
  assert.equal(e.querySelector('h1')?.textContent,'Palavra');
  w.close();
});

test('Enter exits headings and quotes to body without leaking formatting',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const exitAtEnd=html=>{
    w.eval('currentEditorCore().resetHTML('+JSON.stringify(html)+',{silent:true})');
    const block=e.firstElementChild,node=block.firstChild,range=d.createRange();
    range.setStart(node,node.length);range.collapse(true);
    w.getSelection().removeAllRanges();w.getSelection().addRange(range);
    d.dispatchEvent(new w.Event('selectionchange'));
    const before=new w.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertParagraph'});
    e.dispatchEvent(before);
    return block;
  };
  let block=exitAtEnd('<h1>Título</h1>');
  assert.equal(block.nextElementSibling?.tagName,'P');
  assert.equal(d.querySelector('#headingBtn').classList.contains('on'),false);
  assert.equal(d.querySelector('#headingMenu [data-block="p"]').classList.contains('is-current'),true);

  block=exitAtEnd('<blockquote>Citação</blockquote>');
  assert.equal(block.nextElementSibling?.tagName,'P');
  assert.equal(d.querySelector('#quoteBtn').classList.contains('on'),false);
  w.close();
});

test('deleting the last character of a heading or quote returns the block to body',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const reset=tag=>{
    e.innerHTML='<'+tag+'><br></'+tag+'>';
    const block=e.firstElementChild,range=d.createRange();
    range.setStart(block,0);range.collapse(true);
    w.getSelection().removeAllRanges();w.getSelection().addRange(range);
    const event=new w.InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'});
    e.dispatchEvent(event);
    assert.equal(e.firstElementChild.tagName,'P');
  };
  reset('h2');
  reset('blockquote');
  assert.equal(d.querySelector('#headingBtn').classList.contains('on'),false);
  assert.equal(d.querySelector('#quoteBtn').classList.contains('on'),false);
  w.close();
});

test('Markdown inline markers become semantic rich-text marks and support escaping',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  const apply=text=>{
    e.innerHTML='<p></p>';e.querySelector('p').textContent=text;
    const node=e.querySelector('p').firstChild,range=d.createRange();
    range.setStart(node,node.length);range.collapse(true);
    w.getSelection().removeAllRanges();w.getSelection().addRange(range);
    d.dispatchEvent(new w.Event('selectionchange'));
    e.dispatchEvent(new w.Event('input',{bubbles:true}));
  };
  apply('**forte**');assert.equal(e.querySelector('strong')?.textContent,'forte');
  apply('*ênfase*');assert.equal(e.querySelector('em')?.textContent,'ênfase');
  apply('~~riscado~~');assert.equal(e.querySelector('s')?.textContent,'riscado');
  apply('`código`');assert.equal(e.querySelector('code')?.textContent,'código');
  apply('\\*literal*');assert.equal(e.querySelector('em'),null);assert.equal(e.textContent,'*literal*');
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
  w.eval("currentEditorCore().resetHTML('<p>Antes</p><p>Depois</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('Antes')[0];currentEditorCore().selectRange({from:r.to,to:r.to},{focus:true})})()");
  w.eval('saveSel();insertFeature("divider")');
  assert.deepEqual([...e.children].map(el=>el.tagName),['P','HR','P']);

  w.eval("currentEditorCore().resetHTML('<p>antes depois</p>',{silent:true})");
  w.eval("(()=>{const r=currentEditorCore().findLiteral('antes depois')[0];currentEditorCore().selectRange({from:r.from+6,to:r.from+6},{focus:true})})()");
  w.eval('insertFeature("ordered")');
  assert.deepEqual([...e.children].map(node=>node.tagName),['OL']);
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
    starts.push(w.eval('currentEditorCore().state.selection.from'));
  }
  assert.deepEqual(starts,[1,6,11,1]);
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
  ['versão incompatível',JSON.stringify({version:1,name:'Antigo',html:'<p>recuperar</p>',dest:'telegram',telegraphPath:'',docId:'11111111-1111-4111-8111-111111111111',importedMd:'',importedTxt:'',importedHtml:'',media:null})],
  ['sanitização incompatível',JSON.stringify({version:2,name:'Recuperar',html:'<script>preservar()</script>',dest:'telegram',telegraphPath:'',docId:'22222222-2222-4222-8222-222222222222',importedMd:'',importedTxt:'',importedHtml:'',media:null})]
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
  const local=JSON.stringify({version:2,name:'Documento A',html:'<p>texto A</p>',dest:'telegraph',telegraphPath:'pagina-a',docId:oldDoc,revision:3,importedMd:'',importedTxt:'',importedHtml:'',media:null});
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
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Transferido',html:'<p>conteúdo</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:null},file:null,action:pending})};
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
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Já enviado',html:'<p>confirmado</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:null},file:null,action})};
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
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Timeout',html:'<p>texto</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:null},file:null,action:pending})};
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
    if(target.endsWith('/api/handoff/claim'))return {ok:true,status:200,json:async()=>({draft:{version:2,name:'Original',html:'<p>original</p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:null},file:null,action:pending})};
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


test('ProseMirror normalizes equivalent mark aliases and toggles each semantic mark off',()=>{
  const w=page(),d=w.document;
  w.eval("currentEditorCore().resetHTML('<p><b>um</b> <strong>dois</strong> <i>x</i> <em>y</em> <ins>u</ins> <u>v</u> <strike>s1</strike> <del>s2</del> <s>s3</s></p>',{silent:true})");
  assert.equal(d.querySelectorAll('#editor b,#editor i,#editor ins,#editor strike,#editor del').length,0);
  assert.equal(d.querySelectorAll('#editor strong').length,2);
  assert.equal(d.querySelectorAll('#editor em').length,2);
  assert.equal(d.querySelectorAll('#editor u').length,2);
  assert.equal(d.querySelectorAll('#editor s').length,3);

  w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral('um dois')[0],{focus:true});exec('bold')");
  assert.equal(d.querySelectorAll('#editor strong,#editor b').length,0);

  w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral('x y')[0],{focus:true});exec('italic')");
  assert.equal(d.querySelectorAll('#editor em,#editor i').length,0);

  w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral('u v')[0],{focus:true});exec('underline')");
  assert.equal(d.querySelectorAll('#editor u,#editor ins').length,0);

  w.eval("currentEditorCore().selectRange(currentEditorCore().findLiteral('s1 s2 s3')[0],{focus:true});exec('strike')");
  assert.equal(d.querySelectorAll('#editor s,#editor strike,#editor del').length,0);
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


test('ProseMirror normalizes accepted bold aliases and removes the semantic mark uniformly',()=>{
  const doc='81818181-8181-4818-8818-818181818181';
  const local=JSON.stringify({version:2,name:'Aliases',html:'<p><b>Alias</b> <strong>Strong</strong></p>',dest:'telegram',telegraphPath:'',docId:doc,revision:0,importedMd:'',importedTxt:'',importedHtml:'',media:null});
  const w=page({local:{rmdtxtml:local}}),d=w.document,e=d.querySelector('#editor');
  assert.equal(e.querySelectorAll('b').length,0);
  assert.equal(e.querySelectorAll('strong').length,2);

  w.eval('currentEditorCore().selectRange({from:1,to:6},{focus:true})');
  d.querySelector('#typebar [data-cmd="bold"]').click();
  assert.equal(e.innerHTML,'<p>Alias <strong>Strong</strong></p>');

  w.eval('currentEditorCore().selectRange({from:7,to:13},{focus:true})');
  d.querySelector('#typebar [data-cmd="bold"]').click();
  assert.equal(e.querySelector('strong'),null);
  assert.equal(e.textContent,'Alias Strong');
  w.close();
});

test('transaction history keeps the editor selection coherent through undo and redo',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  w.eval("currentEditorCore().resetHTML('<p>alpha beta</p>',{silent:true})");
  w.eval('currentEditorCore().selectRange({from:7,to:11},{focus:true})');
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
