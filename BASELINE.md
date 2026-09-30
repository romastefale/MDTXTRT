# Working baseline

## Baseline vigente

A referência visual vigente do MDTXTRT é:

`db6ae2240cbe2792bd7edb1a9c26399f068ea807`

- Data de adoção: 2026-09-30.
- Origem: estado de produção após o PR #116.
- Motivo: a baseline anterior `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` foi preservada depois de mudanças visuais deliberadas nos menus e deixou de representar corretamente o estado vigente.
- Finalidade: restabelecer uma referência visual coerente com o código atualmente aceito em produção.

## Natureza da baseline

Esta baseline é uma referência de trabalho, não um congelamento do projeto.

O código pode continuar evoluindo depois desse commit. Correções, refatorações e alterações visuais podem ser incorporadas normalmente à `main`. Quando uma mudança visual deliberada tornar a referência vigente incorreta, a baseline deve ser substituída explicitamente no repositório.

## Uso

Para inspecionar exatamente o estado da baseline:

```bash
git fetch origin
git checkout db6ae2240cbe2792bd7edb1a9c26399f068ea807
```

Para comparar um estado posterior com a baseline:

```bash
git diff db6ae2240cbe2792bd7edb1a9c26399f068ea807..HEAD
```

## Histórico

- `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` — baseline anterior após o PR #107; substituída por ter permanecido vigente após mudanças visuais posteriores.
- `aac423e012745c7873908ddc4a76371fb8218aa3` — shell translúcido consolidado após a etapa 2/6, PR #86.
- `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` — referência histórica anterior, merge do PR #53.

## Relação com a Release Anchor

A baseline visual continua sendo um contrato distinto da Release Anchor. A atualização desta referência não move nem substitui implicitamente a Release Anchor.
