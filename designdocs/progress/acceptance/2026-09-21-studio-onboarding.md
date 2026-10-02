# Studio setup and material entry — September 21, 2026

Task: `PK-STUDIO-ONBOARDING`.
Issue: <https://github.com/yydspanda/obsidian-copilot/issues/13>.

## Scope and baseline

The user requested repairing the first-use workflow before resuming self-operated
reading practice. Studio previously required manual Project YAML/rules creation,
and adding a Vault note required a detour through ordinary Quick Chat.

Worktree: `knowledge-h3-personal-flow`, HEAD `1f25176e`, with pre-existing dirty
September 20 Pro compatibility repairs preserved. Incorporated upstream remains
`996a088c59a2ae123852d8e542f354b1eba72cee`; no upstream fetch or merge occurs here.
At this implementation/deployment checkpoint, no commit or push had been performed.

Implementation stays in Knowledge modules except for three lines in `main.ts`
connecting native Agent Chat navigation. Native Project creation, Chat behavior,
internal prompts, provider credentials and dependency versions are unchanged.

## Observable behavior

- First-time Studio setup chooses an existing Project and configured model,
  previews editable roots/rules, and saves only after explicit confirmation.
  Existing Bundle configurations are never replaced by this first-use flow.
- Missing Projects link to native Agent Chat. Configuration-file navigation is
  labeled separately; opening a page does not create files or call a model.
- Setup preserves unrelated frontmatter/body and existing rules, rejects
  configuration-directory overlap, external real paths and mismatched real path
  casing, and rechecks Project/model identity before committing.
- Studio's **Add materials** selects one supported Vault file. Files already in
  the source root register directly. Files outside it require explicit consent
  to copy a snapshot to `<sourceRoot>/Vault/<original path>`; originals are not
  moved or edited and source permissions are not widened.
- Source reads enforce the parser's 8 MiB budget before allocation and again
  after reading. Selections are bound to the current Bundle/generation and file
  identity. Duplicate clicks and stale selections cannot replace existing files.
- Adding does not Resume or Apply. A running queue may start model work after
  the user's confirmation; a paused queue remains paused. The UI warns about
  this distinction. Setup itself neither registers sources nor invokes a model.
- Committed receipts survive refresh/unmount and are scoped to their Bundle.
  Partial failures can leave newly created directories, rules or a registered
  source; users are told to inspect current state before retrying, not promised
  destructive rollback.

## Local verification

Observed red-to-green regressions cover setup behavior, reserved configuration
paths, Windows path spelling, material selection/registration, native Project
navigation, post-unmount receipts and cross-Bundle feedback isolation.

Final frozen-source run: **27 suites / 376 tests pass**, no failures or skips.
This covers `knowledge/setup`, `knowledge/capture`, the affected Studio/forms,
view wiring and `main.test.ts`; it is not a full-suite rerun.

Checks completed:

- Personal production build and TypeScript check with
  `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000`; default release ceiling unchanged.
- `npm run format`, final `npm run format:check`, and `npm run lint`.
  Lint retains nine warnings: six explicit chooser-state reset warnings and
  three pre-existing warnings. No errors or rule suppression.
- Full `npm run review:obsidian`, including packaged styles, dependency audit
  (zero vulnerabilities) and negative fixtures; review warnings remain visible.
  Error output emitted by deliberately invalid fixture manifests is expected.
- `node --check main.js` and `node scripts/mobile-load-smoke.cjs`.
- `npm run gallery:build`; actual adjacent stories mounted through the gallery
  catalog in an isolated browser: 16 states at 300/340/400/600 px, 64 checks,
  no render errors or horizontal overflow. Saving/error and snapshot consent
  states were exercised. This uses minimal theme/Obsidian shims, not native
  Obsidian visual acceptance. No gallery plugin was installed in the Vault.

The initial gallery check correctly rejected a runtime domain import in a story;
the story now uses adjacent/type-only imports without weakening the import fence.
An initial lint run saw work-in-progress test assertions; final lint is green
with the warnings recorded above.

## Windows delivery

Delivery targets only `C:/Users/yydsp/Obsidian-Copilot-Management-Test`.
The original book Vault and old `Obsidian-Copilot-Test` are outside scope.

