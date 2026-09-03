# Compatibilidade verificada

Atualização da branch `new`, mantendo o comportamento funcional do bot e corrigindo regressões observadas em produção.

| Componente | Decisão |
|---|---|
| Telegram Bot API | 10.3, versão oficial atual verificada em 2026-09-03 |
| Framework Telegram | aiogram 3.31.0, com suporte nativo ao Bot API 10.3 |
| Python | 3.13.15, fixado por `.python-version`, `runtime.txt` e `RAILPACK_PYTHON_VERSION` no Railway |
| aiohttp | 3.14.3, dentro do intervalo `>=3.9,<3.15` exigido pelo aiogram 3.31.0 |
| Telegraph | 2.2.0, release estável mais recente verificado |
| Transporte | Bot API hospedada pelo Telegram, via long polling |
| Deploy | Railway Railpack, healthcheck `/health` e suíte de testes no pre-deploy |
| Verificação | 2026-09-03 |

## Contratos preservados

- Mesmos handlers de documento e Web App; o comando de ajuda canônico continua `/help`.
- Cada publicação Telegraph usa uma conta anônima nova e descarta o token após criar a página.
- Mesmos limites de documento e foto, rotas HTTP e comando de início.
- Processamento de updates sequencial (`handle_as_tasks=False`).
- `allowed_updates=None`, preservando a seleção anterior sem inferência apenas pelos handlers.
- `drop_pending_updates=True` antes do polling, com repetição para falhas transitórias.
- Respostas automáticas sem citação em chats privados e com citação em grupos, como no comportamento anterior.
- Timeout de 60 segundos no envio de rich messages.
- Erros de API, rate limit e rede continuam diferenciados.
- O editor, envio para chat, exportação `.md`, mídia local e publicação Telegraph permanecem disponíveis.

## Correções de produção

### Modelos aiogram keyword-only

Os tipos e métodos do aiogram 3 usam argumentos nomeados. O `mini_app_markup` ainda construía `InlineKeyboardButton` e `InlineKeyboardMarkup` com argumentos posicionais herdados da biblioteca anterior. Isso causava em produção:

`TypeError: BaseModel.__init__() takes 1 positional argument but 2 were given`

O teclado agora usa `text=...`, `web_app=...` e `inline_keyboard=...` explicitamente. Há teste de regressão que constrói o teclado real.

### Validação nativa do Mini App

A validação manual anterior removia o campo `signature` antes de montar o `data_check_string`. O formato atual de `initData` pode conter esse campo, que participa do conjunto assinado para a validação com o token do bot. Isso fazia sessões legítimas chegarem a `/api/publish` e serem recusadas com HTTP 401.

A aplicação agora delega a validação a `aiogram.utils.web_app.safe_parse_webapp_init_data`, implementação pública do próprio framework para o algoritmo oficial. Depois da validação criptográfica, continua sendo aplicado o limite local de idade (`INIT_MAX_AGE`). Há testes para `signature` presente e sessão expirada.

### URL do Mini App

Foi removido o hostname antigo embutido no código. `WEB_APP_URL` continua tendo prioridade; sem ele, o servidor usa `RAILWAY_PUBLIC_DOMAIN`. No Railway de produção, `WEB_APP_URL` está definido explicitamente como `https://mdtxtrt-new-production.up.railway.app`.

## Atualização nativa

- `Bot.send_rich_message` e `InputRichMessage` são usados diretamente.
- `Message.rich_message` substitui inspeções por campos auxiliares de wrappers antigos.
- `Bot.download` é usado para downloads Telegram.
- O ciclo de vida do dispatcher está integrado ao startup/cleanup do aiohttp e a sessão do bot é fechada explicitamente.
- Objetos rich recebidos usam a serialização pública do aiogram; wrappers antigos ou objetos desconhecidos são rejeitados explicitamente.
- Botões e blocos de botões do Bot API 10.3, listas, checkboxes e expressões matemáticas são preservados na representação Markdown quando representáveis.
- O nome multipart das fotos é alinhado ao MIME já validado.

## Evidência e restrições consideradas

- A referência e o changelog oficiais do Telegram identificam Bot API 10.3, de 24 de agosto de 2026, como a versão atual.
- A documentação e a release do aiogram 3.31.0 declaram cobertura do Bot API 10.3 e construtores keyword-only.
- Os metadados do aiogram 3.31.0 exigem Python `>=3.10,<3.15`, aiohttp `>=3.9,<3.15`, Pydantic `>=2.4.1,<2.14` e magic-filter `>=1.0.12,<1.1`.
- aiohttp 3.14.3 satisfaz o intervalo oficial do aiogram e mantém a arquitetura aiohttp já existente.
- Python 3.13.15 mantém a linha 3.13 já observada no build Railpack de produção e evita uma troca desnecessária de major para 3.14.
- O envio de mídia em rich messages continua dependendo da permissão do bot para enviar a mídia no chat de destino.
- A proteção de origem de Mini Apps exige que o domínio configurado no BotFather corresponda à origem utilizada.

## Alternativas não selecionadas

- aiogram 3.30.0 foi rejeitado porque 3.31.0 cobre a versão oficial atual 10.3.
- Python 3.14.7 foi considerado, mas não é necessário para a atualização e aumentaria a superfície de mudança sem benefício funcional para este bot.
- aiohttp 3.10.11 era compatível, mas foi substituído pela manutenção atual compatível para deixar a stack atualizada sem mudar de arquitetura.
- Validação HMAC manual do Web App foi removida do caminho ativo em favor da função nativa documentada do aiogram.
- Webhook e servidor Bot API local não foram introduzidos: o projeto já usa long polling e não requer as capacidades adicionais.
- Não foi criado fallback para wrappers antigos nem para métodos Telegram inexistentes.

## Limite da conversão Markdown

Markdown não representa ações interativas como `callback_data`, copiar texto ou seleção de inline query. Na exportação de um botão rich, o rótulo é preservado e URLs/Web Apps/Login URLs viram links; ações sem URL preservam o rótulo, sem inventar uma ação Markdown equivalente.
