import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type {
  ClaimCitation,
  KnowledgeChangeSet,
  KnowledgeFileChange,
} from "@/knowledge/model/types";
import { createKnowledgeReviewEvidenceRef } from "@/knowledge/review/KnowledgeReviewEvidence";
import {
  compileKnowledgeReviewSelection,
  createKnowledgeReviewPlan,
  KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS,
  KnowledgeReviewAbortError,
  KnowledgeReviewDecisionError,
  KnowledgeReviewDecisionService,
  KnowledgeReviewInfrastructureError,
  snapshotKnowledgeReviewCommand,
  type KnowledgeReviewCandidateValidationInput,
  type KnowledgeReviewCandidateValidator,
  type KnowledgeReviewCommand,
  type KnowledgeReviewFileDecision,
  type KnowledgeReviewPlan,
  type KnowledgeReviewTargetObservation,
} from "@/knowledge/review/ReviewDecision";

const BEFORE = "alpha\r\nold  \r\nkeep\r\n中文旧\r\n";
const AFTER = "alpha\r\nnew\r\nkeep\r\n中文新\r\n";

/** Creates a detached JSON-compatible test value. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Creates one valid proposed ChangeSet around caller-supplied changes. */
function createProposal(
  changes: KnowledgeFileChange[],
  citations: ClaimCitation[] = []
): KnowledgeChangeSet {
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes,
    citations,
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    status: "proposed",
    createdAt: 100,
  };
}

/** Creates a valid exact update operation. */
function createUpdate(
  overrides: Partial<Extract<KnowledgeFileChange, { operation: "update" }>> = {}
): Extract<KnowledgeFileChange, { operation: "update" }> {
  return {
    id: "change-update",
    operation: "update",
    path: "Wiki/Update.md",
    sourceRefs: ["source-1"],
    reason: "Update the compiled page",
    beforeHash: createFileContentHash(BEFORE),
    afterContent: AFTER,
    afterHash: createFileContentHash(AFTER),
    ...overrides,
  };
}

/** Creates a valid exact create operation. */
function createCreate(
  overrides: Partial<Extract<KnowledgeFileChange, { operation: "create" }>> = {}
): Extract<KnowledgeFileChange, { operation: "create" }> {
  const afterContent = overrides.afterContent ?? "# Created\n";
  return {
    id: "change-create",
    operation: "create",
    path: "Wiki/Create.md",
    sourceRefs: ["source-1"],
    reason: "Create the compiled page",
    expectedAbsent: true,
    afterContent,
    afterHash: createFileContentHash(afterContent),
    ...overrides,
  };
}

/** Creates a valid exact delete operation. */
function createDelete(
  overrides: Partial<Extract<KnowledgeFileChange, { operation: "delete" }>> = {}
): Extract<KnowledgeFileChange, { operation: "delete" }> {
  return {
    id: "change-delete",
    operation: "delete",
    path: "Wiki/Delete.md",
    sourceRefs: ["source-1"],
    reason: "Delete an obsolete generated page",
    beforeHash: createFileContentHash(BEFORE),
    ...overrides,
  };
}

/** Creates exact observations for every change in one proposal. */
function createObservations(proposal: KnowledgeChangeSet): KnowledgeReviewTargetObservation[] {
  return proposal.changes.map((change) =>
    change.operation === "create"
      ? { changeId: change.id, kind: "missing" as const }
      : { changeId: change.id, kind: "file" as const, content: BEFORE }
  );
}

/** Creates a command bound to one plan and explicit file decisions. */
function createCommand(
  plan: KnowledgeReviewPlan,
  decisions: KnowledgeReviewFileDecision[]
): KnowledgeReviewCommand {
  return {
    changeSetId: plan.changeSetId,
    proposalDigest: plan.proposalDigest,
    expectedSnapshotToken: plan.snapshotToken,
    decisions,
  };
}

/** Reads stable diagnostic codes from a typed review decision rejection. */
function decisionErrorCodes(error: unknown): string[] {
  expect(error).toBeInstanceOf(KnowledgeReviewDecisionError);
  return error instanceof KnowledgeReviewDecisionError
    ? error.diagnostics.map((diagnostic) => diagnostic.code)
    : [];
}

/** Scriptable deterministic validator used by service tests. */
class FakeReviewValidator implements KnowledgeReviewCandidateValidator {
  public calls = 0;
  public inputs: KnowledgeReviewCandidateValidationInput[] = [];