Before delivery, actual CLI identity/path matched the practice Vault. Studio was
ready on Activity, Bundle `reading`, Running, with all five activity counts zero.
Runtime revision was zero, with empty queues/manifests and no active transaction.
The preservation baseline contains 185 note/material files and 92 hashed settings.
No credentials or note bodies are recorded in this evidence.

`npm run test:vault` rebuilt and copied build `1f25176e-dirty-92d174d8715d`
(timestamp `20260921-202900`). Its ordinary CLI toggle did not reload the plugin.
A scoped unload/load initially failed because replacing the cached manifest
omitted Obsidian's runtime `dir` field; restoring only that in-memory installation
path allowed the next load to succeed. No source patch or note change was needed.
The temporary diagnostic marker was removed after checking the outcome.

The actual running instance reports `4.0.9+dev.1f25176e.dirty.92d174d8715d`.
Studio is ready on Activity with an enabled **Add materials** button. Bundle
`reading` remains Running with zero total/active/review/failed/history counts;
runtime revision remains zero, queues/manifests empty, no active transaction.
Pre-reload Quick Chat had no messages and Agent Chat had no active requests,
pending questions/permissions or non-whitespace draft. No Chat Save/model command
was invoked.

All 185 note/material hashes match, including Project, rules, personal notes and
saved history; no note was added or removed. Ninety of 92 persisted settings
hashes match. `configuredModels` and `backends` changed during ordinary startup
model discovery; their exact field-level delta was not retained, so this is
**not** a claim that every model-list setting is byte-identical. Provider/key
settings and all other setting hashes match. No setup/import action was invoked.

Local and deployed artifacts match exactly:

- `main.js`: 6,463,609 bytes;
  SHA-256 `e323cf58fecbce78397e36d920ef6873c887500428d1bdfd58639c987892e028`.
- `styles.css`:
  SHA-256 `83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e`.

User-operated first-use creation and actual material submission/model/Review
remain untested on Windows; the assistant has not performed those actions on the
user's behalf. Existing `reading` configuration needs no setup rerun. Next
checkpoint: the user opens **Add materials** and previews their personal note,
without immediately confirming a paid ingest.

## User-authorized commit/push and post-push verification

The user then requested committing/pushing before verification. The previously
deployed Pro repair is isolated in `fda5ce92`; Studio setup/material entry is
`5777c92d69522b01249a9c009c4a19449756274f`. Both were pushed to
`fork/knowledge-h3-personal-flow`, including the already-local documentation
checkpoint `1f25176e`. Remote `master` was not changed. Normal commit hooks ran;
the mixed documentation hunks were separated without discarding working changes.
The installation guide now recommends the Studio setup form consistently.

After push, an independent run from clean `5777c92d` confirms:

- 27 suites / 376 tests pass again, zero skips/failures.
- Personal production build, artifact syntax and mobile-load smoke pass.
- Full Obsidian review passes, audit reports zero vulnerabilities, warnings
  remain unsuppressed. Full format/lint also passed before committing.
- Both rebuilt artifact SHA-256 values exactly match the deployed values above.
  The old development manifest tag remains truthful to its original build;
  equivalent code was verified without another disruptive plugin reload.

Actual Windows checks used the existing practice Vault and actual plugin React
tree through scoped synthetic DOM events; they are not trusted mouse-input or
performance measurements. The CLI debugger command returned unavailable, so
temporary renderer `error` and `unhandledrejection` listeners observed only this
preview sequence. Both counts stayed zero; this is not a claim that all historical
console errors were inspected. Background-window timer throttling delayed the
probe, not the feature's measured runtime; all callbacks finished and listeners
and result markers were removed.

Fourteen material-entry checks pass:

1. Add materials is enabled.
2. Opening the chooser does not submit anything.
3. An empty selection cannot submit.
4. Configuration, Copilot-owned files, Wiki and the active rules file are excluded
   from the displayed inventory (164 eligible files).
5. A search with no matches stays non-submittable.
6. The user's existing personal note can be found by search.
7. Selecting it previews **Copy snapshot** and the exact destination under
   `Sources/Reading/Vault/`.
8. Running-queue cost and explicit Review/Apply warnings are visible.
9. Snapshot selection cannot submit before separate consent.
10. Consent enables Add; Add itself is never clicked.
11. Revoking consent disables Add again.
12. Cancel closes the chooser.
13. Reopening clears search, selection and prior consent.
14. A second cancellation returns to unchanged empty Activity.

