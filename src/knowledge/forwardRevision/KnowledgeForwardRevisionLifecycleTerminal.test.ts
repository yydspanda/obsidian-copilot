import {
  KnowledgeForwardRevisionLifecycleTerminalValidationError,
  createKnowledgeForwardRevisionAbandonmentRecord,
  createKnowledgeForwardRevisionAbandonmentRecordDigest,
  createKnowledgeForwardRevisionAcceptedClaimIdentity,
  createKnowledgeForwardRevisionAcceptedClaimIdentityDigest,
  createKnowledgeForwardRevisionExternalObservation,
  createKnowledgeForwardRevisionLedgerLineageRef,
  createKnowledgeForwardRevisionLedgerLineageRefDigest,
  createKnowledgeForwardRevisionLifecycleResourceIdentity,
  createKnowledgeForwardRevisionLifecycleResourceIdentityDigest,
  createKnowledgeForwardRevisionRecoveryJournalRef,
  createKnowledgeForwardRevisionRecoveryJournalRefDigest,
  createKnowledgeForwardRevisionRecoveryTerminalRecord,
  createKnowledgeForwardRevisionRecoveryTerminalRecordDigest,
  createKnowledgeForwardRevisionSupersessionRecord,
  createKnowledgeForwardRevisionSupersessionRecordDigest,
  parseKnowledgeForwardRevisionAbandonmentRecord,
  parseKnowledgeForwardRevisionRecoveryTerminalRecord,
  parseKnowledgeForwardRevisionSupersessionRecord,
  snapshotKnowledgeForwardRevisionAbandonmentRecord,
  snapshotKnowledgeForwardRevisionAbandonmentRecordForReplay,
  snapshotKnowledgeForwardRevisionAcceptedClaimIdentity,
  snapshotKnowledgeForwardRevisionExternalObservation,
  snapshotKnowledgeForwardRevisionLedgerLineageRef,
  snapshotKnowledgeForwardRevisionLifecycleResourceIdentity,
  snapshotKnowledgeForwardRevisionRecoveryJournalRef,
  snapshotKnowledgeForwardRevisionRecoveryTerminalRecord,
  snapshotKnowledgeForwardRevisionRecoveryTerminalRecordForReplay,
  snapshotKnowledgeForwardRevisionSupersessionRecord,
  snapshotKnowledgeForwardRevisionSupersessionRecordForReplay,
  validateKnowledgeForwardRevisionAbandonmentRecord,
  validateKnowledgeForwardRevisionRecoveryTerminalRecord,
  validateKnowledgeForwardRevisionSupersessionRecord,
  type KnowledgeForwardRevisionLedgerLineageRefV1,
  type KnowledgeForwardRevisionRecoveryJournalRefV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionLifecycleTerminal";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

/** Creates one mutable JSON replay copy. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Creates the shared exact Runtime/Bundle/source/page identity. */
function createResource(pagePath = "Wiki/Topic.md") {
  return createKnowledgeForwardRevisionLifecycleResourceIdentity({
    runtimeId: "runtime-1",
    bundleId: "personal",
    sourceId: "source-1",
    pagePath,
  });
}

/** Creates one exact accepted decision and Apply-claim identity. */
function createAcceptedIdentity() {
  return createKnowledgeForwardRevisionAcceptedClaimIdentity({
    resource: createResource(),
    acceptedDecisionDigest: HASH_A,
    applyClaimId: `forward-revision-apply-claim-${HASH_E}`,
    applyClaimDigest: HASH_B,
    proposalId: `forward-revision-proposal-${HASH_F}`,
    proposalDigest: HASH_C,
    acceptedAfterHash: HASH_D,
    acceptedAt: 100,
  });
}

/** Creates a strict predecessor or successor ledger reference. */
function createLedgerRef(
  ledgerKind: KnowledgeForwardRevisionLedgerLineageRefV1["ledgerKind"],
  transactionId: string,
  ledgerIdentityDigest: string,
  casBeforeHash: string,
  afterHash: string,
  appliedAt: number,
  resource = createResource()
) {
  return createKnowledgeForwardRevisionLedgerLineageRef({
    ledgerKind,
    resource,
    transactionId,
    ledgerIdentityDigest,
    casBeforeHash,
    afterHash,
    appliedAt,
  });
}

/** Creates one coherent supersession input with a configurable successor kind. */
function createSupersessionInput(
  successorKind: KnowledgeForwardRevisionLedgerLineageRefV1["ledgerKind"] = "source_apply"
) {
  return {
    predecessor: createLedgerRef(
      "forward_revision_apply",
      "forward-transaction-1",
      HASH_A,
      HASH_B,
      HASH_C,
      200
    ),
    successor: createLedgerRef(
      successorKind,
      "successor-transaction-1",
      HASH_D,
      HASH_C,
      HASH_E,
      300
    ),
    supersededAt: 300,
  };
}

/** Creates one exact sticky-recovery journal reference. */
function createRecoveryJournal(
  journalRevision: 1 | 2 | 3
): Readonly<KnowledgeForwardRevisionRecoveryJournalRefV1> {
  const accepted = createAcceptedIdentity();
  return createKnowledgeForwardRevisionRecoveryJournalRef({
    resource: accepted.resource,
    transactionId: "forward-transaction-recovery",
    recoveryJournalDigest: HASH_E,
    journalRevision,
    acceptedDecisionDigest: accepted.acceptedDecisionDigest,
    applyClaimId: accepted.applyClaimId,
    applyClaimDigest: accepted.applyClaimDigest,
    beforeHash: HASH_C,
    afterHash: accepted.acceptedAfterHash,
    updatedAt: 400,
    ...(journalRevision === 3 ? { committedAt: 350 } : {}),
  } as Parameters<typeof createKnowledgeForwardRevisionRecoveryJournalRef>[0]);
}

/** Creates one coherent sticky-recovery terminal input. */
function createRecoveryTerminalInput(journalRevision: 1 | 2 | 3, actualHash = HASH_F) {
  return {
    acceptedIdentity: createAcceptedIdentity(),
    journal: createRecoveryJournal(journalRevision),
    observation: createKnowledgeForwardRevisionExternalObservation({
      actualKind: "file",
      actualHash,
      observedAt: 400,
    }),
    terminalizedAt: 401,
  };
}

describe("KnowledgeForwardRevisionLifecycleTerminal", () => {
  it.each(["forward_revision_apply", "source_apply"] as const)(
    "creates a frozen exact supersession lineage for a %s successor",
    (successorKind) => {
      const input = createSupersessionInput(successorKind);
      const record = createKnowledgeForwardRevisionSupersessionRecord(input);

      expect(record).toMatchObject({
        kind: "forward_revision_supersession_record",
        predecessor: {
          ledgerKind: "forward_revision_apply",
          afterHash: HASH_C,
          ledgerIdentityDigest: HASH_A,
        },
        successor: {
          ledgerKind: successorKind,
          casBeforeHash: HASH_C,
          ledgerIdentityDigest: HASH_D,
        },
        supersededAt: 300,
      });
      expect(record.supersessionId).toBe(
        `forward-revision-supersession-${record.supersessionDigest}`
      );
      expect(createKnowledgeForwardRevisionSupersessionRecordDigest(record)).toBe(
        record.supersessionDigest
      );
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.predecessor)).toBe(true);
      expect(Object.isFrozen(record.predecessor.resource)).toBe(true);
      expect(validateKnowledgeForwardRevisionSupersessionRecord(record)).toEqual({
        valid: true,
        diagnostics: [],
      });
    }
  );

  it("allows a byte-identical source Apply successor while changing durable provenance", () => {
    const input = createSupersessionInput("source_apply");
    const successor = createLedgerRef(
      "source_apply",
      input.successor.transactionId,
      input.successor.ledgerIdentityDigest,
      input.successor.casBeforeHash,
      input.successor.casBeforeHash,
      input.successor.appliedAt
    );

    expect(
      createKnowledgeForwardRevisionSupersessionRecord({
        ...input,
        successor,
      }).successor.afterHash
    ).toBe(HASH_C);
  });

  it("rejects broken supersession identity, hash, uniqueness, kind, and time invariants", () => {
    const input = createSupersessionInput();
    const otherResource = createKnowledgeForwardRevisionLifecycleResourceIdentity({
      runtimeId: "runtime-1",
      bundleId: "personal",
      sourceId: "source-2",
      pagePath: "Wiki/Topic.md",
    });
    const candidates = [
      {
        ...input,
        predecessor: createLedgerRef(
          "source_apply",
          "old-source-transaction",
          HASH_A,
          HASH_B,
          HASH_C,
          200
        ),
      },
      {
        ...input,
        successor: createLedgerRef(
          "source_apply",
          "other-source-transaction",
          HASH_D,
          HASH_C,
          HASH_E,
          300,
          otherResource
        ),
      },
      {
        ...input,
        successor: createLedgerRef(
          "source_apply",
          "hash-gap-transaction",
          HASH_D,
          HASH_B,
          HASH_E,
          300
        ),
      },
      {
        ...input,
        successor: createLedgerRef(
          "source_apply",
          input.predecessor.transactionId,
          HASH_D,
          HASH_C,
          HASH_E,
          300
        ),
      },
      {
        ...input,
        successor: createLedgerRef(
          "source_apply",
          "duplicate-ledger-digest",
          input.predecessor.ledgerIdentityDigest,
          HASH_C,
          HASH_E,
          300
        ),
      },
      { ...input, supersededAt: 301 },
      {
        ...input,
        successor: createLedgerRef("source_apply", "time-regression", HASH_D, HASH_C, HASH_E, 199),
        supersededAt: 199,
      },
    ];

    for (const candidate of candidates) {
      expect(() => createKnowledgeForwardRevisionSupersessionRecord(candidate)).toThrow(
        KnowledgeForwardRevisionLifecycleTerminalValidationError
      );
    }
    expect(() =>
      createLedgerRef("forward_revision_apply", "forward-noop", HASH_A, HASH_B, HASH_B, 300)
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
  });

  it("enforces canonical Windows-safe paths, bounded scalar identifiers, and derived keys", () => {
    const valid = createResource("Wiki/Élan.md");
    const wrongKey = { ...valid, windowsPathKey: "wiki/not-elan.md" };

    expect(valid.windowsPathKey).toBe("wiki/élan.md");
    expect(() => snapshotKnowledgeForwardRevisionLifecycleResourceIdentity(wrongKey)).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
    expect(() => createResource("Wiki/CON.md")).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
    expect(() => createResource("Wiki/\ud800.md")).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
    expect(() => createResource("Wiki/\u0085.md")).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
    expect(() =>
      createKnowledgeForwardRevisionLifecycleResourceIdentity({
        runtimeId: "runtime-1",
        bundleId: "personal",
        sourceId: "\ud800",
        pagePath: "Wiki/Topic.md",
      })
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
    expect(() =>
      createKnowledgeForwardRevisionLifecycleResourceIdentity({
        runtimeId: "x".repeat(257),
        bundleId: "personal",
        sourceId: "source-1",
        pagePath: "Wiki/Topic.md",
      })
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
    expect(() => createResource(`Wiki/${"x".repeat(1_024)}.md`)).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
  });

  it("domain-separates resource, ledger, accepted, journal, and record digests", () => {
    const input = createSupersessionInput();
    const supersession = createKnowledgeForwardRevisionSupersessionRecord(input);
    const accepted = createAcceptedIdentity();
    const journal = createRecoveryJournal(2);
    const digests = [
      createKnowledgeForwardRevisionLifecycleResourceIdentityDigest(input.predecessor.resource),
      createKnowledgeForwardRevisionLedgerLineageRefDigest(input.predecessor),
      createKnowledgeForwardRevisionAcceptedClaimIdentityDigest(accepted),
      createKnowledgeForwardRevisionRecoveryJournalRefDigest(journal),
      supersession.supersessionDigest,
    ];

    expect(new Set(digests).size).toBe(digests.length);
    expect(digests.every((digest) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
  });

  it("provides exact byte-semantic supersession replay equality", () => {
    const input = createSupersessionInput();
    const record = createKnowledgeForwardRevisionSupersessionRecord(input);

    expect(
      snapshotKnowledgeForwardRevisionSupersessionRecordForReplay(clone(record), clone(input))
    ).toEqual(record);
    expect(() =>
      snapshotKnowledgeForwardRevisionSupersessionRecordForReplay(record, {
        ...input,
        supersededAt: 301,
      })
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
  });

  it("creates accepted-not-started abandonment with explicit journal, ledger, and overlay absence", () => {
    const acceptedIdentity = createAcceptedIdentity();
    const record = createKnowledgeForwardRevisionAbandonmentRecord({
      acceptedIdentity,
      abandonedAt: 150,
    });

    expect(record).toMatchObject({
      outcome: "abandoned_before_write",
      journalIdentity: null,
      ledgerIdentityDigest: null,
      overlayLedgerIdentityDigest: null,
      vaultMutation: "none",
      abandonedAt: 150,
    });
    expect(record.abandonmentId).toBe(`forward-revision-abandonment-${record.abandonmentDigest}`);
    expect(createKnowledgeForwardRevisionAbandonmentRecordDigest(record)).toBe(
      record.abandonmentDigest
    );
    expect(Object.isFrozen(record.acceptedIdentity.resource)).toBe(true);
    expect(validateKnowledgeForwardRevisionAbandonmentRecord(record)).toEqual({
      valid: true,
      diagnostics: [],
    });
    expect(
      snapshotKnowledgeForwardRevisionAbandonmentRecordForReplay(clone(record), {
        acceptedIdentity,
        abandonedAt: 150,
      })
    ).toEqual(record);
  });

  it("rejects abandonment before acceptance or with fabricated write proof", () => {
    const acceptedIdentity = createAcceptedIdentity();
    expect(() =>
      createKnowledgeForwardRevisionAbandonmentRecord({ acceptedIdentity, abandonedAt: 99 })
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);

    const record = clone(
      createKnowledgeForwardRevisionAbandonmentRecord({ acceptedIdentity, abandonedAt: 150 })
    ) as Record<string, unknown>;
    record.ledgerIdentityDigest = HASH_E;
    expect(() => snapshotKnowledgeForwardRevisionAbandonmentRecord(record)).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
  });

  it("accepts only the bounded external observation union", () => {
    const observations = [
      createKnowledgeForwardRevisionExternalObservation({
        actualKind: "file",
        actualHash: HASH_A,
        observedAt: 10,
      }),
      createKnowledgeForwardRevisionExternalObservation({ actualKind: "missing", observedAt: 10 }),
      createKnowledgeForwardRevisionExternalObservation({
        actualKind: "directory",
        observedAt: 10,
      }),
      createKnowledgeForwardRevisionExternalObservation({
        actualKind: "oversized_file",
        observedAt: 10,
      }),
    ];

    expect(observations.map((value) => value.actualKind)).toEqual([
      "file",
      "missing",
      "directory",
      "oversized_file",
    ]);
    expect("actualHash" in observations[1]).toBe(false);
    expect(() =>
      snapshotKnowledgeForwardRevisionExternalObservation({
        version: 1,
        kind: "forward_revision_external_observation",
        actualKind: "file",
        observedAt: 10,
      })
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
    expect(() =>
      snapshotKnowledgeForwardRevisionExternalObservation({
        version: 1,
        kind: "forward_revision_external_observation",
        actualKind: "missing",
        actualHash: HASH_A,
        observedAt: 10,
      })
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
  });

  it.each([
    [1, "abandoned_before_write"],
    [2, "write_outcome_uncertain_external_supersession"],
    [3, "committed_then_external_supersession"],
  ] as const)("derives truthful sticky-recovery revision %s outcome", (revision, outcome) => {
    const input = createRecoveryTerminalInput(revision);
    const record = createKnowledgeForwardRevisionRecoveryTerminalRecord(input);

    expect(record.outcome).toBe(outcome);
    expect(record.vaultMutation).toBe("none");
    expect(record.journal.journalRevision).toBe(revision);
    expect(record.terminalizationId).toBe(
      `forward-revision-recovery-terminal-${record.terminalizationDigest}`
    );
    expect(createKnowledgeForwardRevisionRecoveryTerminalRecordDigest(record)).toBe(
      record.terminalizationDigest
    );
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.journal.resource)).toBe(true);
    expect(validateKnowledgeForwardRevisionRecoveryTerminalRecord(record)).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("enforces exact journal phase/revision/committed-time shapes", () => {
    const revisionOne = clone(createRecoveryJournal(1)) as Record<string, unknown>;
    revisionOne.committedAt = 300;
    const revisionThree = clone(createRecoveryJournal(3)) as Record<string, unknown>;
    delete revisionThree.committedAt;
    const committedAfterObservation = clone(createRecoveryJournal(3)) as Record<string, unknown>;
    committedAfterObservation.committedAt = 401;

    for (const candidate of [revisionOne, revisionThree, committedAfterObservation]) {
      expect(() => snapshotKnowledgeForwardRevisionRecoveryJournalRef(candidate)).toThrow(
        KnowledgeForwardRevisionLifecycleTerminalValidationError
      );
    }
  });

  it("rejects illegal recovery outcome, accepted identity, observation, and time combinations", () => {
    const input = createRecoveryTerminalInput(2);
    const valid = clone(createKnowledgeForwardRevisionRecoveryTerminalRecord(input)) as Record<
      string,
      unknown
    >;
    const wrongOutcome = { ...valid, outcome: "committed_then_external_supersession" };
    const wrongAccepted = {
      ...valid,
      acceptedIdentity: {
        ...(valid.acceptedIdentity as Record<string, unknown>),
        applyClaimDigest: HASH_F,
      },
    };
    const wrongObservationTime = {
      ...valid,
      observation: {
        ...(valid.observation as Record<string, unknown>),
        observedAt: 399,
      },
    };
    const earlyTerminal = { ...valid, terminalizedAt: 399 };

    for (const candidate of [wrongOutcome, wrongAccepted, wrongObservationTime, earlyTerminal]) {
      expect(() => snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(candidate)).toThrow(
        KnowledgeForwardRevisionLifecycleTerminalValidationError
      );
    }
  });

  it("requires external supersession hashes while allowing committed drift back to the base", () => {
    expect(() =>
      createKnowledgeForwardRevisionRecoveryTerminalRecord(createRecoveryTerminalInput(1, HASH_C))
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
    expect(() =>
      createKnowledgeForwardRevisionRecoveryTerminalRecord(createRecoveryTerminalInput(2, HASH_D))
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
    expect(
      createKnowledgeForwardRevisionRecoveryTerminalRecord(createRecoveryTerminalInput(3, HASH_C))
        .outcome
    ).toBe("committed_then_external_supersession");
  });

  it("provides exact recovery replay equality", () => {
    const input = createRecoveryTerminalInput(3);
    const record = createKnowledgeForwardRevisionRecoveryTerminalRecord(input);

    expect(
      snapshotKnowledgeForwardRevisionRecoveryTerminalRecordForReplay(clone(record), clone(input))
    ).toEqual(record);
    expect(() =>
      snapshotKnowledgeForwardRevisionRecoveryTerminalRecordForReplay(record, {
        ...input,
        terminalizedAt: 402,
      })
    ).toThrow(KnowledgeForwardRevisionLifecycleTerminalValidationError);
  });

  it("never invokes hostile accessors and fails closed for revoked or exotic records", () => {
    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "version", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const symbolic = { ...createResource(), [Symbol("hidden")]: true };

    expect(parseKnowledgeForwardRevisionSupersessionRecord(hostile)).toMatchObject({ ok: false });
    expect(parseKnowledgeForwardRevisionAbandonmentRecord(revoked.proxy)).toMatchObject({
      ok: false,
    });
    expect(() => snapshotKnowledgeForwardRevisionLifecycleResourceIdentity(symbolic)).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
    expect(getterCalls).toBe(0);
  });

  it("returns fixed detached diagnostics and sanitized frozen errors", () => {
    const malicious = "secret-vault-body";
    const first = parseKnowledgeForwardRevisionRecoveryTerminalRecord({ malicious });
    expect(first).toEqual({
      ok: false,
      issues: [
        {
          code: "forward_revision_recovery_terminal_invalid",
          severity: "error",
          field: "forwardRevisionRecoveryTerminals",
          message: "Forward revision recovery terminal does not satisfy its strict contract",
        },
      ],
    });
    expect(JSON.stringify(first)).not.toContain(malicious);
    if (!first.ok) first.issues[0].message = "mutated";
    expect(parseKnowledgeForwardRevisionRecoveryTerminalRecord(null)).toMatchObject({
      ok: false,
      issues: [
        { message: "Forward revision recovery terminal does not satisfy its strict contract" },
      ],
    });

    let caught: unknown;
    try {
      snapshotKnowledgeForwardRevisionAcceptedClaimIdentity({ malicious });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeForwardRevisionLifecycleTerminalValidationError);
    expect(Object.isFrozen(caught)).toBe(true);
    expect(String(caught)).not.toContain(malicious);
  });

  it("rejects derived-id or digest tampering across every terminal record", () => {
    const supersession = clone(
      createKnowledgeForwardRevisionSupersessionRecord(createSupersessionInput())
    ) as Record<string, unknown>;
    const abandonment = clone(
      createKnowledgeForwardRevisionAbandonmentRecord({
        acceptedIdentity: createAcceptedIdentity(),
        abandonedAt: 150,
      })
    ) as Record<string, unknown>;
    const recovery = clone(
      createKnowledgeForwardRevisionRecoveryTerminalRecord(createRecoveryTerminalInput(2))
    ) as Record<string, unknown>;
    supersession.supersessionDigest = HASH_F;
    abandonment.abandonmentId = `forward-revision-abandonment-${HASH_F}`;
    recovery.terminalizationDigest = HASH_A;

    expect(() => snapshotKnowledgeForwardRevisionSupersessionRecord(supersession)).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
    expect(() => snapshotKnowledgeForwardRevisionAbandonmentRecord(abandonment)).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
    expect(() => snapshotKnowledgeForwardRevisionRecoveryTerminalRecord(recovery)).toThrow(
      KnowledgeForwardRevisionLifecycleTerminalValidationError
    );
  });

  it("returns stable validators for all malformed record families", () => {
    expect(validateKnowledgeForwardRevisionSupersessionRecord(null)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "forward_revision_supersession_invalid" }],
    });
    expect(validateKnowledgeForwardRevisionAbandonmentRecord(null)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "forward_revision_abandonment_invalid" }],
    });
    expect(validateKnowledgeForwardRevisionRecoveryTerminalRecord(null)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "forward_revision_recovery_terminal_invalid" }],
    });
  });

  it("does not retain page bodies in any durable lifecycle record", () => {
    const records = [
      createKnowledgeForwardRevisionSupersessionRecord(createSupersessionInput()),
      createKnowledgeForwardRevisionAbandonmentRecord({
        acceptedIdentity: createAcceptedIdentity(),
        abandonedAt: 150,
      }),
      createKnowledgeForwardRevisionRecoveryTerminalRecord(createRecoveryTerminalInput(2)),
    ];
    const serialized = JSON.stringify(records);

    expect(serialized).not.toContain("beforeContent");
    expect(serialized).not.toContain("afterContent");
    expect(serialized).not.toContain("actualContent");
  });

  it("snapshots detached refs instead of retaining caller-owned objects", () => {
    const resource = clone(createResource());
    const reference = createKnowledgeForwardRevisionLedgerLineageRef({
      ledgerKind: "source_apply",
      resource,
      transactionId: "source-transaction-detached",
      ledgerIdentityDigest: HASH_A,
      casBeforeHash: HASH_B,
      afterHash: HASH_C,
      appliedAt: 200,
    });
    (resource as { sourceId: string }).sourceId = "mutated-source";

    expect(reference.resource.sourceId).toBe("source-1");
    expect(snapshotKnowledgeForwardRevisionLedgerLineageRef(clone(reference))).toEqual(reference);
  });
});
