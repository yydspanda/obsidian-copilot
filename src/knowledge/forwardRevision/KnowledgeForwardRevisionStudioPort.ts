import {
  isValidKnowledgeReviewManualEditText,
  KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS,
  snapshotKnowledgeReviewCommand,
  type KnowledgeReviewCommand,
  type KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";

export const KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION = 1 as const;

export interface KnowledgeForwardRevisionStudioPendingReview {
  readonly state: "pending";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly requestedAt: number;
  readonly selectedAppliedAt: number;
  readonly plan: Readonly<KnowledgeReviewPlan>;
}

export interface KnowledgeForwardRevisionStudioAcceptedReadyReview {
  readonly state: "accepted_ready";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly manualOverride: boolean;
}

export interface KnowledgeForwardRevisionStudioAbandonedReview {
  readonly state: "abandoned";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly abandonedAt: number;
  readonly manualOverride: boolean;
}

export interface KnowledgeForwardRevisionStudioKeptCurrentReview {
  readonly state: "kept_current";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly terminalizedAt: number;
  readonly manualOverride: boolean;
  readonly outcome:
    | "abandoned_before_write"
    | "write_outcome_uncertain_external_supersession"
    | "committed_then_external_supersession";
}

export interface KnowledgeForwardRevisionStudioApplyingReview {
  readonly state: "applying";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly manualOverride: boolean;
  readonly applyPhase: "prepared" | "applying" | "committed";
}

export interface KnowledgeForwardRevisionStudioRecoveryRequiredReview {
  readonly state: "recovery_required";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly manualOverride: boolean;
  readonly conflictCode: "file_state_conflict" | "post_write_verification_failed";
  readonly actualKind: "missing" | "directory" | "file" | "oversized_file";
  readonly detectedAt: number;
}

export type KnowledgeForwardRevisionStudioReview =
  | KnowledgeForwardRevisionStudioPendingReview
  | KnowledgeForwardRevisionStudioAcceptedReadyReview
  | KnowledgeForwardRevisionStudioAbandonedReview
  | KnowledgeForwardRevisionStudioKeptCurrentReview
  | KnowledgeForwardRevisionStudioApplyingReview
  | KnowledgeForwardRevisionStudioRecoveryRequiredReview;

export interface KnowledgeForwardRevisionStudioUiSnapshot {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly revisionToken: string;
  readonly reviews: readonly Readonly<KnowledgeForwardRevisionStudioReview>[];
}

export interface KnowledgeForwardRevisionStudioSimpleCommand {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION;
  readonly kind: "forward_revision_studio_command";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly action:
    | "accept_exact"
    | "reject"
    | "apply"
    | "abandon"
    | "retry_recovery"
    | "keep_current";
}

export interface KnowledgeForwardRevisionStudioEditedCommand {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION;
  readonly kind: "forward_revision_studio_command";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly action: "accept_edited";
  readonly afterContent: string;
}

export interface KnowledgeForwardRevisionStudioBlocksCommand {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION;
  readonly kind: "forward_revision_studio_command";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly action: "accept_blocks";
  readonly acceptedBlockIds: readonly string[];
}

export type KnowledgeForwardRevisionStudioCommand =
  | KnowledgeForwardRevisionStudioSimpleCommand
  | KnowledgeForwardRevisionStudioEditedCommand
  | KnowledgeForwardRevisionStudioBlocksCommand;

export type KnowledgeForwardRevisionStudioSubmissionResult =
  | Readonly<{
      kind:
        | "applied"
        | "rejected"
        | "accepted_ready"
        | "abandoned"
        | "kept_current"
        | "applying"
        | "no_change";
    }>
  | Readonly<{ kind: "recovery_required" | "stale" | "unavailable" }>;

export interface KnowledgeForwardRevisionStudioPort {
  loadForwardRevisionStudio(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionStudioUiSnapshot>>;

  submitForwardRevisionStudio(
    bundleId: string,
    command: KnowledgeForwardRevisionStudioCommand,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionStudioSubmissionResult>>;
}

const SIMPLE_KEYS = ["version", "kind", "reviewRef", "snapshotRef", "action"] as const;
const EDITED_KEYS = [...SIMPLE_KEYS, "afterContent"] as const;
const BLOCKS_KEYS = [...SIMPLE_KEYS, "acceptedBlockIds"] as const;
const REVIEW_REF_PATTERN = /^forward-studio-review-[a-f0-9]{64}$/;
const SNAPSHOT_REF_PATTERN = /^forward-studio-snapshot-[a-f0-9]{64}$/;
const BLOCK_REF_PATTERN = /^review-block-[a-f0-9]{64}$/;
const MAX_BLOCK_IDS = 10_000;

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
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function snapshotBlockIds(value: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
    if (
      !Number.isSafeInteger(length) ||
      Number(length) < 0 ||
      Number(length) > MAX_BLOCK_IDS ||
      Reflect.ownKeys(value).length !== Number(length) + 1
    ) {
      return undefined;
    }
    const result: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < Number(length); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const item = descriptor && "value" in descriptor ? descriptor.value : undefined;
      if (
        !descriptor?.enumerable ||
        typeof item !== "string" ||
        !BLOCK_REF_PATTERN.test(item) ||
        seen.has(item)
      ) {
        return undefined;
      }
      seen.add(item);
      result.push(item);
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

function snapshotCommandBase(record: Readonly<Record<string, unknown>> | undefined):
  | Readonly<{
      reviewRef: string;
      snapshotRef: string;
    }>
  | undefined {
  if (
    !record ||
    record.version !== KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION ||
    record.kind !== "forward_revision_studio_command" ||
    typeof record.reviewRef !== "string" ||
    !REVIEW_REF_PATTERN.test(record.reviewRef) ||
    typeof record.snapshotRef !== "string" ||
    !SNAPSHOT_REF_PATTERN.test(record.snapshotRef)
  ) {
    return undefined;
  }
  return Object.freeze({ reviewRef: record.reviewRef, snapshotRef: record.snapshotRef });
}

export function snapshotKnowledgeForwardRevisionStudioCommand(
  value: unknown
): Readonly<KnowledgeForwardRevisionStudioCommand> {
  const simple = snapshotRecord(value, SIMPLE_KEYS);
  const simpleBase = snapshotCommandBase(simple);
  if (
    simpleBase &&
    (simple?.action === "accept_exact" ||
      simple?.action === "reject" ||
      simple?.action === "apply" ||
      simple?.action === "abandon" ||
      simple?.action === "retry_recovery" ||
      simple?.action === "keep_current")
  ) {
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
      kind: "forward_revision_studio_command" as const,
      ...simpleBase,
      action: simple.action,
    });
  }

  const edited = snapshotRecord(value, EDITED_KEYS);
  const editedBase = snapshotCommandBase(edited);
  if (
    editedBase &&
    edited?.action === "accept_edited" &&
    typeof edited.afterContent === "string" &&
    edited.afterContent.length <= KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile &&
    isValidKnowledgeReviewManualEditText(edited.afterContent)
  ) {
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
      kind: "forward_revision_studio_command" as const,
      ...editedBase,
      action: "accept_edited" as const,
      afterContent: edited.afterContent,
    });
  }

  const blocks = snapshotRecord(value, BLOCKS_KEYS);
  const blocksBase = snapshotCommandBase(blocks);
  const acceptedBlockIds = snapshotBlockIds(blocks?.acceptedBlockIds);
  if (blocksBase && blocks?.action === "accept_blocks" && acceptedBlockIds) {
    return Object.freeze({
      version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
      kind: "forward_revision_studio_command" as const,
      ...blocksBase,
      action: "accept_blocks" as const,
      acceptedBlockIds,
    });
  }
  throw new TypeError("Forward revision Studio command is invalid");
}

