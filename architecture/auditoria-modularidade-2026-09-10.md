# Auditoria de modularidade e monkey patch — 2026-09-10

## Escopo e método

Esta auditoria considera como **runtime de produção** o comando declarado no
`Procfile` e em `railway.json`: `python app.py`. Foram inspecionados o `HEAD`
`0cd0866`, os commits funcionais mais recentes (`8fbca50` e `3e5af6b`), os
imports do entrypoint, o registro de rotas, os arquivos estáticos efetivamente
servidos e indicadores usuais de monkey patch (`install(...)`, substituição de
atributos, retenção de funções originais e alteração dinâmica de módulos).

O código na raiz que não é alcançado por `app.py` foi classificado como
**legado presente no repositório**, não como parte do processo ativo. Essa
distinção é necessária: procurar apenas pela palavra `install` produz um falso
positivo sobre o runtime atual, enquanto ignorar a raiz esconderia dívida
técnica real e o risco de ela voltar a ser usada.

## Veredito executivo

| Pergunta | Veredito | Confiança |
| --- | --- | --- |
| O runtime ativo é modular? | **Sim, em nível de domínios**, com composição explícita e dependências direcionadas para `mdtxtrt/`. | Alta |
| A localização atual é a mais inteligente/eficiente possível? | **Ainda não.** Há boa separação macro, mas composição de rotas fragmentada e módulos concentradores grandes. | Alta |
| Há monkey patch no runtime ativo? | **Não foram encontrados indícios.** | Alta |
| Há monkey patch no repositório? | **Sim, no legado da raiz**, por meio da família de funções `install(...)`. | Alta |
| O código funcional mais recente introduziu monkey patch? | **Não.** Nem `8fbca50` nem `3e5af6b` adicionam esse padrão. | Alta |
| A mudança visual mais recente atingiu a UI de produção? | **Não.** `8fbca50` alterou a UI legada da raiz, enquanto `app.py` serve `mdtxtrt/static/`. | Alta |

## O que está bem modularizado

1. **Composition root único e legível.** `app.py` instancia repositório,
   serviços, publicação e runtime do bot de forma explícita. Não importa
   `main.py`, `runtime_v2.py` nem os módulos `rich_*` legados.
2. **Separação macro coerente.** Persistência (`storage.py`), domínio
   (`domain.py`), autenticação (`auth.py`), conversão, ativos, importação,
   publicação e validação Telegram vivem em módulos próprios.
3. **UI ativa declarativa.** O servidor aponta para `mdtxtrt/static/index.html`,
   que carrega módulos ES diretamente; não concatena a sequência `ui.N.js`.
4. **Sem mutação dinâmica no pacote ativo.** A busca em `app.py` e `mdtxtrt/`
   não encontrou funções `install`, `setattr`, escrita em `sys.modules`, troca
   de `__dict__` ou armazenamento de funções `_ORIGINAL_*`.
5. **Mudança Telegram recente localizada.** O commit `3e5af6b` distribuiu a
   alteração entre validação, representação, publicação, servidor, bot e teste,
   respeitando as fronteiras do novo pacote em vez de sobrescrever o legado.

## Pontos que impedem classificar a arquitetura como ótima

### P1 — a alteração visual mais recente está na árvore errada

O commit `8fbca50` alterou `ui_shell.html`, `ui.02.js` e `ui.css`, verificados
por `tests/test_toolbar_ui.py` via `runtime_v2.render_index()`. Porém, produção
executa `app.py`; `mdtxtrt.server` serve `mdtxtrt/static/index.html`. Assim, o
novo estado ARIA e o ajuste responsivo não alcançam o editor implantado.

Além de trabalho ineficiente, isso cria duas verdades de frontend: a ADR de
design descreve critérios que a UI ativa contradiz. Por exemplo, a UI ativa usa
`overflow-x:auto` na barra e no rodapé, enquanto a revisão recente determina
que não haja rolagem horizontal.

**Recomendação:** portar conscientemente o resultado visual para
`mdtxtrt/static/`, criar os testes contra essa árvore e congelar/remover os
testes visuais do runtime legado. Não se recomenda simplesmente copiar os
arquivos: a UI ativa edita documento canônico, enquanto a antiga edita texto.

### P1 — convivência do legado torna a fronteira fácil de violar

Há duas aplicações e duas famílias de frontend no mesmo nível do repositório.
Os módulos legados `runtime_v2.py`, `drafts.py`, `rich_delivery.py`,
`rich_roundtrip.py`, `rich_media.py`, `rich_media_roundtrip.py`,
`rich_integrity.py`, `rich_buttons.py`, `message_buttons.py`, `map_location.py`,
`dm_command_ui.py` e `preview_security.py` expõem `install(...)` ou participam
desse modelo de composição por mutação.

