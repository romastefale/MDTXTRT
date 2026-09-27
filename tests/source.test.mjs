import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');

test('application scripts parse',()=>{
  assert.doesNotThrow(()=>new vm.Script(read('app.js'),{filename:'app.js'}));
  assert.doesNotThrow(()=>new vm.Script(read('glass.js'),{filename:'glass.js'}));
});

test('script cache keys are versioned and stale app key is gone',()=>{
  const html=read('index.html');
  assert.match(html,/app\.js\?v=[a-f0-9]{12}/);
  assert.match(html,/glass\.js\?v=8c5538a2953d/);
  assert.doesNotMatch(html,/app\.js\?v=46df031c221a/);
});

test('all frost chrome surfaces use an explicit liquid-glass material mode',()=>{
  const html=read('index.html');
  const tags=[...html.matchAll(/<[^>]+\bclass="[^"]*\bfrost\b[^"]*"[^>]*>/g)].map(match=>match[0]);
  assert.equal(tags.length,13);
  for(const tag of tags)assert.match(tag,/\bdata-lg(?:\s|=|>)/,tag);
  assert.doesNotMatch(html,/(?:-webkit-)?backdrop-filter\s*:/);
  assert.match(html,/class="bar frost"\s+data-lg\s+data-lg-mode="frost"\s+id="typebar"/);
  assert.doesNotMatch(html,/data-lg-wide/);
  assert.match(html,/class="brand frost"\s+data-lg/);
  assert.equal((html.match(/class="sheet frost"\s+data-lg/g)||[]).length,8);
  assert.match(html,/class="toast frost"\s+data-lg/);
});

test('liquid-glass engine retains binding material optics on every chrome surface',()=>{
  const glass=read('glass.js');
  for(const fragment of [
    'strength:.05','depth:.5','curvature:.3','dispersion:.32',
    'bend:.45','bendWidth:.16','frost:6','saturate:1.15',
    'specular:1','sheenAngle:45','sheen:.32','sheenWidth:3',
    'glow:.1','glowSpread:1','glowFalloff:.5'
  ])assert.ok(glass.includes(fragment),fragment);
  assert.match(glass,/feDisplacementMap/);
  assert.match(glass,/inset 0 1px 0 rgba\(255,255,255,\.55\).*inset 0 0 0 1px rgba\(255,255,255,\.12\)/s);
  assert.doesNotMatch(glass,/data-lg-wide/);
  assert.match(glass,/el\.dataset\.lgMode==="frost"\?"frost":"material"/);
  assert.match(glass,/if\(mode==="frost"\)\{/);
  assert.doesNotMatch(glass,/willChange/);
  assert.match(glass,/f\.id="lg-mat-"\+materialId\+"-v"\+\(\+\+v\)/);
  assert.doesNotMatch(glass,/el\.style\.filter\s*=/);
});

test('interface icon assets are vector SVG only',()=>{
  const html=read('index.html');
  assert.match(html,/rel="icon" type="image\/svg\+xml" href="favicon\.svg"/);
  assert.match(html,/rel="apple-touch-icon" href="logo\.svg"/);
  assert.ok(existsSync(new URL('../logo.svg',import.meta.url)));
  assert.equal(existsSync(new URL('../logo.png',import.meta.url)),false);
  const icons=[...new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map(m=>m[1]))];
  assert.ok(icons.length>40);
  for(const name of icons){
    assert.match(name,/^[a-z0-9_]+$/);
    assert.ok(existsSync(new URL('../icons/'+name+'.svg',import.meta.url)),name);
  }
});

test('editor keeps target-specific publishing validation and code metadata',()=>{
  const app=read('app.js');
  assert.match(app,/a:\['href','name'\],code:\['class'\]/);
  assert.match(app,/dest==='telegraph'\?\['http:','https:'\]/);
  assert.match(app,/slice\(0,64\)/);
  assert.match(app,/Formato de data inválido/);
  assert.match(app,/function activeMedia\(\)/);
  assert.match(app,/redoUsesMedia=hist\.slice\(histI\+1\)/);
  assert.doesNotMatch(app,/toast\.textContent\s*=/);
  assert.match(app,/const toastText = document\.createTextNode\(''\)/);
  assert.match(app,/if\(window\.visualViewport\)\{/);
  assert.match(app,/function searchRegex\(term,exact=false\)/);
  const searchBlock=app.slice(app.indexOf('function matches(){'),app.indexOf("one('#findNext')"));
  assert.doesNotMatch(searchBlock,/toLocaleLowerCase/);
  assert.match(searchBlock,/matchAll\(searchRegex\(term\)\)/);
});

test('server exposes every referenced local SVG icon and vector app icon',()=>{
  const html=read('index.html'),server=read('server.mjs');
  const icons=[...new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map(m=>m[1]))];
  for(const name of icons)assert.ok(server.includes('"'+name+'"')||server.includes('icons/'+name+'.svg'),name);
  assert.match(server,/"logo\.svg"/);
  assert.doesNotMatch(server,/"logo\.png"/);
});

test('UI preserves portrait phone contract, no zoom, focus semantics and 44px targets',()=>{
  const html=read('index.html');
  assert.match(html,/minimum-scale=1, maximum-scale=1, user-scalable=no/);
  assert.match(html,/:where\(button,input,textarea,\[contenteditable="true"\]\):focus-visible/);
  assert.match(html,/id="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/id="dialogMenu" popover="manual" role="dialog" aria-modal="true" aria-labelledby="dialogLabel"/);
  assert.match(html,/id="deviceGate" role="dialog" aria-modal="true"/);
  assert.match(html,/@media \(orientation:landscape\),\(min-width:760px\)/);
  assert.doesNotMatch(html,/@media \(min-width:760px\)\{\s*\.meta/);
  assert.match(html,/--meta-h:52px/);
  assert.match(html,/--bar-h:52px/);
  assert.match(html,/min-width:44px;height:44px/);
});

test('Telegram Mini App requires phone platform and locks portrait through the official API',()=>{
  const app=read('app.js');
  assert.match(app,/telegramPhonePlatforms=new Set\(\['android','ios'\]\)/);
  assert.match(app,/tg\.isVersionAtLeast\('8\.0'\)/);
  assert.match(app,/typeof tg\.lockOrientation!=='function'/);
  assert.match(app,/if\(!tg\.isOrientationLocked\)tg\.lockOrientation\(\)/);
  assert.match(app,/portraitQuery\.addEventListener\('change',syncDeviceContract\)/);
});

test('server follows Bot API 10.3 Rich Message contracts without message downgrade paths',()=>{
  const server=read('server.mjs');
  assert.match(server,/function richTextLength\(nodes\)/);
  assert.doesNotMatch(server,/Buffer\.byteLength\(html\)>32768/);
  assert.match(server,/A mensagem excede 32768 caracteres/);
  assert.match(server,/insideButton&&!\['tg-emoji','tg-time'\]\.includes\(node\.name\)/);
  assert.match(server,/"mailto:","tel:"/);
  assert.doesNotMatch(server,/telegramCall\("sendMessage"/);
});

test('architecture provenance is shipped with the repository',()=>{
  assert.ok(existsSync(new URL('../PROVENANCE.md',import.meta.url)));
  const provenance=read('PROVENANCE.md');
  assert.match(provenance,/romastefale\/liquid-glass/);
  assert.match(provenance,/Sam Asante/);
  assert.match(provenance,/sendRichMessage/);
  assert.match(provenance,/telegra\.ph\/api/);
});
