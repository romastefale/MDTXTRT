# Relatório de auditoria — 30/09/2026

Revisão crítica feita pelos agentes Liquid Glass e MDTXTRT a pedido do proprietário, sobre `main` em `fa50339`. O objetivo é registrar por que o repositório não evolui e o que precisa sair antes de qualquer mudança visual.

## Resumo

A documentação declara que a baseline é "sempre mutável", mas os testes e o CI congelam o estado atual, inclusive os erros. O CI está verde (195 testes e `verify-surface-contract` passando) justamente sobre todos os problemas abaixo. O fork `romastefale/liquid-glass` não é usado: a dependência real é o pacote npm do autor original, com a óptica desligada.

## Decisões deliberadas do proprietário (preservar)

- Trocar o tema recarrega a página inteira.
- O zoom da página fica bloqueado.

## 1. Preservação de baseline errônea nos testes

`tests/source.test.mjs` verifica texto de CSS e JSX com regex e exige o design atual:

- `MENU_LENS` e `BAR_LENS` precisam ser exatamente `{sheen:0, glow:0, specular:0}`. Qualquer campo óptico do fork (`depth`, `curvature`, `strength`, `bend`, `frost`, `brightness`, `mapSize`, `clipToShape`, `softEdge`) faz o teste falhar.
- O aro de vidro é proibido: `--glass-hairline`, `--glass-edge`, `--glass-inner`, `border`, `box-shadow`, `inset 0 0 0 1px`, gradientes e pseudo-elementos na barra.
- Cor chapada é obrigatória: hover `background:var(--accent);color:#fff`, botão OK sólido, `+` e `.action-dot` sólidos com brilho de 70% e 80%.
- Vidro tingido é obrigatório: `--glass-tint` com 11% e 7% de destaque. O teste de "neutros" exige neutros coloridos (6% a 24% de destaque).
- Cores de marca fixas por tema (`#2B88D8` e `#269c65`), com contagem de ocorrências.
- Medidas fixas: `--menu-w:210px`, `--menu-row-h:24px`, `justify-content:space-between` na barra e sombra `0 14px 34px` no menu.
- Aviso `device-gate` de retrato com `setTimeout` de 4300 ms.
- Mutação manual de DOM do React: `exportHost.insertBefore(tools,exportAnchor)` (`index.html`, linha 530).

## 2. Travas no CI

- `scripts/verify-surface-contract.mjs` é passo obrigatório no `release-validation.yml`. Exige literalmente cerca de 20 `one('#…').addEventListener` no `app.js` e 31 `id="…"` fixos no JSX, o que congela a arquitetura imperativa por ID. Passar o estado para o React derruba o CI mesmo com o app funcionando.
- `scripts/evolution-policy.mjs` e `verify-evolution-policy.mjs` conferem booleanos como `historicalBehaviorIsNormative: false` no `RELEASE_MANIFEST.json` e montam os termos proibidos com `.join('-')` para escapar da própria busca. É uma declaração de que nada está congelado enquanto o congelamento real continua nos testes.
- `scripts/compare-historical-visual.mjs` não bloqueia (só roda com `HISTORICAL_COMPARISON_SHA` manual), mas mantém a comparação com SHAs antigos. O `BASELINE.md` ainda lista 9 SHAs históricos.

## 3. Histórico: tentativas de destravar que reforçaram a trava

- 1.061 commits, 186 deles sobre baseline, congelamento, imutabilidade ou histórico.
- `source.test.mjs` cresceu de 86 linhas e 41 asserts para 884 linhas e 631 asserts. Os `doesNotMatch` (proibições) foram de 8 para 95.
- Ciclo de restaurar e fixar: "Restore Sep 27 design baseline (#24)", "Set current visual state as baseline (#40)", "Promote PR 50 state to baseline contract", "pin dde30467 as working baseline".
- "Experiment: remove glass hairlines (#80)" apagou o aro e, no mesmo commit, criou os testes que proíbem o aro. Um experimento virou regra.
- "Align bar finish with normative Liquid Glass material (#30)" foi o commit que proibiu os campos ópticos do fork.
- O bloco "reject legacy freeze policy" / "stop freezing" (30/09, 12:07–12:32 BRT) alterou 17 arquivos, 12 deles `.md` só trocando palavras, e acrescentou 78 linhas de vigilância em `evolution-policy`. Nenhum assert de design foi removido, e o total subiu de 617 para 631.

