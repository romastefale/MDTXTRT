# Release validation contract — Etapa 7/7

This document defines the optional **release-certification** gate used to award the `RELEASE APPROVED` label and seal an immutable Release Anchor. It is separate from engineering delivery completion. Neither engineering completion nor `RELEASE APPROVED` means the product is final or must stop evolving; later corrections and implementations supersede older behavior when intentionally accepted.

Engineering work is complete when the implementation is integrated, exact-main automated gates pass and that exact SHA is successfully deployed. The additional external/physical evidence below may be collected post-delivery; its absence does not represent unfinished code.

`RELEASE APPROVED` itself is intentionally stricter: it is awarded only when **every** automated, external, physical-device, persistence, fault and rollback criterion below is PASS against the **same exact Git commit SHA**. Mocks and synthetic viewport tests are never recorded as physical or external evidence.

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

## Gate C — stage lineage and announced surface contract

`RELEASE_MANIFEST.json` must identify the six implementation-stage PR heads actually integrated before Etapa 7/7. `scripts/verify-release-manifest.mjs` proves each head is an ancestor of the candidate and preserves order.

`scripts/verify-surface-contract.mjs` must also pass. It audits that every control/command the current Web/PWA/Mini App/bot surfaces declare has a corresponding implementation path, including:
- editor chrome and formatting controls;
- file import/export and Find/Replace;
- destination-aware links, structures and media actions;
- browser/PWA → Mini App handoff for Telegram publication;
- Mini App Telegram/Telegraph publication paths;
- persistent draft routes;
- all registered private bot commands;
- standalone PWA manifest.

Static surface success does not replace live execution required below.

## Gate D — visual baseline

