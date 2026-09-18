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

## First real-use check, not yet executed

After the copied Vault is opened and the plugin/model is configured, use one
question about clear work reports and productive meetings. Require clickable
citations and distinguish quoted chapter material from the note author's modern
management recommendations. Chapters 10 and 16 provide concrete source anchors;
modern examples must not be attributed to the historical text.

This is fixture preparation and deterministic integrity verification, not a
model experiment. Record configuration/data hashes, runtime, command and measured
results in the experiment log when an authorized model check actually runs.
