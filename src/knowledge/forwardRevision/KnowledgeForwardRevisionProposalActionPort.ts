import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";
import {
  KnowledgeProductionForwardRevisionProposalCoordinator,
  type KnowledgeForwardRevisionProposalResult,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
import { createKnowledgeForwardRevisionStudioReviewRef } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioProjection";
import type { KnowledgeKnownAppliedWikiOutputsSession } from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

/** Closed UI-safe reasons why one known output cannot become a proposal. */
export type KnowledgeForwardRevisionProposalActionIneligibilityReason =
  | "current_not_applied"
  | "selected_is_current"
  | "forward_origin_not_supported";

/** Value-only proposal result that deliberately withholds publication identifiers. */
export type KnowledgeForwardRevisionProposalActionResult =
  | Readonly<{ kind: "published"; reviewRef: string }>
  | Readonly<{
      kind: "not_eligible";
      reason: KnowledgeForwardRevisionProposalActionIneligibilityReason;
    }>
  | Readonly<{ kind: "stale" | "too_large" | "unavailable" }>;

/** Opaque UI action surface for proposing one output disclosed by an authentic session. */
export interface KnowledgeForwardRevisionProposalActionPort {
  /**
   * Proposes one exact opaque output without accepting page text or caller-chosen identifiers.
   *
   * @param session - Original authentic Known applied outputs session
   * @param outputRef - Opaque output reference disclosed by that session
   * @param signal - Caller cancellation signal
   * @returns Closed value-only proposal result
   */
  proposeKnownOutput(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionProposalActionResult>>;
}

type CoordinatorProposalOperation = (
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
  outputRef: string,
  signal: AbortSignal
) => Promise<Readonly<KnowledgeForwardRevisionProposalResult>>;

interface AdapterState {
  readonly propose: CoordinatorProposalOperation;
  readonly retainDrain: (drain: Promise<void>) => void;
}

const adapterStates = new WeakMap<object, Readonly<AdapterState>>();
const REVIEW_REF_PATTERN = /^forward-studio-review-[a-f0-9]{64}$/;
const STALE_RESULT = Object.freeze({ kind: "stale" as const });
const TOO_LARGE_RESULT = Object.freeze({ kind: "too_large" as const });
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });
const CURRENT_NOT_APPLIED_RESULT = Object.freeze({
  kind: "not_eligible" as const,
  reason: "current_not_applied" as const,
});
const SELECTED_IS_CURRENT_RESULT = Object.freeze({
  kind: "not_eligible" as const,
  reason: "selected_is_current" as const,
});
const FORWARD_ORIGIN_NOT_SUPPORTED_RESULT = Object.freeze({
  kind: "not_eligible" as const,
  reason: "forward_origin_not_supported" as const,
});

/** Reports whether one value is a bounded opaque forward Studio Review reference. */
export function isKnowledgeForwardRevisionProposalReviewRef(value: unknown): value is string {
  return typeof value === "string" && REVIEW_REF_PATTERN.test(value);
}

/** Creates platform-standard cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reports whether one caught value is platform-standard cancellation. */
const isAbortError = isKnowledgeAbortError;

/** Returns hidden state only for one exact module-authentic production adapter. */
function requireAdapterState(value: unknown): Readonly<AdapterState> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !==
        KnowledgeProductionForwardRevisionProposalActionAdapter.prototype
    ) {
      throw createAbortError();
    }
    const state = adapterStates.get(value);
    if (state) return state;
  } catch {
    throw createAbortError();
  }
  throw createAbortError();
}

/** Removes the publication receipt and snapshots one coordinator result to a closed UI value. */
function projectActionResult(
  result: Readonly<KnowledgeForwardRevisionProposalResult>
): Readonly<KnowledgeForwardRevisionProposalActionResult> {
  switch (result.kind) {
    case "published": {
      const reviewRef = createKnowledgeForwardRevisionStudioReviewRef(
        result.receipt.runtimeId,
        result.bundleId,
        result.receipt.proposalId,
        result.receipt.proposalDigest
      );
      return isKnowledgeForwardRevisionProposalReviewRef(reviewRef)
        ? Object.freeze({ kind: "published" as const, reviewRef })
        : UNAVAILABLE_RESULT;
    }
    case "stale":
      return STALE_RESULT;
    case "too_large":
      return TOO_LARGE_RESULT;
    case "unavailable":
      return UNAVAILABLE_RESULT;
    case "not_eligible":
      switch (result.reason) {
        case "current_not_applied":
          return CURRENT_NOT_APPLIED_RESULT;
        case "selected_is_current":
          return SELECTED_IS_CURRENT_RESULT;
        case "forward_origin_not_supported":
          return FORWARD_ORIGIN_NOT_SUPPORTED_RESULT;
      }
  }
}

/** Genuine adapter from the production coordinator to the receipt-free UI action surface. */
export class KnowledgeProductionForwardRevisionProposalActionAdapter
  implements KnowledgeForwardRevisionProposalActionPort
{
  /**
   * Captures one exact production coordinator and its required cross-generation drain owner.
   *
   * @param coordinator - Exact generation-owned production proposal coordinator
   * @param retainDrain - Vault-lifecycle retention for every dispatched proposal operation
   */
  constructor(
    coordinator: KnowledgeProductionForwardRevisionProposalCoordinator,
    retainDrain: (drain: Promise<void>) => void
  ) {
    KnowledgeProductionForwardRevisionProposalCoordinator.assert(coordinator);
    if (typeof retainDrain !== "function") throw createAbortError();
    adapterStates.set(
      this,
      Object.freeze({
        propose: (
          session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
          outputRef: string,
          signal: AbortSignal
        ) => coordinator.proposeKnownOutput(session, outputRef, signal),
        retainDrain: (drain: Promise<void>) => retainDrain(drain),
      })
    );
    Object.freeze(this);
  }

  /** Requires one exact process-local production adapter. */
  static assert(
    value: unknown
  ): asserts value is KnowledgeProductionForwardRevisionProposalActionAdapter {
    requireAdapterState(value);
  }

  /**
   * Delegates an authentic opaque selection and withholds every durable identifier.
   *
   * A pre-dispatch abort wins. After dispatch, the coordinator owns the durable
   * boundary: a confirmed publication is returned even if cancellation arrives
   * after its atomic publish call.
   */
  async proposeKnownOutput(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionProposalActionResult>> {
    const state = requireAdapterState(this);
    if (signal.aborted) throw createAbortError();
    const operation = state.propose(session, outputRef, signal);
    state.retainDrain(
      operation.then(
        () => undefined,
        () => undefined
      )
    );
    try {
      const result = await operation;
      return projectActionResult(result);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw createAbortError();
      return UNAVAILABLE_RESULT;
    }
  }
}

Object.freeze(KnowledgeProductionForwardRevisionProposalActionAdapter.prototype);
Object.freeze(KnowledgeProductionForwardRevisionProposalActionAdapter);
