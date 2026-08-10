import {
  KnowledgeSourceFreshnessAdmission,
  type KnowledgeSourceFreshnessAdmissionDependencies,
} from "@/knowledge/ingest/KnowledgeSourceFreshnessAdmission";
import type { KnowledgeExpectedOutputPage } from "@/knowledge/ingest/ObsidianKnowledgeOutputObservationReader";
import type { IngestSourceFreshnessAdmissionRequest } from "@/knowledge/ingest/queue/IngestQueue";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type {
  KnowledgeRuntimeAppliedFreshnessAuthority,
  KnowledgeRuntimeNoChangesFreshnessAuthority,
} from "@/knowledge/runtime/KnowledgeRuntimeSourceFreshness";

const SOURCE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);
const MANIFEST_HASH = "c".repeat(64);
const PAGE_CONTENT = "# Durable page\n";
const PAGE_HASH = createFileContentHash(PAGE_CONTENT);

/** Creates one exact Queue admission request. */
function createRequest(
  overrides: Partial<IngestSourceFreshnessAdmissionRequest> = {}
): IngestSourceFreshnessAdmissionRequest {
  return {
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 2,
    ...overrides,
  };
}

/** Creates one strict Runtime-proven applied source outcome. */
function createAppliedAuthority(
  overrides: Partial<KnowledgeRuntimeAppliedFreshnessAuthority> = {}
): KnowledgeRuntimeAppliedFreshnessAuthority {
  return {
    version: 1,
    kind: "applied",
    runtimeId: "runtime-1",
    runtimeRevision: 10,
    runtimeDigest: "d".repeat(64),
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 1,
    manifestRevision: 3,
    manifestDigest: MANIFEST_HASH,
    generatedPages: [
      {
        path: "Wiki/Page.md",
        windowsPathKey: "wiki/page.md",
        ownership: "generated",
        contentHash: PAGE_HASH,
      },
    ],
    transactionId: "transaction-1",
    changeSetId: "changeset-1",
    changeSetDigest: "e".repeat(64),
    manifestIntentDigest: "f".repeat(64),
    committedManifestRevision: 3,
    committedManifestDigest: MANIFEST_HASH,
    completedAt: 100,
    ...overrides,
  };
}

/** Creates one strict Runtime-proven zero-page no-change outcome. */
function createNoChangesAuthority(
  overrides: Partial<KnowledgeRuntimeNoChangesFreshnessAuthority> = {}
): KnowledgeRuntimeNoChangesFreshnessAuthority {
  return {
    version: 1,
    kind: "no_changes",
    runtimeId: "runtime-1",
    runtimeRevision: 10,
    runtimeDigest: "d".repeat(64),
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: SOURCE_HASH,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: 1,
    manifestRevision: 3,
    manifestDigest: MANIFEST_HASH,
    generatedPages: [],
    noChangesId: `knowledge-no-changes-${"1".repeat(64)}`,
    reason: "analysis_no_targets",
    planDigest: "2".repeat(64),
    jobId: "job-1",
    attempt: 1,
    committedManifestRevision: 3,
    completedAt: 100,
    ...overrides,
  };
}

/** Creates an admission with inspectable authority and output seams. */
function createAdmissionFixture(
  options: {
    authorities?: readonly unknown[];
    observations?: KnowledgeSourceFreshnessAdmissionDependencies["outputs"]["observe"];
    assertCurrent?: () => void;
    maxAuthorityReadAttempts?: number;
  } = {}
) {
  const authorities = [...(options.authorities ?? [createAppliedAuthority()])];
  const readSourceFreshnessAuthority = jest.fn(async () =>
    authorities.length > 1 ? authorities.shift() : authorities[0]
  );
  const observe = jest.fn(
    options.observations ??
      (async (outputs: readonly KnowledgeExpectedOutputPage[]) =>
        outputs.map((output) => ({
          path: output.path,
          kind: "file" as const,
          contentHash: output.contentHash,
        })))
  );
  const assertCurrent = jest.fn(options.assertCurrent ?? (() => undefined));
  const admission = new KnowledgeSourceFreshnessAdmission({
    authority: {
      readSourceFreshnessAuthority,
    },
    outputs: { observe },
    generation: { assertCurrent },
    ...(options.maxAuthorityReadAttempts === undefined
      ? {}
      : { maxAuthorityReadAttempts: options.maxAuthorityReadAttempts }),
  });
  return { admission, readSourceFreshnessAuthority, observe, assertCurrent };
}

