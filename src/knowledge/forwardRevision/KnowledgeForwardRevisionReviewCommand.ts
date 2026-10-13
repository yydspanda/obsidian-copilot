import {
  KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  type KnowledgeForwardRevisionPendingProposalRecordV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { JsonValue, KnowledgeValidationResult } from "@/knowledge/model/types";
import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION = 1 as const;

export const KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPagePathCharacters: 1_024,
  maxAfterContentCharacters:
    KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentCharacters,
  maxAfterContentBytes: KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentBytes,
});

export interface KnowledgeForwardRevisionAcceptExactCommandV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION;
  readonly kind: "forward_revision_review_command";
  readonly commandId: string;
  readonly action: "accept_exact";
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly expectedRecordRevision: 0;
}

export interface KnowledgeForwardRevisionAcceptEditedCommandV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION;
  readonly kind: "forward_revision_review_command";
  readonly commandId: string;
  readonly action: "accept_edited";
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly expectedRecordRevision: 0;
  readonly afterContent: string;
  readonly afterContentHash: string;
}

export interface KnowledgeForwardRevisionRejectCommandV1 {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION;
  readonly kind: "forward_revision_review_command";
  readonly commandId: string;
  readonly action: "reject";
  readonly runtimeId: string;
  readonly bundleId: string;
  readonly pagePath: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly intentId: string;
  readonly intentDigest: string;
  readonly expectedRecordRevision: 0;
}

export type KnowledgeForwardRevisionReviewCommandV1 =
  | KnowledgeForwardRevisionAcceptExactCommandV1
  | KnowledgeForwardRevisionAcceptEditedCommandV1
  | KnowledgeForwardRevisionRejectCommandV1;

export interface CreateKnowledgeForwardRevisionReviewCommandBaseInput {
  readonly action: "accept_exact" | "reject";
  readonly proposal: unknown;
  readonly proposalDigest: string;
}

export interface CreateKnowledgeForwardRevisionAcceptEditedCommandInput {
  readonly action: "accept_edited";
  readonly proposal: unknown;
  readonly proposalDigest: string;
  readonly afterContent: string;
}

export type CreateKnowledgeForwardRevisionReviewCommandInput =
  | CreateKnowledgeForwardRevisionReviewCommandBaseInput
  | CreateKnowledgeForwardRevisionAcceptEditedCommandInput;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMAND_ID_PATTERN = /^forward-revision-review-command-[a-f0-9]{64}$/;
const COMMON_KEYS = [
  "version",
  "kind",
  "commandId",
  "action",
  "runtimeId",
  "bundleId",
  "pagePath",
  "proposalId",
  "proposalDigest",
  "requestId",
  "requestDigest",
  "intentId",
  "intentDigest",
  "expectedRecordRevision",
] as const;
const EDITED_KEYS = [...COMMON_KEYS, "afterContent", "afterContentHash"] as const;

export class KnowledgeForwardRevisionReviewCommandValidationError extends TypeError {
  constructor(authenticityToken?: symbol) {
    super("Forward revision Review command does not satisfy its strict contract");
    this.name = "KnowledgeForwardRevisionReviewCommandValidationError";
    if (authenticityToken === VALIDATION_ERROR_TOKEN) authenticValidationErrors.add(this);
  }
}

const VALIDATION_ERROR_TOKEN = Symbol("KnowledgeForwardRevisionReviewCommandValidationError");
const authenticValidationErrors =
  new WeakSet<KnowledgeForwardRevisionReviewCommandValidationError>();

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

