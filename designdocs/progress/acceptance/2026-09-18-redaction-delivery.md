# Log-redaction repair and test-Vault delivery — 2026-09-18

Task: `PK-LOG-REDACTION-WIN`.
Issue: <https://github.com/yydspanda/obsidian-copilot/issues/12>.
Status: full non-paid sweep and static gates pass; commit/push and Windows delivery pending.

## Scope and repair

The user approved fixing the seven remaining full-suite failures, then committing
and pushing the current development branch and deploying only
`Obsidian-Copilot-Test` for targeted Windows acceptance. No model requests,
unrelated Vault changes, old proposal Apply, upstream merge, or remote-master
update are included.

The initial branch is `knowledge-h3-personal-flow` at
`e0e88f7b7444885822c75302ca758cf0e55c0a94`, retaining the four uncommitted
[review #11 repairs](./2026-09-18-review11.md). The frozen upstream baseline is
`61619fe427f27c23fbb08b6a040d18ae73c3b219`; the previously observed 11-commit drift
remains separate maintenance work.

The stack overflow reproduces reliably with an unoptimized V8 regexp engine:

```bash
node --no-regexp-optimization -e '/[A-Za-z0-9._%+@-]+/g.exec("A".repeat(4194304))'
```

Both the email candidate run and Basic credential run use `CLASS+`. Rewriting
them as `CLASS CLASS*` preserves their nonempty greedy matches and capture groups
without the unoptimized engine's per-character stack growth. The production
repair is two regexp expressions plus comments, in one existing file. No scanner
abstraction, runtime flag, dependency, model prompt, or user setting is introduced.

The precise reason the earlier full Jest process reached that engine behavior
while an isolated run did not is not established. The repair covers the unsafe
engine path directly instead of relying on a favorable isolated run.

## Regression evidence

- The initial child-process fixture had a string-escaping mistake; that failure
  is not counted as behavioral RED. After correction, the real production module
  fails with the same `RegExp.exec → replaceEachRun` stack overflow.
- Final regression uses a fresh child process with `--no-regexp-optimization`,
  retaining 16 MiB values and checking all 18 exact outputs: seven credential
  forms, email/punctuation, and harmless text, each with ASCII and delimited
  Unicode surroundings. No flags leak into production or other tests.
- An intermediate fixture incorrectly attached Unicode directly to a password
  value; it was corrected to use whitespace-delimited surroundings. A redundant
  forced-interpreter mode exceeded the fixture timeout and is not part of the
  final regression; the reliable unoptimized-engine reproducer remains covered.
- Final focused run: **3 suites / 103 tests pass**, including unchanged original
  redaction tests and report generation. Command:
  `npm test -- --runInBand --runTestsByPath src/utils/redactLog.test.ts src/utils/redactLog.regexp.test.ts src/utils/issueReport.test.ts --json --outputFile=/tmp/copilot-review12-focused-final.json`.
- Independent read-only review confirms equivalent matching, whole-value output
  assertions, and isolated engine parameters.

## Frozen-source verification

- Source tree: 1,846 files, SHA-256
  `f97bb5b5a00eba51f3ab2c96befcb68e5dee959161c5b62f122eecc79d16e215`.
- Node `v24.14.0`, Linux x64 / WSL.
- `npm run format`, production TypeScript/build, artifact syntax and simulated
  mobile module-load smoke pass.
- `npm run lint`: pass, 0 errors / 3 retained warnings.
- `npm run review:obsidian`: pass, 0 dependency vulnerabilities; retained review
  warnings are unsuppressed, none in the changed production modules. Negative
  fixtures report their expected errors and pass.
- Personal build: 6,429,741 bytes; SHA-256
  `323bd801e0f29d21277cf7407af398167eb98e7aaf185b68c940652dd804d939`.
  Only the already-approved `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000` override
  is used; the upstream default ceiling is unchanged.
- First full non-paid run: **723 suites pass / 1 fails; 10,497 tests pass,
  1 fails, 2 skip**, 1,225.843 seconds. All redaction tests pass, including the
  new unoptimized-engine regression. Command:
  `npm test -- --runInBand '--testPathIgnorePatterns=/node_modules/|/integration_tests/' --json --outputFile=/tmp/copilot-review12-full.json`.
  Real-provider integration tests are excluded; local fake servers and child
  processes run with approved sandbox escalation.
  Result SHA-256: `aa35deff0886052aa074534c91733d534a50bd8b858748f6f12a9938e63b1f65`.
- The only failure is the unchanged upstream publish-wrapper test's first local
  HTTP request exceeding its 250-second timeout. The actual Jest process inherited
  HTTP proxies without loopback exclusions. Its shell timeout left a curl child
  holding pipes open; fixture identity and timestamps confirmed ownership before
  the completed Jest process and that child were terminated. The other five
  publish cases passed, so the original connection stall is not uniquely explained
  by the presence of a proxy. This failed run is retained, not counted as green.
- With process-local `NO_PROXY=127.0.0.1,localhost` and
  `no_proxy=127.0.0.1,localhost`, the same publish suite passes **6/6** in
  11.289 seconds; the previously timed-out case takes 48 ms. No test, wrapper,
  global proxy setting or source file changed. Evidence:
  `/tmp/copilot-review12-publish-local.json`.
- The second full sweep uses those loopback exclusions and
  `--maxWorkers=2 --workerIdleMemoryLimit=2048MB`. It completes in 430.720 seconds
  with **723 suites pass / 1 fails; 10,497 tests pass, 1 fails, 2 skip**.
  Publish and redaction pass; `dev/gallery/main.test.ts` hits its unchanged
  five-second timeout while waiting for layout. The same case passed in 73 ms
  in the first full run. These two runs are not combined into a green sweep.
  Evidence: `/tmp/copilot-review12-full-local.json`, SHA-256
  `f096909573c9d052da426100389b39a4d06da0e78f79a4f3df21b3047617dc16`.
- During the second sweep, Console Ninja's build hook emitted an error. Inspection
  confirms an extension-injected `build-hook-start` block in the installed
  `node_modules/jest/bin/jest.js`; this is not a repository change, and neither
  run has `NODE_OPTIONS` set. Its normal downstream entry,
  `node_modules/jest-cli/bin/jest.js`, is not injected. The exact contribution
  of the hook versus scheduling to the gallery timeout is not established.
- The clean full sweep uses that same installed Jest's downstream CLI directly,
  a fresh `/tmp/copilot-review12-jest-clean-cache`, the same two-worker settings
  and loopback exclusions. No test assertion, timeout, repository configuration,
  user-installed dependency file or editor setting is changed. It passes:
  **724/724 suites, 10,498 tests passed, 0 failed, 2 existing skips**, exit 0,
  1,289.587 seconds. Evidence: `/tmp/copilot-review12-full-clean.json`, SHA-256
  `66d948a242ffc32e73beea59d8bfb10e698f2d080f807bde8bbed9506d31fcbc`.
  Source identity remains frozen after completion. Jest reports one worker
  teardown warning and force-terminates that worker; this is retained, not
  described as a warning-free or fully clean shutdown.

Reproduce the verified full run without changing local editor integrations:

```bash
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
  node node_modules/jest-cli/bin/jest.js --maxWorkers=2 \
  --workerIdleMemoryLimit=2048MB --cacheDirectory=/tmp/copilot-review12-jest-clean-cache \
  '--testPathIgnorePatterns=/node_modules/|/integration_tests/' \
  --json --outputFile=/tmp/copilot-review12-full-clean.json
```

Independent final diff review finds no new P1/P2 issue. Production code is net
one line smaller; the only upstream-owned production files changed in this
delivery are Chat drop identity and the two redaction expressions. Prompt content,
release entries, dependencies and test timeout settings remain unchanged.

## Windows preflight and delivery

Preflight confirms the exact test Vault path
`C:\Users\yydsp\Obsidian-Copilot-Test`, 74 files, old deployed build `05903630`,
Runtime 1986 / Queue 951, no active transaction, and a user-paused queue with
66 jobs (38 failed, 8 cancelled, 16 completed, 4 awaiting review). No job is
pending or processing. Settings and note hashes were captured before delivery.

Commit/push, final deployment identity, preservation comparison and targeted
Windows results will be appended after the full sweep completes successfully.
