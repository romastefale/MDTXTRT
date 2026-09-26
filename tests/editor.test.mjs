import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {randomUUID} from 'node:crypto';
import {TextEncoder} from 'node:util';

const root = new URL('../', import.meta.url);
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
          transaction(){const tx={objectStore:()=>store};queueMicrotask(()=>tx.oncomplete?.());return tx;},
          close(){}
        };
        req.result=db;req.onsuccess?.();
      });
      return req;
    }
  };
}
function page(tg,render=false,setup={}){
  const dom = new JSDOM(readFileSync(new URL('index.html',root),'utf8'),{url:'https://mdtxtrt.up.railway.app/',runScripts:'outside-only'});
  const w = dom.window;
  let systemLight=true, mediaListener=()=>{};
  w.matchMedia = query => ({media:query,get matches(){return systemLight},addEventListener(type,callback){if(type==='change')mediaListener=callback}});
  w.__setSystemLight = value => {systemLight=value;mediaListener({matches:value})};
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID});
  if(setup.indexedDB)Object.defineProperty(w,'indexedDB',{value:setup.indexedDB,configurable:true});
  if(setup.visualViewport)Object.defineProperty(w,'visualViewport',{value:setup.visualViewport,configurable:true});
  if(setup.objectURL){w.URL.createObjectURL=setup.objectURL;w.URL.revokeObjectURL=()=>{};}
  for(const [key,value] of Object.entries(setup.local||{}))w.localStorage.setItem(key,value);
  w.__requests=[];
  w.fetch=async(url,options={})=>{
    w.__requests.push({url:String(url),options});
    if(String(url).endsWith('/api/export')){
      const body=JSON.parse(options.body);w.__exportRequest=body;
      return {ok:true,status:200,json:async()=>({name:body.name,url:'https://mdtxtrt.up.railway.app/download/test/'+encodeURIComponent(body.name)})};
    }
    return {ok:false,status:404,json:async()=>({error:'not found'})};
  };
  if(tg){w.Telegram={WebApp:{initData:'signed-payload',colorScheme:'dark',ready(){},expand(){},setHeaderColor(){},MainButton:{setText(){},show(){},onClick(){}},...tg}};w.fetch=tg.fetch;}
  if(render){
    const callbacks=[];w.__maps=[];
    w.ResizeObserver=class{constructor(callback){callbacks.push(callback)}observe(){}};
    w.__resize=()=>callbacks.forEach(callback=>callback());
    Object.defineProperty(w.navigator,'userAgent',{value:'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36'});
    w.HTMLElement.prototype.getBoundingClientRect=function(){return {width:this.classList.contains('material-target')?160:0,height:44,top:0,left:0,right:160,bottom:44}};
    w.HTMLCanvasElement.prototype.getContext=()=>({createImageData:(x,y)=>({data:new Uint8ClampedArray(x*y*4)}),putImageData:image=>w.__maps.push(image.data.slice())});
    w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,cGl4ZWxz';
    for(const script of w.document.querySelectorAll('script:not([src])'))w.eval(script.textContent);
  }
  w.eval(readFileSync(new URL('marked.js',root),'utf8'));
  w.eval(readFileSync(new URL('turndown.js',root),'utf8'));
  w.eval(readFileSync(new URL('app.js',root),'utf8'));
  return w;
}
test('editor starts and destination controls work',()=>{
  const w=page();
  assert.equal(w.document.querySelector('#destBtn').title,'Destino: Telegram');
  w.document.querySelector('#destBtn').click();
  assert.equal(w.document.querySelector('#destBtn').title,'Destino: Telegraph');
  w.close();
});
test('toolbar clicks edit selected text and undo and redo restore document states',()=>{
  const w=page(),d=w.document,editor=d.querySelector('#editor');
  editor.innerHTML='<p>texto selecionado</p>';
  editor.dispatchEvent(new w.Event('input',{bubbles:true}));
  const text=editor.querySelector('p').firstChild,range=d.createRange();
  range.setStart(text,0);range.setEnd(text,text.length);w.getSelection().removeAllRanges();w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));
  d.querySelector('[data-cmd="bold"]').click();
  assert.equal(editor.querySelector('strong')?.textContent,'texto selecionado');
  d.querySelector('#undoBtn').click();
  assert.equal(editor.querySelector('strong'),null);
  assert.equal(editor.textContent,'texto selecionado');
  d.querySelector('#redoBtn').click();
  assert.equal(editor.querySelector('strong')?.textContent,'texto selecionado');
  w.close();
});
test('replace button changes text without removing semantic formatting',()=>{
  const w=page();
  w.document.querySelector('#editor').innerHTML='<p>Teste <strong>forte forte</strong></p>';
  w.document.querySelector('#findText').value='forte';
  w.document.querySelector('#replaceText').value='novo';
  w.document.querySelector('#replaceAll').click();
  assert.equal(w.document.querySelector('#editor strong').textContent,'novo novo');
  assert.equal(w.document.querySelector('#previewBtn'),null);
  assert.match(w.eval('buildRich().rich_message.html'),/<strong>novo novo<\/strong>/);
  w.close();
});
test('toolbar and insertion menu buttons produce the selected semantic blocks',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  d.querySelector('#headingBtn').click();d.querySelector('#headingMenu [data-block="h3"]').click();
  assert.equal(d.body.contains(e),true);
  assert.ok(d.querySelector('#typebar'));
  assert.equal(e.firstElementChild?.tagName,'H3');
  d.querySelector('#listBtn').click();d.querySelector('#listMenu [data-insert="task"]').click();
  assert.equal(e.querySelector('input[type="checkbox"]')?.type,'checkbox');
  d.querySelector('#listBtn').click();d.querySelector('#listMenu [data-insert="ordered"]').click();
  assert.ok(e.querySelector('ol > li'));
  d.querySelector('#quoteBtn').click();d.querySelector('#quoteMenu [data-block="blockquote"]').click();
  assert.ok(e.querySelector('blockquote'));
  d.querySelector('#plusBtn').click();
  d.querySelector('#destBtn').click();
  assert.equal(d.body.dataset.destination,'telegraph');
  assert.equal(d.querySelector('#listMenu [data-insert="task"]').hidden,true);
  assert.equal(d.querySelector('#plusMenu [data-insert="image"]').hidden,false);
  w.close();
});
test('find is under the app name and menu icons match their actions',()=>{
  const w=page();
  const d=w.document;
  d.querySelector('#brandBtn').click();
  assert.equal(d.querySelector('#importMenu').classList.contains('on'),true);
  d.querySelector('#findBtn').click();
  assert.equal(d.querySelector('#findMenu').classList.contains('on'),true);
  assert.equal(d.querySelector('#importMenu').classList.contains('on'),false);
  assert.deepEqual([...d.querySelectorAll('#findMenu .tools button')].map(el=>el.id),['findNext','replaceOne','replaceAll']);
  const items=[...d.querySelectorAll('#plusMenu button [data-icon]')].map(el=>el.dataset.icon);
  assert.equal(items.length,new Set(items).size);
  assert.equal(d.querySelector('#plusMenu [data-cmd="strike"] [data-icon]').dataset.icon,'strikethrough_s');
  assert.equal(d.querySelector('#plusMenu [data-insert="video"] [data-icon]').dataset.icon,'movie');
  w.close();
});
test('all visible interface icons resolve to local Google Material SVG assets',()=>{
  const w=page(),d=w.document;
  const icons=[...d.querySelectorAll('[data-icon]')];
  assert.ok(icons.length>40);
  for(const icon of icons){
    const name=icon.dataset.icon;
    assert.match(name,/^[a-z0-9_]+$/);
    assert.ok(existsSync(new URL(`../icons/${name}.svg`,import.meta.url)),`missing Material icon ${name}`);
    assert.match(icon.style.getPropertyValue('--ui-icon'),new RegExp(`icons/${name}\\.svg`));
  }
  w.close();
});
test('Markdown import, editor replacement and export retain supported structures',async()=>{
  const w=page(),d=w.document,editor=d.querySelector('#editor');
  let saved;
  w.HTMLAnchorElement.prototype.click=function(){saved={name:this.download,href:this.href}};
  const source='# Nome\n\n- [x] tarefa\n- [ ] próxima\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**forte** e [site](https://example.com)';
  d.querySelector('#brandBtn').click();d.querySelector('#importMdBtn').click();
  assert.equal(d.querySelector('#fileInput').accept,'.md,text/markdown');
  Object.defineProperty(d.querySelector('#fileInput'),'files',{configurable:true,value:[{name:'source.md',text:async()=>source}]});
  d.querySelector('#fileInput').dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(editor.querySelector('h1')?.textContent,'Nome');
  assert.equal(editor.querySelectorAll('input[type="checkbox"]').length,2);
  assert.equal(editor.querySelectorAll('table tr').length,2);
  assert.equal(editor.querySelector('strong')?.textContent,'forte');
  d.querySelector('#findText').value='tarefa';d.querySelector('#replaceText').value='feito';d.querySelector('#replaceAll').click();
  d.querySelector('#exportBtn').click();
  assert.equal(d.querySelector('#exportMenu').classList.contains('on'),true);
  d.querySelector('#exportMdBtn').click();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(saved.name,'source.md');
  const output=w.__exportRequest.content;
  assert.equal(w.__exportRequest.type,'text/markdown');
  assert.match(saved.href,/\/download\/test\/source\.md$/);
  const again=w.eval('mdToBasicHTML('+JSON.stringify(output)+')');
  const round=w.document.createElement('div');round.innerHTML=again;
  assert.equal(round.querySelector('h1')?.textContent,'Nome');
  assert.equal(round.querySelectorAll('input[type="checkbox"]').length,2);
  assert.equal(round.querySelectorAll('table tr').length,2);
  assert.equal(round.querySelector('strong')?.textContent,'forte');
  assert.equal(round.querySelector('a')?.getAttribute('href'),'https://example.com');
  assert.match(round.textContent,/feito/);
  w.close();
});
test('TXT import stays literal and lossy export requires an explicit choice',async()=>{
  const w=page(),d=w.document;let saved,asked=0,allow=false;
  w.confirm=()=>{asked++;return allow};
  w.HTMLAnchorElement.prototype.click=function(){saved={name:this.download,href:this.href}};
  const source='literal <texto>\nlinha dois\n';
  Object.defineProperty(d.querySelector('#fileInput'),'files',{configurable:true,value:[{name:'texto.txt',text:async()=>source}]});
  d.querySelector('#fileInput').dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,10));
  d.querySelector('#exportBtn').click();d.querySelector('#exportTxtBtn').click();
  await new Promise(resolve=>setTimeout(resolve,10));
  let output=w.__exportRequest.content;
  assert.equal(w.__exportRequest.type,'text/plain');
  assert.equal(output,source);
  const editor=d.querySelector('#editor');editor.innerHTML='<p><strong>formato</strong></p>';
  d.querySelector('#exportTxtBtn').click();
  assert.equal(asked,1);
  allow=true;d.querySelector('#exportTxtBtn').click();
  await new Promise(resolve=>setTimeout(resolve,10));
  output=w.__exportRequest.content;
  assert.equal(output,'formato');
  w.close();
});
test('Telegram rich serializer rejects invalid elements and emits semantic message data',()=>{
  const w=page();
  const editor=w.document.querySelector('#editor');
  editor.innerHTML='<h2>Olá</h2><ul><li><input type="checkbox" checked>Feito</li></ul>';
  const msg=w.eval('buildRich()').rich_message;
  assert.equal(msg.html,'<h2>Olá</h2><ul><li><input type="checkbox" checked/>Feito</li></ul>');
  editor.innerHTML='<svg></svg>';
  assert.throws(()=>w.eval('buildRich()'),/não aceita/);
  w.close();
});
test('Mini App mode waits for backend initData validation',async()=>{
  let resolve;
  let fullscreen=0, hidden=0;
  const w=page({fetch:()=>new Promise(r=>resolve=r),requestFullscreen(){fullscreen++},MainButton:{hide(){hidden++}}});
  assert.equal(w.document.body.classList.contains('tg'),false);
  assert.equal(fullscreen,0);
  await new Promise(r=>setTimeout(r,0));
  resolve({ok:true,status:200,json:async()=>({})});
  await new Promise(r=>setTimeout(r,5));
  assert.equal(w.document.body.classList.contains('tg'),true);
  assert.equal(fullscreen,1);
  assert.equal(hidden,1);
  w.close();
});
test('Mini App export click publishes the current editor HTML to the authenticated endpoint',async()=>{
  const requests=[];
  const w=page({isFullscreen:true,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({via:'sendRichMessage'})}},requestFullscreen(){}});
  await new Promise(resolve=>setTimeout(resolve,5));
  w.document.querySelector('#editor').innerHTML='<p><strong>Texto enviado</strong></p>';
  w.document.querySelector('#exportBtn').click();
  await new Promise(resolve=>setTimeout(resolve,5));
  const send=requests.find(item=>item.url.endsWith('/api/telegram/send'));
  assert.ok(send);
  assert.equal(send.options.method,'POST');
  assert.deepEqual(JSON.parse(send.options.body),{initData:'signed-payload',html:'<p><strong>Texto enviado</strong></p>'});
  w.close();
});
test('Mini App destination switch publishes Telegraph nodes and retains the returned page path',async()=>{
  const requests=[];
  const w=page({isFullscreen:true,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({path:'owned-page',url:'https://telegra.ph/owned-page'})}},requestFullscreen(){},openLink(){}});
  await new Promise(resolve=>setTimeout(resolve,5));
  const d=w.document;d.querySelector('#docName').value='Documento';d.querySelector('#editor').innerHTML='<h3>Título</h3><p>Texto</p>';
  d.querySelector('#destBtn').click();d.querySelector('#exportBtn').click();
  await new Promise(resolve=>setTimeout(resolve,5));
  const publish=requests.find(item=>item.url.endsWith('/api/telegraph/publish'));
  assert.ok(publish);
  const data=JSON.parse(publish.options.body);
  assert.deepEqual(data.content,[{tag:'h3',children:['Título']},{tag:'p',children:['Texto']}]);
  assert.equal(data.title,'Documento');
  assert.equal(data.path,'owned-page');
  assert.equal(JSON.parse(w.localStorage.getItem('rmdtxtml')).telegraphPath,'owned-page');
  w.close();
});
test('fullscreen Mini App uses Telegram safe areas and stable viewport without manual header offsets',async()=>{
  const w=page({fetch:async()=>({ok:true,status:404,json:async()=>({})}),isFullscreen:true,viewportStableHeight:620,safeAreaInset:{top:59,bottom:34,left:0,right:0},contentSafeAreaInset:{top:44,bottom:0,left:8,right:7}});
  await new Promise(r=>setTimeout(r,10));
  const root=w.document.documentElement;
  assert.equal(root.style.getPropertyValue('--tg-top'),'59px');
  assert.equal(root.style.getPropertyValue('--tg-bottom'),'34px');
  assert.equal(root.style.getPropertyValue('--tg-left'),'8px');
  assert.equal(root.style.getPropertyValue('--tg-right'),'7px');
  assert.equal(root.style.getPropertyValue('--vv-h'),'620px');
  assert.equal(root.style.getPropertyValue('--kb'),Math.max(0,w.innerHeight-620)+'px');
  w.close();
});
test('dark glass has a single restrained edge and paints the full page while approved light styling stays unchanged',()=>{
  const w=page(),d=w.document,root=d.documentElement;
  const value=name=>w.getComputedStyle(root).getPropertyValue(name).trim();
  assert.equal(w.getComputedStyle(d.querySelector('#brandBtn')).boxShadow,'0 2px 8px rgba(0,0,0,.08)');
  assert.equal(w.getComputedStyle(d.querySelector('#plusMenu')).boxShadow,'0 4px 14px rgba(0,0,0,.14),0 22px 48px rgba(0,0,0,.2)');
  assert.equal(w.getComputedStyle(d.body).backgroundColor,'rgba(0, 0, 0, 0)');
  assert.equal(d.querySelector('meta[name="theme-color"]').content,'#f8fbff');
  assert.equal(value('--glass-frost'),'0.08');
  assert.equal(value('--glass-blur'),'6px');
  assert.equal(value('--glass-highlight'),'rgba(255,255,255,.55)');
  w.__setSystemLight(false);
  assert.equal(root.classList.contains('dark'),true);
  assert.equal(value('--glass-frost'),'0.12');
  assert.equal(value('--glass-blur'),'10px');
  assert.equal(value('--glass-highlight'),'rgba(255,255,255,.1)');
  assert.equal(value('--glass-edge'),'rgba(255,255,255,.055)');
  assert.equal(value('--glass-saturation'),'1.15');
  assert.equal(w.getComputedStyle(d.querySelector('#brandBtn')).boxShadow,'var(--glass-shadow)');
  assert.equal(w.getComputedStyle(d.querySelector('#plusMenu')).boxShadow,'var(--glass-shadow-lg)');
  assert.equal(w.getComputedStyle(d.querySelector('#plusMenu .sheet-ico')).boxShadow,'none');
  assert.equal(w.getComputedStyle(d.querySelector('.action-dot')).boxShadow,'0 4px 14px rgba(167,139,250,.32)');
  assert.equal(d.querySelector('meta[name="theme-color"]').content,'#000000');
  assert.ok(d.querySelector('.sheet.frost'));
  w.close();
});
test('rapid OS and Telegram theme changes preserve working panels, commands and material state',async()=>{
  let themeChanged;
  const w=page({fetch:async()=>({ok:true}),colorScheme:'dark',onEvent:(name,callback)=>{if(name==='themeChanged')themeChanged=callback}});
  await new Promise(resolve=>setTimeout(resolve,5));
  const d=w.document,root=d.documentElement,bar=d.querySelector('#typebar'),editor=d.querySelector('#editor');
  const scheme=()=>root.classList.contains('dark')?'dark':'light';
  assert.equal(scheme(),'dark');
  for(let i=0;i<80;i++){
    w.Telegram.WebApp.colorScheme=i%2?'light':'dark';
    themeChanged();
    assert.equal(scheme(),i%2?'light':'dark');
    assert.equal(w.getComputedStyle(root).getPropertyValue('--glass-blur').trim(),i%2?'6px':'10px');
    assert.equal(w.getComputedStyle(root).getPropertyValue('--glass-frost').trim(),i%2?'0.08':'0.12');
  }
  d.querySelector('#plusBtn').click();
  d.querySelector('#plusMenu [data-insert="divider"]').click();
  assert.equal(editor.querySelectorAll('hr').length,1);
  assert.equal(d.querySelector('#plusMenu').classList.contains('on'),false);
  w.close();
});
test('invalid Telegram session never enters Mini App mode and system theme changes remain usable',async()=>{
  const w=page({fetch:async()=>({ok:false,status:403})});
  await new Promise(resolve=>setTimeout(resolve,5));
  const root=w.document.documentElement;
  assert.equal(w.document.body.classList.contains('tg'),false);
  assert.equal(root.classList.contains('dark'),false);
  w.__setSystemLight(false);
  assert.equal(root.classList.contains('dark'),true);
  assert.equal(w.getComputedStyle(root).getPropertyValue('--glass-blur').trim(),'10px');
  w.document.querySelector('#plusBtn').click();
  assert.equal(w.document.querySelector('#plusMenu').classList.contains('on'),true);
  w.close();
});
test('Markdown preserves embeds and expandable quotes, rejects styles',()=>{
  const w=page();
  const html=w.eval('mdToBasicHTML("<figure><iframe src=\\\"https://example.com/\\\"></iframe></figure>\\n\\n<blockquote expandable>Mais</blockquote>")');
  assert.match(html,/<iframe/);
  assert.match(html,/data-expandable="true"/);
  w.document.querySelector('#editor').innerHTML=html;
  const md=w.eval('htmlToMarkdown(document.querySelector("#editor").innerHTML)');
  assert.match(md,/<iframe/);
  assert.match(md,/data-expandable/);
  assert.throws(()=>w.eval('mdToBasicHTML("<p style=\\\"color:red\\\">x</p>")'),/Atributo/);
  w.close();
});
test('local attachments cannot become unusable downloads',()=>{
  const w=page();
  const editor=w.document.querySelector('#editor');
  editor.innerHTML='<figure><img data-media-id="media1" src="blob:https://example.com/local"></figure>';
  assert.throws(()=>w.eval('htmlToMarkdown(document.querySelector("#editor").innerHTML)'),/URL pública/);
  assert.throws(()=>w.eval('htmlToText(document.querySelector("#editor").innerHTML)'),/TXT não comporta/);
  w.close();
});
test('insertions respect the caret between blocks',()=>{
  const w=page();
  const editor=w.document.querySelector('#editor');
  editor.innerHTML='<p>Antes</p><p>Depois</p>';
  const range=w.document.createRange();
  range.setStartAfter(editor.firstElementChild);range.collapse(true);
  w.getSelection().removeAllRanges();w.getSelection().addRange(range);
  w.eval('saveSel();insertFeature("divider")');
  assert.deepEqual([...editor.children].map(el=>el.tagName),['P','HR','P']);
  w.close();
});
test('ordered list converts the current paragraph without splitting or losing text',()=>{
  const w=page(),d=w.document,editor=d.querySelector('#editor');
  editor.innerHTML='<p>antes depois</p>';
  const text=editor.querySelector('p').firstChild,range=d.createRange();
  range.setStart(text,6);range.collapse(true);w.getSelection().removeAllRanges();w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));
  d.querySelector('#listBtn').click();d.querySelector('#listMenu [data-insert="ordered"]').click();
  assert.deepEqual([...editor.children].map(node=>node.tagName),['OL']);
  assert.equal(editor.querySelector('ol > li').textContent,'antes depois');
  assert.equal(editor.querySelector('p ol'),null);
  w.close();
});
test('button insertion exposes only ready types and validates callback payload',()=>{
  const w=page();
  const editor=w.document.querySelector('#editor');
  w.prompt=()=> 'switch_inline_query';
  w.eval('insertFeature("button")');
  assert.equal(editor.querySelector('tg-button'),null);
  const answers=['callback_data','Abrir','link','ação'];
  w.prompt=()=>answers.shift();
  w.eval('insertFeature("button")');
  assert.equal(editor.querySelector('tg-button')?.getAttribute('data'),'ação');
  assert.match(w.eval('buildRich().rich_message.html'),/type="callback_data"/);
  const tooLong=['callback_data','Outro','primary','a'.repeat(65)];
  w.prompt=()=>tooLong.shift();
  w.eval('insertFeature("button")');
  assert.equal(editor.querySelectorAll('tg-button').length,1);
  w.close();
});

