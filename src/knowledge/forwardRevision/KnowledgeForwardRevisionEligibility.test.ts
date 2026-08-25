import {
  classifyKnowledgeForwardRevisionProtocolAdmission,
  type KnowledgeForwardRevisionProtocolAdmissionInput,
  type KnowledgeForwardRevisionProtocolIneligibilityReason,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionEligibility";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

/** Creates one eligible sole-owner generated-page fact set. */
function createInput(): KnowledgeForwardRevisionProtocolAdmissionInput {
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    historical: {
      bundleId: "personal",
      pagePath: "Wiki/Topic.md",
      transactionId: "transaction-previous",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 2,
      changeSetId: "changeset-previous",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_D,
      appliedAt: 100,
      selectedContentHash: HASH_B,
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
      inputRevision: 3,
      manifestRevision: 5,
      manifestDigest: HASH_C,
      manifestBaseHash: HASH_A,
      vaultObservedBeforeHash: HASH_A,
    },
  });
  return {
    intent,
    currentState: "applied",
    historicalDetail: "available",
    selectedContentHash: HASH_B,
    currentContentHash: HASH_A,
    manifestBaseHash: HASH_A,
    vaultObservedBeforeHash: HASH_A,
    ownership: "generated",
    sourceIds: ["source-1"],
    primarySourceId: "source-1",
    historicalSourceId: "source-1",
    historicalSourceContentHash: HASH_A,
    currentSourceContentHash: HASH_A,
    historicalPipelineFingerprint: HASH_B,
    currentPipelineFingerprint: HASH_B,
    historicalInputRevision: 2,
    currentInputRevision: 3,
    sourceOrigin: "ingest",
    sourceRetired: false,
    validation: "valid",
    pendingProposal: "none",
    blocker: "none",
  };
}

/** Requires one candidate to produce the exact closed ineligibility reason. */
function expectReason(
  candidate: unknown,
  reason: KnowledgeForwardRevisionProtocolIneligibilityReason
): void {
  expect(classifyKnowledgeForwardRevisionProtocolAdmission(candidate)).toEqual({
    eligible: false,
    reason,
  });
}

