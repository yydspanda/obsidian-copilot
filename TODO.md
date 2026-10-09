# Project Progress

`TODO.md` is the short live control plane. Durable scope and task IDs live in the
[execution plan](./designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md); completed work moves to the
[monthly archive](./designdocs/progress/archive/), and reproducible experiments live in the
[experiment log](./designdocs/progress/experiments/).

## Current Stage

- Stage ID: `PK-H3`
- Outcome: clearly explain core facts, principles and usable methods with correct attribution and source/Review safety.
- Exit gate: overnight regression/report is complete; useful incremental Wiki inclusion remains unproven. Preserve the simpler product scope, source/Review safety and the failed evidence; no blind retries or exhaustive-retention machinery.

## In Progress

- [ ] `PK-H3-INCREMENTAL-OMISSION` — Content-selection limitation remains open after the completed overnight regression. No unapproved prompt changes or further automatic model retries; review the product scope before another repair. [Report](./designdocs/progress/acceptance/2026-10-09-overnight-report.md).

## Upstream Status

- Canonical: `logancyang/obsidian-copilot@master`
- Last fetched: `2026-09-18` — canonical `996a088c`; merged into the current branch, 0 behind.
- Incorporated baseline: `996a088c59a2ae123852d8e542f354b1eba72cee`; previous baseline was `61619fe4`.
- Last remote comparison: `2026-10-09 08:21 +08:00` — development commit `a0aac67f` is 121 ahead / 131 behind canonical `5fbd933f`; no fetch or merge. Hosted drift check fails; remote master remains out of scope.
- Scope: current development branch only; remote `master` intentionally unchanged by user choice
- Policy: warn on any behind count; fail at 10 commits or when the oldest missing commit is more
  than 7 days old.

## Recent Activity

