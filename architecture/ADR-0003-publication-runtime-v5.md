# ADR-0003 — Runtime canônico de publicação v5

Status: em revisão
Data: 2026-09-10
Issue: #60
Base: `new`
Branch: `rebuild/v5-publication-runtime`
Predecessores: #43, #57 e PR #58

## Contexto

O PR #58 criou a fundação `mdtxtrt/`, mas declarou explicitamente que a integração completa de Telegram/Telegraph, mídia, Location/Venue e importação pelo bot ainda não estava concluída. Esta rodada continua essa fundação sem voltar ao runtime legado e sem introduzir `install(main)`, monkey patch, wrappers de comportamento ou concatenação de `ui.N.js`.

O usuário também alterou `new` durante o desenvolvimento desta branch. Os commits atuais de `new` foram incorporados à história da branch sem force e sem sobrescrever o conteúdo mais recente de `README.md` e `COMPATIBILITY.md`.

## Decisão

A composição de produção passa por `app.py` e instancia explicitamente:

- `SQLiteRepository`;
- `AssetService`;
- `PendingImportStore`;
- `DocumentService`;
- `ImportService`;
- `TelegramPublicationService`;
- `TelegraphPublicationService`, quando a chave existe;
- `TelegramRuntime`;
- o servidor aiohttp criado por `mdtxtrt.server.create_web_app`.

`Procfile` inicia `python app.py`. O caminho novo não importa `main.py`, `runtime_v2.py` ou os módulos de composição legados.

## Telegram Bot API 10.3

A representação canônica é projetada deterministicamente para Rich HTML. A publicação usa APIs públicas do aiogram 3.31.0: `Bot.send_rich_message`, `InputRichMessage` e, para edição, `rich_message` em `edit_message_text`.

Mídia local é preservada como BLOB pertencente ao `user_id` e ao rascunho, com SHA-256. Na publicação Telegram o BLOB é verificado e ligado ao Rich HTML por `InputRichMessageMedia` e referências `tg://photo?id=`, `tg://video?id=`, `tg://document?id=` ou `tg://audio?id=`. Não é necessário criar URL pública para o Telegram.

A fronteira de publicação valida os limites Rich relevantes representados pelo documento: 500 blocos, profundidade, quantidade de mídia, colunas de tabela, quantidade/alinhamento de botões, tipos de botão, estilo `link` somente em callback, `callback_data` de 1–64 bytes e URLs obrigatórias.

## Mídia e Telegraph

URLs públicas de BLOB são opt-in, usam token aleatório sem expor ID interno e podem ser revogadas. O host público é derivado de `WEB_APP_URL`, não de cabeçalhos encaminhados pelo cliente.

Telegraph permanece por usuário. O token da conta é persistido criptografado com AES-256-GCM. Publicações e edições continuam ligadas a `user_id`, `draft_id` e revisão. Mídia local sem URL pública explícita bloqueia a projeção Telegraph em vez de ser silenciosamente descartada.

## Location e Venue

O editor cria uma solicitação de localização vinculada ao usuário e ao rascunho. O bot solicita que o usuário envie a Location/Venue pelo mecanismo nativo do Telegram. A resposta preenche a solicitação pendente e a UI a transforma em bloco de mapa canônico. Entrada manual de latitude/longitude permanece apenas como fallback explícito.

## Importação

`.md` é interpretado como Markdown de forma loss-aware. `.txt` é importado literalmente e não passa pelo parser inline de Markdown.

Todo arquivo passa por staging persistente com bytes originais e SHA-256. Importações pelo bot usam uma chave de origem derivada da mensagem do Telegram para que reabertura/reentrega resolva para o mesmo pendente. Arquivos não UTF-8 permanecem pendentes até escolha explícita de encoding; uma tela dedicada conclui o mesmo pendente. No Web App, um retry do mesmo arquivo pendente reutiliza `user_id + filename + SHA-256` enquanto o pendente estiver incompleto.

## Estado do editor

IDs canônicos de nós de texto são mantidos estáveis entre serializações para evitar revisões artificiais. O checkpoint de sessão persiste scroll, bloco ativo e seleção/cursor serializados por caminho dentro do bloco. O espelho local continua separado do servidor e não é mesclado automaticamente.

## Compatibilidade com mudanças concorrentes

Durante a rodada, `new` avançou com alterações do usuário em `README.md` e `COMPATIBILITY.md`. A branch v5 recebeu primeiro o conteúdo atual desses arquivos e depois um commit de merge de história com o head de `new`, usando atualização fast-forward da própria branch e sem alterar `new`.

## Não executado

Por determinação do usuário e das ordens de #43, esta rodada não criou nem executou testes Python, não fez deploy e não fez merge do PR. A verificação realizada foi inspeção estática de arquivos/diffs e conferência da API pública atual.

Consequentemente, esta ADR não afirma sucesso de runtime. Ela registra decisões e integrações observáveis no código.

## Pendências conhecidas após esta rodada

Ainda não equivalem a conclusão integral das decisões de #43:

- revisão de conversão com edição paralela de original/convertido e aplicação seletiva de volta ao documento;
- edição visual completa do bloco `raw_markdown`;
- drag-and-drop de blocos e trechos, exclusão visual com Undo temporário e duplicação de rascunho;
- histórico/Undo unificado para renomear, arquivar e restaurar metadados de rascunho;
- nomenclatura automática completa e exclusão de rascunho com confirmação;
- fluxo pós-publicação com continuar/arquivar/novo;
- divergência local/servidor exibindo as duas versões em um diálogo dedicado, em vez de escolha simples;
- detecção/decisão explícita para Markdown colado;
- download explícito de originais e versionamento de substituição de mídia;
- eliminação de uma possível corrida de conclusão simultânea do mesmo import pendente.

Essas pendências permanecem explícitas para a continuação e não devem ser classificadas como concluídas apenas porque a fundação correspondente existe.
