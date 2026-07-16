import {
  parseClaimCitation,
  parseKnowledgeBundleConfig,
  parseKnowledgeChangeSet,
  parseKnowledgeFileChange,
  parseKnowledgeIngestJob,
  parseOkfDocument,
  parseSourceLocator,
  parseSourceManifest,
} from "@/knowledge/model/schemas";
import type { KnowledgeParseResult } from "@/knowledge/model/types";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

type UnknownParser = (value: unknown) => KnowledgeParseResult<unknown>;

/**
 * Asserts that a runtime parser accepts a fixture without changing persisted data.
 *
 * @param parser - Public knowledge contract parser
 * @param fixture - Serializable fixture to parse
 */
function expectRoundTrip<T>(
  parser: (value: unknown) => KnowledgeParseResult<T>,
  fixture: unknown
): void {
  const result = parser(fixture);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(fixture);
  }
}

/**
 * Asserts that a runtime parser rejects an invalid fixture.
 *
 * @param parser - Public knowledge contract parser
 * @param fixture - Invalid fixture to parse
 */
function expectRejected<T>(
  parser: (value: unknown) => KnowledgeParseResult<T>,
  fixture: unknown
): void {
  const result = parser(fixture);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.severity === "error")).toBe(true);
  }
}

/** Creates fields shared by all source locator fixtures. */
function createLocatorBase() {
  return {
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: SHA_A,
    excerpt: "A source-backed excerpt.",
    quoteHash: SHA_B,
  };
}

/** Creates a representative Markdown line locator fixture. */
function createMarkdownLocator() {
  return {
    ...createLocatorBase(),
    kind: "markdown_lines",
    startLine: 4,
    endLine: 7,
    heading: "Architecture",
  };
}

/** Creates a representative claim citation fixture. */
function createCitation() {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: createMarkdownLocator(),
  };
}

/** Creates fields shared by all durable ingest job fixtures. */
function createJobBase() {
  return {
    id: "job-1",
    bundleId: "bundle-1",
    sourceId: "source-1",
    sourceContentHash: SHA_A,
    pipelineFingerprint: SHA_B,
    attempt: 0,
    rerunRequested: false,
    createdAt: 100,
    updatedAt: 110,
  };
}

/** Creates fields shared by all file change fixtures. */
function createFileChangeBase() {
  return {
    id: "change-1",
    path: "Wiki/Concepts/Contract.md",
    sourceRefs: ["source-1"],
    reason: "Compile a source-backed concept page.",
  };
}

/** Creates a complete persisted source manifest fixture. */
function createManifest() {
  return {
    version: 1,
    bundleId: "bundle-1",
    revision: 3,
    entries: [
      {
        sourceId: "source-1",
        sourceKey: "notes/design.md",
        sourcePath: "Notes/Design.md",
        custody: "user_managed",
        lastSuccessful: {
          sourceContentHash: SHA_A,
          pipelineFingerprint: SHA_B,
          generatedPages: [
            {
              path: "Wiki/Concepts/Design.md",
              ownership: "generated",
              contentHash: SHA_C,
            },
          ],
          changeSetId: "changeset-1",
          completedAt: 120,
        },
        lastFailure: {
          sourceContentHash: SHA_C,
          pipelineFingerprint: SHA_B,
          failure: {
            code: "provider_timeout",
            message: "The provider timed out.",
            retryable: true,
            occurredAt: 130,
          },
        },
        extensions: {
          importer: "markdown",
          options: { preserveHeadings: true },
        },
      },
    ],
    extensions: {
      owner: "personal",
      generation: 3,
    },
  };
}

/** Creates a valid multi-operation knowledge ChangeSet fixture. */
function createChangeSet() {
  return {
    id: "changeset-1",
    bundleId: "bundle-1",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes: [
      {
        ...createFileChangeBase(),
        operation: "create",
        expectedAbsent: true,
        afterContent: "# Contract\n",
        afterHash: SHA_A,
      },
      {
        ...createFileChangeBase(),
        id: "change-2",
        path: "Wiki/index.md",
        operation: "update",
        beforeHash: SHA_B,
        afterContent: "- [[Concepts/Contract]]\n",
        afterHash: SHA_C,
      },
    ],
    citations: [createCitation()],
    validation: {
      okfValid: true,
      citationsValid: true,
      linksValid: true,
    },
    status: "proposed",
    createdAt: 140,
  };
}

