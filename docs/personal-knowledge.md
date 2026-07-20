# Personal Knowledge Studio

Knowledge Studio is the Windows desktop workspace for the personal knowledge system being built into this Copilot fork. It is designed to make long-running ingestion, multi-file review, and recoverable knowledge maintenance understandable before any generated page is written.

## Platform and availability

The Knowledge Studio view and ribbon entry are available only in Obsidian Desktop on Windows. Open it from the library icon in the ribbon or run **Open Knowledge Studio** from the command palette. The command remains registered on other platforms so it can explain that the feature is unsupported; it does not open the Studio there.

The rest of Copilot keeps its existing platform support. The plugin manifest therefore remains compatible with mobile and other desktop systems; the Knowledge Studio view and navigation are not registered outside Windows. This avoids disabling Chat for existing users while the new filesystem and recovery adapters are deliberately tested on Windows first.

The current milestone exposes a fail-closed Studio shell and the review/activity foundations. On supported Windows desktop installations, the plugin now attempts to initialize and validate a private `knowledge-runtime-v1.json` state foundation beside the plugin files. The filename remains stable while its internal format is explicitly versioned. The real ingest, review recovery, compiler, file-apply, and query coordinators are not connected to the Studio, so availability remains **Adapter unavailable**: it shows no fabricated jobs, does not call a model, and cannot change knowledge files.

The internal safety core now carries a complete, content-addressed Manifest plan from compilation through durable review; the plan-bound final intent and plan digest then enter the transaction journal. Review filtering or content edits produce a new exact final projection instead of guessing from only the files that changed. Before the transaction may write a Wiki page, the runtime atomically reserves the exact Manifest revision, the journal-bound source hash/pipeline/input revision, ownership, and the previous successful source revision. After page commit, the Manifest success and its replay ledger are published together; an exact retry is a no-op, while conflicting identity fails closed. Startup also cross-checks the Manifest, reserved commit metadata, latest ledger proof, and shared-page co-owner state. Shared pages update every recorded co-owner hash in that same operation. These guarantees are implemented and tested as foundations, but they do not make the unavailable Studio workflow usable yet.

The runtime foundation has automated contract and filesystem tests, but it has not yet passed acceptance inside a real Windows Obsidian test Vault. In particular, Obsidian process serialization, plugin reloads, external editor races, NTFS/OneDrive behavior, and crash persistence still need real-device verification. It must not be treated as production-ready durable storage yet.

## Activity

The following Activity behavior is implemented in the core and UI, but the unavailable Studio shell does not yet load real jobs. Activity is designed as a read-only projection of the durable ingest queue. It distinguishes parsing, analysis, association, generation, validation, review, apply, and final commit acknowledgement.

- **Pause** and **Resume** control whether the Bundle may start new work or accept a review. A transaction already applying is allowed to reach its recoverable commit boundary and is not interrupted halfway.
- **Cancel**, **Retry**, and **Review** are shown only when the selected job allows them.
- A job awaiting review cannot use generic **Cancel**. It must be accepted or durably rejected from Review so its proposal outcome and any retained rerun stay consistent.
- A job being applied cannot be cancelled from the Activity panel.
- A committed job remains **Finalizing** until its durable commit marker has been acknowledged. It is not shown as completed early.
- A divergent interrupted write is shown as **Recovery required** and automatic writes remain blocked. This milestone shows the blocker but does not yet expose revalidate, continue, rollback, or abandon actions.

Activity notifications only request a fresh durable read. They never promote a job optimistically.

## Change review

The following Review behavior is implemented in the core and UI, but it is not yet connected to a live Windows workflow. Review presents one proposed ChangeSet across all of its files. Create and update proposals can be accepted exactly, rejected, or decided block by block. Batch actions still respect every file's capability: **Accept all** cannot override a blocked target.

The review surface sends only content-addressed snapshot identity plus opaque ChangeSet, file, and block identifiers back to the core. It never sends file paths, edited content, file before/after hashes, validation flags, or a claimed status. The core reconstructs the exact selected content, recalculates hashes, and runs deterministic validation again.

The complete proposal is persisted in the Review Store before the queue can wait for review. Accept or Reject then persists an exact terminal Review Store record before the queue changes state. Refreshing the same acceptance while its apply claim is still active is safe and does not create another claim; a conflicting receipt is blocked. After an apply is fully finalized, a late acceptance is not applied again and will be handled by the future Review/Manifest reconciliation flow.

Delete proposals are visible with a danger explanation but are rejection-only in this milestone. The Windows file store advertises `delete: false`; it can recognize an already-missing replay or a conflicting third state, but it never performs a delete. Manifest ownership, source provenance, and last-generated hashes are now journaled and revalidated, but delete acceptance stays disabled until a safe compare-and-delete implementation and the remaining schema/link/source-artifact dependencies are also revalidated immediately before write and recovery.

Rejecting a proposal does not create an empty accepted ChangeSet and does not write files. Its durable rejection identity remains available for safe retry and audit.

## What comes next

Startup reconciliation for persisted pending and rejected reviews now exists as an isolated safety core, but it is not connected to plugin startup yet. Accepted reviews are never applied automatically during startup; only their identity is passed onward for transaction, queue, and success-ledger classification. The full accepted content must be reloaded and rechecked before a future explicit recovery action.

Only a provably idle legacy runtime is upgraded automatically. A legacy file containing active/recovery work, prior Manifest success, or reserved commit metadata is kept byte-for-byte and loading fails closed rather than guessing it into the new format; a user-facing recovery path is still future work.

The next implementation steps are plugin workflow wiring, atomic reproof of the exact Queue/Review identity and source high-watermark at the final commit boundary, explicit no-journal apply recovery, durable `no_changes` success semantics, the remaining schema/link/source-artifact read-set, coordinated history retention, real parser/provider/compiler adapters, Chat's **Add to Knowledge** entry, grounded query/citation navigation, and end-to-end testing in a dedicated Windows Vault. The Studio should not be treated as a finished ingestion workflow until those integrations and tests are complete.
