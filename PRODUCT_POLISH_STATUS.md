# Estado do produto — auditoria final 7/7

## Estado automatizado do `main` de origem

A Etapa 7/7 começou a partir de `main` `ec3def6622818c0411bbeb94165716c7f30fa927`, depois da integração das seis etapas de implementação.

No ponto de partida:
- Regression verification do `main` passou com a suíte completa de 162 testes;
- o PR da Etapa 6/7 passou o Release validation automatizado, incluindo build limpo, bundles reproduzíveis e baseline visual;
- o volume Railway `MDTXTRT-volume` está configurado em `/data`;
- o código contém persistência de rascunho no volume, proveniência operacional Telegram, edição da mesma publicação, título explícito e overlays limitados pela área útil.

Esse estado **não equivale a release aprovada**. Os gates externos/físicos permanecem separados.

## Capacidades com caminho funcional coberto por código/regressão

A auditoria estática e a suíte cobrem:
- edição transacional, seleção, undo/redo e entrada formatada;
- importação/exportação Markdown e TXT na interface;
- importação/exportação pela conversa privada com o bot;
- comandos privados `/start`, `/app`, `/novo`, `/ajuda`, `/enviar`, `/exportar`, `/importar`;
- menus, submenus, links, estruturas, interações e mídia declaradas, com filtragem por destino;
- handoff browser/PWA → Mini App sem publicação implícita;
- publicação Telegram/Telegraph com validação de contrato;
- persistência de rascunho no volume e recuperação sintética após reinício;
- vínculo Telegram usuário/documento/chat/messageId e edição posterior da mesma publicação;
- PWA `standalone`;
- fullscreen/viewport/safe areas oficiais no Mini App e `visualViewport` no browser;
- posicionamento de menus/diálogos acima da barra inferior;
- build determinístico e baseline visual automatizada.

O inventário normativo está em `SURFACE_CONTRACT.md`.

## Correções documentais/gates descobertos na Etapa 7/7

A auditoria encontrou que o conjunto antigo de documentos de release ainda apontava para uma sequência histórica de PRs #56/#58/#61/#63/#66/#68 e não para as seis etapas que produziram o `main` atual.

A Etapa 7/7 corrige esse desvio sem adicionar funcionalidade:
- `RELEASE_MANIFEST.json` passa a registrar PRs #84, #86, #88, #90, #92 e #95;
- a validação final passa a auditar explicitamente o contrato de superfícies;
- PWA instalada passa a ter linha própria na matriz física;
- persistência/reinício do rascunho Railway passa a ser gate real separado do Telegraph;
- a evidência Telegram passa a exigir primeira publicação **e** edição posterior do mesmo `messageId`;
- importação/exportação real passa a ter matriz explícita;
- a matriz de falhas inclui volume Railway, edição Telegram incerta e revisão persistente obsoleta.

## Gates ainda não comprovados

Até que exista evidência observável contra o mesmo Release Anchor, permanecem **BLOCKING**:
- Web/PWA/Mini App físicos em iOS e Android, teclado aberto/fechado;
- importação/exportação real nas superfícies exigidas;
- Telegram real em bot/chat autorizados, incluindo edição posterior da mesma Rich Message;
- Telegraph real, incluindo recuperação/edição depois de reinício;
- persistência real do rascunho no volume depois de reinício/deploy e ausência de cache local;
- falhas reais/controladas de rede e armazenamento;
- rollback operacional preservando o volume;
- correspondência entre SHA aprovado e SHA efetivamente implantado.

Nenhum mock, JSDOM, screenshot automatizado ou resposta sintética converte esses itens em PASS.

## Critério final

O produto recebe status **RELEASE APPROVED** somente quando `RELEASE_VALIDATION.md`, `RELEASE_EVIDENCE_TEMPLATE.md` e o workflow final estiverem satisfeitos contra um único SHA imutável.

Enquanto qualquer evidência externa/física estiver ausente, o estado máximo é **CANDIDATE VALIDATED**; se nem todos os gates automatizados do candidato estiverem verdes, o estado é **BLOCKED**.
