# User Info inline

Consulta only. Nao entra em grupo. Nao vigia ninguem.

```
@SEUBOT @username
@SEUBOT 123456789
```

Manda: nome atual, @ atual, ID, bio, link, foto publica (se existir), data de criacao estimada pelo ID.

Telegram nao expoe lista oficial de nomes/@ antigos. Este bot nao inventa isso.

## Variaveis

| Var | Obrigatoria | Pra que |
|---|---|---|
| `USER_INFO_BOT_TOKEN` | sim | bot novo no BotFather, inline ligado |
| `TELEGRAM_API_ID` | pra resolver user comum | my.telegram.org |
| `TELEGRAM_API_HASH` | pra resolver user comum | my.telegram.org |
| `TELEGRAM_SESSION` | se ja tiver string session | Telethon |

Sem API_ID/HASH o bot ainda funciona para canal, grupo publico e bot. User comum cai no que a pagina t.me mostrar.

## Rodar

```bash
cd user_info_bot
pip install -r requirements.txt
export USER_INFO_BOT_TOKEN=123:abc
export TELEGRAM_API_ID=12345
export TELEGRAM_API_HASH=abcd
python bot.py
```

Primeira vez com MTProto: o Telethon pede o numero da *sua* conta no terminal e grava `user_info.session`.
