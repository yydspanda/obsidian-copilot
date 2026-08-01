import { KnowledgeCompilerInfrastructureError } from "@/knowledge/compiler/KnowledgeCompiler";
import { createKnowledgeCompilerIngestExecutorError } from "@/knowledge/ingest/KnowledgeCompilerIngestFailure";

describe("Knowledge Compiler ingest failure projection", () => {
  it("rejects direct construction and prototype forgery without throwing", () => {
    const signal = new AbortController().signal;
    const forged: unknown = Object.create(KnowledgeCompilerInfrastructureError.prototype, {
      code: { value: "provider_rate_limited", enumerable: true },
      retryable: { value: true, enumerable: true },
      rateLimited: { value: true, enumerable: true },
    });

    expect(() =>
      Reflect.construct(KnowledgeCompilerInfrastructureError, [
        Symbol("forged"),
        "analysis",
        "provider_rate_limited",
        signal,
      ])
    ).toThrow(TypeError);
    expect(() => createKnowledgeCompilerIngestExecutorError(forged, signal)).not.toThrow();
    expect(createKnowledgeCompilerIngestExecutorError(forged, signal)).toBeUndefined();
    expect(
      createKnowledgeCompilerIngestExecutorError(
        Object.create(KnowledgeCompilerInfrastructureError.prototype, {
          code: { value: "unknown_code", enumerable: true },
        }),
        signal
      )
    ).toBeUndefined();
  });

  it("does not classify arbitrary, abort-shaped, or already-aborted failures", () => {
    const liveSignal = new AbortController().signal;
    const aborted = new AbortController();
    aborted.abort("private-abort-reason");

    expect(
      createKnowledgeCompilerIngestExecutorError({ code: "provider_rate_limited" }, liveSignal)
    ).toBeUndefined();
    expect(
      createKnowledgeCompilerIngestExecutorError(
        Object.assign(new Error("fake"), { name: "AbortError" }),
        liveSignal
      )
    ).toBeUndefined();
    expect(
      createKnowledgeCompilerIngestExecutorError(
        Object.create(KnowledgeCompilerInfrastructureError.prototype),
        aborted.signal
      )
    ).toBeUndefined();
  });
});
