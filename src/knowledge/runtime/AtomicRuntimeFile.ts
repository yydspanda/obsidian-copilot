/**
 * Atomic plaintext-file boundary used by the durable knowledge runtime store.
 *
 * Implementations must initialize the file without overwriting an existing
 * store and must serialize every synchronous transform as one atomic
 * read-modify-write operation.
 */
export interface AtomicRuntimeFile {
  /**
   * Creates the runtime file only when it does not already exist.
   *
   * @param initialContent - Complete initial file contents
   */
  initialize(initialContent: string): Promise<void>;

  /** Returns the exact current plaintext contents. */
  read(): Promise<string>;

  /**
   * Atomically reads, transforms, and replaces the complete file contents.
   *
   * @param transform - Synchronous deterministic transform
   * @returns Exact text committed by the atomic file implementation
   */
  process(transform: (currentContent: string) => string): Promise<string>;
}
