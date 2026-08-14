import {
  captureForwardApplyJson,
  freezeForwardApplyJson,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionApplyProtocol";

describe("KnowledgeForwardRevisionApplyProtocol", () => {
  it("captures detached dense JSON without invoking accessors", () => {
    const nested = { value: "safe" };
    const captured = captureForwardApplyJson({ list: [nested] });
    nested.value = "mutated";

    expect(captured).toEqual({ list: [{ value: "safe" }] });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen((captured as { list: object[] }).list[0])).toBe(true);

    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "unsafe";
      },
    });
    expect(captureForwardApplyJson(hostile)).toBeUndefined();
    expect(getterCalls).toBe(0);
  });

  it("rejects sparse, cyclic, revoked, malformed Unicode, and oversized graphs", () => {
    const sparse = new Array<unknown>(2);
    sparse[1] = "value";
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(captureForwardApplyJson(sparse)).toBeUndefined();
    expect(captureForwardApplyJson(cyclic)).toBeUndefined();
    expect(captureForwardApplyJson(revoked.proxy)).toBeUndefined();
    expect(captureForwardApplyJson({ "\ud800": true })).toBeUndefined();
    expect(captureForwardApplyJson({ value: "x".repeat(24_000_001) })).toBeUndefined();
  });

  it("deep-freezes nested values even when the root was already shallow frozen", () => {
    const nested = { value: 1 };
    const root = Object.freeze({ nested });
    freezeForwardApplyJson(root);
    expect(Object.isFrozen(nested)).toBe(true);

    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {};
      },
    });
    expect(() => freezeForwardApplyJson(hostile)).toThrow(TypeError);
    expect(getterCalls).toBe(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => freezeForwardApplyJson(revoked.proxy)).toThrow(TypeError);
  });

  it("bounds freeze traversal and rejects cycles, sparse arrays, and extra array keys", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "value";
    const extra = ["value"] as unknown[] & { extra?: boolean };
    extra.extra = true;
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 130; index += 1) deep = { next: deep };

    expect(() => freezeForwardApplyJson(cyclic)).toThrow(TypeError);
    expect(() => freezeForwardApplyJson(sparse)).toThrow(TypeError);
    expect(() => freezeForwardApplyJson(extra)).toThrow(TypeError);
    expect(() => freezeForwardApplyJson(deep)).toThrow(TypeError);
  });
});
