# Final bounded core-clarity attempt

Task event: `PK-H3-INCREMENTAL-OMISSION`

## User decision and fixed scope

The user requests one final attempt, explicitly preferring a simpler explanation
of events, principles, methodology and core ideas if exhaustive retention is not
reliable. This changes the product criterion; it does not retroactively turn the
[prior incomplete replays](2026-10-06-policy-delivery.md) into passes.

Make a net simplification inside Knowledge-owned modules: remove the newly added
mandatory claim-to-text coverage output and checks, restore the simple generation
output contract, shorten the content policy around useful core meaning, and replace
repeated generation citation locators with references to existing evidence IDs.
Keep complete evidence text, citation relations and identities, source permissions,
file/hash checks, two stages, manual Review and safe Apply. No new verifier,
model, retry loop, persistence format, UI or upstream-owned production edit.

Delivery continues on the current development branch and Management-Test only.
One fresh bounded replay may use analysis, generation and Query once each; do not
reuse closed allowances or retry. Only chapter 13 and its existing Wiki page are
in scope. Apply only after the complete proposed note is independently reviewed.
Preserve source, Rules, settings and history; keep other materials and the queue
paused. Stop after this attempt rather than adding another layer of checks.

## Acceptance fixed before the run

- The final note explains the original events, main principles and methods without
  invented facts or damage to the existing page.
- The reader's extension contributes a concrete usable method, not just a label
  announcing that advice exists.
- Original statements, personal interpretation and untested suggestions remain
  distinguishable. Do not reverse conditions, negation or scope, or invent a claim
  of performed observations. Concise paraphrases and omitted secondary details
  are allowed; the former five-field/five-qualification checklist is retired.
- One Query gives a useful, source-supported explanation with valid citations and
  correct attribution. It asks about core principles and applicable reader methods,
  not an exact inventory of every source clause.

The analysis checkpoint checks the selected topic, supporting evidence, attribution
and allowed target. A compressed analysis claim is not itself the final-note
acceptance test when its full relevant support remains available. Missing topic
selection, ungrounded attribution or authority violations still stop the run.

Context-engineering-advisor informed the boundary: remove repeated input and
unnecessary output obligations, not source evidence or safety checks. Citation
deduplication is a deterministic input-size improvement, not a semantic guarantee.

## Verification and outcome

Local implementation is complete. The simple v1 schema regression, eight exact
evidence-reference projection cases, and the simplified policy/schema cases were
observed RED before their production change and GREEN afterward. Independent
review found no authority, evidence identity or snapshot/digest regression.

- Related compiler, routing, input, security, Review and retest coverage:
  `npm test -- --runInBand src/knowledge/compiler src/knowledge/KnowledgeCommitPipeline.integration.test.ts src/knowledge/startup/KnowledgeProductionCompileReviewHandler.test.ts scripts/knowledge-analysis-retest.test.ts` —
  17 suites / 383 tests pass. This is not a full-repository test run.
- `npm run format && npm run lint` — pass, 0 errors / 9 existing warnings.
- `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build`, `node --check main.js`
  and `node scripts/mobile-load-smoke.cjs` — pass; bundle 6,485,948 bytes.
- `npm_config_registry=https://registry.npmjs.org npm run review:obsidian` —
  all stages pass. Existing source/style warnings and audit findings (0 critical,
  1 high, 3 moderate) remain visible. Manifest errors printed by the negative
  fixture stage are expected and that stage passes; no review rule is suppressed.
- Progress validation and all 20 governance tests pass; `git diff --check` clean.
- No React visual change, dependency change, upstream-owned production edit,
  persistent-format migration or new model call is introduced.

Pinned main SHA-256:
`efe7fa38399cbd5157a2c99a248035b355b882d503b5d89e636c34fd3d089859`.
Prompt identity:
`23065b0628fe42384e51958305ab488f9edc39f6b8d38ed04d46e8d5fcfcc9e3`.
Analysis system SHA-256:
`5e68b4c40142356a20fe5abb023ecbc23a7ec2812c8e6dbde693211f2ea33ea8`.
Generation system SHA-256:
`e12af05e5be5d066551cbfd63b0b55b3e6c20fcf37a4962882bcda741ccd6359`.
The two system messages together shrink by 2,733 bytes. Full source evidence is
preserved; semantic benefit remains to be established by the bounded live run.

Fresh pre-deployment baseline: 226 files/links, runtime revision 693, 9 completed /
4 pending / 5 cancelled jobs, no pending Review or active transaction. The original
user pause and all earlier closed receipts remain intact. No live outcome is
claimed at this checkpoint.

## Delivered final attempt and its limitation

Code `3d2666dc1577c80dfdda7669d352323ef6972b03` is committed and pushed to
`knowledge-h3-personal-flow`; remote branch SHA is independently confirmed.
Canonical `npm run test:vault` with the Management-Test path and personal bundle
budget rebuilds the exact pinned artifact. The script's CLI reload fails; explicit
idle unload/load succeeds and a fresh plugin instance loads the matching main
hash. The old in-memory manifest label is not used as the build oracle.

