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
import {
  KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS,
  KnowledgeForwardRevisionValidationReceiptError,
  createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest,
  createKnowledgeForwardRevisionValidationReceipt,
  createKnowledgeForwardRevisionValidationReceiptDigest,
  parseKnowledgeForwardRevisionValidationReceipt,
  snapshotKnowledgeForwardRevisionValidationReceipt,
  snapshotKnowledgeForwardRevisionValidationReceiptForCandidate,
  validateKnowledgeForwardRevisionValidationReceipt,
  type CreateKnowledgeForwardRevisionValidationReceiptInput,
  type KnowledgeForwardRevisionValidationArtifactIdentityV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import * as validationReceiptModule from "@/knowledge/forwardRevision/KnowledgeForwardRevisionValidationReceipt";
import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation } from "@/knowledge/model/types";

const HISTORICAL_CONTENT = "# Historical output\n";
const CURRENT_CONTENT = "# Current output\n";
const EDITED_CONTENT = "# Edited output\r\nCafe\u0301 🙂\tkept\n";
const HISTORICAL_HASH = createFileContentHash(HISTORICAL_CONTENT);
const CURRENT_HASH = createFileContentHash(CURRENT_CONTENT);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);
const ARTIFACT_HASH = "1".repeat(64);

/** Creates one strict pending proposal fixture. */
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

