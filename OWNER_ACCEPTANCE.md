# Owner acceptance — post-delivery validation

Engineering delivery is complete when the exact `main` SHA has passed the automated release gates and is running successfully in Railway production. The checks in this document are intentionally deferred to the product owner because they require physical devices, real Telegram/Telegraph destinations, or controlled operational disruption.

These checks do **not** represent unfinished implementation work. They are post-delivery acceptance evidence. If any check reveals a defect, record the exact deployed SHA that exposed it, then correct from the current repository state. The evidence record remains historical and does not choose or freeze the implementation base.

## Candidate under acceptance

Record before testing:

- exact 40-character `main` SHA;
- Railway deployment ID and environment;
- test date/time;
- tester;
- authorized Telegram bot/chat;
- authorized Telegraph destination/account.

Do not record tokens, raw Telegram `initData`, browser capability keys or other secrets.

## Physical-device matrix

Test keyboard closed and open in every row.

| Surface | iOS | Android |
| --- | --- | --- |
| Mobile browser | pending | pending |
| Installed PWA | pending | pending |
| Telegram Mini App | pending | pending |

For each cell verify typing/composition, selection, undo/redo, title, destination toggle, menus/submenus, links, at least one media flow, Find/Replace, modal focus, long-menu scrolling, export menu, orientation and viewport transitions.

## Publication acceptance

### Telegram

- open a real Mini App session;
- publish a unique Rich Message fixture;
- record the returned message ID without exposing credentials;
- confirm rendering in the Telegram client;
- edit the same document and publish again;
- confirm the original message remains intact, an update notice replies to it, and the revised content is sent as a new Rich Message;
- when applicable, exercise one media upload;
- reopen a completed handoff and confirm no duplicate send.

### Telegraph

- create a unique page;
- record document UUID/revision/path;
- recover and edit it;
- restart/redeploy while retaining the persistent volume;
- recover and edit again;
- confirm the same Telegraph path is retained.

## Draft persistence acceptance

- create a unique draft marker;
- confirm the current document UUID/revision;
- remove the browser-local active draft/cache required by the test;
- recover from the Railway volume;
- restart/redeploy without replacing the volume;
- recover again;
- verify content, title, destination, UUID, revision and attachment identity;
- verify a different owner cannot load the first owner's draft.

## Real import/export acceptance

Exercise:

- Web/PWA import Markdown and TXT;
- Mini App import Markdown and TXT where file APIs are available;
- Web/PWA export Markdown and TXT;
- Mini App export Markdown and TXT;
- bot private-chat `/importar` for Markdown and TXT;
- bot `/exportar`: pick a saved draft or publication from the list in the chat, then export it as TXT or Markdown in the Mini App;
- bot `/enviar`: pick a saved draft from the list in the chat; the Mini App sends it as a Rich Message;
- one edited Markdown export → new import round trip;
- TXT lossy-warning path with structured content.

## Controlled failure acceptance

Use a controlled/staging context when an operation could disrupt real users or data.

Check:

- localStorage read/write failure;
- browser identity persistence failure;
- IndexedDB unavailable with attachment;
- Railway draft-volume write/recovery failure;
- offline/timeout before request;
- Telegram first-send timeout;
- Telegram revision-notice/new-version timeout;
- backend restart during handoff sending;
- lost response after possible acceptance;
- Telegraph ownership without credential;
- succeeded/uncertain handoff reload behavior;
- explicit Telegram rejection;
- stale persistent draft revision.

Expected behavior remains fail-closed or explicit-uncertain; no silent duplicate external publication and no fabricated recovery.

## Rollback acceptance

Only perform when intentionally authorized for the production/staging environment.

- identify the last known-good deployment;
- roll back without deleting/replacing the persistent volume;
- confirm service health and draft/provenance data remain available;
- forward-deploy the accepted candidate again;
- confirm the same persistent volume remains mounted.

## Completion

When all owner-acceptance rows are PASS against the same exact SHA, attach the evidence to the release record and run the final external/physical evidence workflow. Only then may the SHA be labeled `RELEASE APPROVED` and recorded as the exact release-evidence SHA under `RELEASE_EVIDENCE_POLICY.md`.