The native selected-only action runs job `107ae1da-bd38-4d77-b7d4-a63c247ebe3c`,
input revision 45, once. Official DeepSeek Pro analysis returns HTTP 200 / normal
stop in 14,650 ms: 5 selected topic claims, 8 supporting citations. Full source
and personal-extension evidence remain available in the compacted generation
request. Root and independent inspection pass topic scope, evidence and attribution
availability; they do not claim the final prose is complete.

**The final live acceptance is incomplete.** The temporary, ignored acceptance
guard waits at most 120 seconds for review before dispatching generation. The
agent's review handoff misses that deadline. Native cancellation occurs before
the release helper is invoked; the helper correctly refuses to resume the expired
request. This is an orchestration error in this acceptance session, not a model
timeout, generation failure, failed content review or production-plugin timer.
No attempt is made to extend the deadline, bypass cancellation or spend a retry.

Close this last allowance at 1/3. There is no generation response, new proposal,
Apply, Wiki write or Query. The new generation policy and eventual answer quality
therefore have **no live semantic pass**. Compacted wire citation metadata is
observed at the unpaid boundary, but no paid generation speed or token reduction
is claimed. The old failures remain failures under their original criteria.

Temporary model interception and raw in-memory traces are removed, native fetch
is restored and another explicit idle reload completes. The original user pause
(`1791128571149`) survives. Final runtime revision 746 contains 9 completed,
4 pending and 6 cancelled jobs, no pending Review, rerun or active transaction.
One new chapter-13 observation is pending at attempt zero after reload; it is not
an authorized retry and is left unexecuted. No other source is run.

Root and independent preservation comparison confirms all 226 files/links are
byte-identical, including source, Rules and the existing Wiki. All 14 older terminal
jobs, 4 old Reviews, Manifest and Apply/forward-state history remain exact. The
other three pending jobs have attempt zero; only observation metadata changes.
Of 92 settings fields, 91 are exact; `configuredModels` has a different hash. No
settings write was performed by this acceptance helper. The baseline retains hashes,
not model-setting values, so this is explicitly an unresolved settings exception,
not a claim that every setting was preserved. The actual DeepSeek wire configuration
matches the pinned prior hash; that alone does not prove the entire changed setting
field is equivalent. No restoration or unrelated configuration edit is attempted.

Final runtime SHA-256:
`909537c6c8d8f1b2adce205e424a497a9858d28e050533d7717f0e3f3eea0ada`.
The content-free receipt records `acceptance-checkpoint-timed-out-before-generation`
and `cleanup-complete`; late scope-review metadata explicitly records that release
did not succeed and final content was not reviewed. The last attempt is finished,
not silently converted into another debugging/replay loop. Further product/content
evaluation is left for user direction; no new complexity is proposed.

## October 9 user-delegated native use

After being offered the normal selected-material UI flow, the user explicitly asks
the assistant to operate the software. This is one new native run, not a reopening
of the old receipt. No goal is created, no code/prompt/config is changed, and no
temporary network interception, intermediate review checkpoint or reload is added.
The deployed `3d2666dc` artifact and Management-Test path are verified first.

Click the selected source's **Run only this material**, then **Run this material**
once. Job `85ef0ddf-c84f-4c7a-95db-3492aff35818`, input revision 48, completes at
attempt 1 in 23,289 ms. Activity reports **No Wiki changes**: explicit unchanged
count 0, proposed writes identical to existing files count 1. No new Review exists.
The persisted no-changes receipt records the new personal-method evidence hash
`4c133f7f2cb223fe697e4a4da8a71e207493151249465f4d775efc3ee2859bd9`
with zero supporting claims and zero target claims. Thus the new paragraph was
not selected by analysis; this is not a new timeout or an HTTP-error diagnosis.

Root and independent reading agree: the old Wiki already explains the chapter's
historical events, investigation principles and original-versus-added interpretation
boundaries. But it still does not incorporate the added usable reader method for
recording cases, separating observations from explanations, retaining unknowns and
then choosing representative material to express a conclusion. The issue is an
absent practical addition, not a missing keyword in an exhaustive checklist. The
new run proves native completion, not useful incremental generation.

Before/after snapshots contain 227 file/link entries: 226 are identical and only
the existing `debug.log` changes. Source, Rules, Wiki and project file remain exact;
all 92 settings fields, all 4 old Reviews and the Apply ledger remain exact. Other
three jobs stay queued at attempt zero; only their observation metadata refreshes.
The original user pause is unchanged. Runtime moves from 758 to 776, with 10
completed / 3 pending / 6 cancelled jobs, no pending Review or active transaction.
No Apply, Query, retry, build, deployment, commit or push is performed in this turn.

Final runtime SHA-256:
`40f743b1a188283c29b29927dc8bcbf14a401564f1eed7ae5354047325d5ce3d`.
No-changes identity:
`knowledge-no-changes-e507aa6166eb1a6bac2d7912e1486852640bd3f91bf939fd6a2c0ce0c2f930d1`.
HTTP token counts, response model name and stage latencies were not instrumented;
no such measurements are inferred from the successful UI state. See experiment
`EXP-20261009-001` for stored-config/source hashes and the durable native metrics.
