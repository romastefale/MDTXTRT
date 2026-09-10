# Revisão visual — referência `header-proportion-responsive`

## Objetivo

Recuperar a hierarquia visual enxuta da referência sem reintroduzir a interface
monolítica antiga nem remover recursos do editor atual. A referência analisada é
o `index.html` da branch `header-proportion-responsive`: cabeçalho compacto,
marca discreta, alternância clara entre edição e prévia, área de escrita dominante
e ações persistentes no rodapé.

## Comparação e decisão

| Aspecto | Referência | Aplicação atual | Decisão aplicada |
| --- | --- | --- | --- |
| Cabeçalho | Marca, versão e menu em uma linha | Marca proporcional e importação direta | Manter a proporção responsiva e a importação de um toque; não trazer de volta texto de versão que disputa espaço. |
| Visualização | Duas abas: editar e prévia Telegram | Duas abas compactas | Preservar a nomenclatura explícita “prévia Telegram” e representar as abas semanticamente com `tablist`, `tab` e `aria-selected`. |
| Formatação | Ferramentas aparecem apenas após uma seleção | Treze famílias sempre acessíveis | Manter a barra atual porque ela torna os recursos Rich descobríveis e eficientes. A barra usa uma grade de 13 colunas, nunca rolagem horizontal. |
| Recursos | Inserção e opções concentradas em folhas inferiores | Ações diretas, menus por família e folhas contextuais | Manter os fluxos atuais de mídia, estrutura, listas, matemática, publicação e rascunhos. |
| Rodapé | Inserir e enviar | Exportar, Telegraph e enviar ao chat | Manter as três saídas atuais, todas visíveis em grade e sem rolagem. |

## Regras de implementação

1. **Sem rolagem na barra de opções.** A barra principal deve continuar com
   `grid-template-columns: repeat(13, minmax(0, 1fr))` e `overflow: hidden`.
   Em telas de até 380 px, espaçamento, padding e ícones são reduzidos, em vez de
   transformar a barra em um carrossel horizontal.
2. **Área útil primeiro.** Cabeçalho, abas, barra e rodapé são faixas de altura
   controlada. Somente editor, prévia, menus extensos e folhas podem rolar.
3. **Safe areas do Telegram.** Topo e laterais devem considerar tanto `env()`
   quanto as variáveis de safe area/content safe area fornecidas pela Mini App.
4. **Funcionalidade antes de nostalgia visual.** O contraste monocromático, a
   tipografia compacta e a hierarquia da referência são preservados, mas os
   comandos atuais continuam agrupados por Texto, Título, Citação, Código,
   Matemática, Lista, Mídia e Estrutura.
5. **Estado perceptível e acessível.** A aba ativa deve ter indicador visual e
   `aria-selected`; botões de formato direto mantêm `aria-pressed`, foco visível
   e rótulo acessível.

## Critérios de aceite

- Os 13 controles primários estão simultaneamente visíveis a partir de 320 px.
- A barra de ferramentas e o rodapé não têm `overflow-x: auto`.
- Alternar entre edição e prévia atualiza aparência e estado acessível.
- Importação, exportação Markdown, Telegraph, envio ao chat e todos os menus Rich
  permanecem alcançáveis.
- Em altura reduzida, as faixas de navegação encolhem e o editor preserva a maior
  parte possível da janela.
