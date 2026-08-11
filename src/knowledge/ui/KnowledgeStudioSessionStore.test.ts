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
  if (state.status === "refreshing") {
    return {
      status: "refreshing",
      revision: state.revision,
    };
  }
  if (state.status === "unavailable") {
    return {
      status: "unavailable",
      revision: state.revision,
      unavailableNotice: state.unavailableNotice,
    };
  }
  return {
    status: "selected",
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
        status: "unavailable",
        revision: 0,
        unavailableNotice: "Waiting for project selection.",
      },
      {
        status: "selected",
        revision: 1,
        bundleId: "personal",
        unavailableNotice: "Workflow adapters remain unavailable.",
      },
      {
        status: "unavailable",
        revision: 2,
        unavailableNotice: "No knowledge Bundle is selected.",
      },
    ]);
    expect(store.getState()).toEqual({
      status: "selected",
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
      status: "unavailable",
      revision: 0,
      unavailableNotice: KNOWLEDGE_STUDIO_INITIAL_UNAVAILABLE_NOTICE,
    });
    expect(Object.keys(store.getState()).sort()).toEqual([
      "revision",
      "status",
      "unavailableNotice",
    ]);
    unsubscribe();
  });

  it("publishes an explicit action-free refresh before the same Bundle is selected again", () => {
    const store = new KnowledgeStudioSessionStore("Waiting.");
    const observations: KnowledgeStudioSessionState[] = [];
    store.subscribe(() => observations.push(copyState(store.getState())));

    store.replaceSelection("personal", "Ready.");
    store.publishRefreshing();
    store.publishRefreshing();
    store.replaceSelection("personal", "Ready again.");

    expect(observations).toEqual([
      { status: "unavailable", revision: 0, unavailableNotice: "Waiting." },
      {
        status: "selected",
        revision: 1,
        bundleId: "personal",
        unavailableNotice: "Ready.",
      },
      { status: "refreshing", revision: 2 },
      { status: "refreshing", revision: 3 },
      {
        status: "selected",
        revision: 4,
        bundleId: "personal",
        unavailableNotice: "Ready again.",
      },
    ]);
    expect(Object.keys(observations[2]).sort()).toEqual(["revision", "status"]);
    expect(observations[2].bundleId).toBeUndefined();
    expect(observations[2].unavailableNotice).toBeUndefined();
    expect(Object.isFrozen(store.getState())).toBe(true);
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
    store.publishRefreshing();
    const refreshing = store.getState();
    store.replaceSelection(undefined, "Selection cleared.");
    const cleared = store.getState();

    expect([initial, selected, refreshing, cleared].every(Object.isFrozen)).toBe(true);
    expect(Object.keys(selected).sort()).toEqual([
      "bundleId",
      "revision",
      "status",
      "unavailableNotice",
    ]);
    expect(Object.keys(refreshing).sort()).toEqual(["revision", "status"]);
    expect(Object.keys(cleared).sort()).toEqual(["revision", "status", "unavailableNotice"]);
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
      status: "unavailable",
      revision: 2,
      unavailableNotice: KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE,
    });
    expect(Object.isFrozen(disposedState)).toBe(true);
    expect(store.getState()).toBe(disposedState);
    expect(observations).toEqual([
      {
        status: "selected",
        revision: 1,
        bundleId: "personal",
        unavailableNotice: "Caller-provided notice.",
      },
      {
        status: "unavailable",
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
    expect(() => store.publishRefreshing()).toThrow(KnowledgeStudioSessionDisposedError);
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
