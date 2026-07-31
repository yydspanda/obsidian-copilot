import { initializeKnowledgeRuntimeForCurrentGeneration } from "@/knowledge/startup/KnowledgeRuntimeFoundationInitializer";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/**
 * Creates a controllable Promise for lifecycle-boundary tests.
 *
 * @returns Deferred Promise controls
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("initializeKnowledgeRuntimeForCurrentGeneration", () => {
  it("does not construct or initialize a Runtime after module loading becomes stale", async () => {
    const modules = createDeferred<{ marker: string }>();
    const createRuntime = jest.fn(() => ({ initialized: false }));
    const initializeRuntime = jest.fn(async () => undefined);
    let isCurrent = true;

    const startup = initializeKnowledgeRuntimeForCurrentGeneration(
      () => modules.promise,
      () => isCurrent,
      createRuntime,
      initializeRuntime
    );

    isCurrent = false;
    modules.resolve({ marker: "loaded" });

    await expect(startup).resolves.toBeUndefined();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(initializeRuntime).not.toHaveBeenCalled();
  });

  it("does not publish a Runtime when its issued initialization finishes stale", async () => {
    const initialization = createDeferred<void>();
    const initializationStarted = createDeferred<void>();
    const runtime = { initialized: false };
    let isCurrent = true;

    const startup = initializeKnowledgeRuntimeForCurrentGeneration(
      async () => ({ marker: "loaded" }),
      () => isCurrent,
      () => runtime,
      async () => {
        initializationStarted.resolve(undefined);
        return initialization.promise;
      }
    );

    await initializationStarted.promise;
    isCurrent = false;
    initialization.resolve(undefined);

    await expect(startup).resolves.toBeUndefined();
  });
});
