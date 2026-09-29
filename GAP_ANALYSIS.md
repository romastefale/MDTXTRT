# Final Gap Analysis — Etapa 7/7

Date: 2026-09-30

This document is the current release-readiness audit for the seven-step MDTXTRT roadmap. Steps 1–6 are implementation/correction stages. Step 7 is verification, update and release only: it does not add product features.

The approved visual reference remains `aac423e012745c7873908ddc4a76371fb8218aa3`. The historical reference `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` remains documented in `BASELINE.md`.

A criterion marked **BLOCKING** prevents sealing/releasing a final candidate. **AUTOMATED PASS** means code/build/synthetic evidence exists but does not substitute for the external or physical evidence required by the same contract.

## Current six-stage implementation chain

The final issue must consolidate these six PRs and six evolution reports. PRs/reports 1–4 were originally created while the plan still had six total stages; they are mapped here to the later seven-step roadmap without rewriting their historical contents.

| Step | Implementation PR | Evolution report | Validated PR head |
| --- | ---: | ---: | --- |
| 1/7 — bot import | #84 | #85 | `8b6686eda179f8bed4c1e16ce9115a602b17fdf6` |
| 2/7 — bot consolidation | #86 | #87 | `508bdcdbe97d98805ffc4f243326b67daa81319a` |
| 3/7 — Telegram platform state | #88 | #89 | `e42701b002f86dffa44905eae3da18d2e4262d60` |
| 4/7 — mobile keyboard/focus | #90 | #91 | `dd8b9da6273548af98dacec548c0b0cab2855139` |
| 5/7 — external publication persistence | #92 | #93 | `854a20fd635dc0d55ea9c7294f13bb0313118297` |
| 6/7 — volume drafts, Telegram provenance and overlays | #95 | #96 | `ad2b05d82770a5057d22b2f92d7fc02255bdfb1c` |

The integrated `main` after Step 6 is `ec3def6622818c0411bbeb94165716c7f30fa927`. The machine-readable chain is `RELEASE_MANIFEST.json`.

## Automated state already established