test('all inline startup scripts execute and generate glass maps for every surface',()=>{
  const w=page(undefined,true),d=w.document;
  assert.equal(d.querySelectorAll('.defs filter').length,d.querySelectorAll('.material-target:not(.frost-only)').length);
  assert.ok(w.__maps.length>=8);
  assert.ok(w.__maps.every(map=>map.length===512*512*4&&map.some(value=>value>128)));
  const initial=w.__maps.length;w.__resize();assert.equal(w.__maps.length,initial);
  d.querySelector('#plusBtn').click();w.__resize();assert.ok(d.querySelector('#plusMenu').style.backdropFilter.includes('url(#lg-mat-'));
  w.__setSystemLight(false);assert.ok(d.querySelector('#findMenu').style.backdropFilter.startsWith('blur(10px)'));
  assert.equal(d.querySelector('#typebar').style.backdropFilter.includes('url('),false);
  w.close();
});
test('plain root text and multiple paragraphs become a list without moving the editor shell',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor'),canvas=e.parentElement;
  e.innerHTML='primeiro<div>segundo</div>';e.dispatchEvent(new w.Event('input',{bubbles:true}));
  const range=d.createRange();range.selectNodeContents(e);w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));
  d.querySelector('[data-cmd="insertUnorderedList"]').click();
  assert.equal(e.parentElement,canvas);assert.equal(canvas.id,'canvas');
  assert.deepEqual([...e.querySelectorAll('ul > li')].map(el=>el.textContent),['primeiro','segundo']);
  d.querySelector('#undoBtn').click();assert.equal(e.textContent,'primeirosegundo');
  d.querySelector('#headingBtn').click();d.querySelector('#headingMenu [data-block="h3"]').click();
  assert.ok(e.querySelector('h3'));assert.equal(e.parentElement,canvas);w.close();
});
test('inline marks toggle off on selection and preserve paragraphs across a multi-block selection',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');e.innerHTML='<p>um dois</p><p>três quatro</p>';
  const range=d.createRange();range.selectNodeContents(e);w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));
  d.querySelector('[data-cmd="bold"]').click();assert.equal(e.querySelectorAll('p > strong').length,2);assert.equal(e.querySelector('strong p'),null);
  d.querySelector('[data-cmd="bold"]').click();assert.equal(e.querySelector('strong'),null);assert.equal(e.querySelectorAll('p').length,2);
  const r=d.createRange();r.setStart(e.firstChild.firstChild,3);r.setEnd(e.firstChild.firstChild,7);w.getSelection().removeAllRanges();w.getSelection().addRange(r);d.dispatchEvent(new w.Event('selectionchange'));
  d.querySelector('[data-cmd="italic"]').click();assert.equal(e.querySelector('em').textContent,'dois');
  d.querySelector('[data-cmd="italic"]').click();assert.equal(e.querySelector('em'),null);assert.equal(e.textContent,'um doistrês quatro');w.close();
});
test('find advances, wraps and replaces the chosen occurrence after input focus changes',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');w.HTMLElement.prototype.scrollIntoView=function(){};
  e.innerHTML='<p>ação ação ação</p>';d.querySelector('#findText').value='ação';
  const offsets=[];for(let i=0;i<4;i++){d.querySelector('#findNext').click();offsets.push(w.getSelection().getRangeAt(0).startOffset);}
  assert.deepEqual(offsets,[0,5,10,0]);
  d.querySelector('#replaceText').focus();d.querySelector('#replaceText').value='feito';d.querySelector('#replaceOne').click();
  assert.equal(e.textContent,'feito ação ação');w.close();
});
test('styled rich buttons and footers survive an edited Markdown round trip',()=>{
  const w=page(),e=w.document.querySelector('#editor');e.innerHTML='<p class="tg-footer">Rodapé</p><tg-button-row><tg-button type="url" style="danger" url="https://example.com">Abrir</tg-button></tg-button-row>';
  const md=w.eval('htmlToMarkdown(editor.innerHTML)');const html=w.eval('mdToBasicHTML('+JSON.stringify(md)+')');
  const box=w.document.createElement('div');box.innerHTML=html;assert.equal(box.querySelector('tg-button').getAttribute('style'),'danger');assert.equal(box.querySelector('.tg-footer').textContent,'Rodapé');w.close();
});
test('replace spans inline formatting and checklists retain changed state in exports',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  e.innerHTML='<p><strong>con</strong><em>teúdo</em> conteúdo</p>';
  d.querySelector('#findText').value='conteúdo';d.querySelector('#replaceText').value='texto';d.querySelector('#replaceAll').click();
  assert.equal(e.textContent,'texto texto');assert.equal(e.querySelectorAll('p').length,1);
  e.innerHTML=w.eval('mdToBasicHTML("- [ ] tarefa")');const box=e.querySelector('input');assert.equal(box.disabled,false);box.checked=true;box.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(w.eval('toRichHTML(editor)'),/<input type="checkbox" checked\/>/);
  const md=w.eval('htmlToMarkdown(editor.innerHTML)');assert.match(w.eval('mdToBasicHTML('+JSON.stringify(md)+')'),/checked/);w.close();
});
test('rapid publish clicks send once and network failures allow retry',async()=>{
  let count=0,finish;
  const w=page({fetch:async url=>{
    if(url.endsWith('/session'))return {ok:true,status:200,json:async()=>({})};
    if(url.endsWith('/telegraph/recover'))return {ok:false,status:404,json:async()=>({error:'Página não encontrada'})};
    count++;return await new Promise(resolve=>finish=resolve);
  }});
  await new Promise(resolve=>setTimeout(resolve,10));const d=w.document;d.querySelector('#editor').innerHTML='<p>teste</p>';
  d.querySelector('#exportBtn').click();d.querySelector('#exportBtn').click();assert.equal(count,1);assert.equal(d.querySelector('#exportBtn').disabled,true);
  finish({ok:false,json:async()=>({error:'Falha temporária'})});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(d.querySelector('#exportBtn').disabled,false);assert.equal(d.querySelector('#toast').textContent,'Falha temporária');
  d.querySelector('#exportBtn').click();assert.equal(count,2);finish({ok:true,json:async()=>({})});await new Promise(resolve=>setTimeout(resolve,5));w.close();
});

