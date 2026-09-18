# Project Progress

`TODO.md` is the short live control plane. Durable scope and task IDs live in the
[execution plan](./designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md); completed work moves to the
[monthly archive](./designdocs/progress/archive/), and reproducible experiments live in the
[experiment log](./designdocs/progress/experiments/).

## Current Stage

- Stage ID: `OPS-MAINTENANCE`
- Outcome: keep the current development branch aligned with canonical upstream.
- Exit gate: verify drift and affected regressions at each sync; remote master stays unchanged.

## In Progress

- [ ] `OPS-UPSTREAM-SYNC` — Recurring maintenance pointer: check the next canonical drift.
  September 18 sync and failed-history audit are complete; no Vault deployment or model retries in this delivery.

## Upstream Status

- Canonical: `logancyang/obsidian-copilot@master`
- Last fetched: `2026-09-18` — canonical `996a088c`; merged into the current branch, 0 behind.
- Incorporated baseline: `996a088c59a2ae123852d8e542f354b1eba72cee`; previous baseline was `61619fe4`.
- Scope: current development branch only; remote `master` intentionally unchanged by user choice
- Policy: warn on any behind count; fail at 10 commits or when the oldest missing commit is more
  than 7 days old.

## Recent Activity

- 2026-09-18 — `OPS-UPSTREAM-SYNC` — Synced 12 upstream commits with 1 conflict file; 56 suites / 1,623 tests pass.
  Build/lint/review pass. All 38 Failed tags are unchanged history; no deployment, model calls or Vault writes.
  [Merge reconciliation and retest scope](./designdocs/progress/acceptance/2026-09-18-upstream-sync.md).
- 2026-09-18 — `PK-LOG-REDACTION-WIN` — 724 suites / 10,498 tests pass; repair `3806657e` pushed/deployed.
  Windows isolated checks 14/14 and actual Studio ready/paused pass; no model calls or live Wiki Apply.
  [Delivery evidence and preserved limitations](./designdocs/progress/acceptance/2026-09-18-redaction-delivery.md).
- 2026-09-18 — `PK-H3-REVIEW11-FIX` — Four repairs pass 10 relevant suites / 175 tests.
  Build/lint/review pass; full sweep has 7 failures in unchanged log redaction. No commit/deployment.
  [Regression evidence and limits](./designdocs/progress/acceptance/2026-09-18-review11.md).
- 2026-09-18 — `PK-H3-UPSTREAM-V4-WIN` — Bounded regression complete: five authorized Apply outcomes,
  722 suites / 10,472 tests pass; final Windows reload/popout/Query/citation and 18/18 preservation checks pass.
  Two minimal repairs are pushed/deployed; extra requests 9/20. [Evidence and exceptions](./designdocs/progress/acceptance/2026-09-18-unattended.md).
- 2026-09-17 — `PK-H3-UPSTREAM-V4-WIN` — [Issue #9](https://github.com/yydspanda/obsidian-copilot/issues/9):
  authorized 1 Query + 1 Save created exactly one capture, Manifest entry and pending job; no Wiki writes.
  The earlier build lost feedback after 7 ms; repair 414b05ae is pushed/deployed, with no stale Query authority retained.
  `EXP-20260917-002` passes live Save continuity: feedback survives full refresh, Query stays selected, and all 69 old files are unchanged.
- 2026-09-15 — `PK-H3-UPSTREAM-V4-WIN` — Upstream `61619fe4` merged/pushed; 48 suites / 1,238 tests pass.
  Issue #7 blocks incompatible proposals; 36 Windows gallery cases and Query/citation/return checks pass.
- 2026-09-13 — `PK-H3-UPSTREAM-V4-WIN` — Merged seven upstream commits through `9e2594b4`
  (4.0.8) as `d1603e68` with zero conflicts. All 79 modified files and 12 new files were retained;
  the restored working-tree content exactly matched the isolated merge preflight. The user approved
  an explicit personal budget under [issue #4](https://github.com/yydspanda/obsidian-copilot/issues/4);
  the single-bundle production build passes at 6,393,390 bytes without deployment. Source fixes
  are committed as `7d978089`; the personal build guard and tests are committed as `38e54166`.
- 2026-09-11 — `PK-H3-UPSTREAM-V4-WIN` — Local build comparison confirmed upstream at
  4,863,967 bytes and this fork at 6,383,885 bytes. Target and minifier probes remain over 5 MB;
  production policy and plugin code were left unchanged pending a delivery-architecture decision.
- 2026-09-11 — `PK-H3-UPSTREAM-V4-WIN` — Isolated DeepSeek compatibility and send-time guards
  in fork-owned modules. Necessary upstream seams preserve ordinary-provider fallback and retain
  live sessions when a supported model switch fails; same-tick invalid defaults stop before I/O.
- 2026-09-11 — `PK-H3-UPSTREAM-V4-WIN` — Merged upstream `20837e19`; resolved three conflict
  files by retaining upstream behavior and reapplying only the required Knowledge integration seams.

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
- September 16 issue #9: 45 suites / 554 tests pass; production edits touch only two fork-owned modules.
  Personal production build passes at 6,428,121 bytes under the explicit 10,000,000-byte ceiling;
  typecheck, syntax and mobile-load smoke pass. Default 5 MB policy is unchanged; see the Windows checkpoint for hashes.
- Size-guard regression: 41/41 tests pass after observing 21 intended failures before implementation.
  Final artifact syntax and simulated mobile module-load smoke checks pass; these are not live UI tests.
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
- Upstream drift is resolved at canonical `996a088c`; remote master remains untouched.
- Current Windows deployment: clean `4.0.8+dev.3806657e.clean.3dbe2a0fe726`; Studio ready, queue paused.
  Runtime 2013 / Queue 960; all 66 job identities/states and settings preserved, no pending; 14 isolated checks pass.
  All 74 files retained; only the unload-time diagnostic log changes. [Latest checkpoint](./designdocs/progress/acceptance/2026-09-18-redaction-delivery.md).
  Earlier Gallery plugin is removed; its shared-editor-style cleanup exception remains in the prior checkpoint.
- September 15: explicit old-proposal rejection and fresh Apply pass with exact target hash and Manifest/ledger proof.
  After the Rules update: 3 queued (paused), 4 outdated reviews, 38 failed, 11 completed, 4 cancelled; Recovery 0.
  Evidence: source-mode selection and reading-mode Ctrl+C both preserve all 3,769 characters; Live Preview highlighting differs.
  See the [Windows checkpoint](./designdocs/progress/acceptance/2026-09-14-windows.md) for evidence and limitations.
- Issue #8: 17 tool + 107 related tests pass. `EXP-20260915-002` reaches an in-memory pending proposal with two requests; 14 real files and all Runtime/Review bytes unchanged. Earlier timeout remains inconclusive.

## Archive

- [2026-08](./designdocs/progress/archive/2026-08.md)
- [2026-09](./designdocs/progress/archive/2026-09.md)
- [Frozen pre-governance snapshot](./designdocs/progress/legacy/TODO-2026-08-26.md)
