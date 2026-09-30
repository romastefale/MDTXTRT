# Working baseline

## Baseline vigente

A referência visual vigente do MDTXTRT é:

`db6ae2240cbe2792bd7edb1a9c26399f068ea807`

- Data de adoção: 2026-09-30.
- Origem: estado de produção após o PR #116.
- Motivo: a baseline anterior `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` cobria apenas o shell fechado e deixou de representar a superfície interativa dos menus após a evolução da biblioteca/submenus.
- Escopo: shell, menu de aplicação, submenu de rascunhos/publicações, menu Plus, submenu Plus/Formatação e estados de menu em viewport reduzido representando teclado aberto, sempre em temas claro e escuro.

## Contrato visual vigente

A validação visual não é mais uma captura única do shell. O gate deve comparar, para claro e escuro:

1. shell fechado em 390×844;
2. menu de aplicação aberto em 390×844;
3. submenu de rascunhos/publicações aberto em 390×844;
4. menu Plus aberto em 390×844;
5. submenu Plus/Formatação aberto em 390×844;
6. menu de aplicação em viewport reduzido 390×430 com superfície de digitação focada;
7. submenu de rascunhos/publicações em viewport reduzido 390×430 com superfície de digitação focada.

Cada estado deve ser reproduzido deterministicamente no candidato e no commit de baseline. Divergência em qualquer estado falha o gate.

## Relação com baselines anteriores

- `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` — baseline anterior após o PR #107. Permanece como referência histórica, mas não é mais suficiente para validar os menus atuais.
- `aac423e012745c7873908ddc4a76371fb8218aa3` — shell translúcido consolidado após a etapa 2/6, PR #86.
- `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` — referência histórica anterior, merge do PR #53.

## Regra de substituição

Uma nova baseline somente passa a ser vigente quando:

1. o SHA completo é registrado neste arquivo;
2. o workflow e o manifest apontam para o mesmo SHA;
3. o conjunto de estados visuais cobertos pelo gate é explicitado;
4. a mudança passa pela suíte de regressão e pelo comparador visual;
5. a baseline anterior permanece documentada no histórico.

A baseline é um ponto de comparação, não uma declaração de que todo comportamento do commit é permanentemente correto.

## Relação com a Release Anchor

A baseline visual e a Release Anchor continuam sendo contratos distintos. A baseline define referência visual reproduzível; a Release Anchor representa o artefato de release aprovado. Uma não substitui implicitamente a outra.
