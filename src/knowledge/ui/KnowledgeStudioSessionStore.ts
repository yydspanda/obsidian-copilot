export const KNOWLEDGE_STUDIO_INITIAL_UNAVAILABLE_NOTICE =
  "Knowledge Studio is unavailable until a knowledge Bundle is selected.";

export const KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE =
  "Knowledge Studio is unavailable because the plugin is unloading.";

export type KnowledgeStudioSessionState =
  | Readonly<{
      status: "unavailable";
      revision: number;
      bundleId?: never;
      unavailableNotice: string;
    }>
  | Readonly<{
      status: "selected";
      revision: number;
      bundleId: string;
      unavailableNotice: string;
    }>
  | Readonly<{
      status: "refreshing";
      revision: number;
      bundleId?: never;
      unavailableNotice?: never;
    }>;

export type KnowledgeStudioSessionListener = () => void;

export class KnowledgeStudioSessionSelectionError extends TypeError {
  constructor() {
    super("Knowledge Studio session selection is invalid");
    this.name = "KnowledgeStudioSessionSelectionError";
  }
}

export class KnowledgeStudioSessionDisposedError extends Error {
  constructor() {
    super("Knowledge Studio session has been disposed");
    this.name = "KnowledgeStudioSessionDisposedError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createSessionState(
  revision: number,
  bundleId: string | undefined,
  unavailableNotice: string
): KnowledgeStudioSessionState {
  if (bundleId === undefined) {
    return Object.freeze({ status: "unavailable", revision, unavailableNotice });
  }
  return Object.freeze({ status: "selected", revision, bundleId, unavailableNotice });
}

function createRefreshingState(revision: number): KnowledgeStudioSessionState {
  return Object.freeze({ status: "refreshing", revision });
}

function notifyListenerSafely(listener: KnowledgeStudioSessionListener): void {
  try {
    listener();
  } catch {
    // Session observers cannot interrupt the store or one another.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

export class KnowledgeStudioSessionStore {
  private state: KnowledgeStudioSessionState;
  private readonly listeners = new Set<KnowledgeStudioSessionListener>();
  private disposed = false;

  constructor(initialUnavailableNotice: string = KNOWLEDGE_STUDIO_INITIAL_UNAVAILABLE_NOTICE) {
    if (!isNonEmptyString(initialUnavailableNotice)) {
      throw new KnowledgeStudioSessionSelectionError();
    }
    this.state = createSessionState(0, undefined, initialUnavailableNotice);
  }

  getState(): KnowledgeStudioSessionState {
    return this.state;
  }

  replaceSelection(bundleId: string | undefined, sanitizedNotice: string): void {
    if (this.disposed) {
      throw new KnowledgeStudioSessionDisposedError();
    }
    if (
      !isNonEmptyString(sanitizedNotice) ||
      (bundleId !== undefined && !isNonEmptyString(bundleId))
    ) {
      throw new KnowledgeStudioSessionSelectionError();
    }

    this.state = createSessionState(this.nextRevision(), bundleId, sanitizedNotice);
    this.notifyListeners();
  }

  publishRefreshing(): void {
    if (this.disposed) {
      throw new KnowledgeStudioSessionDisposedError();
    }
    this.state = createRefreshingState(this.nextRevision());
    this.notifyListeners();
  }

  subscribe(listener: KnowledgeStudioSessionListener): () => void {
    if (this.disposed) {
      notifyListenerSafely(listener);
      return () => undefined;
    }

    this.listeners.add(listener);
    notifyListenerSafely(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.state = createSessionState(
      this.nextRevision(),
      undefined,
      KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE
    );
    this.notifyListeners();
    this.listeners.clear();
  }

  private nextRevision(): number {
    if (
      !Number.isSafeInteger(this.state.revision) ||
      this.state.revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new KnowledgeStudioSessionDisposedError();
    }
    return this.state.revision + 1;
  }

  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      notifyListenerSafely(listener);
    }
  }
}
