import {test,expect} from '@playwright/test';

const OFFLINE='servidor fora do ar no primeiro acesso';
const BLOCKED='Safari com Bloquear Todos os Cookies';
const GATE='aviso de retrato';

// A página roda como site estático; o SDK do Telegram fica fora do teste.
test.beforeEach(async ({page})=>{
  // Hora em que o index.html abriu o aviso de retrato inicial (tela larga), para os
  // testes do aviso esperarem o prazo dele acabar (ver showNotice).
  await page.addInitScript(()=>{
    new MutationObserver(()=>{
      if(window.__startupGateAt===undefined&&document.documentElement.hasAttribute('data-device-gate'))window.__startupGateAt=performance.now();
    }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-device-gate']});
  });
  await page.route(/telegram\.org/,route=>route.fulfill({body:'',contentType:'text/javascript'}));
  // Sem backend: nenhum rascunho remoto e o resto da API indisponível.
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'POST, GET, OPTIONS'};
  await page.route(/\/api\//,route=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    const missing=request.url().endsWith('/api/drafts/load');
    return route.fulfill({status:missing?404:503,contentType:'application/json',body:missing?'{"error":"not found"}':'{"error":"offline"}',headers:cors});
  });
  page.errors=[];
  page.on('pageerror',error=>page.errors.push(error.message));
  // O grupo do servidor fora do ar troca a resposta antes de abrir a página.
  if([OFFLINE,BLOCKED,GATE].some(group=>test.info().titlePath.includes(group)))return;
  await page.goto('/index.html');
  await expect(page.locator('#undoBtn')).toBeVisible();
  // Em 1280px o aviso de retrato abre por 4s por cima do texto: os testes de
  // interface começam sem ele (os do aviso o mostram de novo).
  await page.evaluate(()=>document.documentElement.removeAttribute('data-device-gate'));
});

test.afterEach(async ({page})=>{
  expect(page.errors,'erros de JavaScript na página').toEqual([]);
});

test('abre no tema do sistema e sem rolagem lateral',async ({page},info)=>{
  const theme=info.project.use.colorScheme;
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
  const {scrollWidth,innerWidth}=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth}));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

test('texto longo quebra dentro da largura da tela',async ({page})=>{
  const editor=page.locator('#editor');
  await editor.click();
  await page.keyboard.type('palavra '.repeat(60)+'x'.repeat(120));
  // Mede onde termina cada caractere visível. O scrollWidth não serve: o WebKit
  // conta nele o espaço que sobra no fim de cada linha (pendurado, invisível), e
  // isso depende só da largura da fonte.
  const {scrollWidth,innerWidth,inkOverflow}=await page.evaluate(()=>{
    const el=document.querySelector('#editor'),right=el.getBoundingClientRect().right-parseFloat(getComputedStyle(el).paddingRight);
    const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),range=document.createRange();let ink=-Infinity;
    for(let t=walk.nextNode();t;t=walk.nextNode())for(let i=0;i<t.length;i++){
      if(/\s/.test(t.data[i]))continue;
      range.setStart(t,i);range.setEnd(t,i+1);ink=Math.max(ink,range.getBoundingClientRect().right);
    }
    return {scrollWidth:document.documentElement.scrollWidth,innerWidth,inkOverflow:ink-right};
  });
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  expect(inkOverflow).toBeLessThanOrEqual(1);
});

test('desfazer e refazer funcionam por clique real',async ({page})=>{
  const editor=page.locator('#editor');
  await editor.click();
  await page.keyboard.type('Olá Telegraph');
  await expect(editor).toContainText('Olá Telegraph');
  await page.locator('#undoBtn').click();
  await expect(editor).not.toContainText('Olá Telegraph');
  await page.locator('#redoBtn').click();
  await expect(editor).toContainText('Olá Telegraph');
});

test('menu de exportação abre e mostra as opções',async ({page})=>{
  await page.locator('#exportBtn').click();
  await expect(page.locator('#exportMdBtn')).toBeVisible();
  await expect(page.locator('#exportTxtBtn')).toBeVisible();
});

// Troca de tema ao vivo (fora do app instalado): nada recarrega, e o que o Safari, o
// theme-color e o Telegram usam para pintar as barras é a mesma cor sólida da borda.
// Cor computada (rgb) em #rrggbb, para comparar com o theme-color e o Telegram.
const EDGE={light:'#8b82e6',dark:'#151137'};
async function chromeColors(page){
  return page.evaluate(()=>{
    const hex=c=>{const m=/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(c);return m&&(m[4]===undefined||Number(m[4])===1)?'#'+m.slice(1,4).map(n=>Number(n).toString(16).padStart(2,'0')).join(''):c;};
    return {theme:document.documentElement.dataset.theme,meta:document.querySelector('meta[name="theme-color"]').getAttribute('content'),
      top:hex(getComputedStyle(document.querySelector('.edge-top')).backgroundColor),bot:hex(getComputedStyle(document.querySelector('.edge-bot')).backgroundColor)};
  });
}
test('trocar o tema muda na hora, sem recarregar: texto, cursor, borda e theme-color',async ({page})=>{
  const editor=page.locator('#editor');
  await editor.click();
  await page.keyboard.type('antes depois');
  // Cursor logo depois de "antes".
  await page.evaluate(()=>{const t=document.querySelector('#editor').querySelector('p')?.firstChild||document.querySelector('#editor').firstChild;const r=document.createRange();r.setStart(t,5);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);window.__mesmaPagina=true;});
  const before=await chromeColors(page);
  expect(before).toMatchObject({meta:EDGE[before.theme],top:EDGE[before.theme],bot:EDGE[before.theme]});
  await page.locator('#themeBtn').click();
  const after=before.theme==='light'?'dark':'light';
  await expect(page.locator('html')).toHaveAttribute('data-theme',after);
  expect(await page.evaluate(()=>window.__mesmaPagina),'a página não recarregou').toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('mdtxtrt-theme'))).toBe(after);
  // Faixas da borda, theme-color: a cor do tema novo, a mesma nos três.
  expect(await chromeColors(page)).toEqual({theme:after,meta:EDGE[after],top:EDGE[after],bot:EDGE[after]});
  // Texto e cursor intactos: o próximo caractere entra onde o cursor estava.
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('editor');
  await page.keyboard.type('X');
  await expect(editor).toHaveText('antesX depois');
});

// O Safari do iOS 26 tinge as barras com o background-color do elemento fixo que
// acha no meio de cada borda, a 4px da beira, ignorando pointer-events, se ele tiver
// mais de 10px (WebKit, LocalFrameView.cpp › fixedContainerEdges). Simulado aqui com
// pointer-events ligado em tudo: no meio de cada borda tem de estar a faixa sólida,
// opaca e com mais de 10px, nos dois temas (e depois de trocar ao vivo).
test('o elemento no meio de cada borda é a faixa sólida da cor da borda',async ({page})=>{
  const probe=()=>page.evaluate(()=>{
    const style=document.createElement('style');style.textContent='*{pointer-events:auto!important}';document.head.append(style);
    const at=y=>{const el=document.elementFromPoint(innerWidth/2,y),r=el.getBoundingClientRect(),c=getComputedStyle(el);return {cls:el.className,h:r.height,w:r.width,bg:c.backgroundColor,pos:c.position};};
    const out={top:at(4),bot:at(innerHeight-4)};style.remove();return out;
  });
  for(let round=0;round<2;round++){
    const colors=await chromeColors(page),hit=await probe();
    for(const [side,cls] of [['top','edge-top'],['bot','edge-bot']]){
      expect(hit[side],`borda ${side}`).toMatchObject({cls,pos:'fixed'});
      expect(hit[side].h,`faixa ${side} com mais de 10px`).toBeGreaterThan(10);
      expect(hit[side].bg,`faixa ${side} opaca`).toMatch(/^rgb\(/);
    }
    expect(colors.top).toBe(colors.meta);
    if(round===0)await page.locator('#themeBtn').click();
  }
});

// As lentes das barras e dos botões congelam um quadro com o fundo e a cor do tema.
// Depois da troca ao vivo, cada uma tem de ficar igual à de uma página aberta já no
// tema novo (antes ficava o quadro do tema anterior).
async function lensColors(page){
  await expect.poll(()=>page.locator('.lens-surface').count(),{timeout:8000}).toBe(0);
  return page.evaluate(()=>[...document.querySelectorAll('.lens > canvas')].map(c=>{
    if(!c.width||!c.height)return null;
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,sum=[0,0,0];let n=0;
    for(let i=0;i<d.length;i+=4)if(d[i+3]>0){sum[0]+=d[i];sum[1]+=d[i+1];sum[2]+=d[i+2];n++;}
    return n?sum.map(v=>Math.round(v/n)):null;
  }));
}
const lensGap=(a,b)=>Math.max(...a.flatMap((c,i)=>c.map((v,k)=>Math.abs(v-b[i][k]))));
test('depois da troca ao vivo, as lentes têm a cor do tema novo',async ({page})=>{
  await expect.poll(()=>page.locator('#plusBtn').getAttribute('data-lens'),{timeout:8000}).toBe('webgl2');
  const before=await lensColors(page);
  expect(before.length,'lentes das barras e dos botões').toBeGreaterThanOrEqual(6);
  expect(before.every(Boolean),'todas com quadro congelado').toBe(true);
  await page.locator('#themeBtn').click();
  await expect.poll(async()=>lensGap(await lensColors(page),before),{timeout:10000,message:'a lente redesenha com o tema novo'}).toBeGreaterThan(30);
  const toggled=await lensColors(page);
  // A mesma tela aberta do zero no tema escolhido (a preferência ficou salva).
  await page.reload();
  await expect.poll(()=>page.locator('#plusBtn').getAttribute('data-lens'),{timeout:8000}).toBe('webgl2');
  await page.evaluate(()=>document.documentElement.removeAttribute('data-device-gate'));
  const fresh=await lensColors(page);
  expect(lensGap(toggled,fresh),'lente igual à da página aberta no tema novo').toBeLessThanOrEqual(6);
});

// Mini App: a mesma troca ao vivo pinta o cabeçalho, o fundo e a barra de baixo do
// Telegram com a cor da borda (setHeaderColor/setBackgroundColor/setBottomBarColor).
test('no Mini App, trocar o tema pinta o Telegram com a cor da borda, sem recarregar',async ({page})=>{
  await page.addInitScript(()=>{
    const noop=()=>{},button={show:noop,hide:noop,onClick:noop},calls=window.__tgCalls=[];
    const record=name=>color=>calls.push([name,color]);
    const webApp={initData:'query_id=test',initDataUnsafe:{},version:'7.10',platform:'ios',colorScheme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',themeParams:{},
      viewportHeight:innerHeight,viewportStableHeight:innerHeight,isExpanded:true,isFullscreen:false,isVersionAtLeast:()=>true,
      SettingsButton:button,BackButton:button,MainButton:button,
      setHeaderColor:record('header'),setBackgroundColor:record('background'),setBottomBarColor:record('bottomBar')};
    window.Telegram={WebApp:new Proxy(webApp,{get:(target,key)=>key in target?target[key]:noop})};
  });
  await page.route(/\/api\/telegram\/session/,route=>{
    const cors={'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'POST, OPTIONS'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}',headers:cors});
  });
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/\btg\b/);
  const last=()=>page.evaluate(()=>Object.fromEntries(window.__tgCalls));
  const before=await chromeColors(page);
  expect(await last()).toEqual({header:EDGE[before.theme],background:EDGE[before.theme],bottomBar:EDGE[before.theme]});
  await page.evaluate(()=>{window.__mesmaPagina=true;});
  await page.locator('#themeBtn').click();
  const after=before.theme==='light'?'dark':'light';
  await expect(page.locator('html')).toHaveAttribute('data-theme',after);
  expect(await page.evaluate(()=>window.__mesmaPagina),'a página não recarregou').toBe(true);
  const colors=await chromeColors(page);
  expect(colors).toMatchObject({meta:EDGE[after],top:EDGE[after]});
  expect(await last(),'Telegram com a cor da faixa da borda').toEqual({header:colors.top,background:colors.top,bottomBar:colors.top});
});

