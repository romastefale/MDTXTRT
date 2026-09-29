# Release validation contract

This contract is the mandatory release gate for MDTXTRT after evolution step 6/6.

A release is approved only when every gate below is PASS and every evidence reference is attached to the release record. Automated success is necessary but not sufficient.

## Gate A — regression suite

Run on the exact candidate SHA with a clean checkout.

Acceptance:
- the release workflow explicitly checks out the candidate SHA rather than GitHub's synthetic pull-request merge ref;
- `git rev-parse HEAD` equals the candidate/anchor SHA before validation starts;
- all regression tests pass;
- no skipped regression may be used to waive a known defect;
- the result identifies the exact commit SHA and GitHub Actions run.

Failure action: stop release; fix in a new commit; re-run all release gates.

## Gate B — reproducible build

Runtime contract:
- Node 24.21.0;
- npm 11.19.0;
- committed `package-lock.json`;
- clean `npm ci`.

Acceptance:
1. `npm run build` completes;
2. rebuilt `editor-core.js` is byte-identical;
3. rebuilt `ui.js` is byte-identical;
4. no generated correction commit is allowed from CI.

Any bundle difference is a release failure, even when an ordinary PR workflow would have skipped rebuilding that bundle.

## Gate C — visual baseline

Normative visual baseline: `aac423e012745c7873908ddc4a76371fb8218aa3` (the approved consolidated translucent shell). `BASELINE.md` records why it supersedes `dde30467ed9b0d108bac2ae7ad9bcac1137c169e`.

Automated component:
- the release workflow renders candidate and baseline with the same Chrome binary, viewport and host;
- light and dark stable 390×844 browser shells must produce identical candidate/baseline screenshots;
- the screenshots and `summary.json` are retained as a `release-visual-baseline-<anchor-sha>` Actions artifact;
- missing visual evidence is itself a workflow failure.

Manual/physical component:
- verify baseline material, control scale, normal dimensions and composition for top chrome, formatting bar, context menus and dialogs;
- behavior intentionally corrected after the baseline may alter placement under constrained visual viewports, but must not alter the baseline material/tokens or make controls inaccessible;
- semantic text changes required by step 6 are allowed and must match current behavior.

Acceptance evidence includes side-by-side screenshots or video and device/runtime metadata.

## Gate D — Telegraph persistence through restart

Only an explicitly authorized test destination may be used.

Required sequence:
1. create a unique document/page with a release marker;
2. publish through the candidate;
3. record document UUID, revision and Telegraph path;
4. recover through the candidate;
5. edit and publish again;
6. verify the same path was edited;
7. restart the backend while preserving its durable volume;
8. recover again after restart;
9. edit/publish again;
10. verify the same path still exists and content matches the latest authorized revision.

Additional fail-closed check:
- in an isolated staging copy, persisted page ownership without the corresponding Telegraph credential must prevent normal startup/recovery rather than silently create a replacement account.

Acceptance: same page path across restart, exact document binding, no replacement account, evidence URL and timestamps.

## Gate E — real Telegram Rich Message receipt

Only an explicitly authorized test bot/chat may be used.

Required:
- send the release Rich Message fixture through the candidate;
- record API-confirmed `messageId`;
- verify receipt on a real Telegram client;
- visually inspect the declared formatting/structure/interaction capabilities;
- exercise at least one authorized media upload separately when media is part of the announced release capability;
- confirm a reload/reopen does not duplicate a completed handoff.

Acceptance: message is received and rendered in the authorized test chat; no silent downgrade; no duplicate send; evidence screenshot/video and message identifier recorded.

## Gate F — physical-device matrix

Minimum devices/surfaces:

| Surface | iOS | Android |
| --- | --- | --- |
| Mobile browser | required | required |
| Telegram Mini App | required | required |

For each surface test both keyboard closed and open.

