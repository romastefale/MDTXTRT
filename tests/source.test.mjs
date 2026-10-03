import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
// A interface React: ponto de entrada, componentes e estado dos menus.
// O servidor: entrada (server.mjs) e módulos em server/.
const serverSource=()=>['server.mjs',...readdirSync(new URL('server/',root)).filter(name=>name.endsWith('.mjs')).sort().map(name=>'server/'+name)].map(read).join('\n');
// O editor: módulos em src/app/ (antes app.js).
const appSource=()=>readdirSync(new URL('src/app/',root)).filter(name=>name.endsWith('.js')).sort().map(name=>read('src/app/'+name)).join('\n');
const uiSource=()=>['src/liquid-glass-ui.jsx','src/chrome.jsx','src/ui-store.mjs'].map(read).join('\n');
// A página é o HTML mais a folha de estilos que ele carrega.
const page=()=>read('index.html')+'\n'+read('styles.css');

test('application controller parses and committed browser bundles are present',()=>{
  for(const name of readdirSync(new URL('src/app/',root)).filter(name=>name.endsWith('.js')))assert.doesNotThrow(()=>transformSync(read('src/app/'+name),{format:'esm',loader:'js',sourcefile:name}),name);
  assert.ok(existsSync(new URL('../ui.js',import.meta.url)));
  assert.ok(existsSync(new URL('../editor-core.js',import.meta.url)));
  assert.equal(existsSync(new URL('../glass.js',import.meta.url)),false);
});

test('browser bundle cache busters follow the committed Git blob SHAs',()=>{
  const html=page();
  for(const file of ['ui.js','editor-core.js','styles.css']){
    const bytes=readFileSync(new URL('../'+file,import.meta.url));
    const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex').slice(0,12);
    assert.ok(html.includes(file+'?v='+sha),file+' cache buster must match committed blob');
  }
});

