import {
  KnowledgeExecutionOwner,
  createKnowledgeExecutionOwner,
} from "@/knowledge/ingest/KnowledgeExecutionOwner";

describe("KnowledgeExecutionOwner", () => {
  it("binds one exact App, Vault, and adapter tuple with exact-idempotent reproof", () => {
    const owner = createKnowledgeExecutionOwner();
    const adapter = {};
    const vault = { adapter };
    const app = { vault };

    expect(() =>
      KnowledgeExecutionOwner.bindVaultLifecycle(owner, app, vault, adapter)
    ).not.toThrow();
    expect(() =>
      KnowledgeExecutionOwner.bindVaultLifecycle(owner, app, vault, adapter)
    ).not.toThrow();
    expect(KnowledgeExecutionOwner.matchesVaultLifecycle(owner, app, vault, adapter)).toBe(true);

    for (const tuple of [
      [{ vault }, vault, adapter],
      [app, { adapter }, adapter],
      [app, vault, {}],
    ] as const) {
      expect(() =>
        KnowledgeExecutionOwner.bindVaultLifecycle(owner, tuple[0], tuple[1], tuple[2])
      ).toThrow(TypeError);
      expect(
        KnowledgeExecutionOwner.matchesVaultLifecycle(owner, tuple[0], tuple[1], tuple[2])
      ).toBe(false);
    }
  });

  it("rejects copied, proxied, and invalid lifecycle identities", () => {
    const owner = createKnowledgeExecutionOwner();
    const adapter = {};
    const vault = { adapter };
    const app = { vault };
    KnowledgeExecutionOwner.bindVaultLifecycle(owner, app, vault, adapter);

    for (const value of [
      {},
      Object.create(KnowledgeExecutionOwner.prototype),
      new Proxy(owner, {}),
    ]) {
      expect(() => KnowledgeExecutionOwner.assert(value)).toThrow(TypeError);
      expect(
        KnowledgeExecutionOwner.matchesVaultLifecycle(value as never, app, vault, adapter)
      ).toBe(false);
    }
    expect(() => new KnowledgeExecutionOwner(Symbol("forged"))).toThrow(TypeError);
  });
});