Required interactions:
- editor typing/composition;
- undo/redo;
- document name field;
- Find/Replace with literal metacharacters;
- each top-level menu;
- nested File menu;
- dialog opened from editor;
- focus trap and focus return;
- selection preserved after menu/dialog interaction;
- export menu;
- destination toggle;
- long menu content requiring internal scroll.

Record model, OS, browser or Telegram version, viewport/orientation, keyboard state and evidence.

Acceptance: no required control is inaccessible, covered by keyboard/system UI, unexpectedly displaced or focus-inaccessible.

## Gate G — network/storage failure matrix

Execute the following operational cases on staging or controlled physical/browser environments.

| Fault | Required behavior |
| --- | --- |
| localStorage read failure on boot | preserve existing bytes; do not overwrite with default state |
| localStorage write/read-back failure for browser identity | block Telegraph call before external publication |
| localStorage failure during `/novo` archive | abort new-document transition; prior active draft remains authoritative |
| IndexedDB missing/denied with attachment to restore | surface blocking attachment recovery error; do not silently publish missing media |
| network offline before request | fail without claiming success |
| Telegram transport timeout/unknown result | mark/retain uncertain semantics; no automatic retry |
| backend restart while handoff is `sending` | recover as uncertain; no duplicate send |
| response lost after external acceptance | status/reopen returns confirmed result if it was persisted; otherwise uncertain, never silent retry |
| Telegraph ownership state without credential | fail closed |
| reload of succeeded handoff | reuse persisted result; no send |
| reload of uncertain handoff | no send |
| explicit Telegram rejection | failed state; retry only by explicit new authorization |

Acceptance: behavior matches the table and the evidence record names the injected fault and observation.

## Gate H — configuration and authorization

Before any external test:
- identify the staging deployment;
- identify the authorized Telegraph test destination/account;
- identify the authorized Telegram test bot/chat;
- identify who authorized them and when;
- confirm no production destination is selected;
- confirm durable storage is attached to staging for restart tests;
- confirm logs/evidence redact secrets and raw capability keys.

A release run without this authorization record is invalid.

## Gate I — rollback and abort

Release abort conditions:
- any automated workflow failure;
- any external publication to an unauthorized destination;
- mismatch between candidate SHA and sealed Release Anchor;
- any duplicate publication not explicitly caused by a new user authorization;
- cross-document state contamination;
- loss/overwrite of the only recoverable draft;
- visual/device gate failure;
- unreproducible bundle;
- missing evidence.

Rollback contract:
- release deployment must be able to redeploy the last known-good immutable commit;
- persistent files/volumes are not deleted during rollback;
- no release step may perform an irreversible data migration without a separately tested reverse/forward migration;
- if external pages/messages were created during test, they remain test artifacts and are recorded rather than being mistaken for production state.

A failed release never mutates the sealed anchor. Corrections produce a new candidate and, after revalidation, a new superseding anchor.

## Gate J — evidence completeness

Use `RELEASE_EVIDENCE_TEMPLATE.md`.

Every PASS must include:
- exact Release Anchor SHA;
- GitHub Actions run;
- tester/operator;
- UTC timestamp;
- environment/device identification;
- authorization reference for external tests;
- evidence reference;
- observed result.

The final release certification workflow accepts evidence references only; it does not convert an unchecked boolean into proof.

## One-shot/new-document exception behavior

- reloading after consuming `?new=<token>` must not create a second document;
- opening the same one-shot link again after the parameter was removed is a normal URL load of the active document;
- if preservation fails before the token is consumed, the prior active draft remains authoritative and the user receives an error.

## Overlay exception behavior

If the viewport/keyboard changes while an overlay is open, the overlay must be recomputed against the visible area. If the original focus control is no longer visible when closing a modal, focus may fall back to the editor or another documented safe target, but must not disappear into an inert subtree.

## Final certification

Release status is one of:
- **BLOCKED** — at least one mandatory gate lacks evidence or failed;
- **CANDIDATE VALIDATED** — all automated gates passed but external/device gates remain;
- **RELEASE APPROVED** — every gate A–J passed against the same immutable Release Anchor SHA.

No other status implies permission to release.
