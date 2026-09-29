import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const uiSource=()=>read('src/liquid-glass-ui.jsx');

test('application controller parses and committed browser bundles are present',()=>{
  assert.doesNotThrow(()=>new vm.Script(read('app.js'),{filename:'app.js'}));
  assert.ok(existsSync(new URL('../ui.js',import.meta.url)));
  assert.ok(existsSync(new URL('../editor-core.js',import.meta.url)));
  assert.equal(existsSync(new URL('../glass.js',import.meta.url)),false);
});

test('browser bundle cache busters follow the committed Git blob SHAs',()=>{
  const html=read('index.html');
  for(const file of ['ui.js','editor-core.js']){
    const bytes=readFileSync(new URL('../'+file,import.meta.url));
    const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex').slice(0,12);
    assert.ok(html.includes(file+'?v='+sha),file+' cache buster must match committed blob');
  }
});

test('official Liquid Glass React dependencies and deterministic build are pinned',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  assert.equal(pkg.dependencies['@samasante/liquid-glass'],'0.1.1');
  assert.equal(pkg.dependencies.react,'19.3.0');
  assert.equal(pkg.dependencies['react-dom'],'19.3.0');
  assert.equal(pkg.devDependencies.esbuild,'0.28.2');
  assert.equal(pkg.scripts.build,'npm run build:editor && npm run build:ui');
  assert.match(pkg.scripts['build:ui'],/src\/liquid-glass-ui\.jsx/);
  assert.match(pkg.scripts['build:ui'],/--outfile=ui\.js/);
  assert.match(pkg.scripts['build:ui'],/(?:^|\s)--minify(?:\s|$)/);
  assert.match(pkg.scripts['build:editor'],/src\/editor-core\.mjs/);
  assert.match(pkg.scripts['build:editor'],/--outfile=editor-core\.js/);
  assert.equal(lock.packages['node_modules/@samasante/liquid-glass'].version,'0.1.1');
  assert.equal(lock.packages['node_modules/react'].version,'19.3.0');
  assert.equal(lock.packages['node_modules/react-dom'].version,'19.3.0');
});


