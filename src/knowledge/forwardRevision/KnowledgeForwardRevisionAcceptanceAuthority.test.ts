import {
  KNOWLEDGE_FORWARD_REVISION_ACCEPTANCE_AUTHORITY_LIMITS,
  KnowledgeForwardRevisionAcceptanceAuthorityValidationError,
  createKnowledgeForwardRevisionAcceptanceAuthorityDigest,
  snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue,
  type KnowledgeForwardRevisionAcceptanceAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionAcceptanceAuthority";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

/** Creates one internally coherent applied acceptance-authority fixture. */
function createAuthority(): KnowledgeForwardRevisionAcceptanceAuthority {
  return {
    runtimeId: "runtime-1",
    runtimeRevision: 20,
    runtimeDigest: HASH_A,
    manifestRevision: 9,
    manifestDigest: HASH_B,
    manifestBaseHash: HASH_C,
    vaultObservedBeforeHash: HASH_C,
    currentSourceFreshness: {
      kind: "applied",
      runtimeId: "runtime-1",
      runtimeRevision: 20,
      runtimeDigest: HASH_A,
      bundleId: "personal",
      sourceId: "source-1",
      sourceContentHash: HASH_D,
      pipelineFingerprint: HASH_A,
      inputRevision: 7,
      manifestRevision: 9,
      manifestDigest: HASH_B,
      committedManifestRevision: 8,
      completedAt: 115,
      transactionId: "transaction-current",
      changeSetId: "changeset-current",
      changeSetDigest: HASH_C,
      manifestIntentDigest: HASH_D,
      committedManifestDigest: HASH_A,
    },
  };
}

/** Creates a mutable JSON clone for persisted-state adversarial checks. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("KnowledgeForwardRevisionAcceptanceAuthority", () => {
  it("captures a detached deeply frozen authority and stable canonical digest", () => {
    const input = createAuthority();
    const authority = snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(input);
    const digest = createKnowledgeForwardRevisionAcceptanceAuthorityDigest(authority);

    expect(digest).toHaveLength(64);
    expect(createKnowledgeForwardRevisionAcceptanceAuthorityDigest(clone(authority))).toBe(digest);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.currentSourceFreshness)).toBe(true);

    (input.currentSourceFreshness as { completedAt: number }).completedAt = 999;
    expect(authority.currentSourceFreshness.completedAt).toBe(115);
  });

  it("rejects oversized identifiers, incoherent tuples, accessors, and revoked proxies", () => {
    const accessor = clone(createAuthority()) as unknown as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(accessor, "runtimeId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "runtime-1";
      },
    });
    const revoked = Proxy.revocable(createAuthority(), {});
    revoked.revoke();
    const cases: unknown[] = [
      {
        ...createAuthority(),
        runtimeId: "x".repeat(
          KNOWLEDGE_FORWARD_REVISION_ACCEPTANCE_AUTHORITY_LIMITS.maxIdentifierCharacters + 1
        ),
      },
      { ...createAuthority(), runtimeRevision: 21 },
      { ...createAuthority(), extra: true },
      accessor,
      revoked.proxy,
    ];

    for (const value of cases) {
      expect(() => snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(value)).toThrow(
        KnowledgeForwardRevisionAcceptanceAuthorityValidationError
      );
    }
    expect(getterCalls).toBe(0);
  });

  it("preserves distinct source-applied and effective hashes", () => {
    const authority = snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue({
      ...createAuthority(),
      vaultObservedBeforeHash: HASH_D,
    });

    expect(authority.manifestBaseHash).toBe(HASH_C);
    expect(authority.vaultObservedBeforeHash).toBe(HASH_D);
  });

  it("translates hostile failures into a fresh frozen authentic error", () => {
    const spoof = new KnowledgeForwardRevisionAcceptanceAuthorityValidationError();
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
      snapshotKnowledgeForwardRevisionAcceptanceAuthorityValue(hostile);
    } catch (error) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(KnowledgeForwardRevisionAcceptanceAuthorityValidationError);
    expect(observed).not.toBe(spoof);
    expect(Object.isFrozen(observed)).toBe(true);
  });
});
