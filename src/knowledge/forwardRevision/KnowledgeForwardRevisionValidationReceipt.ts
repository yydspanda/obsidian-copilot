import {
  createKnowledgeForwardRevisionAcceptanceAuthorityDigest,
  snapshotKnowledgeForwardRevisionAcceptanceAuthority,
  snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";
import {
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createKnowledgeForwardRevisionReviewCommand,
  createKnowledgeForwardRevisionReviewCommandDigest,
  snapshotKnowledgeForwardRevisionReviewCommandForProposal,
  type KnowledgeForwardRevisionReviewCommandV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  createKnowledgeForwardRevisionHistoricalCitationSetDigest,
  snapshotKnowledgeForwardRevisionHistoricalCitationSet,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationAuthority";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  ClaimCitation,
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_VALIDATION_CONTRACT_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxArtifactIdCharacters: 1_024,
  maxPagePathCharacters: 1_024,
  maxLocatorTextCharacters: 2_000_000,
  maxHistoricalCitations: 4_096,
  maxValidationReadSetArtifacts: 4_096,
  maxTotalEvidenceCharacters: 4_000_000,
  maxWarnings: 10_000,
});

export interface KnowledgeForwardRevisionValidationContractV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_VALIDATION_CONTRACT_VERSION;
  readonly kind: "forward_revision_validation_contract";
  readonly contractId: "forward_revision_candidate_v1";
  readonly okfValid: true;
  readonly citationsValid: true;
  readonly linksValid: true;
}

export interface KnowledgeForwardRevisionValidationProfileV1 {
  readonly version: 1;
  readonly kind: "forward_revision_validation_profile";
  readonly profileId: string;
  readonly profileVersion: number;
  readonly profileConfigurationDigest: string;
  readonly bundleConfigurationDigest: string;
  readonly validatorImplementationId: string;
  readonly validatorImplementationVersion: number;
  readonly validatorImplementationDigest: string;
}

export interface KnowledgeForwardRevisionValidationArtifactIdentityV1 {
  readonly version: 1;
  readonly kind: "forward_revision_validation_artifact_identity";
  readonly artifactKind: "markdown" | "pdf" | "text";
  readonly sourceId: string;
  readonly artifactId: string;
  readonly artifactContentHash: string;
}

export interface KnowledgeForwardRevisionValidationWarningSummaryV1 {
  readonly version: 1;
  readonly kind: "forward_revision_validation_warning_summary";
  readonly count: number;
  readonly digest: string;
}

export interface KnowledgeForwardRevisionValidationReceiptV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_VERSION;
  readonly kind: "forward_revision_validation_receipt";
  readonly receiptId: string;
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly action: "accept_exact" | "accept_edited";
  readonly selectedHistoricalHash: string;
  readonly acceptedAfterHash: string;
  readonly manualOverride: boolean;
  readonly validationContract: Readonly<KnowledgeForwardRevisionValidationContractV1>;
  readonly validationProfile: Readonly<KnowledgeForwardRevisionValidationProfileV1>;
  readonly validationProfileDigest: string;
  readonly acceptanceAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>;
  readonly acceptanceAuthorityDigest: string;
  readonly historicalAcceptedDigest: string;
  readonly historicalCitations: readonly Readonly<ClaimCitation>[];
  readonly historicalCitationSetDigest: string;
  readonly validationReadSet: readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[];
  readonly validationObservationSetDigest: string;
  readonly sourceArtifactObservationBindingDigest: string;
  readonly warningSummary: Readonly<KnowledgeForwardRevisionValidationWarningSummaryV1> | null;
  readonly validatedAt: number;
  readonly receiptDigest: string;
}

export interface KnowledgeForwardRevisionValidationSummaryInput {
  readonly okfValid: boolean;
  readonly citationsValid: boolean;
  readonly linksValid: boolean;
}

