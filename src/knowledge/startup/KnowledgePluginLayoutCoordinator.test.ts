import {
  KnowledgePluginLayoutCoordinator,
  type KnowledgePluginLayoutBarrier,
  type KnowledgePluginLayoutProjectsPort,
} from "@/knowledge/startup/KnowledgePluginLayoutCoordinator";

/** Externally controlled Promise used to exercise lifecycle interleavings. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

/** Creates one externally settled Promise. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

/** Creates an observable Projects initialization boundary. */
function createProjects(
  ensureInitialized: () => Promise<void> = async () => undefined
): KnowledgePluginLayoutProjectsPort & { ensureInitialized: jest.Mock<Promise<void>, []> } {
  return {
    ensureInitialized: jest.fn(ensureInitialized),
  };
}

/** Creates an observable replaceable barrier. */
function createBarrier(
  startAfterLayout: () => Promise<void> = async () => undefined
): KnowledgePluginLayoutBarrier & {
  startAfterLayout: jest.Mock<Promise<void>, []>;
  cancel: jest.Mock<void, []>;
} {
  return {
    startAfterLayout: jest.fn(startAfterLayout),
    cancel: jest.fn(),
  };
}

/** Flushes already-scheduled Promise rejection handlers. */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("KnowledgePluginLayoutCoordinator", () => {
  it("starts Projects at layout readiness without waiting for a late unavailable barrier", async () => {
    const projectsReady = createDeferred<void>();
    const projects = createProjects(() => projectsReady.promise);
    const coordinator = new KnowledgePluginLayoutCoordinator(projects);

    coordinator.onLayoutReady();

    expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);

    const barrier = createBarrier(async () => {
      throw new Error("runtime unavailable");
    });
    coordinator.attachBarrier(barrier);
    await flushPromises();

    expect(barrier.startAfterLayout).toHaveBeenCalledTimes(1);
    expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);

    projectsReady.reject(new Error("projects owns logging"));
    await flushPromises();
  });

  it.each(["barrier-first", "layout-first"] as const)(
    "starts Projects and the barrier exactly once when %s",
    (arrivalOrder) => {
      const events: string[] = [];
      const projects = createProjects(async () => {
        events.push("projects");
      });
      const barrier = createBarrier(async () => {
        events.push("barrier");
      });
      const coordinator = new KnowledgePluginLayoutCoordinator(projects);

      if (arrivalOrder === "barrier-first") {
        coordinator.attachBarrier(barrier);
        expect(barrier.startAfterLayout).not.toHaveBeenCalled();
        coordinator.onLayoutReady();
      } else {
        coordinator.onLayoutReady();
        expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);
        coordinator.attachBarrier(barrier);
      }

      expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);
      expect(barrier.startAfterLayout).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["projects", "barrier"]);
    }
  );

  it("keeps repeated layout notifications and same-barrier attachments idempotent", () => {
    const projects = createProjects();
    const barrier = createBarrier();
    const coordinator = new KnowledgePluginLayoutCoordinator(projects);

    coordinator.attachBarrier(barrier);
    coordinator.attachBarrier(barrier);
    coordinator.onLayoutReady();
    coordinator.onLayoutReady();
    coordinator.attachBarrier(barrier);
    coordinator.onLayoutReady();

    expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);
    expect(barrier.startAfterLayout).toHaveBeenCalledTimes(1);
    expect(barrier.cancel).not.toHaveBeenCalled();
  });

  it("permanently closes before layout and cancels every later attachment", () => {
    const projects = createProjects();
    const initialBarrier = createBarrier();
    const lateBarrier = createBarrier();
    const coordinator = new KnowledgePluginLayoutCoordinator(projects);

    coordinator.attachBarrier(initialBarrier);
    coordinator.close();
    coordinator.close();
    coordinator.onLayoutReady();
    coordinator.attachBarrier(lateBarrier);
    coordinator.onLayoutReady();

    expect(initialBarrier.cancel).toHaveBeenCalledTimes(1);
    expect(initialBarrier.startAfterLayout).not.toHaveBeenCalled();
    expect(lateBarrier.cancel).toHaveBeenCalledTimes(1);
    expect(lateBarrier.startAfterLayout).not.toHaveBeenCalled();
    expect(projects.ensureInitialized).not.toHaveBeenCalled();
  });

  it("does not revive after close while Project and barrier Promises settle", async () => {
    const projectsReady = createDeferred<void>();
    const barrierReady = createDeferred<void>();
    const projects = createProjects(() => projectsReady.promise);
    const barrier = createBarrier(() => barrierReady.promise);
    const coordinator = new KnowledgePluginLayoutCoordinator(projects);

    coordinator.attachBarrier(barrier);
    coordinator.onLayoutReady();
    coordinator.close();

    projectsReady.reject(new Error("late project failure"));
    barrierReady.reject(new Error("late barrier failure"));
    await flushPromises();

    coordinator.onLayoutReady();
    coordinator.attachBarrier(barrier);

    expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);
    expect(barrier.startAfterLayout).toHaveBeenCalledTimes(1);
    expect(barrier.cancel).toHaveBeenCalledTimes(2);
  });

  it("cancels replacements and starts only the current barrier after layout", async () => {
    const projects = createProjects();
    const firstBarrier = createBarrier();
    const secondBarrier = createBarrier();
    const thirdBarrier = createBarrier(async () => {
      throw new Error("replacement unavailable");
    });
    const coordinator = new KnowledgePluginLayoutCoordinator(projects);

    coordinator.attachBarrier(firstBarrier);
    coordinator.attachBarrier(secondBarrier);

    expect(firstBarrier.cancel).toHaveBeenCalledTimes(1);
    expect(firstBarrier.startAfterLayout).not.toHaveBeenCalled();
    expect(secondBarrier.startAfterLayout).not.toHaveBeenCalled();

    coordinator.onLayoutReady();
    coordinator.attachBarrier(thirdBarrier);
    coordinator.attachBarrier(thirdBarrier);
    await flushPromises();

    expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);
    expect(secondBarrier.startAfterLayout).toHaveBeenCalledTimes(1);
    expect(secondBarrier.cancel).toHaveBeenCalledTimes(1);
    expect(thirdBarrier.startAfterLayout).toHaveBeenCalledTimes(1);
    expect(thirdBarrier.cancel).not.toHaveBeenCalled();
  });

  it("contains synchronous dependency failures without skipping independent work", () => {
    const projects = createProjects(() => {
      throw new Error("synchronous project failure");
    });
    const barrier = createBarrier(() => {
      throw new Error("synchronous barrier failure");
    });
    barrier.cancel.mockImplementation(() => {
      throw new Error("synchronous cancel failure");
    });
    const replacement = createBarrier();
    const coordinator = new KnowledgePluginLayoutCoordinator(projects);

    expect(() => coordinator.onLayoutReady()).not.toThrow();
    expect(() => coordinator.attachBarrier(barrier)).not.toThrow();
    expect(() => coordinator.attachBarrier(replacement)).not.toThrow();
    expect(() => coordinator.close()).not.toThrow();

    expect(projects.ensureInitialized).toHaveBeenCalledTimes(1);
    expect(barrier.startAfterLayout).toHaveBeenCalledTimes(1);
    expect(barrier.cancel).toHaveBeenCalledTimes(1);
    expect(replacement.startAfterLayout).toHaveBeenCalledTimes(1);
    expect(replacement.cancel).toHaveBeenCalledTimes(1);
  });
});
