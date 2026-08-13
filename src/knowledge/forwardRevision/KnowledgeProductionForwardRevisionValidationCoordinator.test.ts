jest.mock("@/knowledge/runtime/KnowledgeRuntimeStore", () => {
  const authentic = new WeakSet<object>();
  class KnowledgeRuntimeForwardRevisionValidationPort {
    readonly calls: unknown[] = [];
    private readonly responses: unknown[];
    private readonly executionOwner: unknown;

    /** Captures scripted read-only Runtime responses for coordinator unit tests. */
    constructor(responses: unknown[], executionOwner: unknown) {
      this.responses = responses;
      this.executionOwner = executionOwner;
      authentic.add(this);
      Object.freeze(this);
    }

    /** Requires one mock-module-minted exact base instance. */
    static assert(value: unknown): void {
      if (
        typeof value !== "object" ||
        value === null ||
        Object.getPrototypeOf(value) !== KnowledgeRuntimeForwardRevisionValidationPort.prototype ||
        !authentic.has(value)
      ) {
        throw new TypeError("invalid Runtime validation port");
      }
    }

    /** Reports exact mock lifecycle ownership without exposing it. */
    static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
      return (
        typeof value === "object" &&
        value !== null &&
        authentic.has(value) &&
        (value as KnowledgeRuntimeForwardRevisionValidationPort).executionOwner === executionOwner
      );
    }

    /** Returns the next scripted authority while retaining the detached query. */
    async readForwardRevisionValidationAuthority(query: unknown): Promise<unknown> {
      this.calls.push(query);
      const response = this.responses.shift();
      return typeof response === "function" ? response(query) : response;
    }
  }
  return { KnowledgeRuntimeForwardRevisionValidationPort };
});

jest.mock("@/knowledge/ingest/KnowledgeSourceWorkflowPlan", () => {
  const authentic = new WeakSet<object>();
  class KnowledgeSourceExecutionPlan {
    readonly prepareCalls: unknown[] = [];
    private readonly config: {
      digests: string[];
      profile: unknown;
      preparations: unknown[];
      onPrepare?: () => void;
      executionOwner: unknown;
    };

    /** Captures scripted authentic-plan material for deterministic coordinator tests. */
    constructor(config: {
      digests: string[];
      profile: unknown;
      preparations: unknown[];
      onPrepare?: () => void;
      executionOwner: unknown;
    }) {
      this.config = config;
      authentic.add(this);
      Object.freeze(this);
    }

    /** Reports exact mock workflow lifecycle ownership. */
    matchesExecutionOwner(executionOwner: unknown): boolean {
      return this.config.executionOwner === executionOwner;
    }

    /** Requires one mock-module-minted exact base plan. */
    static assert(value: unknown): void {
      if (
        typeof value !== "object" ||
        value === null ||
        Object.getPrototypeOf(value) !== KnowledgeSourceExecutionPlan.prototype ||
        !authentic.has(value)
      ) {
        throw new TypeError("invalid execution plan");
      }
    }

    /** Returns the next generation digest, retaining the last stable value. */
    getDigest(): string {
      return this.config.digests.length > 1
        ? (this.config.digests.shift() as string)
        : this.config.digests[0];
    }

    /** Returns the exact configured Bundle profile. */
    getBundlePipelineProfile(): unknown {
      return this.config.profile;
    }

    /** Returns the exact parser preparation without performing external work. */
    async prepare(job: unknown, signal: AbortSignal): Promise<unknown> {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      this.prepareCalls.push(job);
      this.config.onPrepare?.();
      return this.config.preparations.length > 1
        ? this.config.preparations.shift()
        : this.config.preparations[0];
    }
  }
  return { KnowledgeSourceExecutionPlan };
});

