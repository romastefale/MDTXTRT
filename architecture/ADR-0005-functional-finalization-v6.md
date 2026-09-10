# ADR-0005 — Finalização funcional v6

Status: em revisão
Data: 2026-09-10
Issue: #60
Base: `new`
Branch: `rebuild/v6-functional-finalization`
Predecessora direta: `architecture/ADR-0004-progress-90-round.md`

## Objetivo desta etapa

Transformar as integrações v5/v6 já construídas em um fluxo utilizável de ponta a ponta, sem reintroduzir `install(main)`, monkey patch, concatenação `ui.N.js`, detector paralelo de formato ou dependência do runtime legado.

Esta versão foi criada a partir do head `d8cfb4818b9997df8d2e20a628999ae61e4b2ec8` da continuação v5. A branch anterior permanece preservada.

## Regra de verificação

Por ordem do usuário, não foram criados nem executados testes Python, não houve execução da aplicação, deploy ou merge. As afirmações abaixo são de conformidade estrutural observável em código, rotas, dependências e história Git; não são alegações de comportamento runtime medido.

## Conversão original ↔ convertido

- `conversion_workflow.py` passou a oferecer revisão inicial, revisão da versão convertida editada e revisão canônica explícita.
- O usuário pode editar o original e reconverter.
- O usuário pode editar o convertido antes de decidir seu destino.
- Reaplicação ao documento principal sinaliza alterações estruturais observadas e exige nova confirmação quando aplicável.
- A opção `somente nesta saída` usa `document_override`; não grava silenciosamente a conversão no documento autoritativo.
- O evento de publicação registra SHA-256 e o documento canônico efetivamente usado quando existe override.
- A preferência `raw_markdown_apply_mode` pode ser persistida por `user_id`; continua sendo apenas valor inicial de UI e nunca substitui confirmação explícita.

## Telegram Bot API 10.3

- A projeção parte de uma única árvore canônica.
- A revisão oferece Rich Markdown, Rich HTML e Blocks tipados como planos distintos.
- Rich Markdown é recomendado quando a representação é exata.
- Blocks só é oferecido quando cada nó possui construção tipada suportada pelo planejador; tipos não cobertos tornam a alternativa indisponível em vez de serem achatados silenciosamente.
- A UI permite escolher uma representação disponível antes da publicação.
- A representação escolhida pode ser memorizada como preferência por usuário.
- Editar publicação Telegram existente e republicar como nova mensagem são ações separadas.
- Republicar cria novo registro de publicação e não sobrescreve o vínculo anterior.

## Telegraph

- `document_override` também pode ser usado apenas naquela saída.
- Publicação vinculada pode atualizar a página existente; a UI também permite criar nova página a partir do mesmo rascunho.
- Mídia local continua exigindo criação explícita de link público antes de Telegraph.

## Importação

- `.md`/`.txt` passam pelo fluxo explícito `stage → preview → complete` na UI principal.
- Encoding não UTF-8 exige escolha; não é adivinhado.
- Conversão parcial de Markdown é mostrada antes da criação definitiva do rascunho.
- `requires_confirmation` e o alias de fronteira `requires_partial_confirmation` representam a mesma decisão; a semântica interna continua única.
- A conclusão autorizada usa a unidade transacional criada na rodada anterior para gravar pendente, rascunho, branch, revisão inicial, bytes originais e conclusão na mesma transação SQLite.
- O fluxo do bot e a página dedicada de import pendente usam a mesma persistência.

## Sessão e preservação local

- Resposta HTTP 401 no editor preserva imediatamente o espelho local e interrompe novas gravações automáticas com a credencial expirada.
- A UI instrui a reabrir o Mini App pelo Telegram.
- Na reabertura, a divergência entre servidor e espelho local continua sendo mostrada para escolha explícita, sem merge automático.

## Rascunhos e mídia

- Novo, listar, arquivar/restaurar, excluir definitivamente e Undo/Redo permanecem no editor principal.
- Duplicação explícita continua no controlador de ciclo de vida.
- Arquivo original importado voltou a estar acessível diretamente na lista de rascunhos.
- Mídia local mantém download original, substituição imutável, histórico e restauração de versão.
- Restaurar uma versão antiga cria outra versão atual; não sobrescreve nem apaga a versão que estava corrente.

## Frontend

`static/app.js` foi substituído como implementação principal v6, em vez de adicionar uma camada que sobrescrevesse listeners/funções do editor anterior. Ele consome diretamente as APIs de conversão, importação, preferências e publicação desta versão.

`static/lifecycle_ui.js` continua como controlador explícito apenas das ações especializadas de ciclo de vida que já possuía: duplicação, original de import e versionamento/substituição de mídia. Não importa nem altera `main.py` e não substitui funções do runtime.

## Limites deliberadamente deixados para etapas futuras

A etapa é estruturalmente funcional, mas não declara teto absoluto. Permanecem principalmente melhorias/expansões que não impedem o fluxo principal:

1. substituir prompts/confirms auxiliares restantes do controlador de ciclo de vida por componentes visuais próprios e acessíveis;
2. oferecer comparação visual semântica mais rica do que texto/JSON em algumas revisões e divergências;
3. ampliar a cobertura Blocks para novos tipos que venham a ser confirmados nas APIs futuras, mantendo a regra de não aproximar silenciosamente;
4. melhorar o editor paralelo para uma superfície dedicada de duas colunas em telas grandes; funcionalmente original e convertido já são editáveis no mesmo fluxo;
5. a opção de conversão `somente nesta saída` para um trecho Markdown recém-colado ainda merece uma semântica de inserção efêmera específica; o fluxo de `raw_markdown` existente no documento já produz override do documento completo corretamente;
6. execução real da aplicação, telemetria e confiabilidade runtime continuam não verificadas por determinação explícita do usuário.

## Critério de conclusão desta etapa

Considera-se esta etapa estruturalmente finalizada quando a branch contém os contratos e a UI acima, permanece baseada em `new`, possui PR draft próprio e não é mergeada pelo ChatGPT. Etapas futuras devem continuar desta versão ou de eventual merge feito pelo proprietário, preservando esta ADR e a predecessora.