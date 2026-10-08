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
