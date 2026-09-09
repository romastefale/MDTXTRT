# Matriz de compatibilidade declarada

Os valores abaixo são os alvos fixados pelo projeto. Em 9 de setembro de 2026,
uma auditoria offline confirmou a coerência interna dos arquivos, mas **não**
conseguiu reconfirmar versões ou contratos nas fontes oficiais porque o acesso
HTTP do ambiente foi recusado. Portanto, esta página não deve ser interpretada
como prova independente de que esses alvos continuam atuais.

| Componente | Decisão |
|---|---|
| Telegram Bot API | 10.3 (atual em 2026-09-04) |
| Framework Telegram | aiogram 3.31.0, com suporte nativo ao Bot API 10.3 |
| Python | 3.13.15 no Railway e em `runtime.txt`; testes locais secundários também executados em 3.12.13 |
| aiohttp | 3.14.3, compatível com o intervalo oficial do aiogram 3.31.0 |
| Telegraph | 2.2.0 mantido |
| Transporte | Bot API hospedada pelo Telegram, via long polling |
| Última verificação oficial declarada no histórico | 2026-09-04 |
| Auditoria offline desta árvore | 2026-09-09 |

## Contratos preservados

- Mesmos handlers de documento e Web App; o comando de ajuda canônico é `/help`.
- Cada publicação Telegraph usa uma conta anônima nova e descarta o token após criar a página.
- Mesmos limites de documento e foto, rotas HTTP, variáveis de ambiente e comando de início.
- Processamento de updates sequencial (`handle_as_tasks=False`).
- `allowed_updates=None`, como no polling anterior, sem inferência baseada apenas nos handlers.
- `drop_pending_updates=True` antes do polling, com repetição para falhas transitórias.
- Respostas automáticas sem citação em chats privados e com citação em grupos, como os atalhos da biblioteca anterior.
- Timeout de 60 segundos no envio de rich messages.
- Erros de API, rate limit e rede continuam diferenciados.

## Atualização nativa

- `Bot.send_rich_message` e `InputRichMessage` substituem a chamada HTTP manual a `sendRichMessage`.
- `Message.rich_message` substitui inspeções por `api_kwargs` e serializações alternativas.
- `Bot.download` substitui o download de arquivos da biblioteca anterior.
- O ciclo de vida do dispatcher é integrado ao startup/cleanup do aiohttp e a sessão do bot é fechada explicitamente.
- Objetos rich recebidos usam a serialização pública do aiogram; wrappers antigos ou objetos desconhecidos são rejeitados explicitamente.
- Botões e blocos de botões do Bot API 10.3, listas, checkboxes e expressões matemáticas são preservados na representação Markdown.
- O nome multipart das fotos é alinhado ao MIME já validado, pois `BufferedInputFile` documenta o nome do arquivo, mas não oferece parâmetro público de MIME.
- O Mini App expõe a gramática Rich 10.3 por geradores categorizados, incluindo H1-H6,
  tabelas, fórmulas, referências, mapas, documentos, collages, slideshows e botões.
- A sintaxe legada `**>` é normalizada para o bloco oficial
  `<blockquote expandable>`, sem confundi-lo com `<details>`.
- A prévia duplicada foi removida. A única prévia restante se identifica como local
  e aproximada, porque o resultado definitivo depende do renderizador do Telegram.

## Composição do processo

- `app.py` é o único entrypoint de produção, tanto no Railway quanto no Procfile.
- As capacidades são montadas em um namespace privado e entregues ao núcleo por
  um contrato fechado; nomes ausentes ou desconhecidos interrompem o arranque.
- Isso isola as escritas dos adaptadores, mas **não elimina ainda o mecanismo
  legado de monkey patch**: os módulos continuam expondo `install(...)`, alteram
  o namespace privado, e a ligação final usa `globals().update(...)` no núcleo.
  Chamar esse estado de “sem monkey patches” seria incorreto.
- A ordem dos adaptadores permanece explícita porque alguns contratos decoram o
  comportamento anterior (por exemplo, segurança da prévia e UI de mensagens).
  Essa dependência deixa de ser um efeito colateral da ordem de imports.

