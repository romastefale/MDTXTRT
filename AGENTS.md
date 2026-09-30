# AGENTS.md — MDTXTRT working rules

This file is written for future coding agents and assistants operating on this repository.

## Product status

MDTXTRT is an evolving product. It is **not finished**.

There is **no authoritative baseline SHA that defines required product behavior**. The working baseline is the current state from which the product evolves. `RELEASE_MANIFEST.json.visualComparisonSnapshot` is only a replaceable visual-comparison snapshot documented by `BASELINE.md`; it is evidence, not behavioral authority.

## Baseline semantics — mandatory

The baseline is a **replaceable evolutionary starting point**. It is not an immutable foundation, preservation target, golden implementation, or requirement to reproduce every behavior present in its SHA.

Use it to answer: **“what known state are we evolving from?”**

Do not use it to answer: **“what behavior must never change?”**

A behavior found in the baseline has no normative authority merely because it exists there. Determine whether it is an intentional contract, a current requirement, or merely incidental/obsolete behavior.

### Authority order for implementation decisions

When sources conflict, apply this order:

1. the user's current explicit requirement or correction;
2. current intentional product contracts applicable to that requirement;
3. the deliberately accepted new behavior being implemented;
4. the current baseline as historical/comparison evidence;
5. obsolete tests, snapshots, prior implementations, and historical behavior.

The baseline therefore cannot veto a correction or evolution. A test derived from the baseline cannot veto it either.

## Required behavior for future work

1. Follow the user's current correction or implementation request. If it conflicts with incidental baseline behavior, evolve the product.
2. Preserve intentional contracts only when they remain applicable; do not preserve accidental implementation details merely because they are present in the baseline.
3. Never defend a defect because it exists in `main`, a baseline, a test, documentation, or a prior assistant message.
4. Do not add silent fallbacks, compatibility branches, or degraded paths merely to reproduce old behavior. Compatibility must have an explicit current reason.
5. Keep changes focused on the requested problem. Do not broaden scope to peripheral work as a substitute for fixing the core issue.
6. Update tests, snapshots, documentation and contracts when intended behavior changes. Do not force new behavior to satisfy an obsolete assertion.
7. After an accepted deliberate change, advance stale baseline references when the previous baseline no longer represents the intended working state.
8. Treat baseline replacement as normal lifecycle maintenance, not as an exceptional break from the repository's rules.

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

> **Preserve intentional contracts; evolve everything else when the product requirement calls for it. The baseline records where evolution starts, not where it must stop.**

Do not use "baseline preservation", snapshot parity, historical compatibility, or an old PASS as a reason to avoid a requested correction or evolution.
