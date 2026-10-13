import type { SourceCustody } from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";

export type KnowledgeSourceLifecycleIssueReason =
  | "source_missing"
  | "source_deleted"
  | "source_renamed";

export interface KnowledgeSourceLifecycleActions {
  canCheckAgain: boolean;
  canRemove: boolean;
}

export interface KnowledgeSourceRemovalConfirmation {
  sourceId: string;
  sourcePath: string;
  retirementRef: string;
  runtimeRevision: number;
  manifestRevision: number;
}

export type KnowledgeSourceLifecycleRetirementBlocker =
  | "active_transaction"
  | "forward_revision_overlay_active"
  | "bundle_work_active"
  | "bundle_rerun_pending"
  | "bundle_review_pending"
  | "bundle_apply_pending"
  | "bundle_apply_recovery_required"
  | "source_observation_pending"
  | "revision_overflow";

interface KnowledgeSourceLifecycleItemBase {
  sourceId: string;
  sourcePath: string;
  custody: SourceCustody;
  generatedPageCount: number;
  retirementRef: string;
  retirementBlockers: readonly KnowledgeSourceLifecycleRetirementBlocker[];
  actions: Readonly<KnowledgeSourceLifecycleActions>;
}

export interface KnowledgeSourceLifecycleReadyItem extends KnowledgeSourceLifecycleItemBase {
  status: "ready";
  issueReason?: never;
}

export interface KnowledgeSourceLifecycleMissingItem extends KnowledgeSourceLifecycleItemBase {
  status: "missing";
  issueReason: KnowledgeSourceLifecycleIssueReason;
}

export type KnowledgeSourceLifecycleItem =
  | KnowledgeSourceLifecycleReadyItem
  | KnowledgeSourceLifecycleMissingItem;

export interface KnowledgeSourceLifecycleModel {
  bundleId: string;
  runtimeRevision: number;
  manifestRevision: number;
  sources: readonly Readonly<KnowledgeSourceLifecycleItem>[];
}

export interface KnowledgeSourceLifecycleModelInput {
  bundleId: string;
  runtimeRevision: number;
  manifestRevision: number;
  sources: readonly KnowledgeSourceLifecycleItem[];
}

export class KnowledgeSourceLifecycleModelError extends TypeError {
  constructor() {
    super("Knowledge source lifecycle model is invalid");
    this.name = "KnowledgeSourceLifecycleModelError";
  }
}

const ISSUE_REASONS = new Set<KnowledgeSourceLifecycleIssueReason>([
  "source_missing",
  "source_deleted",
  "source_renamed",
]);

const RETIREMENT_BLOCKERS = new Set<KnowledgeSourceLifecycleRetirementBlocker>([
  "active_transaction",
  "forward_revision_overlay_active",
  "bundle_work_active",
  "bundle_rerun_pending",
  "bundle_review_pending",
  "bundle_apply_pending",
  "bundle_apply_recovery_required",
  "source_observation_pending",
  "revision_overflow",
]);

function assertIdentifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KnowledgeSourceLifecycleModelError();
  }
}

function assertNonNegativeSafeInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new KnowledgeSourceLifecycleModelError();
  }
}

function snapshotActions(value: unknown): Readonly<KnowledgeSourceLifecycleActions> {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSourceLifecycleModelError();
  }
  const candidate = value as Partial<KnowledgeSourceLifecycleActions>;
  if (typeof candidate.canCheckAgain !== "boolean" || typeof candidate.canRemove !== "boolean") {
    throw new KnowledgeSourceLifecycleModelError();
  }
  return Object.freeze({
    canCheckAgain: candidate.canCheckAgain,
    canRemove: candidate.canRemove,
  });
}

