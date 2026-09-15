# Isolated Knowledge analysis diagnostic

This developer-only tool investigates one explicitly approved source without running
the real queue or writing Wiki pages. It is not part of the production bundle and is
not a permanently installed companion plugin.

The diagnostic deliberately does **not** collect model token usage. A second response
reader can outlive a failed business operation and hide its failure behind a timeout.
The tool passes the original response body directly to the production transport and
records the business result without waiting for optional statistics. Independent
request controllers are cancelled when the attempt closes, even if its Queue job has
already finished. See [issue #8](https://github.com/yydspanda/obsidian-copilot/issues/8).

## Offline verification and build

From the repository root:

```bash
npm test -- --runInBand --runTestsByPath scripts/knowledge-analysis-retest.test.ts
npx tsc --noEmit --skipLibCheck
node scripts/build-knowledge-analysis-retest.mjs
```

The builder only writes `main.js` and `manifest.json` into a new temporary directory
and prints its location and hashes. It does not load the bundle, invoke a model,
install/reload a plugin, change Vault data or overwrite the production artifact.
The TypeScript source and regression tests stay in the repository even if temporary
build artifacts disappear. No package/Jest configuration or dependency change is needed.

## Separately approved live use

Do not deploy or invoke this tool merely to run its offline tests. A live attempt
requires separate user approval for the exact material and potential model charges.
Always target an explicitly named test Vault. Loading the temporary Obsidian plugin
only exposes `.api.prepare`, `.api.run`, and `.api.close`; loading never calls a model.

`prepare` receives an explicit `sourceId`, a complete valid `runtimeText` snapshot,
the selected Bundle `owner`, its configured `project` model declaration, the current
`modelManagement` registry API and the test `app`. Runtime contents stay in memory;
do not print or persist them. The snapshot must already be user-paused. Preparation
uses the public Queue cancellation operation **only in the memory copy** for other
sources' ordinary pending jobs. Every pending job, including the selected source's, must be
unattempted, with no retry deadline or reserved rerun. The preparation report records
the count as `cancelledClonePendingJobs`; it does not delete those jobs or rewrite raw
Runtime JSON. The selected pending job is retained: cancelling it would cause an
identical input to deduplicate against cancelled history instead of running. The copy
stays paused until `run` binds the current observation to that exact job, or enqueues a
new one when none is pending. Before network release, the tool verifies that it is the
only pending job and matches the selected source, hashes and input revision with zero
attempts. A same-input terminal history row is still refused, never forcibly requeued.

Existing terminal history, Manifest, Review and Apply ledger records stay intact.
Other sources' awaiting-Review jobs and their reserved reruns are retained unchanged.
Preparation rejects a selected source awaiting Review, interrupted or processing work,
retrying pending work, and non-user pause gates such as recovery or rate limiting.
Do not erase history, resume the real queue or change real jobs to satisfy these checks.

Verify the zero-request preparation result and source/Schema/pipeline hashes before
calling `run` once. An attempt permits at most two HTTP requests (analysis and, if
authorized by that analysis, generation), no retry/fallback, and a 120-second deadline.
All Queue, Review and Manifest writes target the memory copy, with no Apply capability.
Real Vault access is read-only. The original Runtime must never be overwritten by the
copy, even if a proposal is produced successfully.

The safe report includes request counts/status/timing, hashes, static diagnostics and
business outcome. Headers received are not proof of a completed or valid analysis.
`manifestUnchanged` compares the in-memory Manifest before and after the attempt;
a valid no-change result can update that copy. It is not a proof about the real Vault,
which must be checked against its separate baseline.
Token usage and response model identity are intentionally unavailable; do not infer
them from the requested model or manufacture zero-token counts. A timeout or local
cancellation cannot retract a provider request or charges already incurred.

After the attempt, compare real file/Review proofs and queue controls against the
pre-attempt baseline, record the experiment evidence, call `close`, unload/remove only
the temporary plugin, and clear captured Runtime/diagnostic variables from memory.
Do not automatically apply an isolated proposal or resume the real queue.
