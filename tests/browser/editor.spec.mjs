import {test,expect} from '@playwright/test';

const OFFLINE='servidor fora do ar no primeiro acesso';

// A página roda como site estático; o SDK do Telegram fica fora do teste.
test.beforeEach(async ({page})=>{
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
  if(test.info().titlePath.includes(OFFLINE))return;
  await page.goto('/index.html');
  await expect(page.locator('#undoBtn')).toBeVisible();
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
  const {scrollWidth,innerWidth,editorOverflow}=await page.evaluate(()=>{
    const el=document.querySelector('#editor');
    return {scrollWidth:document.documentElement.scrollWidth,innerWidth,editorOverflow:el.scrollWidth-el.clientWidth};
  });
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  expect(editorOverflow).toBeLessThanOrEqual(1);
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

test('trocar o tema recarrega a página e mantém a escolha',async ({page})=>{
  const before=await page.locator('html').getAttribute('data-theme');
  await Promise.all([page.waitForEvent('load'),page.locator('#themeBtn').click()]);
  await expect(page.locator('#undoBtn')).toBeVisible();
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
    return [...document.querySelectorAll('.seg,.bar,.glass-menu-material,.toast-material')].map(el=>{
      const cs=getComputedStyle(el);
      return {
        name:el.id||el.className.split(' ')[0],
        bg:cs.backgroundColor,bgAlpha:alpha(cs.backgroundColor),
        blur:(cs.backdropFilter||cs.webkitBackdropFilter||''),
        rim:cs.boxShadow
      };
    });
  });
  expect(pieces.length).toBeGreaterThan(4);
  for(const piece of pieces){
    expect(piece.bgAlpha,piece.name+' deixa a cor passar').toBeLessThan(.75);
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
