# Relatório técnico de auditoria — MDTXTRT

**Data:** 30/09/2026 · **Revisão auditada:** `main` em `fa50339` · **Autores:** agentes Liquid Glass e MDTXTRT, a pedido e com autorização do proprietário.

Este relatório é deliberadamente crítico. Todo número foi medido no repositório, e todo trecho citado tem arquivo e linha. Onde uma medição anterior da revisão estava errada, ela foi corrigida aqui.

---

## 0. Diagnóstico central

O repositório afirma uma coisa e impõe outra.

- **O que afirma.** `README.md` e `BASELINE.md` dizem que a baseline é "sempre mutável", que "bugs presentes nela continuam sendo bugs" e que um PASS automatizado não pode bloquear uma evolução pedida. O `RELEASE_MANIFEST.json` repete isso em 15 booleanos.
- **O que impõe.** O `tests/source.test.mjs` tem 622 asserts, e 537 deles são `match`/`doesNotMatch` sobre o texto do código. Eles fixam o design atual, inclusive os erros. O `scripts/verify-surface-contract.mjs` exige, por busca de texto, a arquitetura imperativa por ID. Os dois rodam no CI.
- **O resultado.** O CI está verde (195 testes e `verify-surface-contract` passando) sobre todos os problemas listados abaixo. Verde, aqui, significa apenas que o texto não mudou.
- **O fork não é usado.** O produto diz usar `romastefale/liquid-glass`, mas instala o pacote npm do autor original. E o usa num modo em que a lente não refrata o fundo, com os realces zerados.

Os 1.061 commits, 186 deles sobre baseline, congelamento, imutabilidade ou histórico, não são sinal de maturidade. São sinal de um processo que girou em torno de si mesmo: tirar uma foto do estado, transformar a foto em teste, e depois reescrever a documentação para dizer que a foto não é contrato.

---

## 1. Decisões deliberadas do proprietário (preservar)

Estas escolhas foram confirmadas pelo proprietário. Não são erros e continuam protegidas por teste:

- **Trocar o tema recarrega a página inteira** (teste "require full reload on theme switch").
- **Zoom bloqueado**: `index.html`, linha 8, com `maximum-scale=1, user-scalable=no`.

---

## 2. Dependência e uso do fork

| Ponto | Evidência | Problema |
| --- | --- | --- |
| Pacote instalado | `package.json`: `"@samasante/liquid-glass": "0.1.1"` | É o npm do autor original. O fork nunca é instalado. |
| Documentação | `ARCHITECTURE.md`, linha 96: "a dependência é `romastefale/liquid-glass` em `4e7b769`"; linha 97: "pinned as `@samasante/liquid-glass@0.1.1`" | Duas linhas seguidas se contradizem. |
| Teste que fixa o npm | `source.test.mjs`, linha 27 ("official Liquid Glass React dependencies … are pinned") e linha 595 ("architecture provenance records official package use") | Trocar para o fork quebra o CI. |
| Fork instalável? | O `package.json` do fork só tem `prepublishOnly`, e `dist/` está no `.gitignore` | Instalar via `github:` entrega um pacote sem build. O fork precisa de `"prepare": "tsup"`, que já está pronto no branch `chore/git-install-build` (`9df1c6b`). |
| Modo de uso | `src/liquid-glass-ui.jsx`, linhas 59 e 72: `<Glass optics={…}>` com filhos, sem `refract` nem `overlay` | Pela própria biblioteca (`src/Glass.tsx`, linha 1286), esse é o *wrap mode*: "os filhos SÃO a fonte refratada". A lente distorce o próprio conteúdo do menu, não o que está atrás dele. O fundo só aparece pela tinta CSS. |
| Óptica | `MENU_LENS` e `BAR_LENS` = `{sheen:0, glow:0, specular:0}` | Realce, brilho e especular desligados. O que sobra não é vidro líquido, é um retângulo tingido. |
| Refração | `rg refract src/liquid-glass-ui.jsx` retorna 0 ocorrências | Contradiz o `ARCHITECTURE.md`, linha 103, que manda migrar para `refract` quando houver curvatura. |
| Comentário do componente | `liquid-glass-ui.jsx`, linhas 6 a 12: "copiado e adaptado de `examples/GlassContextMenu.tsx`… a óptica é fornecida exclusivamente pela biblioteca" | O exemplo do fork usa óptica ativa. Aqui ela foi zerada, e a aparência vem de `--glass-tint` no `index.html`. O comentário é falso. |

---

## 3. Congelamento de design nos testes

Todos os itens abaixo estão em `tests/source.test.mjs`. O arquivo tem 44 testes, e nenhum deles abre um navegador.