export interface CreateKnowledgeForwardRevisionValidationReceiptInput {
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly command: unknown;
  readonly afterContent: string;
  readonly validation: unknown;
  readonly validationProfile: unknown;
  readonly acceptanceAuthority: unknown;
  readonly historicalCitations: unknown;
  readonly validationReadSet: unknown;
  readonly sourceArtifactObservationBindingDigest: string;
  readonly warningSummary: unknown;
  readonly validatedAt: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_ID_PATTERN = /^forward-revision-validation-receipt-[a-f0-9]{64}$/;
const VALIDATION_SUMMARY_KEYS = ["okfValid", "citationsValid", "linksValid"] as const;
const VALIDATION_CONTRACT_KEYS = [
  "version",
  "kind",
  "contractId",
  "okfValid",
  "citationsValid",
  "linksValid",
] as const;
const VALIDATION_PROFILE_KEYS = [
  "version",
  "kind",
  "profileId",
  "profileVersion",
  "profileConfigurationDigest",
  "bundleConfigurationDigest",
  "validatorImplementationId",
  "validatorImplementationVersion",
  "validatorImplementationDigest",
] as const;
const VALIDATION_ARTIFACT_KEYS = [
  "version",
  "kind",
  "artifactKind",
  "sourceId",
  "artifactId",
  "artifactContentHash",
] as const;
const WARNING_SUMMARY_KEYS = ["version", "kind", "count", "digest"] as const;
const CREATE_INPUT_KEYS = [
  "proposal",
  "proposalDigest",
  "command",
  "afterContent",
  "validation",
  "validationProfile",
  "acceptanceAuthority",
  "historicalCitations",
  "validationReadSet",
  "sourceArtifactObservationBindingDigest",
  "warningSummary",
  "validatedAt",
] as const;
const RECEIPT_KEYS = [
  "version",
  "kind",
  "receiptId",
  "runtimeId",
  "bundleId",
  "pagePath",
  "proposalId",
  "proposalDigest",
  "requestId",
  "requestDigest",
  "intentId",
  "intentDigest",
  "commandId",
  "commandDigest",
  "action",
  "selectedHistoricalHash",
  "acceptedAfterHash",
  "manualOverride",
  "validationContract",
  "validationProfile",
  "validationProfileDigest",
  "acceptanceAuthority",
  "acceptanceAuthorityDigest",
  "historicalAcceptedDigest",
  "historicalCitations",
  "historicalCitationSetDigest",
  "validationReadSet",
  "validationObservationSetDigest",
  "sourceArtifactObservationBindingDigest",
  "warningSummary",
  "validatedAt",
  "receiptDigest",
] as const;

export class KnowledgeForwardRevisionValidationReceiptError extends TypeError {
  constructor(authenticityToken?: symbol) {
    super("Forward revision validation receipt does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionValidationReceiptError";
    if (authenticityToken === RECEIPT_ERROR_TOKEN) authenticReceiptErrors.add(this);
  }
}

const RECEIPT_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionValidationReceiptError");
const authenticReceiptErrors = new WeakSet<KnowledgeForwardRevisionValidationReceiptError>();

function snapshotRecord(
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

function snapshotArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      return undefined;
    }
    const captured: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      captured.push(descriptor.value);
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function isUnicodeScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isIdentifier(value: unknown, maximum = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxPagePathCharacters ||
    !isUnicodeScalarText(value) ||
    hasControlCharacter(value)
  ) {
    return undefined;
  }
  try {
    const parsed = parseVaultPath(value);
    return parsed.ok && parsed.path === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

function invalidReceipt(): never {
  const error = new KnowledgeForwardRevisionValidationReceiptError(RECEIPT_ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

function isAuthenticReceiptError(
  value: unknown
): value is KnowledgeForwardRevisionValidationReceiptError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticReceiptErrors.has(value as KnowledgeForwardRevisionValidationReceiptError)
  );
}

function snapshotValidationContract(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationContractV1> {
  const record = snapshotRecord(value, VALIDATION_CONTRACT_KEYS);
  if (
    !record ||
    record.version !== KNOWLEDGE_FORWARD_REVISION_VALIDATION_CONTRACT_VERSION ||
    record.kind !== "forward_revision_validation_contract" ||
    record.contractId !== "forward_revision_candidate_v1" ||
    record.okfValid !== true ||
    record.citationsValid !== true ||
    record.linksValid !== true
  ) {
    invalidReceipt();
  }
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_VALIDATION_CONTRACT_VERSION,
    kind: "forward_revision_validation_contract" as const,
    contractId: "forward_revision_candidate_v1" as const,
    okfValid: true as const,
    citationsValid: true as const,
    linksValid: true as const,
  });
}

function createValidationContract(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationContractV1> {
  const record = snapshotRecord(value, VALIDATION_SUMMARY_KEYS);
  if (
    !record ||
    record.okfValid !== true ||
    record.citationsValid !== true ||
    record.linksValid !== true
  ) {
    invalidReceipt();
  }
  return snapshotValidationContract({
    version: KNOWLEDGE_FORWARD_REVISION_VALIDATION_CONTRACT_VERSION,
    kind: "forward_revision_validation_contract",
    contractId: "forward_revision_candidate_v1",
    okfValid: true,
    citationsValid: true,
    linksValid: true,
  });
}

function snapshotValidationProfile(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationProfileV1> {
  const record = snapshotRecord(value, VALIDATION_PROFILE_KEYS);
  if (
    !record ||
    record.version !== 1 ||
    record.kind !== "forward_revision_validation_profile" ||
    !isIdentifier(record.profileId) ||
    !isPositiveInteger(record.profileVersion) ||
    !isDigest(record.profileConfigurationDigest) ||
    !isDigest(record.bundleConfigurationDigest) ||
    !isIdentifier(record.validatorImplementationId) ||
    !isPositiveInteger(record.validatorImplementationVersion) ||
    !isDigest(record.validatorImplementationDigest)
  ) {
    invalidReceipt();
  }
  return Object.freeze({
    version: 1 as const,
    kind: "forward_revision_validation_profile" as const,
    profileId: record.profileId,
    profileVersion: Number(record.profileVersion),
    profileConfigurationDigest: record.profileConfigurationDigest,
    bundleConfigurationDigest: record.bundleConfigurationDigest,
    validatorImplementationId: record.validatorImplementationId,
    validatorImplementationVersion: Number(record.validatorImplementationVersion),
    validatorImplementationDigest: record.validatorImplementationDigest,
  });
}

function createValidationProfileDigest(
  value: Readonly<KnowledgeForwardRevisionValidationProfileV1>
): string {
  return digestValue("knowledge-forward-revision-validation-profile-v1", value);
}

function countHistoricalCitationCharacters(value: Readonly<ClaimCitation>): number {
  const locator = value.locator;
  return (
    value.citationId.length +
    value.claimId.length +
    value.relation.length +
    locator.kind.length +
    locator.sourceId.length +
    locator.artifactId.length +
    locator.artifactContentHash.length +
    locator.excerpt.length +
    locator.quoteHash.length +
    (locator.kind === "markdown_lines" ? (locator.heading?.length ?? 0) : 0) +
    (locator.kind === "heading" ? locator.heading.length : 0) +
    (locator.kind === "quote" ? (locator.prefix?.length ?? 0) + (locator.suffix?.length ?? 0) : 0)
  );
}

function isSupportedCitationText(value: string): boolean {
  if (
    value.length > KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxLocatorTextCharacters ||
    !isUnicodeScalarText(value)
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return false;
    }
  }
  return true;
}

function assertHistoricalCitationText(value: Readonly<ClaimCitation>): void {
  const locator = value.locator;
  const text = [
    locator.excerpt,
    ...(locator.kind === "markdown_lines" ? [locator.heading ?? ""] : []),
    ...(locator.kind === "heading" ? [locator.heading] : []),
    ...(locator.kind === "quote" ? [locator.prefix ?? "", locator.suffix ?? ""] : []),
  ];
  if (text.some((item) => !isSupportedCitationText(item))) invalidReceipt();
}

function snapshotHistoricalCitationSet(
  value: unknown,
  expectedPrimarySourceId: string
): readonly Readonly<ClaimCitation>[] {
  const raw = snapshotArray(
    value,
    KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxHistoricalCitations
  );
  if (!raw) invalidReceipt();
  const citations: Readonly<ClaimCitation>[] = [];
  const citationIds = new Set<string>();
  let totalCharacters = 0;
  for (const item of raw) {
    const [citation] = snapshotKnowledgeForwardRevisionHistoricalCitationSet(
      [item],
      expectedPrimarySourceId
    );
    if (!citation || citationIds.has(citation.citationId)) invalidReceipt();
    assertHistoricalCitationText(citation);
    totalCharacters += countHistoricalCitationCharacters(citation);
    if (
      !Number.isSafeInteger(totalCharacters) ||
      totalCharacters >
        KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxTotalEvidenceCharacters
    ) {
      invalidReceipt();
    }
    citationIds.add(citation.citationId);
    citations.push(citation);
  }
  return Object.freeze(citations);
}

function countHistoricalCitationSetCharacters(value: readonly Readonly<ClaimCitation>[]): number {
  return value.reduce((total, locator) => total + countHistoricalCitationCharacters(locator), 0);
}

function snapshotValidationArtifact(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1> {
  const record = snapshotRecord(value, VALIDATION_ARTIFACT_KEYS);
  if (
    !record ||
    record.version !== 1 ||
    record.kind !== "forward_revision_validation_artifact_identity" ||
    (record.artifactKind !== "markdown" &&
      record.artifactKind !== "pdf" &&
      record.artifactKind !== "text") ||
    !isIdentifier(record.sourceId) ||
    !isIdentifier(
      record.artifactId,
      KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxArtifactIdCharacters
    ) ||
    !isDigest(record.artifactContentHash)
  ) {
    invalidReceipt();
  }
  return Object.freeze({
    version: 1 as const,
    kind: "forward_revision_validation_artifact_identity" as const,
    artifactKind: record.artifactKind,
    sourceId: record.sourceId,
    artifactId: record.artifactId,
    artifactContentHash: record.artifactContentHash,
  });
}

function createValidationArtifactKey(
  value: Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>
): string {
  return canonicalizeJson([
    value.sourceId,
    value.artifactId,
    value.artifactContentHash,
    value.artifactKind,
  ] as JsonValue);
}

function countValidationArtifactCharacters(
  value: Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>
): number {
  return (
    value.artifactKind.length +
    value.sourceId.length +
    value.artifactId.length +
    value.artifactContentHash.length
  );
}

function snapshotValidationReadSet(
  value: unknown,
  initialCharacters = 0
): readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[] {
  const raw = snapshotArray(
    value,
    KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxValidationReadSetArtifacts
  );
  if (!raw || raw.length === 0) invalidReceipt();
  const result: Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[] = [];
  const artifactIds = new Set<string>();
  let previousKey: string | undefined;
  let totalCharacters = initialCharacters;
  for (const item of raw) {
    const artifact = snapshotValidationArtifact(item);
    const key = createValidationArtifactKey(artifact);
    const artifactId = canonicalizeJson([artifact.sourceId, artifact.artifactId] as JsonValue);
    totalCharacters += countValidationArtifactCharacters(artifact);
    if (
      (previousKey !== undefined && compareText(previousKey, key) >= 0) ||
      artifactIds.has(artifactId) ||
      !Number.isSafeInteger(totalCharacters) ||
      totalCharacters >
        KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxTotalEvidenceCharacters
    ) {
      invalidReceipt();
    }
    artifactIds.add(artifactId);
    previousKey = key;
    result.push(artifact);
  }
  return Object.freeze(result);
}

function createValidationReadSet(
  value: unknown,
  initialCharacters = 0
): readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[] {
  const raw = snapshotArray(
    value,
    KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxValidationReadSetArtifacts
  );
  if (!raw || raw.length === 0) invalidReceipt();
  const items: Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[] = [];
  let totalCharacters = initialCharacters;
  for (const item of raw) {
    const artifact = snapshotValidationArtifact(item);
    totalCharacters += countValidationArtifactCharacters(artifact);
    if (
      !Number.isSafeInteger(totalCharacters) ||
      totalCharacters >
        KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxTotalEvidenceCharacters
    ) {
      invalidReceipt();
    }
    items.push(artifact);
  }
  items.sort((left, right) =>
    compareText(createValidationArtifactKey(left), createValidationArtifactKey(right))
  );
  return snapshotValidationReadSet(items, initialCharacters);
}

function createValidationObservationSetDigest(
  value: readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[]
): string {
  return digestValue("knowledge-forward-revision-validation-observation-set-v1", value);
}

function digestSourceArtifactObservationBinding(
  acceptanceAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>,
  readSet: readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[]
): string {
  return digestValue("knowledge-forward-revision-source-artifact-binding-v1", {
    acceptanceAuthority,
    artifacts: readSet,
  });
}

export function createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
  acceptanceAuthorityValue: unknown,
  validationReadSetValue: unknown
): string {
  try {
    const authority =
      snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(acceptanceAuthorityValue);
    const readSet = createValidationReadSet(validationReadSetValue);
    return digestSourceArtifactObservationBinding(authority, readSet);
  } catch (error) {
    if (isAuthenticReceiptError(error)) throw error;
    invalidReceipt();
  }
}

function snapshotWarningSummary(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationWarningSummaryV1> | null {
  if (value === null) return null;
  const record = snapshotRecord(value, WARNING_SUMMARY_KEYS);
  if (
    !record ||
    record.version !== 1 ||
    record.kind !== "forward_revision_validation_warning_summary" ||
    !isPositiveInteger(record.count) ||
    Number(record.count) > KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxWarnings ||
    !isDigest(record.digest)
  ) {
    invalidReceipt();
  }
  return Object.freeze({
    version: 1 as const,
    kind: "forward_revision_validation_warning_summary" as const,
    count: Number(record.count),
    digest: record.digest,
  });
}

function assertEvidenceForProposal(
  historical: readonly Readonly<ClaimCitation>[],
  readSet: readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[],
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>
): void {
  const currentSource = proposal.request.intent.current;
  if (
    historical.some((citation) => citation.locator.sourceId !== currentSource.primarySourceId) ||
    !readSet.some((artifact) => artifact.sourceId === currentSource.primarySourceId) ||
    readSet.some((artifact) => artifact.sourceId !== currentSource.primarySourceId) ||
    historical.some(
      (citation) =>
        !readSet.some(
          (artifact) =>
            artifact.sourceId === citation.locator.sourceId &&
            artifact.artifactId === citation.locator.artifactId &&
            artifact.artifactContentHash === citation.locator.artifactContentHash
        )
    )
  ) {
    invalidReceipt();
  }
}

function snapshotCandidateContent(
  command: Readonly<KnowledgeForwardRevisionReviewCommandV1>,
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  afterContent: unknown
): Readonly<{
  action: "accept_exact" | "accept_edited";
  selectedHistoricalHash: string;
  acceptedAfterHash: string;
  manualOverride: boolean;
}> {
  if (
    (command.action !== "accept_exact" && command.action !== "accept_edited") ||
    typeof afterContent !== "string" ||
    (command.action === "accept_exact" && afterContent !== proposal.request.selectedContent) ||
    (command.action === "accept_edited" && afterContent !== command.afterContent)
  ) {
    invalidReceipt();
  }
  const acceptedAfterHash = createFileContentHash(afterContent);
  if (command.action === "accept_edited" && command.afterContentHash !== acceptedAfterHash) {
    invalidReceipt();
  }
  const selectedHistoricalHash = proposal.request.selectedContentHash;
  return Object.freeze({
    action: command.action,
    selectedHistoricalHash,
    acceptedAfterHash,
    manualOverride: acceptedAfterHash !== selectedHistoricalHash,
  });
}

function projectStableAcceptanceAuthority(
  value: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>
): JsonValue {
  const freshness = value.currentSourceFreshness;
  const commonFreshness = Object.freeze({
    kind: freshness.kind,
    runtimeId: freshness.runtimeId,
    bundleId: freshness.bundleId,
    sourceId: freshness.sourceId,
    sourceContentHash: freshness.sourceContentHash,
    pipelineFingerprint: freshness.pipelineFingerprint,
    inputRevision: freshness.inputRevision,
    manifestRevision: freshness.manifestRevision,
    manifestDigest: freshness.manifestDigest,
    committedManifestRevision: freshness.committedManifestRevision,
    completedAt: freshness.completedAt,
  });
  const stableFreshness =
    freshness.kind === "applied"
      ? Object.freeze({
          ...commonFreshness,
          transactionId: freshness.transactionId,
          changeSetId: freshness.changeSetId,
          changeSetDigest: freshness.changeSetDigest,
          manifestIntentDigest: freshness.manifestIntentDigest,
          committedManifestDigest: freshness.committedManifestDigest,
        })
      : Object.freeze({
          ...commonFreshness,
          noChangesId: freshness.noChangesId,
          reason: freshness.reason,
          planDigest: freshness.planDigest,
          jobId: freshness.jobId,
          attempt: freshness.attempt,
        });
  return Object.freeze({
    runtimeId: value.runtimeId,
    manifestRevision: value.manifestRevision,
    manifestDigest: value.manifestDigest,
    manifestBaseHash: value.manifestBaseHash,
    vaultObservedBeforeHash: value.vaultObservedBeforeHash,
    currentSourceFreshness: stableFreshness,
  });
}

function createReceiptPayload(value: {
  runtimeId: string;
  bundleId: string;
  pagePath: string;
  proposalId: string;
  proposalDigest: string;
  requestId: string;
  requestDigest: string;
  intentId: string;
  intentDigest: string;
  commandId: string;
  commandDigest: string;
  action: "accept_exact" | "accept_edited";
  selectedHistoricalHash: string;
  acceptedAfterHash: string;
  manualOverride: boolean;
  validationContract: Readonly<KnowledgeForwardRevisionValidationContractV1>;
  validationProfile: Readonly<KnowledgeForwardRevisionValidationProfileV1>;
  validationProfileDigest: string;
  acceptanceAuthority: Readonly<KnowledgeForwardRevisionAcceptanceAuthority>;
  acceptanceAuthorityDigest: string;
  historicalAcceptedDigest: string;
  historicalCitations: readonly Readonly<ClaimCitation>[];
  historicalCitationSetDigest: string;
  validationReadSet: readonly Readonly<KnowledgeForwardRevisionValidationArtifactIdentityV1>[];
  validationObservationSetDigest: string;
  sourceArtifactObservationBindingDigest: string;
  warningSummary: Readonly<KnowledgeForwardRevisionValidationWarningSummaryV1> | null;
  validatedAt: number;
}) {
  return Object.freeze({
    version: KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_VERSION,
    kind: "forward_revision_validation_receipt" as const,
    ...value,
  });
}

function digestReceiptPayload(value: ReturnType<typeof createReceiptPayload>): string {
  return digestValue("knowledge-forward-revision-validation-receipt-v1", value);
}

function deriveReceiptId(receiptDigest: string): string {
  return `forward-revision-validation-receipt-${receiptDigest}`;
}

export function snapshotKnowledgeForwardRevisionValidationReceipt(
  value: unknown
): Readonly<KnowledgeForwardRevisionValidationReceiptV1> {
  try {
    const record = snapshotRecord(value, RECEIPT_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      !pagePath ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_VERSION ||
      record.kind !== "forward_revision_validation_receipt" ||
      !isIdentifier(record.receiptId) ||
      !RECEIPT_ID_PATTERN.test(record.receiptId) ||
      !isIdentifier(record.runtimeId) ||
      !isIdentifier(record.bundleId) ||
      !isIdentifier(record.proposalId) ||
      !isDigest(record.proposalDigest) ||
      !isIdentifier(record.requestId) ||
      !isDigest(record.requestDigest) ||
      !isIdentifier(record.intentId) ||
      !isDigest(record.intentDigest) ||
      !isIdentifier(record.commandId) ||
      !isDigest(record.commandDigest) ||
      (record.action !== "accept_exact" && record.action !== "accept_edited") ||
      !isDigest(record.selectedHistoricalHash) ||
      !isDigest(record.acceptedAfterHash) ||
      typeof record.manualOverride !== "boolean" ||
      record.manualOverride !== (record.acceptedAfterHash !== record.selectedHistoricalHash) ||
      !isDigest(record.validationProfileDigest) ||
      !isDigest(record.acceptanceAuthorityDigest) ||
      !isDigest(record.historicalAcceptedDigest) ||
      !isDigest(record.historicalCitationSetDigest) ||
      !isDigest(record.validationObservationSetDigest) ||
      !isDigest(record.sourceArtifactObservationBindingDigest) ||
      !isNonNegativeInteger(record.validatedAt) ||
      !isDigest(record.receiptDigest)
    ) {
      invalidReceipt();
    }
    const validationContract = snapshotValidationContract(record.validationContract);
    const validationProfile = snapshotValidationProfile(record.validationProfile);
    const acceptanceAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(
      record.acceptanceAuthority
    );
    const historicalCitations = snapshotHistoricalCitationSet(
      record.historicalCitations,
      acceptanceAuthority.currentSourceFreshness.sourceId
    );
    const validationReadSet = snapshotValidationReadSet(
      record.validationReadSet,
      countHistoricalCitationSetCharacters(historicalCitations)
    );
    const warningSummary = snapshotWarningSummary(record.warningSummary);
    if (
      record.runtimeId !== acceptanceAuthority.runtimeId ||
      record.bundleId !== acceptanceAuthority.currentSourceFreshness.bundleId ||
      Number(record.validatedAt) < acceptanceAuthority.currentSourceFreshness.completedAt ||
      record.acceptedAfterHash === acceptanceAuthority.vaultObservedBeforeHash ||
      record.validationProfileDigest !== createValidationProfileDigest(validationProfile) ||
      record.acceptanceAuthorityDigest !==
        createKnowledgeForwardRevisionAcceptanceAuthorityDigest(acceptanceAuthority) ||
      record.historicalCitationSetDigest !==
        createKnowledgeForwardRevisionHistoricalCitationSetDigest(
          historicalCitations,
          acceptanceAuthority.currentSourceFreshness.sourceId
        ) ||
      record.validationObservationSetDigest !==
        createValidationObservationSetDigest(validationReadSet) ||
      record.sourceArtifactObservationBindingDigest !==
        digestSourceArtifactObservationBinding(acceptanceAuthority, validationReadSet)
    ) {
      invalidReceipt();
    }
    const payload = createReceiptPayload({
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      pagePath,
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      requestId: record.requestId,
      requestDigest: record.requestDigest,
      intentId: record.intentId,
      intentDigest: record.intentDigest,
      commandId: record.commandId,
      commandDigest: record.commandDigest,
      action: record.action,
      selectedHistoricalHash: record.selectedHistoricalHash,
      acceptedAfterHash: record.acceptedAfterHash,
      manualOverride: record.manualOverride,
      validationContract,
      validationProfile,
      validationProfileDigest: record.validationProfileDigest,
      acceptanceAuthority,
      acceptanceAuthorityDigest: record.acceptanceAuthorityDigest,
      historicalAcceptedDigest: record.historicalAcceptedDigest,
      historicalCitations,
      historicalCitationSetDigest: record.historicalCitationSetDigest,
      validationReadSet,
      validationObservationSetDigest: record.validationObservationSetDigest,
      sourceArtifactObservationBindingDigest: record.sourceArtifactObservationBindingDigest,
      warningSummary,
      validatedAt: Number(record.validatedAt),
    });
    const receiptDigest = digestReceiptPayload(payload);
    if (
      record.receiptDigest !== receiptDigest ||
      record.receiptId !== deriveReceiptId(receiptDigest)
    ) {
      invalidReceipt();
    }
    return Object.freeze({
      ...payload,
      receiptId: record.receiptId,
      receiptDigest: record.receiptDigest,
    });
  } catch (error) {
    if (isAuthenticReceiptError(error)) throw error;
    invalidReceipt();
  }
}

export function createKnowledgeForwardRevisionValidationReceipt(
  value: CreateKnowledgeForwardRevisionValidationReceiptInput
): Readonly<KnowledgeForwardRevisionValidationReceiptV1> {
  try {
    const record = snapshotRecord(value, CREATE_INPUT_KEYS);
    if (
      !record ||
      !isDigest(record.proposalDigest) ||
      !isDigest(record.sourceArtifactObservationBindingDigest) ||
      typeof record.afterContent !== "string" ||
      !isNonNegativeInteger(record.validatedAt)
    ) {
      invalidReceipt();
    }
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    if (
      record.proposalDigest !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)
    ) {
      invalidReceipt();
    }
    const command = snapshotKnowledgeForwardRevisionReviewCommandForProposal(
      record.command,
      proposal,
      record.proposalDigest
    );
    const candidate = snapshotCandidateContent(command, proposal, record.afterContent);
    const validationContract = createValidationContract(record.validation);
    const validationProfile = snapshotValidationProfile(record.validationProfile);
    const acceptanceAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
      record.acceptanceAuthority,
      proposal
    );
    if (candidate.acceptedAfterHash === acceptanceAuthority.vaultObservedBeforeHash) {
      invalidReceipt();
    }
    const historicalCitations = snapshotHistoricalCitationSet(
      record.historicalCitations,
      acceptanceAuthority.currentSourceFreshness.sourceId
    );
    const validationReadSet = createValidationReadSet(
      record.validationReadSet,
      countHistoricalCitationSetCharacters(historicalCitations)
    );
    assertEvidenceForProposal(historicalCitations, validationReadSet, proposal);
    const expectedObservationBindingDigest = digestSourceArtifactObservationBinding(
      acceptanceAuthority,
      validationReadSet
    );
    if (record.sourceArtifactObservationBindingDigest !== expectedObservationBindingDigest) {
      invalidReceipt();
    }
    const warningSummary = snapshotWarningSummary(record.warningSummary);
    const validatedAt = Number(record.validatedAt);
    if (
      validatedAt < proposal.recordedAt ||
      validatedAt < proposal.request.historicalReviewAuthority.acceptedAt ||
      validatedAt < acceptanceAuthority.currentSourceFreshness.completedAt
    ) {
      invalidReceipt();
    }
    const request = proposal.request;
    const payload = createReceiptPayload({
      runtimeId: request.runtimeId,
      bundleId: request.bundleId,
      pagePath: request.pagePath,
      proposalId: proposal.proposalId,
      proposalDigest: record.proposalDigest,
      requestId: request.requestId,
      requestDigest: proposal.requestDigest,
      intentId: request.intent.intentId,
      intentDigest: request.intentDigest,
      commandId: command.commandId,
      commandDigest: createKnowledgeForwardRevisionReviewCommandDigest(command),
      action: candidate.action,
      selectedHistoricalHash: candidate.selectedHistoricalHash,
      acceptedAfterHash: candidate.acceptedAfterHash,
      manualOverride: candidate.manualOverride,
      validationContract,
      validationProfile,
      validationProfileDigest: createValidationProfileDigest(validationProfile),
      acceptanceAuthority,
      acceptanceAuthorityDigest:
        createKnowledgeForwardRevisionAcceptanceAuthorityDigest(acceptanceAuthority),
      historicalAcceptedDigest: request.historicalReviewAuthority.acceptedDigest,
      historicalCitations,
      historicalCitationSetDigest: createKnowledgeForwardRevisionHistoricalCitationSetDigest(
        historicalCitations,
        acceptanceAuthority.currentSourceFreshness.sourceId
      ),
      validationReadSet,
      validationObservationSetDigest: createValidationObservationSetDigest(validationReadSet),
      sourceArtifactObservationBindingDigest: expectedObservationBindingDigest,
      warningSummary,
      validatedAt,
    });
    const receiptDigest = digestReceiptPayload(payload);
    return snapshotKnowledgeForwardRevisionValidationReceipt({
      ...payload,
      receiptId: deriveReceiptId(receiptDigest),
      receiptDigest,
    });
  } catch (error) {
    if (isAuthenticReceiptError(error)) throw error;
    invalidReceipt();
  }
}

export function snapshotKnowledgeForwardRevisionValidationReceiptForCandidate(
  receiptValue: unknown,
  proposalValue: unknown,
  proposalDigestValue: unknown,
  commandValue: unknown,
  afterContent: unknown
): Readonly<KnowledgeForwardRevisionValidationReceiptV1> {
  try {
    const receipt = snapshotKnowledgeForwardRevisionValidationReceipt(receiptValue);
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(proposalValue);
    if (
      !isDigest(proposalDigestValue) ||
      proposalDigestValue !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)
    ) {
      invalidReceipt();
    }
    const command = snapshotKnowledgeForwardRevisionReviewCommandForProposal(
      commandValue,
      proposal,
      proposalDigestValue
    );
    const candidate = snapshotCandidateContent(command, proposal, afterContent);
    const request = proposal.request;
    snapshotKnowledgeForwardRevisionAcceptanceAuthority(receipt.acceptanceAuthority, proposal);
    assertEvidenceForProposal(receipt.historicalCitations, receipt.validationReadSet, proposal);
    const expectedObservationBindingDigest = digestSourceArtifactObservationBinding(
      receipt.acceptanceAuthority,
      receipt.validationReadSet
    );
    if (
      receipt.runtimeId !== request.runtimeId ||
      receipt.bundleId !== request.bundleId ||
      receipt.pagePath !== request.pagePath ||
      receipt.proposalId !== proposal.proposalId ||
      receipt.proposalDigest !== proposalDigestValue ||
      receipt.requestId !== request.requestId ||
      receipt.requestDigest !== proposal.requestDigest ||
      receipt.intentId !== request.intent.intentId ||
      receipt.intentDigest !== request.intentDigest ||
      receipt.commandId !== command.commandId ||
      receipt.commandDigest !== createKnowledgeForwardRevisionReviewCommandDigest(command) ||
      receipt.action !== candidate.action ||
      receipt.selectedHistoricalHash !== candidate.selectedHistoricalHash ||
      receipt.acceptedAfterHash !== candidate.acceptedAfterHash ||
      receipt.manualOverride !== candidate.manualOverride ||
      receipt.historicalAcceptedDigest !== request.historicalReviewAuthority.acceptedDigest ||
      receipt.sourceArtifactObservationBindingDigest !== expectedObservationBindingDigest ||
      receipt.validatedAt < proposal.recordedAt ||
      receipt.validatedAt < request.historicalReviewAuthority.acceptedAt
    ) {
      invalidReceipt();
    }
    return receipt;
  } catch (error) {
    if (isAuthenticReceiptError(error)) throw error;
    invalidReceipt();
  }
}

export function snapshotKnowledgeForwardRevisionValidationReceiptForAcceptedCandidate(
  receiptValue: unknown,
  proposalValue: unknown,
  proposalDigestValue: unknown,
  afterContent: unknown,
  acceptanceAuthorityValue: unknown
): Readonly<KnowledgeForwardRevisionValidationReceiptV1> {
  try {
    const receipt = snapshotKnowledgeForwardRevisionValidationReceipt(receiptValue);
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(proposalValue);
    if (
      !isDigest(proposalDigestValue) ||
      proposalDigestValue !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal) ||
      typeof afterContent !== "string"
    ) {
      invalidReceipt();
    }
    const acceptanceAuthority = snapshotKnowledgeForwardRevisionAcceptanceAuthority(
      acceptanceAuthorityValue,
      proposal
    );
    const request = proposal.request;
    const acceptedAfterHash = createFileContentHash(afterContent);
    const expectedCommand = createKnowledgeForwardRevisionReviewCommand(
      receipt.action === "accept_exact"
        ? { action: receipt.action, proposal, proposalDigest: proposalDigestValue }
        : {
            action: receipt.action,
            proposal,
            proposalDigest: proposalDigestValue,
            afterContent,
          }
    );
    assertEvidenceForProposal(receipt.historicalCitations, receipt.validationReadSet, proposal);
    if (
      receipt.runtimeId !== request.runtimeId ||
      receipt.bundleId !== request.bundleId ||
      receipt.pagePath !== request.pagePath ||
      receipt.proposalId !== proposal.proposalId ||
      receipt.proposalDigest !== proposalDigestValue ||
      receipt.requestId !== request.requestId ||
      receipt.requestDigest !== proposal.requestDigest ||
      receipt.intentId !== request.intent.intentId ||
      receipt.intentDigest !== request.intentDigest ||
      receipt.commandId !== expectedCommand.commandId ||
      receipt.commandDigest !==
        createKnowledgeForwardRevisionReviewCommandDigest(expectedCommand) ||
      receipt.selectedHistoricalHash !== request.selectedContentHash ||
      receipt.acceptedAfterHash !== acceptedAfterHash ||
      receipt.manualOverride !== (acceptedAfterHash !== request.selectedContentHash) ||
      (receipt.action === "accept_exact" && afterContent !== request.selectedContent) ||
      receipt.historicalAcceptedDigest !== request.historicalReviewAuthority.acceptedDigest ||
      acceptanceAuthority.runtimeRevision < receipt.acceptanceAuthority.runtimeRevision ||
      (acceptanceAuthority.runtimeRevision === receipt.acceptanceAuthority.runtimeRevision &&
        acceptanceAuthority.runtimeDigest !== receipt.acceptanceAuthority.runtimeDigest) ||
      canonicalizeJson(projectStableAcceptanceAuthority(receipt.acceptanceAuthority)) !==
        canonicalizeJson(projectStableAcceptanceAuthority(acceptanceAuthority))
    ) {
      invalidReceipt();
    }
    return receipt;
  } catch (error) {
    if (isAuthenticReceiptError(error)) throw error;
    invalidReceipt();
  }
}