jest.mock("@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver", () => {
  const authentic = new WeakSet<object>();
  const errorCodes = new WeakMap<object, string>();

  class ObsidianKnowledgeCompilerTargetResolverError extends Error {
    /** Creates one sanitized mock production-reader failure. */
    constructor(code: string) {
      super("target resolver failed");
      errorCodes.set(this, code);
      Object.freeze(this);
    }

    /** Inspects only mock-module-minted target failures. */
    static inspect(value: unknown): string | undefined {
      return typeof value === "object" && value !== null ? errorCodes.get(value) : undefined;
    }
  }

  class ObsidianKnowledgeCompilerTargetResolver {
    readonly calls: unknown[] = [];
    private readonly observations: unknown[];
    private readonly executionOwner: unknown;

    /** Captures sequential bounded page observations. */
    constructor(observations: unknown[], executionOwner: unknown) {
      this.observations = observations;
      this.executionOwner = executionOwner;
      authentic.add(this);
      Object.freeze(this);
    }

    /** Requires one mock-module-minted exact base resolver. */
    static assert(value: unknown): void {
      if (
        typeof value !== "object" ||
        value === null ||
        Object.getPrototypeOf(value) !== ObsidianKnowledgeCompilerTargetResolver.prototype ||
        !authentic.has(value)
      ) {
        throw new TypeError("invalid target resolver");
      }
    }

    /** Reports exact mock Vault lifecycle ownership without exposing it. */
    static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
      return (
        typeof value === "object" &&
        value !== null &&
        authentic.has(value) &&
        (value as ObsidianKnowledgeCompilerTargetResolver).executionOwner === executionOwner
      );
    }

    /** Visits exactly one scripted current-page observation. */
    async visit(
      requests: readonly { targetId: string; path: string }[],
      signal: AbortSignal,
      options: { maxFileBytes: number },
      visitor: (observation: unknown, size: number | undefined) => void | Promise<void>
    ): Promise<void> {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      this.calls.push({ requests, options });
      const next = this.observations.shift();
      if (next instanceof Error) throw next;
      const observation = next as { content?: string };
      await visitor(
        observation,
        typeof observation?.content === "string"
          ? new TextEncoder().encode(observation.content).byteLength
          : undefined
      );
    }
  }
  return {
    ObsidianKnowledgeCompilerTargetResolver,
    ObsidianKnowledgeCompilerTargetResolverError,
  };
});

import { ObsidianKnowledgeCompilerTargetResolver } from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import {
  KnowledgeForwardRevisionValidationCapability,
  KnowledgeForwardRevisionValidationCoordinatorError,
  KnowledgeProductionForwardRevisionValidationCoordinator,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator";
import type { KnowledgeForwardRevisionAcceptanceAuthority } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionDecision";
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
import { createKnowledgeForwardRevisionValidationAuthority } from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationAuthority";
import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { KnowledgeSourceExecutionPlan } from "@/knowledge/ingest/KnowledgeSourceWorkflowPlan";
import { createSourceManifestDigest } from "@/knowledge/manifest/ManifestCommitIntent";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, KnowledgeBundleConfig, SourceManifest } from "@/knowledge/model/types";
import { KnowledgeRuntimeForwardRevisionValidationPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const SOURCE_TEXT = "Grounded evidence for the forward revision.";
const ARTIFACT_HASH = createFileContentHash(SOURCE_TEXT);
const HISTORICAL_CONTENT = `---\ntype: topic\ntitle: Historical revision\ntags: [knowledge]\nconfidence: 0.9\n---\n\n# Historical revision\n\n${SOURCE_TEXT}\n`;
const CURRENT_CONTENT = `---\ntype: topic\ntitle: Current revision\ntags: [knowledge]\nconfidence: 0.9\n---\n\n# Current revision\n\n${SOURCE_TEXT}\n`;
const EDITED_CONTENT = `---\ntype: topic\ntitle: Edited revision\ntags: [knowledge]\nconfidence: 0.9\n---\n\n# Edited revision\n\n${SOURCE_TEXT}\n`;
const PAGE_PATH = "Wiki/Topic.md";
const SOURCE_ID = "source-1";

interface MockRuntimePort {
  readonly calls: unknown[];
}

interface MockPlan {
  readonly prepareCalls: unknown[];
}

interface MockResolver {
  readonly calls: unknown[];
}

/** Creates one strict production Bundle boundary. */
function createBundle(): KnowledgeBundleConfig {
  return {
    version: 1,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Knowledge/schema.md",
    reviewMode: "always",
  };
}

/** Creates the exact current Manifest re-proved by the mock execution plan. */
function createManifest(): SourceManifest {
  return {
    version: 1,
    bundleId: "personal",
    revision: 9,
    entries: [
      {
        sourceId: SOURCE_ID,
        sourceKey: "sources/source-1.md",
        sourcePath: "Sources/Source-1.md",
        custody: "user_managed",
        lastSuccessful: {
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          generatedPages: [
            {
              path: PAGE_PATH,
              ownership: "generated",
              contentHash: createFileContentHash(CURRENT_CONTENT),
            },
          ],
          changeSetId: "changeset-current",
          completedAt: 125,
        },
      },
    ],
  };
}

/** Creates one complete historical citation revalidated against parser material. */
function createCitation(): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: {
      kind: "quote",
      sourceId: SOURCE_ID,
      artifactId: "artifact-1",
      artifactContentHash: ARTIFACT_HASH,
      excerpt: SOURCE_TEXT,
      quoteHash: createQuoteHash(SOURCE_TEXT),
    },
  };
}

