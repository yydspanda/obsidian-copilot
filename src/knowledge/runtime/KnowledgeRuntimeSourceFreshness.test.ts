import {
  KnowledgeRuntimeSourceFreshnessAuthorityValidationError,
  parseKnowledgeRuntimeSourceFreshnessAuthority,
} from "@/knowledge/runtime/KnowledgeRuntimeSourceFreshness";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

/** Creates common exact Runtime and Manifest source bindings. */
function createCommonAuthority() {
  return {
    version: 2,
    runtimeId: "runtime-1",
    runtimeRevision: 12,
    runtimeDigest: HASH_A,
    bundleId: "personal",
    sourceId: "source-1",
    sourceContentHash: HASH_B,
    pipelineFingerprint: HASH_C,
    inputRevision: 4,
    manifestRevision: 7,
    manifestDigest: HASH_B,
    generatedPages: [
      {
        path: "Wiki/Concept.md",
        windowsPathKey: "wiki/concept.md",
        ownership: "generated",
        sourceAppliedContentHash: HASH_C,
        effectiveContentHash: HASH_C,
        contentHash: HASH_C,
        origin: { kind: "source_apply" },
      },
    ],
  };
}

/** Creates one strict Apply authority candidate. */
function createAppliedAuthority() {
  return {
    ...createCommonAuthority(),
    kind: "applied",
    transactionId: "transaction-1",
    changeSetId: "changeset-1",
    changeSetDigest: HASH_A,
    manifestIntentDigest: HASH_B,
    committedManifestRevision: 6,
    committedManifestDigest: HASH_C,
    completedAt: 100,
  };
}

/** Creates one strict no-changes authority candidate. */
function createNoChangesAuthority() {
  return {
    ...createCommonAuthority(),
    kind: "no_changes",
    noChangesId: `knowledge-no-changes-${HASH_A}`,
    reason: "all_targets_unchanged",
    planDigest: HASH_B,
    jobId: "job-1",
    attempt: 2,
    committedManifestRevision: 7,
    completedAt: 110,
  };
}

