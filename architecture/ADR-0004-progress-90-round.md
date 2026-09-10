# ADR-0004 — Rodada estrutural rumo a 90%

Status: em revisão
Data: 2026-09-10
Issue: #60
PR: #61
Base: `new`
Branch: `rebuild/v5-publication-runtime`
Predecessora direta: `architecture/ADR-0003-publication-runtime-v5.md`

## Regra de evidência

Esta ADR registra somente estado observável no código e na história Git. Não houve execução da aplicação, testes Python ou deploy. Portanto, “90%” nesta rodada significa estimativa de cobertura estrutural/funcional implementada, não taxa de sucesso medida em runtime.

## Implementado nesta rodada

### Histórico e sessão

- revisões persistentes passaram a guardar snapshot de nome e estado arquivado;
- renomear, arquivar e restaurar criam revisões na mesma árvore do documento;
- Undo/Redo restaura documento, nome e estado arquivado em conjunto;
- divergência entre servidor e espelho local mostra as duas versões e exige escolha explícita, sem mesclagem automática;
- cursor/seleção e bloco ativo permanecem no estado de sessão;
- IDs de nós de texto permanecem estáveis entre serializações.

Limite histórico: revisões anteriores à introdução dos snapshots não contêm os metadados históricos antigos. A migração só consegue usar o estado corrente como baseline; não inventa estados passados que não foram armazenados.

### Editor e conversão

- `raw_markdown` pode ser editado como original;
- conversão para visual passa por endpoint de revisão sem mutação implícita do rascunho;
- a revisão devolve original, Markdown convertido, texto convertido, documento canônico resultante e resíduos incompatíveis;
- aplicar a conversão ao documento exige ação explícita;
- ao colar texto com sinais de Markdown, a UI pergunta se deve permanecer literal ou passar pela revisão Markdown;
- blocos podem ser reordenados por drag-and-drop;
- exclusão do bloco ativo oferece Undo temporário preservando posição e conteúdo;
- durante seleção de texto, o arraste de bloco é suspenso para deixar o `contenteditable` usar o movimento nativo do trecho selecionado.

O movimento nativo de texto está estruturalmente habilitado, mas não foi executado no cliente nesta rodada; não é apresentado como comportamento runtime verificado.

### Rascunhos

- rascunho vazio recebe nome automático com data/hora no fuso `America/Sao_Paulo`;
- conteúdo importado deriva nome de até 40 caracteres, com corte em palavra quando possível, ou do primeiro elemento estrutural reconhecido;
- exclusão definitiva exige confirmação explícita e permanece distinta de arquivamento;
- arquivos originais importados podem ser listados e baixados byte a byte após verificação SHA-256;
- duplicação exige confirmação, cria outro `document.id`, copia BLOBs para o novo rascunho e remapeia `media_blob_id`;
- links públicos de mídia não são herdados pela cópia; a cópia começa privada.

### Mídia

- arquivo local original pode ser baixado pela UI;
- substituir mídia cria novo BLOB imutável e registra o vínculo com a versão anterior;
- a versão anterior não é sobrescrita;
- a UI expõe substituição explícita e informa que a versão anterior será preservada;
- exclusão definitiva remove primeiro vínculos de versionamento do próprio rascunho para não depender da ordem de cascatas do SQLite.

### Importação

- pendentes continuam persistentes e possuem SHA-256 dos bytes originais;
- reentrega da mesma mensagem Telegram resolve para a mesma origem;
- retry Web App de encoding reutiliza o mesmo pendente não concluído quando proprietário, nome e SHA-256 coincidem;
- conclusão concorrente usa claim persistente com token e expiração; uma segunda conclusão simultânea não deve criar outro rascunho enquanto o claim estiver ativo;
- o claim é liberado em erro tratado pelo serviço.

Limite ainda conhecido: um encerramento abrupto exatamente depois da criação do rascunho/import e antes da marcação final do pendente não é uma transação SQLite única entre todas essas operações. O claim reduz concorrência, mas não transforma esse intervalo em atomicidade de crash.

### Pós-publicação

Após publicação/edição bem-sucedida, a UI oferece explicitamente continuar editando, arquivar o rascunho ou começar um novo.

## UI modular sem monkey patch

`static/lifecycle_ui.js` é um controlador explícito da UI atual para ações de ciclo de vida. Ele é carregado declarativamente por `index.html`; não importa nem altera `main.py`, não substitui funções do runtime e não segue a sequência `ui.N.js` usada pela arquitetura legada.

## PR e concorrência

O PR #61 foi aberto como draft, de `rebuild/v5-publication-runtime` para `new`. Não foi mergeado e não há autorização de merge pelo ChatGPT.

As alterações concorrentes do proprietário em `README.md` e `COMPATIBILITY.md` foram preservadas anteriormente; `new` foi incorporada à história da branch sem force. A sincronização deve ser conferida novamente antes de qualquer conclusão futura.

## Pendências que formam o restante do escopo

As principais lacunas estruturais ainda abertas são:

- editor paralelo completo de original e convertido, incluindo edição do convertido e escolha “somente esta saída” versus “aplicar ao documento principal”, com revisão de perda na volta;
- prévia de falha parcial de importação antes da criação definitiva do rascunho em todos os casos;
- preferências persistentes do usuário para escolhas de conversão;
- alternativas completas de representação Telegram na revisão (Rich Markdown recomendado quando lossless, HTML e Blocks como alternativas reais), em vez de uma única projeção principal;
- distinção completa na UI entre editar publicação existente e republicar Telegram como nova mensagem;
- atomicidade de crash da conclusão de import pendente;
- restauração/seleção visual de versões anteriores de mídia, embora o histórico e os BLOBs já estejam preservados;
- execução real ainda não verificada por determinação do usuário.

## Estimativa estrutural após esta rodada

Considerando as decisões de #43 e as integrações v5 como conjunto, a cobertura estrutural é estimada em aproximadamente **90%**, com margem de cerca de 2 pontos percentuais. Essa estimativa não é resultado de testes, telemetria ou execução e não deve ser convertida em alegação de confiabilidade runtime.

A parcela restante é concentrada sobretudo no fluxo avançado de conversão/republicação e na atomicidade extrema de importação, e não mais em regressões básicas de mídia, Location/Venue, histórico, sessão ou importação comum.
