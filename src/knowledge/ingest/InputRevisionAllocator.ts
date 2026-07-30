/** Identity supplied by a source adapter for one retryable watcher capture. */
export interface AllocateSourceInputRevisionRequest {
  bundleId: string;
  sourceId: string;
  /** Globally unique opaque id, stable across retries and never reused. */
  captureId: string;
}

/** Opaque durable capability issued for one source observation capture. */
export interface SourceInputRevisionAllocation {
  bundleId: string;
  sourceId: string;
  captureId: string;
  inputRevision: number;
  observationToken: string;
}

/** Exact bytes and pipeline identity observed after allocation. */
export interface BindSourceInputObservationRequest {
  observationToken: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
}

/** Queue-safe source observation reconstructed from runtime-owned identity. */
export interface BoundSourceInputObservation {
  bundleId: string;
  sourceId: string;
  captureId: string;
  inputRevision: number;
  observationToken: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
}

/** Result of first-write-wins source binding or an exact retry. */
export type BindSourceInputObservationResult =
  | {
      kind: "ready" | "already_consumed";
      observation: BoundSourceInputObservation;
    }
  | {
      kind: "superseded";
      bundleId: string;
      sourceId: string;
      captureId: string;
      inputRevision: number;
      supersededByInputRevision: number;
    };

/** Durable terminal state observed after Queue enqueue or an uncertain retry. */
export type SourceInputObservationSettlement =
  | { kind: "pending" }
  | { kind: "consumed"; queueRevision: number }
  | { kind: "superseded"; supersededByInputRevision: number };

/** Restart-recovery work retained before one observation reaches Queue. */
export type SourceInputObservationRecoveryWork =
  | {
      kind: "allocated";
      allocation: SourceInputRevisionAllocation;
    }
  | {
      kind: "bound";
      observation: BoundSourceInputObservation;
    };

/** Durable allocator used before reading one exact source input. */
export interface SourceInputRevisionAllocator {
  /**
   * Allocates a strictly newer revision for a new capture, or returns the same
   * capability when the caller retries an identical `captureId` after an
   * uncertain persistence result.
   *
   * The source adapter must allocate before any asynchronous read or parse.
   * Equal content still receives a newer observation revision.
   *
   * @param request - Stable Bundle, source, and capture identity
   * @returns Opaque capability that can bind only this allocation
   */
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation>;
}

/** Durable first-write-wins hand-off between source reading and Queue enqueue. */
export interface SourceInputObservationBinder {
  /**
   * Binds one allocated capability to the hashes computed from the exact read.
   * The returned observation is the only payload a source adapter should pass
   * to the Queue. Exact retries are byte-preserving; conflicting bindings fail.
   *
   * @param request - Opaque allocation token and exact observed hashes
   * @returns Queue-safe observation or a durable supersession result
   */
  bind(request: BindSourceInputObservationRequest): Promise<BindSourceInputObservationResult>;

  /**
   * Reconciles one bound observation with the current Queue high-watermark.
   * This closes the byte-preserving enqueue paths where Queue did not need a
   * write, and resolves commit-then-throw retries without guessing success.
   *
   * @param observationToken - Opaque token issued by the allocator
   * @returns Current durable hand-off state
   */
  settle(observationToken: string): Promise<SourceInputObservationSettlement>;

  /**
   * Loads pending captures after restart without exposing terminal history.
   * A recovery coordinator may re-read an allocated capture using a new event,
   * or enqueue a bound observation only after revalidating current source bytes.
   *
   * @param bundleId - Bundle whose pending source work should be recovered
   * @returns Stable source/revision ordered recovery work
   */
  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]>;
}
