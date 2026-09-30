# Release validation contract — Etapa 7/7

This document defines the optional **release-certification** gate used to award the `RELEASE APPROVED` label and record exact-SHA release evidence. It is separate from engineering delivery completion. Neither engineering completion nor `RELEASE APPROVED` means the product is final or must stop evolving; later corrections and implementations supersede older behavior when intentionally accepted.

Engineering work is complete when the implementation is integrated, exact-main automated gates pass and that exact SHA is successfully deployed. The additional external/physical evidence below may be collected post-delivery; its absence does not represent unfinished code.

`RELEASE APPROVED` never freezes or restricts later evolution. Every certified state remains mutable and supersedable. The label is intentionally stricter only about the evidence attached to that historical certification: it is awarded only when **every** automated, external, physical-device, persistence, fault and rollback criterion below is PASS against the **same exact Git commit SHA**. Mocks and synthetic viewport tests are never recorded as physical or external evidence.

## Gate A — exact candidate and complete regression

Run from a clean checkout of the exact candidate SHA.

Acceptance:
- checkout is the candidate SHA, never a synthetic PR merge ref;
- `git rev-parse HEAD` equals the candidate;
- `npm test` passes with no skipped test used to waive a known defect;
- the run records the exact SHA and Actions run.

Any correction creates a new candidate and restarts the release gates.

## Gate B — clean reproducible build

Runtime contract:
- Node 24.21.0;
- npm 11.19.0;
- committed `package-lock.json`;
- clean `npm ci`.

Acceptance:
1. `npm run build` succeeds;
2. rebuilt `editor-core.js` is byte-identical to the committed bundle;
3. rebuilt `ui.js` is byte-identical to the committed bundle;
4. no generated correction commit is created by the final release workflow.

Any bundle difference is a release failure.

## Gate C — announced surface contract and optional historical traceability

A regressão automatizada é o `npm test` (Node) mais os testes de navegador em `tests/browser/` (Playwright, Chromium e WebKit). Os antigos verificadores de manifesto, política de evolução, contrato de superfície e evidência foram removidos na fase 0 da força-tarefa (ver `RELATORIO_AUDITORIA.md`).
