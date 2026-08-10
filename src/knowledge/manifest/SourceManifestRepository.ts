import { decideSourceFreshness } from "@/knowledge/manifest/freshness";
import {
  KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY,
  parseKnowledgeNoChangesCommitMarker,
  validateNoChangesManifestCommitMarker,
} from "@/knowledge/manifest/NoChangesManifestCommit";
import {
  KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY,
  parseKnowledgeRuntimeSourceCommitExtension,
} from "@/knowledge/manifest/KnowledgeRuntimeSourceCommit";
import {
  SourceManifestRevisionConflictError,
  type SourceManifestStorage,
} from "@/knowledge/manifest/SourceManifestStorage";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  OutputObservation,
  SourceCompileFailure,
  SourceCompileSnapshot,
  SourceCustody,
  SourceFreshnessDecision,
  SourceManifest,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import { validateSourceManifest, validateVaultRelativePath } from "@/knowledge/model/validation";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const DEFAULT_MAX_WRITE_ATTEMPTS = 3;

/** Input used to register one durable source identity. */
export interface SourceRegistration {
  sourceId: string;
  sourcePath: string;
  custody: SourceCustody;
  extensions?: Record<string, JsonValue>;
}

/**
 * Reports persisted manifest JSON that cannot satisfy the current contract.
 */
export class SourceManifestValidationError extends Error {
  /**
   * Creates a manifest validation failure without retaining raw persisted data.
   *
   * @param bundleId - Bundle whose manifest failed validation
   * @param diagnostics - Stable structural or semantic validation issues
   */
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`Source manifest '${bundleId}' does not satisfy the current contract`);
    this.name = "SourceManifestValidationError";
  }
}

/** Reports a persisted manifest version that this runtime cannot safely read. */
export class SourceManifestIncompatibleVersionError extends Error {
  /**
   * Creates an incompatible manifest version failure.
   *
   * @param bundleId - Bundle whose manifest uses an unsupported version
   * @param version - Unknown persisted version value
   */
  constructor(
    public readonly bundleId: string,
    public readonly version: unknown
  ) {
    super(`Source manifest '${bundleId}' uses an unsupported version`);
    this.name = "SourceManifestIncompatibleVersionError";
  }
}

/** Reports a storage key whose manifest claims to belong to a different Bundle. */
export class SourceManifestBundleMismatchError extends Error {
  /**
   * Creates a Bundle identity mismatch.
   *
   * @param requestedBundleId - Bundle used to read storage
   * @param storedBundleId - Bundle declared by the persisted manifest
   */
  constructor(
    public readonly requestedBundleId: string,
    public readonly storedBundleId: string
  ) {
    super(`Source manifest stored for '${requestedBundleId}' belongs to '${storedBundleId}'`);
    this.name = "SourceManifestBundleMismatchError";
  }
}

