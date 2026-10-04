# Frozen reading regression

Task: `PK-H3-READING-REGRESSION`.

## Scope and preflight

The user approved assistant-operated verification only in
`C:/Users/yydsp/Obsidian-Copilot-Management-Test`, with at most eight model requests
including failures, reviewed source-owned Wiki writes, and a safe full restart.
No source-code repair, prompt change, upstream merge, deletion, commit or push is
authorized by this follow-up. Do not reuse the completed first-use request budget.

Frozen source: `dac3d7ccde6f8e52c558edba7b9857178ee4d319`; incorporated upstream:
`996a088c59a2ae123852d8e542f354b1eba72cee`. The local and deployed `main.js` SHA-256
is `e4bfab4cdedcc84ec6b97d8bb3a56ed85afdbcfeeaacbddc93a120ffeb464922`.
The development manifest's older dirty label is retained; the delivered production
source blobs and tested artifact are unchanged.

Preflight observes Studio ready, queue paused, three completed jobs, zero active,
queued or failed jobs, no transaction, empty Chat and an idle Agent session.
The file baseline contains 214 regular files and ten symlinks recorded without
following their targets; all 92 settings fields are hashed without logging secrets.
Runtime SHA-256 is
`318dd134223cb7ca299dfdd3a754fec8c49b81b517117dca2d32444750cecd14`.

## Initial guard and acceptance criteria

- Full non-paid Jest excludes `src/integration_tests`, whose production tests can
  load credentials and make real model requests. Paid integration tests are not
  part of the free automatic sweep.
- An unarmed native-fetch guard is installed for the exact production DeepSeek
  endpoint; total cap eight, per-phase cap at most two. No model request has been
  armed at this checkpoint. It does not alter request bodies or model prompts.
- Two-chapter review must distinguish the chapters' original text, the original
  narrator's own interpretation, later analysis and reader inference. `Supported`
  alone does not certify semantic correctness.
- Updating a managed source is different from changing its external original.
  A legitimate `no_changes` result must not be relabeled a successful nonempty
  Wiki update; do not manufacture content or retry to force a proposal.
- Cold start must observe process exit and a new application process. Plugin
  unload/load is not equivalent; other Vault windows or active work defer restart.

## Free native persistence check

While the free Jest sweep ran, Add materials copied chapter 13 through the UI.
Exactly one managed snapshot and one paused pending job were created, with zero
model calls. Its hash is
`1294b2065f1506bde879981a37c8bad1aeb35a1bd3c1ce84c5e459b9aa2a59be`.
All 224 preflight file/link entries remain unchanged. Idle instrumentation reload
updated only the non-secret `lastShownStartupVersion` setting field.

Windows UIAutomation and Electron both reported only the management-copy window.
Chat/Agent/Query were idle and the queue paused. A normal Electron `app.quit()`
terminated main PID 14692; Windows process enumeration then confirmed zero
Obsidian processes. Reopening only this Vault created main PID 23176 and renderer
PID 19224. This is a full process restart, not plugin reload.

The restored inactive Studio leaf was initially an Obsidian DeferredView; an
early diagnostic probe incorrectly assumed its controller existed. Activating
Studio via its normal command materialized the view and returned ready/paused.
This probe error is not a plugin failure. All 225 file/link entries, settings and
Apply ledger are unchanged across restart; no transaction or duplicate job exists.
The three completed jobs are byte-equivalent. The pending chapter-13 job retains
its identity, source hash and attempt zero; its inputRevision advances 2 to 3 and
updatedAt changes during startup observation. Do not claim whole-runtime byte
identity across restart. The old in-memory instrumentation is gone.

## Final-source automatic checks

