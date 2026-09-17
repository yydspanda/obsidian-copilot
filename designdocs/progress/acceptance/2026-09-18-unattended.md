# September 18 unattended Windows regression

Task: `PK-H3-UPSTREAM-V4-WIN`. Scope is the existing bounded Windows acceptance
checklist and its regressions, not every separately registered future feature.
Only `Obsidian-Copilot-Test` and `knowledge-h3-personal-flow` are authorized.
Preserve old notes/history, other Vaults and remote master. Extra model requests
are capped at twenty, including retries, beyond the initial five queued sources.

## Completed compile, Review and Apply chain

The initial five-source batch produces five proposals on first attempt with ten
observed HTTP-200 model resources. The latest saved Query is applied first,
advancing Manifest 18 → 19. Each of the four now-stale sibling plans is rejected
normally, promoting only its existing same-source rerun, then regenerated,
independently reviewed and immediately applied. All four finish on attempt one;
the conservative extra request upper bound is eight. No bypass or source edit is
used to make a stale proposal apply. Experiment provenance and timings are in
`EXP-20260917-003` and `EXP-20260918-001`.

Each of the four serial Apply audits passes 15/15 checks; the aggregate passes
17/17. Final Runtime 1932 / Queue 933 / Manifest 23 has no pending/processing
work or active transaction. User pause is durable at `1789662915639`.
The sixty-six jobs comprise thirty-eight old failures, eight cancellations,
sixteen completions and the four original incompatible pending Reviews.

The seventy-file initial baseline becomes seventy-four files, with only four
authorized new Wiki pages and one authorized update to an already source-owned
Wiki page. No file is deleted. All five source materials, twelve original Review
records, fifty-seven non-target jobs and five original Apply ledger records are
preserved, allowing only observation `updatedAt` refresh on old jobs. Exactly
five new Apply ledger entries, source-success authorities and output hashes agree.

Before deployment, evidence is frozen at
`/tmp/copilot-queue-batch-preservation-20260917/serial-after-1789662947343.json`.
Aggregate evidence SHA-256 is
`b8ac59dea4b282d870e33bff225ca067c3ea8d145404a40b055e66edb65b2058`.
Detailed reports remain in `/tmp/copilot-serial-report-20260918.json` and the
per-step `serial-*.json` audit files. They contain local session evidence and are
not shipped as plugin data.

## Deterministic regressions and minimal repairs

The first complete non-paid sweep reports 720/721 suites passing, with one
failure in the unchanged upstream email-run regex on a 16 MiB Basic input.
The isolated same-Node rerun passes 25/25. This intermittent `RegExp.exec`
failure is retained as evidence; its engine-state cause is not established.

Further default-Node probes independently reproduce stack overflow in six
open-ended counted secret patterns. The repair changes only `{n,}` to the
equivalent fixed minimum plus run, retaining full-secret removal and thresholds.
All six new large-input tests fail before the repair; their six boundary tests
already pass. Afterward, two related suites / 102 tests pass. An independent
6,160-case old/new synthetic comparison finds no output differences. This narrow
repair does not modify or explain the earlier email-run path.