// No app instalado na tela de início a barra de status segue o
// apple-mobile-web-app-status-bar-style lido na abertura: lá a troca recarrega.
for(const how of ['navigator.standalone','display-mode: standalone'])test(`no app instalado (${how}) trocar o tema recarrega e mantém a escolha`,async ({page})=>{
  await page.addInitScript(how=>{
    if(how==='navigator.standalone')Object.defineProperty(Navigator.prototype,'standalone',{configurable:true,get:()=>true});
    else{const real=window.matchMedia.bind(window);window.matchMedia=q=>q.includes('display-mode: standalone')?{matches:true,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}:real(q);}
  },how);
  await page.reload();
  await expect(page.locator('#undoBtn')).toBeVisible();
  const before=await page.locator('html').getAttribute('data-theme');
  await page.evaluate(()=>{window.__mesmaPagina=true;});
  await Promise.all([page.waitForEvent('load'),page.locator('#themeBtn').click()]);
  await expect(page.locator('#undoBtn')).toBeVisible();
  expect(await page.evaluate(()=>window.__mesmaPagina),'recarregou').toBeUndefined();
  const after=await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
  expect(await page.evaluate(()=>localStorage.getItem('mdtxtrt-theme'))).toBe(after);
});

test('zoom continua bloqueado',async ({page})=>{
  const viewport=await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('maximum-scale=1');
  expect(viewport).toContain('user-scalable=no');
});

// Invariantes de design.
// Lentes: exigem WebGL 2. Com WebGL 2 o + e o ☰ refratam pelo renderizador do
// fork e congelam o quadro; sem WebGL 2 fica o vidro em CSS, sem erro.
test('lentes refratam com WebGL 2',async ({page})=>{
  const webgl2=await page.evaluate(()=>{
    try{return Boolean(document.createElement('canvas').getContext('webgl2'));}catch{return false;}
  });
  test.info().annotations.push({type:'webgl2',description:webgl2?'disponível: lente testada':'indisponível: fallback CSS testado'});
  for(const id of ['#plusBtn','#exportBtn','#undoBtn']){
    await expect.poll(()=>page.locator(id).getAttribute('data-lens'),{timeout:8000}).toBe(webgl2?'webgl2':'css');
    const lens=await page.evaluate(sel=>{
      const button=document.querySelector(sel),host=button.querySelector('.lens');
      const r=button.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      const snap=host.querySelector(':scope > canvas');
      let opaque=0;
      if(snap.width&&snap.height){
        const d=snap.getContext('2d').getImageData(0,0,snap.width,snap.height).data;
        for(let i=3;i<d.length;i+=4)if(d[i]>0)opaque++;
      }
      return {
        display:getComputedStyle(host).display,
        pointer:getComputedStyle(host).pointerEvents,
        hidden:host.getAttribute('aria-hidden'),
        focusable:host.querySelectorAll('[tabindex],button,a,input').length,
        hitButton:Boolean(hit&&hit.closest(sel)),
        opaque,
        live:host.querySelectorAll('.lens-surface').length
      };
    },id);
    expect(lens.pointer).toBe('none');
    expect(lens.hidden).toBe('true');
    expect(lens.focusable).toBe(0);
    expect(lens.hitButton,'o toque continua chegando ao botão').toBe(true);
    if(webgl2){
      expect(lens.display).not.toBe('none');
      expect(lens.opaque,'quadro da lente congelado no canvas').toBeGreaterThan(0);
    }else{
      expect(lens.display).toBe('none');
    }
  }
  // Nenhum laço contínuo: depois de assentar, o renderizador WebGL é desmontado.
  await expect.poll(()=>page.locator('.lens-surface').count(),{timeout:8000}).toBe(0);
});

const CHROME_CONTROLS='#ux-root button:not([hidden]),#ux-root [role="button"]';

test('nenhum contorno azul de foco em controle nenhum',async ({page})=>{
  const offenders=await page.evaluate(sel=>{
    const bad=[];
    for(const el of document.querySelectorAll(sel)){
      el.focus({preventScroll:true});
      const cs=getComputedStyle(el);
      const outline=cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0;
      const tap=cs.webkitTapHighlightColor;
      const tapVisible=tap&&!/rgba\(0, 0, 0, 0\)|transparent/.test(tap);
      if(outline||tapVisible)bad.push((el.id||el.getAttribute('aria-label')||el.textContent.trim()).slice(0,40)+': '+cs.outlineStyle+' '+cs.outlineWidth+' '+tap);
    }
    document.activeElement?.blur?.();
    return bad;
  },CHROME_CONTROLS);
  expect(offenders).toEqual([]);
});

test('vidro usa hairline e material neutro translúcido, sem cor de acento sólida',async ({page})=>{
  const pieces=await page.evaluate(()=>{
    const alpha=color=>{
      const m=color.match(/rgba?\(([^)]+)\)/);
      if(!m)return color==='transparent'?0:1;
      const parts=m[1].split(/[ ,/]+/).filter(Boolean);
      return parts.length>3?Number(parts[3]):1;
    };
    return [...document.querySelectorAll('.seg,.bar,.glass-menu-material,.toast-material,.device-gate-card')].map(el=>{
      const cs=getComputedStyle(el);
      return {
        name:el.id||el.className.split(' ')[0],notice:el.matches('.toast-material,.device-gate-card'),
        bg:cs.backgroundColor,bgAlpha:alpha(cs.backgroundColor),
        blur:(cs.backdropFilter||cs.webkitBackdropFilter||''),
        rim:cs.boxShadow
      };
    });
  });
  expect(pieces.length).toBeGreaterThan(4);
  for(const piece of pieces){
    // Os avisos efêmeros ficam sobre o texto do documento: a tinta densa do site
    // (--picker-bg, .88–.9), translúcida mas sem deixar o texto de trás aparecer.
    // Nunca opaca, a regra da biblioteca. O resto do cromo deixa a cor passar.
    if(piece.notice){
      expect(piece.bgAlpha,piece.name+' é translúcido, nunca opaco').toBeLessThan(1);
      expect(piece.bgAlpha,piece.name+' tem tinta densa sobre o texto').toBeGreaterThanOrEqual(.85);
    }else expect(piece.bgAlpha,piece.name+' deixa a cor passar').toBeLessThan(.75);
    expect(piece.bgAlpha,piece.name+' tem material').toBeGreaterThan(0);
    expect(piece.blur,piece.name+' desfoca o fundo').toMatch(/blur\(/);
    expect(piece.rim,piece.name+' tem borda hairline').toMatch(/0px 0px 0px (0\.5|1)px/);
  }
  // Nenhum botão da barra usa preenchimento sólido de acento. O vidro branco neutro
  // dos pontos estratégicos no claro (como o pill selecionado do site HTML, .9) pode
  // passar de .75, mas nunca fica opaco.
  const solid=await page.evaluate(()=>[...document.querySelectorAll('#ux-root .bar > button,#ux-root .seg button,#ux-root .action-dot')].filter(el=>{
    const m=getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
    if(!m)return false;
    const parts=m[1].split(/[ ,/]+/).filter(Boolean);
    const alpha=parts.length>3?Number(parts[3]):1;
    const neutralWhite=parts.slice(0,3).every(v=>Number(v)===255);
    return neutralWhite?alpha>.9:alpha>=.75;
  }).map(el=>el.id||el.getAttribute('aria-label')));
  expect(solid).toEqual([]);
});

// Teclado virtual: nenhum controle da barra ou dos menus pode tirar o foco do editor.
async function closeMenus(page){
  // Toca numa área livre da camada de dispensa, fora de qualquer menu aberto.
  const point=await page.evaluate(()=>{
    const layer=document.querySelector('#menuDismissLayer');
    for(let y=innerHeight*.5;y>20;y-=24)for(const x of [innerWidth-24,innerWidth/2,24]){
      if(document.elementFromPoint(x,y)===layer)return {x,y};
    }
    return null;
  });
  expect(point,'área livre para fechar o menu').not.toBeNull();
  await page.mouse.click(point.x,point.y);
  await expect(page.locator('#menuDismissLayer')).toBeHidden();
}
async function expectEditorFocused(page,step){
  expect(await page.evaluate(()=>document.activeElement?.id),step).toBe('editor');
}

