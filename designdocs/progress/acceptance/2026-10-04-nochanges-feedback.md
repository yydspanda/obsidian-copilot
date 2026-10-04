# No-changes diagnostics and Activity feedback

Date: 2026-10-04. Task: `PK-H3-NOCHANGES-FEEDBACK`.
Issue: [#15](https://github.com/yydspanda/obsidian-copilot/issues/15).

## Scope and outcome

Implemented the approved local repair after the
[incremental-content diagnosis](./2026-10-03-reading-regression.md#read-only-incremental-diagnosis-follow-up).
Only six Knowledge-owned production modules changed. No upstream-owned runtime,
prompt, model routing, dependency, or source-hash validation changes were made.
There were no real model calls, Vault/UI operations, deployment, commit/push,
or upstream fetch/merge during this repair.

Activity now distinguishes these outcomes:

- `Wiki updated`: exact completed-job Apply evidence proves file changes were committed;
  this is not a guarantee that every source detail was incorporated.
- `No Wiki changes`: an exact no-changes marker identifies analysis selecting no targets,
  resolution leaving no targets, or generation producing no file changes.
- `Completed`: old history without exact retained proof stays neutral and explicitly unknown.
- `Finalizing` remains unfinished and does not display a successful completion outcome.

New successful generation no-ops retain only the counts of explicit `unchanged`
targets and byte-identical proposed writes. The optional counts are validated,
content-addressed and frozen; no model response or source text is persisted by
this addition. Older no-count plans and markers remain valid with unchanged
identities/digests. Missing historical counts are not invented. Completion
projections come from one Runtime snapshot, match the exact job, and do not grant
write or citation authority.

This resolves diagnosis/feedback, not the model's semantic omission. The prior
incremental Wiki/Query acceptance is still **not passed**. A new source revision
that produces no changes does not refresh old citations. No automatic retry or
forced write was added.

## Regression evidence

New assertions failed before implementation for the intended missing diagnostics
or completion projection. An additional inherited-key case failed before the
own-key lookup repair. After implementation:

- Runtime suite: **261/261 passed**, no skips/failures, 399.878 seconds.
- Ten affected compiler, manifest, Activity, read-adapter, Query and citation
  suites: **228/228 passed**, no skips/failures, 22.269 seconds.
- Combined distinct affected coverage: **11 suites / 489 tests**. This is not a
  rerun of the October 3 full non-paid repository sweep.
- Project-governance tests: **20/20 passed**.
- Independent read-only review found no concrete introduced defect in exact-job
  matching, legacy compatibility, freezing, finalizing, or citation authority.

The cross-layer Runtime test uses production readers, query coordination and
citation resolution with deterministic in-memory storage/model doubles:

1. Apply original-source Wiki evidence; the original query is answered.
2. Append source content and complete a no-changes result with generation counts.
3. Preserve Wiki/Apply provenance and reject the old citation as stale.
4. Return insufficient query evidence without calling the model double again.
5. Reload Runtime and project the new job as no-changes with exact counts, while
   the same source's old Apply job retains its applied outcome.

Reproduction uses `npm test -- --runInBand --runTestsByPath` with:

```text
src/knowledge/runtime/KnowledgeRuntimeStore.test.ts
src/knowledge/manifest/NoChangesManifestCommit.test.ts
src/knowledge/compiler/KnowledgeCompiler.test.ts
src/knowledge/compiler/KnowledgeCompiler.security.test.ts
src/knowledge/ui/activityModel.test.ts
src/knowledge/ui/activityModel.completion.test.ts
src/knowledge/ui/KnowledgeStudioRuntimeReadAdapter.test.ts
src/components/knowledge/KnowledgeActivityPanel.test.tsx
src/knowledge/query/KnowledgeAppliedWikiSnapshotReader.test.ts
src/knowledge/query/KnowledgeScopedQueryCoordinator.test.ts
src/knowledge/query/KnowledgeCitationTargetResolver.test.ts
```

## Rendered states and quality gates

`npm run gallery:build` passes. Seven adjacent Activity stories render through
the real gallery catalog in a dedicated, isolated Chromium page: two themes ×
300/340/400/600 px = **56 passing checks**, no renderer errors or horizontal
overflow. Narrow light and wide dark screenshots were visually inspected.
The preview uses inert Obsidian/modal shims and representative theme variables;
it is not native Windows/Obsidian theme acceptance and never opens a Vault.

`npm run format`, `npm run lint`, personal production build, JavaScript syntax,
mobile-load smoke and `npm run review:obsidian` pass. Lint retains nine warnings
outside this repair. Review retains existing deprecation/style warnings and
three moderate dependency advisories (`fast-uri`, `ip-address`, `js-yaml`);
no rules were suppressed and no dependency update was attempted. The two
deliberately invalid manifest errors at the end of the review log belong to
passing regression fixtures, not package/source gate failures.

Base commit: `dac3d7ccde6f8e52c558edba7b9857178ee4d319` on
`knowledge-h3-personal-flow`. Incorporated upstream remains
`996a088c59a2ae123852d8e542f354b1eba72cee`; upstream drift was not refreshed.
The approved personal ceiling remains `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000`;
the default 5 MB ceiling is unchanged. Local artifact size: **6,467,100 bytes**.

```text
main.js SHA-256  bce176fd81e27a3f3f1386e9122ac0055021094e69a588b71ffc6a622997a094
styles.css SHA-256  83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e
```

Local ignored evidence is under `.git/acceptance/nochanges-feedback-20261004/`:
affected-tests/build/format/lint/review logs, isolated gallery runner/results and
screenshots. These files are local evidence, not committed test fixtures.
The Runtime full-suite result was observed in the test tool output.

## Handoff

The repair is local and verified, not delivered. Commit/push, test-copy deployment
and a bounded real incremental-content retest remain separate next steps. The
previous request budget was not renewed or used during this deterministic repair.

## Authorized delivery follow-up

Task: `PK-H3-NOCHANGES-DELIVERY`. The user subsequently approved the next step:
commit/push this development branch and deploy to
`C:/Users/yydsp/Obsidian-Copilot-Management-Test`. Native loading, Activity outcome
and preservation checks will keep the queue paused. No upstream merge or remote
master change is included. The prior paid budget is closed; a new maximum of
three requests for one source-specific compile/query replay was asked separately
and is not treated as granted before the user's response.