/** Creates one strict pending proposal over distinct historical/current bytes. */
function createProposal(manifest: SourceManifest) {
  const manifestDigest = createSourceManifestDigest(manifest);
  const historicalHash = createFileContentHash(HISTORICAL_CONTENT);
  const currentHash = createFileContentHash(CURRENT_CONTENT);
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath: PAGE_PATH,
    historical: {
      bundleId: "personal",
      pagePath: PAGE_PATH,
      transactionId: "transaction-historical",
      sourceId: SOURCE_ID,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: "changeset-historical",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: 100,
      selectedContentHash: historicalHash,
    },
    current: {
      currentState: "applied",
      ownership: "generated",
      sourceOrigin: "ingest",
      sourceRetired: false,
      sourceIds: [SOURCE_ID],
      primarySourceId: SOURCE_ID,
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: manifest.revision,
      manifestDigest,
      manifestBaseHash: currentHash,
      vaultObservedBeforeHash: currentHash,
    },
  });
  const request = createKnowledgeForwardRevisionRequest({
    requestRevision: 1,
    runtimeId: "runtime-1",
    bundleId: "personal",
    pagePath: PAGE_PATH,
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
        path: PAGE_PATH,
        operation: "update",
        afterHash: historicalHash,
        sourceRefs: [SOURCE_ID],
      },
      manifestPage: {
        path: PAGE_PATH,
        ownership: "generated",
        contentHash: historicalHash,
      },
    },
    selectedContent: HISTORICAL_CONTENT,
    selectedContentHash: historicalHash,
    requestedAt: 120,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({ request, recordedAt: 120 });
}

/** Creates one exact decision-time Runtime/source authority. */
function createAcceptanceAuthority(
  proposal: ReturnType<typeof createProposal>,
  runtimeRevision: number,
  runtimeDigest: string
): KnowledgeForwardRevisionAcceptanceAuthority {
  const current = proposal.request.intent.current;
  return {
    runtimeId: proposal.request.runtimeId,
    runtimeRevision,
    runtimeDigest,
    manifestRevision: current.manifestRevision,
    manifestDigest: current.manifestDigest,
    manifestBaseHash: current.manifestBaseHash,
    vaultObservedBeforeHash: current.vaultObservedBeforeHash,
    currentSourceFreshness: {
      kind: "applied",
      runtimeId: proposal.request.runtimeId,
      runtimeRevision,
      runtimeDigest,
      bundleId: proposal.request.bundleId,
      sourceId: current.primarySourceId,
      sourceContentHash: current.sourceContentHash,
      pipelineFingerprint: current.pipelineFingerprint,
      inputRevision: current.inputRevision,
      manifestRevision: current.manifestRevision,
      manifestDigest: current.manifestDigest,
      committedManifestRevision: 8,
      completedAt: 125,
      transactionId: "transaction-current",
      changeSetId: "changeset-current",
      changeSetDigest: HASH_D,
      manifestIntentDigest: HASH_C,
      committedManifestDigest: HASH_B,
    },
  };
}

/** Creates a strict Runtime validation proof at one enclosing revision. */
function createAuthority(
  proposal: ReturnType<typeof createProposal>,
  runtimeRevision: number,
  runtimeDigest: string
) {
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  return createKnowledgeForwardRevisionValidationAuthority({
    query: {
      version: 1,
      kind: "forward_revision_validation_authority_query",
      runtimeId: proposal.request.runtimeId,
      bundleId: proposal.request.bundleId,
      pagePath: proposal.request.pagePath,
      proposalId: proposal.proposalId,
      proposalDigest,
      requestId: proposal.request.requestId,
      requestDigest: proposal.requestDigest,
      intentId: proposal.request.intent.intentId,
      intentDigest: proposal.request.intentDigest,
      expectedRecordRevision: 0,
    },
    proposal,
    proposalDigest,
    publishedRuntimeRevision: 20,
    proposalStoreRevision: 1,
    forwardReviewStoreRevision: 1,
    acceptanceAuthority: createAcceptanceAuthority(proposal, runtimeRevision, runtimeDigest),
    historicalAcceptedDigest: proposal.request.historicalReviewAuthority.acceptedDigest,
    historicalSourceRefs: [SOURCE_ID],
    historicalCitations: [createCitation()],
  });
}