test('editor mantém foco e seleção ao usar menus e botões da barra',async ({page})=>{
  const editor=page.locator('#editor');
  await editor.click();
  await page.keyboard.type('Foco preservado');
  for(let i=0;i<10;i++)await page.keyboard.press('Shift+ArrowLeft');
  const selected=()=>page.evaluate(()=>{
    const sel=getSelection();
    return {text:sel.toString(),inEditor:Boolean(sel.anchorNode&&document.querySelector('#editor').contains(sel.anchorNode))};
  });
  expect(await selected()).toEqual({text:'preservado',inEditor:true});

  await page.locator('#plusBtn').click();
  await expect(page.locator('#plusMenu')).toBeVisible();
  await expectEditorFocused(page,'menu +');
  for(const key of ['file','format','structure','media','interaction']){
    await page.locator(`#plusMenu [data-plus-category="${key}"]`).click();
    await expect(page.locator(`#plus-${key}-menu`)).toBeVisible();
    await expectEditorFocused(page,'submenu '+key);
    await page.locator(`#plus-${key}-menu [data-plus-back]`).click();
    await expect(page.locator('#plusMenu')).toBeVisible();
    await expectEditorFocused(page,'voltar de '+key);
  }
  await closeMenus(page);
  await expectEditorFocused(page,'fechar menu +');
  expect(await selected()).toEqual({text:'preservado',inEditor:true});

  await page.locator('#typebar [data-cmd="bold"]').click();
  await expectEditorFocused(page,'B');
  expect(await selected()).toEqual({text:'preservado',inEditor:true});
  await expect(editor.locator('strong,b')).toHaveText('preservado');

  for(const cmd of ['italic','underline']){
    await page.locator(`#typebar [data-cmd="${cmd}"]`).click();
    await expectEditorFocused(page,cmd);
  }
  expect(await selected()).toEqual({text:'preservado',inEditor:true});

  // Um item de submenu aplica o formato sem fechar o teclado.
  await page.locator('#plusBtn').click();
  await page.locator('#plusMenu [data-plus-category="format"]').click();
  await page.locator('#plus-format-menu [data-cmd="strike"]').click();
  await expect(page.locator('#plus-format-menu')).toBeHidden();
  await expectEditorFocused(page,'Riscado');

  for(const [button,menu] of [['#linkBtn','#linkMenu'],['#headingBtn','#headingMenu'],['#listBtn','#listMenu'],['#quoteBtn','#quoteMenu'],['#exportBtn','#exportMenu']]){
    await page.locator(button).click();
    await expect(page.locator(menu)).toBeVisible();
    await expectEditorFocused(page,menu);
    await closeMenus(page);
    await expectEditorFocused(page,'fechar '+menu);
  }
  await page.locator('#headingBtn').click();
  await page.locator('#headingMenu [data-block="h2"]').click();
  await expectEditorFocused(page,'Título H2');
  for(const button of ['#undoBtn','#redoBtn','#destBtn','#destBtn']){
    await page.locator(button).click();
    await expectEditorFocused(page,button);
  }
});

const MENUS=[
  ['#plusBtn','#plusMenu'],
  ...['file','format','structure','media','interaction'].map(key=>['#plusBtn',`#plus-${key}-menu`,key]),
  ['#linkBtn','#linkMenu'],['#headingBtn','#headingMenu'],['#listBtn','#listMenu'],['#quoteBtn','#quoteMenu'],['#exportBtn','#exportMenu']
];
for(const size of [{width:390,height:844},{width:390,height:500}]){
  test(`nenhum menu sai da tela em ${size.width}x${size.height}`,async ({page})=>{
    await page.setViewportSize(size);
    await page.locator('#editor').click();
    for(const [button,menu,key] of MENUS){
      await page.locator(button).click();
      if(key)await page.locator(`#plusMenu [data-plus-category="${key}"]`).click();
      await expect(page.locator(menu)).toBeVisible();
      const {boxes,view}=await page.evaluate(sel=>{
        const vv=window.visualViewport;
        const view={top:vv?vv.offsetTop:0,left:vv?vv.offsetLeft:0,width:vv?vv.width:innerWidth,height:vv?vv.height:innerHeight};
        const panel=document.querySelector(sel);
        return {view,boxes:[panel,panel.querySelector('.glass-menu-material'),panel.querySelector('.glass-menu-content')].filter(Boolean).map(el=>el.getBoundingClientRect().toJSON())};
      },menu);
      for(const box of boxes){
        expect(box.top,menu+' topo').toBeGreaterThanOrEqual(view.top-0.5);
        expect(box.left,menu+' esquerda').toBeGreaterThanOrEqual(view.left-0.5);
        expect(box.bottom,menu+' base').toBeLessThanOrEqual(view.top+view.height+0.5);
        expect(box.right,menu+' direita').toBeLessThanOrEqual(view.left+view.width+0.5);
      }
      // O último item continua alcançável por rolagem interna.
      const last=page.locator(`${menu} .menu-list > button:not([hidden])`).last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await closeMenus(page);
    }
  });
}

test('aviso de tela vertical continua no produto',async ({page})=>{
  await expect(page.locator('#deviceGate')).toHaveCount(1);
  await expect(page.locator('#deviceGateTitle')).toHaveText('Melhor em modo retrato');
});

// Um ponto fora do diálogo e fora das barras, no texto embaixo do fundo transparente.
async function outsideDialogPoint(page){
  return page.evaluate(()=>{
    const box=document.querySelector('#dialogMenu').getBoundingClientRect();
    const top=document.querySelector('.topbar').getBoundingClientRect().bottom,bar=document.querySelector('#typebar').getBoundingClientRect().top;
    const below=(box.bottom+bar)/2,above=(top+box.top)/2;
    return {x:24,y:bar-box.bottom>top-box.top?below:above,gapBelow:bar-box.bottom,gapAbove:box.top-top};
  });
}

test.describe(OFFLINE,()=>{
  test.beforeEach(async ({page})=>{
    page.volumeUp=false;
    await page.route(/\/api\/drafts\/load$/,route=>{
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type'}});
      return route.fulfill({status:page.volumeUp?404:503,contentType:'application/json',body:'{"error":"x"}',headers:{'access-control-allow-origin':'*'}});
    });
  });

  test('oferece tentar de novo e libera a edição quando o servidor volta',async ({page})=>{
    await page.goto('/index.html');
    await expect(page.locator('#dialogOk')).toHaveText('Tentar de novo');
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','false');
    page.volumeUp=true;
    await page.locator('#dialogOk').click();
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','true');
  });

  // Toque fora da escolha = Cancelar (o mesmo dismissDialog do Esc e do Voltar):
  // nunca "Tentar de novo" nem "Começar rascunho novo".
  test('toque fora da escolha cancela sem tentar de novo nem começar rascunho novo',async ({page})=>{
    let loads=0;
    page.on('request',request=>{if(request.method()!=='OPTIONS'&&request.url().endsWith('/api/drafts/load'))loads++;});
    await page.goto('/index.html');
    await expect(page.locator('#dialogOk')).toHaveText('Tentar de novo');
    await page.evaluate(()=>document.documentElement.removeAttribute('data-device-gate'));
    const url=page.url(),loadsBefore=loads;
    const point=await outsideDialogPoint(page);
    await page.mouse.click(point.x,point.y);
    await expect(page.locator('#dialogMenu')).toBeHidden();
    await page.waitForTimeout(300);
    expect(page.url(),'sem navegar para um rascunho novo').toBe(url);
    expect(loads-loadsBefore,'sem nova busca da cópia').toBe(0);
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','false');
    // Um toque no texto reabre a escolha, que continua lá depois do mesmo toque.
    await page.locator('#editor').click({position:{x:30,y:30}});
    await expect(page.locator('#dialogOk')).toHaveText('Tentar de novo');
    await page.waitForTimeout(300);
    await expect(page.locator('#dialogMenu')).toBeVisible();
  });

  for(const size of [{width:390,height:844},{width:320,height:568}])test(`o aviso cabe inteiro abaixo da barra superior em ${size.width}x${size.height}`,async ({page})=>{
    await page.setViewportSize(size);
    await page.goto('/index.html');
    await expect(page.locator('#dialogOk')).toHaveText('Tentar de novo');
    await expectDialogFits(page);
  });

  test('começar rascunho novo libera a edição sem tocar na cópia do servidor',async ({page})=>{
    // A cópia do servidor tem um docId conhecido. Depois da escolha, o volume volta
    // e oferece essa cópia: nenhum save pode sair com o docId dela.
    const remoteDoc='7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e';
    const cors={'access-control-allow-origin':'*'};
    await page.route(/\/api\/drafts\/load$/,route=>{
      if(route.request().method()==='OPTIONS'||!page.volumeUp)return route.fallback();
      const draft={version:2,name:'Cópia do servidor',html:'<p>remota</p>',dest:'telegram',telegraphPath:'',docId:remoteDoc,revision:3,importedMd:'',importedTxt:'',importedHtml:'',media:[]};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({draft,media:[]}),headers:cors});
    });
    const saves=[];
    await page.route(/\/api\/drafts\/save$/,route=>{
      if(route.request().method()==='OPTIONS')return route.fallback();
      const body=route.request().postData()||'';
      const docId=(body.match(/"docId":"([0-9a-f-]{36})"/)||[])[1]||'';
      const revision=Number((body.match(/"revision":(\d+)/)||[])[1]||0);
      saves.push(docId);
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({draft:{docId,revision}}),headers:cors});
    });
    await page.goto('/index.html');
    await expect(page.locator('#dialogCancel')).toHaveText('Começar rascunho novo');
    page.volumeUp=true;
    await Promise.all([page.waitForEvent('load'),page.locator('#dialogCancel').click()]);
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','true');
    await page.locator('#editor').click();
    await page.keyboard.type('Rascunho novo');
    await expect(page.locator('#editor')).toContainText('Rascunho novo');
    await expect(page.locator('#editor')).not.toContainText('remota');
    await expect.poll(()=>saves.length,{timeout:5000}).toBeGreaterThan(0);
    const docId=await page.evaluate(()=>JSON.parse(localStorage.getItem('rmdtxtml')).docId);
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);
    expect(docId).not.toBe(remoteDoc);
    expect(saves).not.toContain(remoteDoc);
    expect(new Set(saves)).toEqual(new Set([docId]));
  });

  // Aviso e diálogo abertos juntos (o aviso de retrato abre com a página em 1280px):
  // o toque no botão do diálogo dispara esse botão, e o aviso não some nem mexe na
  // tela no meio do gesto, porque o toque começou dentro do diálogo.
  test('com aviso e diálogo abertos, o toque no botão do diálogo dispara o botão',async ({page})=>{
    await page.goto('/index.html');
    await expect(page.locator('#dialogOk')).toHaveText('Tentar de novo');
    await page.evaluate(()=>{
      window.MDTXTRT_UI.setToast({text:'Aviso por cima',visible:true});
      const root=document.documentElement;root.removeAttribute('data-device-gate');void root.offsetWidth;root.setAttribute('data-device-gate','');
    });
    await expect(page.locator('#toast .toast-material')).toBeVisible();
    await expect(page.locator('#deviceGate .device-gate-card')).toBeVisible();
    page.volumeUp=true;
    // Clique real do mouse no centro do botão (o Playwright confere que é o botão
    // que recebe o toque, não o aviso).
    await page.locator('#dialogOk').click();
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','true');
    await expect(page.locator('#dialogMenu')).toBeHidden();
    expect(await page.evaluate(()=>({toast:window.MDTXTRT_UI.getState().toast.visible,gate:document.documentElement.hasAttribute('data-device-gate')})),
      'os avisos continuam: o toque era no diálogo').toEqual({toast:true,gate:true});
  });
});

