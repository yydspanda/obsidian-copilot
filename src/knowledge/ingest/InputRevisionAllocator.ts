export interface AllocateSourceInputRevisionRequest {
  bundleId: string;
  sourceId: string;

  captureId: string;
}

export interface SourceInputRevisionAllocation {
  bundleId: string;
  sourceId: string;
  captureId: string;
  inputRevision: number;
  observationToken: string;
}

export interface BindSourceInputObservationRequest {
  observationToken: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
}

export interface BoundSourceInputObservation {
  bundleId: string;
  sourceId: string;
  captureId: string;
  inputRevision: number;
  observationToken: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
}

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

export type SourceInputObservationSettlement =
  | { kind: "pending" }
  | { kind: "consumed"; queueRevision: number }
  | { kind: "superseded"; supersededByInputRevision: number };

export type SourceInputObservationRecoveryWork =
  | {
      kind: "allocated";
      allocation: SourceInputRevisionAllocation;
    }
  | {
      kind: "bound";
      observation: BoundSourceInputObservation;
    };

export interface SourceInputRevisionAllocator {
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation>;
}

export interface SourceInputObservationBinder {
  bind(request: BindSourceInputObservationRequest): Promise<BindSourceInputObservationResult>;

  settle(observationToken: string): Promise<SourceInputObservationSettlement>;

  loadRecoveryWork(bundleId: string): Promise<SourceInputObservationRecoveryWork[]>;
}
