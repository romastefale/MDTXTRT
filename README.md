# MDTXTRT

Editor Markdown para Telegram Mini App. Converte `.md` em rich text do Telegram e exporta mensagens em Markdown otimizado.

O bot usa aiogram 3.31.0, com suporte nativo ao Telegram Bot API 10.3.

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

## Configuração (Railway + BotFather)

Start command: `python main.py`

| Variável | Obrigatória | Função |
|---|---|---|
| `TELEGRAM_TOKEN` | sim | token do BotFather |
| `WEB_APP_URL` | recomendada | URL pública HTTPS, hoje `https://mdmtrt.up.railway.app` |
| `TELEGRAPH_ACCESS_TOKEN` | recomendada | persiste a conta Telegraph entre deploys |
| `TELEGRAPH_AUTHOR` | não | autor das páginas (padrão `MDTXTRT`) |
| `PORT` | automática | Railway preenche |

Os comandos `/start` `/helo` `/tgrich` `/mdrich` são registados no menu do bot no arranque. O botão de menu Mini App também é definido no arranque se `WEB_APP_URL` existir.

### Telegraph persistente

1. Publique uma página uma vez pelo Mini App (o bot cria a conta).
2. Abra os logs do Railway e procure a linha `TELEGRAPH_ACCESS_TOKEN com este valor:`.
3. Variables → New variable → nome `TELEGRAPH_ACCESS_TOKEN`, valor copiado → Save.
4. Redeploy.

### BotFather

1. `/mybots` → o bot → **Bot Settings**.
2. **Menu Button** / **Configure Mini App** → URL `https://mdmtrt.up.railway.app`.
3. **Domain** → o mesmo host, sem `https://`: `mdmtrt.up.railway.app`.
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

Abrir `http://localhost:8080`. Publicar Telegraph e enviar ao chat só autenticam dentro do Telegram (initData).

## Testes da migração

```bash
python -m unittest discover -s tests -v
```

A matriz de versões, evidências, decisões e limites da atualização está em `COMPATIBILITY.md`.
