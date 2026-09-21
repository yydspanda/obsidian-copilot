# DeepSeek V4 Pro compatibility repair — September 20, 2026

Task: `PK-DEEPSEEK-PRO-RESTORE`

The user paused the reading walkthrough and requested a fix after selecting
`deepseek-v4-pro` in Quick Chat. A scoped read-only observation confirmed the
selected model and local unsupported-configuration error in
`Obsidian-Copilot-Management-Test`, running `4.0.9+dev.1f25176e.clean.fec5d39dc7b3`.
No UI input, credential output, model request, or Vault mutation was performed.

## Cause and repair

The fork's shared model policy still refused Pro based on its former retirement
plan. The current [official changelog](https://api-docs.deepseek.com/updates/)
explicitly continues Pro service after September 14, and the
[Chat Completions contract](https://api-docs.deepseek.com/api/create-chat-completion/)
lists both `deepseek-flash` and `deepseek-v4-pro`.
[Issue #3](https://github.com/yydspanda/obsidian-copilot/issues/3) remains the
originating identity/alias contract, including the ban on silently replacing Pro
with Flash.

- Preserve Pro as `deepseek-v4-pro` through Chat, OpenCode selection, Knowledge
  profiles, compiler requests and grounded Query requests.
- Retain only the existing Flash alias mapping, `deepseek-v4-flash` to
  `deepseek-flash`; unsupported identities still fail closed.
- Preserve exact Knowledge response-model checks and separate Pro/Flash profile
  identities; a Flash response to a Pro request is rejected without retry.
- Restore the disabled-by-default built-in Pro entry. Existing saved models,
  credentials and enabled/default selections are not changed.
- Keep reasoning/sampling restrictions, custom-provider ownership and endpoint
  boundaries unchanged. No prompts, React components or dependencies changed.

Production edits are limited to two fork-owned adapters and nine added lines in
the upstream-owned `src/constants.ts` catalog. Tests and user documentation remove
the stale retirement expectation; historical checkpoints are retained as history.

## Local verification

Before the repair, 8 Chat/policy, 6 Knowledge, 13 OpenCode and 1 catalog assertions
failed for the expected missing Pro support. After the repair, 19 relevant suites
and 715 tests pass. Requests are intercepted by local test doubles, not sent to
DeepSeek. The Chat request-body suite required sandbox escalation for a loopback
test server after `EPERM`; its rerun passes.

Two added selection-safety cases also fail when a temporary mutation forces
selection of Flash, then pass after restoring the exact original production
bytes. No mutation remains. This is targeted coverage, not a new full-suite run.

The personal production build/typecheck passes at 6,437,429 bytes under the existing
10,000,000-byte personal ceiling. Artifact syntax and simulated mobile-load checks
pass. Source-wide Prettier passes; full ESLint passes with 0 errors and 3 existing
warnings in unchanged files. Progress governance and `git diff --check` pass.
Artifact SHA-256: `ae718332cc91852bbef27d40b856e339af5e2398dccc19542d2198db472bdc32`.

All Obsidian review stages pass, retaining the existing nonblocking warnings.
The aggregate command passed package/source/styles but hung in `npm audit` for
over 15 minutes. Its verified audit process was terminated; the same critical
threshold then passed with `timeout 50s npm audit --omit=dev --audit-level=critical
--fetch-timeout=20000 --fetch-retries=0`, reporting 0 vulnerabilities. Review
fixtures passed separately after rerunning outside the sandbox because its Git
child process had been blocked. This is a completed set of review stages, not a
claim that the original aggregate invocation exited successfully. No rule or
severity threshold was suppressed or changed.

## Delivery boundary

At the local repair handoff, deployment/reload remained pending authorization.
The user then explicitly requested deployment; the scoped result is below.
No commit, push, live Pro request, or reading-note edit has been performed.

The shared model mapping is part of Knowledge route fingerprints, so this repair
also changes Flash route fingerprints. Existing configured Knowledge libraries can
invalidate old proposals and reprocess sources after upgrade. The inspected new
practice Vault has no Project/Bundle; do not silently deploy to other existing
queues or describe this repair as fingerprint-neutral.

## Authorized practice-Vault deployment

Deployed only to `C:/Users/yydsp/Obsidian-Copilot-Management-Test` on September 20.
Preflight reconfirmed no Project/Bundle, an idle Chat and an empty input draft.
The existing deployment script rebuilt with the personal 10 MB ceiling and copied
the plugin artifacts, with its automatic reload deliberately skipped until chat
preservation was ready. Source and deployed `main.js` have the exact SHA-256 and
6,437,429-byte size recorded above. No dependencies or tracked build inputs changed.

The 13 unsaved messages were held temporarily in the current window, including
IDs/order, display and processed text, context, error flags and response metadata.
After plugin-only reload, the public `chatUIState.loadMessages` path restored them
without Save Chat, AI title generation, recent-conversation summarization or a new
model request. Existing mounted input callbacks restored the three attachment
paths/flags and the identical session-only Pro model key; no default setting was
changed. The first reload exposed Obsidian's stale manifest cache, so only this
plugin's manifest was refreshed before a second reload and restoration.

Verification confirms a new instance running
`4.0.9+dev.1f25176e.dirty.ebf5a93c7d53` (artifact build time `20260920-173016`):

- All 13 serialized messages match; all three input attachment paths and context
  flags match. The draft remains empty and the picker still shows `deepseek-v4-pro`.
- All 165 Vault-visible files retain their content hashes, including the user's
  reading notes; none were added or removed.
- Of 92 persisted settings, 91 are byte-equivalent under JSON hashing. Only
  `copilotPlusCatalog`, the ordinary startup catalog cache, refreshed; no setting
  was added or removed, and model/key configuration was preserved.
- Studio still needs Project setup. No other Vault was deployed/reloaded, no
  Knowledge queue or Wiki write was initiated, and no inference request was sent.

The temporary window snapshot was removed after verification. This preserves the
current in-memory conversation; it does not turn it into a saved Chat note.
Actual provider success remains for the user's next retry, not a claimed live test.
