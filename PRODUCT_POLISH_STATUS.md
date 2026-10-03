# Estado do produto

## Estado atual (01/10/2026)

**Fases 0, 1 e 2 concluídas. Os ajustes finos que restavam no código também.** A aceitação física continua com o proprietário.

- **Fase 0 concluída (#129):** fork `romastefale/liquid-glass` instalado de verdade, testes que congelavam o design removidos e testes em navegador real (Playwright, Chromium e WebKit, 390px e 1280px, claro e escuro).
- **Correções urgentes concluídas:** o servidor do Railway voltou a entregar o `editor-core.js`, que deixava o Mini App sem editor (#130). A falha ao buscar o rascunho no servidor oferece tentar de novo ou começar outro rascunho sem sobrescrever a cópia (#131). O botão Voltar do Telegram fecha essa escolha sem descartar nada (#132).
- **Fase 1 concluída (#135–#138):** vidro do site de referência [romastefale/HTML](https://romastefale.github.io/HTML/), lentes WebGL 2 com refração, material translúcido, aro fino, sem contorno azul, espaçamento uniforme e nenhum menu cortado na tela.
- **Fase 2 concluída:** CSS em `styles.css` (#139); estado dos menus, do diálogo e da biblioteca no React (#140); teclado do iPhone, atalhos Markdown, modo escuro e refração nas barras (#141); `server/` e `src/app/` (#144, #145); toast como estado React (#146).
- **Auditoria Telegram/Telegraph concluída (#143).**
- **Ajustes finos concluídos:** download de MD/TXT no Mini App por `WebApp.downloadFile` (#148); swipes verticais desativados quando a versão permite (#149); webhook idempotente por `update_id` (#150); + e ☰ no tema claro como os botões do site (#151). O ícone do destino Telegraph voltou a ser o T do Telegraph — o símbolo de documento do Material Symbols tinha tomado o lugar. Com o teclado aberto, o menu usa a mesma origem do `position:fixed`: se a área visível está deslocada, o menu acompanha o botão em vez de abrir fora do lugar; se o `fixed` já acompanha a área visível, a altura do teclado não é somada de novo.
- **Safari (#154):** com "Bloquear Todos os Cookies", ler o `localStorage` lança erro e o IndexedDB também fica fechado. O app passa a guardar o rascunho, a identidade do navegador e os anexos em memória durante a sessão e mostra um aviso só, com o caminho do ajuste (Ajustes › Apps › Safari › Avançado; no iOS 17, Ajustes › Safari › Avançado). A edição não fica pausada esperando uma cópia no servidor que não pode existir; o rascunho novo começa na mesma página depois de confirmar; o tema muda sem recarregar só nesse modo (recarregar perderia o texto). Fora desse modo, o fluxo de tentar de novo ou começar rascunho novo (#131) e o recarregamento ao trocar o tema continuam iguais. O diálogo sem âncora não se prende mais ao editor de tela cheia: fica abaixo da barra superior, cresce até mostrar o texto inteiro e só rola por dentro se nem a área livre bastar (antes ficava em cima da barra com 53px e cortava o texto). O aviso de retrato mede de novo depois do primeiro quadro e, em tela de toque, usa a orientação do aparelho, porque a medida provisória do carregamento (largura de 980px) disparava o aviso em retrato.
- **De propósito, sem mudança:** o título do Telegraph continua movido pelo script em `index.html` (um input controlado no React mexe no foco e no teclado do iPhone); o `inert` do diálogo continua no DOM porque atinge elementos que não são do React.
- **Pendente com o proprietário (Pi):** segredos e variáveis no Railway, configuração no BotFather (Mini App, domínio, menu) e painel do Railway; aceitação física no iPhone, no app instalado e no Mini App.

Panfleto do produto, com tutorial e roteiro: [romastefale.github.io/MDTXTRT/produto/](https://romastefale.github.io/MDTXTRT/produto/).

## Histórico da entrega funcional

A entrega funcional anterior terminou nos PRs abaixo. Os invariantes listados continuam valendo.

A cadeia funcional terminou com:
- PR #101 — fidelidade editor → publicação;
- PR #104 — histórico imutável de revisões Telegram, migração de rascunhos e biblioteca de rascunhos/Telegraph;
- PR #105 — hardening final fail-closed, removendo fallbacks de DOM bruto e ocultação silenciosa de estado persistente corrompido.

O fechamento documental posterior a esses PRs não altera semântica de runtime. O SHA exato de `main` continua sendo validado automaticamente em cada push por regressão, release gates e deployment.

## Invariantes entregues

A implementação e a regressão cobrem:

- editor transacional como fonte obrigatória de verdade para serialização, restauração, handoff, busca/substituição e exportação;
- ausência de fallback para o DOM `contenteditable` bruto nos caminhos canônicos do documento;
- edição, seleção, undo/redo, composição, paste e entrada formatada;
- fidelidade semântica editor → publicação sem texto de demonstração serializado;
- importação/exportação Markdown e TXT na interface;
- importação/exportação pela conversa privada com o bot;
- comandos privados `/start`, `/app`, `/novo`, `/rascunhos`, `/telegraph`, `/ajuda`, `/enviar`, `/exportar`, `/importar`;
- menus, submenus, links, estruturas, interações e mídia declaradas, filtrados por destino;
- handoff browser/PWA → Mini App sem publicação implícita;
- publicação Telegram com histórico de revisões no chat: mensagem anterior preservada, aviso de atualização e nova Rich Message;
- publicação/edição Telegraph vinculada ao mesmo documento/path;
- persistência de rascunhos no Railway volume e recuperação após reinício;
- normalização/migração explícita de artefatos transitórios do ProseMirror sem afrouxar a allow-list semântica;
- recuperação do volume fail-closed: erro/ambiguidade bloqueia edição e gravação em vez de criar substituto;
- biblioteca persistente fail-closed: registro corrompido não desaparece silenciosamente da listagem;
- isolamento de proprietário para rascunhos e Telegraph;
- biblioteca de rascunhos e páginas Telegraph no Web/PWA e Mini App;
- PWA standalone;
- fullscreen/viewport/safe areas oficiais no Mini App e `visualViewport` no browser;
- posicionamento de menus/diálogos acima da barra inferior;
- build determinístico, bundles reproduzíveis e auditoria de superfícies; comparação visual histórica é apenas diagnóstico opcional.

## Persistência e degradação

`/data` é a camada durável operacional em produção. `localStorage` e IndexedDB são cache/recuperação local e não são promovidos silenciosamente a substitutos do volume.

Falhas críticas de integridade são fail-closed ou explicitamente incertas:
- falha de identidade impede operação dependente de identidade;
- revisão antiga não sobrescreve revisão persistente mais nova;
- falha/ambiguidade de recuperação do volume não abre um rascunho substituto editável;
- resultado Telegram incerto não dispara repetição cega;
- estado persistente corrompido na biblioteca não é omitido como se não existisse;
- ausência do núcleo transacional interrompe a operação em vez de cair para DOM bruto.

Compatibilidade histórica de leitura ou endpoints legados explicitamente documentados não é usada como fallback depois de uma falha do caminho persistente atual.

## Pós-entrega

`OWNER_ACCEPTANCE.md` descreve verificações físicas/externas que o proprietário pode executar depois da entrega. Elas são evidência pós-entrega e **não constituem trabalho de engenharia pendente nem bloqueiam a conclusão formal da implementação**.

`RELEASE_VALIDATION.md` mantém, separadamente, um processo opcional de certificação `RELEASE APPROVED` por SHA exato. Esse SHA registra qual estado foi certificado; não é uma âncora imutável, não congela o produto e não limita a evolução seguinte.

Se uma verificação posterior revelar um defeito, registre o SHA que expôs o problema e corrija a partir do estado corrente do repositório; o SHA histórico não define nem limita a implementação seguinte.

## Conclusão

O comportamento funcional descrito acima está entregue. A fase 1 da interface, a fase 2, a auditoria Telegram/Telegraph e os ajustes finos listados no início também. O que fica de fora do código é a aceitação física.