Three existing-setup checks pass: all three readiness cards remain configured
locally; the existing Bundle exposes no replacement setup form; the Project
action is labeled **Open Project configuration**. Back to Studio succeeds.

A fresh before/after preservation audit for this verification proves all 185
note/material hashes and all 92 setting hashes unchanged, with no added files or
settings. The entire runtime file is byte-identical:
`4174ecc66c858cd6e2cd3386bd95428e62776a31b7fa01cefe8a84896e3a1215`.
It still has revision zero, no sources/jobs and no active write transaction.
The earlier startup settings exception is not confused with this fresh audit.

No model inference, real Add, setup creation, queue Resume or Wiki Apply was
performed. First-use writes and successful ingest remain covered by local tests,
not claimed as completed native Windows scenarios. The user-operated next step
remains choosing their note in Add materials before confirming a real ingest.

## User-authorized removal of the old manual setup

The user correctly noted that retaining the manually prepared directories and
Project binding did not exercise first-time setup, then explicitly requested
removing the old setup. This supersedes the earlier next-step instruction to
proceed directly to Add materials.

Preflight checked the exact management practice Vault and empty runtime. The
only contents were `Knowledge/reading-rules.md`, empty `Sources/Reading`, and
empty `Wiki/Reading`; paths were real in-Vault paths without symbolic aliases.
The existing `reading` Bundle and legacy Pro binding matched the expected
Project before mutation.

Through Obsidian's own APIs, only `copilot-project-knowledge-bundle` and
`copilot-project-model-key` were removed from the existing `project.md`.
Knowledge, Sources and Wiki were moved to the Vault trash, not permanently
deleted. The original Project, its context inclusions and AGENTS/CLAUDE files,
book chapters, personal notes, saved chats and provider configuration were kept.

Verification proves:

- All three original root paths are absent. The old rules file is preserved
  under `.trash/Knowledge/reading-rules.md`.
- Of 185 original material/note files, exactly the old rules path and Project
  file change; all other 183 content hashes match.
- The Project body hash and all retained frontmatter fields match. Only the
  two authorized Knowledge fields were removed.
- All 92 setting hashes and the complete runtime hash remain unchanged.
- Studio now displays **Finish Knowledge setup**, with `读书心得` selected,
  no Knowledge model selected, both existing DeepSeek choices available,
  Workspace **Needs setup**, and Knowledge model **Waiting on another step**.

No setup creation, source import, model request, Apply or plugin reload was
performed. This establishes a clean Knowledge-on-an-existing-Project starting
point, not an empty Copilot installation. The user will select the model and
confirm the setup form; successful native file creation is still pending.

## October 3 autonomous acceptance follow-up

The new active goal asks the assistant to operate the remaining acceptance in
the management test copy. It supersedes the earlier user-operated checkpoint,
not the data-preservation boundary. Paid requests and test-Wiki Apply are still
awaiting the separately requested bounded authorization. No model inference or
Wiki Apply has been performed in this follow-up.

Native first setup now passes through the actual Studio form. Selecting the
existing Project and configured Pro UUID automatically creates `Sources/Knowledge`,
`Wiki/Knowledge`, and `Knowledge/rules.md`, then persists the new Bundle and exact
model binding. The old manual setup remains in Vault trash and was not reused.
The success receipt stays visible after setup's refresh. All retained Project
fields/body match their baseline; all 92 setting hashes are unchanged. Of 209
preflight files, only the Project changes, with 208 unchanged; the new rules file
is the only added file at this checkpoint. Runtime remains byte-identical at
revision zero. Pausing via Activity then creates one paused, empty queue at
runtime revision one.

Actual snapshot Add uncovered an issue missed by the earlier preview-only
checks. The first attempt leaves only the missing parent directory. The second
publishes the exact snapshot but creates no Manifest or job and loses the chooser
without feedback. The original remains unchanged and the queue remains paused.
A live DOM/Vault event trace shows the snapshot create event followed by chooser
closure, with no production-generation replacement. Ordinary read-model reload
sets `refreshing=true`; Root passed this as disabled, causing the chooser effect
to abort its own pending operation and suppress the cancellation error.

