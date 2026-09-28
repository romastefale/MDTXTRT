# Release Anchor policy

The release process uses two distinct immutable references.

## Visual baseline

The visual/design contract remains:

`dde30467ed9b0d108bac2ae7ad9bcac1137c169e`

That commit defines the baseline material, normal dimensions and composition. Later behavioral corrections may change interaction/placement under constrained conditions without silently redefining the visual contract.

## Release Anchor

A Release Anchor is the exact Git commit SHA that contains:
- all six evolution stages in order;
- corrections produced by the final Gap Analysis;
- the release manifest;
- release-validation workflow and scripts;
- formal release/failure/evidence contracts.

The **full commit SHA is the canonical authority**. A branch named `release-anchor/<date>-<name>` is only a convenience pointer. Moving/deleting that branch cannot alter the historical meaning of the SHA.

The first Release Anchor for this final-validation cycle is sealed only after:
1. the release branch is a descendant of every stage head listed in `RELEASE_MANIFEST.json`;
2. ordinary regression is green;
3. the release-validation automated job is green;
4. both committed bundles rebuild byte-identically;
5. automated visual shell comparison against the visual baseline passes.

External/device evidence may still be pending when the anchor is sealed. In that state the anchor is a **canonical candidate configuration**, not a release approval.

## Immutability rule

Never amend, force-move or reinterpret a sealed Release Anchor.

If any blocking external/device test finds a code/configuration defect:
1. keep the previous anchor and its evidence unchanged;
2. implement the correction on a new candidate;
3. rerun all automated gates;
4. seal a new full SHA as a superseding Release Anchor;
5. link both anchors in the release issue and explain why the previous one was superseded.

## Final deployment rule

The production update must identify the exact approved Release Anchor SHA. Deployment from a branch name without resolving/recording its SHA is insufficient.

If the deployed SHA differs from the approved anchor, the release is invalid until the new SHA undergoes the same certification.

## Relationship to BASELINE.md

`BASELINE.md` continues to describe the visual working baseline. This file defines the release-configuration anchor. They serve different purposes and neither silently replaces the other.
