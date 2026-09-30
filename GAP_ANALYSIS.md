# Final Gap Analysis — entrega concluída

Date: 2026-09-30

Scope: close the implementation/audit cycle after the six implementation stages, Etapa 7 release hardening, editor-publication fidelity (#101), Telegram/draft/Telegraph integration (#104), and final fail-closed hardening (#105).

## Implementation chain

| Stage | Scope | PR | Validated head | Integrated `main` |
| --- | --- | ---: | --- | --- |
| 1 | bot import | #84 | `8b6686eda179f8bed4c1e16ce9115a602b17fdf6` | `099c7c6e7c15e9881305843d4c3749c1e7e860cf` |
| 2 | bot consolidation | #86 | `508bdcdbe97d98805ffc4f243326b67daa81319a` | `aac423e012745c7873908ddc4a76371fb8218aa3` |
| 3 | Telegram fullscreen/viewport state | #88 | `e42701b002f86dffa44905eae3da18d2e4262d60` | `b6a253a2807a02952522b0f2a606ab409ed74c91` |
| 4 | mobile keyboard/focus | #90 | `dd8b9da6273548af98dacec548c0b0cab2855139` | `9714da772a5e63f39e93a170ea075f0d7bf69a78` |
| 5 | external publication persistence/idempotency | #92 | `854a20fd635dc0d55ea9c7294f13bb0313118297` | `2cc98d83a330e4f1f56b5a5d0c87f22a51695ce0` |
| 6 | volume drafts/provenance/UI corrections | #95 | `ad2b05d82770a5057d22b2f92d7fc02255bdfb1c` | `ec3def6622818c0411bbeb94165716c7f30fa927` |

Release hardening was integrated by PR #98 and exact-main release validation by PR #100. PR #101 corrected editor → publication fidelity, PR #104 preserved Telegram revision history and integrated the owner library, and PR #105 removed remaining degraded critical paths through fail-closed hardening.

## Incremental delivery — application menu and publication library

PR #107 extends the completed architecture incrementally rather than replacing it. It moves the owner library into the top application menu, changes the top action icon to a hamburger, exposes Telegram publication summaries from the provenance already stored with each durable draft, preserves Telegraph page recovery/editing, and renders responsive draft/publication cards with creation/modification metadata.

This increment does not introduce a second datastore, does not rewrite historical Telegram messages, and does not change the persistent Railway volume contract. Telegram publication cards reopen the current linked document; subsequent publication preserves the existing revision-notice + new Rich Message behavior.

For this increment, engineering delivery is formally concluded only after the exact merged `main` SHA passes regression and automated release gates and the same SHA reaches Railway production with the existing `/data` volume retained. The PR conversation records the exact merged SHA and deployment ID after those conditions are met.

## Gap register

### G-01 — obsolete release manifest

**Status: CLOSED.** The manifest records the actual six-stage chain and validated/integrated SHAs.

### G-02 — no unified announced-surface audit

**Status: CLOSED.** `SURFACE_CONTRACT.md` and `scripts/verify-surface-contract.mjs` are part of regression/release validation.

### G-03 — incomplete evidence schema

**Status: CLOSED.** Physical PWA rows, Railway draft restart, real import/export and Telegram revision-history evidence are explicit in the release contract and validator.

### G-04 — exact production deployment

**Status: CLOSED for engineering delivery.** Exact-main CI and Railway deployment are automated requirements. The authoritative final SHA/deployment evidence is recorded in the closed engineering delivery record (#99), rather than pinning a documentation file to a SHA that changes when the file itself is merged.

PR #105 added the final runtime hardening: mandatory transactional editor paths, fail-closed volume recovery and fail-closed persistent-library enumeration. It passed the same regression/release/deployment pipeline before the documentation-only closure.

### G-05 — physical draft persistence/restart evidence

**Status: POST-DELIVERY CERTIFICATION.** Implementation and deterministic restart tests are complete. Optional live device/cache-removal evidence is described in `OWNER_ACCEPTANCE.md`; it is not an engineering gap.

### G-06 — real Telegraph restart path

**Status: POST-DELIVERY CERTIFICATION.** Contract, ownership and restart behavior are covered in code/tests; optional authorized real-destination evidence is post-delivery.

### G-07 — real Telegram send/revision-history path

**Status: POST-DELIVERY CERTIFICATION.** Request structure, durable binding, immutable chat-history revision flow and uncertainty/idempotency behavior are covered in code/tests; client receipt/rendering evidence is post-delivery.

### G-08 — physical Web/PWA/Mini App matrix

**Status: POST-DELIVERY CERTIFICATION.** Automated viewport/focus/current-contract tests are complete; physical iOS/Android evidence is post-delivery.

### G-09 — real import/export matrix

**Status: POST-DELIVERY CERTIFICATION.** Contract and round-trip automation are complete; physical file-picker/download/bot evidence is post-delivery.

### G-10 — operational network/storage fault matrix

**Status: POST-DELIVERY CERTIFICATION.** Deterministic failure paths are covered; controlled live fault injection is post-delivery where it requires environment/device disruption.

### G-11 — rollback exercise

**Status: POST-DELIVERY CERTIFICATION.** Railway reports rollback-capable prior deployments. An actual rollback is an optional post-delivery operational exercise because it deliberately changes the live service.

## Closure rule

Engineering delivery is concluded when:

1. this closure record is integrated;
2. complete regression passes on the exact resulting `main` SHA;
3. Release validation automated gates pass on that exact SHA;
4. the exact SHA reaches SUCCESS in Railway production with the existing persistent volume retained.

After those four conditions, there are **no open engineering implementation gaps** in this cycle.

Physical/external/rollback checks remain visible as post-delivery certification evidence, not hidden or falsely marked PASS. They gate only the optional `RELEASE APPROVED` exact-SHA evidence record defined by `RELEASE_EVIDENCE_POLICY.md`; they do not gate engineering completion or product deployment.