`npm test -- --runInBand --testPathIgnorePatterns='/node_modules/|/integration_tests/'`
passes with exit zero: 731 suites, 10,760 passed tests, zero failures, two existing
skips, zero snapshots, 1,063.571 seconds. JSON confirms no paid integration file
ran; Root's 44 and ScopedQueryCoordinator's 34 tests are included. The skips need
real Windows npm layout and an absent local Codex archive fixture respectively.
The 34 React act warnings remain visible. Result JSON SHA-256:
`4ec302b9aaa3b92c070ccbf6aa402116e9a2171ae22f0d56a9592ddb0370f1c6`.

`npm run test:project-governance` passes all 20 tests; `npm run format:check`
passes; `npm run lint` passes with zero errors and nine retained warnings.
No production source, test, story, configuration or build artifact was modified.

## First four model requests and interruption

The first two official `deepseek-v4-pro` requests analyzed and generated chapter
13 (8,322 ms / 8,102 tokens and 8,278 ms / 35,995 tokens). One create proposal
targeted only its new source-owned page. Manual Review separated later analysis
from the original narrative, corrected the 15/17/22/40 chronology, and retained
the narrator-attribution boundary. No Wiki file existed before Apply; the applied
bytes exactly matched the saved edit, SHA-256
`d9c76d5429195f645357753be34a17914a278d0745b9dbc21e50f96676533303`.
An independent audit then confirmed all 224 original file/link entries unchanged,
exactly two additions, four completed jobs at attempt one and no pending transaction.

Request three answered the real two-chapter comparison with ten claims (eight
source facts, two inferences). Claims actually cited both chapters; the central
comparison cited both together, not merely two retrieval hits. Independent
semantic review passed this bounded example. Navigation opened both correct
source files. An initial test-selector mismatch did not activate a citation;
selecting the displayed source button then succeeded. Do not infer exact full-text
selection coverage from the immediate navigation probe.

Request four answered the case-count boundary with four claims (three source
facts, one inference): one or two examples serve expression; 176 is a historical
collection size, not a minimum sample size guaranteeing universal conclusions.
No additional Save or Wiki write was performed for these two queries.

The user then continued after an environment restart. WSL uptime was five minutes,
Obsidian main PID had changed to 4280, and `/tmp` scripts/results plus in-memory
request instrumentation were gone. Persisted pages, four completed jobs and paused
state survived. The full-suite result and its hash above were observed before
restart; the raw temporary JSON/log cannot now be reopened. Likewise the exact
transport hashes/usage for requests three and four were not durably archived before
restart and must not be invented. Their observed answers and scope remain recorded
here, but this is an experiment-evidence retention gap.

The managed chapter-13 snapshot alone now has an explicitly labeled, prospective
five-field reading-method supplement; its hash is
`efc1cc6a327961381322e3fcc298dc34206bb7c127c28edccbbdd20fa4dc1748`.
Its original chapter retains hash
`1294b2065f1506bde879981a37c8bad1aeb35a1bd3c1ce84c5e459b9aa2a59be`.
The new revision is queued while paused. Recovery retains four requests already
used, caps the remaining work at four more, and saves new request counts/hashes to
a credential-free receipt inside this test plugin's data directory before each
network dispatch. Private driver/evidence files now live under `.git/acceptance/`
instead of `/tmp`; a new 226-entry baseline bounds the remaining checks. This new
baseline does not replace the lost initial hash inventory retroactively.

## Incremental reading result: acceptance not passed

Requests five and six processed that new managed-source hash successfully at
attempt one, but generation ended with `all_targets_unchanged`. The job is
`d98e19a8-ea68-43e9-9681-9ff814506ed9`; its no-changes marker records the new
`efc1cc6a` hash and inputRevision 8. The page's last successful compilation still
references the old `1294b206` source, and the Wiki remains byte-identical at
`d9c76d54`. Apply ledger count remains two. No new Review or Apply occurred.

This is a supported no-changes processing outcome, not a successful nonempty
Wiki update. The reason alone cannot distinguish an explicit unchanged model
decision from generated content identical to the existing page; it does not
establish why the new supplement was omitted. Unchanged manual Review corrections
under no write do not prove that a nonempty update preserves those corrections.

