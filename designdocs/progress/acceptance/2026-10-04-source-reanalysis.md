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

At the implementation checkpoint, no paid requests had been made. The subsequently
authorized delivery and replay are recorded below.

## Delivery and native result

Source commit `644c5e0ae104ba5e6690d2558fdf7829f2ef1192` was pushed to the fork's
`knowledge-h3-personal-flow`, with normal Prettier/ESLint commit hooks. The remote
branch SHA was read back. The canonical `npm run test:vault` deployment used the
management test-copy path and the personal 10 MB override, producing
`4.0.9+dev.644c5e0a.clean.a88b2eb171d0`; artifact hashes match those above.

The deploy script could not perform its CLI reload. A Vault-guarded idle unload/load
then produced a new plugin instance, the reanalysis capability and actual Activity
button. Merely copying artifacts was not counted as native delivery. A temporary
request guard was installed before that reload so the production route captured
it. It forwarded exact request bodies/headers/signals unchanged and persisted a
credential-free dispatch receipt before each real request. It allowed analysis,
generation and Query at most once each, rejected other compile sources, and limited
generation to an update of the already-owned chapter-13 Wiki path. No retry was made.

Native checks:

1. Opening and cancelling confirmation changes no file or job and makes no request.
2. Confirming adds exactly one pending job at fresh input revision 15. The five old
   jobs are unchanged, Wiki is unchanged, and the queue remains user-paused. Success
   feedback explicitly asks for Resume; zero requests have been dispatched.
3. Explicit Resume makes one analysis and one generation request. Both return HTTP
   200 with requested/observed `deepseek-v4-pro`, ending normally. The generation
   proposes the **same bytes as the existing Wiki page**. The durable result is
   `all_targets_unchanged`, `explicitUnchanged=0`, `identicalWrites=1`, attempt 1.
4. No Review proposal is created, so no Apply is attempted. The queue is paused.
5. One explicit Query asks for the five fields in the supplemented reader extension.
   It retrieves two Wiki hits but the answer is `insufficient_evidence`, with zero
   claims and four missing-evidence explanations. This is a real third request,
   not a successful answer inferred from retrieval hits.
6. The guard is closed and removed, native fetch restored, and an idle plugin reload
   completes. Studio is ready/paused with six completed jobs, zero active/failed/
   pending-review/rerun/recovery work, Query idle and agent sessions idle.

**Reanalysis entry acceptance passes; incremental semantic acceptance does not.**
The new material still has not reached Wiki/Query. This run narrows the symptom to
an identical generated write; it does not establish why the model omitted the
extension. Do not fix it by bypassing no-changes, hash/citation checks or Review,
and do not spend another request under this exhausted allowance.

All **226 file/link entries and 92 existing settings fields** remain unchanged,
including the original chapter, managed source, Wiki and project/rules files.
All five old jobs, old Review records, Apply ledger and other source entries are
preserved. Runtime legitimately gains the one reanalysis and its completion marker;
reload also advances observation bookkeeping. Whole-Runtime byte identity is not
claimed. The previously reviewed historical wording is untouched.

Model allowance: **3/3**, exactly analysis + generation + Query, no blocked attempts,
transport failures or retries. No Apply, Save, other-material write, upstream sync
or remote-master update occurred. See [experiments 20261004-001–003](../experiments/2026-10.md#experiment-exp-20261004-001)
for upstream/model/config/data hashes, hardware, commands, tokens and timings.
Local raw bodies/prompts were not retained; private receipts retain hashes and
metrics, and the saved Query result is separate from the post-reload idle state.