Normative visual baseline: `9c9f8d38313d5f0043283daf06d6ac015f90bded` (working production state after PR #123). This is the current comparison reference, not a preservation mandate; deliberate corrections must replace and advance it when the accepted product state evolves.

Automated component:
- render candidate and baseline with the same Chrome binary and 390×844 stable browser viewport;
- light/dark shell screenshots must satisfy the repository baseline comparator;
- retain screenshot/summary artifact.

Manual component:
- confirm translucent material, scale and composition;
- confirm application-menu icon, library navigation/management capsules, responsive cards and constrained-overlay placement are intentional;
- confirm menus/dialogs remain reachable and do not sit below the bottom bar.

## Gate E — Railway draft-volume persistence and restart

Use the candidate deployment with the persistent Railway volume retained.

Required sequence:
1. create/edit a unique draft marker;
2. confirm the backend stores the owner-scoped active draft under the persistent volume contract;
3. record document UUID and revision;
4. close/reopen with browser-local active draft absent and recover the volume copy;
5. when an attachment is part of the fixture, recover its stored blob too;
6. restart/redeploy the backend **without replacing/deleting the volume**;
7. recover the same document again;
8. verify title, content, destination, UUID, revision and attachment identity match the latest confirmed persisted state;
9. verify another owner cannot load the first owner's draft.

Acceptance: same logical document survives process/deployment restart and local-cache absence; no cross-owner access and no replacement with default state.

## Gate F — real Telegraph create/recover/edit/restart

Only an explicitly authorized test destination/account may be used.

Required sequence:
1. create a unique document/page marker;
2. publish through the candidate;
3. record document UUID, revision and Telegraph path;
4. recover;
5. edit and publish again;
6. verify the **same path** was edited;
7. restart backend with durable volume retained;
8. recover and edit again;
9. verify the same path and latest content;
10. in an isolated authorized fault test, persisted ownership without the corresponding Telegraph credential must fail closed rather than create a replacement account.

Acceptance: same path across restart, exact document binding, no substitute account, URL/timestamps recorded.

## Gate G — real Telegram Rich Message send and revision history

Only an explicitly authorized test bot/chat may be used.

Required:
1. open a real Mini App session with valid Telegram `initData`;
2. publish the release Rich Message fixture;
3. record returned `messageId`, document UUID/revision and publisher identity evidence without exposing raw credentials;
4. verify receipt/rendering in a real Telegram client;
5. edit the **same document** and explicitly publish again;
6. verify the original Telegram message remains unchanged, a revision notice replies to it, and the revised Rich Message is sent as a new message;
7. exercise one authorized media upload when media is part of the announced capability;
8. reload/reopen a completed handoff and confirm no duplicate send;
9. verify a different owner/document cannot reuse the first document's publication binding.

Acceptance: real receipt, no silent downgrade, previous message preserved, revision notice linked to it, revised content has a new message ID, no unintended duplicate send.

## Gate H — Web / PWA / Mini App and physical-device matrix

Minimum physical matrix:

| Surface | iOS | Android |
| --- | --- | --- |
| Mobile browser | required | required |
| Installed PWA | required | required |
| Telegram Mini App | required | required |

For every cell test keyboard closed and open.

Required interactions:
- editor typing/composition and selection;
- undo/redo;
- document title field;
- destination toggle;
- each top-level menu and nested File/format/structure/media/interaction menus applicable to the destination;
- link flow and at least one media dialog/flow;
- Find/Replace with literal metacharacters;
- modal focus trap and focus return;
- long menu internal scroll;
- export menu;
- keyboard/viewport transitions and orientation changes supported by the host.

Acceptance: no required control is hidden under keyboard/system/bottom UI, inaccessible or focus-lost. Record model, OS, browser/Telegram version, orientation and evidence.

## Gate I — real import/export matrix

Execute on Web/PWA and Mini App where file APIs are available, and the bot path separately.

Required:
- Web/PWA import .md and .txt;
- Mini App import .md and .txt;
- Web/PWA export .md and .txt;
- Mini App export .md and .txt;
- bot private-chat `/importar` for .md and .txt;
- bot `/exportar txt` and `/exportar md`;
- round-trip at least one edited Markdown fixture through export → new import and compare declared semantics;
- verify TXT lossy-warning path when structured content exists.

Acceptance: content matches `FORMAT_CONTRACT.md`; unsupported semantics are rejected/warned rather than silently downgraded.

## Gate J — network and storage failure matrix

Execute operationally in staging/controlled environments.

| Fault | Required behavior |
| --- | --- |
| localStorage read failure on boot | preserve existing bytes; do not overwrite with default |
| browser identity write/read-back failure | block identity-dependent external call |
| `/novo` archive storage failure | abort new-document transition; prior draft remains authoritative |
| IndexedDB unavailable with attachment | surface blocking attachment recovery error |
| Railway draft-volume write failure | keep local copy, report persistent-copy failure, never claim durable success |
| Railway draft metadata/blob unavailable after restart | explicit recovery failure; do not fabricate default as recovered |
| offline before request | explicit failure; no claimed success |
| Telegram transport timeout on first send | uncertain/no automatic duplicate send |
| Telegram revision notice/content transport timeout | persist pending/uncertain phase; explicit retry must not blindly duplicate a notice or a possibly accepted revised message |
| backend restart during handoff sending | recover as uncertain; no duplicate send |
| response lost after possible acceptance | persisted result or uncertain, never silent new send |
| Telegraph ownership without credential | fail closed |
| reload succeeded handoff | reuse result/no send |
| reload uncertain handoff | no send |
| explicit Telegram rejection | retry only by explicit new authorization |
| stale draft revision write | reject rather than overwrite newer persistent revision |

Every row requires injected-fault description, observed result and evidence.

## Gate K — authorization, rollback and evidence completeness

Before external testing:
- identify the exact candidate deployment/SHA;
- identify authorized Telegraph test destination/account;
- identify authorized Telegram test bot/chat;
- identify authorizer and timestamp;
- confirm whether the environment is production or staging and that the destinations are intentionally authorized for the test;
- redact tokens, raw `initData`, browser capability keys and secrets.

Rollback:
- identify last known-good immutable deployment SHA;
- exercise deployment rollback/redeploy procedure;
- verify persistent Railway volume is retained;
- verify rollback does not delete draft/Telegraph ownership/provenance files;
- verify forward redeploy to the candidate is possible;
- no irreversible data migration may be introduced without separately tested recovery.

Evidence completeness:
- use `RELEASE_EVIDENCE_TEMPLATE.md`;
- every PASS includes exact anchor SHA, UTC timestamp, tester/operator, environment/device, authorization reference and evidence reference;
- the certification workflow validates references; an unchecked boolean is not proof.

## Release statuses

- **BLOCKED** — at least one mandatory gate failed or lacks evidence.
- **CANDIDATE VALIDATED** — all automated gates pass, but one or more external/physical/rollback evidence gates remain.
- **RELEASE APPROVED** — Gates A–K all pass against the same immutable Release Anchor SHA.

Only **RELEASE APPROVED** authorizes the candidate SHA to be established as the final immutable product release.
