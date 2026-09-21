# Studio setup and material entry — September 21, 2026

Task: `PK-STUDIO-ONBOARDING`.
Issue: <https://github.com/yydspanda/obsidian-copilot/issues/13>.

## Scope and baseline

The user requested repairing the first-use workflow before resuming self-operated
reading practice. Studio previously required manual Project YAML/rules creation,
and adding a Vault note required a detour through ordinary Quick Chat.

Worktree: `knowledge-h3-personal-flow`, HEAD `1f25176e`, with pre-existing dirty
September 20 Pro compatibility repairs preserved. Incorporated upstream remains
`996a088c59a2ae123852d8e542f354b1eba72cee`; no upstream fetch or merge occurs here.
At this implementation/deployment checkpoint, no commit or push had been performed.

Implementation stays in Knowledge modules except for three lines in `main.ts`
connecting native Agent Chat navigation. Native Project creation, Chat behavior,
internal prompts, provider credentials and dependency versions are unchanged.

## Observable behavior

- First-time Studio setup chooses an existing Project and configured model,
  previews editable roots/rules, and saves only after explicit confirmation.
  Existing Bundle configurations are never replaced by this first-use flow.
- Missing Projects link to native Agent Chat. Configuration-file navigation is
  labeled separately; opening a page does not create files or call a model.
- Setup preserves unrelated frontmatter/body and existing rules, rejects
  configuration-directory overlap, external real paths and mismatched real path
  casing, and rechecks Project/model identity before committing.
- Studio's **Add materials** selects one supported Vault file. Files already in
  the source root register directly. Files outside it require explicit consent
  to copy a snapshot to `<sourceRoot>/Vault/<original path>`; originals are not
  moved or edited and source permissions are not widened.
- Source reads enforce the parser's 8 MiB budget before allocation and again
  after reading. Selections are bound to the current Bundle/generation and file
  identity. Duplicate clicks and stale selections cannot replace existing files.
- Adding does not Resume or Apply. A running queue may start model work after
  the user's confirmation; a paused queue remains paused. The UI warns about
  this distinction. Setup itself neither registers sources nor invokes a model.
- Committed receipts survive refresh/unmount and are scoped to their Bundle.
  Partial failures can leave newly created directories, rules or a registered
  source; users are told to inspect current state before retrying, not promised
  destructive rollback.

## Local verification

Observed red-to-green regressions cover setup behavior, reserved configuration
paths, Windows path spelling, material selection/registration, native Project
navigation, post-unmount receipts and cross-Bundle feedback isolation.

Final frozen-source run: **27 suites / 376 tests pass**, no failures or skips.
This covers `knowledge/setup`, `knowledge/capture`, the affected Studio/forms,
view wiring and `main.test.ts`; it is not a full-suite rerun.

Checks completed:

- Personal production build and TypeScript check with
  `COPILOT_PERSONAL_MAX_BUNDLE_BYTES=10000000`; default release ceiling unchanged.
- `npm run format`, final `npm run format:check`, and `npm run lint`.
  Lint retains nine warnings: six explicit chooser-state reset warnings and
  three pre-existing warnings. No errors or rule suppression.
- Full `npm run review:obsidian`, including packaged styles, dependency audit
  (zero vulnerabilities) and negative fixtures; review warnings remain visible.
  Error output emitted by deliberately invalid fixture manifests is expected.
- `node --check main.js` and `node scripts/mobile-load-smoke.cjs`.
- `npm run gallery:build`; actual adjacent stories mounted through the gallery
  catalog in an isolated browser: 16 states at 300/340/400/600 px, 64 checks,
  no render errors or horizontal overflow. Saving/error and snapshot consent
  states were exercised. This uses minimal theme/Obsidian shims, not native
  Obsidian visual acceptance. No gallery plugin was installed in the Vault.

The initial gallery check correctly rejected a runtime domain import in a story;
the story now uses adjacent/type-only imports without weakening the import fence.
An initial lint run saw work-in-progress test assertions; final lint is green
with the warnings recorded above.

## Windows delivery

Delivery targets only `C:/Users/yydsp/Obsidian-Copilot-Management-Test`.
The original book Vault and old `Obsidian-Copilot-Test` are outside scope.

Before delivery, actual CLI identity/path matched the practice Vault. Studio was
ready on Activity, Bundle `reading`, Running, with all five activity counts zero.
Runtime revision was zero, with empty queues/manifests and no active transaction.
The preservation baseline contains 185 note/material files and 92 hashed settings.
No credentials or note bodies are recorded in this evidence.

`npm run test:vault` rebuilt and copied build `1f25176e-dirty-92d174d8715d`
(timestamp `20260921-202900`). Its ordinary CLI toggle did not reload the plugin.
A scoped unload/load initially failed because replacing the cached manifest
omitted Obsidian's runtime `dir` field; restoring only that in-memory installation
path allowed the next load to succeed. No source patch or note change was needed.
The temporary diagnostic marker was removed after checking the outcome.

The actual running instance reports `4.0.9+dev.1f25176e.dirty.92d174d8715d`.
Studio is ready on Activity with an enabled **Add materials** button. Bundle
`reading` remains Running with zero total/active/review/failed/history counts;
runtime revision remains zero, queues/manifests empty, no active transaction.
Pre-reload Quick Chat had no messages and Agent Chat had no active requests,
pending questions/permissions or non-whitespace draft. No Chat Save/model command
was invoked.

All 185 note/material hashes match, including Project, rules, personal notes and
saved history; no note was added or removed. Ninety of 92 persisted settings
hashes match. `configuredModels` and `backends` changed during ordinary startup
model discovery; their exact field-level delta was not retained, so this is
**not** a claim that every model-list setting is byte-identical. Provider/key
settings and all other setting hashes match. No setup/import action was invoked.

Local and deployed artifacts match exactly:

- `main.js`: 6,463,609 bytes;
  SHA-256 `e323cf58fecbce78397e36d920ef6873c887500428d1bdfd58639c987892e028`.
- `styles.css`:
  SHA-256 `83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e`.

User-operated first-use creation and actual material submission/model/Review
remain untested on Windows; the assistant has not performed those actions on the
user's behalf. Existing `reading` configuration needs no setup rerun. Next
checkpoint: the user opens **Add materials** and previews their personal note,
without immediately confirming a paid ingest.
