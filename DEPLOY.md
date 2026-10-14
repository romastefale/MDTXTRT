# Publicar o MDTXTRT

O Mini App tem dois hospedeiros que rodam **o mesmo backend** (`tgcloud/endpoints` e `tgcloud/handlers`):

- **Railway (principal):** o servidor `server.mjs` serve o Mini App, executa os endpoints em `/api/call/<nome>` e recebe as mensagens do bot em `/telegram/webhook`. O banco é um arquivo JSON no volume.
- **Telegram Serverless / tgcloud (alternativa):** a plataforma hospeda o site e os endpoints. Ver o fim deste arquivo.

O cliente escolhe sozinho: dentro do tgcloud usa `Telegram.WebApp.Serverless.call`; servido pelo Railway usa `POST /api/call/<nome>` na mesma origem.

## Versão estática (GitHub Pages)

Existe também uma versão **sem Telegram e sem servidor**, só arquivos estáticos na pasta `docs/`. Ela guarda os rascunhos no próprio aparelho (`localStorage`), importa `.md`/`.txt` e exporta baixando `.md`/`.txt`. Não publica por API, não usa o bot nem token e não faz nenhuma requisição a servidor próprio. O botão **Encaminhar** só entrega o texto aos destinos pelo navegador: abre o compartilhamento do Telegram (`t.me/share/url`; texto longo é copiado para colar), copia o texto e abre o editor do `telegra.ph`, usa o compartilhamento do sistema ou copia o Markdown. Quem confirma o envio é o próprio destino.

Para publicar: no GitHub, **Settings → Pages → Build and deployment → Deploy from a branch**, escolha a branch (por exemplo `migracao-tgcloud` ou `main`) e a pasta **`/docs`**. O endereço fica `https://romastefale.github.io/MDTXTRT/`.

`docs/` é gerado, não se edita à mão. Depois de mudar o código, no computador: `npm ci && npm run build:static` e faça commit de `docs/`. (A versão que está commitada agora foi compilada com o `bun`, porque o `esbuild` não rodou no ambiente onde foi gerada; o resultado funciona, mas os arquivos podem diferir byte a byte dos que o `esbuild` gera.)

Na versão estática o fundo segue o conceito do repositório [`romastefale/HTML`](https://github.com/romastefale/HTML) (`docs/TELA-CHEIA-E-BARRAS.md` de lá): `produto/fundo-organico-*.svg` são cópias exatas dos SVGs de `src/assets/fundo-*.svg` desse repositório (o `scripts/make-organic-bg.py` dele está desatualizado e gera outro arquivo, por isso copiei os SVGs reais); a camada do fundo é fixa, com `100lvh`, e começa e termina em `--edge` (`#8b82e6` no claro, `#1b1646` no escuro), a mesma cor do `theme-color`; o `html` não tem fundo e o `body` tem a cor do canvas; há o elemento de amostra de cor das barras do Safari 26. Também usa `viewport-fit=cover`, `env(safe-area-inset-*)` e `manifest.webmanifest` com `display: standalone` (instalado na tela inicial, abre em tela cheia).

## Railway

Nada precisa ser instalado no seu computador: o Railway faz `npm ci` e `npm run build` (o Railpack detecta o script `build`) e inicia com `node --import ./railway/register.mjs server.mjs` (veja `railway.json`).

1. **Branch:** aponte o serviço para `migracao-tgcloud` (Settings → Source → Branch). Depois, faça merge na `main` se quiser.
2. **Volume:** o serviço precisa de um volume (por exemplo montado em `/data`). O Railway define `RAILWAY_VOLUME_MOUNT_PATH` sozinho. Sem volume o banco fica só em memória e se perde a cada deploy.
3. **Variáveis** (as mesmas que o serviço já usava):

   | Variável | Valor |
   | --- | --- |
   | `TOKEN` | token do bot (BotFather) |
   | `PUBLIC_BASE_URL` | endereço público do serviço, `https://…up.railway.app` |
   | `MINI_APP_URL` | o mesmo endereço, com `/` no fim |
   | `PORT` | o Railway define |
   | `RAILWAY_VOLUME_MOUNT_PATH` | o Railway define com o volume |

4. **Deploy:** o Railway publica a cada push. No início, o servidor registra o webhook do bot sozinho (`setWebhook`). Veja `Webhook configurado` nos logs.
5. **Bot:** abra o bot no Telegram e envie `/start` (registra os comandos e o botão do Mini App). Depois teste `/novo`, `/rascunhos`, uma foto e um `.md`.

Diferenças em relação ao servidor antigo do Railway (que ficou só na `main`):
- Os rascunhos antigos, guardados em arquivos no volume, **não são migrados**; o banco novo é `mdtxtrt-db.json`, no mesmo volume.
- Não existem mais as transferências de navegador para o Telegram (`/telegram/open`, "handoff") nem rascunhos por chave de navegador: o Mini App só abre dentro do Telegram.
- O servidor roda uma instância só (o arquivo JSON não é compartilhado entre instâncias).

Local, sem Railway: `npm test` roda os testes do backend (inclui o servidor com um Bot API simulado).

## tgcloud (alternativa)

Passos que dependem do seu token e de um terminal. Referência: <https://core.telegram.org/bots/serverless>.

Em um comando: `python3 deploy.py` (Node 24 e Python 3). Ou manualmente, na raiz do repositório:

1. `npm install`, `npm run build`, `npm test`
2. `npx tgcloud login` (token `app<id>:<secret>`, guardado em `.tgcloud/`, fora do git)
3. `npx tgcloud push` e `npx tgcloud migrate`. O `push` imprime o endereço `https://app<id>.tgcloud.ai/`
4. Coloque esse endereço em `CONFIGURED` (`tgcloud/lib/config.js`) e rode `npx tgcloud push` de novo
5. Abra o bot e envie `/start`; depois `npx tgcloud status`

Se algum comando falhar, copie a mensagem completa (sem o token).
