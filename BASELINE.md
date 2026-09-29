# Working baseline

## Baseline vigente

O estado de referência de trabalho do MDTXTRT é o commit:

`aac423e012745c7873908ddc4a76371fb8218aa3`

- Data do commit: 2026-09-29.
- Origem: `main` após a integração da etapa 2/6, PR #86.
- Finalidade: fornecer um ponto fixo, identificável e reproduzível para comparação técnica, validação de comportamento, investigação de regressões e planejamento de mudanças posteriores.
- Design: shell translúcido consolidado antes da correção de fullscreen/viewport da etapa 3/6.

## Natureza da baseline

Esta baseline é uma referência de trabalho, não um congelamento do projeto.

O código pode continuar evoluindo depois desse commit. Correções, refatorações, alterações visuais, mudanças arquiteturais e novas funcionalidades podem ser incorporadas normalmente à `main`. Enquanto esta baseline permanecer vigente, esses estados posteriores devem ser interpretados como evolução em relação ao commit acima.

A existência desta baseline não implica que o commit esteja isento de limitações, nem que seu comportamento deva ser preservado indefinidamente. Ela estabelece apenas um ponto explícito de partida para evolução futura.

## Uso

Para inspecionar exatamente o estado da baseline:

```bash
git fetch origin
git checkout aac423e012745c7873908ddc4a76371fb8218aa3
```

Para comparar um estado posterior com a baseline:

```bash
git diff aac423e012745c7873908ddc4a76371fb8218aa3..HEAD
```

## Substituição futura

Uma nova baseline somente passa a ser vigente quando houver alteração explícita desta documentação no repositório.

A atualização deve registrar, no mínimo:

1. o SHA completo do novo commit;
2. a data ou contexto da adoção;
3. a razão da mudança de referência;
4. a relação com a baseline anterior.

Até que isso ocorra, `aac423e012745c7873908ddc4a76371fb8218aa3` permanece sendo a baseline de trabalho documentada.

## Substituição aprovada em 2026-09-29

A baseline anterior `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` (merge do PR #53, em 2026-09-28) permanece imutável como referência histórica. Após essa referência, alterações visuais foram integradas ao shell, incluindo material e composição de controles, menus e toast. A comparação de release com o SHA antigo já falhava antes das etapas 1–3 deste roteiro.

O usuário autorizou preservar o design translúcido atual e permitir sua evolução. O SHA acima fixa exatamente o `main` integrado antes da etapa 3, sem importar alterações desta etapa como referência. No run `36595901636`, os screenshots light/dark da etapa 3 tiveram os mesmos hashes já registrados na etapa 1 (`27bcc73e…` e `301f4225…`), demonstrando ausência de mudança visual produzida pela correção de fullscreen/viewport. O novo gate compara o candidato com o estado consolidado, mantendo a exigência de identidade visual para mudanças comportamentais.

Esta adoção não altera a Release Anchor anteriormente selada nem reclassifica testes físicos como concluídos. Um novo candidato de release deverá passar todos os gates contra a referência aprovada.

## Relação com a Release Anchor

Esta baseline continua sendo o contrato visual de referência e não é substituída implicitamente pela validação final de release.

A configuração candidata à liberação usa uma **Release Anchor** separada, definida em [RELEASE_ANCHOR.md](RELEASE_ANCHOR.md). A Release Anchor é identificada por SHA completo e incorpora as etapas de evolução e as correções processuais da Gap Analysis. Seu papel é fixar a configuração técnica da validação final; seu SHA não redefine implicitamente a baseline visual vigente.

Se uma validação externa revelar defeito após a selagem, a âncora anterior permanece imutável e uma nova âncora substituta deve ser criada e revalidada.
