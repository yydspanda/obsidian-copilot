import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import type { KnowledgeChangeSet, KnowledgeFileChange } from "@/knowledge/model/types";
import {
  compileKnowledgeReviewSelection,
  createKnowledgeReviewPlan,
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
function createProposal(changes: KnowledgeFileChange[]): KnowledgeChangeSet {
  return {
    id: "changeset-1",
    bundleId: "personal",
    operation: "ingest",
    sourceRefs: ["source-1"],
    changes,
    citations: [],
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

    for (const command of [accessorCommand, extraCommand, extraDecisionCommand]) {
      expect(() => snapshotKnowledgeReviewCommand(command)).toThrow(KnowledgeReviewDecisionError);
    }
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
