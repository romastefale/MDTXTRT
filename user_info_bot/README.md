# User Info inline

Consulta only. O inline responde na hora. Os dados entram depois, editando a mensagem.

```
@SEUBOT @username
@SEUBOT 123456789
```

Token: `USER_INFO_BOT_TOKEN`

## BotFather

1. `/setinline` ligado
2. `/setinlinefeedback` → **Enabled** (sem isso a edicao nao roda)

## Variaveis

| Var | Obrigatoria |
|---|---|
| `USER_INFO_BOT_TOKEN` | sim |
| `TELEGRAM_API_ID` | pra resolver user comum |
| `TELEGRAM_API_HASH` | pra resolver user comum |
| `TELEGRAM_SESSION` | session Telethon |
| `INFOCARD_BOT` | brand no card, default `infocardrobot` |