## Alegações herdadas que exigem reconfirmação online

- O histórico afirma que a referência e o changelog oficiais identificam Bot API 10.3, de 24 de agosto de 2026, como a versão atual.
- O histórico afirma que a documentação e a release oficial do aiogram 3.31.0 declaram cobertura completa do Bot API 10.3.
- O histórico registra metadados do aiogram com Python `>=3.10,<3.15`, aiohttp `>=3.9,<3.15`, Pydantic `>=2.4.1,<2.14` e magic-filter `>=1.0.12,<1.1`.
- O histórico também atribui ao metadado oficial do aiogram 3.31.0 o intervalo
  Python `>=3.10,<3.15` e registra Python 3.13.15 como pertencente a ele.
- O histórico relata que um build implantado usou Railpack 0.39.0 e Python
  3.13.15; nenhum log desse build está disponível nesta árvore para auditoria.
- As afirmações sobre permissões de mídia e proteção de origem de Mini Apps
  também permanecem pendentes de reconfirmação nas referências abaixo.

Referências oficiais que devem ser confrontadas quando houver acesso:

- [Telegram Bot API](https://core.telegram.org/bots/api), incluindo
  `InputRichMessage`, `sendRichMessage`, download de arquivos, respostas e
  prepared inline messages.
- [Validação de dados de Mini Apps](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app),
  para assinatura e `auth_date`.
- [Documentação do aiogram](https://docs.aiogram.dev/en/latest/), para lifecycle
  do dispatcher, modelos tipados, download e métodos do Bot API.
- [Telegraph API](https://telegra.ph/api), para criação de conta e de página.

## Limites confirmados na auditoria offline de 2026-09-09

- O ambiente não contém o Python 3.13.15 fixado por `.python-version` e
  `runtime.txt`; contém 3.13.13 como patch 3.13 mais próximo.
- `aiogram`, `aiohttp` e `telegraph` não estão instalados nos runtimes Python
  disponíveis e não há distribuições desses pacotes no cache local.
- Por isso não foi possível importar nem executar a mesma composição de
  produção sem baixar dependências. Compilação sintática não comprova contratos
  de API, serialização, rede, lifecycle ou comportamento do Telegram.
- Nenhuma versão, classe ou método foi promovido ou removido com base em memória
  do modelo. Essa decisão evita transformar falta de conectividade em uma
  “correção” especulativa.

## Alternativas anteriormente registradas

As decisões abaixo pertencem à análise anterior e herdam a mesma necessidade de
reconfirmação online; a auditoria offline não as promove a fatos verificados.

- aiogram 3.30.0 cobre Bot API 10.2, mas foi rejeitado porque 3.31.0 cobre a versão oficial atual 10.3.
- Python 3.12 continua tecnicamente compatível e foi usado na validação local secundária, mas não foi selecionado porque o runtime isolado já fixa e executa 3.13.15 com sucesso.
- Python 3.14 também satisfaz o metadado atual, mas foi rejeitado por ampliar o runtime sem necessidade funcional.
- Outras versões de aiohttp foram rejeitadas: 3.14.3 já está fixada, permanece dentro do intervalo `>=3.9,<3.15` exigido pelo aiogram e passou no runtime real.
- Webhook e servidor Bot API local foram rejeitados porque o projeto já usa long polling e não requer as capacidades adicionais do servidor local.
- Chamadas HTTP diretas ao Bot API foram removidas porque aiogram 3.31.0 oferece cobertura nativa dos recursos usados.

## Limite da conversão Markdown

Markdown não representa ações interativas como `callback_data`, copiar texto ou seleção de inline query. Na exportação de um botão rich, o rótulo é preservado e URLs/Web Apps/Login URLs viram links; ações sem URL preservam o rótulo, sem inventar uma ação Markdown equivalente.

O patch do deploy não fica implícito: `runtime.txt` e `RAILPACK_PYTHON_VERSION` fixam 3.13.15, e o log do Railpack confirmou esse mesmo patch. Python 3.12.13 foi usado apenas como verificação local adicional.