// O esbuild grava no bundle o caminho de cada módulo relativo ao projeto. Um
// node_modules fora do clone (link simbólico) muda esses caminhos e o bundle deixa
// de ser o mesmo que o CI reconstrói com npm ci.
test('committed bundles reference modules only inside the project',()=>{
  for(const file of ['ui.js','editor-core.js']){
    const bundle=read(file);
    assert.doesNotMatch(bundle,/__commonJS\(\{"(?:\.\.\/|\/)/,file+' must be built from the clone\'s own node_modules');
    assert.doesNotMatch(bundle,/\/(?:home|workspace|Users|tmp)\//,file+' must not embed absolute build paths');
  }
});

test('official Liquid Glass React dependencies and deterministic build are pinned',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  const glassSpec=pkg.devDependencies['@samasante/liquid-glass'];
  assert.match(glassSpec,/^github:romastefale\/liquid-glass#[0-9a-f]{40}$/,'Liquid Glass must come from the romastefale fork pinned by commit');
  assert.equal(pkg.devDependencies.react,'19.3.0');
  assert.equal(pkg.devDependencies['react-dom'],'19.3.0');
  assert.equal(pkg.devDependencies.esbuild,'0.28.2');
  assert.equal(pkg.scripts.build,'npm run build:editor && npm run build:ui');
  assert.match(pkg.scripts['build:ui'],/src\/liquid-glass-ui\.jsx/);
  assert.match(pkg.scripts['build:ui'],/--outfile=ui\.js/);
  assert.ok(pkg.scripts['build:ui'].includes("--define:process.env.NODE_ENV='\"production\"'"));
  assert.match(pkg.scripts['build:ui'],/(?:^|\s)--minify-syntax(?:\s|$)/);
  assert.match(pkg.scripts['build:ui'],/(?:^|\s)--minify-whitespace(?:\s|$)/);
  assert.doesNotMatch(pkg.scripts['build:ui'],/(?:^|\s)--minify(?:\s|$)|--minify-identifiers/);
  assert.match(pkg.scripts['build:editor'],/src\/editor-core\.mjs/);
  assert.match(pkg.scripts['build:editor'],/--outfile=editor-core\.js/);
  assert.ok(lock.packages['node_modules/@samasante/liquid-glass'].resolved.endsWith('romastefale/liquid-glass.git#'+glassSpec.split('#')[1]));
  assert.equal(lock.packages['node_modules/react'].version,'19.3.0');
  assert.equal(lock.packages['node_modules/react-dom'].version,'19.3.0');
});

test('editor core is native, modular and independent of third-party document engines',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  for(const name of Object.keys(pkg.dependencies||{}))assert.equal(name.startsWith('prosemirror-'),false);
  for(const name of Object.keys(lock.packages||{}))assert.equal(name.startsWith('node_modules/prosemirror-'),false);
  for(const file of ['src/editor-core.mjs','src/editor-selection.mjs','src/editor-history.mjs','src/editor-formatting.mjs','src/editor-structure.mjs','src/editor-search.mjs'])assert.ok(existsSync(new URL('../'+file,import.meta.url)));
  const core=read('src/editor-core.mjs');
  assert.match(core,/createFormatting/);
  assert.match(core,/createStructure/);
  assert.match(core,/createSearch/);
  assert.match(core,/createHistory/);
  assert.doesNotMatch(core,/prosemirror|EditorState|EditorView|new Schema/i);
});

test('React UX renders menus and chrome through the fork Glass primitive',()=>{
  const src=uiSource();
  assert.match(src,/import \{ Glass \} from "@samasante\/liquid-glass"/);
  assert.match(src,/function GlassContextMenu/);
});

test('MDTXTRT contains no bespoke Liquid Glass renderer or implicit browser fallback',()=>{
  const html=page(),src=uiSource(),server=serverSource();
  assert.match(html,/id="ux-root"/);
  assert.match(html,/<script type="module" src="ui\.js\?v=[a-f0-9]{12}"><\/script>/);
  assert.doesNotMatch(html,/glass\.js/);
  assert.doesNotMatch(html,/data-lg/);
  assert.doesNotMatch(html,/class="sheet/);
  assert.doesNotMatch(src,/feDisplacementMap|backdrop-filter|supportsRefraction|supportsBackdropUrl|navigator\.userAgent|WebKit|Blink|Gecko/);
  assert.doesNotMatch(server,/"glass\.js"/);
  assert.match(server,/"ui\.js"/);
});

test('editorial document typography uses the Telegraph serif family without changing app chrome',()=>{
  const html=page();
  assert.match(html,/\.editor\{[\s\S]*?font-family:Georgia,"Times New Roman",serif;/);
  assert.match(html,/\.editor h1,\.editor h2,\.editor h3,\.editor h4,\.editor h5,\.editor h6\{font-family:inherit;/);
  assert.match(html,/body\{[\s\S]*?font:16px\/1\.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif/);
  assert.match(html,/\.telegraph-title \.document-tools input\{[\s\S]*?Georgia,"Times New Roman",serif/);
});

test('theme switch owns browser and Telegram chrome without mixed system bars',()=>{
  const html=page(),src=uiSource(),app=appSource();
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
  assert.doesNotMatch(app,/function setTheme\(mode\)\{[\s\S]*?applyScheme\(mode\)/);
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
  const html=page(),src=uiSource();
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

test('editor publication controls contain no instructional fixture content',()=>{
  const app=appSource(),html=page();
  assert.match(app,/if\(kind==='expandquote'\)return formatBlock\('expandquote'\)/);
  assert.match(app,/if\(kind==='pullquote'\)return formatBlock\('pullquote'\)/);
  assert.doesNotMatch(app,/Citação expansível|Citação em destaque|Nova tarefa|Texto expansível|<th>A<\/th>|<td>—<\/td>/);
  assert.match(app,/<details open><summary><\/summary><p><\/p><\/details>/);
  assert.match(html,/\.editor blockquote\[expandable\]/);
  assert.match(html,/\.editor aside\{/);
  assert.match(html,/\.editor details\{/);
});

test('editor keeps destination validation and literal-search implementation separated',()=>{
  const app=appSource(),search=read('src/editor-search.mjs');
  assert.match(app,/a:\['href','name'\],code:\['class'\]/);
  assert.match(app,/\['http:','https:'\]/);
  assert.match(app,/\['http:','https:','mailto:','tel:','tg:'\]/);
  assert.match(app,/function activeMedia\(\)/);
  assert.match(app,/requireEditorCore\(\)\.patchMedia/);
  assert.doesNotMatch(app,/\bhistI\b|\bhistLock\b/);
  assert.doesNotMatch(app,/toast\.textContent\s*=/);
  assert.match(search,/function findLiteral\(term\)/);
  assert.match(search,/\.indexOf\(needle,at\)/);
  assert.doesNotMatch(search,/new RegExp\(term/);
});

test('server exposes every React-referenced local SVG icon and vector app icon',()=>{
  const src=uiSource(),server=serverSource();
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
  const html=page(),server=serverSource();
  const manifest=JSON.parse(read('manifest.webmanifest'));
  assert.match(html,/<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.equal(manifest.name,'MDTXTRT');
  assert.equal(manifest.short_name,'MDTXTRT');
  assert.equal(manifest.id,'./');
  assert.equal(manifest.start_url,'./');
  assert.equal(manifest.scope,'./');
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.theme_color,'#8b82e6');
  assert.equal(manifest.prefer_related_applications,false);
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'&&icon.src==='pwa-192.svg'&&icon.type==='image/svg+xml'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.src==='pwa-512.svg'&&icon.type==='image/svg+xml'));
  assert.match(server,/"\.webmanifest": "application\/manifest\+json; charset=utf-8"/);
  assert.match(server,/"manifest\.webmanifest"/);
  assert.match(server,/"pwa-192\.svg"/);
  assert.match(server,/"pwa-512\.svg"/);
  assert.doesNotMatch(html,/service-worker|serviceWorker/);
});

test('browser PWA uses platform safe areas while Telegram keeps its content safe area',()=>{
  const html=page(),app=appSource();
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/--safe-top:env\(safe-area-inset-top,0px\);[\s\S]*?--safe-bottom:env\(safe-area-inset-bottom,0px\);[\s\S]*?--safe-left:env\(safe-area-inset-left,0px\);[\s\S]*?--safe-right:env\(safe-area-inset-right,0px\);[\s\S]*?--safe-bottom-max:env\(safe-area-max-inset-bottom,36px\);/);
  assert.match(html,/html\.tg-shell\{[\s\S]*?--safe-top:var\(--app-tg-content-safe-top\);[\s\S]*?--safe-bottom:var\(--app-tg-content-safe-bottom\);[\s\S]*?--safe-left:var\(--app-tg-content-safe-left\);[\s\S]*?--safe-right:var\(--app-tg-content-safe-right\);[\s\S]*?--safe-bottom-max:0px/);
  assert.match(app,/function syncTelegramSafeAreas\(\)/);
  assert.match(app,/tg\?\.safeAreaInset/);
  assert.match(app,/tg\.contentSafeAreaInset/);
  assert.match(app,/--app-tg-safe-/);
  assert.match(app,/root\.style\.setProperty\('--app-tg-content-safe-'\+field/);
  assert.match(app,/tg\.onEvent\('safeAreaChanged',syncTelegramSafeAreas\)/);
  assert.match(app,/tg\.onEvent\('contentSafeAreaChanged',syncTelegramSafeAreas\)/);
  assert.match(app,/tg\.isVersionAtLeast\('8\.0'\)/);
  assert.doesNotMatch(app,/setDeviceGate\(/);
});

test('UI keeps zoom locked and context menus anchored to their triggers',()=>{
  const html=page(),src=uiSource(),app=appSource();
  assert.match(html,/minimum-scale=1, maximum-scale=1, user-scalable=no/);
  assert.match(src,/className="theme-switch" id="themeBtn"/);
  assert.match(src,/<span className="app-title">MDTXTRT<\/span>/);
  assert.match(src,/id="plusBtn"[\s\S]*aria-haspopup="menu"/);
  assert.doesNotMatch(src,/popoverTarget=/);
  const typebar=src.slice(src.indexOf('<GlassControl className="bar"'),src.indexOf('</GlassControl>',src.indexOf('<GlassControl className="bar"')));
  assert.ok(typebar.indexOf('<PlusButton />')>=0);
  assert.ok(typebar.indexOf('<PlusButton />')<typebar.indexOf('data-cmd="bold"'));
  for(const pair of [['headingMenu','headingBtn'],['listMenu','listBtn'],['quoteMenu','quoteBtn'],['plusMenu','plusBtn'],['exportMenu','exportBtn']]){
    assert.match(src,new RegExp('id="'+pair[0]+'"[^>]*anchorId="'+pair[1]+'"'));
  }
  assert.match(app,/function placePanel\(panel,anchorRect=null\)/);
  assert.match(app,/ui\.setMenu\(id,\{left,top:clamp\(proposed,minTop,maxTop\)\}\)/);
  assert.match(src,/style\["--menu-left"\] = px\(menu\.left\)/);
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

test('plus menu opens categorized submenus over its trigger',()=>{
  const html=page(),src=uiSource(),app=appSource();
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
  assert.match(src,/const plusOpen = useUI\([\s\S]*?id === "plusMenu" \|\| id\.startsWith\("plus-"\)/);
  assert.match(src,/className=\{plusOpen \? "more on" : "more"\} id="plusBtn"/);
});

test('editorial pointer retention has one owner and standard menus never depend on native popover focus',()=>{
  const html=page(),app=appSource(),src=uiSource();
  assert.doesNotMatch(html,/keyboardPolicyReady|applyThemeWithoutReload|interactionFocus/);
  assert.match(app,/function isTypingEntry\(element\)[\s\S]*?\[contenteditable="true"\]/);
  assert.match(app,/function typingFocusActive\(outsidePanel=null\)[\s\S]*?isTypingEntry\(active\)&&\(!outsidePanel\|\|!outsidePanel\.contains\(active\)\)/);
  assert.match(app,/function focusMenuControl\(element,outsidePanel=null\)[\s\S]*?if\(typingFocusActive\(outsidePanel\)\)return false;[\s\S]*?focusControl\(element\)/);
  assert.doesNotMatch(app,/retainedTouch|touchActivating|gesture\.target\.click\(\)/);
  assert.doesNotMatch(app,/document\.addEventListener\('touchstart'|document\.addEventListener\('touchend'/);
  assert.match(app,/function panelIsOpen\(panel\)[\s\S]*?ui\.menu\(panel\.id\)\.open/);
  assert.match(app,/function openPanel\(sel,anchorOverride=null\)[\s\S]*?ui\.setMenu\(panel\.id,\{open:true,anchor:anchor\?\.id\|\|null\}\)/);
  assert.match(app,/function closePanel\(panel,returnFocus=false\)[\s\S]*?ui\.setMenu\(panel\.id,\{open:false\}\)/);
  assert.match(src,/data-menu-open=\{open \? "" : undefined\}/);
  assert.match(app,/menuDismissLayer\?\.addEventListener\('pointerdown'[\s\S]*?event\.preventDefault\(\)/);
  assert.match(app,/menuDismissLayer\?\.addEventListener\('click'[\s\S]*?closePanels\(\)/);
  assert.match(src,/id="menuDismissLayer" className="menu-dismiss-layer" hidden=\{!menuOpen\}/);
  assert.doesNotMatch(src,/popoverTarget=/);
  assert.match(src,/popover = null/);
  assert.match(src,/popover=\{popover \|\| undefined\}/);
  assert.match(app,/if\(returnFocus\)focusMenuControl\(target,panel\)/);
  assert.match(app,/function focusLibraryStart\(\)\{return focusMenuControl\(one\('#libraryClose'\)\);\}/);
  assert.match(app,/librarySubmenuOpen\(\)&&!menu\.contains\(event\.target\)&&!isTypingEntry\(event\.target\)/);
  assert.doesNotMatch(app,/addEventListener\('mousedown', e => e\.preventDefault\(\)\)/);
  assert.match(app,/function setTheme\(mode\)[\s\S]*?window\.location\.reload\(\)/);
  assert.doesNotMatch(app,/function setTheme\(mode\)[\s\S]*?applyScheme\(mode\)/);
});

test('document title is explicit in export flow and becomes the Telegraph page title',()=>{
  const html=page(),src=uiSource(),app=appSource();
  assert.match(html,/class="telegraph-title" id="telegraphTitleSlot" hidden/);
  assert.match(html,/tools\.setAttribute\('data-field-label','Título do documento'\)/);
  assert.match(html,/input\.setAttribute\('aria-label','Título do documento'\)/);
  // Acima do texto, só o título: sem rótulo visível, placeholder curto, nome completo no aria-label.
  assert.match(html,/tools\.removeAttribute\('data-field-label'\)/);
  assert.match(html,/input\.setAttribute\('placeholder','Título'\)/);
  assert.match(html,/input\.setAttribute\('aria-label','Título da página no Telegraph'\)/);
  assert.match(html,/\.telegraph-title \.document-tools::before\{content:none\}/);
  assert.doesNotMatch(html,/data-field-label','Título da página no Telegraph'/);
  assert.match(html,/slot\.append\(tools\)/);
  assert.match(html,/new MutationObserver\(sync\)\.observe\(destBtn,\{attributes:true,attributeFilter:\['data-dest'\]\}\)/);
  assert.match(src,/className="tools document-tools"/);
  assert.doesNotMatch(html,/id="telegraphTitle"/);
  assert.doesNotMatch(app,/telegraphTitle|setDocumentName/);
});

test('Telegram Mini App uses official fullscreen, viewport and safe-area state without orientation inference',()=>{
  const app=appSource();
  assert.match(app,/tg\.isFullscreen/);
  assert.match(app,/tg\.requestFullscreen\(\)/);
  assert.match(app,/tg\.onEvent\('fullscreenChanged'/);
  assert.match(app,/tg\.onEvent\('fullscreenFailed'/);
  assert.match(app,/tg\.onEvent\('viewportChanged',handleTelegramViewportChange\)/);
  assert.match(app,/getTg\(\)\?\.viewportStableHeight/);
  assert.match(app,/tg\.onEvent\('safeAreaChanged',syncTelegramSafeAreas\)/);
  assert.match(app,/tg\.onEvent\('contentSafeAreaChanged',syncTelegramSafeAreas\)/);
  assert.doesNotMatch(app,/portraitQuery|telegramStableViewportIsPortrait|lockOrientation\(|setDeviceGate\(/);
});

test('Telegraph supports explicit Telegram or browser capability ownership without identity fallback',()=>{
  const app=appSource(),server=serverSource();
  assert.match(app,/const BROWSER_OWNER_KEY='mdtxtrt-browser-owner'/);
  assert.match(app,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(app,/session==='ready'\?\{initData:getTg\(\)\.initData\}:\{browserKey:browserOwnerKey\(\)\}/);
  assert.match(server,/function telegraphOwner\(body\)/);
  assert.match(server,/Identidade de publicação ambígua/);
  assert.match(server,/browser:\"?\+?createHash\("sha256"\)/);
  assert.doesNotMatch(server,/Abra pelo bot no Telegram para publicar no Telegraph/);
});

test('server follows Bot API 10.3 Rich Message contracts without message downgrade paths',()=>{
  const server=serverSource();
  assert.match(server,/function richTextLength\(nodes\)/);
  assert.doesNotMatch(server,/Buffer\.byteLength\(html\)>32768/);
  assert.match(server,/A mensagem excede 32768 caracteres/);
  assert.match(server,/insideButton&&!\['tg-emoji','tg-time'\]\.includes\(node\.name\)/);
  assert.match(server,/"mailto:","tel:"/);
  assert.match(server,/allowedByType=\{/);
  assert.match(server,/URL de botão deve usar HTTP, HTTPS ou tg:\/\//);
  assert.match(server,/const msg\s*=\s*await telegramCall\("sendRichMessage",body\)/);
  assert.match(server,/sendTelegramRevisionNotice/);
  assert.doesNotMatch(server,/telegramCall\("editMessageText"/);
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
  assert.match(workflow,/name: Detect React UI bundle input changes[\s\S]*?src app\.js package\.json package-lock\.json/);
  assert.match(workflow,/name: Rebuild React UI bundle[\s\S]*?steps\.ui_inputs\.outputs\.changed == 'true'[\s\S]*?npm run build:ui/);
  assert.match(workflow,/name: Verify React UI bundle[\s\S]*?git diff --exit-code -- ui\.js/);
  assert.doesNotMatch(workflow,/git push|contents: write/);
  assert.deepEqual(railpack.steps.install.deployOutputs,[]);
  assert.equal(railpack.steps.install.commands.at(-2),'npm --version | grep -Fx 11.19.0');
  assert.equal(railpack.steps.install.commands.at(-1),'npm ci --omit=dev');
  assert.equal(railpack.steps.build.commands.length,1);
  assert.match(railpack.steps.build.commands[0].cmd,/^echo /,'Railway must not rebuild: bundles are committed and dev tools are omitted');
  for(const name of ['@samasante/liquid-glass','react','react-dom'])assert.ok(pkg.devDependencies[name]&&!pkg.dependencies[name],name+' is build-only');
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

test('draft persistence and Telegram provenance stay documented',()=>{
  const app=appSource(),server=serverSource(),architecture=read('ARCHITECTURE.md'),drafts=read('LOCAL_DRAFTS.md'),baseline=read('BASELINE.md');
  assert.match(server,/const DRAFT_DIR = DATA \+ "\/drafts"/);
  assert.match(server,/url\.pathname === "\/api\/drafts\/save"/);
  assert.match(server,/url\.pathname === "\/api\/drafts\/load"/);
  assert.match(server,/url\.pathname === "\/api\/drafts\/file"/);
  assert.match(server,/function savePersistentDraft\(owner,draft,files=\[\]\)/);
  assert.match(server,/status:"pending"[\s\S]*?telegramUserId:owner\.telegramUserId/);
  assert.match(server,/async function publishTelegramPersistent/);
  assert.match(server,/sendTelegramRevisionNotice/);
  assert.match(server,/history:nextHistory/);
  assert.doesNotMatch(server,/telegramCall\("editMessageText"/);
  assert.match(app,/function sanitizeDraftRuntimeDOM\(box\)/);
  assert.match(app,/box\.innerHTML=requireEditorCore\(\)\.html\(\)/);
  assert.doesNotMatch(app,/editorCore\?editorCore\.html\(\):editor\.innerHTML/);
  assert.doesNotMatch(app,/else editor\.innerHTML=/);
  assert.match(app,/A edição fica pausada para não substituí-la/);
  assert.match(app,/'Tentar de novo','Começar rascunho novo'/);
  assert.match(app,/function persistRemoteDraft\(pagehide=false\)/);
  assert.match(app,/function loadRemoteDraft\(doc=''\)/);
  assert.match(app,/form\.set\('draft',JSON\.stringify\(draftState\(\)\)\)/);
  assert.match(architecture,/Persistent draft and Telegram provenance boundary/);
  assert.match(architecture,/Railway volume/);
  assert.match(drafts,/mounted Railway volume/);
  assert.match(drafts,/verified Telegram user identifier/);
  assert.match(drafts,/does \*\*not\*\* rewrite the earlier chat message/);
});

test('step 4 format contract is explicit and conversion code uses the shared portable boundary',()=>{
  const app=appSource(),contract=read('FORMAT_CONTRACT.md');
  assert.match(app,/const FORMAT_CONTRACT=Object\.freeze/);
  assert.match(app,/function normalizePortableHTML\(root,label='conteúdo'\)/);
  assert.match(app,/function exportDocumentHTML\(\)\{[\s\S]*?requireEditorCore\(\)\.html\(\)/);
  assert.doesNotMatch(app,/function exportDocumentHTML\(\)\{[\s\S]*?editor\.innerHTML/);
  assert.match(app,/svc\.addRule\('strikethrough'/);
  assert.doesNotMatch(app,/if\(importedMd && editor\.innerHTML === importedHtml\) return importedMd/);
  assert.doesNotMatch(app,/if\(importedTxt && editor\.innerHTML===importedHtml\)return importedTxt/);
  assert.match(contract,/## File matrix/);
  assert.match(contract,/## Destination matrix/);
  assert.match(contract,/Markdown export always serializes the current edited document/);
  assert.match(contract,/Returning an untouched original file is not sufficient evidence/);
});

test('private bot actions are canonical Mini App web_app flows with no legacy direct fallback',()=>{
  const app=appSource(),server=serverSource();
  assert.match(server,/function botWebAppRow\(label,url,style="success"\)/);
  assert.match(server,/type=\\"web_app\\"/);
  assert.doesNotMatch(server,/function botCallbackRow\(/);
  assert.doesNotMatch(server,/function commandBody\(/);
  assert.doesNotMatch(server,/function repliedBody\(/);
  assert.doesNotMatch(server,/function richHTML\(/);
  assert.doesNotMatch(server,/function formatText\(/);
  assert.doesNotMatch(server,/async function sendDocument\(/);
  assert.match(server,/function appButton\(newToken="",view=""\)[\s\S]*?type=\\"web_app\\"/);
  assert.doesNotMatch(server,/function appButton\(newToken="",view=""\)[\s\S]*?type=\\"url\\"/);
  assert.match(server,/function importAppButton\(token\)[\s\S]*?url\.searchParams\.set\("handoff",token\)[\s\S]*?botWebAppRow/);
  assert.match(server,/function botDraftListPages\(owner\)/);
  assert.match(server,/function botSendListPages\(owner\)/);
  assert.match(server,/function botExportListPages\(owner\)/);
  assert.match(server,/botActionLaunchURL\(MINI_APP_URL,"send","d",item\.docId\)/);
  assert.match(server,/botActionLaunchURL\(MINI_APP_URL,"export",item\.kind,item\.docId\)/);
  assert.doesNotMatch(server,/botActionLaunchURL\(base,action,kind,doc,format/);
  assert.match(server,/allowed_updates:\["message"\]/);
  assert.doesNotMatch(server,/answerCallbackQuery/);
  assert.match(server,/url\.pathname === "\/api\/export\/source"/);
  assert.match(server,/const owner=draftOwner\(body\)/);
  assert.match(server,/if\(!publication\.snapshot\)throw new Error\("Esta publicação Telegram não possui snapshot exato da revisão publicada"\)/);
  assert.doesNotMatch(server,/publication\.revision===record\.draft\.revision/);
  assert.match(app,/function handoffToken\(\)[\s\S]*?searchParams\.get\('handoff'\)/);
  assert.match(app,/function consumeBotLaunchAction\(\)/);
  assert.doesNotMatch(app,/const format=url\.searchParams\.get\('format'\)/);
  assert.match(app,/async function runBotLaunchAction\(selection\)/);
  assert.match(app,/async function loadBotExportSource\(selection\)/);
  assert.match(app,/API\+'\/api\/export\/source'/);
  assert.match(app,/await loadRemoteDraft\(selection\.doc\)/);
  assert.match(app,/await publishTelegram\(\)/);
  assert.doesNotMatch(app,/editMessageText/);
});

test('step 6 persists drafts on the Railway volume, binds Telegram publication provenance and labels the document title explicitly',()=>{
  const html=page(),app=appSource(),server=serverSource();
  assert.match(server,/const DRAFT_DIR = DATA \+ "\/drafts"/);
  assert.match(server,/function savePersistentDraft\(owner,draft,files=\[\]\)/);
  assert.match(server,/url\.pathname === "\/api\/drafts\/save"/);
  assert.match(server,/url\.pathname === "\/api\/drafts\/load"/);
  assert.match(server,/url\.pathname === "\/api\/drafts\/file"/);
  assert.match(server,/telegramUserId/);
  assert.match(server,/sendTelegramRevisionNotice/);
  assert.match(server,/publishTelegramPersistent/);
  assert.match(server,/url\.pathname === "\/api\/library\/list"/);
  assert.match(server,/url\.pathname === "\/api\/telegraph\/load"/);
  assert.match(app,/function openLibrary\(preferred=''\)/);
  assert.match(app,/API\+'\/api\/telegraph\/load'/);
  assert.match(app,/function persistRemoteDraft\(pagehide=false\)/);
  assert.match(app,/function loadRemoteDraft\(doc=''\)/);
  assert.match(app,/form\.set\('draft',JSON\.stringify\(draftState\(\)\)\)/);
  assert.match(app,/function panelViewportBounds\(base=visualViewportBounds\(\)\)/);
  assert.match(app,/bar\?\.getBoundingClientRect/);
  assert.match(app,/ui\.setMenu\(id,\{positioned:true,maxHeight:baseMax,maxWidth\}\)/);
  assert.match(uiSource(),/data-runtime-positioned=\{menu\?\.positioned \? "" : undefined\}/);
  assert.match(html,/\.glass-menu\[data-anchor\],\.glass-menu\[data-runtime-positioned\]/);
  assert.match(html,/\.document-tools::before\{content:attr\(data-field-label\)/);
  assert.match(html,/Título do documento/);
  assert.match(html,/Título da página no Telegraph/);
  const ui=uiSource();
  assert.match(ui,/id="exportMenu"[\s\S]*?id="libraryBtn"/);
  assert.match(ui,/id="libraryMenu"[\s\S]*?className="wide-menu plus-submenu library-menu"/);
  assert.doesNotMatch(ui,/id="libraryScreen"/);
  assert.doesNotMatch(ui,/id="libraryDismiss"/);
  assert.doesNotMatch(ui,/id="librarySubmenu"/);
  assert.match(ui,/id="draftList"/);
  assert.match(ui,/id="telegramList"/);
  assert.match(ui,/id="telegraphList"/);
  assert.doesNotMatch(ui,/id="libraryRefresh"/);
  assert.match(ui,/<MenuItem icon="arrow_back" className="submenu-back" id="libraryClose">/);
  assert.match(ui,/<MenuItem icon="sticky_note_2" id="libraryNew">Novo documento<\/MenuItem>/);
  assert.match(ui,/function LibraryToggle\(\{ field, children, \.\.\.props \}\)[\s\S]*?aria-expanded=\{String\(open\)\}/);
  assert.match(ui,/id="publicationToggle" field="publicationsOpen" aria-controls="publicationLists"/);
  assert.match(ui,/id="draftToggle" field="draftsOpen" aria-controls="draftLists"/);
  assert.ok(ui.indexOf('id="publicationToggle"')<ui.indexOf('id="draftToggle"'));
  assert.doesNotMatch(ui,/Conteúdo persistido no volume/);
  assert.match(ui,/Icon name="menu"/);
  assert.match(app,/Array\.isArray\(data\.telegram\)/);
  assert.match(server,/function listTelegramPublications\(owner,drafts=\[\]\)/);
  assert.match(app,/function librarySubmenuOpen\(\)[\s\S]*?panelIsOpen\(one\('#libraryMenu'\)\)/);
  assert.match(app,/function togglePanel\(sel,anchorOverride=null\)/);
  assert.match(html,/\.menu-dismiss-layer\{[\s\S]*?position:fixed[\s\S]*?z-index:39/);
  assert.match(html,/\.glass-menu\[data-menu-open\],\.glass-menu\[popover\]:popover-open/);
  assert.match(app,/function setPublicationsExpanded\(expanded\)\{ui\.setLibrary\(\{publicationsOpen:Boolean\(expanded\)\}\);\}/);
  assert.match(app,/function setDraftsExpanded\(expanded\)\{ui\.setLibrary\(\{draftsOpen:Boolean\(expanded\)\}\);\}/);
  assert.match(html,/\.library-publication-groups,\.library-draft-groups\{/);
  assert.match(html,/\.library-publication-groups\[hidden\],\.library-draft-groups\[hidden\]\{display:none\}/);
  assert.doesNotMatch(app,/function setLibraryView\(open\)/);
  assert.doesNotMatch(app,/const libraryMode=/);
  assert.doesNotMatch(app,/Math\.min\(520,bounds\.height\*\.78,fullHeight\)/);
  assert.match(app,/one\('#exportBtn'\)\.addEventListener[\s\S]*?togglePanel\('#exportMenu'/);
  assert.match(app,/one\('#publicationToggle'\)\?\.addEventListener/);
  assert.match(app,/one\('#draftToggle'\)\?\.addEventListener/);
});

test('step 5 overlays use the visual viewport',()=>{
  const html=page(),app=appSource(),src=uiSource();
  assert.match(html,/\.menu-list\{[\s\S]*?flex:1 1 auto[\s\S]*?max-height:none[\s\S]*?overflow-y:auto/);
  assert.match(html,/\.dialog\{[\s\S]*?max-height:100%[\s\S]*?overflow-y:auto/);
  assert.match(html,/#dialogMenu:popover-open::backdrop\{background:transparent;pointer-events:auto\}/);
  assert.match(app,/function visualViewportBounds\(\)/);
  assert.match(app,/function panelViewportBounds\(base=visualViewportBounds\(\)\)[\s\S]*?\.bar-wrap/);
  assert.match(app,/function placePanel\(panel,anchorRect=null\)[\s\S]*?panelViewportBounds\(viewport\)[\s\S]*?ui\.setMenu\(id,\{positioned:true,maxHeight:baseMax,maxWidth\}\)/);
  assert.match(src,/style\["--menu-max-height"\] = px\(menu\.maxHeight\)[\s\S]*?style\["--menu-max-width"\] = px\(menu\.maxWidth\)/);
  assert.match(app,/openPanel\('#findMenu',anchor\)/);
  assert.match(app,/const anchor=one\('#plusBtn'\)/);
  assert.match(app,/function setDialogModality\(active\)[\s\S]*?setAttribute\('inert',''\)/);
  assert.match(app,/one\('#dialogMenu'\)\.addEventListener\('keydown'[\s\S]*?event\.key!=='Tab'/);
  assert.match(app,/if\(dialog\?\.matches\(':popover-open'\)\)placePanel\(dialog\)/);
  assert.match(src,/id="dialogMenu"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/);
});

test('menus, dialog and library are React state: app.js never rewrites their markup',()=>{
  const app=appSource(),src=uiSource();
  assert.match(app,/const ui = window\.MDTXTRT_UI;/);
  assert.match(src,/window\.MDTXTRT_UI = uiStore;/);
  assert.match(src,/useSyncExternalStore\(subscribeUI, read, read\)/);
  for(const forbidden of [
    /setAttribute\('data-menu-open'|removeAttribute\('data-menu-open'/,
    /data-runtime-positioned'/,
    /style\.setProperty\('--menu-/,
    /setAttribute\('aria-expanded'/,
    /classList\.toggle\('is-current'/,
    /menuDismissLayer\.hidden/,
    /\[data-telegram-only\]'\)\.forEach|\[data-telegraph-only\]'\)\.forEach/,
    /#dialogLabel'\)\.textContent|#dialogOk'\)\.textContent|#dialogCancel'\)\.textContent/,
    /\.showPopover\(\)|\.hidePopover\(\)/,
    /replaceChildren\(/,
    /createElement\('article'\)/,
    /#libraryStatus'\)[\s\S]{0,40}textContent/,
    /openLabel\.textContent/
  ])assert.doesNotMatch(app,forbidden);
  // A delegação que mantém o teclado aberto continua no documento.
  assert.match(app,/document\.addEventListener\('pointerdown',retainTypingFocus,true\);/);
  assert.match(app,/document\.addEventListener\('mousedown',retainTypingFocus,true\);/);
});

test('toast text and visibility are React state, not DOM mutations from the editor',()=>{
  const app=appSource(),src=uiSource();
  assert.match(src,/export function setToast\(patch\)/);
  assert.match(src,/className=\{visible \? "toast on" : "toast"\}/);
  assert.match(app,/ui\.setToast\(\{text:String\(msg\),visible:true\}\)/);
  assert.doesNotMatch(app,/toast\.classList|\btoastText\b|createTextNode\(''\)/);
});

test('edge fades start near transparent on the content side and reach the solid chrome only at the edge',()=>{
  const css=read('styles.css'),jsx=read('src/chrome.jsx');
  const stops=JSON.parse(/export const FADE_STOPS = (\[\[.*?\]\]);/.exec(jsx)[1]);
  assert.deepEqual(stops[0],[0,100]);
  assert.deepEqual(stops.at(-1),[1,0]);
  for(let i=1;i<stops.length;i++){
    assert.ok(stops[i][0]>stops[i-1][0],'posições crescentes');
    assert.ok(stops[i][1]<stops[i-1][1],'alfa cai sem degraus');
  }
  // Metade da faixa do lado do conteúdo quase transparente: a translucidez aparece.
  for(const [t,a] of stops)if(t>=0.5)assert.ok(a<=12,`alfa ${a}% em t=${t}`);
  // O CSS usa as mesmas paradas que o fundo das lentes (canvas).
  const ramp=/--fade-ramp:([^}]*?)transparent 100%/s.exec(css)[1];
  const cssStops=[...ramp.matchAll(/var\(--edge\) ([\d.]+)%,transparent\) calc\(var\(--fade-solid\) \+ \(100% - var\(--fade-solid\)\)\*([\d.]+)\)/g)].map(m=>[Number(m[2]),Number(m[1])]);
  assert.deepEqual(cssStops,stops.slice(1,-1));
  assert.match(css,/\.fade-top\{[^}]*--fade-solid:var\(--safe-top\)/);
  assert.match(css,/\.fade-bot\{[^}]*--fade-solid:var\(--safe-bottom-max\)/);
});

test('platform switcher is an ephemeral choice without a persistent on state',()=>{
  const css=read('styles.css'),jsx=read('src/chrome.jsx');
  const dest=jsx.slice(jsx.indexOf('function DestButton()'),jsx.indexOf('function DestButton()')+900);
  assert.doesNotMatch(dest,/aria-pressed|className=\{dest/);
  assert.match(dest,/data-dest=\{dest\}/);
  assert.doesNotMatch(css,/#destBtn(\.active|\[aria-pressed|\.on)/);
  assert.doesNotMatch(css,/\.seg button\.active/);
});

test('no residue of the old palette: no green accent, no stale tokens, one hairline rule',()=>{
  const css=read('styles.css');
  // O verde antigo (--accent do claro) saiu de vez; o texto usa --link ou neutros.
  assert.doesNotMatch(css,/#269c65/i);
  assert.doesNotMatch(css,/--accent\b/);
  for(const token of ['--bg:','--dim','--glass-tint','--bar-glass-tint-strong','--bar-control-accent-bg','--library-surface','--library-card','--library-section-bg','--library-backdrop','--library-shadow','--menu-shadow','--neutral-3'])assert.ok(!css.includes(token),'token sem uso: '+token);
  // Hairline de 0,5px em telas 2x, também no Safari anterior ao 16 (sem min-resolution).
  assert.match(css,/@media \(min-resolution:2dppx\),\(-webkit-min-device-pixel-ratio:2\)\{:root\{--rim-w:\.5px\}\}/);
  assert.match(css,/--glass-edge:0 0 0 var\(--rim-w\) var\(--rim\)/);
  assert.doesNotMatch(css,/inset 0 1px/);
  // Toast em várias linhas: cantos de 22px, nunca a cápsula de 999px que cortava o texto.
  assert.match(css,/\.toast-material\{\s*border-radius:22px;overflow:hidden/);
});

test('editor quotes follow the canonical platform: Telegraph aside and blockquote, Telegram link bar',()=>{
  const css=read('styles.css'),publish=read('src/app/publish.js');
  const aside=/\n\.editor aside\{([^}]*)\}/.exec(css)[1];
  // telegra.ph/css/core.min.css › .tl_article_content aside
  for(const rule of ['margin:18px 21px 16px','padding:0 18px','font-size:21px','font-style:italic','text-align:center','color:var(--telegraph-aside)'])assert.ok(aside.includes(rule),'aside '+rule);
  assert.doesNotMatch(aside,/border/);
  // Claro: os literais do core.min.css (o texto do claro é #151515, não preto).
  // Escuro (o Telegraph não tem): derivados da cor do texto.
  assert.match(css,/html\.light\{[^}]*--telegraph-rule:#000;\s*--telegraph-aside:rgba\(0,0,0,\.6\);/);
  assert.match(css,/:root\{[^}]*--telegraph-rule:var\(--text\);\s*--telegraph-aside:color-mix\(in srgb,var\(--text\) 60%,transparent\);/);
  assert.doesNotMatch(css,/--telegraph-ink/);
  assert.match(css,/html\[data-dest="telegraph"\] \.editor blockquote:not\(\[expandable\]\)\{[^}]*margin:18px 21px 16px 0;padding:0 0 0 15px;border-left:3px solid var\(--telegraph-rule\);font-style:italic/);
  assert.match(css,/\.editor blockquote\{[^}]*border-left:3px solid var\(--link\)/);
  assert.match(publish,/document\.documentElement\.setAttribute\('data-dest',S\.dest\)/);
});

test('undo and redo flash fade by colour, never by animated opacity (WebKit clipped the circle)',()=>{
  const css=read('styles.css'),main=read('src/app/main.js');
  const frames=/@keyframes flash-out\{([^\n]*)\}\n/.exec(css)[1];
  assert.doesNotMatch(frames,/opacity/);
  assert.match(frames,/background-color:var\(--glass-strong\)/);
  assert.match(frames,/background-color:transparent/);
  assert.match(main,/one\('#undoBtn'\)\.addEventListener\('click', \(\)=>\{ if\(histUndo\(\)\)flashBtn\(one\('#undoBtn'\)\); \}\);/);
  assert.match(main,/one\('#redoBtn'\)\.addEventListener\('click', \(\)=>\{ histRedo\(\); flashBtn\(one\('#redoBtn'\)\); \}\);/);
});
