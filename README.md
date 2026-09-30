# MDTXTRT

## Baseline de trabalho — ponto de partida evolutivo

A baseline de trabalho é **sempre um estado mutável a partir do qual o produto continua evoluindo**. A regra vale permanentemente para estados atuais e futuros. Comparações com SHAs históricos são diagnósticos opcionais e explícitos; nenhum SHA histórico fica associado permanentemente à baseline.

**A baseline não é uma base imutável, um estado a ser congelado nem um alvo de reprodução permanente.** Ela é o ponto de partida conhecido do produto para que a próxima evolução possa ser implementada, comparada e validada com rastreabilidade.

Consequentemente:

- o que estiver correto na baseline pode ser preservado como contrato intencional;
- o que estiver incorreto, incompleto, limitado ou superado deve ser alterado;
- requisitos atuais prevalecem sobre comportamentos incidentais do snapshot;
- testes e documentação devem acompanhar a evolução do comportamento pretendido;
- quando o produto evolui deliberadamente e o novo estado é aceito, a referência de baseline deve evoluir também.

Baseline, portanto, significa **“estado conhecido a partir do qual evoluímos”**, e não **“estado que futuras mudanças devem reproduzir”**.

Bugs presentes nela continuam sendo bugs. Uma característica não se torna requisito apenas por existir no SHA de referência. Compatibilidade com comportamento anterior só deve ser mantida quando ela própria for um requisito ou contrato intencional.

Para agentes/assistentes: não use a baseline, `main`, testes antigos ou um PASS automatizado para negar um problema observado pelo usuário ou bloquear uma evolução solicitada. Consulte [AGENTS.md](AGENTS.md) e [BASELINE.md](BASELINE.md).

## Contratos de implementação

- [ARCHITECTURE.md](ARCHITECTURE.md): fronteiras arquiteturais e decisões deliberadas da evolução.
- [FORMAT_CONTRACT.md](FORMAT_CONTRACT.md): matriz de importação, exportação e publicação.
- [LOCAL_DRAFTS.md](LOCAL_DRAFTS.md): camadas local/volume, identidade, recuperação e proveniência de publicação dos rascunhos.
- [SURFACE_CONTRACT.md](SURFACE_CONTRACT.md): inventário Web/PWA/Mini App/bot e caminho funcional de cada capacidade anunciada.

## Validação final de release

- [GAP_ANALYSIS.md](GAP_ANALYSIS.md): análise formal de lacunas e bloqueios de liberação.
- [RELEASE_VALIDATION.md](RELEASE_VALIDATION.md): gates automatizados, externos e físicos obrigatórios.
- [RELEASE_EVIDENCE_TEMPLATE.md](RELEASE_EVIDENCE_TEMPLATE.md): registro auditável das evidências.
- [RELEASE_ANCHOR.md](RELEASE_ANCHOR.md): política de evidência histórica por SHA, sem autoridade para congelar a evolução.
- [RELEASE_MANIFEST.json](RELEASE_MANIFEST.json): linhagem executável das seis etapas de implementação e requisitos da Etapa 7/7.
- [OWNER_ACCEPTANCE.md](OWNER_ACCEPTANCE.md): testes físicos/externos pós-entrega reservados ao proprietário.


A mutabilidade é uma invariante permanente do projeto: nenhum candidato, release, aprovação, SHA, tag ou evidência futura pode congelar o produto. Estados aceitos continuam substituíveis, mudanças continuam permitidas e evoluções corretas continuam promovíveis sem obrigação de paridade histórica.