test('rejected file import preserves name, document and publication identity',async()=>{
  const w=page(),d=w.document;
  d.querySelector('#editor').innerHTML='<p>Documento existente</p>';
  d.querySelector('#docName').value='Original';
  w.localStorage.setItem('rmdtxtml',JSON.stringify({html:'<p>Documento existente</p>',name:'Original',telegraphPath:'owned-page',docId:'existing-document'}));
  w.eval('loadLocal()');
  Object.defineProperty(d.querySelector('#fileInput'),'files',{value:[{name:'invalido.md',text:async()=>'<script>alert(1)</script>'}]});
  d.querySelector('#fileInput').dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(d.querySelector('#docName').value,'Original');
  assert.equal(d.querySelector('#editor').innerHTML,'<p>Documento existente</p>');
  w.eval('saveLocal()');
  const saved=JSON.parse(w.localStorage.getItem('rmdtxtml'));
  assert.equal(saved.telegraphPath,'owned-page');
  assert.equal(saved.docId,'existing-document');
  w.close();
});
test('empty saved document restores its name and destination',()=>{
  const w=page();
  w.localStorage.setItem('rmdtxtml',JSON.stringify({html:'',name:'Vazio',dest:'telegraph',docId:'empty-document'}));
  w.eval('loadLocal()');
  assert.equal(w.document.querySelector('#editor').innerHTML,'');
  assert.equal(w.document.querySelector('#docName').value,'Vazio');
  w.eval('saveLocal()');
  assert.equal(JSON.parse(w.localStorage.getItem('rmdtxtml')).dest,'telegraph');
  w.close();
});

