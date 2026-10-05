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

Delivery and live semantic results will be recorded after execution. Do not
interpret offline checks or successful HTTP as semantic acceptance.