function snapshotRetirementBlockers(
  value: unknown
): readonly KnowledgeSourceLifecycleRetirementBlocker[] {
  if (!Array.isArray(value)) {
    throw new KnowledgeSourceLifecycleModelError();
  }
  const blockers = value.map((blocker) => {
    if (!RETIREMENT_BLOCKERS.has(blocker as KnowledgeSourceLifecycleRetirementBlocker)) {
      throw new KnowledgeSourceLifecycleModelError();
    }
    return blocker as KnowledgeSourceLifecycleRetirementBlocker;
  });
  blockers.sort(compareText);
  if (new Set(blockers).size !== blockers.length) {
    throw new KnowledgeSourceLifecycleModelError();
  }
  return Object.freeze(blockers);
}

function snapshotSource(
  value: KnowledgeSourceLifecycleItem
): Readonly<KnowledgeSourceLifecycleItem> {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeSourceLifecycleModelError();
  }
  assertIdentifier(value.sourceId);
  assertIdentifier(value.retirementRef);
  if (!parseVaultPath(value.sourcePath).ok) {
    throw new KnowledgeSourceLifecycleModelError();
  }
  if (value.custody !== "user_managed" && value.custody !== "managed_copy") {
    throw new KnowledgeSourceLifecycleModelError();
  }
  assertNonNegativeSafeInteger(value.generatedPageCount);
  const actions = snapshotActions(value.actions);
  const retirementBlockers = snapshotRetirementBlockers(value.retirementBlockers);
  if (actions.canRemove && retirementBlockers.length > 0) {
    throw new KnowledgeSourceLifecycleModelError();
  }

  if (value.status === "ready") {
    if (value.issueReason !== undefined || actions.canCheckAgain) {
      throw new KnowledgeSourceLifecycleModelError();
    }
    return Object.freeze({
      sourceId: value.sourceId,
      sourcePath: value.sourcePath,
      custody: value.custody,
      generatedPageCount: value.generatedPageCount,
      retirementRef: value.retirementRef,
      retirementBlockers,
      status: "ready" as const,
      actions,
    });
  }

  if (value.status !== "missing" || !ISSUE_REASONS.has(value.issueReason)) {
    throw new KnowledgeSourceLifecycleModelError();
  }
  return Object.freeze({
    sourceId: value.sourceId,
    sourcePath: value.sourcePath,
    custody: value.custody,
    generatedPageCount: value.generatedPageCount,
    retirementRef: value.retirementRef,
    retirementBlockers,
    status: "missing" as const,
    issueReason: value.issueReason,
    actions,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(
  left: Readonly<KnowledgeSourceLifecycleItem>,
  right: Readonly<KnowledgeSourceLifecycleItem>
): number {
  return (
    compareText(toWindowsPathKey(left.sourcePath), toWindowsPathKey(right.sourcePath)) ||
    compareText(left.sourcePath, right.sourcePath) ||
    compareText(left.sourceId, right.sourceId)
  );
}

export function createKnowledgeSourceLifecycleModel(
  input: KnowledgeSourceLifecycleModelInput
): Readonly<KnowledgeSourceLifecycleModel> {
  if (typeof input !== "object" || input === null || !Array.isArray(input.sources)) {
    throw new KnowledgeSourceLifecycleModelError();
  }
  assertIdentifier(input.bundleId);
  assertNonNegativeSafeInteger(input.runtimeRevision);
  assertNonNegativeSafeInteger(input.manifestRevision);

  const sources = input.sources.map(snapshotSource).sort(compareSources);
  const sourceIds = new Set<string>();
  const sourcePathKeys = new Set<string>();
  const retirementRefs = new Set<string>();
  for (const source of sources) {
    const pathKey = toWindowsPathKey(source.sourcePath);
    if (
      sourceIds.has(source.sourceId) ||
      sourcePathKeys.has(pathKey) ||
      retirementRefs.has(source.retirementRef)
    ) {
      throw new KnowledgeSourceLifecycleModelError();
    }
    sourceIds.add(source.sourceId);
    sourcePathKeys.add(pathKey);
    retirementRefs.add(source.retirementRef);
  }

  return Object.freeze({
    bundleId: input.bundleId,
    runtimeRevision: input.runtimeRevision,
    manifestRevision: input.manifestRevision,
    sources: Object.freeze(sources),
  });
}
