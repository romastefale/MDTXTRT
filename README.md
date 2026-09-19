# MDTXTRT

Mini App Telegram: editor TXT / Markdown → texto rico (Bot API 10.3) e Telegraph.

**Mini App (qualquer uma no BotFather):**
- [romastefale.github.io/MDTXTRT](https://romastefale.github.io/MDTXTRT/)
- [mdtxtrt.up.railway.app](https://mdtxtrt.up.railway.app)

Bot: [@mdtxtrtbot](https://t.me/mdtxtrtbot)

## Railway

Public networking: `mdtxtrt.up.railway.app`

Variável de ambiente:

- **`TOKEN`** — token do bot (BotFather). O app **não** pede token na tela.

O GitHub Pages chama esse mesmo backend para `sendRichMessage`. Aberto no Telegram, o envio usa a sessão da Mini App (sem colar chat ID).

## Abrir no Telegram

1. BotFather → `/newapp`
2. Cole uma das URLs acima
3. Short name: `rmdtxtml`
4. Abra `https://t.me/mdtxtrtbot/rmdtxtml`

O app segue o modo claro/escuro do sistema (ou do Telegram). O fundo ocupa a tela toda.

## O que faz

- Editor rico (H1–H6, rodapé Telegram, listas, tarefas, tabela, citação expansível 10.3)
- Importar TXT, Markdown, HTML, snapshot
- Publicar no Telegraph
- Payload `sendRichMessage` para o bot (TOKEN no Railway)

## Pastas drop-in (sem mudar código)

- **`icons/`** — coloque o arquivo com o nome do botão (`bold.svg`, `heading.png`…). Aceita SVG, PNG ou WebP. Lista em `icons/LEIA-ME.txt`.
- **`backgrounds/`** — `light.jpg` e `dark.jpg` (também `.png` / `.webp` / `.avif`). Lista em `backgrounds/LEIA-ME.txt`.
