import { KnowledgeProductionForwardRevisionProposalCoordinator } from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionProposalCoordinator";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeForwardRevisionProposalPublicationPort,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
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
    if (this.content === undefined) throw new Error("Runtime file is not initialized");
    this.content = transform(this.content);
    return this.content;
  }
}

/** Mints the genuine facade required by the production coordinator boundary. */
function createRuntimePort(): KnowledgeRuntimeForwardRevisionProposalPublicationPort {
  return new KnowledgeRuntimeForwardRevisionProposalPublicationPort(
    new KnowledgeRuntimeStore(new MemoryAtomicRuntimeFile())
  );
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
}> {
  const delegate = createKnownOutputsDelegate(delegateSession, currentContent);
  const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
  knownOutputs.replaceDelegate(delegate);
  const session = await knownOutputs.inspectKnownOutputs(
    { pagePath: PAGE_PATH },
    new AbortController().signal
  );
  return {
    knownOutputs,
    delegate,
    session,
    coordinator: new KnowledgeProductionForwardRevisionProposalCoordinator({
      knownOutputs,
      knownOutputsDelegate: delegate,
      runtime: createRuntimePort(),
      bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
      assertCurrent: () => undefined,
    }),
  };
}

describe("KnowledgeProductionForwardRevisionProposalCoordinator", () => {
  it("rejects every duck-typed write surface before retaining dependencies", () => {
    const delegate = createKnownOutputsDelegate(createSession());
    const knownOutputs = new DelegatingKnowledgeKnownAppliedWikiOutputsPort();
    knownOutputs.replaceDelegate(delegate);
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
          bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
          assertCurrent: () => undefined,
        })
    ).toThrow(TypeError);
  });

  it("rejects a duck-typed known-output reader before it can supply Vault text", () => {
    const delegate = createKnownOutputsDelegate(createSession());
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs: delegate as unknown as DelegatingKnowledgeKnownAppliedWikiOutputsPort,
          knownOutputsDelegate: delegate,
          runtime: createRuntimePort(),
          bundles: [{ bundleId: "bundle-a", wikiRoot: "Wiki" }],
          assertCurrent: () => undefined,
        })
    ).toThrow(DOMException);
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
    expect(
      () =>
        new KnowledgeProductionForwardRevisionProposalCoordinator({
          knownOutputs,
          knownOutputsDelegate: delegate,
          runtime: createRuntimePort(),
          bundles: [
            { bundleId: "bundle-a", wikiRoot: "Wiki" },
            { bundleId: "bundle-b", wikiRoot: "wiki/Nested" },
          ],
          assertCurrent: () => undefined,
        })
    ).toThrow(DOMException);
  });
});
