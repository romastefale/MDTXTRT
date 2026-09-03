# MDTXTRT

Editor Markdown para Telegram Mini App. Converte `.md` em rich text do Telegram e exporta mensagens em Markdown otimizado.

Stack atual: Telegram Bot API 10.3 + aiogram 3.31.0 + Python 3.13.15.

## Comandos

| Comando | Função |
|---|---|
| `/start` | Abre o Mini App e resume as funções |
| `/help` | Lista os comandos e explica chat vs Mini App |
| `/tgrich` | Markdown → rich text do Telegram. Responda a um arquivo `.md`, ou envie o comando seguido do texto. Anexos e encaminhamentos `.md` disparam isto automaticamente |
| `/mdrich` | Responda a uma mensagem para exportar `.md` compatível e otimizado |

## Mini App

- Escrever Markdown com pré-visualização
- Vista **tgrich**: como a mensagem fica no Telegram
- Spoilers `||texto||`, títulos, listas, código, imagens e ligações
- Publicar no Telegraph (`POST /api/publish`)
- Enviar ao bot (`POST /api/send-chat` ou fluxo de stash/deep link)
- Exportar `.md` (mdrich) e abrir anexos
- Autosave local (`mdtxtrt_draft`, `mdtxtrt_title`, `mdtxtrt_path`)
- Fundo preto no modo escuro, branco no modo claro. Botões flat.

A autenticação do Mini App usa `Telegram.WebApp.initData`, validado no servidor pela implementação nativa do aiogram antes de publicar ou executar ações autenticadas.

## Configuração Railway + BotFather

Start command: `python main.py`

| Variável | Obrigatória | Função |
|---|---|---|
| `TELEGRAM_TOKEN` | sim | token do BotFather |
| `WEB_APP_URL` | recomendada | URL pública HTTPS; produção: `https://mdtxtrt-new-production.up.railway.app` |
| `RAILPACK_PYTHON_VERSION` | recomendada | fixa Python 3.13.15 no Railpack |
| `PORT` | automática | Railway preenche |

Sem `WEB_APP_URL`, o servidor usa `RAILWAY_PUBLIC_DOMAIN` fornecido pelo Railway.

O deploy usa Railpack, healthcheck `/health` e executa `python -m unittest discover -s tests -v` como pre-deploy. Um deploy que não passa a suíte não deve ser promovido.

Os comandos `/start` `/help` `/tgrich` `/mdrich` são registados no menu do bot no arranque. O botão de menu Mini App também é definido no arranque quando existe URL pública.

### Telegraph anônimo por publicação

Cada publicação cria uma conta Telegraph anônima nova, publica uma única página e descarta o cliente e o token em seguida. Nenhuma variável de conta ou autor é usada.

### BotFather

1. `/mybots` → o bot → **Bot Settings**.
2. **Menu Button** / **Configure Mini App** → URL `https://mdtxtrt-new-production.up.railway.app`.
3. **Domain** → o mesmo host, sem `https://`: `mdtxtrt-new-production.up.railway.app`.
4. Se for usar o bot em grupos: **Group Privacy** → **Turn off** para o bot ver anexos `.md` no grupo.

## Local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export TELEGRAM_TOKEN=123:abc
export WEB_APP_URL=http://localhost:8080
python main.py
```

Abrir `http://localhost:8080`. Publicar Telegraph e ações autenticadas pelo Mini App exigem `initData` válido do Telegram.

## Testes

```bash
python -m unittest discover -s tests -v
```

A suíte cobre, entre outros contratos, modelos aiogram keyword-only, validação atual de `initData` com `signature`, expiração da sessão, rich messages do Bot API 10.3, listas, botões, mídia, polling e comportamento de respostas.

A matriz de versões, evidências, decisões e limites da atualização está em `COMPATIBILITY.md`.
