import type { ProjectConfig } from "@/aiParams";
import type { ContextCache } from "@/cache/projectContextCache";
import type { App, Vault } from "obsidian";

import {
  ProjectLoadTracker,
  ProjectLoadTrackerDisposedError,
} from "@/LLMProviders/projectLoadTracker";

jest.mock("@/aiParams", () => ({
  projectContextLoadAtom: Symbol("projectContextLoadAtom"),
  setProjectContextLoadState: jest.fn((state: LoadState) => {
    const { settingsStore } = jest.requireMock<{
      settingsStore: Pick<MockSettingsStore, "set">;
    }>("@/settings/model");
    settingsStore.set(null, state);
  }),
  updateProjectContextLoadState: jest.fn(
    (
      key: keyof LoadState,
      valueFn: (previous: LoadState[keyof LoadState]) => LoadState[keyof LoadState]
    ) => {
      const { settingsStore } = jest.requireMock<{
        settingsStore: Pick<MockSettingsStore, "set">;
      }>("@/settings/model");
      settingsStore.set(null, (previous: LoadState) => ({
        ...previous,
        [key]: valueFn(previous[key]),
      }));
    }
  ),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

jest.mock("@/settings/model", () => {
  interface FailedItemState {
    path: string;
    type: "md" | "web" | "youtube" | "nonMd";
    error?: string;
    timestamp?: number;
  }

  interface LoadState {
    success: string[];
    failed: FailedItemState[];
    processingFiles: string[];
    total: string[];
  }

  type StateUpdate = LoadState | ((previous: LoadState) => LoadState);

  const emptyState = (): LoadState => ({
    success: [],
    failed: [],
    processingFiles: [],
    total: [],
  });
  let state = emptyState();

  return {
    settingsStore: {
      getTestState: jest.fn(() => state),
      resetTestState: jest.fn(() => {
        state = emptyState();
      }),
      set: jest.fn((_atom: unknown, update: StateUpdate) => {
        state = typeof update === "function" ? update(state) : update;
      }),
    },
  };
});

jest.mock("@/utils", () => ({
  err2String: jest.fn((error: unknown) => (error instanceof Error ? error.message : String(error))),
}));

jest.mock("@/utils/rateLimitUtils", () => ({
  isRateLimitError: jest.fn(() => false),
}));

interface LoadState {
  success: string[];
  failed: Array<{
    path: string;
    type: "md" | "web" | "youtube" | "nonMd";
    error?: string;
    timestamp?: number;
  }>;
  processingFiles: string[];
  total: string[];
}

interface MockSettingsStore {
  getTestState: jest.Mock<LoadState>;
  resetTestState: jest.Mock<void>;
  set: jest.Mock;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

/**
 * Create an externally controlled Promise for lifecycle continuation tests.
 *
 * @returns Deferred Promise and settlement functions
 */
function createDeferred<T>(): Deferred<T> {
  let reject!: (reason: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

/**
 * Build a Vault identity for lifecycle ownership tests.
 *
 * @param name - Human-readable test identity
 * @returns Minimal Vault mock
 */
function createVault(name: string): Vault {
  return { name } as unknown as Vault;
}

/**
 * Build a minimal App around a Vault identity.
 *
 * @param vault - Vault owned by the App
 * @returns Minimal App mock
 */
function createApp(vault: Vault): App {
  return { vault } as App;
}

/**
 * Read the mocked shared project-load state.
 *
 * @returns Current mocked state
 */
function getLoadState(): LoadState {
  const { settingsStore } = jest.requireMock<{
    settingsStore: MockSettingsStore;
  }>("@/settings/model");
  return settingsStore.getTestState();
}

/**
 * Reset the mocked shared project-load state.
 */
function resetLoadState(): void {
  const { settingsStore } = jest.requireMock<{
    settingsStore: MockSettingsStore;
  }>("@/settings/model");
  settingsStore.resetTestState();
}

/**
 * Build the smallest project accepted by the tracker.
 *
 * @returns Project fixture with empty source configuration
 */
function createProject(): ProjectConfig {
  return {
    contextSource: {
      inclusions: "",
      exclusions: "",
      webUrls: "",
      youtubeUrls: "",
    },
    id: "project-a",
    name: "Project A",
  } as ProjectConfig;
}

describe("ProjectLoadTracker lifecycle ownership", () => {
  const trackers: ProjectLoadTracker[] = [];

  /**
   * Resolve and remember a tracker so test cleanup can retire the active owner.
   *
   * @param app - App lifecycle requesting the tracker
   * @returns Tracker owned by the App
   */
  function getTracker(app: App): ProjectLoadTracker {
    const tracker = ProjectLoadTracker.getInstance(app);
    trackers.push(tracker);
    return tracker;
  }

  /**
   * Start and remember a fresh plugin-owned tracker lifecycle.
   *
   * @param app - App lifecycle starting the tracker
   * @returns Fresh tracker owned by the plugin lifecycle
   */
  function startTracker(app: App): ProjectLoadTracker {
    const tracker = ProjectLoadTracker.startLifecycle(app);
    trackers.push(tracker);
    return tracker;
  }

  beforeEach(() => {
    trackers.length = 0;
    resetLoadState();
    jest.clearAllMocks();
  });

  afterEach(() => {
    trackers.forEach((tracker) => tracker.dispose());
    resetLoadState();
  });

  it("reuses only the exact same App and Vault owner", () => {
    const vault = createVault("vault-a");
    const app = createApp(vault);
    const first = getTracker(app);

    expect(getTracker(app)).toBe(first);

    const replacement = getTracker(createApp(vault));

    expect(replacement).not.toBe(first);
    expect(() => first.clearAllLoadStates()).toThrow(ProjectLoadTrackerDisposedError);
  });

  it("rebinds when the Vault changes and rejects every stale public mutator", async () => {
    const app = createApp(createVault("vault-a"));
    const first = getTracker(app);
    Object.assign(app, { vault: createVault("vault-b") });
    getTracker(app);
    const project = createProject();
    const contextCache = {
      fileContexts: {},
      webContexts: {},
      youtubeContexts: {},
    } as ContextCache;

    expect(() => first.clearAllLoadStates()).toThrow(ProjectLoadTrackerDisposedError);
    expect(() => first.preComputeAllItems(project, [])).toThrow(ProjectLoadTrackerDisposedError);
    expect(() => first.markAllCachedItemsAsSuccess(project, contextCache, [])).toThrow(
      ProjectLoadTrackerDisposedError
    );
    expect(() => first.markCachedItemAsSuccess("stale.md")).toThrow(
      ProjectLoadTrackerDisposedError
    );
    expect(() => first.makeItemFailed("stale.md", "md")).toThrow(ProjectLoadTrackerDisposedError);
    await expect(
      first.executeWithProcessTracking("stale.md", "md", async () => "ignored")
    ).rejects.toBeInstanceOf(ProjectLoadTrackerDisposedError);
  });

  it("does not let a stale dispose erase replacement progress", () => {
    const first = getTracker(createApp(createVault("vault-a")));
    const secondApp = createApp(createVault("vault-b"));
    const second = getTracker(secondApp);
    second.markCachedItemAsSuccess("new.md");

    first.dispose();

    expect(getLoadState()).toEqual({
      success: ["new.md"],
      failed: [],
      processingFiles: [],
      total: ["new.md"],
    });
    expect(getTracker(secondApp)).toBe(second);
  });

  it("starts a fresh owner for same-App hot reload overlap", () => {
    const app = createApp(createVault("vault-a"));
    const first = startTracker(app);
    first.markCachedItemAsSuccess("old.md");

    const second = startTracker(app);
    second.markCachedItemAsSuccess("new.md");
    first.dispose();

    expect(second).not.toBe(first);
    expect(getTracker(app)).toBe(second);
    expect(getLoadState()).toEqual({
      success: ["new.md"],
      failed: [],
      processingFiles: [],
      total: ["new.md"],
    });
  });

  it("prevents a deferred old success from publishing after replacement", async () => {
    const deferred = createDeferred<string>();
    const app = createApp(createVault("vault-a"));
    const first = startTracker(app);
    const oldOperation = first.executeWithProcessTracking("old.md", "md", () => deferred.promise);
    const second = startTracker(app);
    second.markCachedItemAsSuccess("new.md");

    deferred.resolve("old result");

    await expect(oldOperation).rejects.toBeInstanceOf(ProjectLoadTrackerDisposedError);
    expect(getLoadState()).toEqual({
      success: ["new.md"],
      failed: [],
      processingFiles: [],
      total: ["new.md"],
    });
  });

  it("prevents a deferred old failure from publishing after replacement", async () => {
    const deferred = createDeferred<string>();
    const first = getTracker(createApp(createVault("vault-a")));
    const oldOperation = first.executeWithProcessTracking("old.md", "md", () => deferred.promise);
    const second = getTracker(createApp(createVault("vault-b")));
    second.markCachedItemAsSuccess("new.md");

    deferred.reject(new Error("old failure"));

    await expect(oldOperation).rejects.toBeInstanceOf(ProjectLoadTrackerDisposedError);
    expect(getLoadState()).toEqual({
      success: ["new.md"],
      failed: [],
      processingFiles: [],
      total: ["new.md"],
    });
  });

  it("tracks an active operation failure without changing the thrown error", async () => {
    const tracker = getTracker(createApp(createVault("vault-a")));
    const operationError = new Error("parse failed");

    await expect(
      tracker.executeWithProcessTracking("broken.md", "md", async () => {
        throw operationError;
      })
    ).rejects.toBe(operationError);

    expect(getLoadState()).toEqual({
      success: [],
      failed: [
        expect.objectContaining({
          error: "parse failed",
          path: "broken.md",
          type: "md",
        }),
      ],
      processingFiles: [],
      total: ["broken.md"],
    });
  });

  it("clears active progress on dispose and disposes idempotently", () => {
    const tracker = getTracker(createApp(createVault("vault-a")));
    tracker.markCachedItemAsSuccess("cached.md");

    tracker.dispose();
    tracker.dispose();

    expect(getLoadState()).toEqual({
      success: [],
      failed: [],
      processingFiles: [],
      total: [],
    });
    expect(() => tracker.markCachedItemAsSuccess("stale.md")).toThrow(
      ProjectLoadTrackerDisposedError
    );
  });
});
