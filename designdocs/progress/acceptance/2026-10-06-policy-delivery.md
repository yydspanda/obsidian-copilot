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
