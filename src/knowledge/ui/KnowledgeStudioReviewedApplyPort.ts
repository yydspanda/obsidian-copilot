import type { KnowledgeReviewCommand } from "@/knowledge/review/ReviewDecision";
import type { KnowledgeStudioReviewSubmissionResult } from "@/knowledge/ui/KnowledgeStudioController";

/** Exact selected-review apply function captured from a generation-owned coordinator. */
export type KnowledgeStudioReviewedApplyHandler = (
  bundleId: string,
  command: KnowledgeReviewCommand,
  signal: AbortSignal
) => Promise<KnowledgeStudioReviewSubmissionResult>;

const reviewedApplyHandlers = new WeakMap<object, KnowledgeStudioReviewedApplyHandler>();

/** Creates the platform-standard cancellation used for invalid narrow ports. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Returns the hidden handler only for an authentic narrow port. */
function requireHandler(value: unknown): KnowledgeStudioReviewedApplyHandler {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeStudioReviewedApplyPort.prototype
  ) {
    throw createAbortError();
  }
  const handler = reviewedApplyHandlers.get(value);
  if (!handler) throw createAbortError();
  return handler;
}

/** Narrow content-free facade exposed to the Studio command adapter. */
export class KnowledgeStudioReviewedApplyPort {
  /** Captures one generation-owned reviewed-apply handler. */
  constructor(handler: KnowledgeStudioReviewedApplyHandler) {
    if (typeof handler !== "function") throw createAbortError();
    reviewedApplyHandlers.set(this, handler);
    Object.freeze(this);
  }

  /** Proves a value is one authentic narrow reviewed-apply facade. */
  static assert(value: unknown): asserts value is KnowledgeStudioReviewedApplyPort {
    requireHandler(value);
  }

  /** Delegates one opaque Review command without exposing the owning coordinator. */
  submit(
    bundleId: string,
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeStudioReviewSubmissionResult> {
    return requireHandler(this)(bundleId, command, signal);
  }
}

Object.freeze(KnowledgeStudioReviewedApplyPort.prototype);
Object.freeze(KnowledgeStudioReviewedApplyPort);
