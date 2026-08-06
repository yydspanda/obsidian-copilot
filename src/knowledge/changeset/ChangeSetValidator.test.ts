import {
  ChangeSetValidationError,
  ChangeSetValidationInfrastructureError,
  ChangeSetValidator,
  ALL_KNOWLEDGE_FILE_MUTATIONS,
  createKnowledgeChangeSetDigest,
  type KnowledgeFileObservation,
  type KnowledgeFileMutationCapabilities,
  type KnowledgeFileStore,
  type KnowledgeProjectionValidationInput,
  type KnowledgeProjectionValidator,
  type SourceArtifactResolver,
} from "@/knowledge/changeset/ChangeSetValidator";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { TextArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type {
  ClaimCitation,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeFileChange,
  SourceLocator,
} from "@/knowledge/model/types";

const SOURCE_HASH = "a".repeat(64);

/** Creates the Windows-only Bundle used by transaction preflight tests. */
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

/** Creates a materially resolvable quote citation. */
function createCitation(excerpt = "Grounded evidence"): ClaimCitation {
  return {
    citationId: "citation-1",
    claimId: "claim-1",
    relation: "supports",
    locator: {
      kind: "quote",
      sourceId: "source-1",
      artifactId: "artifact-1",
      artifactContentHash: SOURCE_HASH,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
    },
  };
}

/** Creates one accepted create operation with an exact after hash. */
function createFileChange(path = "Wiki/主题.md", content = "# 主题\n"): KnowledgeFileChange {
  return {
    id: `change-${path}`,
    operation: "create",
    path,
    sourceRefs: ["source-1"],
    reason: "Create generated knowledge",
    expectedAbsent: true,
    afterContent: content,
    afterHash: createFileContentHash(content),
  };
}

/** Creates an accepted ChangeSet whose declared validation is affirmative. */
function createChangeSet(changes = [createFileChange()]): KnowledgeChangeSet {
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes,
    citations: [createCitation()],
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "accepted",
    createdAt: 100,
  };
}

/** Creates a parser observation matching the default citation. */
function createArtifact(text = "Before Grounded evidence After"): TextArtifactObservation {
  return {
    kind: "text",
    sourceId: "source-1",
    artifactId: "artifact-1",
    artifactContentHash: SOURCE_HASH,
    text,
  };
}

/** Creates an injected file store backed by exact path observations. */
function createFileStore(
  observations: Readonly<Record<string, KnowledgeFileObservation>> = {},
  mutationCapabilities: Readonly<KnowledgeFileMutationCapabilities> = ALL_KNOWLEDGE_FILE_MUTATIONS
): jest.Mocked<KnowledgeFileStore> {
  return {
    mutationCapabilities,
    observe: jest.fn(async (path) => observations[path] ?? { kind: "missing" }),
    compareAndSwap: jest.fn(
      async (
        _path: string,
        _before: import("@/knowledge/changeset/TransactionStorage").TransactionFileState,
        _after: import("@/knowledge/changeset/TransactionStorage").TransactionFileState
      ) => ({ kind: "applied" as const })
    ),
  };
}

/** Creates a successful source artifact resolver. */
function createArtifactResolver(
  artifact: TextArtifactObservation | null = createArtifact()
): jest.Mocked<SourceArtifactResolver> {
  return { resolve: jest.fn(async (_locator: SourceLocator) => artifact) };
}

/** Creates a successful projected OKF and link validator. */
function createProjectionValidator(): jest.Mocked<KnowledgeProjectionValidator> {
  return {
    validate: jest.fn(async (_input: KnowledgeProjectionValidationInput) => ({
      okfValid: true,
      linksValid: true,
      diagnostics: [],
    })),
  };
}

/** Extracts stable diagnostic codes from a rejected validation promise. */
async function rejectedCodes(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
    throw new Error("Expected ChangeSet validation to reject");
  } catch (error) {
    if (!(error instanceof ChangeSetValidationError)) {
      throw error;
    }
    return error.diagnostics.map((diagnostic) => diagnostic.code);
  }
}