test('list and quote families open from their toolbar and honor destination',()=>{
  const w=page(),d=w.document;
  d.querySelector('#listBtn').click();
  assert.equal(d.querySelector('#listMenu').classList.contains('on'),true);
  d.querySelector('#listMenu [data-insert="task"]').click();
  assert.ok(d.querySelector('#editor input[type="checkbox"]'));
  d.querySelector('#quoteBtn').click();
  d.querySelector('#quoteMenu [data-insert="pullquote"]').click();
  assert.equal(d.querySelector('#editor aside').textContent,'Citação em destaque');
  d.querySelector('#destBtn').click();
  assert.equal(d.querySelector('#listMenu [data-insert="task"]').hidden,true);
  assert.equal(d.querySelector('#listMenu [data-insert="ordered"]').hidden,false);
  assert.equal(d.querySelector('#quoteMenu [data-insert="pullquote"]').hidden,true);
  d.querySelector('#exportBtn').click();
  assert.equal(d.querySelector('#exportMenu').classList.contains('on'),true);
  assert.equal(d.querySelector('#openAppBtn').hidden,false);
  w.close();
});

test('closing or hiding the page saves the last edit without waiting for debounce',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  e.innerHTML='<p>Última edição</p>';e.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(JSON.parse(w.localStorage.getItem('rmdtxtml')).html,e.innerHTML);
  e.innerHTML='<p>Edição antes de trocar de aplicativo</p>';e.dispatchEvent(new w.Event('input',{bubbles:true}));
  Object.defineProperty(d,'visibilityState',{value:'hidden'});d.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal(JSON.parse(w.localStorage.getItem('rmdtxtml')).html,e.innerHTML);
  w.close();
});
test('cancelling insertion dialogs at every step leaves the document intact',()=>{
  const cases={table:[''],reference:['nota','texto'],time:['1700000000','wDT','Data'],emoji:['123','🙂'],map:['0','0','14',''],image:['https://example.com/image.jpg','legenda','crédito'],collage:['https://example.com/a.jpg',''],button:['url','Abrir','primary','https://example.com']};
  for(const [kind,answers] of Object.entries(cases))for(let stop=0;stop<answers.length;stop++){
    const w=page(),e=w.document.querySelector('#editor');e.innerHTML='<p>Preservar</p>';
    let i=0;w.prompt=()=>i===stop?null:answers[i++];
    w.eval(`insertFeature('${kind}')`);
    assert.equal(e.innerHTML,'<p>Preservar</p>',kind+' etapa '+stop);
    w.close();
  }
});
test('a second local attachment and an oversized attachment never remove the first',()=>{
  const w=page(),d=w.document,input=d.querySelector('#mediaInput');
  let files=[new w.File(['one'],'first.png',{type:'image/png'})],revoked=[];
  Object.defineProperty(input,'files',{get:()=>files});
  w.URL.createObjectURL=()=> 'blob:first';w.URL.revokeObjectURL=url=>revoked.push(url);
  input.dispatchEvent(new w.Event('change'));
  const original=d.querySelector('#editor').innerHTML;
  files=[new w.File(['two'],'second.png',{type:'image/png'})];input.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('#editor').innerHTML,original);assert.deepEqual(revoked,[]);
  files=[{size:20_000_001,name:'large.png',type:'image/png'}];input.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('#editor').innerHTML,original);assert.equal(input.value,'');
  w.close();
});
test('oversized gallery is rejected rather than silently truncated',()=>{
  const w=page(),e=w.document.querySelector('#editor');e.innerHTML='<p>Original</p>';
  w.prompt=()=>Array.from({length:51},(_,i)=>'https://example.com/'+i+'.jpg').join('\n');
  w.eval('insertFeature("collage")');
  assert.equal(e.innerHTML,'<p>Original</p>');
  assert.equal(w.document.querySelector('#toast').textContent,'Use no máximo 50 itens por galeria');
  w.close();
});

