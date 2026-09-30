# Estado do produto — engenharia concluída

## Estado

**ENGINEERING DELIVERY COMPLETE**

A implementação, correções, auditoria, hardening e automação sob responsabilidade de engenharia estão concluídas.

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

`RELEASE_VALIDATION.md` e `RELEASE_EVIDENCE_POLICY.md` mantêm, separadamente, um processo opcional de certificação `RELEASE APPROVED` por SHA exato. Esse SHA registra qual estado foi certificado; não é uma âncora imutável, não congela o produto e não limita a evolução seguinte.

Se uma verificação posterior revelar um defeito, registre o SHA que expôs o problema e corrija a partir do estado corrente do repositório; o SHA histórico não define nem limita a implementação seguinte.

## Conclusão

O estado do produto do ponto de vista de implementação é **ENGINEERING DELIVERY COMPLETE**. Não há funcionalidade, correção, merge ou hardening de código conhecido pendente neste ciclo.
