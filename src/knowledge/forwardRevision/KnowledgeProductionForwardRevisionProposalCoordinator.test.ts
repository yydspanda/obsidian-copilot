import { KnowledgeProductionForwardRevisionProposalCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
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
  KnowledgeKnownAppliedWikiOutputsPort,
  KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const PAGE_PATH = "Wiki/Page.md";
const SELECTED_CONTENT = "# Historical\n";
const CURRENT_CONTENT = "# Current\n";
const SELECTED_REF = `known-wiki-output-${"2".repeat(64)}`;
const PAGE_REF = `known-wiki-page-${"3".repeat(64)}`;

/** Minimal atomic file used only to mint a genuine read/write Runtime facade. */
class MemoryAtomicRuntimeFile implements AtomicRuntimeFile {
  private content?: string;
  processCallCount = 0;

  /** Creates the file only when absent. */
  async initialize(initialContent: string): Promise<void> {
    this.content ??= initialContent;
  }

  /** Reads the exact current content. */
  async read(): Promise<string> {
    if (this.content === undefined) throw new Error("Runtime file is not initialized");
    return this.content;
  }

  /** Applies one synchronous exact transform. */
  async process(transform: (currentContent: string) => string): Promise<string> {
    this.processCallCount += 1;
    if (this.content === undefined) throw new Error("Runtime file is not initialized");
    this.content = transform(this.content);
    return this.content;
  }
}

/** Mints one genuine owner-bound Runtime facade and its revocable test lifecycle. */
function createRuntimeFixture(file = new MemoryAtomicRuntimeFile()) {
  const pairing = createKnowledgeProductionWorkflowExecutionPairing();
  const executionBinding = consumeKnowledgeProductionWorkflowExecutionPreflightClaim(
    pairing.preflightClaim
  );
  const execution = executionBinding.issueWorkflowExecutionLease();
  const runtime = new KnowledgeRuntimeStore(file, {
    productionExecutionClaim: pairing.runtimeClaim,
  });
  const proofPort = new KnowledgeRuntimeIngestExecutionProofPort(
    runtime,
    new KnowledgeRuntimeQueueStorage(runtime, execution.executionOwner)
  );
  return Object.freeze({
    file,
    runtime,
    executionOwner: execution.executionOwner,
    workflowLease: execution.lease,
    port: new KnowledgeRuntimeForwardRevisionProposalPublicationPort(
      runtime,
      proofPort,
      execution.lease
    ),
    revoke: () => executionBinding.revokeWorkflowExecutionLease(execution.lease),
  });
}

/** Creates one authentic-shaped R3b session for pre-publication checks. */
function createSession(
  currentState: "applied" | "drifted" = "applied"
): Readonly<KnowledgeKnownAppliedWikiOutputsSession> {
  return Object.freeze({
    pageRef: PAGE_REF,
    displayPagePath: PAGE_PATH,
    currentState,
    currentMatch: currentState === "applied" ? "current_applied" : "none",
    knownOutputCount: 1,
    items: Object.freeze([
      Object.freeze({
        outputRef: SELECTED_REF,
        appliedAt: 100,
        verifiedApplyCount: 1,
        relation:
          currentState === "applied" ? ("current_applied" as const) : ("latest_known" as const),
      }),
    ]),
  });
}

/** Creates one identity-checking R3b reader with no Runtime authority. */
function createKnownOutputsDelegate(
  session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
  currentContent = CURRENT_CONTENT
): KnowledgeKnownAppliedWikiOutputsPort & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async inspectKnownOutputs() {
      return session;
    },
    async listMore() {
      return Object.freeze({ kind: "stale" as const });
    },
    async readOutput(candidate, outputRef) {
      calls.push(candidate);
      if (candidate !== session || outputRef !== SELECTED_REF) {
        return Object.freeze({ kind: "stale" as const });
      }
      return Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          appliedAt: 100,
          verifiedApplyCount: 1,
          content: SELECTED_CONTENT,
        }),
      });
    },
    async compareWithCurrent(candidate, outputRef) {
      calls.push(candidate);
      if (candidate !== session || outputRef !== SELECTED_REF) {
        return Object.freeze({ kind: "stale" as const });
      }
      return Object.freeze({
        kind: "loaded" as const,
        value: Object.freeze({
          outputRef,
          currentState:
            candidate.currentState === "applied" ? ("applied" as const) : ("drifted" as const),
          knownContent: SELECTED_CONTENT,
          currentContent,
        }),
      });
    },
  };
}