test('timed-out publication releases the button and preserves the document',async()=>{
  let aborted=false;
  const w=page({fetch:async(url,options)=>{
    if(url.endsWith('/session'))return {ok:true,json:async()=>({ok:true})};
    aborted=options.signal.aborted;
    throw options.signal.reason;
  }});
  await new Promise(resolve=>setTimeout(resolve,0));
  w.AbortSignal.timeout=()=>w.AbortSignal.abort(new w.DOMException('Timed out','TimeoutError'));
  const d=w.document;d.querySelector('#editor').innerHTML='<p>Manter texto</p>';
  d.querySelector('#exportBtn').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(aborted,true);
  assert.equal(d.querySelector('#exportBtn').disabled,false);
  assert.equal(d.querySelector('#editor').innerHTML,'<p>Manter texto</p>');
  assert.equal(d.querySelector('#toast').textContent,'Tempo de envio esgotado. Confira o chat antes de tentar novamente.');
  w.close();
});

test('browser viewport follows VisualViewport while Telegram geometry remains separate',()=>{
  const listeners={};
  const vv={height:480,offsetTop:24,addEventListener(name,fn){listeners[name]=fn;}};
  const w=page(undefined,false,{visualViewport:vv});
  const root=w.document.documentElement;
  assert.equal(root.style.getPropertyValue('--vv-top'),'24px');
  assert.equal(root.style.getPropertyValue('--vv-h'),'480px');
  assert.equal(root.style.getPropertyValue('--kb'),Math.max(0,w.innerHeight-504)+'px');
  vv.height=420;vv.offsetTop=12;listeners.resize();
  assert.equal(root.style.getPropertyValue('--vv-h'),'420px');
  assert.equal(root.style.getPropertyValue('--vv-top'),'12px');
  w.close();
});