  /** Creates a validator around one explicit result handler. */
  constructor(
    private readonly handler: (
      input: KnowledgeReviewCandidateValidationInput,
      signal: AbortSignal
    ) => Promise<unknown>
  ) {}

  /** Records and delegates one deterministic candidate validation. */
  async validate(
    input: KnowledgeReviewCandidateValidationInput,
    signal: AbortSignal
  ): Promise<unknown> {
    this.calls += 1;
    this.inputs.push(input);
    return this.handler(input, signal);
  }
}

/** Creates an affirmative deterministic validator payload. */
async function validCandidate(): Promise<unknown> {
  return {
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    diagnostics: [],
  };
}

describe("createKnowledgeReviewPlan", () => {
  it("creates stable exact blocks without mutating the proposal", () => {
    const proposal = createProposal([createUpdate()]);
    const original = cloneJson(proposal);

    const first = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const second = createKnowledgeReviewPlan(proposal, createObservations(proposal));

    expect(first).toEqual(second);
    expect(first.proposalDigest).toBe(createKnowledgeChangeSetDigest(proposal));
    expect(first.files[0]).toMatchObject({
      integrity: "current",
      capability: "blocks_allowed",
      beforeContent: BEFORE,
      afterContent: AFTER,
    });
    expect(first.files[0].blocks.filter((block) => block.kind === "change")).toHaveLength(2);
    expect(proposal).toEqual(original);
  });

  it("creates the same content-addressed snapshot regardless of observation order", () => {
    const proposal = createProposal([createUpdate(), createCreate()]);
    const observations = createObservations(proposal);

    const ordered = createKnowledgeReviewPlan(proposal, observations);
    const reversed = createKnowledgeReviewPlan(proposal, [...observations].reverse());

    expect(reversed).toEqual(ordered);
  });

  it("projects proposal citations into frozen plan-level evidence summaries", () => {
    const excerpt = "Exact source support";
    const proposal = createProposal(
      [createUpdate()],
      [
        {
          citationId: "citation-1",
          claimId: "claim-private",
          relation: "supports",
          locator: {
            kind: "pdf_page",
            sourceId: "source-1",
            artifactId: "artifact-private",
            artifactContentHash: "a".repeat(64),
            excerpt,
            quoteHash: createQuoteHash(excerpt),
            page: 9,
          },
        },
      ]
    );

    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));

    expect(plan.evidence).toEqual([
      {
        evidenceRef: createKnowledgeReviewEvidenceRef(plan.proposalDigest, "citation-1"),
        relation: "supports",
        excerpt,
        truncated: false,
        location: { kind: "pdf_page", page: 9 },
      },
    ]);
    expect(plan.omittedEvidenceCount).toBe(0);
    expect(Object.isFrozen(plan.evidence)).toBe(true);
    expect(Object.isFrozen(plan.evidence[0])).toBe(true);
    expect(JSON.stringify(plan.evidence)).not.toContain("artifact-private");
    expect(JSON.stringify(plan.evidence)).not.toContain("claim-private");
  });

  it("marks occupied, stale, missing, directory, and unavailable targets reject-only", () => {
    const changes = [
      createCreate(),
      createUpdate({ id: "update-stale", path: "Wiki/Stale.md" }),
      createUpdate({ id: "update-missing", path: "Wiki/Missing.md" }),
      createUpdate({ id: "update-directory", path: "Wiki/Directory.md" }),
      createUpdate({ id: "update-unavailable", path: "Wiki/Unavailable.md" }),
    ];
    const proposal = createProposal(changes);
    const plan = createKnowledgeReviewPlan(proposal, [
      { changeId: "change-create", kind: "occupied" },
      { changeId: "update-stale", kind: "file", content: "changed elsewhere" },
      { changeId: "update-missing", kind: "missing" },
      { changeId: "update-directory", kind: "directory" },
      { changeId: "update-unavailable", kind: "unavailable" },
    ]);

    expect(plan.files.map((file) => [file.integrity, file.capability])).toEqual([
      ["occupied", "reject_only"],
      ["stale", "reject_only"],
      ["missing", "reject_only"],
      ["directory", "reject_only"],
      ["unavailable", "reject_only"],
    ]);
  });

  it("keeps delete visible but reject-only until its manifest read-set is journaled", () => {
    const proposal = createProposal([createDelete()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));

    expect(plan.files[0]).toMatchObject({
      operation: "delete",
      integrity: "current",
      capability: "reject_only",
      blockedReason: "review_delete_read_set_not_journaled",
      beforeContent: BEFORE,
    });
  });

  it("rejects missing, duplicate, and unknown observations", () => {
    const proposal = createProposal([createUpdate()]);

    expect(() => createKnowledgeReviewPlan(proposal, [])).toThrow(KnowledgeReviewDecisionError);
    try {
      createKnowledgeReviewPlan(proposal, [
        { changeId: "change-update", kind: "file", content: BEFORE },
        { changeId: "change-update", kind: "file", content: BEFORE },
        { changeId: "unknown", kind: "missing" },
      ]);
    } catch (error) {
      expect(decisionErrorCodes(error)).toEqual(
        expect.arrayContaining(["review_observation_duplicate", "review_observation_unknown"])
      );
    }
  });
});

