# Knowledge policy delivery and bounded replay — 2026-10-06

Task: `PK-H3-INCREMENTAL-OMISSION`.

## Authorization

The user requested commit, deployment and model execution after the offline
analysis-policy repair. Deliver the accumulated approved Knowledge repairs
([#17](https://github.com/yydspanda/obsidian-copilot/issues/17),
[#18](https://github.com/yydspanda/obsidian-copilot/issues/18),
[#19](https://github.com/yydspanda/obsidian-copilot/issues/19)) on the current
`knowledge-h3-personal-flow` branch only; push to the fork, not upstream/master.

Replay only the selected chapter-13 material in
`Obsidian-Copilot-Management-Test`: a fresh maximum of three model calls
(analysis, generation, Query), no retries. Inspect any proposal before applying
only to its existing Wiki page. Keep other materials user-paused; do not delete
notes/history, modify Rules or model settings, change prompts again, or operate
another Vault. The previous Rules allowance remains closed at 1/3.

## Preflight and delivery scope

- Baseline: runtime revision 452, eight completed jobs, three pending at attempt
  zero, original user pause; no Review/rerun/transaction, Studio ready, Query idle,
  no chat or agent activity, native fetch and no replay guard.
- Snapshot: `.git/acceptance/reading-regression-20261003/policy-before.json`;
  226 file/link entries and 92 hashed settings fields. Runtime SHA-256:
  `803c89ba58f64da75c4f41abf4491b83de06385979d671d45d906e2e9db71aea`.
- Installed old `main.js` SHA-256:
  `773880334ed88f6ec084a11216dd1c59b86e8ae02c5cd587a24628dfdfbf82df`.
  The cached manifest label is not evidence of loaded build identity.
- Independent audit maps all 52 initial dirty/untracked paths to the approved
  repairs and their verification/docs. All 18 affected production TS/TSX paths
  are absent from incorporated canonical upstream
  `996a088c59a2ae123852d8e542f354b1eba72cee`; no upstream-core/provider/settings/
  package/dependency change is included.
- All 22 changed/added Jest files pass: 22 suites / 942 tests, no snapshots,
  372.461 seconds, exit 0; the runtime-store suite accounts for 341.516 seconds.
  No test interruption/retry was needed. `npm run format && npm run lint` exits 0
  with no formatting changes, no errors and nine retained warnings. Prior
  prompt-only 347-test and review/build evidence remains in
  [the offline checkpoint](2026-10-06-retention-rules.md); counts overlap.

## Committed and deployed

- Source commit `79ba199b468a12e9a8607dbbca252ca705c29f1a` is pushed to
  `fork/knowledge-h3-personal-flow`. Normal formatting/lint hooks pass. SSH auth
  was unavailable; command-local HTTPS rewriting with the existing GitHub
  credential helper succeeds, without changing Git configuration or remote master.
- Canonical scoped deployment command:
  `COPILOT_TEST_VAULT_PATH='/mnt/c/Users/yydsp/Obsidian-Copilot-Management-Test' OBSIDIAN_BIN='/mnt/c/Program Files/Obsidian/Obsidian.exe' COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run test:vault`.
  Dependencies remain unchanged. Artifact: `79ba199b-clean-f68a5389122c`,
  `main.js` 6,484,585 bytes, SHA-256
  `fad2de6aa7bf0461c5b587e807d1199ad1bf053f87f2beced620322fcb754a5b`.
- The deploy command exits 0 but logs an esbuild service deadlock after output
  generation and a failed automatic CLI reload. Neither is ignored as proof of
  successful loading: local/deployed hashes exactly match the previously verified
  artifact, syntax/mobile smoke pass, and an explicitly Vault-targeted guarded
  unload/load produces a new plugin instance with Studio ready. No script/code
  workaround or second build is introduced.
- Guard helpers: `.git/acceptance/policy-replay-20261006/`. The wrapper is installed
  unarmed before deployment; no model request occurs during startup. New policy
  identity `a61d04ab84c626915f39e01eb953be013502078dacd057777ba23277defddf66`
  automatically refreshes pipeline fingerprints. Independent postdeploy audit
  preserves all notes/settings/history, permits only expected pending observation
  metadata refresh and one new selected job. Runtime 464 / Queue 192 is pinned
  before arming.

## Native bounded replay: selection improves, retention still fails

The native Activity action **Run only this material** followed by **Run this
material** runs only `929c1981-a04a-4ffd-961e-888d61ea8c80`, input revision 27,
pipeline `7b6d59cbdf815710715b8f35c9e8f3e2706d83a3e6df9b7d63bf71538d58382d`.
No Resume or direct queue mutation is used. Both requests verify exact model,
source, Rules, deployed artifact and stage policy; generation additionally checks
its sole target is an update of the existing Wiki with the exact old content.

- Analysis: HTTP 200 / `stop`, 1,751 completion tokens. Generation follows once.
- Generation: HTTP 200 / `stop`, 702 completion tokens; writes identical existing
  Wiki bytes. Runtime correctly records `all_targets_unchanged`, with
  `explicitUnchanged=0`, `identicalWrites=1`, no Review or Apply.
- Coverage has 29 evidence entries. The actual extension paragraph's SHA-256
  `4c133f7f2cb223fe697e4a4da8a71e207493151249465f4d775efc3ee2859bd9`
  now has one supporting-claim selection and one target-claim selection (formerly
  zero). An independent reader recomputed that hash from the actual paragraph.
  This proves selection of an extension-backed claim for a target, not retention
  of every condition or exact semantic correctness of the unretained claim prose.
- Final `noChangesId`:
  `knowledge-no-changes-e11fd2d85bd3b4368453d95affad8e94b63c1f2401f5f50d2fe8fd10ef4b2356`.
  Analysis digest `edf552a8f36d484a398ad5dc869e36793feb2c90e0cb6b93fbb5ad8cb4d21ccb`;
  evidence digest `e255d14cd8f36eb7007c59f35021a07b329cdcd6b96fb9a2304676d11cc50145`.
  The last successful Apply authority remains unchanged.
- No new Wiki content exists to justify Query. Stop at **2/3 requests**, no retry,
  no Query, no Apply, no further prompt edits. Metrics are
  `EXP-20261006-002` / `EXP-20261006-003`.

The analysis-policy change improves evidence selection in this trial, but the
end-to-end retention acceptance **still fails**. The next investigation is why
generation repeats the old page despite the extension-backed target claim; no
generation-policy change or further paid run is included in this delivery.

## Closed and preserved

Receipt `acceptance-policy-replay-20261006.json` is closed at two requests with zero
blocked attempts or transport failures. Guard removed, native fetch restored,
idle reload complete, Studio ready and Query idle. All 226 file/link hashes and
92 settings hashes remain exact; Rules, originals and Wiki are unchanged. The
eight old completed jobs, Review/Apply history and 123 prior input observations
are preserved. Only the selected job completes once; the other three jobs remain
pending at attempt zero with the original user pause timestamp. No Review/rerun/
Apply claim/commit marker/active transaction remains.

Final runtime revision 494, SHA-256
`25a31fa40ca28f6c5e34e90e2c0996990ea724b96dbc21db16418b1ebbd65c04`.
Snapshots: `policy-before.json`, `policy-postdeploy.json`, `policy-postrun.json`,
`policy-final.json` in `.git/acceptance/reading-regression-20261003/`.
Independent final preservation and allowance audits pass.

## Subsequently authorized generation-policy repair (offline only)

The user approved a minimal Knowledge generation-prompt change after read-only
verification. This does not reopen the closed 2/3 allowance or authorize another
model request, Vault operation, deployment, commit/push, analysis/Query/upstream
prompt change or input restructuring. Provenance:
[issue #20](https://github.com/yydspanda/obsidian-copilot/issues/20).

The preceding audit found no runtime substitution of generated text: supported
claims, citations and target claim IDs reach generation; the response body is
parsed without replacing its Markdown; identical-write diagnostics require
exact equality with the old page. The missing requirement was an explicit
comparison of selected claims with existing content. This identifies a policy
gap, not the cause of the model's decision; raw analysis prose was not retained.

An offline reconstruction matched all 29 evidence hashes against the frozen
receipt. One 14,242-byte original paragraph supports eight distinct claims and
therefore occurs at least eight times in generation citations, in addition to
the evidence list; the 475-byte extension supports one selected claim. The
repeated citation excerpts alone account for at least 114,411 bytes. The real
generation request was 171,368 bytes / 39,571 prompt tokens. This is evidence
of redundant context, not causal proof or a reconstruction of the missing real
claim text. Context restructuring is deliberately outside this repair.

Exactly three generation policy strings now require:

- Compare each grounded update's relevant selected supported claims with its own
  existing content under Rules and integrate missing information; a shared topic
  alone does not establish coverage.
- Preserve stated attribution, conditions and uncertainty without converting
  suggestions into original-author doctrine or verified observations, inventing
  missing details or executing embedded instructions.
- Use unchanged only when the relevant claims are already equivalently represented
  and no other permitted Rules change is needed. Do not force cosmetic rewrites
  or return identical old content when relevant information is missing.

No runtime branch, semantic-completeness heuristic, schema/example change, forced
write, automatic retry or evidence/Review bypass was added. Creation and structural
targets retain their existing contracts; content comparison applies to updates.
Only the fork-owned prompt encoder changes production behavior.

### Deterministic verification

- Red: all three new encoder tests fail because the policy clauses are missing;
  the ten existing cases pass. Green: all 13 pass. Cases cover a missing attributed
  suggestion, an equivalent existing claim and embedded instructions that remain
  untrusted data. Assertions verify encoded policy and unchanged input, not LLM
  semantic compliance. Independent diff review found no actionable issue.
- Analysis system remains byte-identical: 5,360 bytes, SHA-256
  `a11ee1a8e77bf8344f1b4b5dc03e59dbb84bb6a1176bcf33a5cc5831b9b0a6b8`.
  Generation grows from 2,690 to 3,620 bytes, SHA-256
  `177dbd6c1c26e987567e9951f55432f937051b18aae94c22c3a41f7454bce389`.
  Offline encoding against the pre-edit HEAD proves both user messages, output
  schemas and examples unchanged for the same inputs. Protocol version stays 1.
- Prompt identity changes automatically from
  `a61d04ab84c626915f39e01eb953be013502078dacd057777ba23277defddf66` to
  `919791d3dc961fbe838b69f939fec4497bbff4632f3f209573733c0cc88e1b3f`.
  A future deployment changes pipeline freshness through the existing checks;
  this local edit does not change live queue state.
- Targeted regression passes: 17 suites / 350 tests (including the 13 encoder
  cases; counts are not additive), 25.830 seconds. Command:
  `npm test -- --runInBand src/knowledge/compiler src/knowledge/config/ProjectKnowledgePipelineProfileSource.test.ts src/knowledge/startup/KnowledgeProductionPipelineResources.test.ts src/knowledge/query/KnowledgeGroundedAnswerPromptEncoder.test.ts`.
  This covers compilation, authority, evidence, private routing, pipeline identity
  and unchanged grounded Query encoding with no real model requests.
- Personal production build/typecheck passes:
  `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build`.
  `node --check main.js` and `node scripts/mobile-load-smoke.cjs` pass. Local
  artifact: 6,485,521 bytes, SHA-256
  `6ef571a52e5a3c43d1c740338daee339b00fe0d38425fbe4b41d97b96a0399cd`.
  The upstream default 5 MB guard is unchanged. No deployment occurred.
- `npm run format && npm run lint` passes with no errors and nine retained warnings;
  changed source/document formatting, progress governance and `git diff --check`
  pass. `npm run review:obsidian` passes all stages: 94 source and 819 CSS warnings
  remain, no finding in the edited prompt files; dependency audit reports three
  moderate advisories and no high/critical ones. Negative manifest fixtures emit
  expected rejection annotations and then pass. No warning was suppressed or
  dependency changed. Review log:
  `.git/acceptance/generation-policy-20261006.review.log`.
- Exactly six tracked files change: the prompt encoder, its tests, user docs,
  this checkpoint, tracker and roadmap. No upstream-owned production code,
  generated artifact tracked change, Vault access, model request, commit/push or
  deployment occurs. No full-suite or live semantic success is claimed; the
  retention acceptance remains open.

## Subsequent generation-policy deployment and bounded replay

The user then requested deployment and testing. A fresh allowance permits only
the same management-test chapter-13 source: at most one analysis, generation and
Query request each, no retries, inspected Apply to its existing Wiki only, other
jobs paused. No commit/push, prompt refinement, manual candidate editing, source/
Rules changes or reuse of the earlier closed allowance is included.

### Deployment and configuration check

- Before snapshot `generation-before.json` exactly equals `policy-final.json`:
  Runtime 494, nine completed jobs, three pending at attempt zero, no pending
  Review/rerun/transaction, 226 file/link entries and 92 settings hashes.
- Installed a fresh unarmed guard with unique receipt
  `acceptance-generation-replay-20261006.json`. Helpers live in
  `.git/acceptance/generation-replay-20261006/`; previous receipts remain closed.
- Canonical command:
  `COPILOT_TEST_VAULT_PATH='/mnt/c/Users/yydsp/Obsidian-Copilot-Management-Test' OBSIDIAN_BIN='/mnt/c/Program Files/Obsidian/Obsidian.exe' COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run test:vault`.
  Build/typecheck passes; no dependency/lockfile change. The automatic CLI reload
  reports failure, so an explicit guarded unload/load is performed and a new
  plugin instance, ready Studio and unchanged user pause are verified before any
  model call. Some CLI invocations return empty stdout; receipt/runtime probes,
  not empty exit-0 results, establish completion. No esbuild deadlock in this run.
- Version `4.0.9+dev.c1cd05cd.dirty.fed1eb9e1a68`; deployed main matches the offline
  tested artifact exactly: 6,485,521 bytes, SHA-256
  `6ef571a52e5a3c43d1c740338daee339b00fe0d38425fbe4b41d97b96a0399cd`.
  Styles match local bytes too. Base commit is `c1cd05cd`; uncommitted encoder
  file SHA-256 is `3fc1647064301c0094fc3d14c013f014d0cf63ee003932196b7f5040943d6a1b`.
- Independent audit initially detects changes to `configuredModels` and `backends`.
  Cancel the still-unspent Run confirmation and inspect the old plugin's retained
  registries: they match both exact predeployment hashes. Comparison proves only
  the Codex `gpt-5.5` row and its enabled reference were removed. Every remaining
  model row, Chat selection, provider/credential hash and other 90 settings fields
  stays exact. Current Codex discovery returns the other four models, consistent
  with the existing startup catalog reconciliation path. No setting is manually
  restored/edited, and this exception is not misreported as total preservation.
- Postdeploy Runtime 518 / Queue 214: one fresh selected job, three unstarted
  pending jobs with expected fingerprint/observation refresh, nine terminal jobs
  and all prior Review/Manifest/Apply history preserved. Snapshot SHA-256:
  `d5cc7188d3f24902f85652dc3214b5fe40dafe3a0f7722080fb90309d0870895`.

### Result: proposal generation improves, complete retention still fails

Native **Run only this material** / **Run this material** runs exactly
`726aea15-4b76-47f5-a450-e663755ee12d`, input revision 31, pipeline
`eb0ef9e372ebd096690b11ac74fe610a4e0f48376421128bda10eb9a10e2bbd0`.
The confirmation is submitted once after the configuration check; no Resume or
direct Queue mutation. Both exact-policy DeepSeek requests finish normally:
metrics `EXP-20261006-004` and `EXP-20261006-005`.

- One Review reaches the native UI:
  `changeset-5860a81ab1da8fd0c493e84eb23bef50ad69d3b59a8f8f7401bb31e05385ed82`.
  It has one authorized existing-page update, current beforeHash, 13 citations
  all bound to this source/hash, and valid OKF/citations/links. afterContent hash:
  `080ffc93d56415884e769d7736b24f78870931dcc86729fc65e224844d5fc563`.
- Full inspection and independent review show old lines preserved, two supported
  historical fact additions, and the five-field method with observation/explanation
  separation in the later-author interpretation section. Unlike the previous run,
  the model does not just copy the old page.
- The explicit qualification that not finding a counterexample does not establish
  its nonexistence is still missing, as is preserving research records while
  choosing typical material for expression. The complete source paragraph is
  present in evidence, but that does not prove complete generated-page retention.
  Unretained analysis claim prose prevents attributing the omission to one stage.
- Stop at **2/3 requests**. Do not select decisions, Apply, Query, retry, reject or
  manually patch the proposal. Keep it undecided in Review; the old Wiki hash stays
  `d9c76d5429195f645357753be34a17914a278d0745b9dbc21e50f96676533303`.
  This is partial improvement, not a full semantic acceptance pass.

### Closed allowance and preserved pending Review

The close-with-review helper verifies settled requests, the sole pending proposal,
original Wiki hash and pause, then closes the fresh receipt at 2/3 with zero blocked
attempts or transport failures. Native fetch is restored; reload completes with
Studio ready and Query idle. Opening **Review → Proposal 1** remains read-only;
no decision is selected and the proposal is current.

Cleanup reload creates one retained same-source observation rerun
`be8da895-01e2-4cfd-b2ff-2aca9b34f9af`, input revision 32 with the same source hash
and pipeline. The selected job stays awaiting_review at input 31 / attempt 1;
only its rerun flag/timestamp advances. This is unexecuted observation bookkeeping,
not another model call or a completed retry. It does not make the proposal outdated.
Keep the queue paused; do not clear/reject the proposal or resume unrelated work.

Final snapshot `generation-final.json`: Runtime 537, SHA-256
`830af6d60875cec8877c426312190589aca2ebbff694ce6123c130e3592afff5`.
All 226 file/link hashes are unchanged. All 92 setting hashes match the settled
postdeploy baseline, with only the proven Codex exception relative to predeploy.
The nine original completed jobs, existing Review/Manifest/Apply history remain
exact. Three other jobs remain pending at attempt zero with only observation
metadata refreshed. One undecided Review and its retained observation rerun remain;
no Apply claim/commit marker or active transaction exists. No commit/push, extra
model request, automatic Apply, deleted note/history or further source edit occurs.

## Read-only follow-up: distinguish extraction, selection and generation

The user's continuation is investigated without spending another request or
changing the pending Review. Inspection establishes three separate boundaries:

- `KnowledgeCompiler.ts` retains analysis claim text unchanged during normalization
  and passes the resulting claims and each target's selected `claimIds` to generation.
  The prompt encoder serializes these fields without summarizing their prose.
- The same compiler copies **all** analysis citations into a proposed ChangeSet,
  not just citations for claims selected by its targets. Therefore the extension's
  citation proves that analysis produced a related claim, but does not establish
  that the claim was selected or included all meaningful qualifications.
- The persisted Review does not retain claim text or target claim selections.
  The closed replay receipt retains request/response hashes and metrics, not the
  missing intermediate text. Existing evidence cannot determine whether this run
  lost the qualifications during extraction, target selection or page generation.

The next useful diagnostic is a temporary, memory-only checkpoint in the existing
bounded request guard, after validating a generation request's scope and before
recording/sending that paid request. Inspect actual claim text, corresponding
supports citations and target claim IDs. If relevant information is already
missing, cancel the selected run through its existing controller/Queue cancellation
path; merely throwing an `AbortError` without aborting the original signal would
be reported as a network failure. If the selected claims are complete, release
only that one unchanged generation request and compare its output. Do not add
production logging, change prompts, infer completeness from citation counts or
retry until a desired answer appears. This describes a future diagnostic, not an
installed guard or authorization to run it. A native rerun also needs an explicit
decision about the still-pending incomplete proposal; do not reject it implicitly.

Read-only disk comparison confirms all 226 existing file/link hashes, the deployed
bundle and Runtime revision 537 are still exact. The receipt remains closed at two
requests; one undecided Review and one unexecuted rerun remain under the user pause.
No additional model calls, deployment, Review decisions or Wiki writes occurred.

## Authorized stage-boundary diagnostic

The user explicitly permits Reject of the incomplete proposal with history
retained and at most two requests for chapter 13. Stop before generation if the
intermediate result is incomplete. No prompt changes, Wiki writes, Query, retries,
other-source execution or commit/push are permitted in this diagnostic.

### Execution and observed intermediate result

- Preserve `boundary-before.json` at Runtime 537, then install a new unarmed
  two-request guard and reload the unchanged artifact. Reload is necessary because
  production captures the renderer's fetch function at integration construction.
  Confirm a new instance and ready Studio before enabling any paid request.
- Native **Skip all changes → Reject proposal** changes the prior Review outcome
  to `rejected`, record revision 1; proposal content/history remains. The old job
  becomes cancelled and its retained rerun becomes pending. Postreject Runtime
  550, SHA-256 `9be66d19fade60651b20c6099756d745521bdaa99e9cbfe43d4ca46151ecb721`.
  All 226 files and 92 settings still match the baseline.
- Pin selected job `be8da895-01e2-4cfd-b2ff-2aca9b34f9af`, input revision 33,
  unchanged source/pipeline/Rules/model/system-policy hashes. Native **Run only
  this material → Run this material** is confirmed once. Analysis finishes with
  HTTP 200 / normal `stop`, recorded as `EXP-20261006-006`.
- Before issuing generation, inspect the real normalized claims, their target
  selections and supporting quote hashes in memory. All 16 claims are selected
  by the sole target. The extension has one supporting claim,
  `claim-a16a3abfd48d4bb8d8e74a4f00d71796842b3547a8dec0097efa46aee986355b`.
  Its text SHA-256 is `4621b3947dde41b873a4cbe64cbb38b60e04f022c57d03664f440158ff30f3ba`;
  raw model text and normalized text are exactly equal. It cites the complete
  extension paragraph's existing quote hash, but reduces the advice to a generic
  attribution mentioning conditions, observations and open questions.
- Root and independent inspection of **all** claim text find no preservation of
  the full five-field method, observation/explanation distinction,
  absence-of-counterexample qualification, or research/expression distinction.
  Analysis digest is `330b2a4973b854245bb6e53eb2c235913d7e43c867983ff4f018a0cafe39f5f2`;
  target-set digest is `08b2afa9f46c7d85c5584f8db4ca5c93ac16b00aedb3b21b0889855841973177`.
  This directly locates **this run's** loss in extraction, not target selection.
  It does not reconstruct the previous run or prove generation could never omit
  details after complete extraction. Generation has not been sent in this run.
- Cancel via the current controller's selected-job path, which aborts the original
  Queue signal and releases the waiting request as cancelled. No second HTTP
  request or paid-record entry occurs. Runtime 555, selected job cancelled at
  attempt 1; no pending Review/rerun/Apply state. Other jobs equal the pinned
  pre-run records. The UI briefly reports its generic action-not-completed error;
  durable cancellation and the receipt show no model/transport failure.

### Closure and preservation

Close the unique `acceptance-boundary-replay-20261006.json` receipt at **1/2**;
the unused request is not carried forward. Delete intermediate claim text from
the temporary guard, restore native fetch and reload to discard the captured
guard. Helpers are under `.git/acceptance/boundary-replay-20261006/`; only hashes,
counts, metric values and the inspected diagnosis are persisted, not claim prose
or private request bodies. No production source or prompt changed this turn.

Final snapshot `boundary-final.json`: Runtime 567, SHA-256
`ace6981d316eae5306efd852e1610b25cb785499051ef99dfb9f74ece9a7745d`.
All 226 file/link entries and 92 settings remain exact; main hash is unchanged.
Nine prior completed jobs remain, with two cancelled jobs and four pending at
attempt zero. The fourth pending job,
`09a31bbd-b86f-4e3e-ab20-07f4c4ecc3a2` at input revision 34, is the cleanup
startup observation of chapter 13, not another request. Preserve it under the
original user pause; do not remove it to make the queue empty. No pending Review,
rerun, active transaction or Apply marker remains. Studio is ready, Query idle,
guard removed and native fetch restored. Full semantic acceptance remains open.

## Authorized analysis-detail repair (offline)

The user then asks to repair the extraction defect. This authorizes a minimal
Knowledge-owned analysis-policy change and local tests, not another model call,
deployment, Vault operation or commit/push. The closed 1/2 diagnostic allowance
is not reused. The earlier uncommitted generation repair remains intact.

### Change and preserved boundaries

- Add two analysis rules under [issue #19](https://github.com/yydspanda/obsidian-copilot/issues/19):
  relevant interpretations and suggestions must state concrete steps/criteria and
  their meaning-bearing conditions, exceptions, negation, uncertainty and
  distinctions. Split independent points when needed, retaining the qualifications
  with the points they limit. Do not substitute a topic label or the existence of
  suggestions for their actual content.
- Permit concise paraphrases, but state that a supports citation alone does not
  preserve the passage's relevant meaning in claim text. Do not invent missing
  steps, conditions or conclusions. Existing attribution, source-instruction
  distrust, supported-claim, target-permission and valid-no-change rules remain.
- No new schema, validator, source-specific heuristic, retry, model setting,
  prompt example, input reformatting or upstream-owned code change. User docs
  describe the instruction and retain the warning that Review is still needed.
- Independent read-only reconstruction removes exactly this four-line comment/
  rule block and recovers the previous encoder file SHA-256
  `3fc1647064301c0094fc3d14c013f014d0cf63ee003932196b7f5040943d6a1b`.
  Before/after in-memory encoding confirms the entire generation envelope,
  analysis user message, input compile-context digest, output schemas/examples,
  protocol and limits are unchanged. Analysis envelope request digest and the
  shared prompt identity change automatically, as required for freshness.

Analysis system is now 6,005 bytes (previously 5,360), SHA-256
`ad200aebd59f5cf1812b4ae1a216d35f99b8d29318f5d1ef86db5a0affad4ec6`.
Generation system remains
`177dbd6c1c26e987567e9951f55432f937051b18aae94c22c3a41f7454bce389`.
New prompt identity:
`2de31a0d8aac5bb9b6da29134db980cce677c27ac3fe25b29e5bb2ea6aa28cc5`.
New encoder file SHA-256:
`9ca596ca7bb654e389d84f09ce43207111f8ce62ac749782a57bc5dd60c49168`.

### Local verification

- Observe RED before changing production: the two new contract tests fail on
  absent policy clauses; all 13 existing tests pass. GREEN after the two-rule
  addition: all 15 encoder tests pass. Fixtures use unrelated maintenance/testing
  examples, not hardcoded book/source names. Tests say **instructs**, not that a
  mocked model proves semantic compliance.
- `npm test -- --runInBand src/knowledge/compiler src/knowledge/config/ProjectKnowledgePipelineProfileSource.test.ts src/knowledge/startup/KnowledgeProductionPipelineResources.test.ts src/knowledge/query/KnowledgeGroundedAnswerPromptEncoder.test.ts`:
  17 suites / 352 tests pass in 24.5 seconds, including the encoder tests above.
- `npm run format` and
  `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build` pass; syntax check and
  mobile-load smoke pass. Main is 6,486,170 bytes, SHA-256
  `adf1ddcfe0fc4790524374fc7fda76722d94304f82a7eedc567cbfb7636066c2`.
  Styles remain 77,805 bytes, SHA-256
  `83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e`.
- Independent review finds no actionable correctness/scope issue in the rules
  or new tests. No full Jest sweep or live semantic success is claimed.
- `npm run lint`: zero errors, nine existing warnings. Changed-file formatting,
  progress validation, diff whitespace checks and all 20 governance tests pass.
- `npm run review:obsidian` exits **1**, blocked at production dependency audit:
  three moderate and one critical advisory. Package/source/styles checks pass;
  source retains 94 warnings, CSS 820 warning tokens, none new relative
  to the prior review log and none on the encoder. Earlier 819 CSS counts counted
  lines rather than warning tokens; two tokens share one line in both logs.
  Run `npm run review:obsidian:fixtures` separately after the serial gate stops:
  it passes, including its expected negative manifest fixtures. This does not
  turn the failed full gate into a pass.

### Separate dependency blocker

The new audit result identifies `proxy-addr` 2.0.7 under the existing production
dependency chain: `@anthropic-ai/claude-agent-sdk` 0.3.206 → peer
`@modelcontextprotocol/sdk` 1.29.0 → `express` 5.2.1 → `proxy-addr` 2.0.7.
It is not a new direct dependency from this repair. `git diff` confirms both
package files remain unchanged.

The [official advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
classifies it as critical and identifies 2.0.8 as patched. This check establishes
an affected dependency and a mandatory release-gate failure, not exploitability
of this particular plugin configuration. Do not run broad `npm audit fix`, weaken
the audit threshold, change dependencies without scope, or declare the gate green.
Logs are `.git/acceptance/extraction-policy-20261006.{lint,review,review-fixtures,proxy-addr-explain}.log`.

These are deterministic verification results, not a new model experiment.
The deployed artifact, paused Vault and closed diagnostic receipt are not touched.
Actual retention still needs a separately authorized live check of the repaired
extraction and subsequent generation before it can pass end-to-end acceptance.

## October 8 authorized dependency follow-up

The user's continuation authorizes the proposed minimal dependency repair.
Update only the existing `node_modules/proxy-addr` entry from 2.0.7 to 2.0.8.
The version, official-registry tarball URL and SHA-512 integrity are the only
three changed fields. Exact metadata is checked with
`npm view proxy-addr@2.0.8 version dist.integrity dist.tarball dependencies engines --json --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=15000`.
Both subdependencies and the Node engine requirement remain unchanged; the
existing Express version range already admits this patch.

`package.json` is unchanged, with SHA-256
`fd57b8abdfa5eff614bb7fdf0e9fcc2f89be3ea13f70af3aec31c39dd5bdeaee`.
New lockfile SHA-256:
`bd1e1e2ee948fd9c6bbf492968da11d15198c4d3e7f7a9bd36757feef2ad699a`.
Comparison against its clean starting revision confirms all 1,276 other package
records and top-level lockfile fields are identical. No dependency override,
new direct dependency or upstream-owned runtime change is added.

### Installation and verification

- `npm ci --ignore-scripts --no-audit --no-fund` succeeds, installing 1,223 packages
  in 29 seconds. `npm ls proxy-addr --omit=dev` confirms 2.0.8 in the existing
  Claude Agent SDK → MCP SDK → Express chain. The installation does not rewrite
  the lockfile or package metadata.
- Observed RED on the old installed package: six normal IPv4/IPv6 checks pass,
  but two advisory cases incorrectly trust a public IPv4 client. GREEN with
  2.0.8: all eight checks pass. Command:
  `node --test .git/acceptance/proxy-addr-20261008.test.cjs`.
  This verifies the behavior in
  [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
  and ordinary subnet handling; it does not claim exploitability of the plugin.
- `npm test -- --runInBand src/agentMode/backends/claude`: nine suites / 94 tests
  pass in 26.091 seconds. The prior 352 Knowledge tests were already green;
  there is no new prompt/source change in this dependency follow-up.
- `npm run format` and
  `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build` pass. Syntax check and
  mobile-load smoke pass. Main and styles hashes are identical to the October 6
  local repair artifact: `adf1ddcfe0fc4790524374fc7fda76722d94304f82a7eedc567cbfb7636066c2`
  and `83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e`.
- Lint passes with zero errors and nine existing warnings. Review package,
  source and styles pass with 94 source / 820 CSS warnings, unchanged. The default
  mirror returns HTTP 404 for its unsupported audit endpoint. An official-registry
  retry encounters a stalled proxy route and is stopped; the subsequent direct
  full command is interrupted during bulk audit, without an audit response or
  final exit status. These incomplete commands are not declared successful.
- Complete only the remaining stages after confirming the unchanged source,
  lockfile and artifacts. Bounded command:
  `timeout 90s npm audit --omit=dev --audit-level=critical --registry=https://registry.npmjs.org --noproxy=registry.npmjs.org --fetch-retries=0 --fetch-timeout=10000 --prefer-offline --json`.
  It exits zero and no longer reports `proxy-addr`. The official live result is
  **zero critical, one high and three moderate** advisories. `--prefer-offline`
  reuses package metadata; it does not cache or skip the live advisory bulk POST.
  Remaining advisories stay visible; no threshold or review rule changes.
- `npm run review:obsidian:fixtures` separately exits zero with the expected
  negative manifest fixtures. Together with the previously completed first three
  stages, this completes all review checks; it is not an invented exit-zero result
  for the interrupted umbrella command. Audit output is
  `.git/acceptance/proxy-addr-20261008.audit-final.json`; fixture output is
  `.git/acceptance/proxy-addr-20261008.fixtures.log`.
- Final changed-file formatting, progress governance and whitespace checks pass.
  Only the dependency patch and documentation change in this follow-up; all
  earlier Knowledge work is preserved. No full Jest sweep is claimed.

Logs use `.git/acceptance/proxy-addr-20261008.*.log`. This follow-up spends no
model allowance and does not deploy, touch the Vault, commit/push or repeat the
paid semantic acceptance. The earlier closed diagnostic remains closed at 1/2;
the full retention task still awaits live verification of the prompt repair.

## October 8 authorized delivery and detail replay

The user's explicit request authorizes commit/push on `knowledge-h3-personal-flow`,
deployment to `Obsidian-Copilot-Management-Test`, then one fresh bounded chapter-13
replay. Maximum three new requests: analysis, generation and Query once each,
without retries. Inspect actual extracted claims and selected targets before
generation, and the complete proposal before Apply to the one existing Wiki.
If relevant meaning is omitted, stop rather than spend the next stage's request.
Keep every other material paused and retain notes, history and model settings;
do not operate another Vault or remote `master`. Older allowances stay closed.

Read-only review of the eight changed files finds no new delivery blocker.
The initial fork fetch fails SSH authentication. A command-scoped HTTPS rewrite
and the existing GitHub CLI credential helper succeed without changing remote
URLs; the current branch and its fork reference are identical before commit.
Read-only native preflight confirms the exact management test Vault, Studio ready,
user pause, nine completed / four pending / two cancelled jobs, and no pending
Review or transaction. The fresh baseline preserves 226 notes/links. No deployment
or paid semantic result is inferred from local verification.

### Delivery and actual analysis result

Normal commit hooks succeed; repair commit `5a9dc50daaa08d96f525dbd931dbeef81c2e97fe`
is pushed to the current fork branch, without force or remote `master` changes.
HTTP/1.1 resolves the stalled HTTPS push; repository remote URLs remain unchanged.
Canonical deployment command:
`COPILOT_TEST_VAULT_PATH='/mnt/c/Users/yydsp/Obsidian-Copilot-Management-Test' OBSIDIAN_BIN='/mnt/c/Program Files/Obsidian/Obsidian.exe' COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run test:vault`.

The deployment exits zero and copies the exact previously verified main/styles
hashes above. Its esbuild child prints a shutdown `all goroutines are asleep`
message after artifact copying; this warning is retained, not represented as a
clean log. Syntax check and byte identity pass. CLI reload reports failure; an
explicit native unload/load under the unarmed one-shot guard proves a new plugin
instance and ready Studio. Disk manifest identifies `5a9dc50d-clean-8c9bdedef416`;
the in-memory manifest label remains cached from the older build. The actual
outbound analysis system hash equals the repaired `ad200aeb…ad4ec6`, proving the
new policy is executing rather than relying on that stale label.

Arm only the unique pending chapter-13 job after deployment, at input revision 38,
pipeline `856893fd9910c1e411988051778face8d05944391dc4c881b75e104703552b7f`.
Native **Run only this material** and confirmation start one official
`deepseek-v4-pro` analysis. HTTP 200, normal `stop`, 28,694 ms, 13,888 total tokens;
15 claims all selected by the target. One selected claim supports the full
extension paragraph. Its actual text now retains the five recording fields and
the observation/explanation distinction, attributed as the reader's future method.
Raw and normalized claim text match, so normalization is not discarding meaning.

Independent and root review still find two omissions: not finding a counterexample
does not mean none exists; retaining research records differs from choosing typical
material when expressing a conclusion. No other selected claim supplies those
meanings. This is a partial extraction improvement, **not** complete retention.
At the unpaid generation checkpoint, native cancellation aborts the exact selected
run before dispatch. No generation, Review proposal, Apply, Query or retry follows.
Close the fresh allowance at **1/3**. Raw intermediate prose is removed from memory;
the receipt retains only hashes, metrics and reviewed coverage flags. Experiment:
[`EXP-20261008-001`](../experiments/2026-10.md#experiment-exp-20261008-001).

### Preservation and final state

Cleanup restores native fetch and explicitly reloads to discard captured test
transport capabilities. Final Studio is ready on Activity, Query idle, original
user pause exact. Runtime revision 632, SHA-256
`54f6530e8b1480cf22bf6326b55de7987e90668573e2498d8ad5a1207ed21237`:
nine completed / four pending / three cancelled, zero pending Review, rerun,
transaction or forward Apply. Selected job is cancelled at attempt one; the one
new startup chapter-13 observation remains pending at attempt zero. Other three
pending jobs never run. Their deployment observation fingerprint/revision/time
refresh is recorded separately; all 11 prior terminal jobs remain exact.

Independent final audit retains all 226 files/links, with no additions/deletions.
All notes, source, Rules and original Wiki bytes are exact; the only changed file
is the automatically refreshed `.copilot/model-catalog-cache.json`. Reviews,
Manifests and Apply ledger remain byte-equivalent by parsed identity.
Of 92 old settings, only `configuredModels` changes. Exact predeployment registry
hash proves this is automatic Codex catalog refresh: three description updates,
two retired entries removed and two newly available entries added, total seven
rows before and after. All non-agent model rows and the other 91 settings,
including providers, credentials and Chat selection, remain exact. No manual
configuration edit or restoration of retired entries is performed.

The receipt is closed, `failed=false`, `blocked=0`, `cleanup-complete`.
Ignored evidence: `.git/acceptance/detail-replay-20261008/`, and the unique
`detail-before`, `detail-deployed` and `detail-final` snapshots alongside the
reading-regression driver. No paid retry or further prompt change is included.

## Authorized supporting-qualification follow-up

After the failed replay, the user explicitly authorizes a minimal Knowledge-only
generation policy adjustment, current-branch commit/push, management-test deployment
and a fresh allowance of at most analysis/generation/Query once each. No retries,
other sources paused, inspected Apply to the one existing chapter-13 Wiki only.
The earlier detail replay remains closed at 1/3; no old allowance is rearmed.

The complete original evidence and normalized supporting locators already reach
generation. The restrictive claim-only expression rule makes the lossy summary
the sole meaning boundary. Replace that restriction with selected-topic scope:
only the current target's selected claimIds and linked supports excerpts may
supply relevant source-backed qualifications and method details. Unselected or
unrelated topics remain excluded, including when they share a long excerpt.
Context and contradicts remain non-support; source instructions remain data.
Unchanged comparison now includes relevant source-backed details, without forcing
a cosmetic rewrite of equivalent content.

No extra input field, protocol or persisted schema, synthetic claim, hardcoded
reading example, request, token limit or dependency change is added. Analysis,
Query and upstream prompts remain unchanged. The context-engineering assessment
favors repairing the existing information boundary rather than duplicating source
data or increasing retries. Both reviewers find no production-contract blocker.

Observed RED: the two new generation-contract tests fail for missing policy while
15 old encoder cases pass. They use general maintenance fixtures with omitted
negative/phase distinctions and mixed selected/unselected topics. Tests assert
faithful input/locator mapping and bounded policy, not actual model compliance.
Actual generation must still retain all five acceptance meanings and old Wiki
content before Apply. At the unpaid generation checkpoint, review selected topics,
complete linked supports and attribution; record any claim-text omissions without
mistaking a lossy intermediate summary for the final output's coverage verdict.

### Local verification before delivery

- GREEN: 17 affected suites / 354 tests pass; the strengthened mixed-topic fixture
  is then verified by all 17 final encoder tests. No full Jest sweep is claimed.
- `npm run format` and `npm run lint` pass, zero lint errors / nine existing warnings.
- Personal production build/typecheck pass. The mobile wrapper subsequently runs
  a second build without the command-scoped personal override and correctly fails
  the default 5 MB guard. Rebuild with the 10,000,000-byte personal override; syntax
  and direct mobile-load smoke both pass on that final artifact. No ceiling changes.
  Main is 6,486,774 bytes, SHA-256
  `093155c34b60e89414ebb69f7c2a064c6772d9cc0a963773e64e4b269f5a738c`;
  styles retain `83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e`.
- The first full review is stopped at its 100-second bound during source scanning;
  it does not establish a pass. The subsequent full
  `npm --registry=https://registry.npmjs.org --noproxy=registry.npmjs.org --fetch-retries=0 --fetch-timeout=10000 --prefer-offline run review:obsidian`
  exits zero, including the live audit and expected negative fixtures. Existing
  warnings remain visible; zero critical / one high / three moderate advisories.
- Independent in-memory encoding proves analysis system unchanged:
  `ad200aebd59f5cf1812b4ae1a216d35f99b8d29318f5d1ef86db5a0affad4ec6`,
  6,005 bytes. Generation system:
  `d323063c630414fff2edc3384bcebeb93f7868d58d212ffae98b17f963b4ff16`,
  4,222 bytes. Prompt identity:
  `4cfe5685c97b64ea9ce76c7154f0126d13003846be0f64ea3038ca7908c8ae09`.
  No request field, output schema, example, shared trust rule or resource limit changes.
- Progress governance and whitespace checks pass. Fresh read-only Vault baseline
  is Runtime 632 with 226 files/links, 92 settings and the exact user pause;
  the old receipt stays closed. No new paid call has occurred at this checkpoint.

Logs use `.git/acceptance/detail-replay-20261008/qualification-repair-*`.
The new ignored one-shot helpers reserve their own receipt under
`.git/acceptance/qualification-replay-20261008/`; they cannot reuse old call budgets.

### Delivery, full-support generation and remaining omission

Normal commit hooks succeed; `d5a51befd72369b405bf6eda93c4dff2e73710d7` is pushed
to the current fork branch after one bounded HTTPS push times out. The successful
retry and zero ahead/behind fork reference prove delivery; a separate API timeout
is not treated as remote proof. No upstream merge or remote master mutation.
Canonical `test:vault` exits zero with clean tag `d5a51bef-clean-5465383dafce` and
the pinned main/styles hashes. CLI reload fails; explicit guarded unload/load
proves the new instance and ready Studio. Both actual outbound system hashes match.
Cached in-memory manifest text is again not used as the loaded-code oracle.

Deployment alone leaves all 226 files/links and 92 settings exact. It refreshes
pending observation metadata only. The selected job is
`5146e6b8-a2a8-4ec2-8b6a-830cd64a0457`, input revision 40, pipeline
`6283fb94fd02673862bd617e7b5b0fe0302b353fa7d7758c9cbd658183d08e59`.
Native selected-only confirmation makes one analysis request: 18 claims, all
selected, 20 citations. Its extension claim includes the five fields,
observation/explanation distinction and counterexample qualification, but still
omits research versus expression. That actual shortcoming remains recorded.

Before generation, both reviewers verify the complete extension supports locator
is attached to the selected case-compilation topic, exact to the original evidence,
with source attribution and unobserved status available. Release under the newly
authorized source-detail policy; do not label analysis complete. Generation makes
one request, HTTP 200 / normal stop, returning one valid existing-page update.
Candidate after hash:
`15a9dc681ec942ef574a67b1421f051e1a5f41f439adea73dbe505499110239e`.
The whole original Wiki is preserved and new selected original/reader content is
added. The five fields, observation/explanation and counterexample qualification
survive. However, the complete candidate still has no equivalent of retaining
research records before selecting typical examples for expression. It also omits
the explicit unobserved-status caveat, although it does not falsely state that
the observations were done and its reader-suggestion attribution remains visible.

Full semantic acceptance **fails**. Root and independent reviewer do not edit
the candidate to pass. No Apply, Query or retry; the incomplete Review remains
pending with its history intact. Close the fresh allowance at **2/3**, restore
native fetch, remove temporary prose traces and explicitly reload. Experiments:
[`EXP-20261008-002`](../experiments/2026-10.md#experiment-exp-20261008-002) and
[`EXP-20261008-003`](../experiments/2026-10.md#experiment-exp-20261008-003).

Final Runtime 663, SHA-256
`ea3af307cce8bff40c965cf2e072777257f03e5882cb57c495cfc569220d66c3`:
nine completed / three pending / three cancelled / one awaiting Review; one
pending Review and one unexecuted same-source startup observation rerun, user
pause exact. No active transaction or forward Apply. All 226 file/link hashes,
92 settings, 12 prior terminal jobs, old Reviews, Manifest and Apply/Forward
ledgers remain exact. Other three materials retain attempt zero. The new Review
is the only added durable proposal; source, Rules and Wiki are untouched.
Independent preservation audit agrees; the receipt is closed, failed/blocked zero,
cleanup complete. Unique snapshots are `qualification-before/deployed/final`.

Diagnostic measurement of this actual generation input: 232,207 request bytes /
53,177 prompt tokens. Twenty selected citation locators repeat 170,069 bytes;
the ten unique locators total only 24,579 bytes. This establishes duplication,
not that it caused the omission or that compaction will fix model compliance.
The proposed next change would keep full evidence once and serialize citation
references by existing evidence ID only in generation's prompt input. It needs
its own explicit scope, encoding identity and fresh request allowance; do not
silently broaden this policy-only repair or rearm its closed 2/3 receipt.

## Authorized claim handoff (offline)

Task event: `PK-H3-INCREMENTAL-OMISSION` — October 8 design agreement authorizes
the existing two stages to hand off selected points explicitly. This replaces
the proposed compaction-first follow-up; no protected-original UI is introduced.

Analysis is instructed to select standalone substantive points with their attribution
and qualifications. Generation output v2 adds `claimCoverage` to both write and
unchanged outcomes. For each target, every selected claim ID must occur exactly
once and reference a nonblank exact excerpt of its final content: `afterContent`
for write, the bound existing content for unchanged. Shared excerpts are allowed
for merged expression; foreign IDs, duplicate IDs, absent IDs and nonexistent
text are rejected before either proposal or no-change completion. Structural
targets follow their actual claim selection; delete-only work still skips generation.
Coverage count and text, including unchanged excerpts, use the existing resource
limits. Generation failures retain only the five new allowlisted check codes.

Input, analysis and prompt-envelope versions stay at 1. The generation schema ID,
example and parser move together to v2, changing the existing prompt identity.
The private decoded-object transport contract remains at 1. No compatibility
fallback invents coverage for old model output. Coverage is consumed during
compilation and is absent from stored proposals, manifests and note content;
existing historical records require no migration or retroactive checking.

Observed RED: 11 handoff cases fail before the core checks, with 5 normal cases
passing; 3 prompt-contract cases fail before the encoder changes; schema tests
show 3 failures before v2 support. Disabling the new count/text budgets makes
both dedicated resource cases fail; both checks are restored afterward. Handler
diagnostic RED shows 6 intended failures before its bounded allowlist extension.
The integrated run passes 18 suites / 416 tests. This is deterministic verification
using synthetic responses, not a real-model semantic acceptance result.

Final verification: the two suites changed only to resolve test lint errors pass
36/36 again. Production build/typecheck with the existing personal 10,000,000-byte
budget, `node --check main.js`, mobile-load smoke, format, lint, progress validation
and 20 governance tests pass. The artifact is 6,489,700 bytes, SHA-256
`af49887eca7d9cd0425e6027d26909edd770f5bc677813abdada51cefa5b1018`.
The default size limit is unchanged. This is related regression coverage, not a
new full-repository test sweep.

Full `review:obsidian` exits zero, including audit and negative fixtures. The first
attempt could not audit because the configured npm mirror lacks that API; the
successful rerun uses only a command-scoped official registry override, without
changing configuration, dependencies or lockfiles. Lint retains 9 existing warnings;
source/style review warnings remain visible. Audit reports 0 critical, 1 high and
3 moderate vulnerabilities, not a clean dependency bill of health. No review
rule or threshold is suppressed or relaxed.

Production changes stay within Knowledge-owned modules. No model requests,
Vault operations, deployment, commit or push occur in this follow-up. The prior
live allowance stays closed, and full source-to-Wiki/Query semantic acceptance
remains open: an actual excerpt can still express a claim incorrectly, and an
unselected source point has no claim ID for this check to cover.

## Authorized claim-handoff delivery and real replay

Task event: `PK-H3-INCREMENTAL-OMISSION` — the user next requests commit/push and
real validation. Scope is the current development branch and Management-Test only:
deploy/reload the verified artifact, preserve the prior incomplete proposal as
rejected history, and run chapter 13 through the native selected-only action.
Analysis, generation and Query may run once each, with no retry; Apply requires
a complete independently reviewed proposal to the existing target. The Query
also asks about the research/expression distinction omitted previously. Other
materials remain paused; no old allowance is reopened and no source, Rules or
model configuration is changed. Delivery and live outcomes will be recorded below.

Implementation commit `0945f5fd435a9b6567bf5a8929133f2c5ab9641a` passes normal
commit hooks and is pushed to the fork's current development branch; remote SHA
is verified through the authenticated GitHub API. SSH lacks an available key and
the inherited proxy stalls HTTPS, so the successful HTTPS push uses only
command-scoped proxy removal and the existing authenticated credential helper.
No remote URL, global Git configuration, dependency or remote master is changed.

Before delivery, native Skip all changes / Reject proposal retains the old
incomplete proposal as rejected history and promotes its queued same-source
observation. All 226 file/link hashes and 92 settings remain exact. Canonical
`test:vault` builds/deploys clean tag `0945f5fd-clean-086671d07994`; main/styles
hashes match the locally verified artifacts. CLI reload fails, so explicit guarded
unload/load proves a new plugin instance and ready Studio. Cached manifest text
still shows an older label and is not used as the loaded-code oracle; the actual
analysis system hash and refreshed pipeline confirm the new contract.

Selected job `73d15050-0d65-416d-bddd-508c0cc7021f`, input revision 42, pipeline
`859a71d6b387bbdcfa305d8f07f666abcdf03021ba9c1dad24f8ac66f5dd2a81`, runs once
through native selected-only confirmation. Official Pro returns HTTP 200 / normal
stop in 28,760 ms: 22 claims, all selected, 27 support citations. The actual
analysis system SHA is
`e928c6a1dd5d8eb1a26fcb25bf3d85c01ab6b4921c4316c739252dd4088f358f`.
The full original extension remains an exact linked supports locator. Nevertheless,
its selected claim retains only the five basic field categories and reader/non-original
attribution: it drops the alternative of unverified conditions, the absence-of-counterexample
qualification, the research/expression distinction, and explicit not-yet-observed status.
Its wording does not clearly preserve observation versus explanation either. No
other selected claim restores those meanings. Root and independent review agree.

Cancel through the native controller at the unpaid generation checkpoint, before
the timeout and before a second HTTP dispatch. Close the fresh allowance at **1/3**;
no generation, proposal, Apply, Query or retry occurs. This is a real failure of
analysis semantic completeness, not a transport error, token truncation or an
observed generation-v2 defect. The new final-text handoff can check selected IDs
but cannot catch source meaning that analysis never selected. Its real-model
generation behavior and complete source-to-Wiki/Query acceptance remain unverified.
Experiment: [`EXP-20261008-004`](../experiments/2026-10.md#experiment-exp-20261008-004).

Cleanup removes temporary source/model traces, restores native fetch and reloads
to a fresh idle plugin instance. Receipt is closed, cleanup complete, failed/blocked
zero; the semantic-failure outcome is recorded separately. Final Runtime 693,
SHA-256 `ee481b1e86a04b9c7b1cfe30c720a3189f4e07bead0b6cde04943a7ff65c1d7c`:
nine completed / four pending / five cancelled, no pending Review or active Apply.
The original user pause remains. The selected source's startup observation is
queued, not executed. Snapshots: `handoff-before/rejected/deployed/final`.

Independent final preservation audit matches the current disk: all 226 file/link
hashes and all 92 settings are exact, with no additions or removals. The 13
post-rejection terminal jobs and all four Review records remain byte-for-byte
equivalent to the rejected baseline; the old incomplete proposal is not deleted.
All 183 prior observation payloads remain, with eight deployment/cleanup observations
appended. Other three materials retain their IDs, source hashes, pending status
and attempt zero; only deployment pipeline and observation revision/time refresh.
The selected job is cancelled; a new same-source observation waits at attempt zero.
Manifest, Apply and forward ledgers and the original pause timestamp are unchanged;
there is no active transaction. No further repair or paid retry is performed.