test('local attachment survives editor reload through IndexedDB and restores its object URL',async()=>{
  const db=memoryIndexedDB();
  let n=0;
  const w=page(undefined,false,{indexedDB:db,objectURL:()=>`blob:persisted-${++n}`});
  const d=w.document,input=d.querySelector('#mediaInput');
  const file=new w.File([new Uint8Array([1,2,3,4])],'foto.png',{type:'image/png'});
  Object.defineProperty(input,'files',{configurable:true,value:[file]});
  input.dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,10));
  const saved=w.localStorage.getItem('rmdtxtml');
  const id=d.querySelector('[data-media-id]')?.getAttribute('data-media-id');
  assert.ok(id);
  assert.equal(db.rows.has(id),true);
  w.eval('mediaFile=null');
  d.querySelector('#editor').innerHTML='';
  w.localStorage.setItem('rmdtxtml',saved);
  w.eval('loadLocal()');
  await w.eval('restoreMedia()');
  const node=d.querySelector('[data-media-id]');
  assert.equal(node.getAttribute('data-media-id'),id);
  assert.match(node.getAttribute('src'),/^blob:persisted-/);
  assert.match(w.eval('buildRich().rich_message.html'),new RegExp('tg:\\/\\/photo\\?id='+id));
  w.close();
});