describe("knowledge contract schemas", () => {
  describe("valid persisted contracts", () => {
    it("round-trips a bundle configuration", () => {
      const bundle = {
        version: 1,
        id: "bundle-1",
        sourceRoots: ["Sources", "Imported Notes"],
        wikiRoot: "Wiki",
        schemaRef: "Schemas/personal-knowledge.json",
        reviewMode: "multi_file",
      };

      expectRoundTrip(parseKnowledgeBundleConfig, bundle);
    });

    it("round-trips a source manifest with success, failure, and extensions", () => {
      expectRoundTrip(parseSourceManifest, createManifest());
    });

    it.each([
      ["Markdown lines", createMarkdownLocator()],
      [
        "heading",
        {
          ...createLocatorBase(),
          kind: "heading",
          heading: "Architecture",
          occurrence: 2,
        },
      ],
      ["PDF page", { ...createLocatorBase(), kind: "pdf_page", page: 9 }],
      [
        "quote",
        {
          ...createLocatorBase(),
          kind: "quote",
          prefix: "before",
          suffix: "after",
        },
      ],
    ])("round-trips a %s locator", (_name, locator) => {
      expectRoundTrip(parseSourceLocator, locator);
    });

    it("round-trips a claim citation", () => {
      expectRoundTrip(parseClaimCitation, createCitation());
    });

    it.each([
      [
        "pending",
        {
          ...createJobBase(),
          status: "pending",
          stage: "queued",
          nextAttemptAt: 200,
        },
      ],
      [
        "processing",
        {
          ...createJobBase(),
          status: "processing",
          stage: "analyzing",
          startedAt: 120,
        },
      ],
      [
        "paused",
        {
          ...createJobBase(),
          status: "paused",
          stage: "generating",
          pausedAt: 125,
          reason: "Provider is offline.",
        },
      ],
      [
        "awaiting review",
        {
          ...createJobBase(),
          status: "awaiting_review",
          stage: "review",
          changeSetId: "changeset-1",
        },
      ],
      [
        "failed",
        {
          ...createJobBase(),
          status: "failed",
          stage: "review",
          failure: {
            code: "review_conflict",
            message: "The generated file changed before approval.",
            retryable: true,
            occurredAt: 130,
          },
        },
      ],
      [
        "completed",
        {
          ...createJobBase(),
          status: "completed",
          stage: "completed",
          changeSetId: "changeset-1",
          completedAt: 140,
        },
      ],
      [
        "cancelled",
        {
          ...createJobBase(),
          status: "cancelled",
          stage: "cancelled",
          cancelledAt: 135,
        },
      ],
    ])("round-trips a %s ingest job", (_name, job) => {
      expectRoundTrip(parseKnowledgeIngestJob, job);
    });

    it.each([
      [
        "create",
        {
          ...createFileChangeBase(),
          operation: "create",
          expectedAbsent: true,
          afterContent: "# Contract\n",
          afterHash: SHA_A,
        },
      ],
      [
        "update",
        {
          ...createFileChangeBase(),
          operation: "update",
          beforeHash: SHA_A,
          afterContent: "# Updated Contract\n",
          afterHash: SHA_B,
        },
      ],
      [
        "delete",
        {
          ...createFileChangeBase(),
          operation: "delete",
          beforeHash: SHA_A,
        },
      ],
    ])("round-trips a %s file change", (_name, change) => {
      expectRoundTrip(parseKnowledgeFileChange, change);
    });

    it("round-trips a ChangeSet", () => {
      expectRoundTrip(parseKnowledgeChangeSet, createChangeSet());
    });

    it("round-trips an OKF concept and preserves arbitrary JSON extensions", () => {
      const extensions = {
        text: "custom value",
        count: 3.5,
        enabled: true,
        empty: null,
        nested: {
          list: ["one", 2, false, null, { deeplyNested: [1, 2, 3] }],
        },
      };
      const concept = {
        kind: "concept",
        path: "Concepts/Contract.md",
        body: "# Contract\n",
        type: "concept",
        title: "Contract",
        description: "A persisted knowledge contract.",
        resource: "Sources/Design.md",
        tags: ["architecture", "knowledge"],
        timestamp: "2026-07-16T10:00:00.000Z",
        extensions,
        citations: [createCitation()],
      };

      const result = parseOkfDocument(concept);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(concept);
        expect(result.value.kind).toBe("concept");
        if (result.value.kind === "concept") {
          expect(result.value.extensions).toEqual(extensions);
        }
      }
    });

    it.each([
      [
        "root index",
        {
          kind: "index",
          path: "index.md",
          body: "# Knowledge Bundle\n",
          okfVersion: "0.1",
        },
      ],
      ["nested index", { kind: "index", path: "Concepts/index.md", body: "# Concepts\n" }],
      ["log", { kind: "log", path: "log.md", body: "- Compiled source-1\n" }],
    ])("round-trips an OKF %s document", (_name, document) => {
      expectRoundTrip(parseOkfDocument, document);
    });
  });

  describe("strict objects and versions", () => {
    it.each<[string, UnknownParser, unknown]>([
      [
        "bundle",
        parseKnowledgeBundleConfig,
        {
          version: 1,
          id: "bundle-1",
          sourceRoots: ["Sources"],
          wikiRoot: "Wiki",
          schemaRef: "schema.json",
          reviewMode: "always",
          unexpected: true,
        },
      ],
      ["manifest", parseSourceManifest, { ...createManifest(), unexpected: true }],
      [
        "manifest entry",
        parseSourceManifest,
        {
          ...createManifest(),
          entries: [{ ...createManifest().entries[0], unexpected: true }],
        },
      ],
      ["locator", parseSourceLocator, { ...createMarkdownLocator(), unexpected: true }],
      ["citation", parseClaimCitation, { ...createCitation(), unexpected: true }],
      [
        "ingest job",
        parseKnowledgeIngestJob,
        {
          ...createJobBase(),
          status: "pending",
          stage: "queued",
          unexpected: true,
        },
      ],
      [
        "file change",
        parseKnowledgeFileChange,
        {
          ...createFileChangeBase(),
          operation: "delete",
          beforeHash: SHA_A,
          unexpected: true,
        },
      ],
      ["ChangeSet", parseKnowledgeChangeSet, { ...createChangeSet(), unexpected: true }],
      [
        "ChangeSet validation",
        parseKnowledgeChangeSet,
        {
          ...createChangeSet(),
          validation: { ...createChangeSet().validation, unexpected: true },
        },
      ],
      [
        "OKF concept",
        parseOkfDocument,
        {
          kind: "concept",
          path: "Concept.md",
          body: "# Concept\n",
          type: "concept",
          extensions: {},
          citations: [],
          unexpected: true,
        },
      ],
      [
        "OKF index",
        parseOkfDocument,
        { kind: "index", path: "index.md", body: "# Index\n", unexpected: true },
      ],
      [
        "OKF log",
        parseOkfDocument,
        { kind: "log", path: "log.md", body: "- Entry\n", unexpected: true },
      ],
    ])("rejects unknown fields on a strict %s object", (_name, parser, fixture) => {
      expectRejected(parser, fixture);
    });

    it.each<[string, UnknownParser, unknown]>([
      [
        "bundle version",
        parseKnowledgeBundleConfig,
        {
          version: 2,
          id: "bundle-1",
          sourceRoots: ["Sources"],
          wikiRoot: "Wiki",
          schemaRef: "schema.json",
          reviewMode: "always",
        },
      ],
      ["manifest version", parseSourceManifest, { ...createManifest(), version: 2 }],
      [
        "OKF version",
        parseOkfDocument,
        { kind: "index", path: "index.md", body: "# Index\n", okfVersion: "0.2" },
      ],
    ])("rejects an unknown %s", (_name, parser, fixture) => {
      expectRejected(parser, fixture);
    });
  });

  describe("SHA-256 fields", () => {
    it.each([
      ["uppercase", "A".repeat(64)],
      ["non-hex lowercase", "g".repeat(64)],
      ["short lowercase", "a".repeat(63)],
      ["prefixed", `sha256:${SHA_A}`],
    ])("rejects an %s SHA-256 value", (_name, invalidHash) => {
      expectRejected(parseSourceLocator, {
        ...createMarkdownLocator(),
        artifactContentHash: invalidHash,
      });
      expectRejected(parseSourceLocator, {
        ...createMarkdownLocator(),
        quoteHash: invalidHash,
      });
    });

    it("rejects invalid hashes in manifests and file changes", () => {
      const manifest = createManifest();

      expectRejected(parseSourceManifest, {
        ...manifest,
        entries: [
          {
            ...manifest.entries[0],
            lastSuccessful: {
              ...manifest.entries[0].lastSuccessful,
              sourceContentHash: "g".repeat(64),
            },
          },
        ],
      });
      expectRejected(parseKnowledgeFileChange, {
        ...createFileChangeBase(),
        operation: "update",
        beforeHash: SHA_A,
        afterContent: "updated",
        afterHash: "A".repeat(64),
      });
    });
  });

  describe("ingest job state machine", () => {
    it.each([
      ["pending work", { status: "pending", stage: "parsing", nextAttemptAt: 200 }],
      ["processing queue", { status: "processing", stage: "queued", startedAt: 120 }],
      ["processing review", { status: "processing", stage: "review", startedAt: 120 }],
      ["paused apply", { status: "paused", stage: "applying", pausedAt: 120 }],
      [
        "reviewing generation",
        { status: "awaiting_review", stage: "generating", changeSetId: "changeset-1" },
      ],
      [
        "completed review",
        {
          status: "completed",
          stage: "review",
          changeSetId: "changeset-1",
          completedAt: 140,
        },
      ],
      ["cancelled completion", { status: "cancelled", stage: "completed", cancelledAt: 140 }],
      [
        "failed completion",
        {
          status: "failed",
          stage: "completed",
          failure: {
            code: "failed",
            message: "Failed.",
            retryable: false,
            occurredAt: 140,
          },
        },
      ],
    ])("rejects the illegal %s state/stage combination", (_name, state) => {
      expectRejected(parseKnowledgeIngestJob, { ...createJobBase(), ...state });
    });

    it.each([
      ["negative attempt", { attempt: -1 }],
      ["fractional attempt", { attempt: 1.5 }],
      ["negative createdAt", { createdAt: -1 }],
      ["fractional updatedAt", { updatedAt: 110.5 }],
      ["negative nextAttemptAt", { nextAttemptAt: -1 }],
      ["fractional nextAttemptAt", { nextAttemptAt: 120.5 }],
    ])("rejects a pending job with %s", (_name, invalidField) => {
      expectRejected(parseKnowledgeIngestJob, {
        ...createJobBase(),
        status: "pending",
        stage: "queued",
        ...invalidField,
      });
    });

    it.each([
      ["negative startedAt", "processing", "parsing", "startedAt", -1],
      ["fractional startedAt", "processing", "parsing", "startedAt", 1.5],
      ["negative pausedAt", "paused", "parsing", "pausedAt", -1],
      ["fractional pausedAt", "paused", "parsing", "pausedAt", 1.5],
      ["negative completedAt", "completed", "completed", "completedAt", -1],
      ["fractional completedAt", "completed", "completed", "completedAt", 1.5],
      ["negative cancelledAt", "cancelled", "cancelled", "cancelledAt", -1],
      ["fractional cancelledAt", "cancelled", "cancelled", "cancelledAt", 1.5],
    ])("rejects a job with %s", (_name, status, stage, timeField, invalidTime) => {
      const stateSpecificFields: Record<string, unknown> = {
        [timeField]: invalidTime,
      };
      if (status === "completed") {
        stateSpecificFields.changeSetId = "changeset-1";
      }

      expectRejected(parseKnowledgeIngestJob, {
        ...createJobBase(),
        status,
        stage,
        ...stateSpecificFields,
      });
    });

    it.each([
      ["negative failure time", -1],
      ["fractional failure time", 10.5],
    ])("rejects a failed job with %s", (_name, occurredAt) => {
      expectRejected(parseKnowledgeIngestJob, {
        ...createJobBase(),
        status: "failed",
        stage: "queued",
        failure: {
          code: "failed",
          message: "Failed.",
          retryable: true,
          occurredAt,
        },
      });
    });
  });

  describe("locator numeric boundaries", () => {
    it.each([
      ["negative start line", { startLine: -1 }],
      ["zero start line", { startLine: 0 }],
      ["fractional start line", { startLine: 1.5 }],
      ["negative end line", { endLine: -1 }],
      ["zero end line", { endLine: 0 }],
      ["fractional end line", { endLine: 7.5 }],
    ])("rejects a Markdown locator with %s", (_name, invalidField) => {
      expectRejected(parseSourceLocator, { ...createMarkdownLocator(), ...invalidField });
    });

    it.each([
      ["negative occurrence", -1],
      ["zero occurrence", 0],
      ["fractional occurrence", 1.5],
    ])("rejects a heading locator with %s", (_name, occurrence) => {
      expectRejected(parseSourceLocator, {
        ...createLocatorBase(),
        kind: "heading",
        heading: "Architecture",
        occurrence,
      });
    });

    it.each([
      ["negative", -1],
      ["zero", 0],
      ["fractional", 1.5],
    ])("rejects a PDF locator with a %s page", (_name, page) => {
      expectRejected(parseSourceLocator, {
        ...createLocatorBase(),
        kind: "pdf_page",
        page,
      });
    });
  });

  describe("persisted integer times", () => {
    it.each([
      ["negative revision", { revision: -1 }],
      ["fractional revision", { revision: 1.5 }],
    ])("rejects a manifest with %s", (_name, invalidField) => {
      expectRejected(parseSourceManifest, { ...createManifest(), ...invalidField });
    });

    it.each([
      ["negative compile completion", -1],
      ["fractional compile completion", 1.5],
    ])("rejects a manifest with %s time", (_name, completedAt) => {
      const manifest = createManifest();

      expectRejected(parseSourceManifest, {
        ...manifest,
        entries: [
          {
            ...manifest.entries[0],
            lastSuccessful: {
              ...manifest.entries[0].lastSuccessful,
              completedAt,
            },
          },
        ],
      });
    });

    it.each([
      ["negative", -1],
      ["fractional", 1.5],
    ])("rejects a ChangeSet with a %s createdAt", (_name, createdAt) => {
      expectRejected(parseKnowledgeChangeSet, { ...createChangeSet(), createdAt });
    });
  });

  describe("file change compare-and-swap contracts", () => {
    it.each([
      [
        "create without expectedAbsent",
        {
          ...createFileChangeBase(),
          operation: "create",
          afterContent: "new",
          afterHash: SHA_A,
        },
      ],
      [
        "create without afterHash",
        {
          ...createFileChangeBase(),
          operation: "create",
          expectedAbsent: true,
          afterContent: "new",
        },
      ],
      [
        "update without beforeHash",
        {
          ...createFileChangeBase(),
          operation: "update",
          afterContent: "updated",
          afterHash: SHA_B,
        },
      ],
      [
        "update without afterHash",
        {
          ...createFileChangeBase(),
          operation: "update",
          beforeHash: SHA_A,
          afterContent: "updated",
        },
      ],
      [
        "delete without beforeHash",
        {
          ...createFileChangeBase(),
          operation: "delete",
        },
      ],
    ])("rejects %s", (_name, change) => {
      expectRejected(parseKnowledgeFileChange, change);
    });

    it("rejects false expectedAbsent instead of weakening create CAS", () => {
      expectRejected(parseKnowledgeFileChange, {
        ...createFileChangeBase(),
        operation: "create",
        expectedAbsent: false,
        afterContent: "new",
        afterHash: SHA_A,
      });
    });
  });
});