## 4. Testes que não testam o produto

- Nenhum teste roda em navegador real. `glass-runtime.test.mjs` usa JSDOM, que não renderiza `backdrop-filter`, filtro SVG nem WebGL, e troca o `ResizeObserver` por um que não faz nada. Não consegue observar a lente.
- 555 asserções de texto estão no `source.test.mjs`, contra 41 no `editor.test.mjs`, que testa comportamento. Há 13 vezes mais testes sobre a forma do CSS do que sobre o editor funcionar.

## 5. Código que contradiz o que o projeto descreve

- `ARCHITECTURE.md`, linha 96: a dependência seria `romastefale/liquid-glass@4e7b769`. Linha 97 e `package.json`: usa-se `@samasante/liquid-glass@0.1.1` do npm. O fork nunca é instalado.
- `ARCHITECTURE.md`, linha 103: exige migrar para `refract` quando houver curvatura. O JSX tem zero `refract`, e os testes proíbem os campos necessários.
- Cabeçalho de `src/liquid-glass-ui.jsx`: "óptica fornecida exclusivamente" pela biblioteca e "copiado de GlassContextMenu.tsx", mas a lente é desligada e a aparência vem de tinta CSS inline no `index.html`.
- `ARCHITECTURE.md`, linha 42: controles emitem comandos em vez de mutação arbitrária de DOM. Na prática há mutação do DOM do React no `index.html` e no `app.js`, e o CI a exige.
- `ARCHITECTURE.md`, linha 19: proíbe preservar comportamento obsoleto. Aviso de retrato, largura fixa de 210px e hover azul chapado são preservados por teste.
- `PRODUCT_POLISH_STATUS.md` declara "ENGINEERING DELIVERY COMPLETE", enquanto `OWNER_ACCEPTANCE.md` marca navegador móvel, PWA e Mini App do Telegram como `pending`.
- README e `BASELINE.md` dizem que um PASS não pode bloquear evolução pedida. `source.test.mjs` e `verify-surface-contract.mjs` fazem exatamente isso.

## 6. Interface: erros frente ao site HTML

- Lentes com óptica desligada, vidro tingido de destaque e sem aro, onde o HTML usa refração do fork com WebGL 2, material neutro e aro fino.
- Destaque em cor chapada com texto branco dentro do vidro, e sombra pesada nos menus.
- Espaçamento irregular (`space-between`) e medidas fixas de desktop, onde o HTML usa um espaçamento uniforme.
- Aviso de "modo retrato" bloqueando o uso.
- CSS inline no `index.html`, `app.js` imperativo de 111 KB e `ui.js` de 667 KB.

## 7. Acertos do MDTXTRT (preservar)

- Tratamento de `visualViewport` e do teclado virtual.
- Retenção do foco do editor ao abrir menus, com camada de dispensa.
- Posicionamento automático dos menus.
- Áreas seguras oficiais do Telegram e continuidade do `theme-color`.
- Suporte a movimento reduzido.
- Os testes de comportamento do editor e do servidor.

## 8. Plano

1. **Passo zero:** instalar o fork de verdade (`github:romastefale/liquid-glass#<commit>`, com `prepare: tsup` no fork); apagar as regex de design do `source.test.mjs`, o `verify-surface-contract.mjs`, o aparato de `evolution-policy`, os booleanos do manifesto e a lista de SHAs do `BASELINE.md`; criar testes de regra em navegador real (Playwright em Chromium e WebKit, claro e escuro, 390px e 1280px) que verificam lente com WebGL 2 ativa, aro presente, ausência de contorno azul e de rolagem lateral, texto quebrando dentro da tela e desfazer e exportar funcionando.
2. **Fase 1:** lentes e material iguais aos do site HTML.
3. **Fases seguintes:** estado dos menus no React, fim da mutação manual de DOM e CSS fora do `index.html`.