- 2026-10-09 — `PK-H3-OVERNIGHT-REGRESSION` — 744 suites / 10,981 tests pass, 4 explicit skips; native Query/citation/Save pass, fresh Review/Apply unverified. Native receipt closed 2/8; initial Jest request count unknown. Fixes/report pushed as `a0aac67f`; zero-model menu/consent follow-up preserves data. [Report](./designdocs/progress/acceptance/2026-10-09-overnight-report.md).
- 2026-10-09 — `PK-H3-INCREMENTAL-OMISSION` — User delegates one normal chapter-13 run; native processing completes in 23,289 ms, identical write count 1, no new Review. New personal-method evidence has 0 supporting/selected claims. No retry/Apply/Query; prior October 8 timeout remains separately recorded. [Evidence](./designdocs/progress/acceptance/2026-10-08-core-clarity.md#october-9-user-delegated-native-use).
- 2026-10-05 — `PK-H3-SELECTED-RUN` — Selected-only entry deployed and natively verified; other three jobs unstarted, queue paused. Local gates, 224 final integration tests and 104 gallery cases pass. Two model requests still yield unchanged Wiki; no commit/push. [Evidence](./designdocs/progress/acceptance/2026-10-05-selected-run.md).
- 2026-10-04 — `PK-H3-SOURCE-REANALYSIS` — `644c5e0a` pushed/deployed; 736 affected tests and 72 gallery checks pass. Native entry works, but generation repeats old Wiki and Query lacks evidence; 3/3 requests, no writes. [Evidence](./designdocs/progress/acceptance/2026-10-04-source-reanalysis.md).
- 2026-10-04 — `PK-H3-NOCHANGES-DELIVERY` — Repair `6e04e480` pushed/deployed; native labels and all 226 files/92 settings preserved. Incremental replay blocked by absent reprocess action, 0/3 requests used. [Evidence](./designdocs/progress/acceptance/2026-10-04-nochanges-feedback.md#authorized-delivery-follow-up).
- 2026-10-03 — `PK-H3-MANAGEMENT-REALUSE` — Full bounded reading flow passes: 3 completed jobs, 0 failures, 5/8 requests; two fork-owned fixes deployed. [Completion](./designdocs/progress/archive/2026-10.md).
- 2026-09-21 — `PK-STUDIO-ONBOARDING` — [Issue #13](https://github.com/yydspanda/obsidian-copilot/issues/13):
  repair pushed as `5777c92d`; 376 tests, 64 gallery and 17 Windows preview/status checks pass. [Evidence](./designdocs/progress/acceptance/2026-09-21-studio-onboarding.md).
- 2026-09-18 — `OPS-UPSTREAM-SYNC` — Synced 12 upstream commits with 1 conflict file; 56 suites / 1,623 tests pass.
  Build/lint/review pass; `b1328a7d` subsequently deployed to the Windows test Vault. All 38 Failed tags remain historical.
  [Merge reconciliation and retest scope](./designdocs/progress/acceptance/2026-09-18-upstream-sync.md).
- 2026-09-18 — `PK-LOG-REDACTION-WIN` — 724 suites / 10,498 tests pass; repair `3806657e` pushed/deployed.
  Windows isolated checks 14/14 and actual Studio ready/paused pass; no model calls or live Wiki Apply.
  [Delivery evidence and preserved limitations](./designdocs/progress/acceptance/2026-09-18-redaction-delivery.md).
- 2026-09-18 — `PK-H3-UPSTREAM-V4-WIN` — Bounded regression complete: five authorized Apply outcomes,
  722 suites / 10,472 tests pass; final Windows reload/popout/Query/citation and 18/18 preservation checks pass.
  Two minimal repairs are pushed/deployed; extra requests 9/20. [Evidence and exceptions](./designdocs/progress/acceptance/2026-09-18-unattended.md).

## Working Agreements

- Treat `origin/master` as the authoritative upstream baseline. Prefer new modules and narrow
  adapters; change upstream-owned files only when the integration requires it, and record the
  reason and regression evidence.
- Personal builds alone set `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000`; keep one plugin and reuse upstream's build pipeline.
- Keep exactly one current stage and one in-progress task here. Move future work to the roadmap and
  completed work to the archive for its completion month.
- Record every model, data, configuration, or performance experiment using the experiment template;
  ordinary deterministic test runs are verification evidence, not experiments.

## Current Verification

- October 9 delivery: `a0aac67f` pushed with tested code blobs unchanged. Local full Jest 744 suites / 10,981 passed / 4 skipped and gates pass with warnings retained. Native receipt closed 2/8; initial Jest request count unknown. Zero-model menu/consent checks preserve notes/settings/runtime; no fresh Review/Apply. Hosted governance passes, drift fails at 131 behind; default hosted Node CI did not run. Semantic limitation remains.
- October 8 final simplification: 17 suites / 383 related tests, 20 governance tests, build/typecheck/smoke/format/lint/full review pass; existing warnings/advisories remain. One normal Pro analysis passes scope/provenance inspection, but review handoff misses the temporary 120-second deadline. Native cancellation, no generation/Apply/Query; not a full-suite or final-content pass. No further automatic experiment.
- October 8 claim handoff: 18 suites / 416 related tests, final 36 cases, 20 governance tests, build/typecheck/smoke/format/lint/full review pass; warnings and audit 0 critical / 1 high / 3 moderate retained. `0945f5fd` deployed; one real analysis fails semantic completeness, closed 1/3 before generation/Apply/Query. Not a full-suite or end-to-end semantic pass.
- October 8 supporting-qualification replay: 354 affected tests, final 17 encoder cases, build/typecheck/smoke, format/lint/full review pass; d5a51bef pushed/deployed. Two official Pro calls retain counterexample qualification but omit research/expression; no Apply/Query, closed 2/3, full semantic acceptance still fails. Earlier detail replay stays closed 1/3.
- October 8 dependency follow-up: only 3 proxy-addr lock fields change; 8 security checks, 94 Claude tests, build/typecheck/smoke, format/lint and all review stages pass. Official live audit: 0 critical / 1 high / 3 moderate. The interrupted full command is not reported as an exit-0 run; audit and fixtures were completed separately.
- October 6 analysis-detail repair: 17 suites / 352 tests, 20 governance tests, build/typecheck/smoke, format/lint pass. Review package/source/styles and separate fixtures pass; full gate fails on proxy-addr critical advisory. No dependency edits, deployment or real model retest.
- October 6 generation policy: 17 suites / 350 tests, personal build/typecheck, syntax/mobile smoke, format/lint/review and governance pass. Analysis/input/schema unchanged; no live request, deployment or commit/push. Semantic retention remains unproven. [Evidence](./designdocs/progress/acceptance/2026-10-06-policy-delivery.md#subsequently-authorized-generation-policy-repair-offline-only).
- October 6 subsequent replay: exact tested artifact deployed/reloaded; 2 model calls yield a valid but incomplete proposal. 226 notes/links unchanged; only one auto-removed Codex model/reference changes settings. Review retained, no Apply/Query, queue paused with one unexecuted observation rerun. No complete semantic pass or commit/push.
- October 6 delivery: 22 changed suites / 942 tests and format/lint pass; prior prompt/build/review gates pass with warnings retained. `79ba199b` deployed after explicit reload and artifact verification. Two live calls improve selection, not Wiki retention; all 226 files / 92 settings preserved. [Evidence](./designdocs/progress/acceptance/2026-10-06-policy-delivery.md).
- October 4 reanalysis: 19 affected suites / 736 tests, 20 governance tests, 72 gallery checks and gates pass. Native queue/cancel/history checks pass; incremental Wiki/Query acceptance fails. 3/3 requests; all 226 files/92 settings preserved; queue paused.
- October 4 no-changes repair: 11 suites / 489 tests, 20 governance tests, 56 isolated rendered states and build/lint/review pass.
  Pushed/deployed; native Activity shows 2 applied/3 no-changes, data preserved. No paid replay/full-suite rerun; semantic inclusion unproven.
- October 3 frozen-source regression: 731 suites / 10,760 tests pass, 2 existing skips; lint/format/governance pass.
  Two-chapter comparison and full restart pass; new source processed as no-changes, so incremental Wiki/Query acceptance does not pass. 7/8 requests; evidence-retention limitation recorded above.
- October 3 management-copy acceptance complete: setup/Add/Review/edit/Apply/Query/Save/reload pass, 3 completed/0 failed, 5/8 model requests. Originals/credentials preserved; queue paused.
  Two fork-owned repairs deployed and pushed as `37a40be4`; 209 affected tests and 12 gallery states pass. The newer full sweep above includes the final repairs.
- September 21 Studio onboarding: 376 targeted tests, build, format/lint and review pass; 64 isolated gallery checks pass.
  Pushed source `5777c92d` rebuild matches deployed artifacts; 17 Windows checks pass, 185 files/92 settings/runtime unchanged; real submission awaits the user.
- September 20 Pro repair: 715 tests and local gates pass; practice build `1f25176e-dirty-ebf5a93c7d53` loaded, 13 messages / 3 attachments / 165 files preserved; no live Pro call or full-suite rerun.
- September 18 upstream sync: 56/56 affected suites and 1,623 tests pass (0 failures/skips), plus 20 governance tests.
  Production build/typecheck, artifact syntax/mobile-load smoke, format/lint and full Obsidian review pass.
  One session-manager compatibility check preserves retired-model refusal; large-log regression stays enabled.
  This is targeted post-merge coverage, not a repeat of the older full sweep or live Windows acceptance.
- September 18 review/redaction repairs: 724/724 suites and 10,498 tests pass, 0 failures, 2 existing skips.
  Source hash stays frozen; normal commit hooks and format/lint/build/review pass, with retained warnings.
  Source `3806657e` is pushed and deployed; no real model requests or upstream merge in this delivery.
- September 17 presentation repair: 8 suites / 210 tests pass, including red/green receipt continuity regressions.
  Personal build, syntax/mobile-load, format/lint and Obsidian review pass; gallery builds and 4 story DOM tests pass.
  Only 2 fork-owned runtime modules changed; 8 Windows story cases and the separately authorized live Save continuity check pass.
  Independent read-only verification passes all 18 receipt checks, including origin/hash/path/sourceId consistency.
  Repaired Save registers in 1,211 ms and returns ready on Query in 20,917 ms with feedback retained; full refresh latency remains.
- September 16 issue #9: 45 suites / 554 tests and a 6,428,121-byte personal build pass; default 5 MB policy unchanged. Details remain in the September archive.
- September 15 merge checks: 48 Jest suites / 1,238 tests, 36 Node tests, production typecheck,
  artifact syntax/mobile-load smoke and Obsidian review pass. The earlier full sweep below predates this merge.
- September 15 gates: production typecheck, formatting, lint (0 errors, 3 existing warnings),
  progress governance, and the full Obsidian review command pass, including packaged CSS and dependency
  audit (0 vulnerabilities). Existing review warnings remain visible; gallery indexing is not live rendering.
- Windows acceptance: stale proposal Continue reproduced without a write journal; explicit Abandon
  cleared the claim, resumed the queue, and left source, target, and project files unchanged.
- Earlier live DeepSeek check: 2/2 scenarios passed with three exact `deepseek-flash` responses;
  this final refactor did not rerun paid requests. Historical evidence limitations are recorded in
  the September experiment log.
- Against frozen upstream `61619fe4`, 38 upstream-owned production TS/TSX files differ (excluding tests/stories).
  The personal-budget change adds no runtime-source edits: one build guard (+18/-2), tests, and docs.
- September 18 old-test-Vault deployment: clean `4.0.9+dev.b1328a7d.clean.fec5d39dc7b3`; new instance and Studio ready/paused verified.
  Runtime 2040 / Queue 969; all 66 job identities/states preserved, no pending; local model readiness passes, no model calls.
  All 74 files retained; only diagnostic log changes. All 103 old settings unchanged; public catalog cache added. [Checkpoint](./designdocs/progress/acceptance/2026-09-18-upstream-sync.md#authorized-windows-deployment).
  Earlier Gallery plugin is removed; its shared-editor-style cleanup exception remains in the prior checkpoint.
- September 15: explicit old-proposal rejection and fresh Apply pass with exact target hash and Manifest/ledger proof.
  After the Rules update: 3 queued (paused), 4 outdated reviews, 38 failed, 11 completed, 4 cancelled; Recovery 0.
  Evidence: source-mode selection and reading-mode Ctrl+C both preserve all 3,769 characters; Live Preview highlighting differs.
  See the [Windows checkpoint](./designdocs/progress/acceptance/2026-09-14-windows.md) for evidence and limitations.

## Archive

- [2026-08](./designdocs/progress/archive/2026-08.md)
- [2026-09](./designdocs/progress/archive/2026-09.md)
- [2026-10](./designdocs/progress/archive/2026-10.md)
- [Frozen pre-governance snapshot](./designdocs/progress/legacy/TODO-2026-08-26.md)