The minimal repair removes that single read-refresh disabling condition from
the Knowledge-owned Root. Non-ready status, pending commands, unavailable
adapters, explicit Cancel and production-generation replacement retain their
existing cancellation behavior. No upstream-owned production file changes.
The new regression fails before the fix because the signal is unexpectedly
aborted, then passes afterward; the paired generation-replacement case still
aborts. Three affected suites / 91 tests pass. An adjacent gallery story covers
the ordinary-refresh chooser/Adding state without any Vault or model operation.

Personal build/typecheck, artifact syntax and mobile-load smoke pass. Formatting
and lint pass with nine retained warnings. Full Obsidian review passes its gates;
the dependency audit now reports three moderate advisories, not zero, and no
automatic dependency changes were made. Negative-fixture errors are expected.
The separately running baseline sweep completed successfully: 731 suites,
10,746 passing tests and two pre-existing skips. Its Root suite contains the old
42 cases, not the two new regressions; the final repaired source was separately
retested with the 91 affected cases. Live integration tests were explicitly
excluded with `--testPathIgnorePatterns='/node_modules/|/integration_tests/'` so
repository integration fixtures could not load credentials and call a model.

Windows delivery uses `test:vault`, with a temporary CLI wrapper pinning every
command to the management test Vault. The script copies the files but its toggle
does not reload this instance; a scoped idle unload/load with the cached manifest's
runtime `dir` preserved loads a verified new instance:
`4.0.9+dev.ff7a9b80.dirty.a5f18b11bd34`. Local/deployed `main.js` match at 6,463,595
bytes, SHA-256 `19733c3973ba51815bc67791c426282ca79e9e6a4ecde4fb1cd09dfe9298bf9c`.
Styles retain the September hash recorded above.

Post-fix native checks pass:

- Retrying the same snapshot reuses its identical bytes and registers exactly
  one source and one pending job. An ordinary read refresh requested while Add
  is in flight no longer cancels it. The success receipt survives the subsequent
  production-generation refresh and the original note remains byte-identical.
- A second snapshot Add reports already registered. Selecting the managed copy
  directly shows Register existing file, needs no copy consent and also reports
  already registered. Both leave the full Runtime byte-identical.
- Runtime revision five / queue revision two contains one queued job at attempt
  zero, control paused, one Manifest entry, no reviews, Apply commits or journal.
- The preservation baseline still has 208 unchanged prior files and only the
  authorized Project change. Exactly two files were added: generated rules and
  the selected note's snapshot. All 92 setting hashes are unchanged; no Wiki
  content was created and no provider credentials are recorded here.

These checks establish native setup and paused intake, not paid compilation,
Review/Apply, Query/Save or the final post-Apply reload. The bounded authorization
for those remaining operations is still pending. The repair is local/deployed;
no new commit, push or upstream synchronization was performed in this follow-up.

The remaining non-paid checks also pass. After one idle plugin reload, Studio
returns ready on Activity with the same source and job IDs, paused control,
attempt zero and no rerun or duplicate job. Startup re-observation advances
Runtime from five to eight, queue revision from two to three and input revision
from one to two. This is observation ordering, not a model attempt; source hash
and pipeline fingerprint are unchanged. The existing queue deduplication
contract preserves that pending job. All 208 other prior files and 92 setting
hashes still match, with no additional files or Wiki writes.

Gallery rendering was initially blocked in a delegated agent's old filesystem
sandbox; those attempts executed no assertions. The main agent subsequently
ran an isolated Chromium page using the real gallery catalog and adjacent
stories with minimal Obsidian/theme shims. Twelve rendered states pass across
300/400/600 px: ready-during-read-refresh, chooser, pending Add, and the existing
Adding form. Consent still gates Add; pending controls stay disabled. No renderer
errors, alerts or horizontal overflow were observed. This is isolated component
verification, not native Windows theme coverage. The dedicated browser was
closed and temporary Vault diagnostics were removed. Paid end-to-end authority
remains pending; the goal is not complete.

### Subsequent bounded authorization and real Review/Apply

The user subsequently approved up to eight actual model requests, including
retries, and reviewed Apply in this test copy. A native-fetch pass-through guard
counts actual official DeepSeek POSTs and blocks any ninth request. It records
only safe metrics and hashes; source/prompt text and credentials are not logged.
The first existing reflection ends legitimately with `analysis_no_targets` after
one request. The selected chapter then produces one create proposal after two
requests. Both originals and snapshots retain their exact hashes. The chapter's
new snapshot parent directory also exercises the repaired Add path successfully.