describe("snapshotKnowledgeReviewCommand", () => {
  it("captures detached deeply frozen exact and block decisions", () => {
    const proposal = createProposal([createUpdate(), createCreate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const acceptedBlockIds = plan.files[0].blocks
      .filter((block) => block.kind === "change")
      .map((block) => block.blockId);
    const command = createCommand(plan, [
      { changeId: "change-create", decision: "accept_exact" },
      {
        changeId: "change-update",
        decision: "accept_blocks",
        acceptedBlockIds,
      },
    ]);

    const captured = snapshotKnowledgeReviewCommand(command);

    expect(captured).toEqual(command);
    expect(captured).not.toBe(command);
    expect(captured.decisions).not.toBe(command.decisions);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.decisions)).toBe(true);
    expect(captured.decisions.every((decision) => Object.isFrozen(decision))).toBe(true);
    const blockDecision = captured.decisions[1];
    expect(blockDecision.decision).toBe("accept_blocks");
    if (blockDecision.decision === "accept_blocks") {
      expect(blockDecision.acceptedBlockIds).not.toBe(acceptedBlockIds);
      expect(Object.isFrozen(blockDecision.acceptedBlockIds)).toBe(true);
    }
  });

  it("captures exact manually edited content as a frozen data record", () => {
    const proposal = createProposal([createUpdate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const command = createCommand(plan, [
      {
        changeId: "change-update",
        decision: "accept_edited",
        afterContent: "# Revised\r\n\r\nExact trailing space  \r\n",
      },
    ]);

    const captured = snapshotKnowledgeReviewCommand(command);

    expect(captured).toEqual(command);
    expect(captured).not.toBe(command);
    expect(captured.decisions[0]).not.toBe(command.decisions[0]);
    expect(Object.isFrozen(captured.decisions[0])).toBe(true);
  });

  it("preserves valid Unicode exactly and rejects lone surrogates or unsupported C0 controls", () => {
    const proposal = createProposal([createUpdate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const exactValidContent = "emoji: 😀\tdecomposed: e\u0301\r\n";

    const captured = snapshotKnowledgeReviewCommand(
      createCommand(plan, [
        {
          changeId: "change-update",
          decision: "accept_edited",
          afterContent: exactValidContent,
        },
      ])
    );

    expect(captured.decisions[0]).toEqual({
      changeId: "change-update",
      decision: "accept_edited",
      afterContent: exactValidContent,
    });
    const invalidContents = [
      "lone-high-\ud800",
      "lone-low-\udc00",
      "bad-pair-\ud800x",
      "nul-\0",
      "c0-\u001f",
    ];
    for (const afterContent of invalidContents) {
      let capturedError: unknown;
      try {
        snapshotKnowledgeReviewCommand(
          createCommand(plan, [
            { changeId: "change-update", decision: "accept_edited", afterContent },
          ])
        );
      } catch (error) {
        capturedError = error;
      }
      expect(decisionErrorCodes(capturedError)).toContain("review_command_edit_content_invalid");
    }
  });

  it("rejects accessor fields and records with extra keys", () => {
    const proposal = createProposal([createUpdate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const accessorCommand = createCommand(plan, [
      { changeId: "change-update", decision: "accept_exact" },
    ]);
    Object.defineProperty(accessorCommand, "changeSetId", {
      enumerable: true,
      get: () => proposal.id,
    });
    const extraCommand = {
      ...createCommand(plan, [{ changeId: "change-update", decision: "accept_exact" }]),
      path: "Wiki/private.md",
    };
    const extraDecisionCommand = createCommand(plan, [
      {
        changeId: "change-update",
        decision: "accept_exact",
        path: "Wiki/private.md",
      } as KnowledgeReviewFileDecision,
    ]);
    let contentAccessorCalls = 0;
    const accessorDecision = {
      changeId: "change-update",
      decision: "accept_edited",
      afterContent: "unused",
    };
    Object.defineProperty(accessorDecision, "afterContent", {
      enumerable: true,
      get: () => {
        contentAccessorCalls += 1;
        return "must not be read";
      },
    });
    const inheritedDecision = Object.assign(Object.create({ inherited: true }) as object, {
      changeId: "change-update",
      decision: "accept_edited",
      afterContent: "not plain",
    });

    for (const command of [
      accessorCommand,
      extraCommand,
      extraDecisionCommand,
      { ...createCommand(plan, []), decisions: [accessorDecision] },
      { ...createCommand(plan, []), decisions: [inheritedDecision] },
    ]) {
      expect(() => snapshotKnowledgeReviewCommand(command)).toThrow(KnowledgeReviewDecisionError);
    }
    expect(contentAccessorCalls).toBe(0);
  });

  it("enforces inclusive edit budgets before scanning oversized invalid text", () => {
    const proposal = createProposal([createUpdate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const exactFileLimit = "x".repeat(KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile);
    const exactTotalCommand = createCommand(
      plan,
      Array.from(
        {
          length:
            KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxTotalCharacters /
            KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile,
        },
        (_, index) => ({
          changeId: `change-${index}`,
          decision: "accept_edited" as const,
          afterContent: exactFileLimit,
        })
      )
    );

    expect(snapshotKnowledgeReviewCommand(exactTotalCommand).decisions).toHaveLength(4);

    const oversizedFile = createCommand(plan, [
      {
        changeId: "change-update",
        decision: "accept_edited",
        afterContent: `\0${exactFileLimit}`,
      },
    ]);
    const oversizedTotal = {
      ...exactTotalCommand,
      decisions: [
        ...exactTotalCommand.decisions,
        { changeId: "change-extra", decision: "accept_edited" as const, afterContent: "\0" },
      ],
    };

    let oversizedFileError: unknown;
    try {
      snapshotKnowledgeReviewCommand(oversizedFile);
    } catch (error) {
      oversizedFileError = error;
    }
    expect(decisionErrorCodes(oversizedFileError)).toContain(
      "review_command_edit_content_limit_exceeded"
    );
    let oversizedTotalError: unknown;
    try {
      snapshotKnowledgeReviewCommand(oversizedTotal);
    } catch (error) {
      oversizedTotalError = error;
    }
    expect(decisionErrorCodes(oversizedTotalError)).toContain(
      "review_command_edit_total_limit_exceeded"
    );
  });

  it("rejects sparse decision and block-id arrays", () => {
    const proposal = createProposal([createUpdate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const sparseDecisions = new Array<KnowledgeReviewFileDecision>(2);
    sparseDecisions[1] = { changeId: "change-update", decision: "accept_exact" };
    const sparseBlockIds = new Array<string>(2);
    sparseBlockIds[1] = plan.files[0].blocks.find((block) => block.kind === "change")!.blockId;

    expect(() =>
      snapshotKnowledgeReviewCommand({
        ...createCommand(plan, [{ changeId: "change-update", decision: "accept_exact" }]),
        decisions: sparseDecisions,
      })
    ).toThrow(KnowledgeReviewDecisionError);
    expect(() =>
      snapshotKnowledgeReviewCommand(
        createCommand(plan, [
          {
            changeId: "change-update",
            decision: "accept_blocks",
            acceptedBlockIds: sparseBlockIds,
          },
        ])
      )
    ).toThrow(KnowledgeReviewDecisionError);
  });
});

describe("compileKnowledgeReviewSelection", () => {
  it("recomposes partial exact content while preserving proposal-owned identity", () => {
    const proposal = createProposal([createUpdate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const changedBlocks = plan.files[0].blocks.filter((block) => block.kind === "change");
    const original = cloneJson(proposal);
    const command = createCommand(plan, [
      {
        changeId: "change-update",
        decision: "accept_blocks",
        acceptedBlockIds: [changedBlocks[0].blockId],
      },
    ]);

    const result = compileKnowledgeReviewSelection(proposal, plan, command);

    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") {
      const change = result.changeSet.changes[0];
      expect(change.operation).toBe("update");
      if (change.operation === "update") {
        const expected = "alpha\r\nnew\r\nkeep\r\n中文旧\r\n";
        expect(change.afterContent).toBe(expected);
        expect(change.afterHash).toBe(createFileContentHash(expected));
        expect(change.id).toBe("change-update");
      }
      expect(result.changeSet.validation).toEqual({
        okfValid: false,
        citationsValid: false,
        linksValid: false,
      });
    }
    expect(proposal).toEqual(original);
  });

  it("replaces only writable content while preserving every proposal-owned invariant", () => {
    const excerpt = "Grounded source excerpt";
    const proposal = createProposal(
      [
        createCreate({ id: "change-create-edited", path: "Wiki/Create-edited.md" }),
        createUpdate({ id: "change-update-edited", path: "Wiki/Update-edited.md" }),
      ],
      [
        {
          citationId: "citation-1",
          claimId: "claim-1",
          relation: "supports",
          locator: {
            kind: "quote",
            sourceId: "source-1",
            artifactId: "artifact-1",
            artifactContentHash: "a".repeat(64),
            excerpt,
            quoteHash: createQuoteHash(excerpt),
          },
        },
      ]
    );
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const original = cloneJson(proposal);
    const editedCreate = "# Manually revised create\n";
    const editedUpdate = "# Manually revised update\r\n\r\n";

    const result = compileKnowledgeReviewSelection(
      proposal,
      plan,
      createCommand(plan, [
        {
          changeId: "change-create-edited",
          decision: "accept_edited",
          afterContent: editedCreate,
        },
        {
          changeId: "change-update-edited",
          decision: "accept_edited",
          afterContent: editedUpdate,
        },
      ])
    );

    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") {
      expect(result.changeSet).toMatchObject({
        id: proposal.id,
        bundleId: proposal.bundleId,
        operation: proposal.operation,
        sourceRefs: proposal.sourceRefs,
        citations: proposal.citations,
        createdAt: proposal.createdAt,
        status: "proposed",
        validation: { okfValid: false, citationsValid: false, linksValid: false },
      });
      expect(result.changeSet.changes).toEqual([
        {
          ...proposal.changes[0],
          afterContent: editedCreate,
          afterHash: createFileContentHash(editedCreate),
        },
        {
          ...proposal.changes[1],
          afterContent: editedUpdate,
          afterHash: createFileContentHash(editedUpdate),
        },
      ]);
    }
    expect(proposal).toEqual(original);
  });

  it("bounds the final exact and mixed selected candidate before validation", () => {
    const chunk = "x".repeat(KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile);
    const chunkHash = createFileContentHash(chunk);
    /** Creates one large create operation without redundantly hashing shared test text. */
    const largeCreate = (id: string): KnowledgeFileChange =>
      createCreate({
        id,
        path: `Wiki/${id}.md`,
        afterContent: chunk,
        afterHash: chunkHash,
      });
    const proposal = createProposal([
      largeCreate("change-exact-1"),
      largeCreate("change-exact-2"),
      largeCreate("change-blocks"),
      largeCreate("change-edited"),
      createCreate({ id: "change-overflow", path: "Wiki/Overflow.md", afterContent: "x" }),
    ]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const acceptedBlockIds = plan.files
      .find((file) => file.changeId === "change-blocks")!
      .blocks.filter((block) => block.kind === "change")
      .map((block) => block.blockId);
    const exactAtLimit = createCommand(plan, [
      { changeId: "change-exact-1", decision: "accept_exact" },
      { changeId: "change-exact-2", decision: "accept_exact" },
      { changeId: "change-blocks", decision: "accept_exact" },
      { changeId: "change-edited", decision: "accept_exact" },
      { changeId: "change-overflow", decision: "reject" },
    ]);
    const mixedAtLimit = createCommand(plan, [
      { changeId: "change-exact-1", decision: "accept_exact" },
      { changeId: "change-exact-2", decision: "accept_exact" },
      { changeId: "change-blocks", decision: "accept_blocks", acceptedBlockIds },
      { changeId: "change-edited", decision: "accept_edited", afterContent: chunk },
      { changeId: "change-overflow", decision: "reject" },
    ]);

    expect(compileKnowledgeReviewSelection(proposal, plan, exactAtLimit).kind).toBe("candidate");
    expect(compileKnowledgeReviewSelection(proposal, plan, mixedAtLimit).kind).toBe("candidate");

    let overLimitError: unknown;
    try {
      compileKnowledgeReviewSelection(proposal, plan, {
        ...mixedAtLimit,
        decisions: [
          ...mixedAtLimit.decisions.slice(0, -1),
          { changeId: "change-overflow", decision: "accept_exact" },
        ],
      });
    } catch (error) {
      overLimitError = error;
    }
    expect(decisionErrorCodes(overLimitError)).toEqual([
      "review_candidate_total_content_limit_exceeded",
    ]);
  });

  it("rejects a block selection that combines into an oversized final file", () => {
    const largeBeforeBlock = "a".repeat(1_100_000);
    const largeAfterBlock = "b".repeat(1_100_000);
    const beforeContent = `${largeBeforeBlock}\nshared context\nold tail\n`;
    const proposedContent = `new head\nshared context\n${largeAfterBlock}\n`;
    const proposal = createProposal([
      createUpdate({
        beforeHash: createFileContentHash(beforeContent),
        afterContent: proposedContent,
        afterHash: createFileContentHash(proposedContent),
      }),
    ]);
    const plan = createKnowledgeReviewPlan(proposal, [
      { changeId: "change-update", kind: "file", content: beforeContent },
    ]);
    const changedBlocks = plan.files[0].blocks.filter((block) => block.kind === "change");

    expect(beforeContent.length).toBeLessThanOrEqual(
      KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile
    );
    expect(proposedContent.length).toBeLessThanOrEqual(
      KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile
    );
    expect(changedBlocks).toHaveLength(2);

    let overLimitError: unknown;
    try {
      compileKnowledgeReviewSelection(
        proposal,
        plan,
        createCommand(plan, [
          {
            changeId: "change-update",
            decision: "accept_blocks",
            acceptedBlockIds: [changedBlocks[1].blockId],
          },
        ])
      );
    } catch (error) {
      overLimitError = error;
    }
    expect(decisionErrorCodes(overLimitError)).toEqual(["review_candidate_content_limit_exceeded"]);
  });

  it("preserves proposal order for rewritten changes", () => {
    const proposal = createProposal([
      createUpdate({ id: "change-z", path: "Wiki/z.md" }),
      createCreate({ id: "change-a", path: "Wiki/A.md" }),
    ]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const decisions = plan.files.map<KnowledgeReviewFileDecision>((file) => ({
      changeId: file.changeId,
      decision: "accept_blocks",
      acceptedBlockIds: file.blocks
        .filter((block) => block.kind === "change")
        .map((block) => block.blockId),
    }));

    const result = compileKnowledgeReviewSelection(proposal, plan, createCommand(plan, decisions));

    expect(result.kind).toBe("candidate");
    if (result.kind === "candidate") {
      expect(result.changeSet.changes.map((change) => change.id)).toEqual(["change-z", "change-a"]);
    }
  });

  it("preserves an exact accepted change and drops rejected files", () => {
    const proposal = createProposal([createUpdate(), createCreate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const result = compileKnowledgeReviewSelection(
      proposal,
      plan,
      createCommand(plan, [
        { changeId: "change-update", decision: "accept_exact" },
        { changeId: "change-create", decision: "reject" },
      ])
    );

    expect(result).toMatchObject({
      kind: "candidate",
      changeSet: { changes: [expect.objectContaining({ id: "change-update" })] },
    });
  });

  it("returns rejection when every selected block reconstructs the exact before state", () => {
    const proposal = createProposal([createUpdate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));

    const result = compileKnowledgeReviewSelection(
      proposal,
      plan,
      createCommand(plan, [
        { changeId: "change-update", decision: "accept_blocks", acceptedBlockIds: [] },
      ])
    );

    expect(result).toEqual({ kind: "rejected" });
  });

  it("skips an edited file whose exact bytes equal its observed before state", () => {
    const proposal = createProposal([createUpdate(), createCreate()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const onlyUpdateProposal = createProposal([createUpdate()]);
    const onlyUpdatePlan = createKnowledgeReviewPlan(
      onlyUpdateProposal,
      createObservations(onlyUpdateProposal)
    );

    const mixed = compileKnowledgeReviewSelection(
      proposal,
      plan,
      createCommand(plan, [
        { changeId: "change-update", decision: "accept_edited", afterContent: BEFORE },
        { changeId: "change-create", decision: "accept_exact" },
      ])
    );
    const onlyNoOp = compileKnowledgeReviewSelection(
      onlyUpdateProposal,
      onlyUpdatePlan,
      createCommand(onlyUpdatePlan, [
        { changeId: "change-update", decision: "accept_edited", afterContent: BEFORE },
      ])
    );

    expect(mixed).toMatchObject({
      kind: "candidate",
      changeSet: { changes: [expect.objectContaining({ id: "change-create" })] },
    });
    expect(onlyNoOp).toEqual({ kind: "rejected" });
  });

  it("rejects manual editing for delete and every reject-only snapshot", () => {
    const deleteProposal = createProposal([createDelete()]);
    const deletePlan = createKnowledgeReviewPlan(
      deleteProposal,
      createObservations(deleteProposal)
    );
    const staleProposal = createProposal([createUpdate()]);
    const stalePlan = createKnowledgeReviewPlan(staleProposal, [
      { changeId: "change-update", kind: "file", content: "changed elsewhere" },
    ]);

    const attempts: Array<{
      proposal: KnowledgeChangeSet;
      plan: KnowledgeReviewPlan;
      command: KnowledgeReviewCommand;
    }> = [
      {
        proposal: deleteProposal,
        plan: deletePlan,
        command: createCommand(deletePlan, [
          { changeId: "change-delete", decision: "accept_edited", afterContent: "replacement" },
        ]),
      },
      {
        proposal: staleProposal,
        plan: stalePlan,
        command: createCommand(stalePlan, [
          { changeId: "change-update", decision: "accept_edited", afterContent: "replacement" },
        ]),
      },
    ];

    for (const attempt of attempts) {
      expect(() =>
        compileKnowledgeReviewSelection(attempt.proposal, attempt.plan, attempt.command)
      ).toThrow(KnowledgeReviewDecisionError);
    }
  });

  it("rejects stale identity, unknown blocks, duplicate decisions, and blocked acceptance", () => {
    const proposal = createProposal([createUpdate(), createDelete()]);
    const plan = createKnowledgeReviewPlan(proposal, createObservations(proposal));
    const commands: KnowledgeReviewCommand[] = [
      {
        ...createCommand(plan, [
          { changeId: "change-update", decision: "reject" },
          { changeId: "change-delete", decision: "reject" },
        ]),
        expectedSnapshotToken: "0".repeat(64),
      },
      createCommand(plan, [
        {
          changeId: "change-update",
          decision: "accept_blocks",
          acceptedBlockIds: ["unknown-block"],
        },
        { changeId: "change-delete", decision: "reject" },
      ]),
      createCommand(plan, [
        { changeId: "change-update", decision: "reject" },
        { changeId: "change-update", decision: "reject" },
        { changeId: "change-delete", decision: "accept_exact" },
      ]),
    ];

    const codes = commands.flatMap((command) => {
      try {
        compileKnowledgeReviewSelection(proposal, plan, command);
        return [];
      } catch (error) {
        return decisionErrorCodes(error);
      }
    });
    expect(codes).toEqual(
      expect.arrayContaining([
        "review_command_snapshot_stale",
        "review_command_block_unknown",
        "review_command_decision_duplicate",
        "review_command_accept_blocked",
      ])
    );
  });
});

describe("KnowledgeReviewDecisionService", () => {
  it("does not invoke command accessors", async () => {
    const proposal = createProposal([createUpdate()]);
    const observations = createObservations(proposal);
    const plan = createKnowledgeReviewPlan(proposal, observations);
    const validator = new FakeReviewValidator(validCandidate);
    const service = new KnowledgeReviewDecisionService(validator);
    const command = createCommand(plan, [{ changeId: "change-update", decision: "accept_exact" }]);
    let accessorCalls = 0;
    Object.defineProperty(command.decisions[0], "changeId", {
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        throw new Error("must not invoke command accessors");
      },
    });

    await expect(
      service.decide(proposal, observations, command, new AbortController().signal)
    ).rejects.toBeInstanceOf(KnowledgeReviewDecisionError);
    expect(accessorCalls).toBe(0);
    expect(validator.calls).toBe(0);
  });

  it("revalidates and returns an exact accepted digest", async () => {
    const proposal = createProposal([createUpdate()]);
    const observations = createObservations(proposal);
    const plan = createKnowledgeReviewPlan(proposal, observations);
    const validator = new FakeReviewValidator(validCandidate);
    const service = new KnowledgeReviewDecisionService(validator);

    const result = await service.decide(
      proposal,
      observations,
      createCommand(plan, [{ changeId: "change-update", decision: "accept_exact" }]),
      new AbortController().signal
    );

    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.changeSet.status).toBe("accepted");
      expect(result.acceptedDigest).toBe(createKnowledgeChangeSetDigest(result.changeSet));
    }
    expect(validator.calls).toBe(1);
    expect(validator.inputs[0].candidate.status).toBe("proposed");
  });

  it("routes manually edited content through the existing deterministic validator", async () => {
    const proposal = createProposal([createUpdate()]);
    const observations = createObservations(proposal);
    const plan = createKnowledgeReviewPlan(proposal, observations);
    const validator = new FakeReviewValidator(validCandidate);
    const service = new KnowledgeReviewDecisionService(validator);
    const afterContent = "# Human-reviewed candidate\n";

    const result = await service.decide(
      proposal,
      observations,
      createCommand(plan, [{ changeId: "change-update", decision: "accept_edited", afterContent }]),
      new AbortController().signal
    );

    expect(result.kind).toBe("accepted");
    expect(validator.calls).toBe(1);
    expect(validator.inputs[0]).toMatchObject({
      proposal,
      proposalDigest: plan.proposalDigest,
      snapshotToken: plan.snapshotToken,
      observations,
      candidate: {
        status: "proposed",
        validation: { okfValid: false, citationsValid: false, linksValid: false },
        changes: [
          {
            id: "change-update",
            operation: "update",
            path: proposal.changes[0].path,
            sourceRefs: proposal.changes[0].sourceRefs,
            reason: proposal.changes[0].reason,
            beforeHash:
              proposal.changes[0].operation === "update"
                ? proposal.changes[0].beforeHash
                : undefined,
            afterContent,
            afterHash: createFileContentHash(afterContent),
          },
        ],
      },
    });
  });

  it("persists no candidate and skips validation when everything is rejected", async () => {
    const proposal = createProposal([createUpdate()]);
    const observations = createObservations(proposal);
    const plan = createKnowledgeReviewPlan(proposal, observations);
    const validator = new FakeReviewValidator(validCandidate);
    const service = new KnowledgeReviewDecisionService(validator);

    const result = await service.decide(
      proposal,
      observations,
      createCommand(plan, [{ changeId: "change-update", decision: "reject" }]),
      new AbortController().signal
    );

    expect(result).toEqual({
      kind: "rejected",
      changeSetId: proposal.id,
      proposalDigest: createKnowledgeChangeSetDigest(proposal),
    });
    expect(validator.calls).toBe(0);
  });

  it("fails closed on false flags, error diagnostics, malformed output, and excess diagnostics", async () => {
    const proposal = createProposal([createUpdate()]);
    const observations = createObservations(proposal);
    const plan = createKnowledgeReviewPlan(proposal, observations);
    const command = createCommand(plan, [{ changeId: "change-update", decision: "accept_exact" }]);
    const payloads: unknown[] = [
      {
        validation: { okfValid: false, citationsValid: true, linksValid: true },
        diagnostics: [],
      },
      {
        validation: { okfValid: true, citationsValid: true, linksValid: true },
        diagnostics: [
          { code: "invalid", severity: "error", field: "candidate", message: "Invalid" },
        ],
      },
      { unexpected: true },
      {
        validation: { okfValid: true, citationsValid: true, linksValid: true },
        diagnostics: Array.from({ length: 257 }, (_, index) => ({
          code: `warning_${index}`,
          severity: "warning",
          field: "candidate",
          message: "Warning",
        })),
      },
    ];

    for (const payload of payloads) {
      const service = new KnowledgeReviewDecisionService(
        new FakeReviewValidator(async () => payload)
      );
      const result = await service.decide(
        proposal,
        observations,
        command,
        new AbortController().signal
      );
      expect(result.kind).toBe("blocked");
    }
  });

  it("sanitizes dependency failures and abort reasons", async () => {
    const proposal = createProposal([createUpdate()]);
    const observations = createObservations(proposal);
    const plan = createKnowledgeReviewPlan(proposal, observations);
    const command = createCommand(plan, [{ changeId: "change-update", decision: "accept_exact" }]);
    const infrastructureService = new KnowledgeReviewDecisionService(
      new FakeReviewValidator(async () => {
        throw new Error("private validator payload");
      })
    );

    let infrastructureError: unknown;
    try {
      await infrastructureService.decide(
        proposal,
        observations,
        command,
        new AbortController().signal
      );
    } catch (error) {
      infrastructureError = error;
    }
    expect(infrastructureError).toBeInstanceOf(KnowledgeReviewInfrastructureError);
    expect(String(infrastructureError)).not.toContain("private validator payload");

    const controller = new AbortController();
    controller.abort("private abort payload");
    const abortService = new KnowledgeReviewDecisionService(
      new FakeReviewValidator(validCandidate)
    );
    let abortError: unknown;
    try {
      await abortService.decide(proposal, observations, command, controller.signal);
    } catch (error) {
      abortError = error;
    }
    expect(abortError).toBeInstanceOf(KnowledgeReviewAbortError);
    expect(String(abortError)).not.toContain("private abort payload");
  });
});
