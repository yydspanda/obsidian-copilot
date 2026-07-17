# Personal Knowledge Studio

Knowledge Studio is the Windows desktop workspace for the personal knowledge system being built into this Copilot fork. It is designed to make long-running ingestion, multi-file review, and recoverable knowledge maintenance understandable before any generated page is written.

## Platform and availability

The Knowledge Studio view and ribbon entry are available only in Obsidian Desktop on Windows. Open it from the library icon in the ribbon or run **Open Knowledge Studio** from the command palette. The command remains registered on other platforms so it can explain that the feature is unsupported; it does not open the Studio there.

The rest of Copilot keeps its existing platform support. The plugin manifest therefore remains compatible with mobile and other desktop systems; the Knowledge Studio view and navigation are not registered outside Windows. This avoids disabling Chat for existing users while the new filesystem and recovery adapters are deliberately tested on Windows first.

The current milestone exposes a fail-closed Studio shell and the review/activity foundations. Until the durable Windows Vault adapters are connected, the Studio says that its adapter is unavailable, shows no fabricated jobs, does not call a model, and cannot change Vault files.

## Activity

Activity is a read-only projection of the durable ingest queue. It distinguishes parsing, analysis, association, generation, validation, review, apply, and final commit acknowledgement.

- **Pause** and **Resume** control whether the Bundle may start new work or accept a review. A transaction already applying is allowed to reach its recoverable commit boundary and is not interrupted halfway.
- **Cancel**, **Retry**, and **Review** are shown only when the selected job allows them.
- A job awaiting review cannot use generic **Cancel**. It must be accepted or durably rejected from Review so its proposal outcome and any retained rerun stay consistent.
- A job being applied cannot be cancelled from the Activity panel.
- A committed job remains **Finalizing** until its durable commit marker has been acknowledged. It is not shown as completed early.
- A divergent interrupted write is shown as **Recovery required** and automatic writes remain blocked. This milestone shows the blocker but does not yet expose revalidate, continue, rollback, or abandon actions.

Activity notifications only request a fresh durable read. They never promote a job optimistically.

## Change review

Review presents one proposed ChangeSet across all of its files. Create and update proposals can be accepted exactly, rejected, or decided block by block. Batch actions still respect every file's capability: **Accept all** cannot override a blocked target.

The review surface sends only content-addressed snapshot identity plus opaque ChangeSet, file, and block identifiers back to the core. It never sends file paths, edited content, file before/after hashes, validation flags, or a claimed status. The core reconstructs the exact selected content, recalculates hashes, and runs deterministic validation again.

The complete proposal is persisted in the Review Store before the queue can wait for review. Accept or Reject then persists an exact terminal Review Store record before the queue changes state. Refreshing the same acceptance while its apply claim is still active is safe and does not create another claim; a conflicting receipt is blocked. After an apply is fully finalized, a late acceptance is not applied again and will be handled by the future Review/Manifest reconciliation flow.

Delete proposals are visible with a danger explanation but are rejection-only in this milestone. Delete acceptance stays disabled until manifest ownership, source provenance, and last-generated hashes are part of the transaction's journaled read-set and are revalidated immediately before write and recovery.

Rejecting a proposal does not create an empty accepted ChangeSet and does not write files. Its durable rejection identity remains available for safe retry and audit.

## What comes next

The next implementation steps are the atomic Windows/Vault storage adapters, startup reconciliation of persisted reviews, explicit no-journal apply recovery, coordinated history retention, real compiler orchestration, Chat's **Add to Knowledge** entry, grounded query/citation navigation, and end-to-end testing in a dedicated Windows Vault. The Studio should not be treated as a finished ingestion workflow until those adapters and tests are complete.
