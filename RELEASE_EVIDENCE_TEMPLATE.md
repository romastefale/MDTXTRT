# Release evidence template

Create one GitHub issue (or a dedicated release-evidence record linked from the release issue) from this template for each sealed Release Anchor.

## Anchor

- Release Anchor SHA:
- Release Anchor convenience branch:
- Source PR:
- GitHub Actions release-validation run:
- UTC validation window:
- Operator/tester:

## External-test authorization

- Authorization evidence reference:
- Authorized staging deployment:
- Authorized Telegraph test destination/account reference:
- Authorized Telegram test bot/chat reference:
- Authorizer:
- Authorization timestamp:
- Confirmation that no production destination is used:

Do not place tokens, passwords, raw browser capabilities or other credentials in this record.

## Automated gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Regression suite |  |  |
| Node/npm contract |  |  |
| Fresh npm ci |  |  |
| editor-core.js reproducible |  |  |
| ui.js reproducible |  |  |
| Stage ancestry/manifest |  |  |
| Automated visual shell comparison |  |  |

## Telegraph restart test

- Initial document UUID:
- Initial revision:
- Telegraph test path/URL:
- Initial publication timestamp:
- Recovery result before restart:
- Edit result before restart:
- Backend restart timestamp:
- Durable volume retained:
- Recovery result after restart:
- Edit result after restart:
- Final path unchanged:
- Evidence reference:

## Telegram Rich Message test

- Test fixture/feature matrix:
- Returned messageId:
- Delivery timestamp:
- Receiving device/client:
- Rendering result:
- Media upload result, when applicable:
- Reload/reopen duplicate check:
- Evidence reference:

## Physical-device matrix

| Surface | Device/model | OS | App/browser version | Keyboard closed | Keyboard open | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| iOS browser |  |  |  |  |  |  |
| iOS Telegram Mini App |  |  |  |  |  |  |
| Android browser |  |  |  |  |  |  |
| Android Telegram Mini App |  |  |  |  |  |  |

For every cell record menu/dialog reachability, internal scroll, Find anchor, focus trap/return and selection preservation.

## Network/storage fault matrix

| Fault | Environment/device | Expected | Observed | PASS/FAIL | Evidence |
| --- | --- | --- | --- | --- | --- |
| localStorage read failure |  | preserve/block overwrite |  |  |  |
| identity write/read-back failure |  | no Telegraph call |  |  |  |
| /novo archive storage failure |  | abort transition |  |  |  |
| IndexedDB unavailable with attachment |  | block/surface missing media |  |  |  |
| offline before request |  | explicit failure |  |  |  |
| Telegram unknown timeout |  | uncertain/no retry |  |  |  |
| backend restart during sending |  | uncertain/no retry |  |  |  |
| response lost after possible acceptance |  | persisted result or uncertain |  |  |  |
| Telegraph ownership without credential |  | fail closed |  |  |  |
| reload succeeded handoff |  | reuse/no send |  |  |  |
| reload uncertain handoff |  | no send |  |  |  |
| explicit Telegram rejection |  | failed/explicit retry only |  |  |  |

## Visual baseline manual verification

- Baseline SHA: `dde30467ed9b0d108bac2ae7ad9bcac1137c169e`
- Candidate/anchor SHA:
- Light mode evidence:
- Dark mode evidence:
- Menus/dialogs evidence:
- Notes on intentional post-baseline behavioral placement changes:
- PASS/FAIL:

## Rollback

- Last known-good immutable SHA:
- Rollback deployment procedure exercised:
- Persistent volume retained:
- Irreversible migration present?:
- If yes, reverse/forward migration evidence:
- PASS/FAIL:

## Final decision

- Regression/build: PASS/FAIL
- Visual: PASS/FAIL
- Telegraph: PASS/FAIL
- Telegram Rich Message: PASS/FAIL
- Physical devices: PASS/FAIL
- Fault matrix: PASS/FAIL
- Authorization/config: PASS/FAIL
- Rollback: PASS/FAIL
- Evidence completeness: PASS/FAIL

Final status: BLOCKED / CANDIDATE VALIDATED / RELEASE APPROVED

Decision timestamp:
Decision maker:
Notes:
