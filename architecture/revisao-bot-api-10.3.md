# Rascunho de revisão — Telegram Bot API 10.3

> **Estado:** rascunho técnico para discussão. Este documento registra achados de revisão; não altera o comportamento do runtime.

## Objetivo

Revisar a integração do MDTXTRT com mensagens Rich da Telegram Bot API 10.3 e transformar as lacunas encontradas em trabalho verificável. O foco é impedir que o preflight aprove payloads que só serão rejeitados no envio, tornar explícito o subconjunto suportado e separar compatibilidade declarada de prontidão operacional.

## Escopo analisado

- Construção e envio de `InputRichMessage`.
- Escolha entre representações HTML, Markdown e Blocks.
- Validação estática de documentos e botões Rich.
- Upload e associação de mídias.
- Envio, edição e confirmação de adaptações semânticas.
- Inicialização do bot e sinalização de saúde do serviço.
- Cobertura automatizada dos payloads enviados ao Telegram.

## Resumo executivo

A base da integração está alinhada ao modelo Rich: o runtime cria `InputRichMessage`, usa `send_rich_message` para publicação e `edit_message_text` com `rich_message` para edição. Também mantém apenas uma representação textual por mensagem, valida `callback_data` em bytes UTF-8 e exige confirmação para adaptações conhecidas.

Isso, porém, ainda não equivale a compatibilidade completa com a Bot API 10.3. O preflight não recebe contexto suficiente sobre o destino, a implementação de Blocks cobre apenas parte do modelo, algumas restrições estruturais não são validadas e o health check publica uma versão fixa sem comprovar capacidade ou conectividade. O resultado possível é uma revisão local aprovada seguida de rejeição pelo Telegram.

## Achados

### P1 — o preflight não considera o destino da publicação

O editor permite criar botões `web_app`, mas a validação estática verifica essencialmente a presença de URL HTTPS. Esse tipo de botão possui restrições relacionadas ao contexto do chat. O endpoint de publicação, por sua vez, aceita destinos como IDs e `@username`, sem fornecer ao preview informações sobre tipo de chat, tópico ou permissões efetivas.

**Risco:** uma composição pode aparecer como publicável e falhar somente em `sendRichMessage`, depois da confirmação do usuário.

**Recomendação:** introduzir um `TelegramDestinationContext` contendo, no mínimo, tipo e identificador do chat, tópico, direct-message topic e capacidades relevantes do bot. O mesmo contexto deve alimentar preview, preflight e publicação.

### P1 — a matriz de constraints 10.3 está incompleta

As validações atuais cobrem quantidade máxima de blocos, linhas de botões, alinhamento, tipos e estilos conhecidos, tamanho de `callback_data` e parte das regras de URL. Ainda é necessário consolidar e testar regras de:

- mapas: zoom, dimensões, coordenadas e proporções;
- collage e slideshow: cardinalidade, ordem e tipos admitidos;
- tabelas: dimensões, células e combinações estruturais;
- `switch_inline_query_chosen_chat`, `login_url`, `copy_text` e botões desabilitados;
- custom emoji, datas, anchors e references;
- textos, captions, mídias e limites específicos de cada bloco.

**Risco:** payloads estruturalmente inválidos podem receber estado `publishable`.

**Recomendação:** manter uma matriz versionada de constraints, com casos positivos, limites exatos e casos imediatamente fora do limite.

### P1 — Blocks representa somente um subconjunto

O compilador cobre estruturas textuais como parágrafo, heading, preformatted, footer, divider, expressão matemática, anchor, citações, listas e details. Outros nós canônicos terminam em `blocks_block_unsupported`, incluindo estruturas que têm representação correspondente no modelo Rich.

Permanecem como lacunas relevantes:

- mapas e tabelas;
- botões em bloco;
- foto, vídeo, animação, áudio, voice note e documento;
- collage e slideshow.

Além disso, a montagem da mensagem não associa anexos quando a representação selecionada é Blocks, embora a mensagem Rich possua mídia em nível geral.

**Risco:** a interface pode atribuir ao Telegram uma limitação que pertence ao compilador local, além de forçar adaptações evitáveis.

**Recomendação:** declarar na UI a cobertura exata de cada representação, implementar os blocos por famílias e habilitar mídia em Blocks quando suportada pelo contrato final.

### P1 — menção nativa é degradada para URL

