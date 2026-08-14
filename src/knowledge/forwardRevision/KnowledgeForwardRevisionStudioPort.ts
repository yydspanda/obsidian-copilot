import {
  isValidKnowledgeReviewManualEditText,
  KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS,
  snapshotKnowledgeReviewCommand,
  type KnowledgeReviewCommand,
  type KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";

/** Current opaque Forward Studio command version. */
export const KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION = 1 as const;

/** One pending forward proposal rendered through the reusable Review surface. */
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

/** One accepted decision that is durably ready for a fresh Apply attempt. */
export interface KnowledgeForwardRevisionStudioAcceptedReadyReview {
  readonly state: "accepted_ready";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly pagePath: string;
  readonly updatedAt: number;
  readonly acceptedAt: number;
  readonly manualOverride: boolean;
}

/** One accepted decision already owned by a durable Apply journal. */
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

/** One accepted decision stopped behind a sticky exact-file conflict. */
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

/** Closed active Forward Review work rendered by Knowledge Studio. */
export type KnowledgeForwardRevisionStudioReview =
  | KnowledgeForwardRevisionStudioPendingReview
  | KnowledgeForwardRevisionStudioAcceptedReadyReview
  | KnowledgeForwardRevisionStudioApplyingReview
  | KnowledgeForwardRevisionStudioRecoveryRequiredReview;

/** One detached product snapshot containing no durable mutation carrier. */
export interface KnowledgeForwardRevisionStudioUiSnapshot {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly revisionToken: string;
  readonly reviews: readonly Readonly<KnowledgeForwardRevisionStudioReview>[];
}

/** Exact or rejected action carrying no caller-selected content. */
export interface KnowledgeForwardRevisionStudioSimpleCommand {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION;
  readonly kind: "forward_revision_studio_command";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly action: "accept_exact" | "reject" | "apply";
}

/** Manual whole-file action whose content is still rejoined and revalidated. */
export interface KnowledgeForwardRevisionStudioEditedCommand {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION;
  readonly kind: "forward_revision_studio_command";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly action: "accept_edited";
  readonly afterContent: string;
}

/** Partial Review action carrying only opaque changed-block identifiers. */
export interface KnowledgeForwardRevisionStudioBlocksCommand {
  readonly version: typeof KNOWLEDGE_FORWARD_REVISION_STUDIO_COMMAND_VERSION;
  readonly kind: "forward_revision_studio_command";
  readonly reviewRef: string;
  readonly snapshotRef: string;
  readonly action: "accept_blocks";
  readonly acceptedBlockIds: readonly string[];
}

/** Closed product command accepted by the Forward Studio coordinator. */
export type KnowledgeForwardRevisionStudioCommand =
  | KnowledgeForwardRevisionStudioSimpleCommand
  | KnowledgeForwardRevisionStudioEditedCommand
  | KnowledgeForwardRevisionStudioBlocksCommand;

/** Value-only result that never exposes decisions, claims, journals, or ledgers. */
export type KnowledgeForwardRevisionStudioSubmissionResult =
  | Readonly<{
      kind: "applied" | "rejected" | "accepted_ready" | "applying" | "no_change";
    }>
  | Readonly<{ kind: "recovery_required" | "stale" | "unavailable" }>;

/** Read and action boundary consumed by the generation-owned Studio adapter. */
export interface KnowledgeForwardRevisionStudioPort {
  /** Loads the exact active Forward Review work for one Bundle. */
  loadForwardRevisionStudio(
    bundleId: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionStudioUiSnapshot>>;

  /** Submits one opaque current action and reloads durable truth afterward. */
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

/** Reads one exact plain data record without invoking caller accessors. */
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

/** Reads one dense bounded string array through data descriptors only. */
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

/** Requires the common opaque identity shared by every Forward Studio command. */
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

/** Strictly snapshots one UI command before any hidden-row lookup. */
export function snapshotKnowledgeForwardRevisionStudioCommand(
  value: unknown
): Readonly<KnowledgeForwardRevisionStudioCommand> {
  const simple = snapshotRecord(value, SIMPLE_KEYS);
  const simpleBase = snapshotCommandBase(simple);
  if (
    simpleBase &&
    (simple?.action === "accept_exact" || simple?.action === "reject" || simple?.action === "apply")
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

/** Converts the reusable single-file Review command into the distinct Forward command union. */
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

/** Creates the one opaque retry command permitted for an accepted-ready row. */
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