describe("classifyKnowledgeForwardRevisionProtocolAdmission", () => {
  it("admits only the exact first-release happy path", () => {
    const input = createInput();
    const intent = input.intent as ReturnType<typeof createKnowledgeForwardRevisionIntent>;
    const result = classifyKnowledgeForwardRevisionProtocolAdmission(input);
    expect(result).toEqual({
      eligible: true,
      intentId: intent.intentId,
      intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("admits an exact effective head layered over the immutable source base", () => {
    const input = createInput();
    const original = input.intent as ReturnType<typeof createKnowledgeForwardRevisionIntent>;
    const intent = createKnowledgeForwardRevisionIntent({
      bundleId: original.bundleId,
      pagePath: original.pagePath,
      historical: original.historical,
      current: { ...original.current, vaultObservedBeforeHash: HASH_D },
    });

    expect(
      classifyKnowledgeForwardRevisionProtocolAdmission({
        ...input,
        intent,
        currentContentHash: HASH_D,
        vaultObservedBeforeHash: HASH_D,
      })
    ).toMatchObject({ eligible: true, intentId: intent.intentId });
  });

  it.each<
    [
      string,
      Partial<KnowledgeForwardRevisionProtocolAdmissionInput>,
      KnowledgeForwardRevisionProtocolIneligibilityReason,
    ]
  >([
    [
      "drifted current",
      { currentState: "drifted", currentContentHash: HASH_B, vaultObservedBeforeHash: HASH_B },
      "current_drifted",
    ],
    [
      "drifted current restored to source base",
      { currentState: "drifted", currentContentHash: HASH_A, vaultObservedBeforeHash: HASH_A },
      "current_drifted",
    ],
    [
      "missing current",
      { currentState: "missing", currentContentHash: null, vaultObservedBeforeHash: null },
      "current_missing",
    ],
    ["stale history", { historicalDetail: "stale" }, "historical_stale"],
    ["large history", { historicalDetail: "too_large" }, "historical_too_large"],
    ["unavailable history", { historicalDetail: "unavailable" }, "historical_unavailable"],
    ["Manifest authority mismatch", { manifestBaseHash: HASH_B }, "intent_mismatch"],
    ["Vault hash drift", { vaultObservedBeforeHash: HASH_B }, "current_hash_unverified"],
    ["same selected output", { selectedContentHash: HASH_A }, "selected_is_current"],
    ["shared ownership", { ownership: "shared" }, "ownership_shared"],
    ["user ownership", { ownership: "user" }, "ownership_user"],
    ["multiple owners", { sourceIds: ["source-1", "source-2"] }, "source_ownership_unsupported"],
    ["wrong primary", { sourceIds: ["source-2"] }, "source_ownership_unsupported"],
    ["historical source changed", { historicalSourceId: "source-2" }, "historical_source_mismatch"],
    ["source content changed", { historicalSourceContentHash: HASH_B }, "source_content_mismatch"],
    ["pipeline changed", { historicalPipelineFingerprint: HASH_A }, "pipeline_mismatch"],
    ["source revision unchanged", { historicalInputRevision: 3 }, "source_revision_not_newer"],
    ["query origin", { sourceOrigin: "query_writeback" }, "source_origin_unsupported"],
    ["retired source", { sourceRetired: true }, "source_retired"],
    ["invalid validation", { validation: "invalid" }, "validation_failed"],
    ["unavailable validation", { validation: "unavailable" }, "validation_unavailable"],
    ["exact pending proposal", { pendingProposal: "exact" }, "proposal_already_pending"],
    ["conflicting proposal", { pendingProposal: "conflict" }, "proposal_conflict"],
    ["active source", { blocker: "source_busy" }, "source_busy"],
    ["active transaction", { blocker: "transaction_busy" }, "transaction_busy"],
    ["recovery gate", { blocker: "recovery_required" }, "recovery_required"],
    ["intent mismatch", { selectedContentHash: HASH_C }, "intent_mismatch"],
  ])("classifies %s with a closed reason", (_label, overrides, reason) => {
    expectReason({ ...createInput(), ...overrides }, reason);
  });

  it("uses stable fail-closed priority before later workflow facts", () => {
    expectReason(
      {
        ...createInput(),
        currentState: "drifted",
        currentContentHash: HASH_B,
        vaultObservedBeforeHash: HASH_B,
        historicalDetail: "stale",
        sourceRetired: true,
        blocker: "recovery_required",
      },
      "current_drifted"
    );
    expectReason(
      {
        ...createInput(),
        selectedContentHash: HASH_A,
        ownership: "shared",
        blocker: "source_busy",
      },
      "selected_is_current"
    );
  });

  it("rejects invalid shapes, duplicate sources, sparse arrays, accessors, and revoked proxies", () => {
    expectReason({ ...createInput(), extra: true }, "input_invalid");
    expectReason({ ...createInput(), sourceIds: ["source-1", "source-1"] }, "input_invalid");
    expectReason({ ...createInput(), selectedContentHash: "not-a-hash" }, "input_invalid");

    const sparse = new Array<string>(1);
    expectReason({ ...createInput(), sourceIds: sparse }, "input_invalid");

    let getterCalls = 0;
    const accessor = { ...createInput() } as Record<string, unknown>;
    Object.defineProperty(accessor, "blocker", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "none";
      },
    });
    expectReason(accessor, "input_invalid");
    expect(getterCalls).toBe(0);

    const revoked = Proxy.revocable(createInput(), {});
    revoked.revoke();
    expectReason(revoked.proxy, "input_invalid");
  });

  it("rejects contradictory current-state observation combinations", () => {
    const input = createInput();
    expectReason(
      {
        ...input,
        currentState: "missing",
        currentContentHash: HASH_A,
        vaultObservedBeforeHash: null,
      },
      "input_invalid"
    );
    expectReason(
      {
        ...input,
        currentState: "missing",
        currentContentHash: null,
        vaultObservedBeforeHash: HASH_A,
      },
      "input_invalid"
    );
    expectReason(
      {
        ...input,
        currentState: "drifted",
        currentContentHash: HASH_B,
        vaultObservedBeforeHash: null,
      },
      "input_invalid"
    );
    expectReason(
      {
        ...input,
        currentState: "drifted",
        currentContentHash: HASH_B,
        vaultObservedBeforeHash: HASH_C,
      },
      "input_invalid"
    );
    expectReason(
      {
        ...input,
        currentState: "applied",
        currentContentHash: null,
        vaultObservedBeforeHash: null,
      },
      "input_invalid"
    );
  });

  it("rejects control and unpaired-surrogate identifiers", () => {
    for (const invalid of ["source\u0000id", "source\u0085id", "source\ud800", "source\udc00"]) {
      expectReason({ ...createInput(), primarySourceId: invalid }, "input_invalid");
    }
  });

  it("returns shared deeply frozen closed result values", () => {
    const first = classifyKnowledgeForwardRevisionProtocolAdmission({
      ...createInput(),
      blocker: "source_busy",
    });
    const second = classifyKnowledgeForwardRevisionProtocolAdmission({
      ...createInput(),
      blocker: "source_busy",
    });
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
