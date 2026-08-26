# MDTXTRT

Editor Markdown para Telegram Mini App, com preview, envio ao bot e publicação no [Telegraph](https://telegra.ph).

O backend que tinha ido parar em `romastefale/TELEGRAPH` voltou para cá.

## O que faz

- Escrever Markdown no Mini App
- Preview em tempo real
- Spoilers `||texto||`, títulos, listas, código, imagens, links
- **Publicar** no Telegraph (`POST /api/publish`) — sem o limite de 4 KB do `sendData`
- **Enviar para o Bot** via `Telegram.WebApp.sendData`
- Exportar / copiar `.md` e rich text
- Autosave local (`mdtxtrt_draft`, `mdtxtrt_title`, `mdtxtrt_path`)
- Comandos `/tgrich` e `/mdrich`

## Railway

Este serviço agora é **Python**, não mais `npx serve`.

1. No serviço do Railway, start command: `python main.py`
2. Variáveis:

| Variável | Obrigatória | Função |
|---|---|---|
| `TELEGRAM_TOKEN` | sim, para o bot | token do BotFather |
| `WEB_APP_URL` | recomendada | URL pública HTTPS do mesmo serviço |
| `TELEGRAPH_ACCESS_TOKEN` | recomendada | persiste a conta Telegraph entre deploys |
| `TELEGRAPH_AUTHOR` | não | autor das páginas (padrão `MDTXTRT`) |
| `PORT` | automática | Railway preenche |

Se `TELEGRAPH_ACCESS_TOKEN` não existir, o processo cria uma conta e escreve o token no log. Copie para a variável e faça redeploy.

3. BotFather → *Bot Settings* → *Menu Button* / *Configure Mini App* → cole `WEB_APP_URL`.

4. Depois do deploy, teste `https://SEU-DOMINIO/health`.

O `package.json` antigo fazia o Nixpacks escolher Node. Ele foi removido deste repo.

## Local

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export TELEGRAM_TOKEN=123:abc
export WEB_APP_URL=http://localhost:8080
python main.py
```

Abra `http://localhost:8080`. Publicar Telegraph funciona no navegador. Enviar ao bot só dentro do Telegram.

## Contrato do Mini App

`sendData` e `POST /api/publish` usam o mesmo JSON:

```json
{
  "action": "publish_telegraph",
  "type": "telegraph",
  "title": "Título",
  "path": "slug-opcional",
  "content": "# markdown",
  "timestamp": 0
}
```

`action` / `type` `markdown` manda o texto para o chat do bot.