// Toque real (iPhone/Telegram): o teclado continua aberto e cada toque ainda ativa o controle.
test.describe('toque com o teclado aberto',()=>{
  test.use({hasTouch:true});
  test('+, submenu, item, ☰ e fechar por fora mantêm #editor ativo',async ({page})=>{
    const active=()=>page.evaluate(()=>document.activeElement?.id);
    await page.locator('#editor').tap();
    await page.keyboard.type('Foco no toque');
    expect(await active()).toBe('editor');
    await page.locator('#plusBtn').tap();
    await expect(page.locator('#plusMenu')).toHaveAttribute('data-menu-open','');
    expect(await active(),'depois do +').toBe('editor');
    await page.locator('#plusMenu [data-plus-category="format"]').tap();
    await expect(page.locator('#plus-format-menu')).toHaveAttribute('data-menu-open','');
    expect(await active(),'depois do submenu').toBe('editor');
    await page.locator('#plus-format-menu [data-cmd="code"]').tap();
    await expect(page.locator('#plus-format-menu')).not.toHaveAttribute('data-menu-open','');
    expect(await active(),'depois do item').toBe('editor');
    await page.locator('#headingBtn').tap();
    await page.locator('#headingMenu [data-block="h2"]').tap();
    await expect(page.locator('#editor h2')).toHaveCount(1);
    expect(await active(),'depois do título').toBe('editor');
    await page.locator('#exportBtn').tap();
    await expect(page.locator('#exportMenu')).toHaveAttribute('data-menu-open','');
    expect(await active(),'depois do ☰').toBe('editor');
    const layer=await page.locator('#menuDismissLayer').boundingBox();
    await page.touchscreen.tap(24,layer.y+layer.height*.5);
    await expect(page.locator('#menuDismissLayer')).toBeHidden();
    expect(await active(),'depois de fechar por fora').toBe('editor');
    await page.keyboard.type('!');
    await expect(page.locator('#editor')).toContainText('!');
  });
});

// + e ☰ funcionam como interruptor: o 1º toque abre, o 2º no mesmo botão fecha,
// com estado aberto visível e sem nunca tirar o foco do editor (teclado aberto).
test.describe('+ e ☰ como interruptor com o teclado aberto',()=>{
  test.use({hasTouch:true});
  test('abrir, fechar e reabrir + e ☰ e tocar em desfazer mantêm #editor ativo',async ({page})=>{
    const active=()=>page.evaluate(()=>document.activeElement?.id);
    // Toque real no ponto do botão: com menu aberto, quem recebe é o que estiver por cima.
    const tapAt=async sel=>{
      const box=await page.locator(sel).boundingBox();
      await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
    };
    await page.locator('#editor').tap();
    await page.keyboard.type('x');
    await expect(page.locator('#undoBtn')).not.toHaveAttribute('aria-disabled','true');
    for(const [button,menu,openSel] of [['#plusBtn','#plusMenu','#plusBtn.on'],['#exportBtn','#exportMenu','#exportBtn[aria-expanded="true"]']]){
      for(let round=0;round<2;round++){
        await tapAt(button);
        await expect(page.locator(menu)).toHaveAttribute('data-menu-open','');
        await expect(page.locator(openSel)).toHaveCount(1);
        expect(await active(),`abrir ${button} (${round})`).toBe('editor');
        await tapAt(button);
        await expect(page.locator(menu)).not.toHaveAttribute('data-menu-open','');
        await expect(page.locator('#menuDismissLayer')).toBeHidden();
        await expect(page.locator(openSel)).toHaveCount(0);
        expect(await active(),`fechar ${button} (${round})`).toBe('editor');
      }
    }
    // O 2º toque no + fecha também quando um submenu do + está aberto.
    await tapAt('#plusBtn');
    await page.locator('#plusMenu [data-plus-category="format"]').tap();
    await expect(page.locator('#plus-format-menu')).toHaveAttribute('data-menu-open','');
    await expect(page.locator('#plusBtn.on')).toHaveCount(1);
    await tapAt('#plusBtn');
    await expect(page.locator('#menuDismissLayer')).toBeHidden();
    await expect(page.locator('#plusBtn.on')).toHaveCount(0);
    expect(await active(),'fechar + com submenu').toBe('editor');
    await tapAt('#undoBtn');
    await expect(page.locator('#editor')).not.toContainText('x');
    expect(await active(),'desfazer').toBe('editor');
    await expect(page.locator('#undoBtn')).toHaveAttribute('aria-disabled','true');
    await page.keyboard.type('!');
    await expect(page.locator('#editor')).toContainText('!');
  });
});

// Atalhos de Markdown digitados de verdade no início da linha (decisão do dono).
test('atalhos de Markdown no início da linha viram título, citação e listas',async ({page})=>{
  const editor=page.locator('#editor');
  await editor.click();
  const line=async(text,enters=1)=>{await page.keyboard.type(text);for(let i=0;i<enters;i++)await page.keyboard.press('Enter');};
  await line('# Título',2);
  await line('## Seção',2);
  await line('> Citação',2);
  await line('- item');
  await line('[ ] tarefa',2);
  await line('1. um');
  await line('dois',2);
  await page.keyboard.type('texto comum');
  await expect(editor.locator('h1')).toHaveText('Título');
  await expect(editor.locator('h2')).toHaveText('Seção');
  await expect(editor.locator('blockquote')).toHaveText('Citação');
  await expect(editor.locator('ul > li').first()).toHaveText('item');
  await expect(editor.locator('ul > li input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('ol > li')).toHaveText(['um','dois']);
  await expect(editor).toContainText('texto comum');
  await expect(editor.locator('h1')).not.toContainText('#');
});

// Teclado virtual simulado: visualViewport encolhe como no iPhone quando o teclado abre.
async function fakeKeyboard(page){
  await page.addInitScript(()=>{
    const vv=new EventTarget();let keyboard=0;
    for(const [key,get] of Object.entries({
      offsetLeft:()=>0,offsetTop:()=>0,pageLeft:()=>0,pageTop:()=>0,scale:()=>1,
      width:()=>document.documentElement.clientWidth,
      height:()=>document.documentElement.clientHeight-keyboard
    }))Object.defineProperty(vv,key,{get});
    Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>vv});
    window.__keyboard=height=>{keyboard=height;vv.dispatchEvent(new Event('resize'));};
  });
  await page.reload();
  await expect(page.locator('#undoBtn')).toBeVisible();
}
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

test('barra inferior acompanha o teclado, não some atrás dele e volta sem vão',async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fakeKeyboard(page);
  const barBottom=()=>page.evaluate(()=>document.querySelector('.bar-wrap').getBoundingClientRect().bottom);
  const initial=await barBottom();
  await page.locator('#editor').click();
  await page.evaluate(()=>window.__keyboard(340));await settle(page);
  const up=await barBottom();
  expect(up,'acima do teclado').toBeLessThanOrEqual(844-340+0.5);
  expect(up,'encostada no teclado, sem pular').toBeGreaterThan(844-340-60);
  // Menu aberto com o teclado em cima cabe acima da barra.
  await page.locator('#headingBtn').click();
  const menu=await page.locator('#headingMenu').boundingBox();
  const bar=await page.locator('.bar-wrap').boundingBox();
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y+menu.height,'menu acima da barra').toBeLessThanOrEqual(bar.y+0.5);
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('editor');
  await closeMenus(page);
  // Teclado fecha: a barra volta exatamente para onde estava.
  await page.locator('#editor').evaluate(el=>el.blur());
  await page.evaluate(()=>window.__keyboard(0));await settle(page);
  expect(Math.abs(await barBottom()-initial),'sem vão depois do teclado').toBeLessThan(0.5);
});

test('o cursor continua visível acima da barra enquanto se digita com o teclado aberto',async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fakeKeyboard(page);
  await page.locator('#editor').click();
  await page.evaluate(()=>window.__keyboard(340));await settle(page);
  for(let i=0;i<24;i++){await page.keyboard.type('linha '+i);await page.keyboard.press('Enter');}
  await page.keyboard.type('fim');
  await settle(page);
  const {caret,bar}=await page.evaluate(()=>{
    const range=getSelection().getRangeAt(0),rects=range.getClientRects();
    const caret=(rects.length?rects[rects.length-1]:range.startContainer.parentElement.getBoundingClientRect()).toJSON();
    return {caret,bar:document.querySelector('.bar-wrap').getBoundingClientRect().toJSON()};
  });
  expect(caret.bottom,'cursor acima da barra').toBeLessThanOrEqual(bar.top+0.5);
  expect(caret.top,'cursor abaixo da barra superior').toBeGreaterThan(0);
});

