import type {
  OutputObservation,
  SourceCompileSnapshot,
  SourceFreshnessDecision,
  SourceStaleReason,
} from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

/** Inputs observed by the manifest layer without performing Vault I/O. */
export interface SourceFreshnessInput {
  lastSuccessful?: SourceCompileSnapshot;
  sourceContentHash: string;
  pipelineFingerprint: string;
  outputs: readonly OutputObservation[];
}

/**
 * Determines whether a source can skip ingestion using durable compile state.
 *
 * A source is current only when its exact bytes and full pipeline fingerprint
 * match and every generated output still exists. Reasons are emitted in stable
 * order so persistence, tests, and UI never depend on incidental iteration.
 *
 * @param input - Last successful snapshot and current source/output observations
 * @returns Up-to-date or ordered reasons the source must be ingested
 */
export function decideSourceFreshness(input: SourceFreshnessInput): SourceFreshnessDecision {
  if (!input.lastSuccessful) {
    return { kind: "needs_ingest", reasons: ["never_ingested"] };
  }

  const reasons: SourceStaleReason[] = [];
  if (input.lastSuccessful.sourceContentHash !== input.sourceContentHash) {
    reasons.push("source_changed");
  }
  if (input.lastSuccessful.pipelineFingerprint !== input.pipelineFingerprint) {
    reasons.push("pipeline_changed");
  }

  const existingOutputs = new Set(
    input.outputs
      .filter((observation) => observation.exists)
      .map((observation) => toWindowsPathKey(observation.path))
  );
  const outputMissing =
    input.lastSuccessful.generatedPages.length === 0 ||
    input.lastSuccessful.generatedPages.some(
      (page) => !existingOutputs.has(toWindowsPathKey(page.path))
    );
  if (outputMissing) {
    reasons.push("output_missing");
  }

  return reasons.length === 0 ? { kind: "up_to_date" } : { kind: "needs_ingest", reasons };
}
