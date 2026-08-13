import {
  KnowledgeForwardRevisionReviewCommandValidationError,
  createKnowledgeForwardRevisionReviewCommand,
  createKnowledgeForwardRevisionReviewCommandDigest,
  snapshotKnowledgeForwardRevisionReviewCommand,
  snapshotKnowledgeForwardRevisionReviewCommandForProposal,
  validateKnowledgeForwardRevisionReviewCommand,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  createKnowledgeForwardRevisionRequest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";

const HISTORICAL_CONTENT = "# Historical output\n";
const CURRENT_CONTENT = "# Current output\n";
const HISTORICAL_HASH = createFileContentHash(HISTORICAL_CONTENT);
const CURRENT_HASH = createFileContentHash(CURRENT_CONTENT);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

/** Creates one canonical pending proposal to which commands must rejoin. */
function createProposal(transactionId = "transaction-historical") {
  const intent = createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    historical: {
      bundleId: "personal",
      pagePath: "Wiki/Topic.md",
      transactionId,
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: `changeset-${transactionId}`,
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: 100,
      selectedContentHash: HISTORICAL_HASH,
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
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_F,
      manifestBaseHash: CURRENT_HASH,
      vaultObservedBeforeHash: CURRENT_HASH,
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
        operation: "update",
        afterHash: HISTORICAL_HASH,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: "Wiki/Topic.md",
        ownership: "generated",
        contentHash: HISTORICAL_HASH,
      },
    },
    selectedContent: HISTORICAL_CONTENT,
    selectedContentHash: HISTORICAL_HASH,
    requestedAt: 120,
  });
  return createKnowledgeForwardRevisionPendingProposalRecord({ request, recordedAt: 120 });
}