| Linha | Teste | O que exige | Por que está errado |
| --- | --- | --- | --- |
| 63–80 | "React UX imports the official Glass primitive and standardizes menu optics…" | Lentes exatamente `{sheen:0,glow:0,specular:0}`. Proíbe `mapSize`, `clipToShape`, `softEdge`, `depth`, `curvature`, `dispersion`, `strength`, `bend`, `bendWidth`, `frost`, `brightness`, `sheenAngle`, `glowSpread`, `glowFalloff` e `sheenWidth`, com a mensagem "must come from GlassMaterial defaults". | Proíbe exatamente a configuração do exemplo do fork. Qualquer correção da óptica falha no CI. |
| 88–98 | "MDTXTRT contains no bespoke Liquid Glass renderer…" | Proíbe `backdrop-filter`, `feDisplacementMap`, `WebKit` e `Blink` no JSX. | Enquanto isso, o material real é tinta CSS feita à mão no `index.html`, que é justamente um renderizador próprio. O teste proíbe a palavra e deixa passar a prática. |
| 100–108 | "background keeps a centered organic accent field…" | Exatamente 3 `radial-gradient`, nas posições `at 43% 44%`, `at 59% 53%` e `at 51% 61%`. | Fixa coordenadas de gradiente. Não existe requisito de produto nesse nível. |
| 110–131 | "theme neutrals are chromatic derivatives of the active accent" | `neutral-1..4` com 6%, 10%, 16% e 24% de destaque, e `--glass-tint` com 11% (escuro) e 7% (claro). Conta as ocorrências de `#2B88D8` e `#269c65`. | "Neutros" coloridos por definição. O nome contradiz o conteúdo, e o vidro fica tingido em vez de neutro. |
| 132–160 | "bars keep the shared glass fill with no hairline stroke" | `doesNotMatch` para `--glass-hairline`, `--glass-edge`, `--glass-inner`, `border`, `box-shadow`, `inset 0 0 0 1px`, gradientes e `::before`/`::after` em `.seg`/`.bar`. | Proíbe o aro de vidro. Nasceu do commit "Experiment: remove glass hairlines" (#80): um experimento virou lei no mesmo commit. |
| 139–140 | (mesmo bloco) | Hover `background:var(--accent);color:#fff` e botão OK sólido. | Cor chapada dentro de vidro anula a translucidez. |
| 272–280 | "bottom bar uses 20px side insets… and redistributes controls" | `justify-content:space-between`. | O espaço entre os controles varia com a largura, sem ritmo uniforme. |
| 338–352 | "menus keep the same theme glass fill without a hairline stroke" | Sombra `0 14px 34px var(--menu-shadow),0 2px 6px …` e nenhum `inset`. | Sombra pesada de cartão em vez de vidro, e o aro proibido de novo. |
| 371–376 | "export and plus keep a strong accent glow in both themes" | `.more` e `.action-dot` sólidos, com brilho de 70% e 80% como string exata. | Fixa um efeito visual por texto literal. |
| 405–445 | "UI preserves compact portrait contract…" | `--menu-w:210px` e `--menu-row-h:24px` (repetidos nas linhas 427–428, 470–471 e 775–776), além do `device-gate`: um cartão de aviso de retrato que some depois de 4 s (`index.html`, linhas 127 a 140). | Medidas fixas de desktop repetidas em três testes, e um aviso transitório tratado como contrato. |
| 515 | "document title is explicit in export flow…" | A string literal `exportHost.insertBefore(tools,exportAnchor)`. | Obriga o código a arrancar à mão um nó do DOM que pertence ao React (`index.html`, linha 530). |

**Padrão:** 95 `doesNotMatch` que proíbem, e centenas de `match` que exigem strings exatas de CSS. Não se testa o que o usuário vê, e sim se o arquivo continua escrito igual.

---

## 4. Travas e teatro no CI

- **`verify-surface-contract.mjs` (95 linhas)** é passo obrigatório em `.github/workflows/release-validation.yml`, na linha 94. Exige 31 `id="…"` fixos no JSX e 18 literais como `one('#undoBtn').addEventListener` no `app.js`. Congela a arquitetura imperativa: passar o estado dos menus para o React derruba o CI mesmo com o app funcionando.
- **`evolution-policy.mjs` (103 linhas) e `verify-evolution-policy.mjs` (45)** rodam em `regression.yml` (linha 53) e `release-validation.yml` (linha 91). Conferem 15 booleanos no `RELEASE_MANIFEST.json`, como `historicalBehaviorIsNormative: false`, `futureCertificationMayFreezeProduct: false` e `everyProductStateRemainsMutable: true`. Montam os termos proibidos com `['verify','baseline','policy'].join('-')` (linhas 74 a 102) para não detectarem a si mesmos. É um mecanismo cuja única função é declarar que nada está congelado, enquanto os dois arquivos acima congelam.
- **`compare-historical-visual.mjs` (133 linhas)** não bloqueia: só roda com `HISTORICAL_COMPARISON_SHA` passado à mão e não está em nenhum workflow. Mas continua existindo como ferramenta de comparação com o passado.
- **`BASELINE.md`**, linhas 87 a 95, lista 9 SHAs históricos de "baseline anterior", mais um arquivo de fotos.
- **`validate-release-evidence.mjs` (163 linhas)** e **`verify-release-manifest.mjs` (29)** existem para validar metadados de processo, não o produto.

Somando, são cerca de 570 linhas de scripts e 98 de teste (`evolution-policy.test.mjs`) dedicadas a certificar o processo.

---

## 5. Histórico: as tentativas de destravar reforçaram a trava

- 1.061 commits, 186 deles sobre baseline, congelamento, imutabilidade ou histórico.
- `source.test.mjs` cresceu de 86 linhas e 41 asserts (8 proibições) no primeiro dia para 884 linhas e 622 asserts (95 proibições).
- **Ciclo de restaurar e fixar:** "Restore Sep 27 design baseline (#24)", "Restore baseline after interrupted device notice edit", "Set current visual state as baseline (#40)", "Promote PR 50 state to baseline contract", "pin dde30467 as working baseline". Cada rodada tira uma nova foto e a torna contrato.
- **Imutabilidade declarada abertamente** até a madrugada de 30/09: "selar SHA imutável somente após todos os gates", "alinhar publicação Telegram ao histórico imutável".
- **"Normativo" que remove a norma:** "Align bar finish with normative Liquid Glass material" (#30, 28/09 07:37 BRT) é o commit que proibiu os campos ópticos do fork.
- **Experimento que virou lei:** "Experiment: remove glass hairlines from the interface" (#80, 28/09 22:52 BRT) removeu o aro e criou, no mesmo commit, os `doesNotMatch` que o proíbem.
- **O falso destravamento (30/09, 12:07–12:32 BRT):** "reject legacy freeze policy", "stop freezing…", "remove obsolete … terminology". O diff do bloco altera 17 arquivos, e 12 deles são `.md` apenas trocando palavras. O `evolution-policy.mjs` ganhou 33 linhas e seu teste mais 45, ou seja, mais vigilância. No `source.test.mjs` saíram 7 asserts (de 629 para 622), todos sobre texto de processo e metadados. **Nenhum assert de design foi removido.**

---

## 6. Os testes não observam o produto

- **Nenhum teste roda em navegador real.** O `tests/glass-runtime.test.mjs`, o único com "glass" no nome, usa JSDOM, que não renderiza `backdrop-filter`, filtro SVG nem WebGL. Nas linhas 22 a 26, ele substitui o `ResizeObserver` por uma classe com `observe(){}` vazio, que é justamente o que a lente usa para medir a própria geometria. Esse teste só consegue confirmar que um nó existe.
- **Design só por regex:** 537 dos 622 asserts do `source.test.mjs` são regex sobre o texto do código. Nenhuma captura de tela, nenhuma medida de layout, nenhuma checagem de rolagem lateral, de contraste ou de quebra de texto.
- **Onde há cobertura real:** `editor.test.mjs` tem 427 asserts em 80 testes, e `server.test.mjs` tem 380 em 47. Esses testam comportamento e devem ser preservados.

---

## 7. Código que contradiz a própria documentação

| Documento | Afirma | Código |
| --- | --- | --- |
| `ARCHITECTURE.md`, linha 19 | Não preservar comportamento obsoleto por caminhos ocultos. | Aviso de retrato, largura fixa de 210px e hover azul chapado são preservados por teste. |
| `ARCHITECTURE.md`, linha 42 | Controles emitem comandos em vez de mutação arbitrária de DOM. | `index.html`, linha 530, move à mão um nó do React. O `app.js` tem mais 8 `insertBefore`/`appendChild`/`innerHTML` e dezenas de `classList` sobre DOM renderizado pelo React. O CI exige isso. |
| `ARCHITECTURE.md`, linhas 96–97 | Dependência é o fork. | Dependência é o npm do autor original. |
| `ARCHITECTURE.md`, linha 103 | Migrar para `refract` quando houver curvatura. | Zero `refract`, e os campos necessários são proibidos por teste. |
| `liquid-glass-ui.jsx`, linhas 6–12 | Óptica "exclusivamente" da biblioteca. | Óptica zerada, e a aparência vem de tinta CSS. |
| `source.test.mjs`, linha 110 | "Neutros". | Neutros com 6% a 24% de destaque. |
| `PRODUCT_POLISH_STATUS.md`, linha 66 | "ENGINEERING DELIVERY COMPLETE", nada pendente. | `OWNER_ACCEPTANCE.md`, linhas 26 a 28: navegador móvel, PWA instalado e Mini App do Telegram estão `pending`, que são as três plataformas do produto. |
| `README.md` / `BASELINE.md` | Um PASS não pode bloquear evolução pedida. | `source.test.mjs` e `verify-surface-contract.mjs` bloqueiam exatamente isso. |

---

## 8. Interface: erros frente ao padrão do site HTML

| Aspecto | MDTXTRT | Site HTML (referência que funcionou) |
| --- | --- | --- |
| Lente | Wrap mode, realces zerados, sem refração do fundo. | Refração do fork com WebGL 2 obrigatório. |
| Material | Tingido de destaque (`--glass-tint` 7% e 11%). | Neutro e translúcido. |
| Borda | Aro proibido por teste. | Aro fino uniforme e semitransparente. |
| Estado ativo | Cor sólida de destaque com texto branco. | Pílula de vidro suave. |
| Sombra | `0 14px 34px` no menu. | Sombra leve, sem corte. |
| Espaçamento | `space-between` e larguras fixas de 210px. | Um espaçamento único (`--pill-gap`) entre todos os itens. |
| Foco | `outline:2px solid var(--accent)` (`index.html`, linha 144), anel azul no tema escuro. | Nenhum contorno azul. |
| Fundo | 3 gradientes em coordenadas fixadas por teste. | Formas orgânicas que se fundem com a cor da barra do navegador. |

---

## 9. Arquitetura e peso

- `app.js` tem 111 KB e 2.182 linhas imperativas por ID. `server.mjs` tem 120 KB num arquivo único.
- `ui.js` tem 667 KB e está versionado no repositório. O CI o reconstrói e compara byte a byte.
- `index.html` tem 33 KB, quase todo CSS inline.
- `src/liquid-glass-ui.jsx`, com 439 linhas, renderiza a estrutura, mas o estado dos menus vive no `app.js`, que manipula o DOM do React por fora.

---

## 10. Acertos do MDTXTRT (preservar)

- `visualViewport` e teclado virtual (`interactive-widget=resizes-visual`).
- Retenção do foco do editor ao abrir e fechar menus, com camada de dispensa.
- Posicionamento automático dos menus (`placement="auto"`).
- Áreas seguras oficiais do Telegram e continuidade do `theme-color`.
- Movimento reduzido.
- Núcleo transacional do editor e testes de editor e servidor (807 asserts de comportamento).
- Contratos de publicação no Telegram e no Telegraph (proveniência durável, sem envio duplicado).

---

## 11. Plano de correção e critérios de aceite

**Passo zero — destravar (um PR)**
1. Fork: aplicar `"prepare": "tsup"` e fixar `github:romastefale/liquid-glass#<commit>` no `package.json`.
2. Apagar do `source.test.mjs` todos os asserts de valor visual (seção 3), mantendo os de dependência, segurança, Telegram e as decisões da seção 1.
3. Apagar `verify-surface-contract.mjs`, `evolution-policy.mjs`, `verify-evolution-policy.mjs`, `verify-release-manifest.mjs`, `validate-release-evidence.mjs`, `compare-historical-visual.mjs` e `evolution-policy.test.mjs`, os booleanos do manifesto e a lista de SHAs do `BASELINE.md`, e tirar os passos correspondentes dos workflows. **Manter** o `npm run build` seguido de `git diff --exit-code -- editor-core.js ui.js` (`release-validation.yml`, linha 112) e as verificações equivalentes do `regression.yml`: é um gate real, que garante que o publicado é exatamente o que sai do código-fonte, e fica mais importante com o fork compilado no `prepare`.
4. Criar testes de regra em navegador real: Playwright em Chromium e WebKit, nos temas claro e escuro, em 390px e 1280px.

**Critérios de aceite dos novos testes**
- Toda lente tem contexto WebGL 2 ativo e refrata o fundo.
- Todo vidro tem aro presente, e nenhum destaque sólido fica dentro do vidro.
- Não há contorno azul em foco.
- `scrollWidth <= innerWidth` em todas as telas, e todo texto quebra dentro da largura, sem reticências.
- Desfazer, refazer, exportar, importar e buscar funcionam por clique real.
- Trocar o tema recarrega a página, e o zoom continua bloqueado.

**Fase 1:** lentes e material com a mesma configuração do site HTML.
**Fases seguintes:** estado dos menus no React, fim da mutação manual de DOM, CSS fora do `index.html` e divisão do `app.js` e do `server.mjs` por responsabilidade.
