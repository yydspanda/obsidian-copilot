import {
  isKnowledgeForwardRevisionProposalReviewRef,
  KnowledgeProductionForwardRevisionProposalActionAdapter,
  type KnowledgeForwardRevisionProposalActionPort,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort";
import { KnowledgeProductionForwardRevisionProposalCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
import type { KnowledgeForwardRevisionProposalResult } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeForwardRevisionProposalPublicationPort,
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  consumeKnowledgeProductionWorkflowExecutionPreflightClaim,
  createKnowledgeProductionWorkflowExecutionPairing,
} from "@/knowledge/startup/KnowledgeProductionWorkflowExecutionLease";
import { DelegatingKnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/DelegatingKnowledgeKnownAppliedWikiOutputsPort";
import type {
  KnowledgeKnownAppliedWikiOutputOriginSummary,
  KnowledgeKnownAppliedWikiOutputsPort,
  KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const CURRENT_REF = `known-wiki-output-${"1".repeat(64)}`;
const EARLIER_REF = `known-wiki-output-${"2".repeat(64)}`;

/** Creates canonical source-Apply provenance for proposal action fixtures. */
function origins(
  appliedAt: number,
  verifiedApplyCount: number
): readonly Readonly<KnowledgeKnownAppliedWikiOutputOriginSummary>[] {
  return Object.freeze([
    Object.freeze({
      kind: "source_apply" as const,
      verifiedApplyCount,
      newestAppliedAt: appliedAt,
      newestManifestRevision: appliedAt,
    }),
  ]);
}

/** Minimal atomic file used only to mint a genuine Runtime facade. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;

  /** Initializes the in-memory file exactly once. */
  async initialize(initialContent: string): Promise<void> {
    this.content ??= initialContent;
  }

  /** Reads the initialized in-memory content. */
  async read(): Promise<string> {
    if (this.content === undefined) throw new Error("Runtime file is not initialized");
    return this.content;
  }

  /** Applies one synchronous exact content transform. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    if (this.content === undefined) throw new Error("Runtime file is not initialized");
    this.content = transform(this.content);
    return this.content;
  }
}

/** Creates one valid current-applied session containing an earlier selection. */
function createSession(): Readonly<KnowledgeKnownAppliedWikiOutputsSession> {
  return Object.freeze({
    pageRef: `known-wiki-page-${"3".repeat(64)}`,
    displayPagePath: "Wiki/Page.md",
    currentState: "applied" as const,
    currentMatch: "current_applied" as const,
    knownOutputCount: 2,
    items: Object.freeze([
      Object.freeze({
        outputRef: CURRENT_REF,
        appliedAt: 200,
        verifiedApplyCount: 1,
        origins: origins(200, 1),
        relation: "current_applied" as const,
        proposalCapability: "selected_is_current" as const,
      }),
      Object.freeze({
        outputRef: EARLIER_REF,
        appliedAt: 100,
        verifiedApplyCount: 2,
        origins: origins(100, 2),
        relation: "earlier_known" as const,
        proposalCapability: "available" as const,
      }),
    ]),
  });
}

/** Creates one genuine adapter and the authentic session bound to its R3b reader. */
async function createFixture(
  sourceSession: Readonly<KnowledgeKnownAppliedWikiOutputsSession> = createSession()
): Promise<{
  readonly adapter: KnowledgeProductionForwardRevisionProposalActionAdapter;
  readonly coordinator: KnowledgeProductionForwardRevisionProposalCoordinator;
  readonly session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
  readonly readOutput: jest.MockedFunction<KnowledgeKnownAppliedWikiOutputsPort["readOutput"]>;
  readonly retainDrain: jest.MockedFunction<(drain: Promise<void>) => void>;
}> {
  const readOutput: jest.MockedFunction<KnowledgeKnownAppliedWikiOutputsPort["readOutput"]> =
    jest.fn(async (_session, outputRef, _signal) => {
      const summary = sourceSession.items.find((item) => item.outputRef === outputRef);
      if (!summary) return Object.freeze({ kind: "stale" as const });
      return Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          appliedAt: summary.appliedAt,
          verifiedApplyCount: summary.verifiedApplyCount,
          origins: summary.origins,
          proposalCapability: summary.proposalCapability,
          content: outputRef === EARLIER_REF ? "same current body" : "current body",
        }),
      });
    });
  const delegate: KnowledgeKnownAppliedWikiOutputsPort = Object.freeze({
    inspectKnownOutputs: async () => sourceSession,
    listMore: async () => Object.freeze({ kind: "stale" as const }),
    readOutput,
    compareWithCurrent: async (
      _session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
      outputRef: string,
      _signal: AbortSignal
    ) =>
      Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          currentState: "applied" as const,
          knownContent: outputRef === EARLIER_REF ? "same current body" : "current body",
          currentContent: "same current body",
        }),
      }),
  });
  const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
  knownOutputs.replaceDelegate(delegate);
  const session = await knownOutputs.inspectKnownOutputs(
    { pagePath: "Wiki/Page.md" },
    new AbortController().signal
  );
  const pairing = createKnowledgeProductionWorkflowExecutionPairing();
  const executionBinding = consumeKnowledgeProductionWorkflowExecutionPreflightClaim(
    pairing.preflightClaim
  );
  const execution = executionBinding.issueWorkflowExecutionLease();
  const runtime = new KnowledgeRuntimeStore(new MemoryAtomicRuntimeFile(), {
    productionExecutionClaim: pairing.runtimeClaim,
  });
  const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(
    runtime,
    new KnowledgeRuntimeQueueStorage(runtime, execution.executionOwner)
  );
  const coordinator = new KnowledgeProductionForwardRevisionProposalCoordinator({
    knownOutputs,
    knownOutputsDelegate: delegate,
    runtime: new KnowledgeRuntimeForwardRevisionProposalPublicationPort(
      runtime,
      proofPort,
      execution.lease
    ),
    executionOwner: execution.executionOwner,
    bundles: [{ bundleId: "personal", wikiRoot: "Wiki" }],
    assertCurrent: () => undefined,
  });
  const retainDrain = jest.fn<void, [Promise<void>]>();
  return {
    adapter: new KnowledgeProductionForwardRevisionProposalActionAdapter(coordinator, retainDrain),
    coordinator,
    session,
    readOutput,
    retainDrain,
  };
}