Step 6 head `ad2b05d82770a5057d22b2f92d7fc02255bdfb1c` passed:
- Stage 6 bundle synchronization run `36607218965`: build + synchronized committed UI artifact + 162/162 tests + diff check;
- Regression verification run `36607395163` (#521): PASS;
- Release validation run `36607395404` (#101): automated release gates PASS, including exact SHA checkout, contracted Node/npm, clean `npm ci`, full rebuild, byte-identical committed bundles, regression suite and automated visual baseline.

After merge, `main` `ec3def6622818c0411bbeb94165716c7f30fa927` passed Regression verification run `36607726876` (#522).

These results are necessary evidence for code integrity. They are not evidence of real Telegram/Telegraph delivery, physical devices, real storage/network faults or production deployment parity.

## Gap register

### G-01 — Release manifest referenced an obsolete implementation chain

**Observed:** `RELEASE_MANIFEST.json` and release documentation still described an older six-PR cycle (#56/#58/#61/#63/#66/#68), while the current requested evolution is PRs #84/#86/#88/#90/#92/#95 followed by Step 7 verification.

**Correction:** the manifest and release documents are updated in the Step 7 audit PR to use the six completed implementation stages above and explicitly model Step 7 as verification/release with no new features.

**Status:** CLOSED by this audit correction, subject to the final audit PR gates.

### G-02 — Exact production deployment is behind current main

**Observed from Railway production:** project `19b2c24f-d78f-466e-8da1-d51f5fc41606`, service `0e01c9a7-d97e-4c3f-b6ef-72329a3670f8`, environment `production` currently reports deployment `57e1fa4a-25e1-4d65-8c43-1cbabc07036b` at commit `215ba3a25f587f8a28303a90b074eea32b80df8f`.

The service is configured for repository `romastefale/MDTXTRT`, branch `main`, with check suites enabled and volume `MDTXTRT-volume` mounted at `/data`. However no Railway deployment was created for the later Step 5 or Step 6 merge commits, including current `main` `ec3def6622818c0411bbeb94165716c7f30fa927`.

**Risk:** real tests against the production URL would exercise old code and cannot certify the current candidate.

**Acceptance:** the chosen Stage 7 candidate must be deployed from its exact full SHA; Railway deployment metadata must report the same commit hash before any real environment evidence is accepted.

**Status:** BLOCKING.

### G-03 — GitHub → Railway autodeploy path did not produce deployments for later main pushes

**Observed:** GitHub regression workflows completed successfully for the Step 5 and Step 6 merge commits, but Railway deployment history contains no corresponding deployment records.

**Boundary:** Railway's ordinary redeploy action redeploys the existing deployment commit; it is not proof of deploying the latest GitHub commit. The current connected Railway AI-agent path is also unavailable because its agent usage limit is exhausted.

**Acceptance:** restore/confirm the GitHub deployment trigger or use an authorized “Deploy Latest Commit” / exact-commit deployment path, then read back the resulting commit hash and terminal deployment status.

**Status:** BLOCKING operationally until deployment parity is restored.

### G-04 — Real Railway volume persistence/restart evidence is absent

Step 6 implements active draft persistence under `$RAILWAY_VOLUME_MOUNT_PATH/drafts`, with the production volume mounted at `/data`. Automated tests prove the file contract and simulated restart. They do not prove that a real deployed candidate writes to the mounted volume and recovers the same draft after a service restart.

**Required operational sequence:**
1. deploy the exact candidate with the existing `/data` volume attached;
2. create/edit a uniquely marked draft;
3. confirm server-side persistence through the product path;
4. restart/redeploy the same candidate without deleting/replacing the volume;
5. open with the same verified owner identity after local active state is removed/unavailable;
6. verify UUID, revision, title/content and attachment identity where applicable;
7. record deployment IDs, timestamps and evidence.

**Status:** BLOCKING until real evidence exists.

### G-05 — No current real Telegraph create/recover/edit/restart evidence

Automated regressions cover Telegraph ownership, uncertain results and durable mapping. A real authorized Telegraph destination is still required.

**Required:** create a uniquely marked page, recover it, edit the same path, restart backend while retaining the volume, recover/edit again, and prove the path remains unchanged. Persisted Telegraph ownership without its credential must fail closed in an isolated authorized test.

**Status:** BLOCKING until real authorized evidence exists.

### G-06 — No current real Telegram Rich Message + edit-in-place evidence

Automated tests cover Rich Message send, persisted publisher provenance, uncertain delivery semantics and `editMessageText`. They do not prove real receipt/rendering.

**Required:**
1. use an explicitly authorized test bot/chat;
2. publish the release fixture through the candidate;
3. record the returned positive `messageId` and receiving-client evidence;
4. edit the same document as the same verified Telegram user;
5. verify the existing message is updated rather than a duplicate being created;
6. verify another owner cannot reuse the first owner’s persisted publication linkage;
7. exercise authorized disposable media if media is part of the advertised release contract.

**Status:** BLOCKING until real authorized evidence exists.

### G-07 — Physical Web/PWA/Mini App matrix is not complete

JSDOM and synthetic `visualViewport` tests are not physical-device evidence.

Minimum matrix:

| Surface | Platform | Keyboard closed | Keyboard open |
| --- | --- | ---: | ---: |
| Web/PWA browser | iOS/Safari | required | required |
| Telegram Mini App | iOS | required | required |
| Web/PWA browser | Android/Chrome | required | required |
| Telegram Mini App | Android | required | required |

For every applicable cell verify typing/composition, undo/redo, document title, import/export, destination toggle, every advertised menu/control, link/media/dialog placement, internal menu scroll, Find/Replace, focus trap/return, editor selection preservation and bottom-bar non-overlap.

**Status:** BLOCKING until physical evidence exists.

### G-08 — Network/storage failure matrix lacks real execution evidence

Automated regressions cover the expected failure semantics, including many storage and transport cases. Stage 7 still requires controlled operational evidence for:
- localStorage read failure;
- browser identity write/read-back failure;
- `/novo` preservation failure;
- IndexedDB unavailable with attachment;
- volume draft write failure;
- volume draft read/corruption/unavailable path where safely testable;
- offline before request;
- Telegram timeout/unknown result;
- backend interruption during sending;
- response loss after possible acceptance;
- Telegraph ownership state without credential;
- succeeded/uncertain/failed handoff reload semantics.

**Acceptance:** no recoverable draft is silently overwritten, uncertain delivery never retries automatically, known failure requires explicit retry, and no cross-document/owner contamination occurs.

**Status:** BLOCKING until controlled evidence exists.

### G-09 — Import/export real matrix remains to be observed on release surfaces

Automated contracts cover Markdown/TXT import/export and bot import. Stage 7 must verify the declared Web/PWA/Mini App/bot paths in the actual candidate environment, including a real file round trip and the explicit **Título do documento** / **Título da página no Telegraph** semantics.

**Status:** BLOCKING for final approval.

### G-10 — Rollback has not been exercised against the current volume-bearing candidate

The code introduces no destructive volume migration, but release approval requires proving that the previous known-good immutable deployment can be restored without deleting `/data` and that returning to the candidate is possible without manufacturing state.

The rollback record must name:
- current candidate SHA/deployment;
- last known-good SHA/deployment;
- rollback target;
- resulting terminal deployment status;
- confirmation that the same volume remains attached;
- post-rollback health observation;
- restoration/forward path if exercised.

**Status:** BLOCKING.

### G-11 — External-test authorization record is absent for the current candidate

Repository history contains an older evidence issue (#75) whose Telegram, Telegraph, device, fault and rollback fields remained PENDING. That record belongs to an obsolete anchor and cannot certify the current candidate.

The current cycle must identify authorized staging/production test target, Telegram bot/chat, Telegraph destination/account, authorizer and timestamp without committing secrets.

**Status:** BLOCKING.

### G-12 — Final status documentation must not overstate validation

Some product-polish documentation still describes earlier gaps as if they are current or refers to the prior six-stage planning taxonomy.

**Correction:** Step 7 updates state documentation to distinguish implemented/automated coverage from real evidence and from deployment status.

**Status:** CLOSED only when this audit PR is merged with its automated gates green.

### G-13 — Immutable candidate cannot be sealed yet

The Release Anchor policy requires exact-SHA automated validation and complete external/physical evidence for approval. The current repository state has strong automated evidence but fails G-02 through G-11.

**Status:** BLOCKING. No current SHA is designated as final immutable product candidate.

## Stage 7 decision state

Current status: **BLOCKED**.

What is already supported by evidence:
- six implementation PRs are integrated into `main`;
- current source-level regression is green;
- Step 6 exact-head full release automation is green;
- build and committed bundles were reproducible at the validated Step 6 head;
- automated visual stable-shell comparison passed;
- the code includes volume draft persistence, Telegram publication provenance/edit path, explicit title semantics and bottom-bar-safe overlay geometry.

What is not yet supported by acceptable evidence:
- exact candidate deployed to Railway;
- real `/data` persistence/restart;
- real Telegram receipt/edit-in-place;
- real Telegraph restart persistence;
- physical iOS/Android Web/PWA/Mini App matrix;
- controlled network/storage failure matrix;
- current-cycle external authorization;
- rollback exercise.

Do not change **BLOCKED** to **CANDIDATE VALIDATED** or **RELEASE APPROVED** by reducing these criteria.
