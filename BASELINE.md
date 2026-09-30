# Working baseline

## O que “baseline” significa neste repositório

A baseline do MDTXTRT é **sempre uma base mutável para evolução**. Esta regra é permanente: vale para o estado atual e para todo estado futuro que venha a ser implementado, aceito, certificado ou publicado.

Ela **nunca se torna uma base imutável**. Nenhum PASS, release, certificação, SHA, tag, aprovação ou evidência futura pode converter um estado do produto em fronteira normativa contra mudanças posteriores.
Ela **não é um estado que deve ser preservado**.
Ela **não é uma especificação do resultado futuro**.
Ela **não transforma o comportamento existente em requisito**.
Ela **não limita correções, refinamentos, substituições ou novas implementações**.

A função da baseline é exclusivamente estabelecer **de onde a evolução parte**. O trabalho novo deve partir do estado atual, preservar apenas os contratos que continuam intencionais e alterar tudo o que precisar ser alterado para chegar ao comportamento atualmente requerido.

Em outras palavras:

> **Baseline = ponto de partida para evolução, não ponto de chegada nem fronteira de mudança.**

## Comparação histórica opcional

Nenhum SHA histórico é associado permanentemente à baseline de trabalho. Quando uma investigação exigir comparação com um estado anterior, forneça explicitamente o SHA desejado ao diagnóstico. Essa escolha vale apenas para aquela investigação e não atualiza, redefine ou limita a base corrente.

A baseline operacional é sempre o estado corrente a partir do qual a próxima mudança será implementada.

## Regra central de evolução

Toda alteração deve responder à pergunta: **qual é o comportamento correto que queremos a partir de agora?**

Não à pergunta: **como fazemos para continuar iguais à baseline?**

Portanto:

1. requisito atual e correção explícita definem o comportamento pretendido;
2. contratos intencionais vigentes devem ser preservados quando continuam aplicáveis;
3. comportamento meramente existente no snapshot não ganha status de contrato;
4. defeitos, limitações, decisões superadas e implementações incidentais devem poder ser removidos ou substituídos;
5. testes, snapshots e documentação que codifiquem comportamento superado devem evoluir junto com o produto;
6. compatibilidade retroativa só deve existir quando for um requisito atual explícito, e não para proteger a baseline;
7. depois que uma evolução deliberada for aceita, o novo estado passa a ser o ponto de partida para evoluções seguintes e a referência anterior passa a ser histórica.

### Consequência obrigatória

**Nenhuma mudança solicitada deve ser rejeitada, enfraquecida, desviada ou implementada parcialmente com a justificativa de “preservar a baseline”.**

Se a implementação correta exigir divergir da baseline, **a implementação deve divergir da baseline**.

Se um teste exigir o comportamento antigo, **o teste deve ser atualizado** quando esse comportamento deixou de ser requisito.

Se uma arquitetura antiga impedir a implementação correta, **a arquitetura pode ser refatorada ou substituída**.

Se a baseline contiver um bug, **o bug deve ser corrigido**.

Se a evolução tornar a referência atual obsoleta, **a baseline deve avançar**.

## O que deve e não deve sobreviver à evolução

A baseline não determina o que deve sobreviver. Quem determina isso são os contratos intencionais atuais.

Preserve:
- invariantes e contratos que continuam explicitamente válidos;
- dados e compatibilidades cuja preservação seja requisito atual;
- comportamento correto que não conflite com a evolução solicitada.

Não preserve apenas por existir:
- bugs;
- limitações técnicas;
- estrutura interna;
- decisões de implementação;
- aparência ou interação superada;
- testes obsoletos;
- fallbacks históricos;
- compatibilidade sem requisito;
- qualquer comportamento incidental do snapshot.

## Regra para agentes e assistentes

Ao receber uma solicitação de evolução, use a baseline para entender o estado inicial e o impacto da mudança. **Nunca a use como veto à mudança.**

A baseline responde “de onde estamos partindo?”. O requisito atual responde “para onde devemos ir?”. Quando houver diferença entre os dois, essa diferença é o espaço de implementação — não uma razão para preservar o estado anterior.

Não use `main`, o SHA da baseline, testes existentes, screenshots, documentação histórica ou um PASS automatizado como argumento suficiente para afirmar que o comportamento existente deve continuar.

## Uso técnico

## Histórico

- `ac0f66ccb5bdd49fb4cd744403dac79d8d1965ce` — candidato funcional usado durante o PR #126; substituído pelo merge publicado e validado em produção `977d61554f75c943b626f89fe871bb3becae75f1`.
- `6742ec104de353d2f19507436fe352b0e0fd1a71` — baseline anterior do editor nativo pós-PR #125; substituída após tornar obrigatório o recarregamento completo na troca de tema e eliminar referências operacionais concorrentes de baseline.
- `9c9f8d38313d5f0043283daf06d6ac015f90bded` — baseline anterior após o PR #123; substituída pelo estado funcional candidato do PR #125, que removeu o motor de edição legado e consolidou os contratos nativos/oficiais sem preservar as limitações anteriores.
- `7fe51e8401012232281db416ac0d9bd080c18ebf` — baseline anterior após o PR #120; substituída após a evolução dos comandos privados do bot nos PRs #122 e #123, incluindo remoção dos caminhos legados e consolidação dos botões `web_app`.
- `b22aee80bbaa79db63d12ef62ae523d968218aa5` — baseline anterior após o PR #118; substituída após tornar Rascunhos recolhível com a mesma normativa de Publicações no PR #120.
- `db6ae2240cbe2792bd7edb1a9c26399f068ea807` — baseline anterior após a correção do toque móvel real no PR #118.
- `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` — baseline histórica após o PR #107.
- `aac423e012745c7873908ddc4a76371fb8218aa3` — shell translúcido consolidado após a etapa 2/6, PR #86.
- `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` — referência histórica anterior, merge do PR #53.

## Relação com Release Anchor e validação

Baseline de trabalho, evidência histórica de release, testes automatizados e evidência de produção têm funções distintas. Nenhum SHA histórico ou comparação histórica define a baseline corrente, e nenhum deles pode bloquear por si só a evolução requerida.


## Invariante permanente de mutabilidade

Esta política não descreve apenas o candidato atual. Ela é uma propriedade permanente do repositório:

- todo estado do produto permanece substituível por uma evolução posterior;
- toda mudança requerida continua admissível independentemente do estado histórico;
- uma evolução correta pode ser promovida mesmo quando diverge de qualquer release, baseline, teste, screenshot ou SHA anterior;
- certificação e aprovação registram evidência; nunca concedem poder de congelamento;
- nenhum mecanismo futuro deve condicionar a permissão de mudar ou promover à paridade com um estado anterior.

Se um teste, workflow, documento ou script futuro contradizer esta seção, esse mecanismo está regressivo e deve ser corrigido para restaurar a mutabilidade permanente.
