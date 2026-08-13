jest.mock(
  "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator",
  () => {
    const coordinatorOwners = new WeakMap<object, unknown>();
    const coordinatorHandlers = new WeakMap<
      object,
      (request: unknown, signal: AbortSignal) => unknown
    >();
    const errorCodes = new WeakMap<object, string>();

    class KnowledgeForwardRevisionValidationCoordinatorError extends Error {
      /** Captures one mock-module-authentic sanitized validation failure. */
      constructor(code: string) {
        super("validation failed");
        errorCodes.set(this, code);
        Object.freeze(this);
      }

      /** Inspects only failures minted by this mock module. */
      static inspect(value: unknown): string | undefined {
        return typeof value === "object" && value !== null ? errorCodes.get(value) : undefined;
      }
    }

    class KnowledgeProductionForwardRevisionValidationCoordinator {
      readonly calls: unknown[] = [];

      /** Captures one exact owner and scripted genuine validation operation. */
      constructor(
        executionOwner: unknown,
        handler: (request: unknown, signal: AbortSignal) => unknown
      ) {
        coordinatorOwners.set(this, executionOwner);
        coordinatorHandlers.set(this, handler);
        Object.freeze(this);
      }

      /** Requires one exact mock coordinator and execution owner. */
      static assertExecutionOwner(value: unknown, executionOwner: unknown): void {
        if (
          typeof value !== "object" ||
          value === null ||
          Object.getPrototypeOf(value) !==
            KnowledgeProductionForwardRevisionValidationCoordinator.prototype ||
          coordinatorOwners.get(value) !== executionOwner
        ) {
          throw new TypeError("invalid validation owner");
        }
      }

      /** Runs the scripted validator while retaining its exact request. */
      async validate(request: unknown, signal: AbortSignal): Promise<unknown> {
        this.calls.push(request);
        return coordinatorHandlers.get(this)?.(request, signal);
      }
    }

    return {
      KnowledgeForwardRevisionValidationCoordinatorError,
      KnowledgeProductionForwardRevisionValidationCoordinator,
      createMockValidationError: (code: string) =>
        new KnowledgeForwardRevisionValidationCoordinatorError(code),
    };
  }
);

jest.mock("@/knowledge/runtime/KnowledgeRuntimeStore", () => {
  const portStates = new WeakMap<
    object,
    {
      owner: unknown;
      readPending: (command: unknown, signal: AbortSignal) => unknown;
      decide: (request: unknown, signal: AbortSignal) => unknown;
    }
  >();
  const errorCodes = new WeakMap<object, string>();

  class KnowledgeForwardRevisionDecisionPortError extends Error {
    /** Captures one mock-module-authentic sanitized Runtime failure. */
    constructor(code: string) {
      super("decision failed");
      errorCodes.set(this, code);
      Object.freeze(this);
    }

    /** Inspects only failures minted by this mock module. */
    static inspect(value: unknown): string | undefined {
      return typeof value === "object" && value !== null ? errorCodes.get(value) : undefined;
    }
  }

  class KnowledgeRuntimeForwardRevisionDecisionPort {
    readonly readPendingCalls: unknown[] = [];
    readonly decideCalls: unknown[] = [];

    /** Captures one exact owner and scripted genuine Runtime operations. */
    constructor(
      owner: unknown,
      handlers: {
        readPending: (command: unknown, signal: AbortSignal) => unknown;
        decide: (request: unknown, signal: AbortSignal) => unknown;
      }
    ) {
      portStates.set(this, { owner, ...handlers });
      Object.freeze(this);
    }

    /** Requires one exact mock-module-minted decision port. */
    static assert(value: unknown): void {
      if (
        typeof value !== "object" ||
        value === null ||
        Object.getPrototypeOf(value) !== KnowledgeRuntimeForwardRevisionDecisionPort.prototype ||
        !portStates.has(value)
      ) {
        throw new TypeError("invalid decision port");
      }
    }

    /** Reports exact mock execution ownership. */
    static matchesExecutionOwner(value: unknown, owner: unknown): boolean {
      return typeof value === "object" && value !== null && portStates.get(value)?.owner === owner;
    }

    /** Runs one scripted strict admission read. */
    async readPending(command: unknown, signal: AbortSignal): Promise<unknown> {
      this.readPendingCalls.push(command);
      return portStates.get(this)?.readPending(command, signal);
    }

    /** Runs one scripted atomic decision operation. */
    async decide(request: unknown, signal: AbortSignal): Promise<unknown> {
      this.decideCalls.push(request);
      return portStates.get(this)?.decide(request, signal);
    }
  }

  return {
    KnowledgeForwardRevisionDecisionPortError,
    KnowledgeRuntimeForwardRevisionDecisionPort,
    createMockDecisionError: (code: string) => new KnowledgeForwardRevisionDecisionPortError(code),
  };
});

