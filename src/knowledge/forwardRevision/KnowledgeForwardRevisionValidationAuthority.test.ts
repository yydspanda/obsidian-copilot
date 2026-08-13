import {
  KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS,
  KnowledgeForwardRevisionValidationAuthorityValidationError,
  createKnowledgeForwardRevisionValidationAuthority,
  createKnowledgeForwardRevisionValidationAuthorityDigest,
  createKnowledgeForwardRevisionValidationAuthorityQuery,
  createKnowledgeForwardRevisionHistoricalCitationSetDigest,
  snapshotKnowledgeForwardRevisionHistoricalCitationSet,
  snapshotKnowledgeForwardRevisionValidationAuthority,
  snapshotKnowledgeForwardRevisionValidationAuthorityQuery,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationAuthority";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const HISTORICAL = "# Historical\n";
const CURRENT = "# Current\n";

/** Creates one strict pending proposal used by authority tests. */
function createProposal() {
  const historicalHash = createFileContentHash(HISTORICAL);
  const currentHash = createFileContentHash(CURRENT);
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
      inputRevision: 1,
      changeSetId: "changeset-historical",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 2,
      manifestAfterDigest: HASH_E,
      appliedAt: 90,
      selectedContentHash: historicalHash,
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
      inputRevision: 2,
      manifestRevision: 3,
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
        operation: "create",
        afterHash: historicalHash,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: "Wiki/Topic.md",
        ownership: "generated",
        contentHash: historicalHash,
      },
    },
    selectedContent: HISTORICAL,
    selectedContentHash: historicalHash,
    requestedAt: 100,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({ request, recordedAt: 100 });
}

/** Creates one exact Runtime-current acceptance tuple for the pending proposal. */
function createAcceptanceAuthority(proposal: ReturnType<typeof createProposal>) {
  return {
    runtimeId: "runtime-1",
    runtimeRevision: 11,
    runtimeDigest: HASH_E,
    manifestRevision: 3,
    manifestDigest: HASH_F,
    manifestBaseHash: proposal.request.intent.current.manifestBaseHash,
    vaultObservedBeforeHash: proposal.request.intent.current.vaultObservedBeforeHash,
    currentSourceFreshness: {
      kind: "applied" as const,
      runtimeId: "runtime-1",
      runtimeRevision: 11,
      runtimeDigest: HASH_E,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      manifestRevision: 3,
      manifestDigest: HASH_F,
      committedManifestRevision: 3,
      completedAt: 95,
      transactionId: "transaction-current",
      changeSetId: "changeset-current",
      changeSetDigest: HASH_D,
      manifestIntentDigest: HASH_C,
      committedManifestDigest: HASH_F,
    },
  };
}

/** Creates one valid citation whose artifact hash intentionally differs from source bytes. */
function createCitation() {
  const excerpt = "Exact historical evidence";
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports" as const,
    locator: {
      kind: "markdown_lines" as const,
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: HASH_D,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
      startLine: 1,
      endLine: 1,
    },
  };
}

/** Creates one strict authority for snapshot and hostile-input tests. */
function createAuthority(citations: unknown = [createCitation()]) {
  const proposal = createProposal();
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  const query = createKnowledgeForwardRevisionValidationAuthorityQuery({
    proposal,
    proposalDigest,
  });
  return createKnowledgeForwardRevisionValidationAuthority({
    query,
    proposal,
    proposalDigest,
    publishedRuntimeRevision: 10,
    proposalStoreRevision: 1,
    forwardReviewStoreRevision: 1,
    acceptanceAuthority: createAcceptanceAuthority(proposal),
    historicalAcceptedDigest: HASH_C,
    historicalSourceRefs: ["source-1"],
    historicalCitations: citations,
  });
}

