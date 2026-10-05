# Selected-material execution — 2026-10-05

Task: `PK-H3-SELECTED-RUN`.
Issue: <https://github.com/yydspanda/obsidian-copilot/issues/18>.

## Scope

The user authorized the minimal repair after v3 startup queued four materials and
the existing Bundle-wide Resume could not honor a chapter-13-only replay. The
previously approved fresh allowance remains at most three model requests, without
retries, limited to that source and its existing Wiki target. The October 4
allowance remains exhausted and is not reused. No commit/push or upstream merge
is part of this repair.

## Implementation boundaries

- Activity exposes **Run only this material** for eligible pending work while the
  Bundle is user-paused. Inline confirmation explains cost, scope and separate
  Review/Apply. The confirmed job and Queue revision reach the atomic claim
  unchanged; an old confirmation cannot authorize a refreshed revision.
- Queue claims at most that exact job using its existing mutex/CAS, execution
  claim, executor, cancellation and outcome handling. It does not resume or drain
  the Bundle, fall back to another source, or automatically retry the selected job.
- A long-running selected job remains cancellable from Studio. Cancellation reads
  a fresh exact revision and cannot cancel a different job. Reopening Activity
  retains the running/cancelling state.
- Explicit Review/Apply is allowed under user pause, without resuming background
  work. Provider, startup/recovery and commit-acknowledgement gates remain intact.
  User Pause is not cancellation of an explicitly authorized Apply.
- The original user pause survives both Apply commit and acknowledgement. The
  existing commit marker independently blocks execution, acceptance, Resume and
  startup release; it cannot be removed while the journal remains active.
- Runtime rechecks paused selected-execution authority and prevents another
  window accepting a proposal during an active selected run. Existing source,
  evidence, target, transaction and Review checks remain in place.
- No-changes completion refreshes Manifest-bound authority. An ambiguous failure
  requests refresh rather than repeating the model call.
- No prompt, provider setting, upstream-owned core or persisted schema field was
  added or changed. All production edits are in the fork's Knowledge modules.

## Local verification

Observed red phases included missing selected action/admission, forbidden
user-paused processing, rejected selected execution proof and Review acceptance,
lost pause at Apply acknowledgement, missing commit-marker startup attention,
premature acceptance beside a commit marker, and concurrent paused acceptance.
The final race reproduced an accepted proposal where rejection was required.
All these regressions subsequently passed. Missing new APIs also initially
failed TypeScript checks; those are API-contract failures, not executed test cases.

- Queue: **124/124** tests pass, including selected identity, stale/double claims,
  due-time checks, failure/backoff, lifecycle abort and retained user pause.
- Storage/Runtime: **312/312** pass; the final additional concurrency guard then
  passed all **10 affected method-group cases**. The full 312 run predates only
  that final guard; do not describe it as a frozen-source full rerun.
- UI: **7 suites / 239 tests** pass; Activity projection has **43 passing cases**
  in its separate run (overlaps the combined run, not additive).
- Production integration exercises the real parser, executor, private model
  adapter with an in-memory response, no-changes commit and refresh. The selected
  job completes; the unselected job remains byte-equal and user pause survives.
- Reviewed Apply: **27 tests** pass. Startup Gate: **24 tests** pass.
- Gallery: **104 rendered cases** (13 stories, two themes, four widths), no
  renderer/overflow failures; confirmation, pending, cancellation and errors
  verified. Evidence: `.git/acceptance/selected-run-20261005/gallery-results.json`.
- Production build/typecheck, artifact syntax and mobile-load smoke pass. Full
  formatting and lint pass (zero errors, nine retained warnings). Full Obsidian
  review passes, retaining existing warnings and three moderate dependency
  advisories; rejection-fixture errors are expected and not source failures.

This is targeted verification, not a repeat of all repository tests. Additional
final integration and live deployment/replay results are recorded below when
available. No successful semantic inclusion in Wiki/Query is claimed from these
local tests.

Logs are under `/tmp/copilot-selected-*`; tests use deterministic in-memory model
responses, not paid calls. No live Vault operation was performed during repair.

## Delivery and native replay

Final integration: **11 suites / 224 tests** pass, including command/read/delegating
adapters, production composition, reviewed Apply, startup gate, worker lifecycle
and Apply commit. These overlap some method-level results above and are not additive.

Canonical `npm run test:vault` deployed only to the management test copy with the
personal 10 MB override and implicit reload disabled. Build tag:
`9bd7be64-dirty-05833c0a6c5f`; `main.js` is 6,483,582 bytes, SHA-256
`773880334ed88f6ec084a11216dd1c59b86e8ae02c5cd587a24628dfdfbf82df`.
The deployment exited zero but its esbuild service printed a shutdown deadlock
after artifact copying began. This warning is retained, not called a clean log:
local/deployed hashes match, artifact syntax and mobile-load smoke pass, and the
explicit guarded reload creates a new ready Studio instance with selected-run
capability. No development server was run.

The fresh receipt continues the unused October 5 allowance, not another three
requests. It begins unarmed. Startup re-observation changed only `inputRevision`
(+1) and `updatedAt` on each of the four pending jobs; no job executed, and all
six historical jobs and the original user pause remain unchanged. Selected-run
isolation is measured from the settled post-reload baseline; the pre-deployment
snapshot remains available separately. Replay results follow below.

### Native outcome

- Native Activity confirmation and running feedback are visible. While the model
  runs, Resume and other material actions are disabled; Cancel for the selected
  material remains enabled. No cancellation is triggered in this paid replay.
