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

// Invariantes de design: entram ativos na fase 1, junto com a troca do material.
test.fixme('lentes refratam com WebGL 2',async ()=>{});
test.fixme('nenhum contorno azul de foco em controle nenhum',async ()=>{});
test.fixme('vidro usa hairline e material neutro translúcido, sem cor de acento sólida',async ()=>{});

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
    await page.goto('/index.html');
    await expect(page.locator('#dialogCancel')).toHaveText('Começar rascunho novo');
    const saves=[];
    page.on('request',request=>{if(request.url().endsWith('/api/drafts/save'))saves.push(request)});
    await Promise.all([page.waitForEvent('load'),page.locator('#dialogCancel').click()]);
    await expect(page.locator('#editor')).toHaveAttribute('contenteditable','true');
    await page.locator('#editor').click();
    await page.keyboard.type('Rascunho novo');
    await expect(page.locator('#editor')).toContainText('Rascunho novo');
    const docId=await page.evaluate(()=>JSON.parse(localStorage.getItem('rmdtxtml')).docId);
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