The proposal conflates original chapter material with the source author's later
interpretations. The operator edits it through Review to distinguish them and
preserve the original rich-research/selective-presentation distinction. Selection
and Use edited file do not write Wiki; only Validate and apply selection creates
the one target. An independent read-only audit verifies disk, acceptedChangeSet,
Manifest intent and Manifest page hashes, acceptedDigest and the single Apply
ledger. The untouched original proposal remains alongside the accepted edit.
At Runtime revision 54, both jobs are completed, with no pending Review, rerun or
active transaction. See experiments 001–003 in the
[October log](../experiments/2026-10.md) for request and output hashes.

The first real Query retrieves the applied page but returns deterministic
insufficient evidence without a model call. All three current source quotes are
5,105 characters; the Query coordinator excludes each at its 4,000-character
per-item boundary. This is recorded as
[issue 14](https://github.com/yydspanda/obsidian-copilot/issues/14), not counted as
successful grounded answering. The queue is paused while the bounded-excerpt
repair is tested; three of eight requests have been used.

At this checkpoint, 208 prior files remain unchanged and only the authorized
Project setup differs from the 209-file baseline. Four new files exist: rules,
two source snapshots and one Wiki page. All credentials and model selections
remain unchanged; the public `copilotPlusCatalog` startup cache is the only
changed settings field, so the earlier all-92-settings-unchanged observation
does not describe this later checkpoint.

### Final real-use completion

Issue 14 is repaired only in the Knowledge-owned Query coordinator. Exact source
quotes are split into bounded, UTF-16-safe evidence pieces after full source
verification; navigation, post-model checks and saved provenance remain bound to
the original complete citation. Per-piece, total-character and item budgets and
all model prompts remain unchanged. Red observes ten intended failures; green
passes all 34 coordinator tests. One first-green assertion incorrectly expected
a four-character suffix from a one-character final piece; that test assertion was
corrected before the successful run. Independent diff review finds no blocker.

The final affected run passes 15 suites / 209 tests, including all Query suites
and the Root/Add/material-intake checks. An earlier invocation named one
nonexistent test path and exited nonzero despite its six real suites passing;
the corrected final command above is the passing result. Format, lint (nine
retained warnings), full Obsidian review, typecheck/build, syntax and mobile-load
smoke all pass. The three moderate dependency advisories remain visible. The
earlier full-suite baseline is not a full rerun of these final repairs.

The canonical test-vault build is deployed only to this test copy; its CLI toggle
again requires the scoped idle unload/load fallback. The new verified instance is
`4.0.9+dev.ff7a9b80.dirty.585c9e469cec`, with local/deployed main.js at 6,463,796
bytes and SHA-256
`e4bfab4cdedcc84ec6b97d8bb3a56ed85afdbcfeeaacbddc93a120ffeb464922`.
Styles remain unchanged. Neither of the two changed production modules exists
in the incorporated upstream tree; no upstream-owned production file was edited.

The same reading question now produces five source-linked claims and survives
navigation away and back. The full source is verified, while Live Preview's
selection excludes its properties header; do not interpret this as raw-byte
selection coverage. A single titled Save while paused creates one immutable
capture and pending job, retains success feedback, and does not write Wiki.
Resuming completes that job as legitimate `analysis_no_targets`, leaving the
capture available without manufacturing a redundant Wiki page. Independent
capture audit matches its digest, content hash, Manifest origin, job identity and
complete original citation. Model inferences still require semantic review.

Final idle reload and cleanup pass: three completed jobs, all attempt one, zero
active/failed/pending/rerun work, one Apply ledger, no transaction, and all target
hashes unchanged at Runtime 95 / queue 46. Native fetch is restored and temporary
renderer instrumentation is deleted. The queue remains paused. All 208 other
preflight files, credentials and model selections remain unchanged; only the
authorized Project setup and public catalog cache differ. There are exactly five
new files: rules, two snapshots, one applied Wiki and one immutable answer capture.

The bounded first-use reading workflow is complete with five of eight authorized
requests and no model retries. This is not an exhaustive future scale/fault
matrix or automatic semantic-quality guarantee. No new commit, push or upstream
merge was performed; the two repairs remain local and deployed. Reproducible
request/hash evidence is in October experiments 001–005.