Eles não são carregados por produção hoje, mas continuam testados e parecem
válidos para quem chega ao projeto. Isso explica como uma mudança recente pôde
ser aplicada e aprovada na superfície errada.

**Recomendação:** mover o legado para um diretório explicitamente arquivado ou
removê-lo após confirmar que não existe consumidor externo. Até lá, manter uma
regra automatizada que impeça imports do legado a partir de `app.py` e
`mdtxtrt/`.

### P2 — composição HTTP está dividida entre dois lugares

`create_web_app()` registra a maior parte das rotas em `server.py`, mas
`app.py` anexa depois rotas de ciclo de vida, conversão, preferências e workflow
de importação. O padrão não é monkey patch — são chamadas públicas explícitas —,
mas obriga o leitor a consultar dois registros para descobrir a API completa e
permite esquecer um `attach_*` em outro entrypoint ou teste.

**Recomendação:** escolher uma única convenção. A opção mais simples é cada
módulo oferecer `routes = web.RouteTableDef()` e o composition root incluir
todas as tabelas em uma lista explícita. Alternativamente, `create_web_app()`
deve receber/incluir todos os registradores e ser a única fábrica completa.

### P2 — módulos concentradores aumentam custo de mudança

`mdtxtrt/static/app.js` tem cerca de 1.550 linhas; `server.py`, `storage.py` e
`publishing.py` passam de 500 linhas. Quantidade de linhas não prova desenho
ruim, mas aqui coincide com múltiplas responsabilidades: `server.py` contém
handlers, health/readiness, serialização e composição; `publishing.py` mistura
planejamento e integrações Telegram/Telegraph; `app.js` agrega estado, edição,
conversão, importação e publicação.

**Recomendação incremental:** primeiro separar código por razão de mudança, sem
criar abstrações genéricas: rotas Telegram/Telegraph, health/runtime, adapters
de publicação e controladores frontend por workflow. Manter o documento
canônico e o estado da sessão como contratos centrais evita trocar um monólito
por módulos fortemente acoplados.

### P3 — service registry por chaves textuais

Handlers recuperam dependências por strings como `request.app["documents"]`.
É um recurso normal do aiohttp e não é monkey patch, mas erros de nome só
aparecem em runtime e a lista de dependências de cada handler fica implícita.

**Recomendação:** usar `web.AppKey` tipadas, centralizadas em um módulo pequeno,
antes de aumentar o número de serviços. Isso preserva injeção explícita sem
introduzir container dinâmico.

## Evidência de monkey patch no legado

O padrão legado é inequívoco: funções `install(base_module)` recebem um módulo,
guardam referências em globais como `_BASE` e `_ORIGINAL_*` e substituem
comportamentos do objeto recebido. Os testes antigos chamam esses instaladores
diretamente. Isso deve ser chamado de monkey patch mesmo que tenha sido uma
estratégia deliberada de migração.

No runtime ativo não há evidência equivalente. `app.middlewares.append(...)` e
`app.router.add_patch(...)` não são monkey patch: o primeiro usa a API pública
de composição do aiohttp e o segundo registra uma rota HTTP com método PATCH.

## Guardrail adicionado

`tests/test_architecture_boundaries.py` fixa apenas propriedades verificáveis e
úteis da fronteira atual:

- produção inicia em `app.py`;
- `app.py` e `mdtxtrt/` não importam os módulos legados;
- o pacote ativo não adota instaladores/mutação típicos do legado;
- a UI servida pertence a `mdtxtrt/static/` e não referencia `ui.N.js`.

O teste é intencionalmente restrito ao runtime ativo. Proibir `install(...)` no
repositório inteiro faria a suíte falhar por dívida conhecida sem distinguir
risco implantado de código arquivável.

## Ordem sugerida de correção

1. Portar e testar o design de `8fbca50` na UI canônica ativa.
2. Marcar/mover/remover a árvore legada para eliminar ambiguidade operacional.
3. Unificar o registro de rotas e adotar `web.AppKey`.
4. Dividir `app.js`, `server.py` e `publishing.py` por workflows concretos.

Até que os itens 1 e 2 sejam concluídos, o diagnóstico mais preciso é:
**arquitetura ativa modular e sem monkey patch, mas repositório globalmente
ambíguo, com monkey patch legado e uma mudança recente localizada fora do
caminho de produção.**
