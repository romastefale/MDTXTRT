import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const uiSource=()=>read('src/liquid-glass-ui.jsx');

test('application controller parses and canonical React bundle is committed',()=>{
  assert.doesNotThrow(()=>new vm.Script(read('app.js'),{filename:'app.js'}));
  assert.ok(existsSync(new URL('../ui.js',import.meta.url)));
  assert.equal(existsSync(new URL('../glass.js',import.meta.url)),false);
});

test('official Liquid Glass React dependencies and deterministic build are pinned',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  assert.equal(pkg.dependencies['@samasante/liquid-glass'],'0.1.1');
  assert.equal(pkg.dependencies.react,'19.3.0');
  assert.equal(pkg.dependencies['react-dom'],'19.3.0');
  assert.equal(pkg.devDependencies.esbuild,'0.28.2');
  assert.match(pkg.scripts.build,/src\/liquid-glass-ui\.jsx/);
  assert.match(pkg.scripts.build,/--outfile=ui\.js/);
  assert.equal(lock.packages['node_modules/@samasante/liquid-glass'].version,'0.1.1');
  assert.equal(lock.packages['node_modules/react'].version,'19.3.0');
  assert.equal(lock.packages['node_modules/react-dom'].version,'19.3.0');
});

test('React UX imports the official Glass primitive and follows GlassContextMenu optics',()=>{
  const src=uiSource();
  assert.match(src,/import \{ Glass \} from "@samasante\/liquid-glass"/);
  assert.match(src,/examples\/GlassContextMenu\.tsx/);
  assert.match(src,/export const MENU_LENS = \{/);
  for(const fragment of [
    'mapSize: 256','clipToShape: true','softEdge: true','depth: 0.65',
    'curvature: 0.26','dispersion: 0.16','strength: 0.22','bend: 0.65',
    'bendWidth: 0.07','frost: 3.5','brightness: 0.55','specular: 0.8',
    'sheenAngle: 45','glow: 0.06','glowSpread: 1','glowFalloff: 0.8',
    'sheen: 0.4','sheenWidth: 1'
  ])assert.ok(src.includes(fragment),fragment);
  assert.match(src,/function GlassContextMenu/);
  assert.match(src,/<Glass optics=\{MENU_LENS\} className="glass-menu-material">/);
  assert.match(src,/function GlassControl/);
  assert.match(src,/<Glass optics=\{MENU_LENS\}/);
});

test('MDTXTRT contains no bespoke Liquid Glass renderer or implicit browser fallback',()=>{
  const html=read('index.html'),src=uiSource(),server=read('server.mjs');
  assert.match(html,/id="ux-root"/);
  assert.match(html,/<script type="module" src="ui\.js\?v=[a-f0-9]{12}"><\/script>/);
  assert.doesNotMatch(html,/glass\.js/);
  assert.doesNotMatch(html,/data-lg/);
  assert.doesNotMatch(html,/class="sheet/);
  assert.doesNotMatch(src,/feDisplacementMap|backdrop-filter|supportsRefraction|supportsBackdropUrl|navigator\.userAgent|WebKit|Blink|Gecko/);
  assert.doesNotMatch(server,/"glass\.js"/);
  assert.match(server,/"ui\.js"/);
});

test('theme neutrals are chromatic derivatives of the active accent',()=>{
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
  assert.doesNotMatch(html,/--muted:#[0-9a-f]{3,8}/i);
});

test('theme switch owns browser and Telegram chrome without mixed system bars',()=>{
  const html=read('index.html'),src=uiSource(),app=read('app.js');
  assert.match(html,/id="statusBarStyle"/);
  assert.match(html,/mdtxtrt-theme/);
  assert.match(html,/root\.classList|r\.classList/);
  assert.match(src,/Icon name="light_mode"/);
  assert.ok(existsSync(new URL('../icons/light_mode.svg',import.meta.url)));
  assert.ok(existsSync(new URL('../icons/dark_mode.svg',import.meta.url)));
  assert.match(app,/const THEME_KEY='mdtxtrt-theme'/);
  assert.match(app,/localStorage\.setItem\(THEME_KEY,mode\)/);
  assert.match(app,/tg\.setHeaderColor\(color\)/);
  assert.match(app,/tg\.setBackgroundColor\(color\)/);
  assert.match(app,/tg\.setBottomBarColor\(color\)/);
  assert.match(app,/light\?'dark_mode':'light_mode'/);
  assert.match(app,/statusMeta\.content=light\?'default':'black-translucent'/);
});

test('interface icon assets are vector SVG only and referenced from React source',()=>{
  const html=read('index.html'),src=uiSource();
  assert.match(html,/rel="icon" type="image\/svg\+xml" href="favicon\.svg"/);
  assert.match(html,/rel="apple-touch-icon" href="logo\.svg"/);
  assert.ok(existsSync(new URL('../logo.svg',import.meta.url)));
  assert.equal(existsSync(new URL('../logo.png',import.meta.url)),false);
  const names=new Set([
    ...[...src.matchAll(/(?:name|icon)="([a-z0-9_]+)"/g)].map(m=>m[1]),
    ...[...src.matchAll(/\["([a-z0-9_]+)",\s*"[^"]+"/g)].map(m=>m[1]),
  ]);
  assert.ok(names.size>40);
  for(const name of names)assert.ok(existsSync(new URL('../icons/'+name+'.svg',import.meta.url)),name);
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
  assert.match(app,/toastTextHost/);
  assert.match(app,/if\(window\.visualViewport\)\{/);
  assert.match(app,/function searchRegex\(term,exact=false\)/);
  const searchBlock=app.slice(app.indexOf('function matches(){'),app.indexOf("one('#findNext')"));
  assert.doesNotMatch(searchBlock,/toLocaleLowerCase/);
  assert.match(searchBlock,/matchAll\(searchRegex\(term\)\)/);
});

test('server exposes every React-referenced local SVG icon and vector app icon',()=>{
  const src=uiSource(),server=read('server.mjs');
  const names=new Set([
    ...[...src.matchAll(/(?:name|icon)="([a-z0-9_]+)"/g)].map(m=>m[1]),
    ...[...src.matchAll(/\["([a-z0-9_]+)",\s*"[^"]+"/g)].map(m=>m[1]),
  ]);
  for(const name of names)assert.ok(server.includes('"'+name+'"')||server.includes('icons/'+name+'.svg'),name);
  assert.match(server,/"logo\.svg"/);
  assert.doesNotMatch(server,/"logo\.png"/);
});

test('UI preserves compact portrait contract, unified chrome scale and anchored context menus',()=>{
  const html=read('index.html'),src=uiSource(),app=read('app.js');
  assert.match(html,/minimum-scale=1, maximum-scale=1, user-scalable=no/);
  assert.match(html,/\*\{box-sizing:border-box;scrollbar-width:none\}/);
  assert.match(html,/\*::-webkit-scrollbar\{width:0;height:0;display:none\}/);
  assert.match(html,/:where\(button,input,textarea,\[contenteditable="true"\]\):focus-visible/);
  assert.match(html,/@media \(orientation:landscape\),\(min-width:760px\)/);
  assert.match(html,/--control-size:clamp\(36px,10vw,40px\)/);
  assert.match(html,/--menu-w:210px/);
  assert.match(html,/--menu-row-h:24px/);
  assert.match(html,/\.bar > button\.more\{color:var\(--accent\);background:var\(--neutral-3\)\}/);
  assert.match(src,/className="app-title"[^>]*>MDTXTRT<\/span>/);
  assert.match(src,/id="themeBtn"/);
  assert.match(src,/id="plusBtn"[\s\S]*popoverTarget="plusMenu"/);
  const typebar=src.slice(src.indexOf('<GlassControl className="bar"'),src.indexOf('</GlassControl>',src.indexOf('<GlassControl className="bar"')));
  assert.ok(typebar.lastIndexOf('id="plusBtn"')>typebar.lastIndexOf('id="quoteBtn"'));
  for(const pair of [['headingMenu','headingBtn'],['listMenu','listBtn'],['quoteMenu','quoteBtn'],['plusMenu','plusBtn'],['exportMenu','exportBtn']]){
    assert.match(src,new RegExp('id="'+pair[0]+'"[^>]*anchorId="'+pair[1]+'"'));
  }
  assert.match(app,/function placePanel\(panel,anchorRect=null\)/);
  assert.match(app,/panel\.style\.setProperty\('--menu-left'/);
  assert.match(src,/id="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(src,/id="dialogMenu"[\s\S]*?popover="manual"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
});

test('Telegram Mini App requires phone platform and locks portrait through the official API',()=>{
  const app=read('app.js');
  assert.match(app,/telegramPhonePlatforms=new Set\(\['android','ios'\]\)/);
  assert.match(app,/tg\.isVersionAtLeast\('8\.0'\)/);
  assert.match(app,/typeof tg\.lockOrientation!=='function'/);
  assert.match(app,/if\(!tg\.isOrientationLocked\)tg\.lockOrientation\(\)/);
  assert.match(app,/portraitQuery\.addEventListener\('change',syncDeviceContract\)/);
});

test('Telegraph supports explicit Telegram or browser capability ownership without identity fallback',()=>{
  const app=read('app.js'),server=read('server.mjs');
  assert.match(app,/const BROWSER_OWNER_KEY='mdtxtrt-browser-owner'/);
  assert.match(app,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(app,/session==='ready'\?\{initData:getTg\(\)\.initData\}:\{browserKey:browserOwnerKey\(\)\}/);
  assert.match(server,/function telegraphOwner\(body\)/);
  assert.match(server,/Identidade de publicação ambígua/);
  assert.match(server,/browser:\"?\+?createHash\("sha256"\)/);
  assert.doesNotMatch(server,/Abra pelo bot no Telegram para publicar no Telegraph/);
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

test('execution toolchain is pinned and CI verifies generated UI without mutating main',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  const workflow=read('.github/workflows/regression.yml');
  const railpack=JSON.parse(read('railpack.json'));
  assert.deepEqual(pkg.engines,{node:'24.21.0'});
  assert.equal(pkg.devEngines.runtime.version,'24.21.0');
  assert.equal(pkg.devEngines.runtime.onFail,'error');
  assert.deepEqual(lock.packages[''].engines,pkg.engines);
  assert.match(workflow,/permissions:\s*\n\s*contents: read/);
  assert.match(workflow,/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/);
  assert.match(workflow,/actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.match(workflow,/test "\$\(npm --version\)" = "11\.19\.0"/);
  assert.match(workflow,/npm run build/);
  assert.match(workflow,/actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4/);
  assert.match(workflow,/name: react-ui-bundle/);
  assert.match(workflow,/git diff --exit-code -- ui\.js/);
  assert.doesNotMatch(workflow,/git push|contents: write/);
  assert.deepEqual(railpack.steps.install.deployOutputs,[]);
  assert.equal(railpack.steps.install.commands.at(-2),'npm --version | grep -Fx 11.19.0');
  assert.equal(railpack.steps.install.commands.at(-1),'npm ci');
});

test('architecture provenance records official package use and copied example ownership',()=>{
  assert.ok(existsSync(new URL('../PROVENANCE.md',import.meta.url)));
  const provenance=read('PROVENANCE.md');
  const architecture=read('ARCHITECTURE.md');
  assert.match(provenance,/@samasante\/liquid-glass/);
  assert.match(provenance,/examples\/GlassContextMenu\.tsx/);
  assert.match(provenance,/MIT/);
  assert.match(provenance,/Sam Asante/);
  assert.match(provenance,/sendRichMessage/);
  assert.match(provenance,/telegra\.ph\/api/);
  assert.match(architecture,/React/);
  assert.match(architecture,/@samasante\/liquid-glass/);
  assert.match(architecture,/no local displacement-map renderer/i);
});
