import { subscribeKnowledgeSetupSelectionChanges } from "@/knowledge/setup/KnowledgeSetupSelectionSubscription";

/** Creates an inspectable synchronous event source. */
function createSource() {
  const listeners = new Set<() => void>();
  return {
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit: () => [...listeners].forEach((listener) => listener()),
    listeners,
  };
}

describe("subscribeKnowledgeSetupSelectionChanges", () => {
  it("refreshes initially and for model, chain, and Project selection changes", () => {
    const model = createSource();
    const chain = createSource();
    const project = createSource();
    const refresh = jest.fn();

    const unsubscribe = subscribeKnowledgeSetupSelectionChanges({
      subscribeModelKey: model.subscribe,
      subscribeChainType: chain.subscribe,
      subscribeProject: project.subscribe,
      refresh,
    });
    model.emit();
    chain.emit();
    project.emit();

    expect(refresh).toHaveBeenCalledTimes(4);
    unsubscribe();
    unsubscribe();
    model.emit();
    chain.emit();
    project.emit();
    expect(refresh).toHaveBeenCalledTimes(4);
    expect([model.listeners.size, chain.listeners.size, project.listeners.size]).toEqual([0, 0, 0]);
  });

  it("isolates refresh failures from the selection event owner", () => {
    const model = createSource();
    const chain = createSource();
    const project = createSource();

    const unsubscribe = subscribeKnowledgeSetupSelectionChanges({
      subscribeModelKey: model.subscribe,
      subscribeChainType: chain.subscribe,
      subscribeProject: project.subscribe,
      refresh: () => {
        throw new Error("presentation failed");
      },
    });

    expect(() => model.emit()).not.toThrow();
    unsubscribe();
  });

  it("rolls back prior listeners when a later subscription cannot be installed", () => {
    const model = createSource();
    const project = createSource();
    const refresh = jest.fn();

    const unsubscribe = subscribeKnowledgeSetupSelectionChanges({
      subscribeModelKey: model.subscribe,
      subscribeChainType: () => {
        throw new Error("subscription failed");
      },
      subscribeProject: project.subscribe,
      refresh,
    });

    expect(model.listeners.size).toBe(0);
    expect(project.subscribe).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
