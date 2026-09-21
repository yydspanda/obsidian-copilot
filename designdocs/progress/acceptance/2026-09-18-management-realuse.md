# Management notes real-use preparation

Task: `PK-H3-MANAGEMENT-REALUSE`.

The user selected the existing Vault `毛主席教我们当省委书记【管理】` and approved
preparing an independent test copy. This step does not authorize a paid model
request, a bulk ingest, or writes to the original notes or generated Wiki.

## Material copy

- Source: `C:\Users\yydsp\PycharmProjects\mao_thought_and_philosophy\output\毛主席教我们当省委书记【管理】`.
- New folder: `C:\Users\yydsp\Obsidian-Copilot-Management-Test`.
- Created the destination exclusively: an existing folder would make `mkdir`
  fail before copying. `rsync -rt --exclude='.*'` preserved non-hidden relative
  paths and bytes; hidden application/plugin/account configuration was excluded.
- Copied 163 Markdown notes plus the accompanying `knowledge_graph.json`.
  The index, chapter and concept folders keep their original layout.
- Created an empty `.obsidian` folder. No plugin, settings, credentials, queue
  history or model configuration is copied; this is not yet a deployed/configured
  Copilot Vault. No Obsidian registration or opening is claimed.

The settled verification passes: exactly the expected 164 files, every copied
file hash matching its source, and all 171 original files (including the seven
excluded settings files) unchanged, with no additions. The copy inventory's
SHA-256 is `2ef289b38150e7142072e34bbe5f37387ab960d91f0ed68304ad07cb78284cab`.
The first check ran before the asynchronous copy finished and saw an unavailable
in-flight file; after copy completion, the full comparison passed. Original
materials were never edited or opened through the application.

Local evidence: `/tmp/copilot-management-source-before.json`,
`/tmp/copilot-management-verify-copy.cjs` and
`/tmp/copilot-management-copy-verification.json`. No note text or credential
values are placed in repository evidence. Canonical upstream remains
`996a088c59a2ae123852d8e542f354b1eba72cee`; no plugin source changes are made.

## Authorized plugin and model setup

The user subsequently opened the independent copy and explicitly approved
reusing the old test Vault's model configuration and credentials only. Its
running name and adapter path match `Obsidian-Copilot-Management-Test`; the
original material Vault is not the deployment target.

- Installed and loaded `4.0.9+dev.1f25176e.clean.fec5d39dc7b3`, using the existing
  personal 10,000,000-byte build allowance and `npm run test:vault` with the new
  copied Vault as `COPILOT_TEST_VAULT_PATH`.
- `main.js`: 6,437,283 bytes, SHA-256
  `33280a47af73e618a72d6f88558d386ef292381cf9f1b8dd801108c6842754b8`.
  Styles SHA-256:
  `83f1b894ad7da14c8c3b4b26ee8367e225553ebb554babd4408abb1e3f421b2e`.
  Local and installed artifacts match; syntax and mobile-load smoke checks pass.
  Source is unchanged from the verified upstream-merge build; `1f25176e` adds
  fixture documentation only.
- The build/copy command exits successfully, but its log retains the esbuild
  child-process shutdown deadlock diagnostic. This is not a clean shutdown
  claim. Windows CLI reload also required the established scoped plugin API
  fallback; actual loaded identity was then checked directly.
- Enabled community plugins and Copilot only in the copied Vault. Imported the
  existing DeepSeek BYOK provider and both configured model snapshots, retaining
  their Chat enrollment. No agent backend was enrolled.
- Used the plugin's production `setup.byok.setupProvider` API with
  `autoEnrollIn: ["chat"]`. Fresh provider/model IDs and a new Vault keychain
  namespace avoid sharing mutable credential entries with the old test Vault.
  The two Vaults' secret stores are isolated: an initial target-side lookup
  stopped before configuration writes. The successful transfer read only the
  selected credential through the old Vault window, passed it in memory between
  the two verified Electron windows, and saved it through the new plugin API.
  No secret was printed, stored in a temporary file, or copied into repository
  evidence. Equality, independent keychain pointers and preservation of the old
  credential were checked as booleans.
- Selected the newly configured `deepseek-v4-flash` as the default using the
  existing settings control, rather than copying the stale Gemini/OpenRouter
  default string. The old Pro model metadata remains; the deployed runtime's
  existing retired-model rejection policy is unchanged.
- Turned off **Autosave Chat as Markdown** through its existing control so a
  later bounded question does not automatically create a note and request an AI
  title. The hidden recent-conversation setting remains at its fresh default;
  do not click New Chat or manually save during a one-request check, because
  those operations can trigger additional model work.