// O iPhone rola a área visível (visualViewport.offsetTop > 0) para mostrar o cursor
// com o teclado aberto. O menu tem de abrir dentro da área visível, lida na hora,
// e continuar nela quando a área muda com o menu aberto.
async function pannedKeyboard(page){
  await page.addInitScript(()=>{
    const vv=new EventTarget();let keyboard=0,top=0;
    for(const [key,get] of Object.entries({
      offsetLeft:()=>0,offsetTop:()=>top,pageLeft:()=>0,pageTop:()=>top,scale:()=>1,
      width:()=>document.documentElement.clientWidth,
      height:()=>document.documentElement.clientHeight-keyboard
    }))Object.defineProperty(vv,key,{get});
    Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>vv});
    window.__pan=(height,offset)=>{keyboard=height;top=offset;vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));};
  });
  await page.reload();
  await expect(page.locator('#undoBtn')).toBeVisible();
}
async function inVisibleArea(page,sel){
  const {box,view}=await page.evaluate(sel=>{
    const vv=window.visualViewport,box=document.querySelector(sel).getBoundingClientRect().toJSON();
    return {box,view:{top:vv.offsetTop,bottom:vv.offsetTop+vv.height}};
  },sel);
  expect(box.top,sel+' topo dentro da área visível').toBeGreaterThanOrEqual(view.top-0.5);
  expect(box.bottom,sel+' base dentro da área visível').toBeLessThanOrEqual(view.bottom+0.5);
  return box;
}
for(const mini of [false,true])test(`menu com o teclado aberto e área visível deslocada fica na área visível${mini?' (Mini App)':''}`,async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  if(mini)await page.addInitScript(()=>{
    const noop=()=>{},button={show:noop,hide:noop,onClick:noop};
    // Só o que o app lê do WebApp; qualquer outro método vira no-op.
    const webApp={initData:'query_id=test',initDataUnsafe:{},version:'6.0',platform:'ios',colorScheme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',themeParams:{},
      viewportHeight:844,viewportStableHeight:844,isExpanded:true,isFullscreen:false,isVersionAtLeast:()=>false,
      SettingsButton:button,BackButton:button,MainButton:button};
    window.Telegram={WebApp:new Proxy(webApp,{get:(target,key)=>key in target?target[key]:noop})};
  });
  if(mini)await page.route(/\/api\/telegram\/session/,route=>{
    const cors={'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'POST, OPTIONS'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}',headers:cors});
  });
  await pannedKeyboard(page);
  if(mini)await expect(page.locator('body')).toHaveClass(/\btg\b/);
  await page.locator('#editor').click();
  await page.evaluate(()=>window.__pan(340,120));await settle(page);
  // No navegador a barra sobe com o teclado. No Mini App ela segue a altura do
  // Telegram (comportamento inalterado), então só o menu é verificado.
  if(!mini)await inVisibleArea(page,'.bar-wrap');
  // A barra superior acompanha a área visível nos dois casos (no Mini App também).
  await inVisibleArea(page,'.topbar');
  await page.locator('#headingBtn').click();
  await expect(page.locator('#headingMenu')).toBeVisible();
  await inVisibleArea(page,'#headingMenu');
  // A área visível muda com o menu aberto: o menu acompanha (resize/scroll em rAF).
  await page.evaluate(()=>window.__pan(340,200));await settle(page);await settle(page);
  await inVisibleArea(page,'#headingMenu');
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('editor');
  await closeMenus(page);
});

// Citações e títulos como a plataforma de destino os mostra. Telegram: Bot API 10.3
// (RichBlockBlockQuotation, RichBlockExpandableBlockQuotation e RichBlockPullQuotation,
// "citação com texto centrado", cada uma com o crédito opcional em <cite>), medidos no
// app (referência: app Telegram iOS, print do Pi, 2026-10-03). Telegraph: core.min.css.
test('citação e citação em destaque seguem o Telegraph e o Telegram',async ({page},info)=>{
  const light=info.project.use.colorScheme==='light';
  await page.evaluate(()=>{document.querySelector('#editor').innerHTML='<h1>Título 1</h1><h6>Título 6</h6><blockquote>Citação<cite>Autor</cite></blockquote><aside>Destaque do autor</aside><blockquote expandable="">Longa</blockquote><p>texto <a href="https://telegra.ph">link</a></p>';});
  const read=()=>page.evaluate(()=>{
    // color-mix() sai como rgba() ou color(srgb …) conforme o motor: compara por canais.
    const rgba=value=>{
      const srgb=/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(value);
      if(srgb)return [...srgb.slice(1,4).map(n=>Math.round(Number(n)*255)),Math.round(Number(srgb[4]??1)*100)/100];
      const rgb=/^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(value);
      return rgb?[...rgb.slice(1,4).map(Number),Math.round(Number(rgb[4]??1)*100)/100]:value;
    };
    const ed=document.querySelector('#editor'),qe=ed.querySelector('blockquote'),ae=ed.querySelector('aside'),xe=ed.querySelector('blockquote[expandable]');
    const q=getComputedStyle(qe),a=getComputedStyle(ae),x=getComputedStyle(xe),e=getComputedStyle(ed);
    const probe=document.createElement('span');probe.style.color='var(--link)';document.body.append(probe);
    const link=rgba(getComputedStyle(probe).color);probe.remove();
    const er=ed.getBoundingClientRect(),ar=ae.getBoundingClientRect();
    const pick=c=>({bw:c.borderLeftWidth,bs:c.borderLeftStyle,bc:rgba(c.borderLeftColor),style:c.fontStyle,size:c.fontSize,
      pad:c.paddingTop+' '+c.paddingRight+' '+c.paddingBottom+' '+c.paddingLeft,margin:c.margin,radius:c.borderTopRightRadius,bg:rgba(c.backgroundColor),family:c.fontFamily});
    const an=getComputedStyle(ed.querySelector('a')),title=document.querySelector('#docName');
    const marks=['::before','::after'].map(pseudo=>{const m=getComputedStyle(ae,pseudo);return {content:m.content,w:m.width,h:m.height,left:m.left,right:m.right,top:m.top,bottom:m.bottom,bg:rgba(m.backgroundColor),mask:(m.maskImage||m.webkitMaskImage||'').startsWith('url(')};});
    const head=sel=>{const h=getComputedStyle(ed.querySelector(sel));return {size:h.fontSize,family:h.fontFamily,weight:h.fontWeight,color:rgba(h.color)};};
    const cite=getComputedStyle(qe.querySelector('cite')),citeBox=qe.querySelector('cite').getBoundingClientRect(),firstLine=qe.firstChild;
    const range=document.createRange();range.selectNodeContents(firstLine);
    return {link,editor:{size:e.fontSize,lh:Math.round(parseFloat(e.lineHeight)/parseFloat(e.fontSize)*100)/100},
      text:rgba(e.color),quoteText:rgba(q.color),family:e.fontFamily,qlh:Math.round(parseFloat(q.lineHeight)/parseFloat(q.fontSize)*100)/100,
      alh:Math.round(parseFloat(a.lineHeight)/parseFloat(a.fontSize)*100)/100,marks,h1:head('h1'),h6:head('h6'),
      cite:{display:cite.display,style:cite.fontStyle,weight:cite.fontWeight,color:rgba(cite.color),size:cite.fontSize,ownLine:citeBox.top>=range.getBoundingClientRect().bottom-0.5},title:title?rgba(getComputedStyle(title).color):null,
      anchor:{color:rgba(an.color),line:an.textDecorationLine,bw:an.borderBottomWidth,bs:an.borderBottomStyle,bc:rgba(an.borderBottomColor),size:parseFloat(an.fontSize)},
      q:pick(q),x:{...pick(x),chevron:getComputedStyle(xe,'::after').content},
      a:{...pick(a),weight:a.fontWeight,align:a.textAlign,color:rgba(a.color),lh:Math.round(parseFloat(a.lineHeight)/parseFloat(a.fontSize)*100)/100,
        top:a.borderTopStyle,bottom:a.borderBottomStyle,width:ar.width,editorWidth:er.width,leftGap:ar.left-er.left,rightGap:er.right-ar.right}};
  });
  const tint=s=>[...s.link.slice(0,3),0.1];
  // Telegram (padrão).
  let s=await read();
  // Texto e citações na fonte do sistema; títulos com serifa, H1 22pt e H6 15pt.
  const sans=/^-apple-system, BlinkMacSystemFont/;
  expect(s.family,'texto sem serifa').toMatch(sans);
  expect(s.q.family,'citação sem serifa').toMatch(sans);
  for(const [h,size] of [[s.h1,'22px'],[s.h6,'15px']]){
    expect(h).toMatchObject({size,weight:'600',color:s.text});
    expect(h.family,'título com serifa').toMatch(/^ui-serif, "?New York"?, Georgia/);
  }
  expect(s.q).toMatchObject({bw:'3px',bs:'solid',bc:s.link,style:'normal',size:'15px',pad:'4px 16px 4px 6px',radius:'8px',bg:tint(s)});
  expect(s.qlh).toBe(1.25);
  expect(s.x).toMatchObject({bw:'3px',bc:s.link,style:'normal',size:'15px',radius:'8px',bg:tint(s)});
  expect(s.x.chevron).not.toBe('none');
  expect(s.a).toMatchObject({style:'italic',weight:'400',align:'center',size:'15px',pad:'5px 30px 5px 30px',radius:'8px',bg:tint(s),bw:'0px'});
  expect(s.alh).toBe(1.42);
  // Aspas do destaque: “ no alto à esquerda e ” embaixo à direita, 12×9 na cor de link.
  const [open,close]=s.marks;
  expect(open).toMatchObject({content:'""',w:'12px',h:'9px',left:'6px',top:'6px',bg:s.link,mask:true});
  expect(close).toMatchObject({content:'""',w:'12px',h:'9px',right:'6px',bottom:'4px',bg:s.link,mask:true});
  // Crédito (<cite>, o credit da Bot API): linha própria, semi-negrito, cor secundária.
  expect(s.cite).toMatchObject({display:'block',style:'normal',weight:'600',size:'15px',ownLine:true});
  expect(s.cite.color,'crédito mais apagado que o texto').not.toEqual(s.quoteText);
  expect(s.a.top,'pílula sem linhas').toBe('none');
  expect(s.a.width,'a pílula abraça o texto').toBeLessThan(s.a.editorWidth-40);
  expect(Math.abs(s.a.leftGap-s.a.rightGap),'pílula centrada').toBeLessThanOrEqual(1);
  // Telegraph: core.min.css › .tl_article_content.
  await page.locator('#destBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-dest','telegraph');
  s=await read();
  expect(s.editor).toEqual({size:'18px',lh:1.58});
  // Cores do texto do core.min.css (claro; no escuro, as mesmas proporções do texto).
  const ink=alpha=>light?[0,0,0,alpha]:[245,245,247,alpha];
  expect(s.text,'texto do artigo').toEqual(ink(0.8));
  expect(s.quoteText,'citação herda o texto').toEqual(ink(0.8));
  expect(s.title,'título da página').toEqual(ink(0.8));
  expect(s.anchor).toMatchObject({color:ink(0.8),line:'none',bs:'solid',bc:ink(0.7)});
  // .1em de borda; o motor arredonda a espessura para pixels de tela (mínimo 1).
  const dpr=await page.evaluate(()=>devicePixelRatio),em=s.anchor.size*0.1;
  expect(parseFloat(s.anchor.bw),'borda do link de .1em').toBeGreaterThanOrEqual(Math.max(1/dpr,Math.floor(em*dpr)/dpr)-0.01);
  expect(parseFloat(s.anchor.bw),'borda do link de .1em').toBeLessThanOrEqual(em+0.01);
  const rule=light?[0,0,0,1]:[245,245,247,1];
  const plain={bw:'3px',bs:'solid',bc:rule,style:'italic',size:'18px',pad:'0px 0px 0px 15px',margin:'18px 21px 16px 0px',radius:'0px',bg:[0,0,0,0]};
  expect(s.q).toMatchObject(plain);
  expect(s.q.family).toMatch(/^Georgia, Cambria/);
  // O Telegraph não tem citação expansível: aparece como citação comum.
  expect(s.x).toMatchObject({...plain,chevron:'none'});
  expect(s.a).toMatchObject({style:'italic',weight:'400',align:'center',size:'21px',lh:1.58,color:light?[0,0,0,0.6]:[245,245,247,0.6],
    margin:'18px 21px 16px',pad:'0px 18px 0px 18px',radius:'0px',bg:[0,0,0,0],bw:'0px',top:'none',bottom:'none'});
  expect(s.a.family).toMatch(/^Georgia, Cambria/);
  expect(s.marks.map(m=>m.content),'sem aspas no Telegraph').toEqual(['none','none']);
  // O Telegraph não tem crédito: o nome fica como texto da citação, numa linha própria.
  expect(s.cite).toMatchObject({display:'block',style:'italic',weight:'400',color:s.quoteText,size:'18px',ownLine:true});
  expect(s.a.width,'destaque do Telegraph ocupa a coluna').toBeGreaterThan(s.a.editorWidth-50);
  await page.locator('#destBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-dest','telegram');
});