- One analysis and one generation request reach DeepSeek, both HTTP 200. No
  retry, Bundle Resume, Query, Save, Review acceptance or Apply occurs. Final
  receipt is `closed_no_changes`, **2/3 used**, zero blocked HTTP attempts.
- The selected job completes at attempt 1/input revision 20 with
  `all_targets_unchanged`, `explicitUnchanged=0`, `identicalWrites=1`. The native
  result correctly says **No Wiki changes**, not that the supplement was included.
- The other three jobs remain pending at attempt zero. After generation refresh,
  only their observation revision and timestamp advance (+1); cleanup reload
  advances those metadata fields once more. None executes, is cancelled, or is
  removed. This is processing isolation, not a claim that background observation
  metadata remains byte-identical through generation refresh/reload.
- There is no proposal to review: the existing Wiki hash is still
  `d9c76d5429195f645357753be34a17914a278d0745b9dbc21e50f96676533303`.
  Its accepted source authority still refers to the old source hash. No third
  model request is spent querying that unchanged, stale-citation page.
- Cleanup restores native fetch, removes the request guard and completes an idle
  reload. Studio is ready, Query idle, seven completed/three queued/zero failed,
  no pending Review, rerun, Apply marker or active transaction. Original user
  pause and timestamp survive. Final runtime revision: 400.
  Final runtime SHA-256:
  `43a0adc60833fa2c95f4753e46849301c700f4d4d7d81de33ec76aa8c9f4fb39`.

The strict replay guard deliberately reports metadata drift after generation
refresh. Independent inspection confirms only the exact revision/timestamp
changes described above. A cleanup-only path validates these changes without
resetting the paid allowance, replacing the execution baseline or arming Query.
The first pre-arm file comparison also exposed Windows/WSL symlink target text
differences; normalizing that comparison resolved it without changing any link
or making a model request.

### Evidence selection and preservation

An in-memory reconstruction using the production evidence builder reproduces all
29 stored quote hashes in order. The added heading (`evidence-0028`, quote hash
`fac0e32e3d384eceb770ace90cf18f07b029fc8334e8642fe17ab85a12e45ed8`)
and its 159-character body (`evidence-0029`, quote hash
`4c133f7f2cb223fe697e4a4da8a71e207493151249465f4d775efc3ee2859bd9`)
are present, but each has **zero supporting-claim and target-claim selections**.
Six of the 29 evidence items were selected by analysis. This narrows the failure
to analysis not selecting the extension; it does not establish why the model
made that choice or that generation alone omitted it.

All 226 file/link entries match the settled post-reload snapshot; all 92 settings,
six original terminal jobs, old Review/Apply records and unrelated Manifest entries
remain unchanged. Compared with pre-deployment, only the public model-catalog
cache changed; all 225 other file/link entries are preserved. No notes or history
were deleted, and no prompts, Rules or model configuration were changed.

Snapshots are under `.git/acceptance/reading-regression-20261003/selected-*.json`;
replay helpers under `.git/acceptance/selected-run-20261005/replay/`. Content-free
paid metrics are recorded as `EXP-20261005-003` and `EXP-20261005-004`.

**Selected-material repair passes local and native isolation verification.**
The separate Wiki/Query semantic-inclusion acceptance still fails. User-paused
Review/Apply has local regression coverage only; this no-changes replay cannot
claim live Apply coverage. No commit/push or full repository test rerun occurred.

## Read-only contract follow-up

The user's subsequent continuation authorized further investigation, not changing
prompt policy or making additional paid calls. Two independent code traces find
no demonstrated transport truncation or compiler filtering defect. Both analysis
and generation requests retain all input evidence; analysis normalization maps
all emitted claims and valid citations. Invalid references and size overflows
fail rather than silently discard content. The provider requires a normal
`finish_reason=stop`, observed for both paid responses; 1,474 and 704 completion
tokens are below the configured 6,000 maximum.

A synthetic offline probe sends 29 paragraphs through the production input
builder, compiler and both prompt encoders. All 29, including the final reader
extension, survive unchanged in both encoded stages. A fake analysis choosing
only an earlier supported claim reproduces identical-write/no-changes with tail
coverage 0/0. This verifies the boundary, not actual model reasoning or semantic
quality. It uses no provider and reads/writes no Vault data. Command:
`node .git/acceptance/selected-run-20261005/replay/offline-evidence-boundary.cjs`.

Four existing suites / **70 tests** also pass: production input, no-changes
coverage, prompt encoder and private DeepSeek transport. Log:
`/tmp/copilot-omission-contract-20261005.log`. No production code changed in this
follow-up; the earlier dirty implementation is preserved.

The current generation policy permits only supported analysis claims. The test
Rules distinguish quotation, personal interpretation and inference, but do not
explicitly require retention of new labelled personal interpretations. Existing
Wiki content already contains attributed later interpretation, so that content
type is not categorically forbidden. The smaller proposed next step is an
explicitly authorized Rules clarification, not weakening grounding checks or
requiring every heading/paragraph to become a claim. No Rules edit occurred.

Coverage counts supporting citations and supported target claims, not all
context/contradiction mentions. A 0/0 entry is not proof the model never saw or
considered the text. Its exact reason for exclusion remains unknown because raw
model response prose was not retained. The context-engineering assessment guided
this distinction between intact data boundaries and an underspecified retention
policy; no speculative code or automatic retry was added.
