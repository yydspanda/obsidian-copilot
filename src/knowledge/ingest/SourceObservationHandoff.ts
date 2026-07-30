import type {
  AllocateSourceInputRevisionRequest,
  BindSourceInputObservationRequest,
  BoundSourceInputObservation,
  SourceInputObservationBinder,
  SourceInputObservationRecoveryWork,
  SourceInputRevisionAllocation,
  SourceInputRevisionAllocator,
} from "@/knowledge/ingest/InputRevisionAllocator";
import type { EnqueueIngestRequest } from "@/knowledge/ingest/queue/IngestQueue";

/** Narrow Queue capability accepted by the production source hand-off. */
export interface SourceObservationEnqueuePort {
  /** Enqueues one runtime-derived exact source observation. */
  enqueue(request: EnqueueIngestRequest): Promise<unknown>;
}

/** Successful or superseded result of the durable bind-to-Queue hand-off. */
export type CommitSourceInputObservationResult =
  | {
      kind: "committed";
      observation: BoundSourceInputObservation;
      queueRevision: number;
    }
  | {
      kind: "superseded";
      bundleId: string;
      sourceId: string;
      captureId: string;
      inputRevision: number;
      supersededByInputRevision: number;
    };

/** Reports a Queue call that returned without a durable terminal hand-off. */
export class SourceObservationHandoffIncompleteError extends Error {
  /** Creates a sanitized fail-closed incomplete hand-off error. */
  constructor() {
    super("The source observation did not reach a durable Queue settlement");
    this.name = "SourceObservationHandoffIncompleteError";
  }
}

/**
 * Production-facing capability that owns allocation, binding, Queue enqueue,
 * and post-call settlement. Watchers should receive this facade instead of the
 * raw Queue storage capability.
 */
export class SourceObservationHandoff {
  /** Creates one durable source-observation hand-off. */
  constructor(
    private readonly allocator: SourceInputRevisionAllocator,
    private readonly binder: SourceInputObservationBinder,
    private readonly queue: SourceObservationEnqueuePort
  ) {}

  /** Allocates before the source adapter begins any asynchronous read. */
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation> {
    return this.allocator.allocate(request);
  }

  /** Loads pending allocations and bound observations after restart. */
  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]> {
    return this.binder.loadRecoveryWork(bundleId);
  }

  /**
   * Binds exact read hashes and durably reconciles the resulting Queue state.
   * A Queue commit whose acknowledgement is lost is detected through the
   * shared observation journal without manufacturing a second Queue receipt.
   *
   * @param request - Opaque allocation capability and exact observed hashes
   * @returns Durable committed observation or supersession
   */
  async commit(
    request: BindSourceInputObservationRequest
  ): Promise<CommitSourceInputObservationResult> {
    let binding: Awaited<ReturnType<SourceInputObservationBinder["bind"]>>;
    try {
      binding = await this.binder.bind(request);
    } catch {
      binding = await this.binder.bind(request);
    }
    if (binding.kind === "superseded") {
      return binding;
    }
    if (binding.kind === "already_consumed") {
      const settlement = await this.binder.settle(request.observationToken);
      if (settlement.kind !== "consumed") {
        throw new SourceObservationHandoffIncompleteError();
      }
      return {
        kind: "committed",
        observation: binding.observation,
        queueRevision: settlement.queueRevision,
      };
    }
    try {
      await this.queue.enqueue(binding.observation);
    } catch (error) {
      const settlement = await this.binder.settle(request.observationToken);
      if (settlement.kind === "superseded") {
        return {
          kind: "superseded",
          bundleId: binding.observation.bundleId,
          sourceId: binding.observation.sourceId,
          captureId: binding.observation.captureId,
          inputRevision: binding.observation.inputRevision,
          supersededByInputRevision: settlement.supersededByInputRevision,
        };
      }
      if (settlement.kind !== "consumed") {
        throw error;
      }
      return {
        kind: "committed",
        observation: binding.observation,
        queueRevision: settlement.queueRevision,
      };
    }
    const settlement = await this.binder.settle(request.observationToken);
    if (settlement.kind === "superseded") {
      return {
        kind: "superseded",
        bundleId: binding.observation.bundleId,
        sourceId: binding.observation.sourceId,
        captureId: binding.observation.captureId,
        inputRevision: binding.observation.inputRevision,
        supersededByInputRevision: settlement.supersededByInputRevision,
      };
    }
    if (settlement.kind !== "consumed") {
      throw new SourceObservationHandoffIncompleteError();
    }
    return {
      kind: "committed",
      observation: binding.observation,
      queueRevision: settlement.queueRevision,
    };
  }
}
