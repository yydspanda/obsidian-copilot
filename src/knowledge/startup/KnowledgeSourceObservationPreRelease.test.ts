import { createSourceObservationPreReleaseResult } from "@/knowledge/startup/KnowledgeSourceObservationPreRelease";
import type { KnowledgeSourceObservationRecoverableIssue } from "@/knowledge/startup/KnowledgeSourceObservationStartupCoordinator";

/** Creates one path-free recoverable issue from the active watcher generation. */
function createIssue(bundleId = "personal"): Readonly<KnowledgeSourceObservationRecoverableIssue> {
  return Object.freeze({ kind: "source_missing", bundleId, sourceId: "source-1" });
}

describe("createSourceObservationPreReleaseResult", () => {
  it("stages only exact pending evidence with a recoverable issue in one Bundle", () => {
    const result = createSourceObservationPreReleaseResult(
      { kind: "blocked", blockerKinds: ["source_observation_pending"] },
      ["personal"],
      [createIssue()]
    );

    expect(result).toEqual({
      kind: "blocked",
      blockerKinds: ["source_observation_pending"],
      sourceRecoveryBundleIds: ["personal"],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.blockerKinds)).toBe(true);
    expect(Object.isFrozen(result?.sourceRecoveryBundleIds)).toBe(true);
  });

  it.each([
    {
      name: "no recoverable issue",
      result: { kind: "blocked" as const, blockerKinds: ["source_observation_pending"] as const },
      bundleIds: ["personal"],
      issues: [],
    },
    {
      name: "another blocker",
      result: { kind: "blocked" as const, blockerKinds: ["source_missing"] as const },
      bundleIds: ["personal"],
      issues: [createIssue()],
    },
    {
      name: "mixed blockers",
      result: {
        kind: "blocked" as const,
        blockerKinds: ["source_observation_pending", "source_missing"] as const,
      },
      bundleIds: ["personal"],
      issues: [createIssue()],
    },
    {
      name: "multiple Bundles",
      result: { kind: "blocked" as const, blockerKinds: ["source_observation_pending"] as const },
      bundleIds: ["personal", "work"],
      issues: [createIssue()],
    },
    {
      name: "issue from another Bundle",
      result: { kind: "blocked" as const, blockerKinds: ["source_observation_pending"] as const },
      bundleIds: ["personal"],
      issues: [createIssue("work")],
    },
  ])("does not stage $name", ({ result, bundleIds, issues }) => {
    expect(createSourceObservationPreReleaseResult(result, bundleIds, issues)).toBeUndefined();
  });
});
