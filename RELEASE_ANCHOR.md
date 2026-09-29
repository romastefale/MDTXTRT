# Release Anchor policy — Etapa 7/7

## Authority

The canonical release identity is a **full 40-character Git commit SHA**. A convenience branch or tag may point to it, but never replaces the SHA as authority.

The approved translucent visual baseline remains `aac423e012745c7873908ddc4a76371fb8218aa3`; it is a visual reference, not the release identity.

## Pre-release candidate versus final immutable anchor

During Etapa 7/7, code may have one or more **test candidates**. A test candidate is simply an exact commit SHA used to run automated and external validation. It is not an immutable final product candidate and must not be described as release-approved.

The **final immutable Release Anchor is created only after every mandatory criterion in `RELEASE_VALIDATION.md` passes against the same exact SHA**, including:
- clean regression/build and bundle reproducibility;
- stage lineage and surface-contract audit;
- automated/manual visual checks;
- exact candidate deployment;
- Railway draft persistence/restart;
- Telegraph real restart flow;
- Telegram real send + later edit of the same message;
- Web/PWA/Mini App physical matrix on iOS and Android;
- real import/export matrix;
- network/storage fault matrix;
- rollback;
- evidence completeness and authorization.

This intentionally prevents a green automated build from being called the final immutable candidate while external/device evidence is missing.

## Immutability rule

After a SHA is recorded as **RELEASE APPROVED** and sealed as the Release Anchor:
- do not amend or reinterpret it;
- do not force-move a convenience branch/tag to make another commit appear to be the same release;
- do not deploy a different SHA under the same release record.

If a defect is discovered **before** approval, fix it in a new test-candidate commit and restart the required gates. No immutable anchor has yet been sealed.

If a defect is discovered **after** approval, keep the approved anchor and evidence unchanged. A correction becomes a new release cycle with its own SHA and full validation.

## Deployment rule

The final deployment record must identify the exact approved Release Anchor SHA. Deployment from a branch name alone is insufficient.

Persistent Railway volume data is not deleted to make rollback appear clean. Rollback/forward-redeploy evidence belongs to the release record.

## Convenience pointer

Only after approval, an optional branch/tag such as `release-anchor/<date>-final` may be created as a convenience pointer to the already-approved full SHA.

Moving or deleting that pointer never changes the historical meaning of the recorded SHA.
