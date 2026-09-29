# Working baseline

## Baseline vigente

O estado de referência visual de trabalho do MDTXTRT é o commit:

`1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad`

- Data do commit: 2026-09-29.
- Origem: implementação incremental do PR #107 antes da atualização documental da própria baseline.
- Finalidade: fornecer um ponto fixo, identificável e reproduzível para comparação técnica e visual depois da introdução do menu de aplicação e da biblioteca integrada de rascunhos/publicações.
- Design: preserva o baseline Liquid Glass vigente e incorpora apenas as mudanças visuais deliberadas desta evolução: ícone hambúrguer no controle superior, acesso à biblioteca pelo menu, cápsulas de navegação/gerenciamento e cards responsivos.

## Natureza da baseline

Esta baseline é uma referência de trabalho, não um congelamento do projeto.

O código pode continuar evoluindo depois desse commit. Correções, refatorações, alterações visuais, mudanças arquiteturais e novas funcionalidades podem ser incorporadas normalmente à `main`. Enquanto esta baseline permanecer vigente, estados posteriores devem ser interpretados como evolução em relação ao commit acima.

A existência desta baseline não implica que o commit esteja isento de limitações, nem que seu comportamento deva ser preservado indefinidamente. Ela estabelece um ponto explícito de partida para validação visual futura.

## Uso

Para inspecionar exatamente o estado da baseline:

```bash
git fetch origin
git checkout 1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad
```

Para comparar um estado posterior com a baseline:

```bash
git diff 1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad..HEAD
```

## Substituição futura

Uma nova baseline somente passa a ser vigente quando houver alteração explícita desta documentação no repositório.

A atualização deve registrar, no mínimo:

1. o SHA completo do novo commit;
2. a data ou contexto da adoção;
3. a razão da mudança de referência;
4. a relação com a baseline anterior.

Até que isso ocorra, `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` permanece sendo a baseline de trabalho documentada.

## Substituição aprovada em 2026-09-29 — menu e biblioteca integrados

A baseline anterior `aac423e012745c7873908ddc4a76371fb8218aa3` permanece imutável como referência histórica do shell translúcido consolidado. O PR #107 introduz uma mudança visual deliberada e localizada: o controle circular superior deixa de representar “exportar” e passa a representar o menu da aplicação, e a biblioteca de rascunhos/publicações ganha navegação e gerenciamento em cápsulas Liquid Glass e cards responsivos.

O commit `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` é o primeiro estado desta implementação que passou a suíte completa de regressão e a verificação de reprodutibilidade dos bundles no runtime contratado. O comparador visual contra `aac423e012745c7873908ddc4a76371fb8218aa3` falha por diferença intencional de superfície; por isso a referência é atualizada explicitamente, em vez de enfraquecer ou remover o gate.

A mudança de baseline não altera a Release Anchor, não certifica testes físicos/externos e não transforma a biblioteca em um novo armazenamento. Ela apenas atualiza a referência visual para a implementação incremental aprovada neste PR.

## Histórico

- `aac423e012745c7873908ddc4a76371fb8218aa3` — shell translúcido consolidado após a etapa 2/6, PR #86.
- `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` — referência anterior do merge do PR #53.

## Relação com a Release Anchor

Esta baseline continua sendo o contrato visual de referência e não é substituída implicitamente pela validação final de release.
