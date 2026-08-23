# MDTXTRT — Markdown Editor for Telegram

Editor Markdown dark style (inspirado no Telegraph) otimizado para a nova formatação **Rich Messages** do Telegram (Bot API 10.1+).

## Recursos

- Escreva em Markdown natural
- Preview em tempo real
- Spoilers estilo Telegram (`||texto||`)
- Títulos, listas, código, imagens, links, linha horizontal
- Botão principal do Mini App: **Enviar para o Bot**
- Exportação: Markdown puro + Rich Text
- Tema automático do Telegram
- Autosave local

## Deploy no Railway

1. Conecte este repositório no [Railway](https://railway.app)
2. Railway detecta o `package.json` automaticamente
3. O serviço sobe com `npm start` (usa a porta `$PORT`)
4. Após o deploy, copie a URL pública (ex: `https://mdtxtrt-production.up.railway.app`)

## Configurar no BotFather

1. Abra o [@BotFather](https://t.me/BotFather)
2. `/mybots` → selecione seu bot → **Bot Settings** → **Menu Button** ou **Configure Mini App**
3. Cole a URL do Railway

## Como o bot recebe o conteúdo

Quando o usuário clica em **Enviar para o Bot**, o Mini App chama `Telegram.WebApp.sendData()`.

No seu bot (exemplo com `python-telegram-bot`):

```python
async def web_app_handler(update, context):
    data = json.loads(update.effective_message.web_app_data.data)
    markdown = data["content"]
    
    # Enviar como mensagem formatada (ou usar sendRichMessage na API 10.1+)
    await update.message.reply_text(markdown, parse_mode="Markdown")
```

## Desenvolvimento local

```bash
npm install
npm start
```

Abra `http://localhost:3000` (ou a porta que o `serve` mostrar).

---

Feito para funcionar perfeitamente com a nova formatação Rich Messages do Telegram.