/** Reports a source path or id that would collide with an existing identity. */
export class SourceManifestIdentityConflictError extends Error {
  /**
   * Creates a stable source identity conflict.
   *
   * @param bundleId - Bundle containing the conflicting source
   * @param sourceId - Source id requested by the operation
   * @param sourcePath - Source path requested by the operation
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly sourcePath: string
  ) {
    super(`Source '${sourceId}' conflicts with an existing identity in '${bundleId}'`);
    this.name = "SourceManifestIdentityConflictError";
  }
}

/** Reports an operation targeting a source id that is not registered. */
export class SourceManifestSourceNotFoundError extends Error {
  /**
   * Creates a missing source failure.
   *
   * @param bundleId - Bundle expected to contain the source
   * @param sourceId - Missing stable source identifier
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string
  ) {
    super(`Source '${sourceId}' is not registered in Bundle '${bundleId}'`);
    this.name = "SourceManifestSourceNotFoundError";
  }
}

/** Reports a manifest revision that cannot be incremented without precision loss. */
export class SourceManifestRevisionOverflowError extends Error {
  /**
   * Creates a safe-integer revision overflow failure.
   *
   * @param bundleId - Bundle whose revision reached the safe integer limit
   * @param revision - Last safely represented revision
   */
  constructor(
    public readonly bundleId: string,
    public readonly revision: number
  ) {
    super(`Source manifest '${bundleId}' cannot advance beyond revision ${revision}`);
    this.name = "SourceManifestRevisionOverflowError";
  }
}

/** Reports optimistic write conflicts that exceeded the bounded retry policy. */
export class SourceManifestWriteConflictExhaustedError extends Error {
  /**
   * Creates an exhausted manifest write conflict.
   *
   * @param bundleId - Bundle whose write could not converge
   * @param attempts - Number of attempted read-transform-write cycles
   * @param conflict - Last observed storage conflict
   */
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number,
    public readonly conflict: SourceManifestRevisionConflictError
  ) {
    super(`Source manifest '${bundleId}' still conflicted after ${attempts} attempts`);
    this.name = "SourceManifestWriteConflictExhaustedError";
  }
}

/** Reports two distinct observations claiming the same source timestamp. */
export class SourceManifestObservationConflictError extends Error {
  /**
   * Creates a same-time observation conflict that cannot be ordered safely.
   *
   * @param bundleId - Bundle containing the source
   * @param sourceId - Stable source identifier
   * @param observation - Successful or failed observation kind
   * @param occurredAt - Timestamp shared by different observations
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly observation: "success" | "failure",
    public readonly occurredAt: number
  ) {
    super(`Source '${sourceId}' has conflicting ${observation} observations at ${occurredAt}`);
    this.name = "SourceManifestObservationConflictError";
  }
}

/** Parsed manifest plus the revision expected by the next storage write. */
interface LoadedManifest {
  manifest: SourceManifest;
  expectedRevision: number | null;
}

/**
 * Checks whether an unknown value is a non-null record.
 *
 * @param value - Runtime value to inspect
 * @returns Whether fields can be read safely
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Creates a new, unpersisted source manifest.
 *
 * @param bundleId - Stable Bundle identifier
 * @returns Empty revision-zero manifest
 */
function createEmptyManifest(bundleId: string): SourceManifest {
  return { version: 1, bundleId, revision: 0, entries: [] };
}

/**
 * Requires a non-whitespace identifier at the repository boundary.
 *
 * @param value - Identifier supplied by an orchestration layer
 * @param field - Identifier name used by the error message
 */
function assertIdentifier(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must contain non-whitespace text`);
  }
}

/**
 * Finds a registered source or throws a typed not-found error.
 *
 * @param manifest - Current validated manifest
 * @param sourceId - Stable source identifier
 * @returns Registered source entry
 */
function requireSource(manifest: SourceManifest, sourceId: string): SourceManifestEntry {
  const source = manifest.entries.find((entry) => entry.sourceId === sourceId);
  if (!source) {
    throw new SourceManifestSourceNotFoundError(manifest.bundleId, sourceId);
  }
  return source;
}

/**
 * Replaces one source entry without mutating a parsed manifest.
 *
 * @param manifest - Current validated manifest
 * @param nextEntry - Complete replacement entry
 * @returns Immutable manifest proposal whose revision is assigned later
 */
function replaceSourceEntry(
  manifest: SourceManifest,
  nextEntry: SourceManifestEntry
): SourceManifest {
  return {
    ...manifest,
    entries: manifest.entries.map((entry) =>
      entry.sourceId === nextEntry.sourceId ? nextEntry : entry
    ),
  };
}

/**
 * Compares compile snapshots without relying on object key insertion order.
 *
 * @param left - First successful compile snapshot
 * @param right - Second successful compile snapshot
 * @returns Whether every persisted snapshot field is equal
 */
function areCompileSnapshotsEqual(
  left: SourceCompileSnapshot,
  right: SourceCompileSnapshot
): boolean {
  return (
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint &&
    left.changeSetId === right.changeSetId &&
    left.completedAt === right.completedAt &&
    left.generatedPages.length === right.generatedPages.length &&
    left.generatedPages.every((page, index) => {
      const otherPage = right.generatedPages[index];
      return (
        otherPage !== undefined &&
        page.path === otherPage.path &&
        page.ownership === otherPage.ownership &&
        page.contentHash === otherPage.contentHash
      );
    })
  );
}

/**
 * Compares failed compile observations field by field.
 *
 * @param left - First failed compile observation
 * @param right - Second failed compile observation
 * @returns Whether every persisted failure field is equal
 */
function areCompileFailuresEqual(left: SourceCompileFailure, right: SourceCompileFailure): boolean {
  return (
    left.sourceContentHash === right.sourceContentHash &&
    left.pipelineFingerprint === right.pipelineFingerprint &&
    left.failure.code === right.failure.code &&
    left.failure.message === right.failure.message &&
    left.failure.retryable === right.failure.retryable &&
    left.failure.occurredAt === right.failure.occurredAt
  );
}

/**
 * Persists and queries source identity and last committed compile state.
 *
 * Runtime Queue status intentionally lives outside this repository. Every
 * mutation uses optimistic revision checking and bounded conflict retries.
 */
export class SourceManifestRepository {
  private readonly maxWriteAttempts: number;

  /**
   * Creates a repository over an injected persistence adapter.
   *
   * @param storage - Manifest JSON persistence port
   * @param maxWriteAttempts - Maximum optimistic write attempts per mutation
   */
  constructor(
    private readonly storage: SourceManifestStorage,
    maxWriteAttempts = DEFAULT_MAX_WRITE_ATTEMPTS
  ) {
    if (!Number.isSafeInteger(maxWriteAttempts) || maxWriteAttempts < 1) {
      throw new TypeError("maxWriteAttempts must be a positive integer");
    }
    this.maxWriteAttempts = maxWriteAttempts;
  }

  /**
   * Loads and validates one Bundle manifest without creating storage eagerly.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Detached validated manifest or an empty revision-zero manifest
   */
  async load(bundleId: string): Promise<SourceManifest> {
    assertIdentifier(bundleId, "bundleId");
    const loaded = await this.loadForMutation(bundleId);
    return this.cloneValidatedManifest(bundleId, loaded.manifest);
  }

  /**
   * Returns a detached source entry when it is registered.
   *
   * @param bundleId - Stable Bundle identifier
   * @param sourceId - Stable source identifier
   * @returns Source entry or undefined
   */
  async getSource(bundleId: string, sourceId: string): Promise<SourceManifestEntry | undefined> {
    assertIdentifier(sourceId, "sourceId");
    const manifest = await this.load(bundleId);
    return manifest.entries.find((entry) => entry.sourceId === sourceId);
  }

  /**
   * Registers a new stable source identity idempotently.
   *
   * Reusing the same id and path is a no-op. Reusing either identity for a
   * different source fails closed; path changes must use {@link renameSource}.
   *
   * @param bundleId - Stable Bundle identifier
   * @param registration - Stable id, canonical path, custody, and extensions
   * @returns Detached registered source entry
   */
  async registerSource(
    bundleId: string,
    registration: SourceRegistration
  ): Promise<SourceManifestEntry> {
    assertIdentifier(bundleId, "bundleId");
    assertIdentifier(registration.sourceId, "sourceId");
    this.assertSourcePath(bundleId, registration.sourcePath);
    const sourceKey = toWindowsPathKey(registration.sourcePath);

    const manifest = await this.mutate(bundleId, (current) => {
      const byId = current.entries.find((entry) => entry.sourceId === registration.sourceId);
      const byPath = current.entries.find((entry) => entry.sourceKey === sourceKey);
      if (byId) {
        if (
          byId.sourceKey !== sourceKey ||
          byId.sourcePath !== registration.sourcePath ||
          byId.custody !== registration.custody
        ) {
          throw new SourceManifestIdentityConflictError(
            bundleId,
            registration.sourceId,
            registration.sourcePath
          );
        }
        return undefined;
      }
      if (byPath) {
        throw new SourceManifestIdentityConflictError(
          bundleId,
          registration.sourceId,
          registration.sourcePath
        );
      }

      const entry: SourceManifestEntry = {
        sourceId: registration.sourceId,
        sourceKey,
        sourcePath: registration.sourcePath,
        custody: registration.custody,
        ...(registration.extensions === undefined ? {} : { extensions: registration.extensions }),
      };
      return { ...current, entries: [...current.entries, entry] };
    });
    return requireSource(manifest, registration.sourceId);
  }

  /**
   * Changes a source path while preserving its durable sourceId and history.
   *
   * @param bundleId - Stable Bundle identifier
   * @param sourceId - Stable source identifier
   * @param sourcePath - New canonical Vault-relative path
   * @returns Detached renamed source entry
   */
  async renameSource(
    bundleId: string,
    sourceId: string,
    sourcePath: string
  ): Promise<SourceManifestEntry> {
    assertIdentifier(sourceId, "sourceId");
    this.assertSourcePath(bundleId, sourcePath);
    const sourceKey = toWindowsPathKey(sourcePath);
    const manifest = await this.mutate(bundleId, (current) => {
      const existing = requireSource(current, sourceId);
      if (existing.sourcePath === sourcePath) {
        return undefined;
      }
      const collision = current.entries.some(
        (entry) => entry.sourceId !== sourceId && entry.sourceKey === sourceKey
      );
      if (collision) {
        throw new SourceManifestIdentityConflictError(bundleId, sourceId, sourcePath);
      }
      return replaceSourceEntry(current, { ...existing, sourcePath, sourceKey });
    });
    return requireSource(manifest, sourceId);
  }

  /**
   * Records a successfully committed compile and clears an older failure marker.
   *
   * @param bundleId - Stable Bundle identifier
   * @param sourceId - Stable source identifier
   * @param snapshot - Compile state written only after transaction commit
   * @returns Detached updated source entry
   */
  async recordSuccessfulCompile(
    bundleId: string,
    sourceId: string,
    snapshot: SourceCompileSnapshot
  ): Promise<SourceManifestEntry> {
    const manifest = await this.mutate(bundleId, (current) => {
      const existing = requireSource(current, sourceId);
      if (existing.lastSuccessful) {
        if (existing.lastSuccessful.completedAt > snapshot.completedAt) {
          return undefined;
        }
        if (
          existing.lastSuccessful.completedAt === snapshot.completedAt &&
          !areCompileSnapshotsEqual(existing.lastSuccessful, snapshot)
        ) {
          throw new SourceManifestObservationConflictError(
            bundleId,
            sourceId,
            "success",
            snapshot.completedAt
          );
        }
      }
      const clearsFailure =
        existing.lastFailure !== undefined &&
        existing.lastFailure.failure.occurredAt <= snapshot.completedAt;
      if (
        existing.lastSuccessful &&
        areCompileSnapshotsEqual(existing.lastSuccessful, snapshot) &&
        !clearsFailure
      ) {
        return undefined;
      }
      const nextEntry: SourceManifestEntry = { ...existing, lastSuccessful: snapshot };
      if (clearsFailure) {
        delete nextEntry.lastFailure;
      }
      return replaceSourceEntry(current, nextEntry);
    });
    return requireSource(manifest, sourceId);
  }

  /**
   * Records a failed attempt without replacing the last successful snapshot.
   *
   * @param bundleId - Stable Bundle identifier
   * @param sourceId - Stable source identifier
   * @param failure - Serializable failed compile observation
   * @returns Detached updated source entry
   */
  async recordFailedCompile(
    bundleId: string,
    sourceId: string,
    failure: SourceCompileFailure
  ): Promise<SourceManifestEntry> {
    const manifest = await this.mutate(bundleId, (current) => {
      const existing = requireSource(current, sourceId);
      if (
        existing.lastSuccessful &&
        existing.lastSuccessful.completedAt >= failure.failure.occurredAt
      ) {
        return undefined;
      }
      if (existing.lastFailure) {
        if (existing.lastFailure.failure.occurredAt > failure.failure.occurredAt) {
          return undefined;
        }
        if (existing.lastFailure.failure.occurredAt === failure.failure.occurredAt) {
          if (areCompileFailuresEqual(existing.lastFailure, failure)) {
            return undefined;
          }
          throw new SourceManifestObservationConflictError(
            bundleId,
            sourceId,
            "failure",
            failure.failure.occurredAt
          );
        }
      }
      return replaceSourceEntry(current, { ...existing, lastFailure: failure });
    });
    return requireSource(manifest, sourceId);
  }

  /**
   * Removes a source identity without deleting any generated page directly.
   *
   * Page ownership and deletion decisions belong to a reviewed ChangeSet, not
   * to manifest bookkeeping.
   *
   * @param bundleId - Stable Bundle identifier
   * @param sourceId - Stable source identifier
   * @returns Detached manifest after removal
   */
  async removeSource(bundleId: string, sourceId: string): Promise<SourceManifest> {
    return this.mutate(bundleId, (current) => {
      requireSource(current, sourceId);
      return {
        ...current,
        entries: current.entries.filter((entry) => entry.sourceId !== sourceId),
      };
    });
  }

  /**
   * Evaluates whether a registered source can skip its next ingest.
   *
   * @param bundleId - Stable Bundle identifier
   * @param sourceId - Stable source identifier
   * @param sourceContentHash - Current exact source byte hash
   * @param pipelineFingerprint - Current behavior fingerprint
   * @param outputs - Current generated output path and exact hash observations
   * @returns Deterministic freshness decision
   */
  async evaluateFreshness(
    bundleId: string,
    sourceId: string,
    sourceContentHash: string,
    pipelineFingerprint: string,
    outputs: readonly OutputObservation[]
  ): Promise<SourceFreshnessDecision> {
    const manifest = await this.load(bundleId);
    const source = requireSource(manifest, sourceId);
    const rawNoChanges = source.extensions?.[KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY];
    const rawApply = source.extensions?.[KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY];
    const parsedNoChanges =
      rawNoChanges === undefined ? undefined : parseKnowledgeNoChangesCommitMarker(rawNoChanges);
    const parsedApply =
      rawApply === undefined ? undefined : parseKnowledgeRuntimeSourceCommitExtension(rawApply);
    if (
      parsedNoChanges !== undefined &&
      (!parsedNoChanges.ok ||
        !validateNoChangesManifestCommitMarker(parsedNoChanges.value).valid ||
        parsedNoChanges.value.bundleId !== bundleId ||
        parsedNoChanges.value.sourceId !== sourceId ||
        parsedNoChanges.value.manifestAfterRevision > manifest.revision)
    ) {
      throw new SourceManifestValidationError(bundleId, [
        {
          code: "manifest_no_changes_commit_invalid",
          severity: "error",
          field: `entries.${sourceId}.extensions.${KNOWLEDGE_NO_CHANGES_COMMIT_EXTENSION_KEY}`,
          message: "The durable no-change success marker is invalid",
        },
      ]);
    }
    if (parsedApply !== undefined && !parsedApply.ok) {
      throw new SourceManifestValidationError(bundleId, [
        {
          code: "manifest_runtime_commit_invalid",
          severity: "error",
          field: `entries.${sourceId}.extensions.${KNOWLEDGE_RUNTIME_SOURCE_COMMIT_EXTENSION_KEY}`,
          message: "The durable Runtime apply metadata is invalid",
        },
      ]);
    }
    if (
      parsedNoChanges?.ok &&
      parsedApply?.ok &&
      parsedNoChanges.value.inputRevision === parsedApply.value.inputRevision
    ) {
      throw new SourceManifestValidationError(bundleId, [
        {
          code: "manifest_source_outcome_revision_conflict",
          severity: "error",
          field: `entries.${sourceId}.extensions`,
          message: "Apply and no-change outcomes cannot share one input revision",
        },
      ]);
    }
    const latestNoChanges =
      parsedNoChanges?.ok &&
      (!parsedApply?.ok || parsedNoChanges.value.inputRevision > parsedApply.value.inputRevision)
        ? parsedNoChanges.value
        : undefined;
    return decideSourceFreshness({
      lastSuccessful: source.lastSuccessful,
      ...(latestNoChanges ? { lastNoChanges: latestNoChanges } : {}),
      sourceContentHash,
      pipelineFingerprint,
      outputs,
    });
  }

  /**
   * Loads unknown storage JSON and enforces version and Bundle identity.
   *
   * @param bundleId - Stable Bundle identifier
   * @returns Validated manifest and expected write revision
   */
  private async loadForMutation(bundleId: string): Promise<LoadedManifest> {
    const raw = await this.storage.read(bundleId);
    if (raw === null) {
      return { manifest: createEmptyManifest(bundleId), expectedRevision: null };
    }
    if (isRecord(raw) && "version" in raw && raw.version !== 1) {
      throw new SourceManifestIncompatibleVersionError(bundleId, raw.version);
    }

    const manifest = this.cloneValidatedManifest(bundleId, raw);
    if (manifest.bundleId !== bundleId) {
      throw new SourceManifestBundleMismatchError(bundleId, manifest.bundleId);
    }
    return { manifest, expectedRevision: manifest.revision };
  }

  /**
   * Applies one immutable mutation with bounded optimistic retries.
   *
   * @param bundleId - Stable Bundle identifier
   * @param transform - Deterministic manifest transform; undefined means no-op
   * @returns Detached persisted or current manifest
   */
  private async mutate(
    bundleId: string,
    transform: (manifest: SourceManifest) => SourceManifest | undefined
  ): Promise<SourceManifest> {
    assertIdentifier(bundleId, "bundleId");
    let lastConflict: SourceManifestRevisionConflictError | undefined;
    for (let attempt = 0; attempt < this.maxWriteAttempts; attempt += 1) {
      const loaded = await this.loadForMutation(bundleId);
      const proposed = transform(loaded.manifest);
      if (!proposed) {
        return this.cloneValidatedManifest(bundleId, loaded.manifest);
      }
      if (loaded.manifest.revision >= Number.MAX_SAFE_INTEGER) {
        throw new SourceManifestRevisionOverflowError(bundleId, loaded.manifest.revision);
      }
      const next = this.cloneValidatedManifest(bundleId, {
        ...proposed,
        version: 1,
        bundleId,
        revision: loaded.manifest.revision + 1,
      });
      try {
        await this.storage.write(bundleId, next, loaded.expectedRevision);
        return this.cloneValidatedManifest(bundleId, next);
      } catch (error) {
        if (!(error instanceof SourceManifestRevisionConflictError)) {
          throw error;
        }
        lastConflict = error;
      }
    }
    throw new SourceManifestWriteConflictExhaustedError(
      bundleId,
      this.maxWriteAttempts,
      lastConflict ?? new SourceManifestRevisionConflictError(bundleId, null)
    );
  }

  /**
   * Strictly parses, semantically validates, and clones a manifest value.
   *
   * @param bundleId - Bundle used for safe error reporting
   * @param value - Unknown or typed manifest value
   * @returns Detached validated manifest
   */
  private cloneValidatedManifest(bundleId: string, value: unknown): SourceManifest {
    const parsed = parseSourceManifest(value);
    if (!parsed.ok) {
      throw new SourceManifestValidationError(bundleId, parsed.issues);
    }
    const semantic = validateSourceManifest(parsed.value);
    if (!semantic.valid) {
      throw new SourceManifestValidationError(bundleId, semantic.diagnostics);
    }
    return parsed.value;
  }

  /**
   * Rejects unsafe native or ambiguous Windows paths before mutation.
   *
   * @param bundleId - Bundle used for safe error reporting
   * @param sourcePath - Proposed canonical Vault-relative source path
   */
  private assertSourcePath(bundleId: string, sourcePath: string): void {
    const validation = validateVaultRelativePath(sourcePath, "sourcePath");
    if (!validation.valid) {
      throw new SourceManifestValidationError(bundleId, validation.diagnostics);
    }
  }
}
