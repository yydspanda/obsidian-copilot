import * as z from "zod";

import {
  createTransactionCommitReceipt,
  createTransactionCommitReceiptDigest,
  transactionCommitReceiptMatchesJournal,
  type ChangeSetTransactionApplyInput,
  type ChangeSetTransactionAuthorityProof,
  type ChangeSetTransactionAuthorityPort,
  type ChangeSetTransactionAuthorityRequest,
  type TransactionCommitReceipt,
} from "@/knowledge/changeset/ChangeSetTransaction";
import type {
  ApplyCommitManifestPort,
  CommittedChangeSetTransactionJournal,
} from "@/knowledge/changeset/ApplyCommitCoordinator";
import { deriveKnowledgeSourceCompileAuthority } from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  createKnowledgeForwardRevisionApplyJournalDigest,
  createKnowledgeForwardRevisionPreparedApplyJournal,
  parseKnowledgeForwardRevisionApplyJournal,
  projectKnowledgeForwardRevisionApplyJournalApplying,
  projectKnowledgeForwardRevisionApplyJournalCommitted,
  projectKnowledgeForwardRevisionApplyJournalRecoveryRequired,
  projectKnowledgeForwardRevisionRecoveryJournalCommitted,
  snapshotKnowledgeForwardRevisionApplyJournal,
  type KnowledgeForwardRevisionApplyJournalV1,
  type KnowledgeForwardRevisionPreparedApplyJournalV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyJournal";
import {
  createKnowledgeForwardRevisionApplyLedgerIdentityDigest,
  createKnowledgeForwardRevisionApplyLedgerRecord,
  migrateKnowledgeForwardRevisionApplyLedgerRecordV1,
  parseKnowledgeForwardRevisionApplyLedgerRecord,
  snapshotKnowledgeForwardRevisionApplyLedgerRecord,
  snapshotKnowledgeForwardRevisionApplyLedgerRecordV1,
  snapshotKnowledgeForwardRevisionApplyLedgerRecordForCommittedJournal,
  type KnowledgeForwardRevisionApplyLedgerRecord,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyLedger";
import {
  createKnowledgeForwardRevisionAbandonmentRecord,
  createKnowledgeForwardRevisionAcceptedClaimIdentity,
  createKnowledgeForwardRevisionExternalObservation,
  createKnowledgeForwardRevisionLedgerLineageRef,
  createKnowledgeForwardRevisionLifecycleResourceIdentity,
  createKnowledgeForwardRevisionRecoveryJournalRef,
  createKnowledgeForwardRevisionRecoveryTerminalRecord,
  createKnowledgeForwardRevisionSupersessionRecord,
  parseKnowledgeForwardRevisionAbandonmentRecord,
  parseKnowledgeForwardRevisionRecoveryTerminalRecord,
  parseKnowledgeForwardRevisionSupersessionRecord,
  snapshotKnowledgeForwardRevisionAcceptedClaimIdentity,
  snapshotKnowledgeForwardRevisionAbandonmentRecord,
  snapshotKnowledgeForwardRevisionRecoveryTerminalRecord,
  snapshotKnowledgeForwardRevisionSupersessionRecord,
  type KnowledgeForwardRevisionAbandonmentRecordV1,
  type KnowledgeForwardRevisionRecoveryTerminalRecordV1,
  type KnowledgeForwardRevisionSupersessionRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionLifecycleTerminal";
import { snapshotKnowledgeForwardRevisionRecoveryTerminalTransition } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionRecoveryTerminalTransition";
import {
  createKnowledgeForwardRevisionSourceBase,
  createKnowledgeForwardRevisionSourceBaseDigest,
  snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision,
  snapshotKnowledgeForwardRevisionSourceBase,
  type KnowledgeForwardRevisionSourceBaseV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyRevalidation";
import {
  captureForwardApplyRecord,
  freezeForwardApplyJson,
  isForwardApplyDigest,
  isForwardApplyIdentifier,
  isForwardApplyNonNegativeInteger,
  isForwardApplyPositiveInteger,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import {
  type KnowledgeForwardRevisionPendingProposalRecordV1,
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPublicationReceipt,
  createKnowledgeForwardRevisionRequest,
  type KnowledgeForwardRevisionHistoricalReviewAuthority,
  type KnowledgeForwardRevisionPublicationReceiptV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { snapshotKnowledgeForwardRevisionReviewSnapshot } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshot";
import {
  KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS,
  createEmptyKnowledgeForwardRevisionReviewSnapshotV2,
  createKnowledgeForwardRevisionPendingReviewEntryV2,
  createKnowledgeForwardRevisionTerminalReviewEntryV2,
  migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2,
  parseKnowledgeForwardRevisionReviewSnapshotV2,
  projectKnowledgeForwardRevisionReviewEntryProposalV2,
  snapshotKnowledgeForwardRevisionReviewSnapshotV2,
  type KnowledgeForwardRevisionReviewEntryV2,
  type KnowledgeForwardRevisionTerminalReviewEntryV2,
  type KnowledgeForwardRevisionReviewSnapshotV2,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewSnapshotV2";
import {
  projectKnowledgeForwardRevisionStudioSnapshot,
  type KnowledgeForwardRevisionStudioSnapshot,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioProjection";
import {
  createKnowledgeForwardRevisionAcceptedDecisionRecord,
  createKnowledgeForwardRevisionRejectedDecisionRecord,
  createKnowledgeForwardRevisionTerminalDecisionRecordDigest,
  snapshotKnowledgeForwardRevisionAcceptedDecisionRecord,
  type KnowledgeForwardRevisionAcceptedDecisionRecordV1,
  type KnowledgeForwardRevisionTerminalDecisionRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  createKnowledgeForwardRevisionIntentDigest,
  createKnowledgeForwardRevisionIntent,
  snapshotKnowledgeForwardRevisionIntent,
  type KnowledgeForwardRevisionIntent,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import {
  createKnowledgeForwardRevisionValidationAuthorityQuery,
  createKnowledgeForwardRevisionValidationAuthority,
  snapshotKnowledgeForwardRevisionValidationAuthorityQuery,
  type KnowledgeForwardRevisionValidationAuthorityQueryV1,
  type KnowledgeForwardRevisionValidationAuthorityV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationAuthority";
import {
  KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION,
  snapshotKnowledgeForwardRevisionProposalAuthorityQuery,
  type KnowledgeForwardRevisionProposalAuthorityQueryV1,
  type KnowledgeForwardRevisionProposalAuthorityV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalAuthority";
import type { KnowledgeForwardRevisionAcceptanceAuthority } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
import {
  createKnowledgeForwardRevisionReviewCommandDigest,
  snapshotKnowledgeForwardRevisionReviewCommand,
  snapshotKnowledgeForwardRevisionReviewCommandForProposal,
  type KnowledgeForwardRevisionReviewCommandV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  KnowledgeForwardRevisionValidationCapability,
  type KnowledgeForwardRevisionValidationCapabilityProjectionV1,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator";
import {
  KnowledgeForwardRevisionApplyCapability,
  KnowledgeForwardRevisionApplyTransitionCapability,
  type KnowledgeForwardRevisionApplyCapabilityProjectionV1,
  type KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionApplyCoordinator";
import {
  TransactionStorageRevisionConflictError,
  TransactionStorageAuthorityError,
  createChangeSetTransactionDigest,
  createChangeSetTransactionJournalDigest,
  parseChangeSetTransactionJournal,
  validateChangeSetTransactionJournal,
  type ChangeSetTransactionJournal,
  type TransactionJobClaim,
  type TransactionStorage,
  type TransactionStorageToken,
} from "@/knowledge/changeset/TransactionStorage";
import type {
  AllocateSourceInputRevisionRequest,
  BindSourceInputObservationRequest,
  BindSourceInputObservationResult,
  BoundSourceInputObservation,
  SourceInputObservationBinder,
  SourceInputObservationRecoveryWork,
  SourceInputObservationSettlement,
  SourceInputRevisionAllocation,
  SourceInputRevisionAllocator,
} from "@/knowledge/ingest/InputRevisionAllocator";
import {
  ingestExecutionClaimMatchesQueueStorage,
  type IngestExecutionClaim,
} from "@/knowledge/ingest/queue/IngestQueue";
import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  consumeKnowledgeProductionWorkflowExecutionRuntimeClaim,
  KnowledgeProductionWorkflowExecutionRuntimeBinding,
  KnowledgeProductionWorkflowExecutionRuntimeClaim,
  KnowledgeProductionWorkflowExecutionLease,
} from "@/knowledge/startup/KnowledgeProductionWorkflowExecutionLease";
import {
  KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION,
  verifyKnowledgeIngestExecutionProofRequest,
  type KnowledgeIngestExecutionProof,
  type KnowledgeIngestExecutionProofPort,
  type KnowledgeIngestExecutionProofRequest,
} from "@/knowledge/ingest/KnowledgeIngestExecutionProof";
import {
  INGEST_QUEUE_VERSION,
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  validateIngestQueueSnapshot,
  type IngestApplyAbandonment,
  type IngestApplyClaimMarker,
  type IngestQueueSnapshot,
  type IngestSourceHighWatermark,
  type QueueWriteAuthority,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  createManifestCommitIntentDigest,
  createSourceManifestDigest,
  parseManifestCommitIntent,
  validateManifestCommitIntent,
  validateManifestCommitIntentForCommit,
  type ManifestCommitPage,
  type ManifestCommitIntent,
} from "@/knowledge/manifest/ManifestCommitIntent";
import {
  KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY,
  createKnowledgeNoChangesCommitMarker,
  createNoChangesManifestCommitPlanDigest,
  parseKnowledgeNoChangesCommitMarker,
  parseNoChangesManifestCommitPlan,
  validateNoChangesManifestCommitMarker,
  validateNoChangesManifestCommitPlan,
  type NoChangesManifestCommitMarker,
} from "@/knowledge/manifest/NoChangesManifestCommit";
import {
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  parseKnowledgeRuntimeSourceCommitExtension,
  type KnowledgeRuntimeSourceCommitExtension,
} from "@/knowledge/manifest/KnowledgeRuntimeSourceCommit";
import {
  KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY,
  createKnowledgeSourceRetirementRecord,
  findKnowledgeSourceHistoryEntry,
  findKnowledgeSourceRetirement,
  listKnowledgeSourceHistoryEntries,
  parseKnowledgeSourceRetirements,
  projectKnowledgeSourceRetirement,
  type KnowledgeSourceRetirementReason,
  type KnowledgeSourceRetirementRecord,
} from "@/knowledge/manifest/SourceRetirement";
import {
  KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY,
  createKnowledgeForwardRevisionOverlayEntry,
  parseKnowledgeForwardRevisionOverlayExtension,
  projectKnowledgeForwardRevisionOverlayAddition,
  projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit,
  type KnowledgeForwardRevisionOverlayEntry,
} from "@/knowledge/manifest/KnowledgeForwardRevisionOverlay";
import {
  projectKnowledgeEffectiveManifestPages,
  type KnowledgeEffectiveManifestPage,
} from "@/knowledge/manifest/KnowledgeEffectivePageProjection";
import {
  SourceManifestRevisionConflictError,
  type SourceManifestStorage,
} from "@/knowledge/manifest/SourceManifestStorage";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  parseKnowledgeBundleConfig,
  parseKnowledgeChangeSet,
  parseSourceManifest,
} from "@/knowledge/model/schemas";
import type {
  ClaimCitation,
  GeneratedPageOwnership,
  GeneratedPageReference,
  JsonValue,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeIngestJob,
  SourceCustody,
  SourceCompileSnapshot,
  SourceManifest,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
  validateSourceManifest,
} from "@/knowledge/model/validation";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  createNoJournalApplyRecoveryReference,
  type NoJournalApplyAbandonReceipt,
  type NoJournalApplyRecoveryCandidate,
  type NoJournalApplyRecoveryClassification,
  type NoJournalApplyRecoveryReference,
  type NoJournalApplyRecoverySnapshotLoadResult,
  type NoJournalApplyRecoverySnapshotPort,
  type NoJournalApplyRecoveryStatePort,
} from "@/knowledge/recovery/NoJournalApplyRecovery";
import {
  parseKnowledgeStartupReleaseRequest,
  type KnowledgeStartupReleasePort,
  type KnowledgeStartupReleaseRequest,
  type KnowledgeStartupReleaseResult,
} from "@/knowledge/recovery/KnowledgeStartupRelease";
import type { AcceptedReviewStartupIdentity } from "@/knowledge/review/ReviewQueueStartupReconciler";
import {
  CHANGESET_REVIEW_SNAPSHOT_VERSION,
  ReviewStorageAcceptanceBlockedError,
  ReviewStorageRevisionConflictError,
  parseChangeSetReviewSnapshot,
  validateChangeSetReviewSnapshot,
  type AcceptedChangeSetReviewRecord,
  type ChangeSetReviewSnapshot,
  type ReviewStorage,
} from "@/knowledge/review/ReviewStorage";
import {
  parseKnowledgeLiteralRejectCommand,
  projectKnowledgeReviewRejection,
  type KnowledgeLiteralRejectCommand,
  type KnowledgeReviewRejectTransitionReceipt,
} from "@/knowledge/review/ReviewRejectTransition";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KNOWLEDGE_RUNTIME_SOURCE_FRESHNESS_AUTHORITY_VERSION,
  type KnowledgeRuntimeAppliedFreshnessAuthority,
  type KnowledgeRuntimeFreshnessGeneratedPage,
  type KnowledgeRuntimeNoChangesFreshnessAuthority,
  type KnowledgeRuntimeSourceFreshnessAuthority,
  type KnowledgeRuntimeSourceFreshnessAuthorityPort,
} from "@/knowledge/runtime/KnowledgeRuntimeSourceFreshness";
import {
  KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS,
  KnowledgeKnownAppliedWikiOutputLimitError,
  KnowledgeKnownAppliedWikiOutputProjectionError,
  knowledgeApplyLedgerMatchesAcceptedRecord as ledgerMatchesAcceptedRecord,
  projectKnowledgeKnownAppliedWikiOutputDetail,
  projectKnowledgeKnownAppliedWikiOutputIndex,
  type KnowledgeKnownAppliedWikiOutputAuthorityIdentity,
  type KnowledgeKnownAppliedWikiCurrentPage,
  type KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot,
  type KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot,
} from "@/knowledge/runtime/KnowledgeKnownAppliedWikiOutputProjector";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_RUNTIME_STORE_VERSION = 9 as const;

export { KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY };

const RUNTIME_V5_STORE_VERSION = 5 as const;

const RUNTIME_V6_STORE_VERSION = 6 as const;

const RUNTIME_V7_STORE_VERSION = 7 as const;

const RUNTIME_V8_STORE_VERSION = 8 as const;

const RUNTIME_V4_STORE_VERSION = 4 as const;

const PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION = 3 as const;

const RUNTIME_V2_STORE_VERSION = 2 as const;

const LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION = 1 as const;

interface KnowledgeRuntimeBundleSlot {
  bundleId: string;
  value: object;
}

export type KnowledgeRuntimeSourceObservationRecord =
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "allocated";
    }
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "bound";
      sourceContentHash: string;
      pipelineFingerprint: string;
      boundAt: number;
    }
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "consumed";
      sourceContentHash: string;
      pipelineFingerprint: string;
      boundAt: number;
      settledAt: number;
      queueRevision: number;
    }
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "superseded";
      sourceContentHash?: string;
      pipelineFingerprint?: string;
      boundAt?: number;
      settledAt: number;
      supersededByInputRevision: number;
    }
  | {
      observationToken: string;
      captureId: string;
      inputRevision: number;
      allocatedAt: number;
      status: "retired";
      sourceContentHash?: string;
      pipelineFingerprint?: string;
      boundAt?: number;
      settledAt: number;
      retirementId: string;
    };

export interface KnowledgeRuntimeInputRevisionRecord {
  sourceId: string;
  inputRevision: number;

  managedAfterRevision: number;

  legacyCheckpoint?: IngestSourceHighWatermark;
  observations: KnowledgeRuntimeSourceObservationRecord[];
}

interface KnowledgeRuntimeInputRevisionBundle {
  bundleId: string;
  sources: KnowledgeRuntimeInputRevisionRecord[];
}

export interface KnowledgeApplyCommitLedgerRecord {
  transactionId: string;
  commitRevision: number;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  inputRevision: number;
  changeSetId: string;
  changeSetDigest: string;
  manifestIntentDigest: string;
  journalDigest: string;
  receiptDigest: string;
  manifestBeforeRevision: number;
  manifestBeforeDigest: string;
  manifestAfterRevision: number;
  manifestAfterDigest: string;
  recordedAt: number;
}

export interface KnowledgeRuntimeStoreSnapshot {
  version: typeof KNOWLEDGE_RUNTIME_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  forwardRevisionReviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  activeForwardRevisionApply: KnowledgeForwardRevisionApplyJournalV1 | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
  forwardRevisionApplyCommits: KnowledgeForwardRevisionApplyLedgerRecord[];
  forwardRevisionSupersessions: KnowledgeForwardRevisionSupersessionRecordV1[];
  forwardRevisionAbandonments: KnowledgeForwardRevisionAbandonmentRecordV1[];
  forwardRevisionRecoveryTerminals: KnowledgeForwardRevisionRecoveryTerminalRecordV1[];
}

interface KnowledgeRuntimeStoreSnapshotV8 {
  version: typeof RUNTIME_V8_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  forwardRevisionReviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  activeForwardRevisionApply: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
  forwardRevisionApplyCommits: object[];
}

interface KnowledgeRuntimeStoreSnapshotV7 {
  version: typeof RUNTIME_V7_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  forwardRevisionReviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

interface KnowledgeRuntimeStoreSnapshotV6 {
  version: typeof RUNTIME_V6_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  forwardRevisionReviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

interface KnowledgeRuntimeStoreSnapshotV5 {
  version: typeof RUNTIME_V5_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

interface KnowledgeRuntimeStoreSnapshotV4 {
  version: typeof RUNTIME_V4_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

export interface KnowledgeRuntimeStudioBundleSnapshot {
  bundleId: string;
  runtimeRevision: number;
  queue: IngestQueueSnapshot;
  review: ChangeSetReviewSnapshot;

  completionOutcomes?: Readonly<Record<string, KnowledgeRuntimeJobCompletion>>;

  reanalyzableJobIds?: readonly string[];
}

export interface KnowledgeCompletedSourceReanalysisCommand {
  bundleId: string;
  jobId: string;
  expectedQueueRevision: number;
}

export type KnowledgeRuntimeJobCompletion =
  | Readonly<{ kind: "applied" }>
  | Readonly<{
      kind: "no_changes";
      reason: NoChangesManifestCommitMarker["reason"];
      generationOutcomes?: Readonly<
        NonNullable<NoChangesManifestCommitMarker["generationOutcomes"]>
      >;
    }>;

export interface KnowledgeRuntimeAppliedSourceProvenance {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly custody: SourceCustody;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly acceptedAt: number;
  readonly citations: readonly Readonly<ClaimCitation>[];
}

export interface KnowledgeRuntimeAppliedPageProvenance {
  readonly path: string;
  readonly windowsPathKey: string;
  readonly ownership: GeneratedPageOwnership;
  readonly sourceAppliedContentHash: string;
  readonly effectiveContentHash: string;

  readonly contentHash: string;
  readonly origin: Readonly<KnowledgeEffectiveManifestPage["origin"]>;
  readonly sources: readonly Readonly<KnowledgeRuntimeAppliedSourceProvenance>[];
}

export interface KnowledgeRuntimeAppliedProvenanceSnapshot {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly pages: readonly Readonly<KnowledgeRuntimeAppliedPageProvenance>[];
}

export type KnowledgeSourceRetirementBlocker =
  | "active_transaction"
  | "forward_revision_overlay_active"
  | "bundle_work_active"
  | "bundle_rerun_pending"
  | "bundle_review_pending"
  | "bundle_apply_pending"
  | "bundle_apply_recovery_required"
  | "source_observation_pending"
  | "revision_overflow";

export interface KnowledgeSourceRetirementCandidate {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly custody: SourceCustody;
  readonly generatedPageCount: number;
  readonly status: "ready" | "blocked";
  readonly expectedToken: string;
  readonly blockers: readonly KnowledgeSourceRetirementBlocker[];
}

export interface KnowledgeSourceRetirementCandidateSnapshot {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly candidates: readonly KnowledgeSourceRetirementCandidate[];
}

export interface KnowledgeSourceRetirementCommand {
  version: 1;
  bundleId: string;
  sourceId: string;
  expectedToken: string;
  reason: KnowledgeSourceRetirementReason;
  confirm: {
    keepWikiFiles: true;
    revokeProvenance: true;
    reserveIdentity: true;
  };
}

export interface KnowledgeSourceRetirementReceipt {
  outcome: "retired" | "already_retired";
  bundleId: string;
  sourceId: string;
  sourcePath: string;
  custody: SourceCustody;
  retirementId: string;
  retiredAt: number;
  manifestRevision: number;
  runtimeRevision: number;
  generatedPages: readonly Readonly<GeneratedPageReference>[];
}

export interface KnowledgeRuntimeReviewRejectReceipt extends KnowledgeReviewRejectTransitionReceipt {
  runtimeRevision: number;
}

export interface KnowledgeForwardRevisionProposalPublicationEvidence {
  readonly intent: unknown;
  readonly intentDigest: string;
  readonly historicalReviewAuthority: unknown;
  readonly selectedContent: string;
  readonly selectedContentHash: string;
  readonly vaultObservedBeforeHash: string;
}

export interface KnowledgeForwardRevisionApplyAuthorityQuery {
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
}

export interface KnowledgeForwardRevisionApplyAuthority {
  readonly query: Readonly<KnowledgeForwardRevisionApplyAuthorityQuery>;
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly forwardReviewStoreRevision: number;
  readonly decisionStoreRevision: number;
  readonly acceptedDecision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>;
  readonly acceptedDecisionDigest: string;
  readonly sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>;
  readonly sourceBaseDigest: string;
  readonly lineageAppliedAtFloor: number;
  readonly manifestRevision: number;
  readonly manifestDigest: string;
}

const FORWARD_REVISION_APPLY_AUTHORITY_QUERY_KEYS = [
  "runtimeId",
  "bundleId",
  "pagePath",
  "proposalId",
  "proposalDigest",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
] as const;

const FORWARD_REVISION_APPLY_AUTHORITY_KEYS = [
  "query",
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "forwardReviewStoreRevision",
  "decisionStoreRevision",
  "acceptedDecision",
  "acceptedDecisionDigest",
  "sourceBase",
  "sourceBaseDigest",
  "lineageAppliedAtFloor",
  "manifestRevision",
  "manifestDigest",
] as const;

export function snapshotKnowledgeForwardRevisionApplyAuthorityQuery(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyAuthorityQuery> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== FORWARD_REVISION_APPLY_AUTHORITY_QUERY_KEYS.length ||
      keys.some((key) => typeof key !== "string") ||
      FORWARD_REVISION_APPLY_AUTHORITY_QUERY_KEYS.some((key) => !keys.includes(key))
    ) {
      throw new TypeError();
    }
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError();
      captured[key] = descriptor.value;
    }
    const parsedPath =
      typeof captured.pagePath === "string" ? parseVaultPath(captured.pagePath) : undefined;
    if (
      typeof captured.runtimeId !== "string" ||
      !opaqueIdSchema.safeParse(captured.runtimeId).success ||
      !isForwardApplyIdentifier(captured.bundleId) ||
      !parsedPath?.ok ||
      parsedPath.path !== captured.pagePath ||
      captured.pagePath.length > 1_024 ||
      !isForwardApplyIdentifier(captured.proposalId) ||
      !isForwardApplyDigest(captured.proposalDigest) ||
      !isForwardApplyDigest(captured.acceptedDecisionDigest) ||
      !isForwardApplyIdentifier(captured.applyClaimId) ||
      !isForwardApplyDigest(captured.applyClaimDigest)
    ) {
      throw new TypeError();
    }
    return Object.freeze({
      runtimeId: captured.runtimeId,
      bundleId: captured.bundleId,
      pagePath: captured.pagePath,
      proposalId: captured.proposalId,
      proposalDigest: captured.proposalDigest,
      acceptedDecisionDigest: captured.acceptedDecisionDigest,
      applyClaimId: captured.applyClaimId,
      applyClaimDigest: captured.applyClaimDigest,
    });
  } catch {
    throw new TypeError("Forward revision Apply authority query is invalid");
  }
}

export function snapshotKnowledgeForwardRevisionApplyAuthority(
  value: unknown,
  expectedQueryValue?: unknown
): Readonly<KnowledgeForwardRevisionApplyAuthority> {
  try {
    const record = captureForwardApplyRecord(value, FORWARD_REVISION_APPLY_AUTHORITY_KEYS);
    if (
      !record ||
      !opaqueIdSchema.safeParse(record.runtimeId).success ||
      !isForwardApplyPositiveInteger(record.runtimeRevision) ||
      !isForwardApplyDigest(record.runtimeDigest) ||
      !isForwardApplyPositiveInteger(record.forwardReviewStoreRevision) ||
      !isForwardApplyPositiveInteger(record.decisionStoreRevision) ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyDigest(record.sourceBaseDigest) ||
      !isForwardApplyNonNegativeInteger(record.lineageAppliedAtFloor) ||
      !isForwardApplyPositiveInteger(record.manifestRevision) ||
      !isForwardApplyDigest(record.manifestDigest)
    ) {
      throw new TypeError();
    }
    const query = snapshotKnowledgeForwardRevisionApplyAuthorityQuery(record.query);
    if (expectedQueryValue !== undefined) {
      const expectedQuery = snapshotKnowledgeForwardRevisionApplyAuthorityQuery(expectedQueryValue);
      if (canonicalizeJson(query) !== canonicalizeJson(expectedQuery)) throw new TypeError();
    }
    const acceptedDecision = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(
      record.acceptedDecision
    );
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(record.sourceBase);
    const sourceFreshness = sourceBase.currentSourceFreshness;
    const primarySourceId = acceptedDecision.proposal.request.intent.current.primarySourceId;
    if (
      record.runtimeId !== query.runtimeId ||
      record.runtimeId !== acceptedDecision.applyClaim.runtimeId ||
      record.runtimeId !== sourceFreshness.runtimeId ||
      record.runtimeRevision !== sourceFreshness.runtimeRevision ||
      record.runtimeDigest !== sourceFreshness.runtimeDigest ||
      record.manifestRevision !== sourceFreshness.manifestRevision ||
      record.manifestDigest !== sourceFreshness.manifestDigest ||
      record.decisionStoreRevision > record.forwardReviewStoreRevision ||
      record.acceptedDecisionDigest !== acceptedDecision.acceptedDecisionDigest ||
      record.sourceBaseDigest !== createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) ||
      query.bundleId !== acceptedDecision.proposal.request.bundleId ||
      query.bundleId !== acceptedDecision.applyClaim.bundleId ||
      query.bundleId !== sourceBase.bundleId ||
      query.pagePath !== acceptedDecision.proposal.request.pagePath ||
      query.pagePath !== acceptedDecision.applyClaim.pagePath ||
      query.proposalId !== acceptedDecision.proposal.proposalId ||
      query.proposalId !== acceptedDecision.applyClaim.proposalId ||
      query.proposalDigest !== acceptedDecision.proposalDigest ||
      query.proposalDigest !== acceptedDecision.applyClaim.proposalDigest ||
      query.acceptedDecisionDigest !== acceptedDecision.acceptedDecisionDigest ||
      query.applyClaimId !== acceptedDecision.applyClaim.claimId ||
      query.applyClaimDigest !== acceptedDecision.applyClaimDigest ||
      sourceBase.sourceId !== primarySourceId ||
      sourceFreshness.bundleId !== query.bundleId ||
      sourceFreshness.sourceId !== primarySourceId
    ) {
      throw new TypeError();
    }
    return freezeForwardApplyJson({
      query,
      runtimeId: record.runtimeId,
      runtimeRevision: record.runtimeRevision,
      runtimeDigest: record.runtimeDigest,
      forwardReviewStoreRevision: record.forwardReviewStoreRevision,
      decisionStoreRevision: record.decisionStoreRevision,
      acceptedDecision,
      acceptedDecisionDigest: record.acceptedDecisionDigest,
      sourceBase,
      sourceBaseDigest: record.sourceBaseDigest,
      lineageAppliedAtFloor: record.lineageAppliedAtFloor,
      manifestRevision: record.manifestRevision,
      manifestDigest: record.manifestDigest,
    });
  } catch {
    throw new TypeError("Forward revision Apply authority is invalid");
  }
}

export function createKnowledgeForwardRevisionApplyAuthorityDigest(value: unknown): string {
  const authority = snapshotKnowledgeForwardRevisionApplyAuthority(value);
  return sha256(
    `knowledge-forward-revision-apply-authority-v1\n${canonicalizeJson(
      authority as unknown as JsonValue
    )}`
  );
}

export type KnowledgeForwardRevisionPublicationConflictReason =
  | "request_invalid"
  | "intent_conflict"
  | "page_conflict"
  | "current_authority_changed"
  | "historical_authority_changed"
  | "source_busy"
  | "transaction_busy"
  | "recovery_required"
  | "resource_limit"
  | "revision_overflow";

export class KnowledgeForwardRevisionPublicationConflictError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly reason: KnowledgeForwardRevisionPublicationConflictReason
  ) {
    super("The forward revision proposal could not be published from current authority");
    this.name = "KnowledgeForwardRevisionPublicationConflictError";
    Object.freeze(this);
  }
}

interface PreviousKnowledgeRuntimeInputRevisionRecord {
  sourceId: string;
  inputRevision: number;
}

interface PreviousKnowledgeRuntimeInputRevisionBundle {
  bundleId: string;
  sources: PreviousKnowledgeRuntimeInputRevisionRecord[];
}

type RuntimeBundleCollection = "queues" | "reviews" | "manifests";
type StudioHintBundleCollection = RuntimeBundleCollection | "forwardRevisionReviews";

interface RuntimeMutation<T> {
  next?: KnowledgeRuntimeStoreSnapshot;
  value: T;
}

interface LegacyKnowledgeRuntimeStoreSnapshot {
  version: typeof LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: PreviousKnowledgeRuntimeInputRevisionBundle[];
  applyCommits: object[];
}

interface KnowledgeRuntimeStoreSnapshotV2 {
  version: typeof RUNTIME_V2_STORE_VERSION;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: PreviousKnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

interface PreviousKnowledgeRuntimeStoreSnapshot {
  version: typeof PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION;
  runtimeId: string;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

type KnowledgeRuntimeSemanticSnapshot =
  | KnowledgeRuntimeStoreSnapshot
  | KnowledgeRuntimeStoreSnapshotV7
  | KnowledgeRuntimeStoreSnapshotV6
  | KnowledgeRuntimeStoreSnapshotV5
  | KnowledgeRuntimeStoreSnapshotV4
  | PreviousKnowledgeRuntimeStoreSnapshot;

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const opaqueIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const sourceRetirementIdSchema = z.string().regex(/^knowledge-source-retirement-[a-f0-9]{64}$/);
const nonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();

const runtimeBundleSlotSchema: z.ZodType<KnowledgeRuntimeBundleSlot> = z
  .object({
    bundleId: nonEmptyStringSchema,
    value: z.record(z.string(), z.unknown()),
  })
  .strict();

const previousRuntimeInputRevisionRecordSchema: z.ZodType<PreviousKnowledgeRuntimeInputRevisionRecord> =
  z
    .object({
      sourceId: nonEmptyStringSchema,
      inputRevision: z.number().int().safe().positive(),
    })
    .strict();

const previousRuntimeInputRevisionBundleSchema: z.ZodType<PreviousKnowledgeRuntimeInputRevisionBundle> =
  z
    .object({
      bundleId: nonEmptyStringSchema,
      sources: z.array(previousRuntimeInputRevisionRecordSchema),
    })
    .strict();

const runtimeAllocatedObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("allocated"),
  })
  .strict();

const runtimeBoundObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("bound"),
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    boundAt: nonNegativeSafeIntegerSchema,
  })
  .strict();

const runtimeConsumedObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("consumed"),
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    boundAt: nonNegativeSafeIntegerSchema,
    settledAt: nonNegativeSafeIntegerSchema,
    queueRevision: z.number().int().safe().positive(),
  })
  .strict();

const runtimeSupersededObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("superseded"),
    sourceContentHash: sha256Schema.optional(),
    pipelineFingerprint: sha256Schema.optional(),
    boundAt: nonNegativeSafeIntegerSchema.optional(),
    settledAt: nonNegativeSafeIntegerSchema,
    supersededByInputRevision: z.number().int().safe().positive(),
  })
  .strict();

const runtimeRetiredObservationSchema = z
  .object({
    observationToken: opaqueIdSchema,
    captureId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    allocatedAt: nonNegativeSafeIntegerSchema,
    status: z.literal("retired"),
    sourceContentHash: sha256Schema.optional(),
    pipelineFingerprint: sha256Schema.optional(),
    boundAt: nonNegativeSafeIntegerSchema.optional(),
    settledAt: nonNegativeSafeIntegerSchema,
    retirementId: sourceRetirementIdSchema,
  })
  .strict();

const runtimeSourceObservationSchema: z.ZodType<KnowledgeRuntimeSourceObservationRecord> =
  z.discriminatedUnion("status", [
    runtimeAllocatedObservationSchema,
    runtimeBoundObservationSchema,
    runtimeConsumedObservationSchema,
    runtimeSupersededObservationSchema,
    runtimeRetiredObservationSchema,
  ]);

const runtimeInputRevisionRecordSchema: z.ZodType<KnowledgeRuntimeInputRevisionRecord> = z
  .object({
    sourceId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
    managedAfterRevision: nonNegativeSafeIntegerSchema,
    legacyCheckpoint: z
      .object({
        sourceId: nonEmptyStringSchema,
        sourceContentHash: sha256Schema,
        pipelineFingerprint: sha256Schema,
        inputRevision: z.number().int().safe().positive(),
        observedAt: nonNegativeSafeIntegerSchema,
      })
      .strict()
      .optional(),
    observations: z.array(runtimeSourceObservationSchema),
  })
  .strict();

const runtimeInputRevisionBundleSchema: z.ZodType<KnowledgeRuntimeInputRevisionBundle> = z
  .object({
    bundleId: nonEmptyStringSchema,
    sources: z.array(runtimeInputRevisionRecordSchema),
  })
  .strict();

const applyCommitLedgerRecordSchema: z.ZodType<KnowledgeApplyCommitLedgerRecord> = z
  .object({
    transactionId: nonEmptyStringSchema,
    commitRevision: nonNegativeSafeIntegerSchema,
    bundleId: nonEmptyStringSchema,
    sourceId: nonEmptyStringSchema,
    sourceContentHash: sha256Schema,
    pipelineFingerprint: sha256Schema,
    inputRevision: nonNegativeSafeIntegerSchema,
    changeSetId: nonEmptyStringSchema,
    changeSetDigest: sha256Schema,
    manifestIntentDigest: sha256Schema,
    journalDigest: sha256Schema,
    receiptDigest: sha256Schema,
    manifestBeforeRevision: nonNegativeSafeIntegerSchema,
    manifestBeforeDigest: sha256Schema,
    manifestAfterRevision: nonNegativeSafeIntegerSchema,
    manifestAfterDigest: sha256Schema,
    recordedAt: nonNegativeSafeIntegerSchema,
  })
  .strict();

const legacyKnowledgeRuntimeStoreSnapshotSchema: z.ZodType<LegacyKnowledgeRuntimeStoreSnapshot> = z
  .object({
    version: z.literal(LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION),
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    inputRevisions: z.array(previousRuntimeInputRevisionBundleSchema),
    applyCommits: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

const runtimeV2StoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshotV2> = z
  .object({
    version: z.literal(RUNTIME_V2_STORE_VERSION),
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    inputRevisions: z.array(previousRuntimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

const previousKnowledgeRuntimeStoreSnapshotSchema: z.ZodType<PreviousKnowledgeRuntimeStoreSnapshot> =
  z
    .object({
      version: z.literal(PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION),
      runtimeId: opaqueIdSchema,
      revision: nonNegativeSafeIntegerSchema,
      queues: z.array(runtimeBundleSlotSchema),
      reviews: z.array(runtimeBundleSlotSchema),
      manifests: z.array(runtimeBundleSlotSchema),
      activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
      inputRevisions: z.array(runtimeInputRevisionBundleSchema),
      applyCommits: z.array(applyCommitLedgerRecordSchema),
    })
    .strict();

const runtimeV4StoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshotV4> = z
  .object({
    version: z.literal(RUNTIME_V4_STORE_VERSION),
    runtimeId: opaqueIdSchema,
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

const runtimeV5StoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshotV5> = z
  .object({
    version: z.literal(RUNTIME_V5_STORE_VERSION),
    runtimeId: opaqueIdSchema,
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

const runtimeV6StoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshotV6> = z
  .object({
    version: z.literal(RUNTIME_V6_STORE_VERSION),
    runtimeId: opaqueIdSchema,
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    forwardRevisionReviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

const runtimeV7StoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshotV7> = z
  .object({
    version: z.literal(RUNTIME_V7_STORE_VERSION),
    runtimeId: opaqueIdSchema,
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    forwardRevisionReviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

const runtimeV8StoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshotV8> = z
  .object({
    version: z.literal(RUNTIME_V8_STORE_VERSION),
    runtimeId: opaqueIdSchema,
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    forwardRevisionReviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    activeForwardRevisionApply: z.union([z.record(z.string(), z.unknown()), z.null()]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
    forwardRevisionApplyCommits: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

const legacyEmptyReviewSnapshotSchema = z
  .object({
    version: z.literal(1),
    bundleId: nonEmptyStringSchema,
    revision: nonNegativeSafeIntegerSchema,
    records: z.array(z.unknown()),
  })
  .strict();

const knowledgeRuntimeStoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshot> = z
  .object({
    version: z.literal(KNOWLEDGE_RUNTIME_STORE_VERSION),
    runtimeId: opaqueIdSchema,
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    forwardRevisionReviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.string(), z.unknown()), z.null()]),
    activeForwardRevisionApply: z.union([
      z.custom<KnowledgeForwardRevisionApplyJournalV1>(
        (value) => parseKnowledgeForwardRevisionApplyJournal(value).ok
      ),
      z.null(),
    ]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
    forwardRevisionApplyCommits: z.array(
      z.custom<KnowledgeForwardRevisionApplyLedgerRecord>(
        (value) => parseKnowledgeForwardRevisionApplyLedgerRecord(value).ok
      )
    ),
    forwardRevisionSupersessions: z.array(
      z.custom<KnowledgeForwardRevisionSupersessionRecordV1>(
        (value) => parseKnowledgeForwardRevisionSupersessionRecord(value).ok
      )
    ),
    forwardRevisionAbandonments: z.array(
      z.custom<KnowledgeForwardRevisionAbandonmentRecordV1>(
        (value) => parseKnowledgeForwardRevisionAbandonmentRecord(value).ok
      )
    ),
    forwardRevisionRecoveryTerminals: z.array(
      z.custom<KnowledgeForwardRevisionRecoveryTerminalRecordV1>(
        (value) => parseKnowledgeForwardRevisionRecoveryTerminalRecord(value).ok
      )
    ),
  })
  .strict();

const sourceRetirementCommandSchema: z.ZodType<KnowledgeSourceRetirementCommand> = z
  .object({
    version: z.literal(1),
    bundleId: nonEmptyStringSchema,
    sourceId: nonEmptyStringSchema,
    expectedToken: sha256Schema,
    reason: z.enum(["user_requested", "source_missing"]),
    confirm: z
      .object({
        keepWikiFiles: z.literal(true),
        revokeProvenance: z.literal(true),
        reserveIdentity: z.literal(true),
      })
      .strict(),
  })
  .strict();

const completedSourceReanalysisCommandSchema: z.ZodType<KnowledgeCompletedSourceReanalysisCommand> =
  z
    .object({
      bundleId: nonEmptyStringSchema,
      jobId: nonEmptyStringSchema,
      expectedQueueRevision: nonNegativeSafeIntegerSchema,
    })
    .strict();

export class KnowledgeRuntimeStoreCorruptError extends Error {
  constructor() {
    super("The durable knowledge runtime store does not satisfy its strict contract");
    this.name = "KnowledgeRuntimeStoreCorruptError";
  }
}

export class KnowledgeRuntimeSlotValidationError extends Error {
  constructor(
    public readonly subsystem: "queue" | "review" | "manifest" | "transaction",
    public readonly bundleId?: string
  ) {
    super(
      bundleId
        ? `The durable ${subsystem} snapshot for '${bundleId}' is invalid`
        : `The durable ${subsystem} snapshot is invalid`
    );
    this.name = "KnowledgeRuntimeSlotValidationError";
  }
}

export class KnowledgeRuntimeAtomicWriteError extends Error {
  constructor() {
    super("The knowledge runtime atomic file did not confirm the requested replacement");
    this.name = "KnowledgeRuntimeAtomicWriteError";
  }
}

export type KnowledgeRuntimeMigrationUnsafeReason =
  | "active_transaction_present"
  | "apply_commit_ledger_present"
  | "review_records_present"
  | "queue_review_state_present"
  | "queue_apply_state_present"
  | "queue_active_job_present"
  | "queue_revision_overflow"
  | "manifest_success_present"
  | "manifest_reserved_commit_metadata_present"
  | "source_retirement_state_present"
  | "forward_revision_overlay_state_present"
  | "forward_revision_source_base_unavailable"
  | "revision_overflow";

export class KnowledgeRuntimeMigrationUnsafeError extends Error {
  constructor(
    public readonly reason: KnowledgeRuntimeMigrationUnsafeReason,
    public readonly bundleId?: string
  ) {
    super("The legacy knowledge runtime contains work that cannot be migrated automatically");
    this.name = "KnowledgeRuntimeMigrationUnsafeError";
  }
}

export type KnowledgeApplyCommitProofErrorReason =
  | "journal_invalid"
  | "journal_not_committed"
  | "receipt_mismatch"
  | "active_journal_missing"
  | "active_journal_mismatch";

export class KnowledgeApplyCommitProofError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly reason: KnowledgeApplyCommitProofErrorReason
  ) {
    super(`Transaction '${transactionId}' does not have exact durable commit proof`);
    this.name = "KnowledgeApplyCommitProofError";
  }
}

export type KnowledgeApplyCommitAuthorityErrorReason =
  | "request_invalid"
  | "queue_missing"
  | "queue_claim_missing"
  | "queue_claim_mismatch"
  | "queue_review_unverified"
  | "review_missing"
  | "review_record_missing"
  | "review_record_mismatch"
  | "source_high_watermark_missing"
  | "source_high_watermark_mismatch"
  | "input_revision_missing"
  | "input_revision_behind"
  | "forward_lineage_time_mismatch";

export class KnowledgeApplyCommitAuthorityError extends TransactionStorageAuthorityError {
  constructor(
    public readonly transactionId: string,
    public readonly reason: KnowledgeApplyCommitAuthorityErrorReason
  ) {
    super(`Transaction '${transactionId}' does not have exact durable apply authority`);
    this.name = "KnowledgeApplyCommitAuthorityError";
  }
}

export class KnowledgeApplyCommitLedgerConflictError extends TransactionStorageAuthorityError {
  constructor(public readonly transactionId: string) {
    super(`Transaction '${transactionId}' conflicts with its durable apply ledger record`);
    this.name = "KnowledgeApplyCommitLedgerConflictError";
  }
}

export type KnowledgeApplyCommitManifestConflictReason =
  | "intent_invalid"
  | "source_missing"
  | "source_metadata_missing"
  | "source_metadata_invalid"
  | "input_revision_not_newer"
  | "revision_overflow";

export class KnowledgeApplyCommitManifestConflictError extends TransactionStorageAuthorityError {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly reason: KnowledgeApplyCommitManifestConflictReason,
    public readonly diagnostics: readonly KnowledgeDiagnostic[] = []
  ) {
    super(`Source '${sourceId}' cannot commit its final Manifest projection in '${bundleId}'`);
    this.name = "KnowledgeApplyCommitManifestConflictError";
  }
}

export type KnowledgeNoJournalApplyRecoveryConflictReason =
  | "request_invalid"
  | "review_missing"
  | "review_record_missing"
  | "review_record_mismatch"
  | "queue_missing"
  | "queue_state_mismatch"
  | "recovery_id_unknown"
  | "write_evidence_conflict"
  | "state_not_actionable"
  | "revision_overflow";

export class KnowledgeNoJournalApplyRecoveryConflictError extends TransactionStorageAuthorityError {
  constructor(
    public readonly bundleId: string,
    public readonly reason: KnowledgeNoJournalApplyRecoveryConflictReason
  ) {
    super(`An accepted apply in '${bundleId}' does not have exact no-journal recovery authority`);
    this.name = "KnowledgeNoJournalApplyRecoveryConflictError";
  }
}

export class KnowledgeRuntimeManifestReservationError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly transactionId: string
  ) {
    super(`Manifest writes for '${bundleId}' are reserved by transaction '${transactionId}'`);
    this.name = "KnowledgeRuntimeManifestReservationError";
  }
}

export type KnowledgeRuntimeManifestProtectedState =
  | "last_successful"
  | "reserved_commit_extension"
  | "reserved_no_changes_extension"
  | "source_identity"
  | "retirement_extension"
  | "forward_revision_overlay_extension";

export class KnowledgeRuntimeManifestProtectedStateError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly state: KnowledgeRuntimeManifestProtectedState
  ) {
    super(`Source '${sourceId}' has protected commit state in Manifest '${bundleId}'`);
    this.name = "KnowledgeRuntimeManifestProtectedStateError";
  }
}

export class KnowledgeSourceRetirementConflictError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly reason: "request_invalid" | "source_missing" | "state_changed" | "blocked",
    public readonly blockers: readonly KnowledgeSourceRetirementBlocker[] = []
  ) {
    super(`Source '${sourceId}' cannot be retired from Bundle '${bundleId}'`);
    this.name = "KnowledgeSourceRetirementConflictError";
  }
}

export class KnowledgeRuntimeSourceRetiredError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string
  ) {
    super(`Source '${sourceId}' is retired in Bundle '${bundleId}'`);
    this.name = "KnowledgeRuntimeSourceRetiredError";
  }
}

export class KnowledgeRuntimeQueueRecoveryGateProtectedError extends Error {
  constructor(public readonly bundleId: string) {
    super(`Queue '${bundleId}' cannot bypass protected recovery or review authority`);
    this.name = "KnowledgeRuntimeQueueRecoveryGateProtectedError";
  }
}

export class KnowledgeRuntimeQueueObservationAuthorityError extends Error {
  constructor(public readonly bundleId: string) {
    super(`Queue '${bundleId}' contains an unallocated or regressing source observation`);
    this.name = "KnowledgeRuntimeQueueObservationAuthorityError";
  }
}

export type KnowledgeRuntimeNoChangesCommitConflictReason =
  | "authority_invalid"
  | "queue_mismatch"
  | "manifest_mismatch"
  | "source_mismatch"
  | "observation_mismatch"
  | "input_revision_not_newer"
  | "transaction_active"
  | "revision_overflow";

export class KnowledgeRuntimeNoChangesCommitConflictError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly reason: KnowledgeRuntimeNoChangesCommitConflictReason
  ) {
    super(`Source '${sourceId}' cannot commit no-change success in Bundle '${bundleId}'`);
    this.name = "KnowledgeRuntimeNoChangesCommitConflictError";
  }
}

export class KnowledgeRuntimeIngestExecutionProofError extends Error {
  constructor() {
    super("The knowledge ingest execution claim is not authorized by Runtime");
    this.name = "KnowledgeRuntimeIngestExecutionProofError";
  }
}

export class SourceInputRevisionOverflowError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string
  ) {
    super(`Source '${sourceId}' in Bundle '${bundleId}' cannot allocate another input revision`);
    this.name = "SourceInputRevisionOverflowError";
  }
}

export class SourceInputCaptureConflictError extends Error {
  constructor() {
    super("The source observation capture id is already bound to another identity");
    this.name = "SourceInputCaptureConflictError";
  }
}

export class SourceInputObservationTokenError extends Error {
  constructor() {
    super("The source observation capability is invalid or unknown");
    this.name = "SourceInputObservationTokenError";
  }
}

export class SourceInputObservationBindingConflictError extends Error {
  constructor() {
    super("The source observation capability is already bound to a different payload");
    this.name = "SourceInputObservationBindingConflictError";
  }
}

export class SourceInputObservationTokenCollisionError extends Error {
  constructor() {
    super("The source observation capability generator produced a duplicate token");
    this.name = "SourceInputObservationTokenCollisionError";
  }
}

export interface KnowledgeRuntimeStoreOptions {
  clock?: () => number;
  maxTextCharacters?: number;
  opaqueIdFactory?: () => string;

  productionExecutionClaim?: KnowledgeProductionWorkflowExecutionRuntimeClaim;
}

export const DEFAULT_MAX_KNOWLEDGE_RUNTIME_TEXT_CHARACTERS = 64 * 1024 * 1024;

function createSecureOpaqueId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function createEmptyKnowledgeRuntimeStoreSnapshot(
  runtimeId = createSecureOpaqueId()
): KnowledgeRuntimeStoreSnapshot {
  return {
    version: KNOWLEDGE_RUNTIME_STORE_VERSION,
    runtimeId,
    revision: 0,
    queues: [],
    reviews: [],
    forwardRevisionReviews: [],
    manifests: [],
    activeTransaction: null,
    activeForwardRevisionApply: null,
    inputRevisions: [],
    applyCommits: [],
    forwardRevisionApplyCommits: [],
    forwardRevisionSupersessions: [],
    forwardRevisionAbandonments: [],
    forwardRevisionRecoveryTerminals: [],
  };
}

export function parseKnowledgeRuntimeStoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshot {
  const parsed = knowledgeRuntimeStoreSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const snapshot = parsed.data;
  snapshot.activeForwardRevisionApply =
    snapshot.activeForwardRevisionApply === null
      ? null
      : snapshotKnowledgeForwardRevisionApplyJournal(snapshot.activeForwardRevisionApply);
  snapshot.forwardRevisionApplyCommits = snapshot.forwardRevisionApplyCommits.map((record) =>
    snapshotKnowledgeForwardRevisionApplyLedgerRecord(record)
  );
  snapshot.forwardRevisionSupersessions = snapshot.forwardRevisionSupersessions.map((record) =>
    snapshotKnowledgeForwardRevisionSupersessionRecord(record)
  );
  snapshot.forwardRevisionAbandonments = snapshot.forwardRevisionAbandonments.map((record) =>
    snapshotKnowledgeForwardRevisionAbandonmentRecord(record)
  );
  snapshot.forwardRevisionRecoveryTerminals = snapshot.forwardRevisionRecoveryTerminals.map(
    (record) => snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(record)
  );
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.forwardRevisionReviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  assertUniqueForwardRevisionApplyCommits(
    snapshot.forwardRevisionApplyCommits,
    snapshot.applyCommits
  );
  assertRuntimeSlotSemantics(snapshot);
  return cloneJson(snapshot);
}

function assertUniqueForwardRevisionApplyCommits(
  records: readonly Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[],
  legacyRecords: readonly Readonly<KnowledgeApplyCommitLedgerRecord>[]
): void {
  const ledgerIds = new Set<string>();
  const transactionIds = new Set(legacyRecords.map((record) => record.transactionId));
  const identityDigests = new Set<string>();
  const decisionDigests = new Set<string>();
  const claimIds = new Set<string>();
  const claimDigests = new Set<string>();
  for (const record of records) {
    if (
      ledgerIds.has(record.ledgerId) ||
      transactionIds.has(record.transactionId) ||
      identityDigests.has(record.forwardLedgerIdentityDigest) ||
      decisionDigests.has(record.acceptedDecisionDigest) ||
      claimIds.has(record.applyClaimId) ||
      claimDigests.has(record.applyClaimDigest)
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    ledgerIds.add(record.ledgerId);
    transactionIds.add(record.transactionId);
    identityDigests.add(record.forwardLedgerIdentityDigest);
    decisionDigests.add(record.acceptedDecisionDigest);
    claimIds.add(record.applyClaimId);
    claimDigests.add(record.applyClaimDigest);
  }
}

function assertRuntimeSlotSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  requireReusableCompletionProof = true
): void {
  const manifests = new Map<string, SourceManifest>();
  const queues = new Map<string, IngestQueueSnapshot>();
  for (const slot of snapshot.queues) {
    const parsed = parseIngestQueueSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateIngestQueueSnapshot(slot.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    queues.set(slot.bundleId, parsed.value);
  }
  for (const slot of snapshot.reviews) {
    const parsed = parseChangeSetReviewSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  if (
    snapshot.version === RUNTIME_V7_STORE_VERSION ||
    snapshot.version === KNOWLEDGE_RUNTIME_STORE_VERSION
  ) {
    const eventRuntimeRevisions = new Set<number>();
    for (const slot of snapshot.forwardRevisionReviews) {
      const parsed = parseKnowledgeForwardRevisionReviewSnapshotV2(slot.value);
      if (
        !parsed.ok ||
        parsed.value.bundleId !== slot.bundleId ||
        parsed.value.records.some((record) => {
          const publication = projectKnowledgeForwardRevisionReviewEntryProposalV2(record);
          return (
            publication.proposal.request.runtimeId !== snapshot.runtimeId ||
            publication.publishedRuntimeRevision > snapshot.revision ||
            eventRuntimeRevisions.has(publication.publishedRuntimeRevision) ||
            (record.state !== "pending" &&
              (record.decidedRuntimeRevision > snapshot.revision ||
                eventRuntimeRevisions.has(record.decidedRuntimeRevision)))
          );
        })
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      for (const record of parsed.value.records) {
        const publication = projectKnowledgeForwardRevisionReviewEntryProposalV2(record);
        eventRuntimeRevisions.add(publication.publishedRuntimeRevision);
        if (record.state !== "pending") {
          eventRuntimeRevisions.add(record.decidedRuntimeRevision);
        }
      }
    }
  }
  for (const slot of snapshot.manifests) {
    const parsed = parseSourceManifest(slot.value);
    if (
      !parsed.ok ||
      !validateSourceManifest(slot.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    manifests.set(slot.bundleId, parsed.value);
    if (snapshot.version === KNOWLEDGE_RUNTIME_STORE_VERSION) {
      const forwardOverlays =
        parsed.value.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY];
      if (
        forwardOverlays !== undefined &&
        !parseKnowledgeForwardRevisionOverlayExtension(forwardOverlays).ok
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
  if (snapshot.activeTransaction !== null) {
    const parsed = parseChangeSetTransactionJournal(snapshot.activeTransaction);
    if (!parsed.ok || !validateChangeSetTransactionJournal(snapshot.activeTransaction).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      snapshot.version === KNOWLEDGE_RUNTIME_STORE_VERSION &&
      snapshot.forwardRevisionApplyCommits.some(
        (record) => record.transactionId === parsed.value.transactionId
      )
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  if (
    snapshot.version === KNOWLEDGE_RUNTIME_STORE_VERSION &&
    snapshot.activeTransaction !== null &&
    snapshot.activeForwardRevisionApply !== null
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  if (snapshot.version === KNOWLEDGE_RUNTIME_STORE_VERSION) {
    assertForwardRevisionApplySemantics(snapshot, manifests);
  }
  assertManifestLedgerSemantics(snapshot.applyCommits, manifests);
  assertQueueApplyCommitLedgerSemantics(snapshot.applyCommits, queues);
  assertNoChangesCommitSemantics(snapshot, manifests, queues);
  if (requireReusableCompletionProof) {
    assertReusableCompletionSemantics(snapshot, manifests, queues);
  }
  assertObservationJournalSemantics(snapshot, queues, manifests);
}

function recomputeForwardRevisionSourceBase(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  sourceId: string
): Readonly<KnowledgeForwardRevisionSourceBaseV1> | undefined {
  const source = manifest.entries.find((entry) => entry.sourceId === sourceId);
  if (!source || findKnowledgeSourceRetirement(manifest, sourceId)) return undefined;
  const runtimeFreshness = projectRuntimeSourceFreshnessAuthority(state, manifest, source);
  if (!runtimeFreshness) return undefined;
  const common = {
    runtimeId: runtimeFreshness.runtimeId,
    runtimeRevision: runtimeFreshness.runtimeRevision,
    runtimeDigest: runtimeFreshness.runtimeDigest,
    bundleId: runtimeFreshness.bundleId,
    sourceId: runtimeFreshness.sourceId,
    sourceContentHash: runtimeFreshness.sourceContentHash,
    pipelineFingerprint: runtimeFreshness.pipelineFingerprint,
    inputRevision: runtimeFreshness.inputRevision,
    manifestRevision: runtimeFreshness.manifestRevision,
    manifestDigest: runtimeFreshness.manifestDigest,
    committedManifestRevision: runtimeFreshness.committedManifestRevision,
    completedAt: runtimeFreshness.completedAt,
  } as const;
  const freshness =
    runtimeFreshness.kind === "applied"
      ? Object.freeze({
          ...common,
          kind: "applied" as const,
          transactionId: runtimeFreshness.transactionId,
          changeSetId: runtimeFreshness.changeSetId,
          changeSetDigest: runtimeFreshness.changeSetDigest,
          manifestIntentDigest: runtimeFreshness.manifestIntentDigest,
          committedManifestDigest: runtimeFreshness.committedManifestDigest,
        })
      : Object.freeze({
          ...common,
          kind: "no_changes" as const,
          noChangesId: runtimeFreshness.noChangesId,
          reason: runtimeFreshness.reason,
          planDigest: runtimeFreshness.planDigest,
          jobId: runtimeFreshness.jobId,
          attempt: runtimeFreshness.attempt,
        });
  try {
    return createKnowledgeForwardRevisionSourceBase({
      bundleId: manifest.bundleId,
      sourceEntry: source,
      currentSourceFreshness: freshness,
    });
  } catch {
    return undefined;
  }
}

function projectForwardRevisionApplyAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  query: Readonly<KnowledgeForwardRevisionApplyAuthorityQuery>
): Readonly<KnowledgeForwardRevisionApplyAuthority> | null {
  if (
    query.runtimeId !== state.runtimeId ||
    state.activeTransaction !== null ||
    state.activeForwardRevisionApply !== null ||
    state.revision > Number.MAX_SAFE_INTEGER - 4
  ) {
    return null;
  }
  const rawForward = findForwardRevisionReviewSlot(state, query.bundleId);
  const manifestRaw = findBundleSlot(state, "manifests", query.bundleId);
  if (rawForward === null || manifestRaw === null) return null;
  const forward = snapshotKnowledgeForwardRevisionReviewSnapshotV2(rawForward);
  const matches = forward.records.filter(
    (
      entry
    ): entry is Extract<KnowledgeForwardRevisionTerminalReviewEntryV2, { state: "accepted" }> =>
      entry.state === "accepted" &&
      entry.decision.proposal.proposalId === query.proposalId &&
      entry.decision.proposalDigest === query.proposalDigest &&
      entry.decision.acceptedDecisionDigest === query.acceptedDecisionDigest &&
      entry.decision.applyClaim.claimId === query.applyClaimId &&
      entry.decision.applyClaimDigest === query.applyClaimDigest
  );
  if (matches.length !== 1) return null;
  const accepted = matches[0];
  const decision = accepted.decision;
  const acceptedKey = createForwardRevisionAcceptedLifecycleKey({
    bundleId: query.bundleId,
    proposalId: query.proposalId,
    proposalDigest: query.proposalDigest,
    acceptedDecisionDigest: query.acceptedDecisionDigest,
    applyClaimId: query.applyClaimId,
    applyClaimDigest: query.applyClaimDigest,
  });
  if (
    decision.proposal.request.pagePath !== query.pagePath ||
    decision.applyClaim.runtimeId !== state.runtimeId ||
    decision.applyClaim.bundleId !== query.bundleId ||
    decision.applyClaim.pagePath !== query.pagePath ||
    state.forwardRevisionAbandonments.some(
      (record) =>
        createForwardRevisionAcceptedLifecycleKey({
          bundleId: record.acceptedIdentity.resource.bundleId,
          proposalId: record.acceptedIdentity.proposalId,
          proposalDigest: record.acceptedIdentity.proposalDigest,
          acceptedDecisionDigest: record.acceptedIdentity.acceptedDecisionDigest,
          applyClaimId: record.acceptedIdentity.applyClaimId,
          applyClaimDigest: record.acceptedIdentity.applyClaimDigest,
        }) === acceptedKey
    ) ||
    state.forwardRevisionRecoveryTerminals.some(
      (record) =>
        createForwardRevisionAcceptedLifecycleKey({
          bundleId: record.acceptedIdentity.resource.bundleId,
          proposalId: record.acceptedIdentity.proposalId,
          proposalDigest: record.acceptedIdentity.proposalDigest,
          acceptedDecisionDigest: record.acceptedIdentity.acceptedDecisionDigest,
          applyClaimId: record.acceptedIdentity.applyClaimId,
          applyClaimDigest: record.acceptedIdentity.applyClaimDigest,
        }) === acceptedKey
    )
  ) {
    return null;
  }
  const currentManifests = state.manifests.map((slot) => {
    const parsed = parseSourceManifest(slot.value);
    if (
      !parsed.ok ||
      !validateSourceManifest(parsed.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    return { bundleId: slot.bundleId, manifest: parsed.value };
  });
  const manifest = currentManifests.find(({ bundleId }) => bundleId === query.bundleId)?.manifest;
  if (!manifest) return null;
  if (
    manifest.revision === Number.MAX_SAFE_INTEGER ||
    listManifestForwardRevisionOverlays(manifest).length >= 10_000
  ) {
    return null;
  }
  const windowsPathKey = toWindowsPathKey(query.pagePath);
  const sourceId = decision.proposal.request.intent.current.primarySourceId;
  const source = manifest.entries.find((entry) => entry.sourceId === sourceId);
  if (!source || findKnowledgeSourceRetirement(manifest, sourceId)) return null;
  const pages = currentManifests.flatMap(({ bundleId, manifest: currentManifest }) =>
    projectKnowledgeEffectiveManifestPages(currentManifest)
      .filter((page) => page.windowsPathKey === windowsPathKey)
      .map((page) => ({ bundleId, page }))
  );
  const owned = pages[0];
  const page = owned?.page;
  if (
    pages.length !== 1 ||
    owned?.bundleId !== query.bundleId ||
    !page ||
    page.path !== query.pagePath ||
    page.ownership !== "generated" ||
    page.sourceIds.length !== 1 ||
    page.sourceIds[0] !== sourceId ||
    page.sourceAppliedContentHash !== decision.acceptanceAuthority.manifestBaseHash ||
    page.effectiveContentHash !== decision.acceptanceAuthority.vaultObservedBeforeHash
  ) {
    return null;
  }
  const sourceBase = recomputeForwardRevisionSourceBase(state, manifest, sourceId);
  if (!sourceBase) return null;
  const lineageAppliedAtFloor =
    page.origin.kind === "forward_revision" ? page.origin.overlay.appliedAt : 0;
  return snapshotKnowledgeForwardRevisionApplyAuthority(
    {
      query,
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      runtimeDigest: sha256(canonicalizeJson(state as unknown as JsonValue)),
      forwardReviewStoreRevision: forward.revision,
      decisionStoreRevision: accepted.decisionStoreRevision,
      acceptedDecision: decision,
      acceptedDecisionDigest: decision.acceptedDecisionDigest,
      sourceBase,
      sourceBaseDigest: createKnowledgeForwardRevisionSourceBaseDigest(sourceBase),
      lineageAppliedAtFloor,
      manifestRevision: manifest.revision,
      manifestDigest: createSourceManifestDigest(manifest),
    },
    query
  );
}

function createPreparedForwardRevisionApplyJournal(
  projection: Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1>
): Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1> {
  const query = snapshotKnowledgeForwardRevisionApplyAuthorityQuery(projection.request);
  const afterAuthority = snapshotKnowledgeForwardRevisionApplyAuthority(
    projection.afterAuthority,
    query
  );
  const acceptedDecision = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(
    projection.acceptedDecision
  );
  const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(projection.sourceBase);
  const revalidationReceipt =
    snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision(
      projection.revalidationReceipt,
      acceptedDecision
    );
  if (
    projection.version !== 1 ||
    projection.kind !== "forward_revision_apply_capability_projection" ||
    projection.acceptedDecisionDigest !== acceptedDecision.acceptedDecisionDigest ||
    projection.sourceBaseDigest !== createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) ||
    projection.revalidationReceiptDigest !== revalidationReceipt.receiptDigest ||
    projection.beforeHash !== createFileContentHash(projection.beforeContent) ||
    projection.afterHash !== createFileContentHash(projection.afterContent) ||
    projection.afterContent !== acceptedDecision.afterContent ||
    projection.afterHash !== acceptedDecision.acceptedAfterHash ||
    revalidationReceipt.revalidatedAt < afterAuthority.lineageAppliedAtFloor ||
    !exactJsonValuesEqual(acceptedDecision, afterAuthority.acceptedDecision) ||
    !exactJsonValuesEqual(sourceBase, afterAuthority.sourceBase) ||
    !exactJsonValuesEqual(sourceBase, revalidationReceipt.sourceBase) ||
    !exactJsonValuesEqual(projection.applyAuthority, revalidationReceipt.applyAuthority)
  ) {
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
  const transactionDigest = sha256(
    `knowledge-forward-revision-apply-transaction-v1\n${canonicalizeJson({
      runtimeId: afterAuthority.runtimeId,
      acceptedDecisionDigest: acceptedDecision.acceptedDecisionDigest,
      revalidationReceiptDigest: revalidationReceipt.receiptDigest,
      sourceBaseDigest: projection.sourceBaseDigest,
      pagePath: query.pagePath,
      beforeHash: projection.beforeHash,
      afterHash: projection.afterHash,
    })}`
  );
  return createKnowledgeForwardRevisionPreparedApplyJournal({
    transactionId: `forward-revision-apply-transaction-${transactionDigest}`,
    acceptedDecision,
    revalidationReceipt,
    manifestBeforeRevision: afterAuthority.manifestRevision,
    manifestBeforeDigest: afterAuthority.manifestDigest,
    beforeContent: projection.beforeContent,
    afterContent: projection.afterContent,
    createdAt: revalidationReceipt.revalidatedAt,
  });
}

const FORWARD_APPLY_TRANSITION_KEYS = [
  "version",
  "kind",
  "transition",
  "previousJournal",
  "previousJournalDigest",
  "nextJournal",
  "nextJournalDigest",
  "observation",
] as const;
const FORWARD_APPLY_FINALIZE_KEYS = [
  "version",
  "kind",
  "transition",
  "previousJournal",
  "previousJournalDigest",
  "observation",
] as const;
const FORWARD_APPLY_TERMINALIZE_KEYS = [
  "version",
  "kind",
  "transition",
  "previousJournal",
  "previousJournalDigest",
  "observation",
  "observedAt",
] as const;
const FORWARD_APPLY_RECOVERY_COMMITTED_KEYS = [
  "version",
  "kind",
  "transition",
  "previousJournal",
  "previousJournalDigest",
  "nextJournal",
  "nextJournalDigest",
  "observation",
  "observedAt",
] as const;
const FORWARD_APPLY_FILE_OBSERVATION_KEYS = ["kind", "contentHash"] as const;
const FORWARD_APPLY_NON_FILE_OBSERVATION_KEYS = ["kind"] as const;

function snapshotForwardRevisionApplyTransitionObservation(
  value: unknown
): Readonly<
  { kind: "missing" | "directory" | "oversized_file" } | { kind: "file"; contentHash: string }
> {
  const kind = (() => {
    try {
      if (typeof value !== "object" || value === null) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
      const descriptorValue: unknown = descriptor?.value;
      return descriptor?.enumerable && "value" in descriptor ? descriptorValue : undefined;
    } catch {
      return undefined;
    }
  })();
  const record = captureForwardApplyRecord(
    value,
    kind === "file" ? FORWARD_APPLY_FILE_OBSERVATION_KEYS : FORWARD_APPLY_NON_FILE_OBSERVATION_KEYS
  );
  if (!record) throw createForwardRevisionApplyPortError("dependency_invalid");
  if (record.kind === "file" && isForwardApplyDigest(record.contentHash)) {
    return Object.freeze({ kind: "file" as const, contentHash: record.contentHash });
  }
  if (
    record.kind === "missing" ||
    record.kind === "directory" ||
    record.kind === "oversized_file"
  ) {
    return Object.freeze({ kind: record.kind });
  }
  throw createForwardRevisionApplyPortError("dependency_invalid");
}

function snapshotForwardRevisionApplyTransitionProjection(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1> {
  try {
    const transition = (() => {
      if (typeof value !== "object" || value === null) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, "transition");
      const descriptorValue: unknown = descriptor?.value;
      return descriptor?.enumerable && "value" in descriptor ? descriptorValue : undefined;
    })();
    const record = captureForwardApplyRecord(
      value,
      transition === "finalize"
        ? FORWARD_APPLY_FINALIZE_KEYS
        : transition === "terminalize"
          ? FORWARD_APPLY_TERMINALIZE_KEYS
          : transition === "recovery_committed"
            ? FORWARD_APPLY_RECOVERY_COMMITTED_KEYS
            : FORWARD_APPLY_TRANSITION_KEYS
    );
    if (
      !record ||
      record.version !== 1 ||
      record.kind !== "forward_revision_apply_transition_capability_projection"
    ) {
      throw new TypeError();
    }
    const previousJournal = snapshotKnowledgeForwardRevisionApplyJournal(record.previousJournal);
    const previousJournalDigest = createKnowledgeForwardRevisionApplyJournalDigest(previousJournal);
    const observation = snapshotForwardRevisionApplyTransitionObservation(record.observation);
    if (record.previousJournalDigest !== previousJournalDigest) throw new TypeError();
    if (transition === "terminalize") {
      if (
        previousJournal.phase !== "recovery_required" ||
        !Number.isSafeInteger(record.observedAt) ||
        Number(record.observedAt) < previousJournal.updatedAt ||
        (observation.kind === "file" &&
          (observation.contentHash === previousJournal.afterHash ||
            (previousJournal.revision !== 3 &&
              observation.contentHash === previousJournal.beforeHash)))
      ) {
        throw new TypeError();
      }
      return Object.freeze({
        version: 1 as const,
        kind: "forward_revision_apply_transition_capability_projection" as const,
        transition,
        previousJournal,
        previousJournalDigest,
        observation,
        observedAt: Number(record.observedAt),
      });
    }
    if (transition === "finalize") {
      if (
        previousJournal.phase !== "committed" ||
        observation.kind !== "file" ||
        observation.contentHash !== previousJournal.afterHash
      ) {
        throw new TypeError();
      }
      return Object.freeze({
        version: 1 as const,
        kind: "forward_revision_apply_transition_capability_projection" as const,
        transition,
        previousJournal,
        previousJournalDigest,
        observation,
      });
    }
    if (transition === "recovery_committed") {
      if (
        previousJournal.phase !== "recovery_required" ||
        observation.kind !== "file" ||
        observation.contentHash !== previousJournal.afterHash ||
        !Number.isSafeInteger(record.observedAt) ||
        Number(record.observedAt) < previousJournal.updatedAt
      ) {
        throw new TypeError();
      }
      const nextJournal = snapshotKnowledgeForwardRevisionApplyJournal(record.nextJournal);
      const nextJournalDigest = createKnowledgeForwardRevisionApplyJournalDigest(nextJournal);
      const expected = projectKnowledgeForwardRevisionRecoveryJournalCommitted(
        previousJournal,
        Number(record.observedAt)
      );
      if (
        record.nextJournalDigest !== nextJournalDigest ||
        !exactJsonValuesEqual(nextJournal, expected)
      ) {
        throw new TypeError();
      }
      return Object.freeze({
        version: 1 as const,
        kind: "forward_revision_apply_transition_capability_projection" as const,
        transition,
        previousJournal,
        previousJournalDigest,
        nextJournal,
        nextJournalDigest,
        observation,
        observedAt: Number(record.observedAt),
      });
    }
    if (
      transition !== "applying" &&
      transition !== "committed" &&
      transition !== "recovery_required"
    ) {
      throw new TypeError();
    }
    const nextJournal = snapshotKnowledgeForwardRevisionApplyJournal(record.nextJournal);
    const nextJournalDigest = createKnowledgeForwardRevisionApplyJournalDigest(nextJournal);
    if (record.nextJournalDigest !== nextJournalDigest) throw new TypeError();
    const expected = (() => {
      if (transition === "applying") {
        if (
          observation.kind !== "file" ||
          (observation.contentHash !== previousJournal.beforeHash &&
            observation.contentHash !== previousJournal.afterHash)
        ) {
          throw new TypeError();
        }
        return projectKnowledgeForwardRevisionApplyJournalApplying(
          previousJournal,
          nextJournal.updatedAt
        );
      }
      if (transition === "committed") {
        if (
          nextJournal.phase !== "committed" ||
          observation.kind !== "file" ||
          observation.contentHash !== previousJournal.afterHash
        ) {
          throw new TypeError();
        }
        return projectKnowledgeForwardRevisionApplyJournalCommitted(
          previousJournal,
          nextJournal.committedAt
        );
      }
      if (nextJournal.phase !== "recovery_required") throw new TypeError();
      const conflict = nextJournal.conflict;
      if (
        observation.kind !== conflict.actualKind ||
        (observation.kind === "file" && observation.contentHash !== conflict.actualHash)
      ) {
        throw new TypeError();
      }
      return projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(previousJournal, {
        code: conflict.code,
        actualKind: conflict.actualKind,
        ...(conflict.actualHash === undefined ? {} : { actualHash: conflict.actualHash }),
        detectedAt: conflict.detectedAt,
      });
    })();
    if (nextJournal.phase !== transition || !exactJsonValuesEqual(nextJournal, expected)) {
      throw new TypeError();
    }
    return Object.freeze({
      version: 1 as const,
      kind: "forward_revision_apply_transition_capability_projection" as const,
      transition,
      previousJournal,
      previousJournalDigest,
      nextJournal,
      nextJournalDigest,
      observation,
    });
  } catch (error) {
    if (KnowledgeForwardRevisionApplyPortError.inspect(error)) throw error;
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
}

function projectForwardRevisionApplyFinalization(
  state: KnowledgeRuntimeStoreSnapshot,
  journalValue: unknown
): Readonly<{
  next: KnowledgeRuntimeStoreSnapshot;
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>;
}> {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(journalValue);
  if (journal.phase !== "committed") {
    throw createForwardRevisionApplyPortError("conflict");
  }
  const manifestRaw = findBundleSlot(state, "manifests", journal.bundleId);
  if (manifestRaw === null) throw createForwardRevisionApplyPortError("authority_unavailable");
  const parsedManifest = parseSourceManifest(manifestRaw);
  if (
    !parsedManifest.ok ||
    !validateSourceManifest(parsedManifest.value).valid ||
    parsedManifest.value.bundleId !== journal.bundleId
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const manifest = parsedManifest.value;
  if (
    manifest.revision !== journal.manifestBeforeRevision ||
    createSourceManifestDigest(manifest) !== journal.manifestBeforeDigest
  ) {
    throw createForwardRevisionApplyPortError("authority_unavailable");
  }
  const sourceBase = recomputeForwardRevisionSourceBase(state, manifest, journal.sourceId);
  if (
    !sourceBase ||
    createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== journal.sourceBaseDigest
  ) {
    throw createForwardRevisionApplyPortError("authority_unavailable");
  }
  if (
    state.applyCommits.some((record) => record.transactionId === journal.transactionId) ||
    state.forwardRevisionApplyCommits.some(
      (record) =>
        record.transactionId === journal.transactionId ||
        record.acceptedDecisionDigest === journal.acceptedDecisionDigest ||
        record.applyClaimId === journal.applyClaimId ||
        record.applyClaimDigest === journal.applyClaimDigest
    )
  ) {
    throw createForwardRevisionApplyPortError("conflict");
  }
  const predecessorOverlay = listManifestForwardRevisionOverlays(manifest).find(
    (entry) => entry.windowsPathKey === journal.windowsPathKey
  );
  const predecessorLedger = predecessorOverlay
    ? state.forwardRevisionApplyCommits.find((record) =>
        forwardRevisionOverlayMatchesLedger(predecessorOverlay, record)
      )
    : undefined;
  if (
    (predecessorOverlay !== undefined && predecessorLedger === undefined) ||
    (predecessorOverlay === undefined &&
      journal.previousEffectiveContentHash !== journal.sourceAppliedContentHash) ||
    (predecessorOverlay !== undefined &&
      (predecessorOverlay.effectiveContentHash !== journal.previousEffectiveContentHash ||
        predecessorOverlay.sourceAppliedContentHash !== journal.sourceAppliedContentHash ||
        predecessorOverlay.sourceId !== journal.sourceId ||
        predecessorOverlay.pagePath !== journal.pagePath))
  ) {
    throw createForwardRevisionApplyPortError("authority_unavailable");
  }
  const forwardLedgerIdentityDigest = createKnowledgeForwardRevisionApplyLedgerIdentityDigest(
    journal,
    sourceBase
  );
  const overlay = createKnowledgeForwardRevisionOverlayEntry({
    bundleId: journal.bundleId,
    pagePath: journal.pagePath,
    sourceId: journal.sourceId,
    sourceBaseDigest: journal.sourceBaseDigest,
    sourceAppliedContentHash: journal.sourceAppliedContentHash,
    previousEffectiveContentHash: journal.previousEffectiveContentHash,
    effectiveContentHash: journal.afterHash,
    forwardTransactionId: journal.transactionId,
    acceptedDecisionDigest: journal.acceptedDecisionDigest,
    forwardLedgerIdentityDigest,
    appliedAt: journal.committedAt,
  });
  const nextManifest = projectKnowledgeForwardRevisionOverlayAddition(
    manifest,
    overlay,
    sourceBase
  );
  const manifestAfterDigest = createSourceManifestDigest(nextManifest);
  const ledger = createKnowledgeForwardRevisionApplyLedgerRecord({
    committedJournal: journal,
    sourceBase,
    manifestAfterRevision: nextManifest.revision,
    manifestAfterDigest,
    appliedAt: journal.committedAt,
  });
  if (ledger.forwardLedgerIdentityDigest !== forwardLedgerIdentityDigest) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const supersession = predecessorLedger
    ? createKnowledgeForwardRevisionSupersessionRecord({
        predecessor: createForwardRevisionLedgerLineageRefForLedger(predecessorLedger),
        successor: createForwardRevisionLedgerLineageRefForLedger(ledger),
        supersededAt: ledger.appliedAt,
      })
    : undefined;
  const nextRevision = (() => {
    try {
      return nextStoreRevision(state);
    } catch {
      throw createForwardRevisionApplyPortError("resource_limit");
    }
  })();
  return Object.freeze({
    next: {
      ...state,
      revision: nextRevision,
      manifests: replaceBundleSlot(state.manifests, journal.bundleId, nextManifest),
      activeForwardRevisionApply: null,
      forwardRevisionApplyCommits: [...state.forwardRevisionApplyCommits, ledger].sort(
        (left, right) => compareIdentifiers(left.transactionId, right.transactionId)
      ),
      forwardRevisionSupersessions:
        supersession === undefined
          ? state.forwardRevisionSupersessions
          : [...state.forwardRevisionSupersessions, supersession].sort((left, right) =>
              compareIdentifiers(left.supersessionId, right.supersessionId)
            ),
    },
    ledger,
  });
}

function confirmForwardRevisionApplyFinalization(
  state: KnowledgeRuntimeStoreSnapshot,
  journalValue: unknown
): Readonly<KnowledgeForwardRevisionApplyLedgerRecord> | undefined {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(journalValue);
  if (journal.phase !== "committed" || state.activeForwardRevisionApply !== null) {
    return undefined;
  }
  const matches = state.forwardRevisionApplyCommits.filter(
    (record) => record.transactionId === journal.transactionId
  );
  if (matches.length !== 1) return undefined;
  try {
    return snapshotKnowledgeForwardRevisionApplyLedgerRecordForCommittedJournal(
      matches[0],
      journal,
      matches[0].sourceBase
    );
  } catch {
    return undefined;
  }
}

function projectForwardRevisionRecoveryTerminalization(
  state: KnowledgeRuntimeStoreSnapshot,
  projection: Extract<
    KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1,
    { transition: "terminalize" }
  >,
  terminalizedAt: number
): Readonly<{
  next: KnowledgeRuntimeStoreSnapshot;
  terminal: Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>;
}> {
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(projection.previousJournal);
  if (journal.phase !== "recovery_required") {
    throw createForwardRevisionApplyPortError("conflict");
  }
  const acceptedIdentity = createForwardRevisionAcceptedClaimIdentityForDecision(
    state.runtimeId,
    journal.acceptedDecision
  );
  const resource = createForwardRevisionLifecycleResourceForDecision(
    state.runtimeId,
    journal.acceptedDecision
  );
  const recoveryJournalBase = {
    resource,
    transactionId: journal.transactionId,
    recoveryJournalDigest: projection.previousJournalDigest,
    acceptedDecisionDigest: journal.acceptedDecisionDigest,
    applyClaimId: journal.applyClaimId,
    applyClaimDigest: journal.applyClaimDigest,
    beforeHash: journal.beforeHash,
    afterHash: journal.afterHash,
    updatedAt: projection.observedAt,
  };
  const recoveryJournal = createKnowledgeForwardRevisionRecoveryJournalRef(
    journal.revision === 3
      ? { ...recoveryJournalBase, journalRevision: 3, committedAt: journal.committedAt! }
      : journal.revision === 2
        ? { ...recoveryJournalBase, journalRevision: 2 }
        : { ...recoveryJournalBase, journalRevision: 1 }
  );
  const observation = createKnowledgeForwardRevisionExternalObservation(
    projection.observation.kind === "file"
      ? {
          actualKind: "file" as const,
          actualHash: projection.observation.contentHash,
          observedAt: projection.observedAt,
        }
      : {
          actualKind: projection.observation.kind,
          observedAt: projection.observedAt,
        }
  );
  const terminal = createKnowledgeForwardRevisionRecoveryTerminalRecord({
    acceptedIdentity,
    journal: recoveryJournal,
    observation,
    terminalizedAt,
  });
  if (journal.revision !== 3) {
    return Object.freeze({
      next: {
        ...state,
        revision: nextStoreRevision(state),
        activeForwardRevisionApply: null,
        forwardRevisionRecoveryTerminals: [
          ...state.forwardRevisionRecoveryTerminals,
          terminal,
        ].sort((left, right) =>
          compareIdentifiers(left.terminalizationId, right.terminalizationId)
        ),
      },
      terminal,
    });
  }

  const committedJournal = projectKnowledgeForwardRevisionRecoveryJournalCommitted(
    journal,
    projection.observedAt
  );
  const finalized = projectForwardRevisionApplyFinalization(state, committedJournal);
  const finalizedManifestRaw = findBundleSlot(
    finalized.next,
    "manifests",
    committedJournal.bundleId
  );
  if (finalizedManifestRaw === null) throw new KnowledgeRuntimeStoreCorruptError();
  let finalizedManifest = parseSourceManifest(finalizedManifestRaw);
  if (!finalizedManifest.ok) throw new KnowledgeRuntimeStoreCorruptError();
  const activeOverlay = listManifestForwardRevisionOverlays(finalizedManifest.value).find(
    (entry) => entry.forwardTransactionId === committedJournal.transactionId
  );
  if (activeOverlay === undefined) throw new KnowledgeRuntimeStoreCorruptError();
  const manifestWithoutTerminalOverlay =
    projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit(
      finalizedManifest.value,
      activeOverlay
    );
  const sourceBase = finalized.ledger.sourceBase;
  const terminalLedger = createKnowledgeForwardRevisionApplyLedgerRecord({
    committedJournal,
    sourceBase,
    manifestAfterRevision: manifestWithoutTerminalOverlay.revision,
    manifestAfterDigest: createSourceManifestDigest(manifestWithoutTerminalOverlay),
    appliedAt: committedJournal.committedAt,
  });
  if (terminalLedger.forwardLedgerIdentityDigest !== finalized.ledger.forwardLedgerIdentityDigest) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return Object.freeze({
    next: {
      ...finalized.next,
      manifests: replaceBundleSlot(
        finalized.next.manifests,
        committedJournal.bundleId,
        manifestWithoutTerminalOverlay
      ),
      forwardRevisionApplyCommits: finalized.next.forwardRevisionApplyCommits
        .map((record) =>
          record.transactionId === terminalLedger.transactionId ? terminalLedger : record
        )
        .sort((left, right) => compareIdentifiers(left.transactionId, right.transactionId)),
      forwardRevisionRecoveryTerminals: [
        ...finalized.next.forwardRevisionRecoveryTerminals,
        terminal,
      ].sort((left, right) => compareIdentifiers(left.terminalizationId, right.terminalizationId)),
    },
    terminal,
  });
}

function confirmForwardRevisionRecoveryTerminalization(
  state: KnowledgeRuntimeStoreSnapshot,
  projection: Extract<
    KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1,
    { transition: "terminalize" }
  >
): Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1> | undefined {
  if (state.activeForwardRevisionApply !== null) return undefined;
  const matches = state.forwardRevisionRecoveryTerminals.filter(
    (record) =>
      record.journal.transactionId === projection.previousJournal.transactionId &&
      record.journal.recoveryJournalDigest === projection.previousJournalDigest &&
      record.observation.observedAt === projection.observedAt &&
      record.observation.actualKind === projection.observation.kind &&
      (record.observation.actualKind !== "file" ||
        (projection.observation.kind === "file" &&
          record.observation.actualHash === projection.observation.contentHash))
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function createForwardRevisionApplyResourceProbeHash(
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): string {
  for (let index = 0; index < 3; index += 1) {
    const digest = sha256(
      `knowledge-forward-revision-apply-resource-probe-v1\n${journal.transactionId}\n${index}`
    );
    if (digest !== journal.beforeHash && digest !== journal.afterHash) return digest;
  }
  throw createForwardRevisionApplyPortError("resource_limit");
}

function assertForwardRevisionApplyLineageTimestampFloor(
  state: KnowledgeRuntimeStoreSnapshot,
  journal: Readonly<KnowledgeForwardRevisionApplyJournalV1>
): void {
  const manifestRaw = findBundleSlot(state, "manifests", journal.bundleId);
  if (manifestRaw === null) throw createForwardRevisionApplyPortError("authority_unavailable");
  const parsedManifest = parseSourceManifest(manifestRaw);
  if (
    !parsedManifest.ok ||
    !validateSourceManifest(parsedManifest.value).valid ||
    parsedManifest.value.bundleId !== journal.bundleId
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const predecessor = listManifestForwardRevisionOverlays(parsedManifest.value).find(
    (entry) => entry.windowsPathKey === journal.windowsPathKey
  );
  if (
    (predecessor === undefined &&
      journal.previousEffectiveContentHash !== journal.sourceAppliedContentHash) ||
    (predecessor !== undefined &&
      (predecessor.bundleId !== journal.bundleId ||
        predecessor.pagePath !== journal.pagePath ||
        predecessor.sourceId !== journal.sourceId ||
        predecessor.sourceAppliedContentHash !== journal.sourceAppliedContentHash ||
        predecessor.effectiveContentHash !== journal.previousEffectiveContentHash ||
        journal.createdAt < predecessor.appliedAt))
  ) {
    throw createForwardRevisionApplyPortError("authority_unavailable");
  }
}

function assertForwardRevisionApplyBeginResources(
  state: KnowledgeRuntimeStoreSnapshot,
  prepared: Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1>,
  maxTextCharacters: number
): void {
  try {
    if (state.revision > Number.MAX_SAFE_INTEGER - 4) {
      throw createForwardRevisionApplyPortError("resource_limit");
    }
    const manifestRaw = findBundleSlot(state, "manifests", prepared.bundleId);
    if (manifestRaw === null) throw createForwardRevisionApplyPortError("authority_unavailable");
    const parsedManifest = parseSourceManifest(manifestRaw);
    if (
      !parsedManifest.ok ||
      !validateSourceManifest(parsedManifest.value).valid ||
      parsedManifest.value.bundleId !== prepared.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      parsedManifest.value.revision === Number.MAX_SAFE_INTEGER ||
      listManifestForwardRevisionOverlays(parsedManifest.value).length >= 10_000
    ) {
      throw createForwardRevisionApplyPortError("resource_limit");
    }
    const applying = projectKnowledgeForwardRevisionApplyJournalApplying(
      prepared,
      Number.MAX_SAFE_INTEGER
    );
    const committed = projectKnowledgeForwardRevisionApplyJournalCommitted(
      applying,
      Number.MAX_SAFE_INTEGER
    );
    const recovery = projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(committed, {
      code: "post_write_verification_failed",
      actualKind: "file",
      actualHash: createForwardRevisionApplyResourceProbeHash(committed),
      detectedAt: Number.MAX_SAFE_INTEGER,
    });
    const preparedState: KnowledgeRuntimeStoreSnapshot = {
      ...state,
      revision: state.revision + 1,
      activeForwardRevisionApply: prepared,
    };
    const applyingState: KnowledgeRuntimeStoreSnapshot = {
      ...preparedState,
      revision: state.revision + 2,
      activeForwardRevisionApply: applying,
    };
    const committedState: KnowledgeRuntimeStoreSnapshot = {
      ...applyingState,
      revision: state.revision + 3,
      activeForwardRevisionApply: committed,
    };
    const recoveryState: KnowledgeRuntimeStoreSnapshot = {
      ...committedState,
      revision: state.revision + 4,
      activeForwardRevisionApply: recovery,
    };
    const finalizedState = projectForwardRevisionApplyFinalization(committedState, committed).next;
    if (
      [preparedState, applyingState, committedState, recoveryState, finalizedState].some((value) =>
        serializedRuntimeValueExceedsLimit(value, maxTextCharacters)
      )
    ) {
      throw createForwardRevisionApplyPortError("resource_limit");
    }
  } catch (error) {
    if (KnowledgeForwardRevisionApplyPortError.inspect(error)) throw error;
    if (error instanceof KnowledgeRuntimeStoreCorruptError) throw error;
    throw createForwardRevisionApplyPortError("resource_limit");
  }
}

function assertForwardRevisionApplyExclusiveMutation(
  current: KnowledgeRuntimeStoreSnapshot,
  next: KnowledgeRuntimeStoreSnapshot
): void {
  if (current.activeForwardRevisionApply === null) return;
  const previous = snapshotKnowledgeForwardRevisionApplyJournal(current.activeForwardRevisionApply);
  if (next.activeForwardRevisionApply === null) {
    if (previous.phase === "recovery_required") {
      const currentTerminalIds = new Set(
        current.forwardRevisionRecoveryTerminals.map((record) => record.terminalizationId)
      );
      const appended = next.forwardRevisionRecoveryTerminals.filter(
        (record) => !currentTerminalIds.has(record.terminalizationId)
      );
      if (appended.length !== 1) {
        throw createForwardRevisionApplyPortError("conflict");
      }
      let transition: ReturnType<typeof snapshotKnowledgeForwardRevisionRecoveryTerminalTransition>;
      try {
        transition = snapshotKnowledgeForwardRevisionRecoveryTerminalTransition(
          previous,
          appended[0]
        );
      } catch {
        throw createForwardRevisionApplyPortError("conflict");
      }
      const expected = projectForwardRevisionRecoveryTerminalization(
        current,
        Object.freeze({
          version: 1 as const,
          kind: "forward_revision_apply_transition_capability_projection" as const,
          transition: "terminalize" as const,
          previousJournal: transition.previousJournal,
          previousJournalDigest: transition.previousJournalDigest,
          observation: transition.observation,
          observedAt: transition.observedAt,
        }),
        transition.terminal.terminalizedAt
      ).next;
      if (!exactJsonValuesEqual(next, expected)) {
        throw createForwardRevisionApplyPortError("conflict");
      }
      return;
    }
    if (previous.phase !== "committed") {
      throw createForwardRevisionApplyPortError("conflict");
    }
    const expected = projectForwardRevisionApplyFinalization(current, previous).next;
    if (!exactJsonValuesEqual(next, expected)) {
      throw createForwardRevisionApplyPortError("conflict");
    }
    return;
  }
  const candidate = snapshotKnowledgeForwardRevisionApplyJournal(next.activeForwardRevisionApply);
  const expectedJournal = (() => {
    if (candidate.phase === "applying") {
      return projectKnowledgeForwardRevisionApplyJournalApplying(previous, candidate.updatedAt);
    }
    if (candidate.phase === "committed") {
      if (previous.phase === "recovery_required") {
        return projectKnowledgeForwardRevisionRecoveryJournalCommitted(
          previous,
          previous.revision === 3 ? previous.updatedAt : candidate.committedAt
        );
      }
      return projectKnowledgeForwardRevisionApplyJournalCommitted(previous, candidate.committedAt);
    }
    if (candidate.phase === "recovery_required") {
      return projectKnowledgeForwardRevisionApplyJournalRecoveryRequired(previous, {
        code: candidate.conflict.code,
        actualKind: candidate.conflict.actualKind,
        ...(candidate.conflict.actualHash === undefined
          ? {}
          : { actualHash: candidate.conflict.actualHash }),
        detectedAt: candidate.conflict.detectedAt,
      });
    }
    throw createForwardRevisionApplyPortError("conflict");
  })();
  const expected: KnowledgeRuntimeStoreSnapshot = {
    ...current,
    revision: nextStoreRevision(current),
    activeForwardRevisionApply: expectedJournal,
  };
  if (!exactJsonValuesEqual(candidate, expectedJournal) || !exactJsonValuesEqual(next, expected)) {
    throw createForwardRevisionApplyPortError("conflict");
  }
}

function createForwardRevisionAcceptedLifecycleKey(identity: {
  bundleId: string;
  proposalId: string;
  proposalDigest: string;
  acceptedDecisionDigest: string;
  applyClaimId: string;
  applyClaimDigest: string;
}): string {
  return [
    identity.bundleId,
    identity.proposalId,
    identity.proposalDigest,
    identity.acceptedDecisionDigest,
    identity.applyClaimId,
    identity.applyClaimDigest,
  ].join("\n");
}

function createForwardRevisionLifecycleResourceForDecision(
  runtimeId: string,
  decision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>
) {
  return createKnowledgeForwardRevisionLifecycleResourceIdentity({
    runtimeId,
    bundleId: decision.proposal.request.bundleId,
    sourceId: decision.proposal.request.intent.current.primarySourceId,
    pagePath: decision.proposal.request.pagePath,
  });
}

function createForwardRevisionAcceptedClaimIdentityForDecision(
  runtimeId: string,
  decision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>
) {
  return createKnowledgeForwardRevisionAcceptedClaimIdentity({
    resource: createForwardRevisionLifecycleResourceForDecision(runtimeId, decision),
    acceptedDecisionDigest: decision.acceptedDecisionDigest,
    applyClaimId: decision.applyClaim.claimId,
    applyClaimDigest: decision.applyClaimDigest,
    proposalId: decision.proposal.proposalId,
    proposalDigest: decision.proposalDigest,
    acceptedAfterHash: decision.acceptedAfterHash,
    acceptedAt: decision.acceptedAt,
  });
}

function acceptedForwardRevisionReviewIsTerminal(
  state: KnowledgeRuntimeStoreSnapshot,
  decision: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>
): boolean {
  const key = createForwardRevisionAcceptedLifecycleKey({
    bundleId: decision.proposal.request.bundleId,
    proposalId: decision.proposal.proposalId,
    proposalDigest: decision.proposalDigest,
    acceptedDecisionDigest: decision.acceptedDecisionDigest,
    applyClaimId: decision.applyClaim.claimId,
    applyClaimDigest: decision.applyClaimDigest,
  });
  if (
    state.activeForwardRevisionApply !== null &&
    createForwardRevisionAcceptedLifecycleKey(state.activeForwardRevisionApply) === key
  ) {
    return false;
  }
  return (
    state.forwardRevisionApplyCommits.some(
      (record) => createForwardRevisionAcceptedLifecycleKey(record) === key
    ) ||
    state.forwardRevisionAbandonments.some(
      (record) =>
        createForwardRevisionAcceptedLifecycleKey({
          bundleId: record.acceptedIdentity.resource.bundleId,
          proposalId: record.acceptedIdentity.proposalId,
          proposalDigest: record.acceptedIdentity.proposalDigest,
          acceptedDecisionDigest: record.acceptedIdentity.acceptedDecisionDigest,
          applyClaimId: record.acceptedIdentity.applyClaimId,
          applyClaimDigest: record.acceptedIdentity.applyClaimDigest,
        }) === key
    ) ||
    state.forwardRevisionRecoveryTerminals.some(
      (record) =>
        createForwardRevisionAcceptedLifecycleKey({
          bundleId: record.acceptedIdentity.resource.bundleId,
          proposalId: record.acceptedIdentity.proposalId,
          proposalDigest: record.acceptedIdentity.proposalDigest,
          acceptedDecisionDigest: record.acceptedIdentity.acceptedDecisionDigest,
          applyClaimId: record.acceptedIdentity.applyClaimId,
          applyClaimDigest: record.acceptedIdentity.applyClaimDigest,
        }) === key
    )
  );
}

function createForwardRevisionLedgerLineageRefForLedger(
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>
) {
  return createKnowledgeForwardRevisionLedgerLineageRef({
    ledgerKind: "forward_revision_apply",
    resource: createKnowledgeForwardRevisionLifecycleResourceIdentity({
      runtimeId: ledger.runtimeId,
      bundleId: ledger.bundleId,
      sourceId: ledger.sourceId,
      pagePath: ledger.pagePath,
    }),
    transactionId: ledger.transactionId,
    ledgerIdentityDigest: ledger.forwardLedgerIdentityDigest,
    casBeforeHash: ledger.previousEffectiveContentHash,
    afterHash: ledger.effectiveContentHash,
    appliedAt: ledger.appliedAt,
  });
}

function createSourceApplyDeletedPageHash(
  ledger: Readonly<KnowledgeApplyCommitLedgerRecord>,
  change: Extract<KnowledgeFileChange, { operation: "delete" }>
): string {
  return sha256(
    `knowledge-source-apply-deleted-page-v1\n${canonicalizeJson({
      version: 1,
      kind: "knowledge_source_apply_deleted_page",
      runtimeTransactionId: ledger.transactionId,
      bundleId: ledger.bundleId,
      sourceId: ledger.sourceId,
      pagePath: change.path,
      windowsPathKey: toWindowsPathKey(change.path),
      beforeHash: change.beforeHash,
    })}`
  );
}

function getSourceApplyPageAfterHash(
  ledger: Readonly<KnowledgeApplyCommitLedgerRecord>,
  change: Extract<KnowledgeFileChange, { operation: "update" | "delete" }>
): string {
  return change.operation === "update"
    ? change.afterHash
    : createSourceApplyDeletedPageHash(ledger, change);
}

function createSourceApplyPageLedgerIdentityDigest(
  ledger: Readonly<KnowledgeApplyCommitLedgerRecord>,
  change: Extract<KnowledgeFileChange, { operation: "update" | "delete" }>
): string {
  return sha256(
    `knowledge-source-apply-page-ledger-identity-v1\n${canonicalizeJson({
      version: 1,
      kind: "knowledge_source_apply_page_ledger_identity",
      ledger,
      operation: change.operation,
      pagePath: change.path,
      windowsPathKey: toWindowsPathKey(change.path),
      beforeHash: change.beforeHash,
      afterHash: getSourceApplyPageAfterHash(ledger, change),
      sourceRefs: [...change.sourceRefs].sort(compareIdentifiers),
    })}`
  );
}

function requireAcceptedSourceApplyRecordForLedger(
  state: KnowledgeRuntimeStoreSnapshot,
  ledger: Readonly<KnowledgeApplyCommitLedgerRecord>
): Readonly<AcceptedChangeSetReviewRecord> {
  const rawReview = findBundleSlot(state, "reviews", ledger.bundleId);
  if (rawReview === null) throw new KnowledgeRuntimeStoreCorruptError();
  const parsedReview = parseChangeSetReviewSnapshot(rawReview);
  if (!parsedReview.ok || !validateChangeSetReviewSnapshot(parsedReview.value).valid) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const accepted = parsedReview.value.records.filter(
    (record): record is AcceptedChangeSetReviewRecord =>
      record.outcome === "accepted" && ledgerMatchesAcceptedRecord(ledger, ledger.bundleId, record)
  );
  if (accepted.length !== 1) throw new KnowledgeRuntimeStoreCorruptError();
  return accepted[0];
}

function projectSourceApplyPageLedgerLineageRef(
  state: KnowledgeRuntimeStoreSnapshot,
  ledger: Readonly<KnowledgeApplyCommitLedgerRecord>,
  pagePath: string
) {
  const accepted = requireAcceptedSourceApplyRecordForLedger(state, ledger);
  const changes = accepted.acceptedChangeSet.changes.filter(
    (change): change is Extract<KnowledgeFileChange, { operation: "update" | "delete" }> =>
      (change.operation === "update" || change.operation === "delete") &&
      change.path === pagePath &&
      toWindowsPathKey(change.path) === toWindowsPathKey(pagePath) &&
      change.sourceRefs.includes(ledger.sourceId)
  );
  if (changes.length !== 1) throw new KnowledgeRuntimeStoreCorruptError();
  const change = changes[0];
  return createKnowledgeForwardRevisionLedgerLineageRef({
    ledgerKind: "source_apply",
    resource: createKnowledgeForwardRevisionLifecycleResourceIdentity({
      runtimeId: state.runtimeId,
      bundleId: ledger.bundleId,
      sourceId: ledger.sourceId,
      pagePath,
    }),
    transactionId: ledger.transactionId,
    ledgerIdentityDigest: createSourceApplyPageLedgerIdentityDigest(ledger, change),
    casBeforeHash: change.beforeHash,
    afterHash: getSourceApplyPageAfterHash(ledger, change),
    appliedAt: ledger.recordedAt,
  });
}

function forwardRevisionOverlayMatchesLedger(
  overlay: Readonly<KnowledgeForwardRevisionOverlayEntry>,
  ledger: Readonly<KnowledgeForwardRevisionApplyLedgerRecord>
): boolean {
  return (
    overlay.bundleId === ledger.bundleId &&
    overlay.sourceId === ledger.sourceId &&
    overlay.pagePath === ledger.pagePath &&
    overlay.windowsPathKey === ledger.windowsPathKey &&
    overlay.sourceBaseDigest === ledger.sourceBaseDigest &&
    overlay.sourceAppliedContentHash === ledger.sourceAppliedContentHash &&
    overlay.previousEffectiveContentHash === ledger.previousEffectiveContentHash &&
    overlay.effectiveContentHash === ledger.effectiveContentHash &&
    overlay.forwardTransactionId === ledger.transactionId &&
    overlay.acceptedDecisionDigest === ledger.acceptedDecisionDigest &&
    (overlay.forwardLedgerIdentityDigest === ledger.forwardLedgerIdentityDigest ||
      (ledger.legacyForwardLedgerIdentityDigest !== null &&
        overlay.forwardLedgerIdentityDigest === ledger.legacyForwardLedgerIdentityDigest)) &&
    overlay.appliedAt === ledger.appliedAt
  );
}

function assertForwardRevisionApplySemantics(
  state: KnowledgeRuntimeStoreSnapshot,
  manifests: ReadonlyMap<string, SourceManifest>
): void {
  type AcceptedEntry = Extract<
    KnowledgeForwardRevisionTerminalReviewEntryV2,
    { state: "accepted" }
  >;
  const overlays = new Map<string, Readonly<KnowledgeForwardRevisionOverlayEntry>>();
  const pageOwners = new Map<
    string,
    Array<{
      bundleId: string;
      source: SourceManifestEntry;
      page: GeneratedPageReference;
    }>
  >();
  for (const [bundleId, manifest] of manifests) {
    for (const overlay of listManifestForwardRevisionOverlays(manifest)) {
      const key = overlay.windowsPathKey;
      if (overlay.bundleId !== bundleId || overlays.has(key)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      overlays.set(key, overlay);
    }
    for (const source of manifest.entries) {
      for (const page of source.lastSuccessful?.generatedPages ?? []) {
        const key = toWindowsPathKey(page.path);
        const owners = pageOwners.get(key) ?? [];
        owners.push({ bundleId, source, page });
        pageOwners.set(key, owners);
      }
    }
  }
  const acceptedEntries = new Map<string, AcceptedEntry>();
  for (const slot of state.forwardRevisionReviews) {
    const review = snapshotKnowledgeForwardRevisionReviewSnapshotV2(slot.value);
    const previousEntriesByPage = new Map<
      string,
      Readonly<KnowledgeForwardRevisionReviewEntryV2>
    >();
    for (const entry of review.records) {
      const publication = projectKnowledgeForwardRevisionReviewEntryProposalV2(entry);
      const pageKey = toWindowsPathKey(publication.proposal.request.pagePath);
      const previous = previousEntriesByPage.get(pageKey);
      if (
        previous?.state === "accepted" &&
        !acceptedForwardRevisionReviewIsTerminal(state, previous.decision)
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      previousEntriesByPage.set(pageKey, entry);
      if (entry.state !== "accepted") continue;
      const decision = entry.decision;
      const key = createForwardRevisionAcceptedLifecycleKey({
        bundleId: slot.bundleId,
        proposalId: decision.proposal.proposalId,
        proposalDigest: decision.proposalDigest,
        acceptedDecisionDigest: decision.acceptedDecisionDigest,
        applyClaimId: decision.applyClaim.claimId,
        applyClaimDigest: decision.applyClaimDigest,
      });
      if (acceptedEntries.has(key)) throw new KnowledgeRuntimeStoreCorruptError();
      acceptedEntries.set(key, entry);
    }
  }

  const findAccepted = (identity: {
    bundleId: string;
    proposalId: string;
    proposalDigest: string;
    acceptedDecisionDigest: string;
    applyClaimId: string;
    applyClaimDigest: string;
  }): AcceptedEntry | undefined =>
    acceptedEntries.get(createForwardRevisionAcceptedLifecycleKey(identity));

  const ledgersByIdentity = new Map<string, Readonly<KnowledgeForwardRevisionApplyLedgerRecord>>();
  const ledgersByTransaction = new Map<
    string,
    Readonly<KnowledgeForwardRevisionApplyLedgerRecord>
  >();
  const ledgerAcceptedKeys = new Map<string, string>();
  for (const ledger of state.forwardRevisionApplyCommits) {
    const manifest = manifests.get(ledger.bundleId);
    const accepted = findAccepted(ledger);
    if (!manifest || !accepted) throw new KnowledgeRuntimeStoreCorruptError();
    const decision = accepted.decision;
    if (
      ledger.runtimeId !== state.runtimeId ||
      ledger.manifestAfterRevision > manifest.revision ||
      (ledger.manifestAfterRevision === manifest.revision &&
        ledger.manifestAfterDigest !== createSourceManifestDigest(manifest)) ||
      createKnowledgeForwardRevisionSourceBaseDigest(ledger.sourceBase) !==
        ledger.sourceBaseDigest ||
      ledger.sourceBase.bundleId !== ledger.bundleId ||
      ledger.sourceBase.sourceId !== ledger.sourceId ||
      ledger.sourceId !== decision.proposal.request.intent.current.primarySourceId ||
      ledger.pagePath !== decision.proposal.request.pagePath ||
      ledger.windowsPathKey !== toWindowsPathKey(decision.proposal.request.pagePath) ||
      ledger.sourceAppliedContentHash !== decision.acceptanceAuthority.manifestBaseHash ||
      ledger.previousEffectiveContentHash !==
        decision.acceptanceAuthority.vaultObservedBeforeHash ||
      ledger.originalValidationReceiptDigest !== decision.validationReceiptDigest ||
      ledger.appliedAt < decision.acceptedAt ||
      decision.afterContent.length === 0 ||
      decision.acceptedAfterHash !== ledger.effectiveContentHash ||
      ledgersByIdentity.has(ledger.forwardLedgerIdentityDigest) ||
      ledgersByTransaction.has(ledger.transactionId)
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    ledgersByIdentity.set(ledger.forwardLedgerIdentityDigest, ledger);
    ledgersByTransaction.set(ledger.transactionId, ledger);
    ledgerAcceptedKeys.set(
      ledger.forwardLedgerIdentityDigest,
      createForwardRevisionAcceptedLifecycleKey(ledger)
    );
  }

  const abandonmentByAcceptedKey = new Map<
    string,
    Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>
  >();
  for (const abandonment of state.forwardRevisionAbandonments) {
    const accepted = findAccepted({
      bundleId: abandonment.acceptedIdentity.resource.bundleId,
      proposalId: abandonment.acceptedIdentity.proposalId,
      proposalDigest: abandonment.acceptedIdentity.proposalDigest,
      acceptedDecisionDigest: abandonment.acceptedIdentity.acceptedDecisionDigest,
      applyClaimId: abandonment.acceptedIdentity.applyClaimId,
      applyClaimDigest: abandonment.acceptedIdentity.applyClaimDigest,
    });
    if (
      !accepted ||
      abandonment.acceptedIdentity.resource.runtimeId !== state.runtimeId ||
      !exactJsonValuesEqual(
        abandonment.acceptedIdentity,
        createForwardRevisionAcceptedClaimIdentityForDecision(state.runtimeId, accepted.decision)
      )
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const key = createForwardRevisionAcceptedLifecycleKey({
      bundleId: abandonment.acceptedIdentity.resource.bundleId,
      proposalId: abandonment.acceptedIdentity.proposalId,
      proposalDigest: abandonment.acceptedIdentity.proposalDigest,
      acceptedDecisionDigest: abandonment.acceptedIdentity.acceptedDecisionDigest,
      applyClaimId: abandonment.acceptedIdentity.applyClaimId,
      applyClaimDigest: abandonment.acceptedIdentity.applyClaimDigest,
    });
    if (abandonmentByAcceptedKey.has(key)) throw new KnowledgeRuntimeStoreCorruptError();
    abandonmentByAcceptedKey.set(key, abandonment);
  }

  const recoveryByAcceptedKey = new Map<
    string,
    Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>
  >();
  for (const terminal of state.forwardRevisionRecoveryTerminals) {
    const identity = terminal.acceptedIdentity;
    const accepted = findAccepted({
      bundleId: identity.resource.bundleId,
      proposalId: identity.proposalId,
      proposalDigest: identity.proposalDigest,
      acceptedDecisionDigest: identity.acceptedDecisionDigest,
      applyClaimId: identity.applyClaimId,
      applyClaimDigest: identity.applyClaimDigest,
    });
    if (
      !accepted ||
      identity.resource.runtimeId !== state.runtimeId ||
      !exactJsonValuesEqual(
        identity,
        createForwardRevisionAcceptedClaimIdentityForDecision(state.runtimeId, accepted.decision)
      )
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const key = createForwardRevisionAcceptedLifecycleKey({
      bundleId: identity.resource.bundleId,
      proposalId: identity.proposalId,
      proposalDigest: identity.proposalDigest,
      acceptedDecisionDigest: identity.acceptedDecisionDigest,
      applyClaimId: identity.applyClaimId,
      applyClaimDigest: identity.applyClaimDigest,
    });
    if (recoveryByAcceptedKey.has(key) || abandonmentByAcceptedKey.has(key)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    recoveryByAcceptedKey.set(key, terminal);
  }

  const outgoingByLedgerIdentity = new Map<
    string,
    Readonly<KnowledgeForwardRevisionSupersessionRecordV1>
  >();
  const incomingByLedgerIdentity = new Map<
    string,
    Readonly<KnowledgeForwardRevisionSupersessionRecordV1>
  >();
  const activeForwardHeadsBySource = new Map<
    string,
    Map<string, Readonly<KnowledgeForwardRevisionApplyLedgerRecord>>
  >();
  const supersessionIds = new Set<string>();
  const supersessionSuccessorKeys = new Set<string>();
  for (const supersession of state.forwardRevisionSupersessions) {
    const successorKey = canonicalizeJson(supersession.successor);
    if (
      supersessionIds.has(supersession.supersessionId) ||
      supersessionSuccessorKeys.has(successorKey)
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    supersessionIds.add(supersession.supersessionId);
    supersessionSuccessorKeys.add(successorKey);
    const predecessor = ledgersByIdentity.get(supersession.predecessor.ledgerIdentityDigest);
    if (
      !predecessor ||
      outgoingByLedgerIdentity.has(predecessor.forwardLedgerIdentityDigest) ||
      !exactJsonValuesEqual(
        supersession.predecessor,
        createForwardRevisionLedgerLineageRefForLedger(predecessor)
      )
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (supersession.successor.ledgerKind === "forward_revision_apply") {
      const successor = ledgersByIdentity.get(supersession.successor.ledgerIdentityDigest);
      if (
        !successor ||
        incomingByLedgerIdentity.has(successor.forwardLedgerIdentityDigest) ||
        !exactJsonValuesEqual(
          supersession.successor,
          createForwardRevisionLedgerLineageRefForLedger(successor)
        )
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      incomingByLedgerIdentity.set(successor.forwardLedgerIdentityDigest, supersession);
    } else {
      const sourceLedger = state.applyCommits.find(
        (candidate) => candidate.transactionId === supersession.successor.transactionId
      );
      if (
        !sourceLedger ||
        !exactJsonValuesEqual(
          supersession.successor,
          projectSourceApplyPageLedgerLineageRef(
            state,
            sourceLedger,
            supersession.predecessor.resource.pagePath
          )
        )
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
    outgoingByLedgerIdentity.set(predecessor.forwardLedgerIdentityDigest, supersession);
  }

  for (const ledger of state.forwardRevisionApplyCommits) {
    const incoming = incomingByLedgerIdentity.get(ledger.forwardLedgerIdentityDigest);
    if (!incoming && ledger.previousEffectiveContentHash !== ledger.sourceAppliedContentHash) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const overlay = overlays.get(ledger.windowsPathKey);
    const ownsOverlay =
      overlay !== undefined && forwardRevisionOverlayMatchesLedger(overlay, ledger);
    const outgoing = outgoingByLedgerIdentity.get(ledger.forwardLedgerIdentityDigest);
    const acceptedKey = ledgerAcceptedKeys.get(ledger.forwardLedgerIdentityDigest)!;
    const recovery = recoveryByAcceptedKey.get(acceptedKey);
    const committedRecovery =
      recovery?.outcome === "committed_then_external_supersession" &&
      recovery.journal.transactionId === ledger.transactionId &&
      recovery.journal.beforeHash === ledger.previousEffectiveContentHash &&
      recovery.journal.afterHash === ledger.effectiveContentHash &&
      recovery.journal.committedAt === ledger.appliedAt;
    const terminalCount =
      Number(ownsOverlay) + Number(outgoing !== undefined) + Number(committedRecovery);
    if (terminalCount !== 1 || (recovery !== undefined && !committedRecovery)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (ownsOverlay) {
      const owners = pageOwners.get(ledger.windowsPathKey) ?? [];
      const owner = owners[0];
      if (
        owners.length !== 1 ||
        owner?.bundleId !== ledger.bundleId ||
        owner.source.sourceId !== ledger.sourceId ||
        owner.page.path !== ledger.pagePath ||
        owner.page.ownership !== "generated" ||
        owner.page.contentHash !== ledger.sourceAppliedContentHash
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const sourceKey = `${ledger.bundleId}\u0000${ledger.sourceId}`;
      const heads =
        activeForwardHeadsBySource.get(sourceKey) ??
        new Map<string, Readonly<KnowledgeForwardRevisionApplyLedgerRecord>>();
      heads.set(ledger.windowsPathKey, ledger);
      activeForwardHeadsBySource.set(sourceKey, heads);
      overlays.delete(ledger.windowsPathKey);
    }
  }
  if (overlays.size > 0) throw new KnowledgeRuntimeStoreCorruptError();

  for (const sourceLedger of state.applyCommits) {
    const sourceKey = `${sourceLedger.bundleId}\u0000${sourceLedger.sourceId}`;
    const activeHeads = activeForwardHeadsBySource.get(sourceKey);
    if (
      !activeHeads ||
      ![...activeHeads.values()].some(
        (forwardLedger) => sourceLedger.manifestAfterRevision > forwardLedger.manifestAfterRevision
      )
    ) {
      continue;
    }
    const accepted = requireAcceptedSourceApplyRecordForLedger(state, sourceLedger);
    for (const change of accepted.acceptedChangeSet.changes) {
      const forwardLedger = activeHeads.get(toWindowsPathKey(change.path));
      if (
        forwardLedger &&
        sourceLedger.manifestAfterRevision > forwardLedger.manifestAfterRevision
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }

  for (const ledger of state.forwardRevisionApplyCommits) {
    const seen = new Set<string>();
    let current: Readonly<KnowledgeForwardRevisionApplyLedgerRecord> | undefined = ledger;
    while (current) {
      if (seen.has(current.forwardLedgerIdentityDigest)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      seen.add(current.forwardLedgerIdentityDigest);
      const edge = outgoingByLedgerIdentity.get(current.forwardLedgerIdentityDigest);
      current =
        edge?.successor.ledgerKind === "forward_revision_apply"
          ? ledgersByIdentity.get(edge.successor.ledgerIdentityDigest)
          : undefined;
    }
  }

  const acceptedLedgerKeys = [...ledgerAcceptedKeys.values()];
  for (const [key, recovery] of recoveryByAcceptedKey) {
    const hasLedger = acceptedLedgerKeys.includes(key);
    if (recovery.outcome === "committed_then_external_supersession" ? !hasLedger : hasLedger) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  for (const key of abandonmentByAcceptedKey.keys()) {
    if (acceptedLedgerKeys.includes(key) || recoveryByAcceptedKey.has(key)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }

  if (state.activeForwardRevisionApply === null) {
    return;
  }
  const journal = snapshotKnowledgeForwardRevisionApplyJournal(state.activeForwardRevisionApply);
  const accepted = findAccepted(journal);
  const manifest = manifests.get(journal.bundleId);
  if (!accepted || !manifest) throw new KnowledgeRuntimeStoreCorruptError();
  const owners = pageOwners.get(journal.windowsPathKey) ?? [];
  const owner = owners[0];
  const sourceBase = recomputeForwardRevisionSourceBase(state, manifest, journal.sourceId);
  const effectivePage = projectKnowledgeEffectiveManifestPages(manifest).find(
    (page) => page.windowsPathKey === journal.windowsPathKey
  );
  const journalAcceptedKey = createForwardRevisionAcceptedLifecycleKey(journal);
  const requiredRemainingRevisions =
    journal.phase === "prepared"
      ? 3
      : journal.phase === "applying"
        ? 2
        : journal.phase === "committed"
          ? 1
          : 0;
  if (
    journal.runtimeId !== state.runtimeId ||
    state.revision > Number.MAX_SAFE_INTEGER - requiredRemainingRevisions ||
    (journal.phase !== "recovery_required" &&
      (manifest.revision === Number.MAX_SAFE_INTEGER ||
        listManifestForwardRevisionOverlays(manifest).length >= 10_000)) ||
    state.applyCommits.some((ledger) => ledger.transactionId === journal.transactionId) ||
    state.forwardRevisionApplyCommits.some(
      (ledger) => ledger.transactionId === journal.transactionId
    ) ||
    abandonmentByAcceptedKey.has(journalAcceptedKey) ||
    recoveryByAcceptedKey.has(journalAcceptedKey) ||
    manifest.revision !== journal.manifestBeforeRevision ||
    createSourceManifestDigest(manifest) !== journal.manifestBeforeDigest ||
    owners.length !== 1 ||
    owner?.bundleId !== journal.bundleId ||
    owner?.source.sourceId !== journal.sourceId ||
    owner.page.path !== journal.pagePath ||
    owner.page.ownership !== "generated" ||
    owner.page.contentHash !== journal.sourceAppliedContentHash ||
    !effectivePage ||
    effectivePage.path !== journal.pagePath ||
    effectivePage.ownership !== "generated" ||
    effectivePage.sourceIds.length !== 1 ||
    effectivePage.sourceIds[0] !== journal.sourceId ||
    effectivePage.sourceAppliedContentHash !== journal.sourceAppliedContentHash ||
    effectivePage.effectiveContentHash !== journal.previousEffectiveContentHash ||
    journal.acceptedDecisionDigest !== accepted.decision.acceptedDecisionDigest ||
    !exactJsonValuesEqual(journal.acceptedDecision, accepted.decision) ||
    journal.revalidationReceipt.runtimeRevision < accepted.decidedRuntimeRevision ||
    journal.revalidationReceipt.runtimeRevision > state.revision - journal.revision - 1 ||
    journal.afterHash !== accepted.decision.acceptedAfterHash ||
    !sourceBase ||
    createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== journal.sourceBaseDigest ||
    journal.sourceAppliedContentHash !== accepted.decision.acceptanceAuthority.manifestBaseHash ||
    journal.previousEffectiveContentHash !==
      accepted.decision.acceptanceAuthority.vaultObservedBeforeHash
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }

  const predecessorOverlay = listManifestForwardRevisionOverlays(manifest).find(
    (overlay) => overlay.windowsPathKey === journal.windowsPathKey
  );
  if (predecessorOverlay) {
    const predecessor = state.forwardRevisionApplyCommits.find((ledger) =>
      forwardRevisionOverlayMatchesLedger(predecessorOverlay, ledger)
    );
    if (
      !predecessor ||
      journal.createdAt < predecessor.appliedAt ||
      outgoingByLedgerIdentity.has(predecessor.forwardLedgerIdentityDigest) ||
      recoveryByAcceptedKey.has(
        ledgerAcceptedKeys.get(predecessor.forwardLedgerIdentityDigest) ?? ""
      )
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  } else if (journal.previousEffectiveContentHash !== journal.sourceAppliedContentHash) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

function assertUniqueBundleSlots(slots: readonly KnowledgeRuntimeBundleSlot[]): void {
  const bundleIds = new Set<string>();
  for (const slot of slots) {
    if (bundleIds.has(slot.bundleId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    bundleIds.add(slot.bundleId);
  }
}

function assertUniqueInputRevisionRecords(
  bundles: readonly {
    bundleId: string;
    sources: readonly { sourceId: string }[];
  }[]
): void {
  const bundleIds = new Set<string>();
  for (const bundle of bundles) {
    if (bundleIds.has(bundle.bundleId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    bundleIds.add(bundle.bundleId);
    const sourceIds = new Set<string>();
    for (const source of bundle.sources) {
      if (sourceIds.has(source.sourceId)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      sourceIds.add(source.sourceId);
    }
  }
}

function assertObservationJournalSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  queues: ReadonlyMap<string, IngestQueueSnapshot>,
  manifests: ReadonlyMap<string, SourceManifest>
): void {
  const captureIds = new Set<string>();
  const observationTokens = new Set<string>();
  for (const bundle of snapshot.inputRevisions) {
    const queue = queues.get(bundle.bundleId);
    for (const source of bundle.sources) {
      const manifest = manifests.get(bundle.bundleId);
      const retirement = manifest
        ? findKnowledgeSourceRetirement(manifest, source.sourceId)
        : undefined;
      if (source.managedAfterRevision > source.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      if (
        source.legacyCheckpoint !== undefined &&
        (source.legacyCheckpoint.sourceId !== source.sourceId ||
          source.legacyCheckpoint.inputRevision > source.managedAfterRevision)
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      let expectedRevision = source.managedAfterRevision + 1;
      let activeBoundRevision: number | undefined;
      let highestBindingRevision: number | undefined;
      let highestConsumed:
        | Extract<KnowledgeRuntimeSourceObservationRecord, { status: "consumed" }>
        | undefined;
      let previousConsumedQueueRevision = 0;
      for (const observation of source.observations) {
        if (
          observation.inputRevision !== expectedRevision ||
          observation.inputRevision > source.inputRevision ||
          observation.allocatedAt >
            ("boundAt" in observation && observation.boundAt !== undefined
              ? observation.boundAt
              : Number.MAX_SAFE_INTEGER) ||
          captureIds.has(observation.captureId) ||
          observationTokens.has(observation.observationToken)
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        captureIds.add(observation.captureId);
        observationTokens.add(observation.observationToken);
        if (observation.status === "bound") {
          if (activeBoundRevision !== undefined) {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
          activeBoundRevision = observation.inputRevision;
        }
        if (
          observation.status === "bound" ||
          observation.status === "consumed" ||
          (observation.status === "superseded" &&
            observation.sourceContentHash !== undefined &&
            observation.pipelineFingerprint !== undefined &&
            observation.boundAt !== undefined) ||
          (observation.status === "retired" &&
            observation.sourceContentHash !== undefined &&
            observation.pipelineFingerprint !== undefined &&
            observation.boundAt !== undefined)
        ) {
          highestBindingRevision = observation.inputRevision;
        }
        if (
          observation.status === "consumed" &&
          (observation.boundAt > observation.settledAt ||
            observation.queueRevision > (queue?.revision ?? 0) ||
            observation.queueRevision <= previousConsumedQueueRevision)
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        if (observation.status === "consumed") {
          highestConsumed = observation;
          previousConsumedQueueRevision = observation.queueRevision;
        }
        if (observation.status === "superseded") {
          const hasAnyBinding =
            observation.sourceContentHash !== undefined ||
            observation.pipelineFingerprint !== undefined ||
            observation.boundAt !== undefined;
          const hasCompleteBinding =
            observation.sourceContentHash !== undefined &&
            observation.pipelineFingerprint !== undefined &&
            observation.boundAt !== undefined;
          if (
            (hasAnyBinding && !hasCompleteBinding) ||
            observation.supersededByInputRevision <= observation.inputRevision ||
            observation.supersededByInputRevision > source.inputRevision ||
            observation.allocatedAt > observation.settledAt ||
            (observation.boundAt !== undefined && observation.boundAt > observation.settledAt)
          ) {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
        }
        if (observation.status === "retired") {
          const hasAnyBinding =
            observation.sourceContentHash !== undefined ||
            observation.pipelineFingerprint !== undefined ||
            observation.boundAt !== undefined;
          const hasCompleteBinding =
            observation.sourceContentHash !== undefined &&
            observation.pipelineFingerprint !== undefined &&
            observation.boundAt !== undefined;
          if (
            (hasAnyBinding && !hasCompleteBinding) ||
            !retirement ||
            observation.retirementId !== retirement.retirementId ||
            observation.allocatedAt > observation.settledAt ||
            (observation.boundAt !== undefined && observation.boundAt > observation.settledAt) ||
            retirement.retiredAt > observation.settledAt
          ) {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
        }
        expectedRevision += 1;
      }
      if (
        retirement &&
        source.observations.some(
          (observation) => observation.status === "allocated" || observation.status === "bound"
        )
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      if (expectedRevision !== source.inputRevision + 1) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const observationsByRevision = new Map(
        source.observations.map((observation) => [observation.inputRevision, observation] as const)
      );
      for (const observation of source.observations) {
        if (
          highestBindingRevision !== undefined &&
          observation.inputRevision < highestBindingRevision &&
          (observation.status === "allocated" || observation.status === "bound")
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        if (observation.status === "superseded") {
          const target = observationsByRevision.get(observation.supersededByInputRevision);
          const targetHasBinding =
            target !== undefined &&
            (target.status === "bound" ||
              target.status === "consumed" ||
              (target.status === "superseded" &&
                target.sourceContentHash !== undefined &&
                target.pipelineFingerprint !== undefined &&
                target.boundAt !== undefined));
          if (!targetHasBinding) {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
        }
      }
      const highWatermark = queue?.sourceHighWatermarks.find(
        (candidate) => candidate.sourceId === source.sourceId
      );
      if (highWatermark === undefined) {
        if (highestConsumed !== undefined || source.legacyCheckpoint !== undefined) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        continue;
      }
      if (highWatermark.inputRevision > source.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const highWatermarkMatchesManagedConsumption =
        highestConsumed !== undefined &&
        highestConsumed.inputRevision === highWatermark.inputRevision &&
        highestConsumed.sourceContentHash === highWatermark.sourceContentHash &&
        highestConsumed.pipelineFingerprint === highWatermark.pipelineFingerprint;
      const highWatermarkMatchesMigrationCheckpoint =
        highestConsumed === undefined &&
        exactJsonValuesEqual(source.legacyCheckpoint, highWatermark);
      if (!highWatermarkMatchesManagedConsumption && !highWatermarkMatchesMigrationCheckpoint) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      if (activeBoundRevision !== undefined && activeBoundRevision <= highWatermark.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
  for (const [bundleId, queue] of queues) {
    const sources = snapshot.inputRevisions.find(
      (candidate) => candidate.bundleId === bundleId
    )?.sources;
    for (const highWatermark of queue.sourceHighWatermarks) {
      if (!sources?.some((source) => source.sourceId === highWatermark.sourceId)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

function assertUniqueApplyCommits(records: readonly KnowledgeApplyCommitLedgerRecord[]): void {
  const transactionIds = new Set<string>();
  const manifestRevisions = new Map<string, Set<number>>();
  const sourceHistories = new Map<string, KnowledgeApplyCommitLedgerRecord[]>();
  for (const record of records) {
    if (transactionIds.has(record.transactionId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      record.manifestBeforeRevision === Number.MAX_SAFE_INTEGER ||
      record.manifestAfterRevision !== record.manifestBeforeRevision + 1 ||
      record.manifestBeforeDigest === record.manifestAfterDigest
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const revisions = manifestRevisions.get(record.bundleId) ?? new Set<number>();
    if (revisions.has(record.manifestAfterRevision)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    revisions.add(record.manifestAfterRevision);
    manifestRevisions.set(record.bundleId, revisions);
    const sourceKey = `${record.bundleId}\u0000${record.sourceId}`;
    const history = sourceHistories.get(sourceKey) ?? [];
    history.push(record);
    sourceHistories.set(sourceKey, history);
    transactionIds.add(record.transactionId);
  }
  for (const history of sourceHistories.values()) {
    history.sort((left, right) => left.manifestAfterRevision - right.manifestAfterRevision);
    for (let index = 1; index < history.length; index += 1) {
      if (history[index].inputRevision <= history[index - 1].inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

function assertManifestLedgerSemantics(
  records: readonly KnowledgeApplyCommitLedgerRecord[],
  manifests: ReadonlyMap<string, SourceManifest>
): void {
  const histories = new Map<string, KnowledgeApplyCommitLedgerRecord[]>();
  const bundleHistories = new Map<string, KnowledgeApplyCommitLedgerRecord[]>();

  for (const record of records) {
    const manifest = manifests.get(record.bundleId);
    const source = manifest
      ? findKnowledgeSourceHistoryEntry(manifest, record.sourceId)
      : undefined;
    if (!manifest || !source || record.manifestAfterRevision > manifest.revision) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      record.manifestAfterRevision === manifest.revision &&
      record.manifestAfterDigest !== createSourceManifestDigest(manifest)
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const sourceKey = `${record.bundleId}\u0000${record.sourceId}`;
    const sourceHistory = histories.get(sourceKey) ?? [];
    sourceHistory.push(record);
    histories.set(sourceKey, sourceHistory);
    const bundleHistory = bundleHistories.get(record.bundleId) ?? [];
    bundleHistory.push(record);
    bundleHistories.set(record.bundleId, bundleHistory);
  }

  for (const history of bundleHistories.values()) {
    history.sort((left, right) => left.manifestAfterRevision - right.manifestAfterRevision);
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1];
      const current = history[index];
      if (
        current.manifestBeforeRevision === previous.manifestAfterRevision &&
        current.manifestBeforeDigest !== previous.manifestAfterDigest
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }

  for (const manifest of manifests.values()) {
    const generatedPages = new Map<
      string,
      { path: string; ownership: string; contentHash: string; sourceIds: Set<string> }
    >();
    for (const entry of manifest.entries) {
      const success = entry.lastSuccessful;
      const rawExtension = entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
      const sourceKey = `${manifest.bundleId}\u0000${entry.sourceId}`;
      const history = histories.get(sourceKey) ?? [];
      if (!success || rawExtension === undefined) {
        if (success !== undefined || rawExtension !== undefined || history.length > 0) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        continue;
      }
      for (const page of success.generatedPages) {
        if (page.contentHash === undefined) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        const pathKey = toWindowsPathKey(page.path);
        const existing = generatedPages.get(pathKey);
        if (!existing) {
          generatedPages.set(pathKey, {
            path: page.path,
            ownership: page.ownership,
            contentHash: page.contentHash,
            sourceIds: new Set([entry.sourceId]),
          });
          continue;
        }
        if (
          existing.sourceIds.has(entry.sourceId) ||
          existing.path !== page.path ||
          existing.ownership !== page.ownership ||
          existing.contentHash !== page.contentHash
        ) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        existing.sourceIds.add(entry.sourceId);
      }
      const extension = parseKnowledgeRuntimeSourceCommitExtension(rawExtension);
      if (!extension.ok || history.length === 0) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const latest = [...history].sort(
        (left, right) => right.manifestAfterRevision - left.manifestAfterRevision
      )[0];
      if (
        extension.value.transactionId !== latest.transactionId ||
        extension.value.inputRevision !== latest.inputRevision ||
        extension.value.manifestIntentDigest !== latest.manifestIntentDigest ||
        success.sourceContentHash !== latest.sourceContentHash ||
        success.pipelineFingerprint !== latest.pipelineFingerprint ||
        success.changeSetId !== latest.changeSetId ||
        success.completedAt !== latest.recordedAt
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
    const retirements = parseKnowledgeSourceRetirements(manifest);
    if (!retirements.ok) throw new KnowledgeRuntimeStoreCorruptError();
    for (const retirement of retirements.value) {
      const entry = retirement.source;
      const success = entry.lastSuccessful;
      const rawExtension = entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
      const sourceKey = `${manifest.bundleId}\u0000${entry.sourceId}`;
      const history = histories.get(sourceKey) ?? [];
      if (!success || rawExtension === undefined) {
        if (success !== undefined || rawExtension !== undefined || history.length > 0) {
          throw new KnowledgeRuntimeStoreCorruptError();
        }
        continue;
      }
      const extension = parseKnowledgeRuntimeSourceCommitExtension(rawExtension);
      if (!extension.ok || history.length === 0) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const latest = [...history].sort(
        (left, right) => right.manifestAfterRevision - left.manifestAfterRevision
      )[0];
      if (
        extension.value.transactionId !== latest.transactionId ||
        extension.value.inputRevision !== latest.inputRevision ||
        extension.value.manifestIntentDigest !== latest.manifestIntentDigest ||
        success.sourceContentHash !== latest.sourceContentHash ||
        success.pipelineFingerprint !== latest.pipelineFingerprint ||
        success.changeSetId !== latest.changeSetId ||
        success.completedAt !== latest.recordedAt ||
        latest.manifestAfterRevision >= retirement.retiredManifestRevision
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
    for (const page of generatedPages.values()) {
      if (page.sourceIds.size > 1 && page.ownership !== "shared") {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

function assertQueueApplyCommitLedgerSemantics(
  records: readonly KnowledgeApplyCommitLedgerRecord[],
  queues: ReadonlyMap<string, IngestQueueSnapshot>
): void {
  const recordsByTransaction = new Map(
    records.map((record) => [record.transactionId, record] as const)
  );
  for (const [bundleId, queue] of queues) {
    const marker = queue.applyCommit;
    if (!marker) {
      continue;
    }
    const record = recordsByTransaction.get(marker.transactionId);
    if (
      !record ||
      record.bundleId !== bundleId ||
      record.sourceId !== marker.sourceId ||
      record.sourceContentHash !== marker.sourceContentHash ||
      record.pipelineFingerprint !== marker.pipelineFingerprint ||
      record.inputRevision !== marker.inputRevision ||
      record.changeSetId !== marker.changeSetId ||
      record.changeSetDigest !== marker.changeSetDigest ||
      record.commitRevision !== marker.commitRevision ||
      record.recordedAt !== marker.committedAt
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
}

function noChangesBasePagesMatchSource(
  source: SourceManifestEntry,
  basePages: readonly ManifestCommitPage[],
  allowSharedHashDrift: boolean
): boolean {
  const currentPages = source.lastSuccessful?.generatedPages ?? [];
  if (basePages.length !== currentPages.length) return false;
  const currentByPathKey = new Map(
    currentPages.map((page) => [toWindowsPathKey(page.path), page] as const)
  );
  return basePages.every((page) => {
    const current = currentByPathKey.get(toWindowsPathKey(page.path));
    return (
      current !== undefined &&
      page.path === current.path &&
      page.ownership === current.ownership &&
      ((allowSharedHashDrift && page.ownership === "shared") ||
        page.contentHash === current.contentHash)
    );
  });
}

function assertNoChangesCommitSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  manifests: ReadonlyMap<string, SourceManifest>,
  queues: ReadonlyMap<string, IngestQueueSnapshot>
): void {
  for (const [bundleId, manifest] of manifests) {
    const queue = queues.get(bundleId);
    let sourceHistory: SourceManifestEntry[];
    try {
      sourceHistory = listKnowledgeSourceHistoryEntries(manifest);
    } catch {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    for (const source of sourceHistory) {
      const rawMarker = source.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
      if (rawMarker === undefined) continue;
      const parsed = parseKnowledgeNoChangesCommitMarker(rawMarker);
      if (!parsed.ok || !validateNoChangesManifestCommitMarker(parsed.value).valid || !queue) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const marker = parsed.value;
      const job = queue.jobs.find((candidate) => candidate.id === marker.jobId);
      const highWatermark = queue.sourceHighWatermarks.find(
        (candidate) => candidate.sourceId === source.sourceId
      );
      const observations =
        snapshot.inputRevisions
          .find((bundle) => bundle.bundleId === bundleId)
          ?.sources.find((candidate) => candidate.sourceId === source.sourceId)
          ?.observations.filter(
            (observation) =>
              observation.status === "consumed" &&
              observation.inputRevision === marker.inputRevision &&
              observation.sourceContentHash === marker.sourceContentHash &&
              observation.pipelineFingerprint === marker.pipelineFingerprint
          ) ?? [];
      let sourceAuthority: ReturnType<typeof deriveKnowledgeSourceCompileAuthority>;
      try {
        sourceAuthority = deriveKnowledgeSourceCompileAuthority(source);
      } catch {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const sourceAuthorityMatches =
        marker.kind === "query_writeback_source_compile"
          ? sourceAuthority.operation === "query_writeback" &&
            sourceAuthority.sourceOriginDigest === marker.sourceOriginDigest &&
            sourceAuthority.expectedSourceContentHash === marker.sourceContentHash
          : sourceAuthority.operation === "ingest";
      const basePagesMatch = noChangesBasePagesMatchSource(source, marker.baseGeneratedPages, true);
      const applyExtension = readSourceCommitExtension(source, bundleId);
      const applyInputRevision = applyExtension?.inputRevision ?? 0;
      const markerIsHistorical = marker.inputRevision < applyInputRevision;
      if (
        marker.bundleId !== bundleId ||
        marker.sourceId !== source.sourceId ||
        marker.manifestAfterRevision > manifest.revision ||
        !sourceAuthorityMatches ||
        (!markerIsHistorical && !basePagesMatch) ||
        marker.inputRevision === applyInputRevision ||
        !job ||
        job.status !== "completed" ||
        job.sourceId !== marker.sourceId ||
        job.sourceContentHash !== marker.sourceContentHash ||
        job.pipelineFingerprint !== marker.pipelineFingerprint ||
        job.inputRevision !== marker.inputRevision ||
        job.attempt !== marker.attempt ||
        job.changeSetId !== marker.noChangesId ||
        job.completedAt !== marker.completedAt ||
        highWatermark === undefined ||
        highWatermark.inputRevision < marker.inputRevision ||
        observations.length !== 1 ||
        queue.pendingReviews.some((review) => review.jobId === marker.jobId) ||
        queue.applyClaim?.jobId === marker.jobId ||
        queue.applyCommit?.jobId === marker.jobId ||
        snapshot.applyCommits.some(
          (record) =>
            record.bundleId === bundleId &&
            record.sourceId === source.sourceId &&
            record.inputRevision === marker.inputRevision
        )
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

type ReusableCompletedJob = Extract<KnowledgeIngestJob, { status: "completed" }>;

function runtimeSourcePayloadMatches(
  left: Pick<KnowledgeIngestJob, "sourceContentHash" | "pipelineFingerprint">,
  right: Pick<KnowledgeIngestJob, "sourceContentHash" | "pipelineFingerprint">
): boolean {
  return (
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint
  );
}

function runtimeQueueJobIsActive(job: KnowledgeIngestJob): boolean {
  return job.status !== "failed" && job.status !== "completed" && job.status !== "cancelled";
}

type CurrentSourceTerminalOutcome =
  | { kind: "covered" }
  | { kind: "failed_or_cancelled" }
  | { kind: "completed"; job: ReusableCompletedJob }
  | { kind: "invalid" };

function findCurrentSourceTerminalOutcome(
  queue: IngestQueueSnapshot,
  highWatermark: IngestSourceHighWatermark
): CurrentSourceTerminalOutcome {
  const activeJob = queue.jobs.some(
    (job) => job.sourceId === highWatermark.sourceId && runtimeQueueJobIsActive(job)
  );
  const rerun = queue.reruns.some((candidate) => candidate.sourceId === highWatermark.sourceId);
  if (activeJob || rerun) return { kind: "covered" };

  const latest = queue.jobs
    .filter((job) => job.sourceId === highWatermark.sourceId)
    .sort(
      (left, right) =>
        right.inputRevision - left.inputRevision ||
        right.updatedAt - left.updatedAt ||
        left.id.localeCompare(right.id)
    )[0];
  if (
    !latest ||
    latest.inputRevision > highWatermark.inputRevision ||
    !runtimeSourcePayloadMatches(latest, highWatermark)
  ) {
    return { kind: "invalid" };
  }
  if (latest.status === "completed") return { kind: "completed", job: latest };
  if (latest.status === "failed" || latest.status === "cancelled") {
    return { kind: "failed_or_cancelled" };
  }
  return { kind: "invalid" };
}

function readCompletionOutcome(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  manifest: SourceManifest | undefined,
  job: ReusableCompletedJob
): KnowledgeRuntimeJobCompletion | undefined {
  const source = manifest ? findKnowledgeSourceHistoryEntry(manifest, job.sourceId) : undefined;
  const marker = parseKnowledgeNoChangesCommitMarker(
    source?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
  );
  const exactNoChangesMarker =
    marker.ok &&
    marker.value.bundleId === job.bundleId &&
    marker.value.jobId === job.id &&
    marker.value.sourceId === job.sourceId &&
    marker.value.sourceContentHash === job.sourceContentHash &&
    marker.value.pipelineFingerprint === job.pipelineFingerprint &&
    marker.value.inputRevision === job.inputRevision &&
    marker.value.attempt === job.attempt &&
    marker.value.noChangesId === job.changeSetId &&
    marker.value.completedAt === job.completedAt;
  // A source's latest no-change marker must never describe another historical job.
  // https://github.com/yydspanda/obsidian-copilot/issues/15
  if (exactNoChangesMarker) {
    return Object.freeze({
      kind: "no_changes",
      reason: marker.value.reason,
      ...(marker.value.generationOutcomes === undefined
        ? {}
        : { generationOutcomes: Object.freeze({ ...marker.value.generationOutcomes }) }),
    });
  }

  const applied = snapshot.applyCommits.some(
    (record) =>
      record.bundleId === job.bundleId &&
      record.sourceId === job.sourceId &&
      record.sourceContentHash === job.sourceContentHash &&
      record.pipelineFingerprint === job.pipelineFingerprint &&
      record.inputRevision === job.inputRevision &&
      record.changeSetId === job.changeSetId
  );
  return applied ? Object.freeze({ kind: "applied" }) : undefined;
}

function reusableCompletionHasProof(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  manifest: SourceManifest | undefined,
  job: ReusableCompletedJob
): boolean {
  return readCompletionOutcome(snapshot, manifest, job) !== undefined;
}

function readCompletedSourceReanalysis(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest | undefined,
  queue: IngestQueueSnapshot,
  jobId: string
):
  | {
      job: ReusableCompletedJob;
      source: KnowledgeRuntimeInputRevisionRecord;
      highWatermark: IngestSourceHighWatermark;
    }
  | undefined {
  // An explicit replay must not release a recovery gate or race an existing write owner.
  // https://github.com/yydspanda/obsidian-copilot/issues/16
  if (
    !manifest ||
    queue.control.status !== "paused" ||
    queue.control.reason !== "user" ||
    state.activeTransaction !== null ||
    state.activeForwardRevisionApply !== null ||
    queue.applyClaim !== undefined ||
    queue.applyCommit !== undefined ||
    queue.jobs.some((job) => job.status === "failed" && job.stage === "applying") ||
    queue.revision === Number.MAX_SAFE_INTEGER ||
    state.revision === Number.MAX_SAFE_INTEGER
  )
    return undefined;
  const job = queue.jobs.find((candidate) => candidate.id === jobId);
  if (
    job?.status !== "completed" ||
    !manifest.entries.some((entry) => entry.sourceId === job.sourceId) ||
    findKnowledgeSourceRetirement(manifest, job.sourceId) ||
    !reusableCompletionHasProof(state, manifest, job)
  )
    return undefined;
  const highWatermark = queue.sourceHighWatermarks.find((item) => item.sourceId === job.sourceId);
  if (!highWatermark) return undefined;
  const outcome = findCurrentSourceTerminalOutcome(queue, highWatermark);
  const source = state.inputRevisions
    .find((bundle) => bundle.bundleId === queue.bundleId)
    ?.sources.find((candidate) => candidate.sourceId === job.sourceId);
  // A new watcher read owns its allocated revision even before its bytes reach Queue.
  // https://github.com/yydspanda/obsidian-copilot/issues/16
  if (
    outcome.kind !== "completed" ||
    outcome.job.id !== job.id ||
    !source ||
    source.inputRevision !== highWatermark.inputRevision ||
    source.inputRevision === Number.MAX_SAFE_INTEGER ||
    source.observations.some(
      (observation) => observation.status === "allocated" || observation.status === "bound"
    )
  )
    return undefined;
  return { job, source, highWatermark };
}

function assertReusableCompletionSemantics(
  snapshot: KnowledgeRuntimeSemanticSnapshot,
  manifests: ReadonlyMap<string, SourceManifest>,
  queues: ReadonlyMap<string, IngestQueueSnapshot>
): void {
  for (const [bundleId, queue] of queues) {
    const manifest = manifests.get(bundleId);
    for (const highWatermark of queue.sourceHighWatermarks) {
      const outcome = findCurrentSourceTerminalOutcome(queue, highWatermark);
      if (
        outcome.kind === "invalid" ||
        (outcome.kind === "completed" &&
          !reusableCompletionHasProof(snapshot, manifest, outcome.job))
      ) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
}

type KnowledgeApplyCommitLedgerIdentity = Omit<
  KnowledgeApplyCommitLedgerRecord,
  "manifestAfterRevision" | "manifestAfterDigest"
>;

function applyCommitLedgerIdentityMatches(
  record: KnowledgeApplyCommitLedgerRecord,
  identity: KnowledgeApplyCommitLedgerIdentity
): boolean {
  return (
    record.transactionId === identity.transactionId &&
    record.commitRevision === identity.commitRevision &&
    record.bundleId === identity.bundleId &&
    record.sourceId === identity.sourceId &&
    record.sourceContentHash === identity.sourceContentHash &&
    record.pipelineFingerprint === identity.pipelineFingerprint &&
    record.inputRevision === identity.inputRevision &&
    record.changeSetId === identity.changeSetId &&
    record.changeSetDigest === identity.changeSetDigest &&
    record.manifestIntentDigest === identity.manifestIntentDigest &&
    record.journalDigest === identity.journalDigest &&
    record.receiptDigest === identity.receiptDigest &&
    record.manifestBeforeRevision === identity.manifestBeforeRevision &&
    record.manifestBeforeDigest === identity.manifestBeforeDigest &&
    record.recordedAt === identity.recordedAt
  );
}

function createApplyCommitLedgerIdentity(
  journal: CommittedChangeSetTransactionJournal,
  receipt: TransactionCommitReceipt,
  intent: ManifestCommitIntent
): KnowledgeApplyCommitLedgerIdentity {
  return {
    transactionId: journal.transactionId,
    commitRevision: journal.revision,
    bundleId: journal.bundleId,
    sourceId: journal.jobClaim.sourceId,
    sourceContentHash: journal.jobClaim.sourceContentHash,
    pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
    inputRevision: journal.jobClaim.inputRevision,
    changeSetId: journal.changeSetId,
    changeSetDigest: journal.changeSetDigest,
    manifestIntentDigest: journal.manifestCommitIntentDigest,
    journalDigest: createChangeSetTransactionJournalDigest(journal),
    receiptDigest: createTransactionCommitReceiptDigest(receipt),
    manifestBeforeRevision: intent.expectedManifestRevision,
    manifestBeforeDigest: intent.expectedManifestDigest,
    recordedAt: receipt.committedAt,
  };
}

interface KnowledgeApplyRuntimeIdentity {
  transactionId: string;
  bundleId: string;
  changeSetId: string;
  changeSetDigest: string;
  changeSet: KnowledgeChangeSet;
  jobClaim: TransactionJobClaim;
  manifestCommitIntent: ManifestCommitIntent;
  manifestCommitIntentDigest: string;
}

interface KnowledgeApplyAuthorityProof extends KnowledgeApplyRuntimeIdentity {
  bundle: KnowledgeBundleConfig;
}

function parseApplyAuthorityRequest(
  request: ChangeSetTransactionAuthorityRequest
): KnowledgeApplyAuthorityProof {
  const transactionId = request.transactionId;
  const bundleResult = parseKnowledgeBundleConfig(request.bundle);
  const changeSetResult = parseKnowledgeChangeSet(request.changeSet);
  const intentResult = parseManifestCommitIntent(request.manifestCommitIntent);
  const claim = request.jobClaim;
  const claimValid =
    typeof claim === "object" &&
    claim !== null &&
    typeof claim.jobId === "string" &&
    claim.jobId.trim().length > 0 &&
    Number.isSafeInteger(claim.attempt) &&
    claim.attempt > 0 &&
    Number.isSafeInteger(claim.startedAt) &&
    claim.startedAt >= 0 &&
    typeof claim.sourceId === "string" &&
    claim.sourceId.trim().length > 0 &&
    sha256Schema.safeParse(claim.sourceContentHash).success &&
    sha256Schema.safeParse(claim.pipelineFingerprint).success &&
    Number.isSafeInteger(claim.inputRevision) &&
    claim.inputRevision >= 0;
  if (
    typeof transactionId !== "string" ||
    transactionId.trim().length === 0 ||
    !bundleResult.ok ||
    !changeSetResult.ok ||
    !intentResult.ok ||
    !claimValid
  ) {
    throw new KnowledgeApplyCommitAuthorityError(transactionId, "request_invalid");
  }

  const bundle = bundleResult.value;
  const changeSet = changeSetResult.value;
  const intent = intentResult.value;
  const bundleValidation = validateKnowledgeBundleConfig(bundle);
  const changeSetValidation = validateKnowledgeChangeSet(changeSet, bundle);
  const intentValidation = validateManifestCommitIntent(intent, bundle);
  if (
    !bundleValidation.valid ||
    !changeSetValidation.valid ||
    !intentValidation.valid ||
    changeSet.status !== "accepted" ||
    request.changeSetDigest !== createChangeSetTransactionDigest(changeSet) ||
    request.manifestCommitIntentDigest !== createManifestCommitIntentDigest(intent) ||
    changeSet.bundleId !== bundle.id ||
    intent.bundleId !== bundle.id ||
    intent.changeSetId !== changeSet.id ||
    intent.sourceId !== claim.sourceId ||
    intent.sourceContentHash !== claim.sourceContentHash ||
    intent.pipelineFingerprint !== claim.pipelineFingerprint ||
    intent.inputRevision !== claim.inputRevision
  ) {
    throw new KnowledgeApplyCommitAuthorityError(transactionId, "request_invalid");
  }

  return {
    transactionId,
    bundleId: bundle.id,
    bundle,
    changeSetId: changeSet.id,
    changeSetDigest: request.changeSetDigest,
    changeSet,
    jobClaim: {
      jobId: claim.jobId,
      attempt: claim.attempt,
      startedAt: claim.startedAt,
      sourceId: claim.sourceId,
      sourceContentHash: claim.sourceContentHash,
      pipelineFingerprint: claim.pipelineFingerprint,
      inputRevision: claim.inputRevision,
    },
    manifestCommitIntent: intent,
    manifestCommitIntentDigest: request.manifestCommitIntentDigest,
  };
}

function queueClaimMatchesTransaction(
  claim: IngestQueueSnapshot["applyClaim"],
  journal: KnowledgeApplyRuntimeIdentity
): boolean {
  return (
    claim !== undefined &&
    claim.jobId === journal.jobClaim.jobId &&
    claim.sourceId === journal.jobClaim.sourceId &&
    claim.sourceContentHash === journal.jobClaim.sourceContentHash &&
    claim.pipelineFingerprint === journal.jobClaim.pipelineFingerprint &&
    claim.inputRevision === journal.jobClaim.inputRevision &&
    claim.attempt === journal.jobClaim.attempt &&
    claim.startedAt === journal.jobClaim.startedAt
  );
}

function reviewClaimMatchesTransaction(
  record: AcceptedChangeSetReviewRecord,
  journal: KnowledgeApplyRuntimeIdentity
): boolean {
  return (
    record.jobClaim.jobId === journal.jobClaim.jobId &&
    record.jobClaim.sourceId === journal.jobClaim.sourceId &&
    record.jobClaim.sourceContentHash === journal.jobClaim.sourceContentHash &&
    record.jobClaim.pipelineFingerprint === journal.jobClaim.pipelineFingerprint &&
    record.jobClaim.inputRevision === journal.jobClaim.inputRevision &&
    record.jobClaim.attempt === journal.jobClaim.attempt
  );
}

function exactJsonValuesEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

interface CapturedForwardRevisionPublicationEvidence {
  intent: Readonly<KnowledgeForwardRevisionIntent>;
  intentDigest: string;
  historicalReviewAuthority: Readonly<KnowledgeForwardRevisionHistoricalReviewAuthority>;
  selectedContent: string;
  selectedContentHash: string;
  vaultObservedBeforeHash: string;
}

interface ForwardRevisionPublicationTimeFloors {
  readonly sourceFreshnessCompletedAt: number;
  readonly lineageAppliedAtFloor: number;
}

function snapshotExactDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      expectedKeys.some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      Object.defineProperty(captured, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function snapshotForwardRevisionPublicationEvidence(
  value: unknown
): Readonly<CapturedForwardRevisionPublicationEvidence> {
  let bundleId = "unknown";
  const record = snapshotExactDataRecord(value, [
    "intent",
    "intentDigest",
    "historicalReviewAuthority",
    "selectedContent",
    "selectedContentHash",
    "vaultObservedBeforeHash",
  ]);
  try {
    if (!record) throw new TypeError();
    const intent = snapshotKnowledgeForwardRevisionIntent(record.intent);
    bundleId = intent.bundleId;
    if (
      typeof record.intentDigest !== "string" ||
      record.intentDigest !== createKnowledgeForwardRevisionIntentDigest(intent) ||
      typeof record.vaultObservedBeforeHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.vaultObservedBeforeHash) ||
      record.vaultObservedBeforeHash !== intent.current.vaultObservedBeforeHash ||
      typeof record.selectedContent !== "string" ||
      typeof record.selectedContentHash !== "string"
    ) {
      throw new TypeError();
    }
    const captured = createKnowledgeForwardRevisionRequest({
      requestRevision: 1,
      runtimeId: "forward-revision-evidence-capture",
      bundleId: intent.bundleId,
      pagePath: intent.pagePath,
      intent,
      intentDigest: record.intentDigest,
      historicalReviewAuthority:
        record.historicalReviewAuthority as KnowledgeForwardRevisionHistoricalReviewAuthority,
      selectedContent: record.selectedContent,
      selectedContentHash: record.selectedContentHash,
      requestedAt: intent.historical.appliedAt,
    });
    return Object.freeze({
      intent: captured.intent,
      intentDigest: captured.intentDigest,
      historicalReviewAuthority: captured.historicalReviewAuthority,
      selectedContent: captured.selectedContent,
      selectedContentHash: captured.selectedContentHash,
      vaultObservedBeforeHash: captured.intent.current.vaultObservedBeforeHash,
    });
  } catch {
    throw new KnowledgeForwardRevisionPublicationConflictError(bundleId, "request_invalid");
  }
}

function acceptedRecordMatchesStartupIdentity(
  identity: AcceptedReviewStartupIdentity,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    identity.changeSetId === record.changeSetId &&
    identity.proposalDigest === record.proposalDigest &&
    identity.recordRevision === record.recordRevision &&
    identity.recordedAt === record.recordedAt &&
    identity.acceptedDigest === record.acceptedDigest &&
    identity.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    identity.acceptedAt === record.acceptedAt &&
    identity.jobClaim.jobId === record.jobClaim.jobId &&
    identity.jobClaim.sourceId === record.jobClaim.sourceId &&
    identity.jobClaim.sourceContentHash === record.jobClaim.sourceContentHash &&
    identity.jobClaim.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    identity.jobClaim.inputRevision === record.jobClaim.inputRevision &&
    identity.jobClaim.attempt === record.jobClaim.attempt
  );
}

function createNoJournalApplyRecoveryId(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): string {
  return createNoJournalApplyRecoveryReference(bundleId, record).recoveryId;
}

function queueJobMatchesAcceptedRecord(
  job: KnowledgeIngestJob | undefined,
  record: AcceptedChangeSetReviewRecord
): job is KnowledgeIngestJob {
  return (
    job !== undefined &&
    job.id === record.jobClaim.jobId &&
    job.sourceId === record.jobClaim.sourceId &&
    job.sourceContentHash === record.jobClaim.sourceContentHash &&
    job.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    job.inputRevision === record.jobClaim.inputRevision &&
    job.attempt === record.jobClaim.attempt
  );
}

function queueClaimMatchesAcceptedRecord(
  claim: IngestApplyClaimMarker | undefined,
  record: AcceptedChangeSetReviewRecord
): claim is IngestApplyClaimMarker {
  return (
    claim !== undefined &&
    claim.jobId === record.jobClaim.jobId &&
    claim.sourceId === record.jobClaim.sourceId &&
    claim.sourceContentHash === record.jobClaim.sourceContentHash &&
    claim.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    claim.inputRevision === record.jobClaim.inputRevision &&
    claim.attempt === record.jobClaim.attempt &&
    claim.legacyReview === undefined &&
    claim.reviewedChangeSet?.changeSetId === record.changeSetId &&
    claim.reviewedChangeSet.changeSetDigest === record.acceptedDigest &&
    claim.acceptedReview?.proposalDigest === record.proposalDigest &&
    claim.acceptedReview.recordRevision === record.recordRevision &&
    claim.acceptedReview.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    claim.acceptedReview.acceptedAt === record.acceptedAt
  );
}

function createNoJournalApplyRuntimeIdentity(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord,
  claim: IngestApplyClaimMarker
): KnowledgeApplyRuntimeIdentity {
  return {
    transactionId: createNoJournalApplyRecoveryId(bundleId, record),
    bundleId,
    changeSetId: record.changeSetId,
    changeSetDigest: record.acceptedDigest,
    changeSet: cloneJson(record.acceptedChangeSet),
    jobClaim: {
      jobId: claim.jobId,
      attempt: claim.attempt,
      startedAt: claim.startedAt,
      sourceId: claim.sourceId,
      sourceContentHash: claim.sourceContentHash,
      pipelineFingerprint: claim.pipelineFingerprint,
      inputRevision: claim.inputRevision,
    },
    manifestCommitIntent: cloneJson(record.manifestCommitIntent),
    manifestCommitIntentDigest: record.manifestCommitIntentDigest,
  };
}

function createNoJournalApplyRecoveryCandidate(
  bundleId: string,
  record: AcceptedChangeSetReviewRecord,
  claim: IngestApplyClaimMarker
): NoJournalApplyRecoveryCandidate {
  return {
    ...createNoJournalApplyRecoveryReference(bundleId, record),
    jobId: claim.jobId,
    changeSetId: record.changeSetId,
    sourceId: claim.sourceId,
    sourceContentHash: claim.sourceContentHash,
    pipelineFingerprint: claim.pipelineFingerprint,
    inputRevision: claim.inputRevision,
    attempt: claim.attempt,
    startedAt: claim.startedAt,
    acceptedAt: record.acceptedAt,
  };
}

function abandonmentMatchesAcceptedRecord(
  abandonment: IngestApplyAbandonment,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    abandonment.jobId === record.jobClaim.jobId &&
    abandonment.sourceId === record.jobClaim.sourceId &&
    abandonment.sourceContentHash === record.jobClaim.sourceContentHash &&
    abandonment.pipelineFingerprint === record.jobClaim.pipelineFingerprint &&
    abandonment.inputRevision === record.jobClaim.inputRevision &&
    abandonment.attempt === record.jobClaim.attempt &&
    abandonment.changeSetId === record.changeSetId &&
    abandonment.changeSetDigest === record.acceptedDigest &&
    abandonment.proposalDigest === record.proposalDigest &&
    abandonment.recordRevision === record.recordRevision &&
    abandonment.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    abandonment.acceptedAt === record.acceptedAt
  );
}

function findLatestSourceApplyLedger(
  records: readonly KnowledgeApplyCommitLedgerRecord[],
  bundleId: string,
  sourceId: string
): KnowledgeApplyCommitLedgerRecord | undefined {
  let latest: KnowledgeApplyCommitLedgerRecord | undefined;
  for (const record of records) {
    if (record.bundleId !== bundleId || record.sourceId !== sourceId) continue;
    if (!latest || record.manifestAfterRevision > latest.manifestAfterRevision) {
      latest = record;
    }
  }
  return latest;
}

function ledgerMatchesCurrentManifestEntry(
  ledger: KnowledgeApplyCommitLedgerRecord,
  bundleId: string,
  entry: SourceManifestEntry
): boolean {
  const success = entry.lastSuccessful;
  const extension = parseKnowledgeRuntimeSourceCommitExtension(
    entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]
  );
  return (
    success !== undefined &&
    extension.ok &&
    ledger.bundleId === bundleId &&
    ledger.sourceId === entry.sourceId &&
    ledger.sourceContentHash === success.sourceContentHash &&
    ledger.pipelineFingerprint === success.pipelineFingerprint &&
    ledger.changeSetId === success.changeSetId &&
    ledger.recordedAt === success.completedAt &&
    ledger.transactionId === extension.value.transactionId &&
    ledger.inputRevision === extension.value.inputRevision &&
    ledger.manifestIntentDigest === extension.value.manifestIntentDigest
  );
}

function freezeAppliedClaimCitation(citation: ClaimCitation): Readonly<ClaimCitation> {
  return Object.freeze({
    ...citation,
    locator: Object.freeze({ ...citation.locator }),
  });
}

function freezeAppliedSourceProvenance(
  source: KnowledgeRuntimeAppliedSourceProvenance
): Readonly<KnowledgeRuntimeAppliedSourceProvenance> {
  const citations = source.citations.map(freezeAppliedClaimCitation);
  return Object.freeze({
    ...source,
    citations: Object.freeze(citations),
  });
}

function freezeAppliedPageProvenance(
  page: KnowledgeRuntimeAppliedPageProvenance
): Readonly<KnowledgeRuntimeAppliedPageProvenance> {
  return Object.freeze({
    ...page,
    sources: Object.freeze([...page.sources]),
  });
}

function freezeAppliedProvenanceSnapshot(
  snapshot: KnowledgeRuntimeAppliedProvenanceSnapshot
): KnowledgeRuntimeAppliedProvenanceSnapshot {
  return Object.freeze({
    ...snapshot,
    pages: Object.freeze([...snapshot.pages]),
  });
}

function freezeRuntimeFreshnessGeneratedPages(
  manifest: SourceManifest,
  entry: SourceManifestEntry
): readonly Readonly<KnowledgeRuntimeFreshnessGeneratedPage>[] {
  const pages = projectKnowledgeEffectiveManifestPages(manifest)
    .filter((page) => page.sourceIds.includes(entry.sourceId))
    .map((page) =>
      Object.freeze({
        path: page.path,
        windowsPathKey: page.windowsPathKey,
        ownership: page.ownership,
        sourceAppliedContentHash: page.sourceAppliedContentHash,
        effectiveContentHash: page.effectiveContentHash,
        contentHash: page.effectiveContentHash,
        origin: page.origin,
      })
    );
  pages.sort(
    (left, right) =>
      compareIdentifiers(left.windowsPathKey, right.windowsPathKey) ||
      compareIdentifiers(left.path, right.path)
  );
  return Object.freeze(pages);
}

function freezeRuntimeSourceFreshnessAuthority(
  authority: KnowledgeRuntimeSourceFreshnessAuthority
): KnowledgeRuntimeSourceFreshnessAuthority {
  return Object.freeze({
    ...authority,
    generatedPages: Object.freeze([...authority.generatedPages]),
  });
}

function selectedNoChangesMarkerHasRuntimeProof(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  entry: SourceManifestEntry,
  marker: NoChangesManifestCommitMarker
): boolean {
  const queueRaw = findBundleSlot(state, "queues", manifest.bundleId);
  if (queueRaw === null) return false;
  const parsedQueue = parseIngestQueueSnapshot(queueRaw);
  if (!parsedQueue.ok || !validateIngestQueueSnapshot(parsedQueue.value).valid) return false;
  const job = parsedQueue.value.jobs.find(
    (candidate): candidate is ReusableCompletedJob =>
      candidate.id === marker.jobId && candidate.status === "completed"
  );
  return (
    marker.bundleId === manifest.bundleId &&
    marker.sourceId === entry.sourceId &&
    marker.manifestAfterRevision <= manifest.revision &&
    job !== undefined &&
    reusableCompletionHasProof(state, manifest, job)
  );
}

function projectRuntimeSourceFreshnessAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  entry: SourceManifestEntry
): KnowledgeRuntimeSourceFreshnessAuthority | null {
  const rawApply = entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
  const parsedApply =
    rawApply === undefined ? undefined : parseKnowledgeRuntimeSourceCommitExtension(rawApply);
  if (parsedApply !== undefined && !parsedApply.ok) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const noChanges = readSourceNoChangesCommitMarker(entry);
  const apply = parsedApply?.ok ? parsedApply.value : undefined;
  if (apply && noChanges && apply.inputRevision === noChanges.inputRevision) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }

  const runtimeDigest = sha256(canonicalizeJson(state as unknown as JsonValue));
  const manifestDigest = createSourceManifestDigest(manifest);
  const generatedPages = freezeRuntimeFreshnessGeneratedPages(manifest, entry);
  const common = {
    version: KNOWLEDGE_RUNTIME_SOURCE_FRESHNESS_AUTHORITY_VERSION,
    runtimeId: state.runtimeId,
    runtimeRevision: state.revision,
    runtimeDigest,
    bundleId: manifest.bundleId,
    sourceId: entry.sourceId,
    manifestRevision: manifest.revision,
    manifestDigest,
    generatedPages,
  } as const;

  if (noChanges && (!apply || noChanges.inputRevision > apply.inputRevision)) {
    if (!selectedNoChangesMarkerHasRuntimeProof(state, manifest, entry, noChanges)) return null;
    const authority: KnowledgeRuntimeNoChangesFreshnessAuthority = {
      ...common,
      kind: "no_changes",
      sourceContentHash: noChanges.sourceContentHash,
      pipelineFingerprint: noChanges.pipelineFingerprint,
      inputRevision: noChanges.inputRevision,
      noChangesId: noChanges.noChangesId,
      reason: noChanges.reason,
      planDigest: noChanges.planDigest,
      jobId: noChanges.jobId,
      attempt: noChanges.attempt,
      committedManifestRevision: noChanges.manifestAfterRevision,
      completedAt: noChanges.completedAt,
    };
    return freezeRuntimeSourceFreshnessAuthority(authority);
  }

  if (!apply || !entry.lastSuccessful) return null;
  const ledger = findLatestSourceApplyLedger(state.applyCommits, manifest.bundleId, entry.sourceId);
  if (
    !ledger ||
    ledger.transactionId !== apply.transactionId ||
    !ledgerMatchesCurrentManifestEntry(ledger, manifest.bundleId, entry)
  ) {
    return null;
  }
  const authority: KnowledgeRuntimeAppliedFreshnessAuthority = {
    ...common,
    kind: "applied",
    sourceContentHash: ledger.sourceContentHash,
    pipelineFingerprint: ledger.pipelineFingerprint,
    inputRevision: ledger.inputRevision,
    transactionId: ledger.transactionId,
    changeSetId: ledger.changeSetId,
    changeSetDigest: ledger.changeSetDigest,
    manifestIntentDigest: ledger.manifestIntentDigest,
    committedManifestRevision: ledger.manifestAfterRevision,
    committedManifestDigest: ledger.manifestAfterDigest,
    completedAt: ledger.recordedAt,
  };
  return freezeRuntimeSourceFreshnessAuthority(authority);
}

interface AppliedSourceCommitCandidate {
  ledger: KnowledgeApplyCommitLedgerRecord;
  record: AcceptedChangeSetReviewRecord;
  entry: SourceManifestEntry;
}

interface AppliedSourceCommitEvidence {
  provenance: Readonly<KnowledgeRuntimeAppliedSourceProvenance>;
}

function projectAppliedSourceCommitCandidate(
  ledger: KnowledgeApplyCommitLedgerRecord,
  manifest: SourceManifest,
  record: AcceptedChangeSetReviewRecord | undefined,
  entry: SourceManifestEntry
): AppliedSourceCommitCandidate | undefined {
  if (
    !entry.lastSuccessful ||
    !record ||
    ledger.bundleId !== manifest.bundleId ||
    ledger.sourceId !== entry.sourceId ||
    !ledgerMatchesAcceptedRecord(ledger, manifest.bundleId, record)
  ) {
    return undefined;
  }
  return { ledger, record, entry };
}

function createAppliedSourceCommitEvidence(
  candidate: AppliedSourceCommitCandidate
): AppliedSourceCommitEvidence | undefined {
  const { ledger, record, entry } = candidate;
  const citations = record.acceptedChangeSet.citations
    .filter((citation) => citation.locator.sourceId === entry.sourceId)
    .map((citation) => cloneJson(citation));
  if (citations.length === 0) return undefined;
  return {
    provenance: freezeAppliedSourceProvenance({
      sourceId: entry.sourceId,
      sourcePath: entry.sourcePath,
      custody: entry.custody,
      sourceContentHash: ledger.sourceContentHash,
      pipelineFingerprint: ledger.pipelineFingerprint,
      inputRevision: ledger.inputRevision,
      changeSetId: ledger.changeSetId,
      changeSetDigest: ledger.changeSetDigest,
      acceptedAt: record.acceptedAt,
      citations,
    }),
  };
}

function createAppliedSourcePageEvidenceKey(
  sourceId: string,
  windowsPathKey: string,
  sourceAppliedContentHash: string
): string {
  return canonicalizeJson([sourceId, windowsPathKey, sourceAppliedContentHash]);
}

function indexLatestSourceApplyLedgers(
  records: readonly KnowledgeApplyCommitLedgerRecord[],
  bundleId: string
): ReadonlyMap<string, KnowledgeApplyCommitLedgerRecord> {
  const latestBySourceId = new Map<string, KnowledgeApplyCommitLedgerRecord>();
  for (const record of records) {
    if (record.bundleId !== bundleId) continue;
    const current = latestBySourceId.get(record.sourceId);
    if (!current || record.manifestAfterRevision > current.manifestAfterRevision) {
      latestBySourceId.set(record.sourceId, record);
    }
  }
  return latestBySourceId;
}

function projectAppliedSourcePageEvidenceIndex(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  review: ChangeSetReviewSnapshot | undefined,
  pages: readonly Readonly<KnowledgeEffectiveManifestPage>[]
): ReadonlyMap<string, AppliedSourceCommitEvidence> {
  const evidenceByPage = new Map<string, AppliedSourceCommitEvidence>();
  if (!review) return evidenceByPage;

  const wantedPageKeys = new Set<string>();
  for (const page of pages) {
    for (const sourceId of page.sourceIds) {
      wantedPageKeys.add(
        createAppliedSourcePageEvidenceKey(
          sourceId,
          page.windowsPathKey,
          page.sourceAppliedContentHash
        )
      );
    }
  }
  if (wantedPageKeys.size === 0) return evidenceByPage;

  const latestBySourceId = indexLatestSourceApplyLedgers(state.applyCommits, manifest.bundleId);
  const activeSources = new Map<string, SourceManifestEntry>();
  for (const entry of manifest.entries) {
    if (!entry.lastSuccessful) continue;
    const latest = latestBySourceId.get(entry.sourceId);
    if (latest && ledgerMatchesCurrentManifestEntry(latest, manifest.bundleId, entry)) {
      activeSources.set(entry.sourceId, entry);
    }
  }

  const acceptedByChangeSetId = new Map<string, AcceptedChangeSetReviewRecord>();
  for (const record of review.records) {
    if (record.outcome !== "accepted") continue;
    if (acceptedByChangeSetId.has(record.changeSetId)) return evidenceByPage;
    acceptedByChangeSetId.set(record.changeSetId, record);
  }

  const winningCandidateByPage = new Map<string, AppliedSourceCommitCandidate>();
  for (const ledger of state.applyCommits) {
    if (ledger.bundleId !== manifest.bundleId) continue;
    const entry = activeSources.get(ledger.sourceId);
    if (!entry) continue;
    const candidate = projectAppliedSourceCommitCandidate(
      ledger,
      manifest,
      acceptedByChangeSetId.get(ledger.changeSetId),
      entry
    );
    if (!candidate) continue;

    const matchingChangeCounts = new Map<string, number>();
    for (const change of candidate.record.acceptedChangeSet.changes) {
      if (
        (change.operation !== "create" && change.operation !== "update") ||
        !change.sourceRefs.includes(ledger.sourceId)
      ) {
        continue;
      }
      const key = createAppliedSourcePageEvidenceKey(
        ledger.sourceId,
        toWindowsPathKey(change.path),
        change.afterHash
      );
      if (!wantedPageKeys.has(key)) continue;
      matchingChangeCounts.set(key, (matchingChangeCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of matchingChangeCounts) {
      if (count !== 1) continue;
      const current = winningCandidateByPage.get(key);
      if (
        !current ||
        candidate.ledger.manifestAfterRevision > current.ledger.manifestAfterRevision
      ) {
        winningCandidateByPage.set(key, candidate);
      }
    }
  }

  const evidenceByTransactionId = new Map<string, AppliedSourceCommitEvidence | null>();
  for (const [key, candidate] of winningCandidateByPage) {
    let evidence = evidenceByTransactionId.get(candidate.ledger.transactionId);
    if (evidence === undefined) {
      evidence = createAppliedSourceCommitEvidence(candidate) ?? null;
      evidenceByTransactionId.set(candidate.ledger.transactionId, evidence);
    }
    if (evidence) evidenceByPage.set(key, evidence);
  }
  return evidenceByPage;
}

function projectAppliedManifestPages(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  review: ChangeSetReviewSnapshot | undefined
): readonly Readonly<KnowledgeRuntimeAppliedPageProvenance>[] {
  const effectivePages = projectKnowledgeEffectiveManifestPages(manifest);
  const sourceEvidence = projectAppliedSourcePageEvidenceIndex(
    state,
    manifest,
    review,
    effectivePages
  );

  const projectedPages: Readonly<KnowledgeRuntimeAppliedPageProvenance>[] = [];
  for (const page of effectivePages) {
    const sources = page.sourceIds.flatMap((sourceId) => {
      const evidence = sourceEvidence.get(
        createAppliedSourcePageEvidenceKey(
          sourceId,
          page.windowsPathKey,
          page.sourceAppliedContentHash
        )
      );
      return evidence ? [evidence.provenance] : [];
    });
    if (sources.length === 0) continue;
    projectedPages.push(
      freezeAppliedPageProvenance({
        path: page.path,
        windowsPathKey: page.windowsPathKey,
        ownership: page.ownership,
        sourceAppliedContentHash: page.sourceAppliedContentHash,
        effectiveContentHash: page.effectiveContentHash,
        contentHash: page.effectiveContentHash,
        origin: page.origin,
        sources,
      })
    );
  }
  projectedPages.sort((left, right) =>
    compareIdentifiers(left.windowsPathKey, right.windowsPathKey)
  );
  return Object.freeze(projectedPages);
}

function projectKnownAppliedWikiCurrentManifestPage(
  manifest: SourceManifest,
  pagePath: string
): KnowledgeKnownAppliedWikiCurrentPage | undefined {
  const requestedKey = toWindowsPathKey(pagePath);
  if (manifest.entries.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxManifestEntries) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("page_outputs");
  }
  const pageCount = manifest.entries.reduce(
    (count, entry) => count + (entry.lastSuccessful?.generatedPages.length ?? 0),
    0
  );
  if (pageCount > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPageOutputs) {
    throw new KnowledgeKnownAppliedWikiOutputLimitError("page_outputs");
  }
  const matches = projectKnowledgeEffectiveManifestPages(manifest).filter(
    (page) => page.windowsPathKey === requestedKey
  );
  if (matches.length === 0) return undefined;
  const page = matches[0];
  if (
    matches.length !== 1 ||
    page.path !== pagePath ||
    page.path.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return {
    path: page.path,
    windowsPathKey: page.windowsPathKey,
    ownership: page.ownership,
    contentHash: page.effectiveContentHash,
  };
}

function transactionMatchesAcceptedRecord(
  journal: ChangeSetTransactionJournal,
  bundleId: string,
  record: AcceptedChangeSetReviewRecord
): boolean {
  return (
    journal.bundleId === bundleId &&
    journal.changeSetId === record.changeSetId &&
    journal.changeSetDigest === record.acceptedDigest &&
    journal.manifestCommitIntentDigest === record.manifestCommitIntentDigest &&
    reviewClaimMatchesTransaction(record, journal) &&
    exactJsonValuesEqual(journal.changeSet, record.acceptedChangeSet) &&
    exactJsonValuesEqual(journal.manifestCommitIntent, record.manifestCommitIntent)
  );
}

function isActiveNoJournalQueueJob(job: KnowledgeIngestJob): boolean {
  return job.status !== "failed" && job.status !== "completed" && job.status !== "cancelled";
}

function promoteNoJournalRerun(
  snapshot: IngestQueueSnapshot,
  sourceId: string,
  timestamp: number
): IngestQueueSnapshot {
  const rerun = snapshot.reruns.find((candidate) => candidate.sourceId === sourceId);
  const existingSuccessor = snapshot.jobs.some(
    (job) => job.sourceId === sourceId && isActiveNoJournalQueueJob(job)
  );
  if (!rerun || existingSuccessor) {
    return snapshot;
  }
  const successor: KnowledgeIngestJob = {
    id: rerun.jobId,
    bundleId: snapshot.bundleId,
    sourceId: rerun.sourceId,
    sourceContentHash: rerun.sourceContentHash,
    pipelineFingerprint: rerun.pipelineFingerprint,
    inputRevision: rerun.inputRevision,
    attempt: 0,
    rerunRequested: false,
    createdAt: rerun.requestedAt,
    updatedAt: Math.max(timestamp, rerun.updatedAt),
    status: "pending",
    stage: "queued",
  };
  return {
    ...snapshot,
    jobs: [...snapshot.jobs, successor],
    reruns: snapshot.reruns.filter((candidate) => candidate.sourceId !== sourceId),
  };
}

function settleNoJournalRerunAfterSuccessfulApply(
  snapshot: IngestQueueSnapshot,
  appliedJob: KnowledgeIngestJob,
  timestamp: number
): IngestQueueSnapshot {
  const highWatermark = snapshot.sourceHighWatermarks.find(
    (candidate) => candidate.sourceId === appliedJob.sourceId
  );
  const activeSuccessors = snapshot.jobs.filter(
    (job) => job.sourceId === appliedJob.sourceId && isActiveNoJournalQueueJob(job)
  );
  const latestInputWasApplied =
    highWatermark !== undefined &&
    highWatermark.sourceContentHash === appliedJob.sourceContentHash &&
    highWatermark.pipelineFingerprint === appliedJob.pipelineFingerprint;
  const canRetireSuccessors = activeSuccessors.every(
    (job) => (job.status === "pending" || job.status === "paused") && job.attempt === 0
  );
  if (highWatermark && latestInputWasApplied && canRetireSuccessors) {
    return {
      ...snapshot,
      jobs: snapshot.jobs.map((job): KnowledgeIngestJob => {
        if (
          job.sourceId !== appliedJob.sourceId ||
          (job.status !== "pending" && job.status !== "paused")
        ) {
          return job;
        }
        const cancelledAt = Math.max(timestamp, job.updatedAt, highWatermark.observedAt);
        return {
          id: job.id,
          bundleId: job.bundleId,
          sourceId: job.sourceId,
          sourceContentHash: highWatermark.sourceContentHash,
          pipelineFingerprint: highWatermark.pipelineFingerprint,
          inputRevision: highWatermark.inputRevision,
          attempt: job.attempt,
          rerunRequested: false,
          createdAt: job.createdAt,
          updatedAt: cancelledAt,
          status: "cancelled",
          stage: "cancelled",
          cancelledAt,
        };
      }),
      reruns: snapshot.reruns.filter((candidate) => candidate.sourceId !== appliedJob.sourceId),
    };
  }
  return promoteNoJournalRerun(snapshot, appliedJob.sourceId, timestamp);
}

function assertApplyCommitRuntimeAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  journal: KnowledgeApplyRuntimeIdentity
): void {
  const queueRaw = findBundleSlot(state, "queues", journal.bundleId);
  if (queueRaw === null) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_missing");
  }
  const queueResult = parseIngestQueueSnapshot(queueRaw);
  if (!queueResult.ok || !validateIngestQueueSnapshot(queueRaw).valid) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_claim_mismatch");
  }
  const queue = queueResult.value;
  const claim = queue.applyClaim;
  if (!claim) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_claim_missing");
  }
  const job = queue.jobs.find((candidate) => candidate.id === journal.jobClaim.jobId);
  const applyingJobMatches =
    job !== undefined &&
    (job.status === "processing" || job.status === "failed") &&
    job.stage === "applying" &&
    job.sourceId === journal.jobClaim.sourceId &&
    job.sourceContentHash === journal.jobClaim.sourceContentHash &&
    job.pipelineFingerprint === journal.jobClaim.pipelineFingerprint &&
    job.inputRevision === journal.jobClaim.inputRevision &&
    job.attempt === journal.jobClaim.attempt &&
    (job.status === "failed" || job.startedAt === journal.jobClaim.startedAt);
  if (!applyingJobMatches || !queueClaimMatchesTransaction(claim, journal)) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_claim_mismatch");
  }

  const highWatermark = queue.sourceHighWatermarks.find(
    (candidate) => candidate.sourceId === journal.jobClaim.sourceId
  );
  if (!highWatermark) {
    throw new KnowledgeApplyCommitAuthorityError(
      journal.transactionId,
      "source_high_watermark_missing"
    );
  }
  if (
    highWatermark.inputRevision < journal.jobClaim.inputRevision ||
    (highWatermark.inputRevision === journal.jobClaim.inputRevision &&
      (highWatermark.sourceContentHash !== journal.jobClaim.sourceContentHash ||
        highWatermark.pipelineFingerprint !== journal.jobClaim.pipelineFingerprint))
  ) {
    throw new KnowledgeApplyCommitAuthorityError(
      journal.transactionId,
      "source_high_watermark_mismatch"
    );
  }
  const highWatermarkHasNewPayload =
    highWatermark.inputRevision > journal.jobClaim.inputRevision &&
    (highWatermark.sourceContentHash !== journal.jobClaim.sourceContentHash ||
      highWatermark.pipelineFingerprint !== journal.jobClaim.pipelineFingerprint);
  if (highWatermarkHasNewPayload) {
    const exactRetainedRerun = queue.reruns.some(
      (candidate) =>
        candidate.sourceId === highWatermark.sourceId &&
        candidate.inputRevision === highWatermark.inputRevision &&
        candidate.sourceContentHash === highWatermark.sourceContentHash &&
        candidate.pipelineFingerprint === highWatermark.pipelineFingerprint
    );
    const exactPromotedSuccessor = queue.jobs.some(
      (candidate) =>
        candidate.id !== job.id &&
        (candidate.status === "pending" || candidate.status === "paused") &&
        candidate.sourceId === highWatermark.sourceId &&
        candidate.inputRevision === highWatermark.inputRevision &&
        candidate.sourceContentHash === highWatermark.sourceContentHash &&
        candidate.pipelineFingerprint === highWatermark.pipelineFingerprint
    );
    if (!exactRetainedRerun && !exactPromotedSuccessor) {
      throw new KnowledgeApplyCommitAuthorityError(
        journal.transactionId,
        "source_high_watermark_mismatch"
      );
    }
  }
  const revisionBundle = state.inputRevisions.find(
    (candidate) => candidate.bundleId === journal.bundleId
  );
  const allocatedRevision = revisionBundle?.sources.find(
    (candidate) => candidate.sourceId === journal.jobClaim.sourceId
  );
  if (!allocatedRevision) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "input_revision_missing");
  }
  if (allocatedRevision.inputRevision < highWatermark.inputRevision) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "input_revision_behind");
  }

  if (claim.legacyReview) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_review_unverified");
  }
  if (!claim.reviewedChangeSet) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_review_unverified");
  }
  const acceptedReview = claim.acceptedReview;
  if (
    !acceptedReview ||
    claim.reviewedChangeSet.changeSetId !== journal.changeSetId ||
    claim.reviewedChangeSet.changeSetDigest !== journal.changeSetDigest ||
    acceptedReview.manifestCommitIntentDigest !== journal.manifestCommitIntentDigest
  ) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "queue_review_unverified");
  }

  const reviewRaw = findBundleSlot(state, "reviews", journal.bundleId);
  if (reviewRaw === null) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_missing");
  }
  const reviewResult = parseChangeSetReviewSnapshot(reviewRaw);
  if (!reviewResult.ok || !validateChangeSetReviewSnapshot(reviewResult.value).valid) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_record_mismatch");
  }
  const record = reviewResult.value.records.find(
    (candidate) => candidate.changeSetId === journal.changeSetId
  );
  if (!record) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_record_missing");
  }
  if (
    record.outcome !== "accepted" ||
    record.recordRevision !== acceptedReview.recordRevision ||
    record.proposalDigest !== acceptedReview.proposalDigest ||
    record.acceptedAt !== acceptedReview.acceptedAt ||
    record.acceptedDigest !== journal.changeSetDigest ||
    record.manifestCommitIntentDigest !== acceptedReview.manifestCommitIntentDigest ||
    record.manifestCommitIntentDigest !== journal.manifestCommitIntentDigest ||
    record.manifestCommitPlanDigest !== journal.manifestCommitIntent.manifestCommitPlanDigest ||
    !reviewClaimMatchesTransaction(record, journal) ||
    !exactJsonValuesEqual(record.acceptedChangeSet, journal.changeSet) ||
    !exactJsonValuesEqual(record.manifestCommitIntent, journal.manifestCommitIntent)
  ) {
    throw new KnowledgeApplyCommitAuthorityError(journal.transactionId, "review_record_mismatch");
  }
}

function readSourceCommitExtension(
  entry: SourceManifestEntry,
  bundleId: string
): KnowledgeRuntimeSourceCommitExtension | null {
  const raw = entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
  if (raw === undefined) {
    return null;
  }
  const parsed = parseKnowledgeRuntimeSourceCommitExtension(raw);
  if (!parsed.ok) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "source_metadata_invalid"
    );
  }
  return parsed.value;
}

function readSourceNoChangesCommitMarker(
  entry: SourceManifestEntry
): NoChangesManifestCommitMarker | null {
  const raw = entry.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
  if (raw === undefined) return null;
  const parsed = parseKnowledgeNoChangesCommitMarker(raw);
  if (!parsed.ok || !validateNoChangesManifestCommitMarker(parsed.value).valid) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return parsed.value;
}

function assertSourceInputRevisionCanCommit(
  entry: SourceManifestEntry,
  bundleId: string,
  inputRevision: number,
  manifest: SourceManifest,
  ledger: readonly KnowledgeApplyCommitLedgerRecord[]
): void {
  const previous = readSourceCommitExtension(entry, bundleId);
  const previousNoChanges = readSourceNoChangesCommitMarker(entry);
  if (entry.lastSuccessful !== undefined && previous === null) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "source_metadata_missing"
    );
  }
  if (entry.lastSuccessful === undefined && previous !== null) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "source_metadata_invalid"
    );
  }
  if (entry.lastSuccessful !== undefined && previous !== null) {
    const proof = ledger.find((record) => record.transactionId === previous.transactionId);
    if (
      !proof ||
      proof.bundleId !== bundleId ||
      proof.sourceId !== entry.sourceId ||
      proof.sourceContentHash !== entry.lastSuccessful.sourceContentHash ||
      proof.pipelineFingerprint !== entry.lastSuccessful.pipelineFingerprint ||
      proof.inputRevision !== previous.inputRevision ||
      proof.manifestIntentDigest !== previous.manifestIntentDigest ||
      proof.changeSetId !== entry.lastSuccessful.changeSetId ||
      proof.recordedAt !== entry.lastSuccessful.completedAt ||
      proof.manifestAfterRevision > manifest.revision ||
      (proof.manifestAfterRevision === manifest.revision &&
        proof.manifestAfterDigest !== createSourceManifestDigest(manifest))
    ) {
      throw new KnowledgeApplyCommitManifestConflictError(
        bundleId,
        entry.sourceId,
        "source_metadata_invalid"
      );
    }
  }
  const latestInputRevision = Math.max(
    previous?.inputRevision ?? 0,
    previousNoChanges?.inputRevision ?? 0
  );
  if (inputRevision <= latestInputRevision) {
    throw new KnowledgeApplyCommitManifestConflictError(
      bundleId,
      entry.sourceId,
      "input_revision_not_newer"
    );
  }
}

function createCommittedSourceManifest(
  manifest: SourceManifest,
  source: SourceManifestEntry,
  journal: CommittedChangeSetTransactionJournal,
  receipt: TransactionCommitReceipt,
  intent: ManifestCommitIntent
): SourceManifest {
  if (manifest.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeApplyCommitManifestConflictError(
      manifest.bundleId,
      source.sourceId,
      "revision_overflow"
    );
  }
  const snapshot: SourceCompileSnapshot = {
    sourceContentHash: journal.jobClaim.sourceContentHash,
    pipelineFingerprint: journal.jobClaim.pipelineFingerprint,
    generatedPages: intent.generatedPages.map((page) => ({ ...page })),
    changeSetId: journal.changeSetId,
    completedAt: receipt.committedAt,
  };
  const extension: KnowledgeRuntimeSourceCommitExtension = {
    version: 1,
    inputRevision: journal.jobClaim.inputRevision,
    transactionId: journal.transactionId,
    manifestIntentDigest: journal.manifestCommitIntentDigest,
  };
  const extensions: Record<string, JsonValue> = {
    ...source.extensions,
    [KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]: extension as unknown as JsonValue,
  };
  delete extensions[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
  const nextEntry: SourceManifestEntry = {
    ...source,
    lastSuccessful: snapshot,
    extensions,
  };
  if (
    nextEntry.lastFailure !== undefined &&
    nextEntry.lastFailure.failure.occurredAt <= receipt.committedAt
  ) {
    delete nextEntry.lastFailure;
  }
  const writtenTargets = new Map(
    journal.changeSet.changes.flatMap((change) =>
      change.operation === "delete"
        ? []
        : [
            [
              toWindowsPathKey(change.path),
              { contentHash: change.afterHash, sourceRefs: new Set(change.sourceRefs) },
            ] as const,
          ]
    )
  );
  return {
    ...manifest,
    revision: manifest.revision + 1,
    entries: manifest.entries.map((entry) => {
      if (entry.sourceId === source.sourceId) {
        return nextEntry;
      }
      if (!entry.lastSuccessful) {
        return entry;
      }
      let changed = false;
      const generatedPages = entry.lastSuccessful.generatedPages.map((page) => {
        const written = writtenTargets.get(toWindowsPathKey(page.path));
        if (!written || !written.sourceRefs.has(entry.sourceId)) {
          return page;
        }
        changed = changed || page.contentHash !== written.contentHash;
        return { ...page, contentHash: written.contentHash };
      });
      return changed
        ? { ...entry, lastSuccessful: { ...entry.lastSuccessful, generatedPages } }
        : entry;
    }),
  };
}

function optionalJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return canonicalizeJson(left as JsonValue) === canonicalizeJson(right as JsonValue);
}

function assertGenericManifestPreservesCommitState(
  current: SourceManifest | null,
  candidate: SourceManifest
): void {
  const currentEntries = new Map(
    (current?.entries ?? []).map((entry) => [entry.sourceId, entry] as const)
  );
  const candidateEntries = new Map(
    candidate.entries.map((entry) => [entry.sourceId, entry] as const)
  );
  const sourceIds = new Set([...currentEntries.keys(), ...candidateEntries.keys()]);
  for (const sourceId of sourceIds) {
    const before = currentEntries.get(sourceId);
    const after = candidateEntries.get(sourceId);
    if (before !== undefined && after === undefined) {
      throw new KnowledgeRuntimeManifestProtectedStateError(
        candidate.bundleId,
        sourceId,
        "source_identity"
      );
    }
    if (!optionalJsonValuesEqual(before?.lastSuccessful, after?.lastSuccessful)) {
      throw new KnowledgeRuntimeManifestProtectedStateError(
        candidate.bundleId,
        sourceId,
        "last_successful"
      );
    }
    if (
      !optionalJsonValuesEqual(
        before?.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY],
        after?.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]
      )
    ) {
      throw new KnowledgeRuntimeManifestProtectedStateError(
        candidate.bundleId,
        sourceId,
        "reserved_commit_extension"
      );
    }
    if (
      !optionalJsonValuesEqual(
        before?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY],
        after?.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]
      )
    ) {
      throw new KnowledgeRuntimeManifestProtectedStateError(
        candidate.bundleId,
        sourceId,
        "reserved_no_changes_extension"
      );
    }
  }
  if (
    !optionalJsonValuesEqual(
      current?.extensions?.[KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY],
      candidate.extensions?.[KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY]
    )
  ) {
    throw new KnowledgeRuntimeManifestProtectedStateError(
      candidate.bundleId,
      "retirement-history",
      "retirement_extension"
    );
  }
  if (
    !optionalJsonValuesEqual(
      current?.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY],
      candidate.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY]
    )
  ) {
    throw new KnowledgeRuntimeManifestProtectedStateError(
      candidate.bundleId,
      "forward-revision-overlays",
      "forward_revision_overlay_extension"
    );
  }
}

function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

function parseRuntimeText(
  text: string,
  maxTextCharacters = DEFAULT_MAX_KNOWLEDGE_RUNTIME_TEXT_CHARACTERS
): KnowledgeRuntimeStoreSnapshot {
  requireRuntimeTextWithinLimit(text, maxTextCharacters);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return parseKnowledgeRuntimeStoreSnapshot(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUnknownRuntimeText(
  text: string,
  maxTextCharacters = DEFAULT_MAX_KNOWLEDGE_RUNTIME_TEXT_CHARACTERS
): unknown {
  requireRuntimeTextWithinLimit(text, maxTextCharacters);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

function requireRuntimeTextWithinLimit(text: string, maxTextCharacters: number): string {
  if (typeof text !== "string" || text.length > maxTextCharacters) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return text;
}

function stringifyBoundedRuntimeValue(value: unknown, maxTextCharacters: number): string {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    return requireRuntimeTextWithinLimit(text, maxTextCharacters);
  } catch (error) {
    if (error instanceof KnowledgeRuntimeStoreCorruptError) throw error;
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

function serializedRuntimeValueExceedsLimit(value: unknown, maxTextCharacters: number): boolean {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") throw new KnowledgeRuntimeStoreCorruptError();
    return text.length > maxTextCharacters;
  } catch (error) {
    if (error instanceof KnowledgeRuntimeStoreCorruptError) throw error;
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

function requireLegacyQueueSlot(slot: KnowledgeRuntimeBundleSlot): IngestQueueSnapshot {
  const parsed = parseIngestQueueSnapshot(slot.value);
  if (
    !parsed.ok ||
    !validateIngestQueueSnapshot(slot.value).valid ||
    parsed.value.bundleId !== slot.bundleId
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return cloneJson(parsed.value);
}

function assertLegacyManifestSlot(slot: KnowledgeRuntimeBundleSlot): void {
  const parsed = parseSourceManifest(slot.value);
  if (
    !parsed.ok ||
    !validateSourceManifest(slot.value).valid ||
    parsed.value.bundleId !== slot.bundleId
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  for (const entry of parsed.value.entries) {
    if (entry.lastSuccessful !== undefined) {
      throw new KnowledgeRuntimeMigrationUnsafeError("manifest_success_present", slot.bundleId);
    }
    if (entry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY] !== undefined) {
      throw new KnowledgeRuntimeMigrationUnsafeError(
        "manifest_reserved_commit_metadata_present",
        slot.bundleId
      );
    }
  }
}

function migrateLegacyReviewSlot(slot: KnowledgeRuntimeBundleSlot): KnowledgeRuntimeBundleSlot {
  if (isRecord(slot.value) && slot.value.version === CHANGESET_REVIEW_SNAPSHOT_VERSION) {
    const parsed = parseChangeSetReviewSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (parsed.value.records.length > 0) {
      throw new KnowledgeRuntimeMigrationUnsafeError("review_records_present", slot.bundleId);
    }
    return { bundleId: slot.bundleId, value: cloneJson(parsed.value) };
  }

  const parsed = legacyEmptyReviewSnapshotSchema.safeParse(slot.value);
  if (!parsed.success || parsed.data.bundleId !== slot.bundleId) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  if (parsed.data.records.length > 0) {
    throw new KnowledgeRuntimeMigrationUnsafeError("review_records_present", slot.bundleId);
  }
  return {
    bundleId: slot.bundleId,
    value: {
      version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
      bundleId: parsed.data.bundleId,
      revision: parsed.data.revision,
      records: [],
    },
  };
}

function assertLegacyQueueIsMigrationSafe(snapshot: IngestQueueSnapshot): void {
  if (snapshot.pendingReviews.length > 0 || snapshot.reviewRejections.length > 0) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_review_state_present", snapshot.bundleId);
  }
  if (
    snapshot.applyClaim !== undefined ||
    snapshot.applyCommit !== undefined ||
    snapshot.applyAbandonments.length > 0
  ) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_apply_state_present", snapshot.bundleId);
  }
  if (snapshot.jobs.some((job) => job.status === "awaiting_review" || job.stage === "applying")) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_active_job_present", snapshot.bundleId);
  }
}

function migrateRuntimeV2ToV3Snapshot(
  value: unknown,
  runtimeId: string
): PreviousKnowledgeRuntimeStoreSnapshot {
  const parsed = runtimeV2StoreSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const previous = parsed.data;
  assertUniqueBundleSlots(previous.queues);
  assertUniqueBundleSlots(previous.reviews);
  assertUniqueBundleSlots(previous.manifests);
  assertUniqueInputRevisionRecords(previous.inputRevisions);
  assertUniqueApplyCommits(previous.applyCommits);
  if (previous.revision >= Number.MAX_SAFE_INTEGER - 1) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  const queues = new Map<string, IngestQueueSnapshot>();
  for (const slot of previous.queues) {
    const queue = parseIngestQueueSnapshot(slot.value);
    if (
      !queue.ok ||
      !validateIngestQueueSnapshot(queue.value).valid ||
      queue.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    queues.set(slot.bundleId, queue.value);
  }
  for (const [bundleId, queue] of queues) {
    const previousSources = previous.inputRevisions.find(
      (candidate) => candidate.bundleId === bundleId
    )?.sources;
    for (const watermark of queue.sourceHighWatermarks) {
      const allocated = previousSources?.find(
        (candidate) => candidate.sourceId === watermark.sourceId
      );
      if (!allocated || allocated.inputRevision < watermark.inputRevision) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    }
  }
  const inputRevisions: KnowledgeRuntimeInputRevisionBundle[] = previous.inputRevisions.map(
    (bundle) => {
      const queue = queues.get(bundle.bundleId);
      return {
        bundleId: bundle.bundleId,
        sources: bundle.sources.map((source) => {
          const legacyCheckpoint = queue?.sourceHighWatermarks.find(
            (candidate) => candidate.sourceId === source.sourceId
          );
          return {
            sourceId: source.sourceId,
            inputRevision: source.inputRevision,
            managedAfterRevision: source.inputRevision,
            ...(legacyCheckpoint === undefined
              ? {}
              : { legacyCheckpoint: cloneJson(legacyCheckpoint) }),
            observations: [],
          };
        }),
      };
    }
  );
  const migrated: PreviousKnowledgeRuntimeStoreSnapshot = {
    ...previous,
    version: PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION,
    runtimeId,
    revision: previous.revision + 1,
    inputRevisions,
  };
  const validated = previousKnowledgeRuntimeStoreSnapshotSchema.safeParse(migrated);
  if (!validated.success) throw new KnowledgeRuntimeStoreCorruptError();
  assertUniqueBundleSlots(validated.data.queues);
  assertUniqueBundleSlots(validated.data.reviews);
  assertUniqueBundleSlots(validated.data.manifests);
  assertUniqueInputRevisionRecords(validated.data.inputRevisions);
  assertUniqueApplyCommits(validated.data.applyCommits);
  assertRuntimeSlotSemantics(validated.data, false);
  return cloneJson(validated.data);
}

function demoteLegacyCompletedJob(job: ReusableCompletedJob): KnowledgeIngestJob {
  return {
    id: job.id,
    bundleId: job.bundleId,
    sourceId: job.sourceId,
    sourceContentHash: job.sourceContentHash,
    pipelineFingerprint: job.pipelineFingerprint,
    inputRevision: job.inputRevision,
    attempt: job.attempt,
    rerunRequested: false,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: "pending",
    stage: "queued",
  };
}

function migrateRuntimeV3Queue(
  previous: PreviousKnowledgeRuntimeStoreSnapshot,
  queue: IngestQueueSnapshot,
  manifest: SourceManifest | undefined
): IngestQueueSnapshot {
  const demotedJobIds = new Set<string>();
  for (const highWatermark of queue.sourceHighWatermarks) {
    const outcome = findCurrentSourceTerminalOutcome(queue, highWatermark);
    if (outcome.kind === "invalid") {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    if (
      outcome.kind === "completed" &&
      !reusableCompletionHasProof(previous, manifest, outcome.job)
    ) {
      demotedJobIds.add(outcome.job.id);
    }
  }
  if (demotedJobIds.size === 0) return cloneJson(queue);
  if (queue.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("queue_revision_overflow", queue.bundleId);
  }
  const jobs = queue.jobs.map((job) =>
    job.status === "completed" && demotedJobIds.has(job.id) ? demoteLegacyCompletedJob(job) : job
  );
  const pausedAt = Math.max(
    0,
    ...jobs
      .filter((job) => demotedJobIds.has(job.id))
      .map((job) => Math.max(job.createdAt, job.updatedAt))
  );
  const candidate: IngestQueueSnapshot = {
    ...queue,
    revision: queue.revision + 1,
    control:
      queue.control.status === "running"
        ? {
            status: "paused",
            reason: "startup_recovery",
            pausedAt,
            detail: "Legacy completion requires one proof-producing restart run",
          }
        : queue.control,
    jobs,
  };
  const parsed = parseIngestQueueSnapshot(candidate);
  if (!parsed.ok || !validateIngestQueueSnapshot(parsed.value).valid) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return cloneJson(parsed.value);
}

function parsePreviousKnowledgeRuntimeStoreSnapshot(
  value: unknown
): PreviousKnowledgeRuntimeStoreSnapshot {
  const parsed = previousKnowledgeRuntimeStoreSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  assertRuntimeSlotSemantics(snapshot, false);
  return cloneJson(snapshot);
}

function migrateRuntimeV3ToV4Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV4 {
  const previous = parsePreviousKnowledgeRuntimeStoreSnapshot(value);
  if (previous.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  const manifests = new Map<string, SourceManifest>();
  for (const slot of previous.manifests) {
    const parsed = parseSourceManifest(slot.value);
    if (!parsed.ok || !validateSourceManifest(parsed.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    manifests.set(slot.bundleId, parsed.value);
  }
  const queues = previous.queues.map((slot) => {
    const parsed = parseIngestQueueSnapshot(slot.value);
    if (!parsed.ok || !validateIngestQueueSnapshot(parsed.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    return {
      bundleId: slot.bundleId,
      value: migrateRuntimeV3Queue(previous, parsed.value, manifests.get(slot.bundleId)),
    };
  });
  return parseRuntimeV4StoreSnapshot({
    ...previous,
    version: RUNTIME_V4_STORE_VERSION,
    revision: previous.revision + 1,
    queues,
  });
}

function parseRuntimeV4StoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV4 {
  const parsed = runtimeV4StoreSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  const snapshot = parsed.data;
  for (const slot of snapshot.manifests) {
    const manifest = parseSourceManifest(slot.value);
    if (
      manifest.ok &&
      Object.prototype.hasOwnProperty.call(
        manifest.value.extensions ?? {},
        KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY
      )
    ) {
      throw new KnowledgeRuntimeMigrationUnsafeError(
        "source_retirement_state_present",
        slot.bundleId
      );
    }
  }
  for (const bundle of snapshot.inputRevisions) {
    if (
      bundle.sources.some((source) =>
        source.observations.some((observation) => observation.status === "retired")
      )
    ) {
      throw new KnowledgeRuntimeMigrationUnsafeError(
        "source_retirement_state_present",
        bundle.bundleId
      );
    }
  }
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  assertRuntimeSlotSemantics(snapshot);
  return cloneJson(snapshot);
}

function migrateRuntimeV4ToV5Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV5 {
  const previous = parseRuntimeV4StoreSnapshot(value);
  if (previous.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  return parseRuntimeV5StoreSnapshot({
    ...previous,
    version: RUNTIME_V5_STORE_VERSION,
    revision: previous.revision + 1,
  });
}

function parseRuntimeV5StoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV5 {
  const parsed = runtimeV5StoreSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  assertRuntimeSlotSemantics(snapshot);
  return cloneJson(snapshot);
}

function migrateRuntimeV5ToV6Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV6 {
  const previous = parseRuntimeV5StoreSnapshot(value);
  if (previous.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  return parseRuntimeV6StoreSnapshot({
    ...previous,
    version: RUNTIME_V6_STORE_VERSION,
    revision: previous.revision + 1,
    forwardRevisionReviews: [],
  });
}

function parseRuntimeV6StoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV6 {
  const parsed = runtimeV6StoreSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.forwardRevisionReviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  const publishedRuntimeRevisions = new Set<number>();
  for (const slot of snapshot.forwardRevisionReviews) {
    const parsedForward = (() => {
      try {
        return snapshotKnowledgeForwardRevisionReviewSnapshot(slot.value);
      } catch {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
    })();
    if (
      parsedForward.bundleId !== slot.bundleId ||
      parsedForward.records.some((record) => {
        if (
          record.proposal.request.runtimeId !== snapshot.runtimeId ||
          record.publishedRuntimeRevision > snapshot.revision ||
          publishedRuntimeRevisions.has(record.publishedRuntimeRevision)
        ) {
          return true;
        }
        publishedRuntimeRevisions.add(record.publishedRuntimeRevision);
        return false;
      })
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  assertRuntimeSlotSemantics(snapshot);
  return cloneJson(snapshot);
}

function migrateRuntimeV6ToV7Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV7 {
  const previous = parseRuntimeV6StoreSnapshot(value);
  if (previous.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  return parseRuntimeV7StoreSnapshot({
    ...previous,
    version: RUNTIME_V7_STORE_VERSION,
    revision: previous.revision + 1,
    forwardRevisionReviews: previous.forwardRevisionReviews.map((slot) => ({
      bundleId: slot.bundleId,
      value: migrateKnowledgeForwardRevisionReviewSnapshotV1ToV2(slot.value),
    })),
  });
}

function parseRuntimeV7StoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV7 {
  const parsed = runtimeV7StoreSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.forwardRevisionReviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  for (const slot of snapshot.manifests) {
    const manifest = parseSourceManifest(slot.value);
    if (!manifest.ok || !validateSourceManifest(manifest.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const extensions = manifest.value.extensions ?? {};
    if (
      Object.prototype.hasOwnProperty.call(
        extensions,
        KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY
      )
    ) {
      throw new KnowledgeRuntimeMigrationUnsafeError(
        "forward_revision_overlay_state_present",
        slot.bundleId
      );
    }
  }
  assertRuntimeSlotSemantics(snapshot);
  return cloneJson(snapshot);
}

function migrateRuntimeV7ToV8Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV8 {
  const previous = parseRuntimeV7StoreSnapshot(value);
  if (previous.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  const migrated = {
    ...previous,
    version: RUNTIME_V8_STORE_VERSION,
    revision: previous.revision + 1,
    activeForwardRevisionApply: null,
    forwardRevisionApplyCommits: [],
  };
  const parsed = runtimeV8StoreSnapshotSchema.safeParse(migrated);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  return cloneJson(parsed.data);
}

function parseRuntimeV8StoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshotV8 {
  const parsed = runtimeV8StoreSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new KnowledgeRuntimeStoreCorruptError();
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.forwardRevisionReviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  if (snapshot.activeTransaction !== null) {
    const transaction = parseChangeSetTransactionJournal(snapshot.activeTransaction);
    if (!transaction.ok || !validateChangeSetTransactionJournal(transaction.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  if (snapshot.activeTransaction !== null && snapshot.activeForwardRevisionApply !== null) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  if (snapshot.activeForwardRevisionApply !== null) {
    snapshotKnowledgeForwardRevisionApplyJournal(snapshot.activeForwardRevisionApply);
  }
  const legacyLedgers = snapshot.forwardRevisionApplyCommits.map((record) =>
    snapshotKnowledgeForwardRevisionApplyLedgerRecordV1(record)
  );
  const ledgerIds = new Set<string>();
  const transactionIds = new Set(snapshot.applyCommits.map((record) => record.transactionId));
  const pageKeys = new Set<string>();
  for (const ledger of legacyLedgers) {
    if (
      ledgerIds.has(ledger.ledgerId) ||
      transactionIds.has(ledger.transactionId) ||
      pageKeys.has(ledger.windowsPathKey)
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    ledgerIds.add(ledger.ledgerId);
    transactionIds.add(ledger.transactionId);
    pageKeys.add(ledger.windowsPathKey);
  }
  for (const slot of snapshot.forwardRevisionReviews) {
    const review = parseKnowledgeForwardRevisionReviewSnapshotV2(slot.value);
    if (!review.ok || review.value.bundleId !== slot.bundleId) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  for (const slot of snapshot.manifests) {
    const manifest = parseSourceManifest(slot.value);
    if (
      !manifest.ok ||
      !validateSourceManifest(manifest.value).valid ||
      manifest.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    const overlays = manifest.value.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY];
    if (overlays !== undefined && !parseKnowledgeForwardRevisionOverlayExtension(overlays).ok) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  return cloneJson(snapshot);
}

function migrateRuntimeV8ToV9Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshot {
  const previous = parseRuntimeV8StoreSnapshot(value);
  if (previous.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }
  const activeForwardRevisionApply =
    previous.activeForwardRevisionApply === null
      ? null
      : snapshotKnowledgeForwardRevisionApplyJournal(previous.activeForwardRevisionApply);
  const provisional: KnowledgeRuntimeStoreSnapshot = {
    ...previous,
    version: KNOWLEDGE_RUNTIME_STORE_VERSION,
    revision: previous.revision + 1,
    activeForwardRevisionApply,
    forwardRevisionApplyCommits: [],
    forwardRevisionSupersessions: [],
    forwardRevisionAbandonments: [],
    forwardRevisionRecoveryTerminals: [],
  };
  const manifests = new Map<string, SourceManifest>();
  for (const slot of provisional.manifests) {
    const parsed = parseSourceManifest(slot.value);
    if (!parsed.ok || !validateSourceManifest(parsed.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    manifests.set(slot.bundleId, parsed.value);
  }
  const migratedLedgers = previous.forwardRevisionApplyCommits.map((record) => {
    const legacy = snapshotKnowledgeForwardRevisionApplyLedgerRecordV1(record);
    const manifest = manifests.get(legacy.bundleId);
    const sourceBase = manifest
      ? recomputeForwardRevisionSourceBase(provisional, manifest, legacy.sourceId)
      : undefined;
    if (
      !sourceBase ||
      createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== legacy.sourceBaseDigest
    ) {
      throw new KnowledgeRuntimeMigrationUnsafeError(
        "forward_revision_source_base_unavailable",
        legacy.bundleId
      );
    }
    return migrateKnowledgeForwardRevisionApplyLedgerRecordV1(legacy, {
      sourceBase,
      manifestAfterDigest: legacy.manifestAfterDigest,
    });
  });
  return parseKnowledgeRuntimeStoreSnapshot({
    ...provisional,
    forwardRevisionApplyCommits: migratedLedgers,
  });
}

function migrateRuntimeV7ToV9Snapshot(value: unknown): KnowledgeRuntimeStoreSnapshot {
  return migrateRuntimeV8ToV9Snapshot(migrateRuntimeV7ToV8Snapshot(value));
}

function migrateLegacyRuntimeSnapshot(
  value: unknown,
  runtimeId: string
): PreviousKnowledgeRuntimeStoreSnapshot {
  const parsed = legacyKnowledgeRuntimeStoreSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const legacy = parsed.data;
  assertUniqueBundleSlots(legacy.queues);
  assertUniqueBundleSlots(legacy.reviews);
  assertUniqueBundleSlots(legacy.manifests);
  assertUniqueInputRevisionRecords(legacy.inputRevisions);

  if (legacy.activeTransaction !== null) {
    throw new KnowledgeRuntimeMigrationUnsafeError("active_transaction_present");
  }
  if (legacy.applyCommits.length > 0) {
    throw new KnowledgeRuntimeMigrationUnsafeError("apply_commit_ledger_present");
  }
  if (legacy.revision >= Number.MAX_SAFE_INTEGER - 1) {
    throw new KnowledgeRuntimeMigrationUnsafeError("revision_overflow");
  }

  for (const slot of legacy.queues) {
    assertLegacyQueueIsMigrationSafe(requireLegacyQueueSlot(slot));
  }
  for (const slot of legacy.manifests) {
    assertLegacyManifestSlot(slot);
  }
  const reviews = legacy.reviews.map(migrateLegacyReviewSlot);
  const previous: KnowledgeRuntimeStoreSnapshotV2 = {
    version: RUNTIME_V2_STORE_VERSION,
    revision: legacy.revision,
    queues: legacy.queues,
    reviews,
    manifests: legacy.manifests,
    activeTransaction: null,
    inputRevisions: legacy.inputRevisions,
    applyCommits: [],
  };
  return migrateRuntimeV2ToV3Snapshot(previous, runtimeId);
}

function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createEmptyRuntimeQueueSnapshot(bundleId: string): IngestQueueSnapshot {
  return {
    version: INGEST_QUEUE_VERSION,
    bundleId,
    revision: 0,
    control: { status: "running" },
    jobs: [],
    reruns: [],
    sourceHighWatermarks: [],
    pendingReviews: [],
    reviewRejections: [],
    applyAbandonments: [],
  };
}

function createEmptyRuntimeReviewSnapshot(bundleId: string): ChangeSetReviewSnapshot {
  return {
    version: CHANGESET_REVIEW_SNAPSHOT_VERSION,
    bundleId,
    revision: 0,
    records: [],
  };
}

function queueHasStartupWriteRecoveryEvidence(snapshot: IngestQueueSnapshot): boolean {
  return (
    snapshot.applyClaim !== undefined ||
    snapshot.applyCommit !== undefined ||
    (snapshot.control.status === "paused" &&
      (snapshot.control.reason === "recovery_required" ||
        snapshot.control.reason === "commit_pending_ack")) ||
    snapshot.jobs.some(
      (job) => job.status === "processing" || (job.status === "failed" && job.stage === "applying")
    )
  );
}

function acceptedClassificationIsTerminal(
  classification: NoJournalApplyRecoveryClassification
): boolean {
  return classification.kind === "committed" || classification.kind === "abandoned";
}

function queueJobMatchesApplyClaim(
  job: KnowledgeIngestJob | undefined,
  claim: IngestApplyClaimMarker
): job is KnowledgeIngestJob {
  return (
    job !== undefined &&
    job.id === claim.jobId &&
    job.sourceId === claim.sourceId &&
    job.sourceContentHash === claim.sourceContentHash &&
    job.pipelineFingerprint === claim.pipelineFingerprint &&
    job.inputRevision === claim.inputRevision &&
    job.attempt === claim.attempt &&
    (job.status !== "processing" || job.startedAt === claim.startedAt)
  );
}

function replaceRuntimeQueueJob(
  snapshot: IngestQueueSnapshot,
  replacement: KnowledgeIngestJob
): IngestQueueSnapshot {
  return {
    ...snapshot,
    jobs: snapshot.jobs.map((job) => (job.id === replacement.id ? replacement : job)),
  };
}

interface RuntimeNoChangesQueueTransition {
  processing: Extract<KnowledgeIngestJob, { status: "processing" }>;
  completed: Extract<KnowledgeIngestJob, { status: "completed" }>;
}

function hasProtectedNoChangesCompletion(
  current: IngestQueueSnapshot | null,
  candidate: IngestQueueSnapshot
): boolean {
  if (!current) return false;
  return current.jobs.some((job) => {
    if (job.status !== "processing" || job.stage === "applying") return false;
    const next = candidate.jobs.find((candidateJob) => candidateJob.id === job.id);
    return next?.status === "completed";
  });
}

function projectRuntimeNoChangesQueueTransition(
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): RuntimeNoChangesQueueTransition | null {
  const processing = current.jobs.find(
    (job): job is Extract<KnowledgeIngestJob, { status: "processing" }> =>
      job.status === "processing" && job.stage !== "applying"
  );
  if (!processing) return null;
  const completed = candidate.jobs.find(
    (job): job is Extract<KnowledgeIngestJob, { status: "completed" }> =>
      job.id === processing.id && job.status === "completed"
  );
  if (!completed || completed.completedAt < Math.max(processing.updatedAt, processing.startedAt)) {
    return null;
  }
  const expectedCompleted: KnowledgeIngestJob = {
    id: processing.id,
    bundleId: processing.bundleId,
    sourceId: processing.sourceId,
    sourceContentHash: processing.sourceContentHash,
    pipelineFingerprint: processing.pipelineFingerprint,
    inputRevision: processing.inputRevision,
    attempt: processing.attempt,
    rerunRequested: false,
    createdAt: processing.createdAt,
    updatedAt: completed.completedAt,
    status: "completed",
    stage: "completed",
    changeSetId: completed.changeSetId,
    completedAt: completed.completedAt,
  };
  const expected = {
    ...promoteNoJournalRerun(
      replaceRuntimeQueueJob(current, expectedCompleted),
      processing.sourceId,
      completed.completedAt
    ),
    revision: current.revision + 1,
  };
  return exactJsonValuesEqual(expected, candidate) ? { processing, completed } : null;
}

function createNoChangesCommittedManifest(
  manifest: SourceManifest,
  source: SourceManifestEntry,
  marker: NoChangesManifestCommitMarker
): SourceManifest {
  if (manifest.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      manifest.bundleId,
      source.sourceId,
      "revision_overflow"
    );
  }
  const nextEntry: SourceManifestEntry = {
    ...source,
    extensions: {
      ...source.extensions,
      [KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY]: marker as unknown as JsonValue,
    },
  };
  if (
    nextEntry.lastFailure !== undefined &&
    nextEntry.lastFailure.failure.occurredAt <= marker.completedAt
  ) {
    delete nextEntry.lastFailure;
  }
  return {
    ...manifest,
    revision: manifest.revision + 1,
    entries: manifest.entries.map((entry) =>
      entry.sourceId === source.sourceId ? nextEntry : entry
    ),
  };
}

function projectRuntimeNoChangesManifestCommit(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot,
  authority: Extract<QueueWriteAuthority, { kind: "no_changes_commit" }>
): SourceManifest {
  const transition = projectRuntimeNoChangesQueueTransition(current, candidate);
  const parsedPlan = parseNoChangesManifestCommitPlan(authority.plan);
  const fallbackSourceId = transition?.processing.sourceId ?? "unknown-source";
  if (
    !transition ||
    !parsedPlan.ok ||
    !validateNoChangesManifestCommitPlan(parsedPlan.ok ? parsedPlan.value : authority.plan).valid ||
    typeof authority.planDigest !== "string" ||
    createNoChangesManifestCommitPlanDigest(parsedPlan.value) !== authority.planDigest
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      fallbackSourceId,
      transition ? "authority_invalid" : "queue_mismatch"
    );
  }
  const { processing, completed } = transition;
  const plan = parsedPlan.value;
  if (
    plan.bundleId !== current.bundleId ||
    plan.sourceId !== processing.sourceId ||
    plan.sourceContentHash !== processing.sourceContentHash ||
    plan.pipelineFingerprint !== processing.pipelineFingerprint ||
    plan.inputRevision !== processing.inputRevision ||
    plan.noChangesId !== completed.changeSetId
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "queue_mismatch"
    );
  }
  if (state.activeTransaction !== null) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "transaction_active"
    );
  }
  const manifestRaw = findBundleSlot(state, "manifests", current.bundleId);
  if (manifestRaw === null) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "manifest_mismatch"
    );
  }
  const manifest = parseSourceManifest(manifestRaw);
  if (
    !manifest.ok ||
    manifest.value.revision !== plan.expectedManifestRevision ||
    createSourceManifestDigest(manifest.value) !== plan.expectedManifestDigest
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "manifest_mismatch"
    );
  }
  const source = manifest.value.entries.find((entry) => entry.sourceId === processing.sourceId);
  if (!source) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "source_mismatch"
    );
  }
  let sourceAuthority: ReturnType<typeof deriveKnowledgeSourceCompileAuthority>;
  try {
    sourceAuthority = deriveKnowledgeSourceCompileAuthority(source);
  } catch {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "source_mismatch"
    );
  }
  const sourceAuthorityMatches =
    plan.kind === "query_writeback_source_compile"
      ? sourceAuthority.operation === "query_writeback" &&
        sourceAuthority.sourceOriginDigest === plan.sourceOriginDigest &&
        sourceAuthority.expectedSourceContentHash === plan.sourceContentHash
      : sourceAuthority.operation === "ingest";
  if (
    !sourceAuthorityMatches ||
    !noChangesBasePagesMatchSource(source, plan.baseGeneratedPages, false)
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "source_mismatch"
    );
  }
  const previousApply = readSourceCommitExtension(source, current.bundleId);
  const previousNoChanges = readSourceNoChangesCommitMarker(source);
  if (
    processing.inputRevision <=
    Math.max(previousApply?.inputRevision ?? 0, previousNoChanges?.inputRevision ?? 0)
  ) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "input_revision_not_newer"
    );
  }
  const observations =
    state.inputRevisions
      .find((bundle) => bundle.bundleId === current.bundleId)
      ?.sources.find((candidateSource) => candidateSource.sourceId === processing.sourceId)
      ?.observations.filter(
        (observation) =>
          observation.status === "consumed" &&
          observation.inputRevision === processing.inputRevision &&
          observation.sourceContentHash === processing.sourceContentHash &&
          observation.pipelineFingerprint === processing.pipelineFingerprint
      ) ?? [];
  if (observations.length !== 1) {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "observation_mismatch"
    );
  }
  let marker: NoChangesManifestCommitMarker;
  try {
    marker = createKnowledgeNoChangesCommitMarker({
      plan,
      jobClaim: {
        jobId: processing.id,
        sourceId: processing.sourceId,
        sourceContentHash: processing.sourceContentHash,
        pipelineFingerprint: processing.pipelineFingerprint,
        inputRevision: processing.inputRevision,
        attempt: processing.attempt,
        startedAt: processing.startedAt,
      },
      completedAt: completed.completedAt,
      manifestAfterRevision: manifest.value.revision + 1,
    });
  } catch {
    throw new KnowledgeRuntimeNoChangesCommitConflictError(
      current.bundleId,
      processing.sourceId,
      "authority_invalid"
    );
  }
  return createNoChangesCommittedManifest(manifest.value, source, marker);
}

function acceptedClaimProjectionMatches(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  const claim = candidate.applyClaim;
  // Review Apply is an explicit action; a user pause only blocks background work.
  // https://github.com/yydspanda/obsidian-copilot/issues/18
  const controlAllowsBegin =
    current.control.status === "running" ||
    (current.control.status === "paused" &&
      (current.control.reason === "startup_recovery" || current.control.reason === "user"));
  if (
    !controlAllowsBegin ||
    current.applyClaim !== undefined ||
    claim === undefined ||
    candidate.applyCommit !== undefined
  ) {
    return false;
  }
  const reviewRaw = findBundleSlot(state, "reviews", current.bundleId);
  if (reviewRaw === null) {
    return false;
  }
  const parsedReview = parseChangeSetReviewSnapshot(reviewRaw);
  if (!parsedReview.ok || !validateChangeSetReviewSnapshot(parsedReview.value).valid) {
    return false;
  }
  const record = parsedReview.value.records.find(
    (candidateRecord): candidateRecord is AcceptedChangeSetReviewRecord =>
      candidateRecord.outcome === "accepted" &&
      queueClaimMatchesAcceptedRecord(claim, candidateRecord)
  );
  const currentJob = current.jobs.find((job) => job.id === claim.jobId);
  const pending = current.pendingReviews.find((item) => item.jobId === claim.jobId);
  if (
    !record ||
    !currentJob ||
    currentJob.status !== "awaiting_review" ||
    currentJob.stage !== "review" ||
    currentJob.changeSetId !== record.changeSetId ||
    !queueJobMatchesAcceptedRecord(currentJob, record) ||
    pending?.kind !== "durable" ||
    pending.changeSetId !== record.changeSetId ||
    pending.proposalDigest !== record.proposalDigest ||
    pending.reviewRecordRevision !== 0 ||
    pending.recordedAt !== record.recordedAt ||
    claim.startedAt < Math.max(currentJob.updatedAt, record.acceptedAt)
  ) {
    return false;
  }

  const applying: KnowledgeIngestJob = {
    id: currentJob.id,
    bundleId: currentJob.bundleId,
    sourceId: currentJob.sourceId,
    sourceContentHash: currentJob.sourceContentHash,
    pipelineFingerprint: currentJob.pipelineFingerprint,
    inputRevision: currentJob.inputRevision,
    attempt: currentJob.attempt,
    rerunRequested: currentJob.rerunRequested,
    createdAt: currentJob.createdAt,
    updatedAt: claim.startedAt,
    status: "processing",
    stage: "applying",
    startedAt: claim.startedAt,
  };
  const expected: IngestQueueSnapshot = {
    ...replaceRuntimeQueueJob(current, applying),
    revision: current.revision + 1,
    pendingReviews: current.pendingReviews.filter((item) => item.jobId !== claim.jobId),
    applyClaim: {
      jobId: applying.id,
      sourceId: applying.sourceId,
      sourceContentHash: applying.sourceContentHash,
      pipelineFingerprint: applying.pipelineFingerprint,
      inputRevision: applying.inputRevision,
      attempt: applying.attempt,
      startedAt: applying.startedAt,
      reviewedChangeSet: {
        changeSetId: record.changeSetId,
        changeSetDigest: record.acceptedDigest,
      },
      acceptedReview: {
        proposalDigest: record.proposalDigest,
        recordRevision: record.recordRevision,
        manifestCommitIntentDigest: record.manifestCommitIntentDigest,
        acceptedAt: record.acceptedAt,
      },
    },
  };
  return exactJsonValuesEqual(expected, candidate);
}

function acceptedNotStartedAnchorsArePreserved(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  const reviewRaw = findBundleSlot(state, "reviews", current.bundleId);
  if (reviewRaw === null) {
    return true;
  }
  const parsedReview = parseChangeSetReviewSnapshot(reviewRaw);
  if (!parsedReview.ok || !validateChangeSetReviewSnapshot(parsedReview.value).valid) {
    return false;
  }
  for (const record of parsedReview.value.records) {
    if (record.outcome !== "accepted") {
      continue;
    }
    const currentJob = current.jobs.find((job) => job.id === record.jobClaim.jobId);
    const currentPending = current.pendingReviews.find(
      (pending) => pending.jobId === record.jobClaim.jobId
    );
    const isAcceptedNotStarted =
      queueJobMatchesAcceptedRecord(currentJob, record) &&
      currentJob.status === "awaiting_review" &&
      currentJob.stage === "review" &&
      currentJob.changeSetId === record.changeSetId &&
      currentPending?.kind === "durable" &&
      currentPending.changeSetId === record.changeSetId &&
      currentPending.proposalDigest === record.proposalDigest &&
      currentPending.reviewRecordRevision === 0 &&
      currentPending.recordedAt === record.recordedAt &&
      current.applyClaim?.jobId !== record.jobClaim.jobId;
    if (!isAcceptedNotStarted) {
      continue;
    }
    const candidateJob = candidate.jobs.find((job) => job.id === record.jobClaim.jobId);
    const candidatePending = candidate.pendingReviews.find(
      (pending) => pending.jobId === record.jobClaim.jobId
    );
    if (
      !protectedQueueJobProjectionMatches(currentJob, candidateJob) ||
      !exactJsonValuesEqual(currentPending, candidatePending)
    ) {
      return false;
    }
  }
  return true;
}

function consumeQueueSourceObservations(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot | null,
  candidate: IngestQueueSnapshot,
  settledAt: number,
  authority?: QueueWriteAuthority
): KnowledgeRuntimeInputRevisionBundle[] | null {
  const currentBySource = new Map(
    (current?.sourceHighWatermarks ?? []).map(
      (watermark) => [watermark.sourceId, watermark] as const
    )
  );
  const candidateBySource = new Map(
    candidate.sourceHighWatermarks.map((watermark) => [watermark.sourceId, watermark] as const)
  );

  for (const watermark of current?.sourceHighWatermarks ?? []) {
    const next = candidateBySource.get(watermark.sourceId);
    if (!next || next.inputRevision < watermark.inputRevision) {
      return null;
    }
    if (next.inputRevision === watermark.inputRevision) {
      if (!exactJsonValuesEqual(watermark, next)) {
        return null;
      }
      continue;
    }
    if (next.observedAt < watermark.observedAt) {
      return null;
    }
  }
  let inputRevisions = state.inputRevisions;
  for (const watermark of candidate.sourceHighWatermarks) {
    const previous = currentBySource.get(watermark.sourceId);
    if (previous && previous.inputRevision === watermark.inputRevision) {
      continue;
    }
    const source = inputRevisions
      .find((bundle) => bundle.bundleId === candidate.bundleId)
      ?.sources.find((candidateSource) => candidateSource.sourceId === watermark.sourceId);
    const observation = source?.observations.find(
      (candidateObservation) => candidateObservation.inputRevision === watermark.inputRevision
    );
    if (
      !source ||
      !observation ||
      observation.status !== "bound" ||
      authority?.kind !== "source_observation" ||
      authority.observationToken !== observation.observationToken ||
      observation.sourceContentHash !== watermark.sourceContentHash ||
      observation.pipelineFingerprint !== watermark.pipelineFingerprint
    ) {
      return null;
    }
    const observations: KnowledgeRuntimeSourceObservationRecord[] = source.observations.map(
      (candidateObservation) => {
        if (candidateObservation.observationToken === observation.observationToken) {
          return {
            ...observation,
            status: "consumed" as const,
            settledAt: Math.max(settledAt, observation.boundAt),
            queueRevision: candidate.revision,
          };
        }
        if (
          candidateObservation.inputRevision < observation.inputRevision &&
          (candidateObservation.status === "allocated" || candidateObservation.status === "bound")
        ) {
          return {
            observationToken: candidateObservation.observationToken,
            captureId: candidateObservation.captureId,
            inputRevision: candidateObservation.inputRevision,
            allocatedAt: candidateObservation.allocatedAt,
            status: "superseded" as const,
            ...(candidateObservation.status === "bound"
              ? {
                  sourceContentHash: candidateObservation.sourceContentHash,
                  pipelineFingerprint: candidateObservation.pipelineFingerprint,
                  boundAt: candidateObservation.boundAt,
                }
              : {}),
            settledAt: Math.max(
              settledAt,
              candidateObservation.allocatedAt,
              candidateObservation.status === "bound" ? candidateObservation.boundAt : 0
            ),
            supersededByInputRevision: observation.inputRevision,
          };
        }
        return candidateObservation;
      }
    );
    inputRevisions = replaceInputRevisionSource(inputRevisions, candidate.bundleId, {
      ...source,
      observations,
    });
  }
  return inputRevisions;
}

function startupApplyRecoveryProjectionMatches(
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  if (
    candidate.control.status !== "paused" ||
    candidate.control.reason !== "recovery_required" ||
    current.applyClaim === undefined
  ) {
    return false;
  }
  const claim = current.applyClaim;
  const applying = current.jobs.find((job) => job.id === claim.jobId);
  if (
    !queueJobMatchesApplyClaim(applying, claim) ||
    applying.status !== "processing" ||
    applying.stage !== "applying"
  ) {
    return false;
  }
  const recoveredAt = Math.max(candidate.control.pausedAt, applying.updatedAt);
  const failed: KnowledgeIngestJob = {
    id: applying.id,
    bundleId: applying.bundleId,
    sourceId: applying.sourceId,
    sourceContentHash: applying.sourceContentHash,
    pipelineFingerprint: applying.pipelineFingerprint,
    inputRevision: applying.inputRevision,
    attempt: applying.attempt,
    rerunRequested: false,
    createdAt: applying.createdAt,
    updatedAt: recoveredAt,
    status: "failed",
    stage: "applying",
    failure: {
      code: "interrupted_apply_requires_recovery",
      message: "An interrupted apply requires transaction recovery before retry",
      retryable: false,
      occurredAt: recoveredAt,
    },
  };
  const recovered = promoteNoJournalRerun(
    replaceRuntimeQueueJob(current, failed),
    applying.sourceId,
    recoveredAt
  );
  const expected: IngestQueueSnapshot = {
    ...recovered,
    revision: current.revision + 1,
    control: {
      status: "paused",
      reason: "recovery_required",
      pausedAt: candidate.control.pausedAt,
      detail: "An interrupted apply must be recovered before queue resume",
    },
  };
  return exactJsonValuesEqual(expected, candidate);
}

function protectedQueueJobProjectionMatches(
  current: KnowledgeIngestJob | undefined,
  candidate: KnowledgeIngestJob | undefined
): boolean {
  if (!current || !candidate) {
    return false;
  }
  if (current.status !== "processing" && current.status !== "awaiting_review") {
    return exactJsonValuesEqual(current, candidate);
  }
  const {
    rerunRequested: _currentRerunRequested,
    updatedAt: currentUpdatedAt,
    ...currentAuthority
  } = current;
  const {
    rerunRequested: _candidateRerunRequested,
    updatedAt: candidateUpdatedAt,
    ...candidateAuthority
  } = candidate;
  void _currentRerunRequested;
  void _candidateRerunRequested;
  return (
    candidateUpdatedAt >= currentUpdatedAt &&
    exactJsonValuesEqual(currentAuthority, candidateAuthority)
  );
}

function createRuntimeApplyCommitMarker(
  journal: CommittedChangeSetTransactionJournal
): NonNullable<IngestQueueSnapshot["applyCommit"]> {
  const receipt = createTransactionCommitReceipt(journal);
  return {
    transactionId: receipt.transactionId,
    changeSetId: receipt.changeSetId,
    changeSetDigest: receipt.changeSetDigest,
    commitRevision: receipt.commitRevision,
    ...receipt.jobClaim,
    committedAt: receipt.committedAt,
  };
}

function applyCommitProjectionMatches(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  const preserveUserPause =
    current.control.status === "paused" && current.control.reason === "user";
  if (
    candidate.control.status !== "paused" ||
    candidate.control.reason !== (preserveUserPause ? "user" : "commit_pending_ack") ||
    current.applyClaim === undefined ||
    candidate.applyCommit === undefined ||
    state.activeTransaction === null
  ) {
    return false;
  }
  const parsedJournal = parseChangeSetTransactionJournal(state.activeTransaction);
  if (!parsedJournal.ok || parsedJournal.value.phase !== "committed") {
    return false;
  }
  const journal = parsedJournal.value;
  const marker = createRuntimeApplyCommitMarker(journal);
  const claim = current.applyClaim;
  const applying = current.jobs.find((job) => job.id === claim.jobId);
  if (
    journal.bundleId !== current.bundleId ||
    !exactJsonValuesEqual(marker, candidate.applyCommit) ||
    !queueClaimMatchesTransaction(claim, journal) ||
    (claim.reviewedChangeSet !== undefined &&
      (claim.reviewedChangeSet.changeSetId !== marker.changeSetId ||
        claim.reviewedChangeSet.changeSetDigest !== marker.changeSetDigest)) ||
    !queueJobMatchesApplyClaim(applying, claim) ||
    (applying.status !== "processing" && applying.status !== "failed") ||
    applying.stage !== "applying"
  ) {
    return false;
  }
  const completedJob = candidate.jobs.find((job) => job.id === applying.id);
  if (completedJob?.status !== "completed") return false;
  const completedAt = completedJob.completedAt;
  if (completedAt < Math.max(marker.committedAt, applying.updatedAt)) {
    return false;
  }
  const completed: KnowledgeIngestJob = {
    id: applying.id,
    bundleId: applying.bundleId,
    sourceId: applying.sourceId,
    sourceContentHash: applying.sourceContentHash,
    pipelineFingerprint: applying.pipelineFingerprint,
    inputRevision: applying.inputRevision,
    attempt: applying.attempt,
    rerunRequested: false,
    createdAt: applying.createdAt,
    updatedAt: completedAt,
    status: "completed",
    stage: "completed",
    changeSetId: marker.changeSetId,
    completedAt,
  };
  const promoted = settleNoJournalRerunAfterSuccessfulApply(
    replaceRuntimeQueueJob(current, completed),
    completed,
    completedAt
  );
  const expectedWithoutClaim: IngestQueueSnapshot = { ...promoted };
  delete expectedWithoutClaim.applyClaim;
  const expected: IngestQueueSnapshot = {
    ...expectedWithoutClaim,
    revision: current.revision + 1,
    // Retain the original pause across crash-safe acknowledgement; refreshing
    // the workflow must not release unrelated backlog after a selected Apply.
    // https://github.com/yydspanda/obsidian-copilot/issues/18
    control: preserveUserPause
      ? current.control
      : {
          status: "paused",
          reason: "commit_pending_ack",
          pausedAt: completedAt,
          detail: "Committed pages are waiting for durable journal acknowledgement",
        },
    applyCommit: marker,
  };
  return exactJsonValuesEqual(expected, candidate);
}

function applyCommitFinalizationProjectionMatches(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  const preserveUserPause =
    current.control.status === "paused" && current.control.reason === "user";
  if (
    state.activeTransaction !== null ||
    current.applyCommit === undefined ||
    candidate.applyCommit !== undefined ||
    candidate.control.status !== "paused" ||
    candidate.control.reason !== (preserveUserPause ? "user" : "startup_recovery") ||
    (!preserveUserPause && candidate.control.pausedAt < current.applyCommit.committedAt)
  ) {
    return false;
  }
  const expectedWithoutMarker: IngestQueueSnapshot = { ...current };
  delete expectedWithoutMarker.applyCommit;
  const expected: IngestQueueSnapshot = {
    ...expectedWithoutMarker,
    revision: current.revision + 1,
    // A selected Apply acknowledges only its marker, never the user's pause.
    // https://github.com/yydspanda/obsidian-copilot/issues/18
    control: preserveUserPause
      ? current.control
      : {
          status: "paused",
          reason: "startup_recovery",
          pausedAt: candidate.control.pausedAt,
          detail: "Recovered apply committed; startup reconciliation must release the backlog",
        },
  };
  return exactJsonValuesEqual(expected, candidate);
}

function protectedQueueEvidenceIsPreserved(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot,
  candidate: IngestQueueSnapshot
): boolean {
  if (current.control.status !== "paused") {
    return false;
  }
  const anchorsPreserved = acceptedNotStartedAnchorsArePreserved(state, current, candidate);
  if (current.control.reason === "startup_recovery") {
    if (current.applyClaim === undefined) {
      return candidate.applyClaim === undefined
        ? anchorsPreserved
        : acceptedClaimProjectionMatches(state, current, candidate);
    }
    const currentJob = current.jobs.find((job) => job.id === current.applyClaim?.jobId);
    const candidateJob = candidate.jobs.find((job) => job.id === current.applyClaim?.jobId);
    return (
      anchorsPreserved &&
      exactJsonValuesEqual(current.applyClaim, candidate.applyClaim) &&
      protectedQueueJobProjectionMatches(currentJob, candidateJob)
    );
  }
  if (current.control.reason === "recovery_required") {
    const currentJob = current.jobs.find((job) => job.id === current.applyClaim?.jobId);
    const candidateJob = candidate.jobs.find((job) => job.id === current.applyClaim?.jobId);
    return (
      anchorsPreserved &&
      current.applyClaim !== undefined &&
      exactJsonValuesEqual(current.applyClaim, candidate.applyClaim) &&
      exactJsonValuesEqual(currentJob, candidateJob)
    );
  }
  const currentJob = current.jobs.find((job) => job.id === current.applyCommit?.jobId);
  const candidateJob = candidate.jobs.find((job) => job.id === current.applyCommit?.jobId);
  return (
    anchorsPreserved &&
    current.applyCommit !== undefined &&
    exactJsonValuesEqual(current.applyCommit, candidate.applyCommit) &&
    exactJsonValuesEqual(currentJob, candidateJob)
  );
}

function protectedQueueControlTransitionIsAllowed(
  state: KnowledgeRuntimeStoreSnapshot,
  current: IngestQueueSnapshot | null,
  candidate: IngestQueueSnapshot
): boolean {
  // The commit marker remains an independent hard gate when a selected Apply
  // preserves the user's pause instead of replacing it with a recovery reason.
  // https://github.com/yydspanda/obsidian-copilot/issues/18
  if (
    current?.control.status === "paused" &&
    current.control.reason === "user" &&
    (current.applyCommit !== undefined || candidate.applyCommit !== undefined)
  ) {
    if (current.applyCommit === undefined) {
      return applyCommitProjectionMatches(state, current, candidate);
    }
    if (candidate.applyCommit === undefined) {
      return applyCommitFinalizationProjectionMatches(state, current, candidate);
    }
    return (
      exactJsonValuesEqual(current.control, candidate.control) &&
      protectedQueueEvidenceIsPreserved(state, current, candidate)
    );
  }
  if (
    current?.control.status !== "paused" ||
    (current.control.reason !== "startup_recovery" &&
      current.control.reason !== "recovery_required" &&
      current.control.reason !== "commit_pending_ack")
  ) {
    return true;
  }
  if (candidate.control.status !== "paused") {
    return false;
  }
  if (candidate.control.reason === current.control.reason) {
    return (
      exactJsonValuesEqual(current.control, candidate.control) &&
      protectedQueueEvidenceIsPreserved(state, current, candidate)
    );
  }
  if (
    current.control.reason === "startup_recovery" &&
    candidate.control.reason === "recovery_required"
  ) {
    return startupApplyRecoveryProjectionMatches(current, candidate);
  }
  if (
    (current.control.reason === "startup_recovery" ||
      current.control.reason === "recovery_required") &&
    candidate.control.reason === "commit_pending_ack"
  ) {
    return applyCommitProjectionMatches(state, current, candidate);
  }
  return applyCommitFinalizationProjectionMatches(state, current, candidate);
}

function compareAcceptedReviewRecords(
  left: AcceptedChangeSetReviewRecord,
  right: AcceptedChangeSetReviewRecord
): number {
  return (
    left.recordedAt - right.recordedAt || compareIdentifiers(left.changeSetId, right.changeSetId)
  );
}

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must contain non-whitespace text`);
  }
}

function replaceBundleSlot(
  slots: readonly KnowledgeRuntimeBundleSlot[],
  bundleId: string,
  value: object
): KnowledgeRuntimeBundleSlot[] {
  const replacement = { bundleId, value: cloneJson(value) };
  const exists = slots.some((slot) => slot.bundleId === bundleId);
  return (
    exists
      ? slots.map((slot) => (slot.bundleId === bundleId ? replacement : slot))
      : [...slots, replacement]
  ).sort((left, right) => compareIdentifiers(left.bundleId, right.bundleId));
}

function findForwardRevisionReviewSlot(
  state: KnowledgeRuntimeStoreSnapshot,
  bundleId: string
): object | null {
  return state.forwardRevisionReviews.find((slot) => slot.bundleId === bundleId)?.value ?? null;
}

function projectForwardRevisionProposalAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  query: Readonly<KnowledgeForwardRevisionProposalAuthorityQueryV1>
): Readonly<KnowledgeForwardRevisionProposalAuthorityV1> | null {
  const manifestRaw = findBundleSlot(state, "manifests", query.bundleId);
  const reviewRaw = findBundleSlot(state, "reviews", query.bundleId);
  if (manifestRaw === null || reviewRaw === null) return null;
  const manifestResult = parseSourceManifest(manifestRaw);
  const reviewResult = parseChangeSetReviewSnapshot(reviewRaw);
  if (
    !manifestResult.ok ||
    !validateSourceManifest(manifestResult.value).valid ||
    !reviewResult.ok ||
    !validateChangeSetReviewSnapshot(reviewResult.value).valid
  ) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const manifest = manifestResult.value;
  const review = reviewResult.value;
  const forwardReviewRaw = findForwardRevisionReviewSlot(state, query.bundleId);
  const forwardRevisionReview =
    forwardReviewRaw === null
      ? undefined
      : snapshotKnowledgeForwardRevisionReviewSnapshotV2(forwardReviewRaw);
  const currentManifestPage = projectKnownAppliedWikiCurrentManifestPage(manifest, query.pagePath);
  if (
    !currentManifestPage ||
    currentManifestPage.path !== query.pagePath ||
    currentManifestPage.ownership !== "generated" ||
    currentManifestPage.contentHash !== query.vaultObservedBeforeHash ||
    query.selectedContentHash === query.vaultObservedBeforeHash
  ) {
    return null;
  }
  const index = projectKnowledgeKnownAppliedWikiOutputIndex({
    runtimeId: state.runtimeId,
    runtimeRevision: state.revision,
    bundleId: query.bundleId,
    pagePath: query.pagePath,
    applyCommits: state.applyCommits,
    review,
    forwardRevisionApplyCommits: state.forwardRevisionApplyCommits,
    forwardRevisionReview,
    manifestRevision: manifest.revision,
    currentManifestPage,
  });
  const selectedItems = index.outputs.filter((item) => {
    const sourceOrigin = item.origins.find((origin) => origin.kind === "source_apply");
    return (
      item.contentHash === query.selectedContentHash &&
      item.authority.origin === "source_apply" &&
      sourceOrigin?.newestAppliedAt === query.selectedAppliedAt &&
      sourceOrigin.verifiedApplyCount === query.selectedVerifiedApplyCount
    );
  });
  const currentItems = index.outputs.filter(
    (item) => item.contentHash === query.vaultObservedBeforeHash
  );
  if (selectedItems.length !== 1 || currentItems.length !== 1) return null;
  const selected = selectedItems[0];
  const historicalIdentity = selected.authority;
  if (
    historicalIdentity.origin !== "source_apply" ||
    historicalIdentity.outputPath !== query.pagePath ||
    historicalIdentity.contentHash !== query.selectedContentHash ||
    historicalIdentity.appliedAt !== query.selectedAppliedAt
  ) {
    return null;
  }

  const requestedKey = toWindowsPathKey(query.pagePath);
  const effectivePage = projectKnowledgeEffectiveManifestPages(manifest).find(
    (page) => page.windowsPathKey === requestedKey
  );
  const owners = manifest.entries.flatMap((entry) =>
    (entry.lastSuccessful?.generatedPages ?? [])
      .filter((page) => toWindowsPathKey(page.path) === requestedKey)
      .map((page) => ({ entry, page }))
  );
  if (owners.length !== 1) return null;
  const { entry: source, page: sourcePage } = owners[0];
  if (
    !effectivePage ||
    effectivePage.path !== query.pagePath ||
    effectivePage.sourceIds.length !== 1 ||
    effectivePage.sourceIds[0] !== source.sourceId ||
    sourcePage.path !== query.pagePath ||
    sourcePage.ownership !== "generated" ||
    sourcePage.contentHash !== effectivePage.sourceAppliedContentHash ||
    effectivePage.effectiveContentHash !== query.vaultObservedBeforeHash ||
    findKnowledgeSourceRetirement(manifest, source.sourceId)
  ) {
    return null;
  }
  let origin: ReturnType<typeof deriveKnowledgeSourceCompileAuthority>;
  try {
    origin = deriveKnowledgeSourceCompileAuthority(source);
  } catch {
    return null;
  }
  if (origin.operation !== "ingest") return null;
  const freshness = projectRuntimeSourceFreshnessAuthority(state, manifest, source);
  if (!freshness) return null;
  if (
    historicalIdentity.sourceId !== source.sourceId ||
    historicalIdentity.sourceContentHash !== freshness.sourceContentHash ||
    historicalIdentity.pipelineFingerprint !== freshness.pipelineFingerprint ||
    historicalIdentity.inputRevision >= freshness.inputRevision ||
    historicalIdentity.manifestAfterRevision >= manifest.revision ||
    historicalIdentity.manifestAfterDigest === createSourceManifestDigest(manifest)
  ) {
    return null;
  }

  const ledgerMatches = state.applyCommits.filter(
    (ledger) =>
      ledger.transactionId === historicalIdentity.transactionId &&
      ledger.bundleId === query.bundleId &&
      ledger.sourceId === source.sourceId &&
      ledger.sourceContentHash === historicalIdentity.sourceContentHash &&
      ledger.pipelineFingerprint === historicalIdentity.pipelineFingerprint &&
      ledger.inputRevision === historicalIdentity.inputRevision &&
      ledger.changeSetId === historicalIdentity.changeSetId &&
      ledger.changeSetDigest === historicalIdentity.changeSetDigest &&
      ledger.manifestIntentDigest === historicalIdentity.manifestIntentDigest &&
      ledger.manifestAfterRevision === historicalIdentity.manifestAfterRevision &&
      ledger.manifestAfterDigest === historicalIdentity.manifestAfterDigest &&
      ledger.recordedAt === historicalIdentity.appliedAt
  );
  if (ledgerMatches.length !== 1) return null;
  const historicalLedger = ledgerMatches[0];
  const acceptedMatches = review.records.filter(
    (record): record is AcceptedChangeSetReviewRecord =>
      record.outcome === "accepted" &&
      ledgerMatchesAcceptedRecord(historicalLedger, query.bundleId, record)
  );
  if (acceptedMatches.length !== 1) return null;
  const accepted = acceptedMatches[0];
  const changes = accepted.acceptedChangeSet.changes.filter(
    (change) => toWindowsPathKey(change.path) === requestedKey
  );
  const pages = accepted.manifestCommitIntent.generatedPages.filter(
    (page) => toWindowsPathKey(page.path) === requestedKey
  );
  const change = changes[0];
  const historicalPage = pages[0];
  if (
    changes.length !== 1 ||
    !change ||
    (change.operation !== "create" && change.operation !== "update") ||
    change.path !== query.pagePath ||
    change.afterHash !== query.selectedContentHash ||
    createFileContentHash(change.afterContent) !== query.selectedContentHash ||
    change.sourceRefs.length !== 1 ||
    change.sourceRefs[0] !== source.sourceId ||
    pages.length !== 1 ||
    !historicalPage ||
    historicalPage.path !== query.pagePath ||
    historicalPage.ownership !== "generated" ||
    historicalPage.contentHash !== query.selectedContentHash
  ) {
    return null;
  }

  const manifestDigest = createSourceManifestDigest(manifest);
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: query.bundleId,
    pagePath: query.pagePath,
    historical: {
      bundleId: query.bundleId,
      pagePath: query.pagePath,
      transactionId: historicalLedger.transactionId,
      sourceId: historicalLedger.sourceId,
      sourceContentHash: historicalLedger.sourceContentHash,
      pipelineFingerprint: historicalLedger.pipelineFingerprint,
      inputRevision: historicalLedger.inputRevision,
      changeSetId: historicalLedger.changeSetId,
      changeSetDigest: historicalLedger.changeSetDigest,
      manifestIntentDigest: historicalLedger.manifestIntentDigest,
      manifestAfterRevision: historicalLedger.manifestAfterRevision,
      manifestAfterDigest: historicalLedger.manifestAfterDigest,
      appliedAt: historicalLedger.recordedAt,
      selectedContentHash: query.selectedContentHash,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: [source.sourceId],
      primarySourceId: source.sourceId,
      sourceContentHash: freshness.sourceContentHash,
      pipelineFingerprint: freshness.pipelineFingerprint,
      inputRevision: freshness.inputRevision,
      manifestRevision: manifest.revision,
      manifestDigest,
      manifestBaseHash: sourcePage.contentHash,
      vaultObservedBeforeHash: query.vaultObservedBeforeHash,
    },
  });
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_AUTHORITY_VERSION,
    kind: "forward_revision_proposal_authority" as const,
    runtimeId: state.runtimeId,
    runtimeRevision: state.revision,
    query,
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: Object.freeze({
      proposalDigest: accepted.proposalDigest,
      acceptedDigest: accepted.acceptedDigest,
      acceptedRecordRevision: 1 as const,
      manifestCommitIntentDigest: accepted.manifestCommitIntentDigest,
      acceptedAt: accepted.acceptedAt,
      targetChange: Object.freeze({
        changeId: change.id,
        path: change.path,
        operation: change.operation,
        afterHash: change.afterHash,
        sourceRefs: Object.freeze([source.sourceId] as [string]),
      }),
      manifestPage: Object.freeze({
        path: historicalPage.path,
        ownership: "generated" as const,
        contentHash: historicalPage.contentHash,
      }),
    }),
  });
}

function projectForwardRevisionAcceptanceAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  source: SourceManifestEntry,
  manifestBaseHash: string,
  vaultObservedBeforeHash: string
): Readonly<KnowledgeForwardRevisionAcceptanceAuthority> | null {
  const freshness = projectRuntimeSourceFreshnessAuthority(state, manifest, source);
  if (!freshness) return null;
  const common = {
    runtimeId: freshness.runtimeId,
    runtimeRevision: freshness.runtimeRevision,
    runtimeDigest: freshness.runtimeDigest,
    bundleId: freshness.bundleId,
    sourceId: freshness.sourceId,
    sourceContentHash: freshness.sourceContentHash,
    pipelineFingerprint: freshness.pipelineFingerprint,
    inputRevision: freshness.inputRevision,
    manifestRevision: freshness.manifestRevision,
    manifestDigest: freshness.manifestDigest,
    committedManifestRevision: freshness.committedManifestRevision,
    completedAt: freshness.completedAt,
  } as const;
  return Object.freeze({
    runtimeId: freshness.runtimeId,
    runtimeRevision: freshness.runtimeRevision,
    runtimeDigest: freshness.runtimeDigest,
    manifestRevision: freshness.manifestRevision,
    manifestDigest: freshness.manifestDigest,
    manifestBaseHash,
    vaultObservedBeforeHash,
    currentSourceFreshness:
      freshness.kind === "applied"
        ? Object.freeze({
            ...common,
            kind: "applied" as const,
            transactionId: freshness.transactionId,
            changeSetId: freshness.changeSetId,
            changeSetDigest: freshness.changeSetDigest,
            manifestIntentDigest: freshness.manifestIntentDigest,
            committedManifestDigest: freshness.committedManifestDigest,
          })
        : Object.freeze({
            ...common,
            kind: "no_changes" as const,
            noChangesId: freshness.noChangesId,
            reason: freshness.reason,
            planDigest: freshness.planDigest,
            jobId: freshness.jobId,
            attempt: freshness.attempt,
          }),
  });
}

function projectForwardRevisionValidationAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  query: Readonly<KnowledgeForwardRevisionValidationAuthorityQueryV1>
): Readonly<KnowledgeForwardRevisionValidationAuthorityV1> | null {
  if (
    query.runtimeId !== state.runtimeId ||
    state.activeTransaction !== null ||
    state.activeForwardRevisionApply !== null
  ) {
    return null;
  }
  const rawForward = findForwardRevisionReviewSlot(state, query.bundleId);
  if (rawForward === null) return null;
  const forward = snapshotKnowledgeForwardRevisionReviewSnapshotV2(rawForward);
  const pending = forward.records.filter(
    (record) =>
      record.state === "pending" &&
      record.proposal.proposalId === query.proposalId &&
      record.proposalDigest === query.proposalDigest
  );
  if (pending.length !== 1) return null;
  const entry = pending[0];
  if (entry.state !== "pending") return null;
  const proposal = entry.proposal;
  const request = proposal.request;
  const intent = request.intent;
  if (
    request.runtimeId !== query.runtimeId ||
    request.bundleId !== query.bundleId ||
    request.pagePath !== query.pagePath ||
    request.requestId !== query.requestId ||
    proposal.requestDigest !== query.requestDigest ||
    intent.intentId !== query.intentId ||
    request.intentDigest !== query.intentDigest ||
    proposal.recordRevision !== query.expectedRecordRevision
  ) {
    return null;
  }
  try {
    assertForwardRevisionPublicationAuthority(state, {
      intent,
      intentDigest: request.intentDigest,
      historicalReviewAuthority: request.historicalReviewAuthority,
      selectedContent: request.selectedContent,
      selectedContentHash: request.selectedContentHash,
      vaultObservedBeforeHash: intent.current.vaultObservedBeforeHash,
    });
  } catch {
    return null;
  }

  const manifestRaw = findBundleSlot(state, "manifests", query.bundleId);
  const reviewRaw = findBundleSlot(state, "reviews", query.bundleId);
  if (manifestRaw === null || reviewRaw === null) return null;
  const manifest = thisOrNullManifest(manifestRaw);
  const review = thisOrNullReview(reviewRaw);
  if (!manifest || !review) return null;
  const current = intent.current;
  if (
    manifest.revision !== current.manifestRevision ||
    createSourceManifestDigest(manifest) !== current.manifestDigest
  ) {
    return null;
  }
  const requestedKey = toWindowsPathKey(query.pagePath);
  const owners = manifest.entries.flatMap((candidate) =>
    (candidate.lastSuccessful?.generatedPages ?? [])
      .filter((page) => toWindowsPathKey(page.path) === requestedKey)
      .map((page) => ({ source: candidate, page }))
  );
  if (owners.length !== 1) return null;
  const { source, page } = owners[0];
  const effectivePage = projectKnowledgeEffectiveManifestPages(manifest).find(
    (candidate) => candidate.windowsPathKey === requestedKey
  );
  if (
    !effectivePage ||
    effectivePage.path !== query.pagePath ||
    effectivePage.sourceIds.length !== 1 ||
    effectivePage.sourceIds[0] !== source.sourceId ||
    effectivePage.sourceAppliedContentHash !== current.manifestBaseHash ||
    effectivePage.effectiveContentHash !== current.vaultObservedBeforeHash ||
    source.sourceId !== current.primarySourceId ||
    current.sourceIds.length !== 1 ||
    current.sourceIds[0] !== source.sourceId ||
    page.path !== query.pagePath ||
    page.ownership !== "generated" ||
    page.contentHash !== current.manifestBaseHash ||
    findKnowledgeSourceRetirement(manifest, source.sourceId)
  ) {
    return null;
  }
  let origin: ReturnType<typeof deriveKnowledgeSourceCompileAuthority>;
  try {
    origin = deriveKnowledgeSourceCompileAuthority(source);
  } catch {
    return null;
  }
  if (origin.operation !== "ingest") return null;
  const acceptanceAuthority = projectForwardRevisionAcceptanceAuthority(
    state,
    manifest,
    source,
    current.manifestBaseHash,
    current.vaultObservedBeforeHash
  );
  if (
    !acceptanceAuthority ||
    acceptanceAuthority.currentSourceFreshness.sourceContentHash !== current.sourceContentHash ||
    acceptanceAuthority.currentSourceFreshness.pipelineFingerprint !==
      current.pipelineFingerprint ||
    acceptanceAuthority.currentSourceFreshness.inputRevision !== current.inputRevision
  ) {
    return null;
  }

  const historical = intent.historical;
  const ledgers = state.applyCommits.filter(
    (record) =>
      record.transactionId === historical.transactionId &&
      record.bundleId === query.bundleId &&
      record.sourceId === source.sourceId &&
      record.sourceContentHash === historical.sourceContentHash &&
      record.pipelineFingerprint === historical.pipelineFingerprint &&
      record.inputRevision === historical.inputRevision &&
      record.changeSetId === historical.changeSetId &&
      record.changeSetDigest === historical.changeSetDigest &&
      record.manifestIntentDigest === historical.manifestIntentDigest &&
      record.manifestAfterRevision === historical.manifestAfterRevision &&
      record.manifestAfterDigest === historical.manifestAfterDigest &&
      record.recordedAt === historical.appliedAt
  );
  if (ledgers.length !== 1) return null;
  const accepted = review.records.filter(
    (record): record is AcceptedChangeSetReviewRecord =>
      record.outcome === "accepted" &&
      ledgerMatchesAcceptedRecord(ledgers[0], query.bundleId, record)
  );
  if (accepted.length !== 1) return null;
  const record = accepted[0];
  const historicalAuthority = request.historicalReviewAuthority;
  const changes = record.acceptedChangeSet.changes.filter(
    (change) => toWindowsPathKey(change.path) === requestedKey
  );
  const pages = record.manifestCommitIntent.generatedPages.filter(
    (candidate) => toWindowsPathKey(candidate.path) === requestedKey
  );
  const change = changes[0];
  const historicalPage = pages[0];
  if (
    record.acceptedDigest !== historicalAuthority.acceptedDigest ||
    record.proposalDigest !== historicalAuthority.proposalDigest ||
    record.manifestCommitIntentDigest !== historicalAuthority.manifestCommitIntentDigest ||
    record.acceptedAt !== historicalAuthority.acceptedAt ||
    changes.length !== 1 ||
    !change ||
    (change.operation !== "create" && change.operation !== "update") ||
    change.id !== historicalAuthority.targetChange.changeId ||
    change.path !== query.pagePath ||
    change.afterContent !== request.selectedContent ||
    change.afterHash !== request.selectedContentHash ||
    createFileContentHash(change.afterContent) !== change.afterHash ||
    change.sourceRefs.length !== 1 ||
    change.sourceRefs[0] !== source.sourceId ||
    !exactJsonValuesEqual(change.sourceRefs, historicalAuthority.targetChange.sourceRefs) ||
    record.acceptedChangeSet.sourceRefs.length !== 1 ||
    record.acceptedChangeSet.sourceRefs[0] !== source.sourceId ||
    record.acceptedChangeSet.citations.some(
      (citation) => citation.locator.sourceId !== source.sourceId
    ) ||
    pages.length !== 1 ||
    !historicalPage ||
    !exactJsonValuesEqual(historicalPage, historicalAuthority.manifestPage)
  ) {
    return null;
  }
  try {
    return createKnowledgeForwardRevisionValidationAuthority({
      query,
      proposal,
      proposalDigest: entry.proposalDigest,
      publishedRuntimeRevision: entry.publishedRuntimeRevision,
      proposalStoreRevision: entry.proposalStoreRevision,
      forwardReviewStoreRevision: forward.revision,
      acceptanceAuthority,
      historicalAcceptedDigest: record.acceptedDigest,
      historicalSourceRefs: record.acceptedChangeSet.sourceRefs,
      historicalCitations: record.acceptedChangeSet.citations,
    });
  } catch {
    return null;
  }
}

function assertForwardRevisionDecisionValidationProjection(
  projection: Readonly<KnowledgeForwardRevisionValidationCapabilityProjectionV1>,
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  proposalDigest: string,
  command: Readonly<KnowledgeForwardRevisionReviewCommandV1>,
  current: Readonly<KnowledgeForwardRevisionValidationAuthorityV1>
): void {
  try {
    if (
      projection.proposalDigest !== proposalDigest ||
      !exactJsonValuesEqual(projection.proposal, proposal) ||
      projection.commandDigest !== createKnowledgeForwardRevisionReviewCommandDigest(command) ||
      !exactJsonValuesEqual(projection.command, command) ||
      projection.receiptDigest !== projection.receipt.receiptDigest ||
      current.runtimeRevision < projection.receipt.acceptanceAuthority.runtimeRevision ||
      (current.runtimeRevision === projection.receipt.acceptanceAuthority.runtimeRevision &&
        current.runtimeDigest !== projection.receipt.acceptanceAuthority.runtimeDigest)
    ) {
      throw new TypeError();
    }
    createKnowledgeForwardRevisionAcceptedDecisionRecord({
      proposal,
      proposalDigest,
      command,
      afterContent: projection.afterContent,
      acceptanceAuthority: current.acceptanceAuthority,
      validationReceipt: projection.receipt,
      validationReceiptDigest: projection.receiptDigest,
      acceptedAt: Math.max(
        proposal.recordedAt,
        current.acceptanceAuthority.currentSourceFreshness.completedAt,
        projection.receipt.validatedAt
      ),
    });
  } catch {
    throw createForwardRevisionDecisionPortError("authority_unavailable");
  }
}

function createForwardRevisionDecisionResult(
  outcome: KnowledgeForwardRevisionDecisionResult["outcome"],
  decision: Readonly<KnowledgeForwardRevisionTerminalDecisionRecordV1>,
  runtimeRevision: number,
  decisionStoreRevision: number
): Readonly<KnowledgeForwardRevisionDecisionResult> {
  return Object.freeze({
    kind: decision.state,
    outcome,
    decision,
    decisionDigest: createKnowledgeForwardRevisionTerminalDecisionRecordDigest(decision),
    runtimeRevision,
    decisionStoreRevision,
  });
}

function projectForwardRevisionDecisionReplay(
  entry: Readonly<KnowledgeForwardRevisionTerminalReviewEntryV2>,
  command: Readonly<KnowledgeForwardRevisionReviewCommandV1>
): Readonly<KnowledgeForwardRevisionDecisionResult> | null {
  try {
    const proposal = entry.decision.proposal;
    snapshotKnowledgeForwardRevisionReviewCommandForProposal(
      command,
      proposal,
      entry.decision.proposalDigest
    );
    if (entry.state === "rejected") {
      if (command.action !== "reject") return null;
    } else {
      if (command.action === "reject") return null;
      const expectedContent =
        command.action === "accept_exact" ? proposal.request.selectedContent : command.afterContent;
      if (
        entry.decision.afterContent !== expectedContent ||
        entry.decision.validationReceipt.commandId !== command.commandId ||
        entry.decision.validationReceipt.commandDigest !==
          createKnowledgeForwardRevisionReviewCommandDigest(command)
      ) {
        return null;
      }
    }
    return createForwardRevisionDecisionResult(
      "already_decided",
      entry.decision,
      entry.decidedRuntimeRevision,
      entry.decisionStoreRevision
    );
  } catch {
    return null;
  }
}

function thisOrNullManifest(value: unknown): SourceManifest | null {
  const parsed = parseSourceManifest(value);
  if (!parsed.ok || !validateSourceManifest(parsed.value).valid) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return parsed.value;
}

function thisOrNullReview(value: unknown): ChangeSetReviewSnapshot | null {
  const parsed = parseChangeSetReviewSnapshot(value);
  if (!parsed.ok || !validateChangeSetReviewSnapshot(parsed.value).valid) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return parsed.value;
}

function assertForwardRevisionPublicationAuthority(
  state: KnowledgeRuntimeStoreSnapshot,
  evidence: Readonly<CapturedForwardRevisionPublicationEvidence>
): Readonly<ForwardRevisionPublicationTimeFloors> {
  const { intent } = evidence;
  function conflict(reason: KnowledgeForwardRevisionPublicationConflictReason): never {
    throw new KnowledgeForwardRevisionPublicationConflictError(intent.bundleId, reason);
  }
  if (state.activeTransaction !== null || state.activeForwardRevisionApply !== null) {
    conflict("transaction_busy");
  }

  const manifestRaw = findBundleSlot(state, "manifests", intent.bundleId);
  if (manifestRaw === null) conflict("current_authority_changed");
  const manifest = (() => {
    try {
      const parsed = parseSourceManifest(manifestRaw);
      if (!parsed.ok) conflict("current_authority_changed");
      if (!validateSourceManifest(parsed.value).valid) conflict("current_authority_changed");
      return parsed.value;
    } catch {
      return conflict("current_authority_changed");
    }
  })();
  if (
    manifest.revision !== intent.current.manifestRevision ||
    createSourceManifestDigest(manifest) !== intent.current.manifestDigest ||
    evidence.vaultObservedBeforeHash !== intent.current.vaultObservedBeforeHash
  ) {
    conflict("current_authority_changed");
  }
  const source = manifest.entries.find(
    (entry) => entry.sourceId === intent.current.primarySourceId
  );
  if (!source || findKnowledgeSourceRetirement(manifest, source.sourceId)) {
    conflict("current_authority_changed");
  }
  const sourceOrigin = (() => {
    try {
      return deriveKnowledgeSourceCompileAuthority(source);
    } catch {
      return conflict("current_authority_changed");
    }
  })();
  if (sourceOrigin.operation !== "ingest") conflict("current_authority_changed");
  const freshness = projectRuntimeSourceFreshnessAuthority(state, manifest, source);
  if (
    !freshness ||
    freshness.sourceContentHash !== intent.current.sourceContentHash ||
    freshness.pipelineFingerprint !== intent.current.pipelineFingerprint ||
    freshness.inputRevision !== intent.current.inputRevision
  ) {
    conflict("current_authority_changed");
  }
  const sourceCommit = parseKnowledgeRuntimeSourceCommitExtension(
    source.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY]
  );
  if (!sourceCommit.ok) conflict("current_authority_changed");
  const sourcePages = source.lastSuccessful?.generatedPages.filter(
    (page) => toWindowsPathKey(page.path) === toWindowsPathKey(intent.pagePath)
  );
  const allOwners = manifest.entries.flatMap((entry) =>
    (entry.lastSuccessful?.generatedPages ?? [])
      .filter((page) => toWindowsPathKey(page.path) === toWindowsPathKey(intent.pagePath))
      .map((page) => ({ sourceId: entry.sourceId, page }))
  );
  const effectivePage = projectKnowledgeEffectiveManifestPages(manifest).find(
    (page) => toWindowsPathKey(page.path) === toWindowsPathKey(intent.pagePath)
  );
  if (
    !effectivePage ||
    effectivePage.path !== intent.pagePath ||
    effectivePage.sourceAppliedContentHash !== intent.current.manifestBaseHash ||
    effectivePage.effectiveContentHash !== intent.current.vaultObservedBeforeHash ||
    effectivePage.sourceIds.length !== 1 ||
    effectivePage.sourceIds[0] !== source.sourceId ||
    !source.lastSuccessful ||
    sourcePages?.length !== 1 ||
    sourcePages[0].path !== intent.pagePath ||
    sourcePages[0].ownership !== "generated" ||
    sourcePages[0].contentHash !== intent.current.manifestBaseHash ||
    allOwners.length !== 1 ||
    allOwners[0].sourceId !== source.sourceId
  ) {
    conflict("current_authority_changed");
  }
  const currentLedger = findLatestSourceApplyLedger(
    state.applyCommits,
    intent.bundleId,
    source.sourceId
  );
  if (
    !currentLedger ||
    currentLedger.transactionId !== sourceCommit.value.transactionId ||
    !ledgerMatchesCurrentManifestEntry(currentLedger, intent.bundleId, source)
  ) {
    conflict("current_authority_changed");
  }

  const queueRaw = findBundleSlot(state, "queues", intent.bundleId);
  if (queueRaw !== null) {
    const parsed = parseIngestQueueSnapshot(queueRaw);
    if (!parsed.ok) conflict("recovery_required");
    if (!validateIngestQueueSnapshot(parsed.value).valid) conflict("recovery_required");
    const queue = parsed.value;
    if (
      queue.applyClaim !== undefined ||
      queue.applyCommit !== undefined ||
      (queue.control.status === "paused" &&
        (queue.control.reason === "startup_recovery" ||
          queue.control.reason === "recovery_required" ||
          queue.control.reason === "commit_pending_ack")) ||
      queue.jobs.some((job) => job.status === "processing" && job.stage === "applying") ||
      queue.jobs.some((job) => job.status === "failed" && job.stage === "applying")
    ) {
      conflict("recovery_required");
    }
    if (
      queue.reruns.some((rerun) => rerun.sourceId === source.sourceId) ||
      queue.jobs.some(
        (job) =>
          job.sourceId === source.sourceId &&
          job.status !== "failed" &&
          job.status !== "completed" &&
          job.status !== "cancelled"
      )
    ) {
      conflict("source_busy");
    }
  }
  const inputSource = state.inputRevisions
    .find((bundle) => bundle.bundleId === intent.bundleId)
    ?.sources.find((candidate) => candidate.sourceId === source.sourceId);
  if (
    inputSource?.observations.some(
      (observation) => observation.status === "allocated" || observation.status === "bound"
    )
  ) {
    conflict("source_busy");
  }

  const ledger = state.applyCommits.find(
    (record) => record.transactionId === intent.historical.transactionId
  );
  if (!ledger) conflict("historical_authority_changed");
  if (
    ledger.bundleId !== intent.bundleId ||
    ledger.sourceId !== intent.historical.sourceId ||
    ledger.sourceContentHash !== intent.historical.sourceContentHash ||
    ledger.pipelineFingerprint !== intent.historical.pipelineFingerprint ||
    ledger.inputRevision !== intent.historical.inputRevision ||
    ledger.changeSetId !== intent.historical.changeSetId ||
    ledger.changeSetDigest !== intent.historical.changeSetDigest ||
    ledger.manifestIntentDigest !== intent.historical.manifestIntentDigest ||
    ledger.manifestAfterRevision !== intent.historical.manifestAfterRevision ||
    ledger.manifestAfterDigest !== intent.historical.manifestAfterDigest ||
    ledger.recordedAt !== intent.historical.appliedAt
  ) {
    conflict("historical_authority_changed");
  }
  const reviewRaw = findBundleSlot(state, "reviews", intent.bundleId);
  if (reviewRaw === null) conflict("historical_authority_changed");
  const reviewResult = parseChangeSetReviewSnapshot(reviewRaw);
  if (!reviewResult.ok) conflict("historical_authority_changed");
  if (!validateChangeSetReviewSnapshot(reviewResult.value).valid) {
    conflict("historical_authority_changed");
  }
  const records = reviewResult.value.records.filter(
    (record): record is AcceptedChangeSetReviewRecord =>
      record.outcome === "accepted" && ledgerMatchesAcceptedRecord(ledger, intent.bundleId, record)
  );
  if (records.length !== 1) conflict("historical_authority_changed");
  const accepted = records[0];
  const authority = evidence.historicalReviewAuthority;
  const changes = accepted.acceptedChangeSet.changes.filter(
    (change) => toWindowsPathKey(change.path) === toWindowsPathKey(intent.pagePath)
  );
  const pages = accepted.manifestCommitIntent.generatedPages.filter(
    (page) => toWindowsPathKey(page.path) === toWindowsPathKey(intent.pagePath)
  );
  const change = changes[0];
  const page = pages[0];
  if (
    accepted.proposalDigest !== authority.proposalDigest ||
    accepted.acceptedDigest !== authority.acceptedDigest ||
    accepted.recordRevision !== authority.acceptedRecordRevision ||
    accepted.manifestCommitIntentDigest !== authority.manifestCommitIntentDigest ||
    accepted.acceptedAt !== authority.acceptedAt ||
    changes.length !== 1 ||
    pages.length !== 1 ||
    !change ||
    (change.operation !== "create" && change.operation !== "update") ||
    change.id !== authority.targetChange.changeId ||
    change.path !== intent.pagePath ||
    change.operation !== authority.targetChange.operation ||
    change.afterContent !== evidence.selectedContent ||
    change.afterHash !== evidence.selectedContentHash ||
    createFileContentHash(change.afterContent) !== change.afterHash ||
    change.sourceRefs.length !== 1 ||
    change.sourceRefs[0] !== source.sourceId ||
    !exactJsonValuesEqual(change.sourceRefs, authority.targetChange.sourceRefs) ||
    !page ||
    page.path !== intent.pagePath ||
    page.ownership !== "generated" ||
    page.contentHash !== evidence.selectedContentHash ||
    !exactJsonValuesEqual(page, authority.manifestPage)
  ) {
    conflict("historical_authority_changed");
  }
  return Object.freeze({
    sourceFreshnessCompletedAt: freshness.completedAt,
    lineageAppliedAtFloor:
      effectivePage.origin.kind === "forward_revision" ? effectivePage.origin.overlay.appliedAt : 0,
  });
}

function groupForwardRevisionApplyCommitsByBundle(
  records: readonly Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[]
): ReadonlyMap<string, readonly Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[]> {
  const grouped = new Map<string, Readonly<KnowledgeForwardRevisionApplyLedgerRecord>[]>();
  for (const record of records) {
    const existing = grouped.get(record.bundleId);
    if (existing) existing.push(record);
    else grouped.set(record.bundleId, [record]);
  }
  return grouped;
}

function findStudioChangedBundleIds(
  current: KnowledgeRuntimeStoreSnapshot,
  next: KnowledgeRuntimeStoreSnapshot
): string[] {
  const bundleIds = new Set<string>();
  const currentForwardCommits = groupForwardRevisionApplyCommitsByBundle(
    current.forwardRevisionApplyCommits
  );
  const nextForwardCommits = groupForwardRevisionApplyCommitsByBundle(
    next.forwardRevisionApplyCommits
  );
  for (const collection of [
    "queues",
    "reviews",
    "forwardRevisionReviews",
    "manifests",
  ] as const satisfies readonly StudioHintBundleCollection[]) {
    for (const slot of current[collection]) bundleIds.add(slot.bundleId);
    for (const slot of next[collection]) bundleIds.add(slot.bundleId);
  }
  if (current.activeForwardRevisionApply !== null) {
    bundleIds.add(current.activeForwardRevisionApply.bundleId);
  }
  if (next.activeForwardRevisionApply !== null) {
    bundleIds.add(next.activeForwardRevisionApply.bundleId);
  }
  for (const bundleId of currentForwardCommits.keys()) bundleIds.add(bundleId);
  for (const bundleId of nextForwardCommits.keys()) bundleIds.add(bundleId);
  for (const record of current.forwardRevisionAbandonments) {
    bundleIds.add(record.acceptedIdentity.resource.bundleId);
  }
  for (const record of next.forwardRevisionAbandonments) {
    bundleIds.add(record.acceptedIdentity.resource.bundleId);
  }
  for (const record of current.forwardRevisionRecoveryTerminals) {
    bundleIds.add(record.acceptedIdentity.resource.bundleId);
  }
  for (const record of next.forwardRevisionRecoveryTerminals) {
    bundleIds.add(record.acceptedIdentity.resource.bundleId);
  }
  return [...bundleIds]
    .filter((bundleId) => {
      const currentActiveForwardApply =
        current.activeForwardRevisionApply?.bundleId === bundleId
          ? current.activeForwardRevisionApply
          : null;
      const nextActiveForwardApply =
        next.activeForwardRevisionApply?.bundleId === bundleId
          ? next.activeForwardRevisionApply
          : null;
      return (
        !exactJsonValuesEqual(
          findBundleSlot(current, "queues", bundleId),
          findBundleSlot(next, "queues", bundleId)
        ) ||
        !exactJsonValuesEqual(
          findBundleSlot(current, "reviews", bundleId),
          findBundleSlot(next, "reviews", bundleId)
        ) ||
        !exactJsonValuesEqual(
          findBundleSlot(current, "forwardRevisionReviews", bundleId),
          findBundleSlot(next, "forwardRevisionReviews", bundleId)
        ) ||
        !exactJsonValuesEqual(
          findBundleSlot(current, "manifests", bundleId),
          findBundleSlot(next, "manifests", bundleId)
        ) ||
        !exactJsonValuesEqual(currentActiveForwardApply, nextActiveForwardApply) ||
        !exactJsonValuesEqual(
          currentForwardCommits.get(bundleId) ?? [],
          nextForwardCommits.get(bundleId) ?? []
        ) ||
        !exactJsonValuesEqual(
          current.forwardRevisionAbandonments.filter(
            (record) => record.acceptedIdentity.resource.bundleId === bundleId
          ),
          next.forwardRevisionAbandonments.filter(
            (record) => record.acceptedIdentity.resource.bundleId === bundleId
          )
        ) ||
        !exactJsonValuesEqual(
          current.forwardRevisionRecoveryTerminals.filter(
            (record) => record.acceptedIdentity.resource.bundleId === bundleId
          ),
          next.forwardRevisionRecoveryTerminals.filter(
            (record) => record.acceptedIdentity.resource.bundleId === bundleId
          )
        )
      );
    })
    .sort(compareIdentifiers);
}

function replaceInputRevisionSource(
  bundles: readonly KnowledgeRuntimeInputRevisionBundle[],
  bundleId: string,
  source: KnowledgeRuntimeInputRevisionRecord
): KnowledgeRuntimeInputRevisionBundle[] {
  const bundle = bundles.find((candidate) => candidate.bundleId === bundleId);
  const nextBundle: KnowledgeRuntimeInputRevisionBundle = {
    bundleId,
    sources: (bundle
      ? bundle.sources.some((candidate) => candidate.sourceId === source.sourceId)
        ? bundle.sources.map((candidate) =>
            candidate.sourceId === source.sourceId ? source : candidate
          )
        : [...bundle.sources, source]
      : [source]
    ).sort((left, right) => compareIdentifiers(left.sourceId, right.sourceId)),
  };
  return (
    bundle
      ? bundles.map((candidate) => (candidate.bundleId === bundleId ? nextBundle : candidate))
      : [...bundles, nextBundle]
  ).sort((left, right) => compareIdentifiers(left.bundleId, right.bundleId));
}

function createBoundSourceInputObservation(
  bundleId: string,
  sourceId: string,
  observation: Extract<KnowledgeRuntimeSourceObservationRecord, { status: "bound" | "consumed" }>
): BoundSourceInputObservation {
  return {
    bundleId,
    sourceId,
    captureId: observation.captureId,
    inputRevision: observation.inputRevision,
    observationToken: observation.observationToken,
    sourceContentHash: observation.sourceContentHash,
    pipelineFingerprint: observation.pipelineFingerprint,
  };
}

function throwIfRuntimeExecutionProofAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("The knowledge Runtime execution proof was aborted");
  error.name = "AbortError";
  throw error;
}

function findBundleSlot(
  state: KnowledgeRuntimeStoreSnapshot,
  collection: StudioHintBundleCollection,
  bundleId: string
): object | null {
  return state[collection].find((slot) => slot.bundleId === bundleId)?.value ?? null;
}

function nextStoreRevision(state: KnowledgeRuntimeStoreSnapshot): number {
  if (state.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return state.revision + 1;
}

function createSourceRetirementExpectedToken(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  source: SourceManifestEntry
): string {
  return sha256(
    `knowledge-source-retirement-request-v1\n${canonicalizeJson({
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      bundleId: manifest.bundleId,
      manifestRevision: manifest.revision,
      manifestDigest: createSourceManifestDigest(manifest),
      source,
    } as unknown as JsonValue)}`
  );
}

function acceptedReviewIsTerminalForRetirement(
  state: KnowledgeRuntimeStoreSnapshot,
  bundleId: string,
  queue: IngestQueueSnapshot,
  record: AcceptedChangeSetReviewRecord
): boolean {
  const matchingLedgers = state.applyCommits.filter((ledger) =>
    ledgerMatchesAcceptedRecord(ledger, bundleId, record)
  );
  if (matchingLedgers.length === 1) return true;
  const abandonments = queue.applyAbandonments.filter((abandonment) =>
    abandonmentMatchesAcceptedRecord(abandonment, record)
  );
  return matchingLedgers.length === 0 && abandonments.length === 1;
}

function collectSourceRetirementBlockers(
  state: KnowledgeRuntimeStoreSnapshot,
  manifest: SourceManifest,
  queue: IngestQueueSnapshot,
  review: ChangeSetReviewSnapshot
): KnowledgeSourceRetirementBlocker[] {
  const blockers = new Set<KnowledgeSourceRetirementBlocker>();
  if (state.activeTransaction !== null || state.activeForwardRevisionApply !== null) {
    blockers.add("active_transaction");
  }
  if (
    queue.jobs.some(
      (job) =>
        !["failed", "completed", "cancelled"].includes(job.status) ||
        (job.status === "failed" && job.stage === "applying")
    )
  ) {
    blockers.add("bundle_work_active");
  }
  if (queue.reruns.length > 0) blockers.add("bundle_rerun_pending");
  if (
    queue.pendingReviews.length > 0 ||
    review.records.some((record) => record.outcome === "pending")
  ) {
    blockers.add("bundle_review_pending");
  }
  if (queue.applyClaim !== undefined || queue.applyCommit !== undefined) {
    blockers.add("bundle_apply_pending");
  }
  if (
    review.records.some(
      (record) =>
        record.outcome === "accepted" &&
        !acceptedReviewIsTerminalForRetirement(state, manifest.bundleId, queue, record)
    )
  ) {
    blockers.add("bundle_apply_recovery_required");
  }
  if (state.revision === Number.MAX_SAFE_INTEGER || manifest.revision === Number.MAX_SAFE_INTEGER) {
    blockers.add("revision_overflow");
  }
  const order: readonly KnowledgeSourceRetirementBlocker[] = [
    "active_transaction",
    "forward_revision_overlay_active",
    "bundle_work_active",
    "bundle_rerun_pending",
    "bundle_review_pending",
    "bundle_apply_pending",
    "bundle_apply_recovery_required",
    "source_observation_pending",
    "revision_overflow",
  ];
  return order.filter((blocker) => blockers.has(blocker));
}

function listManifestForwardRevisionOverlays(
  manifest: SourceManifest
): readonly Readonly<KnowledgeForwardRevisionOverlayEntry>[] {
  const raw = manifest.extensions?.[KNOWLEDGE_FORWARD_REVISION_OVERLAYS_EXTENSION_KEY];
  if (raw === undefined) return Object.freeze([]);
  const parsed = parseKnowledgeForwardRevisionOverlayExtension(raw);
  if (!parsed.ok) throw new KnowledgeRuntimeStoreCorruptError();
  return parsed.value.entries;
}

function sourceOwnsForwardRevisionOverlay(manifest: SourceManifest, sourceId: string): boolean {
  return listManifestForwardRevisionOverlays(manifest).some(
    (overlay) => overlay.sourceId === sourceId
  );
}

function listSourceApplySupersededForwardRevisionOverlays(
  state: KnowledgeRuntimeStoreSnapshot,
  transaction: Pick<ChangeSetTransactionJournal, "bundleId" | "jobClaim" | "changeSet">
): readonly Readonly<KnowledgeForwardRevisionOverlayEntry>[] {
  const changesByWindowsKey = new Map(
    transaction.changeSet.changes.map((change) => [toWindowsPathKey(change.path), change] as const)
  );
  const superseded: Readonly<KnowledgeForwardRevisionOverlayEntry>[] = [];
  for (const slot of state.manifests) {
    const parsed = parseSourceManifest(slot.value);
    if (!parsed.ok || !validateSourceManifest(parsed.value).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    for (const overlay of listManifestForwardRevisionOverlays(parsed.value)) {
      const change = changesByWindowsKey.get(overlay.windowsPathKey);
      if (change === undefined) continue;
      if (
        slot.bundleId !== transaction.bundleId ||
        overlay.bundleId !== transaction.bundleId ||
        overlay.sourceId !== transaction.jobClaim.sourceId ||
        overlay.pagePath !== change.path ||
        !change.sourceRefs.includes(transaction.jobClaim.sourceId) ||
        (change.operation !== "update" && change.operation !== "delete") ||
        change.beforeHash !== overlay.effectiveContentHash
      ) {
        throw new TransactionStorageAuthorityError(
          "The Source Apply does not exactly supersede the protected forward revision head"
        );
      }
      superseded.push(overlay);
    }
  }
  return Object.freeze(superseded);
}

function getSourceApplyForwardLineageTimestampFloor(
  overlays: readonly Readonly<KnowledgeForwardRevisionOverlayEntry>[]
): number {
  return overlays.reduce((floor, overlay) => Math.max(floor, overlay.appliedAt), 0);
}

function createRetiredSourceQueueProjection(
  queue: IngestQueueSnapshot | null,
  sourceId: string,
  linkedJobIds: ReadonlySet<string>
): JsonValue {
  return {
    jobs: (queue?.jobs ?? []).filter((job) => job.sourceId === sourceId),
    reruns: (queue?.reruns ?? []).filter((rerun) => rerun.sourceId === sourceId),
    sourceHighWatermarks: (queue?.sourceHighWatermarks ?? []).filter(
      (watermark) => watermark.sourceId === sourceId
    ),
    pendingReviews: (queue?.pendingReviews ?? []).filter((record) =>
      linkedJobIds.has(record.jobId)
    ),
    reviewRejections: (queue?.reviewRejections ?? []).filter((record) =>
      linkedJobIds.has(record.jobId)
    ),
    applyAbandonments: (queue?.applyAbandonments ?? []).filter(
      (record) => record.sourceId === sourceId
    ),
    applyClaim: queue?.applyClaim?.sourceId === sourceId ? queue.applyClaim : null,
    applyCommit: queue?.applyCommit?.sourceId === sourceId ? queue.applyCommit : null,
  } as unknown as JsonValue;
}

function assertRetiredQueueHistoryPreserved(
  bundleId: string,
  current: IngestQueueSnapshot | null,
  candidate: IngestQueueSnapshot,
  retiredSourceIds: ReadonlySet<string>
): void {
  for (const sourceId of [...retiredSourceIds].sort(compareIdentifiers)) {
    const linkedJobIds = new Set([
      ...(current?.jobs ?? []).filter((job) => job.sourceId === sourceId).map((job) => job.id),
      ...candidate.jobs.filter((job) => job.sourceId === sourceId).map((job) => job.id),
    ]);
    if (
      !exactJsonValuesEqual(
        createRetiredSourceQueueProjection(current, sourceId, linkedJobIds),
        createRetiredSourceQueueProjection(candidate, sourceId, linkedJobIds)
      )
    ) {
      throw new KnowledgeRuntimeSourceRetiredError(bundleId, sourceId);
    }
  }
}

function assertRetiredReviewHistoryPreserved(
  bundleId: string,
  current: ChangeSetReviewSnapshot | null,
  candidate: ChangeSetReviewSnapshot,
  retiredSourceIds: ReadonlySet<string>
): void {
  for (const sourceId of [...retiredSourceIds].sort(compareIdentifiers)) {
    const before = (current?.records ?? []).filter(
      (record) => record.jobClaim.sourceId === sourceId
    );
    const after = candidate.records.filter((record) => record.jobClaim.sourceId === sourceId);
    if (!exactJsonValuesEqual(before, after)) {
      throw new KnowledgeRuntimeSourceRetiredError(bundleId, sourceId);
    }
  }
}

function terminalizeSourceRetirementObservations(
  inputRevisions: readonly KnowledgeRuntimeInputRevisionBundle[],
  record: KnowledgeSourceRetirementRecord
): KnowledgeRuntimeInputRevisionBundle[] {
  const bundle = inputRevisions.find((candidate) => candidate.bundleId === record.bundleId);
  const source = bundle?.sources.find((candidate) => candidate.sourceId === record.source.sourceId);
  if (!source) return cloneJson([...inputRevisions]);
  const observations: KnowledgeRuntimeSourceObservationRecord[] = source.observations.map(
    (observation) => {
      if (observation.status !== "allocated" && observation.status !== "bound") {
        return observation;
      }
      return {
        observationToken: observation.observationToken,
        captureId: observation.captureId,
        inputRevision: observation.inputRevision,
        allocatedAt: observation.allocatedAt,
        status: "retired" as const,
        ...(observation.status === "bound"
          ? {
              sourceContentHash: observation.sourceContentHash,
              pipelineFingerprint: observation.pipelineFingerprint,
              boundAt: observation.boundAt,
            }
          : {}),
        settledAt: Math.max(
          record.retiredAt,
          observation.allocatedAt,
          observation.status === "bound" ? observation.boundAt : 0
        ),
        retirementId: record.retirementId,
      };
    }
  );
  return replaceInputRevisionSource(inputRevisions, record.bundleId, {
    ...source,
    observations,
  });
}

function createSourceRetirementReceipt(
  record: KnowledgeSourceRetirementRecord,
  runtimeRevision: number,
  outcome: KnowledgeSourceRetirementReceipt["outcome"]
): KnowledgeSourceRetirementReceipt {
  return Object.freeze({
    outcome,
    bundleId: record.bundleId,
    sourceId: record.source.sourceId,
    sourcePath: record.source.sourcePath,
    custody: record.source.custody,
    retirementId: record.retirementId,
    retiredAt: record.retiredAt,
    manifestRevision: record.retiredManifestRevision,
    runtimeRevision,
    generatedPages: Object.freeze(
      (record.source.lastSuccessful?.generatedPages ?? []).map((page) => Object.freeze({ ...page }))
    ),
  });
}

interface AuthenticForwardRevisionPublicationRuntimeStoreState {
  readonly file: AtomicRuntimeFile;
  readonly clock: () => number;
  readonly maxTextCharacters: number;
  readonly opaqueIdFactory: () => string;
  readonly studioListeners: Map<string, Set<() => void>>;
  readonly productionExecutionBinding?: KnowledgeProductionWorkflowExecutionRuntimeBinding;
}

const authenticForwardRevisionPublicationRuntimeStores = new WeakMap<
  object,
  Readonly<AuthenticForwardRevisionPublicationRuntimeStoreState>
>();

export class KnowledgeRuntimeStore implements KnowledgeRuntimeSourceFreshnessAuthorityPort {
  private readonly clock: () => number;
  private readonly maxTextCharacters: number;
  private readonly opaqueIdFactory: () => string;
  private readonly studioListeners = new Map<string, Set<() => void>>();

  constructor(
    private readonly file: AtomicRuntimeFile,
    options: KnowledgeRuntimeStoreOptions = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.maxTextCharacters =
      options.maxTextCharacters ?? DEFAULT_MAX_KNOWLEDGE_RUNTIME_TEXT_CHARACTERS;
    if (
      !Number.isSafeInteger(this.maxTextCharacters) ||
      this.maxTextCharacters < 1 ||
      this.maxTextCharacters > DEFAULT_MAX_KNOWLEDGE_RUNTIME_TEXT_CHARACTERS
    ) {
      throw new TypeError("Knowledge Runtime text limit is invalid");
    }
    this.opaqueIdFactory = options.opaqueIdFactory ?? createSecureOpaqueId;
    const productionExecutionClaim = options.productionExecutionClaim;
    if (productionExecutionClaim !== undefined && new.target !== KnowledgeRuntimeStore) {
      throw new TypeError("The production Runtime execution claim is invalid");
    }
    const productionExecutionBinding =
      productionExecutionClaim === undefined
        ? undefined
        : consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(productionExecutionClaim);
    if (new.target === KnowledgeRuntimeStore) {
      authenticForwardRevisionPublicationRuntimeStores.set(
        this,
        Object.freeze({
          file: this.file,
          clock: this.clock,
          maxTextCharacters: this.maxTextCharacters,
          opaqueIdFactory: this.opaqueIdFactory,
          studioListeners: this.studioListeners,
          productionExecutionBinding,
        })
      );
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.file.read();
    } catch {
      const initial = stringifyBoundedRuntimeValue(
        createEmptyKnowledgeRuntimeStoreSnapshot(this.nextOpaqueId("runtimeId")),
        this.maxTextCharacters
      );
      await this.file.initialize(initial);
    }
    await this.migrateLegacyStore();
    await this.readState();
  }

  async readQueue(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("queues", bundleId);
  }

  async reanalyzeCompletedSource(
    command: KnowledgeCompletedSourceReanalysisCommand
  ): Promise<void> {
    const request = completedSourceReanalysisCommandSchema.parse(command);
    let expected: KnowledgeRuntimeStoreSnapshot | undefined;
    try {
      await this.updateState((state) => {
        const queueRaw = findBundleSlot(state, "queues", request.bundleId);
        const manifestRaw = findBundleSlot(state, "manifests", request.bundleId);
        const queue =
          queueRaw === null ? undefined : this.requireQueueSnapshot(request.bundleId, queueRaw);
        const manifest =
          manifestRaw === null ? undefined : this.requireManifest(request.bundleId, manifestRaw);
        const admission =
          queue?.revision === request.expectedQueueRevision
            ? readCompletedSourceReanalysis(state, manifest, queue, request.jobId)
            : undefined;
        if (!admission || !queue) {
          throw new TypeError(
            "Completed-source reanalysis is unavailable; refresh Activity and pause the queue"
          );
        }
        const { job, source, highWatermark } = admission;
        const newJobId = `reanalysis-${this.nextOpaqueId("jobId")}`;
        const observationToken = this.nextOpaqueId("observationToken");
        const captureId = newJobId;
        if (
          state.queues.some((slot) =>
            this.requireQueueSnapshot(slot.bundleId, slot.value).jobs.some(
              (item) => item.id === newJobId
            )
          ) ||
          state.inputRevisions.some((bundle) =>
            bundle.sources.some((item) =>
              item.observations.some(
                (observation) =>
                  observation.observationToken === observationToken ||
                  observation.captureId === captureId
              )
            )
          )
        )
          throw new SourceInputObservationTokenCollisionError();
        const timestamp = Math.max(this.now(), job.updatedAt, highWatermark.observedAt);
        const inputRevision = source.inputRevision + 1;
        const nextQueue: IngestQueueSnapshot = {
          ...queue,
          revision: queue.revision + 1,
          jobs: [
            ...queue.jobs,
            {
              id: newJobId,
              bundleId: queue.bundleId,
              sourceId: job.sourceId,
              sourceContentHash: job.sourceContentHash,
              pipelineFingerprint: job.pipelineFingerprint,
              inputRevision,
              attempt: 0,
              rerunRequested: false,
              createdAt: timestamp,
              updatedAt: timestamp,
              status: "pending",
              stage: "queued",
            },
          ],
          sourceHighWatermarks: queue.sourceHighWatermarks.map((watermark) =>
            watermark.sourceId === job.sourceId
              ? { ...watermark, inputRevision, observedAt: timestamp }
              : watermark
          ),
        };
        // A replay advances ordering, never source bytes or completion evidence. The executor
        // still checks the real source against this hash before making any model request.
        // https://github.com/yydspanda/obsidian-copilot/issues/16
        expected = {
          ...state,
          revision: nextStoreRevision(state),
          queues: replaceBundleSlot(state.queues, queue.bundleId, nextQueue),
          inputRevisions: replaceInputRevisionSource(state.inputRevisions, queue.bundleId, {
            ...source,
            inputRevision,
            observations: [
              ...source.observations,
              {
                observationToken,
                captureId,
                inputRevision,
                status: "consumed",
                sourceContentHash: job.sourceContentHash,
                pipelineFingerprint: job.pipelineFingerprint,
                allocatedAt: timestamp,
                boundAt: timestamp,
                settledAt: timestamp,
                queueRevision: nextQueue.revision,
              },
            ],
          }),
        };
        return { next: expected, value: undefined };
      });
    } catch (error) {
      // Lost acknowledgements must not invite a second paid attempt from the same click.
      // https://github.com/yydspanda/obsidian-copilot/issues/16
      const actual =
        expected === undefined ? undefined : await this.readState().catch(() => undefined);
      if (expected === undefined || actual === undefined || !exactJsonValuesEqual(expected, actual))
        throw error;
      this.emitStudioHints([request.bundleId]);
    }
  }

  async writeQueue(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null,
    authority?: QueueWriteAuthority
  ): Promise<void> {
    const candidate = this.requireQueueSnapshot(bundleId, snapshot);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "queue");
    const settledAt = this.now();
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "queues", bundleId);
      const current = currentRaw === null ? null : this.requireQueueSnapshot(bundleId, currentRaw);
      const manifestRaw = findBundleSlot(state, "manifests", bundleId);
      const retiredSourceIds = new Set<string>();
      if (manifestRaw !== null) {
        const manifest = this.requireManifest(bundleId, manifestRaw);
        const retirements = parseKnowledgeSourceRetirements(manifest);
        if (!retirements.ok) throw new KnowledgeRuntimeStoreCorruptError();
        for (const retirement of retirements.value) {
          retiredSourceIds.add(retirement.source.sourceId);
        }
      }
      assertRetiredQueueHistoryPreserved(bundleId, current, candidate, retiredSourceIds);
      if (authority?.kind === "source_observation") {
        const owner = state.inputRevisions
          .find((bundle) => bundle.bundleId === bundleId)
          ?.sources.find((source) =>
            source.observations.some(
              (observation) => observation.observationToken === authority.observationToken
            )
          );
        if (owner && retiredSourceIds.has(owner.sourceId)) {
          throw new KnowledgeRuntimeSourceRetiredError(bundleId, owner.sourceId);
        }
      }
      if (
        authority?.kind === "no_changes_commit" &&
        retiredSourceIds.has(authority.plan.sourceId)
      ) {
        throw new KnowledgeRuntimeSourceRetiredError(bundleId, authority.plan.sourceId);
      }
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      const abandonmentHistoryPreserved =
        current === null
          ? candidate.applyAbandonments.length === 0
          : exactJsonValuesEqual(current.applyAbandonments, candidate.applyAbandonments);
      if (!abandonmentHistoryPreserved) {
        throw new KnowledgeRuntimeQueueRecoveryGateProtectedError(bundleId);
      }
      const acceptedAnchorsPreserved =
        current === null ||
        acceptedNotStartedAnchorsArePreserved(state, current, candidate) ||
        acceptedClaimProjectionMatches(state, current, candidate);
      if (!acceptedAnchorsPreserved) {
        throw new KnowledgeRuntimeQueueRecoveryGateProtectedError(bundleId);
      }
      if (!protectedQueueControlTransitionIsAllowed(state, current, candidate)) {
        throw new KnowledgeRuntimeQueueRecoveryGateProtectedError(bundleId);
      }
      const noChangesAuthority = authority?.kind === "no_changes_commit" ? authority : undefined;
      if (noChangesAuthority !== undefined) {
        if (state.activeForwardRevisionApply !== null) {
          throw new KnowledgeRuntimeNoChangesCommitConflictError(
            bundleId,
            noChangesAuthority.plan.sourceId,
            "transaction_active"
          );
        }
      }
      const protectedNoChangesCompletion = hasProtectedNoChangesCompletion(current, candidate);
      if (protectedNoChangesCompletion && noChangesAuthority === undefined) {
        const sourceId =
          current?.jobs.find((job) => {
            const next = candidate.jobs.find((candidateJob) => candidateJob.id === job.id);
            return (
              job.status === "processing" &&
              job.stage !== "applying" &&
              next?.status === "completed"
            );
          })?.sourceId ?? "unknown-source";
        throw new KnowledgeRuntimeNoChangesCommitConflictError(
          bundleId,
          sourceId,
          "authority_invalid"
        );
      }
      let manifests = state.manifests;
      if (noChangesAuthority !== undefined) {
        if (current === null) {
          throw new KnowledgeRuntimeNoChangesCommitConflictError(
            bundleId,
            noChangesAuthority.plan.sourceId,
            "queue_mismatch"
          );
        }
        const nextManifest = projectRuntimeNoChangesManifestCommit(
          state,
          current,
          candidate,
          noChangesAuthority
        );
        manifests = replaceBundleSlot(state.manifests, bundleId, nextManifest);
      }
      const inputRevisions = consumeQueueSourceObservations(
        state,
        current,
        candidate,
        settledAt,
        authority
      );
      if (inputRevisions === null) {
        throw new KnowledgeRuntimeQueueObservationAuthorityError(bundleId);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          queues: replaceBundleSlot(state.queues, bundleId, candidate),
          manifests,
          inputRevisions,
        },
        value: undefined,
      };
    });
  }

  async readReview(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("reviews", bundleId);
  }

  async readStudioBundle(bundleId: string): Promise<KnowledgeRuntimeStudioBundleSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const queueRaw = findBundleSlot(state, "queues", bundleId);
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const queue =
      queueRaw === null
        ? createEmptyRuntimeQueueSnapshot(bundleId)
        : this.requireQueueSnapshot(bundleId, queueRaw);
    const manifestRaw = findBundleSlot(state, "manifests", bundleId);
    const manifest =
      manifestRaw === null ? undefined : (thisOrNullManifest(manifestRaw) ?? undefined);
    const completions: [string, KnowledgeRuntimeJobCompletion][] = [];
    const reanalyzableJobIds: string[] = [];
    for (const job of queue.jobs) {
      if (job.status !== "completed") continue;
      const outcome = readCompletionOutcome(state, manifest, job);
      if (outcome !== undefined) completions.push([job.id, outcome]);
      if (readCompletedSourceReanalysis(state, manifest, queue, job.id))
        reanalyzableJobIds.push(job.id);
    }
    return {
      bundleId,
      runtimeRevision: state.revision,
      queue,
      review:
        reviewRaw === null
          ? createEmptyRuntimeReviewSnapshot(bundleId)
          : this.requireReviewSnapshot(bundleId, reviewRaw),
      // Unproven legacy history stays unknown instead of implying a Wiki write.
      // https://github.com/yydspanda/obsidian-copilot/issues/15
      ...(completions.length === 0
        ? {}
        : { completionOutcomes: Object.freeze(Object.fromEntries(completions)) }),
      ...(reanalyzableJobIds.length === 0
        ? {}
        : { reanalyzableJobIds: Object.freeze(reanalyzableJobIds) }),
    };
  }

  async readForwardRevisionStudioBundle(
    bundleId: string
  ): Promise<Readonly<KnowledgeForwardRevisionStudioSnapshot>> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const reviewRaw = findForwardRevisionReviewSlot(state, bundleId);
    const activeApply =
      state.activeForwardRevisionApply?.bundleId === bundleId
        ? state.activeForwardRevisionApply
        : null;
    return projectKnowledgeForwardRevisionStudioSnapshot({
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      bundleId,
      ...(reviewRaw === null ? {} : { review: reviewRaw }),
      activeApply,
      applyCommits: state.forwardRevisionApplyCommits.filter(
        (record) => record.bundleId === bundleId
      ),
      abandonments: state.forwardRevisionAbandonments.filter(
        (record) => record.acceptedIdentity.resource.bundleId === bundleId
      ),
      recoveryTerminals: state.forwardRevisionRecoveryTerminals.filter(
        (record) => record.acceptedIdentity.resource.bundleId === bundleId
      ),
    });
  }

  async abandonForwardRevisionAcceptedReady(
    acceptedIdentityValue: unknown,
    expectedRuntimeRevision: number
  ): Promise<Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>> {
    const acceptedIdentity =
      snapshotKnowledgeForwardRevisionAcceptedClaimIdentity(acceptedIdentityValue);
    if (!Number.isSafeInteger(expectedRuntimeRevision) || expectedRuntimeRevision < 0) {
      throw new TypeError("The expected Runtime revision is invalid");
    }
    return this.updateState((state) => {
      if (
        state.revision !== expectedRuntimeRevision ||
        acceptedIdentity.resource.runtimeId !== state.runtimeId
      ) {
        throw new TypeError("The accepted forward revision is stale");
      }
      const reviewRaw = findForwardRevisionReviewSlot(state, acceptedIdentity.resource.bundleId);
      if (reviewRaw === null) throw new TypeError("The accepted forward revision is unavailable");
      const review = snapshotKnowledgeForwardRevisionReviewSnapshotV2(reviewRaw);
      const accepted = review.records.filter(
        (
          entry
        ): entry is Extract<KnowledgeForwardRevisionTerminalReviewEntryV2, { state: "accepted" }> =>
          entry.state === "accepted" &&
          exactJsonValuesEqual(
            createForwardRevisionAcceptedClaimIdentityForDecision(state.runtimeId, entry.decision),
            acceptedIdentity
          )
      );
      if (accepted.length !== 1) {
        throw new TypeError("The accepted forward revision is unavailable");
      }
      const acceptedKey = createForwardRevisionAcceptedLifecycleKey({
        bundleId: acceptedIdentity.resource.bundleId,
        proposalId: acceptedIdentity.proposalId,
        proposalDigest: acceptedIdentity.proposalDigest,
        acceptedDecisionDigest: acceptedIdentity.acceptedDecisionDigest,
        applyClaimId: acceptedIdentity.applyClaimId,
        applyClaimDigest: acceptedIdentity.applyClaimDigest,
      });
      const activeKey =
        state.activeForwardRevisionApply === null
          ? undefined
          : createForwardRevisionAcceptedLifecycleKey(state.activeForwardRevisionApply);
      const hasLedger = state.forwardRevisionApplyCommits.some(
        (record) => createForwardRevisionAcceptedLifecycleKey(record) === acceptedKey
      );
      const hasOverlay = state.manifests.some((slot) => {
        const manifest = this.requireManifest(slot.bundleId, slot.value);
        return listManifestForwardRevisionOverlays(manifest).some(
          (overlay) => overlay.acceptedDecisionDigest === acceptedIdentity.acceptedDecisionDigest
        );
      });
      const hasTerminal =
        state.forwardRevisionAbandonments.some(
          (record) =>
            createForwardRevisionAcceptedLifecycleKey({
              bundleId: record.acceptedIdentity.resource.bundleId,
              proposalId: record.acceptedIdentity.proposalId,
              proposalDigest: record.acceptedIdentity.proposalDigest,
              acceptedDecisionDigest: record.acceptedIdentity.acceptedDecisionDigest,
              applyClaimId: record.acceptedIdentity.applyClaimId,
              applyClaimDigest: record.acceptedIdentity.applyClaimDigest,
            }) === acceptedKey
        ) ||
        state.forwardRevisionRecoveryTerminals.some(
          (record) =>
            createForwardRevisionAcceptedLifecycleKey({
              bundleId: record.acceptedIdentity.resource.bundleId,
              proposalId: record.acceptedIdentity.proposalId,
              proposalDigest: record.acceptedIdentity.proposalDigest,
              acceptedDecisionDigest: record.acceptedIdentity.acceptedDecisionDigest,
              applyClaimId: record.acceptedIdentity.applyClaimId,
              applyClaimDigest: record.acceptedIdentity.applyClaimDigest,
            }) === acceptedKey
        );
      if (activeKey === acceptedKey || hasLedger || hasOverlay || hasTerminal) {
        throw new TypeError("The accepted forward revision already has an Apply outcome");
      }
      const abandonment = createKnowledgeForwardRevisionAbandonmentRecord({
        acceptedIdentity,
        abandonedAt: Math.max(this.now(), accepted[0].decision.acceptedAt),
      });
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          forwardRevisionAbandonments: [...state.forwardRevisionAbandonments, abandonment].sort(
            (left, right) => compareIdentifiers(left.abandonmentId, right.abandonmentId)
          ),
        },
        value: abandonment,
      };
    });
  }

  async readSourceRetirementCandidates(
    bundleId: string
  ): Promise<KnowledgeSourceRetirementCandidateSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const manifestRaw = findBundleSlot(state, "manifests", bundleId);
    const manifest: SourceManifest =
      manifestRaw === null
        ? { version: 1, bundleId, revision: 0, entries: [] }
        : this.requireManifest(bundleId, manifestRaw);
    const queueRaw = findBundleSlot(state, "queues", bundleId);
    const queue =
      queueRaw === null
        ? createEmptyRuntimeQueueSnapshot(bundleId)
        : this.requireQueueSnapshot(bundleId, queueRaw);
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const review =
      reviewRaw === null
        ? createEmptyRuntimeReviewSnapshot(bundleId)
        : this.requireReviewSnapshot(bundleId, reviewRaw);
    const blockers = Object.freeze(collectSourceRetirementBlockers(state, manifest, queue, review));
    const candidates = manifest.entries
      .map((source): KnowledgeSourceRetirementCandidate => {
        const candidateBlockers = Object.freeze([
          ...blockers,
          ...(sourceOwnsForwardRevisionOverlay(manifest, source.sourceId)
            ? (["forward_revision_overlay_active"] as const)
            : []),
        ]);
        return Object.freeze({
          sourceId: source.sourceId,
          sourcePath: source.sourcePath,
          custody: source.custody,
          generatedPageCount: source.lastSuccessful?.generatedPages.length ?? 0,
          status: candidateBlockers.length === 0 ? "ready" : "blocked",
          expectedToken: createSourceRetirementExpectedToken(state, manifest, source),
          blockers: candidateBlockers,
        });
      })
      .sort((left, right) => compareIdentifiers(left.sourcePath, right.sourcePath));
    return Object.freeze({
      bundleId,
      runtimeRevision: state.revision,
      manifestRevision: manifest.revision,
      candidates: Object.freeze(candidates),
    });
  }

  async retireSourceAtomically(commandValue: unknown): Promise<KnowledgeSourceRetirementReceipt> {
    const parsed = sourceRetirementCommandSchema.safeParse(commandValue);
    if (!parsed.success) {
      const candidate = isRecord(commandValue) ? commandValue : {};
      throw new KnowledgeSourceRetirementConflictError(
        typeof candidate.bundleId === "string" ? candidate.bundleId : "unknown",
        typeof candidate.sourceId === "string" ? candidate.sourceId : "unknown",
        "request_invalid"
      );
    }
    const command = parsed.data;
    const retiredAt = this.now();
    try {
      return await this.updateState((state) => {
        const manifestRaw = findBundleSlot(state, "manifests", command.bundleId);
        if (manifestRaw === null) {
          throw new KnowledgeSourceRetirementConflictError(
            command.bundleId,
            command.sourceId,
            "source_missing"
          );
        }
        const manifest = this.requireManifest(command.bundleId, manifestRaw);
        const retirements = parseKnowledgeSourceRetirements(manifest);
        if (!retirements.ok) throw new KnowledgeRuntimeStoreCorruptError();
        const existing = retirements.value.find(
          (record) => record.source.sourceId === command.sourceId
        );
        if (existing) {
          if (
            existing.requestToken !== command.expectedToken ||
            existing.reason !== command.reason
          ) {
            throw new KnowledgeSourceRetirementConflictError(
              command.bundleId,
              command.sourceId,
              "state_changed"
            );
          }
          return {
            value: createSourceRetirementReceipt(existing, state.revision, "already_retired"),
          };
        }
        const source = manifest.entries.find((entry) => entry.sourceId === command.sourceId);
        if (!source) {
          throw new KnowledgeSourceRetirementConflictError(
            command.bundleId,
            command.sourceId,
            "source_missing"
          );
        }
        if (sourceOwnsForwardRevisionOverlay(manifest, command.sourceId)) {
          throw new KnowledgeSourceRetirementConflictError(
            command.bundleId,
            command.sourceId,
            "blocked",
            Object.freeze(["forward_revision_overlay_active"])
          );
        }
        const expectedToken = createSourceRetirementExpectedToken(state, manifest, source);
        if (expectedToken !== command.expectedToken) {
          throw new KnowledgeSourceRetirementConflictError(
            command.bundleId,
            command.sourceId,
            "state_changed"
          );
        }
        const queueRaw = findBundleSlot(state, "queues", command.bundleId);
        const queue =
          queueRaw === null
            ? createEmptyRuntimeQueueSnapshot(command.bundleId)
            : this.requireQueueSnapshot(command.bundleId, queueRaw);
        const reviewRaw = findBundleSlot(state, "reviews", command.bundleId);
        const review =
          reviewRaw === null
            ? createEmptyRuntimeReviewSnapshot(command.bundleId)
            : this.requireReviewSnapshot(command.bundleId, reviewRaw);
        const blockers = collectSourceRetirementBlockers(state, manifest, queue, review);
        if (blockers.length > 0) {
          throw new KnowledgeSourceRetirementConflictError(
            command.bundleId,
            command.sourceId,
            "blocked",
            Object.freeze(blockers)
          );
        }
        const retiredManifestRevision = manifest.revision + 1;
        const record = createKnowledgeSourceRetirementRecord({
          bundleId: command.bundleId,
          requestToken: command.expectedToken,
          reason: command.reason,
          retiredAt,
          retiredManifestRevision,
          source,
        });
        const nextManifest = this.requireManifest(
          command.bundleId,
          projectKnowledgeSourceRetirement(manifest, record)
        );
        const inputRevisions = terminalizeSourceRetirementObservations(
          state.inputRevisions,
          record
        );
        const runtimeRevision = nextStoreRevision(state);
        return {
          next: {
            ...state,
            revision: runtimeRevision,
            manifests: replaceBundleSlot(state.manifests, command.bundleId, nextManifest),
            inputRevisions,
          },
          value: createSourceRetirementReceipt(record, runtimeRevision, "retired"),
        };
      });
    } catch (error) {
      const confirmed = await this.confirmSourceRetirement(command);
      if (confirmed) {
        this.emitStudioHints([command.bundleId]);
        return confirmed;
      }
      throw error;
    }
  }

  async readAppliedProvenance(
    bundleId: string
  ): Promise<KnowledgeRuntimeAppliedProvenanceSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const manifestRaw = findBundleSlot(state, "manifests", bundleId);
    if (manifestRaw === null) {
      return freezeAppliedProvenanceSnapshot({
        bundleId,
        runtimeRevision: state.revision,
        manifestRevision: 0,
        pages: [],
      });
    }
    const manifest = this.requireManifest(bundleId, manifestRaw);
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const review = reviewRaw === null ? undefined : this.requireReviewSnapshot(bundleId, reviewRaw);
    return freezeAppliedProvenanceSnapshot({
      bundleId,
      runtimeRevision: state.revision,
      manifestRevision: manifest.revision,
      pages: projectAppliedManifestPages(state, manifest, review),
    });
  }

  async readKnownAppliedWikiOutputIndex(
    bundleId: string,
    pagePath: string
  ): Promise<KnowledgeRuntimeKnownAppliedWikiOutputIndexSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    if (
      typeof pagePath !== "string" ||
      pagePath.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
    ) {
      throw new KnowledgeKnownAppliedWikiOutputProjectionError();
    }
    const parsedPagePath = parseVaultPath(pagePath);
    if (!parsedPagePath.ok || parsedPagePath.path !== pagePath) {
      throw new KnowledgeKnownAppliedWikiOutputProjectionError();
    }
    const state = await this.readState();
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const review = reviewRaw === null ? undefined : this.requireReviewSnapshot(bundleId, reviewRaw);
    const forwardReviewRaw = findForwardRevisionReviewSlot(state, bundleId);
    const forwardRevisionReview =
      forwardReviewRaw === null
        ? undefined
        : snapshotKnowledgeForwardRevisionReviewSnapshotV2(forwardReviewRaw);
    const manifestRaw = findBundleSlot(state, "manifests", bundleId);
    const manifest = manifestRaw === null ? undefined : this.requireManifest(bundleId, manifestRaw);
    const current = manifest
      ? projectKnownAppliedWikiCurrentManifestPage(manifest, pagePath)
      : undefined;
    return projectKnowledgeKnownAppliedWikiOutputIndex({
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      bundleId,
      pagePath,
      applyCommits: state.applyCommits,
      review,
      forwardRevisionApplyCommits: state.forwardRevisionApplyCommits,
      forwardRevisionReview,
      manifestRevision: manifest?.revision ?? 0,
      ...(current
        ? {
            currentManifestPage: {
              path: current.path,
              windowsPathKey: current.windowsPathKey,
              ownership: current.ownership,
              contentHash: current.contentHash,
            },
          }
        : {}),
    });
  }

  async readKnownAppliedWikiOutputDetail(
    bundleId: string,
    pagePath: string,
    authority: KnowledgeKnownAppliedWikiOutputAuthorityIdentity
  ): Promise<KnowledgeRuntimeKnownAppliedWikiOutputDetailSnapshot> {
    assertIdentifier(bundleId, "bundleId");
    if (
      typeof pagePath !== "string" ||
      pagePath.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxPagePathCharacters
    ) {
      throw new KnowledgeKnownAppliedWikiOutputProjectionError();
    }
    const parsedPagePath = parseVaultPath(pagePath);
    if (!parsedPagePath.ok || parsedPagePath.path !== pagePath) {
      throw new KnowledgeKnownAppliedWikiOutputProjectionError();
    }
    const state = await this.readState();
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const review = reviewRaw === null ? undefined : this.requireReviewSnapshot(bundleId, reviewRaw);
    const forwardReviewRaw = findForwardRevisionReviewSlot(state, bundleId);
    const forwardRevisionReview =
      forwardReviewRaw === null
        ? undefined
        : snapshotKnowledgeForwardRevisionReviewSnapshotV2(forwardReviewRaw);
    return projectKnowledgeKnownAppliedWikiOutputDetail({
      runtimeId: state.runtimeId,
      runtimeRevision: state.revision,
      bundleId,
      pagePath,
      applyCommits: state.applyCommits,
      review,
      forwardRevisionApplyCommits: state.forwardRevisionApplyCommits,
      forwardRevisionReview,
      authority,
    });
  }

  async readForwardRevisionProposalAuthority(
    value: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionProposalAuthorityV1> | null> {
    const query = snapshotKnowledgeForwardRevisionProposalAuthorityQuery(value);
    const state = await this.readState();
    return projectForwardRevisionProposalAuthority(state, query);
  }

  async readForwardRevisionValidationAuthority(
    value: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionValidationAuthorityV1> | null> {
    const query = snapshotKnowledgeForwardRevisionValidationAuthorityQuery(value);
    const state = await this.readState();
    return projectForwardRevisionValidationAuthority(state, query);
  }

  async readForwardRevisionApplyAuthority(
    queryValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionApplyAuthority> | null> {
    const query = snapshotKnowledgeForwardRevisionApplyAuthorityQuery(queryValue);
    const state = await this.readState();
    return projectForwardRevisionApplyAuthority(state, query);
  }

  async beginForwardRevisionApply(
    authorizationValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1>> {
    const authorization = requireForwardRevisionApplyBeginAuthorization(authorizationValue);
    const prepared = createPreparedForwardRevisionApplyJournal(authorization.projection);
    let mutationAttempted = false;
    try {
      return await this.updateState((state) => {
        try {
          authorization.workflowLease.assertCurrent();
          if (
            !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
              authorization.workflowLease,
              authorization.executionOwner
            )
          ) {
            throw new TypeError();
          }
          KnowledgeForwardRevisionApplyCapability.assertExecutionOwner(
            authorization.capability,
            authorization.executionOwner
          );
          const currentProjection = KnowledgeForwardRevisionApplyCapability.project(
            authorization.capability
          );
          if (!exactJsonValuesEqual(currentProjection, authorization.projection)) {
            throw new TypeError();
          }
        } catch {
          throw createForwardRevisionApplyPortError("aborted");
        }

        if (state.activeForwardRevisionApply !== null) {
          const current = snapshotKnowledgeForwardRevisionApplyJournal(
            state.activeForwardRevisionApply
          );
          if (current.phase === "prepared" && exactJsonValuesEqual(current, prepared)) {
            return { value: current };
          }
          throw createForwardRevisionApplyPortError("conflict");
        }
        if (state.activeTransaction !== null) {
          throw createForwardRevisionApplyPortError("authority_unavailable");
        }
        if (
          state.applyCommits.some((record) => record.transactionId === prepared.transactionId) ||
          state.forwardRevisionApplyCommits.some(
            (record) => record.transactionId === prepared.transactionId
          )
        ) {
          throw createForwardRevisionApplyPortError("conflict");
        }
        const currentAuthority = projectForwardRevisionApplyAuthority(
          state,
          authorization.projection.request
        );
        if (
          currentAuthority === null ||
          !exactJsonValuesEqual(currentAuthority, authorization.projection.afterAuthority)
        ) {
          throw createForwardRevisionApplyPortError("authority_unavailable");
        }
        if (prepared.createdAt < currentAuthority.lineageAppliedAtFloor) {
          throw createForwardRevisionApplyPortError("authority_unavailable");
        }
        assertForwardRevisionApplyLineageTimestampFloor(state, prepared);
        assertForwardRevisionApplyBeginResources(state, prepared, this.maxTextCharacters);
        mutationAttempted = true;
        return {
          next: {
            ...state,
            revision: state.revision + 1,
            activeForwardRevisionApply: prepared,
          },
          value: prepared,
        };
      });
    } catch (error) {
      if (mutationAttempted) {
        const confirmed = await this.confirmForwardRevisionApplyBegin(authorization.projection);
        if (confirmed) {
          this.emitStudioHints([prepared.bundleId]);
          return confirmed;
        }
      }
      throw error;
    }
  }

  async confirmForwardRevisionApplyBegin(
    projection: Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1>
  ): Promise<Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1> | undefined> {
    try {
      const expected = createPreparedForwardRevisionApplyJournal(projection);
      const state = await this.readState();
      if (state.activeForwardRevisionApply === null) return undefined;
      const active = snapshotKnowledgeForwardRevisionApplyJournal(state.activeForwardRevisionApply);
      return active.phase === "prepared" && exactJsonValuesEqual(active, expected)
        ? active
        : undefined;
    } catch {
      return undefined;
    }
  }

  async readActiveForwardRevisionApply(): Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1> | null> {
    const state = await this.readState();
    return state.activeForwardRevisionApply === null
      ? null
      : snapshotKnowledgeForwardRevisionApplyJournal(state.activeForwardRevisionApply);
  }

  async advanceForwardRevisionApply(
    authorizationValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1>> {
    const authorization = requireForwardRevisionApplyTransitionAuthorization(
      authorizationValue,
      "advance"
    );
    const projection = snapshotForwardRevisionApplyTransitionProjection(authorization.projection);
    if (projection.transition === "finalize" || projection.transition === "terminalize") {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
    let mutationAttempted = false;
    try {
      return await this.updateState((state) => {
        assertForwardRevisionApplyTransitionAuthorizationCurrent(
          authorization,
          projection,
          "advance"
        );
        if (state.activeForwardRevisionApply === null) {
          throw createForwardRevisionApplyPortError("conflict");
        }
        const active = snapshotKnowledgeForwardRevisionApplyJournal(
          state.activeForwardRevisionApply
        );
        if (exactJsonValuesEqual(active, projection.nextJournal)) {
          return { value: active };
        }
        if (!exactJsonValuesEqual(active, projection.previousJournal)) {
          throw createForwardRevisionApplyPortError("conflict");
        }
        if (projection.transition === "applying") {
          assertForwardRevisionApplyLineageTimestampFloor(state, active);
        }
        const requiredRemainingRevisions =
          projection.transition === "applying"
            ? 3
            : projection.transition === "committed" ||
                projection.transition === "recovery_committed"
              ? 2
              : 1;
        if (state.revision > Number.MAX_SAFE_INTEGER - requiredRemainingRevisions) {
          throw createForwardRevisionApplyPortError("resource_limit");
        }
        let revision: number;
        try {
          revision = nextStoreRevision(state);
        } catch {
          throw createForwardRevisionApplyPortError("resource_limit");
        }
        mutationAttempted = true;
        return {
          next: {
            ...state,
            revision,
            activeForwardRevisionApply: projection.nextJournal,
          },
          value: projection.nextJournal,
        };
      });
    } catch (error) {
      if (mutationAttempted) {
        const confirmed = await this.confirmForwardRevisionApplyAdvance(projection);
        if (confirmed) {
          this.emitStudioHints([projection.nextJournal.bundleId]);
          return confirmed;
        }
      }
      throw error;
    }
  }

  async confirmForwardRevisionApplyAdvance(
    projectionValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1> | undefined> {
    try {
      const projection = snapshotForwardRevisionApplyTransitionProjection(projectionValue);
      if (projection.transition === "finalize" || projection.transition === "terminalize") {
        return undefined;
      }
      const state = await this.readState();
      if (state.activeForwardRevisionApply === null) return undefined;
      const active = snapshotKnowledgeForwardRevisionApplyJournal(state.activeForwardRevisionApply);
      return exactJsonValuesEqual(active, projection.nextJournal) ? active : undefined;
    } catch {
      return undefined;
    }
  }

  async finalizeForwardRevisionApply(
    authorizationValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionApplyLedgerRecord>> {
    const authorization = requireForwardRevisionApplyTransitionAuthorization(
      authorizationValue,
      "finalize"
    );
    const projection = snapshotForwardRevisionApplyTransitionProjection(authorization.projection);
    if (projection.transition !== "finalize") {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
    let mutationAttempted = false;
    try {
      return await this.updateState((state) => {
        assertForwardRevisionApplyTransitionAuthorizationCurrent(
          authorization,
          projection,
          "finalize"
        );
        if (state.activeForwardRevisionApply === null) {
          const replay = confirmForwardRevisionApplyFinalization(state, projection.previousJournal);
          if (replay) return { value: replay };
          throw createForwardRevisionApplyPortError("conflict");
        }
        const active = snapshotKnowledgeForwardRevisionApplyJournal(
          state.activeForwardRevisionApply
        );
        if (!exactJsonValuesEqual(active, projection.previousJournal)) {
          throw createForwardRevisionApplyPortError("conflict");
        }
        const projected = projectForwardRevisionApplyFinalization(state, active);
        mutationAttempted = true;
        return { next: projected.next, value: projected.ledger };
      });
    } catch (error) {
      if (mutationAttempted) {
        const confirmed = await this.confirmForwardRevisionApplyFinalization(projection);
        if (confirmed) {
          this.emitStudioHints([projection.previousJournal.bundleId]);
          return confirmed;
        }
      }
      throw error;
    }
  }

  async confirmForwardRevisionApplyFinalization(
    projectionValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionApplyLedgerRecord> | undefined> {
    try {
      const projection = snapshotForwardRevisionApplyTransitionProjection(projectionValue);
      if (projection.transition !== "finalize") return undefined;
      return confirmForwardRevisionApplyFinalization(
        await this.readState(),
        projection.previousJournal
      );
    } catch {
      return undefined;
    }
  }

  async terminalizeForwardRevisionRecovery(
    authorizationValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>> {
    const authorization = requireForwardRevisionApplyTransitionAuthorization(
      authorizationValue,
      "terminalize"
    );
    const projection = snapshotForwardRevisionApplyTransitionProjection(authorization.projection);
    if (projection.transition !== "terminalize") {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
    let mutationAttempted = false;
    try {
      return await this.updateState((state) => {
        assertForwardRevisionApplyTransitionAuthorizationCurrent(
          authorization,
          projection,
          "terminalize"
        );
        if (state.activeForwardRevisionApply === null) {
          const replay = confirmForwardRevisionRecoveryTerminalization(state, projection);
          if (replay) return { value: replay };
          throw createForwardRevisionApplyPortError("conflict");
        }
        const active = snapshotKnowledgeForwardRevisionApplyJournal(
          state.activeForwardRevisionApply
        );
        if (!exactJsonValuesEqual(active, projection.previousJournal)) {
          throw createForwardRevisionApplyPortError("conflict");
        }
        const terminalizedAt = Math.max(this.now(), projection.observedAt);
        const projected = projectForwardRevisionRecoveryTerminalization(
          state,
          projection,
          terminalizedAt
        );
        mutationAttempted = true;
        return { next: projected.next, value: projected.terminal };
      });
    } catch (error) {
      if (mutationAttempted) {
        const confirmed = await this.confirmForwardRevisionRecoveryTerminalization(projection);
        if (confirmed) {
          this.emitStudioHints([projection.previousJournal.bundleId]);
          return confirmed;
        }
      }
      throw error;
    }
  }

  async confirmForwardRevisionRecoveryTerminalization(
    projectionValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1> | undefined> {
    try {
      const projection = snapshotForwardRevisionApplyTransitionProjection(projectionValue);
      if (projection.transition !== "terminalize") return undefined;
      return confirmForwardRevisionRecoveryTerminalization(await this.readState(), projection);
    } catch {
      return undefined;
    }
  }

  async readForwardRevisionReview(
    bundleId: string
  ): Promise<Readonly<KnowledgeForwardRevisionReviewSnapshotV2>> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const raw = findForwardRevisionReviewSlot(state, bundleId);
    return raw === null
      ? createEmptyKnowledgeForwardRevisionReviewSnapshotV2(bundleId)
      : snapshotKnowledgeForwardRevisionReviewSnapshotV2(raw);
  }

  async readForwardRevisionPendingForDecision(
    commandValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionDecisionAdmission> | null> {
    const command = snapshotKnowledgeForwardRevisionReviewCommand(commandValue);
    const state = await this.readState();
    if (state.runtimeId !== command.runtimeId) return null;
    const raw = findForwardRevisionReviewSlot(state, command.bundleId);
    if (raw === null) return null;
    const store = snapshotKnowledgeForwardRevisionReviewSnapshotV2(raw);
    const matches = store.records.filter((entry) => {
      const projection = projectKnowledgeForwardRevisionReviewEntryProposalV2(entry);
      return (
        projection.proposal.proposalId === command.proposalId &&
        projection.proposalDigest === command.proposalDigest
      );
    });
    if (matches.length !== 1) return null;
    if (matches[0].state !== "pending") {
      const result = projectForwardRevisionDecisionReplay(matches[0], command);
      if (!result) throw createForwardRevisionDecisionPortError("conflict");
      return Object.freeze({ kind: "terminal" as const, result });
    }
    const projection = projectKnowledgeForwardRevisionReviewEntryProposalV2(matches[0]);
    snapshotKnowledgeForwardRevisionReviewCommandForProposal(
      command,
      projection.proposal,
      projection.proposalDigest
    );
    return Object.freeze({
      kind: "pending" as const,
      proposal: projection.proposal,
      proposalDigest: projection.proposalDigest,
    });
  }

  async publishForwardRevisionProposalAtomically(
    value: KnowledgeForwardRevisionProposalPublicationEvidence
  ): Promise<Readonly<KnowledgeForwardRevisionPublicationReceiptV1>> {
    const evidence = snapshotForwardRevisionPublicationEvidence(value);
    let attemptedReceipt: Readonly<KnowledgeForwardRevisionPublicationReceiptV1> | undefined;
    try {
      return await this.updateState((state) => {
        const raw = findForwardRevisionReviewSlot(state, evidence.intent.bundleId);
        const current =
          raw === null
            ? createEmptyKnowledgeForwardRevisionReviewSnapshotV2(evidence.intent.bundleId)
            : snapshotKnowledgeForwardRevisionReviewSnapshotV2(raw);
        const existing = current.records.find(
          (record) =>
            projectKnowledgeForwardRevisionReviewEntryProposalV2(record).proposal.request.intent
              .intentId === evidence.intent.intentId
        );
        if (existing) {
          const publication = projectKnowledgeForwardRevisionReviewEntryProposalV2(existing);
          const request = publication.proposal.request;
          if (
            request.intentDigest !== evidence.intentDigest ||
            !exactJsonValuesEqual(request.intent, evidence.intent) ||
            !exactJsonValuesEqual(
              request.historicalReviewAuthority,
              evidence.historicalReviewAuthority
            ) ||
            request.selectedContent !== evidence.selectedContent ||
            request.selectedContentHash !== evidence.selectedContentHash ||
            request.intent.current.vaultObservedBeforeHash !== evidence.vaultObservedBeforeHash
          ) {
            throw new KnowledgeForwardRevisionPublicationConflictError(
              evidence.intent.bundleId,
              "intent_conflict"
            );
          }
          return {
            value: createKnowledgeForwardRevisionPublicationReceipt({
              outcome: "already_published",
              proposal: publication.proposal,
              runtimeRevision: publication.publishedRuntimeRevision,
              proposalStoreRevision: publication.proposalStoreRevision,
            }),
          };
        }
        if (
          current.records.some(
            (record) =>
              record.state !== "rejected" &&
              (record.state !== "accepted" ||
                !acceptedForwardRevisionReviewIsTerminal(state, record.decision)) &&
              toWindowsPathKey(
                projectKnowledgeForwardRevisionReviewEntryProposalV2(record).proposal.request
                  .pagePath
              ) === toWindowsPathKey(evidence.intent.pagePath)
          )
        ) {
          throw new KnowledgeForwardRevisionPublicationConflictError(
            evidence.intent.bundleId,
            "page_conflict"
          );
        }
        const publicationTimeFloors = assertForwardRevisionPublicationAuthority(state, evidence);
        const selectedContentCharacters = current.records.reduce(
          (total, record) =>
            total +
            projectKnowledgeForwardRevisionReviewEntryProposalV2(record).proposal.request
              .selectedContent.length +
            (record.state === "accepted" ? record.decision.afterContent.length : 0),
          evidence.selectedContent.length
        );
        if (
          current.records.length >=
            KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxRecords ||
          selectedContentCharacters >
            KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxTotalRetainedBodyCharacters
        ) {
          throw new KnowledgeForwardRevisionPublicationConflictError(
            evidence.intent.bundleId,
            "resource_limit"
          );
        }
        if (
          state.revision === Number.MAX_SAFE_INTEGER ||
          current.revision === Number.MAX_SAFE_INTEGER ||
          current.lastRequestRevision === Number.MAX_SAFE_INTEGER
        ) {
          throw new KnowledgeForwardRevisionPublicationConflictError(
            evidence.intent.bundleId,
            "revision_overflow"
          );
        }
        const runtimeRevision = state.revision + 1;
        const proposalStoreRevision = current.revision + 1;
        const requestedAt = Math.max(
          this.now(),
          evidence.intent.historical.appliedAt,
          publicationTimeFloors.sourceFreshnessCompletedAt,
          publicationTimeFloors.lineageAppliedAtFloor
        );
        const request = createKnowledgeForwardRevisionRequest({
          requestRevision: current.lastRequestRevision + 1,
          runtimeId: state.runtimeId,
          bundleId: evidence.intent.bundleId,
          pagePath: evidence.intent.pagePath,
          intent: evidence.intent,
          intentDigest: evidence.intentDigest,
          historicalReviewAuthority: evidence.historicalReviewAuthority,
          selectedContent: evidence.selectedContent,
          selectedContentHash: evidence.selectedContentHash,
          requestedAt,
        });
        const proposal = createKnowledgeForwardRevisionPendingProposalRecord({
          request,
          recordedAt: requestedAt,
        });
        const published = createKnowledgeForwardRevisionPendingReviewEntryV2({
          proposal,
          publishedRuntimeRevision: runtimeRevision,
          proposalStoreRevision,
        });
        const nextStore = snapshotKnowledgeForwardRevisionReviewSnapshotV2({
          version: 2,
          bundleId: evidence.intent.bundleId,
          revision: proposalStoreRevision,
          lastRequestRevision: request.requestRevision,
          records: [...current.records, published],
        });
        const receipt = createKnowledgeForwardRevisionPublicationReceipt({
          outcome: "published",
          proposal,
          runtimeRevision,
          proposalStoreRevision,
        });
        const next: KnowledgeRuntimeStoreSnapshot = {
          ...state,
          revision: runtimeRevision,
          forwardRevisionReviews: replaceBundleSlot(
            state.forwardRevisionReviews,
            evidence.intent.bundleId,
            nextStore
          ),
        };
        if (serializedRuntimeValueExceedsLimit(next, this.maxTextCharacters)) {
          throw new KnowledgeForwardRevisionPublicationConflictError(
            evidence.intent.bundleId,
            "resource_limit"
          );
        }
        attemptedReceipt = receipt;
        return {
          next,
          value: receipt,
        };
      });
    } catch (error) {
      if (attemptedReceipt) {
        const confirmed = await this.confirmForwardRevisionPublication(evidence, attemptedReceipt);
        if (confirmed) {
          this.emitStudioHints([evidence.intent.bundleId]);
          return attemptedReceipt;
        }
      }
      throw error;
    }
  }

  async decideForwardRevisionAtomically(
    authorizationValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionDecisionResult>> {
    const authorization = requireForwardRevisionDecisionMutationAuthorization(authorizationValue);
    const { command, validationProjection } = authorization;
    const decidedAt = this.now();
    let mutationAttempted = false;
    try {
      return await this.updateState((state) => {
        try {
          authorization.workflowLease.assertCurrent();
          if (
            !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
              authorization.workflowLease,
              authorization.executionOwner
            )
          ) {
            throw new TypeError();
          }
          if (validationProjection) {
            KnowledgeForwardRevisionValidationCapability.assertExecutionOwner(
              authorization.validationCapability,
              authorization.executionOwner
            );
            const currentProjection = KnowledgeForwardRevisionValidationCapability.project(
              authorization.validationCapability
            );
            if (!exactJsonValuesEqual(currentProjection, validationProjection)) {
              throw new TypeError();
            }
          } else if (authorization.validationCapability !== undefined) {
            throw new TypeError();
          }
        } catch {
          throw createForwardRevisionDecisionPortError("aborted");
        }
        if (
          state.runtimeId !== command.runtimeId ||
          state.activeTransaction !== null ||
          state.activeForwardRevisionApply !== null
        ) {
          throw createForwardRevisionDecisionPortError("authority_unavailable");
        }
        const raw = findForwardRevisionReviewSlot(state, command.bundleId);
        if (raw === null) throw createForwardRevisionDecisionPortError("conflict");
        const store = snapshotKnowledgeForwardRevisionReviewSnapshotV2(raw);
        const matches = store.records.filter((entry) => {
          const proposal = projectKnowledgeForwardRevisionReviewEntryProposalV2(entry);
          return (
            proposal.proposal.proposalId === command.proposalId &&
            proposal.proposalDigest === command.proposalDigest
          );
        });
        if (matches.length !== 1) throw createForwardRevisionDecisionPortError("conflict");
        const existing = matches[0];
        const publication = projectKnowledgeForwardRevisionReviewEntryProposalV2(existing);
        const strictCommand = snapshotKnowledgeForwardRevisionReviewCommandForProposal(
          command,
          publication.proposal,
          publication.proposalDigest
        );
        if (existing.state !== "pending") {
          const replay = projectForwardRevisionDecisionReplay(existing, strictCommand);
          if (!replay) throw createForwardRevisionDecisionPortError("conflict");
          return { value: replay };
        }

        const retainedCharacters = store.records.reduce(
          (total, entry) =>
            total +
            projectKnowledgeForwardRevisionReviewEntryProposalV2(entry).proposal.request
              .selectedContent.length +
            (entry.state === "accepted" ? entry.decision.afterContent.length : 0),
          strictCommand.action === "reject" ? 0 : (validationProjection?.afterContent.length ?? 0)
        );
        if (
          !Number.isSafeInteger(retainedCharacters) ||
          retainedCharacters >
            KNOWLEDGE_FORWARD_REVISION_REVIEW_SNAPSHOT_V2_LIMITS.maxTotalRetainedBodyCharacters
        ) {
          throw createForwardRevisionDecisionPortError("resource_limit");
        }

        if (state.revision === Number.MAX_SAFE_INTEGER) {
          throw createForwardRevisionDecisionPortError("resource_limit");
        }
        const nextRuntimeRevision = nextStoreRevision(state);
        const nextDecisionStoreRevision = store.revision + 1;
        if (!Number.isSafeInteger(nextDecisionStoreRevision)) {
          throw createForwardRevisionDecisionPortError("resource_limit");
        }
        let decision: Readonly<KnowledgeForwardRevisionTerminalDecisionRecordV1>;
        if (strictCommand.action === "reject") {
          if (validationProjection !== undefined) {
            throw createForwardRevisionDecisionPortError("request_invalid");
          }
          decision = createKnowledgeForwardRevisionRejectedDecisionRecord({
            proposal: publication.proposal,
            proposalDigest: publication.proposalDigest,
            rejectedAt: Math.max(publication.proposal.recordedAt, decidedAt),
          });
        } else {
          if (!validationProjection) {
            throw createForwardRevisionDecisionPortError("request_invalid");
          }
          const query = createKnowledgeForwardRevisionValidationAuthorityQuery({
            proposal: publication.proposal,
            proposalDigest: publication.proposalDigest,
          });
          const authority = projectForwardRevisionValidationAuthority(state, query);
          if (!authority) {
            throw createForwardRevisionDecisionPortError("authority_unavailable");
          }
          assertForwardRevisionDecisionValidationProjection(
            validationProjection,
            publication.proposal,
            publication.proposalDigest,
            strictCommand,
            authority
          );
          const acceptedAt = Math.max(
            publication.proposal.recordedAt,
            authority.acceptanceAuthority.currentSourceFreshness.completedAt,
            validationProjection.receipt.validatedAt,
            decidedAt
          );
          decision = createKnowledgeForwardRevisionAcceptedDecisionRecord({
            proposal: publication.proposal,
            proposalDigest: publication.proposalDigest,
            command: strictCommand,
            afterContent: validationProjection.afterContent,
            acceptanceAuthority: authority.acceptanceAuthority,
            validationReceipt: validationProjection.receipt,
            validationReceiptDigest: validationProjection.receiptDigest,
            acceptedAt,
          });
        }
        const terminal = createKnowledgeForwardRevisionTerminalReviewEntryV2({
          decision,
          publishedRuntimeRevision: publication.publishedRuntimeRevision,
          proposalStoreRevision: publication.proposalStoreRevision,
          decidedRuntimeRevision: nextRuntimeRevision,
          decisionStoreRevision: nextDecisionStoreRevision,
        });
        const records = store.records.map((entry) => (entry === existing ? terminal : entry));
        const nextStore = snapshotKnowledgeForwardRevisionReviewSnapshotV2({
          ...store,
          revision: nextDecisionStoreRevision,
          records,
        });
        const next: KnowledgeRuntimeStoreSnapshot = {
          ...state,
          revision: nextRuntimeRevision,
          forwardRevisionReviews: replaceBundleSlot(
            state.forwardRevisionReviews,
            command.bundleId,
            nextStore
          ),
        };
        if (serializedRuntimeValueExceedsLimit(next, this.maxTextCharacters)) {
          throw createForwardRevisionDecisionPortError("resource_limit");
        }
        mutationAttempted = true;
        return {
          next,
          value: createForwardRevisionDecisionResult(
            "decided",
            decision,
            nextRuntimeRevision,
            nextDecisionStoreRevision
          ),
        };
      });
    } catch (error) {
      if (mutationAttempted) {
        const confirmed = await this.confirmForwardRevisionDecision(command);
        if (confirmed) {
          this.emitStudioHints([command.bundleId]);
          return confirmed;
        }
      }
      throw error;
    }
  }

  async confirmForwardRevisionDecision(
    commandValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionDecisionResult> | undefined> {
    try {
      const command = snapshotKnowledgeForwardRevisionReviewCommand(commandValue);
      const state = await this.readState();
      if (state.runtimeId !== command.runtimeId) return undefined;
      const raw = findForwardRevisionReviewSlot(state, command.bundleId);
      if (raw === null) return undefined;
      const store = snapshotKnowledgeForwardRevisionReviewSnapshotV2(raw);
      const matches = store.records.filter((entry) => {
        const proposal = projectKnowledgeForwardRevisionReviewEntryProposalV2(entry);
        return (
          proposal.proposal.proposalId === command.proposalId &&
          proposal.proposalDigest === command.proposalDigest
        );
      });
      if (matches.length !== 1 || matches[0].state === "pending") return undefined;
      return projectForwardRevisionDecisionReplay(matches[0], command) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async readSourceFreshnessAuthority(
    bundleId: string,
    sourceId: string
  ): Promise<KnowledgeRuntimeSourceFreshnessAuthority | null> {
    assertIdentifier(bundleId, "bundleId");
    assertIdentifier(sourceId, "sourceId");
    const state = await this.readState();
    const manifestRaw = findBundleSlot(state, "manifests", bundleId);
    if (manifestRaw === null) return null;
    const manifest = this.requireManifest(bundleId, manifestRaw);
    const entry = manifest.entries.find((candidate) => candidate.sourceId === sourceId);
    if (!entry) return null;
    return projectRuntimeSourceFreshnessAuthority(state, manifest, entry);
  }

  async rejectReviewAtomically(
    bundleId: string,
    command: unknown
  ): Promise<KnowledgeRuntimeReviewRejectReceipt> {
    assertIdentifier(bundleId, "bundleId");
    const captured = parseKnowledgeLiteralRejectCommand(command);
    const decidedAt = this.now();
    try {
      return await this.commitReviewRejection(bundleId, captured, decidedAt);
    } catch (error) {
      const confirmed = await this.confirmReviewRejection(bundleId, captured, decidedAt);
      if (confirmed) {
        this.emitStudioHints([bundleId]);
        return confirmed;
      }
      throw error;
    }
  }

  subscribeStudioBundle(bundleId: string, listener: () => void): () => void {
    assertIdentifier(bundleId, "bundleId");
    if (typeof listener !== "function") {
      throw new TypeError("listener must be a function");
    }
    const listeners = this.studioListeners.get(bundleId) ?? new Set<() => void>();
    listeners.add(listener);
    this.studioListeners.set(bundleId, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.studioListeners.get(bundleId);
      current?.delete(listener);
      if (current?.size === 0) this.studioListeners.delete(bundleId);
    };
  }

  async writeReview(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireReviewSnapshot(bundleId, snapshot);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "review");
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "reviews", bundleId);
      const current = currentRaw === null ? null : this.requireReviewSnapshot(bundleId, currentRaw);
      const manifestRaw = findBundleSlot(state, "manifests", bundleId);
      if (manifestRaw !== null) {
        const manifest = this.requireManifest(bundleId, manifestRaw);
        const retirements = parseKnowledgeSourceRetirements(manifest);
        if (!retirements.ok) throw new KnowledgeRuntimeStoreCorruptError();
        const retiredSourceIds = new Set(retirements.value.map((record) => record.source.sourceId));
        assertRetiredReviewHistoryPreserved(bundleId, current, candidate, retiredSourceIds);
      }
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new ReviewStorageRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      // Explicit Review Apply may proceed under a user pause without resuming
      // background work; provider and recovery gates still forbid new acceptance.
      // https://github.com/yydspanda/obsidian-copilot/issues/18
      const queueRaw = findBundleSlot(state, "queues", bundleId);
      const queue = queueRaw === null ? null : this.requireQueueSnapshot(bundleId, queueRaw);
      // A second Studio view must not durably accept while selected work owns
      // the paused queue, because its subsequent Apply claim would be blocked.
      // https://github.com/yydspanda/obsidian-copilot/issues/18
      const selectedWorkActive =
        queue?.control.status === "paused" &&
        queue.control.reason === "user" &&
        queue.jobs.some((job) => job.status === "processing");
      if (
        queue?.applyCommit !== undefined ||
        selectedWorkActive ||
        (queue?.control.status === "paused" &&
          queue.control.reason !== "startup_recovery" &&
          queue.control.reason !== "user")
      ) {
        const acceptedIds = new Set(
          candidate.records
            .filter((record) => record.outcome === "accepted")
            .map((record) => record.changeSetId)
        );
        if (
          current?.records.some(
            (record) => record.outcome === "pending" && acceptedIds.has(record.changeSetId)
          )
        ) {
          throw new ReviewStorageAcceptanceBlockedError();
        }
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          reviews: replaceBundleSlot(state.reviews, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  async readManifest(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("manifests", bundleId);
  }

  async writeManifest(
    bundleId: string,
    manifest: SourceManifest,
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireManifest(bundleId, manifest);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "manifest");
    await this.updateState((state) => {
      if (state.activeTransaction !== null) {
        const active = this.requireTransaction(state.activeTransaction);
        throw new KnowledgeRuntimeManifestReservationError(bundleId, active.transactionId);
      }
      if (state.activeForwardRevisionApply !== null) {
        throw new KnowledgeRuntimeManifestReservationError(
          bundleId,
          "active-forward-revision-apply"
        );
      }
      const currentRaw = findBundleSlot(state, "manifests", bundleId);
      const current = currentRaw === null ? null : this.requireManifest(bundleId, currentRaw);
      assertGenericManifestPreservesCommitState(current, candidate);
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new SourceManifestRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          manifests: replaceBundleSlot(state.manifests, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  async verifyApplyAuthority(
    request: ChangeSetTransactionAuthorityRequest
  ): Promise<Readonly<ChangeSetTransactionAuthorityProof>> {
    const proof = parseApplyAuthorityRequest(request);
    const state = await this.readState();
    const minimumTimestamp = this.assertTransactionFileAccessAuthority(state, proof);
    return Object.freeze({ minimumTimestamp });
  }

  async classifyNoJournalApplyRecovery(
    identity: AcceptedReviewStartupIdentity
  ): Promise<NoJournalApplyRecoveryClassification> {
    this.assertAcceptedReviewStartupIdentity(identity);
    const state = await this.readState();
    const record = this.requireAcceptedReviewByStartupIdentity(state, identity);
    return this.classifyAcceptedApplyState(state, identity.bundleId, record);
  }

  async loadNoJournalApplyRecoverySnapshot(
    bundleId: string,
    expectedReviewRevision: number
  ): Promise<NoJournalApplyRecoverySnapshotLoadResult> {
    assertIdentifier(bundleId, "bundleId");
    if (!Number.isSafeInteger(expectedReviewRevision) || expectedReviewRevision < 0) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "request_invalid");
    }
    const state = await this.readState();
    const reviewRaw = findBundleSlot(state, "reviews", bundleId);
    const review =
      reviewRaw === null
        ? createEmptyRuntimeReviewSnapshot(bundleId)
        : this.requireReviewSnapshot(bundleId, reviewRaw);
    if (review.revision !== expectedReviewRevision) {
      return {
        kind: "review_revision_changed",
        bundleId,
        runtimeRevision: state.revision,
        expectedReviewRevision,
        actualReviewRevision: review.revision,
      };
    }

    const queueRaw = findBundleSlot(state, "queues", bundleId);
    const queueSnapshot =
      queueRaw === null
        ? createEmptyRuntimeQueueSnapshot(bundleId)
        : this.requireQueueSnapshot(bundleId, queueRaw);
    const activeTransaction =
      state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
    const classifications = review.records
      .filter((record): record is AcceptedChangeSetReviewRecord => record.outcome === "accepted")
      .sort(compareAcceptedReviewRecords)
      .map((record) => this.classifyAcceptedApplyState(state, bundleId, record));
    return {
      kind: "loaded",
      snapshot: {
        bundleId,
        runtimeRevision: state.revision,
        reviewRevision: review.revision,
        queueSnapshot,
        globalTransaction:
          activeTransaction === null
            ? null
            : {
                transactionId: activeTransaction.transactionId,
                bundleId: activeTransaction.bundleId,
                changeSetId: activeTransaction.changeSetId,
                phase: activeTransaction.phase,
              },
        classifications,
      },
    };
  }

  async releaseStartupRecovery(
    requestValue: KnowledgeStartupReleaseRequest
  ): Promise<KnowledgeStartupReleaseResult> {
    const request = parseKnowledgeStartupReleaseRequest(requestValue);
    return this.updateState<KnowledgeStartupReleaseResult>((state) => {
      if (state.revision !== request.expectedRuntimeRevision) {
        return {
          value: {
            kind: "observation_changed",
            bundleId: request.bundleId,
            boundary: "runtime",
          },
        };
      }

      const reviewRaw = findBundleSlot(state, "reviews", request.bundleId);
      const review =
        reviewRaw === null
          ? createEmptyRuntimeReviewSnapshot(request.bundleId)
          : this.requireReviewSnapshot(request.bundleId, reviewRaw);
      if (review.revision !== request.expectedReviewRevision) {
        return {
          value: {
            kind: "observation_changed",
            bundleId: request.bundleId,
            boundary: "review",
          },
        };
      }

      const queueRaw = findBundleSlot(state, "queues", request.bundleId);
      const queue =
        queueRaw === null
          ? createEmptyRuntimeQueueSnapshot(request.bundleId)
          : this.requireQueueSnapshot(request.bundleId, queueRaw);
      const preservedPauseReason =
        queue.control.status === "paused" &&
        (queue.control.reason === "user" || queue.control.reason === "rate_limit")
          ? queue.control.reason
          : undefined;
      if (queue.revision !== request.expectedQueueRevision) {
        return {
          value: {
            kind: "observation_changed",
            bundleId: request.bundleId,
            boundary: "queue",
          },
        };
      }

      if (state.activeTransaction !== null) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "active_transaction_present",
          },
        };
      }
      if (state.activeForwardRevisionApply !== null) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "active_transaction_present",
          },
        };
      }

      for (const slot of state.queues) {
        if (slot.bundleId === request.bundleId) continue;
        const otherQueue = this.requireQueueSnapshot(slot.bundleId, slot.value);
        if (queueHasStartupWriteRecoveryEvidence(otherQueue)) {
          return {
            value: {
              kind: "blocked",
              bundleId: request.bundleId,
              reason: "other_bundle_apply_recovery_present",
            },
          };
        }
      }

      if (queue.applyCommit !== undefined) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "apply_commit_present",
          },
        };
      }
      if (queue.jobs.some((job) => job.status === "failed" && job.stage === "applying")) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "failed_apply_present",
          },
        };
      }
      if (queue.applyClaim !== undefined) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "apply_claim_present",
          },
        };
      }
      if (queue.jobs.some((job) => job.status === "processing")) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "processing_job_present",
          },
        };
      }
      if (queue.jobs.some((job) => job.status === "paused") && preservedPauseReason === undefined) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "paused_job_present",
          },
        };
      }

      for (const bundle of state.inputRevisions) {
        const hasPendingObservation = bundle.sources.some((source) =>
          source.observations.some(
            (observation) => observation.status === "allocated" || observation.status === "bound"
          )
        );
        if (hasPendingObservation) {
          return {
            value: {
              kind: "blocked",
              bundleId: request.bundleId,
              reason:
                bundle.bundleId === request.bundleId
                  ? "source_observation_pending"
                  : "other_bundle_apply_recovery_present",
            },
          };
        }
      }

      for (const slot of state.reviews) {
        const candidateReview =
          slot.bundleId === request.bundleId
            ? review
            : this.requireReviewSnapshot(slot.bundleId, slot.value);
        const acceptedRecords = candidateReview.records.filter(
          (record): record is AcceptedChangeSetReviewRecord => record.outcome === "accepted"
        );
        for (const record of acceptedRecords) {
          const classification = this.classifyAcceptedApplyState(
            state,
            candidateReview.bundleId,
            record
          );
          if (!acceptedClassificationIsTerminal(classification)) {
            return {
              value: {
                kind: "blocked",
                bundleId: request.bundleId,
                reason:
                  candidateReview.bundleId === request.bundleId
                    ? "accepted_review_unresolved"
                    : "other_bundle_apply_recovery_present",
              },
            };
          }
        }
      }

      if (preservedPauseReason !== undefined) {
        return {
          value: {
            kind: "unchanged",
            bundleId: request.bundleId,
            reason:
              preservedPauseReason === "user"
                ? "user_pause_preserved"
                : "rate_limit_pause_preserved",
            runtimeRevision: state.revision,
            reviewRevision: review.revision,
            queueSnapshot: queue,
          },
        };
      }

      if (queueRaw === null) {
        return {
          value: {
            kind: "unchanged",
            bundleId: request.bundleId,
            reason: "queue_absent",
            runtimeRevision: state.revision,
            reviewRevision: review.revision,
            queueSnapshot: queue,
          },
        };
      }
      if (queue.control.status === "running") {
        return {
          value: {
            kind: "unchanged",
            bundleId: request.bundleId,
            reason: "already_running",
            runtimeRevision: state.revision,
            reviewRevision: review.revision,
            queueSnapshot: queue,
          },
        };
      }
      if (queue.control.reason !== "startup_recovery") {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "queue_pause_not_releasable",
          },
        };
      }
      if (
        state.revision === Number.MAX_SAFE_INTEGER ||
        queue.revision === Number.MAX_SAFE_INTEGER
      ) {
        return {
          value: {
            kind: "blocked",
            bundleId: request.bundleId,
            reason: "revision_overflow",
          },
        };
      }

      const nextQueue: IngestQueueSnapshot = {
        ...queue,
        revision: queue.revision + 1,
        control: { status: "running" },
      };
      return {
        next: {
          ...state,
          revision: state.revision + 1,
          queues: replaceBundleSlot(state.queues, request.bundleId, nextQueue),
        },
        value: {
          kind: "released",
          bundleId: request.bundleId,
          previousRuntimeRevision: state.revision,
          runtimeRevision: state.revision + 1,
          previousQueueRevision: queue.revision,
          queueSnapshot: cloneJson(nextQueue),
        },
      };
    });
  }

  async loadNoJournalApplyContinueInput(
    reference: NoJournalApplyRecoveryReference,
    bundleValue: unknown
  ): Promise<ChangeSetTransactionApplyInput> {
    this.assertNoJournalApplyRecoveryReference(reference);
    const state = await this.readState();
    const record = this.requireAcceptedReviewByReference(state, reference);
    const classification = this.classifyAcceptedApplyState(state, reference.bundleId, record);
    if (classification.kind !== "requires_decision") {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        reference.bundleId,
        "state_not_actionable"
      );
    }
    const queue = this.requireNoJournalQueue(state, reference.bundleId);
    const claim = queue.applyClaim;
    if (!queueClaimMatchesAcceptedRecord(claim, record)) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        reference.bundleId,
        "queue_state_mismatch"
      );
    }
    const runtimeIdentity = createNoJournalApplyRuntimeIdentity(reference.bundleId, record, claim);
    const proof = parseApplyAuthorityRequest({
      ...runtimeIdentity,
      bundle: bundleValue as KnowledgeBundleConfig,
    });
    // A changed Manifest makes this accepted intent permanently unable to
    // publish its first journal; only the separately authorized Abandon path
    // remains actionable. https://github.com/yydspanda/obsidian-copilot/issues/2
    if (classification.candidate.continueBlockedReason !== undefined) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        reference.bundleId,
        "state_not_actionable"
      );
    }
    this.assertTransactionFileAccessAuthority(state, proof);
    return {
      changeSet: cloneJson(proof.changeSet),
      bundle: cloneJson(proof.bundle),
      jobClaim: { ...proof.jobClaim },
      manifestCommitIntent: cloneJson(proof.manifestCommitIntent),
      manifestCommitIntentDigest: proof.manifestCommitIntentDigest,
    };
  }

  async abandonNoJournalApply(
    reference: NoJournalApplyRecoveryReference,
    requestedAt: number
  ): Promise<NoJournalApplyAbandonReceipt> {
    this.assertNoJournalApplyRecoveryReference(reference);
    if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(reference.bundleId, "request_invalid");
    }
    return this.updateState<NoJournalApplyAbandonReceipt>((state) => {
      const record = this.requireAcceptedReviewByReference(state, reference);
      const classification = this.classifyAcceptedApplyState(state, reference.bundleId, record);
      if (classification.kind === "abandoned") {
        return {
          value: {
            ...classification.reference,
            jobId: classification.jobId,
            changeSetId: classification.changeSetId,
            abandonedAt: classification.abandonedAt,
          },
        };
      }
      if (classification.kind !== "requires_decision") {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "state_not_actionable"
        );
      }
      if (state.activeTransaction !== null || state.activeForwardRevisionApply !== null) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "write_evidence_conflict"
        );
      }
      const queue = this.requireNoJournalQueue(state, reference.bundleId);
      const claim = queue.applyClaim;
      const job = queue.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
      if (
        !queueClaimMatchesAcceptedRecord(claim, record) ||
        !queueJobMatchesAcceptedRecord(job, record) ||
        (job.status !== "processing" && job.status !== "failed") ||
        job.stage !== "applying" ||
        queue.applyCommit !== undefined
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "queue_state_mismatch"
        );
      }
      const hasSourceInputLedger = state.applyCommits.some(
        (ledger) =>
          ledger.bundleId === reference.bundleId &&
          ledger.sourceId === record.jobClaim.sourceId &&
          ledger.inputRevision === record.jobClaim.inputRevision
      );
      if (hasSourceInputLedger) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "write_evidence_conflict"
        );
      }
      if (
        queue.revision === Number.MAX_SAFE_INTEGER ||
        state.revision === Number.MAX_SAFE_INTEGER
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(
          reference.bundleId,
          "revision_overflow"
        );
      }

      const abandonedAt = Math.max(requestedAt, job.updatedAt, claim.startedAt, record.acceptedAt);
      const cancelled: KnowledgeIngestJob = {
        id: job.id,
        bundleId: job.bundleId,
        sourceId: job.sourceId,
        sourceContentHash: job.sourceContentHash,
        pipelineFingerprint: job.pipelineFingerprint,
        inputRevision: job.inputRevision,
        attempt: job.attempt,
        rerunRequested: false,
        createdAt: job.createdAt,
        updatedAt: abandonedAt,
        status: "cancelled",
        stage: "cancelled",
        cancelledAt: abandonedAt,
      };
      const abandonment: IngestApplyAbandonment = {
        jobId: claim.jobId,
        sourceId: claim.sourceId,
        sourceContentHash: claim.sourceContentHash,
        pipelineFingerprint: claim.pipelineFingerprint,
        inputRevision: claim.inputRevision,
        attempt: claim.attempt,
        startedAt: claim.startedAt,
        changeSetId: record.changeSetId,
        changeSetDigest: record.acceptedDigest,
        proposalDigest: record.proposalDigest,
        recordRevision: record.recordRevision,
        manifestCommitIntentDigest: record.manifestCommitIntentDigest,
        acceptedAt: record.acceptedAt,
        abandonedAt,
      };
      const { applyClaim: _applyClaim, ...queueWithoutClaim } = queue;
      void _applyClaim;
      const currentPausedAt =
        queue.control.status === "paused" ? queue.control.pausedAt : abandonedAt;
      const cancelledQueue: IngestQueueSnapshot = {
        ...queueWithoutClaim,
        revision: queue.revision + 1,
        control: {
          status: "paused",
          reason: "startup_recovery",
          pausedAt: Math.max(abandonedAt, currentPausedAt),
          detail: "An accepted apply was explicitly abandoned before journaling",
        },
        jobs: queue.jobs.map((candidate) =>
          candidate.id === cancelled.id ? cancelled : candidate
        ),
        applyAbandonments: [...queue.applyAbandonments, abandonment].sort(
          (left, right) =>
            left.abandonedAt - right.abandonedAt || compareIdentifiers(left.jobId, right.jobId)
        ),
      };
      const nextQueue = this.requireQueueSnapshot(
        reference.bundleId,
        promoteNoJournalRerun(cancelledQueue, job.sourceId, abandonedAt)
      );
      const receipt: NoJournalApplyAbandonReceipt = {
        bundleId: reference.bundleId,
        recoveryId: reference.recoveryId,
        jobId: job.id,
        changeSetId: record.changeSetId,
        abandonedAt,
      };
      return {
        next: {
          ...state,
          revision: state.revision + 1,
          queues: replaceBundleSlot(state.queues, reference.bundleId, nextQueue),
        },
        value: receipt,
      };
    });
  }

  async recordApplyCommit(
    journal: CommittedChangeSetTransactionJournal,
    receipt: TransactionCommitReceipt
  ): Promise<void> {
    let committed: CommittedChangeSetTransactionJournal;
    try {
      const parsed = this.requireTransaction(journal);
      if (parsed.phase !== "committed") {
        throw new KnowledgeApplyCommitProofError(journal.transactionId, "journal_not_committed");
      }
      committed = parsed;
    } catch (error) {
      if (error instanceof KnowledgeApplyCommitProofError) {
        throw error;
      }
      throw new KnowledgeApplyCommitProofError(journal.transactionId, "journal_invalid");
    }
    if (!transactionCommitReceiptMatchesJournal(receipt, committed)) {
      throw new KnowledgeApplyCommitProofError(committed.transactionId, "receipt_mismatch");
    }
    const intent = committed.manifestCommitIntent;
    if (
      committed.manifestCommitIntentDigest !== createManifestCommitIntentDigest(intent) ||
      intent.bundleId !== committed.bundleId ||
      intent.sourceId !== committed.jobClaim.sourceId ||
      intent.sourceContentHash !== committed.jobClaim.sourceContentHash ||
      intent.pipelineFingerprint !== committed.jobClaim.pipelineFingerprint ||
      intent.inputRevision !== committed.jobClaim.inputRevision ||
      intent.changeSetId !== committed.changeSetId
    ) {
      throw new KnowledgeApplyCommitProofError(committed.transactionId, "journal_invalid");
    }
    const identity = createApplyCommitLedgerIdentity(committed, receipt, intent);

    await this.updateState((state) => {
      const existing = state.applyCommits.find(
        (record) => record.transactionId === committed.transactionId
      );
      if (existing) {
        if (!applyCommitLedgerIdentityMatches(existing, identity)) {
          throw new KnowledgeApplyCommitLedgerConflictError(committed.transactionId);
        }
        return { value: undefined };
      }

      if (state.activeTransaction === null) {
        throw new KnowledgeApplyCommitProofError(committed.transactionId, "active_journal_missing");
      }
      const active = this.requireTransaction(state.activeTransaction);
      if (
        active.phase !== "committed" ||
        active.transactionId !== committed.transactionId ||
        active.revision !== committed.revision ||
        createChangeSetTransactionJournalDigest(active) !== identity.journalDigest ||
        !transactionCommitReceiptMatchesJournal(receipt, active)
      ) {
        throw new KnowledgeApplyCommitProofError(
          committed.transactionId,
          "active_journal_mismatch"
        );
      }

      const supersededOverlays = listSourceApplySupersededForwardRevisionOverlays(state, active);
      const lineageTimestampFloor = getSourceApplyForwardLineageTimestampFloor(supersededOverlays);
      if (active.createdAt < lineageTimestampFloor || active.committedAt < lineageTimestampFloor) {
        throw new KnowledgeApplyCommitAuthorityError(
          active.transactionId,
          "forward_lineage_time_mismatch"
        );
      }

      assertApplyCommitRuntimeAuthority(state, active);

      const currentRaw = findBundleSlot(state, "manifests", committed.bundleId);
      const actualManifest =
        currentRaw === null
          ? {
              version: 1 as const,
              bundleId: committed.bundleId,
              revision: 0,
              entries: [],
            }
          : this.requireManifest(committed.bundleId, currentRaw);
      const source = actualManifest.entries.find(
        (entry) => entry.sourceId === committed.jobClaim.sourceId
      );
      if (!source) {
        throw new KnowledgeApplyCommitManifestConflictError(
          committed.bundleId,
          committed.jobClaim.sourceId,
          "source_missing"
        );
      }
      const intentValidation = validateManifestCommitIntentForCommit(
        intent,
        actualManifest,
        committed.changeSet,
        committed.bundle
      );
      if (!intentValidation.valid) {
        throw new KnowledgeApplyCommitManifestConflictError(
          committed.bundleId,
          committed.jobClaim.sourceId,
          "intent_invalid",
          intentValidation.diagnostics
        );
      }
      assertSourceInputRevisionCanCommit(
        source,
        committed.bundleId,
        committed.jobClaim.inputRevision,
        actualManifest,
        state.applyCommits
      );
      let nextManifest = this.requireManifest(
        committed.bundleId,
        createCommittedSourceManifest(actualManifest, source, committed, receipt, intent)
      );
      for (const overlay of supersededOverlays) {
        nextManifest = this.requireManifest(
          committed.bundleId,
          projectKnowledgeForwardRevisionOverlayRemovalAfterSourceCommit(nextManifest, overlay)
        );
      }
      const ledgerRecord: KnowledgeApplyCommitLedgerRecord = {
        ...identity,
        manifestAfterRevision: nextManifest.revision,
        manifestAfterDigest: createSourceManifestDigest(nextManifest),
      };
      const applyCommits = [...state.applyCommits, ledgerRecord].sort((left, right) =>
        compareIdentifiers(left.transactionId, right.transactionId)
      );
      const stateWithLedger: KnowledgeRuntimeStoreSnapshot = {
        ...state,
        manifests: replaceBundleSlot(state.manifests, committed.bundleId, nextManifest),
        applyCommits,
      };
      const supersessions = supersededOverlays.map((overlay) => {
        const predecessor = state.forwardRevisionApplyCommits.find((candidate) =>
          forwardRevisionOverlayMatchesLedger(overlay, candidate)
        );
        if (predecessor === undefined) throw new KnowledgeRuntimeStoreCorruptError();
        return createKnowledgeForwardRevisionSupersessionRecord({
          predecessor: createForwardRevisionLedgerLineageRefForLedger(predecessor),
          successor: projectSourceApplyPageLedgerLineageRef(
            stateWithLedger,
            ledgerRecord,
            overlay.pagePath
          ),
          supersededAt: ledgerRecord.recordedAt,
        });
      });
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          manifests: replaceBundleSlot(state.manifests, committed.bundleId, nextManifest),
          applyCommits,
          forwardRevisionSupersessions: [
            ...state.forwardRevisionSupersessions,
            ...supersessions,
          ].sort((left, right) => compareIdentifiers(left.supersessionId, right.supersessionId)),
        },
        value: undefined,
      };
    });
  }

  async readActiveTransaction(): Promise<unknown> {
    const state = await this.readState();
    if (state.activeTransaction === null) {
      return null;
    }
    const active = this.requireTransaction(state.activeTransaction);
    if (active.phase === "prepared" || active.phase === "applying") {
      this.assertTransactionFileAccessAuthority(state, active);
    }
    return cloneJson(active);
  }

  async writeActiveTransaction(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    const candidate = this.requireTransaction(journal);
    if (expectedToken === null) {
      if (candidate.revision !== 0 || candidate.phase !== "prepared") {
        throw new TypeError("A new active transaction must begin as prepared at revision zero");
      }
    } else if (
      candidate.transactionId !== expectedToken.transactionId ||
      candidate.revision !== expectedToken.revision + 1
    ) {
      throw new TypeError("An active transaction replacement must advance its exact token once");
    }

    await this.updateState((state) => {
      const current =
        state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
      const actualToken = current
        ? { transactionId: current.transactionId, revision: current.revision }
        : null;
      if (!sameTransactionToken(expectedToken, actualToken)) {
        throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
      }
      if (expectedToken === null) {
        if (state.activeForwardRevisionApply !== null) {
          throw new TransactionStorageAuthorityError(
            "A forward revision apply already owns the Vault-global transaction reservation"
          );
        }
        this.assertTransactionFileAccessAuthority(state, candidate);
      } else if (current) {
        assertActiveTransactionTransition(current, candidate);
        if (current.phase === "prepared" && candidate.phase === "applying") {
          this.assertTransactionFileAccessAuthority(state, candidate);
        }
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          activeTransaction: cloneJson(candidate),
        },
        value: undefined,
      };
    });
  }

  async clearActiveTransaction(expectedToken: TransactionStorageToken): Promise<void> {
    await this.updateState((state) => {
      const current =
        state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
      const actualToken = current
        ? { transactionId: current.transactionId, revision: current.revision }
        : null;
      if (!sameTransactionToken(expectedToken, actualToken)) {
        throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
      }
      if (current?.phase !== "committed") {
        throw new TypeError("Only a committed active transaction may be acknowledged and cleared");
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          activeTransaction: null,
        },
        value: undefined,
      };
    });
  }

  async allocateInputRevision(
    request: AllocateSourceInputRevisionRequest
  ): Promise<SourceInputRevisionAllocation> {
    this.assertInputRevisionRequest(request);
    return this.updateState<SourceInputRevisionAllocation>((state) => {
      const manifestRaw = findBundleSlot(state, "manifests", request.bundleId);
      if (manifestRaw !== null) {
        const manifest = this.requireManifest(request.bundleId, manifestRaw);
        const retirements = parseKnowledgeSourceRetirements(manifest);
        if (!retirements.ok) throw new KnowledgeRuntimeStoreCorruptError();
        if (retirements.value.some((record) => record.source.sourceId === request.sourceId)) {
          throw new KnowledgeRuntimeSourceRetiredError(request.bundleId, request.sourceId);
        }
      }
      for (const candidateBundle of state.inputRevisions) {
        for (const candidateSource of candidateBundle.sources) {
          const replay = candidateSource.observations.find(
            (observation) => observation.captureId === request.captureId
          );
          if (!replay) {
            continue;
          }
          if (
            candidateBundle.bundleId !== request.bundleId ||
            candidateSource.sourceId !== request.sourceId
          ) {
            throw new SourceInputCaptureConflictError();
          }
          return {
            value: {
              bundleId: request.bundleId,
              sourceId: request.sourceId,
              captureId: replay.captureId,
              inputRevision: replay.inputRevision,
              observationToken: replay.observationToken,
            },
          };
        }
      }
      const observationToken = this.nextOpaqueId("observationToken");
      const allocatedAt = this.now();
      if (
        state.inputRevisions.some((candidateBundle) =>
          candidateBundle.sources.some((candidateSource) =>
            candidateSource.observations.some(
              (observation) => observation.observationToken === observationToken
            )
          )
        )
      ) {
        throw new SourceInputObservationTokenCollisionError();
      }
      const bundle = state.inputRevisions.find(
        (candidate) => candidate.bundleId === request.bundleId
      );
      const current = bundle?.sources.find((candidate) => candidate.sourceId === request.sourceId);
      if (current?.inputRevision === Number.MAX_SAFE_INTEGER) {
        throw new SourceInputRevisionOverflowError(request.bundleId, request.sourceId);
      }
      const nextRecord: KnowledgeRuntimeInputRevisionRecord = {
        sourceId: request.sourceId,
        inputRevision: current ? current.inputRevision + 1 : 1,
        managedAfterRevision: current?.managedAfterRevision ?? 0,
        ...(current?.legacyCheckpoint === undefined
          ? {}
          : { legacyCheckpoint: current.legacyCheckpoint }),
        observations: [
          ...(current?.observations ?? []),
          {
            observationToken,
            captureId: request.captureId,
            inputRevision: current ? current.inputRevision + 1 : 1,
            allocatedAt,
            status: "allocated" as const,
          },
        ],
      };
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          inputRevisions: replaceInputRevisionSource(
            state.inputRevisions,
            request.bundleId,
            nextRecord
          ),
        },
        value: {
          bundleId: request.bundleId,
          sourceId: request.sourceId,
          captureId: request.captureId,
          inputRevision: nextRecord.inputRevision,
          observationToken,
        },
      };
    });
  }

  async bindInputObservation(
    request: BindSourceInputObservationRequest
  ): Promise<BindSourceInputObservationResult> {
    this.assertObservationBindingRequest(request);
    return this.updateState<BindSourceInputObservationResult>((state) => {
      for (const bundle of state.inputRevisions) {
        for (const source of bundle.sources) {
          const current = source.observations.find(
            (observation) => observation.observationToken === request.observationToken
          );
          if (!current) {
            continue;
          }
          if (current.status === "retired") {
            throw new KnowledgeRuntimeSourceRetiredError(bundle.bundleId, source.sourceId);
          }
          const manifestRaw = findBundleSlot(state, "manifests", bundle.bundleId);
          if (manifestRaw !== null) {
            const manifest = this.requireManifest(bundle.bundleId, manifestRaw);
            const retirements = parseKnowledgeSourceRetirements(manifest);
            if (!retirements.ok) throw new KnowledgeRuntimeStoreCorruptError();
            if (retirements.value.some((record) => record.source.sourceId === source.sourceId)) {
              throw new KnowledgeRuntimeSourceRetiredError(bundle.bundleId, source.sourceId);
            }
          }
          if (current.status === "superseded") {
            if (
              current.sourceContentHash !== undefined &&
              (current.sourceContentHash !== request.sourceContentHash ||
                current.pipelineFingerprint !== request.pipelineFingerprint)
            ) {
              throw new SourceInputObservationBindingConflictError();
            }
            return {
              value: {
                kind: "superseded",
                bundleId: bundle.bundleId,
                sourceId: source.sourceId,
                captureId: current.captureId,
                inputRevision: current.inputRevision,
                supersededByInputRevision: current.supersededByInputRevision,
              },
            };
          }
          if (current.status === "bound" || current.status === "consumed") {
            if (
              current.sourceContentHash !== request.sourceContentHash ||
              current.pipelineFingerprint !== request.pipelineFingerprint
            ) {
              throw new SourceInputObservationBindingConflictError();
            }
            return {
              value: {
                kind: current.status === "consumed" ? "already_consumed" : "ready",
                observation: createBoundSourceInputObservation(
                  bundle.bundleId,
                  source.sourceId,
                  current
                ),
              },
            };
          }
          const boundAt = this.now();
          const effectiveBoundAt = Math.max(boundAt, current.allocatedAt);
          const observations: KnowledgeRuntimeSourceObservationRecord[] = source.observations.map(
            (observation) => {
              if (observation.observationToken === current.observationToken) {
                return {
                  ...observation,
                  status: "bound" as const,
                  sourceContentHash: request.sourceContentHash,
                  pipelineFingerprint: request.pipelineFingerprint,
                  boundAt: effectiveBoundAt,
                };
              }
              if (
                observation.inputRevision < current.inputRevision &&
                (observation.status === "allocated" || observation.status === "bound")
              ) {
                const observationBoundAt =
                  observation.status === "bound" ? observation.boundAt : undefined;
                return {
                  observationToken: observation.observationToken,
                  captureId: observation.captureId,
                  inputRevision: observation.inputRevision,
                  allocatedAt: observation.allocatedAt,
                  status: "superseded" as const,
                  ...(observation.status === "bound"
                    ? {
                        sourceContentHash: observation.sourceContentHash,
                        pipelineFingerprint: observation.pipelineFingerprint,
                        boundAt: observation.boundAt,
                      }
                    : {}),
                  settledAt: Math.max(
                    effectiveBoundAt,
                    observation.allocatedAt,
                    observationBoundAt ?? 0
                  ),
                  supersededByInputRevision: current.inputRevision,
                };
              }
              return observation;
            }
          );
          const nextSource: KnowledgeRuntimeInputRevisionRecord = { ...source, observations };
          const bound = observations.find(
            (observation) => observation.observationToken === current.observationToken
          );
          if (!bound || bound.status !== "bound") {
            throw new KnowledgeRuntimeStoreCorruptError();
          }
          return {
            next: {
              ...state,
              revision: nextStoreRevision(state),
              inputRevisions: replaceInputRevisionSource(
                state.inputRevisions,
                bundle.bundleId,
                nextSource
              ),
            },
            value: {
              kind: "ready",
              observation: createBoundSourceInputObservation(
                bundle.bundleId,
                source.sourceId,
                bound
              ),
            },
          };
        }
      }
      throw new SourceInputObservationTokenError();
    });
  }

  async settleInputObservation(
    observationToken: string
  ): Promise<SourceInputObservationSettlement> {
    this.assertObservationToken(observationToken);
    return this.updateState<SourceInputObservationSettlement>((state) => {
      for (const bundle of state.inputRevisions) {
        for (const source of bundle.sources) {
          const current = source.observations.find(
            (observation) => observation.observationToken === observationToken
          );
          if (!current) {
            continue;
          }
          if (current.status === "retired") {
            throw new KnowledgeRuntimeSourceRetiredError(bundle.bundleId, source.sourceId);
          }
          if (current.status === "allocated" || current.status === "bound") {
            const queueRaw = findBundleSlot(state, "queues", bundle.bundleId);
            const queue =
              queueRaw === null ? null : this.requireQueueSnapshot(bundle.bundleId, queueRaw);
            const highWatermark = queue?.sourceHighWatermarks.find(
              (candidate) => candidate.sourceId === source.sourceId
            );
            if (current.status === "allocated" || highWatermark === undefined) {
              return { value: { kind: "pending" } };
            }
            if (highWatermark.inputRevision < current.inputRevision) {
              return { value: { kind: "pending" } };
            }
            const settledAt = this.now();
            let terminal: KnowledgeRuntimeSourceObservationRecord;
            let value: SourceInputObservationSettlement;
            if (highWatermark.inputRevision === current.inputRevision) {
              if (queue === null) {
                throw new KnowledgeRuntimeStoreCorruptError();
              }
              if (
                highWatermark.sourceContentHash !== current.sourceContentHash ||
                highWatermark.pipelineFingerprint !== current.pipelineFingerprint
              ) {
                throw new KnowledgeRuntimeStoreCorruptError();
              }
              terminal = {
                ...current,
                status: "consumed",
                settledAt: Math.max(settledAt, current.boundAt),
                queueRevision: queue.revision,
              };
              value = { kind: "consumed", queueRevision: queue.revision };
            } else {
              terminal = {
                ...current,
                status: "superseded",
                settledAt: Math.max(settledAt, current.boundAt),
                supersededByInputRevision: highWatermark.inputRevision,
              };
              value = {
                kind: "superseded",
                supersededByInputRevision: highWatermark.inputRevision,
              };
            }
            const nextSource = {
              ...source,
              observations: source.observations.map((observation) =>
                observation.observationToken === observationToken ? terminal : observation
              ),
            };
            return {
              next: {
                ...state,
                revision: nextStoreRevision(state),
                inputRevisions: replaceInputRevisionSource(
                  state.inputRevisions,
                  bundle.bundleId,
                  nextSource
                ),
              },
              value,
            };
          }
          return {
            value:
              current.status === "consumed"
                ? { kind: "consumed", queueRevision: current.queueRevision }
                : {
                    kind: "superseded",
                    supersededByInputRevision: current.supersededByInputRevision,
                  },
          };
        }
      }
      throw new SourceInputObservationTokenError();
    });
  }

  async loadInputObservationRecoveryWork(
    bundleId: string
  ): Promise<SourceInputObservationRecoveryWork[]> {
    assertIdentifier(bundleId, "bundleId");
    const state = await this.readState();
    const bundle = state.inputRevisions.find((candidate) => candidate.bundleId === bundleId);
    if (!bundle) {
      return [];
    }
    return bundle.sources.flatMap((source): SourceInputObservationRecoveryWork[] =>
      source.observations.flatMap((observation): SourceInputObservationRecoveryWork[] => {
        if (observation.status === "allocated") {
          return [
            {
              kind: "allocated",
              allocation: {
                bundleId,
                sourceId: source.sourceId,
                captureId: observation.captureId,
                inputRevision: observation.inputRevision,
                observationToken: observation.observationToken,
              },
            },
          ];
        }
        if (observation.status === "bound") {
          return [
            {
              kind: "bound",
              observation: createBoundSourceInputObservation(
                bundleId,
                source.sourceId,
                observation
              ),
            },
          ];
        }
        return [];
      })
    );
  }

  async proveIngestExecution(
    requestValue: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeIngestExecutionProof>> {
    throwIfRuntimeExecutionProofAborted(signal);
    let request: Readonly<KnowledgeIngestExecutionProofRequest>;
    try {
      request = verifyKnowledgeIngestExecutionProofRequest(requestValue);
    } catch {
      throw new KnowledgeRuntimeIngestExecutionProofError();
    }
    const proof = await this.updateState<Readonly<KnowledgeIngestExecutionProof>>((state) => {
      const queueRaw = findBundleSlot(state, "queues", request.bundleId);
      const manifestRaw = findBundleSlot(state, "manifests", request.bundleId);
      if (queueRaw === null || manifestRaw === null) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      const queue = this.requireQueueSnapshot(request.bundleId, queueRaw);
      const manifest = this.requireManifest(request.bundleId, manifestRaw);
      const job = queue.jobs.find((candidate) => candidate.id === request.jobId);
      const tupleJobs = queue.jobs.filter(
        (candidate) =>
          candidate.sourceId === request.sourceId &&
          candidate.sourceContentHash === request.sourceContentHash &&
          candidate.pipelineFingerprint === request.pipelineFingerprint &&
          candidate.inputRevision === request.inputRevision
      );
      // A selected claim does not release the user-paused background queue.
      // The exact claim and consumed observation remain mandatory model authority.
      // https://github.com/yydspanda/obsidian-copilot/issues/18
      if (
        (queue.control.status !== "running" && queue.control.reason !== "user") ||
        !job ||
        tupleJobs.length !== 1 ||
        tupleJobs[0]?.id !== request.jobId ||
        job.status !== "processing" ||
        job.stage === "applying" ||
        job.bundleId !== request.bundleId ||
        job.sourceId !== request.sourceId ||
        job.sourceContentHash !== request.sourceContentHash ||
        job.pipelineFingerprint !== request.pipelineFingerprint ||
        job.inputRevision !== request.inputRevision ||
        job.attempt !== request.attempt ||
        job.startedAt !== request.startedAt
      ) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      const source = state.inputRevisions
        .find((bundle) => bundle.bundleId === request.bundleId)
        ?.sources.find((candidate) => candidate.sourceId === request.sourceId);
      const observations =
        source?.observations.filter(
          (observation) =>
            observation.status === "consumed" &&
            observation.inputRevision === request.inputRevision &&
            observation.sourceContentHash === request.sourceContentHash &&
            observation.pipelineFingerprint === request.pipelineFingerprint
        ) ?? [];
      const manifestEntries = manifest.entries.filter(
        (entry) => entry.sourceId === request.sourceId
      );
      if (observations.length !== 1 || manifestEntries.length !== 1) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      const observation = observations[0];
      if (observation.status !== "consumed" || observation.queueRevision > queue.revision) {
        throw new KnowledgeRuntimeIngestExecutionProofError();
      }
      return {
        value: Object.freeze({
          version: KNOWLEDGE_INGEST_EXECUTION_PROOF_VERSION,
          bundleId: request.bundleId,
          jobId: request.jobId,
          sourceId: request.sourceId,
          sourceContentHash: request.sourceContentHash,
          pipelineFingerprint: request.pipelineFingerprint,
          inputRevision: request.inputRevision,
          attempt: request.attempt,
          startedAt: request.startedAt,
          stage: job.stage,
          runtimeIdentityDigest: sha256(`knowledge-runtime-execution-owner-v1\n${state.runtimeId}`),
          runtimeRevision: state.revision,
          queueRevision: queue.revision,
          observationIdentityDigest: sha256(
            `knowledge-runtime-consumed-observation-v1\n${canonicalizeJson({
              runtimeId: state.runtimeId,
              bundleId: request.bundleId,
              sourceId: request.sourceId,
              observationToken: observation.observationToken,
              captureId: observation.captureId,
              inputRevision: observation.inputRevision,
              queueRevision: observation.queueRevision,
            })}`
          ),
          manifestRevision: manifest.revision,
          manifestDigest: createSourceManifestDigest(manifest),
        }),
      };
    });
    throwIfRuntimeExecutionProofAborted(signal);
    return proof;
  }

  private async migrateLegacyStore(): Promise<void> {
    let callbackCalled = false;
    let expectedText: string | undefined;
    const committedText = await this.file.process((currentText) => {
      if (callbackCalled) {
        throw new KnowledgeRuntimeAtomicWriteError();
      }
      callbackCalled = true;
      const value = parseUnknownRuntimeText(currentText, this.maxTextCharacters);
      if (!isRecord(value)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      if (value.version === KNOWLEDGE_RUNTIME_STORE_VERSION) {
        parseKnowledgeRuntimeStoreSnapshot(value);
        expectedText = currentText;
        return currentText;
      }
      if (value.version === RUNTIME_V8_STORE_VERSION) {
        expectedText = stringifyBoundedRuntimeValue(
          migrateRuntimeV8ToV9Snapshot(value),
          this.maxTextCharacters
        );
        return expectedText;
      }
      if (value.version === RUNTIME_V7_STORE_VERSION) {
        expectedText = stringifyBoundedRuntimeValue(
          migrateRuntimeV7ToV9Snapshot(value),
          this.maxTextCharacters
        );
        return expectedText;
      }
      if (value.version === RUNTIME_V6_STORE_VERSION) {
        expectedText = stringifyBoundedRuntimeValue(
          migrateRuntimeV7ToV9Snapshot(migrateRuntimeV6ToV7Snapshot(value)),
          this.maxTextCharacters
        );
        return expectedText;
      }
      if (value.version === RUNTIME_V5_STORE_VERSION) {
        expectedText = stringifyBoundedRuntimeValue(
          migrateRuntimeV7ToV9Snapshot(
            migrateRuntimeV6ToV7Snapshot(migrateRuntimeV5ToV6Snapshot(value))
          ),
          this.maxTextCharacters
        );
        return expectedText;
      }
      if (value.version === RUNTIME_V4_STORE_VERSION) {
        expectedText = stringifyBoundedRuntimeValue(
          migrateRuntimeV7ToV9Snapshot(
            migrateRuntimeV6ToV7Snapshot(
              migrateRuntimeV5ToV6Snapshot(migrateRuntimeV4ToV5Snapshot(value))
            )
          ),
          this.maxTextCharacters
        );
        return expectedText;
      }
      if (value.version === PREVIOUS_KNOWLEDGE_RUNTIME_STORE_VERSION) {
        expectedText = stringifyBoundedRuntimeValue(
          migrateRuntimeV7ToV9Snapshot(
            migrateRuntimeV6ToV7Snapshot(
              migrateRuntimeV5ToV6Snapshot(
                migrateRuntimeV4ToV5Snapshot(migrateRuntimeV3ToV4Snapshot(value))
              )
            )
          ),
          this.maxTextCharacters
        );
        return expectedText;
      }
      if (value.version === RUNTIME_V2_STORE_VERSION) {
        const runtimeId = this.nextOpaqueId("runtimeId");
        expectedText = stringifyBoundedRuntimeValue(
          migrateRuntimeV7ToV9Snapshot(
            migrateRuntimeV6ToV7Snapshot(
              migrateRuntimeV5ToV6Snapshot(
                migrateRuntimeV4ToV5Snapshot(
                  migrateRuntimeV3ToV4Snapshot(migrateRuntimeV2ToV3Snapshot(value, runtimeId))
                )
              )
            )
          ),
          this.maxTextCharacters
        );
        return expectedText;
      }
      if (value.version !== LEGACY_KNOWLEDGE_RUNTIME_STORE_VERSION) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      const runtimeId = this.nextOpaqueId("runtimeId");
      expectedText = stringifyBoundedRuntimeValue(
        migrateRuntimeV7ToV9Snapshot(
          migrateRuntimeV6ToV7Snapshot(
            migrateRuntimeV5ToV6Snapshot(
              migrateRuntimeV4ToV5Snapshot(
                migrateRuntimeV3ToV4Snapshot(migrateLegacyRuntimeSnapshot(value, runtimeId))
              )
            )
          )
        ),
        this.maxTextCharacters
      );
      return expectedText;
    });
    if (!callbackCalled || expectedText === undefined || committedText !== expectedText) {
      throw new KnowledgeRuntimeAtomicWriteError();
    }
    parseRuntimeText(committedText, this.maxTextCharacters);
  }

  private async readBundleSlot(
    collection: RuntimeBundleCollection,
    bundleId: string
  ): Promise<unknown> {
    assertIdentifier(bundleId, "bundleId");
    const value = findBundleSlot(await this.readState(), collection, bundleId);
    return value === null ? null : cloneJson(value);
  }

  private assertAcceptedReviewStartupIdentity(identity: AcceptedReviewStartupIdentity): void {
    const value: unknown = identity;
    if (!isRecord(value) || !isRecord(value.jobClaim)) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError("unknown", "request_invalid");
    }
    const claim = value.jobClaim;
    const valid =
      typeof value.bundleId === "string" &&
      value.bundleId.trim().length > 0 &&
      typeof value.changeSetId === "string" &&
      value.changeSetId.trim().length > 0 &&
      sha256Schema.safeParse(value.proposalDigest).success &&
      value.recordRevision === 1 &&
      Number.isSafeInteger(value.recordedAt) &&
      (value.recordedAt as number) >= 0 &&
      sha256Schema.safeParse(value.acceptedDigest).success &&
      sha256Schema.safeParse(value.manifestCommitIntentDigest).success &&
      Number.isSafeInteger(value.acceptedAt) &&
      (value.acceptedAt as number) >= 0 &&
      typeof claim.jobId === "string" &&
      claim.jobId.trim().length > 0 &&
      typeof claim.sourceId === "string" &&
      claim.sourceId.trim().length > 0 &&
      sha256Schema.safeParse(claim.sourceContentHash).success &&
      sha256Schema.safeParse(claim.pipelineFingerprint).success &&
      Number.isSafeInteger(claim.inputRevision) &&
      (claim.inputRevision as number) >= 0 &&
      Number.isSafeInteger(claim.attempt) &&
      (claim.attempt as number) > 0;
    if (!valid) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        typeof value.bundleId === "string" && value.bundleId.trim().length > 0
          ? value.bundleId
          : "unknown",
        "request_invalid"
      );
    }
  }

  private assertNoJournalApplyRecoveryReference(reference: NoJournalApplyRecoveryReference): void {
    const value: unknown = reference;
    if (
      !isRecord(value) ||
      typeof value.bundleId !== "string" ||
      value.bundleId.trim().length === 0 ||
      typeof value.recoveryId !== "string" ||
      !/^knowledge-no-journal-[a-f0-9]{64}$/.test(value.recoveryId)
    ) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        isRecord(value) && typeof value.bundleId === "string" && value.bundleId.trim().length > 0
          ? value.bundleId
          : "unknown",
        "request_invalid"
      );
    }
  }

  private requireAcceptedReviewByStartupIdentity(
    state: KnowledgeRuntimeStoreSnapshot,
    identity: AcceptedReviewStartupIdentity
  ): AcceptedChangeSetReviewRecord {
    const raw = findBundleSlot(state, "reviews", identity.bundleId);
    if (raw === null) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(identity.bundleId, "review_missing");
    }
    const review = this.requireReviewSnapshot(identity.bundleId, raw);
    const record = review.records.find(
      (candidate) => candidate.changeSetId === identity.changeSetId
    );
    if (!record) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        identity.bundleId,
        "review_record_missing"
      );
    }
    if (record.outcome !== "accepted" || !acceptedRecordMatchesStartupIdentity(identity, record)) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        identity.bundleId,
        "review_record_mismatch"
      );
    }
    return cloneJson(record);
  }

  private requireAcceptedReviewByReference(
    state: KnowledgeRuntimeStoreSnapshot,
    reference: NoJournalApplyRecoveryReference
  ): AcceptedChangeSetReviewRecord {
    const raw = findBundleSlot(state, "reviews", reference.bundleId);
    if (raw === null) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(reference.bundleId, "review_missing");
    }
    const review = this.requireReviewSnapshot(reference.bundleId, raw);
    const matches = review.records.filter(
      (record): record is AcceptedChangeSetReviewRecord =>
        record.outcome === "accepted" &&
        createNoJournalApplyRecoveryId(reference.bundleId, record) === reference.recoveryId
    );
    if (matches.length !== 1) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(
        reference.bundleId,
        "recovery_id_unknown"
      );
    }
    return cloneJson(matches[0]);
  }

  private requireNoJournalQueue(
    state: KnowledgeRuntimeStoreSnapshot,
    bundleId: string
  ): IngestQueueSnapshot {
    const raw = findBundleSlot(state, "queues", bundleId);
    if (raw === null) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "queue_missing");
    }
    return this.requireQueueSnapshot(bundleId, raw);
  }

  private classifyAcceptedApplyState(
    state: KnowledgeRuntimeStoreSnapshot,
    bundleId: string,
    record: AcceptedChangeSetReviewRecord
  ): NoJournalApplyRecoveryClassification {
    const queue = this.requireNoJournalQueue(state, bundleId);
    const reference = createNoJournalApplyRecoveryReference(bundleId, record);
    const job = queue.jobs.find((candidate) => candidate.id === record.jobClaim.jobId);
    const relatedAbandonments = queue.applyAbandonments.filter(
      (candidate) =>
        candidate.jobId === record.jobClaim.jobId || candidate.changeSetId === record.changeSetId
    );
    const sourceInputLedgers = state.applyCommits.filter(
      (ledger) =>
        ledger.bundleId === bundleId &&
        ledger.sourceId === record.jobClaim.sourceId &&
        ledger.inputRevision === record.jobClaim.inputRevision
    );
    const matchingLedgers = sourceInputLedgers.filter((ledger) =>
      ledgerMatchesAcceptedRecord(ledger, bundleId, record)
    );
    const active =
      state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
    const activeMatches =
      active !== null && transactionMatchesAcceptedRecord(active, bundleId, record);
    const marker = queue.applyCommit;
    const markerRelated =
      marker !== undefined &&
      (marker.jobId === record.jobClaim.jobId || marker.changeSetId === record.changeSetId);

    if (relatedAbandonments.length > 0) {
      const abandonment = relatedAbandonments[0];
      if (
        relatedAbandonments.length !== 1 ||
        !abandonmentMatchesAcceptedRecord(abandonment, record) ||
        !queueJobMatchesAcceptedRecord(job, record) ||
        job.status !== "cancelled" ||
        sourceInputLedgers.length > 0 ||
        activeMatches ||
        markerRelated
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
      }
      return {
        kind: "abandoned",
        reference,
        jobId: abandonment.jobId,
        changeSetId: abandonment.changeSetId,
        abandonedAt: abandonment.abandonedAt,
      };
    }

    if (sourceInputLedgers.length !== matchingLedgers.length || matchingLedgers.length > 1) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
    }

    if (markerRelated) {
      const ledger = matchingLedgers[0];
      if (
        !marker ||
        matchingLedgers.length !== 1 ||
        !queueJobMatchesAcceptedRecord(job, record) ||
        job.status !== "completed" ||
        job.changeSetId !== record.changeSetId ||
        marker.jobId !== record.jobClaim.jobId ||
        marker.sourceId !== record.jobClaim.sourceId ||
        marker.sourceContentHash !== record.jobClaim.sourceContentHash ||
        marker.pipelineFingerprint !== record.jobClaim.pipelineFingerprint ||
        marker.inputRevision !== record.jobClaim.inputRevision ||
        marker.attempt !== record.jobClaim.attempt ||
        marker.changeSetId !== record.changeSetId ||
        marker.changeSetDigest !== record.acceptedDigest ||
        marker.transactionId !== ledger.transactionId ||
        marker.commitRevision !== ledger.commitRevision ||
        marker.committedAt !== ledger.recordedAt ||
        (active !== null &&
          (!activeMatches ||
            active.phase !== "committed" ||
            active.transactionId !== marker.transactionId))
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
      }
      return { kind: "finalizing", reference, transactionId: marker.transactionId };
    }

    if (matchingLedgers.length === 1) {
      const ledger = matchingLedgers[0];
      if (activeMatches) {
        if (
          active?.phase !== "committed" ||
          active.transactionId !== ledger.transactionId ||
          !queueClaimMatchesAcceptedRecord(queue.applyClaim, record) ||
          !queueJobMatchesAcceptedRecord(job, record) ||
          (job.status !== "processing" && job.status !== "failed") ||
          job.stage !== "applying"
        ) {
          throw new KnowledgeNoJournalApplyRecoveryConflictError(
            bundleId,
            "write_evidence_conflict"
          );
        }
        assertApplyCommitRuntimeAuthority(state, active);
        return { kind: "finalizing", reference, transactionId: ledger.transactionId };
      }
      if (
        !queueJobMatchesAcceptedRecord(job, record) ||
        job.status !== "completed" ||
        job.changeSetId !== record.changeSetId
      ) {
        throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "write_evidence_conflict");
      }
      return { kind: "committed", reference, transactionId: ledger.transactionId };
    }

    if (activeMatches && active) {
      if (active.phase === "prepared" || active.phase === "applying") {
        this.assertTransactionFileAccessAuthority(state, active);
        return {
          kind: "active",
          reference,
          transactionId: active.transactionId,
          phase: active.phase,
        };
      }
      if (active.phase === "recovery_required") {
        assertApplyCommitRuntimeAuthority(state, active);
        return {
          kind: "blocked",
          reference,
          transactionId: active.transactionId,
          reason: "transaction_recovery_required",
        };
      }
      assertApplyCommitRuntimeAuthority(state, active);
      return { kind: "finalizing", reference, transactionId: active.transactionId };
    }

    const manifestRaw = findBundleSlot(state, "manifests", bundleId);
    const manifest =
      manifestRaw === null
        ? { version: 1 as const, bundleId, revision: 0, entries: [] }
        : this.requireManifest(bundleId, manifestRaw);
    const manifestReadSetChanged =
      manifest.revision !== record.manifestCommitIntent.expectedManifestRevision ||
      createSourceManifestDigest(manifest) !== record.manifestCommitIntent.expectedManifestDigest;
    const pending = queue.pendingReviews.find(
      (candidate) => candidate.jobId === record.jobClaim.jobId
    );
    if (
      queueJobMatchesAcceptedRecord(job, record) &&
      job.status === "awaiting_review" &&
      job.stage === "review" &&
      job.changeSetId === record.changeSetId &&
      pending?.kind === "durable" &&
      pending.changeSetId === record.changeSetId &&
      pending.proposalDigest === record.proposalDigest &&
      pending.reviewRecordRevision === 0 &&
      pending.recordedAt === record.recordedAt &&
      queue.applyClaim?.jobId !== record.jobClaim.jobId
    ) {
      return {
        kind: "accepted_not_started",
        reference,
        bundleId,
        changeSetId: record.changeSetId,
        jobId: record.jobClaim.jobId,
        // An accepted action can outlive its Manifest read-set before Queue apply starts.
        // Preserve the durable decision while preventing a doomed Continue loop.
        // https://github.com/yydspanda/obsidian-copilot/issues/2
        ...(manifestReadSetChanged
          ? { continueBlockedReason: "manifest_read_set_changed" as const }
          : {}),
      };
    }

    const claim = queue.applyClaim;
    if (
      !queueClaimMatchesAcceptedRecord(claim, record) ||
      !queueJobMatchesAcceptedRecord(job, record) ||
      (job.status !== "processing" && job.status !== "failed") ||
      job.stage !== "applying"
    ) {
      throw new KnowledgeNoJournalApplyRecoveryConflictError(bundleId, "queue_state_mismatch");
    }
    const runtimeIdentity = createNoJournalApplyRuntimeIdentity(bundleId, record, claim);
    assertApplyCommitRuntimeAuthority(state, runtimeIdentity);
    if (active) {
      return {
        kind: "blocked",
        reference,
        transactionId: active.transactionId,
        reason: "other_transaction_active",
      };
    }
    // A no-journal claim tied to an older Manifest can never succeed on retry.
    // It stays decision-required so its existing Abandon proof remains valid,
    // but callers must not advertise Continue. https://github.com/yydspanda/obsidian-copilot/issues/2
    return {
      kind: "requires_decision",
      candidate: {
        ...createNoJournalApplyRecoveryCandidate(bundleId, record, claim),
        ...(manifestReadSetChanged
          ? { continueBlockedReason: "manifest_read_set_changed" as const }
          : {}),
      },
    };
  }

  private async readState(): Promise<KnowledgeRuntimeStoreSnapshot> {
    return parseRuntimeText(await this.file.read(), this.maxTextCharacters);
  }

  private async confirmForwardRevisionPublication(
    evidence: Readonly<CapturedForwardRevisionPublicationEvidence>,
    attempted: Readonly<KnowledgeForwardRevisionPublicationReceiptV1>
  ): Promise<boolean> {
    try {
      const state = await this.readState();
      const raw = findForwardRevisionReviewSlot(state, evidence.intent.bundleId);
      if (raw === null) return false;
      const store = snapshotKnowledgeForwardRevisionReviewSnapshotV2(raw);
      const existing = store.records.find(
        (record) =>
          projectKnowledgeForwardRevisionReviewEntryProposalV2(record).proposal.request.intent
            .intentId === evidence.intent.intentId
      );
      if (!existing) return false;
      const publication = projectKnowledgeForwardRevisionReviewEntryProposalV2(existing);
      const request = publication.proposal.request;
      if (
        request.intentDigest !== evidence.intentDigest ||
        !exactJsonValuesEqual(request.intent, evidence.intent) ||
        !exactJsonValuesEqual(
          request.historicalReviewAuthority,
          evidence.historicalReviewAuthority
        ) ||
        request.selectedContent !== evidence.selectedContent ||
        request.selectedContentHash !== evidence.selectedContentHash ||
        request.intent.current.vaultObservedBeforeHash !== evidence.vaultObservedBeforeHash
      ) {
        return false;
      }
      const replay = createKnowledgeForwardRevisionPublicationReceipt({
        outcome: "already_published",
        proposal: publication.proposal,
        runtimeRevision: publication.publishedRuntimeRevision,
        proposalStoreRevision: publication.proposalStoreRevision,
      });
      return replay.publicationId === attempted.publicationId;
    } catch {
      return false;
    }
  }

  private async confirmSourceRetirement(
    command: KnowledgeSourceRetirementCommand
  ): Promise<KnowledgeSourceRetirementReceipt | undefined> {
    try {
      const state = await this.readState();
      const manifestRaw = findBundleSlot(state, "manifests", command.bundleId);
      if (manifestRaw === null) return undefined;
      const manifest = this.requireManifest(command.bundleId, manifestRaw);
      const retirements = parseKnowledgeSourceRetirements(manifest);
      if (!retirements.ok) return undefined;
      const record = retirements.value.find(
        (candidate) =>
          candidate.source.sourceId === command.sourceId &&
          candidate.requestToken === command.expectedToken &&
          candidate.reason === command.reason
      );
      return record
        ? createSourceRetirementReceipt(record, state.revision, "already_retired")
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async commitReviewRejection(
    bundleId: string,
    command: KnowledgeLiteralRejectCommand,
    decidedAt: number
  ): Promise<KnowledgeRuntimeReviewRejectReceipt> {
    return this.updateState((state) => {
      const queueRaw = findBundleSlot(state, "queues", bundleId);
      const reviewRaw = findBundleSlot(state, "reviews", bundleId);
      const projection = projectKnowledgeReviewRejection({
        bundleId,
        queue:
          queueRaw === null
            ? createEmptyRuntimeQueueSnapshot(bundleId)
            : this.requireQueueSnapshot(bundleId, queueRaw),
        review:
          reviewRaw === null
            ? createEmptyRuntimeReviewSnapshot(bundleId)
            : this.requireReviewSnapshot(bundleId, reviewRaw),
        command,
        decidedAt,
      });
      if (projection.kind === "already_rejected") {
        return {
          value: { ...projection.receipt, runtimeRevision: state.revision },
        };
      }
      const runtimeRevision = nextStoreRevision(state);
      return {
        next: {
          ...state,
          revision: runtimeRevision,
          queues: replaceBundleSlot(state.queues, bundleId, projection.queue),
          reviews: replaceBundleSlot(state.reviews, bundleId, projection.review),
        },
        value: { ...projection.receipt, runtimeRevision },
      };
    });
  }

  private async confirmReviewRejection(
    bundleId: string,
    command: KnowledgeLiteralRejectCommand,
    decidedAt: number
  ): Promise<KnowledgeRuntimeReviewRejectReceipt | undefined> {
    try {
      const state = await this.readState();
      const queueRaw = findBundleSlot(state, "queues", bundleId);
      const reviewRaw = findBundleSlot(state, "reviews", bundleId);
      if (queueRaw === null || reviewRaw === null) return undefined;
      const projection = projectKnowledgeReviewRejection({
        bundleId,
        queue: this.requireQueueSnapshot(bundleId, queueRaw),
        review: this.requireReviewSnapshot(bundleId, reviewRaw),
        command,
        decidedAt,
      });
      if (projection.kind !== "already_rejected") return undefined;
      return { ...projection.receipt, runtimeRevision: state.revision };
    } catch {
      return undefined;
    }
  }

  private async updateState<T>(
    transform: (state: KnowledgeRuntimeStoreSnapshot) => RuntimeMutation<T>
  ): Promise<T> {
    let callbackCalled = false;
    let expectedText: string | undefined;
    let result: T | undefined;
    let changedBundleIds: string[] = [];
    const committedText = await this.file.process((currentText) => {
      if (callbackCalled) {
        throw new KnowledgeRuntimeAtomicWriteError();
      }
      callbackCalled = true;
      const current = parseRuntimeText(currentText, this.maxTextCharacters);
      const mutation = transform(current);
      result = mutation.value;
      if (!mutation.next) {
        expectedText = currentText;
        return currentText;
      }
      const next = parseKnowledgeRuntimeStoreSnapshot(mutation.next);
      assertForwardRevisionApplyExclusiveMutation(current, next);
      this.assertUnfinishedTransactionFileAccessAuthority(next);
      changedBundleIds = findStudioChangedBundleIds(current, next);
      expectedText = stringifyBoundedRuntimeValue(next, this.maxTextCharacters);
      return expectedText;
    });
    if (!callbackCalled || expectedText === undefined || committedText !== expectedText) {
      throw new KnowledgeRuntimeAtomicWriteError();
    }
    parseRuntimeText(committedText, this.maxTextCharacters);
    this.emitStudioHints(changedBundleIds);
    return result as T;
  }

  private emitStudioHints(bundleIds: readonly string[]): void {
    for (const bundleId of bundleIds) {
      const listeners = this.studioListeners.get(bundleId);
      if (!listeners) continue;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // Studio hints are best-effort and never participate in Runtime commit success.
          // https://github.com/yydspanda/obsidian-copilot/issues/24
        }
      }
    }
  }

  private assertTransactionFileAccessAuthority(
    state: KnowledgeRuntimeStoreSnapshot,
    transaction: KnowledgeApplyAuthorityProof
  ): number {
    if (state.activeForwardRevisionApply !== null) {
      throw new TransactionStorageAuthorityError(
        "A forward revision Apply owns the Vault-global transaction reservation"
      );
    }
    const supersededOverlays = listSourceApplySupersededForwardRevisionOverlays(state, transaction);
    const lineageTimestampFloor = getSourceApplyForwardLineageTimestampFloor(supersededOverlays);
    if (
      "createdAt" in transaction &&
      (typeof transaction.createdAt !== "number" ||
        !Number.isSafeInteger(transaction.createdAt) ||
        transaction.createdAt < lineageTimestampFloor)
    ) {
      throw new KnowledgeApplyCommitAuthorityError(
        transaction.transactionId,
        "forward_lineage_time_mismatch"
      );
    }
    if (
      state.applyCommits.some((record) => record.transactionId === transaction.transactionId) ||
      state.forwardRevisionApplyCommits.some(
        (record) => record.transactionId === transaction.transactionId
      )
    ) {
      throw new KnowledgeApplyCommitLedgerConflictError(transaction.transactionId);
    }
    assertApplyCommitRuntimeAuthority(state, transaction);
    const manifestRaw = findBundleSlot(state, "manifests", transaction.bundleId);
    const actualManifest =
      manifestRaw === null
        ? {
            version: 1 as const,
            bundleId: transaction.bundleId,
            revision: 0,
            entries: [],
          }
        : this.requireManifest(transaction.bundleId, manifestRaw);
    const source = actualManifest.entries.find(
      (entry) => entry.sourceId === transaction.jobClaim.sourceId
    );
    if (!source) {
      throw new KnowledgeApplyCommitManifestConflictError(
        transaction.bundleId,
        transaction.jobClaim.sourceId,
        "source_missing"
      );
    }
    const intentValidation = validateManifestCommitIntentForCommit(
      transaction.manifestCommitIntent,
      actualManifest,
      transaction.changeSet,
      transaction.bundle
    );
    if (!intentValidation.valid) {
      throw new KnowledgeApplyCommitManifestConflictError(
        transaction.bundleId,
        transaction.jobClaim.sourceId,
        "intent_invalid",
        intentValidation.diagnostics
      );
    }
    assertSourceInputRevisionCanCommit(
      source,
      transaction.bundleId,
      transaction.jobClaim.inputRevision,
      actualManifest,
      state.applyCommits
    );
    return lineageTimestampFloor;
  }

  private assertUnfinishedTransactionFileAccessAuthority(
    state: KnowledgeRuntimeStoreSnapshot
  ): void {
    if (state.activeTransaction === null) {
      return;
    }
    const transaction = this.requireTransaction(state.activeTransaction);
    if (transaction.phase === "prepared" || transaction.phase === "applying") {
      this.assertTransactionFileAccessAuthority(state, transaction);
    }
  }

  private requireQueueSnapshot(bundleId: string, value: unknown): IngestQueueSnapshot {
    const parsed = parseIngestQueueSnapshot(value);
    const validation = validateIngestQueueSnapshot(value);
    if (!parsed.ok || !validation.valid || parsed.value.bundleId !== bundleId) {
      throw new KnowledgeRuntimeSlotValidationError("queue", bundleId);
    }
    return cloneJson(parsed.value);
  }

  private requireReviewSnapshot(bundleId: string, value: unknown): ChangeSetReviewSnapshot {
    const parsed = parseChangeSetReviewSnapshot(value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== bundleId
    ) {
      throw new KnowledgeRuntimeSlotValidationError("review", bundleId);
    }
    return cloneJson(parsed.value);
  }

  private requireManifest(bundleId: string, value: unknown): SourceManifest {
    const parsed = parseSourceManifest(value);
    const validation = validateSourceManifest(value);
    if (!parsed.ok || !validation.valid || parsed.value.bundleId !== bundleId) {
      throw new KnowledgeRuntimeSlotValidationError("manifest", bundleId);
    }
    return cloneJson(parsed.value);
  }

  private requireTransaction(value: unknown): ChangeSetTransactionJournal {
    const parsed = parseChangeSetTransactionJournal(value);
    const validation = validateChangeSetTransactionJournal(value);
    if (!parsed.ok || !validation.valid) {
      throw new KnowledgeRuntimeSlotValidationError("transaction");
    }
    return cloneJson(parsed.value);
  }

  private assertNextBundleRevision(
    candidateRevision: number,
    expectedRevision: number | null,
    subsystem: "queue" | "review" | "manifest"
  ): void {
    const nextRevision = expectedRevision === null ? 1 : expectedRevision + 1;
    if (
      expectedRevision === Number.MAX_SAFE_INTEGER ||
      candidateRevision !== nextRevision ||
      !Number.isSafeInteger(candidateRevision)
    ) {
      throw new TypeError(`${subsystem} snapshot must advance its observed revision exactly once`);
    }
  }

  private assertInputRevisionRequest(request: AllocateSourceInputRevisionRequest): void {
    assertIdentifier(request.bundleId, "bundleId");
    assertIdentifier(request.sourceId, "sourceId");
    assertIdentifier(request.captureId, "captureId");
  }

  private assertObservationBindingRequest(request: BindSourceInputObservationRequest): void {
    this.assertObservationToken(request.observationToken);
    if (
      !sha256Schema.safeParse(request.sourceContentHash).success ||
      !sha256Schema.safeParse(request.pipelineFingerprint).success
    ) {
      throw new TypeError("Source observation hashes must be lowercase SHA-256 values");
    }
  }

  private assertObservationToken(observationToken: string): void {
    if (!opaqueIdSchema.safeParse(observationToken).success) {
      throw new SourceInputObservationTokenError();
    }
  }

  private now(): number {
    const timestamp = this.clock();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("Runtime clock must return a non-negative safe integer");
    }
    return timestamp;
  }

  private nextOpaqueId(field: string): string {
    const value = this.opaqueIdFactory();
    if (!opaqueIdSchema.safeParse(value).success) {
      throw new TypeError(`${field} factory must return 32 lowercase hexadecimal characters`);
    }
    return value;
  }
}

function sameTransactionToken(
  left: TransactionStorageToken | null,
  right: TransactionStorageToken | null
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.transactionId === right.transactionId &&
      left.revision === right.revision)
  );
}

function selectActiveTransactionPayload(journal: ChangeSetTransactionJournal): JsonValue {
  return {
    version: journal.version,
    transactionId: journal.transactionId,
    bundleId: journal.bundleId,
    bundle: journal.bundle as unknown as JsonValue,
    changeSetId: journal.changeSetId,
    changeSetDigest: journal.changeSetDigest,
    manifestCommitIntent: journal.manifestCommitIntent as unknown as JsonValue,
    manifestCommitIntentDigest: journal.manifestCommitIntentDigest,
    jobClaim: journal.jobClaim as unknown as JsonValue,
    changeSet: journal.changeSet as unknown as JsonValue,
    targets: journal.targets as unknown as JsonValue,
    createdAt: journal.createdAt,
  };
}

function sameActiveTransactionPayload(
  left: ChangeSetTransactionJournal,
  right: ChangeSetTransactionJournal
): boolean {
  return (
    canonicalizeJson(selectActiveTransactionPayload(left)) ===
    canonicalizeJson(selectActiveTransactionPayload(right))
  );
}

function assertActiveTransactionTransition(
  current: ChangeSetTransactionJournal,
  candidate: ChangeSetTransactionJournal
): void {
  if (
    !sameActiveTransactionPayload(current, candidate) ||
    candidate.updatedAt < current.updatedAt
  ) {
    throw new TypeError("An active transaction replacement must preserve its immutable payload");
  }
  const validTransition =
    (current.phase === "prepared" &&
      candidate.phase === "applying" &&
      candidate.appliedCount === current.appliedCount) ||
    (current.phase === "applying" &&
      candidate.phase === "applying" &&
      candidate.appliedCount === current.appliedCount + 1) ||
    (current.phase === "applying" &&
      candidate.phase === "committed" &&
      current.appliedCount === current.targets.length &&
      candidate.appliedCount === candidate.targets.length) ||
    (current.phase === "applying" &&
      candidate.phase === "recovery_required" &&
      candidate.appliedCount === current.appliedCount);
  if (!validTransition) {
    throw new TypeError("An active transaction replacement violates the transaction state machine");
  }
}

interface KnowledgeRuntimeQueueStorageState {
  runtime: KnowledgeRuntimeStore;
  executionOwner: KnowledgeExecutionOwner;
}

const runtimeQueueStorageStates = new WeakMap<object, KnowledgeRuntimeQueueStorageState>();

function requireRuntimeQueueStorageState(value: unknown): KnowledgeRuntimeQueueStorageState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The Runtime Queue storage is invalid");
  }
  const state = runtimeQueueStorageStates.get(value);
  if (!state) throw new TypeError("The Runtime Queue storage is invalid");
  return state;
}

export class KnowledgeRuntimeQueueStorage implements QueueStorage {
  constructor(
    runtime: KnowledgeRuntimeStore,
    executionOwner: KnowledgeExecutionOwner = createKnowledgeExecutionOwner()
  ) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime Queue storage dependency is invalid");
    }
    KnowledgeExecutionOwner.assert(executionOwner);
    KnowledgeExecutionOwner.bindRuntime(executionOwner, runtime);
    runtimeQueueStorageStates.set(this, Object.freeze({ runtime, executionOwner }));
    Object.freeze(this);
  }

  getExecutionOwner(): KnowledgeExecutionOwner {
    return requireRuntimeQueueStorageState(this).executionOwner;
  }

  read(bundleId: string): Promise<unknown> {
    return requireRuntimeQueueStorageState(this).runtime.readQueue(bundleId);
  }

  write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null,
    authority?: QueueWriteAuthority
  ): Promise<void> {
    return requireRuntimeQueueStorageState(this).runtime.writeQueue(
      bundleId,
      snapshot,
      expectedRevision,
      authority
    );
  }
}

Object.freeze(KnowledgeRuntimeQueueStorage.prototype);
Object.freeze(KnowledgeRuntimeQueueStorage);

interface KnowledgeRuntimeReviewStorageState {
  runtime: KnowledgeRuntimeStore;
  executionOwner?: KnowledgeExecutionOwner;
}

const runtimeReviewStorageStates = new WeakMap<object, KnowledgeRuntimeReviewStorageState>();

function requireRuntimeReviewStorageState(value: unknown): KnowledgeRuntimeReviewStorageState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeRuntimeReviewStorage.prototype
  ) {
    throw new TypeError("The Runtime Review storage is invalid");
  }
  const state = runtimeReviewStorageStates.get(value);
  if (!state) throw new TypeError("The Runtime Review storage is invalid");
  return state;
}

export class KnowledgeRuntimeReviewStorage implements ReviewStorage {
  constructor(runtime: KnowledgeRuntimeStore, executionOwner?: KnowledgeExecutionOwner) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime Review storage dependency is invalid");
    }
    if (executionOwner !== undefined) {
      KnowledgeExecutionOwner.assert(executionOwner);
      KnowledgeExecutionOwner.bindRuntime(executionOwner, runtime);
    }
    runtimeReviewStorageStates.set(this, Object.freeze({ runtime, executionOwner }));
    Object.freeze(this);
  }

  static getExecutionOwner(value: unknown): KnowledgeExecutionOwner {
    const owner = requireRuntimeReviewStorageState(value).executionOwner;
    if (!owner) {
      throw new TypeError("The Runtime Review storage execution owner is unavailable");
    }
    KnowledgeExecutionOwner.assert(owner);
    return owner;
  }

  read(bundleId: string): Promise<unknown> {
    return requireRuntimeReviewStorageState(this).runtime.readReview(bundleId);
  }

  write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    return requireRuntimeReviewStorageState(this).runtime.writeReview(
      bundleId,
      snapshot,
      expectedRevision
    );
  }
}

Object.freeze(KnowledgeRuntimeReviewStorage.prototype);
Object.freeze(KnowledgeRuntimeReviewStorage);

const runtimeReviewRejectPortStates = new WeakMap<object, KnowledgeRuntimeStore>();

function requireRuntimeReviewRejectPortState(value: unknown): KnowledgeRuntimeStore {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeRuntimeReviewRejectPort.prototype
  ) {
    throw new TypeError("The Runtime Review Reject port is invalid");
  }
  const runtime = runtimeReviewRejectPortStates.get(value);
  if (!runtime) throw new TypeError("The Runtime Review Reject port is invalid");
  return runtime;
}

export class KnowledgeRuntimeReviewRejectPort {
  constructor(runtime: KnowledgeRuntimeStore) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime Review Reject dependency is invalid");
    }
    runtimeReviewRejectPortStates.set(this, runtime);
    Object.freeze(this);
  }

  rejectReviewAtomically(
    bundleId: string,
    command: unknown
  ): Promise<KnowledgeRuntimeReviewRejectReceipt> {
    return requireRuntimeReviewRejectPortState(this).rejectReviewAtomically(bundleId, command);
  }
}

Object.freeze(KnowledgeRuntimeReviewRejectPort.prototype);
Object.freeze(KnowledgeRuntimeReviewRejectPort);

interface RuntimeForwardRevisionProposalPortState {
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly workflowLease: KnowledgeProductionWorkflowExecutionLease;
  readonly readAuthority: (
    value: unknown
  ) => Promise<Readonly<KnowledgeForwardRevisionProposalAuthorityV1> | null>;
  readonly readReview: (
    bundleId: string
  ) => Promise<Readonly<KnowledgeForwardRevisionReviewSnapshotV2>>;
  readonly publish: (
    value: KnowledgeForwardRevisionProposalPublicationEvidence
  ) => Promise<Readonly<KnowledgeForwardRevisionPublicationReceiptV1>>;
}

interface RuntimeForwardRevisionStudioPortState {
  readonly executionOwner?: KnowledgeExecutionOwner;
  readonly read: (bundleId: string) => Promise<Readonly<KnowledgeForwardRevisionStudioSnapshot>>;
  readonly abandon: (
    acceptedIdentity: unknown,
    expectedRuntimeRevision: number
  ) => Promise<Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>>;
}

interface RuntimeForwardRevisionValidationPortState {
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly readAuthority: (
    value: unknown
  ) => Promise<Readonly<KnowledgeForwardRevisionValidationAuthorityV1> | null>;
}

interface RuntimeForwardRevisionApplyPortState {
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly workflowLease: KnowledgeProductionWorkflowExecutionLease;
  readonly readAuthority: (
    value: unknown
  ) => Promise<Readonly<KnowledgeForwardRevisionApplyAuthority> | null>;
  readonly begin: (
    authorization: ForwardRevisionApplyBeginAuthorization
  ) => Promise<Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1>>;
  readonly confirmBegin: (
    projection: Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1>
  ) => Promise<Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1> | undefined>;
}

interface RuntimeForwardRevisionApplyRecoveryPortState {
  readonly runtime: KnowledgeRuntimeStore;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly readActive: () => Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1> | null>;
  readonly advance: (
    authorization: ForwardRevisionApplyTransitionAuthorization
  ) => Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1>>;
  readonly confirmAdvance: (
    projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>
  ) => Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1> | undefined>;
  readonly finalize: (
    authorization: ForwardRevisionApplyTransitionAuthorization
  ) => Promise<Readonly<KnowledgeForwardRevisionApplyLedgerRecord>>;
  readonly confirmFinalize: (
    projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>
  ) => Promise<Readonly<KnowledgeForwardRevisionApplyLedgerRecord> | undefined>;
  readonly terminalize: (
    authorization: ForwardRevisionApplyTransitionAuthorization
  ) => Promise<Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>>;
  readonly confirmTerminalize: (
    projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>
  ) => Promise<Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1> | undefined>;
}

class ForwardRevisionApplyBeginAuthorization {
  private constructor() {
    Object.freeze(this);
  }

  static create(): ForwardRevisionApplyBeginAuthorization {
    return new ForwardRevisionApplyBeginAuthorization();
  }
}

interface ForwardRevisionApplyBeginAuthorizationState {
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly workflowLease: KnowledgeProductionWorkflowExecutionLease;
  readonly capability: KnowledgeForwardRevisionApplyCapability;
  readonly projection: Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1>;
}

const forwardRevisionApplyBeginAuthorizationStates = new WeakMap<
  object,
  Readonly<ForwardRevisionApplyBeginAuthorizationState>
>();

class ForwardRevisionApplyTransitionAuthorization {
  private constructor() {
    Object.freeze(this);
  }

  static create(): ForwardRevisionApplyTransitionAuthorization {
    return new ForwardRevisionApplyTransitionAuthorization();
  }
}

interface ForwardRevisionApplyTransitionAuthorizationState {
  readonly operation: "advance" | "finalize" | "terminalize";
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly capability: KnowledgeForwardRevisionApplyTransitionCapability;
  readonly projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>;
}

const forwardRevisionApplyTransitionAuthorizationStates = new WeakMap<
  object,
  Readonly<ForwardRevisionApplyTransitionAuthorizationState>
>();

function requireForwardRevisionApplyBeginAuthorization(
  value: unknown
): Readonly<ForwardRevisionApplyBeginAuthorizationState> {
  let state: Readonly<ForwardRevisionApplyBeginAuthorizationState> | undefined;
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== ForwardRevisionApplyBeginAuthorization.prototype
    ) {
      throw new TypeError();
    }
    state = forwardRevisionApplyBeginAuthorizationStates.get(value);
    if (!state) throw new TypeError();
  } catch {
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
  forwardRevisionApplyBeginAuthorizationStates.delete(value);
  try {
    state.workflowLease.assertCurrent();
    if (
      !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
        state.workflowLease,
        state.executionOwner
      )
    ) {
      throw new TypeError();
    }
    KnowledgeForwardRevisionApplyCapability.assertExecutionOwner(
      state.capability,
      state.executionOwner
    );
    if (
      !exactJsonValuesEqual(
        KnowledgeForwardRevisionApplyCapability.project(state.capability),
        state.projection
      )
    ) {
      throw new TypeError();
    }
    return state;
  } catch {
    throw createForwardRevisionApplyPortError("aborted");
  }
}

function requireForwardRevisionApplyTransitionAuthorization(
  value: unknown,
  expectedOperation: "advance" | "finalize" | "terminalize"
): Readonly<ForwardRevisionApplyTransitionAuthorizationState> {
  let state: Readonly<ForwardRevisionApplyTransitionAuthorizationState> | undefined;
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== ForwardRevisionApplyTransitionAuthorization.prototype
    ) {
      throw new TypeError();
    }
    state = forwardRevisionApplyTransitionAuthorizationStates.get(value);
    if (!state || state.operation !== expectedOperation) throw new TypeError();
  } catch {
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
  forwardRevisionApplyTransitionAuthorizationStates.delete(value);
  try {
    KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
      state.capability,
      state.executionOwner
    );
    const currentProjection = snapshotForwardRevisionApplyTransitionProjection(
      KnowledgeForwardRevisionApplyTransitionCapability.project(state.capability)
    );
    if (!exactJsonValuesEqual(currentProjection, state.projection)) throw new TypeError();
    return state;
  } catch {
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
}

function assertForwardRevisionApplyTransitionAuthorizationCurrent(
  state: Readonly<ForwardRevisionApplyTransitionAuthorizationState>,
  expectedProjection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>,
  expectedOperation: "advance" | "finalize" | "terminalize"
): void {
  try {
    if (state.operation !== expectedOperation) throw new TypeError();
    KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
      state.capability,
      state.executionOwner
    );
    const currentProjection = snapshotForwardRevisionApplyTransitionProjection(
      KnowledgeForwardRevisionApplyTransitionCapability.project(state.capability)
    );
    if (
      !exactJsonValuesEqual(currentProjection, state.projection) ||
      !exactJsonValuesEqual(currentProjection, expectedProjection)
    ) {
      throw new TypeError();
    }
  } catch {
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
}

export type KnowledgeForwardRevisionApplyPortErrorCode =
  | "dependency_invalid"
  | "request_invalid"
  | "authority_unavailable"
  | "conflict"
  | "resource_limit"
  | "aborted"
  | "commit_uncertain";

const forwardRevisionApplyErrorCodes = new WeakMap<
  object,
  KnowledgeForwardRevisionApplyPortErrorCode
>();
const FORWARD_REVISION_APPLY_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionApplyPortError");

export class KnowledgeForwardRevisionApplyPortError extends Error {
  constructor(token: symbol, code: KnowledgeForwardRevisionApplyPortErrorCode) {
    if (token !== FORWARD_REVISION_APPLY_ERROR_TOKEN) throw new TypeError();
    super("Forward revision Apply could not be completed");
    this.name = code === "aborted" ? "AbortError" : "KnowledgeForwardRevisionApplyPortError";
    forwardRevisionApplyErrorCodes.set(this, code);
    Object.freeze(this);
  }

  static inspect(value: unknown): KnowledgeForwardRevisionApplyPortErrorCode | undefined {
    return typeof value === "object" && value !== null
      ? forwardRevisionApplyErrorCodes.get(value)
      : undefined;
  }
}

function createForwardRevisionApplyPortError(
  code: KnowledgeForwardRevisionApplyPortErrorCode
): KnowledgeForwardRevisionApplyPortError {
  return new KnowledgeForwardRevisionApplyPortError(FORWARD_REVISION_APPLY_ERROR_TOKEN, code);
}

Object.freeze(KnowledgeForwardRevisionApplyPortError.prototype);
Object.freeze(KnowledgeForwardRevisionApplyPortError);

export interface KnowledgeForwardRevisionDecisionRequest {
  readonly command: unknown;
  readonly validationCapability?: unknown;
}

export interface KnowledgeForwardRevisionPendingDecisionProjection {
  readonly proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  readonly proposalDigest: string;
}

export type KnowledgeForwardRevisionDecisionAdmission =
  | Readonly<{
      kind: "pending";
      proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
      proposalDigest: string;
    }>
  | Readonly<{
      kind: "terminal";
      result: Readonly<KnowledgeForwardRevisionDecisionResult>;
    }>;

export interface KnowledgeForwardRevisionDecisionResult {
  readonly kind: "accepted" | "rejected";
  readonly outcome: "decided" | "already_decided";
  readonly decision: Readonly<KnowledgeForwardRevisionTerminalDecisionRecordV1>;
  readonly decisionDigest: string;
  readonly runtimeRevision: number;
  readonly decisionStoreRevision: number;
}

export type KnowledgeForwardRevisionDecisionPortErrorCode =
  | "dependency_invalid"
  | "request_invalid"
  | "authority_unavailable"
  | "conflict"
  | "resource_limit"
  | "aborted"
  | "commit_uncertain";

const forwardRevisionDecisionErrorCodes = new WeakMap<
  object,
  KnowledgeForwardRevisionDecisionPortErrorCode
>();
const FORWARD_REVISION_DECISION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionDecisionPortError");

export class KnowledgeForwardRevisionDecisionPortError extends Error {
  constructor(token: symbol, code: KnowledgeForwardRevisionDecisionPortErrorCode) {
    if (token !== FORWARD_REVISION_DECISION_ERROR_TOKEN) throw new TypeError();
    super("Forward revision decision could not be completed");
    this.name = code === "aborted" ? "AbortError" : "KnowledgeForwardRevisionDecisionPortError";
    forwardRevisionDecisionErrorCodes.set(this, code);
    Object.freeze(this);
  }

  static inspect(value: unknown): KnowledgeForwardRevisionDecisionPortErrorCode | undefined {
    return typeof value === "object" && value !== null
      ? forwardRevisionDecisionErrorCodes.get(value)
      : undefined;
  }
}

function createForwardRevisionDecisionPortError(
  code: KnowledgeForwardRevisionDecisionPortErrorCode
): KnowledgeForwardRevisionDecisionPortError {
  return new KnowledgeForwardRevisionDecisionPortError(FORWARD_REVISION_DECISION_ERROR_TOKEN, code);
}

Object.freeze(KnowledgeForwardRevisionDecisionPortError.prototype);
Object.freeze(KnowledgeForwardRevisionDecisionPortError);

interface RuntimeForwardRevisionDecisionPortState {
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly workflowLease: KnowledgeProductionWorkflowExecutionLease;
  readonly readPending: (
    command: Readonly<KnowledgeForwardRevisionReviewCommandV1>
  ) => Promise<Readonly<KnowledgeForwardRevisionDecisionAdmission> | null>;
  readonly decide: (
    authorization: ForwardRevisionDecisionMutationAuthorization
  ) => Promise<Readonly<KnowledgeForwardRevisionDecisionResult>>;
  readonly confirm: (
    command: Readonly<KnowledgeForwardRevisionReviewCommandV1>
  ) => Promise<Readonly<KnowledgeForwardRevisionDecisionResult> | undefined>;
}

class ForwardRevisionDecisionMutationAuthorization {
  private constructor() {
    Object.freeze(this);
  }

  static create(): ForwardRevisionDecisionMutationAuthorization {
    return new ForwardRevisionDecisionMutationAuthorization();
  }
}

interface ForwardRevisionDecisionMutationAuthorizationState {
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly workflowLease: KnowledgeProductionWorkflowExecutionLease;
  readonly command: Readonly<KnowledgeForwardRevisionReviewCommandV1>;
  readonly validationProjection?: Readonly<KnowledgeForwardRevisionValidationCapabilityProjectionV1>;
  readonly validationCapability?: KnowledgeForwardRevisionValidationCapability;
}

const forwardRevisionDecisionMutationAuthorizationStates = new WeakMap<
  object,
  Readonly<ForwardRevisionDecisionMutationAuthorizationState>
>();

function requireForwardRevisionDecisionMutationAuthorization(
  value: unknown
): Readonly<ForwardRevisionDecisionMutationAuthorizationState> {
  let prototype: object | null;
  try {
    prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
  } catch {
    throw createForwardRevisionDecisionPortError("dependency_invalid");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    prototype !== ForwardRevisionDecisionMutationAuthorization.prototype
  ) {
    throw createForwardRevisionDecisionPortError("dependency_invalid");
  }
  const state = forwardRevisionDecisionMutationAuthorizationStates.get(value);
  if (!state) throw createForwardRevisionDecisionPortError("dependency_invalid");
  forwardRevisionDecisionMutationAuthorizationStates.delete(value);
  try {
    state.workflowLease.assertCurrent();
    if (
      !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
        state.workflowLease,
        state.executionOwner
      )
    ) {
      throw new TypeError();
    }
  } catch {
    throw createForwardRevisionDecisionPortError("aborted");
  }
  return state;
}

const runtimeForwardRevisionPublicationPortStates = new WeakMap<
  object,
  Readonly<RuntimeForwardRevisionProposalPortState>
>();
const runtimeForwardRevisionStudioPortStates = new WeakMap<
  object,
  Readonly<RuntimeForwardRevisionStudioPortState>
>();
const runtimeForwardRevisionValidationPortStates = new WeakMap<
  object,
  Readonly<RuntimeForwardRevisionValidationPortState>
>();
const runtimeForwardRevisionDecisionPortStates = new WeakMap<
  object,
  Readonly<RuntimeForwardRevisionDecisionPortState>
>();
const runtimeForwardRevisionApplyPortStates = new WeakMap<
  object,
  Readonly<RuntimeForwardRevisionApplyPortState>
>();
const runtimeForwardRevisionApplyRecoveryPortStates = new WeakMap<
  object,
  Readonly<RuntimeForwardRevisionApplyRecoveryPortState>
>();

const FORWARD_REVISION_PINNED_RUNTIME_METHOD_NAMES = [
  "readForwardRevisionProposalAuthority",
  "readForwardRevisionValidationAuthority",
  "readForwardRevisionApplyAuthority",
  "beginForwardRevisionApply",
  "confirmForwardRevisionApplyBegin",
  "readActiveForwardRevisionApply",
  "advanceForwardRevisionApply",
  "confirmForwardRevisionApplyAdvance",
  "finalizeForwardRevisionApply",
  "confirmForwardRevisionApplyFinalization",
  "terminalizeForwardRevisionRecovery",
  "confirmForwardRevisionRecoveryTerminalization",
  "readForwardRevisionStudioBundle",
  "abandonForwardRevisionAcceptedReady",
  "readForwardRevisionReview",
  "publishForwardRevisionProposalAtomically",
  "readForwardRevisionPendingForDecision",
  "decideForwardRevisionAtomically",
  "confirmForwardRevisionDecision",
  "updateState",
  "now",
  "confirmForwardRevisionPublication",
  "readState",
  "assertUnfinishedTransactionFileAccessAuthority",
  "emitStudioHints",
] as const;
const FORWARD_REVISION_RUNTIME_STATE_KEYS = [
  "file",
  "clock",
  "maxTextCharacters",
  "opaqueIdFactory",
  "studioListeners",
] as const;
type RuntimeForwardRevisionPinnedMethod = (...args: never[]) => unknown;

function captureRuntimeForwardRevisionPublicationMethods(): ReadonlyMap<
  string,
  RuntimeForwardRevisionPinnedMethod
> {
  const methods = new Map<string, RuntimeForwardRevisionPinnedMethod>();
  for (const name of FORWARD_REVISION_PINNED_RUNTIME_METHOD_NAMES) {
    const descriptor = Object.getOwnPropertyDescriptor(KnowledgeRuntimeStore.prototype, name);
    const method: unknown = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (typeof method !== "function") {
      throw new TypeError("The Runtime forward-revision publication dependency is invalid");
    }
    methods.set(name, method as RuntimeForwardRevisionPinnedMethod);
  }
  return methods;
}

const runtimeForwardRevisionPublicationMethods = captureRuntimeForwardRevisionPublicationMethods();
const runtimeForwardRevisionPublicationMethod = runtimeForwardRevisionPublicationMethods.get(
  "publishForwardRevisionProposalAtomically"
) as KnowledgeRuntimeStore["publishForwardRevisionProposalAtomically"];
const runtimeForwardRevisionAuthorityReadMethod = runtimeForwardRevisionPublicationMethods.get(
  "readForwardRevisionProposalAuthority"
) as KnowledgeRuntimeStore["readForwardRevisionProposalAuthority"];
const runtimeForwardRevisionStudioReadMethod = runtimeForwardRevisionPublicationMethods.get(
  "readForwardRevisionStudioBundle"
) as KnowledgeRuntimeStore["readForwardRevisionStudioBundle"];
const runtimeForwardRevisionStudioAbandonMethod = runtimeForwardRevisionPublicationMethods.get(
  "abandonForwardRevisionAcceptedReady"
) as KnowledgeRuntimeStore["abandonForwardRevisionAcceptedReady"];
const runtimeForwardRevisionReviewReadMethod = runtimeForwardRevisionPublicationMethods.get(
  "readForwardRevisionReview"
) as KnowledgeRuntimeStore["readForwardRevisionReview"];
const runtimeForwardRevisionValidationAuthorityReadMethod =
  runtimeForwardRevisionPublicationMethods.get(
    "readForwardRevisionValidationAuthority"
  ) as KnowledgeRuntimeStore["readForwardRevisionValidationAuthority"];
const runtimeForwardRevisionApplyAuthorityReadMethod = runtimeForwardRevisionPublicationMethods.get(
  "readForwardRevisionApplyAuthority"
) as KnowledgeRuntimeStore["readForwardRevisionApplyAuthority"];
const runtimeForwardRevisionApplyBeginMethod = runtimeForwardRevisionPublicationMethods.get(
  "beginForwardRevisionApply"
) as KnowledgeRuntimeStore["beginForwardRevisionApply"];
const runtimeForwardRevisionApplyBeginConfirmMethod = runtimeForwardRevisionPublicationMethods.get(
  "confirmForwardRevisionApplyBegin"
) as KnowledgeRuntimeStore["confirmForwardRevisionApplyBegin"];
const runtimeForwardRevisionApplyActiveReadMethod = runtimeForwardRevisionPublicationMethods.get(
  "readActiveForwardRevisionApply"
) as KnowledgeRuntimeStore["readActiveForwardRevisionApply"];
const runtimeForwardRevisionApplyAdvanceMethod = runtimeForwardRevisionPublicationMethods.get(
  "advanceForwardRevisionApply"
) as KnowledgeRuntimeStore["advanceForwardRevisionApply"];
const runtimeForwardRevisionApplyAdvanceConfirmMethod =
  runtimeForwardRevisionPublicationMethods.get(
    "confirmForwardRevisionApplyAdvance"
  ) as KnowledgeRuntimeStore["confirmForwardRevisionApplyAdvance"];
const runtimeForwardRevisionApplyFinalizeMethod = runtimeForwardRevisionPublicationMethods.get(
  "finalizeForwardRevisionApply"
) as KnowledgeRuntimeStore["finalizeForwardRevisionApply"];
const runtimeForwardRevisionApplyFinalizeConfirmMethod =
  runtimeForwardRevisionPublicationMethods.get(
    "confirmForwardRevisionApplyFinalization"
  ) as KnowledgeRuntimeStore["confirmForwardRevisionApplyFinalization"];
const runtimeForwardRevisionRecoveryTerminalizeMethod =
  runtimeForwardRevisionPublicationMethods.get(
    "terminalizeForwardRevisionRecovery"
  ) as KnowledgeRuntimeStore["terminalizeForwardRevisionRecovery"];
const runtimeForwardRevisionRecoveryTerminalizeConfirmMethod =
  runtimeForwardRevisionPublicationMethods.get(
    "confirmForwardRevisionRecoveryTerminalization"
  ) as KnowledgeRuntimeStore["confirmForwardRevisionRecoveryTerminalization"];
const runtimeForwardRevisionPendingDecisionReadMethod =
  runtimeForwardRevisionPublicationMethods.get(
    "readForwardRevisionPendingForDecision"
  ) as KnowledgeRuntimeStore["readForwardRevisionPendingForDecision"];
const runtimeForwardRevisionDecisionMethod = runtimeForwardRevisionPublicationMethods.get(
  "decideForwardRevisionAtomically"
) as KnowledgeRuntimeStore["decideForwardRevisionAtomically"];
const runtimeForwardRevisionDecisionConfirmMethod = runtimeForwardRevisionPublicationMethods.get(
  "confirmForwardRevisionDecision"
) as KnowledgeRuntimeStore["confirmForwardRevisionDecision"];

function readRuntimeOwnDataField(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function requireAuthenticForwardRevisionPublicationRuntimeStore(
  runtime: KnowledgeRuntimeStore
): Readonly<AuthenticForwardRevisionPublicationRuntimeStoreState> {
  try {
    if (Object.getPrototypeOf(runtime) !== KnowledgeRuntimeStore.prototype) {
      throw new TypeError();
    }
    const state = authenticForwardRevisionPublicationRuntimeStores.get(runtime);
    if (!state) throw new TypeError();
    const allowedKeys = new Set<string>([
      ...FORWARD_REVISION_RUNTIME_STATE_KEYS,
      ...FORWARD_REVISION_PINNED_RUNTIME_METHOD_NAMES,
    ]);
    const ownKeys = Reflect.ownKeys(runtime);
    if (
      ownKeys.some((key) => typeof key !== "string" || !allowedKeys.has(key)) ||
      FORWARD_REVISION_RUNTIME_STATE_KEYS.some(
        (key) => readRuntimeOwnDataField(runtime, key) !== state[key]
      ) ||
      FORWARD_REVISION_PINNED_RUNTIME_METHOD_NAMES.some((name) => {
        const value = readRuntimeOwnDataField(runtime, name);
        return value !== undefined && value !== runtimeForwardRevisionPublicationMethods.get(name);
      })
    ) {
      throw new TypeError();
    }
    return state;
  } catch {
    throw new TypeError("The Runtime forward-revision publication dependency is invalid");
  }
}

function sealForwardRevisionPublicationRuntimeStore(runtime: KnowledgeRuntimeStore): void {
  requireAuthenticForwardRevisionPublicationRuntimeStore(runtime);
  try {
    for (const [name, method] of runtimeForwardRevisionPublicationMethods) {
      Object.defineProperty(runtime, name, {
        value: method,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
    Object.freeze(runtime);
  } catch {
    throw new TypeError("The Runtime forward-revision publication dependency is invalid");
  }
}

function requireRuntimeForwardRevisionStudioPortState(
  value: unknown
): Readonly<RuntimeForwardRevisionStudioPortState> {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeRuntimeForwardRevisionStudioPort.prototype
  ) {
    throw new TypeError("The Runtime forward-revision Studio port is invalid");
  }
  const state = runtimeForwardRevisionStudioPortStates.get(value);
  if (!state) throw new TypeError("The Runtime forward-revision Studio port is invalid");
  return state;
}

export class KnowledgeRuntimeForwardRevisionStudioPort {
  constructor(
    runtime: KnowledgeRuntimeStore,
    proofPort?: KnowledgeRuntimeIngestExecutionProofPort,
    workflowLease?: KnowledgeProductionWorkflowExecutionLease
  ) {
    try {
      if ((proofPort === undefined) !== (workflowLease === undefined)) throw new TypeError();
      let executionOwner: KnowledgeExecutionOwner | undefined;
      if (proofPort !== undefined && workflowLease !== undefined) {
        const proofState = requireRuntimeIngestExecutionProofPortState(proofPort);
        const runtimeState = requireAuthenticForwardRevisionPublicationRuntimeStore(runtime);
        KnowledgeProductionWorkflowExecutionLease.assert(workflowLease);
        if (
          Object.getPrototypeOf(proofPort) !== KnowledgeRuntimeIngestExecutionProofPort.prototype ||
          proofState.runtime !== runtime ||
          !runtimeState.productionExecutionBinding?.ownsWorkflowExecutionLease(workflowLease) ||
          !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
            workflowLease,
            proofState.executionOwner
          )
        ) {
          throw new TypeError();
        }
        executionOwner = proofState.executionOwner;
      }
      sealForwardRevisionPublicationRuntimeStore(runtime);
      runtimeForwardRevisionStudioPortStates.set(
        this,
        Object.freeze({
          ...(executionOwner === undefined ? {} : { executionOwner }),
          read: (bundleId: string) =>
            Reflect.apply(runtimeForwardRevisionStudioReadMethod, runtime, [bundleId]),
          abandon: (acceptedIdentity: unknown, expectedRuntimeRevision: number) =>
            Reflect.apply(runtimeForwardRevisionStudioAbandonMethod, runtime, [
              acceptedIdentity,
              expectedRuntimeRevision,
            ]),
        })
      );
      Object.freeze(this);
    } catch {
      throw new TypeError("The Runtime forward-revision Studio dependency is invalid");
    }
  }

  static assert(value: unknown): asserts value is KnowledgeRuntimeForwardRevisionStudioPort {
    requireRuntimeForwardRevisionStudioPortState(value);
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      const state = requireRuntimeForwardRevisionStudioPortState(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      return state.executionOwner !== undefined && state.executionOwner === executionOwner;
    } catch {
      return false;
    }
  }

  readForwardRevisionStudioBundle(
    bundleId: string
  ): Promise<Readonly<KnowledgeForwardRevisionStudioSnapshot>> {
    return requireRuntimeForwardRevisionStudioPortState(this).read(bundleId);
  }

  abandonForwardRevisionAcceptedReady(
    acceptedIdentity: unknown,
    expectedRuntimeRevision: number
  ): Promise<Readonly<KnowledgeForwardRevisionAbandonmentRecordV1>> {
    return requireRuntimeForwardRevisionStudioPortState(this).abandon(
      acceptedIdentity,
      expectedRuntimeRevision
    );
  }
}

Object.freeze(KnowledgeRuntimeForwardRevisionStudioPort.prototype);
Object.freeze(KnowledgeRuntimeForwardRevisionStudioPort);

function requireRuntimeForwardRevisionPublicationPortState(
  value: unknown
): Readonly<RuntimeForwardRevisionProposalPortState> {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !==
      KnowledgeRuntimeForwardRevisionProposalPublicationPort.prototype
  ) {
    throw new TypeError("The Runtime forward-revision publication port is invalid");
  }
  const state = runtimeForwardRevisionPublicationPortStates.get(value);
  if (!state) {
    throw new TypeError("The Runtime forward-revision publication port is invalid");
  }
  return state;
}

function assertRuntimeForwardRevisionPublicationPortCurrent(
  state: Readonly<RuntimeForwardRevisionProposalPortState>
): void {
  try {
    state.workflowLease.assertCurrent();
    if (
      !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
        state.workflowLease,
        state.executionOwner
      )
    ) {
      throw new TypeError();
    }
  } catch {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

export class KnowledgeRuntimeForwardRevisionProposalPublicationPort {
  constructor(
    runtime: KnowledgeRuntimeStore,
    proofPort: KnowledgeRuntimeIngestExecutionProofPort,
    workflowLease: KnowledgeProductionWorkflowExecutionLease
  ) {
    try {
      const proofState = requireRuntimeIngestExecutionProofPortState(proofPort);
      const runtimeState = requireAuthenticForwardRevisionPublicationRuntimeStore(runtime);
      KnowledgeProductionWorkflowExecutionLease.assert(workflowLease);
      if (
        Object.getPrototypeOf(proofPort) !== KnowledgeRuntimeIngestExecutionProofPort.prototype ||
        proofState.runtime !== runtime ||
        !runtimeState.productionExecutionBinding?.ownsWorkflowExecutionLease(workflowLease) ||
        !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          workflowLease,
          proofState.executionOwner
        )
      ) {
        throw new TypeError();
      }
      sealForwardRevisionPublicationRuntimeStore(runtime);
      runtimeForwardRevisionPublicationPortStates.set(
        this,
        Object.freeze({
          executionOwner: proofState.executionOwner,
          workflowLease,
          readAuthority: (value: unknown) =>
            Reflect.apply(runtimeForwardRevisionAuthorityReadMethod, runtime, [value]),
          readReview: (bundleId: string) =>
            Reflect.apply(runtimeForwardRevisionReviewReadMethod, runtime, [bundleId]),
          publish: (value: KnowledgeForwardRevisionProposalPublicationEvidence) =>
            Reflect.apply(runtimeForwardRevisionPublicationMethod, runtime, [value]),
        })
      );
      Object.freeze(this);
    } catch {
      throw new TypeError("The Runtime forward-revision publication dependency is invalid");
    }
  }

  static assert(
    value: unknown
  ): asserts value is KnowledgeRuntimeForwardRevisionProposalPublicationPort {
    requireRuntimeForwardRevisionPublicationPortState(value);
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      const state = requireRuntimeForwardRevisionPublicationPortState(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      return (
        state.executionOwner === executionOwner &&
        KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          state.workflowLease,
          executionOwner
        )
      );
    } catch {
      return false;
    }
  }

  async readForwardRevisionProposalAuthority(
    value: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionProposalAuthorityV1> | null> {
    const state = requireRuntimeForwardRevisionPublicationPortState(this);
    assertRuntimeForwardRevisionPublicationPortCurrent(state);
    const authority = await state.readAuthority(value);
    assertRuntimeForwardRevisionPublicationPortCurrent(state);
    return authority;
  }

  async readForwardRevisionReview(
    bundleId: string
  ): Promise<Readonly<KnowledgeForwardRevisionReviewSnapshotV2>> {
    const state = requireRuntimeForwardRevisionPublicationPortState(this);
    assertRuntimeForwardRevisionPublicationPortCurrent(state);
    const review = await state.readReview(bundleId);
    assertRuntimeForwardRevisionPublicationPortCurrent(state);
    return review;
  }

  async publishForwardRevisionProposalAtomically(
    value: KnowledgeForwardRevisionProposalPublicationEvidence
  ): Promise<Readonly<KnowledgeForwardRevisionPublicationReceiptV1>> {
    const state = requireRuntimeForwardRevisionPublicationPortState(this);
    assertRuntimeForwardRevisionPublicationPortCurrent(state);
    return state.publish(value);
  }

  async publish(
    value: KnowledgeForwardRevisionProposalPublicationEvidence
  ): Promise<Readonly<KnowledgeForwardRevisionPublicationReceiptV1>> {
    const state = requireRuntimeForwardRevisionPublicationPortState(this);
    assertRuntimeForwardRevisionPublicationPortCurrent(state);
    return state.publish(value);
  }
}

Object.freeze(KnowledgeRuntimeForwardRevisionProposalPublicationPort.prototype);
Object.freeze(KnowledgeRuntimeForwardRevisionProposalPublicationPort);

function requireRuntimeForwardRevisionValidationPortState(
  value: unknown
): Readonly<RuntimeForwardRevisionValidationPortState> {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeRuntimeForwardRevisionValidationPort.prototype
  ) {
    throw new TypeError("The Runtime forward-revision validation port is invalid");
  }
  const state = runtimeForwardRevisionValidationPortStates.get(value);
  if (!state) throw new TypeError("The Runtime forward-revision validation port is invalid");
  return state;
}

export class KnowledgeRuntimeForwardRevisionValidationPort {
  constructor(runtime: KnowledgeRuntimeStore, proofPort: KnowledgeRuntimeIngestExecutionProofPort) {
    const proofState = requireRuntimeIngestExecutionProofPortState(proofPort);
    if (
      Object.getPrototypeOf(proofPort) !== KnowledgeRuntimeIngestExecutionProofPort.prototype ||
      proofState.runtime !== runtime
    ) {
      throw new TypeError("The Runtime forward-revision validation dependency is invalid");
    }
    sealForwardRevisionPublicationRuntimeStore(runtime);
    runtimeForwardRevisionValidationPortStates.set(
      this,
      Object.freeze({
        executionOwner: proofState.executionOwner,
        readAuthority: (value: unknown) =>
          Reflect.apply(runtimeForwardRevisionValidationAuthorityReadMethod, runtime, [value]),
      })
    );
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgeRuntimeForwardRevisionValidationPort {
    requireRuntimeForwardRevisionValidationPortState(value);
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      const state = requireRuntimeForwardRevisionValidationPortState(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      return state.executionOwner === executionOwner;
    } catch {
      return false;
    }
  }

  readForwardRevisionValidationAuthority(
    value: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionValidationAuthorityV1> | null> {
    return requireRuntimeForwardRevisionValidationPortState(this).readAuthority(value);
  }
}

Object.freeze(KnowledgeRuntimeForwardRevisionValidationPort.prototype);
Object.freeze(KnowledgeRuntimeForwardRevisionValidationPort);

function requireRuntimeForwardRevisionApplyPortState(
  value: unknown
): Readonly<RuntimeForwardRevisionApplyPortState> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeRuntimeForwardRevisionApplyPort.prototype
    ) {
      throw new TypeError();
    }
    const state = runtimeForwardRevisionApplyPortStates.get(value);
    if (!state) throw new TypeError();
    return state;
  } catch {
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
}

export class KnowledgeRuntimeForwardRevisionApplyPort {
  constructor(
    runtime: KnowledgeRuntimeStore,
    proofPort: KnowledgeRuntimeIngestExecutionProofPort,
    workflowLease: KnowledgeProductionWorkflowExecutionLease
  ) {
    try {
      const proofState = requireRuntimeIngestExecutionProofPortState(proofPort);
      const runtimeState = requireAuthenticForwardRevisionPublicationRuntimeStore(runtime);
      KnowledgeProductionWorkflowExecutionLease.assert(workflowLease);
      if (
        Object.getPrototypeOf(proofPort) !== KnowledgeRuntimeIngestExecutionProofPort.prototype ||
        proofState.runtime !== runtime ||
        !runtimeState.productionExecutionBinding?.ownsWorkflowExecutionLease(workflowLease) ||
        !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          workflowLease,
          proofState.executionOwner
        )
      ) {
        throw new TypeError();
      }
      sealForwardRevisionPublicationRuntimeStore(runtime);
      runtimeForwardRevisionApplyPortStates.set(
        this,
        Object.freeze({
          executionOwner: proofState.executionOwner,
          workflowLease,
          readAuthority: (value: unknown) =>
            Reflect.apply(runtimeForwardRevisionApplyAuthorityReadMethod, runtime, [value]),
          begin: (authorization: ForwardRevisionApplyBeginAuthorization) =>
            Reflect.apply(runtimeForwardRevisionApplyBeginMethod, runtime, [authorization]),
          confirmBegin: (
            projection: Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1>
          ) => Reflect.apply(runtimeForwardRevisionApplyBeginConfirmMethod, runtime, [projection]),
        })
      );
      Object.freeze(this);
    } catch {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
  }

  static assert(value: unknown): asserts value is KnowledgeRuntimeForwardRevisionApplyPort {
    const state = requireRuntimeForwardRevisionApplyPortState(value);
    assertForwardRevisionApplyCurrent(state, new AbortController().signal);
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      const state = requireRuntimeForwardRevisionApplyPortState(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      return (
        state.executionOwner === executionOwner &&
        KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          state.workflowLease,
          executionOwner
        )
      );
    } catch {
      return false;
    }
  }

  async readAuthority(
    queryValue: unknown,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionApplyAuthority> | null> {
    const state = requireRuntimeForwardRevisionApplyPortState(this);
    assertForwardRevisionApplyCurrent(state, signal);
    let query: Readonly<KnowledgeForwardRevisionApplyAuthorityQuery>;
    try {
      query = snapshotKnowledgeForwardRevisionApplyAuthorityQuery(queryValue);
    } catch {
      throw createForwardRevisionApplyPortError("request_invalid");
    }
    const authority = await state.readAuthority(query);
    assertForwardRevisionApplyCurrent(state, signal);
    return authority;
  }

  async begin(
    capabilityValue: unknown,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionPreparedApplyJournalV1>> {
    const state = requireRuntimeForwardRevisionApplyPortState(this);
    assertForwardRevisionApplyCurrent(state, signal);
    let capability: KnowledgeForwardRevisionApplyCapability;
    let projection: Readonly<KnowledgeForwardRevisionApplyCapabilityProjectionV1>;
    try {
      KnowledgeForwardRevisionApplyCapability.assertExecutionOwner(
        capabilityValue,
        state.executionOwner
      );
      capability = capabilityValue as KnowledgeForwardRevisionApplyCapability;
      projection = KnowledgeForwardRevisionApplyCapability.project(capability);
      createPreparedForwardRevisionApplyJournal(projection);
    } catch {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
    assertForwardRevisionApplyCurrent(state, signal);
    const authorization = ForwardRevisionApplyBeginAuthorization.create();
    forwardRevisionApplyBeginAuthorizationStates.set(
      authorization,
      Object.freeze({
        executionOwner: state.executionOwner,
        workflowLease: state.workflowLease,
        capability,
        projection,
      })
    );
    try {
      return await state.begin(authorization);
    } catch (error) {
      const confirmed = await state.confirmBegin(projection);
      if (confirmed) return confirmed;
      if (KnowledgeForwardRevisionApplyPortError.inspect(error)) throw error;
      throw createForwardRevisionApplyPortError("commit_uncertain");
    }
  }
}

function assertForwardRevisionApplyCurrent(
  state: Readonly<RuntimeForwardRevisionApplyPortState>,
  signal: AbortSignal
): void {
  try {
    if (signal.aborted) throw new TypeError();
    state.workflowLease.assertCurrent();
    if (
      !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
        state.workflowLease,
        state.executionOwner
      )
    ) {
      throw new TypeError();
    }
  } catch {
    throw createForwardRevisionApplyPortError("aborted");
  }
}

Object.freeze(KnowledgeRuntimeForwardRevisionApplyPort.prototype);
Object.freeze(KnowledgeRuntimeForwardRevisionApplyPort);

function requireRuntimeForwardRevisionApplyRecoveryPortState(
  value: unknown
): Readonly<RuntimeForwardRevisionApplyRecoveryPortState> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeRuntimeForwardRevisionApplyRecoveryPort.prototype
    ) {
      throw new TypeError();
    }
    const state = runtimeForwardRevisionApplyRecoveryPortStates.get(value);
    if (!state) throw new TypeError();
    return state;
  } catch {
    throw createForwardRevisionApplyPortError("dependency_invalid");
  }
}

function assertForwardRevisionApplyRecoveryReadSignal(signal: AbortSignal): void {
  try {
    if (typeof signal !== "object" || signal === null || signal.aborted) throw new TypeError();
  } catch {
    throw createForwardRevisionApplyPortError("aborted");
  }
}

export class KnowledgeRuntimeForwardRevisionApplyRecoveryPort {
  constructor(
    runtime: KnowledgeRuntimeStore,
    proofPort: KnowledgeRuntimeIngestExecutionProofPort,
    workflowLease: KnowledgeProductionWorkflowExecutionLease
  ) {
    try {
      const proofState = requireRuntimeIngestExecutionProofPortState(proofPort);
      const runtimeState = requireAuthenticForwardRevisionPublicationRuntimeStore(runtime);
      KnowledgeProductionWorkflowExecutionLease.assert(workflowLease);
      workflowLease.assertCurrent();
      if (
        Object.getPrototypeOf(proofPort) !== KnowledgeRuntimeIngestExecutionProofPort.prototype ||
        proofState.runtime !== runtime ||
        !runtimeState.productionExecutionBinding?.ownsWorkflowExecutionLease(workflowLease) ||
        !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          workflowLease,
          proofState.executionOwner
        )
      ) {
        throw new TypeError();
      }
      sealForwardRevisionPublicationRuntimeStore(runtime);
      runtimeForwardRevisionApplyRecoveryPortStates.set(
        this,
        Object.freeze({
          runtime,
          executionOwner: proofState.executionOwner,
          readActive: () => Reflect.apply(runtimeForwardRevisionApplyActiveReadMethod, runtime, []),
          advance: (authorization: ForwardRevisionApplyTransitionAuthorization) =>
            Reflect.apply(runtimeForwardRevisionApplyAdvanceMethod, runtime, [authorization]),
          confirmAdvance: (
            projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>
          ) =>
            Reflect.apply(runtimeForwardRevisionApplyAdvanceConfirmMethod, runtime, [projection]),
          finalize: (authorization: ForwardRevisionApplyTransitionAuthorization) =>
            Reflect.apply(runtimeForwardRevisionApplyFinalizeMethod, runtime, [authorization]),
          confirmFinalize: (
            projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>
          ) =>
            Reflect.apply(runtimeForwardRevisionApplyFinalizeConfirmMethod, runtime, [projection]),
          terminalize: (authorization: ForwardRevisionApplyTransitionAuthorization) =>
            Reflect.apply(runtimeForwardRevisionRecoveryTerminalizeMethod, runtime, [
              authorization,
            ]),
          confirmTerminalize: (
            projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>
          ) =>
            Reflect.apply(runtimeForwardRevisionRecoveryTerminalizeConfirmMethod, runtime, [
              projection,
            ]),
        })
      );
      Object.freeze(this);
    } catch {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
  }

  static assert(value: unknown): asserts value is KnowledgeRuntimeForwardRevisionApplyRecoveryPort {
    requireRuntimeForwardRevisionApplyRecoveryPortState(value);
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      const state = requireRuntimeForwardRevisionApplyRecoveryPortState(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      return state.executionOwner === executionOwner;
    } catch {
      return false;
    }
  }

  static matchesRuntime(value: unknown, runtime: unknown): boolean {
    try {
      const state = requireRuntimeForwardRevisionApplyRecoveryPortState(value);
      return state.runtime === runtime;
    } catch {
      return false;
    }
  }

  async readActive(
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1> | null> {
    const state = requireRuntimeForwardRevisionApplyRecoveryPortState(this);
    assertForwardRevisionApplyRecoveryReadSignal(signal);
    const active = await state.readActive();
    assertForwardRevisionApplyRecoveryReadSignal(signal);
    return active;
  }

  async advance(
    capabilityValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionApplyJournalV1>> {
    const state = requireRuntimeForwardRevisionApplyRecoveryPortState(this);
    let capability: KnowledgeForwardRevisionApplyTransitionCapability;
    let projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>;
    try {
      KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
        capabilityValue,
        state.executionOwner
      );
      capability = capabilityValue as KnowledgeForwardRevisionApplyTransitionCapability;
      projection = snapshotForwardRevisionApplyTransitionProjection(
        KnowledgeForwardRevisionApplyTransitionCapability.project(capability)
      );
      if (projection.transition === "finalize") throw new TypeError();
    } catch {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
    const authorization = ForwardRevisionApplyTransitionAuthorization.create();
    forwardRevisionApplyTransitionAuthorizationStates.set(
      authorization,
      Object.freeze({
        operation: "advance" as const,
        executionOwner: state.executionOwner,
        capability,
        projection,
      })
    );
    try {
      return await state.advance(authorization);
    } catch (error) {
      try {
        const confirmed = await state.confirmAdvance(projection);
        if (confirmed) return confirmed;
      } catch {
        // The original sanitized result remains authoritative when confirmation cannot read.
        // https://github.com/yydspanda/obsidian-copilot/issues/24
      }
      if (KnowledgeForwardRevisionApplyPortError.inspect(error)) throw error;
      throw createForwardRevisionApplyPortError("commit_uncertain");
    }
  }

  async finalize(
    capabilityValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionApplyLedgerRecord>> {
    const state = requireRuntimeForwardRevisionApplyRecoveryPortState(this);
    let capability: KnowledgeForwardRevisionApplyTransitionCapability;
    let projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>;
    try {
      KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
        capabilityValue,
        state.executionOwner
      );
      capability = capabilityValue as KnowledgeForwardRevisionApplyTransitionCapability;
      projection = snapshotForwardRevisionApplyTransitionProjection(
        KnowledgeForwardRevisionApplyTransitionCapability.project(capability)
      );
      if (projection.transition !== "finalize") throw new TypeError();
    } catch {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
    const authorization = ForwardRevisionApplyTransitionAuthorization.create();
    forwardRevisionApplyTransitionAuthorizationStates.set(
      authorization,
      Object.freeze({
        operation: "finalize" as const,
        executionOwner: state.executionOwner,
        capability,
        projection,
      })
    );
    try {
      return await state.finalize(authorization);
    } catch (error) {
      try {
        const confirmed = await state.confirmFinalize(projection);
        if (confirmed) return confirmed;
      } catch {
        // The original sanitized result remains authoritative when confirmation cannot read.
        // https://github.com/yydspanda/obsidian-copilot/issues/24
      }
      if (KnowledgeForwardRevisionApplyPortError.inspect(error)) throw error;
      throw createForwardRevisionApplyPortError("commit_uncertain");
    }
  }

  async terminalize(
    capabilityValue: unknown
  ): Promise<Readonly<KnowledgeForwardRevisionRecoveryTerminalRecordV1>> {
    const state = requireRuntimeForwardRevisionApplyRecoveryPortState(this);
    let capability: KnowledgeForwardRevisionApplyTransitionCapability;
    let projection: Readonly<KnowledgeForwardRevisionApplyTransitionCapabilityProjectionV1>;
    try {
      KnowledgeForwardRevisionApplyTransitionCapability.assertExecutionOwner(
        capabilityValue,
        state.executionOwner
      );
      capability = capabilityValue as KnowledgeForwardRevisionApplyTransitionCapability;
      projection = snapshotForwardRevisionApplyTransitionProjection(
        KnowledgeForwardRevisionApplyTransitionCapability.project(capability)
      );
      if (projection.transition !== "terminalize") throw new TypeError();
    } catch {
      throw createForwardRevisionApplyPortError("dependency_invalid");
    }
    const authorization = ForwardRevisionApplyTransitionAuthorization.create();
    forwardRevisionApplyTransitionAuthorizationStates.set(
      authorization,
      Object.freeze({
        operation: "terminalize" as const,
        executionOwner: state.executionOwner,
        capability,
        projection,
      })
    );
    try {
      return await state.terminalize(authorization);
    } catch (error) {
      try {
        const confirmed = await state.confirmTerminalize(projection);
        if (confirmed) return confirmed;
      } catch {
        // The original sanitized result remains authoritative when confirmation cannot read.
        // https://github.com/yydspanda/obsidian-copilot/issues/24
      }
      if (KnowledgeForwardRevisionApplyPortError.inspect(error)) throw error;
      throw createForwardRevisionApplyPortError("commit_uncertain");
    }
  }
}

Object.freeze(KnowledgeRuntimeForwardRevisionApplyRecoveryPort.prototype);
Object.freeze(KnowledgeRuntimeForwardRevisionApplyRecoveryPort);

function requireRuntimeForwardRevisionDecisionPortState(
  value: unknown
): Readonly<RuntimeForwardRevisionDecisionPortState> {
  let prototype: object | null;
  try {
    prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
  } catch {
    throw createForwardRevisionDecisionPortError("dependency_invalid");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    prototype !== KnowledgeRuntimeForwardRevisionDecisionPort.prototype
  ) {
    throw createForwardRevisionDecisionPortError("dependency_invalid");
  }
  const state = runtimeForwardRevisionDecisionPortStates.get(value);
  if (!state) throw createForwardRevisionDecisionPortError("dependency_invalid");
  return state;
}

export class KnowledgeRuntimeForwardRevisionDecisionPort {
  constructor(
    runtime: KnowledgeRuntimeStore,
    proofPort: KnowledgeRuntimeIngestExecutionProofPort,
    workflowLease: KnowledgeProductionWorkflowExecutionLease
  ) {
    try {
      const proofState = requireRuntimeIngestExecutionProofPortState(proofPort);
      const runtimeState = requireAuthenticForwardRevisionPublicationRuntimeStore(runtime);
      KnowledgeProductionWorkflowExecutionLease.assert(workflowLease);
      if (
        Object.getPrototypeOf(proofPort) !== KnowledgeRuntimeIngestExecutionProofPort.prototype ||
        proofState.runtime !== runtime ||
        !runtimeState.productionExecutionBinding?.ownsWorkflowExecutionLease(workflowLease) ||
        !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          workflowLease,
          proofState.executionOwner
        )
      ) {
        throw new TypeError();
      }
      sealForwardRevisionPublicationRuntimeStore(runtime);
      runtimeForwardRevisionDecisionPortStates.set(
        this,
        Object.freeze({
          executionOwner: proofState.executionOwner,
          workflowLease,
          readPending: (command: Readonly<KnowledgeForwardRevisionReviewCommandV1>) =>
            Reflect.apply(runtimeForwardRevisionPendingDecisionReadMethod, runtime, [command]),
          decide: (authorization: ForwardRevisionDecisionMutationAuthorization) =>
            Reflect.apply(runtimeForwardRevisionDecisionMethod, runtime, [authorization]),
          confirm: (command: Readonly<KnowledgeForwardRevisionReviewCommandV1>) =>
            Reflect.apply(runtimeForwardRevisionDecisionConfirmMethod, runtime, [command]),
        })
      );
      Object.freeze(this);
    } catch {
      throw createForwardRevisionDecisionPortError("dependency_invalid");
    }
  }

  static assert(value: unknown): asserts value is KnowledgeRuntimeForwardRevisionDecisionPort {
    const state = requireRuntimeForwardRevisionDecisionPortState(value);
    try {
      state.workflowLease.assertCurrent();
    } catch {
      throw createForwardRevisionDecisionPortError("aborted");
    }
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      const state = requireRuntimeForwardRevisionDecisionPortState(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      return (
        state.executionOwner === executionOwner &&
        KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          state.workflowLease,
          executionOwner
        )
      );
    } catch {
      return false;
    }
  }

  async readPending(
    commandValue: unknown,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionDecisionAdmission> | null> {
    const state = requireRuntimeForwardRevisionDecisionPortState(this);
    assertForwardRevisionDecisionCurrent(state, signal);
    let command: Readonly<KnowledgeForwardRevisionReviewCommandV1>;
    try {
      command = snapshotKnowledgeForwardRevisionReviewCommand(commandValue);
    } catch {
      throw createForwardRevisionDecisionPortError("request_invalid");
    }
    const pending = await state.readPending(command);
    assertForwardRevisionDecisionCurrent(state, signal);
    return pending;
  }

  async decide(
    requestValue: unknown,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionDecisionResult>> {
    const state = requireRuntimeForwardRevisionDecisionPortState(this);
    assertForwardRevisionDecisionCurrent(state, signal);
    let command: Readonly<KnowledgeForwardRevisionReviewCommandV1>;
    let capability: unknown;
    try {
      const request = snapshotForwardRevisionDecisionRequest(requestValue);
      command = snapshotKnowledgeForwardRevisionReviewCommand(request.command);
      capability = request.validationCapability;
    } catch {
      throw createForwardRevisionDecisionPortError("request_invalid");
    }
    const admission = await state.readPending(command);
    assertForwardRevisionDecisionCurrent(state, signal);
    if (!admission) throw createForwardRevisionDecisionPortError("conflict");
    if (admission.kind === "terminal") return admission.result;
    let projection: Readonly<KnowledgeForwardRevisionValidationCapabilityProjectionV1> | undefined;
    let validatedCapability: KnowledgeForwardRevisionValidationCapability | undefined;
    if (command.action === "reject") {
      if (capability !== undefined) {
        throw createForwardRevisionDecisionPortError("request_invalid");
      }
    } else {
      try {
        KnowledgeForwardRevisionValidationCapability.assertExecutionOwner(
          capability,
          state.executionOwner
        );
        projection = KnowledgeForwardRevisionValidationCapability.project(capability);
        validatedCapability = capability as KnowledgeForwardRevisionValidationCapability;
        if (!exactJsonValuesEqual(projection.command, command)) throw new TypeError();
      } catch {
        throw createForwardRevisionDecisionPortError("dependency_invalid");
      }
    }
    assertForwardRevisionDecisionCurrent(state, signal);
    try {
      const authorization = ForwardRevisionDecisionMutationAuthorization.create();
      forwardRevisionDecisionMutationAuthorizationStates.set(
        authorization,
        Object.freeze({
          executionOwner: state.executionOwner,
          workflowLease: state.workflowLease,
          command,
          ...(projection ? { validationProjection: projection } : {}),
          ...(validatedCapability ? { validationCapability: validatedCapability } : {}),
        })
      );
      return await state.decide(authorization);
    } catch (error) {
      const confirmed = await state.confirm(command);
      if (confirmed) return confirmed;
      if (KnowledgeForwardRevisionDecisionPortError.inspect(error)) throw error;
      throw createForwardRevisionDecisionPortError("commit_uncertain");
    }
  }
}

function snapshotForwardRevisionDecisionRequest(
  value: unknown
): Readonly<KnowledgeForwardRevisionDecisionRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const keys = Reflect.ownKeys(value);
  const allowed = new Set(["command", "validationCapability"]);
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) {
    throw new TypeError();
  }
  const command = Object.getOwnPropertyDescriptor(value, "command");
  const capability = Object.getOwnPropertyDescriptor(value, "validationCapability");
  if (!command?.enumerable || !("value" in command)) throw new TypeError();
  if (capability && (!capability.enumerable || !("value" in capability))) throw new TypeError();
  return Object.freeze({
    command: command.value,
    ...(capability ? { validationCapability: capability.value } : {}),
  });
}

function assertForwardRevisionDecisionCurrent(
  state: Readonly<RuntimeForwardRevisionDecisionPortState>,
  signal: AbortSignal
): void {
  try {
    if (signal.aborted) throw new TypeError();
    state.workflowLease.assertCurrent();
    if (
      !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
        state.workflowLease,
        state.executionOwner
      )
    ) {
      throw new TypeError();
    }
  } catch {
    throw createForwardRevisionDecisionPortError("aborted");
  }
}

Object.freeze(KnowledgeRuntimeForwardRevisionDecisionPort.prototype);
Object.freeze(KnowledgeRuntimeForwardRevisionDecisionPort);

export class KnowledgeRuntimeManifestStorage implements SourceManifestStorage {
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  read(bundleId: string): Promise<unknown> {
    return this.runtime.readManifest(bundleId);
  }

  write(
    bundleId: string,
    manifest: SourceManifest,
    expectedRevision: number | null
  ): Promise<void> {
    return this.runtime.writeManifest(bundleId, manifest, expectedRevision);
  }
}

export class KnowledgeRuntimeApplyAuthorityPort implements ChangeSetTransactionAuthorityPort {
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  verify(
    request: ChangeSetTransactionAuthorityRequest
  ): Promise<Readonly<ChangeSetTransactionAuthorityProof>> {
    return this.runtime.verifyApplyAuthority(request);
  }
}

export class KnowledgeRuntimeNoJournalApplyRecoveryPort
  implements NoJournalApplyRecoveryStatePort, NoJournalApplyRecoverySnapshotPort
{
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  classify(identity: AcceptedReviewStartupIdentity): Promise<NoJournalApplyRecoveryClassification> {
    return this.runtime.classifyNoJournalApplyRecovery(identity);
  }

  loadSnapshot(
    bundleId: string,
    expectedReviewRevision: number
  ): Promise<NoJournalApplyRecoverySnapshotLoadResult> {
    return this.runtime.loadNoJournalApplyRecoverySnapshot(bundleId, expectedReviewRevision);
  }

  loadContinueInput(
    reference: NoJournalApplyRecoveryReference,
    bundle: unknown
  ): Promise<ChangeSetTransactionApplyInput> {
    return this.runtime.loadNoJournalApplyContinueInput(reference, bundle);
  }

  abandon(
    reference: NoJournalApplyRecoveryReference,
    abandonedAt: number
  ): Promise<NoJournalApplyAbandonReceipt> {
    return this.runtime.abandonNoJournalApply(reference, abandonedAt);
  }
}

export class KnowledgeRuntimeStartupReleasePort implements KnowledgeStartupReleasePort {
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  release(request: KnowledgeStartupReleaseRequest): Promise<KnowledgeStartupReleaseResult> {
    return this.runtime.releaseStartupRecovery(request);
  }
}

export class KnowledgeRuntimeApplyCommitManifestPort implements ApplyCommitManifestPort {
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  recordCommitted(
    journal: CommittedChangeSetTransactionJournal,
    receipt: TransactionCommitReceipt
  ): Promise<void> {
    return this.runtime.recordApplyCommit(journal, receipt);
  }
}

export class KnowledgeRuntimeTransactionStorage implements TransactionStorage {
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  readActive(): Promise<unknown> {
    return this.runtime.readActiveTransaction();
  }

  writeActive(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    return this.runtime.writeActiveTransaction(journal, expectedToken);
  }

  clearActive(expectedToken: TransactionStorageToken): Promise<void> {
    return this.runtime.clearActiveTransaction(expectedToken);
  }
}

export class KnowledgeRuntimeInputRevisionAllocator implements SourceInputRevisionAllocator {
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation> {
    return this.runtime.allocateInputRevision(request);
  }
}

export class KnowledgeRuntimeInputObservationBinder implements SourceInputObservationBinder {
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  bind(request: BindSourceInputObservationRequest): Promise<BindSourceInputObservationResult> {
    return this.runtime.bindInputObservation(request);
  }

  settle(observationToken: string): Promise<SourceInputObservationSettlement> {
    return this.runtime.settleInputObservation(observationToken);
  }

  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]> {
    return this.runtime.loadInputObservationRecoveryWork(bundleId);
  }
}

interface KnowledgeRuntimeIngestExecutionProofPortState {
  runtime: KnowledgeRuntimeStore;
  queueStorage: KnowledgeRuntimeQueueStorage;
  executionOwner: KnowledgeExecutionOwner;
  prove: (
    request: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ) => Promise<unknown>;
}

const runtimeIngestExecutionProofPortStates = new WeakMap<
  object,
  KnowledgeRuntimeIngestExecutionProofPortState
>();

function captureRuntimeIngestExecutionProofMethod(): KnowledgeRuntimeStore["proveIngestExecution"] {
  const descriptor = Object.getOwnPropertyDescriptor(
    KnowledgeRuntimeStore.prototype,
    "proveIngestExecution"
  );
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new TypeError("The Runtime ingest execution-proof dependency is invalid");
  }
  return descriptor.value as KnowledgeRuntimeStore["proveIngestExecution"];
}

const runtimeIngestExecutionProofMethod = captureRuntimeIngestExecutionProofMethod();

function requireRuntimeIngestExecutionProofPortState(
  value: unknown
): KnowledgeRuntimeIngestExecutionProofPortState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The Runtime ingest execution-proof port is invalid");
  }
  const state = runtimeIngestExecutionProofPortStates.get(value);
  if (!state) {
    throw new TypeError("The Runtime ingest execution-proof port is invalid");
  }
  return state;
}

export class KnowledgeRuntimeIngestExecutionProofPort implements KnowledgeIngestExecutionProofPort {
  constructor(runtime: KnowledgeRuntimeStore, queueStorage: KnowledgeRuntimeQueueStorage) {
    if (!(runtime instanceof KnowledgeRuntimeStore)) {
      throw new TypeError("The Runtime ingest execution-proof dependency is invalid");
    }
    const queueState = requireRuntimeQueueStorageState(queueStorage);
    if (queueState.runtime !== runtime) {
      throw new TypeError("The Runtime ingest execution-proof dependency is invalid");
    }
    runtimeIngestExecutionProofPortStates.set(
      this,
      Object.freeze({
        runtime,
        queueStorage,
        executionOwner: queueState.executionOwner,
        prove: (request: Readonly<KnowledgeIngestExecutionProofRequest>, signal: AbortSignal) =>
          Reflect.apply(runtimeIngestExecutionProofMethod, runtime, [request, signal]),
      })
    );
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgeRuntimeIngestExecutionProofPort {
    requireRuntimeIngestExecutionProofPortState(value);
  }

  static assertClaimOwner(
    value: KnowledgeRuntimeIngestExecutionProofPort,
    claim: IngestExecutionClaim
  ): void {
    const state = requireRuntimeIngestExecutionProofPortState(value);
    if (!ingestExecutionClaimMatchesQueueStorage(claim, state.queueStorage)) {
      throw new TypeError("The Runtime ingest execution-proof owner is invalid");
    }
  }

  static getExecutionOwner(
    value: KnowledgeRuntimeIngestExecutionProofPort
  ): KnowledgeExecutionOwner {
    return requireRuntimeIngestExecutionProofPortState(value).executionOwner;
  }

  prove(
    request: Readonly<KnowledgeIngestExecutionProofRequest>,
    signal: AbortSignal
  ): Promise<unknown> {
    return requireRuntimeIngestExecutionProofPortState(this).prove(request, signal);
  }
}

Object.freeze(KnowledgeRuntimeIngestExecutionProofPort.prototype);
Object.freeze(KnowledgeRuntimeIngestExecutionProofPort);
