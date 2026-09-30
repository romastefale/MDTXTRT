# Release evidence reference policy — Etapa 7/7

## Purpose

A release SHA identifies the exact code state against which a particular certification record was collected. It exists for traceability and evidence.

It is **not an immutable product baseline**, **not a preservation target**, and **not authority over subsequent development**. A later correction or evolution is expected to create a later state. Historical release evidence remains attached to the SHA it actually tested, while development continues from the current product state.

`RELEASE_MANIFEST.json.visualComparisonSnapshot` is separately a replaceable visual-comparison snapshot. Neither that snapshot nor a release-evidence SHA defines required future behavior.

## Engineering completion versus release certification

Engineering completion is a property of the implementation and its current acceptance criteria. Release certification records evidence for one exact candidate state.

Certification does not freeze that state. `RELEASE APPROVED` means only that the recorded gates passed for the identified SHA at that point in time. It does not mean “final product”, “permanent implementation”, or “state that future work must preserve”.

## Candidate and historical evidence reference

During certification, the candidate is an exact commit SHA so automated and external evidence cannot accidentally mix different code states.

After certification, that SHA remains in the historical evidence record because changing the identifier would falsify what was tested. This is **historical traceability**, not product immutability.

When the product changes:
- do not rewrite old evidence to claim it tested new code;
- create new evidence for the later candidate when certification is desired;
- do not use the older certified SHA to veto, weaken, or redirect a requested evolution;
- do not require new implementation to reproduce old behavior unless that behavior remains an intentional current contract.

## Evolution rule

A release record answers: **“what exact state did this evidence evaluate?”**

The current requirements answer: **“what should the product become now?”**

The first question never overrides the second.

If a defect is discovered after certification, correct it. If an implementation becomes obsolete, replace it. If behavior intentionally changes, update tests and contracts that should follow that behavior. The prior SHA remains only as an honest historical coordinate for its evidence.

## Deployment and rollback

Deployment records should identify exact SHAs for traceability. Rollback targets may likewise identify a known historical deployment SHA.

That does not make either SHA immutable product architecture. A rollback reference is operational evidence for recovering a prior deployment, not a mandate that development remain compatible with it forever.

## Convenience pointers

Branches or tags may be used as convenience pointers, but they do not define product truth. Historical evidence should always retain the exact SHA actually tested so the record remains auditable.
