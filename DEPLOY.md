# Publicar o MDTXTRT no Telegram Serverless

Passos que dependem da sua conta, do seu token e de rede. Rode na raiz do repositório.
Referência: <https://core.telegram.org/bots/serverless>.

1. **Dependências e build** (Node 24 recomendado)
   ```
   npm install
   npm run build        # editor-core.js, ui.js e a pasta dist/
   npm test             # simulação local do backend (não substitui testar na plataforma)
   ```
2. **Login** (terminal interativo; o token tem a forma `app<id>:<secret>` e fica em `.tgcloud/`, fora do git)
   ```
   npx tgcloud login
   ```
3. **Enviar código e site**
   ```
   npx tgcloud push     # relata mudanças de banco pendentes, mas não aplica
   npx tgcloud migrate  # cria as tabelas de tgcloud/schema.js
   ```
   O `push` imprime o endereço do site: `https://app<id>.tgcloud.ai/`.
4. **Configurar a URL do Mini App**: coloque esse endereço em `MINI_APP_URL`
   (`tgcloud/lib/config.js`) e rode `npx tgcloud push` de novo. Enquanto estiver vazia, o bot falha de propósito.
5. **Configurar o bot**: abra o bot no Telegram e envie `/start`. Isso registra os comandos e o botão de menu do Mini App.
6. **Conferir**: `npx tgcloud status`; envie `/novo`, `/rascunhos`, uma foto e um `.md` ao bot.

Se algum comando falhar, copie a mensagem completa (sem o token).
