# MDTXTRT

Mini App Telegram: editor TXT / Markdown → texto rico (Bot API 10.3) e Telegraph.

**Live:** [romastefale.github.io/MDTXTRT](https://romastefale.github.io/MDTXTRT/)

Bot: [@mdtxtrtbot](https://t.me/mdtxtrtbot)

Toque no nome **MDTXTRT** no centro para ligar o bot.

## Abrir no Telegram

1. BotFather → `/newapp`
2. Cole a URL: `https://romastefale.github.io/MDTXTRT/`
3. Short name: `rmdtxtml`
4. Abra `https://t.me/mdtxtrtbot/rmdtxtml`

O app segue o modo claro/escuro do sistema (ou do Telegram). O fundo ocupa a tela toda.

## O que faz

- Editor rico (H1–H6, rodapé Telegram, listas, tarefas, tabela, citação expansível 10.3)
- Importar TXT, Markdown, HTML, snapshot
- Publicar no Telegraph
- Payload `sendRichMessage` para o bot

## Pastas drop-in (sem mudar código)

- **`icons/`** — coloque o arquivo com o nome do botão (`bold.svg`, `heading.png`…). Aceita SVG, PNG ou WebP. Lista em `icons/LEIA-ME.txt`.
- **`backgrounds/`** — `light.jpg` e `dark.jpg` (também `.png` / `.webp` / `.avif`). Lista em `backgrounds/LEIA-ME.txt`.
