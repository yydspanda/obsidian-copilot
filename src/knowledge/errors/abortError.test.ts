import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";

describe("isKnowledgeAbortError", () => {
  it("recognizes native and detached own-data cancellation without invoking getters", () => {
    expect(isKnowledgeAbortError(new DOMException("stopped", "AbortError"))).toBe(true);
    expect(isKnowledgeAbortError(Object.freeze({ name: "AbortError" }))).toBe(true);
    expect(isKnowledgeAbortError(Object.freeze({ name: "TypeError" }))).toBe(false);
    let getterCalls = 0;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "name", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "AbortError";
      },
    });

    expect(isKnowledgeAbortError(hostile)).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("fails closed for throwing and revoked Proxy candidates", () => {
    expect(
      isKnowledgeAbortError(
        new Proxy(Object.freeze({}), {
          getOwnPropertyDescriptor: () => {
            throw new Error("hostile descriptor");
          },
        })
      )
    ).toBe(false);
    const revocable = Proxy.revocable(Object.freeze({ name: "AbortError" }), {});
    revocable.revoke();
    expect(isKnowledgeAbortError(revocable.proxy)).toBe(false);
  });

  it("does not invoke a native foreign-realm DOMException name accessor", () => {
    const host = new Image().doc.body;
    const frame = host.doc.createElement("iframe");
    host.appendChild(frame);
    const foreignWindow = frame.contentWindow;
    expect(foreignWindow).not.toBeNull();
    if (!foreignWindow) throw new Error("Expected an iframe renderer");
    const ForeignDOMException = (
      foreignWindow as unknown as { readonly DOMException: typeof DOMException }
    ).DOMException;
    const foreignAbort = new ForeignDOMException("stopped", "AbortError");

    expect(foreignAbort instanceof DOMException).toBe(false);
    expect(isKnowledgeAbortError(foreignAbort)).toBe(false);
    frame.remove();
  });
});
