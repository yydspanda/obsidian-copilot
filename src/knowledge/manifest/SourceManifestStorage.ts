import type { SourceManifest } from "@/knowledge/model/types";

export class SourceManifestRevisionConflictError extends Error {
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

export interface SourceManifestStorage {
  read(bundleId: string): Promise<unknown>;

  write(bundleId: string, manifest: SourceManifest, expectedRevision: number | null): Promise<void>;
}
