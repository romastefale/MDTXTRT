# Working baseline

## Baseline vigente

O estado de referência de trabalho do MDTXTRT é o commit:

`dde30467ed9b0d108bac2ae7ad9bcac1137c169e`

- Data do commit: 2026-09-28.
- Origem: merge do PR #53, `Fix dark-mode menu text contrast`.
- Finalidade: fornecer um ponto fixo, identificável e reproduzível para comparação técnica, validação de comportamento, investigação de regressões e planejamento de mudanças posteriores.

## Natureza da baseline

Esta baseline é uma referência de trabalho, não um congelamento do projeto.

O código pode continuar evoluindo depois desse commit. Correções, refatorações, alterações visuais, mudanças arquiteturais e novas funcionalidades podem ser incorporadas normalmente à `main`. Enquanto esta baseline permanecer vigente, esses estados posteriores devem ser interpretados como evolução em relação ao commit acima.

A existência desta baseline não implica que o commit esteja isento de limitações, nem que seu comportamento deva ser preservado indefinidamente. Ela estabelece apenas um ponto explícito de partida para evolução futura.

## Uso

Para inspecionar exatamente o estado da baseline:

```bash
git fetch origin
git checkout dde30467ed9b0d108bac2ae7ad9bcac1137c169e
```

Para comparar um estado posterior com a baseline:

```bash
git diff dde30467ed9b0d108bac2ae7ad9bcac1137c169e..HEAD
```

## Substituição futura

Uma nova baseline somente passa a ser vigente quando houver alteração explícita desta documentação no repositório.

A atualização deve registrar, no mínimo:

1. o SHA completo do novo commit;
2. a data ou contexto da adoção;
3. a razão da mudança de referência;
4. a relação com a baseline anterior.

Até que isso ocorra, `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` permanece sendo a baseline de trabalho documentada.
