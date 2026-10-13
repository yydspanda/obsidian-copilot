export type KnowledgeSetupSelectionSubscribe = (listener: () => void) => () => void;

export interface KnowledgeSetupSelectionSubscriptionDependencies {
  subscribeModelKey: KnowledgeSetupSelectionSubscribe;
  subscribeChainType: KnowledgeSetupSelectionSubscribe;
  subscribeProject: KnowledgeSetupSelectionSubscribe;
  refresh(): void;
}

function invokeSafely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Readiness presentation cannot interrupt an authoritative selection change.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

function unsubscribeSafely(unsubscribe: () => void): void {
  try {
    unsubscribe();
  } catch {
    // One faulty subscriber owner cannot prevent the remaining cleanup.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

export function subscribeKnowledgeSetupSelectionChanges(
  dependencies: KnowledgeSetupSelectionSubscriptionDependencies
): () => void {
  let active = true;
  const unsubscribers: Array<() => void> = [];
  const refresh = (): void => {
    if (!active) return;
    invokeSafely(() => dependencies.refresh());
  };

  try {
    for (const subscribe of [
      (listener: () => void) => dependencies.subscribeModelKey(listener),
      (listener: () => void) => dependencies.subscribeChainType(listener),
      (listener: () => void) => dependencies.subscribeProject(listener),
    ]) {
      const unsubscribe = subscribe(refresh);
      if (typeof unsubscribe !== "function") {
        throw new TypeError("Knowledge setup selection subscription is unavailable");
      }
      unsubscribers.push(unsubscribe);
    }
  } catch {
    active = false;
    for (const unsubscribe of unsubscribers.reverse()) {
      unsubscribeSafely(unsubscribe);
    }
    return () => undefined;
  }

  refresh();
  return (): void => {
    if (!active) return;
    active = false;
    for (const unsubscribe of unsubscribers.reverse()) {
      unsubscribeSafely(unsubscribe);
    }
  };
}