// O seletor Telegram/Telegraph é só uma troca: nos dois estados é um botão comum da
// barra, como o refazer, sem preenchimento nem aro de ponto estratégico.
test('seletor de plataforma sem destaque nos dois estados',async ({page})=>{
  const look=sel=>page.evaluate(sel=>{
    const el=document.querySelector(sel),cs=getComputedStyle(el),before=getComputedStyle(el,'::before');
    return {bg:cs.backgroundColor,shadow:cs.boxShadow,before:before.content==='none'||before.content==='normal'?'none':before.backgroundColor,color:cs.color};
  },sel);
  await page.mouse.move(1,400);
  const redo=await look('#redoBtn');
  for(const dest of ['telegram','telegraph']){
    await expect(page.locator('#destBtn')).toHaveAttribute('data-dest',dest);
    expect(await look('#destBtn'),'seletor em '+dest).toEqual(redo);
    await expect(page.locator(`#destBtn [data-icon="${dest}"]`)).toHaveCount(1);
    await page.locator('#destBtn').click();
    await page.mouse.move(1,400);
  }
});

// Botão de formato ligado: claro, mas neutro (sem aro nem sombra), diferente do + e do ☰.
test('estado ligado dos botões de formato não imita os pontos estratégicos',async ({page})=>{
  await page.locator('#editor').click();
  await page.keyboard.type('texto');
  await page.locator('#quoteBtn').click();
  await page.locator('#quoteMenu .menu-list > button:not([hidden])').first().click();
  await expect(page.locator('#quoteBtn.on')).toHaveCount(1);
  const s=await page.evaluate(()=>{
    const on=getComputedStyle(document.querySelector('#quoteBtn'),'::before'),plus=getComputedStyle(document.querySelector('#plusBtn'));
    const probe=document.createElement('span');probe.style.background='var(--toggle-on)';document.body.append(probe);
    const token=getComputedStyle(probe).backgroundColor;probe.remove();
    return {bg:on.backgroundColor,shadow:on.boxShadow,token,plus:plus.backgroundColor};
  });
  expect(s.bg).toBe(s.token);
  expect(s.shadow).toBe('none');
  expect(s.bg).not.toBe(s.plus);
});

// Vidro: um só aro hairline por fora (0,5px em tela 2x, 1px em 1x), nenhum brilho de
// topo, e a lente do + / desfazer / ☰ coincide com o botão (mesma caixa e raio).
test('aro hairline único, sem brilho de topo e lente alinhada ao aro',async ({page})=>{
  const r=await page.evaluate(()=>{
    const width=devicePixelRatio>=2?0.5:1,bad=[];
    const visible=shadow=>(shadow.match(/rgba?\([^)]*\)[^,]*/g)||[]).filter(part=>!/rgba\([^)]*,\s*0\)/.test(part));
    for(const el of document.querySelectorAll('.seg,.bar,.glass-menu-material,.toast-material')){
      const shadow=getComputedStyle(el).boxShadow;
      if(!shadow.includes(`0px 0px 0px ${width}px`))bad.push('aro '+el.className+': '+shadow);
      if(visible(shadow).some(part=>part.includes('inset')))bad.push('brilho interno '+el.className);
      for(const layer of el.querySelectorAll(':scope > [data-lg-layer]')){
        if(visible(getComputedStyle(layer).boxShadow).length)bad.push('borda da biblioteca visível em '+el.className);
      }
    }
    for(const sel of ['#plusBtn','#undoBtn .action-dot','#exportBtn .action-dot']){
      const host=document.querySelector(sel),lens=host.querySelector(':scope > .lens');
      const a=host.getBoundingClientRect(),b=lens.getBoundingClientRect(),ha=getComputedStyle(host),hl=getComputedStyle(lens);
      if(Math.abs(a.left-b.left)>0.01||Math.abs(a.top-b.top)>0.01||Math.abs(a.width-b.width)>0.01||Math.abs(a.height-b.height)>0.01)bad.push('lente fora do botão '+sel);
      if(ha.borderTopLeftRadius!==hl.borderTopLeftRadius)bad.push('raio da lente '+sel+' '+hl.borderTopLeftRadius+' x '+ha.borderTopLeftRadius);
      if(!ha.boxShadow.includes(`0px 0px 0px ${width}px`))bad.push('aro '+sel+': '+ha.boxShadow);
    }
    return bad;
  });
  expect(r).toEqual([]);
});

// Aviso longo em várias linhas: o texto inteiro fica dentro do vidro arredondado.
test('toast em várias linhas não corta o texto nos cantos',async ({page})=>{
  await page.evaluate(()=>window.MDTXTRT_UI.setToast({text:'Não foi possível concluir esta ação agora. Verifique a conexão e tente de novo em alguns instantes; nada do texto foi perdido.',visible:true}));
  await expect(page.locator('#toast')).toBeVisible();
  const out=await page.evaluate(()=>{
    const box=document.querySelector('#toast .toast-material').getBoundingClientRect();
    const radius=Math.min(parseFloat(getComputedStyle(document.querySelector('#toast .toast-material')).borderTopLeftRadius),box.height/2,box.width/2);
    const range=document.createRange();range.selectNodeContents(document.querySelector('#toastTextHost'));
    const inside=(x,y)=>{
      const cx=Math.min(Math.max(x,box.left+radius),box.right-radius),cy=Math.min(Math.max(y,box.top+radius),box.bottom-radius);
      return Math.hypot(x-cx,y-cy)<=radius+0.5;
    };
    const lines=[...range.getClientRects()];
    return {lines:lines.length,clipped:lines.filter(l=>![[l.left,l.top],[l.right,l.top],[l.left,l.bottom],[l.right,l.bottom]].every(([x,y])=>inside(x,y))).length};
  });
  expect(out.lines).toBeGreaterThan(1);
  expect(out.clipped).toBe(0);
});

// Título do Telegraph acima do texto: só "Título", sem rótulo pequeno, e cabe inteiro.
for(const width of [390,320])test(`título do Telegraph sem rótulo e com placeholder inteiro em ${width}px`,async ({page})=>{
  await page.setViewportSize({width,height:844});
  await page.locator('#destBtn').click();
  const input=page.locator('#telegraphTitleSlot #docName');
  await expect(input).toBeVisible();
  await input.fill('');
  await expect(input).toHaveAttribute('placeholder','Título');
  await expect(input).toHaveAttribute('aria-label','Título da página no Telegraph');
  const m=await input.evaluate(el=>{
    const cs=getComputedStyle(el),label=getComputedStyle(el.closest('.document-tools'),'::before');
    const ctx=document.createElement('canvas').getContext('2d');ctx.font=cs.font;
    if(cs.letterSpacing&&cs.letterSpacing!=='normal')ctx.letterSpacing=cs.letterSpacing;
    const text=ctx.measureText(el.placeholder);
    return {label:label.content,text:text.width,room:el.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),
      glyphs:text.actualBoundingBoxAscent+text.actualBoundingBoxDescent,height:el.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)};
  });
  expect(m.label==='none'||m.label==='normal','sem rótulo visível').toBe(true);
  expect(m.text,'placeholder cabe no campo').toBeLessThanOrEqual(m.room);
  expect(m.glyphs,'acento e letras do placeholder cabem na altura do campo').toBeLessThanOrEqual(m.height);
});

