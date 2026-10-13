import { KnowledgeSourceExecutionPlan } from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeReviewEvidenceSourceAuthorityPort } from "@/knowledge/review/KnowledgeProductionReviewEvidenceCoordinator";

export interface KnowledgeProductionReviewEvidenceSourceAuthorityInput {
  readonly plan: KnowledgeSourceExecutionPlan;
  readonly bundleId: string;
  readonly assertCurrent: () => void;
}

interface KnowledgeProductionReviewEvidenceSourceAuthorityState {
  readonly plan: KnowledgeSourceExecutionPlan;
  readonly bundleId: string;
  readonly assertCurrent: () => void;
}

const authorityStates = new WeakMap<
  object,
  KnowledgeProductionReviewEvidenceSourceAuthorityState
>();

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function assertInvocation(
  state: KnowledgeProductionReviewEvidenceSourceAuthorityState,
  signal: AbortSignal
): void {
  if (signal.aborted) throw createAbortError();
  state.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

function requireAuthorityState(
  value: unknown
): KnowledgeProductionReviewEvidenceSourceAuthorityState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeProductionReviewEvidenceSourceAuthority.prototype
  ) {
    throw createAbortError();
  }
  const state = authorityStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

export class KnowledgeProductionReviewEvidenceSourceAuthority implements KnowledgeReviewEvidenceSourceAuthorityPort {
  constructor(input: KnowledgeProductionReviewEvidenceSourceAuthorityInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      !isIdentifier(input.bundleId) ||
      typeof input.assertCurrent !== "function"
    ) {
      throw createAbortError();
    }
    KnowledgeSourceExecutionPlan.assert(input.plan);
    input.assertCurrent();
    if (!input.plan.getWatchPlan().getBundleAuthority(input.bundleId)) {
      throw createAbortError();
    }
    authorityStates.set(this, {
      plan: input.plan,
      bundleId: input.bundleId,
      assertCurrent: input.assertCurrent,
    });
    Object.freeze(this);
  }

  async resolve(
    bundleId: string,
    sourceId: string,
    signal: AbortSignal
  ): Promise<Readonly<{ sourcePath: string }> | undefined> {
    const state = requireAuthorityState(this);
    if (bundleId !== state.bundleId || !isIdentifier(sourceId)) return undefined;
    assertInvocation(state, signal);
    const authorities = await state.plan.reproveBundleAuthorities(bundleId, signal);
    assertInvocation(state, signal);
    const matches = authorities.manifest.entries.filter((entry) => entry.sourceId === sourceId);
    const watched = state.plan.getWatchPlan().getSource(bundleId, sourceId);
    if (
      matches.length !== 1 ||
      !watched ||
      matches[0].sourcePath !== watched.sourcePath ||
      matches[0].sourceKey !== watched.sourceKey ||
      matches[0].sourceKey !== toWindowsPathKey(matches[0].sourcePath)
    ) {
      return undefined;
    }
    assertInvocation(state, signal);
    return Object.freeze({ sourcePath: watched.sourcePath });
  }
}

Object.freeze(KnowledgeProductionReviewEvidenceSourceAuthority.prototype);
Object.freeze(KnowledgeProductionReviewEvidenceSourceAuthority);