Local verification: the persisted default resolves to Flash, its credential is
available, Chat has two configured models, no agent backend configuration was
imported, and the active chat contains zero messages. The old test Vault's
settings file SHA-256 is unchanged across the credential transfer. A first
read-only verification helper assumed an absent agent-backend object existed
and raised a TypeError; correcting that helper's inspection passes. This was a
diagnostic-script error, not a reproduced plugin failure.

The material recheck still matches all 164 copied files and all 171 original
files, with no original additions. The material inventory hash remains the one
above. New application-owned files are confined to `.obsidian/`, including a
fresh Knowledge runtime; no source, chat, queue history or Wiki page was copied.
Local helper: `/tmp/copilot-management-verify-materials.cjs`.

An independent read-only check confirms the copied provider's non-secret fields
and both model snapshots match the old configuration, with new IDs; no nonempty
plaintext credential fields are persisted. The fresh runtime has revision 0,
zero queues, jobs, reviews, manifests or commits, and null active transactions.
ProjectList is empty and no conversation or memory folders exist. Quick Chat is
open and visibly shows `deepseek-v4-flash`, with zero messages sent.

No inference, model verification endpoint, embedding, ingest, Query, Save or
Apply was run. Plugin startup may perform public catalog/version checks; this
is not a zero-network claim. This configuration check is not model-quality or
end-to-end acceptance.

## September 20 guided walkthrough: first attachment

The goal is a joint, step-by-step walkthrough: show how to use the plugin, then
explain its practical value using the selected notes. No model request or Wiki
write is authorized by the UI preparation below.

Rechecked the deployed identity and empty chat in the new Vault. Demonstrated
the normal Add context picker: searched `10_文件` and selected the exact chapter
10 result through its mousedown handler. The actual Chat now displays the
chapter's attachment badge and still contains zero messages. This adds local
reference material to an unsent conversation; it does not edit the source note.

The first automated picker attempt closed before selection. Waiting for the
existing delayed composer-focus callback before opening the picker allowed the
same UI path to succeed; no plugin source change was made. Temporary evidence
helper: `/tmp/copilot-management-first-attachment.cjs`.

The proposed next step was adding chapter 16 before a first question. The user's
subsequent clarification below supersedes that fixed demonstration sequence.
Answer quality, citation accuracy and reusable reading notes remain unverified.

## September 20 revised goal: user-operated reading practice

The user explicitly asked to revise the goal: they want to operate the plugin
themselves while the assistant accompanies them through realistic reading,
comparison, understanding and note-taking. Assistant-run automation does not
meet that learning objective.

Authoritative working objective:

> 陪用户在新的 Obsidian 笔记库中亲手使用 Copilot，模拟真实读书过程，逐步体验
> 理解难点、比较章节与观点、联系已有知识、整理自己的阅读笔记。
> 用户负责所有插件操作；助手只做逐步指导和讨论，不代替点击、输入、发送、
> 修改设置或记录笔记。每次只给一个与当前阅读问题有关的小任务，解释它的用途
> 和预期收获，等用户操作并反馈后再继续。共同核对回答与原文，区分作者观点、
> AI 推断和用户自己的理解。目标是让用户能独立把插件用于日常阅读和思考，
> 而不是完成一套由助手自动执行的技术验收。

- Start with what the user is reading or trying to understand, not a fixed
  button checklist or the earlier meeting-report demonstration.
- Do not drive or poll the live Obsidian UI, send prompts, alter settings, edit
  notes, or call model/queue APIs unless the user explicitly requests that
  specific assistance again. Prior automation permissions are not a standing
  authorization for this guided exercise.
- Explain one meaningful reading action at a time, including where to perform
  it and what would make the result useful. Let the user report the result or
  share the relevant excerpt; do not silently complete their practice step.
- Waiting for the user's response is expected. Do not repeatedly restate the
  same click instructions, advance automatically, or invent progress to keep an
  autonomous loop running.
- Evaluate value through the user's experience: a difficult passage becomes
  clearer; a comparison reveals an agreement or distinction grounded in the
  text; and the user records a note containing their own understanding and
  traceable sources. Successful automated clicks or green tests do not prove
  this goal achieved.

This revised objective is persisted in the task tracker and roadmap. The
available goal tools only create a goal when no unfinished goal exists or update
its status; they do not expose an objective-edit field. The existing product
goal was not falsely completed or replaced, and its displayed text has not been
changed by these documentation edits.

The earlier chapters 10/16 sample remains optional. Ordinary Quick Chat can use
explicit Markdown attachments; Studio Query is a separate workflow requiring a
configured Bundle and applied Wiki provenance. Choose a workflow for the user's
reading need rather than making them exercise every plugin surface.

This is fixture preparation and deterministic integrity verification, not a
model experiment. Record configuration/data hashes, runtime, command and measured
results in the experiment log when an authorized model check actually runs.
