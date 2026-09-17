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
Final full-sweep verification is still running, not yet claimed successful.

## Live compatibility and remaining final-artifact checks

Before deployment, settings remain version 14 with one provider and two configured
models, zero unresolved provider references, and identical disk/live model IDs.
The existing Project model and Knowledge Bundle configuration remain valid.
This is compatibility of an already migrated Vault, not a claim that an old
Windows settings file was reset and migrated. The legacy migration evidence is
the isolated in-memory execution suite; real disk-fault/NTFS/crash tests remain
separate work.

Remaining: deploy the pushed repairs, verify artifact identity and new plugin
instance, compare the paused-state baseline through reload, exercise Studio
popout/close/reopen and read-only tabs, run one bounded final Query if useful,
remove owned diagnostics, and inspect the final full-suite result.

## Upstream drift

Read-only fetch on September 18 observes canonical
`37bf6a120fb8e36e7a6fbb02225e40ff219b3fe8`, eleven commits ahead of the frozen
acceptance baseline `61619fe427f27c23fbb08b6a040d18ae73c3b219`.
Before the regression fixes, the development branch is 92 ahead / 11 behind.
This exceeds the configured ten-commit drift limit and is not a green drift gate.
No merge is performed during frozen-artifact acceptance; remote master remains
unchanged. Drift unit tests passing prove the checker, not branch currency.