test('formula and media structures are visibly distinct while remaining native rich elements',()=>{
  const w=page(),d=w.document,e=d.querySelector('#editor');
  e.innerHTML='<p>Inline <tg-math>x^2</tg-math></p><tg-math-block>E = mc^2</tg-math-block><figure><video src="https://example.com/a.mp4"></video><figcaption>Vídeo</figcaption></figure><tg-document src="https://example.com/a.pdf"></tg-document>';
  w.eval('decorateSpecials()');
  assert.equal(w.getComputedStyle(e.querySelector('tg-math')).display,'inline-block');
  assert.equal(w.getComputedStyle(e.querySelector('tg-math-block')).display,'block');
  assert.equal(w.getComputedStyle(e.querySelector('tg-math-block')).borderRadius,'14px');
  assert.equal(w.getComputedStyle(e.querySelector('tg-math-block')).padding,'12px 14px');
  assert.equal(e.querySelector('video').hasAttribute('controls'),true);
  assert.equal(w.getComputedStyle(e.querySelector('figure')).borderRadius,'18px');
  assert.equal(w.getComputedStyle(e.querySelector('tg-document')).minHeight,'48px');
  assert.match(w.eval('buildRich().rich_message.html'),/<tg-math>x\^2<\/tg-math>/);
  w.close();
});
