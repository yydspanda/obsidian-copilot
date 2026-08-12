/** One synchronous selection-event subscription boundary. */
export type KnowledgeSetupSelectionSubscribe = (listener: () => void) => () => void;

/** Passive dependencies used to follow the effective ordinary Chat selection. */
export interface KnowledgeSetupSelectionSubscriptionDependencies {
  subscribeModelKey: KnowledgeSetupSelectionSubscribe;
  subscribeChainType: KnowledgeSetupSelectionSubscribe;
  subscribeProject: KnowledgeSetupSelectionSubscribe;
  refresh(): void;
}

/** Safely invokes one presentation-only callback. */
function invokeSafely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Readiness presentation cannot interrupt an authoritative selection change.
  }
}

/** Safely releases one upstream selection subscription. */
function unsubscribeSafely(unsubscribe: () => void): void {
  try {
    unsubscribe();
  } catch {
    // One faulty subscriber owner cannot prevent the remaining cleanup.
  }
}

/**
 * Follows all inputs that determine the effective ordinary Chat model.
 *
 * The returned cleanup closes a local generation before releasing upstream
 * listeners, so even an imperfect emitter cannot publish stale readiness after
 * plugin unload. Partial subscription failure rolls back every prior listener
 * and remains non-authoritative to normal Chat and Knowledge startup.
 *
 * @param dependencies - Three selection event sources and a local refresh callback
 * @returns Idempotent cleanup for this presentation-only subscription generation
 */
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
