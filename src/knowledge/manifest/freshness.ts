import type {
  GeneratedPageReference,
  OutputObservation,
  SourceCompileSnapshot,
  SourceFreshnessDecision,
  SourceStaleReason,
} from "@/knowledge/model/types";
import type { NoChangesManifestCommitMarker } from "@/knowledge/manifest/NoChangesManifestCommit";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

export interface SourceFreshnessInput {
  lastSuccessful?: SourceCompileSnapshot;

  lastNoChanges?: NoChangesManifestCommitMarker;
  sourceContentHash: string;
  pipelineFingerprint: string;
  outputs: readonly OutputObservation[];
}

export interface ProvenSourceFreshnessInput {
  outcome: "applied" | "no_changes";
  successfulSourceContentHash: string;
  successfulPipelineFingerprint: string;
  generatedPages: readonly GeneratedPageReference[];
  sourceContentHash: string;
  pipelineFingerprint: string;
  outputs: readonly OutputObservation[];
}

function addReason(reasons: SourceStaleReason[], reason: SourceStaleReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function appendOutputReasons(
  reasons: SourceStaleReason[],
  expectedPages: readonly GeneratedPageReference[],
  outputs: readonly OutputObservation[],
  allowEmpty: boolean
): void {
  if (expectedPages.length === 0) {
    if (!allowEmpty) addReason(reasons, "output_missing");
    if (outputs.length > 0) addReason(reasons, "output_unverifiable");
    return;
  }

  const expectedKeys = new Set(expectedPages.map((page) => toWindowsPathKey(page.path)));
  const observations = new Map<string, OutputObservation>();
  for (const observation of outputs) {
    const pathKey = toWindowsPathKey(observation.path);
    if (!expectedKeys.has(pathKey) || observations.has(pathKey)) {
      addReason(reasons, "output_unverifiable");
      continue;
    }
    observations.set(pathKey, observation);
  }

  for (const page of expectedPages) {
    if (!page.contentHash) {
      addReason(reasons, "output_unverifiable");
      continue;
    }
    const observation = observations.get(toWindowsPathKey(page.path));
    if (!observation || observation.kind !== "file") {
      addReason(reasons, "output_missing");
      continue;
    }
    if (observation.contentHash !== page.contentHash) {
      addReason(reasons, "output_changed");
    }
  }
}

export function decideProvenSourceFreshness(
  input: ProvenSourceFreshnessInput
): SourceFreshnessDecision {
  const reasons: SourceStaleReason[] = [];
  if (input.successfulSourceContentHash !== input.sourceContentHash) {
    reasons.push("source_changed");
  }
  if (input.successfulPipelineFingerprint !== input.pipelineFingerprint) {
    reasons.push("pipeline_changed");
  }
  appendOutputReasons(reasons, input.generatedPages, input.outputs, input.outcome === "no_changes");
  return reasons.length === 0 ? { kind: "up_to_date" } : { kind: "needs_ingest", reasons };
}

export function decideSourceFreshness(input: SourceFreshnessInput): SourceFreshnessDecision {
  if (input.lastNoChanges) {
    return decideProvenSourceFreshness({
      outcome: "no_changes",
      successfulSourceContentHash: input.lastNoChanges.sourceContentHash,
      successfulPipelineFingerprint: input.lastNoChanges.pipelineFingerprint,
      generatedPages: input.lastNoChanges.baseGeneratedPages,
      sourceContentHash: input.sourceContentHash,
      pipelineFingerprint: input.pipelineFingerprint,
      outputs: input.outputs,
    });
  }
  if (!input.lastSuccessful) {
    return { kind: "needs_ingest", reasons: ["never_ingested"] };
  }

  return decideProvenSourceFreshness({
    outcome: "applied",
    successfulSourceContentHash: input.lastSuccessful.sourceContentHash,
    successfulPipelineFingerprint: input.lastSuccessful.pipelineFingerprint,
    generatedPages: input.lastSuccessful.generatedPages,
    sourceContentHash: input.sourceContentHash,
    pipelineFingerprint: input.pipelineFingerprint,
    outputs: input.outputs,
  });
}
