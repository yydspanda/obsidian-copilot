import {
  KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS,
  KnowledgeForwardRevisionProposalValidationError,
  createKnowledgeForwardRevisionPendingProposalRecord,
  createKnowledgeForwardRevisionPendingProposalRecordDigest,
  createKnowledgeForwardRevisionPublicationReceipt,
  createKnowledgeForwardRevisionPublicationReceiptDigest,
  createKnowledgeForwardRevisionRequest,
  createKnowledgeForwardRevisionRequestDigest,
  snapshotKnowledgeForwardRevisionPendingProposalRecord,
  snapshotKnowledgeForwardRevisionPublicationReceipt,
  snapshotKnowledgeForwardRevisionRequest,
  type CreateKnowledgeForwardRevisionRequestInput,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import {
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";
import { createFileContentHash } from "@/knowledge/model/fingerprint";

const HISTORICAL_CONTENT = "# Historical accepted output\n";
const HASH_SELECTED = createFileContentHash(HISTORICAL_CONTENT);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);

/** Creates one strict R3c-a intent for durable proposal tests. */
function createIntent(selectedContentHash = HASH_SELECTED) {
  return createKnowledgeForwardRevisionIntent({
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    historical: {
      bundleId: "personal",
      pagePath: "Wiki/Topic.md",
      transactionId: "transaction-historical",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: "changeset-historical",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: 100,
      selectedContentHash,
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
      manifestDigest: HASH_D,
      manifestBaseHash: HASH_A,
      vaultObservedBeforeHash: HASH_A,
    },
  });
}

/** Creates complete Runtime-projected request facts. */
function createRequestInput(): CreateKnowledgeForwardRevisionRequestInput {
  const intent = createIntent();
  return {
    requestRevision: 11,
    runtimeId: "runtime-1",
    bundleId: intent.bundleId,
    pagePath: intent.pagePath,
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      proposalDigest: HASH_B,
      acceptedDigest: intent.historical.changeSetDigest,
      acceptedRecordRevision: 1,
      manifestCommitIntentDigest: intent.historical.manifestIntentDigest,
      acceptedAt: 90,
      targetChange: {
        changeId: "change-historical",
        path: intent.pagePath,
        operation: "update",
        afterHash: HASH_SELECTED,
        sourceRefs: ["source-1"],
      },
      manifestPage: {
        path: intent.pagePath,
        ownership: "generated",
        contentHash: HASH_SELECTED,
      },
    },
    selectedContent: HISTORICAL_CONTENT,
    selectedContentHash: HASH_SELECTED,
    requestedAt: 120,
  };
}

/** Rebuilds every correlated selected-content proof for one exact candidate. */
function createRequestInputForContent(
  selectedContent: string
): CreateKnowledgeForwardRevisionRequestInput {
  const selectedContentHash = createFileContentHash(selectedContent);
  const intent = createIntent(selectedContentHash);
  const original = createRequestInput();
  return {
    ...original,
    intent,
    intentDigest: createKnowledgeForwardRevisionIntentDigest(intent),
    historicalReviewAuthority: {
      ...original.historicalReviewAuthority,
      acceptedDigest: intent.historical.changeSetDigest,
      manifestCommitIntentDigest: intent.historical.manifestIntentDigest,
      targetChange: {
        ...original.historicalReviewAuthority.targetChange,
        afterHash: selectedContentHash,
      },
      manifestPage: {
        ...original.historicalReviewAuthority.manifestPage,
        contentHash: selectedContentHash,
      },
    },
    selectedContent,
    selectedContentHash,
  };
}