Actual Project migration tests expose a separate data-loss path: target writing
and recovery backup can both fail, yet legacy settings are still cleared.
[Issue #10](https://github.com/yydspanda/obsidian-copilot/issues/10) preserves
unprotected legacy entries, verifies backup bytes and reports recovery truthfully.
Three intended red tests are observed before repair. Nine true-function memory
Vault tests cover success, backup, read-back failure, conflict, retry/idempotence
and partial success; eleven related suites / 195 tests pass after repair.
The production migration diff is net-negative and remains within one file.

Only two upstream-owned production files are changed. No prompt, model routing,
persisted Runtime schema or React component is changed. The production build
passes at 6,428,807 bytes under the explicitly approved 10,000,000-byte personal
ceiling; the default 5 MB policy is unchanged. TypeScript, syntax, simulated
mobile load, formatting, lint (zero errors, three retained warnings), progress
governance and Obsidian review pass. Review fixture errors are intentional
negative-fixture output; the command exits zero and audit finds no vulnerabilities.
The final complete non-paid sweep passes in one process: 722/722 suites,
10,472 passed, zero failed and two existing skips, in 707.635 seconds. The 1,845
source entries have the same SHA-256 before and after execution:
`e61a263c94a49830e42a1fd6e4f2affc895f45212e63562b3d528d3e67888a27`.
The two skips are the real Windows npm-layout fixture on Linux and the optional
locally built Codex archive without `CODEX_BUNDLE_TEST_ARCHIVE`. The 34 existing
React `act(...)` warnings remain visible. The paid integration suite is excluded;
live model checks are separately budgeted and recorded below. No extra skips,
Node flags or warning suppressions are used. The first failed sweep remains
recorded rather than being replaced by this later successful result.

Command: `npm test -- --runInBand --testPathIgnorePatterns='/node_modules/|/integration_tests/' --json --outputFile=/tmp/copilot-full-regression-final-20260918.json`.
The final result SHA-256 is
`eabbedbad5bd776fe0ad582582f84b2d40efe914d4f5000c1d29e3766e537ce6`;
the runner evidence SHA-256 is
`d270ae6782fb9915f22f79feb483a345cf0b51dc1a894e621b4b7b4fc46abfb6`.

## Final artifact and Windows completion

Before deployment, settings remain version 14 with one provider and two configured
models, zero unresolved provider references, and identical disk/live model IDs.
The existing Project model and Knowledge Bundle configuration remain valid.
This is compatibility of an already migrated Vault, not a claim that an old
Windows settings file was reset and migrated. The legacy migration evidence is
the isolated in-memory execution suite; real disk-fault/NTFS/crash tests remain
separate work.

The clean pushed artifact `4.0.8+dev.05903630.clean.9281d3d8cf94` is deployed via
`COPILOT_TEST_VAULT_PATH=/mnt/c/Users/yydsp/Obsidian-Copilot-Test COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run test:vault`.
The WSL deploy script skips its macOS CLI reload; the scoped Windows bridge then
explicitly disables Copilot, reloads manifests, enables it and opens Studio.

- `main.js`: `3128c2d01e058b96d11e638aabf990c26ac89992858da95853c9acb775787a30`.
- `styles.css`: `af35750f263a4192ac0aefcbc0c7c65ed69716c42ce330f25de6151aa5c18003`.
- Settings: `c686ea3763d2708bccf6b1f757effea4cfb5aff4e47be93cc83ed3def9aeb217`.

The old controller becomes idle with no snapshot or listeners. A distinct plugin
instance loads the exact expected version. Studio becomes ready with the same
user pause, no runnable jobs and no transaction; old job states/attempts remain
unchanged and reload observes zero model resources. Runtime advances only through
startup observations to 1959 / Queue 942; Manifest stays 23. Final settings still
have schema 14, one provider, two configured models, zero unresolved references,
matching disk/live IDs and the original valid Project/Bundle configuration.

The real Studio moves to a visible independent window, renders paused Activity,
closes, releases its controller/listeners and reopens in the main window. Sources
and Query tabs render correctly. The final Query completes once in 3,250 ms, with
seven claims and seven hits; all five outputs applied this run are present with
their exact current hashes. All answer citations use the pre-existing direct
Abort source; none cite the five sources processed in this run. Opening a current citation selects the exact 1,093
source characters, SHA-256
`6701bbaf1659d0ad680933e63dd3a670d4a474fc742c807bb5b50c4f26f4f373`,
then returns to the same Studio with its answer visible. No Save or retry occurs.
Extra model requests are bounded at nine of twenty; see `EXP-20260918-002`.

The strict post-deployment Query/navigation audit passes 18/18 checks: all 74
files, five protected files and the complete Runtime bytes are unchanged.
The final Runtime SHA-256 is
`01cd9993c7a53ab9055a0bb1f29c7a1163a16c6a795ac46852319f9970ec297d`.
Report: `/tmp/copilot-queue-batch-preservation-20260917/deploy-audit-1789663883820.json`,
SHA-256 `bbe5f09b1fd459a154f2cb7c775cc1dec79307d95db06ab02407c981ac37df89`.

All four owned final diagnostic handles are removed and their observers/listeners
disposed. Gallery has no loaded/enabled plugin, manifest, leaf, handle or named
plugin style. Queue pause remains `1789662915639`; no model or Apply work remains.
Lifecycle evidence is `/tmp/copilot-final-lifecycle-evidence-20260918.json`,
SHA-256 `958ac95f6d27621a74ee3c74c42d57af21219790032860e0496fd970174b0597`.

## Completion audit and retained limitations

| Required area                           | Evidence and result                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider/Project/settings compatibility | Actual migration execution tests, unchanged live settings/Project and reload references pass; not a real legacy Windows reset or disk-fault test.                |
| Full deterministic regression           | Final 722-suite single run passes; two pre-existing conditional skips and warnings are disclosed.                                                                |
| Queue, Review, Apply and preservation   | Five authorized sources applied; exact source/target/Manifest/ledger checks pass; all old incompatible Reviews and historical failures preserved.                |
| Query, Save and feedback                | Prior real Save continuity plus eight Windows gallery states pass; final Query proves current applied retrieval and zero writes. No redundant Save is performed. |
| Evidence navigation                     | Current opaque citation opens exact source text and returns to the same visible answer.                                                                          |
| Reload/unload and popout                | Final artifact identity, released old authority, no duplicate work and window round trip pass.                                                                   |
| Cleanup                                 | Owned diagnostics and Gallery plugin removed; queue paused; shared-editor style limitation below remains.                                                        |
| Upstream monitoring                     | Fetch and comparison completed; drift is a failed maintenance gate, not a claim of synchronization.                                                              |

Two strict preservation/cleanup assertions must not be silently relabeled green.
Across plugin unload, `copilot/copilot-log.md` changes from 1,521 to 1,150 bytes
because the existing unload path exports the current in-memory diagnostic log.
All other 73 notes/materials, old Reviews and settings are preserved. The raw
13/14 deployment audit remains `allPassed=false`, with its separate source-backed
log assessment retained. This is not deletion of note/history data, and does not
justify another upstream code edit. After deployment, all 74 files are unchanged.

The earlier Gallery strict zero-new-style assertion also remains failed: a
6,919-byte shared CodeMirror style is retained because exclusive Gallery ownership
cannot be proved. There is no safe basis to remove a shared editor stylesheet.
The Gallery instance, files, manifest, leaf and handle are absent. No strict
DOM-zero-residue claim is made.

This closes the registered merged-V4 Windows regression. Physical folder-picker,
first-use Golden Flow, Forward revision and NTFS/OneDrive/crash/dual-instance
tests remain separately registered work, not results of this bounded acceptance.

## Upstream drift

Read-only fetch on September 18 observes canonical
`37bf6a120fb8e36e7a6fbb02225e40ff219b3fe8`, eleven commits ahead of the frozen
acceptance baseline `61619fe427f27c23fbb08b6a040d18ae73c3b219`.
At verified artifact commit `05903630`, the branch is 95 ahead / 11 behind.
This exceeds the configured ten-commit drift limit and is not a green drift gate.
No merge is performed during frozen-artifact acceptance; remote master remains
unchanged. Drift unit tests passing prove the checker, not branch currency.
The next live task is the existing recurring `OPS-UPSTREAM-SYNC`, not a new merge
inside the completed frozen-artifact regression.
