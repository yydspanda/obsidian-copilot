/** Initial notice shown before any knowledge Bundle is selected. */
export const KNOWLEDGE_STUDIO_INITIAL_UNAVAILABLE_NOTICE =
  "Knowledge Studio is unavailable until a knowledge Bundle is selected.";

/** Fixed fail-closed notice published while the plugin unloads. */
export const KNOWLEDGE_STUDIO_UNLOAD_UNAVAILABLE_NOTICE =
  "Knowledge Studio is unavailable because the plugin is unloading.";

/** Immutable Knowledge Studio selection observed by controller/view wiring. */
export interface KnowledgeStudioSessionState {
  readonly revision: number;
  readonly bundleId?: string;
  readonly unavailableNotice: string;
}

/** Callback notified synchronously after a state publication. */
export type KnowledgeStudioSessionListener = () => void;

/** Fixed error raised for malformed selection input without retaining caller text. */
export class KnowledgeStudioSessionSelectionError extends TypeError {
  /** Creates a sanitized selection validation failure. */
  constructor() {
    super("Knowledge Studio session selection is invalid");
    this.name = "KnowledgeStudioSessionSelectionError";
  }
}

/** Fixed error raised when a disposed session is asked to reopen. */
export class KnowledgeStudioSessionDisposedError extends Error {
  /** Creates a sanitized permanent-closure failure. */
  constructor() {
    super("Knowledge Studio session has been disposed");
    this.name = "KnowledgeStudioSessionDisposedError";
  }
}

/**
 * Validates one required non-whitespace string without transforming it.
 *
 * @param value - Unknown boundary value
 * @returns Whether the value satisfies the session text contract
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Creates one exact, frozen session state.
 *
 * @param revision - Monotonic in-memory revision
 * @param bundleId - Optional selected Bundle identifier
 * @param unavailableNotice - Sanitized unavailable explanation
 * @returns Frozen state with no fields beyond the public contract
 */
function createSessionState(
  revision: number,
  bundleId: string | undefined,
  unavailableNotice: string
): KnowledgeStudioSessionState {
  if (bundleId === undefined) {
    return Object.freeze({ revision, unavailableNotice });
  }
  return Object.freeze({ revision, bundleId, unavailableNotice });
}

/**
 * Invokes one non-authoritative observer without allowing it to break publication.
 *
 * @param listener - Session observer
 */
function notifyListenerSafely(listener: KnowledgeStudioSessionListener): void {
  try {
    listener();
  } catch {
    // Session observers cannot interrupt the store or one another.
  }
}

/**
 * Stable synchronous selection store for one Knowledge Studio plugin session.
 *
 * The store publishes only unavailable selection metadata. It does not own any
 * runtime, workflow, controller, or Vault operation.
 */
export class KnowledgeStudioSessionStore {
  private state: KnowledgeStudioSessionState;
  private readonly listeners = new Set<KnowledgeStudioSessionListener>();
  private disposed = false;

  /**
   * Creates an initially unselected, fail-closed session.
   *
   * @param initialUnavailableNotice - Sanitized initial unavailable explanation
   */
  constructor(initialUnavailableNotice: string = KNOWLEDGE_STUDIO_INITIAL_UNAVAILABLE_NOTICE) {
    if (!isNonEmptyString(initialUnavailableNotice)) {
      throw new KnowledgeStudioSessionSelectionError();
    }
    this.state = createSessionState(0, undefined, initialUnavailableNotice);
  }

  /** Returns the current frozen state synchronously. */
  getState(): KnowledgeStudioSessionState {
    return this.state;
  }

  /**
   * Replaces the selected Bundle and synchronously publishes a new revision.
   *
   * @param bundleId - Selected Bundle identifier, or undefined to clear selection
   * @param sanitizedNotice - Sanitized unavailable explanation for this selection
   */
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

  /**
   * Subscribes to state publications and immediately reports the current state.
   *
   * Registration happens before the immediate notification, preventing a
   * get/subscribe window from losing a synchronous replacement. A subscription
   * created after disposal receives the final state once but is not retained.
   *
   * @param listener - Callback that reads current state through `getState`
   * @returns Idempotent unsubscribe callback
   */
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

  /**
   * Permanently closes the session and publishes one fixed unload state.
   *
   * Disposal is idempotent. It closes replacement authority before notifying
   * observers, so a reentrant listener cannot reopen the session.
   */
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

  /** Returns the next safe in-memory revision. */
  private nextRevision(): number {
    if (
      !Number.isSafeInteger(this.state.revision) ||
      this.state.revision >= Number.MAX_SAFE_INTEGER
    ) {
      throw new KnowledgeStudioSessionDisposedError();
    }
    return this.state.revision + 1;
  }

  /** Notifies a stable snapshot so subscription mutation cannot change this publication. */
  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      notifyListenerSafely(listener);
    }
  }
}
