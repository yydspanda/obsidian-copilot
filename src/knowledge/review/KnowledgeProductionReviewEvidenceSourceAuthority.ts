import { KnowledgeSourceExecutionPlan } from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import type { KnowledgeReviewEvidenceSourceAuthorityPort } from "@/knowledge/review/KnowledgeProductionReviewEvidenceCoordinator";

/** Dependencies retained by one production Review evidence source-authority bridge. */
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

/** Creates the platform-standard cancellation category without retaining a reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Re-proves caller cancellation and workflow ownership at one boundary. */
function assertInvocation(
  state: KnowledgeProductionReviewEvidenceSourceAuthorityState,
  signal: AbortSignal
): void {
  if (signal.aborted) throw createAbortError();
  state.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

/** Returns hidden state only for an authentic source-authority instance. */
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

/** Reports whether one input is a canonical non-empty identifier. */
function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/**
 * Resolves current Review citation sources only through an authenticated workflow plan.
 *
 * Every invocation re-proves the exact Bundle Manifest/schema/profile generation, then
 * requires a unique Manifest source and an identical retained watch-plan path and key.
 */
export class KnowledgeProductionReviewEvidenceSourceAuthority implements KnowledgeReviewEvidenceSourceAuthorityPort {
  /** Captures one exact workflow plan and Bundle owner. */
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

  /** Re-proves and resolves one exact registered source as a path-only frozen receipt. */
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
