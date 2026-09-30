# AGENTS.md — MDTXTRT working rules

This file is written for future coding agents and assistants operating on this repository.

## Product status

MDTXTRT is an evolving product. It is **not finished**.

Current working baseline: `7fe51e8401012232281db416ac0d9bd080c18ebf`.

The baseline is a comparison snapshot only. It is not a requirement to preserve existing behavior.

## Required behavior for future work

1. Follow the user's current correction or implementation request. If it conflicts with baseline behavior, evolve the product.
2. Never defend a defect because it exists in `main`, a baseline, a test, documentation, or a prior assistant message.
3. Do not add silent fallbacks, compatibility branches, or degraded paths merely to preserve old behavior.
4. Keep changes focused on the requested problem. Do not broaden scope to peripheral work as a substitute for fixing the core issue.
5. Update tests and contracts when the intended behavior changes. Do not force new behavior to satisfy an obsolete assertion.
6. After an accepted deliberate change, update stale baseline references if the previous baseline no longer represents the intended state.

## Evidence discipline — do not confabulate

Do not state that something is fixed, tested, deployed, persisted, or verified unless that exact claim has evidence.

Use these distinctions:

- **Implemented**: code was changed.
- **Automated PASS**: a named automated test/workflow passed for a specific SHA.
- **Deployed**: the deployment system reports success for that exact SHA.
- **Runtime observed**: the behavior was actually exercised in the relevant runtime.
- **Physical/device verified**: the behavior was actually checked on the relevant real device/environment.

These are not interchangeable.

Never infer:
- physical mobile behavior from a DOM/unit test;
- persistence of stored bytes from volume configuration alone;
- production behavior from source code alone;
- deploy success from a merged PR;
- correctness from an old baseline;
- user-observed behavior from a synthetic test.

If the user reports a real behavior that contradicts automation, treat the discrepancy as a defect to investigate. Do not use the passing test to overrule the report.

## Baseline rule

Read [BASELINE.md](BASELINE.md) before baseline-sensitive work.

The operative rule is:

> Preserve intentional contracts, not accidental defects. Evolve the baseline when accepted product behavior evolves.

Do not use "baseline preservation" as a reason to avoid a requested correction.
