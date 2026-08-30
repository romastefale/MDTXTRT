# MDTXTRT

Editor Markdown para Telegram Mini App. Converte `.md` em rich text do Telegram e exporta mensagens em Markdown otimizado.

## Comandos

| Comando | Função |
|---|---|
| `/start` | Abre o Mini App e resume as funções |
| `/helo` | Lista os comandos e explica chat vs Mini App (`/help` é alias) |
| `/tgrich` | Markdown → rich text do Telegram. Responda a um arquivo `.md`, ou envie o comando seguido do texto. Anexos e encaminhamentos `.md` disparam isto automaticamente |
| `/mdrich` | Responda a uma mensagem para exportar `.md` compatível e otimizado |

## Mini App

- Escrever Markdown com pré-visualização
- Vista **tgrich**: como a mensagem fica no Telegram
- Spoilers `||texto||`, títulos, listas, código, imagens, ligações
- Publicar no Telegraph (`POST /api/publish`)
- Enviar ao bot (`POST /api/send-chat`)
- Exportar `.md` (mdrich) e abrir anexos
- Autosave local (`mdtxtrt_draft`, `mdtxtrt_title`, `mdtxtrt_path`)
- Fundo preto no modo escuro, branco no modo claro. Botões flat.

## Railway

Start command: `python main.py`

| Variável | Obrigatória | Função |
|---|---|---|
| `TELEGRAM_TOKEN` | sim, para o bot | token do BotFather |
| `WEB_APP_URL` | recomendada | URL pública HTTPS do mesmo serviço |
| `TELEGRAPH_ACCESS_TOKEN` | recomendada | persiste a conta Telegraph entre deploys |
| `TELEGRAPH_AUTHOR` | não | autor das páginas (padrão `MDTXTRT`) |
| `PORT` | automática | Railway preenche |

BotFather → *Bot Settings* → *Menu Button* / *Configure Mini App* → cole `WEB_APP_URL`.

Os comandos `/start` `/helo` `/tgrich` `/mdrich` são registados no menu do bot no arranque.

## Local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export TELEGRAM_TOKEN=123:abc
export WEB_APP_URL=http://localhost:8080
python main.py
```

Abrir `http://localhost:8080`. Publicar Telegraph e enviar ao chat só autenticam dentro do Telegram (initData).