export function createKnowledgeForwardRevisionStudioCommandFromReview(
  review: Readonly<KnowledgeForwardRevisionStudioPendingReview>,
  value: KnowledgeReviewCommand
): Readonly<KnowledgeForwardRevisionStudioCommand> {
  const command = snapshotKnowledgeReviewCommand(value);
  const plan = review.plan;
  if (
    command.changeSetId !== plan.changeSetId ||
    command.proposalDigest !== plan.proposalDigest ||
    command.expectedSnapshotToken !== plan.snapshotToken ||
    plan.files.length !== 1 ||
    command.decisions.length !== 1 ||
    command.decisions[0].changeId !== plan.files[0].changeId
  ) {
    throw new TypeError("Forward revision Review command is stale");
  }
  const decision = command.decisions[0];
  const base = {
    version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
    kind: "forward_revision_studio_command" as const,
    reviewRef: review.reviewRef,
    snapshotRef: review.snapshotRef,
  };
  if (decision.decision === "accept_edited") {
    return snapshotKnowledgeForwardRevisionStudioCommand({
      ...base,
      action: "accept_edited",
      afterContent: decision.afterContent,
    });
  }
  if (decision.decision === "accept_blocks") {
    return snapshotKnowledgeForwardRevisionStudioCommand({
      ...base,
      action: "accept_blocks",
      acceptedBlockIds: [...decision.acceptedBlockIds],
    });
  }
  return snapshotKnowledgeForwardRevisionStudioCommand({
    ...base,
    action: decision.decision,
  });
}

