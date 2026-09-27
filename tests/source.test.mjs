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

test('script cache keys track the current UX engine and controller blobs',()=>{
  const html=read('index.html');
  assert.match(html,/app\.js\?v=d6c30dd32be8/);
  assert.match(html,/glass\.js\?v=aa91846a9205/);
  assert.doesNotMatch(html,/app\.js\?v=46df031c221a/);
});

test('compact UX surfaces use the GlassContextMenu profile and no legacy sheet surface remains',()=>{
  const html=read('index.html');
  const tags=[...html.matchAll(/<[^>]+\bclass="[^"]*\bfrost\b[^"]*"[^>]*>/g)].map(match=>match[0]);
  assert.equal(tags.length,13);
  for(const tag of tags)assert.match(tag,/\bdata-lg(?:\s|=|>)/,tag);
  assert.doesNotMatch(html,/(?:-webkit-)?backdrop-filter\s*:/);
  assert.match(html,/class="bar frost"\s+data-lg\s+data-lg-mode="frost"\s+id="typebar"/);
  assert.equal((html.match(/class="glass-menu frost"\s+data-lg\s+data-lg-profile="context-menu"/g)||[]).length,8);
  assert.equal((html.match(/<[^>]+data-lg-profile="context-menu"[^>]*>/g)||[]).length,12);
  assert.doesNotMatch(html,/class="sheet frost"/);
  assert.doesNotMatch(html,/data-lg-wide/);
});

test('liquid-glass engine preserves base optics and the normative GlassContextMenu profile',()=>{
  const glass=read('glass.js');
  for(const fragment of [
    'strength:.05','depth:.5','curvature:.3','dispersion:.32',
    'bend:.45','bendWidth:.16','frost:6','saturate:1.15',
    'specular:1','sheenAngle:45','sheen:.32','sheenWidth:3',
    'glow:.1','glowSpread:1','glowFalloff:.5'
  ])assert.ok(glass.includes(fragment),fragment);
  for(const fragment of [
    'mapSize:256','depth:.65','curvature:.26','dispersion:.16','strength:.22',
    'bend:.65','bendWidth:.07','frost:3.5','brightness:.55','specular:.8',
    'glow:.06','glowFalloff:.8','sheen:.4','sheenWidth:1'
  ])assert.ok(glass.includes(fragment),fragment);
  assert.match(glass,/UX profile source: examples\/GlassContextMenu\.tsx/);
  assert.match(glass,/profile=el\.dataset\.lgProfile==="context-menu"\?"context-menu":"material"/);
  assert.match(glass,/context-menu-refraction/);
  assert.match(glass,/context-menu-frost/);
  assert.match(glass,/r\.setAttribute\("scale",scale\*\(1\+D\*\.5\*optics\.dispersion\)\)/);
  assert.match(glass,/g\.setAttribute\("scale",scale\)/);
  assert.match(glass,/b\.setAttribute\("scale",scale\*\(1-D\*\.5\*optics\.dispersion\)\)/);
  assert.match(glass,/feDisplacementMap/);
  assert.doesNotMatch(glass,/data-lg-wide/);
  assert.doesNotMatch(glass,/willChange/);
  assert.match(glass,/f\.id="lg-mat-"\+materialId\+"-v"\+\(\+\+v\)/);
  assert.doesNotMatch(glass,/el\.style\.filter\s*=/);
});

