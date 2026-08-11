import type { KnowledgeProductionObservationResult } from "@/knowledge/startup/KnowledgeProductionObservationComposer";
import type { KnowledgePluginObservationStartupResult } from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import type { KnowledgeSourceObservationRecoverableIssue } from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";

type SourceRecoveryStartupResult = Extract<
  KnowledgePluginObservationStartupResult,
  { kind: "blocked" }
> &
  Readonly<{ sourceRecoveryBundleIds: readonly [string] }>;

/**
 * Projects exact watcher evidence into the sole pre-release lifecycle result.
 *
 * A generic pending observation is insufficient: at least one recoverable
 * missing/delete/rename issue must belong to the one configured Bundle.
 */
export function createSourceObservationPreReleaseResult(
  result: KnowledgeProductionObservationResult,
  bundleIds: readonly string[],
  issues: readonly KnowledgeSourceObservationRecoverableIssue[]
): SourceRecoveryStartupResult | undefined {
  if (
    result.kind !== "blocked" ||
    result.blockerKinds.length !== 1 ||
    result.blockerKinds[0] !== "source_observation_pending" ||
    bundleIds.length !== 1 ||
    typeof bundleIds[0] !== "string" ||
    bundleIds[0].trim().length === 0 ||
    issues.length === 0
  ) {
    return undefined;
  }
  const bundleId = bundleIds[0];
  for (const issue of issues) {
    if (
      typeof issue !== "object" ||
      issue === null ||
      issue.bundleId !== bundleId ||
      typeof issue.sourceId !== "string" ||
      issue.sourceId.trim().length === 0 ||
      (issue.kind !== "source_missing" && issue.kind !== "source_change_unsupported")
    ) {
      return undefined;
    }
  }
  const blockerKinds: readonly ["source_observation_pending"] = Object.freeze([
    "source_observation_pending",
  ]);
  const sourceRecoveryBundleIds: readonly [string] = Object.freeze([bundleId]);
  return Object.freeze({
    kind: "blocked" as const,
    blockerKinds,
    sourceRecoveryBundleIds,
  });
}
