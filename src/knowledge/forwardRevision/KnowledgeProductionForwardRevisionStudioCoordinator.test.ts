jest.mock("@/knowledge/runtime/KnowledgeRuntimeStore", () => ({
  KnowledgeRuntimeForwardRevisionStudioPort: class MockRuntimeStudioPort {
    constructor(
      private readonly read: (bundleId: string) => Promise<Readonly<Record<string, unknown>>>
    ) {}

    static assert(value: unknown): void {
      if (!(value instanceof MockRuntimeStudioPort)) throw new TypeError();
    }

    static matchesExecutionOwner(value: unknown, owner: unknown): boolean {
      return value instanceof MockRuntimeStudioPort && typeof owner === "object" && owner !== null;
    }

    readForwardRevisionStudioBundle(bundleId: string): Promise<Readonly<Record<string, unknown>>> {
      return this.read(bundleId);
    }
  },
}));

jest.mock(
  "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionDecisionCoordinator",
  () => ({
    KnowledgeProductionForwardRevisionDecisionCoordinator: class MockDecisionCoordinator {
      constructor(
        readonly decide: (
          command: unknown,
          signal: AbortSignal
        ) => Promise<Readonly<{ kind: string }>>
      ) {}

      static assertExecutionOwner(value: unknown, owner: unknown): void {
        if (
          !(value instanceof MockDecisionCoordinator) ||
          typeof owner !== "object" ||
          owner === null
        ) {
          throw new TypeError();
        }
      }
    },
  })
);

jest.mock("@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionApplyCoordinator", () => {
  class MockApplyCoordinatorError extends Error {
    static inspect(value: unknown): undefined {
      return value instanceof MockApplyCoordinatorError ? undefined : undefined;
    }
  }
  class MockApplyCoordinator {
    constructor(
      readonly apply: (request: unknown, signal: AbortSignal) => Promise<Readonly<{ kind: string }>>
    ) {}

    static assertExecutionOwner(value: unknown, owner: unknown): void {
      if (!(value instanceof MockApplyCoordinator) || typeof owner !== "object" || owner === null) {
        throw new TypeError();
      }
    }
  }
  return {
    KnowledgeForwardRevisionApplyCoordinatorError: MockApplyCoordinatorError,
    KnowledgeProductionForwardRevisionApplyCoordinator: MockApplyCoordinator,
  };
});

jest.mock("@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver", () => ({
  ObsidianKnowledgeCompilerTargetResolver: class MockTargetResolver {
    constructor(
      readonly visit: (
        requests: readonly Readonly<{ targetId: string; path: string }>[],
        signal: AbortSignal,
        options: Readonly<{ maxFileBytes: number }>,
        visitor: (value: unknown, fileByteSize?: number) => void
      ) => Promise<void>
    ) {}

    static assert(value: unknown): void {
      if (!(value instanceof MockTargetResolver)) throw new TypeError();
    }

    static matchesExecutionOwner(value: unknown, owner: unknown): boolean {
      return value instanceof MockTargetResolver && typeof owner === "object" && owner !== null;
    }
  },
}));

jest.mock("@/knowledge/ingest/KnowledgeExecutionOwner", () => ({
  KnowledgeExecutionOwner: class MockExecutionOwner {
    static assert(value: unknown): void {
      if (typeof value !== "object" || value === null) throw new TypeError();
    }
  },
}));

jest.mock("@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioProjection", () => ({
  snapshotKnowledgeForwardRevisionStudioSnapshot: (value: unknown) => value,
}));

jest.mock("@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand", () => ({
  createKnowledgeForwardRevisionReviewCommand: (value: unknown) => Object.freeze(value),
}));