export function createKnowledgeForwardRevisionValidationReceiptDigest(value: unknown): string {
  return snapshotKnowledgeForwardRevisionValidationReceipt(value).receiptDigest;
}

export function parseKnowledgeForwardRevisionValidationReceipt(
  value: unknown
): KnowledgeParseResult<Readonly<KnowledgeForwardRevisionValidationReceiptV1>> {
  try {
    return { ok: true, value: snapshotKnowledgeForwardRevisionValidationReceipt(value) };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "forward_revision_validation_receipt_invalid",
          severity: "error",
          field: "forwardRevisionValidationReceipt",
          message: "Forward revision validation receipt does not satisfy its strict contract",
        },
      ],
    };
  }
}

export function validateKnowledgeForwardRevisionValidationReceipt(
  value: unknown
): KnowledgeValidationResult {
  const parsed = parseKnowledgeForwardRevisionValidationReceipt(value);
  return parsed.ok
    ? { valid: true, diagnostics: [] }
    : { valid: false, diagnostics: parsed.issues.map(cloneDiagnostic) };
}

function cloneDiagnostic(value: Readonly<KnowledgeDiagnostic>): KnowledgeDiagnostic {
  return { ...value };
}

Object.freeze(KnowledgeForwardRevisionValidationReceiptError.prototype);
Object.freeze(KnowledgeForwardRevisionValidationReceiptError);
