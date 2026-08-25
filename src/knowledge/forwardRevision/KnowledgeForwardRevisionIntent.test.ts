import {
  KNOWLEDGE_FORWARD_REVISION_INTENT_LIMITS,
  KnowledgeForwardRevisionIntentValidationError,
  createKnowledgeForwardRevisionIntent,
  createKnowledgeForwardRevisionIntentDigest,
  snapshotKnowledgeForwardRevisionIntent,
  validateKnowledgeForwardRevisionIntent,
  type CreateKnowledgeForwardRevisionIntentInput,
  type KnowledgeForwardRevisionIntent,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionIntent";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);
const HASH_F = "f".repeat(64);

/** Creates complete valid caller facts without derived intent fields. */
function createInput(): CreateKnowledgeForwardRevisionIntentInput {
  return {
    bundleId: "personal",
    pagePath: "Wiki/Topic.md",
    historical: {
      bundleId: "personal",
      pagePath: "Wiki/Topic.md",
      transactionId: "transaction-previous",
      sourceId: "source-1",
      sourceContentHash: HASH_A,
      pipelineFingerprint: HASH_B,
      inputRevision: 3,
      changeSetId: "changeset-previous",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      manifestAfterRevision: 4,
      manifestAfterDigest: HASH_E,
      appliedAt: 100,
      selectedContentHash: HASH_F,
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
  };
}

/** Clones one intent as mutable plain JSON for adversarial mutations. */
function cloneIntent(
  value: Readonly<KnowledgeForwardRevisionIntent>
): KnowledgeForwardRevisionIntent {
  return JSON.parse(JSON.stringify(value)) as KnowledgeForwardRevisionIntent;
}

/** Reorders every top-level creator property without changing semantic material. */
function reorderInput(
  input: CreateKnowledgeForwardRevisionIntentInput
): CreateKnowledgeForwardRevisionIntentInput {
  return {
    current: {
      vaultObservedBeforeHash: input.current.vaultObservedBeforeHash,
      manifestBaseHash: input.current.manifestBaseHash,
      manifestDigest: input.current.manifestDigest,
      manifestRevision: input.current.manifestRevision,
      inputRevision: input.current.inputRevision,
      pipelineFingerprint: input.current.pipelineFingerprint,
      sourceContentHash: input.current.sourceContentHash,
      primarySourceId: input.current.primarySourceId,
      sourceIds: [...input.current.sourceIds] as [string],
      sourceRetired: input.current.sourceRetired,
      sourceOrigin: input.current.sourceOrigin,
      ownership: input.current.ownership,
      currentState: input.current.currentState,
    },
    historical: { ...input.historical },
    pagePath: input.pagePath,
    bundleId: input.bundleId,
  };
}

describe("KnowledgeForwardRevisionIntent", () => {
  it("derives a deterministic opaque id and a stable full-intent digest", () => {
    const first = createKnowledgeForwardRevisionIntent(createInput());
    const second = createKnowledgeForwardRevisionIntent(reorderInput(createInput()));

    expect(first).toEqual(second);
    expect(first.intentId).toMatch(/^forward-revision-[a-f0-9]{64}$/);
    expect(createKnowledgeForwardRevisionIntentDigest(first)).toBe(
      createKnowledgeForwardRevisionIntentDigest(second)
    );
    expect(validateKnowledgeForwardRevisionIntent(first)).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("rejects an arbitrary or stale intent id after recomputing canonical payload identity", () => {
    const canonical = createKnowledgeForwardRevisionIntent(createInput());
    const forged = cloneIntent(canonical);
    (forged as { intentId: string }).intentId = `forward-revision-${HASH_A}`;

    expect(() => snapshotKnowledgeForwardRevisionIntent(forged)).toThrow(
      KnowledgeForwardRevisionIntentValidationError
    );
    expect(validateKnowledgeForwardRevisionIntent(forged)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "forward_revision_intent_id_mismatch", field: "intentId" }],
    });
  });

  it("retains distinct source-applied and effective current hashes", () => {
    const input = createInput();
    const mismatched = {
      ...input,
      current: { ...input.current, vaultObservedBeforeHash: HASH_B },
    };

    const successor = createKnowledgeForwardRevisionIntent(mismatched);
    expect(successor.current.manifestBaseHash).toBe(HASH_A);
    expect(successor.current.vaultObservedBeforeHash).toBe(HASH_B);
    const intent = createKnowledgeForwardRevisionIntent(input);
    expect(intent.current.manifestBaseHash).toBe(HASH_A);
    expect(intent.current.vaultObservedBeforeHash).toBe(HASH_A);
  });

  it("requires the historical source, sole generated owner, and monotonic forward revision", () => {
    const input = createInput();
    const cases: unknown[] = [
      { ...input, historical: { ...input.historical, sourceId: "source-2" } },
      {
        ...input,
        historical: { ...input.historical, sourceContentHash: HASH_B },
      },
      {
        ...input,
        historical: { ...input.historical, pipelineFingerprint: HASH_C },
      },
      {
        ...input,
        current: { ...input.current, inputRevision: input.historical.inputRevision - 1 },
      },
      {
        ...input,
        current: { ...input.current, ownership: "shared" },
      },
      {
        ...input,
        current: { ...input.current, currentState: "drifted" },
      },
      {
        ...input,
        current: { ...input.current, sourceOrigin: "query_writeback" },
      },
      {
        ...input,
        current: { ...input.current, sourceRetired: true },
      },
      {
        ...input,
        current: {
          ...input.current,
          sourceIds: ["source-1", "source-2"],
        },
      },
      { ...input, historical: { ...input.historical, bundleId: "other" } },
      { ...input, historical: { ...input.historical, pagePath: "Wiki/Other.md" } },
      {
        ...input,
        historical: {
          ...input.historical,
          manifestAfterRevision: input.current.manifestRevision,
        },
      },
      {
        ...input,
        historical: {
          ...input.historical,
          manifestAfterDigest: input.current.manifestDigest,
        },
      },
      {
        ...input,
        historical: { ...input.historical, selectedContentHash: input.current.manifestBaseHash },
      },
      { ...input, historical: { ...input.historical, appliedAt: -1 } },
      { ...input, current: { ...input.current, manifestRevision: 0 } },
    ];

    for (const candidate of cases) {
      expect(() =>
        createKnowledgeForwardRevisionIntent(candidate as CreateKnowledgeForwardRevisionIntentInput)
      ).toThrow(KnowledgeForwardRevisionIntentValidationError);
    }
  });

  it("snapshots exact data descriptors without invoking getters or retaining caller objects", () => {
    const input = createInput();
    let getterCalls = 0;
    const hostile = { ...input } as Record<string, unknown>;
    Object.defineProperty(hostile, "bundleId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "personal";
      },
    });

    expect(() =>
      createKnowledgeForwardRevisionIntent(hostile as CreateKnowledgeForwardRevisionIntentInput)
    ).toThrow(KnowledgeForwardRevisionIntentValidationError);
    expect(getterCalls).toBe(0);

    const intent = createKnowledgeForwardRevisionIntent(input);
    (input.historical as { transactionId: string }).transactionId = "changed";
    (input.current.sourceIds as unknown as string[])[0] = "changed";
    expect(intent.historical.transactionId).toBe("transaction-previous");
    expect(intent.current.sourceIds).toEqual(["source-1"]);
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.historical)).toBe(true);
    expect(Object.isFrozen(intent.current)).toBe(true);
    expect(Object.isFrozen(intent.current.sourceIds)).toBe(true);
  });

  it("rejects sparse arrays, unknown keys, oversized values, and revoked proxies", () => {
    const sparseIds = new Array<string>(1);
    const candidates: unknown[] = [
      { ...createInput(), extra: true },
      { ...createInput(), current: { ...createInput().current, sourceIds: sparseIds } },
      {
        ...createInput(),
        bundleId: "x".repeat(KNOWLEDGE_FORWARD_REVISION_INTENT_LIMITS.maxIdentifierCharacters + 1),
      },
    ];
    const revoked = Proxy.revocable(createInput(), {});
    revoked.revoke();
    candidates.push(revoked.proxy);

    for (const candidate of candidates) {
      expect(validateKnowledgeForwardRevisionIntent(candidate).valid).toBe(false);
    }
  });

  it("rejects controls and unpaired surrogates while preserving valid Unicode exactly", () => {
    for (const invalid of ["source\u0000id", "source\u0085id", "source\ud800", "source\udc00"]) {
      const input = createInput();
      expect(() =>
        createKnowledgeForwardRevisionIntent({
          ...input,
          historical: { ...input.historical, sourceId: invalid },
          current: {
            ...input.current,
            sourceIds: [invalid],
            primarySourceId: invalid,
          },
        })
      ).toThrow(KnowledgeForwardRevisionIntentValidationError);
    }
    for (const invalidPath of [
      "Wiki/Topic\u0085.md",
      "Wiki/Topic\ud800.md",
      "Wiki/Topic\udc00.md",
    ]) {
      const input = createInput();
      expect(() =>
        createKnowledgeForwardRevisionIntent({
          ...input,
          pagePath: invalidPath,
          historical: { ...input.historical, pagePath: invalidPath },
        })
      ).toThrow(KnowledgeForwardRevisionIntentValidationError);
    }

    const input = createInput();
    const unicodeSource = "source-😀-e\u0301";
    const unicodePath = "Wiki/😀-e\u0301.md";
    const intent = createKnowledgeForwardRevisionIntent({
      ...input,
      pagePath: unicodePath,
      historical: { ...input.historical, pagePath: unicodePath, sourceId: unicodeSource },
      current: {
        ...input.current,
        sourceIds: [unicodeSource],
        primarySourceId: unicodeSource,
      },
    });
    expect(intent.pagePath).toBe(unicodePath);
    expect(intent.current.primarySourceId).toBe(unicodeSource);
  });

  it("does not permit prototype data to satisfy exact intent fields", () => {
    const input = createInput();
    const inherited = Object.create({ bundleId: input.bundleId }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(input)) {
      if (key !== "bundleId") inherited[key] = value;
    }

    expect(validateKnowledgeForwardRevisionIntent(inherited)).toMatchObject({ valid: false });
  });

  it("accepts canonical null-prototype records and still detaches them", () => {
    const input = createInput();
    const nullPrototypeInput: Record<string, unknown> = Object.assign(
      Object.create(null) as Record<string, unknown>,
      input
    );
    nullPrototypeInput.historical = Object.assign(
      Object.create(null) as Record<string, unknown>,
      input.historical
    );
    nullPrototypeInput.current = Object.assign(
      Object.create(null) as Record<string, unknown>,
      input.current
    );

    const intent = createKnowledgeForwardRevisionIntent(
      nullPrototypeInput as CreateKnowledgeForwardRevisionIntentInput
    );
    expect(validateKnowledgeForwardRevisionIntent(intent)).toMatchObject({ valid: true });
    expect(Object.getPrototypeOf(intent)).toBe(Object.prototype);
  });

  it("does not authenticate caller-created, subclassed, or prototype-forged errors", () => {
    const callerDiagnostics = [
      {
        code: "caller_secret",
        severity: "error" as const,
        field: "secret",
        message: "secret-user-value",
      },
    ];
    const callerError = new KnowledgeForwardRevisionIntentValidationError(callerDiagnostics);
    callerDiagnostics[0].message = "changed-secret";

    class ForgedValidationError extends KnowledgeForwardRevisionIntentValidationError {}
    const subclassError = new ForgedValidationError(callerDiagnostics);
    const prototypeForgery = Object.create(
      KnowledgeForwardRevisionIntentValidationError.prototype
    ) as KnowledgeForwardRevisionIntentValidationError;

    for (const error of [callerError, subclassError, prototypeForgery]) {
      expect(error.diagnostics).toEqual([
        {
          code: "forward_revision_intent_invalid",
          severity: "error",
          field: "intent",
          message: "Forward revision intent does not satisfy the strict protocol",
        },
      ]);
      expect(JSON.stringify(error.diagnostics)).not.toContain("secret-user-value");
      expect(Object.isFrozen(error.diagnostics)).toBe(true);
      expect(Object.isFrozen(error.diagnostics[0])).toBe(true);
    }
  });

  it("keeps authentic errors frozen when a hostile Proxy trap throws them again", () => {
    const validIntent = createKnowledgeForwardRevisionIntent(createInput());
    let authenticError: unknown;
    try {
      snapshotKnowledgeForwardRevisionIntent({});
    } catch (error) {
      authenticError = error;
    }

    expect(authenticError).toBeInstanceOf(KnowledgeForwardRevisionIntentValidationError);
    expect(Object.isFrozen(authenticError)).toBe(true);
    expect(Reflect.set(authenticError as object, "message", "secret-user-value")).toBe(false);

    const valuesSpy = jest.spyOn(Object, "values").mockImplementationOnce(() => {
      throw authenticError;
    });
    let rethrown: unknown;
    try {
      snapshotKnowledgeForwardRevisionIntent(validIntent);
    } catch (error) {
      rethrown = error;
    } finally {
      valuesSpy.mockRestore();
    }
    expect(rethrown).toBe(authenticError);

    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw authenticError;
        },
      }
    );
    let observed: unknown;
    try {
      snapshotKnowledgeForwardRevisionIntent(hostile);
    } catch (error) {
      observed = error;
    }

    expect(observed).not.toBe(authenticError);
    expect(Object.isFrozen(observed)).toBe(true);
    expect(observed).toMatchObject({
      name: "KnowledgeForwardRevisionIntentValidationError",
      message: "The knowledge forward revision intent is invalid",
    });
    expect(JSON.stringify(observed)).not.toContain("secret-user-value");
  });

  it("returns sanitized validation diagnostics without rejected values", () => {
    const secret = "secret-user-value";
    const result = validateKnowledgeForwardRevisionIntent({ secret });

    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.diagnostics).toEqual([
      {
        code: "forward_revision_intent_invalid",
        severity: "error",
        field: "intent",
        message: "Forward revision intent does not satisfy the strict protocol",
      },
    ]);
  });
});