/** Produces a JSON-detached mutable clone for hostile mutations. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("KnowledgeForwardRevisionProposal", () => {
  it("derives stable canonical request, proposal, and receipt identities", () => {
    const request = createKnowledgeForwardRevisionRequest(createRequestInput());
    const proposal = createKnowledgeForwardRevisionPendingProposalRecord({
      request,
      recordedAt: request.requestedAt,
    });
    const published = createKnowledgeForwardRevisionPublicationReceipt({
      outcome: "published",
      proposal,
      runtimeRevision: 15,
      proposalStoreRevision: 11,
    });
    const replay = createKnowledgeForwardRevisionPublicationReceipt({
      outcome: "already_published",
      proposal,
      runtimeRevision: 15,
      proposalStoreRevision: 11,
    });

    expect(request.requestId).toMatch(/^forward-revision-request-[a-f0-9]{64}$/);
    expect(proposal.proposalId).toMatch(/^forward-revision-proposal-[a-f0-9]{64}$/);
    expect(published.publicationId).toMatch(/^forward-revision-publication-[a-f0-9]{64}$/);
    expect(replay.publicationId).toBe(published.publicationId);
    expect(
      createKnowledgeForwardRevisionPublicationReceipt({
        outcome: "already_published",
        proposal,
        runtimeRevision: 16,
        proposalStoreRevision: 11,
      }).publicationId
    ).not.toBe(published.publicationId);
    expect(createKnowledgeForwardRevisionRequestDigest(request)).toHaveLength(64);
    expect(createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal)).toHaveLength(64);
    expect(createKnowledgeForwardRevisionPublicationReceiptDigest(published)).not.toBe(
      createKnowledgeForwardRevisionPublicationReceiptDigest(replay)
    );
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.intent)).toBe(true);
    expect(Object.isFrozen(request.historicalReviewAuthority.targetChange.sourceRefs)).toBe(true);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(published)).toBe(true);
  });

  it("rejects stale derived ids and all digest substitution", () => {
    const request = createKnowledgeForwardRevisionRequest(createRequestInput());
    const forgedRequest = clone(request) as { requestId: string };
    forgedRequest.requestId = `forward-revision-request-${HASH_A}`;
    expect(() => snapshotKnowledgeForwardRevisionRequest(forgedRequest)).toThrow(
      KnowledgeForwardRevisionProposalValidationError
    );

    const proposal = createKnowledgeForwardRevisionPendingProposalRecord({
      request,
      recordedAt: request.requestedAt,
    });
    const forgedProposal = clone(proposal) as { requestDigest: string };
    forgedProposal.requestDigest = HASH_A;
    expect(() => snapshotKnowledgeForwardRevisionPendingProposalRecord(forgedProposal)).toThrow(
      KnowledgeForwardRevisionProposalValidationError
    );

    const receipt = createKnowledgeForwardRevisionPublicationReceipt({
      outcome: "published",
      proposal,
      runtimeRevision: 15,
      proposalStoreRevision: 11,
    });
    const forgedReceipt = clone(receipt) as { proposalDigest: string };
    forgedReceipt.proposalDigest = HASH_A;
    expect(() => snapshotKnowledgeForwardRevisionPublicationReceipt(forgedReceipt)).toThrow(
      KnowledgeForwardRevisionProposalValidationError
    );
  });

  it("rejects impossible publication revision ordering", () => {
    const request = createKnowledgeForwardRevisionRequest(createRequestInput());
    const proposal = createKnowledgeForwardRevisionPendingProposalRecord({
      request,
      recordedAt: request.requestedAt,
    });

    for (const revisions of [
      { runtimeRevision: 15, proposalStoreRevision: 10 },
      { runtimeRevision: 10, proposalStoreRevision: 11 },
    ]) {
      expect(() =>
        createKnowledgeForwardRevisionPublicationReceipt({
          outcome: "published",
          proposal,
          ...revisions,
        })
      ).toThrow(KnowledgeForwardRevisionProposalValidationError);
    }

    const receipt = createKnowledgeForwardRevisionPublicationReceipt({
      outcome: "published",
      proposal,
      runtimeRevision: 15,
      proposalStoreRevision: 11,
    });
    for (const mutation of [
      { requestRevision: 12 },
      { runtimeRevision: 10 },
      { proposalStoreRevision: 10 },
    ]) {
      expect(() =>
        snapshotKnowledgeForwardRevisionPublicationReceipt({ ...receipt, ...mutation })
      ).toThrow(KnowledgeForwardRevisionProposalValidationError);
    }
  });

  it("requires historical bytes and sole generated historical authority", () => {
    const input = createRequestInput();
    const candidates: unknown[] = [
      { ...input, selectedContent: `${input.selectedContent}changed` },
      { ...input, selectedContentHash: HASH_A },
      {
        ...input,
        historicalReviewAuthority: {
          ...input.historicalReviewAuthority,
          acceptedDigest: HASH_A,
        },
      },
      {
        ...input,
        historicalReviewAuthority: {
          ...input.historicalReviewAuthority,
          targetChange: {
            ...input.historicalReviewAuthority.targetChange,
            sourceRefs: ["source-1", "source-2"],
          },
        },
      },
      {
        ...input,
        historicalReviewAuthority: {
          ...input.historicalReviewAuthority,
          manifestPage: {
            ...input.historicalReviewAuthority.manifestPage,
            ownership: "shared",
          },
        },
      },
      {
        ...input,
        historicalReviewAuthority: {
          ...input.historicalReviewAuthority,
          targetChange: {
            ...input.historicalReviewAuthority.targetChange,
            operation: "delete",
          },
        },
      },
    ];
    for (const candidate of candidates) {
      expect(() =>
        createKnowledgeForwardRevisionRequest(
          candidate as CreateKnowledgeForwardRevisionRequestInput
        )
      ).toThrow(KnowledgeForwardRevisionProposalValidationError);
    }
  });

  it("enforces independent positive request revision and monotonic Runtime timestamps", () => {
    const input = createRequestInput();
    for (const candidate of [
      { ...input, requestRevision: 0 },
      { ...input, requestedAt: input.intent.historical.appliedAt - 1 },
    ]) {
      expect(() => createKnowledgeForwardRevisionRequest(candidate)).toThrow(
        KnowledgeForwardRevisionProposalValidationError
      );
    }
    const request = createKnowledgeForwardRevisionRequest(input);
    expect(() =>
      createKnowledgeForwardRevisionPendingProposalRecord({
        request,
        recordedAt: request.requestedAt - 1,
      })
    ).toThrow(KnowledgeForwardRevisionProposalValidationError);
  });

  it("enforces both candidate content character and UTF-8 byte caps", () => {
    const exactCharacterLimit = "x".repeat(
      KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentCharacters
    );
    expect(() =>
      createKnowledgeForwardRevisionRequest(createRequestInputForContent(exactCharacterLimit))
    ).not.toThrow();

    const oversizedCharacters = "x".repeat(
      KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentCharacters + 1
    );
    expect(() =>
      createKnowledgeForwardRevisionRequest(createRequestInputForContent(oversizedCharacters))
    ).toThrow(KnowledgeForwardRevisionProposalValidationError);

    const withinByteCap = "汉".repeat(1_000);
    expect(new TextEncoder().encode(withinByteCap).byteLength).toBe(withinByteCap.length * 3);
    expect(withinByteCap.length * 3).toBeLessThanOrEqual(
      KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentBytes
    );
    expect(
      KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentCharacters * 3
    ).toBeLessThanOrEqual(KNOWLEDGE_FORWARD_REVISION_PROPOSAL_LIMITS.maxSelectedContentBytes);
  });

  it("never invokes accessors and accepts detached null-prototype records", () => {
    const input = createRequestInput();
    let getterCalls = 0;
    const accessor = { ...input } as Record<string, unknown>;
    Object.defineProperty(accessor, "runtimeId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "runtime-1";
      },
    });
    expect(() =>
      createKnowledgeForwardRevisionRequest(accessor as CreateKnowledgeForwardRevisionRequestInput)
    ).toThrow(KnowledgeForwardRevisionProposalValidationError);
    expect(getterCalls).toBe(0);

    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, input);
    const request = createKnowledgeForwardRevisionRequest(nullPrototype);
    expect(Object.getPrototypeOf(request)).toBe(Object.prototype);
  });

  it("sanitizes caller-created, subclassed, forged, and Proxy-thrown errors", () => {
    class ForgedError extends KnowledgeForwardRevisionProposalValidationError {}
    const callerError = new ForgedError();
    const forged = Object.create(
      KnowledgeForwardRevisionProposalValidationError.prototype
    ) as KnowledgeForwardRevisionProposalValidationError;
    const request = createKnowledgeForwardRevisionRequest(createRequestInput());
    for (const injected of [callerError, forged, new TypeError("private caller text")]) {
      const hostile = new Proxy(request, {
        getPrototypeOf: () => {
          throw injected;
        },
      });
      let observed: unknown;
      try {
        snapshotKnowledgeForwardRevisionRequest(hostile);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(KnowledgeForwardRevisionProposalValidationError);
      expect(observed).not.toBe(injected);
      expect(observed).toMatchObject({
        name: "KnowledgeForwardRevisionProposalValidationError",
        message: "Forward revision durable proposal material is invalid",
      });
      expect(Object.isFrozen(observed)).toBe(true);
    }

    const revoked = Proxy.revocable(request, {});
    revoked.revoke();
    expect(() => snapshotKnowledgeForwardRevisionRequest(revoked.proxy)).toThrow(
      KnowledgeForwardRevisionProposalValidationError
    );
  });

  it("rejects unknown keys, sparse source refs, Unicode controls, and lone surrogates", () => {
    const input = createRequestInput();
    expect(() => createKnowledgeForwardRevisionRequest({ ...input, extra: true } as never)).toThrow(
      KnowledgeForwardRevisionProposalValidationError
    );

    const sparse = new Array<string>(1);
    for (const sourceRefs of [sparse, ["source\u0085"], ["source\ud800"], ["source\udc00"]]) {
      expect(() =>
        createKnowledgeForwardRevisionRequest({
          ...input,
          historicalReviewAuthority: {
            ...input.historicalReviewAuthority,
            targetChange: { ...input.historicalReviewAuthority.targetChange, sourceRefs },
          },
        } as unknown as CreateKnowledgeForwardRevisionRequestInput)
      ).toThrow(KnowledgeForwardRevisionProposalValidationError);
    }
  });
});
