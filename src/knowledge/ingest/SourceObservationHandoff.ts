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

export interface SourceObservationEnqueuePort {
  enqueue(request: EnqueueIngestRequest): Promise<unknown>;
}

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

export class SourceObservationHandoffIncompleteError extends Error {
  constructor() {
    super("The source observation did not reach a durable Queue settlement");
    this.name = "SourceObservationHandoffIncompleteError";
  }
}

export class SourceObservationHandoff {
  constructor(
    private readonly allocator: SourceInputRevisionAllocator,
    private readonly binder: SourceInputObservationBinder,
    private readonly queue: SourceObservationEnqueuePort
  ) {}

  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation> {
    return this.allocator.allocate(request);
  }

  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]> {
    return this.binder.loadRecoveryWork(bundleId);
  }

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
