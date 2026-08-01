import type { KnowledgeIngestExecutionProofRequest } from "@/knowledge/ingest/KnowledgeIngestExecutionAuthority";
import { createKnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";
import {
  KnowledgeRuntimeIngestExecutionProofError,
  KnowledgeRuntimeIngestExecutionProofPort,
  KnowledgeRuntimeQueueStorage,
  KnowledgeRuntimeStore,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

/** Creates an unused atomic boundary for facade-isolation tests. */
function createUnusedAtomicRuntimeFile(): AtomicRuntimeFile {
  return {
    initialize: jest.fn(async () => undefined),
    read: jest.fn(async () => {
      throw new Error("Unexpected atomic read");
    }),
    process: jest.fn(async () => {
      throw new Error("Unexpected atomic transform");
    }),
  };
}

describe("KnowledgeRuntimeIngestExecutionProofPort", () => {
  it("retains its Runtime capability only in frozen process-local state", () => {
    const runtime = new KnowledgeRuntimeStore(createUnusedAtomicRuntimeFile());
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
    const port = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);

    expect(Reflect.ownKeys(port)).toEqual([]);
    expect(Object.isFrozen(port)).toBe(true);
    expect(Object.isFrozen(KnowledgeRuntimeIngestExecutionProofPort.prototype)).toBe(true);
    expect(Object.isFrozen(KnowledgeRuntimeIngestExecutionProofPort)).toBe(true);
  });

  it("rejects copied prototypes and invalid Runtime dependencies", () => {
    const runtime = new KnowledgeRuntimeStore(createUnusedAtomicRuntimeFile());
    const otherRuntime = new KnowledgeRuntimeStore(createUnusedAtomicRuntimeFile());
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
    const port = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);
    const prototype = Reflect.getPrototypeOf(port);
    if (!prototype) throw new Error("Expected Runtime proof-port prototype");
    const forged = Object.create(prototype) as KnowledgeRuntimeIngestExecutionProofPort;
    const invalidRequest = {} as KnowledgeIngestExecutionProofRequest;
    const signal = new AbortController().signal;

    expect(
      () => new KnowledgeRuntimeIngestExecutionProofPort({} as KnowledgeRuntimeStore, queueStorage)
    ).toThrow(TypeError);
    expect(() => new KnowledgeRuntimeIngestExecutionProofPort(otherRuntime, queueStorage)).toThrow(
      TypeError
    );
    expect(() => forged.prove(invalidRequest, signal)).toThrow(TypeError);
  });

  it("prevents one lifecycle owner from being registered to another Runtime", () => {
    const owner = createKnowledgeExecutionOwner();
    const runtime = new KnowledgeRuntimeStore(createUnusedAtomicRuntimeFile());
    const otherRuntime = new KnowledgeRuntimeStore(createUnusedAtomicRuntimeFile());

    expect(() => new KnowledgeRuntimeQueueStorage(runtime, owner)).not.toThrow();
    expect(() => new KnowledgeRuntimeQueueStorage(runtime, owner)).not.toThrow();
    expect(() => new KnowledgeRuntimeQueueStorage(otherRuntime, owner)).toThrow(TypeError);
  });

  it("captures the canonical proof method instead of following later instance overrides", async () => {
    const runtime = new KnowledgeRuntimeStore(createUnusedAtomicRuntimeFile());
    const queueStorage = new KnowledgeRuntimeQueueStorage(runtime);
    const port = new KnowledgeRuntimeIngestExecutionProofPort(runtime, queueStorage);
    const replacement = jest.fn(async () => ({ forged: true }));
    Object.defineProperty(runtime, "proveIngestExecution", {
      configurable: true,
      value: replacement,
    });

    await expect(
      port.prove({} as KnowledgeIngestExecutionProofRequest, new AbortController().signal)
    ).rejects.toBeInstanceOf(KnowledgeRuntimeIngestExecutionProofError);
    expect(replacement).not.toHaveBeenCalled();
  });
});
