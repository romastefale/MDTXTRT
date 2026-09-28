import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
const uiSource=()=>read('src/liquid-glass-ui.jsx');

test('application controller parses and canonical React bundle is committed',()=>{
  assert.doesNotThrow(()=>new vm.Script(read('app.js'),{filename:'app.js'}));
  assert.ok(existsSync(new URL('../ui.js',import.meta.url)));
  assert.equal(existsSync(new URL('../glass.js',import.meta.url)),false);
});

test('ui.js cache buster follows the committed Git blob SHA',()=>{
  const html=read('index.html'),ui=readFileSync(new URL('../ui.js',import.meta.url));
  const sha=createHash('sha1').update(Buffer.from('blob '+ui.length+'\0')).update(ui).digest('hex').slice(0,12);
  assert.match(html,new RegExp('ui\\.js\\?v='+sha));
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
  assert.match(src,/<Glass[\s\S]*?optics=\{MENU_LENS\}[\s\S]*?className="glass-menu-material"/);
  assert.match(src,/const BAR_LENS = \{[\s\S]*?light: \{[\s\S]*?brightness: 0\.34,[\s\S]*?specular: 0\.68,[\s\S]*?sheen: 0\.3,[\s\S]*?dark: \{[\s\S]*?brightness: 0\.2,[\s\S]*?specular: 0\.5,[\s\S]*?sheen: 0\.22,[\s\S]*?readTheme\(\)[\s\S]*?subscribe\(onStoreChange\)[\s\S]*?serverTheme\(\)/);
  assert.doesNotMatch(src,/const BAR_LENS = \{[\s\S]*?\.\.\.MENU_LENS/);
  assert.match(src,/function GlassControl[\s\S]*?React\.useSyncExternalStore\([\s\S]*?BAR_LENS\.subscribe,[\s\S]*?BAR_LENS\.readTheme,[\s\S]*?BAR_LENS\.serverTheme,[\s\S]*?<Glass[\s\S]*?optics=\{BAR_LENS\[theme\]\}/);
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
  assert.match(html,/--bar-glass-tint:color-mix\(in oklab,var\(--accent\) 20%,transparent\);/);
  assert.match(html,/--bar-glass-tint-strong:color-mix\(in oklab,var\(--accent\) 28%,transparent\);/);
  assert.match(html,/--bar-control-accent-bg:color-mix\(in oklab,var\(--accent\) 26%,transparent\);/);
  assert.match(html,/html\.light\{[\s\S]*?--bar-glass-tint:color-mix\(in oklab,var\(--accent\) 16%,transparent\);/);
  assert.match(html,/html\.light\{[\s\S]*?--bar-glass-tint-strong:color-mix\(in oklab,var\(--accent\) 23%,transparent\);/);
  assert.match(html,/html\.light\{[\s\S]*?--bar-control-accent-bg:color-mix\(in oklab,var\(--accent\) 20%,transparent\);/);
  assert.doesNotMatch(html,/--bar-(?:glass-tint|glass-tint-strong|control-accent-bg):[^;]*rgba\(/);
  assert.match(html,/\.seg,\.bar,\.theme-control\{[^}]*background:var\(--bar-glass-tint\)/);
  assert.match(html,/\.glass-menu-material,\.toast-material\{background:var\(--glass-tint\)\}/);
  assert.match(html,/box-shadow:inset 0 0 0 \.5px var\(--glass-inner\),0 0 0 \.5px var\(--glass-edge\)/);
  assert.match(html,/\.menu-divider::after\{[^}]*background:var\(--glass-edge\)\}/);
  assert.match(html,/\.menu-list > button:hover,\.menu-list > button:focus-visible\{background:var\(--accent\);color:#fff\}/);
  assert.match(html,/\.dialog-actions #dialogOk\{background:var\(--accent\);color:#fff\}/);
  assert.match(html,/html\.dark\{--accent:#2B88D8;color-scheme:dark\}/);
  assert.doesNotMatch(html,/html\.dark\{[^}]*--muted:/);
});

test('editor uses incremental Markdown input rules without replacing the rich-text model',()=>{
  const app=read('app.js');
  for(const fragment of [
    'function markdownBlockRule()',
    'const heading=text.match(/^(#{1,6}) (?=\\S)/);',
    "const quote=text.match(/^> (?=\\S)/);",
    "const bullet=text.match(/^[-*+] (?=\\S)/);",
    'const ordered=text.match(/^(\\d+)\\. (?=\\S)/);',
    "dest==='telegram'&&text.match(/^- \\[([ xX])\\] (?=\\S)/)",
    'function exitFormattedBlockOnParagraph(event)',
    "editor.addEventListener('beforeinput',exitFormattedBlockOnParagraph);",
    'function normalizeEmptyFormattedBlock(event)',
    'function syncEditorSelectionUI()',
    "btn.setAttribute('aria-pressed',String(on));",
    "markdownInlineWrap(text,offset,'**','strong')",
    "markdownInlineWrap(text,offset,'~~','s')",
    "markdownInlineWrap(text,offset,'`','code')",
    "markdownInlineWrap(text,offset,'*','em',{single:true})"
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

test('editor content starts below the lowered side pills without bypassing Telegram safe-area tokens',()=>{
  const html=read('index.html');
  assert.match(html,/html\.tg-shell\{[\s\S]*?--safe-top:max\(var\(--app-tg-safe-top\),var\(--app-tg-content-safe-top\)\)/);
  assert.match(html,/\.topbar\{[\s\S]*?top:calc\(var\(--vv-top\) \+ var\(--safe-top\) \+ var\(--gap\)\)/);
  assert.match(html,/\.top-slot\{[\s\S]*?margin-top:var\(--top-side-offset\)/);
  assert.match(html,/\.scroll\{[\s\S]*?padding-top:var\(--head-inset\)/);
});

test('Telegram Mini App safe areas are sourced from WebApp fields and updated by official events',()=>{
  const html=read('index.html'),app=read('app.js');
  assert.match(html,/html\.tg-shell\{[\s\S]*?--safe-top:max\(var\(--app-tg-safe-top\),var\(--app-tg-content-safe-top\)\)/);
  assert.match(app,/function syncTelegramSafeAreas\(\)/);
  assert.match(app,/tg\.safeAreaInset/);
  assert.match(app,/tg\.contentSafeAreaInset/);
  assert.match(app,/root\.style\.setProperty\('--app-tg-safe-'\+field/);
  assert.match(app,/root\.style\.setProperty\('--app-tg-content-safe-'\+field/);
  assert.match(app,/tg\.onEvent\('safeAreaChanged',handleTelegramSafeAreaChange\)/);
  assert.match(app,/tg\.onEvent\('contentSafeAreaChanged',handleTelegramSafeAreaChange\)/);
  assert.match(app,/tg\.isVersionAtLeast\('8\.0'\)/);
  assert.match(app,/!syncTelegramSafeAreas\(\)/);
});

test('chrome circles share one control diameter and dark icons retain contrast',()=>{
  const html=read('index.html');
  assert.match(html,/html\.dark \.seg,html\.dark \.bar,html\.dark \.theme-control\{color:#f5f5f7\}/);
  assert.match(html,/\.seg button\{[\s\S]*?width:var\(--control-size\);height:var\(--control-size\)/);
  assert.match(html,/\.bar > button\{[\s\S]*?flex:0 0 var\(--control-size\);width:var\(--control-size\);min-width:var\(--control-size\);height:var\(--control-size\)/);
  assert.match(html,/\.action-dot\{[\s\S]*?width:var\(--control-size\);height:var\(--control-size\)/);
  assert.match(html,/\.seg \.action-dot\{width:var\(--control-size\);height:var\(--control-size\)\}/);
  assert.match(html,/\.bar > button\.more\{color:#fff;background:var\(--accent\);box-shadow:0 4px 14px color-mix\(in oklab,var\(--accent\) 45%,transparent\)\}/);
  assert.match(html,/\.bar > button\.on::before\{[\s\S]*?inset:0;border-radius:50%/);
  assert.doesNotMatch(html,/\.action-dot\{[\s\S]*?control-size\) - 6px/);
});

test('theme switch keeps a deliberate sixty-percent visual scale across access modes',()=>{
  const html=read('index.html');
  assert.match(html,/--control-size:clamp\(36px,10vw,40px\)/);
  assert.match(html,/--theme-control-size:clamp\(21\.6px,6vw,24px\)/);
  assert.match(html,/--theme-icon-size:clamp\(10\.8px,3vw,12px\)/);
  assert.match(html,/\.theme-control\{width:var\(--theme-control-size\);height:var\(--theme-control-size\)\}/);
  assert.match(html,/\.theme-control button\{[\s\S]*?width:var\(--theme-control-size\);height:var\(--theme-control-size\)/);
  assert.match(html,/\.theme-control \.ui-icon\{width:var\(--theme-icon-size\);height:var\(--theme-icon-size\)\}/);
});

test('top chrome keeps lateral pills below the centered title and inside Telegram safe areas',()=>{
  const html=read('index.html');
  assert.match(html,/--top-side-offset:12px/);
  assert.match(html,/--editor-top-gap:8px/);
  assert.match(html,/--topbar-h:calc\(var\(--pill-h\) \+ var\(--top-side-offset\)\)/);
  assert.match(html,/--head-inset:calc\(var\(--safe-top\) \+ var\(--gap\) \+ var\(--topbar-h\) \+ var\(--editor-top-gap\) \+ var\(--gap\)\)/);
  assert.match(html,/html\.tg-shell\{[\s\S]*?--safe-top:max\(var\(--app-tg-safe-top\),var\(--app-tg-content-safe-top\)\)/);
  assert.match(html,/\.topbar\{[\s\S]*?top:calc\(var\(--vv-top\) \+ var\(--safe-top\) \+ var\(--gap\)\)/);
  assert.match(html,/\.top-left\{grid-column:1;justify-self:start\}/);
  assert.match(html,/\.top-right\{grid-column:3;justify-self:end\}/);
  assert.match(html,/\.top-slot\{[\s\S]*?margin-top:var\(--top-side-offset\)/);
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
  assert.doesNotMatch(html,/\.device-gate\{[\s\S]*?inset:0/);
  assert.match(html,/id="deviceGate" role="status" aria-live="polite"/);
  assert.doesNotMatch(html,/id="deviceGate"[^>]*aria-modal=/);
  assert.match(html,/Você pode continuar nesta tela\./);
  assert.match(html,/const initialDeviceNotice=matchMedia\('\(orientation:landscape\)'\)\.matches\|\|matchMedia\('\(min-width:760px\)'\)\.matches/);
  assert.match(html,/root\.setAttribute\('data-device-gate',''\)/);
  assert.match(html,/setTimeout\(\(\)=>root\.removeAttribute\('data-device-gate'\),4300\)/);
  assert.match(html,/@keyframes device-gate-out\{to\{opacity:0;visibility:hidden\}\}/);
  assert.doesNotMatch(html,/@media \(orientation:landscape\),\(min-width:760px\)\{\s*\.device-gate\{display:/);
  assert.match(html,/--control-size:clamp\(36px,10vw,40px\)/);
  assert.match(html,/--theme-control-size:clamp\(21\.6px,6vw,24px\)/);
  assert.match(html,/--theme-icon-size:clamp\(10\.8px,3vw,12px\)/);
  assert.match(html,/--menu-w:210px/);
  assert.match(html,/--menu-row-h:24px/);
  assert.match(html,/\.fade-top\{[\s\S]*?height:calc\(var\(--head-inset\) \+ 20px\);[\s\S]*?var\(--bg\) 86%,transparent[\s\S]*?var\(--bg\) 60%,transparent\) 52%[\s\S]*?var\(--bg\) 26%,transparent\) 76%[\s\S]*?transparent 100%/);
  assert.match(html,/\.fade-bot\{[\s\S]*?height:calc\(var\(--foot-inset\) \+ 20px\);[\s\S]*?var\(--bg\) 86%,transparent[\s\S]*?var\(--bg\) 60%,transparent\) 52%[\s\S]*?var\(--bg\) 26%,transparent\) 76%[\s\S]*?transparent 100%/);
  assert.match(html,/\.bar > button\.more\{color:var\(--accent\);background:var\(--bar-control-accent-bg\)\}/);
  assert.match(src,/className="app-title"[^>]*>MDTXTRT<\/span>/);
  assert.match(src,/id="themeBtn"/);
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