// Borda da tela: a área segura e a faixa acima/abaixo das barras são a cor sólida do
// cromo (--edge), com o texto rolando por baixo, como na main e no site HTML. Mede
// os pixels de verdade, no meio da largura (longe da sombra das pílulas).
test('borda da tela fica na cor sólida do cromo com texto rolando por baixo',async ({page})=>{
  const html=Array.from({length:40},(_,i)=>`<p><b>Parágrafo ${i}</b> eiusmod tempor incididunt ut labore et dolore magna aliqua, quis nostrud exercitation ullamco.</p>`).join('');
  await page.evaluate(h=>{document.querySelector('#editor').innerHTML=h;},html);
  const strip=await page.evaluate(()=>{
    const p=document.createElement('div');p.style.cssText='position:fixed;visibility:hidden;height:var(--gap)';document.body.append(p);
    const h=p.getBoundingClientRect().height;p.remove();return Math.floor(h);
  });
  expect(strip,'faixa sólida visível').toBeGreaterThanOrEqual(4);
  let worst={top:0,bottom:0};
  for(let step=0;step<8;step++){
    await page.evaluate(t=>{document.querySelector('.scroll').scrollTop=t;},400+step*3);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const shot=(await page.screenshot({scale:'css'})).toString('base64');
    const d=await page.evaluate(async ({b64,strip})=>{
      const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
      const probe=document.createElement('span');probe.style.color='var(--edge)';document.body.append(probe);
      const edge=getComputedStyle(probe).color.match(/\d+/g).map(Number);probe.remove();
      const left=Math.round(c.width/2-30);
      const dev=(y0,y1)=>{let max=0;for(let y=y0;y<y1;y++){const px=x.getImageData(left,y,60,1).data;for(let i=0;i<px.length;i+=4)max=Math.max(max,Math.abs(px[i]-edge[0]),Math.abs(px[i+1]-edge[1]),Math.abs(px[i+2]-edge[2]));}return max;};
      return {top:dev(0,strip),bottom:dev(c.height-strip,c.height)};
    },{b64:shot,strip});
    worst={top:Math.max(worst.top,d.top),bottom:Math.max(worst.bottom,d.bottom)};
  }
  expect(worst.top,'faixa do topo sólida (sem texto)').toBeLessThanOrEqual(4);
  expect(worst.bottom,'faixa da base sólida (sem texto)').toBeLessThanOrEqual(4);
});

// Avisos efêmeros (toast e aviso de retrato): centrados na área livre entre as barras,
// sem cobrir as barras nem +, ☰ e desfazer, também com o teclado aberto.
const NOTICES={toast:'#toast .toast-material',retrato:'#deviceGate .device-gate-card'};
async function showNotice(page,kind){
  // Em tela larga o index.html abre o aviso de retrato logo depois de carregar e o
  // tira 4,3s depois. Com a máquina carregada esse prazo caía no meio do teste e o
  // aviso sumia: o aviso do teste só aparece depois dele (ou, se o inicial não abriu,
  // 1,5s depois do DOMContentLoaded).
  if(kind==='retrato')await page.waitForFunction(()=>{
    const nav=performance.getEntriesByType('navigation')[0],now=performance.now();
    if(window.__startupGateAt!==undefined)return now>window.__startupGateAt+4400;
    return nav&&nav.domContentLoadedEventEnd>0&&now>nav.domContentLoadedEventEnd+1500;
  },null,{timeout:15000});
  await page.evaluate(kind=>{
    const root=document.documentElement;
    if(kind==='toast'){root.removeAttribute('data-device-gate');window.MDTXTRT_UI.setToast({text:'Link copiado',visible:true});}
    else{window.MDTXTRT_UI.setToast({visible:false});root.removeAttribute('data-device-gate');void root.offsetWidth;root.setAttribute('data-device-gate','');}
  },kind);
  await expect(page.locator(NOTICES[kind])).toBeVisible();
}
async function noticeLayout(page,kind){
  return page.evaluate(sel=>{
    const r=el=>{const b=document.querySelector(el).getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right};};
    return {box:r(sel),top:r('.topbar'),bar:r('#typebar'),controls:['#plusBtn','#exportBtn','#undoBtn','#redoBtn'].map(r),width:innerWidth};
  },NOTICES[kind]);
}
const overlaps=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
for(const kind of Object.keys(NOTICES))for(const keyboard of [false,true])test(`aviso efêmero (${kind}) centrado entre as barras${keyboard?' com o teclado aberto':''}`,async ({page})=>{
  for(const width of [390,320]){
    await page.setViewportSize({width,height:keyboard?568:844});
    if(keyboard){
      // Teclado de 280px: a área visual encolhe e as barras sobem com ela.
      // Espera o ajuste de viewport do redimensionamento terminar para não ser sobrescrito.
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(done,50)))));
      await page.evaluate(()=>{const s=document.documentElement.style;s.setProperty('--vv-bottom','280px');s.setProperty('--vv-height',(innerHeight-280)+'px');});
    }
    await showNotice(page,kind);
    const l=await noticeLayout(page,kind);
    expect(l.box.top,'abaixo da barra de cima').toBeGreaterThan(l.top.bottom);
    expect(l.box.bottom,'acima da barra de baixo').toBeLessThan(l.bar.top);
    for(const c of l.controls)expect(overlaps(l.box,c),'não cobre + ☰ desfazer refazer').toBe(false);
    expect(Math.abs((l.box.top+l.box.bottom)/2-(l.top.bottom+l.bar.top)/2),'centro vertical entre as barras').toBeLessThanOrEqual(1);
    expect(Math.abs((l.box.left+l.box.right)/2-l.width/2),'centro horizontal').toBeLessThanOrEqual(1);
    if(keyboard){
      expect(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--vv-bottom'))).toBe('280px');
      expect(l.box.bottom,'visível acima do teclado').toBeLessThan(568-280);
    }
  }
});

for(const kind of Object.keys(NOTICES))test(`toque fecha o aviso (${kind}) sem fechar o teclado; no aviso não chega ao texto`,async ({page})=>{
  const editor=page.locator('#editor');
  await editor.click();
  await page.keyboard.type('texto '.repeat(80));
  const before=await editor.textContent();
  // Toque fora (no ☰): fecha o aviso e o ☰ abre; o editor continua ativo.
  await showNotice(page,kind);
  await page.locator('#exportBtn').click();
  await expect(page.locator(NOTICES[kind])).toBeHidden();
  await expect(page.locator('#exportMenu')).toHaveAttribute('data-menu-open','');
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('editor');
  await closeMenus(page);
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('editor');
  // Toque no próprio aviso (sobre o texto): só fecha; o cursor não vai para baixo dele.
  await showNotice(page,kind);
  // Toque real no centro do vidro (o mouse do Playwright, sem rolar nada antes).
  const center=await page.locator(NOTICES[kind]).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
  await page.mouse.click(center.x,center.y);
  await expect(page.locator(NOTICES[kind])).toBeHidden();
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('editor');
  await page.keyboard.type('!');
  await expect(editor).toHaveText(before+'!');
});

// Legibilidade do aviso sobre o texto do documento: mede os pixels de verdade do
// vidro com o texto do aviso apagado (só o fundo composto, com o documento por
// baixo). Primeiro confirma que há texto atrás (sem o aviso, o recorte varia muito).
// Com o aviso, o texto do aviso, inclusive o secundário, tem contraste AA (4,5:1)
// contra o pior pixel do fundo composto; onde o motor pinta o backdrop-filter
// (Chromium), o texto de trás também não aparece pelo vidro (textura abaixo de 1,1:1,
// sem contar o degradê do fundo, então não depende da fonte da máquina). O WebKit do Playwright no Linux não pinta backdrop-filter nenhum, então lá
// só a tinta conta, e ela sozinha precisa garantir o contraste.
const luminance=([r,g,b])=>{const f=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
const contrast=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
async function backdropPixels(page,box){
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const shot=(await page.screenshot({clip:box,scale:'css'})).toString('base64');
  return page.evaluate(async b64=>{
    const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
    const d=x.getImageData(0,0,c.width,c.height).data,out=[];
    for(let i=0;i<d.length;i+=4)out.push([d[i],d[i+1],d[i+2]]);
    return out;
  },shot);
}
for(const kind of Object.keys(NOTICES))test(`aviso efêmero (${kind}) legível sobre o texto do documento`,async ({page,browserName})=>{
  const sel=NOTICES[kind];
  // Texto corrido e denso, sem linhas em branco, atrás de todo o aviso.
  await page.evaluate(()=>{document.querySelector('#editor').innerHTML='<p>'+'<b>Mdtxtrt</b> eiusmod tempor incididunt ut labore et dolore magna aliqua quis nostrud exercitation ullamco laboris. '.repeat(120)+'</p>';});
  await showNotice(page,kind);
  // Mede o aviso parado na tela: a saída do aviso de retrato começa 4s depois de ele
  // aparecer, e com a máquina carregada as medições passavam disso.
  await page.addStyleTag({content:`${sel}{animation:none!important}`});
  // Cores do texto do aviso já resolvidas em sRGB 0–255 com alfa (canvas normaliza
  // rgb(), color(srgb …) e color-mix()).
  const colors=await page.evaluate(sel=>{
    const el=document.querySelector(sel),c=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
    const nodes=[el,...el.querySelectorAll('*')].filter(n=>[...n.childNodes].some(t=>t.nodeType===3&&t.textContent.trim()));
    return [...new Set(nodes.map(n=>getComputedStyle(n).color))].map(css=>{c.clearRect(0,0,1,1);c.fillStyle=css;c.fillRect(0,0,1,1);const d=c.getImageData(0,0,1,1).data;return {css,rgb:[d[0],d[1],d[2]],a:d[3]/255};});
  },sel);
  expect(colors.length,'texto do aviso encontrado').toBeGreaterThan(0);
  const box=await page.locator(sel).evaluate(el=>{const r=el.getBoundingClientRect(),rad=Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||0,r.height/2);return {x:Math.ceil(r.left+rad),y:Math.ceil(r.top+3),width:Math.floor(r.width-2*rad),height:Math.floor(r.height-6)};});
  const range=px=>{const l=px.map(luminance);return Math.max(...l)-Math.min(...l);};
  const hide=await page.addStyleTag({content:`${sel}{visibility:hidden!important}`});
  expect(range(await backdropPixels(page,box)),'há texto do documento atrás do aviso').toBeGreaterThan(.3);
  await hide.evaluate(el=>el.remove());
  await page.addStyleTag({content:`${sel},${sel} *{color:transparent!important;text-shadow:none!important}`});
  const glass=await backdropPixels(page,box);
  if(browserName==='chromium'){
    // Textura que o texto de trás deixa no vidro: o mesmo recorte com a tinta do
    // documento apagada tira o degradê do fundo; o que sobra é só o texto. Abaixo de
    // 1,1:1 (medido de 1,002 a 1,053; a tinta antiga deixava de 1,34 a 5,1:1).
    const ink=await page.addStyleTag({content:'.editor,.editor *{color:transparent!important}'});
    const clean=await backdropPixels(page,box);
    await ink.evaluate(el=>el.remove());
    const ratio=glass.map((px,i)=>(luminance(px)+.05)/(luminance(clean[i])+.05));
    expect(Math.max(...ratio)/Math.min(...ratio),'o texto de trás não aparece pelo vidro').toBeLessThanOrEqual(1.1);
  }
  for(const {css,rgb,a} of colors){
    // Contraste do texto (com o próprio alfa composto sobre o pixel) contra cada pixel.
    const worst=Math.min(...glass.map(bg=>contrast(luminance(rgb.map((v,k)=>v*a+bg[k]*(1-a))),luminance(bg))));
    expect(worst,`contraste de ${css} contra o fundo composto`).toBeGreaterThanOrEqual(4.5);
  }
});