function readDataDiscriminant(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
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

function isValidAfterContentText(value: string): boolean {
  if (!isUnicodeScalarText(value)) return false;
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

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_LIMITS.maxIdentifierCharacters &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function snapshotPagePath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_LIMITS.maxPagePathCharacters ||
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

function digestValue(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

function invalid(): never {
  const error = new KnowledgeForwardRevisionReviewCommandValidationError(VALIDATION_ERROR_TOKEN);
  Object.freeze(error);
  throw error;
}

function isAuthenticValidationError(
  value: unknown
): value is KnowledgeForwardRevisionReviewCommandValidationError {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    authenticValidationErrors.has(value as KnowledgeForwardRevisionReviewCommandValidationError)
  );
}

function commandIdentity(
  proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>,
  proposalDigest: string
) {
  const request = proposal.request;
  return Object.freeze({
    runtimeId: request.runtimeId,
    bundleId: request.bundleId,
    pagePath: request.pagePath,
    proposalId: proposal.proposalId,
    proposalDigest,
    requestId: request.requestId,
    requestDigest: proposal.requestDigest,
    intentId: request.intent.intentId,
    intentDigest: request.intentDigest,
    expectedRecordRevision: 0 as const,
  });
}

function deriveCommandId(
  value: Omit<KnowledgeForwardRevisionReviewCommandV1, "version" | "kind" | "commandId">
): string {
  return `forward-revision-review-command-${digestValue(
    "knowledge-forward-revision-review-command-id-v1",
    value
  )}`;
}

export function createKnowledgeForwardRevisionReviewCommand(
  value: CreateKnowledgeForwardRevisionReviewCommandInput
): Readonly<KnowledgeForwardRevisionReviewCommandV1> {
  try {
    const action = readDataDiscriminant(value, "action");
    const expectedKeys =
      action === "accept_edited"
        ? ["action", "proposal", "proposalDigest", "afterContent"]
        : ["action", "proposal", "proposalDigest"];
    const record = snapshotRecord(value, expectedKeys);
    if (
      !record ||
      (action !== "accept_exact" && action !== "accept_edited" && action !== "reject") ||
      !isDigest(record.proposalDigest)
    ) {
      invalid();
    }
    const proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(record.proposal);
    if (
      record.proposalDigest !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)
    ) {
      invalid();
    }
    const identity = commandIdentity(proposal, record.proposalDigest);
    if (action === "accept_edited") {
      if (
        typeof record.afterContent !== "string" ||
        record.afterContent.length >
          KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_LIMITS.maxAfterContentCharacters ||
        !isValidAfterContentText(record.afterContent) ||
        new TextEncoder().encode(record.afterContent).byteLength >
          KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_LIMITS.maxAfterContentBytes
      ) {
        invalid();
      }
      const afterContentHash = createFileContentHash(record.afterContent);
      const payload = Object.freeze({
        action: "accept_edited" as const,
        ...identity,
        afterContent: record.afterContent,
        afterContentHash,
      });
      return snapshotKnowledgeForwardRevisionReviewCommand({
        version: KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION,
        kind: "forward_revision_review_command",
        commandId: deriveCommandId(payload),
        ...payload,
      });
    }
    const payload = Object.freeze({ action, ...identity }) as Omit<
      KnowledgeForwardRevisionAcceptExactCommandV1 | KnowledgeForwardRevisionRejectCommandV1,
      "version" | "kind" | "commandId"
    >;
    return snapshotKnowledgeForwardRevisionReviewCommand({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION,
      kind: "forward_revision_review_command",
      commandId: deriveCommandId(payload),
      ...payload,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

export function snapshotKnowledgeForwardRevisionReviewCommand(
  value: unknown
): Readonly<KnowledgeForwardRevisionReviewCommandV1> {
  try {
    const action = readDataDiscriminant(value, "action");
    const record = snapshotRecord(value, action === "accept_edited" ? EDITED_KEYS : COMMON_KEYS);
    const pagePath = snapshotPagePath(record?.pagePath);
    if (
      !record ||
      !pagePath ||
      record.version !== KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION ||
      record.kind !== "forward_revision_review_command" ||
      (action !== "accept_exact" && action !== "accept_edited" && action !== "reject") ||
      !isIdentifier(record.commandId) ||
      !COMMAND_ID_PATTERN.test(record.commandId) ||
      !isIdentifier(record.runtimeId) ||
      !isIdentifier(record.bundleId) ||
      !isIdentifier(record.proposalId) ||
      !isDigest(record.proposalDigest) ||
      !isIdentifier(record.requestId) ||
      !isDigest(record.requestDigest) ||
      !isIdentifier(record.intentId) ||
      !isDigest(record.intentDigest) ||
      record.expectedRecordRevision !== 0
    ) {
      invalid();
    }
    const identity = Object.freeze({
      runtimeId: record.runtimeId,
      bundleId: record.bundleId,
      pagePath,
      proposalId: record.proposalId,
      proposalDigest: record.proposalDigest,
      requestId: record.requestId,
      requestDigest: record.requestDigest,
      intentId: record.intentId,
      intentDigest: record.intentDigest,
      expectedRecordRevision: 0 as const,
    });
    if (action === "accept_edited") {
      if (
        typeof record.afterContent !== "string" ||
        record.afterContent.length >
          KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_LIMITS.maxAfterContentCharacters ||
        !isValidAfterContentText(record.afterContent) ||
        new TextEncoder().encode(record.afterContent).byteLength >
          KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_LIMITS.maxAfterContentBytes ||
        !isDigest(record.afterContentHash) ||
        record.afterContentHash !== createFileContentHash(record.afterContent)
      ) {
        invalid();
      }
      const payload = Object.freeze({
        action: "accept_edited" as const,
        ...identity,
        afterContent: record.afterContent,
        afterContentHash: record.afterContentHash,
      });
      if (record.commandId !== deriveCommandId(payload)) invalid();
      return Object.freeze({
        version: KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION,
        kind: "forward_revision_review_command" as const,
        commandId: record.commandId,
        ...payload,
      });
    }
    const payload = Object.freeze({ action, ...identity }) as Omit<
      KnowledgeForwardRevisionAcceptExactCommandV1 | KnowledgeForwardRevisionRejectCommandV1,
      "version" | "kind" | "commandId"
    >;
    if (record.commandId !== deriveCommandId(payload)) invalid();
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_REVIEW_COMMAND_VERSION,
      kind: "forward_revision_review_command" as const,
      commandId: record.commandId,
      ...payload,
    });
  } catch (error) {
    if (isAuthenticValidationError(error)) throw error;
    invalid();
  }
}

export function snapshotKnowledgeForwardRevisionReviewCommandForProposal(
  commandValue: unknown,
  proposalValue: unknown,
  proposalDigestValue: unknown
): Readonly<KnowledgeForwardRevisionReviewCommandV1> {
  const command = snapshotKnowledgeForwardRevisionReviewCommand(commandValue);
  let proposal: Readonly<KnowledgeForwardRevisionPendingProposalRecordV1>;
  try {
    proposal = snapshotKnowledgeForwardRevisionPendingProposalRecord(proposalValue);
  } catch {
    invalid();
  }
  if (
    !isDigest(proposalDigestValue) ||
    proposalDigestValue !== createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)
  ) {
    invalid();
  }
  const expected = commandIdentity(proposal, proposalDigestValue);
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    if (command[key] !== expected[key]) invalid();
  }
  return command;
}

export function createKnowledgeForwardRevisionReviewCommandDigest(value: unknown): string {
  return digestValue(
    "knowledge-forward-revision-review-command-v1",
    snapshotKnowledgeForwardRevisionReviewCommand(value)
  );
}

export function validateKnowledgeForwardRevisionReviewCommand(
  value: unknown
): KnowledgeValidationResult {
  try {
    snapshotKnowledgeForwardRevisionReviewCommand(value);
    return { valid: true, diagnostics: [] };
  } catch {
    return {
      valid: false,
      diagnostics: [
        {
          code: "forward_revision_review_command_invalid",
          severity: "error",
          field: "forwardRevisionReviewCommand",
          message: "Forward revision Review command does not satisfy its strict contract",
        },
      ],
    };
  }
}

Object.freeze(KnowledgeForwardRevisionReviewCommandValidationError.prototype);
Object.freeze(KnowledgeForwardRevisionReviewCommandValidationError);