Request seven asked for the supplement's five case-recording fields and its
observation/interpretation and missing-counterexample distinctions. Query returned
`insufficient_evidence`, zero claims and four missing-evidence explanations. Both
old Wiki pages were retrieved, but the new supplement was not available in the
answer's evidence. The managed source itself exists and was processed; this is
not a claim that its on-disk update was lost. An independent read-only audit
confirmed the runtime, page hashes and Query result.

The changed-source detection/processing check passes; delivering and querying
the new understanding does not. No retry, fabricated proposal, direct Wiki patch
or extra Save was used to force a pass. Seven of eight authorized requests were
used, with no request failures or retries. The unused request is not a new budget.
No production code fix or prompt change was made; diagnosis and any repair of
this incremental-content gap require a separate follow-up.

## Final preservation and cleanup

Before cleanup, all 226 entries in the recovery baseline and all 92 settings
fields are unchanged, as is the deployed artifact. The request receipt was
closed at seven used requests, zero blocked dispatches and no transport failure.
The native fetch function was restored, instrumentation removed, and the idle
plugin unloaded/reloaded so its production adapters no longer capture the guard.

After reload, Studio is ready on Activity, queue paused, Query idle and Agent idle.
All five jobs remain completed at attempt one; zero queued, active, failed or
pending-review jobs, zero reruns, two Apply records and no active transaction.
All 226 recovery-baseline entries and all 92 settings fields are still unchanged.
Runtime revision is 253; final runtime SHA-256 is
`406073b24f30b530d4706da7c83162465e914c3de20e55e88c499888c95f94df`.
The full original 224-entry inventory cannot be replayed after the environment
restart; its earlier successful audit and the later bounded preservation check
are separate evidence, not a reconstructed end-to-end inventory claim.

Private recovery/final snapshots, the final Query output and scoped driver remain
under `.git/acceptance/reading-regression-20261003/`. The saved final Query output
has SHA-256 `a101afad26a7b1be24d9fcf73cead6f6622f342c43f3826e03f470a336e81e9d`.
The credential-free request
receipt remains in this test Vault's plugin directory as
`acceptance-reading-regression-20261003.json`; it includes request hashes, model
configuration and metrics, not keys or prompt bodies. These files are local
evidence, not committed fixtures. Only progress documentation changed in the
repository; no commit, push, upstream sync or deployment was performed.

Final verdict: the full non-paid tests, bounded two-chapter comparison, case-count
boundary, reviewed initial Apply and controlled complete restart pass. The
nonempty incremental reading-update/query loop is **not passed**, and the lost
pre-restart raw evidence remains an explicit retention limitation.

Documentation checks: `npm run progress:check` and `git diff --check` pass.

## Read-only incremental diagnosis follow-up

Task: `PK-H3-INCREMENTAL-DIAGNOSIS`. The user's continuation authorized the
targeted diagnosis proposed above, not another paid run or a production repair.
No model request, UI action, Vault write, prompt edit or source-code change was
performed. The following proofs use retained private fixtures and production
pure functions bundled only in memory (`esbuild` with `write: false`).

### Proven input and generation boundary

Reconstructing the analysis request from the pre-processing Manifest, completed
job, unchanged Project/Rules and current managed source produces exact matches
for the retained request-five receipt:

- compileContextDigest: `d23fb66d7832ee999fbf3c049edac9421356b158de8852810fa8ea7500e00dc4`;
- messages data SHA-256: `a7bcf72f1c13b0e93703af8cd3ee2eda7c403bdea46f4ba99908bbb851955964`;
- complete request SHA-256: `71a2b7d7c36252603b217d02ea558b156b1c87d4d2f3bafd6a84470144fa415c`;
- request size: 32,202 bytes; one full-text evidence item of 9,140 characters,
  including the explicitly labeled new supplement.

