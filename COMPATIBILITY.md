# Compatibilidade de produção

Estado desta entrega: 2026-09-13.

| Componente | Contrato fixado |
|---|---|
| Telegram Bot API | 10.3 |
| Framework Telegram | `aiogram==3.31.0` |
| Python | 3.13.15 (`.python-version`, `runtime.txt`) |
| aiohttp | `3.14.3` |
| Telegraph | `telegraph==2.2.0` |
| cryptography | `50.0.1` |

## Fronteiras relevantes

- Rich Message usa exatamente uma representação por envio: HTML, Rich Markdown ou Blocks.
- Limites Rich 10.3 aplicados antes do envio: 32768 caracteres, 500 blocos contáveis (incluindo itens de lista e linhas de tabela), 16 níveis, 50 anexos e 20 colunas.
- O plano Telegram revisado é identificado por fingerprint que inclui revisão efetiva, destino resolvido, anexos locais por SHA-256 e operações nativas Location/Venue.
- Upload local: 10 MB para foto e 50 MB para os demais tipos aceitos pelo editor; o armazenamento possui limite rígido de 50 MB por BLOB.
- Importação `.md`/`.txt`: 20 MB.
- Telegraph é habilitado somente quando `MDTXTRT_TELEGRAPH_KEY` é configurada com uma chave de 32 bytes em base64 URL-safe.

## Verificação desta entrega

O pre-deploy do Railway executa `python -m unittest discover -s tests -v` antes de `python app.py`. A árvore também é compatível com `node --check` para os JavaScripts ativos e `python -m compileall` para o código Python.
