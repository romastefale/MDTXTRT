# ADR-0002 — Rebuild ground-up a partir de `new`

## Status

Proposto na issue #57. Esta edição não é continuação arquitetural da #54 ou #56.

## Contexto

O pedido original exigia criar a arquitetura correta considerando o erro da #54 e o estudo forense. A execução anterior reduziu esse objetivo a três correções e partiu do head da #54. A issue #43, porém, determina reconstrução a partir de arquitetura própria, com runtime/UI próprios, documento canônico JSON, SQLite, histórico ramificado, importação e autenticação Telegram Web App.

O estudo forense também demonstra um problema de classe arquitetural: decisão de roteamento e compilação podiam divergir porque eram contratos separados.

## Decisão

A nova linha parte diretamente do commit `3259f34c5d4c49a191dad0452b87c1ba98c67578` de `new`.

A implementação legada continua no repositório, mas o pacote `mdtxtrt/` não importa `main` e não usa `install(...)`, monkey patch, service locator dinâmico ou wrapper para sobrescrever módulos existentes.

### Fonte canônica

`CanonicalDocument` é JSON estruturado. Markdown e TXT entram por importadores. Construções ainda não modeladas são preservadas como `raw_markdown`, e os bytes originais de arquivos importados são persistidos separadamente.

### Histórico

Revisões são append-only. `drafts.active_revision_id` é apenas um ponteiro de navegação. Se o usuário desfaz e edita a partir de uma revisão que já possui filho, uma nova branch é criada. O futuro anterior não é apagado.

### Sessão

Cursor, seleção, scroll e bloco ativo são persistidos em `editor_sessions`, fora do JSON do documento.

### Autenticação

`mdtxtrt/auth.py` valida Telegram Web App `initData`. O TTL padrão é 3600 segundos e é configurado em `mdtxtrt/config.py`.

### UI

`mdtxtrt/static/` é uma UI própria. Não concatena `ui.*.js`. A primeira edição fornece o esqueleto visual e trabalha diretamente com nós canônicos.

## Limites desta edição

Esta edição estabelece as fronteiras e mecanismos aprovados, mas não declara implementadas as 40 decisões funcionais completas nem projeções integrais Telegram/Telegraph. Formatação inline Rich, revisão de incompatibilidades, mídia/BLOB lifecycle completo, publicação Telegram/Telegraph e integração final do `/import` do bot continuam como trabalho da mesma arquitetura, sem voltar ao legado.

Nenhum teste foi criado ou executado pelo ChatGPT, conforme a regra permanente da #43.

## Proveniência

Todos os arquivos novos desta edição são `NEW_FILL`: implementação nova derivada das decisões aprovadas e da análise observável. Nenhum arquivo é rotulado como `RECOVERED_LITERAL`.
