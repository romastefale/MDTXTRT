# Final Gap Analysis — Etapa 7/7

Date: 2026-09-30

Scope: audit of the `main` produced by the six implementation stages, followed by only the corrections/documentation required to make final release validation accurate. No product feature is added in this stage.

## Current six-stage chain

| Stage | Scope | PR | Validated head | Integrated `main` |
| --- | --- | ---: | --- | --- |
| 1 | bot import | #84 | `8b6686eda179f8bed4c1e16ce9115a602b17fdf6` | `099c7c6e7c15e9881305843d4c3749c1e7e860cf` |
| 2 | bot consolidation | #86 | `508bdcdbe97d98805ffc4f243326b67daa81319a` | `aac423e012745c7873908ddc4a76371fb8218aa3` |
| 3 | Telegram fullscreen/viewport state | #88 | `e42701b002f86dffa44905eae3da18d2e4262d60` | `b6a253a2807a02952522b0f2a606ab409ed74c91` |
| 4 | mobile keyboard/focus | #90 | `dd8b9da6273548af98dacec548c0b0cab2855139` | `9714da772a5e63f39e93a170ea075f0d7bf69a78` |
| 5 | external publication persistence/idempotency | #92 | `854a20fd635dc0d55ea9c7294f13bb0313118297` | `2cc98d83a330e4f1f56b5a5d0c87f22a51695ce0` |
| 6 | volume drafts/provenance/UI corrections | #95 | `ad2b05d82770a5057d22b2f92d7fc02255bdfb1c` | `ec3def6622818c0411bbeb94165716c7f30fa927` |

The theme reload correction in PR #94 is also present in the resulting `main`, but it is not one of the six stage PRs.

## Gap register

### G-01 — release manifest referenced an obsolete evolution chain

**Observed:** `RELEASE_MANIFEST.json` still listed PRs #56/#58/#61/#63/#66/#68 from an earlier evolution cycle. Those commits are ancestors, so ancestry checks could still pass while reporting the wrong six-stage history.

**Correction in Etapa 7/7:** manifest now records #84/#86/#88/#90/#92/#95 and their validated heads.

**Status:** CLOSED when final release validation passes on the updated manifest.

### G-02 — no explicit machine audit that every announced surface has a path

**Observed:** individual tests covered controls and commands, but the release workflow had no single gate proving the current Web/PWA/Mini App/bot inventory was still wired.

**Correction:** `SURFACE_CONTRACT.md`, `scripts/verify-surface-contract.mjs` and a regression test enumerate/wire the declared controls, insertion/command vocabulary, PWA manifest, bot commands and backend routes.

**Status:** CLOSED when regression/release workflow passes.

### G-03 — release evidence did not separately require PWA, draft-volume restart or real import/export

**Observed:** the previous evidence contract covered mobile browser and Mini App, Telegraph, Telegram and a fault matrix, but:
- installed PWA had no separate physical row;
- Railway draft persistence/restart was not a first-class external gate;
- real import/export had no explicit matrix;
- Telegram evidence did not require proving a later edit of the same persisted `messageId`.

**Correction:** release contract, template, workflow inputs and evidence validator are expanded accordingly.

**Status:** CLOSED as a gate-definition defect; the evidence itself remains blocking until executed.

### G-04 — production Railway deployment is behind current `main`

**Observed at start of Etapa 7/7:** Railway production service `MDTXTRT` reports latest successful deployment `57e1fa4a-25e1-4d65-8c43-1cbabc07036b`, commit `215ba3a25f587f8a28303a90b074eea32b80df8f` (PR #94), while audited `main` begins Etapa 7/7 at `ec3def6622818c0411bbeb94165716c7f30fa927`.

The service configuration is connected to `romastefale/MDTXTRT`, branch `main`, with check suites enabled, one replica in `us-west2`, health check `/` and persistent volume `MDTXTRT-volume` mounted at `/data`.

**Risk:** real tests against the existing production URL would exercise stale code and cannot certify the current candidate.

**Acceptance:** deploy the exact final candidate SHA (or a staging service with the same candidate and an explicitly authorized external-test configuration), record deployment ID/SHA, then run real evidence. Branch name alone is insufficient.

**Status:** BLOCKING until deployment evidence identifies the exact candidate SHA.

### G-05 — real Railway draft persistence/restart not yet evidenced

Synthetic tests prove file-layout/restart logic, not the live mounted volume.

**Required:** persist unique draft + optional attachment, remove local active cache, recover, restart/deploy with volume retained, recover again, and prove cross-owner isolation.

**Status:** BLOCKING until evidence exists.

### G-06 — real Telegraph restart path not yet evidenced

Mocks and server tests do not prove create/recover/edit/restart against an authorized Telegraph account/page.

**Required:** same document/page path before and after backend restart, no replacement account, authorized destination and timestamps.

**Status:** BLOCKING until evidence exists.

### G-07 — real Telegram send/edit path not yet evidenced

Mocks prove Bot API request structure and durable binding logic, not receipt/rendering.

**Required:** real Mini App session, authorized bot/chat, first Rich Message receipt, recorded `messageId`, later edit of the same document observed on the same message, media fixture when applicable, no duplicate on reopen.

**Status:** BLOCKING until evidence exists.

### G-08 — physical Web/PWA/Mini App matrix not yet evidenced

Automated `visualViewport`, focus and baseline tests are not physical-device proof.

Required minimum rows:
- iOS browser;
- iOS installed PWA;
- iOS Telegram Mini App;
- Android browser;
- Android installed PWA;
- Android Telegram Mini App;

with keyboard closed/open for every row.

**Status:** BLOCKING until evidence exists.

### G-09 — real import/export matrix not yet evidenced

Automated round-trip tests exist, but final release requires real file selection/download and bot document flows on the declared surfaces.

**Status:** BLOCKING until evidence exists.

### G-10 — network/storage operational matrix not yet evidenced

Regression tests cover many deterministic failure cases, but release requires controlled operational observations, including Railway volume failures and Telegram edit-time uncertainty.

**Status:** BLOCKING until evidence exists.

### G-11 — rollback not yet exercised against the candidate

Railway reports prior deployments that are rollback-capable, and the release contract forbids deleting the volume, but the exact final-candidate rollback + forward-redeploy sequence has not been evidenced.

**Status:** BLOCKING until exercised and recorded.

## Automated state at audit start

- `main` `ec3def6622818c0411bbeb94165716c7f30fa927`: Regression verification #522 — success.
- Etapa 6/7 head `ad2b05d82770a5057d22b2f92d7fc02255bdfb1c`: Regression #521 — success, 162/162; Release validation #101 automated gates — success; final external/physical evidence job skipped by design.
- Visual baseline remains `aac423e012745c7873908ddc4a76371fb8218aa3`.

These results establish a clean automated starting point only.

## Release rule

The final immutable SHA may be declared only after:
1. the Etapa 7/7 correction PR is merged;
2. clean automated release validation passes on the exact candidate;
3. exact candidate deployment is recorded;
4. G-05 through G-11 have real evidence;
5. the evidence validator reports `RELEASE APPROVED`;
6. rollback state and known limitations are consolidated in the final issue.

Until then the product is **BLOCKED** for final release, even when code/regression is green.
