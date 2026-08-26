# Project Progress

`TODO.md` is the short live control plane. Durable scope and task IDs live in the
[execution plan](./designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md); completed work moves to the
[monthly archive](./designdocs/progress/archive/), and reproducible experiments live in the
[experiment log](./designdocs/progress/experiments/).

## Current Stage

- Stage ID: `PK-H3`
- Outcome: validate the upstream 4.0.3 merge and current Personal Knowledge flow in real Windows
  Obsidian without weakening upstream behavior.
- Exit gate: provider/project/settings migration, reload/unload, Knowledge Studio, and popout pass
  the bounded Windows checklist against the frozen artifact.

## In Progress

- [ ] `PK-H3-UPSTREAM-V4-WIN` — Validate provider/project/settings migration, reload/unload,
  Knowledge Studio, and popout behavior against the merged V4 baseline.

## Upstream Status

- Canonical: `logancyang/obsidian-copilot@master`
- Last checked: `2026-08-26T16:50:48+08:00`
- Baseline: `054dc69bdca43a827e1bfe818f0db1c6d7855c54`
- Current branch at check: ahead 66, behind 0
- Policy: warn on any behind count; fail at 10 commits or when the oldest missing commit is more
  than 7 days old.

## Recent Activity

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
- Keep exactly one current stage and one in-progress task here. Move future work to the roadmap and
  completed work to the archive for its completion month.
- Record every model, data, configuration, or performance experiment using the experiment template;
  ordinary deterministic test runs are verification evidence, not experiments.

## Current Verification

- Conflict resolution: `ChatSingleMessage.test.tsx` — 20/20 tests passed against upstream 4.0.3.
- Governance: 20/20 policy regressions and the live repository check pass; workflow YAML parses.
- Repository: format, TypeScript production build, ESLint, dependency audit, Obsidian package/source/
  style/fixture review, diff check, and secret scan pass. ESLint retains one upstream warning.
- Full Jest: 646/647 suites and 9,288/9,289 tests passed in the parallel run; its single 5-second
  timeout passed on isolated rerun with the full `AgentSession` file at 152/152.
- Upstream drift: fork `master` is synced through `054dc69b`, and the scheduled workflow is
  registered active on the default branch.

## Archive

- [2026-08](./designdocs/progress/archive/2026-08.md)
- [Frozen pre-governance snapshot](./designdocs/progress/legacy/TODO-2026-08-26.md)
