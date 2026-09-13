# User Info inline

Bot novo, separado do MDTXTRT. Fica nesta pasta só para versionar.

Uso no Telegram (inline):

```
@SEUBOT @username
@SEUBOT 123456789
```

Manda o perfil público (nome, ID, @, bio, link). Se a foto de perfil for pública, manda a foto também.

## BotFather

1. `/newbot` — crie um bot **novo**.
2. `/setinline` — ligue o modo inline. Placeholder: `@username ou id`.
3. Cole o token em `USER_INFO_BOT_TOKEN`.

## Rodar

```bash
cd user_info_bot
pip install -r requirements.txt
export USER_INFO_BOT_TOKEN=123:abc
python bot.py
```

## Limite da Bot API

Foto e dados extras só existem se forem públicos. Conta sem @, foto só para contatos, ou perfil fechado: o bot manda o que der (link/`id`). Não é userbot.
