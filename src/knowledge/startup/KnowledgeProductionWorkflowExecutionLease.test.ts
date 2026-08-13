import {
  consumeKnowledgeProductionWorkflowExecutionPreflightClaim,
  consumeKnowledgeProductionWorkflowExecutionRuntimeClaim,
  createKnowledgeProductionWorkflowExecutionPairing,
  KnowledgeProductionWorkflowExecutionLease,
  KnowledgeProductionWorkflowExecutionPreflightBinding,
  KnowledgeProductionWorkflowExecutionPreflightClaim,
  KnowledgeProductionWorkflowExecutionRuntimeBinding,
  KnowledgeProductionWorkflowExecutionRuntimeClaim,
} from "@/knowledge/startup/KnowledgeProductionWorkflowExecutionLease";

describe("KnowledgeProductionWorkflowExecutionPairing", () => {
  it("pairs exact one-shot claims without exposing their hidden identity", () => {
    const pairing = createKnowledgeProductionWorkflowExecutionPairing();

    expect(Object.isFrozen(pairing)).toBe(true);
    expect(Reflect.ownKeys(pairing)).toEqual(["runtimeClaim", "preflightClaim"]);
    expect(Reflect.ownKeys(pairing.runtimeClaim)).toEqual([]);
    expect(Reflect.ownKeys(pairing.preflightClaim)).toEqual([]);
    expect(Object.isFrozen(pairing.runtimeClaim)).toBe(true);
    expect(Object.isFrozen(pairing.preflightClaim)).toBe(true);

    const runtimeBinding = consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(
      pairing.runtimeClaim
    );
    const preflightBinding = consumeKnowledgeProductionWorkflowExecutionPreflightClaim(
      pairing.preflightClaim
    );

    expect(Reflect.ownKeys(runtimeBinding)).toEqual([]);
    expect(Reflect.ownKeys(preflightBinding)).toEqual([]);
    expect(Object.isFrozen(runtimeBinding)).toBe(true);
    expect(Object.isFrozen(preflightBinding)).toBe(true);
    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(pairing.runtimeClaim)
    ).toThrow(TypeError);
    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionPreflightClaim(pairing.preflightClaim)
    ).toThrow(TypeError);
  });

  it("mints, owner-matches, cross-pair rejects, and synchronously revokes a lease", () => {
    const pairing = createKnowledgeProductionWorkflowExecutionPairing();
    const otherPairing = createKnowledgeProductionWorkflowExecutionPairing();
    const runtimeBinding = consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(
      pairing.runtimeClaim
    );
    const otherRuntimeBinding = consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(
      otherPairing.runtimeClaim
    );
    const preflightBinding = consumeKnowledgeProductionWorkflowExecutionPreflightClaim(
      pairing.preflightClaim
    );
    const { lease, executionOwner } = preflightBinding.issueWorkflowExecutionLease();

    expect(Reflect.ownKeys(lease)).toEqual([]);
    expect(Object.isFrozen(lease)).toBe(true);
    expect(runtimeBinding.ownsWorkflowExecutionLease(lease)).toBe(true);
    expect(otherRuntimeBinding.ownsWorkflowExecutionLease(lease)).toBe(false);
    expect(
      KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(lease, executionOwner)
    ).toBe(true);

    preflightBinding.revokeWorkflowExecutionLease(lease);

    try {
      lease.assertCurrent();
      throw new Error("Expected the revoked execution lease to abort");
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("AbortError");
    }
    expect(runtimeBinding.ownsWorkflowExecutionLease(lease)).toBe(false);
    expect(
      KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(lease, executionOwner)
    ).toBe(false);
  });

  it("rejects copied, interchanged, proxied, inherited, and forged capabilities", () => {
    const pairing = createKnowledgeProductionWorkflowExecutionPairing();
    const revokedRuntimeProxy = Proxy.revocable(pairing.runtimeClaim, {});

    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(pairing.preflightClaim)
    ).toThrow(TypeError);
    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionPreflightClaim(pairing.runtimeClaim)
    ).toThrow(TypeError);
    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(
        Object.create(KnowledgeProductionWorkflowExecutionRuntimeClaim.prototype)
      )
    ).toThrow(TypeError);
    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionPreflightClaim(
        Object.create(KnowledgeProductionWorkflowExecutionPreflightClaim.prototype)
      )
    ).toThrow(TypeError);
    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(new Proxy(pairing.runtimeClaim, {}))
    ).toThrow(TypeError);
    revokedRuntimeProxy.revoke();
    expect(() =>
      consumeKnowledgeProductionWorkflowExecutionRuntimeClaim(revokedRuntimeProxy.proxy)
    ).toThrow(TypeError);
    expect(() => new KnowledgeProductionWorkflowExecutionRuntimeClaim(Symbol("wrong"))).toThrow(
      TypeError
    );
    expect(() => new KnowledgeProductionWorkflowExecutionPreflightClaim(Symbol("wrong"))).toThrow(
      TypeError
    );
    expect(() => new KnowledgeProductionWorkflowExecutionRuntimeBinding(Symbol("wrong"))).toThrow(
      TypeError
    );
    expect(() => new KnowledgeProductionWorkflowExecutionPreflightBinding(Symbol("wrong"))).toThrow(
      TypeError
    );
    expect(() => new KnowledgeProductionWorkflowExecutionLease(Symbol("wrong"))).toThrow(TypeError);
  });

  it("freezes every authority class and exact prototype", () => {
    const authorities = [
      KnowledgeProductionWorkflowExecutionRuntimeClaim,
      KnowledgeProductionWorkflowExecutionPreflightClaim,
      KnowledgeProductionWorkflowExecutionRuntimeBinding,
      KnowledgeProductionWorkflowExecutionPreflightBinding,
      KnowledgeProductionWorkflowExecutionLease,
    ];

    for (const authority of authorities) {
      expect(Object.isFrozen(authority)).toBe(true);
      expect(Object.isFrozen(authority.prototype)).toBe(true);
    }
  });
});
