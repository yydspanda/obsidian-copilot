import { createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation } from "@/knowledge/model/types";
import type {
  KnowledgeRuntimeAppliedPageProvenance,
  KnowledgeRuntimeAppliedSourceProvenance,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KnowledgeAppliedWikiPageInspectionProjector,
  type KnowledgeAppliedWikiPageProjectionAuthority,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageProjector";
import { KnowledgeAppliedWikiPageInspectorError } from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";

const PAGE_HASH = "a".repeat(64);
const PIPELINE_HASH = "b".repeat(64);

/** Creates one exact valid citation for a contributing Source artifact. */
function createCitation(sourceId: string, sourceContentHash: string, index = 1): ClaimCitation {
  const excerpt = `Evidence ${index}`;
  return {
    citationId: `citation-${sourceId}-${index}`,
    claimId: `claim-${sourceId}-${index}`,
    relation: "supports",
    locator: {
      kind: "markdown_lines",
      sourceId,
      artifactId: `artifact-${sourceId}`,
      artifactContentHash: sourceContentHash,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
      startLine: index,
      endLine: index,
      heading: "Evidence",
    },
  };
}

/** Creates one valid applied contributing-Source authority. */
function createSource(index = 1): KnowledgeRuntimeAppliedSourceProvenance {
  const sourceId = `source-${index}`;
  const sourceContentHash = index.toString(16).padStart(64, "0");
  return {
    sourceId,
    sourcePath: `Sources/Source ${index}.md`,
    custody: "user_managed",
    sourceContentHash,
    pipelineFingerprint: PIPELINE_HASH,
    inputRevision: index,
    changeSetId: `changeset-${index}`,
    changeSetDigest: (index + 100).toString(16).padStart(64, "0"),
    acceptedAt: index,
    citations: [createCitation(sourceId, sourceContentHash, index)],
  };
}

/** Creates one valid stable page authority accepted by the projector. */
function createAuthority(
  sources: readonly Readonly<KnowledgeRuntimeAppliedSourceProvenance>[] = [createSource()],
  overrides: Partial<KnowledgeRuntimeAppliedPageProvenance> = {}
): KnowledgeAppliedWikiPageProjectionAuthority {
  const page: KnowledgeRuntimeAppliedPageProvenance = {
    path: "Wiki/Applied.md",
    windowsPathKey: "wiki/applied.md",
    ownership: "generated",
    sourceAppliedContentHash: PAGE_HASH,
    effectiveContentHash: PAGE_HASH,
    contentHash: PAGE_HASH,
    origin: { kind: "source_apply" },
    sources,
    ...overrides,
  };
  return { bundleId: "personal", runtimeRevision: 8, manifestRevision: 5, page };
}

describe("KnowledgeAppliedWikiPageInspectionProjector", () => {
  it("emits a bounded deeply frozen display session without actionable authority", () => {
    const source = createSource();
    const projector = new KnowledgeAppliedWikiPageInspectionProjector();

    const session = projector.project(createAuthority([source]));

    expect(session.displayPagePath).toBe("Wiki/Applied.md");
    expect(session.ownership).toBe("generated");
    expect(session).toMatchObject({
      sourceAppliedContentHash: PAGE_HASH,
      effectiveContentHash: PAGE_HASH,
      origin: { kind: "source_apply" },
      evidenceScope: "source_applied_content",
    });
    expect(session.sources[0]).toMatchObject({
      displaySourcePath: source.sourcePath,
      custody: "user_managed",
      acceptedAt: 1,
      omittedEvidenceCount: 0,
    });
    expect(session.sources[0].evidence[0]).toMatchObject({
      relation: "supports",
      excerpt: "Evidence 1",
      location: { kind: "markdown_lines", startLine: 1, endLine: 1 },
    });
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain("personal");
    expect(serialized).toContain(PAGE_HASH);
    expect(serialized).not.toContain(source.sourceContentHash);
    expect(serialized).not.toContain(source.sourceId);
    expect(serialized).not.toContain("artifact-source-1");
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.sources)).toBe(true);
    expect(Object.isFrozen(session.sources[0])).toBe(true);
    expect(Object.isFrozen(session.sources[0].evidence)).toBe(true);
    expect(Object.isFrozen(session.sources[0].evidence[0].location)).toBe(true);

    const evidence = session.sources[0].evidence[0];
    expect(projector.resolveEvidence(session, evidence.evidenceRef)).toMatchObject({
      bundleId: "personal",
      pageContentHash: PAGE_HASH,
      sourceId: source.sourceId,
      sourceContentHash: source.sourceContentHash,
      citation: source.citations[0],
    });
    expect(
      projector.resolveEvidence(
        Object.freeze({ ...session, sources: session.sources }),
        evidence.evidenceRef
      )
    ).toBeUndefined();
  });

  it("discloses a forward effective head without recasting Source citations as manual proof", () => {
    const source = createSource();
    const effectiveContentHash = "f".repeat(64);
    const projector = new KnowledgeAppliedWikiPageInspectionProjector();

    const session = projector.project(
      createAuthority([source], {
        effectiveContentHash,
        contentHash: effectiveContentHash,
        origin: {
          kind: "forward_revision",
          overlay: {
            version: 2,
            kind: "forward_revision_overlay_entry",
            bundleId: "personal",
            pagePath: "Wiki/Applied.md",
            windowsPathKey: "wiki/applied.md",
            sourceId: source.sourceId,
            sourceBaseDigest: "1".repeat(64),
            sourceAppliedContentHash: PAGE_HASH,
            previousEffectiveContentHash: PAGE_HASH,
            effectiveContentHash,
            forwardTransactionId: "forward-1",
            acceptedDecisionDigest: "2".repeat(64),
            forwardLedgerIdentityDigest: "3".repeat(64),
            appliedAt: 20,
          },
        },
      })
    );

    expect(session).toMatchObject({
      sourceAppliedContentHash: PAGE_HASH,
      effectiveContentHash,
      origin: {
        kind: "forward_revision",
        overlay: {
          sourceAppliedContentHash: PAGE_HASH,
          previousEffectiveContentHash: PAGE_HASH,
          effectiveContentHash,
        },
      },
      evidenceScope: "source_applied_content",
      sources: [{ evidence: [{ excerpt: "Evidence 1" }] }],
    });
    const evidence = session.sources[0].evidence[0];
    expect(projector.resolveEvidence(session, evidence.evidenceRef)).toMatchObject({
      pageContentHash: effectiveContentHash,
      sourceContentHash: source.sourceContentHash,
      citation: source.citations[0],
    });
  });

  it("validates every hidden Source and citation before applying display caps", () => {
    const sources = Array.from({ length: 17 }, (_, index) => createSource(index + 1));
    const invalidLast = sources[16];
    sources[16] = {
      ...invalidLast,
      citations: [
        {
          ...invalidLast.citations[0],
          locator: { ...invalidLast.citations[0].locator, sourceId: "wrong-source" },
        },
      ],
    };
    const projector = new KnowledgeAppliedWikiPageInspectionProjector();

    expect(() => projector.project(createAuthority(sources))).toThrow(
      KnowledgeAppliedWikiPageInspectorError
    );
  });

  it("rejects artifact-hash mismatches before minting an evidence capability", () => {
    const source = createSource();
    const invalid = {
      ...source,
      citations: [
        {
          ...source.citations[0],
          locator: {
            ...source.citations[0].locator,
            artifactContentHash: "f".repeat(64),
          },
        },
      ],
    };

    expect(() =>
      new KnowledgeAppliedWikiPageInspectionProjector().project(createAuthority([invalid]))
    ).toThrow(KnowledgeAppliedWikiPageInspectorError);
  });

  it("rejects accessor authorities without invoking their getters", () => {
    let getterCalls = 0;
    const authority = createAuthority() as KnowledgeAppliedWikiPageProjectionAuthority & {
      leaked?: string;
    };
    Object.defineProperty(authority, "page", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return createAuthority().page;
      },
    });

    expect(() => new KnowledgeAppliedWikiPageInspectionProjector().project(authority)).toThrow(
      KnowledgeAppliedWikiPageInspectorError
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects accessor array entries without invoking them", () => {
    let getterCalls = 0;
    const sources: KnowledgeRuntimeAppliedSourceProvenance[] = [];
    Object.defineProperty(sources, "0", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterCalls += 1;
        return createSource();
      },
    });
    Object.defineProperty(sources, "length", { value: 1 });

    expect(() =>
      new KnowledgeAppliedWikiPageInspectionProjector().project(createAuthority(sources))
    ).toThrow(KnowledgeAppliedWikiPageInspectorError);
    expect(getterCalls).toBe(0);
  });

  it("caps Sources and evidence globally while reporting omissions per Source", () => {
    const sources = Array.from({ length: 17 }, (_, index) => {
      const source = createSource(index + 1);
      return {
        ...source,
        citations: Array.from({ length: 5 }, (_unused, citationIndex) =>
          createCitation(source.sourceId, source.sourceContentHash, citationIndex + 1)
        ),
      };
    });

    const session = new KnowledgeAppliedWikiPageInspectionProjector().project(
      createAuthority(sources)
    );

    expect(session.sources).toHaveLength(16);
    expect(session.omittedSourceCount).toBe(1);
    expect(session.sources.flatMap((source) => source.evidence)).toHaveLength(64);
    expect(session.sources[12].omittedEvidenceCount).toBe(1);
    expect(session.sources[13].omittedEvidenceCount).toBe(5);
  });

  it("accepts exactly 8,192 citations and rejects the next citation", () => {
    const first = createSource(1);
    const second = createSource(2);
    const exact = [first, second].map((source) => ({
      ...source,
      citations: Array.from({ length: 4_096 }, (_unused, index) =>
        createCitation(source.sourceId, source.sourceContentHash, index + 1)
      ),
    }));
    const projector = new KnowledgeAppliedWikiPageInspectionProjector();

    const session = projector.project(createAuthority(exact));

    expect(session.sources.flatMap((source) => source.evidence)).toHaveLength(64);
    expect(() => projector.project(createAuthority([...exact, createSource(3)]))).toThrow(
      KnowledgeAppliedWikiPageInspectorError
    );
  });

  it("keeps heterogeneous citation identity aligned across the global 64-item cutoff", () => {
    const first = createSource(1);
    const firstCitations = Array.from({ length: 63 }, (_unused, index) => {
      const citation = createCitation(first.sourceId, first.sourceContentHash, index + 1);
      const base = citation.locator;
      const common = {
        sourceId: base.sourceId,
        artifactId: base.artifactId,
        artifactContentHash: base.artifactContentHash,
        excerpt: base.excerpt,
        quoteHash: base.quoteHash,
      };
      if (index % 3 === 0) {
        return {
          ...citation,
          locator: {
            ...common,
            kind: "heading" as const,
            heading: `Heading ${index}`,
            occurrence: 1,
          },
        };
      }
      if (index % 3 === 1) {
        return {
          ...citation,
          locator: { ...common, kind: "quote" as const, prefix: "before", suffix: "after" },
        };
      }
      return citation;
    });
    const second = createSource(2);
    const secondCitations = [
      createCitation(second.sourceId, second.sourceContentHash, 101),
      createCitation(second.sourceId, second.sourceContentHash, 102),
    ];
    const projector = new KnowledgeAppliedWikiPageInspectionProjector();

    const session = projector.project(
      createAuthority([
        { ...first, citations: firstCitations },
        { ...second, citations: secondCitations },
      ])
    );

    expect(session.sources[0].evidence).toHaveLength(63);
    expect(session.sources[1].evidence).toHaveLength(1);
    expect(session.sources[1].omittedEvidenceCount).toBe(1);
    const boundaryEvidence = session.sources[1].evidence[0];
    expect(projector.resolveEvidence(session, boundaryEvidence.evidenceRef)).toMatchObject({
      sourceId: second.sourceId,
      citation: { citationId: secondCitations[0].citationId },
    });
  });

  it("rejects an oversized hidden citation beyond the display cutoff", () => {
    const source = createSource();
    const citations = Array.from({ length: 65 }, (_unused, index) =>
      createCitation(source.sourceId, source.sourceContentHash, index + 1)
    );
    citations[64] = {
      ...citations[64],
      locator: {
        ...citations[64].locator,
        excerpt: "x".repeat(2_000_001),
      },
    };

    expect(() =>
      new KnowledgeAppliedWikiPageInspectionProjector().project(
        createAuthority([{ ...source, citations }])
      )
    ).toThrow(KnowledgeAppliedWikiPageInspectorError);
  });

  it.each(["citationId", "heading", "prefix"] as const)(
    "rejects a non-string %s value without invoking its length getter",
    (field) => {
      let getterCalls = 0;
      const hostileText = {};
      Object.defineProperty(hostileText, "length", {
        get: () => {
          getterCalls += 1;
          return 1;
        },
      });
      const source = createSource();
      const citation = createCitation(source.sourceId, source.sourceContentHash);
      let hostile: unknown;
      if (field === "citationId") {
        hostile = { ...citation, citationId: hostileText };
      } else if (field === "heading") {
        const locator = citation.locator;
        hostile = {
          ...citation,
          locator: {
            kind: "heading",
            sourceId: locator.sourceId,
            artifactId: locator.artifactId,
            artifactContentHash: locator.artifactContentHash,
            excerpt: locator.excerpt,
            quoteHash: locator.quoteHash,
            heading: hostileText,
            occurrence: 1,
          },
        };
      } else {
        const locator = citation.locator;
        hostile = {
          ...citation,
          locator: {
            kind: "quote",
            sourceId: locator.sourceId,
            artifactId: locator.artifactId,
            artifactContentHash: locator.artifactContentHash,
            excerpt: locator.excerpt,
            quoteHash: locator.quoteHash,
            prefix: hostileText,
          },
        };
      }

      expect(() =>
        new KnowledgeAppliedWikiPageInspectionProjector().project(
          createAuthority([{ ...source, citations: [hostile as ClaimCitation] }])
        )
      ).toThrow(KnowledgeAppliedWikiPageInspectorError);
      expect(getterCalls).toBe(0);
    }
  );
});
