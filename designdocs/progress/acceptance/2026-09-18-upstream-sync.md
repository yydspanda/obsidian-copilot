# September 18 current-branch upstream synchronization

Task: `OPS-UPSTREAM-SYNC`.

## Scope and baseline

The user requested canonical upstream synchronization and an explanation of the
many Knowledge Studio Failed tags. This run only changes the development branch
`knowledge-h3-personal-flow`; it does not update remote master, deploy/reload the
plugin, change a Vault, retry jobs, Apply proposals, or invoke a model.

- Starting HEAD: `c93bea80c122d26717bbd8f53b124ea794d8c1f6` (clean).
- Previous incorporated upstream: `61619fe427f27c23fbb08b6a040d18ae73c3b219`.
- Fetched canonical: `996a088c59a2ae123852d8e542f354b1eba72cee`.
- Before merge: 98 ahead / 12 behind. The upstream delta touches 105 files;
  18 have changes on both branches, which is not the conflict count.
- SSH fetch was closed on port 22. HTTPS fetch of the same canonical repository
  succeeded without changing the remote configuration.
- Non-mutating `git merge-tree --write-tree HEAD origin/master` and the actual
  `git merge --no-ff --no-commit origin/master` both found exactly one text
  conflict: `src/agentMode/session/AgentSessionManager.ts`.

## Minimal reconciliation

Upstream now substitutes an enabled model when a saved default is absent from
the offered catalog. The fork must still reject policy-retired models before
constructing a sendable backend session, even when an alternative is offered.
The merged session creation uses upstream's `getSeedSelection()` while retaining
the existing normalization/refusal boundary. One early check in
`getSeedSelection()` preserves policy-rejected identities for that boundary;
ordinary upstream catalog fallback remains covered and enabled.
Origin: [issue #3](https://github.com/yydspanda/obsidian-copilot/issues/3).

Before adding this early check, the targeted regression had two intended
failures: a rejected Pro default silently became Flash, and session creation
resolved instead of refusing. The existing no-alternative case passed. After
the check, all 194 tests in the full manager suite passed, including the upstream
fallback and deferred-reload cases. No test timeout or assertion was relaxed.

Two test-only reconciliations preserve existing contracts:

- Upstream skips one huge-credential stress test. The fork has already fixed
  that V8 overflow under [issue #12](https://github.com/yydspanda/obsidian-copilot/issues/12),
  so the test remains enabled along with the no-regexp-optimization regression.
- Upstream removes baked-in Plus model enum members. A fork constants test still
  referenced a removed member, causing the initial build's TypeScript failure.
  Its negative assertion now uses the concrete retired model name, without
  restoring any obsolete production constant.

Independent static review found no other lost fork protections. Knowledge,
generic Chat drop, source-read budgets, Wiki real-path checks, DeepSeek routes,
and production log redaction are unchanged from the starting HEAD. The lockfile
diff only changes the plugin version, not dependencies. Upstream release notes
and built-in skill content are imported unchanged, without custom prompt edits.

## Verification

- Full manager suite: 194/194 tests pass after the intentional red run.
- Impacted regression: 56/56 suites and 1,623/1,623 tests pass, zero failures or
  skips, 148.577 seconds (34 upstream suites plus 22 fork integration-seam suites;
  no real-provider integration tests). Three upstream Miyo React `act(...)`
  warnings and one worker teardown warning remain visible; exit code is zero.
- Production build/typecheck passes with the existing explicit personal budget:
  `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000 npm run build`.
  The default upstream 5 MB limit is unchanged.
- Artifact: 6,437,283 bytes; SHA-256
  `33280a47af73e618a72d6f88558d386ef292381cf9f1b8dd801108c6842754b8`.
  `node --check main.js` and `node scripts/mobile-load-smoke.cjs` pass.
- `npm run format` and `npm run lint` pass (0 errors, 3 retained warnings).
- `npm run test:project-governance`: 20 tests / 4 suites pass.
- Full `npm run review:obsidian` passes, including dependency audit (zero
  vulnerabilities). Existing source/style warnings remain visible. The two
  deliberate invalid-manifest fixture errors are expected negative-test output,
  followed by `Obsidian review fixtures passed`; no gate is suppressed.

The Jest entry is the installed, unmodified
`node node_modules/jest-cli/bin/jest.js`, with two workers,
`--workerIdleMemoryLimit=2048MB`, cache
`/tmp/copilot-review12-jest-clean-cache`, and process-local
`NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost`. The editor's injected
Jest wrapper is neither used nor modified. The suite set comprises every existing
test changed from the previous canonical baseline to this fetch, plus the fork
model-selection, lifecycle, file-drop, file-store, source-budget, and redaction
regressions. Local evidence is `/tmp/copilot-sync-20260918-{red,manager-green,regression}.json`
and the corresponding build/format/lint/review/governance logs.

The earlier 724-suite / 10,498-test full sweep predates this merge. It is not
represented as a new full-suite result. No new Windows UI/gallery rendering or
paid model/end-to-end run is claimed.

## Read-only Failed-history audit

The test Vault runtime is byte-identical to the last completed Windows checkpoint:
SHA-256 `6cbb6ddfb7874b495d52b61e720ef1f894c6f12aa1356feef144c477a0b6820e`.
Runtime revision 2013 / Queue revision 960; all 66 jobs remain unchanged:
38 failed, 8 cancelled, 16 completed, 4 awaiting review, no pending/processing.
Queue control remains user-paused and there is no active write transaction.

The 38 failed attempts belong to six source files. Each has a later nonfailed
result: three latest jobs completed and three await review. The failed attempts
date from August 4 through September 15 (Beijing time), not this synchronization.
Stored categories are 22 analysis-validation rejections, 9 invalid provider
responses, 6 network connection failures and 1 candidate-validation rejection.
Older generic messages do not prove a more detailed root cause retrospectively.

Activity counts terminal attempts, including hidden historical rows. Failed jobs
do not occupy worker slots; the paused control, not the failed count, currently
prevents processing. Existing review/dedup constraints may still affect the same
material. There is no reason to delete history or batch-retry these failures.

Windows still runs the previously verified
`4.0.8+dev.3806657e.clean.3dbe2a0fe726`. After a separate deployment, the appropriate
next check is a short smoke test of the loaded version, Studio, model selector
and preserved paused queue, not the entire acceptance click sequence. Upstream
may now cache the public Plus model catalog even while signed out; that is not
model inference, and expected catalog-cache changes should be distinguished from
unexpected changes to provider credentials, user model choices or project data.
