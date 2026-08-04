import {
  awaitKnowledgeProductionDrain,
  retainKnowledgeProductionDrain,
} from "@/knowledge/startup/KnowledgeProductionDrainRegistry";

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

/** Creates one externally settled Promise for generation-drain assertions. */
function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("KnowledgeProductionDrainRegistry", () => {
  it("returns immediately when one Vault has no retained production work", async () => {
    await expect(
      awaitKnowledgeProductionDrain({}, new AbortController().signal)
    ).resolves.toBeUndefined();
  });

  it("keeps replacement startup blocked until the active generation settles", async () => {
    const owner = {};
    const active = createDeferred();
    let waitSettled = false;
    retainKnowledgeProductionDrain(owner, active.promise);

    const waiting = awaitKnowledgeProductionDrain(owner, new AbortController().signal).then(() => {
      waitSettled = true;
    });
    await Promise.resolve();
    expect(waitSettled).toBe(false);

    active.resolve();
    await waiting;
    expect(waitSettled).toBe(true);
    await expect(
      awaitKnowledgeProductionDrain(owner, new AbortController().signal)
    ).resolves.toBeUndefined();
  });

  it("does not let an older settlement erase a newer retained drain", async () => {
    const owner = {};
    const first = createDeferred();
    const second = createDeferred();
    retainKnowledgeProductionDrain(owner, first.promise);
    retainKnowledgeProductionDrain(owner, second.promise);

    let waitSettled = false;
    const waiting = awaitKnowledgeProductionDrain(owner, new AbortController().signal).then(() => {
      waitSettled = true;
    });
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(waitSettled).toBe(false);

    second.resolve();
    await waiting;
    expect(waitSettled).toBe(true);
  });

  it("cancels one waiter without clearing the drain required by a later generation", async () => {
    const owner = {};
    const active = createDeferred();
    const cancelled = new AbortController();
    retainKnowledgeProductionDrain(owner, active.promise);

    const waiting = awaitKnowledgeProductionDrain(owner, cancelled.signal);
    cancelled.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });

    let laterSettled = false;
    const later = awaitKnowledgeProductionDrain(owner, new AbortController().signal).then(() => {
      laterSettled = true;
    });
    await Promise.resolve();
    expect(laterSettled).toBe(false);
    active.resolve();
    await later;
  });
});