test('ProseMirror editor dependencies, schema and transaction primitives are pinned',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  const expected={
    'prosemirror-commands':'1.7.2',
    'prosemirror-history':'1.5.0',
    'prosemirror-keymap':'1.2.3',
    'prosemirror-model':'1.25.12',
    'prosemirror-schema-list':'1.5.1',
    'prosemirror-state':'1.4.4',
    'prosemirror-view':'1.42.3'
  };
  for(const [name,version] of Object.entries(expected)){
    assert.equal(pkg.dependencies[name],version);
    assert.equal(lock.packages['node_modules/'+name].version,version);
  }
  const core=read('src/editor-core.mjs');
  assert.match(core,/new Schema\(/);
  assert.match(core,/EditorState\.create/);
  assert.match(core,/new EditorView/);
  assert.match(core,/history\(\{/);
  assert.match(core,/dispatchTransaction/);
  assert.match(core,/content:"paragraph block\*"/);
  assert.match(core,/inline:true,group:"inline",atom:true,selectable:false/);
});

test('React UX imports the official Glass primitive and standardizes menu optics with chrome capsules',()=>{
  const src=uiSource();
  assert.match(src,/import \{ Glass \} from "@samasante\/liquid-glass"/);
  assert.match(src,/examples\/GlassContextMenu\.tsx/);
  const menuLens=src.slice(src.indexOf('export const MENU_LENS = {'),src.indexOf('const BAR_LENS = {'));
  const barLens=src.slice(src.indexOf('const BAR_LENS = {'),src.indexOf('const MENU_RADIUS'));
  assert.match(menuLens,/export const MENU_LENS = \{\s*sheen: 0,\s*glow: 0,\s*specular: 0,\s*\};/);
  assert.match(barLens,/const BAR_LENS = \{\s*sheen: 0,\s*glow: 0,\s*specular: 0,\s*\};/);
  for(const lens of [menuLens,barLens]){
    for(const field of [
      'mapSize','clipToShape','softEdge','depth','curvature','dispersion','strength',
      'bend','bendWidth','frost','brightness','sheenAngle','glowSpread',
      'glowFalloff','sheenWidth'
    ]){
      assert.equal(lens.includes(field+':'),false,field+' must come from GlassMaterial defaults');
    }
  }
  assert.match(src,/function GlassContextMenu/);
  assert.match(src,/<Glass[\s\S]*?optics=\{MENU_LENS\}[\s\S]*?className="glass-menu-material"/);
  assert.doesNotMatch(src,/React\.useSyncExternalStore/);
  assert.match(src,/function GlassControl[\s\S]*?<Glass[\s\S]*?optics=\{BAR_LENS\}/);
  assert.match(src,/style=\{\{ display: "flex", alignItems: "center", \.\.\.style \}\}/);
  assert.match(src,/className="glass-menu-material"[\s\S]*?style=\{\{ display: "block", width: "100%" \}\}/);
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

test('background keeps a centered organic accent field with solid chrome-colored edges',()=>{
  const html=read('index.html');
  const bg=html.match(/\.bg\{([\s\S]*?)\n    \}/)?.[1]||'';
  assert.equal((bg.match(/radial-gradient\(/g)||[]).length,3);
  assert.match(bg,/at 43% 44%/);
  assert.match(bg,/at 59% 53%/);
  assert.match(bg,/at 51% 61%/);
  assert.match(bg,/var\(--bg\)\s*$/);
});

test('theme neutrals are chromatic derivatives of the active accent',()=>{
  const html=read('index.html');
  assert.match(html,/--accent:#2B88D8;/);
  assert.equal((html.match(/--accent:#2B88D8;/g)||[]).length,2);
  assert.match(html,/html\.light\{[\s\S]*?--accent:#269c65;/);
  assert.equal((html.match(/--accent:#269c65;/g)||[]).length,1);
  assert.match(html,/--muted:color-mix\(in oklab,var\(--text\) 82%,var\(--accent\)\);/);
  for(const [name,amount] of [['neutral-1','6'],['neutral-2','10'],['neutral-3','16'],['neutral-4','24']]){
    assert.match(html,new RegExp('--'+name+':color-mix\\(in oklab,var\\(--accent\\) '+amount+'%,var\\(--bg\\)\\);'));
  }
  assert.match(html,/--line:color-mix\(in oklab,var\(--accent\) 22%,var\(--bg\)\);/);
  assert.match(html,/--glass-tint:color-mix\(in oklab,var\(--accent\) 11%,transparent\);/);
  assert.match(html,/html\.light\{[\s\S]*?--glass-tint:color-mix\(in oklab,var\(--accent\) 7%,transparent\);/);
  assert.doesNotMatch(html,/--bar-glass-tint:/);
  assert.match(html,/--bar-glass-tint-strong:color-mix\(in oklab,var\(--accent\) 28%,transparent\);/);
  assert.match(html,/--bar-control-accent-bg:color-mix\(in oklab,var\(--accent\) 26%,transparent\);/);
  assert.match(html,/html\.light\{[\s\S]*?--bar-glass-tint-strong:color-mix\(in oklab,var\(--accent\) 23%,transparent\);/);
  assert.match(html,/html\.light\{[\s\S]*?--bar-control-accent-bg:color-mix\(in oklab,var\(--accent\) 20%,transparent\);/);
  assert.doesNotMatch(html,/--bar-(?:glass-tint-strong|control-accent-bg):[^;]*rgba\(/);
  assert.match(html,/\.seg,\.bar\{[^}]*background:var\(--glass-tint\)/);
  assert.doesNotMatch(html,/\.theme-switch\{[^}]*background:var\(--bar-glass-tint\)/);
  assert.match(html,/\.glass-menu-material,\.toast-material\{background:var\(--glass-tint\)\}/);
  assert.doesNotMatch(html,/--glass-hairline:/);
  assert.doesNotMatch(html,/box-shadow:[^;}]*inset 0 0 0 1px/);
  assert.match(html,/\.menu-divider::after\{[^}]*background:var\(--menu-edge\)\}/);
  assert.doesNotMatch(html,/--glass-edge:/);
  assert.doesNotMatch(html,/--glass-inner:/);
  assert.doesNotMatch(html,/--glass-shadow:/);
  assert.doesNotMatch(html,/--glass-shadow-tight:/);
  assert.match(html,/\.menu-list > button:hover,\.menu-list > button:focus-visible\{background:var\(--accent\);color:#fff\}/);
  assert.match(html,/\.dialog-actions #dialogOk\{background:var\(--accent\);color:#fff\}/);
  assert.match(html,/html\.dark\{--accent:#2B88D8;color-scheme:dark\}/);
  assert.doesNotMatch(html,/html\.dark\{[^}]*--muted:/);
});

test('bars keep the shared glass fill with no hairline stroke',()=>{
  const html=read('index.html');
  const shared=html.match(/\.seg,\.bar\{([^}]*)\}/)?.[1]||'';
  const seg=html.match(/\.seg\{([^}]*)\}/)?.[1]||'';
  const bar=html.match(/\.bar\{([^}]*)\}/)?.[1]||'';
  assert.doesNotMatch(html,/--glass-hairline:/);
  assert.doesNotMatch(shared,/(?:^|;)\s*border\s*:/);
  assert.doesNotMatch(shared,/box-shadow:/);
  assert.doesNotMatch(shared,/(?:linear|radial|conic)-gradient/);
  for(const block of [seg,bar]){
    assert.doesNotMatch(block,/(?:^|;)\s*border\s*:/);
    assert.doesNotMatch(block,/(?:linear|radial|conic)-gradient/);
  }
  assert.doesNotMatch(html,/\.(?:seg|bar)::(?:before|after)\{/);
  assert.match(shared,/background:var\(--glass-tint\)/);
  assert.match(shared,/border-radius:999px/);
});

test('editor uses incremental Markdown input rules on the transactional core',()=>{
  const app=read('app.js'),core=read('src/editor-core.mjs');
  for(const fragment of [
    'function applyMarkdownBlockRule({allowTask=true}={})',
    'const heading=text.match(/^(#{1,6}) (?=\\S)/);',
    "const quote=text.match(/^> (?=\\S)/);",
    "const bullet=text.match(/^[-*+] (?=\\S)/);",
    'const ordered=text.match(/^(\\d+)\\. (?=\\S)/);',
    'const task=allowTask&&text.match(/^- \\[([ xX])\\] (?=\\S)/)',
    'const wrapped=schema.nodes.blockquote.create({expandable:false},node.content.cut(markerLength))',
    'function applyMarkdownInlineRule()',
    'function normalizeEmptyFormattedBlock(inputType="")',
    'function exitFormattedBlock()',
    'function inBlock(kind)'
  ])assert.ok(core.includes(fragment),fragment);
  for(const fragment of [
    "editorCore.applyMarkdownBlockRule({allowTask:dest==='telegram'})",
    'editorCore.applyMarkdownInlineRule()',
    "editorCore.normalizeEmptyFormattedBlock(event?.inputType||'')",
    'editorCore.exitFormattedBlock()',
    "editorCore?.inBlock('blockquote')",
    "editor.addEventListener('beforeinput',exitFormattedBlockOnParagraph);",
    'function syncEditorSelectionUI()',
    "btn.setAttribute('aria-pressed',String(on));"
  ])assert.ok(app.includes(fragment),fragment);
});

test('editorial document typography uses the Telegraph serif family without changing app chrome',()=>{
  const html=read('index.html');
  assert.match(html,/\.editor\{[\s\S]*?font-family:Georgia,"Times New Roman",serif;/);
  assert.match(html,/\.editor h1,\.editor h2,\.editor h3,\.editor h4,\.editor h5,\.editor h6\{font-family:inherit;/);
  assert.match(html,/body\{[\s\S]*?font:16px\/1\.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif/);
  assert.match(html,/\.telegraph-title \.document-tools input\{[\s\S]*?Georgia,"Times New Roman",serif/);
});

test('theme switch owns browser and Telegram chrome without mixed system bars',()=>{
  const html=read('index.html'),src=uiSource(),app=read('app.js');
  assert.match(html,/id="statusBarStyle"/);
  assert.match(html,/name="color-scheme" id="colorScheme"/);
  assert.match(html,/mdtxtrt-theme/);
  assert.match(html,/root\.classList|r\.classList/);
  assert.match(src,/Icon name="light_mode"/);
  assert.ok(existsSync(new URL('../icons/light_mode.svg',import.meta.url)));
  assert.ok(existsSync(new URL('../icons/dark_mode.svg',import.meta.url)));
  assert.match(app,/const THEME_KEY='mdtxtrt-theme'/);
  assert.match(app,/localStorage\.setItem\(THEME_KEY,mode\)/);
  assert.match(app,/function setTheme\(mode\)\{[\s\S]*?localStorage\.setItem\(THEME_KEY,mode\)[\s\S]*?window\.location\.reload\(\)/);
  assert.match(app,/tg\.setHeaderColor\(color\)/);
  assert.match(app,/tg\.setBackgroundColor\(color\)/);
  assert.match(app,/tg\.setBottomBarColor\(color\)/);
  assert.match(app,/light\?'dark_mode':'light_mode'/);
  assert.match(app,/function syncBrowserChrome\(mode,color\)/);
  assert.match(app,/schemeMeta\.setAttribute\('content',mode\)/);
  assert.match(app,/replacement\.setAttribute\('content',color\)/);
  assert.match(app,/themeMeta\.replaceWith\(replacement\)/);
  assert.match(app,/root\.style\.colorScheme=mode/);
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
    ...[...src.matchAll(/\["([a-z0-9_]+)",\s*"[A-ZÀ-Ý][^"]*"/g)].map(m=>m[1]),
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
  assert.match(app,/\['http:','https:'\]/);
  assert.match(app,/\['http:','https:','mailto:','tel:','tg:'\]/);
  assert.match(app,/slice\(0,64\)/);
  assert.match(app,/Formato de data inválido/);
  assert.match(app,/function activeMedia\(\)/);
  assert.match(app,/editorCore\.patchMedia/);
  assert.doesNotMatch(app,/\bhistI\b|\bhistLock\b/);
  assert.doesNotMatch(app,/toast\.textContent\s*=/);
  assert.match(app,/toastTextHost/);
  assert.match(app,/if\(window\.visualViewport\)\{/);
  assert.doesNotMatch(app,/function searchRegex\(/);
  const core=read('src/editor-core.mjs');
  assert.match(core,/function findLiteral\(term\)/);
  assert.match(core,/\.indexOf\(needle,at\)/);
  assert.doesNotMatch(core,/new RegExp\(term/);
});

test('server exposes every React-referenced local SVG icon and vector app icon',()=>{
  const src=uiSource(),server=read('server.mjs');
  const plusStart=src.indexOf('const plusSections = [');
  const plusEnd=src.indexOf('function PlusCategory',plusStart);
  assert.ok(plusStart>=0&&plusEnd>plusStart);
  const plus=src.slice(plusStart,plusEnd);
  const names=new Set([
    ...[...src.matchAll(/\b(?:name|icon)="([a-z0-9_]+)"/g)].map(m=>m[1]),
    ...[...plus.matchAll(/\bicon:\s*"([a-z0-9_]+)"/g)].map(m=>m[1]),
    ...[...plus.matchAll(/\["([a-z0-9_]+)",\s*"[^"]+"/g)].map(m=>m[1]),
  ]);
  for(const name of names)assert.ok(server.includes('"'+name+'"')||server.includes('icons/'+name+'.svg'),name);
  assert.match(server,/"logo\.svg"/);
  assert.doesNotMatch(server,/"logo\.png"/);
});

test('Chrome PWA install metadata is exposed without changing runtime caching',()=>{
  const html=read('index.html'),server=read('server.mjs');
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.match(html,/<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.equal(manifest.name,'MDTXTRT');
  assert.equal(manifest.short_name,'MDTXTRT');
  assert.equal(manifest.id,'./');
  assert.equal(manifest.start_url,'./');
  assert.equal(manifest.scope,'./');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.theme_color,'#f8fbff');
  assert.equal(manifest.prefer_related_applications,false);
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'&&icon.src==='pwa-192.svg'&&icon.type==='image/svg+xml'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.src==='pwa-512.svg'&&icon.type==='image/svg+xml'));
  assert.match(server,/"\.webmanifest": "application\/manifest\+json; charset=utf-8"/);
  assert.match(server,/"manifest\.webmanifest"/);
  assert.match(server,/"pwa-192\.svg"/);
  assert.match(server,/"pwa-512\.svg"/);
  assert.doesNotMatch(html,/service-worker|serviceWorker/);
});

test('bottom bar uses 20px side insets, 32px bottom inset and redistributes controls',()=>{
  const html=read('index.html'),app=read('app.js');
  assert.match(html,/--bar-side-inset:20px/);
  assert.match(html,/--bar-bottom-inset:32px/);
  assert.match(html,/--foot-inset:calc\(var\(--bottom\) \+ var\(--bar-bottom-inset\) \+ var\(--bar-h\) \+ var\(--gap\)\)/);
  assert.match(html,/\.bar-wrap\{[\s\S]*?left:max\(var\(--bar-side-inset\),var\(--safe-left\)\);right:max\(var\(--bar-side-inset\),var\(--safe-right\)\);width:auto;[\s\S]*?bottom:calc\(var\(--vv-bottom\) \+ var\(--bottom\) \+ var\(--bar-bottom-inset\)\)[\s\S]*?transform:none/);
  assert.match(html,/\.bar\{[\s\S]*?width:100%;margin:0;[\s\S]*?justify-content:space-between/);
  assert.doesNotMatch(app,/root\.style\.setProperty\('--bar-side-inset'/);
});

test('editor content starts below the lowered side pills without bypassing Telegram safe-area tokens',()=>{
  const html=read('index.html');
  assert.match(html,/html\.tg-shell\{[\s\S]*?--safe-top:var\(--app-tg-content-safe-top\)/);
  assert.match(html,/\.topbar\{[\s\S]*?top:calc\(var\(--vv-top\) \+ var\(--safe-top\) \+ var\(--gap\)\)/);
  assert.match(html,/\.top-slot\{[\s\S]*?margin-top:0;transform:translateY\(var\(--top-side-offset\)\)/);
  assert.match(html,/\.seg\.top-pill\{gap:var\(--pill-pad\)\}/);
  assert.match(html,/\.scroll\{[\s\S]*?padding-top:var\(--head-inset\)/);
});

test('browser PWA uses platform safe areas while Telegram keeps its content safe area',()=>{
  const html=read('index.html'),app=read('app.js');
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/--safe-top:env\(safe-area-inset-top,0px\);[\s\S]*?--safe-bottom:env\(safe-area-inset-bottom,0px\);[\s\S]*?--safe-left:env\(safe-area-inset-left,0px\);[\s\S]*?--safe-right:env\(safe-area-inset-right,0px\);[\s\S]*?--safe-bottom-max:env\(safe-area-max-inset-bottom,36px\);/);
  assert.match(html,/html\.tg-shell\{[\s\S]*?--safe-top:var\(--app-tg-content-safe-top\);[\s\S]*?--safe-bottom:var\(--app-tg-content-safe-bottom\);[\s\S]*?--safe-left:var\(--app-tg-content-safe-left\);[\s\S]*?--safe-right:var\(--app-tg-content-safe-right\);[\s\S]*?--safe-bottom-max:0px/);
  assert.match(html,/\.fade-bot\{[\s\S]*?bottom:calc\(var\(--vv-bottom\) \+ var\(--safe-bottom\) - var\(--safe-bottom-max\)\);[\s\S]*?height:calc\(var\(--foot-inset\) \+ 50px \+ var\(--safe-bottom-max\)\)/);
  assert.match(app,/function syncTelegramContentSafeArea\(\)/);
  assert.doesNotMatch(app,/tg\.safeAreaInset/);
  assert.match(app,/tg\.contentSafeAreaInset/);
  assert.doesNotMatch(app,/--app-tg-safe-/);
  assert.match(app,/root\.style\.setProperty\('--app-tg-content-safe-'\+field/);
  assert.doesNotMatch(app,/tg\.onEvent\('safeAreaChanged'/);
  assert.match(app,/tg\.onEvent\('contentSafeAreaChanged',handleTelegramContentSafeAreaChange\)/);
  assert.match(app,/tg\.isVersionAtLeast\('8\.0'\)/);
  assert.match(app,/!syncTelegramContentSafeArea\(\)/);
});

test('undo and redo use destination mid-tone and export accent while flashing',()=>{
  const html=read('index.html');
  assert.match(html,/\.seg #undoBtn,\.seg #redoBtn\{background:var\(--bar-control-accent-bg\);color:var\(--accent\)\}/);
  assert.match(html,/\.seg #destBtn\{position:relative;background:var\(--bar-control-accent-bg\);color:var\(--accent\)\}/);
  assert.match(html,/\.seg button\.is-flash::before\{[\s\S]*?background:var\(--accent\)/);
  assert.match(html,/@keyframes flash-icon\{0%,35%\{color:#fff\}100%\{color:var\(--accent\)\}\}/);
  assert.match(html,/--bar-control-accent-bg:color-mix\(in oklab,var\(--accent\) 26%,transparent\)/);
  assert.match(html,/html\.light\{[\s\S]*?--bar-control-accent-bg:color-mix\(in oklab,var\(--accent\) 20%,transparent\)/);
});

test('destination Telegram and Telegraph icon is 28px',()=>{
  const html=read('index.html');
  assert.match(html,/\.seg #destBtn \.ui-icon\{width:28px;height:28px\}/);
});

test('chrome circles share one control diameter and dark icons retain contrast',()=>{
  const html=read('index.html');
  assert.doesNotMatch(html,/--glass-hairline:/);
  assert.doesNotMatch(html,/\.seg,\.bar\{[^}]*box-shadow:/);
  assert.match(html,/html\.dark \.seg,html\.dark \.bar\{color:#f5f5f7\}/);
  assert.match(html,/\.seg button\{[\s\S]*?width:var\(--control-size\);height:var\(--control-size\)/);
  assert.match(html,/\.bar > button\{[\s\S]*?flex:0 0 var\(--control-size\);width:var\(--control-size\);min-width:var\(--control-size\);height:var\(--control-size\)/);
  assert.match(html,/\.action-dot\{[\s\S]*?width:var\(--control-size\);height:var\(--control-size\)/);
  assert.match(html,/\.seg \.action-dot\{width:var\(--control-size\);height:var\(--control-size\)\}/);
  assert.match(html,/\.bar > button\.more\{color:#fff;background:var\(--accent\);box-shadow:0 4px 20px color-mix\(in oklab,var\(--accent\) 70%,transparent\)\}/);
  assert.match(html,/\.bar > button\.on::before\{[\s\S]*?inset:0;border-radius:50%/);
  assert.doesNotMatch(html,/\.action-dot\{[\s\S]*?control-size\) - 6px/);
});

test('menus keep the same theme glass fill without a hairline stroke',()=>{
  const html=read('index.html');
  const menu=html.match(/\.glass-menu\{([^}]*)\}/)?.[1]||'';
  const content=html.match(/\.glass-menu-content\{([^}]*)\}/)?.[1]||'';
  assert.match(menu,/color:var\(--text\)/);
  assert.match(html,/\.tools input\{[\s\S]*?color:inherit/);
  assert.match(html,/\.tools button\{[\s\S]*?color:inherit/);
  assert.match(html,/\.dialog-label\{[\s\S]*?color:var\(--muted\)/);
  assert.match(html,/#dialogInput\{[\s\S]*?color:inherit/);
  assert.match(html,/\.dialog-actions button\{[\s\S]*?color:inherit/);
  assert.doesNotMatch(menu,/color:#151515/);
  assert.match(html,/\.glass-menu-material,\.toast-material\{background:var\(--glass-tint\)\}/);
  assert.match(content,/box-shadow:0 14px 34px var\(--menu-shadow\),0 2px 6px var\(--menu-shadow-tight\)/);
  assert.doesNotMatch(content,/inset 0 0 0/);
  assert.doesNotMatch(html,/--menu-inner:/);
});

test('toast uses the shared translucent pill surface and theme-aware text',()=>{
  const html=read('index.html'),src=uiSource();
  const toast=html.match(/\.toast\{([^}]*)\}/)?.[1]||'';
  const material=html.match(/(?:^|\n)\s*\.toast-material\{([^}]*)\}/m)?.[1]||'';
  const content=html.match(/\.toast-content\{([^}]*)\}/)?.[1]||'';
  assert.match(src,/function Toast\(\)[\s\S]*?<Glass optics=\{MENU_LENS\} className="toast-material">/);
  assert.match(toast,/border-radius:999px/);
  assert.match(toast,/color:var\(--text\)/);
  assert.doesNotMatch(toast,/color:#151515/);
  assert.match(material,/border-radius:999px/);
  assert.match(material,/background:var\(--glass-tint\)/);
  assert.doesNotMatch(material,/box-shadow:/);
  assert.match(content,/padding:8px 13px/);
  assert.match(content,/color:inherit/);
});

test('export and plus keep a strong accent glow in both themes',()=>{
  const html=read('index.html');
  assert.match(html,/\.bar > button\.more\{color:#fff;background:var\(--accent\);box-shadow:0 4px 20px color-mix\(in oklab,var\(--accent\) 70%,transparent\)\}/);
  assert.match(html,/\.bar > button\.more\.on\{background:var\(--accent\);box-shadow:0 4px 24px color-mix\(in oklab,var\(--accent\) 80%,transparent\)\}/);
  assert.match(html,/\.action-dot\{[\s\S]*?background:var\(--accent\);color:#fff;[\s\S]*?box-shadow:0 4px 20px color-mix\(in oklab,var\(--accent\) 70%,transparent\)/);
});

test('theme switch is a text-and-icon target with no control background',()=>{
  const html=read('index.html'),src=uiSource(),app=read('app.js');
  assert.match(html,/--control-size:clamp\(36px,10vw,40px\)/);
  assert.doesNotMatch(html,/--theme-control-size:/);
  assert.doesNotMatch(html,/--theme-icon-size:/);
  assert.match(html,/\.theme-switch\{[\s\S]*?border:0;background:transparent;box-shadow:none;[\s\S]*?display:flex;align-items:center;justify-content:center;gap:4px;[\s\S]*?padding:8px 0;line-height:1/);
  assert.match(html,/\.app-title\{[\s\S]*?font-size:12px;line-height:1/);
  assert.match(html,/\.theme-switch \.ui-icon\{width:12px;height:12px\}/);
  assert.match(src,/<button type="button" className="theme-switch" id="themeBtn"[\s\S]*?<span className="app-title">MDTXTRT<\/span>[\s\S]*?<Icon name="light_mode" \/>[\s\S]*?<\/button>/);
  assert.doesNotMatch(src,/GlassControl className="theme-control"/);
  assert.match(app,/one\('#themeBtn'\)\.addEventListener\('click',[\s\S]*?setTheme/);
});

test('top chrome keeps lateral pills below the centered title and inside Telegram safe areas',()=>{
  const html=read('index.html');
  assert.match(html,/--top-side-offset:32px/);
  assert.match(html,/--editor-top-gap:8px/);
  assert.match(html,/--topbar-h:calc\(var\(--pill-h\) \+ var\(--top-side-offset\)\)/);
  assert.match(html,/--head-inset:calc\(var\(--safe-top\) \+ var\(--gap\) \+ var\(--topbar-h\) \+ var\(--editor-top-gap\) \+ var\(--gap\)\)/);
  assert.match(html,/html\.tg-shell\{[\s\S]*?--safe-top:var\(--app-tg-content-safe-top\)/);
  assert.match(html,/\.topbar\{[\s\S]*?top:calc\(var\(--vv-top\) \+ var\(--safe-top\) \+ var\(--gap\)\)/);
  assert.match(html,/\.top-left\{grid-column:1;justify-self:start\}/);
  assert.match(html,/\.top-right\{grid-column:3;justify-self:end\}/);
  assert.match(html,/\.top-slot\{[\s\S]*?margin-top:0;transform:translateY\(var\(--top-side-offset\)\)/);
  assert.match(html,/\.top-center\{[\s\S]*?top:0;[\s\S]*?height:var\(--pill-h\)/);
});

test('UI preserves compact portrait contract, unified chrome scale and anchored context menus',()=>{
  const html=read('index.html'),src=uiSource(),app=read('app.js');
  assert.match(html,/minimum-scale=1, maximum-scale=1, user-scalable=no/);
  assert.match(html,/\*\{box-sizing:border-box;scrollbar-width:none\}/);
  assert.match(html,/\*::-webkit-scrollbar\{width:0;height:0;display:none\}/);
  assert.match(html,/:where\(button,input,textarea,\[contenteditable="true"\]\):focus-visible/);
  assert.match(html,/@media \(orientation:landscape\),\(min-width:760px\)/);
  assert.match(html,/\.device-gate\{[\s\S]*?pointer-events:none/);
  const deviceGateBlock=html.slice(html.indexOf('.device-gate{'),html.indexOf('.device-gate-card{'));
  assert.doesNotMatch(deviceGateBlock,/inset:0/);
  assert.match(html,/id="deviceGate" role="status" aria-live="polite"/);
  assert.doesNotMatch(html,/id="deviceGate"[^>]*aria-modal=/);
  assert.match(html,/Você pode continuar nesta tela\./);
  assert.match(html,/const telegramMiniApp=Boolean\(window\.Telegram\?\.WebApp\?\.initData\)/);
  assert.match(html,/const initialDeviceNotice=!telegramMiniApp&&\(matchMedia\('\(orientation:landscape\)'\)\.matches\|\|matchMedia\('\(min-width:760px\)'\)\.matches\)/);
  assert.match(html,/root\.setAttribute\('data-device-gate',''\)/);
  assert.match(html,/setTimeout\(\(\)=>root\.removeAttribute\('data-device-gate'\),4300\)/);
  assert.match(html,/@keyframes device-gate-out\{to\{opacity:0;visibility:hidden\}\}/);
  assert.doesNotMatch(html,/@media \(orientation:landscape\),\(min-width:760px\)\{\s*\.device-gate\{display:/);
  assert.match(html,/--control-size:clamp\(36px,10vw,40px\)/);
  assert.doesNotMatch(html,/--theme-control-size:/);
  assert.doesNotMatch(html,/--theme-icon-size:/);
  assert.match(html,/--menu-w:210px/);
  assert.match(html,/--menu-row-h:24px/);
  assert.match(html,/\.fade-top\{[\s\S]*?height:calc\(var\(--head-inset\) \+ 50px\);[\s\S]*?linear-gradient\(180deg,var\(--bg\) 0,var\(--bg\) calc\(var\(--safe-top\) \+ var\(--gap\)\)[\s\S]*?var\(--bg\) 60%,transparent\) 52%[\s\S]*?var\(--bg\) 26%,transparent\) 76%[\s\S]*?transparent 100%/);
  assert.match(html,/\.fade-bot\{[\s\S]*?bottom:calc\(var\(--vv-bottom\) \+ var\(--safe-bottom\) - var\(--safe-bottom-max\)\);[\s\S]*?height:calc\(var\(--foot-inset\) \+ 50px \+ var\(--safe-bottom-max\)\);[\s\S]*?linear-gradient\(0deg,var\(--bg\) 0,var\(--bg\) calc\(var\(--safe-bottom-max\) \+ var\(--gap\)\)[\s\S]*?var\(--bg\) 60%,transparent\) 52%[\s\S]*?var\(--bg\) 26%,transparent\) 76%[\s\S]*?transparent 100%/);
  assert.match(html,/\.bar > button\.more\{color:#fff;background:var\(--accent\);box-shadow:0 4px 20px color-mix\(in oklab,var\(--accent\) 70%,transparent\)\}/);
  assert.match(src,/className="theme-switch" id="themeBtn"/);
  assert.match(src,/<span className="app-title">MDTXTRT<\/span>/);
  assert.match(src,/id="plusBtn"[\s\S]*popoverTarget="plusMenu"/);
  const typebar=src.slice(src.indexOf('<GlassControl className="bar"'),src.indexOf('</GlassControl>',src.indexOf('<GlassControl className="bar"')));
  assert.ok(typebar.indexOf('id="plusBtn"')<typebar.indexOf('data-cmd="bold"'));
  for(const pair of [['headingMenu','headingBtn'],['listMenu','listBtn'],['quoteMenu','quoteBtn'],['plusMenu','plusBtn'],['exportMenu','exportBtn']]){
    assert.match(src,new RegExp('id="'+pair[0]+'"[^>]*anchorId="'+pair[1]+'"'));
  }
  assert.match(app,/function placePanel\(panel,anchorRect=null\)/);
  assert.match(app,/panel\.style\.setProperty\('--menu-left'/);
  assert.match(src,/id="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(src,/id="dialogMenu"[\s\S]*?popover="manual"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
});

test('link control exposes the three destination-aware choices in an anchored menu',()=>{
  const src=uiSource();
  assert.match(src,/function LinkMenu\(\)/);
  assert.match(src,/id="linkMenu" anchorId="linkBtn" placement="top"/);
  assert.match(src,/data-link-kind="hyperlink">Hiperlink/);
  assert.match(src,/data-link-kind="url">Link/);
  assert.match(src,/data-link-kind="button" data-telegram-only="">Botão com link/);
});

test('plus menu keeps normative compact geometry and opens categorized submenus over the leftmost trigger',()=>{
  const html=read('index.html'),src=uiSource(),app=read('app.js');
  assert.match(src,/const plusSections = \[/);
  for(const id of ['file','format','structure','media','interaction']) assert.match(src,new RegExp('id: "'+id+'"'));
  assert.ok(src.includes('id={`plus-${section.id}-menu`}'));
  assert.match(src,/data-plus-category=\{section\.id\}/);
  assert.match(src,/data-plus-submenu=\{section\.id\}/);
  assert.match(src,/Icon name="chevron_right"/);
  assert.match(src,/icon="arrow_back"/);
  assert.match(src,/anchorId="plusBtn" placement="top"/);
  assert.match(app,/const plusSubmenus=\['#plus-file-menu','#plus-format-menu','#plus-structure-menu','#plus-media-menu','#plus-interaction-menu'\]/);
  assert.match(app,/function openPlusSubmenu\(key\)/);
  assert.match(app,/function openPlusRoot\(\)/);
  assert.match(app,/plusSubmenus\.some\(sel=>one\(sel\)\.matches\(':popover-open'\)\)/);
  assert.match(html,/--menu-w:210px/);
  assert.match(html,/--menu-row-h:24px/);
  assert.match(html,/--menu-radius:9px/);
  assert.match(html,/\.menu-label\{flex:1/);
  assert.match(html,/\.plus-submenu \.submenu-back\{font-weight:650\}/);
});


test('shell owns a global virtual-keyboard retention policy without modifying generated UI bundles',()=>{
  const html=read('index.html');
  assert.match(html,/const keyboardOpen=\(\)=>\{/);
  assert.match(html,/root\.hasAttribute\('data-keyboard'\)/);
  assert.match(html,/document\.addEventListener\('pointerdown',preservePointer,true\)/);
  assert.match(html,/document\.addEventListener\('mousedown',preservePointer,true\)/);
  assert.match(html,/if\(theme&&keyboardOpen\(\)\)[\s\S]*?applyThemeWithoutReload\(\)/);
  assert.match(html,/if\(!keyboardOpen\(\)\)return;[\s\S]*?event\.preventDefault\(\)/);
});

test('document name lives in export flow and becomes the Telegraph editorial title',()=>{
  const html=read('index.html'),src=uiSource(),app=read('app.js');
  assert.match(html,/class="telegraph-title" id="telegraphTitleSlot" hidden/);
  assert.match(html,/\.telegraph-title \.document-tools input\{[\s\S]*?Georgia,"Times New Roman",serif/);
  assert.match(html,/slot\.append\(tools\)/);
  assert.match(html,/exportHost\.insertBefore\(tools,exportAnchor\)/);
  assert.match(html,/#exportMenu \.glass-menu-content/);
  assert.match(html,/new MutationObserver\(sync\)\.observe\(destBtn,\{attributes:true,attributeFilter:\['aria-pressed'\]\}\)/);
  assert.match(src,/className="tools document-tools"/);
  assert.doesNotMatch(html,/id="telegraphTitle"/);
  assert.doesNotMatch(app,/telegraphTitle|setDocumentName/);
});

test('Glass wrappers keep chrome controls horizontal instead of package inline-block stacking',()=>{
  const src=uiSource(),html=read('index.html');
  assert.match(src,/function GlassControl\(\{ className = "", children, style, \.\.\.props \}\)/);
  assert.match(src,/style=\{\{ display: "flex", alignItems: "center", \.\.\.style \}\}/);
  assert.match(html,/\.seg\{display:flex;align-items:center/);
  assert.match(html,/\.bar\{[\s\S]*?display:flex;align-items:center/);
  assert.equal((html.match(/--accent:#2B88D8;/g)||[]).length,2);
});

test('Telegram Mini App validates orientation from stable Telegram viewport geometry',()=>{
  const app=read('app.js');
  assert.match(app,/telegramPhonePlatforms=new Set\(\['android','ios'\]\)/);
  assert.match(app,/function telegramViewportIsStable\(tg=getTg\(\)\)/);
  assert.match(app,/function telegramStableViewportIsPortrait\(tg=getTg\(\)\)/);
  assert.match(app,/tg\?\.viewportStableHeight/);
  assert.match(app,/window\.visualViewport\?\.width/);
  assert.match(app,/return stableHeight>=viewportWidth/);
  assert.match(app,/telegramViewportEventSeen=true/);
  assert.match(app,/event\?\.isStateStable!==true/);
  assert.match(app,/tg\.onEvent\('viewportChanged',handleTelegramViewportChange\)/);
  assert.match(app,/!telegramViewportEventSeen&&telegramViewportIsStable\(tg\)/);
  assert.match(app,/const portrait=telegramStableViewportIsPortrait\(tg\)/);
  assert.match(app,/if\(!portrait\)\{setDeviceGate\('portrait'\);return;\}/);
  assert.match(app,/if\(!tg\.isOrientationLocked\)tg\.lockOrientation\(\)/);
  assert.doesNotMatch(app,/if\(!portraitQuery\.matches\)\{setDeviceGate\('portrait'\)/);
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

test('execution toolchain is pinned and CI verifies committed browser bundles without mutating main',()=>{
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
  assert.match(workflow,/name: Rebuild transactional editor bundle[\s\S]*?npm run build:editor/);
  assert.match(workflow,/name: Verify transactional editor bundle[\s\S]*?git diff --exit-code -- editor-core\.js/);
  assert.match(workflow,/name: Detect React UI bundle input changes[\s\S]*?src\/liquid-glass-ui\.jsx package\.json package-lock\.json/);
  assert.match(workflow,/name: Rebuild React UI bundle[\s\S]*?steps\.ui_inputs\.outputs\.changed == 'true'[\s\S]*?npm run build:ui/);
  assert.match(workflow,/name: Verify React UI bundle[\s\S]*?git diff --exit-code -- ui\.js/);
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


test('step 6 semantics and documentation preserve the pinned visual baseline',()=>{
  const app=read('app.js'),server=read('server.mjs'),architecture=read('ARCHITECTURE.md'),drafts=read('LOCAL_DRAFTS.md'),baseline=read('BASELINE.md');
  assert.match(app,/const DRAFT_ARCHIVE_PREFIX='rmdtxtml-document:'/);
  assert.match(app,/function archiveStoredDraftForNew\(token\)/);
  assert.match(app,/openPanel\('#exportMenu'\)/);
  assert.doesNotMatch(app,/if\(session==='ready'\)return publishCurrent\(\)/);
  assert.match(app,/Abrir opções de publicação e exportação/);
  assert.match(app,/Alternar destino\. Atual:/);
  assert.match(server,/function documentLaunchURL\(base,newToken=""\)/);
  assert.match(server,/command === "novo"[\s\S]*?randomUUID\(\)\.replace\(\/-\/g,""\)/);
  assert.match(architecture,/Transactional editor boundary/);
  assert.match(architecture,/Browser → Mini App handoff/);
  assert.match(architecture,/Durable document provenance boundary/);
  assert.match(drafts,/one \*\*active draft slot\*\*/);
  assert.match(drafts,/not a synchronized document database or a durable provenance ledger/);
  assert.match(baseline,/dde30467ed9b0d108bac2ae7ad9bcac1137c169e/);
});

test('step 4 format contract is explicit and conversion code uses the shared portable boundary',()=>{
  const app=read('app.js'),contract=read('FORMAT_CONTRACT.md');
  assert.match(app,/const FORMAT_CONTRACT=Object\.freeze/);
  assert.match(app,/function normalizePortableHTML\(root,label='conteúdo'\)/);
  assert.match(app,/function exportDocumentHTML\(\)\{[\s\S]*?editorCore\?editorCore\.html\(\):editor\.innerHTML/);
  assert.match(app,/svc\.addRule\('strikethrough'/);
  assert.doesNotMatch(app,/if\(importedMd && editor\.innerHTML === importedHtml\) return importedMd/);
  assert.doesNotMatch(app,/if\(importedTxt && editor\.innerHTML===importedHtml\)return importedTxt/);
  assert.match(contract,/## File matrix/);
  assert.match(contract,/## Destination matrix/);
  assert.match(contract,/Markdown export always serializes the current edited document/);
  assert.match(contract,/Returning an untouched original file is not sufficient evidence/);
});


test('step 5 overlays use the visual viewport without changing the baseline material contract',()=>{
  const html=read('index.html'),app=read('app.js'),src=uiSource();
  assert.match(html,/max-height:var\(--menu-max-height,min\(55vh,420px\)\)/);
  assert.match(html,/width:min\(var\(--menu-w\),var\(--menu-max-width,calc\(100vw - 16px\)\)\)/);
  assert.match(html,/\.menu-list\{[\s\S]*?flex:1 1 auto[\s\S]*?max-height:none[\s\S]*?overflow-y:auto/);
  assert.match(html,/\.dialog\{[\s\S]*?max-height:100%[\s\S]*?overflow-y:auto/);
  assert.match(html,/#dialogMenu:popover-open::backdrop\{background:transparent;pointer-events:auto\}/);
  assert.match(app,/function visualViewportBounds\(\)/);
  assert.match(app,/function placePanel\(panel,anchorRect=null\)[\s\S]*?--menu-max-height[\s\S]*?--menu-max-width/);
  assert.match(app,/openPanel\('#findMenu',anchor\)/);
  assert.match(app,/const anchor=one\('#plusBtn'\)/);
  assert.match(app,/function setDialogModality\(active\)[\s\S]*?setAttribute\('inert',''\)/);
  assert.match(app,/one\('#dialogMenu'\)\.addEventListener\('keydown'[\s\S]*?event\.key!=='Tab'/);
  assert.match(app,/if\(dialog\?\.matches\(':popover-open'\)\)placePanel\(dialog\)/);
  assert.match(src,/id="dialogMenu"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(html,/--menu-w:210px/);
  assert.match(html,/--menu-row-h:24px/);
  assert.match(html,/--menu-radius:9px/);
  assert.match(html,/\.glass-menu-material,\.toast-material\{background:var\(--glass-tint\)\}/);
});


test('final release gap analysis and immutable anchor gates are explicit',()=>{
  for(const file of ['GAP_ANALYSIS.md','RELEASE_VALIDATION.md','RELEASE_EVIDENCE_TEMPLATE.md','RELEASE_ANCHOR.md','RELEASE_MANIFEST.json','.github/workflows/release-validation.yml','scripts/verify-release-manifest.mjs','scripts/verify-visual-baseline.mjs','scripts/validate-release-evidence.mjs']){
    assert.ok(existsSync(new URL('../'+file,import.meta.url)),file);
  }
  const workflow=read('.github/workflows/release-validation.yml');
  const gap=read('GAP_ANALYSIS.md');
  const validation=read('RELEASE_VALIDATION.md');
  const anchor=read('RELEASE_ANCHOR.md');
  const manifest=JSON.parse(read('RELEASE_MANIFEST.json'));

  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/RELEASE_CANDIDATE_SHA: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.equal((workflow.match(/ref: \$\{\{ env\.RELEASE_CANDIDATE_SHA \}\}/g)||[]).length,2);
  assert.equal((workflow.match(/name: Verify exact candidate checkout/g)||[]).length,2);
  assert.match(workflow,/git rev-parse HEAD[\s\S]*?RELEASE_CANDIDATE_SHA/);
  assert.match(workflow,/name: Rebuild all committed bundles[\s\S]*?npm run build/);
  assert.match(workflow,/git diff --exit-code -- editor-core\.js ui\.js/);
  assert.match(workflow,/node scripts\/verify-release-manifest\.mjs/);
  assert.match(workflow,/node scripts\/verify-visual-baseline\.mjs/);
  assert.match(workflow,/release-rebuilt-bundles-\$\{\{ env\.RELEASE_CANDIDATE_SHA \}\}/);
  assert.match(workflow,/release-visual-baseline-\$\{\{ env\.RELEASE_CANDIDATE_SHA \}\}/);
  assert.match(workflow,/include-hidden-files: true/);
  assert.match(workflow,/if-no-files-found: error/);
  assert.match(workflow,/name: Audit release evidence record[\s\S]*?GITHUB_TOKEN:[\s\S]*?node scripts\/validate-release-evidence\.mjs/);
  assert.doesNotMatch(workflow,/contents:\s*write|git push/);

  assert.match(read('scripts/verify-visual-baseline.mjs'),/for\(const theme of \['light','dark'\]\)/);
  assert.match(read('scripts/validate-release-evidence.mjs'),/Final status[\s\S]*?RELEASE APPROVED/);
  assert.match(read('scripts/validate-release-evidence.mjs'),/iOS Telegram Mini App/);
  assert.match(read('scripts/validate-release-evidence.mjs'),/Telegram unknown timeout/);

  assert.equal(manifest.visualBaseline,'dde30467ed9b0d108bac2ae7ad9bcac1137c169e');
  assert.deepEqual(manifest.runtime,{node:'24.21.0',npm:'11.19.0'});
  assert.equal(manifest.stages.length,6);
  assert.equal(manifest.stages.at(-1).head,'e20d115b18424ab5c9abfa7e175b5376fe0633fb');
  assert.equal(manifest.anchorPolicy.authority,'full-git-commit-sha');
  assert.equal(manifest.anchorPolicy.immutable,true);

  assert.match(gap,/G-05 — No real Telegraph create\/recover\/edit\/restart evidence/);
  assert.match(gap,/G-13 — Pull-request validation did not prove the exact anchor SHA/);
  assert.match(gap,/G-14 — Visual comparison evidence was not retained/);
  assert.match(gap,/\*\*Status:\*\* BLOCKING until real authorized evidence exists/);
  assert.match(validation,/Release status is one of:/);
  assert.match(validation,/RELEASE APPROVED/);
  assert.match(validation,/synthetic pull-request merge ref/);
  assert.match(validation,/release-visual-baseline-<anchor-sha>/);
  assert.match(anchor,/full commit SHA is the canonical authority/i);
  assert.match(anchor,/superseding Release Anchor/);
});