// Diálogo: texto inteiro visível (sem corte nem rolagem), abaixo da barra superior,
// acima da inferior e dentro da área visível.
async function expectDialogFits(page){
  await expect(page.locator('#dialogMenu')).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const m=await page.evaluate(()=>{
    const rect=el=>document.querySelector(el).getBoundingClientRect().toJSON();
    const body=document.querySelector('#dialogMenu .dialog'),label=document.querySelector('#dialogLabel');
    const vv=window.visualViewport;
    return {dialog:rect('#dialogMenu'),content:rect('#dialogMenu .glass-menu-content'),label:rect('#dialogLabel'),actions:rect('#dialogMenu .dialog-actions'),
      top:rect('.topbar'),bar:rect('.bar-wrap'),view:{top:vv.offsetTop,bottom:vv.offsetTop+vv.height},
      bodyOverflow:body.scrollHeight-body.clientHeight,labelOverflow:label.scrollHeight-label.clientHeight};
  });
  expect(m.dialog.top,'abaixo da barra superior').toBeGreaterThanOrEqual(m.top.bottom-0.5);
  expect(m.dialog.bottom,'acima da barra inferior').toBeLessThanOrEqual(m.bar.top+0.5);
  expect(m.dialog.top).toBeGreaterThanOrEqual(m.view.top-0.5);
  expect(m.dialog.bottom).toBeLessThanOrEqual(m.view.bottom+0.5);
  expect(m.bodyOverflow,'conteúdo sem rolagem escondida').toBeLessThanOrEqual(1);
  expect(m.labelOverflow,'texto sem corte').toBeLessThanOrEqual(1);
  expect(m.label.bottom,'texto dentro do diálogo').toBeLessThanOrEqual(m.content.bottom+0.5);
  expect(m.actions.bottom,'botões dentro do diálogo').toBeLessThanOrEqual(m.content.bottom+0.5);
}

// Safari com "Bloquear Todos os Cookies": ler o localStorage lança SecurityError e
// o IndexedDB também fica bloqueado. O app continua editável nesta sessão.
test.describe(BLOCKED,()=>{
  test.beforeEach(async ({page})=>{
    page.loads=0;
    page.on('request',request=>{if(request.url().endsWith('/api/drafts/load'))page.loads++;});
    await page.addInitScript(()=>{
      const deny=()=>{throw new DOMException('The operation is insecure.','SecurityError');};
      for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{configurable:true,get:deny});
      Object.defineProperty(IDBFactory.prototype,'open',{configurable:true,value:deny});
      window.__navigations=0;
      addEventListener('pagehide',()=>{window.__navigations++;});
    });
    await page.goto('/index.html');
    await expect(page.locator('#undoBtn')).toBeVisible();
  });

  test('um aviso claro, inteiro e abaixo da barra; edição liberada sem pausar',async ({page})=>{
    await expect(page.locator('#dialogLabel')).toContainText('bloqueando o armazenamento');
    await expect(page.locator('#dialogLabel')).toContainText('Bloquear Todos os Cookies');
    await expect(page.locator('#dialogOk')).toHaveText('Entendi');
    await expect(page.locator('#dialogCancel')).toBeHidden();
    await expectDialogFits(page);
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','true');
    expect(page.loads,'sem busca de cópia no servidor com identidade de uma sessão só').toBe(0);
    await page.locator('#dialogOk').click();
    await expect(page.locator('#dialogMenu')).toBeHidden();
    await expect(page.locator('#toast')).not.toContainText('rascunho local');
    await page.locator('#editor').click();
    await page.keyboard.type('Texto desta sessão');
    await expect(page.locator('#editor')).toContainText('Texto desta sessão');
    await page.waitForTimeout(800);
    await expect(page.locator('#toast')).not.toContainText('Não foi possível');
  });

  test('o aviso cabe inteiro numa tela de 320x568',async ({page})=>{
    await page.setViewportSize({width:320,height:568});
    await page.reload();
    await expect(page.locator('#dialogLabel')).toContainText('Bloquear Todos os Cookies');
    await expectDialogFits(page);
  });

  test('anexo fica em memória e aparece no texto sem erro de armazenamento',async ({page})=>{
    await page.locator('#dialogOk').click();
    await page.locator('#editor').click();
    // PNG 1x1 transparente.
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');
    await page.locator('#mediaInput').setInputFiles({name:'ponto.png',mimeType:'image/png',buffer:png});
    await expect(page.locator('#editor img[data-media-id]')).toHaveCount(1);
    await expect(page.locator('#editor img[data-media-id]')).toHaveAttribute('src',/^blob:/);
    await page.waitForTimeout(400);
    await expect(page.locator('#toast')).not.toContainText(/Não foi possível|armazenamento/);
  });

  test('trocar o tema não recarrega nem perde o texto',async ({page})=>{
    await page.locator('#dialogOk').click();
    await page.locator('#editor').click();
    await page.keyboard.type('Continua aqui');
    const before=await page.evaluate(()=>document.documentElement.classList.contains('dark'));
    await page.locator('#themeBtn').click();
    await expect.poll(()=>page.evaluate(()=>document.documentElement.classList.contains('dark'))).toBe(!before);
    await expect(page.locator('#editor')).toContainText('Continua aqui');
    expect(await page.evaluate(()=>window.__navigations)).toBe(0);
  });

  test('rascunho novo começa na mesma página depois de confirmar',async ({page})=>{
    await page.locator('#dialogOk').click();
    await page.locator('#editor').click();
    await page.keyboard.type('Texto antigo');
    await page.locator('#exportBtn').click();
    await page.locator('#libraryBtn').click();
    await page.locator('#libraryNew').click();
    await expect(page.locator('#dialogLabel')).toContainText('não pode ser guardado');
    await expectDialogFits(page);
    await page.locator('#dialogOk').click();
    await expect(page.locator('#editor')).not.toContainText('Texto antigo');
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','true');
    expect(await page.evaluate(()=>window.__navigations)).toBe(0);
  });
});

// O aviso de retrato só aparece em paisagem de verdade, por alguns segundos.
test.describe(GATE,()=>{
  const touchPhone=orientation=>({orientation,script:o=>{
    const real=window.matchMedia.bind(window);
    // Primeira leitura com medidas provisórias de paisagem (como o iPhone às vezes
    // entrega no DOMContentLoaded); depois do primeiro quadro, as medidas reais.
    let provisional=true;
    document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(()=>{provisional=false;}));
    window.matchMedia=query=>{
      if(query==='(pointer:coarse)')return {matches:true,media:query,addEventListener(){},removeEventListener(){}};
      if(provisional&&o==='portrait'&&query==='(orientation:landscape)')return {matches:true,media:query,addEventListener(){},removeEventListener(){}};
      return real(query);
    };
    Object.defineProperty(screen,'orientation',{configurable:true,value:{type:o==='portrait'?'portrait-primary':'landscape-primary',angle:o==='portrait'?0:90,addEventListener(){},removeEventListener(){}}});
    window.__gateSeen=false;
    new MutationObserver(()=>{if(document.documentElement.hasAttribute('data-device-gate'))window.__gateSeen=true;}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-device-gate']});
  }});

  test('iPhone em retrato com medida provisória de paisagem: sem aviso',async ({page})=>{
    await page.setViewportSize({width:390,height:844});
    const phone=touchPhone('portrait');
    await page.addInitScript(phone.script,phone.orientation);
    await page.goto('/index.html');
    await expect(page.locator('#undoBtn')).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(()=>window.__gateSeen)).toBe(false);
    await expect(page.locator('#deviceGate')).toBeHidden();
  });

  test('iPhone em paisagem: aviso aparece e some sozinho',async ({page})=>{
    await page.setViewportSize({width:844,height:390});
    const phone=touchPhone('landscape');
    await page.addInitScript(phone.script,phone.orientation);
    await page.goto('/index.html');
    await expect(page.locator('#deviceGate')).toBeVisible();
    await expect(page.locator('#deviceGateTitle')).toHaveText('Melhor em modo retrato');
    await expect(page.locator('#deviceGate')).toBeHidden({timeout:7000});
  });
});

// Pergunta com campo (link): o toque fora cancela pelo mesmo caminho do Esc
// (dismissDialog), não insere nada e não aciona o que está embaixo. O toque em si não
// solta o foco do campo (nenhum blur para o body, que fecharia o teclado); ao fechar,
// o foco vai para o mesmo lugar que o Esc o leva.
test('toque fora do diálogo de link cancela pelo caminho do Esc sem soltar o foco',async ({page})=>{
  await page.evaluate(()=>document.documentElement.removeAttribute('data-device-gate'));
  const editor=page.locator('#editor');
  await editor.click();
  await page.keyboard.type('texto');
  const openLink=async()=>{
    await page.locator('#linkBtn').click();
    await page.locator('#linkMenu [data-link-kind="url"]').click();
    await expect(page.locator('#dialogMenu')).toBeVisible();
    await expect(page.locator('#dialogInput')).toBeFocused();
  };
  await openLink();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dialogMenu')).toBeHidden();
  const afterEsc=await page.evaluate(()=>document.activeElement?.id);
  await editor.click();
  await openLink();
  await page.evaluate(()=>{window.__blurs=0;document.addEventListener('focusout',e=>{if(!e.relatedTarget)window.__blurs++;},true);});
  const point=await outsideDialogPoint(page);
  await page.mouse.move(point.x,point.y);
  await page.mouse.down();
  await expect(page.locator('#dialogInput'),'o campo continua focado durante o toque').toBeFocused();
  await page.mouse.up();
  await expect(page.locator('#dialogMenu')).toBeHidden();
  await expect(editor).toHaveText('texto');
  expect(await page.evaluate(()=>window.__blurs),'nenhum foco solto no body').toBe(0);
  expect(await page.evaluate(()=>document.activeElement?.id),'mesmo destino do Esc').toBe(afterEsc);
});