/** Creates one exact read-only parser preparation and behavior profile. */
function createPreparation(manifest: SourceManifest) {
  const bundle = createBundle();
  const profile = {
    version: 1 as const,
    bundleId: bundle.id,
    compiler: { version: "1", configuration: {} },
    parsers: [{ id: "text-parser", version: "1", pathSuffixes: [".md"], configuration: {} }],
    model: { provider: "none", model: "none", configuration: {} },
    outputLanguage: "en",
    okfVersion: "0.1" as const,
    citationContractVersion: 1 as const,
  };
  return {
    profile,
    preparation: {
      authority: "unbound_read_only" as const,
      operation: "ingest" as const,
      bundle,
      manifest,
      schema: {
        path: bundle.schemaRef,
        content: "type: schema",
        contentHash: createFileContentHash("type: schema"),
      },
      source: {
        sourceId: SOURCE_ID,
        sourceContentHash: HASH_A,
        pipelineFingerprint: HASH_B,
        inputRevision: 7,
      },
      artifacts: [
        {
          kind: "text" as const,
          sourceId: SOURCE_ID,
          artifactId: "artifact-1",
          artifactContentHash: ARTIFACT_HASH,
          text: SOURCE_TEXT,
        },
      ],
    },
  };
}

/** Creates one exact scripted coordinator fixture. */
function createFixture(options?: {
  commandContent?: string;
  pages?: string[];
  runtimeResponses?: unknown[];
  planDigests?: string[];
  onPrepare?: () => void;
  preparations?: unknown[];
  executionOwner?: KnowledgeExecutionOwner;
  runtimeOwner?: KnowledgeExecutionOwner;
  planOwner?: KnowledgeExecutionOwner;
  resolverOwner?: KnowledgeExecutionOwner;
  assertCurrent?: () => void;
  sameRevisionDigestDrift?: boolean;
}) {
  const manifest = createManifest();
  const proposal = createProposal(manifest);
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  const command = createKnowledgeForwardRevisionReviewCommand(
    options?.commandContent === undefined
      ? { action: "accept_exact", proposal, proposalDigest }
      : {
          action: "accept_edited",
          proposal,
          proposalDigest,
          afterContent: options.commandContent,
        }
  );
  const before = createAuthority(proposal, 20, HASH_D);
  const after = createAuthority(proposal, options?.sameRevisionDigestDrift ? 20 : 21, HASH_E);
  const executionOwner = options?.executionOwner ?? createKnowledgeExecutionOwner();
  const RuntimeConstructor = KnowledgeRuntimeForwardRevisionValidationPort as unknown as new (
    responses: unknown[],
    owner: KnowledgeExecutionOwner
  ) => KnowledgeRuntimeForwardRevisionValidationPort;
  const runtime = new RuntimeConstructor(
    options?.runtimeResponses ?? [before, after],
    options?.runtimeOwner ?? executionOwner
  );
  const prepared = createPreparation(manifest);
  const PlanConstructor = KnowledgeSourceExecutionPlan as unknown as new (config: {
    digests: string[];
    profile: unknown;
    preparations: unknown[];
    onPrepare?: () => void;
    executionOwner: KnowledgeExecutionOwner;
  }) => KnowledgeSourceExecutionPlan;
  const plan = new PlanConstructor({
    digests: options?.planDigests ?? [HASH_A],
    profile: prepared.profile,
    preparations: options?.preparations ?? [prepared.preparation],
    onPrepare: options?.onPrepare,
    executionOwner: options?.planOwner ?? executionOwner,
  });
  const ResolverConstructor = ObsidianKnowledgeCompilerTargetResolver as unknown as new (
    observations: unknown[],
    owner: KnowledgeExecutionOwner
  ) => ObsidianKnowledgeCompilerTargetResolver;
  const pages = options?.pages ?? [CURRENT_CONTENT, CURRENT_CONTENT];
  const resolver = new ResolverConstructor(
    pages.map((content) => ({
      targetId: proposal.proposalId,
      kind: "file",
      path: PAGE_PATH,
      content,
    })),
    options?.resolverOwner ?? executionOwner
  );
  return {
    proposal,
    proposalDigest,
    command,
    before,
    after,
    runtime,
    plan,
    resolver,
    executionOwner,
    coordinator: new KnowledgeProductionForwardRevisionValidationCoordinator(
      runtime,
      plan,
      resolver,
      executionOwner,
      options?.assertCurrent ?? (() => undefined)
    ),
  };
}

