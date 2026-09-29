# Release evidence template — Etapa 7/7

Create one GitHub issue (or dedicated evidence record linked from the final release issue) for each sealed Release Anchor.

## Anchor

- Release Anchor SHA:
- Release Anchor convenience branch:
- Source PR:
- GitHub Actions release-validation run:
- UTC validation window:
- Operator/tester:

## External-test authorization

- Authorization evidence reference:
- Authorized candidate deployment:
- Authorized Telegraph test destination/account reference:
- Authorized Telegram test bot/chat reference:
- Authorizer:
- Authorization timestamp:
- Environment classification (staging/production):
- Confirmation that every external destination used is intentionally authorized:

Do not place tokens, raw Telegram initData, raw browser capabilities, passwords or other credentials in this record.

## Automated gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Regression suite |  |  |
| Node/npm contract |  |  |
| Fresh npm ci |  |  |
| editor-core.js reproducible |  |  |
| ui.js reproducible |  |  |
| Stage ancestry/manifest |  |  |
| Surface contract |  |  |
| Automated visual shell comparison |  |  |

## Railway draft persistence/restart

- Draft document UUID:
- Draft revision before restart:
- Owner type (browser/Telegram):
- Attachment fixture/result, if applicable:
- Recovery with local active slot absent:
- Backend restart/deploy timestamp:
- Draft persistent volume retained:
- Recovery result after restart:
- Cross-owner isolation result:
- Final document/revision unchanged as expected:
- Draft evidence reference:

## Telegraph restart test

- Initial document UUID:
- Telegraph initial revision:
- Telegraph test path/URL:
- Initial publication timestamp:
- Recovery result before restart:
- Edit result before restart:
- Backend restart timestamp:
- Durable volume retained:
- Recovery result after restart:
- Edit result after restart:
- Final path unchanged:
- Telegraph evidence reference:

## Telegram Rich Message send/edit test

- Test fixture/feature matrix:
- Document UUID:
- Telegram initial revision:
- Returned messageId:
- Delivery timestamp:
- Receiving device/client:
- Rendering result:
- Later edited revision:
- Edit returned/observed same messageId:
- Second-message duplicate check:
- Media upload result, when applicable:
- Reload/reopen duplicate check:
- Cross-owner/document binding isolation:
- Telegram evidence reference:

## Web / PWA / Mini App physical matrix

| Surface | Device/model | OS | App/browser version | Keyboard closed | Keyboard open | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| iOS browser |  |  |  |  |  |  |
| iOS PWA |  |  |  |  |  |  |
| iOS Telegram Mini App |  |  |  |  |  |  |
| Android browser |  |  |  |  |  |  |
| Android PWA |  |  |  |  |  |  |
| Android Telegram Mini App |  |  |  |  |  |  |

For every row record menu/dialog reachability, bottom-bar clearance, internal scroll, Find anchor, focus trap/return, selection preservation and orientation/viewport behavior.

## Import/export matrix

| Path | Markdown | TXT | Result | Evidence |
| --- | --- | --- | --- | --- |
| Web/PWA import |  |  |  |  |
| Web/PWA export |  |  |  |  |
| Mini App import |  |  |  |  |
| Mini App export |  |  |  |  |
| Bot /importar |  |  |  |  |
| Bot /exportar |  |  |  |  |
| Edited Markdown round-trip |  | N/A |  |  |
| Structured document → TXT warning | N/A |  |  |  |

## Network/storage fault matrix

| Fault | Environment/device | Expected | Observed | PASS/FAIL | Evidence |
| --- | --- | --- | --- | --- | --- |
| localStorage read failure |  | preserve/block overwrite |  |  |  |
| identity write/read-back failure |  | block identity-dependent call |  |  |  |
| /novo archive storage failure |  | abort transition |  |  |  |
| IndexedDB unavailable with attachment |  | block/surface missing media |  |  |  |
| Railway draft-volume write failure |  | local copy retained, no durable-success claim |  |  |  |
| Railway draft unavailable after restart |  | explicit recovery failure |  |  |  |
| offline before request |  | explicit failure |  |  |  |
| Telegram unknown timeout on first send |  | uncertain/no new send |  |  |  |
| Telegram edit timeout |  | same binding/no duplicate message |  |  |  |
| backend restart during sending |  | uncertain/no retry |  |  |  |
| response lost after possible acceptance |  | persisted result or uncertain |  |  |  |
| Telegraph ownership without credential |  | fail closed |  |  |  |
| reload succeeded handoff |  | reuse/no send |  |  |  |
| reload uncertain handoff |  | no send |  |  |  |
| explicit Telegram rejection |  | failed/explicit retry only |  |  |  |
| stale persistent draft revision |  | reject stale overwrite |  |  |  |

## Visual baseline manual verification

- Baseline SHA: `aac423e012745c7873908ddc4a76371fb8218aa3`
- Candidate/anchor SHA:
- Light mode evidence:
- Dark mode evidence:
- Menus/dialogs evidence:
- Title-label evidence:
- Notes on intentional post-baseline placement changes:
- PASS/FAIL:

## Rollback

- Last known-good immutable SHA:
- Candidate deployment ID/SHA:
- Rollback deployment procedure exercised:
- Rolled-back deployment ID/SHA:
- Persistent volume retained:
- Persistent draft still recoverable after rollback:
- Forward redeploy procedure exercised:
- Irreversible migration present?:
- If yes, reverse/forward migration evidence:
- Rollback evidence reference:
- PASS/FAIL:

## Final decision

- Regression/build: PASS/FAIL
- Surface contract: PASS/FAIL
- Visual: PASS/FAIL
- Draft persistence: PASS/FAIL
- Telegraph: PASS/FAIL
- Telegram Rich Message: PASS/FAIL
- Physical devices: PASS/FAIL
- Import/export: PASS/FAIL
- Fault matrix: PASS/FAIL
- Authorization/config: PASS/FAIL
- Rollback: PASS/FAIL
- Evidence completeness: PASS/FAIL

Final status: BLOCKED / CANDIDATE VALIDATED / RELEASE APPROVED

Decision timestamp:
Decision maker:
Notes:
