# ADR-0001 — Composição explícita e projeção Rich por capacidade

Status: proposto nesta edição; PR deve permanecer sem merge automático.

## Cronologia

- `new` observado em `3259f34c5d4c49a191dad0452b87c1ba98c67578`.
- PR #54: predecessor imediato, head `c120101f167385dcd091f3b490d1fc65975342e2`.
- Issue #55: decisão desta edição.
- Branch desta edição: `architecture/v3-explicit-capabilities`, criada a partir do head da #54 para preservar integralmente a versão anterior.

## Contexto

A PR #54 eliminou `install(...)` e mutação de módulos, mas concentrou o wiring em `runtime_contract.py` e introduziu `_CoreDependencies.__getattr__`. Isso mantém uma fronteira aberta: qualquer serviço pode obter atributos não declarados do módulo monolítico `main`.

Separadamente, o pipeline Rich continuou escolhendo `markdown` ou `blocks` por `contains_semantic_entities()`, cujo contrato histórico só reconhecia `<tg-entity>`. O compilador já sabia construir `<tg-button>`, portanto o recurso podia funcionar quando a função interna era invocada diretamente e falhar no caminho público com um botão isolado.

O compilador também possuía duas implementações de `<tg-button>`: a inline e a de `<tg-button-row>`, com validação divergente.

## Decisão

### 1. Borda legada única

`legacy_core_adapter.py` é o único arquivo da nova composição que conhece os nomes do módulo `main`. Ele produz `CoreRuntime`, uma dataclass imutável e fechada. Os serviços recebem somente capacidades declaradas.

A presença desse adaptador é dívida de migração explícita, não arquitetura de domínio. Remover `main` passa a significar reduzir campos do adaptador até ele ficar vazio; nenhuma camada interna precisa voltar a consultar o módulo.

### 2. Sem fallback dinâmico

`CoreDependencies` declara todos os recursos usados pelos adapters HTTP/Telegram. Não existe `__getattr__`, `globals().update`, `install(...)` nem atribuição a módulos. Novo consumo exige alteração visível do contrato e do wiring.

### 3. Análise e compilação compartilham a mesma árvore

`analyze_explicit_blocks(source)` produz `ExplicitBlockPlan` com:

- fonte;
- árvore parseada;
- motivos estruturais que exigem blocks;
- propriedade `requires_blocks`.

`rich_media` apenas consulta essa propriedade. Se blocks forem necessários, `compile_explicit_blocks(plan, ...)` recebe o mesmo plano, sem segunda detecção e sem regex específica de `<tg-entity>` no delivery.

Isso corrige por construção o caso mínimo de `<tg-button>` isolado: o botão é uma capacidade explícita da árvore e não precisa de uma entidade auxiliar para ativar o compilador.

### 4. Um botão, um construtor

Tanto o botão inline quanto `tg-button-row` usam `_inline_button()`. A regra de texto, tipos, estilos e campos opcionais fica em um único ponto.

### 5. Compatibilidade é explícita

`compile_semantic_blocks(source, ...)` e `contains_semantic_entities(source)` são mantidos apenas como shims para consumidores antigos. O pipeline novo não usa o detector legado.

## Limite desta edição

Esta mudança corrige a fronteira de composição do #54 e o roteamento Rich que o estudo revelou, mas não declara concluído o rebuild integral da #43. Em particular, o documento canônico persistente em JSON e a remoção final do adaptador legado continuam sendo etapas próprias e versionadas. Não se deve confundir esta edição com prova de conclusão dessas etapas.

## Verificação obrigatória pelo proprietário/CI

A regra da #43 impede ChatGPT de criar/executar testes nesta linha. A revisão deve executar pelo menos estes cenários, sem alterar a arquitetura para fazê-los passar:

1. pipeline público com somente `<tg-button type="callback_data" data="x">X</tg-button>`;
2. mesma entrada sem `<tg-entity>` antes ou depois;
3. projeção canônica real, sem mock de `CanonicalDocument.from_markdown()`;
4. equivalência de payload do mesmo botão inline e dentro de `<tg-button-row>`;
5. texto Rich proibido rejeitado igualmente nas duas formas;
6. comparação com o head da #54 demonstrando que o cenário 1 falha no predecessor;
7. inspeção estática confirmando ausência de `__getattr__` no novo contrato.

## Regra de merge

Não fazer merge por ChatGPT. O proprietário decide após revisão e verificação.
