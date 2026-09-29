# MDTXTRT

## Baseline de trabalho

A baseline de trabalho explicitamente adotada por este repositório é o commit:

`aac423e012745c7873908ddc4a76371fb8218aa3`

Esse commit corresponde ao `main` após a etapa 2/6 e fixa o design translúcido consolidado como referência de comparação. A referência anterior do PR #53 permanece documentada em [BASELINE.md](BASELINE.md).

A baseline não representa congelamento do código, versão final imutável nem impedimento a mudanças posteriores. A branch `main` pode avançar normalmente com correções, refinamentos e novas funcionalidades. Alterações posteriores devem ser entendidas como evolução a partir desta referência enquanto ela permanecer documentada como baseline vigente.

Uma baseline futura somente substitui esta quando essa mudança for feita de modo explícito no repositório, identificando ao menos o novo commit e a razão da substituição.

Consulte [BASELINE.md](BASELINE.md) para a definição operacional, regras de evolução e instruções de reprodução do estado de referência.

## Contratos de implementação

- [ARCHITECTURE.md](ARCHITECTURE.md): fronteiras arquiteturais e decisões deliberadas da evolução.
- [FORMAT_CONTRACT.md](FORMAT_CONTRACT.md): matriz de importação, exportação e publicação.
- [LOCAL_DRAFTS.md](LOCAL_DRAFTS.md): camadas local/volume, identidade, recuperação e proveniência de publicação dos rascunhos.

## Validação final de release

- [GAP_ANALYSIS.md](GAP_ANALYSIS.md): análise formal de lacunas e bloqueios de liberação.
- [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md): gates automatizados, externos e físicos obrigatórios.
- [RELEASE_EVIDENCE_TEMPLATE.md](RELEASE_EVIDENCE_TEMPLATE.md): registro auditável das evidências.
- [RELEASE_ANCHOR.md](RELEASE_ANCHOR.md): política da âncora canônica imutável por SHA.
- [RELEASE_MANIFEST.json](RELEASE_MANIFEST.json): linhagem executável das seis etapas e requisitos de release.
