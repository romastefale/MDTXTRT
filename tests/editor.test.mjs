import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {randomUUID} from 'node:crypto';
import {TextEncoder} from 'node:util';

const root = new URL('../', import.meta.url);
function page(tg){
  const dom = new JSDOM(readFileSync(new URL('index.html',root),'utf8'),{url:'https://mdtxtrt.up.railway.app/',runScripts:'outside-only'});
  const w = dom.window;
  w.matchMedia = () => ({matches:true,addEventListener(){}});
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID});
  if(tg){w.Telegram={WebApp:{initData:'signed-payload',colorScheme:'dark',ready(){},expand(){},setHeaderColor(){},MainButton:{setText(){},show(){},onClick(){}},...tg}};w.fetch=tg.fetch;}
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
test('markdown GFM and unsupported HTML',()=>{
  const w=page();
  const src='# Título\n\n- [x] tarefa\n- [ ] próxima\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**forte** e [site](https://example.com)';
  const html=w.eval('mdToBasicHTML('+JSON.stringify(src)+')');
  assert.match(html,/<table>/);
  assert.match(html,/checkbox/);
  assert.match(html,/<strong>forte<\/strong>/);
  w.document.querySelector('#editor').innerHTML=html;
  const md=w.eval('htmlToMarkdown(document.querySelector("#editor").innerHTML)');
  assert.match(md,/<table>/);
  assert.throws(()=>w.eval('mdToBasicHTML("<script>alert(1)</script>")'),/não suportado/);
  w.close();
});
test('replace keeps bold and preview uses selected serializer',()=>{
  const w=page();
  w.document.querySelector('#editor').innerHTML='<p>Teste <strong>forte forte</strong></p>';
  w.document.querySelector('#findText').value='forte';
  w.document.querySelector('#replaceText').value='novo';
  w.document.querySelector('#replaceAll').click();
  assert.equal(w.document.querySelector('#editor strong').textContent,'novo novo');
  w.document.querySelector('#previewBtn').click();
  assert.match(w.document.querySelector('#preview').innerHTML,/<strong>novo novo<\/strong>/);
  w.close();
});
test('exact markdown stays unchanged when editor is untouched',async()=>{
  const w=page();
  const md='## Nome\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
  const file=w.document.querySelector('#fileInput');
  Object.defineProperty(file,'files',{value:[{name:'source.md',text:async()=>md}]});
  file.dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(w.eval('htmlToMarkdown(document.querySelector("#editor").innerHTML)'),md);
  w.close();
});
test('Telegram rich serializer rejects arbitrary elements and uses native HTML',()=>{
  const w=page();
  const editor=w.document.querySelector('#editor');
  editor.innerHTML='<h2>Olá</h2><ul><li><input type="checkbox" checked>Feito</li></ul>';
  assert.match(w.eval('buildRich().rich_message.html'),/<h2>Olá<\/h2>/);
  assert.match(w.eval('buildRich().rich_message.html'),/checked/);
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
  resolve({ok:true});
  await new Promise(r=>setTimeout(r,5));
  assert.equal(w.document.body.classList.contains('tg'),true);
  assert.equal(fullscreen,1);
  assert.equal(hidden,1);
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