describe("KnowledgeSourceFreshnessAdmission", () => {
  it("conservatively ingests when Runtime has no proven source outcome", async () => {
    const fixture = createAdmissionFixture({ authorities: [null] });

    await expect(fixture.admission.evaluate(createRequest())).resolves.toEqual({
      ...createRequest(),
      decision: { kind: "needs_ingest", reasons: ["never_ingested"] },
    });
    expect(fixture.observe).not.toHaveBeenCalled();
    expect(fixture.readSourceFreshnessAuthority).toHaveBeenCalledTimes(1);
  });

  it("returns identity drift without reading unrelated Wiki output", async () => {
    const fixture = createAdmissionFixture({
      authorities: [
        createAppliedAuthority({
          sourceContentHash: "8".repeat(64),
          pipelineFingerprint: "9".repeat(64),
        }),
      ],
    });

    await expect(fixture.admission.evaluate(createRequest())).resolves.toMatchObject({
      decision: {
        kind: "needs_ingest",
        reasons: ["source_changed", "pipeline_changed"],
      },
    });
    expect(fixture.observe).not.toHaveBeenCalled();
  });

  it("returns up to date only after an exact output and authority sandwich", async () => {
    const before = createAppliedAuthority();
    const after = createAppliedAuthority({ runtimeRevision: 11, runtimeDigest: "9".repeat(64) });
    const fixture = createAdmissionFixture({ authorities: [before, after] });

    const result = await fixture.admission.evaluate(createRequest());

    expect(result).toEqual({ ...createRequest(), decision: { kind: "up_to_date" } });
    expect(fixture.readSourceFreshnessAuthority).toHaveBeenCalledTimes(2);
    expect(fixture.observe).toHaveBeenCalledWith(
      [{ path: "Wiki/Page.md", contentHash: PAGE_HASH }],
      expect.any(AbortSignal)
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { decision: object }).decision)).toBe(true);
  });

  it.each([
    {
      name: "missing",
      observations: [{ path: "Wiki/Page.md", kind: "missing" }] as const,
      reason: "output_missing",
    },
    {
      name: "changed",
      observations: [{ path: "Wiki/Page.md", kind: "file", contentHash: "7".repeat(64) }] as const,
      reason: "output_changed",
    },
  ])("creates a repair decision for $name output", async ({ observations, reason }) => {
    const fixture = createAdmissionFixture({ observations: async () => observations });

    await expect(fixture.admission.evaluate(createRequest())).resolves.toMatchObject({
      decision: { kind: "needs_ingest", reasons: [reason] },
    });
    expect(fixture.readSourceFreshnessAuthority).toHaveBeenCalledTimes(1);
  });

  it("accepts an explicit Runtime-proven zero-page no-change outcome", async () => {
    const marker = createNoChangesAuthority();
    const fixture = createAdmissionFixture({ authorities: [marker, marker] });

    await expect(fixture.admission.evaluate(createRequest())).resolves.toMatchObject({
      decision: { kind: "up_to_date" },
    });
    expect(fixture.observe).toHaveBeenCalledWith([], expect.any(AbortSignal));
  });

  it("retries the full output proof when source authority changes during the sandwich", async () => {
    const first = createAppliedAuthority();
    const changed = createAppliedAuthority({
      manifestRevision: 4,
      manifestDigest: "8".repeat(64),
      committedManifestRevision: 4,
      committedManifestDigest: "8".repeat(64),
    });
    const fixture = createAdmissionFixture({ authorities: [first, changed, changed, changed] });

    await expect(fixture.admission.evaluate(createRequest())).resolves.toMatchObject({
      decision: { kind: "up_to_date" },
    });
    expect(fixture.observe).toHaveBeenCalledTimes(2);
    expect(fixture.readSourceFreshnessAuthority).toHaveBeenCalledTimes(4);
  });

  it("fails closed when every bounded authority sandwich changes", async () => {
    const fixture = createAdmissionFixture({
      authorities: [
        createAppliedAuthority({ manifestDigest: "1".repeat(64) }),
        createAppliedAuthority({ manifestDigest: "2".repeat(64) }),
        createAppliedAuthority({ manifestDigest: "3".repeat(64) }),
        createAppliedAuthority({ manifestDigest: "4".repeat(64) }),
      ],
      maxAuthorityReadAttempts: 2,
    });

    await expect(fixture.admission.evaluate(createRequest())).rejects.toMatchObject({
      name: "KnowledgeSourceFreshnessAdmissionError",
      code: "authority_changed",
    });
    expect(fixture.observe).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed Runtime projection before any Vault output read", async () => {
    const malformed = { ...createAppliedAuthority(), unexpected: true };
    const fixture = createAdmissionFixture({ authorities: [malformed] });

    await expect(fixture.admission.evaluate(createRequest())).rejects.toMatchObject({
      name: "KnowledgeSourceFreshnessAdmissionError",
      code: "authority_unavailable",
    });
    expect(fixture.observe).not.toHaveBeenCalled();
  });

  it("revokes output observation and future admission when the generation closes", async () => {
    let observedSignal: AbortSignal | undefined;
    const fixture = createAdmissionFixture({
      observations: async (_outputs, signal) => {
        observedSignal = signal;
        fixture.admission.close();
        throw new Error("closed");
      },
    });

    await expect(fixture.admission.evaluate(createRequest())).rejects.toMatchObject({
      code: "generation_stale",
    });
    expect(observedSignal?.aborted).toBe(true);
    await expect(fixture.admission.evaluate(createRequest())).rejects.toMatchObject({
      code: "generation_stale",
    });
  });
});
