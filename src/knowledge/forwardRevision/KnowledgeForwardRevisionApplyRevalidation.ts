import {
  createKnowledgeForwardRevisionAcceptanceAuthorityDigest,
  snapshotKnowledgeForwardRevisionAcceptanceAuthority,
  snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue,
  snapshotKnowledgeForwardRevisionSourceFreshness,
  type KnowledgeForwardRevisionAcceptanceAuthority,
  type KnowledgeForwardRevisionSourceFreshness,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
import {
  snapshotKnowledgeForwardRevisionAcceptedDecisionRecord,
  snapshotKnowledgeForwardRevisionApplyClaim,
  type KnowledgeForwardRevisionAcceptedDecisionRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
import {
  captureForwardApplyJson,
  captureForwardApplyRecord,
  freezeForwardApplyJson,
  isForwardApplyDigest,
  isForwardApplyIdentifier,
  isForwardApplyNonNegativeInteger,
  isForwardApplyPositiveInteger,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";
import {
  snapshotKnowledgeForwardRevisionValidationReceiptForAcceptedCandidate,
  snapshotKnowledgeForwardRevisionValidationReceipt,
  type KnowledgeForwardRevisionValidationReceiptV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import {
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  parseKnowledgeRuntimeSourceCommitExtension,
  type KnowledgeRuntimeSourceCommitExtension,
} from "@/knowledge/manifest/KnowledgeRuntimeSourceCommit";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { sourceManifestEntrySchema } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
  SourceCompileSnapshot,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Current strict source-base and fresh Apply revalidation version. */
export const KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION = 1 as const;

/** Exact source state that remains stable across unrelated Manifest writes. */
export interface KnowledgeForwardRevisionSourceBaseV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION;
  readonly kind: "forward_revision_source_base";
  readonly bundleId: string;
  readonly sourceId: string;
  readonly lastSuccessful: Readonly<SourceCompileSnapshot>;
  readonly runtimeSourceCommitExtension: Readonly<KnowledgeRuntimeSourceCommitExtension>;
  readonly currentSourceFreshness: Readonly<KnowledgeForwardRevisionSourceFreshness>;
}

/** Creator input projected from one exact current Manifest source entry. */
export interface CreateKnowledgeForwardRevisionSourceBaseInput {
  readonly bundleId: string;
  readonly sourceEntry: unknown;
  readonly currentSourceFreshness: unknown;
}

/** Durable structural proof of a fresh deterministic pre-Apply validation. */
export interface KnowledgeForwardRevisionApplyRevalidationReceiptV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION;
  readonly kind: "forward_revision_apply_revalidation_receipt";
  readonly revalidationId: string;
  readonly runtimeId: string;
  readonly runtimeRevision: number;
  readonly runtimeDigest: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly acceptedDecisionDigest: string;
  readonly applyClaimId: string;
  readonly applyClaimDigest: string;
  readonly originalValidationReceiptDigest: string;
  readonly freshValidationReceipt: Readonly<KnowledgeForwardRevisionValidationReceiptV1>;
  readonly freshValidationReceiptDigest: string;
  readonly applyAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>;
  readonly applyAuthorityDigest: string;
  readonly sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>;
  readonly sourceBaseDigest: string;
  readonly vaultObservedBeforeHash: string;
  readonly vaultObservedAfterHash: string;
  readonly acceptedAfterHash: string;
  readonly revalidatedAt: number;
  readonly receiptDigest: string;
}

/** Complete input for one fresh, still non-authoritative Apply receipt. */
export interface CreateKnowledgeForwardRevisionApplyRevalidationReceiptInput {
  readonly acceptedDecision: unknown;
  readonly freshValidationReceipt: unknown;
  readonly applyAuthority: unknown;
  readonly sourceBase: unknown;
  readonly vaultObservedBeforeHash: string;
  readonly vaultObservedAfterHash: string;
  readonly revalidatedAt: number;
}

const SOURCE_BASE_KEYS = [
  "version",
  "kind",
  "bundleId",
  "sourceId",
  "lastSuccessful",
  "runtimeSourceCommitExtension",
  "currentSourceFreshness",
] as const;
const SOURCE_BASE_CREATE_KEYS = ["bundleId", "sourceEntry", "currentSourceFreshness"] as const;
const RECEIPT_KEYS = [
  "version",
  "kind",
  "revalidationId",
  "runtimeId",
  "runtimeRevision",
  "runtimeDigest",
  "bundleId",
  "pagePath",
  "proposalId",
  "proposalDigest",
  "acceptedDecisionDigest",
  "applyClaimId",
  "applyClaimDigest",
  "originalValidationReceiptDigest",
  "freshValidationReceipt",
  "freshValidationReceiptDigest",
  "applyAuthority",
  "applyAuthorityDigest",
  "sourceBase",
  "sourceBaseDigest",
  "vaultObservedBeforeHash",
  "vaultObservedAfterHash",
  "acceptedAfterHash",
  "revalidatedAt",
  "receiptDigest",
] as const;
const RECEIPT_CREATE_KEYS = [
  "acceptedDecision",
  "freshValidationReceipt",
  "applyAuthority",
  "sourceBase",
  "vaultObservedBeforeHash",
  "vaultObservedAfterHash",
  "revalidatedAt",
] as const;
const REVALIDATION_ID_PATTERN = /^forward-revision-apply-revalidation-[a-f0-9]{64}$/;

/** Fixed value-free failure for invalid source-base or revalidation material. */
export class KnowledgeForwardRevisionApplyRevalidationValidationError extends TypeError {
  /** Creates one sanitized error; only this module can mark it authentic. */
  constructor(authenticityToken?: symbol) {
    super("Forward revision Apply revalidation does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionApplyRevalidationValidationError";
    if (authenticityToken === ERROR_TOKEN) authenticErrors.add(this);
  }
}

const ERROR_TOKEN = Symbol("KnowledgeForwardRevisionApplyRevalidationValidationError");
const authenticErrors = new WeakSet<KnowledgeForwardRevisionApplyRevalidationValidationError>();

/** Throws one authentic frozen validation failure. */
function invalid(): never {
  const error = new KnowledgeForwardRevisionApplyRevalidationValidationError(ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

/** Reports whether one caught value is an authentic local failure. */
function isAuthenticError(
  value: unknown
): value is KnowledgeForwardRevisionApplyRevalidationValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticErrors.has(value as KnowledgeForwardRevisionApplyRevalidationValidationError)
  );
}

/** Hashes one exact JSON projection with explicit domain separation. */
function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

/** Strictly snapshots the last successful source compile projection. */
function snapshotLastSuccessful(value: unknown): Readonly<SourceCompileSnapshot> {
  const captured = captureForwardApplyJson(value);
  if (captured === undefined) invalid();
  const parsed = sourceManifestEntrySchema.safeParse({
    sourceId: "source-base-snapshot",
    sourceKey: "source-base-snapshot.md",
    sourcePath: "source-base-snapshot.md",
    custody: "user_managed",
    lastSuccessful: captured,
  });
  if (!parsed.success || !parsed.data.lastSuccessful) invalid();
  return freezeForwardApplyJson(parsed.data.lastSuccessful);
}

/** Enforces exact correlations within one source-base projection. */
function assertSourceBaseSemantics(
  bundleId: string,
  sourceId: string,
  lastSuccessful: Readonly<SourceCompileSnapshot>,
  runtimeCommit: Readonly<KnowledgeRuntimeSourceCommitExtension>,
  freshness: Readonly<KnowledgeForwardRevisionSourceFreshness>
): void {
  if (
    freshness.bundleId !== bundleId ||
    freshness.sourceId !== sourceId ||
    runtimeCommit.inputRevision > freshness.inputRevision ||
    (freshness.kind === "applied" &&
      (freshness.sourceContentHash !== lastSuccessful.sourceContentHash ||
        freshness.pipelineFingerprint !== lastSuccessful.pipelineFingerprint ||
        runtimeCommit.inputRevision !== freshness.inputRevision ||
        runtimeCommit.transactionId !== freshness.transactionId ||
        runtimeCommit.manifestIntentDigest !== freshness.manifestIntentDigest ||
        lastSuccessful.changeSetId !== freshness.changeSetId ||
        lastSuccessful.completedAt !== freshness.completedAt)) ||
    (freshness.kind === "no_changes" &&
      (runtimeCommit.inputRevision >= freshness.inputRevision ||
        lastSuccessful.completedAt > freshness.completedAt))
  ) {
    invalid();
  }
}

/** Strictly snapshots one exact source-base projection. */
export function snapshotKnowledgeForwardRevisionSourceBase(
  value: unknown
): Readonly<KnowledgeForwardRevisionSourceBaseV1> {
  try {
    const record = captureForwardApplyRecord(value, SOURCE_BASE_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION ||
      record.kind !== "forward_revision_source_base" ||
      !isForwardApplyIdentifier(record.bundleId) ||
      !isForwardApplyIdentifier(record.sourceId)
    ) {
      invalid();
    }
    const lastSuccessful = snapshotLastSuccessful(record.lastSuccessful);
    const runtimeCommitResult = parseKnowledgeRuntimeSourceCommitExtension(
      captureForwardApplyJson(record.runtimeSourceCommitExtension)
    );
    if (!runtimeCommitResult.ok) invalid();
    const runtimeSourceCommitExtension = runtimeCommitResult.value;
    const currentSourceFreshness = snapshotKnowledgeForwardRevisionSourceFreshness(
      record.currentSourceFreshness
    );
    assertSourceBaseSemantics(
      record.bundleId,
      record.sourceId,
      lastSuccessful,
      runtimeSourceCommitExtension,
      currentSourceFreshness
    );
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION,
      kind: "forward_revision_source_base" as const,
      bundleId: record.bundleId,
      sourceId: record.sourceId,
      lastSuccessful,
      runtimeSourceCommitExtension,
      currentSourceFreshness,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one source-base projection from an exact current Manifest entry. */
export function createKnowledgeForwardRevisionSourceBase(
  value: CreateKnowledgeForwardRevisionSourceBaseInput
): Readonly<KnowledgeForwardRevisionSourceBaseV1> {
  try {
    const record = captureForwardApplyRecord(value, SOURCE_BASE_CREATE_KEYS);
    if (!record || !isForwardApplyIdentifier(record.bundleId)) invalid();
    const capturedEntry = captureForwardApplyJson(record.sourceEntry);
    if (capturedEntry === undefined) invalid();
    const parsedEntry = sourceManifestEntrySchema.safeParse(capturedEntry);
    if (!parsedEntry.success) invalid();
    const sourceEntry = freezeForwardApplyJson(parsedEntry.data) as Readonly<SourceManifestEntry>;
    const lastSuccessful = sourceEntry.lastSuccessful;
    const runtimeCommitRaw =
      sourceEntry.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
    if (!lastSuccessful || runtimeCommitRaw === undefined) invalid();
    const runtimeCommit = parseKnowledgeRuntimeSourceCommitExtension(runtimeCommitRaw);
    if (!runtimeCommit.ok) invalid();
    return snapshotKnowledgeForwardRevisionSourceBase({
      version: KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION,
      kind: "forward_revision_source_base",
      bundleId: record.bundleId,
      sourceId: sourceEntry.sourceId,
      lastSuccessful,
      runtimeSourceCommitExtension: runtimeCommit.value,
      currentSourceFreshness: record.currentSourceFreshness,
    });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the required source base over its complete canonical projection. */
export function createKnowledgeForwardRevisionSourceBaseDigest(value: unknown): string {
  const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(value);
  const freshness = sourceBase.currentSourceFreshness;
  const stableFreshness =
    freshness.kind === "applied"
      ? {
          kind: freshness.kind,
          bundleId: freshness.bundleId,
          sourceId: freshness.sourceId,
          sourceContentHash: freshness.sourceContentHash,
          pipelineFingerprint: freshness.pipelineFingerprint,
          inputRevision: freshness.inputRevision,
          committedManifestRevision: freshness.committedManifestRevision,
          completedAt: freshness.completedAt,
          transactionId: freshness.transactionId,
          changeSetId: freshness.changeSetId,
          changeSetDigest: freshness.changeSetDigest,
          manifestIntentDigest: freshness.manifestIntentDigest,
          committedManifestDigest: freshness.committedManifestDigest,
        }
      : {
          kind: freshness.kind,
          bundleId: freshness.bundleId,
          sourceId: freshness.sourceId,
          sourceContentHash: freshness.sourceContentHash,
          pipelineFingerprint: freshness.pipelineFingerprint,
          inputRevision: freshness.inputRevision,
          committedManifestRevision: freshness.committedManifestRevision,
          completedAt: freshness.completedAt,
          noChangesId: freshness.noChangesId,
          reason: freshness.reason,
          planDigest: freshness.planDigest,
          jobId: freshness.jobId,
          attempt: freshness.attempt,
        };
  return digestValue("knowledge-forward-revision-source-base-v1", {
    bundleId: sourceBase.bundleId,
    sourceId: sourceBase.sourceId,
    lastSuccessful: sourceBase.lastSuccessful,
    runtimeSourceCommitExtension: sourceBase.runtimeSourceCommitExtension,
    currentSourceFreshness: stableFreshness,
  });
}

/** Creates the exact digest payload excluding self-identifying receipt fields. */
function createReceiptPayload(
  accepted: Readonly<KnowledgeForwardRevisionAcceptedDecisionRecordV1>,
  freshValidationReceipt: Readonly<KnowledgeForwardRevisionValidationReceiptV1>,
  applyAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>,
  sourceBase: Readonly<KnowledgeForwardRevisionSourceBaseV1>,
  vaultObservedBeforeHash: string,
  vaultObservedAfterHash: string,
  revalidatedAt: number
): Omit<KnowledgeForwardRevisionApplyRevalidationReceiptV1, "revalidationId" | "receiptDigest"> {
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION,
    kind: "forward_revision_apply_revalidation_receipt" as const,
    runtimeId: applyAuthority.runtimeId,
    runtimeRevision: applyAuthority.runtimeRevision,
    runtimeDigest: applyAuthority.runtimeDigest,
    bundleId: accepted.proposal.request.bundleId,
    pagePath: accepted.proposal.request.pagePath,
    proposalId: accepted.proposal.proposalId,
    proposalDigest: accepted.proposalDigest,
    acceptedDecisionDigest: accepted.acceptedDecisionDigest,
    applyClaimId: accepted.applyClaim.claimId,
    applyClaimDigest: accepted.applyClaimDigest,
    originalValidationReceiptDigest: accepted.validationReceiptDigest,
    freshValidationReceipt,
    freshValidationReceiptDigest: freshValidationReceipt.receiptDigest,
    applyAuthority,
    applyAuthorityDigest: createKnowledgeForwardRevisionAcceptanceAuthorityDigest(applyAuthority),
    sourceBase,
    sourceBaseDigest: createKnowledgeForwardRevisionSourceBaseDigest(sourceBase),
    vaultObservedBeforeHash,
    vaultObservedAfterHash,
    acceptedAfterHash: accepted.acceptedAfterHash,
    revalidatedAt,
  });
}

/** Strictly rejoins one revalidation receipt to its accepted decision. */
export function snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision(
  value: unknown,
  acceptedDecisionValue: unknown
): Readonly<KnowledgeForwardRevisionApplyRevalidationReceiptV1> {
  try {
    const accepted = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(acceptedDecisionValue);
    const record = captureForwardApplyRecord(value, RECEIPT_KEYS);
    if (
      !record ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION ||
      record.kind !== "forward_revision_apply_revalidation_receipt" ||
      !isForwardApplyIdentifier(record.revalidationId) ||
      !REVALIDATION_ID_PATTERN.test(record.revalidationId) ||
      !isForwardApplyPositiveInteger(record.runtimeRevision) ||
      !isForwardApplyDigest(record.runtimeDigest) ||
      !isForwardApplyDigest(record.proposalDigest) ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyDigest(record.applyClaimDigest) ||
      !isForwardApplyDigest(record.originalValidationReceiptDigest) ||
      !isForwardApplyDigest(record.freshValidationReceiptDigest) ||
      !isForwardApplyDigest(record.applyAuthorityDigest) ||
      !isForwardApplyDigest(record.sourceBaseDigest) ||
      !isForwardApplyDigest(record.vaultObservedBeforeHash) ||
      !isForwardApplyDigest(record.vaultObservedAfterHash) ||
      !isForwardApplyDigest(record.acceptedAfterHash) ||
      !isForwardApplyNonNegativeInteger(record.revalidatedAt)
    ) {
      invalid();
    }
    snapshotKnowledgeForwardRevisionApplyClaim(accepted.applyClaim, accepted);
    const applyAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
      record.applyAuthority,
      accepted.proposal
    );
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(record.sourceBase);
    const freshValidationReceipt =
      snapshotKnowledgeForwardRevisionValidationReceiptForAcceptedCandidate(
        record.freshValidationReceipt,
        accepted.proposal,
        accepted.proposalDigest,
        accepted.afterContent,
        applyAuthority
      );
    const revalidatedAt = Number(record.revalidatedAt);
    if (
      applyAuthority.runtimeRevision < accepted.acceptanceAuthority.runtimeRevision ||
      (applyAuthority.runtimeRevision === accepted.acceptanceAuthority.runtimeRevision &&
        applyAuthority.runtimeDigest !== accepted.acceptanceAuthority.runtimeDigest) ||
      sourceBase.bundleId !== accepted.proposal.request.bundleId ||
      sourceBase.sourceId !== accepted.proposal.request.intent.current.primarySourceId ||
      canonicalizeJson(sourceBase.currentSourceFreshness) !==
        canonicalizeJson(applyAuthority.currentSourceFreshness) ||
      record.vaultObservedBeforeHash !== applyAuthority.manifestBaseHash ||
      record.vaultObservedBeforeHash !== applyAuthority.vaultObservedBeforeHash ||
      record.vaultObservedAfterHash !== record.vaultObservedBeforeHash ||
      freshValidationReceipt.validatedAt < accepted.acceptedAt ||
      revalidatedAt < freshValidationReceipt.validatedAt ||
      record.freshValidationReceiptDigest !== freshValidationReceipt.receiptDigest ||
      freshValidationReceipt.action !== accepted.validationReceipt.action ||
      freshValidationReceipt.commandId !== accepted.validationReceipt.commandId ||
      freshValidationReceipt.commandDigest !== accepted.validationReceipt.commandDigest ||
      freshValidationReceipt.historicalAcceptedDigest !==
        accepted.validationReceipt.historicalAcceptedDigest ||
      freshValidationReceipt.historicalCitationSetDigest !==
        accepted.validationReceipt.historicalCitationSetDigest ||
      canonicalizeJson(freshValidationReceipt.historicalCitations as unknown as JsonValue) !==
        canonicalizeJson(accepted.validationReceipt.historicalCitations as unknown as JsonValue) ||
      record.sourceBaseDigest !== createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) ||
      record.applyAuthorityDigest !==
        createKnowledgeForwardRevisionAcceptanceAuthorityDigest(applyAuthority)
    ) {
      invalid();
    }
    const payload = createReceiptPayload(
      accepted,
      freshValidationReceipt,
      applyAuthority,
      sourceBase,
      record.vaultObservedBeforeHash,
      record.vaultObservedAfterHash,
      revalidatedAt
    );
    const receiptDigest = digestValue(
      "knowledge-forward-revision-apply-revalidation-receipt-v1",
      payload
    );
    const revalidationId = `forward-revision-apply-revalidation-${receiptDigest}`;
    if (
      record.revalidationId !== revalidationId ||
      record.receiptDigest !== receiptDigest ||
      canonicalizeJson(record as unknown as JsonValue) !==
        canonicalizeJson({ ...payload, revalidationId, receiptDigest } as unknown as JsonValue)
    ) {
      invalid();
    }
    return freezeForwardApplyJson({ ...payload, revalidationId, receiptDigest });
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Strictly snapshots one self-contained revalidation receipt. */
export function snapshotKnowledgeForwardRevisionApplyRevalidationReceipt(
  value: unknown
): Readonly<KnowledgeForwardRevisionApplyRevalidationReceiptV1> {
  try {
    const record = captureForwardApplyRecord(value, RECEIPT_KEYS);
    if (!record) invalid();
    if (
      !isForwardApplyIdentifier(record.revalidationId) ||
      !isForwardApplyIdentifier(record.runtimeId) ||
      !isForwardApplyPositiveInteger(record.runtimeRevision) ||
      !isForwardApplyDigest(record.runtimeDigest) ||
      !isForwardApplyIdentifier(record.bundleId) ||
      !isForwardApplyIdentifier(record.pagePath) ||
      !isForwardApplyIdentifier(record.proposalId) ||
      !isForwardApplyDigest(record.proposalDigest) ||
      !isForwardApplyDigest(record.acceptedDecisionDigest) ||
      !isForwardApplyIdentifier(record.applyClaimId) ||
      !isForwardApplyDigest(record.applyClaimDigest) ||
      !isForwardApplyDigest(record.originalValidationReceiptDigest) ||
      !isForwardApplyDigest(record.freshValidationReceiptDigest) ||
      !isForwardApplyDigest(record.applyAuthorityDigest) ||
      !isForwardApplyDigest(record.sourceBaseDigest) ||
      !isForwardApplyDigest(record.vaultObservedBeforeHash) ||
      !isForwardApplyDigest(record.vaultObservedAfterHash) ||
      !isForwardApplyDigest(record.acceptedAfterHash) ||
      !isForwardApplyNonNegativeInteger(record.revalidatedAt) ||
      !isForwardApplyDigest(record.receiptDigest)
    ) {
      invalid();
    }
    const applyAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(
      record.applyAuthority
    );
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(record.sourceBase);
    const freshValidationReceipt = snapshotKnowledgeForwardRevisionValidationReceipt(
      record.freshValidationReceipt
    );
    if (
      applyAuthority.runtimeId !== record.runtimeId ||
      applyAuthority.runtimeRevision !== record.runtimeRevision ||
      applyAuthority.runtimeDigest !== record.runtimeDigest ||
      freshValidationReceipt.bundleId !== record.bundleId ||
      freshValidationReceipt.pagePath !== record.pagePath ||
      freshValidationReceipt.proposalId !== record.proposalId ||
      freshValidationReceipt.proposalDigest !== record.proposalDigest ||
      freshValidationReceipt.acceptedAfterHash !== record.acceptedAfterHash ||
      freshValidationReceipt.receiptDigest !== record.freshValidationReceiptDigest ||
      sourceBase.bundleId !== record.bundleId ||
      canonicalizeJson(sourceBase.currentSourceFreshness) !==
        canonicalizeJson(applyAuthority.currentSourceFreshness) ||
      createKnowledgeForwardRevisionAcceptanceAuthorityDigest(applyAuthority) !==
        record.applyAuthorityDigest ||
      createKnowledgeForwardRevisionSourceBaseDigest(sourceBase) !== record.sourceBaseDigest ||
      record.vaultObservedBeforeHash !== applyAuthority.manifestBaseHash ||
      record.vaultObservedBeforeHash !== applyAuthority.vaultObservedBeforeHash ||
      record.vaultObservedAfterHash !== record.vaultObservedBeforeHash ||
      Number(record.revalidatedAt) < freshValidationReceipt.validatedAt
    ) {
      invalid();
    }
    const captured = captureForwardApplyJson(record);
    if (captured === undefined) invalid();
    const object = captured as unknown as KnowledgeForwardRevisionApplyRevalidationReceiptV1;
    if (
      object.version !== KNOWLEDGE_FORWARD_REVISION_APPLY_REVALIDATION_VERSION ||
      object.kind !== "forward_revision_apply_revalidation_receipt" ||
      !REVALIDATION_ID_PATTERN.test(object.revalidationId) ||
      object.receiptDigest !==
        object.revalidationId.slice("forward-revision-apply-revalidation-".length)
    ) {
      invalid();
    }
    const { revalidationId: _id, receiptDigest: _digest, ...payload } = object;
    void _id;
    void _digest;
    if (
      digestValue("knowledge-forward-revision-apply-revalidation-receipt-v1", payload) !==
      object.receiptDigest
    ) {
      invalid();
    }
    return freezeForwardApplyJson(object);
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Creates one strict fresh revalidation receipt for an accepted decision. */
export function createKnowledgeForwardRevisionApplyRevalidationReceipt(
  value: CreateKnowledgeForwardRevisionApplyRevalidationReceiptInput
): Readonly<KnowledgeForwardRevisionApplyRevalidationReceiptV1> {
  try {
    const record = captureForwardApplyRecord(value, RECEIPT_CREATE_KEYS);
    if (
      !record ||
      !isForwardApplyDigest(record.vaultObservedBeforeHash) ||
      !isForwardApplyDigest(record.vaultObservedAfterHash) ||
      !isForwardApplyNonNegativeInteger(record.revalidatedAt)
    ) {
      invalid();
    }
    const accepted = snapshotKnowledgeForwardRevisionAcceptedDecisionRecord(
      record.acceptedDecision
    );
    const applyAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
      record.applyAuthority,
      accepted.proposal
    );
    const sourceBase = snapshotKnowledgeForwardRevisionSourceBase(record.sourceBase);
    const freshValidationReceipt =
      snapshotKnowledgeForwardRevisionValidationReceiptForAcceptedCandidate(
        record.freshValidationReceipt,
        accepted.proposal,
        accepted.proposalDigest,
        accepted.afterContent,
        applyAuthority
      );
    const payload = createReceiptPayload(
      accepted,
      freshValidationReceipt,
      applyAuthority,
      sourceBase,
      record.vaultObservedBeforeHash,
      record.vaultObservedAfterHash,
      Number(record.revalidatedAt)
    );
    const receiptDigest = digestValue(
      "knowledge-forward-revision-apply-revalidation-receipt-v1",
      payload
    );
    return snapshotKnowledgeForwardRevisionApplyRevalidationReceiptForAcceptedDecision(
      {
        ...payload,
        revalidationId: `forward-revision-apply-revalidation-${receiptDigest}`,
        receiptDigest,
      },
      accepted
    );
  } catch (error) {
    if (isAuthenticError(error)) throw error;
    invalid();
  }
}

/** Computes the canonical digest of one strict standalone receipt. */
export function createKnowledgeForwardRevisionApplyRevalidationReceiptDigest(
  value: unknown
): string {
  return snapshotKnowledgeForwardRevisionApplyRevalidationReceipt(value).receiptDigest;
}

/** Parses an untrusted revalidation receipt into a detached value or diagnostic. */
export function parseKnowledgeForwardRevisionApplyRevalidationReceipt(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionApplyRevalidationReceiptV1>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionApplyRevalidationReceipt(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_apply_revalidation_invalid",
          severity: "error",
          field: "forwardRevisionApplyRevalidation",
          message: "Forward revision Apply revalidation does not satisfy its strict contract",
        },
      ],
    };
  }
}

/** Validates one untrusted revalidation receipt without retaining rejected data. */
export function validateKnowledgeForwardRevisionApplyRevalidationReceipt(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionApplyRevalidationReceipt(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

/** Detaches one fixed diagnostic. */
function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

Object.freeze(KnowledgeForwardRevisionApplyRevalidationValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionApplyRevalidationValidationError);
