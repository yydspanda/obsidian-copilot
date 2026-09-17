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

- [ ] `PK-H3-UPSTREAM-V4-WIN` — Five authorized sources are applied; extra model-request upper bound 8/20.
  Minimal migration/logging repairs are pushed as 4bf81d7b; final full suite, new deployment and lifecycle checks remain.

## Upstream Status

- Canonical: `logancyang/obsidian-copilot@master`
- Last fetched: `2026-09-18` — latest canonical `37bf6a12`; current branch 92 ahead / 11 behind before regression fixes.
- Frozen baseline: `61619fe427f27c23fbb08b6a040d18ae73c3b219`, merge `0c381e68`; no new merge during live acceptance.
- Scope: current development branch only; remote `master` intentionally unchanged by user choice
- Policy: warn on any behind count; fail at 10 commits or when the oldest missing commit is more
  than 7 days old.

## Recent Activity

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
- Deterministic regression: 697 suites / 9,876 tests passed in the full sweep; the one suite read
  during test-import migration passed all 11 cases after files were frozen (698 suites / 9,887
  passing tests across the sweep and rerun; 2 existing tests skipped; paid live suite excluded).
- September 15 gates: production typecheck, formatting, lint (0 errors, 3 existing warnings),
  progress governance, and the full Obsidian review command pass, including packaged CSS and dependency
  audit (0 vulnerabilities). Existing review warnings remain visible; gallery indexing is not live rendering.
- Pre-push verification: formatting/lint and 6 focused suites / 84 tests pass. Commit hooks preserve
  the verified source/config hashes; no common credential patterns were found in outgoing added lines.
- Windows acceptance: stale proposal Continue reproduced without a write journal; explicit Abandon
  cleared the claim, resumed the queue, and left source, target, and project files unchanged.
- Earlier live DeepSeek check: 2/2 scenarios passed with three exact `deepseek-flash` responses;
  this final refactor did not rerun paid requests. Historical evidence limitations are recorded in
  the September experiment log.
- Across the whole fork, 37 upstream-owned production TS/TSX files differ (excluding tests/stories).
  The personal-budget change adds no runtime-source edits: one build guard (+18/-2), tests, and docs.
- Upstream drift now exceeds the 10-commit limit (11 behind); do not report this gate green. Remote master remains untouched.
- Current Windows deployment: clean `4.0.8+dev.414b05ae.clean.daa7f5fe750b`; five valid proposals applied, queue paused.
  Runtime 1932 / Manifest 23 contains 9 entries; 66 jobs, no pending; [latest checkpoint](./designdocs/progress/acceptance/2026-09-18-unattended.md).
  Gallery preserves all 69 files and Runtime/settings; plugin removed, but strict style cleanup does not pass (one retained editor style).
  Earlier 36 gallery states and fake connection/Studio popout/Activity/close/reopen checks pass; gallery is removed.
- September 15: explicit old-proposal rejection and fresh Apply pass with exact target hash and Manifest/ledger proof.
  After the Rules update: 3 queued (paused), 4 outdated reviews, 38 failed, 11 completed, 4 cancelled; Recovery 0.
  Evidence: source-mode selection and reading-mode Ctrl+C both preserve all 3,769 characters; Live Preview highlighting differs.
  See the [Windows checkpoint](./designdocs/progress/acceptance/2026-09-14-windows.md) for evidence and limitations.
- Issue #8: 17 tool + 107 related tests pass. `EXP-20260915-002` reaches an in-memory pending proposal with two requests; 14 real files and all Runtime/Review bytes unchanged. Earlier timeout remains inconclusive.

## Archive

- [2026-08](./designdocs/progress/archive/2026-08.md)
- [2026-09](./designdocs/progress/archive/2026-09.md)
- [Frozen pre-governance snapshot](./designdocs/progress/legacy/TODO-2026-08-26.md)
