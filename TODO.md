# Project Progress

`TODO.md` is the short live control plane. Durable scope and task IDs live in the
[execution plan](./designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md); completed work moves to the
[monthly archive](./designdocs/progress/archive/), and reproducible experiments live in the
[experiment log](./designdocs/progress/experiments/).

## Current Stage

- Stage ID: `PK-H3`
- Outcome: validate the current upstream merge and Personal Knowledge flow in real Windows
  Obsidian without weakening upstream behavior.
- Exit gate: provider/project/settings migration, reload/unload, Knowledge Studio, and popout pass
  the bounded Windows checklist against a frozen artifact that passes the approved personal
  production budget; the default upstream 5 MB release policy remains unchanged.

## In Progress

- [ ] `PK-H3-UPSTREAM-V4-WIN` — Resume provider/project/settings migration, reload/unload,
  Knowledge Studio, and popout acceptance with the verified personal production artifact.

## Upstream Status

- Canonical: `logancyang/obsidian-copilot@master`
- Last checked: `2026-09-13T16:08:57+08:00`
- Baseline: `9e2594b4`
- Current branch at check: ahead 71, behind 0
- Policy: warn on any behind count; fail at 10 commits or when the oldest missing commit is more
  than 7 days old.

## Recent Activity

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
- 2026-09-11 — `PK-H3-UPSTREAM-V4-WIN` — Windows acceptance confirmed safe Abandon behavior and
  exposed a stale-Manifest recovery loop before any target file was written; the recovery contract
  is corrected under [issue #2](https://github.com/yydspanda/obsidian-copilot/issues/2), pending a
  fresh Windows artifact check.
- 2026-09-11 — `PK-H3-UPSTREAM-V4-WIN` — DeepSeek's canonical model rename broke both live
  Knowledge scenarios; [issue #3](https://github.com/yydspanda/obsidian-copilot/issues/3) now keeps
  the old Flash selection compatible, blocks Pro before I/O, and passes 2/2 live scenarios.
- 2026-08-26 — `OPS-PROGRESS-GOVERNANCE` — Replaced the mixed 600-line tracker with a bounded live
  pointer, frozen migration snapshot, monthly archive, experiment contract, and CI validation.
- 2026-08-26 — `OPS-UPSTREAM-SYNC` — Merged upstream `054dc69b`; retained the new upstream user
  message folding behavior and only reapplied the narrow Knowledge Draft extension.
- 2026-08-26 — `OPS-UPSTREAM-SYNC` — Merged upstream `13aad329`; resolved 52 conflict files and
  passed the full automated gate (648 suites / 9,291 tests).
- 2026-08-25 — `PK-H3-FORWARD-REVISION-WIN` — Automated and release gates completed; bounded
  Windows acceptance remains on the roadmap.

## Working Agreements

- Treat `origin/master` as the authoritative upstream baseline. Prefer new modules and narrow
  adapters; change upstream-owned files only when the integration requires it, and record the
  reason and regression evidence.
- Personal builds explicitly set `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000`; never export this
  into the default release environment. Keep one plugin and reuse the upstream build pipeline.
- Keep exactly one current stage and one in-progress task here. Move future work to the roadmap and
  completed work to the archive for its completion month.
- Record every model, data, configuration, or performance experiment using the experiment template;
  ordinary deterministic test runs are verification evidence, not experiments.

## Current Verification

- Personal production build passes at 6,393,390 bytes under the explicit 10,000,000-byte ceiling.
  Default 5,000,000-byte enforcement still rejects this artifact; it is not a default-policy release
  or Sync Standard-compatible delivery. Exact artifact/config/source hashes are in the September log.
- Size-guard regression: 41/41 tests pass after observing 21 intended failures before implementation.
  Final artifact syntax and simulated mobile module-load smoke checks pass; these are not live UI tests.
- September 13 merge checks: typecheck, diff whitespace check, progress governance, and 10 focused
  suites / 149 tests pass. The earlier full sweep and quality gates below predate this merge.
- Deterministic regression: 697 suites / 9,876 tests passed in the full sweep; the one suite read
  during test-import migration passed all 11 cases after files were frozen (698 suites / 9,887
  passing tests across the sweep and rerun; 2 existing tests skipped; paid live suite excluded).
- Final focused rerun: session manager and extracted OpenCode policy pass 170/170 tests.
- September 13 gates: production typecheck, formatting, lint (0 errors, 3 existing warnings),
  progress governance, and the full Obsidian review command pass, including packaged CSS and dependency
  audit (0 vulnerabilities). Existing review warnings remain visible; gallery indexing is not live rendering.
- Pre-push verification: formatting/lint and 6 focused suites / 84 tests pass. Commit hooks preserve
  the verified source/config hashes; no common credential patterns were found in outgoing added lines.
- Windows acceptance: stale proposal Continue reproduced without a write journal; explicit Abandon
  cleared the claim, resumed the queue, and left source, target, and project files unchanged.
- Earlier live DeepSeek check: 2/2 scenarios passed with three exact `deepseek-flash` responses;
  this final refactor did not rerun paid requests. Historical evidence limitations are recorded in
  the September experiment log.
- The September 11 repair batch touched 16 upstream-owned production files, but extraction reduced their
  diff from +672/-82 to +398/-81. The remaining seams handle model defaults, registry/picker
  resolution, backend configuration, and pre-send validation; provider policy lives in new modules.
- Across the whole fork, 37 upstream-owned production TS/TSX files differ (excluding tests/stories).
  The personal-budget change adds no runtime-source edits: one build guard (+18/-2), tests, and docs.
- Upstream drift: the working branch remains synced through `9e2594b4`, with no missing upstream commits.
- Pending: deployment and fresh Windows visual acceptance of the personal artifact. No Vault copy,
  Obsidian reload, model requests, default-threshold change, or production target/minifier change occurred.

## Archive

- [2026-08](./designdocs/progress/archive/2026-08.md)
- [Frozen pre-governance snapshot](./designdocs/progress/legacy/TODO-2026-08-26.md)