export function createKnowledgeForwardRevisionStudioApplyCommand(
  review: Readonly<KnowledgeForwardRevisionStudioAcceptedReadyReview>
): Readonly<KnowledgeForwardRevisionStudioSimpleCommand> {
  return snapshotKnowledgeForwardRevisionStudioCommand({
    version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
    kind: "forward_revision_studio_command",
    reviewRef: review.reviewRef,
    snapshotRef: review.snapshotRef,
    action: "apply",
  }) as Readonly<KnowledgeForwardRevisionStudioSimpleCommand>;
}

export function createKnowledgeForwardRevisionStudioAbandonCommand(
  review: Readonly<KnowledgeForwardRevisionStudioAcceptedReadyReview>
): Readonly<KnowledgeForwardRevisionStudioSimpleCommand> {
  return snapshotKnowledgeForwardRevisionStudioCommand({
    version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
    kind: "forward_revision_studio_command",
    reviewRef: review.reviewRef,
    snapshotRef: review.snapshotRef,
    action: "abandon",
  }) as Readonly<KnowledgeForwardRevisionStudioSimpleCommand>;
}

export function createKnowledgeForwardRevisionStudioRetryRecoveryCommand(
  review: Readonly<KnowledgeForwardRevisionStudioRecoveryRequiredReview>
): Readonly<KnowledgeForwardRevisionStudioSimpleCommand> {
  return snapshotKnowledgeForwardRevisionStudioCommand({
    version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
    kind: "forward_revision_studio_command",
    reviewRef: review.reviewRef,
    snapshotRef: review.snapshotRef,
    action: "retry_recovery",
  }) as Readonly<KnowledgeForwardRevisionStudioSimpleCommand>;
}

export function createKnowledgeForwardRevisionStudioKeepCurrentCommand(
  review: Readonly<KnowledgeForwardRevisionStudioRecoveryRequiredReview>
): Readonly<KnowledgeForwardRevisionStudioSimpleCommand> {
  return snapshotKnowledgeForwardRevisionStudioCommand({
    version: KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION,
    kind: "forward_revision_studio_command",
    reviewRef: review.reviewRef,
    snapshotRef: review.snapshotRef,
    action: "keep_current",
  }) as Readonly<KnowledgeForwardRevisionStudioSimpleCommand>;
}
