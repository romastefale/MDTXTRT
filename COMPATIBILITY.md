# Compatibilidade verificada

Atualização executada a partir do projeto original, sem usar a migração anterior como base.

| Componente | Decisão |
|---|---|
| Telegram Bot API | 10.3 (atual em 2026-09-04) |
| Framework Telegram | aiogram 3.31.0, com suporte nativo ao Bot API 10.3 |
| Python | 3.13.15 no Railway e em `runtime.txt`; testes locais secundários também executados em 3.12.13 |
| aiohttp | 3.14.3, compatível com o intervalo oficial do aiogram 3.31.0 |
| Telegraph | 2.2.0 mantido |
| Transporte | Bot API hospedada pelo Telegram, via long polling |
| Verificação | 2026-09-04 |

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

## Evidência e restrições consideradas

- A referência e o changelog oficiais identificam Bot API 10.3, de 24 de agosto de 2026, como a versão atual.
- A documentação e a release oficial do aiogram 3.31.0 declaram cobertura completa do Bot API 10.3.
- Os metadados instalados do aiogram exigem Python `>=3.10,<3.15`, aiohttp `>=3.9,<3.15`, Pydantic `>=2.4.1,<2.14` e magic-filter `>=1.0.12,<1.1`.
- O metadado oficial do aiogram 3.31.0 exige Python `>=3.10,<3.15`; Python 3.13.15 está dentro desse intervalo.
- O Railway usa Railpack 0.39.0 e confirmou Python 3.13.15 no build do commit implantado.
- O envio de mídia em rich messages exige que o bot tenha permissão para enviar a mídia no chat de destino.
- A proteção de origem de Mini Apps introduzida no Bot API 10.2 exige que a origem usada corresponda ao domínio configurado no BotFather.

## Alternativas não selecionadas

- aiogram 3.30.0 cobre Bot API 10.2, mas foi rejeitado porque 3.31.0 cobre a versão oficial atual 10.3.
- Python 3.12 continua tecnicamente compatível e foi usado na validação local secundária, mas não foi selecionado porque o runtime isolado já fixa e executa 3.13.15 com sucesso.
- Python 3.14 também satisfaz o metadado atual, mas foi rejeitado por ampliar o runtime sem necessidade funcional.
- Outras versões de aiohttp foram rejeitadas: 3.14.3 já está fixada, permanece dentro do intervalo `>=3.9,<3.15` exigido pelo aiogram e passou no runtime real.
- Webhook e servidor Bot API local foram rejeitados porque o projeto já usa long polling e não requer as capacidades adicionais do servidor local.
- Chamadas HTTP diretas ao Bot API foram removidas porque aiogram 3.31.0 oferece cobertura nativa dos recursos usados.

## Limite da conversão Markdown

Markdown não representa ações interativas como `callback_data`, copiar texto ou seleção de inline query. Na exportação de um botão rich, o rótulo é preservado e URLs/Web Apps/Login URLs viram links; ações sem URL preservam o rótulo, sem inventar uma ação Markdown equivalente.

O patch do deploy não fica implícito: `runtime.txt` e `RAILPACK_PYTHON_VERSION` fixam 3.13.15, e o log do Railpack confirmou esse mesmo patch. Python 3.12.13 foi usado apenas como verificação local adicional.