/** Makes a mutable JSON clone for strict persisted-shape checks. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("KnowledgeForwardRevisionValidationAuthority", () => {
  it("derives a strict query and binds full citations into both digests", () => {
    const authority = createAuthority();

    expect(authority).toMatchObject({
      kind: "forward_revision_validation_authority",
      proposalRecordRevision: 0,
      publishedRuntimeRevision: 10,
      runtimeRevision: 11,
      historicalAcceptedDigest: HASH_C,
      historicalSourceRefs: ["source-1"],
      historicalCitations: [{ locator: { sourceId: "source-1", artifactContentHash: HASH_D } }],
    });
    expect(authority.acceptanceAuthority.vaultObservedBeforeHash).toBe(
      authority.proposal.request.intent.current.vaultObservedBeforeHash
    );
    expect(snapshotKnowledgeForwardRevisionValidationAuthority(authority)).toEqual(authority);
    expect(createKnowledgeForwardRevisionValidationAuthorityDigest(authority)).toBe(
      authority.authorityDigest
    );
    expect(
      createKnowledgeForwardRevisionHistoricalCitationSetDigest(
        authority.historicalCitations,
        "source-1"
      )
    ).toBe(authority.historicalCitationSetDigest);
    expect(
      snapshotKnowledgeForwardRevisionHistoricalCitationSet(
        authority.historicalCitations,
        "source-1"
      )
    ).toEqual(authority.historicalCitations);
    expect(Object.isFrozen(authority.historicalCitations[0].locator)).toBe(true);

    const changed = clone(authority);
    changed.historicalCitations[0].locator.artifactContentHash = HASH_A;
    expect(() => snapshotKnowledgeForwardRevisionValidationAuthority(changed)).toThrow(
      KnowledgeForwardRevisionValidationAuthorityValidationError
    );
  });

  it("allows no citations but rejects duplicate ids and the wrong source", () => {
    expect(createAuthority([]).historicalCitations).toEqual([]);
    expect(() => createAuthority([createCitation(), createCitation()])).toThrow(
      KnowledgeForwardRevisionValidationAuthorityValidationError
    );
    expect(() =>
      createAuthority([
        {
          ...createCitation(),
          locator: { ...createCitation().locator, sourceId: "source-2" },
        },
      ])
    ).toThrow(KnowledgeForwardRevisionValidationAuthorityValidationError);
  });

  it("stops at the aggregate citation budget without touching the next hostile element", () => {
    const oversized = {
      ...createCitation(),
      locator: {
        kind: "quote" as const,
        sourceId: "source-1",
        artifactId: "artifact-1",
        artifactContentHash: HASH_D,
        excerpt: "x".repeat(
          KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS.maxHistoricalCitationStringCharacters
        ),
        quoteHash: HASH_A,
        prefix: "y".repeat(
          KNOWLEDGE_FORWARD_REVISION_VALIDATION_AUTHORITY_LIMITS.maxHistoricalCitationStringCharacters
        ),
      },
    };
    let citationDescriptorReads = 0;
    let locatorTrapReads = 0;
    const hostileLocator = new Proxy(createCitation().locator, {
      getOwnPropertyDescriptor(target, key) {
        locatorTrapReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      getPrototypeOf(target) {
        locatorTrapReads += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    const hostileCitation = new Proxy(
      { ...createCitation(), locator: hostileLocator },
      {
        getOwnPropertyDescriptor(target, key) {
          citationDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }
    );

    expect(() =>
      snapshotKnowledgeForwardRevisionHistoricalCitationSet(
        [oversized, hostileCitation],
        "source-1"
      )
    ).toThrow(KnowledgeForwardRevisionValidationAuthorityValidationError);
    expect(citationDescriptorReads).toBe(0);
    expect(locatorTrapReads).toBe(0);
  });

  it("preserves exact historical control text but rejects invalid scalars and locators", () => {
    const excerpt = "exact\u0000historical\u0085material";
    const citation = {
      ...createCitation(),
      locator: {
        kind: "quote" as const,
        sourceId: "source-1",
        artifactId: "artifact-1",
        artifactContentHash: HASH_D,
        excerpt,
        quoteHash: createQuoteHash(excerpt),
        prefix: "prefix\u0001",
        suffix: "suffix\u007f",
      },
    };
    expect(snapshotKnowledgeForwardRevisionHistoricalCitationSet([citation], "source-1")).toEqual([
      citation,
    ]);
    expect(() =>
      snapshotKnowledgeForwardRevisionHistoricalCitationSet(
        [{ ...citation, locator: { ...citation.locator, excerpt: "invalid\ud800" } }],
        "source-1"
      )
    ).toThrow(KnowledgeForwardRevisionValidationAuthorityValidationError);
    expect(() =>
      snapshotKnowledgeForwardRevisionHistoricalCitationSet(
        [{ ...citation, locator: { ...citation.locator, quoteHash: HASH_B } }],
        "source-1"
      )
    ).toThrow(KnowledgeForwardRevisionValidationAuthorityValidationError);
  });

  it("rejects malformed standalone queries including noncanonical paths", () => {
    const query = createAuthority().query;
    expect(snapshotKnowledgeForwardRevisionValidationAuthorityQuery(query)).toEqual(query);
    for (const pagePath of ["Wiki//Topic.md", "Wiki/../Topic.md", `Wiki/${"x".repeat(1025)}`]) {
      expect(() =>
        snapshotKnowledgeForwardRevisionValidationAuthorityQuery({ ...query, pagePath })
      ).toThrow(KnowledgeForwardRevisionValidationAuthorityValidationError);
    }
  });

  it("never invokes citation or locator accessors before rejecting", () => {
    let citationReads = 0;
    const hostileCitation = { ...createCitation() } as Record<string, unknown>;
    Object.defineProperty(hostileCitation, "citationId", {
      enumerable: true,
      get: () => {
        citationReads += 1;
        return "citation-1";
      },
    });
    expect(() => createAuthority([hostileCitation])).toThrow(
      KnowledgeForwardRevisionValidationAuthorityValidationError
    );
    expect(citationReads).toBe(0);

    for (const field of ["heading", "prefix"] as const) {
      let locatorReads = 0;
      const locator: Record<string, unknown> =
        field === "heading"
          ? {
              ...createCitation().locator,
              heading: "Topic",
            }
          : {
              ...createCitation().locator,
              kind: "quote",
              prefix: "before",
            };
      Object.defineProperty(locator, field, {
        enumerable: true,
        get: () => {
          locatorReads += 1;
          return "hostile";
        },
      });
      expect(() => createAuthority([{ ...createCitation(), locator }])).toThrow(
        KnowledgeForwardRevisionValidationAuthorityValidationError
      );
      expect(locatorReads).toBe(0);
    }
  });

  it("requires a positive no-changes attempt and exact current tuple", () => {
    const authority = clone(createAuthority());
    const malformed = {
      ...authority,
      acceptanceAuthority: {
        ...authority.acceptanceAuthority,
        currentSourceFreshness: {
          kind: "no_changes",
          runtimeId: authority.runtimeId,
          runtimeRevision: authority.runtimeRevision,
          runtimeDigest: authority.runtimeDigest,
          bundleId: "personal",
          sourceId: "source-1",
          sourceContentHash: HASH_A,
          pipelineFingerprint: HASH_B,
          inputRevision: 2,
          manifestRevision: 3,
          manifestDigest: HASH_F,
          committedManifestRevision: 3,
          completedAt: 95,
          noChangesId: `knowledge-no-changes-${HASH_A}`,
          reason: "all_targets_unchanged",
          planDigest: HASH_C,
          jobId: "job-1",
          attempt: 0,
        },
      },
    };
    expect(() => snapshotKnowledgeForwardRevisionValidationAuthority(malformed)).toThrow(
      KnowledgeForwardRevisionValidationAuthorityValidationError
    );
  });

  it("enforces v2 publication and current Runtime revision causality", () => {
    const authority = clone(createAuthority());
    const cases = [
      { ...authority, proposalStoreRevision: 0 },
      { ...authority, proposalStoreRevision: 11, publishedRuntimeRevision: 10 },
      { ...authority, publishedRuntimeRevision: 12 },
      { ...authority, forwardReviewStoreRevision: 12 },
    ];
    for (const value of cases) {
      expect(() => snapshotKnowledgeForwardRevisionValidationAuthority(value)).toThrow(
        KnowledgeForwardRevisionValidationAuthorityValidationError
      );
    }
  });
});
