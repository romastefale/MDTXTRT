# MDTXTRT

Mini App Telegram para edição, revisão e publicação de conteúdo Rich usando Telegram Bot API 10.3 e Telegraph.

## Runtime de produção

- entrada: `app.py`
- UI: `mdtxtrt/static/`
- servidor: aiohttp
- persistência: SQLite/WAL
- Telegram: aiogram 3.31.0
- healthcheck: `GET /health`
- start: `python app.py`

O documento canônico JSON é a fonte autoritativa. Markdown/TXT são importações/exportações; Telegram Rich e Telegraph são projeções/publicações do mesmo documento.

## Funcionalidades

- rascunhos, revisões imutáveis, branches, Undo/Redo e sessão por usuário;
- importação `.md` e `.txt` com preservação de bytes, encoding e SHA-256;
- mídia local imutável por BLOB, SHA-256 e histórico de substituições;
- Telegram Rich por HTML, Rich Markdown ou Blocks tipados;
- tabelas Rich 10.3 com spans, alinhamento, borda, listras e modo compacto;
- linhas de botões Rich 10.3 com validação de ação/estilo/destino e ciclo de callback reconhecido pelo bot;
- Location/Venue enviados pelas operações nativas do Telegram, sem degradação para mapa HTML;
- preview vinculado à execução por fingerprint completo;
- edição e republicação de publicações pertencentes ao mesmo usuário;
- Telegraph por conta individual do usuário, com token cifrado em AES-256-GCM;
- links públicos de mídia explícitos, aleatórios e revogáveis.

## Configuração

Variáveis de ambiente:

- `TELEGRAM_TOKEN` — obrigatória;
- `MDTXTRT_DATABASE` — caminho do SQLite; padrão `mdtxtrt.sqlite3`;
- `WEB_APP_URL` — URL pública HTTPS do Mini App; necessária para Web App e links públicos;
- `MDTXTRT_TELEGRAPH_KEY` — opcional; chave URL-safe base64 que decodifica para exatamente 32 bytes;
- `HOST` — padrão `0.0.0.0`;
- `PORT` — padrão `8080`;
- `INIT_DATA_TTL_SECONDS` — padrão `3600`.

## Limites de entrada e Rich Message

- importação `.md`/`.txt`: 20 MB;
- foto local: 10 MB;
- demais mídias locais: 50 MB;
- Rich Message: até 32768 caracteres, 500 blocos contáveis, 16 níveis, 50 anexos e 20 colunas por tabela;
- linhas de tabela e itens de lista entram na contagem de blocos conforme Bot API 10.3;
- o servidor aplica limite global de corpo HTTP acima do maior upload permitido para comportar overhead multipart.

## Publicação Telegram

O preview é calculado já para o destino resolvido pelo backend. O fingerprint revisado cobre:

- revisão de origem;
- digest do documento efetivo;
- representação escolhida;
- contexto do destino;
- mídia local (ID, SHA-256, MIME, nome e tamanho);
- Location/Venue nativas.

Se qualquer parte relevante mudar, a execução exige nova revisão. Confirmação de adaptação e identidade do plano são contratos separados.

Publicações parcialmente enviadas são compensadas por exclusão best-effort das mensagens já criadas quando uma etapa posterior falha; limitações do próprio Telegram para exclusão continuam aplicáveis.

## Desenvolvimento e validação

Instale as versões fixadas:

```bash
python -m pip install -r requirements.txt
```

Execute a suíte que também é usada no pre-deploy:

```bash
python -m unittest discover -s tests -v
```

Verificações sintáticas adicionais:

```bash
python -m compileall -q app.py mdtxtrt tests
node --check mdtxtrt/static/app.js
node --check mdtxtrt/static/dialogs.js
node --check mdtxtrt/static/import_ui.js
node --check mdtxtrt/static/lifecycle_ui.js
```

## Arquitetura

Decisões e evolução ficam em `architecture/`. O runtime ativo é exclusivamente `app.py` + `mdtxtrt/`; o pacote distribuído contém somente o runtime ativo e sua documentação atual.
