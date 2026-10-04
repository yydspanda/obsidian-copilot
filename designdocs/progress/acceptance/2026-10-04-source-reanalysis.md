# Confirmed single-source reanalysis

Date: 2026-10-04. Task: `PK-H3-SOURCE-REANALYSIS`.
Issue: [#16](https://github.com/yydspanda/obsidian-copilot/issues/16).

## Scope

The user approved an explicit way to reanalyze a completed source, then delivery
and the previously authorized incremental chapter-13 replay. Only nine
Knowledge-owned production modules changed, under `src/knowledge` and
`src/components/knowledge`. IngestQueue, prompts, upstream core, dependencies,
source bytes and the default bundle-size policy are unchanged.

The new Activity action requires a user-paused Queue and an exact, proven latest
completion. Confirmation queues a separate job; it does not resume the Bundle,
call a model, change Wiki, erase history or weaken automatic same-input dedup.
Runtime rechecks the displayed Queue revision, source ordering, pending work,
retirement and write/recovery owners atomically. A fresh input ordering revision,
consumed observation, pending job and watermark are committed together. Execution
still verifies the real source hash, and proposed changes still require Review/Apply.
Late cancellation cannot turn an acknowledged durable enqueue into a failure.

The inline confirmation discloses cost, retained history and explicit Resume.
It expires when Bundle/revision/eligibility changes. Duplicate confirmation and
competing actions are disabled. Older adapters remain read-only for this action.

## Deterministic evidence

Behavioral RED was observed for missing Runtime admission, command forwarding,
Activity action and Controller/Root wiring. An independent read-only review
identified a post-commit lifecycle assertion that could lose the enqueue receipt;
both late-generation and late-signal regressions failed before that assertion was
removed, then passed in a fresh process.

- Ten UI/control suites: 277 tests pass.
- Four Queue/source-freshness/Apply suites: 138 tests pass.
- Full Runtime suite passes in 430.561 seconds; its source remained stable.
- Final fresh-process Runtime replay, command adapter, production composer and
  Root wiring rerun: 5 suites / 105 tests pass. Combined distinct affected
  coverage is 19 suites / 736 tests (overlapping reruns counted only once).
- Governance: 20 tests pass.
- Gallery: nine actual Activity stories, two themes, four widths (300/340/400/600
  px), 72 checks pass without renderer errors or horizontal overflow. Reanalyze
  confirmation/cancel/queue and busy-state controls were exercised. Narrow light
  and wide dark rendered screenshots were inspected. This isolated preview uses
  inert Obsidian shims; native deployment is a separate check.

The earlier combined backend command is **not** an all-green result: its long-lived
process loaded the old adapter, then read two changed commit-wins assertions and
reported 319 passed / 2 failed. Both failures passed against final source in a
new process. Evidence retains this distinction rather than hiding the failed run.
This is affected-path regression coverage, not a repeat of the full repository sweep.

The personal production build, typecheck, JavaScript syntax, mobile-load smoke,
gallery build and complete Obsidian review pass. Review retains existing
deprecation/style warnings and three moderate dependency advisories (`fast-uri`,
`ip-address`, `js-yaml`); no suppression or dependency update was made. The two
invalid manifest errors at the end of the review log are expected regression
fixtures, not source/package failures. Tested local bundle: 6,474,174 bytes.
`npm run format && npm run lint` passes; lint retains nine pre-existing warnings,
with no errors. Progress governance and `git diff --check` pass.

```text
main.js SHA-256     d1f418adfbca20898dbd7c9b2362a7d7c6969cfc85e0e8dfbfdee78b2873c931
styles.css SHA-256  83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e
```

Base branch commit: `d08ef1486be9411f92cddf62226cf12b521de466`.
Incorporated upstream: `996a088c59a2ae123852d8e542f354b1eba72cee`.
No upstream synchronization or remote-master change is part of this task.
Ignored local evidence: `.git/acceptance/reanalysis-20261004/`.

## Bounded native replay contract

Only `C:/Users/yydsp/Obsidian-Copilot-Management-Test` may be operated. The fresh
allowance is at most three requests: one analysis, one generation, one Query;
no retry. Only the already-supplemented chapter-13 source may be reprocessed and
Apply is limited to its existing Wiki page after inspection. No prompts, other
materials or original source files may change. End with the queue paused.

At this implementation checkpoint, no paid requests have been made. Deployment
and native replay results will be recorded below; implementing the entry does not
prove that the model incorporates the new material or repairs stale citations.
