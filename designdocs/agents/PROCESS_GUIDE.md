# Process Guide

Conventions for running a multi-step development session in this repo.

## Live progress control plane

`TODO.md` is the single live status entry point, not a permanent history or migration document.
Keep it short and update it whenever ownership or state changes:

1. `## Current Stage` appears exactly once and points to one registered Stage ID.
2. `## In Progress` appears exactly once and contains exactly one unchecked task with a registered
   Task ID. Future work stays in the roadmap rather than becoming extra active checkboxes.
3. `## Recent Activity` keeps only the newest operational records. Do not use completed checkboxes
   here.
4. `## Upstream Status` records the most recent canonical commit and ahead/behind observation.
5. Current decisions and verification evidence remain concise; durable design belongs in the
   relevant design document.

The Task ID Registry in `designdocs/PERSONAL_KNOWLEDGE_EXECUTION_PLAN.md` is the durable roadmap.
Register an ID there before referencing it from `TODO.md`, a monthly archive, or an experiment.
Never recycle a completed one-off ID for new work. Explicitly registered recurring operations keep
their stable ID across dated activity and archive events.

### Completion and monthly archive

When a task finishes:

1. move its completion evidence to `designdocs/progress/archive/YYYY-MM.md` for the actual completion
   month;
2. add a short plain-text Recent Activity record if it is still useful at the top level;
3. select exactly one next task from the roadmap;
4. keep monthly archive files free of unchecked tasks and active-stage headings.

Do not invent dates while migrating old records. Preserve ambiguous legacy material in a frozen
snapshot and summarize only facts that can be dated reliably.

Use a completed checkbox beginning with a backticked Task ID for a dated one-off completion. Use a
plain `Task event:` marker followed by a backticked Task ID for a recurring operation or an undated
migration fact. The explicit marker lets CI validate task ownership without mistaking technical
tokens such as `SHA-256` for a Task ID.

### Experiment evidence

Every model, data, configuration, quality, or performance experiment must be appended to
`designdocs/progress/experiments/YYYY-MM.md` using its README template. Each block records:

- a unique Experiment ID and registered Task ID;
- the full canonical upstream commit;
- the exact model/revision;
- SHA-256 hashes for model configuration and data;
- hardware and runtime context;
- the reproducible command;
- named metrics with values and units.

Ordinary deterministic tests are verification, not experiments. Never place secrets or raw private
data in experiment logs.

### Required checks

Run `npm run progress:check` after changing the tracker, roadmap, archive, or experiment log. CI
runs the same validator. The separate upstream-drift workflow regularly compares tracked fork
branches with the explicitly configured canonical repository; ordinary `git status` is insufficient
because a feature branch commonly tracks only its fork remote.

### Live tracker example

```markdown
# Project Progress

## Current Stage

- Stage ID: `PK-H3`
- Outcome: bounded Windows acceptance.

## In Progress

- [ ] `PK-H3-UPSTREAM-V4-WIN` — Verify the frozen artifact in Windows Obsidian.

## Recent Activity

- 2026-08-26 — `OPS-UPSTREAM-SYNC` — Merged the latest canonical baseline.
```