/** Creates the production coordinator over genuine Runtime and R3b capabilities. */
async function createCoordinator(
  delegateSession: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
  currentContent = CURRENT_CONTENT
): Promise<{
  readonly coordinator: KnowledgeProductionForwardRevisionProposalCoordinator;
  readonly knownOutputs: DelegatingKnowledgeKnownAppliedWikiOutputsPort;
  readonly delegate: ReturnType<typeof createKnownOutputsDelegate>;
  readonly session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
  readonly runtime: ReturnType<typeof createRuntimeFixture>;
}> {
  const delegate = createKnownOutputsDelegate(delegateSession, currentContent);
  const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
  knownOutputs.replaceDelegate(delegate);
  const session = await knownOutputs.inspectKnownOutputs(
    { pagePath: PAGE_PATH },
    new AbortController().signal
  );
  const runtime = createRuntimeFixture();
  return {
    knownOutputs,
    delegate,
    session,
    runtime,
    coordinator: new KnowledgeProductionForwardRevisionProposalCoordinator({
      knownOutputs,
      knownOutputsDelegate: delegate,
      runtime: runtime.port,
      executionOwner: runtime.executionOwner,
      bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
      assertCurrent: () => runtime.workflowLease.assertCurrent(),
    }),
  };
}

describe("KnowledgeProductionForwardRevisionProposalCoordinator", () => {
  it("authenticates only exact process-local coordinator instances", async () => {
    const { coordinator } = await createCoordinator(createSession());
    expect(() =>
      KnowledgeProductionForwardRevisionProposalCoordinator.assert(coordinator)
    ).not.toThrow();
    expect(() =>
      KnowledgeProductionForwardRevisionProposalCoordinator.assert(
        Object.create(KnowledgeProductionForwardRevisionProposalCoordinator.prototype)
      )
    ).toThrow(DOMException);
    expect(() =>
      KnowledgeProductionForwardRevisionProposalCoordinator.assert(new Proxy(coordinator, {}))
    ).toThrow(DOMException);
  });

  it("rejects every duck-typed write surface before retaining dependencies", () => {
    const delegate = createKnownOutputsDelegate(createSession());
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    knownOutputs.replaceDelegate(delegate);
    const runtime = createRuntimeFixture();
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs,
          knownOutputsDelegate: delegate,
          runtime: {
            readForwardRevisionProposalAuthority: async () => null,
            readForwardRevisionReview: async () => ({}),
            publishForwardRevisionProposalAtomically: async () => ({}),
          } as unknown as KnowledgeRuntimeForwardRevisionProposalPublicationPort,
          executionOwner: runtime.executionOwner,
          bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
          assertCurrent: () => undefined,
        })
    ).toThrow(TypeError);
  });

  it("rejects a genuine Runtime facade owned by another execution without publishing", () => {
    const delegate = createKnownOutputsDelegate(createSession());
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    knownOutputs.replaceDelegate(delegate);
    const first = createRuntimeFixture();
    const second = createRuntimeFixture();

    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs,
          knownOutputsDelegate: delegate,
          runtime: first.port,
          executionOwner: second.executionOwner,
          bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
          assertCurrent: () => undefined,
        })
    ).toThrow(DOMException);
    expect(first.file.processCallCount).toBe(0);
    expect(second.file.processCallCount).toBe(0);
  });

  it("rejects a revoked execution before reading Vault text or publishing", async () => {
    const fixture = await createCoordinator(createSession());
    fixture.runtime.revoke();

    await expect(
      fixture.coordinator.proposeKnownOutput(
        fixture.session,
        SELECTED_REF,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.delegate.calls).toHaveLength(0);
    expect(fixture.runtime.file.processCallCount).toBe(0);
  });

  it("re-proves Runtime ownership after an awaited Vault read with zero publication", async () => {
    const sourceSession = createSession();
    const baseDelegate = createKnownOutputsDelegate(sourceSession);
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    const runtime = createRuntimeFixture();
    const revokingDelegate: KnowledgeKnownAppliedWikiOutputsPort = {
      ...baseDelegate,
      async readOutput(session, outputRef, signal) {
        const result = await baseDelegate.readOutput(session, outputRef, signal);
        runtime.revoke();
        return result;
      },
    };
    knownOutputs.replaceDelegate(revokingDelegate);
    const session = await knownOutputs.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );
    const coordinator = new KnowledgeProductionForwardRevisionProposalCoordinator({
      knownOutputs,
      knownOutputsDelegate: revokingDelegate,
      runtime: runtime.port,
      executionOwner: runtime.executionOwner,
      bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
      assertCurrent: () => runtime.workflowLease.assertCurrent(),
    });

    await expect(
      coordinator.proposeKnownOutput(session, SELECTED_REF, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(baseDelegate.calls).toEqual([sourceSession]);
    expect(runtime.file.processCallCount).toBe(0);
  });

  it("rejects a duck-typed known-output reader before it can supply Vault text", () => {
    const delegate = createKnownOutputsDelegate(createSession());
    const runtime = createRuntimeFixture();
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs: delegate as unknown as DelegatingKnowledgeKnownAppliedWikiOutputsPort,
          knownOutputsDelegate: delegate,
          runtime: runtime.port,
          executionOwner: runtime.executionOwner,
          bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
          assertCurrent: () => undefined,
        })
    ).toThrow(DOMException);
  });

  it("revokes an old action before a replacement reader or its authentic session can be used", async () => {
    const originalDelegate = createKnownOutputsDelegate(createSession());
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    knownOutputs.replaceDelegate(originalDelegate);
    const file = new MemoryAtomicRuntimeFile();
    const runtime = createRuntimeFixture(file);
    const coordinator = new KnowledgeProductionForwardRevisionProposalCoordinator({
      knownOutputs,
      knownOutputsDelegate: originalDelegate,
      runtime: runtime.port,
      executionOwner: runtime.executionOwner,
      bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
      assertCurrent: () => undefined,
    });

    const replacementDelegate = createKnownOutputsDelegate(createSession());
    knownOutputs.replaceDelegate(replacementDelegate);
    const replacementSession = await knownOutputs.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );

    await expect(
      coordinator.proposeKnownOutput(replacementSession, SELECTED_REF, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(originalDelegate.calls).toHaveLength(0);
    expect(replacementDelegate.calls).toHaveLength(0);
    expect(file.processCallCount).toBe(0);
  });

  it("re-proves the exact reader after an awaited read before any publication", async () => {
    const sourceSession = createSession();
    const baseDelegate = createKnownOutputsDelegate(sourceSession);
    const replacementDelegate = createKnownOutputsDelegate(createSession());
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    const swappingDelegate: KnowledgeKnownAppliedWikiOutputsPort = {
      ...baseDelegate,
      async readOutput(session, outputRef, signal) {
        const result = await baseDelegate.readOutput(session, outputRef, signal);
        knownOutputs.replaceDelegate(replacementDelegate);
        return result;
      },
    };
    knownOutputs.replaceDelegate(swappingDelegate);
    const session = await knownOutputs.inspectKnownOutputs(
      { pagePath: PAGE_PATH },
      new AbortController().signal
    );
    const file = new MemoryAtomicRuntimeFile();
    const runtime = createRuntimeFixture(file);
    const coordinator = new KnowledgeProductionForwardRevisionProposalCoordinator({
      knownOutputs,
      knownOutputsDelegate: swappingDelegate,
      runtime: runtime.port,
      executionOwner: runtime.executionOwner,
      bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
      assertCurrent: () => undefined,
    });

    await expect(
      coordinator.proposeKnownOutput(session, SELECTED_REF, new AbortController().signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(baseDelegate.calls).toEqual([sourceSession]);
    expect(replacementDelegate.calls).toHaveLength(0);
    expect(file.processCallCount).toBe(0);
  });

  it("passes the original authentic R3b session and rejects a copied capability", async () => {
    const { coordinator, delegate, session } = await createCoordinator(createSession());
    const copied = JSON.parse(JSON.stringify(session)) as KnowledgeKnownAppliedWikiOutputsSession;

    await expect(
      coordinator.proposeKnownOutput(copied, SELECTED_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "stale" });
    expect(delegate.calls).toHaveLength(0);
  });

  it("admits only current-applied sessions before any R3b or Runtime read", async () => {
    const { coordinator, delegate, session } = await createCoordinator(createSession("drifted"));

    await expect(
      coordinator.proposeKnownOutput(session, SELECTED_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "not_eligible", reason: "current_not_applied" });
    expect(delegate.calls).toHaveLength(0);
  });

  it("rejects a selected body equal to the exact current file before Runtime admission", async () => {
    const delegateSession = createSession();
    const { coordinator, delegate, session } = await createCoordinator(
      delegateSession,
      SELECTED_CONTENT
    );

    await expect(
      coordinator.proposeKnownOutput(session, SELECTED_REF, new AbortController().signal)
    ).resolves.toEqual({ kind: "not_eligible", reason: "selected_is_current" });
    expect(delegate.calls).toEqual([delegateSession, delegateSession]);
  });

  it("rejects overlapping trusted Bundle roots at construction", () => {
    const delegate = createKnownOutputsDelegate(createSession());
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    knownOutputs.replaceDelegate(delegate);
    const runtime = createRuntimeFixture();
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs,
          knownOutputsDelegate: delegate,
          runtime: runtime.port,
          executionOwner: runtime.executionOwner,
          bundles: [
            { bundleId: "bundle-a", wikiRoot: "Wiki" },
            { bundleId: "bundle-b", wikiRoot: "wiki/Nested" },
          ],
          assertCurrent: () => undefined,
        })
    ).toThrow(DOMException);
  });
});
