# Incremental evidence context optimization — 2026-10-05

Task: `PK-H3-INCREMENTAL-OMISSION`. Issue:
[17](https://github.com/yydspanda/obsidian-copilot/issues/17).

## Scope and evidence

The user authorized optimization after the read-only diagnosis. The preceding
three-request allowance is exhausted. This work uses deterministic in-memory
model doubles only: no paid model requests, Vault operations, prompt edits,
deployment, upstream synchronization or changes to upstream-owned runtime code.

The previous exact-request reconstruction established that the complete addition
reached analysis, generation returned identical Wiki bytes, and stale chapter
citations were excluded from Query. Raw analysis claims were not retained, so
the historical omission cannot be assigned definitively to analysis or generation.

## Bounded implementation

- Partition text into exact paragraph evidence while retaining the complete source
  artifact, its original hash and existing citation validation. Merge ambiguous
  quote ranges instead of allowing a citation to select the wrong occurrence.
  Paragraph-count or quote-search work exhaustion falls back to complete original
  evidence. Markdown ranges do not include the following paragraph's first line.
- Preserve all evidence in both model stages; a selected citation carries its
  excerpt rather than a repeated copy of the whole source. Do not change prompts,
  model output schemas, semantic selection policy or PDF page evidence.
- Add optional content-free `evidenceCoverage` to no-changes plans/markers: each
  entry carries a quote hash, distinct supporting-claim count and count of those
  claims assigned to at least one analysis write target. Exact locator identity,
  not quote hash alone, determines the counts.
- Persist no raw source, claim prose or generated text in these diagnostics.
  Strict bounds, identity/digest binding and immutable snapshots apply. Missing
  diagnostics stay missing so old record identities are preserved. A custom
  compiler admitting more than 2,048 evidence items omits the optional summary
  rather than silently truncating it or rejecting an otherwise valid result.
- Advance production compiler behavior to `knowledge-compiler-v3`; keep parser
  and prompt identities unchanged. Existing historical citations are not refreshed.

## Verification

- Compiler selection tests first failed for the absent diagnostics (5/5).
- Manifest tests first failed for ignored/unchecked diagnostics (14 failures);
  final module run passes 37/37, including frozen round trips, tampering, bounds
  and exact legacy identities.
- Pipeline-version regression first observed v2 instead of the required v3.
- Paragraph tests observed the original full-source behavior fail, then passed
  production UTF-8 parser → analysis → generation, quote navigation, stale-hash
  refusal, duplicate/tail merging, original line endings, BOM and budget cases.
- The first prototype's 24-second repetitive-source regression was independently
  found and fixed before delivery. A deterministic scan-work test failed at
  500,281,340 characters against a 32,000,000-character budget, then passed.
  Final synthetic runs retain all material in 171/166 ms; see
  [experiments 001–002](../experiments/2026-10.md#experiment-exp-20261005-001).
- The custom diagnostic bound was deliberately relaxed by one item to confirm its
  regression fails at persistence; the mutation was restored before final checks.
- Final combined regression: **12 suites / 280 tests pass**, zero skips/failures;
  20 governance tests pass. An intermediate combined run had 279 pass / 1 failure
  because the old text-count fixture also exceeded the new work budget. Its count
  assertion now uses exact-line Markdown evidence, separating the two budgets.
- Production build/typecheck, artifact syntax and mobile-load smoke pass. Personal
  artifact: 6,476,163 bytes; upstream default size policy remains unchanged.
- `npm run format`, full lint (zero errors, nine retained warnings), changed-file
  formatting and full Obsidian review pass. The audit retains three moderate
  dependency advisories; expected rejection-fixture messages are not source errors.
- Independent final review found no remaining concrete defect in the four changed
  production files. No visual state changed; gallery verification is not applicable.
- This is targeted verification, not a full-repository test rerun or model
  acceptance. The subsequent authorized Windows deployment is recorded below;
  changes remain uncommitted and unpushed.

Reproduce the combined regression:

```bash
npm test -- --runInBand --runTestsByPath \
  src/knowledge/compiler/KnowledgeProductionCompileInput.test.ts \
  src/knowledge/compiler/KnowledgeCompiler.evidenceCoverage.test.ts \
  src/knowledge/compiler/KnowledgeCompiler.test.ts \
  src/knowledge/compiler/KnowledgeCompiler.security.test.ts \
  src/knowledge/compiler/KnowledgeCompilerModelAdapter.test.ts \
  src/knowledge/compiler/KnowledgeCompilerPromptEncoder.test.ts \
  src/knowledge/startup/KnowledgeProductionPipelineResources.test.ts \
  src/knowledge/startup/KnowledgeProductionCompileReviewHandler.test.ts \
  src/knowledge/manifest/NoChangesManifestCommit.test.ts \
  src/knowledge/ingest/KnowledgeSourceFreshnessAdmission.test.ts \
  src/knowledge/query/KnowledgeCitationTargetResolver.test.ts \
  src/knowledge/query/KnowledgeScopedQueryCoordinator.test.ts
COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build
node --check main.js
node scripts/mobile-load-smoke.cjs
```

## Remaining acceptance boundary

These are selection diagnostics, **not semantic coverage scores**. An uncited
paragraph may legitimately be irrelevant; a cited or target-assigned claim may
still be omitted from prose. No automatic failure, retry, forced write or Review
bypass is introduced. Budget fallback retains coarser whole-artifact diagnostics,
and added metadata still counts toward the existing request-size limit. The change
makes ordinary context finer-grained and a later
no-changes result inspectable; it does not prove the real model will incorporate
the reader's extension. Reviewed Apply/Query acceptance is still needed before
claiming that outcome; the fresh allowance below has not been consumed.

## Authorized Windows deployment and scoped replay preflight

The user subsequently approved deployment to `Obsidian-Copilot-Management-Test`
and at most three fresh requests (analysis, generation, Query), only processing
the previously supplemented chapter 13 and applying reviewed changes to its
existing Wiki page. No retries or other materials were authorized. The exhausted
October 4 allowance remains separate; this allowance used **0/3** requests.

Deployment used the repository workflow:

```bash
COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 \
COPILOT_TEST_VAULT_PATH=/mnt/c/Users/yydsp/Obsidian-Copilot-Management-Test \
OBSIDIAN_BIN=/nonexistent/explicit-vault-reload-follows npm run test:vault
```

The implicit CLI reload was deliberately skipped. An explicit Vault-name and
base-path-checked Obsidian CLI evaluation reloaded only the management test copy,
with its existing `paused/user` control intact and paid calls unarmed. The build
passed and deployed tag `9bd7be64-dirty-44ae576ae18c`, main SHA-256
`ce7b83784f42a756ad09424ad4724e51792d5f6f13e726b657e45dc131f76bb7`
(6,476,163 bytes). Reload created a new plugin instance and the new compiler
fingerprints appeared in persisted jobs. Obsidian retains a cached manifest
label; that label is not used as proof of the loaded build.

**Scoped replay stopped before any model request.** Changing compiler behavior
to v3 correctly changes source pipeline fingerprints, but startup observation
then creates pending work for all four registered sources. Current Resume and
worker selection are Bundle-wide; they cannot run just the chapter-13 job while
leaving the other three unprocessed. A network block occurs after job claiming
and is not a safe substitute for source isolation.

- Runtime revisions: 334 before deployment, 346 after first reload, 358 after
  cleanup reload. Six completed historical jobs remain; four new jobs are
  pending with attempt 0. The second reload did not duplicate the pending jobs.
- Target chapter-13 pending job: `4dbdf8a0-e942-4bd7-9e83-b91e14e7fc60`;
  new fingerprint: `c619f75fc4f98f0d51bb2c26acaf6120f9357056e36991a571838beee72b80b2`.
- No Resume, model request, Review selection, Apply, Query or retry was executed;
  no other job was cancelled or forced into failure, and no runtime data was
  manually rewritten. This is a blocked preflight, **not a successful model test**.
- Final native Studio is ready, Query idle, queue `paused/user` with its original
  pause timestamp, zero failed jobs, no pending reviews/reruns or active write
  journal. Temporary fetch instrumentation was removed and native fetch restored.
- Fresh receipt `acceptance-incremental-replay-20261005.json` is closed as
  `closed_scope_blocked`, records 0 and blocked requests 0. No model experiment
  entry is claimed for this zero-call deployment verification.
- Independent live preservation audit: all 226 file/link digests and 92 settings
  digests match the fresh baseline, with no files added/deleted/changed. All six
  old jobs, two reviews, two Apply commits, four Source records, one Manifest and
  87 old observations are deeply equal. Only runtime `revision`, `queues` and
  `inputRevisions` changed: Queue revision 142 → 150, four pending jobs and
  high-watermarks advanced, and eight consumed observations were appended across
  the two reloads. Original source hashes are unchanged. Final live runtime
  matches the postdeployment snapshot at SHA-256
  `a50e1d886fec905a39c973ede508ddfb04f88c2dc2a5c418daef2f60475b4930`.

Local evidence: `.git/acceptance/incremental-replay-20261005/` scripts,
`reading-regression-20261003/incremental-{pre,post}deploy.json` snapshots,
`/tmp/copilot-incremental-deploy-20261005.log`, and
`/tmp/copilot-incremental-final-probe-20261005.log`.

Next decision: authorize a minimal source-scoped execution repair before resuming
this allowance. Do not expand the replay to the other materials merely to get
past this queue limitation.
