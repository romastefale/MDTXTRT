# MDTXTRT

## Baseline de trabalho

A baseline de trabalho vigente é `7fe51e8401012232281db416ac0d9bd080c18ebf`, estado de produção após o PR #120.

Ela é um snapshot de referência, não um produto final, não uma especificação imutável e não deve ser preservada quando uma solicitação exigir correção ou evolução. Bugs presentes nela continuam sendo bugs. Requisitos novos ou corrigidos devem evoluir o código e, quando apropriado, substituir a própria baseline.

Para agentes/assistentes: não use a baseline, testes antigos ou um PASS automatizado para negar um problema observado pelo usuário. Não afirme validações, deploys ou comportamento real sem evidência correspondente. Consulte [AGENTS.md](AGENTS.md) e [BASELINE.md](BASELINE.md).

## Contratos de implementação

- [ARCHITECTURE.md](ARCHITECTURE.md): fronteiras arquiteturais e decisões deliberadas da evolução.
- [FORMAT_CONTRACT.md](FORMAT_CONTRACT.md): matriz de importação, exportação e publicação.
- [LOCAL_DRAFTS.md](LOCAL_DRAFTS.md): camadas local/volume, identidade, recuperação e proveniência de publicação dos rascunhos.
- [SURFACE_CONTRACT.md](SURFACE_CONTRACT.md): inventário Web/PWA/Mini App/bot e caminho funcional de cada capacidade anunciada.

## Validação final de release

- [GAP_ANALYSIS.md](GAP_ANALYSIS.md): análise formal de lacunas e bloqueios de liberação.
- [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md): gates automatizados, externos e físicos obrigatórios.
- [RELEASE_EVIDENCE_TEMPLATE.md](RELEASE_EVIDENCE_TEMPLATE.md): registro auditável das evidências.
- [RELEASE_ANCHOR.md](RELEASE_ANCHOR.md): política da âncora canônica imutável por SHA.
- [RELEASE_MANIFEST.json](RELEASE_MANIFEST.json): linhagem executável das seis etapas de implementação e requisitos da Etapa 7/7.
- [OWNER_ACCEPTANCE.md](OWNER_ACCEPTANCE.md): testes físicos/externos pós-entrega reservados ao proprietário.