O nó canônico `text_mention` é convertido para `tg://user?id=...`, com adaptação registrada, em vez de produzir a estrutura nativa correspondente.

**Risco:** embora a confirmação reduza surpresa, a representação deixa de ser semanticamente exata e pode divergir entre formatos.

**Recomendação:** decidir e documentar uma das estratégias:

1. armazenar ou resolver o objeto de usuário necessário à representação nativa; ou
2. assumir que o modelo canônico contém somente o ID e marcar Blocks como inexato nesse caso.

### P2 — a versão exposta no health check é estática

O health check informa `10.3` literalmente. O valor não comprova a versão instalada do cliente, presença dos modelos Rich, conectividade com a API, estado do polling ou sucesso de serialização.

**Risco:** monitoração e suporte podem interpretar uma meta declarada como capacidade operacional confirmada.

**Recomendação:** publicar sinais separados:

- `target_bot_api_version`;
- `aiogram_version`;
- `rich_message_models_available`;
- `telegram_ready`;
- `polling_ready`;
- último erro operacional, sem dados sensíveis.

### P2 — o startup HTTP depende da disponibilidade do Telegram

Na inicialização, o bot executa operações remotas como `get_me`, remoção de webhook, configuração de comandos e menu, antes de iniciar polling. Uma credencial inválida ou indisponibilidade temporária pode impedir o Web App de subir por completo.

**Risco:** usuários podem perder acesso ao editor e aos rascunhos por uma falha restrita à publicação.

**Recomendação:** iniciar o editor em modo degradado, sinalizar a indisponibilidade e bloquear apenas recursos que realmente dependem do Telegram. A reconexão deve possuir retry com backoff e estado observável.

### P2 — faltam testes do payload HTTP final

Os testes existentes exercitam modelos e mocks, mas não formam uma matriz de serialização completa do método enviado ao Telegram.

**Recomendação:** capturar e inspecionar o JSON final para:

- `sendRichMessage` e edição com `rich_message`;
- HTML, Markdown e Blocks;
- mídia local e referências `tg://...`;
- chats privados, grupos, canais, tópicos e direct-message topics;
- valores mínimos, máximos e imediatamente inválidos;
- respostas de erro relevantes e sua tradução para a UI.

## Plano proposto

1. Criar uma matriz rastreável de capacidades e constraints da versão-alvo.
2. Adicionar `TelegramDestinationContext` ao preview e à publicação.
3. Fechar primeiro as validações que evitam rejeição tardia.
4. Implementar Blocks por famílias, sem anunciar suporte antes dos testes de payload.
5. Separar health, readiness e versão-alvo.
6. Desacoplar o startup do editor da conexão com o Telegram.
7. Adicionar testes de contrato no limite entre aiogram e HTTP.

## Critérios de aceite

- [ ] Preview e publicação validam o mesmo documento, representação e destino.
- [ ] Combinações inválidas de botão, chat, tópico e permissão são bloqueadas antes da confirmação.
- [ ] Cada constraint suportada possui testes no limite e fora dele.
- [ ] A UI diferencia “não suportado pelo MDTXTRT” de “não suportado pela Bot API”.
- [ ] Blocks com mídia possuem contrato explícito e testes de serialização.
- [ ] A estratégia de `text_mention` está documentada e coberta por round-trip.
- [ ] Health e readiness não confundem versão-alvo com disponibilidade operacional.
- [ ] O editor inicia em modo degradado quando o Telegram está indisponível.
- [ ] Testes verificam o JSON final de envio e edição para todas as representações habilitadas.
- [ ] Logs e mensagens de erro preservam contexto útil sem expor token ou conteúdo sensível.

## Fora de escopo deste rascunho

- Implementar as correções listadas.
- Alterar o modelo canônico ou migrar documentos existentes.
- Certificar comportamento de produção sem testes contra um ambiente Telegram controlado.

## Referências

- [Telegram Bot API — InputRichMessage](https://core.telegram.org/bots/api#inputrichmessage)
- [Telegram Bot API — sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage)
- [Telegram Bot API — editMessageText](https://core.telegram.org/bots/api#editmessagetext)
- [Telegram Bot API — RichMessageButton](https://core.telegram.org/bots/api#richmessagebutton)
- [Telegram Bot API — changelog](https://core.telegram.org/bots/api-changelog)