describe("ChangeSetValidator", () => {
  it("rejects a mutation capability contract that omits create-parent semantics", () => {
    const store = createFileStore({}, {
      create: true,
      update: true,
      delete: true,
    } as unknown as KnowledgeFileMutationCapabilities);

    expect(
      () => new ChangeSetValidator(store, createArtifactResolver(), createProjectionValidator())
    ).toThrow(TypeError);
    expect(store.observe).not.toHaveBeenCalled();
  });

  it("captures exact pre-state, revalidates semantics, and orders targets by Windows key", async () => {
    const zeta = createFileChange("Wiki/Zeta.md", "zeta");
    const alphaContent = "before\r\n";
    const alpha: KnowledgeFileChange = {
      id: "change-alpha",
      operation: "update",
      path: "Wiki/alpha.md",
      sourceRefs: ["source-1"],
      reason: "Refresh generated page",
      beforeHash: createFileContentHash(alphaContent),
      afterContent: "after\n",
      afterHash: createFileContentHash("after\n"),
    };
    const store = createFileStore({ "Wiki/alpha.md": { kind: "file", content: alphaContent } });
    const projection = createProjectionValidator();
    const validator = new ChangeSetValidator(store, createArtifactResolver(), projection);

    const prepared = await validator.prepare(createChangeSet([zeta, alpha]), createBundle());

    expect(prepared.targets.map((target) => target.path)).toEqual([
      "Wiki/alpha.md",
      "Wiki/Zeta.md",
    ]);
    expect(prepared.targets[0].before).toEqual({
      kind: "file",
      content: alphaContent,
      contentHash: createFileContentHash(alphaContent),
    });
    expect(prepared.validation).toEqual({
      okfValid: true,
      citationsValid: true,
      linksValid: true,
    });
    expect(prepared.changeSetDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(projection.validate).toHaveBeenCalledWith(
      expect.objectContaining({ targets: prepared.targets })
    );
    expect(store.compareAndSwap).not.toHaveBeenCalled();
  });

  it("computes the same digest for equivalent object insertion orders", () => {
    const first = createChangeSet();
    const second: KnowledgeChangeSet = {
      createdAt: first.createdAt,
      status: first.status,
      validation: first.validation,
      citations: first.citations,
      changes: first.changes,
      sourceRefs: first.sourceRefs,
      operation: first.operation,
      bundleId: first.bundleId,
      id: first.id,
    };

    expect(createKnowledgeChangeSetDigest(first)).toBe(createKnowledgeChangeSetDigest(second));
  });

  it("rejects an unaccepted ChangeSet before observing files", async () => {
    const changeSet = createChangeSet();
    changeSet.status = "proposed";
    const store = createFileStore();
    const validator = new ChangeSetValidator(
      store,
      createArtifactResolver(),
      createProjectionValidator()
    );

    await expect(rejectedCodes(validator.prepare(changeSet, createBundle()))).resolves.toContain(
      "changeset_not_accepted"
    );
    expect(store.observe).not.toHaveBeenCalled();
  });

  it("rejects failed declared validation before observing files", async () => {
    const changeSet = createChangeSet();
    changeSet.validation.linksValid = false;
    const store = createFileStore();
    const validator = new ChangeSetValidator(
      store,
      createArtifactResolver(),
      createProjectionValidator()
    );

    await expect(rejectedCodes(validator.prepare(changeSet, createBundle()))).resolves.toContain(
      "changeset_declared_validation_failed"
    );
    expect(store.observe).not.toHaveBeenCalled();
  });

  it("rejects an unsupported adapter operation before observing files or creating a journal", async () => {
    const content = "# Generated page\n";
    const deletion: KnowledgeFileChange = {
      id: "change-delete",
      operation: "delete",
      path: "Wiki/Generated.md",
      sourceRefs: ["source-1"],
      reason: "Remove obsolete generated content",
      beforeHash: createFileContentHash(content),
    };
    const capabilities = {
      create: true,
      update: true,
      delete: false,
      requiresExistingParentForCreate: false,
    };
    const store = createFileStore({ "Wiki/Generated.md": { kind: "file", content } }, capabilities);
    const resolver = createArtifactResolver();
    const projection = createProjectionValidator();
    const validator = new ChangeSetValidator(store, resolver, projection);
    capabilities.delete = true;

    await expect(
      rejectedCodes(validator.prepare(createChangeSet([deletion]), createBundle()))
    ).resolves.toContain("changeset_operation_unsupported");
    expect(store.observe).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(projection.validate).not.toHaveBeenCalled();
  });

  it("rejects Bundle mismatch and Raw Source targets before observing files", async () => {
    const changeSet = createChangeSet([createFileChange("Sources/raw.md")]);
    changeSet.bundleId = "another-bundle";
    const store = createFileStore();
    const validator = new ChangeSetValidator(
      store,
      createArtifactResolver(),
      createProjectionValidator()
    );

    await expect(rejectedCodes(validator.prepare(changeSet, createBundle()))).resolves.toEqual(
      expect.arrayContaining([
        "changeset_bundle_mismatch",
        "change_path_inside_source",
        "change_path_outside_wiki",
      ])
    );
    expect(store.observe).not.toHaveBeenCalled();
  });

  it("rejects create targets that already exist", async () => {
    const store = createFileStore({ "Wiki/主题.md": { kind: "file", content: "occupied" } });
    const validator = new ChangeSetValidator(
      store,
      createArtifactResolver(),
      createProjectionValidator()
    );

    await expect(
      rejectedCodes(validator.prepare(createChangeSet(), createBundle()))
    ).resolves.toContain("changeset_expected_absent_conflict");
  });

  it.each([
    [{ kind: "missing" } as const, "changeset_create_parent_missing"],
    [
      { kind: "file", content: "not a directory" } as const,
      "changeset_create_parent_not_directory",
    ],
  ])("rejects a create whose required parent is unavailable", async (parent, code) => {
    const capabilities: KnowledgeFileMutationCapabilities = {
      ...ALL_KNOWLEDGE_FILE_MUTATIONS,
      requiresExistingParentForCreate: true,
    };
    const change = createFileChange("Wiki/Queries/New.md");
    const store = createFileStore({ "Wiki/Queries": parent }, capabilities);
    const validator = new ChangeSetValidator(
      store,
      createArtifactResolver(),
      createProjectionValidator()
    );

    await expect(
      rejectedCodes(validator.prepare(createChangeSet([change]), createBundle()))
    ).resolves.toContain(code);
    expect(store.observe).toHaveBeenCalledWith("Wiki/Queries/New.md");
    expect(store.observe).toHaveBeenCalledWith("Wiki/Queries");
    expect(store.compareAndSwap).not.toHaveBeenCalled();
  });

  it("accepts a create when its required parent is an existing directory", async () => {
    const capabilities: KnowledgeFileMutationCapabilities = {
      ...ALL_KNOWLEDGE_FILE_MUTATIONS,
      requiresExistingParentForCreate: true,
    };
    const change = createFileChange("Wiki/Queries/New.md");
    const store = createFileStore({ "Wiki/Queries": { kind: "directory" } }, capabilities);
    const validator = new ChangeSetValidator(
      store,
      createArtifactResolver(),
      createProjectionValidator()
    );

    const prepared = await validator.prepare(createChangeSet([change]), createBundle());

    expect(prepared.targets).toHaveLength(1);
    expect(prepared.targets[0].path).toBe("Wiki/Queries/New.md");
    expect(store.observe).toHaveBeenCalledWith("Wiki/Queries");
  });

  it("sanitizes a required create-parent observation failure", async () => {
    const capabilities: KnowledgeFileMutationCapabilities = {
      ...ALL_KNOWLEDGE_FILE_MUTATIONS,
      requiresExistingParentForCreate: true,
    };
    const change = createFileChange("Wiki/Queries/New.md");
    const store = createFileStore({}, capabilities);
    store.observe.mockImplementation(async (path) => {
      if (path === "Wiki/Queries") throw new Error("secret parent failure");
      return { kind: "missing" };
    });
    const validator = new ChangeSetValidator(
      store,
      createArtifactResolver(),
      createProjectionValidator()
    );

    await expect(
      validator.prepare(createChangeSet([change]), createBundle())
    ).rejects.toMatchObject({
      name: "ChangeSetValidationInfrastructureError",
      stage: "file_observation",
    } satisfies Partial<ChangeSetValidationInfrastructureError>);
  });

  it("rejects missing, directory, and changed update targets", async () => {
    const expected = "expected\r\n";
    const updated: KnowledgeFileChange = {
      id: "change-update",
      operation: "update",
      path: "Wiki/update.md",
      sourceRefs: ["source-1"],
      reason: "Update page",
      beforeHash: createFileContentHash(expected),
      afterContent: "after",
      afterHash: createFileContentHash("after"),
    };

    for (const [observation, code] of [
      [{ kind: "missing" } as const, "changeset_target_missing"],
      [{ kind: "directory" } as const, "changeset_target_is_directory"],
      [{ kind: "file", content: "expected\n" } as const, "changeset_before_hash_conflict"],
    ] as const) {
      const validator = new ChangeSetValidator(
        createFileStore({ "Wiki/update.md": observation }),
        createArtifactResolver(),
        createProjectionValidator()
      );

      await expect(
        rejectedCodes(validator.prepare(createChangeSet([updated]), createBundle()))
      ).resolves.toContain(code);
    }
  });

  it("rejects a citation whose current artifact does not contain the excerpt", async () => {
    const validator = new ChangeSetValidator(
      createFileStore(),
      createArtifactResolver(createArtifact("Different material")),
      createProjectionValidator()
    );

    await expect(
      rejectedCodes(validator.prepare(createChangeSet(), createBundle()))
    ).resolves.toContain("locator_excerpt_missing");
  });

  it("rejects a citation whose parser artifact is unavailable", async () => {
    const validator = new ChangeSetValidator(
      createFileStore(),
      createArtifactResolver(null),
      createProjectionValidator()
    );

    await expect(
      rejectedCodes(validator.prepare(createChangeSet(), createBundle()))
    ).resolves.toContain("citation_artifact_missing");
  });

  it("rejects recomputed OKF and link failures even when declared flags are true", async () => {
    const projection = createProjectionValidator();
    projection.validate.mockResolvedValue({
      okfValid: false,
      linksValid: false,
      diagnostics: [],
    });
    const validator = new ChangeSetValidator(
      createFileStore(),
      createArtifactResolver(),
      projection
    );

    await expect(
      rejectedCodes(validator.prepare(createChangeSet(), createBundle()))
    ).resolves.toEqual(
      expect.arrayContaining(["projected_okf_invalid", "projected_links_invalid"])
    );
  });

  it.each([
    ["file observation", "file_observation" as const],
    ["artifact resolution", "artifact_resolution" as const],
    ["projection validation", "projection_validation" as const],
  ])("sanitizes %s dependency failures", async (_label, stage) => {
    const store = createFileStore();
    const resolver = createArtifactResolver();
    const projection = createProjectionValidator();
    if (stage === "file_observation") {
      store.observe.mockRejectedValue(new Error("secret file failure"));
    } else if (stage === "artifact_resolution") {
      resolver.resolve.mockRejectedValue(new Error("secret parser failure"));
    } else {
      projection.validate.mockRejectedValue(new Error("secret link failure"));
    }
    const validator = new ChangeSetValidator(store, resolver, projection);

    await expect(validator.prepare(createChangeSet(), createBundle())).rejects.toMatchObject({
      name: "ChangeSetValidationInfrastructureError",
      stage,
    } satisfies Partial<ChangeSetValidationInfrastructureError>);
  });
});