test('theme accents remain semantic while compact glass menu states use the active accent',()=>{
  const html=read('index.html');
  assert.match(html,/--accent:#2B88D8;/);
  assert.match(html,/html\.light\{[\s\S]*?--accent:#FF4BA0;/);
  assert.match(html,/--muted:color-mix\(in oklab,var\(--text\) 82%,var\(--accent\)\);/);
  for(const [name,amount] of [['neutral-1','6'],['neutral-2','10'],['neutral-3','16'],['neutral-4','24']]){
    assert.match(html,new RegExp('--'+name+':color-mix\\(in oklab,var\\(--accent\\) '+amount+'%,var\\(--bg\\)\\);'));
  }
  assert.match(html,/--line:color-mix\(in oklab,var\(--accent\) 22%,var\(--bg\)\);/);
  assert.match(html,/\.menu-list > button:hover,\.menu-list > button:focus-visible\{background:var\(--accent\);color:#fff\}/);
  assert.match(html,/\.dialog-actions #dialogOk\{background:var\(--accent\);color:#fff\}/);
  assert.match(html,/\[data-lg-profile="context-menu"\]\{[\s\S]*?background:transparent;color:#151515;/);
  assert.doesNotMatch(html,/--muted:#[0-9a-f]{3,8}/i);
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

test('editor emits Bot API 10.3 RichText-compatible expandable quotes',()=>{
  const app=read('app.js');
  assert.match(app,/<blockquote expandable>Citação expansível<\/blockquote>/);
  assert.doesNotMatch(app,/<blockquote expandable><p>/);
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

test('UI preserves portrait phone contract, disables zoom and pinch zoom, hides scrollbars and keeps 44px shell targets',()=>{
  const html=read('index.html');
  assert.match(html,/minimum-scale=1, maximum-scale=1, user-scalable=no/);
  assert.match(html,/touch-action:pan-x pan-y/);
  assert.match(html,/\*\{box-sizing:border-box;scrollbar-width:none\}/);
  assert.match(html,/\*::-webkit-scrollbar\{width:0;height:0;display:none\}/);
  assert.match(html,/:where\(button,input,textarea,\[contenteditable="true"\]\):focus-visible/);
  assert.match(html,/id="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/id="dialogMenu"[^>]*popover="manual"[^>]*role="dialog" aria-modal="true" aria-labelledby="dialogLabel"/);
  assert.match(html,/id="deviceGate" role="dialog" aria-modal="true"/);
  assert.match(html,/@media \(orientation:landscape\),\(min-width:760px\)/);
  assert.match(html,/--meta-h:52px/);
  assert.match(html,/--bar-h:52px/);
  assert.match(html,/min-width:44px;height:44px/);
});

test('menus use compact context-menu geometry and anchor to their invoking controls',()=>{
  const html=read('index.html'),app=read('app.js');
  assert.match(html,/\.glass-menu\{[\s\S]*?min-width:210px;max-width:min\(280px,calc\(100vw - 16px\)\);[\s\S]*?max-height:min\(55vh,420px\)/);
  assert.match(html,/height:32px;min-height:32px/);
  assert.match(html,/border-radius:9px/);
  assert.match(html,/data-anchor="plusBtn" data-placement="top"/);
  assert.match(html,/data-anchor="brandBtn" data-placement="bottom"/);
  assert.match(html,/data-anchor="findBtn" data-placement="right"/);
  assert.doesNotMatch(html,/\.sheet\{/);
  assert.match(app,/function positionFloatingPanel\(panel,anchorRect=null\)/);
  assert.match(app,/panel\.dataset\.placement\|\|'bottom'/);
  assert.match(app,/getBoundingClientRect\(\)/);
  assert.match(app,/requestAnimationFrame\(\(\)=>positionFloatingPanel/);
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
  assert.match(server,/allowedByType=\{/);
  assert.match(server,/URL de botão deve usar HTTP, HTTPS ou tg:\/\//);
  assert.doesNotMatch(server,/telegramCall\("sendMessage"/);
});

test('execution toolchain is pinned across local, CI and Railway builds',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  const workflow=read('.github/workflows/regression.yml');
  const railpack=JSON.parse(read('railpack.json'));
  assert.equal(pkg.packageManager,undefined);
  assert.deepEqual(pkg.engines,{node:'24.21.0'});
  assert.equal(pkg.devEngines.runtime.version,'24.21.0');
  assert.equal(pkg.devEngines.runtime.onFail,'error');
  assert.equal(pkg.devEngines.packageManager,undefined);
  assert.deepEqual(lock.packages[''].engines,pkg.engines);
  assert.match(workflow,/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(workflow,/actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.match(workflow,/node-version-file: package\.json/);
  assert.match(workflow,/test "\$\(npm --version\)" = "11\.19\.0"/);
  assert.deepEqual(railpack.steps.install.deployOutputs,[]);
  assert.equal(railpack.steps.install.commands.at(-2),'npm --version | grep -Fx 11.19.0');
  assert.equal(railpack.steps.install.commands.at(-1),'npm ci');
});

test('architecture provenance is shipped with the repository and adapted source',()=>{
  assert.ok(existsSync(new URL('../PROVENANCE.md',import.meta.url)));
  const provenance=read('PROVENANCE.md');
  const glass=read('glass.js');
  assert.match(provenance,/romastefale\/liquid-glass/);
  assert.match(provenance,/Sam Asante/);
  assert.match(provenance,/sendRichMessage/);
  assert.match(provenance,/telegra\.ph\/api/);
  assert.match(glass,/Reference: https:\/\/github\.com\/romastefale\/liquid-glass/);
  assert.match(glass,/4e7b769e1df7e5a7d3669fef22417fe3d2f79ade/);
  assert.match(glass,/© Sam Asante, MIT License/);
});