describe("KnowledgeProductionForwardRevisionProposalActionAdapter", () => {
  it("accepts only the exact bounded opaque Studio Review ref category", () => {
    expect(
      isKnowledgeForwardRevisionProposalReviewRef(`forward-studio-review-${"8".repeat(64)}`)
    ).toBe(true);
    expect(isKnowledgeForwardRevisionProposalReviewRef("forward-studio-review-short")).toBe(false);
    expect(
      isKnowledgeForwardRevisionProposalReviewRef(`forward-studio-review-${"G".repeat(64)}`)
    ).toBe(false);
  });

  it("rejects duck-typed coordinators and authenticates only exact adapters", async () => {
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalActionAdapter(
          {
            proposeKnownOutput: async () => Object.freeze({ kind: "published" as const }),
          } as unknown as KnowledgeProductionForwardRevisionProposalCoordinator,
          jest.fn()
        )
    ).toThrow(DOMException);

    const { adapter } = await createFixture();
    expect(() =>
      KnowledgeProductionForwardRevisionProposalActionAdapter.assert(adapter)
    ).not.toThrow();
    expect(() =>
      KnowledgeProductionForwardRevisionProposalActionAdapter.assert(
        Object.create(KnowledgeProductionForwardRevisionProposalActionAdapter.prototype)
      )
    ).toThrow(DOMException);
    expect(() =>
      KnowledgeProductionForwardRevisionProposalActionAdapter.assert(new Proxy(adapter, {}))
    ).toThrow(DOMException);
  });

  it("requires production drain retention at construction", async () => {
    const { coordinator } = await createFixture();

    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalActionAdapter(
          coordinator,
          undefined as unknown as (drain: Promise<void>) => void
        )
    ).toThrow(DOMException);
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalActionAdapter(
          coordinator,
          "not-a-drain-owner" as unknown as (drain: Promise<void>) => void
        )
    ).toThrow(DOMException);
  });

  it("registers the dispatched coordinator operation before awaiting its result", async () => {
    const { adapter, session, retainDrain } = await createFixture();

    const pending = adapter.proposeKnownOutput(session, EARLIER_REF, new AbortController().signal);

    expect(retainDrain).toHaveBeenCalledTimes(1);
    const retained = retainDrain.mock.calls[0][0];
    expect(retained).toBeInstanceOf(Promise);
    await expect(pending).resolves.toEqual({
      kind: "not_eligible",
      reason: "selected_is_current",
    });
    await expect(retained).resolves.toBeUndefined();
  });

  it("passes only the authentic opaque selection and removes coordinator-only identities", async () => {
    const { adapter, session } = await createFixture();
    const action: KnowledgeForwardRevisionProposalActionPort = adapter;

    await expect(
      action.proposeKnownOutput(session, EARLIER_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "not_eligible", reason: "selected_is_current" });
    const result = await action.proposeKnownOutput(
      session,
      EARLIER_REF,
      new AbortController().signal
    );
    expect(Reflect.ownKeys(result)).toEqual(["kind", "reason"]);

    const copied = JSON.parse(JSON.stringify(session)) as KnowledgeKnownAppliedWikiOutputsSession;
    await expect(
      action.proposeKnownOutput(copied, EARLIER_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
  });

  it("preserves the explicit Forward-origin ineligibility without widening action authority", async () => {
    const base = createSession();
    const forwardSession = Object.freeze({
      ...base,
      items: Object.freeze([
        base.items[0],
        Object.freeze({
          ...base.items[1],
          origins: Object.freeze([
            Object.freeze({
              kind: "forward_revision" as const,
              verifiedApplyCount: 2,
              newestAppliedAt: 100,
              newestManifestRevision: 100,
            }),
          ]),
          proposalCapability: "forward_origin_not_supported" as const,
        }),
      ]),
    });
    const { adapter, session } = await createFixture(forwardSession);

    await expect(
      adapter.proposeKnownOutput(session, EARLIER_REF, new AbortController().signal)
    ).resolves.toEqual({
      kind: "not_eligible",
      reason: "forward_origin_not_supported",
    });
  });

  it("does not dispatch a pre-aborted action", async () => {
    const { adapter, session, readOutput, retainDrain } = await createFixture();
    const caller = new AbortController();
    caller.abort();

    await expect(
      adapter.proposeKnownOutput(session, EARLIER_REF, caller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(readOutput).not.toHaveBeenCalled();
    expect(retainDrain).not.toHaveBeenCalled();
  });

  it("retains publication across caller cancellation and preserves a confirmed commit", async () => {
    const coordinatorModule =
      "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
    await jest.isolateModulesAsync(async () => {
      let resolveOperation:
        | ((result: Readonly<KnowledgeForwardRevisionProposalResult>) => void)
        | undefined;
      const operation = new Promise<Readonly<KnowledgeForwardRevisionProposalResult>>((resolve) => {
        resolveOperation = resolve;
      });

      class ControlledProposalCoordinator {
        /** Accepts only the exact controlled coordinator used by this adapter-unit boundary. */
        static assert(value: unknown): asserts value is ControlledProposalCoordinator {
          if (!(value instanceof ControlledProposalCoordinator)) throw new DOMException();
        }

        /** Returns the publication operation controlled by this test. */
        proposeKnownOutput(): Promise<Readonly<KnowledgeForwardRevisionProposalResult>> {
          return operation;
        }
      }

      jest.doMock(coordinatorModule, () => ({
        KnowledgeProductionForwardRevisionProposalCoordinator: ControlledProposalCoordinator,
      }));
      const isolated =
        await import("@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalActionPort");
      const retainDrain = jest.fn<void, [Promise<void>]>();
      const adapter = new isolated.KnowledgeProductionForwardRevisionProposalActionAdapter(
        new ControlledProposalCoordinator(),
        retainDrain
      );
      const caller = new AbortController();

      const pending = adapter.proposeKnownOutput(createSession(), EARLIER_REF, caller.signal);
      expect(retainDrain).toHaveBeenCalledTimes(1);
      const retained = retainDrain.mock.calls[0][0];
      caller.abort();
      resolveOperation?.(
        Object.freeze({
          kind: "published" as const,
          bundleId: "personal",
          receipt: Object.freeze({
            runtimeId: "runtime-proposal-action",
            proposalId: "proposal-action",
            proposalDigest: "8".repeat(64),
          }),
        }) as unknown as Readonly<KnowledgeForwardRevisionProposalResult>
      );

      const result = await pending;
      expect(result.kind).toBe("published");
      if (result.kind !== "published") throw new Error("Expected the confirmed publication");
      expect(Reflect.ownKeys(result).sort()).toEqual(["kind", "reviewRef"]);
      expect(isolated.isKnowledgeForwardRevisionProposalReviewRef(result.reviewRef)).toBe(true);
      for (const forbidden of ["bundleId", "proposalId", "proposalDigest", "receipt"]) {
        expect(Object.hasOwn(result, forbidden)).toBe(false);
      }
      await expect(retained).resolves.toBeUndefined();
    });
    jest.dontMock(coordinatorModule);
  });
});