/** Expects one sanitized coordinator error with the supplied closed code. */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error("Expected coordinator failure");
  } catch (error) {
    expect(KnowledgeForwardRevisionValidationCoordinatorError.inspect(error)).toBe(code);
  }
}

describe("KnowledgeProductionForwardRevisionValidationCoordinator", () => {
  it("mints a frozen genuine capability only after the full read-only sandwich", async () => {
    const fixture = createFixture();

    const result = await fixture.coordinator.validate(
      {
        proposal: fixture.proposal,
        proposalDigest: fixture.proposalDigest,
        command: fixture.command,
      },
      new AbortController().signal
    );

    expect(result.kind).toBe("validated");
    if (result.kind !== "validated") throw new Error("Expected validated result");
    expect(() =>
      KnowledgeForwardRevisionValidationCapability.assert(result.capability)
    ).not.toThrow();
    expect(() =>
      KnowledgeForwardRevisionValidationCapability.assertExecutionOwner(
        result.capability,
        fixture.executionOwner
      )
    ).not.toThrow();
    const projection = KnowledgeForwardRevisionValidationCapability.project(result.capability);
    expect(projection).toMatchObject({
      proposalDigest: fixture.proposalDigest,
      commandDigest: projection.receipt.commandDigest,
      afterContent: HISTORICAL_CONTENT,
      acceptedAfterHash: createFileContentHash(HISTORICAL_CONTENT),
      candidate: {
        kind: "forward_revision_validated_candidate",
        pagePath: PAGE_PATH,
        change: {
          operation: "update",
          beforeHash: createFileContentHash(CURRENT_CONTENT),
          afterContent: HISTORICAL_CONTENT,
        },
        citations: [{ citationId: "citation-1" }],
      },
      receipt: {
        acceptedAfterHash: createFileContentHash(HISTORICAL_CONTENT),
        validatedAt: 125,
      },
      beforeAuthorityDigest: fixture.before.authorityDigest,
      afterAuthorityDigest: fixture.after.authorityDigest,
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect((fixture.runtime as unknown as MockRuntimePort).calls).toHaveLength(2);
    expect((fixture.plan as unknown as MockPlan).prepareCalls).toHaveLength(2);
    expect((fixture.resolver as unknown as MockResolver).calls).toHaveLength(2);
  });

  it("returns deterministic no_change without minting when edited bytes equal current", async () => {
    const fixture = createFixture({ commandContent: CURRENT_CONTENT });

    await expect(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        new AbortController().signal
      )
    ).resolves.toEqual({
      kind: "no_change",
      proposalId: fixture.proposal.proposalId,
      commandId: fixture.command.commandId,
      contentHash: createFileContentHash(CURRENT_CONTENT),
    });
    expect((fixture.plan as unknown as MockPlan).prepareCalls).toHaveLength(0);
    expect((fixture.resolver as unknown as MockResolver).calls).toHaveLength(2);
  });

  it("fails closed when the Wiki page changes during deterministic validation", async () => {
    const fixture = createFixture({ pages: [CURRENT_CONTENT, EDITED_CONTENT] });

    await expectCode(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        new AbortController().signal
      ),
      "page_stale"
    );
    expect((fixture.runtime as unknown as MockRuntimePort).calls).toHaveLength(1);
  });

  it("fails closed when source parser material changes during validation", async () => {
    const manifest = createManifest();
    const first = createPreparation(manifest).preparation;
    const changedText = `${SOURCE_TEXT} changed`;
    const second = {
      ...first,
      artifacts: [
        {
          ...first.artifacts[0],
          artifactContentHash: createFileContentHash(changedText),
          text: changedText,
        },
      ],
    };
    const fixture = createFixture({ preparations: [first, second] });

    await expectCode(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        new AbortController().signal
      ),
      "source_stale"
    );
    expect((fixture.runtime as unknown as MockRuntimePort).calls).toHaveLength(1);
    expect((fixture.plan as unknown as MockPlan).prepareCalls).toHaveLength(2);
  });

  it("maps a page beyond the hard byte budget to resource_limit before validation", async () => {
    const fixture = createFixture({ pages: ["x".repeat(8_000_001)] });

    await expectCode(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        new AbortController().signal
      ),
      "resource_limit"
    );
    expect((fixture.plan as unknown as MockPlan).prepareCalls).toHaveLength(0);
  });

  it("rejects a historical locator that no longer resolves against fresh parser material", async () => {
    const preparation = createPreparation(createManifest()).preparation;
    const mismatched = {
      ...preparation,
      artifacts: [
        {
          ...preparation.artifacts[0],
          artifactId: "artifact-current-other",
        },
      ],
    };
    const fixture = createFixture({ preparations: [mismatched, mismatched] });

    await expectCode(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        new AbortController().signal
      ),
      "validation_failed"
    );
    expect((fixture.runtime as unknown as MockRuntimePort).calls).toHaveLength(1);
    expect((fixture.resolver as unknown as MockResolver).calls).toHaveLength(1);
  });

  it.each([
    ["missing OKF frontmatter", "# Not an OKF concept\n"],
    ["unsupported Wiki link", EDITED_CONTENT + "\n[[Other page]]\n"],
  ])("rejects %s through the pure document validator", async (_name, afterContent) => {
    const fixture = createFixture({ commandContent: afterContent });

    await expectCode(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        new AbortController().signal
      ),
      "validation_failed"
    );
    expect((fixture.runtime as unknown as MockRuntimePort).calls).toHaveLength(1);
    expect((fixture.resolver as unknown as MockResolver).calls).toHaveLength(1);
  });

  it("rejects an authority loss or workflow-generation drift after validation", async () => {
    const authorityLost = createFixture({ runtimeResponses: [] });
    const lostRuntime = authorityLost.runtime as unknown as { readonly calls: unknown[] };
    void lostRuntime;
    await expectCode(
      authorityLost.coordinator.validate(
        {
          proposal: authorityLost.proposal,
          proposalDigest: authorityLost.proposalDigest,
          command: authorityLost.command,
        },
        new AbortController().signal
      ),
      "authority_unavailable"
    );

    const generationDrift = createFixture({ planDigests: [HASH_A, HASH_B] });
    await expectCode(
      generationDrift.coordinator.validate(
        {
          proposal: generationDrift.proposal,
          proposalDigest: generationDrift.proposalDigest,
          command: generationDrift.command,
        },
        new AbortController().signal
      ),
      "source_stale"
    );
  });

  it("rejects a changed Runtime digest when the sandwich revision did not advance", async () => {
    const fixture = createFixture({ sameRevisionDigestDrift: true });

    await expectCode(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        new AbortController().signal
      ),
      "authority_changed"
    );
  });

  it("rejects Runtime, workflow-plan, and Vault readers from any alternate owner", () => {
    for (const key of ["runtimeOwner", "planOwner", "resolverOwner"] as const) {
      expect(() => createFixture({ [key]: createKnowledgeExecutionOwner() })).toThrow();
    }
  });

  it("authenticates only the exact live coordinator and its execution owner", () => {
    let current = true;
    const fixture = createFixture({
      assertCurrent: () => {
        if (!current) throw new DOMException("stale", "AbortError");
      },
    });

    expect(() =>
      KnowledgeProductionForwardRevisionValidationCoordinator.assertExecutionOwner(
        fixture.coordinator,
        fixture.executionOwner
      )
    ).not.toThrow();
    expect(() =>
      KnowledgeProductionForwardRevisionValidationCoordinator.assertExecutionOwner(
        fixture.coordinator,
        createKnowledgeExecutionOwner()
      )
    ).toThrow();
    expect(() =>
      KnowledgeProductionForwardRevisionValidationCoordinator.assertExecutionOwner(
        new Proxy(fixture.coordinator, {}),
        fixture.executionOwner
      )
    ).toThrow();

    current = false;
    expect(() =>
      KnowledgeProductionForwardRevisionValidationCoordinator.assertExecutionOwner(
        fixture.coordinator,
        fixture.executionOwner
      )
    ).toThrow();
  });

  it("revokes a minted capability with its exact workflow generation", async () => {
    let current = true;
    const fixture = createFixture({
      assertCurrent: () => {
        if (!current) throw new DOMException("stale", "AbortError");
      },
    });
    const result = await fixture.coordinator.validate(
      {
        proposal: fixture.proposal,
        proposalDigest: fixture.proposalDigest,
        command: fixture.command,
      },
      new AbortController().signal
    );
    if (result.kind !== "validated") throw new Error("Expected validated result");

    current = false;
    expect(() => KnowledgeForwardRevisionValidationCapability.assert(result.capability)).toThrow();
    expect(() => KnowledgeForwardRevisionValidationCapability.project(result.capability)).toThrow();
    expect(() =>
      KnowledgeForwardRevisionValidationCapability.assertExecutionOwner(
        result.capability,
        fixture.executionOwner
      )
    ).toThrow();
  });

  it("rejects hostile request accessors without invoking them and honors pre-abort", async () => {
    const fixture = createFixture();
    let getterCalls = 0;
    const hostile = {
      get proposal() {
        getterCalls += 1;
        return fixture.proposal;
      },
      proposalDigest: fixture.proposalDigest,
      command: fixture.command,
    };
    await expectCode(
      fixture.coordinator.validate(hostile, new AbortController().signal),
      "request_invalid"
    );
    expect(getterCalls).toBe(0);
    expect((fixture.runtime as unknown as MockRuntimePort).calls).toHaveLength(0);

    const controller = new AbortController();
    controller.abort("private abort reason");
    await expectCode(
      fixture.coordinator.validate(
        {
          proposal: fixture.proposal,
          proposalDigest: fixture.proposalDigest,
          command: fixture.command,
        },
        controller.signal
      ),
      "aborted"
    );
  });

  it("rejects forged, wrapped, proxied, and exact-prototype capability shapes", async () => {
    const fixture = createFixture();
    const result = await fixture.coordinator.validate(
      {
        proposal: fixture.proposal,
        proposalDigest: fixture.proposalDigest,
        command: fixture.command,
      },
      new AbortController().signal
    );
    if (result.kind !== "validated") throw new Error("Expected validated result");
    const alternateOwner = createKnowledgeExecutionOwner();
    expect(() =>
      KnowledgeForwardRevisionValidationCapability.assertExecutionOwner(
        result.capability,
        alternateOwner
      )
    ).toThrow();

    for (const forged of [
      {},
      Object.create(KnowledgeForwardRevisionValidationCapability.prototype),
      new Proxy(result.capability, {}),
    ]) {
      expect(() => KnowledgeForwardRevisionValidationCapability.assert(forged)).toThrow();
      expect(() => KnowledgeForwardRevisionValidationCapability.project(forged)).toThrow();
    }

    const revokedCapability = Proxy.revocable(result.capability, {});
    revokedCapability.revoke();
    for (const operation of [
      () => KnowledgeForwardRevisionValidationCapability.assert(revokedCapability.proxy),
      () => KnowledgeForwardRevisionValidationCapability.project(revokedCapability.proxy),
    ]) {
      try {
        operation();
        throw new Error("Expected revoked capability rejection");
      } catch (error) {
        expect(KnowledgeForwardRevisionValidationCoordinatorError.inspect(error)).toBe(
          "dependency_invalid"
        );
      }
    }
  });

  it("rejects copied, proxied, and subclassed coordinator receivers", async () => {
    const fixture = createFixture();
    const request = {
      proposal: fixture.proposal,
      proposalDigest: fixture.proposalDigest,
      command: fixture.command,
    };
    class CoordinatorSubclass extends KnowledgeProductionForwardRevisionValidationCoordinator {}
    const subclass = new CoordinatorSubclass(
      fixture.runtime,
      fixture.plan,
      fixture.resolver,
      fixture.executionOwner,
      () => undefined
    );
    for (const value of [
      Object.create(KnowledgeProductionForwardRevisionValidationCoordinator.prototype),
      new Proxy(fixture.coordinator, {}),
      subclass,
    ]) {
      await expectCode(
        (value as KnowledgeProductionForwardRevisionValidationCoordinator).validate(
          request,
          new AbortController().signal
        ),
        "dependency_invalid"
      );
    }

    const validate = KnowledgeProductionForwardRevisionValidationCoordinator.prototype.validate;
    const revokedCoordinator = Proxy.revocable(fixture.coordinator, {});
    revokedCoordinator.revoke();
    await expectCode(
      Reflect.apply(validate, revokedCoordinator.proxy, [request, new AbortController().signal]),
      "dependency_invalid"
    );
  });
});