import { ObsidianKnowledgeCompilerTargetResolver } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import { KnowledgeProductionForwardRevisionApplyCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionApplyCoordinator";
import { KnowledgeProductionForwardRevisionDecisionCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionDecisionCoordinator";
import { KnowledgeProductionForwardRevisionStudioCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionStudioCoordinator";
import type { KnowledgeForwardRevisionStudioSnapshot } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioProjection";
import type { KnowledgeForwardRevisionStudioCommand } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionStudioPort";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { KnowledgeRuntimeForwardRevisionStudioPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";

const REVIEW_REF = `forward-studio-review-${"1".repeat(64)}`;
const RUNTIME_SNAPSHOT_REF = `forward-studio-snapshot-${"2".repeat(64)}`;
const PROPOSAL_DIGEST = "a".repeat(64);
const CURRENT_CONTENT = "current\n";
const SELECTED_CONTENT = "selected\n";

type RuntimeRead = (bundleId: string) => Promise<Readonly<KnowledgeForwardRevisionStudioSnapshot>>;
type DecisionCall = (command: unknown, signal: AbortSignal) => Promise<Readonly<{ kind: string }>>;
type ApplyCall = (request: unknown, signal: AbortSignal) => Promise<Readonly<{ kind: string }>>;
type VisitCall = (
  requests: readonly Readonly<{ targetId: string; path: string }>[],
  signal: AbortSignal,
  options: Readonly<{ maxFileBytes: number }>,
  visitor: (value: unknown, fileByteSize?: number) => void
) => Promise<void>;

/** Visits the first requested target with the default current Wiki content. */
const visitCurrentTarget: VisitCall = async (requests, _signal, _options, visitor) => {
  const request = requests[0];
  if (!request) throw new Error("Expected one compiler target request");
  visitor(
    Object.freeze({
      targetId: request.targetId,
      path: request.path,
      kind: "file",
      content: CURRENT_CONTENT,
    }),
    new TextEncoder().encode(CURRENT_CONTENT).byteLength
  );
};

const RuntimePortConstructor = KnowledgeRuntimeForwardRevisionStudioPort as unknown as new (
  read: RuntimeRead
) => KnowledgeRuntimeForwardRevisionStudioPort;
const DecisionConstructor =
  KnowledgeProductionForwardRevisionDecisionCoordinator as unknown as new (
    decide: DecisionCall
  ) => KnowledgeProductionForwardRevisionDecisionCoordinator;
const ApplyConstructor = KnowledgeProductionForwardRevisionApplyCoordinator as unknown as new (
  apply: ApplyCall
) => KnowledgeProductionForwardRevisionApplyCoordinator;
const ResolverConstructor = ObsidianKnowledgeCompilerTargetResolver as unknown as new (
  visit: VisitCall
) => ObsidianKnowledgeCompilerTargetResolver;

/** Creates one minimal pending durable record accepted by the product coordinator mocks. */
function createPendingRecord(
  index = 0,
  selectedContent = SELECTED_CONTENT,
  currentContent = CURRENT_CONTENT,
  bundleId = "bundle-a"
) {
  const pagePath = `Wiki/Page-${index}.md`;
  return Object.freeze({
    state: "pending" as const,
    reviewRef:
      index === 0 ? REVIEW_REF : `forward-studio-review-${index.toString(16).padStart(64, "0")}`,
    snapshotRef: RUNTIME_SNAPSHOT_REF,
    pagePath,
    updatedAt: 10,
    requestedAt: 9,
    selectedAppliedAt: 8,
    proposalDigest: PROPOSAL_DIGEST,
    proposal: Object.freeze({
      proposalId: `proposal-${index}`,
      recordedAt: 9,
      request: Object.freeze({
        runtimeId: "runtime-1",
        bundleId,
        pagePath,
        selectedContent,
        selectedAppliedAt: 8,
        intent: Object.freeze({
          current: Object.freeze({
            vaultObservedBeforeHash: createFileContentHash(currentContent),
          }),
        }),
        historicalReviewAuthority: Object.freeze({
          targetChange: Object.freeze({ sourceRefs: Object.freeze(["source-1"]) }),
        }),
      }),
    }),
  });
}

/** Creates one accepted-ready record from the same exact pending identity. */
function createAcceptedReadyRecord(pending = createPendingRecord()) {
  return Object.freeze({
    state: "accepted_ready" as const,
    reviewRef: pending.reviewRef,
    snapshotRef: `forward-studio-snapshot-${"3".repeat(64)}`,
    pagePath: pending.pagePath,
    updatedAt: 12,
    acceptedAt: 11,
    manualOverride: false,
    decisionDigest: "b".repeat(64),
    acceptedDecision: Object.freeze({
      proposal: pending.proposal,
      proposalDigest: pending.proposalDigest,
      acceptedDecisionDigest: "c".repeat(64),
      applyClaim: Object.freeze({ claimId: "claim-1" }),
      applyClaimDigest: "d".repeat(64),
    }),
  });
}

/** Creates one applying record carrying the exact accepted decision identity. */
function createApplyingRecord(accepted = createAcceptedReadyRecord()) {
  return Object.freeze({
    ...accepted,
    state: "applying" as const,
    applyPhase: "prepared" as const,
    updatedAt: accepted.updatedAt + 1,
  });
}

/** Creates one sticky recovery row carrying no UI mutation authority. */
function createRecoveryRecord(accepted = createAcceptedReadyRecord()) {
  return Object.freeze({
    ...accepted,
    state: "recovery_required" as const,
    conflictCode: "file_state_conflict" as const,
    actualKind: "file" as const,
    detectedAt: accepted.updatedAt + 1,
    updatedAt: accepted.updatedAt + 1,
  });
}

/** Creates one minimal internal Runtime Studio snapshot. */
function createRuntimeSnapshot(
  activeRecords: readonly Readonly<
    | ReturnType<typeof createPendingRecord>
    | ReturnType<typeof createAcceptedReadyRecord>
    | ReturnType<typeof createApplyingRecord>
    | ReturnType<typeof createRecoveryRecord>
  >[],
  runtimeRevision = 10,
  committedReviewRefs: readonly string[] = [],
  bundleId = "bundle-a"
): Readonly<KnowledgeForwardRevisionStudioSnapshot> {
  return Object.freeze({
    version: 1,
    kind: "forward_revision_studio_snapshot",
    bundleId,
    runtimeRevision,
    reviewRevision: 1,
    revisionToken: `forward-studio-revision-${"4".repeat(64)}`,
    activeRecords: Object.freeze([...activeRecords]),
    committedReviewRefs: Object.freeze([...committedReviewRefs]),
    committedCount: committedReviewRefs.length,
  }) as unknown as Readonly<KnowledgeForwardRevisionStudioSnapshot>;
}

/** Creates one coordinator with independently controlled genuine-boundary mocks. */
function createCoordinator(input: {
  read: RuntimeRead;
  decide?: DecisionCall;
  apply?: ApplyCall;
  visit?: VisitCall;
  assertCurrent?: () => void;
}) {
  const owner = Object.freeze({}) as KnowledgeExecutionOwner;
  const decide = jest.fn(
    input.decide ??
      (async () => Object.freeze({ kind: "accepted" as const, decisionDigest: "b".repeat(64) }))
  );
  const apply = jest.fn(input.apply ?? (async () => Object.freeze({ kind: "committed" as const })));
  const visit = jest.fn(input.visit ?? visitCurrentTarget);
  const coordinator = new KnowledgeProductionForwardRevisionStudioCoordinator(
    new RuntimePortConstructor(input.read),
    new DecisionConstructor(decide),
    new ApplyConstructor(apply),
    new ResolverConstructor(visit),
    owner,
    input.assertCurrent ?? (() => undefined)
  );
  return { coordinator, decide, apply, visit };
}

/** Creates one opaque command from the current UI row. */
function createCommand(
  reviewRef: string,
  snapshotRef: string,
  action: "accept_exact" | "reject" | "apply" | "accept_blocks"
): KnowledgeForwardRevisionStudioCommand {
  return Object.freeze({
    version: 1,
    kind: "forward_revision_studio_command" as const,
    reviewRef,
    snapshotRef,
    action,
    ...(action === "accept_blocks" ? { acceptedBlockIds: Object.freeze([]) } : {}),
  }) as KnowledgeForwardRevisionStudioCommand;
}

describe("KnowledgeProductionForwardRevisionStudioCoordinator", () => {
  it("projects exact per-state UI keys without durable decision, claim, or journal carriers", async () => {
    const records = [
      createPendingRecord(),
      createAcceptedReadyRecord(),
      createApplyingRecord(),
      createRecoveryRecord(),
    ] as const;
    const expectedKeys = [
      [
        "pagePath",
        "plan",
        "requestedAt",
        "reviewRef",
        "selectedAppliedAt",
        "snapshotRef",
        "state",
        "updatedAt",
      ],
      [
        "acceptedAt",
        "manualOverride",
        "pagePath",
        "reviewRef",
        "snapshotRef",
        "state",
        "updatedAt",
      ],
      [
        "acceptedAt",
        "applyPhase",
        "manualOverride",
        "pagePath",
        "reviewRef",
        "snapshotRef",
        "state",
        "updatedAt",
      ],
      [
        "acceptedAt",
        "actualKind",
        "conflictCode",
        "detectedAt",
        "manualOverride",
        "pagePath",
        "reviewRef",
        "snapshotRef",
        "state",
        "updatedAt",
      ],
    ] as const;

    for (let index = 0; index < records.length; index += 1) {
      const snapshot = createRuntimeSnapshot([records[index]]);
      const fixture = createCoordinator({ read: async () => snapshot });
      const ui = await fixture.coordinator.loadForwardRevisionStudio(
        "bundle-a",
        new AbortController().signal
      );
      expect(Reflect.ownKeys(ui).sort()).toEqual([
        "bundleId",
        "reviews",
        "revisionToken",
        "runtimeRevision",
      ]);
      expect(Reflect.ownKeys(ui.reviews[0]).sort()).toEqual([...expectedKeys[index]].sort());
      for (const forbidden of [
        "acceptedDecision",
        "applyClaim",
        "decisionDigest",
        "journal",
        "ledger",
        "proposal",
        "transactionId",
      ]) {
        expect(Object.hasOwn(ui.reviews[0], forbidden)).toBe(false);
      }
    }
  });

  it("rejects a valid opaque row submitted under another Bundle without mutation", async () => {
    const snapshot = createRuntimeSnapshot([createPendingRecord()]);
    const fixture = createCoordinator({ read: async () => snapshot });
    const ui = await fixture.coordinator.loadForwardRevisionStudio(
      "bundle-a",
      new AbortController().signal
    );

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-b",
        createCommand(ui.reviews[0].reviewRef, ui.reviews[0].snapshotRef, "accept_exact"),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    expect(fixture.decide).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("retains independent current bindings when two Bundles load concurrently", async () => {
    const pendingA = createPendingRecord();
    const pendingB = createPendingRecord(1, SELECTED_CONTENT, CURRENT_CONTENT, "bundle-b");
    const snapshots = new Map([
      ["bundle-a", createRuntimeSnapshot([pendingA])],
      ["bundle-b", createRuntimeSnapshot([pendingB], 10, [], "bundle-b")],
    ]);
    const fixture = createCoordinator({
      read: async (bundleId) => snapshots.get(bundleId)!,
      decide: async () =>
        Object.freeze({ kind: "rejected" as const, decisionDigest: "e".repeat(64) }),
    });
    const signal = new AbortController().signal;
    const uiA = await fixture.coordinator.loadForwardRevisionStudio("bundle-a", signal);
    await fixture.coordinator.loadForwardRevisionStudio("bundle-b", signal);

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(uiA.reviews[0].reviewRef, uiA.reviews[0].snapshotRef, "reject"),
        signal
      )
    ).resolves.toEqual({ kind: "rejected" });
    expect(fixture.decide).toHaveBeenCalledTimes(1);
  });

  it("evicts only stale UI bindings instead of rejecting a later configured Bundle", async () => {
    const fixture = createCoordinator({
      read: async (bundleId) => createRuntimeSnapshot([], 10, [], bundleId),
    });
    const signal = new AbortController().signal;
    for (let index = 0; index < 257; index += 1) {
      await fixture.coordinator.loadForwardRevisionStudio(`bundle-${index}`, signal);
    }

    await expect(
      fixture.coordinator.loadForwardRevisionStudio("bundle-0", signal)
    ).resolves.toMatchObject({ bundleId: "bundle-0", reviews: [] });
  });

  it("never reports applied when an accepted decision has no exact active row", async () => {
    const pending = createPendingRecord();
    const reads = [
      createRuntimeSnapshot([pending]),
      createRuntimeSnapshot([pending]),
      createRuntimeSnapshot([], 11),
    ];
    const fixture = createCoordinator({
      read: async () => reads.shift() ?? createRuntimeSnapshot([], 11),
    });
    const ui = await fixture.coordinator.loadForwardRevisionStudio(
      "bundle-a",
      new AbortController().signal
    );

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(ui.reviews[0].reviewRef, ui.reviews[0].snapshotRef, "accept_exact"),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    expect(fixture.decide).toHaveBeenCalledTimes(1);
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("continues an exact accepted-ready row through the genuine Apply boundary", async () => {
    const pending = createPendingRecord();
    const accepted = createAcceptedReadyRecord(pending);
    const reads = [
      createRuntimeSnapshot([pending]),
      createRuntimeSnapshot([pending]),
      createRuntimeSnapshot([accepted], 11),
      createRuntimeSnapshot([], 12, [accepted.reviewRef]),
    ];
    const fixture = createCoordinator({
      read: async () => reads.shift() ?? createRuntimeSnapshot([], 12, [accepted.reviewRef]),
    });
    const ui = await fixture.coordinator.loadForwardRevisionStudio(
      "bundle-a",
      new AbortController().signal
    );

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(ui.reviews[0].reviewRef, ui.reviews[0].snapshotRef, "accept_exact"),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "applied" });
    expect(fixture.apply).toHaveBeenCalledTimes(1);
  });

  it("reclassifies a late accepted-ready command from fresh applying durable truth", async () => {
    const accepted = createAcceptedReadyRecord();
    const applying = createApplyingRecord(accepted);
    const reads = [
      createRuntimeSnapshot([accepted]),
      createRuntimeSnapshot([accepted]),
      createRuntimeSnapshot([applying], 11),
    ];
    const fixture = createCoordinator({
      read: async () => reads.shift() ?? createRuntimeSnapshot([applying], 11),
      apply: async () => {
        throw new Error("late authority failure");
      },
    });
    const ui = await fixture.coordinator.loadForwardRevisionStudio(
      "bundle-a",
      new AbortController().signal
    );

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(ui.reviews[0].reviewRef, ui.reviews[0].snapshotRef, "apply"),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "applying" });
    expect(fixture.apply).toHaveBeenCalledTimes(1);
  });

  it("returns durable applying truth after begin even when the caller aborts and generation revokes", async () => {
    const accepted = createAcceptedReadyRecord();
    const applying = createApplyingRecord(accepted);
    const reads = [
      createRuntimeSnapshot([accepted]),
      createRuntimeSnapshot([accepted]),
      createRuntimeSnapshot([applying], 11),
    ];
    const controller = new AbortController();
    let current = true;
    const fixture = createCoordinator({
      read: async () => reads.shift() ?? createRuntimeSnapshot([applying], 11),
      apply: async () => {
        current = false;
        controller.abort();
        throw new Error("transport failed after begin");
      },
      assertCurrent: () => {
        if (!current) throw new Error("generation revoked");
      },
    });
    const ui = await fixture.coordinator.loadForwardRevisionStudio("bundle-a", controller.signal);

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(ui.reviews[0].reviewRef, ui.reviews[0].snapshotRef, "apply"),
        controller.signal
      )
    ).resolves.toEqual({ kind: "applying" });
    expect(fixture.apply).toHaveBeenCalledTimes(1);
  });

  it("reports an exact late committed Review as applied without exposing its ledger", async () => {
    const accepted = createAcceptedReadyRecord();
    const reads = [
      createRuntimeSnapshot([accepted]),
      createRuntimeSnapshot([accepted]),
      createRuntimeSnapshot([], 11, [accepted.reviewRef]),
    ];
    const fixture = createCoordinator({
      read: async () => reads.shift() ?? createRuntimeSnapshot([], 11, [accepted.reviewRef]),
      apply: async () => Object.freeze({ kind: "idle" as const }),
    });
    const ui = await fixture.coordinator.loadForwardRevisionStudio(
      "bundle-a",
      new AbortController().signal
    );

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(ui.reviews[0].reviewRef, ui.reviews[0].snapshotRef, "apply"),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "applied" });
    expect(fixture.apply).toHaveBeenCalledTimes(1);
  });

  it("recognizes an exact ledger committed between Decision and the continuation read", async () => {
    const pending = createPendingRecord();
    const reads = [
      createRuntimeSnapshot([pending]),
      createRuntimeSnapshot([pending]),
      createRuntimeSnapshot([], 11, [pending.reviewRef]),
    ];
    const fixture = createCoordinator({
      read: async () => reads.shift() ?? createRuntimeSnapshot([], 11, [pending.reviewRef]),
    });
    const ui = await fixture.coordinator.loadForwardRevisionStudio(
      "bundle-a",
      new AbortController().signal
    );

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(ui.reviews[0].reviewRef, ui.reviews[0].snapshotRef, "accept_exact"),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "applied" });
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("stops bounded Vault visits as soon as the aggregate character budget is exceeded", async () => {
    const content = "x".repeat(2_000_000);
    const records = Object.freeze(
      Array.from({ length: 9 }, (_, index) => createPendingRecord(index, `selected-${index}`))
    );
    const snapshot = createRuntimeSnapshot(records);
    const fixture = createCoordinator({
      read: async () => snapshot,
      visit: async (requests, _signal, _options, visitor) => {
        const request = requests[0];
        visitor(
          Object.freeze({
            targetId: request.targetId,
            path: request.path,
            kind: "file",
            content,
          }),
          content.length
        );
      },
    });

    await expect(
      fixture.coordinator.loadForwardRevisionStudio("bundle-a", new AbortController().signal)
    ).rejects.toThrow("product budget");
    expect(fixture.visit).toHaveBeenCalledTimes(9);
  });

  it("rejects block selection when the bounded renderer classified the row exact-only", async () => {
    const current = `${"x".repeat(200_001)}\n`;
    const pending = createPendingRecord(0, SELECTED_CONTENT, current);
    const snapshot = createRuntimeSnapshot([pending]);
    const fixture = createCoordinator({
      read: async () => snapshot,
      visit: async (requests, _signal, _options, visitor) => {
        const request = requests[0];
        visitor(
          Object.freeze({
            targetId: request.targetId,
            path: request.path,
            kind: "file",
            content: current,
          }),
          current.length
        );
      },
    });
    const ui = await fixture.coordinator.loadForwardRevisionStudio(
      "bundle-a",
      new AbortController().signal
    );
    const pendingUi = ui.reviews[0];
    if (pendingUi.state !== "pending") throw new Error("Expected pending UI row");
    expect(pendingUi.plan.files[0].capability).toBe("exact_only");

    await expect(
      fixture.coordinator.submitForwardRevisionStudio(
        "bundle-a",
        createCommand(pendingUi.reviewRef, pendingUi.snapshotRef, "accept_blocks"),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: "stale" });
    expect(fixture.decide).not.toHaveBeenCalled();
  });
});
