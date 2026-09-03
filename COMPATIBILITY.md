# Compatibilidade verificada

Atualização executada a partir do projeto original, sem usar a migração anterior como base.

| Componente | Decisão |
|---|---|
| Telegram Bot API | 10.3 (atual em 2026-09-03) |
| Framework Telegram | aiogram 3.31.0, com suporte nativo ao Bot API 10.3 |
| Python | série 3.12 mantida em `runtime.txt`; testes locais executados em 3.12.13 |
| aiohttp | 3.10.11 mantido, pois satisfaz aiogram 3.31.0 e evita alterar o servidor Mini App |
| Telegraph | 2.2.0 mantido |
| Transporte | Bot API hospedada pelo Telegram, via long polling |
| Verificação | 2026-09-03 |

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

## Evidência e restrições consideradas

- A referência e o changelog oficiais identificam Bot API 10.3, de 24 de agosto de 2026, como a versão atual.
- A documentação e a release oficial do aiogram 3.31.0 declaram cobertura completa do Bot API 10.3.
- Os metadados instalados do aiogram exigem Python `>=3.10,<3.15`, aiohttp `>=3.9,<3.15`, Pydantic `>=2.4.1,<2.14` e magic-filter `>=1.0.12,<1.1`.
- O Nixpacks documenta Python 3.12 e seleção por `runtime.txt`, mas não garante nessa página um patch específico.
- O envio de mídia em rich messages exige que o bot tenha permissão para enviar a mídia no chat de destino.
- A proteção de origem de Mini Apps introduzida no Bot API 10.2 exige que a origem usada corresponda ao domínio configurado no BotFather.

## Alternativas não selecionadas

- aiogram 3.30.0 cobre Bot API 10.2, mas foi rejeitado porque 3.31.0 cobre a versão oficial atual 10.3.
- Python 3.13 foi rejeitado porque alteraria o runtime existente sem necessidade para a compatibilidade.
- Python 3.12.14 é o patch oficial mais recente, mas não foi declarado como patch do deploy porque o Nixpacks consultado documenta apenas a série 3.12 e o ambiente verificável executa 3.12.13.
- Atualizar aiohttp foi rejeitado: 3.10.11 está dentro do intervalo oficial do aiogram e sua troca modificaria uma dependência do servidor sem necessidade.
- Webhook e servidor Bot API local foram rejeitados porque o projeto já usa long polling e não requer as capacidades adicionais do servidor local.
- Chamadas HTTP diretas ao Bot API foram removidas porque aiogram 3.31.0 oferece cobertura nativa dos recursos usados.

## Limite da conversão Markdown

Markdown não representa ações interativas como `callback_data`, copiar texto ou seleção de inline query. Na exportação de um botão rich, o rótulo é preservado e URLs/Web Apps/Login URLs viram links; ações sem URL preservam o rótulo, sem inventar uma ação Markdown equivalente.

O patch exato usado no deploy continua sendo resolvido pelo provider Nixpacks a partir de `python-3.12`, exatamente como no projeto original. Portanto, 3.12.13 é o patch testado localmente, não uma alegação sobre o patch que o próximo deploy selecionará.
