# RMDtxtML — MDTXTRT

Mini App Telegram: editor TXT / Markdown → texto rico (Bot API 10.3) e Telegraph.

**Live:** [romastefale.github.io/MDTXTRT](https://romastefale.github.io/MDTXTRT/)

Bot: [@mdtxtrtbot](https://t.me/mdtxtrtbot)

## Abrir no Telegram

1. BotFather → `/newapp`
2. Cole a URL: `https://romastefale.github.io/MDTXTRT/`
3. Short name: `rmdtxtml`
4. Abra `https://t.me/mdtxtrtbot/rmdtxtml`

O app detecta Mini App pelo `initData`. No Telegram, **Publicar** manda `sendData` / `sendRichMessage` (HTML 10.3, `skip_entity_detection`). Telegraph usa `createPage` direto.

## O que faz

- Editor rico (títulos, listas, tarefas, tabela, citação expansível 10.3)
- Importar TXT, Markdown, HTML, snapshot
- Publicar no Telegraph
- Payload `sendRichMessage` para o bot
- Logo das aspas (`@mdtxtrtbot · md to rich text and telegraph editor`)

## Grok

O mesmo produto no Grok App Builder. Publique por lá para ter `https://mdtxtrt.grok.me` (servidor próprio para o token do bot). GitHub Pages é a Mini App estática — o jeito certo de abrir pelo Telegram.