/** Creates a mutable JSON clone for hostile persisted-command checks. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("KnowledgeForwardRevisionReviewCommand", () => {
  it("creates exact-accept and reject commands without caller authority or body fields", () => {
    const proposal = createProposal();
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);

    for (const action of ["accept_exact", "reject"] as const) {
      const command = createKnowledgeForwardRevisionReviewCommand({
        action,
        proposal,
        proposalDigest,
      });
      expect(command).toMatchObject({
        action,
        runtimeId: "runtime-1",
        bundleId: "personal",
        pagePath: "Wiki/Topic.md",
        proposalId: proposal.proposalId,
        proposalDigest,
        requestId: proposal.request.requestId,
        requestDigest: proposal.requestDigest,
        intentId: proposal.request.intent.intentId,
        intentDigest: proposal.request.intentDigest,
        expectedRecordRevision: 0,
      });
      expect("afterContent" in command).toBe(false);
      expect("acceptanceAuthority" in command).toBe(false);
      expect(command.commandId).toMatch(/^forward-revision-review-command-[a-f0-9]{64}$/);
      expect(createKnowledgeForwardRevisionReviewCommandDigest(command)).toHaveLength(64);
      expect(
        snapshotKnowledgeForwardRevisionReviewCommandForProposal(command, proposal, proposalDigest)
      ).toEqual(command);
    }
  });

  it("accepts edited exact bytes and derives their hash without normalization", () => {
    const proposal = createProposal();
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
    const afterContent = "# Edited\r\nCafe\u0301 🙂\tkept\n";
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_edited",
      proposal,
      proposalDigest,
      afterContent,
    });

    expect(command).toMatchObject({
      action: "accept_edited",
      expectedRecordRevision: 0,
      afterContent,
      afterContentHash: createFileContentHash(afterContent),
    });
    expect(Object.isFrozen(command)).toBe(true);
    expect(snapshotKnowledgeForwardRevisionReviewCommand(command)).toEqual(command);
  });

  it("keeps edited historical/current-base commands valid for Runtime semantic resolution", () => {
    const proposal = createProposal();
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);

    for (const afterContent of [HISTORICAL_CONTENT, CURRENT_CONTENT]) {
      const command = createKnowledgeForwardRevisionReviewCommand({
        action: "accept_edited",
        proposal,
        proposalDigest,
        afterContent,
      });
      expect(command).toMatchObject({
        action: "accept_edited",
        afterContentHash: createFileContentHash(afterContent),
      });
      expect(() =>
        snapshotKnowledgeForwardRevisionReviewCommandForProposal(command, proposal, proposalDigest)
      ).not.toThrow();
    }
    expect(() =>
      createKnowledgeForwardRevisionReviewCommand({
        action: "accept_exact",
        proposal,
        proposalDigest,
      })
    ).not.toThrow();
  });

  it("rejects unsupported controls and lone surrogates while allowing TAB/LF/CR", () => {
    const proposal = createProposal();
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
    for (const afterContent of ["bad\u0000", "bad\u000b", "bad\u0085", "bad\udc00"]) {
      expect(() =>
        createKnowledgeForwardRevisionReviewCommand({
          action: "accept_edited",
          proposal,
          proposalDigest,
          afterContent,
        })
      ).toThrow(KnowledgeForwardRevisionReviewCommandValidationError);
    }
    expect(() =>
      createKnowledgeForwardRevisionReviewCommand({
        action: "accept_edited",
        proposal,
        proposalDigest,
        afterContent: "valid\ttext\r\n🙂\n",
      })
    ).not.toThrow();
  });

  it("requires exact pending proposal identity before a command can reach Runtime CAS", () => {
    const proposal = createProposal();
    const other = createProposal("transaction-other");
    const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_exact",
      proposal,
      proposalDigest,
    });

    for (const [candidate, digest] of [
      [other, createKnowledgeForwardRevisionPendingProposalRecordDigest(other)],
      [proposal, HASH_A],
    ] as const) {
      expect(() =>
        snapshotKnowledgeForwardRevisionReviewCommandForProposal(command, candidate, digest)
      ).toThrow(KnowledgeForwardRevisionReviewCommandValidationError);
    }
  });

  it("detects action, revision, body, hash, identity, and command-id tampering", () => {
    const proposal = createProposal();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_edited",
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
      afterContent: "# Edited\n",
    });
    const mutations: ((value: Record<string, unknown>) => void)[] = [
      (value) => (value.expectedRecordRevision = 1),
      (value) => (value.afterContent = "# Changed\n"),
      (value) => (value.afterContentHash = HASH_A),
      (value) => (value.proposalDigest = HASH_A),
      (value) => (value.requestDigest = HASH_A),
      (value) => (value.commandId = "forward-revision-review-command-" + HASH_A),
    ];

    for (const mutate of mutations) {
      const candidate = clone(command) as unknown as Record<string, unknown>;
      mutate(candidate);
      expect(() => snapshotKnowledgeForwardRevisionReviewCommand(candidate)).toThrow(
        KnowledgeForwardRevisionReviewCommandValidationError
      );
    }
  });

  it("rejects accessors, extra keys, revoked proxies, and spoofed errors", () => {
    const proposal = createProposal();
    const command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_exact",
      proposal,
      proposalDigest: createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal),
    });
    const accessor = clone(command) as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(accessor, "proposalId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return proposal.proposalId;
      },
    });
    const revoked = Proxy.revocable(command, {});
    revoked.revoke();

    for (const value of [{ ...command, extra: true }, accessor, revoked.proxy]) {
      expect(() => snapshotKnowledgeForwardRevisionReviewCommand(value)).toThrow(
        KnowledgeForwardRevisionReviewCommandValidationError
      );
    }
    expect(getterCalls).toBe(0);

    const spoof = new KnowledgeForwardRevisionReviewCommandValidationError();
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw spoof;
        },
      }
    );
    let observed: unknown;
    try {
      snapshotKnowledgeForwardRevisionReviewCommand(hostile);
    } catch (error) {
      observed = error;
    }
    expect(observed).not.toBe(spoof);
    expect(Object.isFrozen(observed)).toBe(true);
  });

  it("returns closed deterministic validation without retaining invalid values", () => {
    const secret = "secret-user-value";
    const result = validateKnowledgeForwardRevisionReviewCommand({ secret });

    expect(result).toEqual({
      valid: false,
      diagnostics: [
        {
          code: "forward_revision_review_command_invalid",
          severity: "error",
          field: "forwardRevisionReviewCommand",
          message: "Forward revision Review command does not satisfy its strict contract",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
