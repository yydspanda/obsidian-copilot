import {
  createKnowledgeSourceLifecycleModel,
  KnowledgeSourceLifecycleModelError,
  type KnowledgeSourceLifecycleItem,
  type KnowledgeSourceLifecycleModelInput,
  type KnowledgeSourceLifecycleMissingItem,
  type KnowledgeSourceLifecycleReadyItem,
  type KnowledgeSourceLifecycleRetirementBlocker,
} from "@/knowledge/ui/sourceLifecycleModel";

/** Creates one ready source with removable, fail-closed action defaults. */
function createReady(
  overrides: Partial<KnowledgeSourceLifecycleReadyItem> = {}
): KnowledgeSourceLifecycleReadyItem {
  return {
    sourceId: "source-ready",
    sourcePath: "Sources/Ready.md",
    custody: "user_managed",
    generatedPageCount: 2,
    retirementRef: "retirement-ready",
    retirementBlockers: [],
    status: "ready",
    actions: { canCheckAgain: false, canRemove: true },
    ...overrides,
  };
}

/** Creates one missing source with all recovery actions available. */
function createMissing(
  overrides: Partial<KnowledgeSourceLifecycleMissingItem> = {}
): KnowledgeSourceLifecycleMissingItem {
  return {
    sourceId: "source-missing",
    sourcePath: "Sources/Missing.md",
    custody: "managed_copy",
    generatedPageCount: 0,
    retirementRef: "retirement-missing",
    retirementBlockers: [],
    status: "missing",
    issueReason: "source_missing",
    actions: { canCheckAgain: true, canRemove: true },
    ...overrides,
  };
}

/** Creates one complete lifecycle model input around selected sources. */
function createInput(
  sources: KnowledgeSourceLifecycleItem[] = [createReady(), createMissing()]
): KnowledgeSourceLifecycleModelInput {
  return {
    bundleId: "personal",
    runtimeRevision: 42,
    manifestRevision: 7,
    sources,
  };
}

describe("createKnowledgeSourceLifecycleModel", () => {
  it("detaches, deterministically sorts, and deeply freezes every model layer", () => {
    const missing = createMissing({ sourcePath: "Sources/Zeta.md" });
    const ready = createReady({ sourcePath: "Sources/Alpha.md" });
    const inputSources = [missing, ready];
    const input = createInput(inputSources);

    const model = createKnowledgeSourceLifecycleModel(input);

    expect(model).toMatchObject({
      bundleId: "personal",
      runtimeRevision: 42,
      manifestRevision: 7,
    });
    expect(model.sources.map((source) => source.sourceId)).toEqual([
      "source-ready",
      "source-missing",
    ]);
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.sources)).toBe(true);
    for (const source of model.sources) {
      expect(Object.isFrozen(source)).toBe(true);
      expect(Object.isFrozen(source.actions)).toBe(true);
      expect(Object.isFrozen(source.retirementBlockers)).toBe(true);
    }

    missing.sourcePath = "Sources/Changed.md";
    missing.actions = { canCheckAgain: false, canRemove: false };
    inputSources.push(createMissing({ sourceId: "source-late" }));

    expect(model.sources).toHaveLength(2);
    expect(model.sources[1]).toMatchObject({
      sourceId: "source-missing",
      sourcePath: "Sources/Zeta.md",
      actions: { canCheckAgain: true, canRemove: true },
    });
  });

  it.each([
    "active_transaction",
    "bundle_work_active",
    "bundle_rerun_pending",
    "bundle_review_pending",
    "bundle_apply_pending",
    "bundle_apply_recovery_required",
    "source_observation_pending",
    "revision_overflow",
  ] satisfies readonly KnowledgeSourceLifecycleRetirementBlocker[])(
    "retains and freezes the stable %s retirement blocker",
    (blocker) => {
      const model = createKnowledgeSourceLifecycleModel(
        createInput([
          createReady({
            actions: { canCheckAgain: false, canRemove: false },
            retirementBlockers: [blocker],
          }),
        ])
      );

      expect(model.sources[0].retirementBlockers).toEqual([blocker]);
      expect(Object.isFrozen(model.sources[0].retirementBlockers)).toBe(true);
    }
  );

  it("accepts only the three recoverable missing-source reasons", () => {
    for (const issueReason of ["source_missing", "source_deleted", "source_renamed"] as const) {
      const model = createKnowledgeSourceLifecycleModel(
        createInput([createMissing({ issueReason })])
      );
      expect(model.sources[0]).toMatchObject({ status: "missing", issueReason });
    }
  });

  it.each([
    {
      name: "negative Runtime revision",
      input: { ...createInput(), runtimeRevision: -1 },
    },
    {
      name: "unsafe source path",
      input: createInput([createReady({ sourcePath: "D:\\private\\Note.md" })]),
    },
    {
      name: "ready source with missing-only action",
      input: createInput([
        createReady({
          actions: { canCheckAgain: true, canRemove: true },
        }),
      ]),
    },
    {
      name: "removable source with a blocker",
      input: createInput([createReady({ retirementBlockers: ["active_transaction"] })]),
    },
    {
      name: "duplicate Windows path",
      input: createInput([createReady(), createMissing({ sourcePath: "sources/READY.md" })]),
    },
    {
      name: "duplicate retirement reference",
      input: createInput([createReady(), createMissing({ retirementRef: "retirement-ready" })]),
    },
  ])("rejects $name without echoing input material", ({ input }) => {
    let error: unknown;
    try {
      createKnowledgeSourceLifecycleModel(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(KnowledgeSourceLifecycleModelError);
    expect((error as Error).message).toBe("Knowledge source lifecycle model is invalid");
    expect((error as Error).message).not.toContain("private");
  });

  it("rejects malformed status, reason, actions, and blocker values at the runtime boundary", () => {
    const malformed = [
      { ...createMissing(), status: "gone" },
      { ...createMissing(), issueReason: "private-path" },
      { ...createMissing(), actions: { canCheckAgain: true } },
      { ...createMissing(), retirementBlockers: ["private-blocker"] },
    ];

    for (const source of malformed) {
      expect(() =>
        createKnowledgeSourceLifecycleModel(
          createInput([source as unknown as KnowledgeSourceLifecycleItem])
        )
      ).toThrow(KnowledgeSourceLifecycleModelError);
    }
  });
});
