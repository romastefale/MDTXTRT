# Estado de polimento e finalização

## Escopo

O design translúcido consolidado permanece como contrato visual. A referência vigente é `aac423e012745c7873908ddc4a76371fb8218aa3`, adotada explicitamente após a referência histórica `dde30467ed9b0d108bac2ae7ad9bcac1137c169e`; veja `BASELINE.md`. Esta fase não adiciona funções fora do escopo já declarado pelo produto. O objetivo é fechar defeitos de edição, interação, implantação e paridade entre Web, PWA, Mini App e conversa privada com o bot.

## Estado verificado em `main`

Já estão implementados e cobertos por regressão:

- retenção do teclado virtual durante ações internas, sem forçar reabertura depois de dispensa pelo sistema;
- diálogos e menu de links ancorados ao controle que iniciou a ação;
- Hiperlink, Link e Botão com link com regras por destino;
- importação e exportação Web de `.md` e `.txt`;
- publicação Telegram e Telegraph com validação;
- manifesto PWA em modo standalone e tratamento separado das safe areas do browser e do Telegram;
- comandos privados do bot `/start`, `/app`, `/novo`, `/ajuda`, `/enviar` e `/exportar`;
- webhook autenticado e testes do fluxo de exportação do bot.

## Lacunas confirmadas

### 1. Enter em título e citação

O comportamento em `main` transforma o bloco em Corpo no primeiro Enter. Isso contradiz o contrato de edição pretendido.

Contrato:

- primeiro Enter em título ou citação mantém o mesmo tipo de bloco na nova linha;
- segundo Enter sobre a linha formatada vazia encerra o bloco e volta para Corpo;
- undo/redo e estado visual da toolbar continuam coerentes.

Esta correção faz parte deste PR.

### 2. Importação independente pelo bot

O bot registra `/exportar`, mas não registra `/importar`. O handler também ignora mensagens que não tenham `message.text`, portanto hoje um arquivo `.md` ou `.txt` recebido no chat privado não entra em nenhum fluxo de importação.

Não deve ser anunciado um comando `/importar` até que o fluxo completo esteja implementado e testado.

Critério mínimo:

- aceitar somente `.md` e `.txt`;
- obter o arquivo pelo Bot API e validar tamanho, nome, extensão e UTF-8;
- preservar o conteúdo de TXT literalmente e aplicar o mesmo contrato de Markdown já usado pelo produto;
- permitir uso pelo chat privado sem depender de a interface Web estar aberta;
- oferecer continuidade explícita para o Mini App sem publicar ou substituir um documento silenciosamente;
- cobrir download, formato inválido, arquivo ausente, erro de transporte e continuidade no Mini App.

### 3. Abertura fullscreen do Mini App

O PR #82 foi encerrado sem integração: comparava altura e largura para inferir orientação física. O PR #88 usa estados e eventos oficiais de fullscreen, viewport e safe areas do Telegram. O gate visual histórico divergente foi investigado: os screenshots do PR #88 são byte-idênticos aos registrados antes desta etapa. A referência vigente foi deliberadamente atualizada para o design translúcido integrado, sem alterar a aparência do PR #88. A validação física das formas de abertura e dos dispositivos permanece necessária.

### 4. Evidência real de plataforma

A suíte automatizada não substitui os testes físicos. Antes de declarar o produto finalizado, registrar evidência para:

- browser instalado como PWA em iOS e Android;
- Mini App em iOS e Android;
- teclado fechado, aberto, dispensado manualmente e reaberto;
- inserção de link com teclado aberto;
- título/citação com Enter simples e Enter duplo;
- importação e exportação reais;
- publicação Telegram em chat autorizado;
- criação, recuperação e edição da mesma página Telegraph após reinício do backend;
- falhas de rede e armazenamento sem perda ou duplicação.

## Ordem de fechamento

1. Corrigir e integrar a semântica de Enter com regressão.
2. Implementar a importação privada do bot sem expor comando incompleto.
3. Resolver o gate visual do PR #82 sem alterar o baseline por conveniência.
4. Executar a matriz física Web/PWA/Mini App.
5. Executar publicação Telegram/Telegraph autorizada e matriz de falhas.
6. Selar um novo candidato imutável somente depois de todos os gates passarem.

## Critério de conclusão

O produto só deve ser tratado como finalizado quando todas as funções visíveis ou registradas tiverem caminho funcional completo, testes automatizados verdes e evidência real nas superfícies que dependem de navegador, sistema operacional, Telegram ou serviços externos.
