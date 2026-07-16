import type { SourceManifest } from "@/knowledge/model/types";

/**
 * Signals that a manifest changed after it was read and before it was written.
 *
 * Storage adapters throw this error instead of silently overwriting a newer
 * revision. The repository may reload, reapply its deterministic mutation,
 * and retry within a bounded attempt count.
 */
export class SourceManifestRevisionConflictError extends Error {
  /**
   * Creates an optimistic concurrency conflict.
   *
   * @param bundleId - Bundle whose manifest changed concurrently
   * @param expectedRevision - Revision observed before the attempted write
   */
  constructor(
    public readonly bundleId: string,
    public readonly expectedRevision: number | null,
    public readonly actualRevision?: number | null
  ) {
    super(
      expectedRevision === null
        ? `Source manifest '${bundleId}' was created concurrently`
        : `Source manifest '${bundleId}' changed after revision ${expectedRevision}` +
            (actualRevision === undefined ? "" : `; observed revision ${actualRevision}`)
    );
    this.name = "SourceManifestRevisionConflictError";
  }
}

/** Persistence port for versioned Source Manifest JSON. */
export interface SourceManifestStorage {
  /**
   * Reads unknown persisted JSON for one Bundle.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Unknown JSON, or null when no manifest has been persisted
   */
  read(bundleId: string): Promise<unknown>;

  /**
   * Writes a complete validated manifest with optimistic revision checking.
   *
   * `expectedRevision` is null only when the caller observed no existing
   * manifest. Adapters must reject an existing target in that case.
   *
   * @param bundleId - Stable Bundle identifier
   * @param manifest - Complete next manifest revision
   * @param expectedRevision - Previously observed revision, or null for create
   */
  write(bundleId: string, manifest: SourceManifest, expectedRevision: number | null): Promise<void>;
}