/** Creates one coherent exact acceptance prestate. */
function createAuthority(): KnowledgeForwardRevisionAcceptanceAuthority {
  return {
    runtimeId: "runtime-1",
    runtimeRevision: 20,
    runtimeDigest: HASH_E,
    manifestRevision: 9,
    manifestDigest: HASH_F,
    manifestBaseHash: CURRENT_HASH,
    vaultObservedBeforeHash: CURRENT_HASH,
    currentSourceFreshness: {
      kind: "applied",
      runtimeId: "runtime-1",
      runtimeRevision: 20,
      runtimeDigest: HASH_E,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_F,
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

/** Creates one parser observation whose content identity differs from source bytes. */
function createArtifact(
  artifactId = "artifact-1",
  artifactContentHash = ARTIFACT_HASH
): KnowledgeForwardRevisionValidationArtifactIdentityV1 {
  return {
    version: 1,
    kind: "forward_revision_validation_artifact_identity",
    artifactKind: "markdown",
    sourceId: "source-1",
    artifactId,
    artifactContentHash,
  };
}

/** Creates one complete historical citation locator. */
function createCitation(
  citationId = "citation-1",
  artifactId = "artifact-1",
  artifactContentHash = ARTIFACT_HASH,
  excerpt = "Historical output"
): ClaimCitation {
  return {
    citationId,
    claimId: `claim-${citationId}`,
    relation: "supports",
    locator: {
      kind: "quote",
      sourceId: "source-1",
      artifactId,
      artifactContentHash,
      excerpt,
      quoteHash: createQuoteHash(excerpt),
      prefix: "before",
      suffix: "after",
    },
  };
}

/** Creates a valid receipt input and its exact correlation values. */
function createFixture(options?: {
  action?: "accept_exact" | "accept_edited";
  historicalCitations?: unknown[];
  validationReadSet?: unknown[];
  warningSummary?: unknown;
}) {
  const proposal = createProposal();
  const proposalDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(proposal);
  const action = options?.action ?? "accept_edited";
  const afterContent = action === "accept_exact" ? HISTORICAL_CONTENT : EDITED_CONTENT;
  const command = createKnowledgeForwardRevisionReviewCommand(
    action === "accept_exact"
      ? { action, proposal, proposalDigest }
      : { action, proposal, proposalDigest, afterContent }
  );
  const acceptanceAuthority = createAuthority();
  const historicalCitations = options?.historicalCitations ?? [createCitation()];
  const validationReadSet = options?.validationReadSet ?? [createArtifact()];
  const sourceArtifactObservationBindingDigest =
    createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
      acceptanceAuthority,
      validationReadSet
    );
  const input = {
    proposal,
    proposalDigest,
    command,
    afterContent,
    validation: { okfValid: true, citationsValid: true, linksValid: true },
    validationProfile: {
      version: 1,
      kind: "forward_revision_validation_profile",
      profileId: "profile-1",
      profileVersion: 2,
      profileConfigurationDigest: HASH_A,
      bundleConfigurationDigest: HASH_B,
      validatorImplementationId: "deterministic-validator",
      validatorImplementationVersion: 3,
      validatorImplementationDigest: HASH_D,
    },
    acceptanceAuthority,
    historicalCitations,
    validationReadSet,
    sourceArtifactObservationBindingDigest,
    warningSummary: options?.warningSummary ?? null,
    validatedAt: 140,
  } satisfies CreateKnowledgeForwardRevisionValidationReceiptInput;
  return { proposal, proposalDigest, command, afterContent, acceptanceAuthority, input };
}

/** Creates a mutable JSON clone for persisted-state tampering. */
type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

/** Creates a mutable JSON clone for adversarial persisted-state checks. */
function clone<T>(value: T): Mutable<T> {
  return JSON.parse(JSON.stringify(value)) as Mutable<T>;
}

/** Captures one thrown value without weakening its runtime type. */
function captureThrow(callback: () => unknown): unknown {
  try {
    callback();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("KnowledgeForwardRevisionValidationReceipt", () => {
  it("round-trips an exact edited candidate with full immutable correlation material", () => {
    const fixture = createFixture({
      warningSummary: {
        version: 1,
        kind: "forward_revision_validation_warning_summary",
        count: 2,
        digest: HASH_E,
      },
    });
    const receipt = createKnowledgeForwardRevisionValidationReceipt(fixture.input);

    expect(receipt).toMatchObject({
      version: 1,
      kind: "forward_revision_validation_receipt",
      runtimeId: "runtime-1",
      bundleId: "personal",
      pagePath: "Wiki/Topic.md",
      proposalId: fixture.proposal.proposalId,
      proposalDigest: fixture.proposalDigest,
      requestId: fixture.proposal.request.requestId,
      requestDigest: fixture.proposal.requestDigest,
      intentId: fixture.proposal.request.intent.intentId,
      intentDigest: fixture.proposal.request.intentDigest,
      commandId: fixture.command.commandId,
      action: "accept_edited",
      selectedHistoricalHash: HISTORICAL_HASH,
      acceptedAfterHash: createFileContentHash(EDITED_CONTENT),
      manualOverride: true,
      historicalAcceptedDigest: HASH_C,
      validatedAt: 140,
    });
    expect(receipt.receiptId).toBe(`forward-revision-validation-receipt-${receipt.receiptDigest}`);
    expect(createKnowledgeForwardRevisionValidationReceiptDigest(receipt)).toBe(
      receipt.receiptDigest
    );
    expect(receipt.validationReadSet[0].artifactContentHash).toBe(ARTIFACT_HASH);
    expect(receipt.validationReadSet[0].artifactContentHash).not.toBe(HASH_A);
    expect(receipt.historicalCitations[0]).toEqual(createCitation());
    expect("afterContent" in receipt).toBe(false);
    expect("capability" in receipt).toBe(false);
    expect(Object.keys(validationReceiptModule).some((key) => /capability|mint/i.test(key))).toBe(
      false
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.acceptanceAuthority.currentSourceFreshness)).toBe(true);
    expect(Object.isFrozen(receipt.historicalCitations)).toBe(true);
    expect(Object.isFrozen(receipt.historicalCitations[0].locator)).toBe(true);
    expect(Object.isFrozen(receipt.validationReadSet)).toBe(true);

    expect(snapshotKnowledgeForwardRevisionValidationReceipt(clone(receipt))).toEqual(receipt);
    expect(
      snapshotKnowledgeForwardRevisionValidationReceiptForCandidate(
        receipt,
        fixture.proposal,
        fixture.proposalDigest,
        fixture.command,
        fixture.afterContent
      )
    ).toEqual(receipt);
    expect(parseKnowledgeForwardRevisionValidationReceipt(receipt)).toEqual({
      ok: true,
      value: receipt,
    });
    expect(validateKnowledgeForwardRevisionValidationReceipt(receipt)).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("supports exact acceptance and an empty structural historical citation set", () => {
    const fixture = createFixture({ action: "accept_exact", historicalCitations: [] });
    const receipt = createKnowledgeForwardRevisionValidationReceipt(fixture.input);

    expect(receipt.action).toBe("accept_exact");
    expect(receipt.acceptedAfterHash).toBe(HISTORICAL_HASH);
    expect(receipt.manualOverride).toBe(false);
    expect(receipt.historicalCitations).toEqual([]);
    expect(receipt.historicalCitationSetDigest).toHaveLength(64);
  });

  it("preserves accepted citation order while canonicalizing read-set artifacts", () => {
    const citations = [
      createCitation("citation-z", "artifact-z", "2".repeat(64)),
      createCitation("citation-a", "artifact-a", "3".repeat(64)),
    ];
    const artifacts = [
      createArtifact("artifact-z", "2".repeat(64)),
      createArtifact("artifact-a", "3".repeat(64)),
    ];
    const fixture = createFixture({
      historicalCitations: citations,
      validationReadSet: artifacts,
    });
    const receipt = createKnowledgeForwardRevisionValidationReceipt(fixture.input);

    expect(receipt.historicalCitations.map((value) => value.citationId)).toEqual([
      "citation-z",
      "citation-a",
    ]);
    expect(receipt.validationReadSet.map((value) => value.artifactId)).toEqual([
      "artifact-a",
      "artifact-z",
    ]);

    const duplicateCitation = createFixture();
    duplicateCitation.input.historicalCitations = [
      createCitation("citation-1"),
      createCitation("citation-1", "artifact-2", "2".repeat(64)),
    ];
    expect(() => createKnowledgeForwardRevisionValidationReceipt(duplicateCitation.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );

    const duplicateArtifact = createFixture();
    duplicateArtifact.input.validationReadSet = [
      createArtifact("artifact-1", ARTIFACT_HASH),
      createArtifact("artifact-1", "2".repeat(64)),
    ];
    expect(() => createKnowledgeForwardRevisionValidationReceipt(duplicateArtifact.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
  });

  it("binds the full source freshness tuple and read-set without equating source and artifact hashes", () => {
    const authority = createAuthority();
    const readSet = [createArtifact()];
    const digest = createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
      authority,
      readSet
    );
    const changedAuthority = clone(authority);
    changedAuthority.currentSourceFreshness.completedAt += 1;
    const changedVaultAndManifestBase = clone(authority);
    changedVaultAndManifestBase.manifestBaseHash = HASH_C;
    changedVaultAndManifestBase.vaultObservedBeforeHash = HASH_C;
    const changedArtifact = [createArtifact("artifact-1", "2".repeat(64))];

    expect(digest).not.toBe(
      createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        changedAuthority,
        readSet
      )
    );
    expect(digest).not.toBe(
      createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        changedVaultAndManifestBase,
        readSet
      )
    );
    expect(digest).not.toBe(
      createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        authority,
        changedArtifact
      )
    );

    const fixture = createFixture();
    fixture.input.sourceArtifactObservationBindingDigest = HASH_A;
    expect(() => createKnowledgeForwardRevisionValidationReceipt(fixture.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
  });

  it("requires all validation flags, an acceptance action, and a non-current-base candidate", () => {
    for (const key of ["okfValid", "citationsValid", "linksValid"] as const) {
      const fixture = createFixture();
      fixture.input.validation = {
        okfValid: true,
        citationsValid: true,
        linksValid: true,
        [key]: false,
      };
      expect(() => createKnowledgeForwardRevisionValidationReceipt(fixture.input)).toThrow(
        KnowledgeForwardRevisionValidationReceiptError
      );
    }

    const rejection = createFixture();
    rejection.input.command = createKnowledgeForwardRevisionReviewCommand({
      action: "reject",
      proposal: rejection.proposal,
      proposalDigest: rejection.proposalDigest,
    });
    expect(() => createKnowledgeForwardRevisionValidationReceipt(rejection.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );

    const currentBase = createFixture();
    currentBase.input.command = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_edited",
      proposal: currentBase.proposal,
      proposalDigest: currentBase.proposalDigest,
      afterContent: CURRENT_CONTENT,
    });
    currentBase.input.afterContent = CURRENT_CONTENT;
    expect(() => createKnowledgeForwardRevisionValidationReceipt(currentBase.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
  });

  it("requires every complete historical locator to join the actual validation read-set", () => {
    const missing = createFixture({ validationReadSet: [createArtifact("artifact-other")] });
    expect(() => createKnowledgeForwardRevisionValidationReceipt(missing.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );

    const emptyReadSet = createFixture();
    emptyReadSet.input.validationReadSet = [];
    expect(() => createKnowledgeForwardRevisionValidationReceipt(emptyReadSet.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );

    for (const excerpt of ["bad\u0000text", "bad\u0085text", "bad\udc00text"]) {
      const fixture = createFixture();
      fixture.input.historicalCitations = [
        createCitation("citation-1", "artifact-1", ARTIFACT_HASH, excerpt),
      ];
      expect(() => createKnowledgeForwardRevisionValidationReceipt(fixture.input)).toThrow(
        KnowledgeForwardRevisionValidationReceiptError
      );
    }
    const badQuote = createFixture();
    const citation = clone(createCitation());
    citation.locator.quoteHash = HASH_A;
    badQuote.input.historicalCitations = [citation];
    expect(() => createKnowledgeForwardRevisionValidationReceipt(badQuote.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
  });

  it("rejects candidate substitution while permitting a coherent structural Runtime advance", () => {
    const fixture = createFixture();
    const receipt = createKnowledgeForwardRevisionValidationReceipt(fixture.input);
    const otherProposal = createProposal("transaction-other");
    const otherDigest = createKnowledgeForwardRevisionPendingProposalRecordDigest(otherProposal);
    const otherCommand = createKnowledgeForwardRevisionReviewCommand({
      action: "accept_edited",
      proposal: otherProposal,
      proposalDigest: otherDigest,
      afterContent: EDITED_CONTENT,
    });

    expect(() =>
      snapshotKnowledgeForwardRevisionValidationReceiptForCandidate(
        receipt,
        otherProposal,
        otherDigest,
        otherCommand,
        EDITED_CONTENT
      )
    ).toThrow(KnowledgeForwardRevisionValidationReceiptError);
    expect(() =>
      snapshotKnowledgeForwardRevisionValidationReceiptForCandidate(
        receipt,
        fixture.proposal,
        fixture.proposalDigest,
        fixture.command,
        `${EDITED_CONTENT}changed`
      )
    ).toThrow(KnowledgeForwardRevisionValidationReceiptError);

    const advanced = createFixture();
    const authority = clone(advanced.acceptanceAuthority);
    authority.runtimeRevision += 1;
    authority.currentSourceFreshness.runtimeRevision += 1;
    advanced.input.acceptanceAuthority = authority;
    advanced.input.sourceArtifactObservationBindingDigest =
      createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        authority,
        advanced.input.validationReadSet
      );
    const advancedReceipt = createKnowledgeForwardRevisionValidationReceipt(advanced.input);
    expect(advancedReceipt.receiptDigest).not.toBe(receipt.receiptDigest);
    expect(advancedReceipt.acceptanceAuthority.runtimeRevision).toBe(21);

    const staleBinding = createFixture();
    staleBinding.input.acceptanceAuthority = authority;
    expect(() => createKnowledgeForwardRevisionValidationReceipt(staleBinding.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );

    const substitutedSource = createFixture();
    const sourceAuthority = clone(substitutedSource.acceptanceAuthority);
    sourceAuthority.currentSourceFreshness.pipelineFingerprint = HASH_A;
    substitutedSource.input.acceptanceAuthority = sourceAuthority;
    substitutedSource.input.sourceArtifactObservationBindingDigest =
      createKnowledgeForwardRevisionSourceArtifactObservationBindingDigest(
        sourceAuthority,
        substitutedSource.input.validationReadSet
      );
    expect(() => createKnowledgeForwardRevisionValidationReceipt(substitutedSource.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
  });

  it("rejects exact-key, digest, id, profile, warning, and canonical-order tampering", () => {
    const receipt = createKnowledgeForwardRevisionValidationReceipt(createFixture().input);
    const mutations: ((value: Record<string, unknown>) => void)[] = [
      (value) => {
        value.extra = true;
      },
      (value) => {
        delete value.commandDigest;
      },
      (value) => {
        value.receiptDigest = HASH_A;
      },
      (value) => {
        value.receiptId = `forward-revision-validation-receipt-${HASH_A}`;
      },
      (value) => {
        (value.validationProfile as Record<string, unknown>).validatorImplementationVersion = 0;
      },
      (value) => {
        value.warningSummary = {
          version: 1,
          kind: "forward_revision_validation_warning_summary",
          count: 0,
          digest: HASH_A,
        };
      },
    ];
    for (const mutate of mutations) {
      const candidate = clone(receipt) as unknown as Record<string, unknown>;
      mutate(candidate);
      expect(() => snapshotKnowledgeForwardRevisionValidationReceipt(candidate)).toThrow(
        KnowledgeForwardRevisionValidationReceiptError
      );
    }

    const multi = createFixture({
      historicalCitations: [
        createCitation("citation-z", "artifact-z", "2".repeat(64)),
        createCitation("citation-a", "artifact-a", "3".repeat(64)),
      ],
      validationReadSet: [
        createArtifact("artifact-z", "2".repeat(64)),
        createArtifact("artifact-a", "3".repeat(64)),
      ],
    });
    const persisted = clone(createKnowledgeForwardRevisionValidationReceipt(multi.input));
    persisted.validationReadSet.reverse();
    expect(() => snapshotKnowledgeForwardRevisionValidationReceipt(persisted)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
  });

  it("uses descriptor-safe snapshots and replaces hostile failures with authentic frozen errors", () => {
    const receipt = createKnowledgeForwardRevisionValidationReceipt(createFixture().input);
    const getterCandidate = clone(receipt) as unknown as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(getterCandidate, "receiptDigest", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return receipt.receiptDigest;
      },
    });
    expect(() => snapshotKnowledgeForwardRevisionValidationReceipt(getterCandidate)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
    expect(getterCalls).toBe(0);

    const fake = new KnowledgeForwardRevisionValidationReceiptError();
    const hostile = new Proxy(clone(receipt), {
      ownKeys() {
        throw fake;
      },
    });
    const caught = captureThrow(() => snapshotKnowledgeForwardRevisionValidationReceipt(hostile));
    expect(caught).toBeInstanceOf(KnowledgeForwardRevisionValidationReceiptError);
    expect(caught).not.toBe(fake);
    expect(Object.isFrozen(caught)).toBe(true);
    expect((caught as Error).message).toBe(
      "Forward revision validation receipt does not satisfy its strict contract"
    );

    const revoked = Proxy.revocable(clone(receipt), {});
    revoked.revoke();
    expect(() => snapshotKnowledgeForwardRevisionValidationReceipt(revoked.proxy)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
    expect(parseKnowledgeForwardRevisionValidationReceipt(hostile)).toEqual({
      ok: false,
      issues: [
        {
          code: "forward_revision_validation_receipt_invalid",
          severity: "error",
          field: "forwardRevisionValidationReceipt",
          message: "Forward revision validation receipt does not satisfy its strict contract",
        },
      ],
    });
  });

  it("stops deep evidence snapshotting immediately after the aggregate fence is crossed", () => {
    const largeExcerpt = "x".repeat(
      KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxLocatorTextCharacters - 1_000
    );
    let trailingTouches = 0;
    const trailing = new Proxy(createCitation("citation-4", "artifact-4", "4".repeat(64)), {
      ownKeys(target) {
        trailingTouches += 1;
        return Reflect.ownKeys(target);
      },
    });
    const fixture = createFixture();
    fixture.input.historicalCitations = [
      createCitation("citation-1", "artifact-1", ARTIFACT_HASH, largeExcerpt),
      createCitation("citation-2", "artifact-2", "2".repeat(64), largeExcerpt),
      createCitation("citation-3", "artifact-3", "3".repeat(64), "overflow".repeat(400)),
      trailing,
    ];

    expect(() => createKnowledgeForwardRevisionValidationReceipt(fixture.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
    expect(trailingTouches).toBe(0);

    const nearFenceCitation = createCitation(
      "citation-1",
      "artifact-1",
      ARTIFACT_HASH,
      "e".repeat(
        KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxLocatorTextCharacters - 150
      )
    );
    if (nearFenceCitation.locator.kind !== "quote") throw new Error("Expected quote fixture");
    nearFenceCitation.locator.prefix = "p".repeat(
      KNOWLEDGE_FORWARD_REVISION_VALIDATION_RECEIPT_LIMITS.maxLocatorTextCharacters - 150
    );
    let trailingArtifactTouches = 0;
    const trailingArtifact = new Proxy(createArtifact("artifact-trailing", "4".repeat(64)), {
      ownKeys(target) {
        trailingArtifactTouches += 1;
        return Reflect.ownKeys(target);
      },
    });
    const readSetFence = createFixture();
    readSetFence.input.historicalCitations = [nearFenceCitation];
    readSetFence.input.validationReadSet = [
      createArtifact(),
      createArtifact("a".repeat(1_024), "2".repeat(64)),
      trailingArtifact,
    ];

    expect(() => createKnowledgeForwardRevisionValidationReceipt(readSetFence.input)).toThrow(
      KnowledgeForwardRevisionValidationReceiptError
    );
    expect(trailingArtifactTouches).toBe(0);
  });

  it("detaches retained containers from later caller mutation", () => {
    const citation = createCitation();
    const artifact = createArtifact();
    const fixture = createFixture({
      historicalCitations: [citation],
      validationReadSet: [artifact],
    });
    const receipt = createKnowledgeForwardRevisionValidationReceipt(fixture.input);

    (citation as { claimId: string }).claimId = "mutated";
    (artifact as { artifactId: string }).artifactId = "mutated";
    (fixture.input.validationProfile as Record<string, unknown>).profileId = "mutated";

    expect(receipt.historicalCitations[0].claimId).toBe("claim-citation-1");
    expect(receipt.validationReadSet[0].artifactId).toBe("artifact-1");
    expect(receipt.validationProfile.profileId).toBe("profile-1");
  });
});