describe("parseKnowledgeRuntimeSourceFreshnessAuthority", () => {
  it("returns a detached deeply frozen exact Apply authority", () => {
    const input = createAppliedAuthority();

    const parsed = parseKnowledgeRuntimeSourceFreshnessAuthority(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.generatedPages).not.toBe(input.generatedPages);
    expect(parsed.generatedPages[0]).not.toBe(input.generatedPages[0]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.generatedPages)).toBe(true);
    expect(Object.isFrozen(parsed.generatedPages[0])).toBe(true);
    input.generatedPages[0].path = "Wiki/Mutated.md";
    expect(parsed.generatedPages[0].path).toBe("Wiki/Concept.md");
  });

  it("accepts an exact first-source zero-page no-changes authority", () => {
    const input = { ...createNoChangesAuthority(), generatedPages: [] };

    const parsed = parseKnowledgeRuntimeSourceFreshnessAuthority(input);

    expect(parsed).toEqual(input);
    expect(parsed.kind).toBe("no_changes");
    expect(parsed.generatedPages).toEqual([]);
    expect(Object.isFrozen(parsed.generatedPages)).toBe(true);
  });

  it("retains exact forward lineage while treating the effective hash as current", () => {
    const base = createAppliedAuthority();
    const basePage = base.generatedPages[0];
    const page = {
      ...basePage,
      effectiveContentHash: HASH_A,
      contentHash: HASH_A,
      origin: {
        kind: "forward_revision" as const,
        overlay: {
          version: 2 as const,
          kind: "forward_revision_overlay_entry" as const,
          bundleId: "personal",
          pagePath: basePage.path,
          windowsPathKey: basePage.windowsPathKey,
          sourceId: "source-1",
          sourceBaseDigest: HASH_B,
          sourceAppliedContentHash: HASH_C,
          previousEffectiveContentHash: HASH_C,
          effectiveContentHash: HASH_A,
          forwardTransactionId: "forward-transaction-1",
          acceptedDecisionDigest: HASH_A,
          forwardLedgerIdentityDigest: HASH_B,
          appliedAt: 90,
        },
      },
    };
    const input = { ...base, generatedPages: [page] };

    const parsed = parseKnowledgeRuntimeSourceFreshnessAuthority(input);

    expect(parsed.generatedPages[0]).toEqual(page);
    expect(Object.isFrozen(parsed.generatedPages[0].origin)).toBe(true);
    expect(
      parsed.generatedPages[0].origin.kind === "forward_revision" &&
        Object.isFrozen(parsed.generatedPages[0].origin.overlay)
    ).toBe(true);
  });

  it("retains a legacy Runtime-proven Apply at input revision zero", () => {
    const input = { ...createAppliedAuthority(), inputRevision: 0 };

    expect(parseKnowledgeRuntimeSourceFreshnessAuthority(input)).toEqual(input);
  });

  it("rejects an impossible no-changes authority at input revision zero", () => {
    expect(() =>
      parseKnowledgeRuntimeSourceFreshnessAuthority({
        ...createNoChangesAuthority(),
        inputRevision: 0,
      })
    ).toThrow(KnowledgeRuntimeSourceFreshnessAuthorityValidationError);
  });

  it.each([
    ["runtime hash", () => ({ ...createAppliedAuthority(), runtimeDigest: HASH_A.toUpperCase() })],
    [
      "path alias",
      () => ({
        ...createAppliedAuthority(),
        generatedPages: [
          { ...createAppliedAuthority().generatedPages[0], path: "Wiki/../Wiki/Concept.md" },
        ],
      }),
    ],
    [
      "Windows key",
      () => ({
        ...createAppliedAuthority(),
        generatedPages: [
          { ...createAppliedAuthority().generatedPages[0], windowsPathKey: "wrong/key.md" },
        ],
      }),
    ],
    [
      "ownership",
      () => ({
        ...createAppliedAuthority(),
        generatedPages: [{ ...createAppliedAuthority().generatedPages[0], ownership: "untrusted" }],
      }),
    ],
    [
      "duplicate page",
      () => {
        const input = createAppliedAuthority();
        return { ...input, generatedPages: [input.generatedPages[0], input.generatedPages[0]] };
      },
    ],
    ["empty Apply pages", () => ({ ...createAppliedAuthority(), generatedPages: [] })],
    [
      "future commit revision",
      () => ({ ...createAppliedAuthority(), committedManifestRevision: 8 }),
    ],
    [
      "wrong no-changes id",
      () => ({ ...createNoChangesAuthority(), noChangesId: "knowledge-no-changes-forged" }),
    ],
    ["zero attempt", () => ({ ...createNoChangesAuthority(), attempt: 0 })],
  ])("rejects tampered %s material", (_label, createValue) => {
    expect(() => parseKnowledgeRuntimeSourceFreshnessAuthority(createValue())).toThrow(
      KnowledgeRuntimeSourceFreshnessAuthorityValidationError
    );
  });

  it("rejects sparse generated pages", () => {
    const input = createAppliedAuthority();
    const pages = new Array(2);
    pages[1] = input.generatedPages[0];

    expect(() =>
      parseKnowledgeRuntimeSourceFreshnessAuthority({ ...input, generatedPages: pages })
    ).toThrow(KnowledgeRuntimeSourceFreshnessAuthorityValidationError);
  });

  it("rejects root and nested accessors without invoking them", () => {
    let accessorCalls = 0;
    const rootAccessor = createAppliedAuthority();
    Object.defineProperty(rootAccessor, "runtimeId", {
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return "hidden-runtime";
      },
    });
    const nestedAccessor = createAppliedAuthority();
    Object.defineProperty(nestedAccessor.generatedPages[0], "contentHash", {
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return HASH_A;
      },
    });

    for (const input of [rootAccessor, nestedAccessor]) {
      expect(() => parseKnowledgeRuntimeSourceFreshnessAuthority(input)).toThrow(
        KnowledgeRuntimeSourceFreshnessAuthorityValidationError
      );
    }
    expect(accessorCalls).toBe(0);
  });

  it("rejects extra root and generated-page fields", () => {
    const rootExtra = { ...createAppliedAuthority(), writeAuthority: "forged" };
    const nested = createAppliedAuthority();
    const pageExtra = {
      ...nested,
      generatedPages: [{ ...nested.generatedPages[0], sourcePath: "Sources/Private.md" }],
    };

    for (const input of [rootExtra, pageExtra]) {
      expect(() => parseKnowledgeRuntimeSourceFreshnessAuthority(input)).toThrow(
        KnowledgeRuntimeSourceFreshnessAuthorityValidationError
      );
    }
  });
});