This rules out missing observation, stale input or read truncation for that
request. The local model port is a capture-only stub, not a real model replay.
`KnowledgeCompiler.ts:2553` preserves explicit `unchanged` outputs; line 2556
also removes byte-identical writes. Only an empty successfully validated
projection reaches `all_targets_unchanged` at line 2833. Missing targets,
invalid paths or malformed output fail instead. There was no proposed file
change for Apply to lose.

The exact model-side omission remains unknown. The retained hashes cannot reveal
whether analysis extracted the supplement, which targets it selected, or whether
generation explicitly preserved a target versus reproduced its old bytes.
`KnowledgeProductionCompileReviewHandler.ts:515` transfers only the no-changes
identity/commit plan; analysis and diagnostics are not durably retained. Do not
claim the model specifically selected Wiki13 and decided its new content was
unnecessary.

### Proven Query evidence exclusion

The applied-Wiki corpus still includes chapter 13, but answer material is admitted
only after source-citation verification. `KnowledgeRuntimeStore.ts:5178` obtains
citations from accepted historical ChangeSets; a no-changes receipt does not
rebind them. `KnowledgeCitationTargetResolver.ts:264` rejects a changed whole-file
hash before trusting coordinates. `KnowledgeScopedQueryCoordinator.ts:778` then
omits both that source evidence and its Wiki context if verification fails.

Running the actual `resolveKnowledgeCitationTarget()` on all five retained
chapter-13 citations yields five `stale` results against the current managed
source and five `resolved` results against the preserved original. Every old
excerpt still exists, but none includes the supplement. Only the old-hash Apply
ledger exists for this source. Thus a chapter-13 search hit does not establish
that chapter-13 evidence reached the answer model. The observed insufficiency
is consistent with the safe exclusion of stale evidence, not an indexing delay.

Activity separately projects both applied and no-changes jobs as `completed`
(`activityModel.ts:333`, `KnowledgeActivityPanel.tsx:151`), without a distinct
no-changes outcome label. This is a user-feedback gap; completion is not evidence
that the Wiki or its source references were updated.

### Checks and next repair boundary

Six existing suites pass: Compiler, ProductionCompileInput, NoChangesManifestCommit,
CitationTargetResolver, ScopedQueryCoordinator and ProductionCompileReviewHandler.
There are 167 passed tests, zero failures/skips, in 37.674 seconds. Command:
`npm test -- --runInBand --runTestsByPath` with those six adjacent test paths,
plus `--json --outputFile=.git/acceptance/reading-regression-20261003/incremental-diagnosis-tests.json`.
Result SHA-256: `f8f45942b529636d7c677caa6e4365154e245e32eaa1d934a10a92adc20d5c78`.
These existing green tests validate the local contracts, not successful new-content
delivery. No new regression or behavior fix has been landed.

Reproducible private tools are `diagnose-analysis-input.cjs` and
`diagnose-citations.cjs` under `.git/acceptance/reading-regression-20261003/`.
Their content-free results are `analysis-input-diagnosis.json` (SHA-256
`d83100d2ade50dee979ca78ae0ce0b8a71baff9813244c0341357ffbd8da4978`)
and `citation-diagnosis.json` (SHA-256
`c02efd447d824f5eaff4838093ef55f5ec1fb66b65410020e7c464ad0ba3dc28`).
Final audit still preserves all 226 recovery-baseline entries, all 92 settings,
the plugin artifact and exact final runtime hash. Queue remains paused; paid
usage remains seven of the prior eight, with no renewed budget.

Recommended follow-up: retain minimal no-changes diagnostics, distinguish
unchanged results and stale evidence in the UI, and add an applied-source →
changed-source → no-changes → Query cross-layer regression before choosing a
content-generation repair. Preserve Review ownership and exact source-hash
verification. Do not force a Wiki write, blindly rebind old citations, silently
replace Query's applied evidence with the latest source, change prompts, or
retry the paid model merely to obtain a passing result.
