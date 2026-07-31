import {
  KNOWLEDGE_STUDIO_INITIAL_UNAVAILABLE_NOTICE,
  KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE,
  KnowledgeStudioSessionDisposedError,
  KnowledgeStudioSessionSelectionError,
  KnowledgeStudioSessionStore,
  type KnowledgeStudioSessionState,
} from "@/knowledge/ui/KnowledgeStudioSessionStore";

/** Copies the exact public state fields captured by one synchronous listener. */
function copyState(state: KnowledgeStudioSessionState): KnowledgeStudioSessionState {
  if (state.bundleId === undefined) {
    return {
      revision: state.revision,
      unavailableNotice: state.unavailableNotice,
    };
  }
  return {
    revision: state.revision,
    bundleId: state.bundleId,
    unavailableNotice: state.unavailableNotice,
  };
}

describe("KnowledgeStudioSessionStore", () => {
  it("publishes dynamic no-selection, unique-Bundle, then cleared selection states", () => {
    const store = new KnowledgeStudioSessionStore("Waiting for project selection.");
    const observations: KnowledgeStudioSessionState[] = [];
    const unsubscribe = store.subscribe(() => {
      observations.push(copyState(store.getState()));
    });

    store.replaceSelection("personal", "Workflow adapters remain unavailable.");
    store.replaceSelection(undefined, "No knowledge Bundle is selected.");
    unsubscribe();
    unsubscribe();
    store.replaceSelection("research", "Still unavailable.");

    expect(observations).toEqual([
      {
        revision: 0,
        unavailableNotice: "Waiting for project selection.",
      },
      {
        revision: 1,
        bundleId: "personal",
        unavailableNotice: "Workflow adapters remain unavailable.",
      },
      {
        revision: 2,
        unavailableNotice: "No knowledge Bundle is selected.",
      },
    ]);
    expect(store.getState()).toEqual({
      revision: 3,
      bundleId: "research",
      unavailableNotice: "Still unavailable.",
    });
  });

  it("starts without a Bundle and immediately notifies new subscribers", () => {
    const store = new KnowledgeStudioSessionStore();
    const listener = jest.fn();

    const unsubscribe = store.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({
      revision: 0,
      unavailableNotice: KNOWLEDGE_STUDIO_INITIAL_UNAVAILABLE_NOTICE,
    });
    expect(Object.keys(store.getState()).sort()).toEqual(["revision", "unavailableNotice"]);
    unsubscribe();
  });

  it("rejects empty selection input with fixed errors and no state mutation", () => {
    const store = new KnowledgeStudioSessionStore("Initial safe notice.");
    const initialState = store.getState();
    const rawNotice = "   ";

    expect(() => store.replaceSelection("", "Safe notice.")).toThrow(
      KnowledgeStudioSessionSelectionError
    );
    expect(() => store.replaceSelection("personal", rawNotice)).toThrow(
      KnowledgeStudioSessionSelectionError
    );
    expect(() => store.replaceSelection(42 as unknown as string, "Safe notice.")).toThrow(
      KnowledgeStudioSessionSelectionError
    );
    expect(store.getState()).toBe(initialState);

    try {
      store.replaceSelection("personal", rawNotice);
    } catch (error) {
      expect(error).toEqual(new KnowledgeStudioSessionSelectionError());
      expect(String(error)).not.toContain(rawNotice);
    }
  });

  it("isolates listener failures from later listeners and future publications", () => {
    const store = new KnowledgeStudioSessionStore();
    const observations: number[] = [];

    expect(() =>
      store.subscribe(() => {
        throw new Error("listener failure");
      })
    ).not.toThrow();
    store.subscribe(() => {
      observations.push(store.getState().revision);
    });

    expect(() => store.replaceSelection("personal", "Adapters are unavailable.")).not.toThrow();
    expect(observations).toEqual([0, 1]);
  });

  it("freezes every published state and exposes no extra fields", () => {
    const store = new KnowledgeStudioSessionStore();
    const initial = store.getState();

    store.replaceSelection("personal", "Adapters are unavailable.");
    const selected = store.getState();
    store.replaceSelection(undefined, "Selection cleared.");
    const cleared = store.getState();

    expect([initial, selected, cleared].every(Object.isFrozen)).toBe(true);
    expect(Object.keys(selected).sort()).toEqual(["bundleId", "revision", "unavailableNotice"]);
    expect(Object.keys(cleared).sort()).toEqual(["revision", "unavailableNotice"]);
  });

  it("disposes once, publishes the fixed unload state, clears listeners, and cannot reopen", () => {
    const store = new KnowledgeStudioSessionStore();
    const observations: KnowledgeStudioSessionState[] = [];
    store.replaceSelection("personal", "Caller-provided notice.");
    store.subscribe(() => {
      observations.push(copyState(store.getState()));
      if (store.getState().unavailableNotice === KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE) {
        expect(() => store.replaceSelection("reentrant", "Raw reentrant text.")).toThrow(
          KnowledgeStudioSessionDisposedError
        );
      }
    });

    store.dispose();
    const disposedState = store.getState();
    store.dispose();

    expect(disposedState).toEqual({
      revision: 2,
      unavailableNotice: KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE,
    });
    expect(Object.isFrozen(disposedState)).toBe(true);
    expect(store.getState()).toBe(disposedState);
    expect(observations).toEqual([
      {
        revision: 1,
        bundleId: "personal",
        unavailableNotice: "Caller-provided notice.",
      },
      {
        revision: 2,
        unavailableNotice: KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE,
      },
    ]);

    const lateListener = jest.fn();
    const lateUnsubscribe = store.subscribe(lateListener);
    lateUnsubscribe();
    lateUnsubscribe();
    expect(lateListener).toHaveBeenCalledTimes(1);

    const rawBundle = "private-bundle";
    const rawNotice = "C:\\private\\vault";
    try {
      store.replaceSelection(rawBundle, rawNotice);
      throw new Error("Expected disposed replacement to fail");
    } catch (error) {
      expect(error).toEqual(new KnowledgeStudioSessionDisposedError());
      expect(String(error)).not.toContain(rawBundle);
      expect(String(error)).not.toContain(rawNotice);
    }
    expect(JSON.stringify(store.getState())).not.toContain(rawBundle);
    expect(JSON.stringify(store.getState())).not.toContain(rawNotice);
  });
});