import {
  KnowledgeProductionForwardRevisionDecisionCoordinator,
  type KnowledgeProductionForwardRevisionDecisionResult,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionDecisionCoordinator";
import {
  KnowledgeProductionForwardRevisionValidationCoordinator,
  type KnowledgeForwardRevisionValidationCoordinatorResult,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { createKnowledgeForwardRevisionReviewCommand } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import {
  KnowledgeRuntimeForwardRevisionDecisionPort,
  type KnowledgeForwardRevisionDecisionAdmission,
  type KnowledgeForwardRevisionDecisionRequest,
  type KnowledgeForwardRevisionDecisionResult,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const HISTORICAL_CONTENT = "# Historical output\n";
const CURRENT_CONTENT = "# Current output\n";

interface MockValidationCoordinator {
  readonly calls: unknown[];
}

interface MockDecisionPort {
  readonly readPendingCalls: unknown[];
  readonly decideCalls: unknown[];
}

/** Creates one strict pending proposal for high-level orchestration tests. */
function createProposal() {
  const selectedContentHash = createFileContentHash(HISTORICAL_CONTENT);
  const currentHash = createFileContentHash(CURRENT_CONTENT);
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    historical: {
      bundleId: "personal",
      pagePath: "Wiki/Topic.md",
      transactionId: "transaction-historical",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: "changeset-historical",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: 100,
      selectedContentHash,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: ["source-1"],
      primarySourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_F,
      manifestBaseHash: currentHash,
      vaultObservedBeforeHash: currentHash,
    },
  });
  const request = createKnowledgeForwardRevisionRequest({
    requestRevision: 1,
    runtimeId: "runtime-1",
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      proposalDigest: HASH_B,
      acceptedDigest: HASH_C,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: HASH_D,
      acceptedAt: 90,
      targetChange: {
        changeId: "change-historical",
        path: "Wiki/Topic.md",
        operation: "update",
        afterHash: selectedContentHash,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: "Wiki/Topic.md",
        ownership: "generated",
        contentHash: selectedContentHash,
      },
    },
    selectedContent: HISTORICAL_CONTENT,
    selectedContentHash,
    requestedAt: 120,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({ request, recordedAt: 120 });
}

/** Creates one mock genuine validator under the selected execution owner. */
function createValidator(
  owner: KnowledgeExecutionOwner,
  handler: (request: unknown, signal: AbortSignal) => unknown
): KnowledgeProductionForwardRevisionValidationCoordinator & MockValidationCoordinator {
  const Constructor = KnowledgeProductionForwardRevisionValidationCoordinator as unknown as new (
    owner: KnowledgeExecutionOwner,
    handler: (request: unknown, signal: AbortSignal) => unknown
  ) => KnowledgeProductionForwardRevisionValidationCoordinator & MockValidationCoordinator;
  return new Constructor(owner, handler);
}

/** Creates one mock genuine decision port under the selected execution owner. */
function createDecisionPort(
  owner: KnowledgeExecutionOwner,
  readPending: (
    command: unknown,
    signal: AbortSignal
  ) => Promise<Readonly<KnowledgeForwardRevisionDecisionAdmission> | null>,
  decide: (
    request: unknown,
    signal: AbortSignal
  ) => Promise<Readonly<KnowledgeForwardRevisionDecisionResult>>
): KnowledgeRuntimeForwardRevisionDecisionPort & MockDecisionPort {
  const Constructor = KnowledgeRuntimeForwardRevisionDecisionPort as unknown as new (
    owner: KnowledgeExecutionOwner,
    handlers: { readPending: typeof readPending; decide: typeof decide }
  ) => KnowledgeRuntimeForwardRevisionDecisionPort & MockDecisionPort;
  return new Constructor(owner, { readPending, decide });
}

/** Creates one detached terminal result whose body must not cross the coordinator boundary. */
function createTerminalResult(
  kind: "accepted" | "rejected",
  outcome: "decided" | "already_decided" = "decided"
): Readonly<KnowledgeForwardRevisionDecisionResult> {
  return Object.freeze({
    kind,
    outcome,
    decision: Object.freeze({ secretBody: "must-not-escape" }) as never,
    decisionDigest: HASH_E,
    runtimeRevision: 30,
    decisionStoreRevision: 4,
  });
}

/** Creates one production coordinator fixture with a strict accept-exact command. */
function createFixture(options?: {
  readonly validationResult?: Readonly<KnowledgeForwardRevisionValidationCoordinatorResult>;
  readonly admission?: Readonly<KnowledgeForwardRevisionDecisionAdmission> | null;
  readonly terminalResult?: Readonly<KnowledgeForwardRevisionDecisionResult>;
  readonly assertCurrent?: () => void;
  readonly onDecide?: () => void;
}) {
  const owner = createKnowledgeExecutionOwner();
  const proposal = createProposal();
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  const command = createKnowledgeForwardRevisionReviewCommand({
    action: "accept_exact",
    proposal,
    proposalDigest,
  });
  const capability = Object.freeze({ opaque: true });
  const validationResult =
    options?.validationResult ??
    Object.freeze({
      kind: "validated" as const,
      capability,
    });
  const validator = createValidator(owner, async () => validationResult);
  const admission =
    options && "admission" in options
      ? options.admission
      : Object.freeze({ kind: "pending" as const, proposal, proposalDigest });
  const decisionResult = options?.terminalResult ?? createTerminalResult("accepted");
  const decisions = createDecisionPort(
    owner,
    async () => admission ?? null,
    async () => {
      options?.onDecide?.();
      return decisionResult;
    }
  );
  const coordinator = new KnowledgeProductionForwardRevisionDecisionCoordinator(
    validator,
    decisions,
    owner,
    options?.assertCurrent ?? (() => undefined)
  );
  return {
    owner,
    proposal,
    proposalDigest,
    command,
    capability,
    validator,
    decisions,
    coordinator,
  };
}

/** Reads one enumerable request field without widening mock call types. */
function readRequestField(value: unknown, key: keyof KnowledgeForwardRevisionDecisionRequest) {
  return (value as Readonly<Record<string, unknown>>)[key];
}

describe("KnowledgeProductionForwardRevisionDecisionCoordinator", () => {
  it("passes only its validator-minted original capability into adjacent acceptance CAS", async () => {
    const fixture = createFixture();
    const result = await fixture.coordinator.decide(fixture.command, new AbortController().signal);

    expect(result).toEqual({
      kind: "accepted",
      outcome: "decided",
      proposalId: fixture.proposal.proposalId,
      commandId: fixture.command.commandId,
      decisionDigest: HASH_E,
      runtimeRevision: 30,
      decisionStoreRevision: 4,
    });
    expect("decision" in result).toBe(false);
    expect(fixture.validator.calls).toEqual([
      {
        proposal: fixture.proposal,
        proposalDigest: fixture.proposalDigest,
        command: fixture.command,
      },
    ]);
    expect(fixture.decisions.decideCalls).toHaveLength(1);
    expect(readRequestField(fixture.decisions.decideCalls[0], "command")).toBe(
      (fixture.validator.calls[0] as Readonly<Record<string, unknown>>).command
    );
    expect(readRequestField(fixture.decisions.decideCalls[0], "validationCapability")).toBe(
      fixture.capability
    );
  });

  it("rejects directly after strict pending admission without validation capability", async () => {
    const fixture = createFixture();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "reject",
      proposal: fixture.proposal,
      proposalDigest: fixture.proposalDigest,
    });
    const rejected = createTerminalResult("rejected");
    const decisions = createDecisionPort(
      fixture.owner,
      async () => ({
        kind: "pending" as const,
        proposal: fixture.proposal,
        proposalDigest: fixture.proposalDigest,
      }),
      async () => rejected
    );
    const coordinator = new KnowledgeProductionForwardRevisionDecisionCoordinator(
      fixture.validator,
      decisions,
      fixture.owner,
      () => undefined
    );

    await expect(coordinator.decide(command, new AbortController().signal)).resolves.toMatchObject({
      kind: "rejected",
      commandId: command.commandId,
    });
    expect(fixture.validator.calls).toHaveLength(0);
    expect(decisions.decideCalls).toHaveLength(1);
    expect(Reflect.ownKeys(decisions.decideCalls[0] as object)).toEqual(["command"]);
  });

  it("returns no_change without entering the Runtime decision boundary", async () => {
    const proposal = createProposal();
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_edited",
      proposal,
      proposalDigest,
      afterContent: CURRENT_CONTENT,
    });
    const owner = createKnowledgeExecutionOwner();
    const validator = createValidator(owner, async () =>
      Object.freeze({
        kind: "no_change" as const,
        proposalId: proposal.proposalId,
        commandId: command.commandId,
        contentHash: createFileContentHash(CURRENT_CONTENT),
      })
    );
    const decisions = createDecisionPort(
      owner,
      async () => ({ kind: "pending" as const, proposal, proposalDigest }),
      async () => {
        throw new Error("no_change must not mutate Runtime");
      }
    );
    const coordinator = new KnowledgeProductionForwardRevisionDecisionCoordinator(
      validator,
      decisions,
      owner,
      () => undefined
    );

    await expect(coordinator.decide(command, new AbortController().signal)).resolves.toEqual({
      kind: "no_change",
      proposalId: proposal.proposalId,
      commandId: command.commandId,
      contentHash: createFileContentHash(CURRENT_CONTENT),
    });
    expect(decisions.decideCalls).toHaveLength(0);
  });

  it("returns exact terminal replay before validation", async () => {
    const fixture = createFixture({
      admission: Object.freeze({
        kind: "terminal" as const,
        result: createTerminalResult("accepted", "already_decided"),
      }),
    });

    await expect(
      fixture.coordinator.decide(fixture.command, new AbortController().signal)
    ).resolves.toMatchObject({ kind: "accepted", outcome: "already_decided" });
    expect(fixture.validator.calls).toHaveLength(0);
    expect(fixture.decisions.decideCalls).toHaveLength(0);
  });

  it("maps missing strict admission to stale and never validates or mutates", async () => {
    const fixture = createFixture({ admission: null });

    await expect(
      fixture.coordinator.decide(fixture.command, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(fixture.validator.calls).toHaveLength(0);
    expect(fixture.decisions.decideCalls).toHaveLength(0);
  });

  it("honors cancellation before CAS but preserves a committed result after invocation", async () => {
    const preAborted = createFixture();
    const aborted = new AbortController();
    aborted.abort("private reason");
    await expect(preAborted.coordinator.decide(preAborted.command, aborted.signal)).rejects.toEqual(
      expect.objectContaining({ name: "AbortError" })
    );
    expect(preAborted.decisions.readPendingCalls).toHaveLength(0);

    let current = true;
    const caller = new AbortController();
    const committed = createFixture({
      assertCurrent: () => {
        if (!current) throw new DOMException("stale", "AbortError");
      },
      onDecide: () => {
        current = false;
        caller.abort("private reason");
      },
    });
    await expect(
      committed.coordinator.decide(committed.command, caller.signal)
    ).resolves.toMatchObject({ kind: "accepted", outcome: "decided" });
  });

  it("rejects alternate-owner, forged, proxied, and revoked dependency compositions", () => {
    const fixture = createFixture();
    const otherOwner = createKnowledgeExecutionOwner();
    expect(
      () =>
        new KnowledgeProductionForwardRevisionDecisionCoordinator(
          fixture.validator,
          fixture.decisions,
          otherOwner,
          () => undefined
        )
    ).toThrow(DOMException);
    expect(
      () =>
        new KnowledgeProductionForwardRevisionDecisionCoordinator(
          new Proxy(fixture.validator, {}),
          fixture.decisions,
          fixture.owner,
          () => undefined
        )
    ).toThrow(DOMException);

    let current = true;
    const revocable = createFixture({
      assertCurrent: () => {
        if (!current) throw new DOMException("stale", "AbortError");
      },
    });
    current = false;
    expect(
      () =>
        new KnowledgeProductionForwardRevisionDecisionCoordinator(
          revocable.validator,
          revocable.decisions,
          revocable.owner,
          () => {
            throw new DOMException("stale", "AbortError");
          }
        )
    ).toThrow(DOMException);
  });

  it("normalizes a revoked coordinator receiver to AbortError before any dependency call", async () => {
    const fixture = createFixture();
    const decide = KnowledgeProductionForwardRevisionDecisionCoordinator.prototype.decide;
    const revoked = Proxy.revocable(fixture.coordinator, {});
    revoked.revoke();

    await expect(
      Reflect.apply(decide, revoked.proxy, [fixture.command, new AbortController().signal])
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.decisions.readPendingCalls).toHaveLength(0);
    expect(fixture.validator.calls).toHaveLength(0);
  });

  it("always returns a frozen closed value without accepted body material", async () => {
    const fixture = createFixture();
    const result: Readonly<KnowledgeProductionForwardRevisionDecisionResult> =
      await fixture.coordinator.decide(fixture.command, new AbortController().signal);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.ownKeys(result)).toEqual([
      "kind",
      "outcome",
      "proposalId",
      "commandId",
      "decisionDigest",
      "runtimeRevision",
      "decisionStoreRevision",
    ]);
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
  });
});
