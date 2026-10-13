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
import { parseKnowledgeSourceRetirements } from "@/knowledge/manifest/SourceRetirement";
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

export interface SourceRegistration {
  sourceId: string;
  sourcePath: string;
  custody: SourceCustody;
  extensions?: Record<string, JsonValue>;
}

export class SourceManifestValidationError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly diagnostics: readonly KnowledgeDiagnostic[]
  ) {
    super(`Source manifest '${bundleId}' does not satisfy the current contract`);
    this.name = "SourceManifestValidationError";
  }
}

export class SourceManifestIncompatibleVersionError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly version: unknown
  ) {
    super(`Source manifest '${bundleId}' uses an unsupported version`);
    this.name = "SourceManifestIncompatibleVersionError";
  }
}

export class SourceManifestBundleMismatchError extends Error {
  constructor(
    public readonly requestedBundleId: string,
    public readonly storedBundleId: string
  ) {
    super(`Source manifest stored for '${requestedBundleId}' belongs to '${storedBundleId}'`);
    this.name = "SourceManifestBundleMismatchError";
  }
}

export class SourceManifestIdentityConflictError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly sourcePath: string
  ) {
    super(`Source '${sourceId}' conflicts with an existing identity in '${bundleId}'`);
    this.name = "SourceManifestIdentityConflictError";
  }
}

export class SourceManifestSourceNotFoundError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string
  ) {
    super(`Source '${sourceId}' is not registered in Bundle '${bundleId}'`);
    this.name = "SourceManifestSourceNotFoundError";
  }
}

export class SourceManifestSourceRetiredError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string,
    public readonly sourcePath: string
  ) {
    super(`Source '${sourceId}' is retired in Bundle '${bundleId}'`);
    this.name = "SourceManifestSourceRetiredError";
  }
}

export class SourceManifestRevisionOverflowError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly revision: number
  ) {
    super(`Source manifest '${bundleId}' cannot advance beyond revision ${revision}`);
    this.name = "SourceManifestRevisionOverflowError";
  }
}

export class SourceManifestWriteConflictExhaustedError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly attempts: number,
    public readonly conflict: SourceManifestRevisionConflictError
  ) {
    super(`Source manifest '${bundleId}' still conflicted after ${attempts} attempts`);
    this.name = "SourceManifestWriteConflictExhaustedError";
  }
}

export class SourceManifestObservationConflictError extends Error {
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

interface LoadedManifest {
  manifest: SourceManifest;
  expectedRevision: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createEmptyManifest(bundleId: string): SourceManifest {
  return { version: 1, bundleId, revision: 0, entries: [] };
}

function assertIdentifier(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must contain non-whitespace text`);
  }
}

function requireSource(manifest: SourceManifest, sourceId: string): SourceManifestEntry {
  const source = manifest.entries.find((entry) => entry.sourceId === sourceId);
  if (!source) {
    throw new SourceManifestSourceNotFoundError(manifest.bundleId, sourceId);
  }
  return source;
}

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

export class SourceManifestRepository {
  private readonly maxWriteAttempts: number;

  constructor(
    private readonly storage: SourceManifestStorage,
    maxWriteAttempts = DEFAULT_MAX_WRITE_ATTEMPTS
  ) {
    if (!Number.isSafeInteger(maxWriteAttempts) || maxWriteAttempts < 1) {
      throw new TypeError("maxWriteAttempts must be a positive integer");
    }
    this.maxWriteAttempts = maxWriteAttempts;
  }

  async load(bundleId: string): Promise<SourceManifest> {
    assertIdentifier(bundleId, "bundleId");
    const loaded = await this.loadForMutation(bundleId);
    return this.cloneValidatedManifest(bundleId, loaded.manifest);
  }

  async getSource(bundleId: string, sourceId: string): Promise<SourceManifestEntry | undefined> {
    assertIdentifier(sourceId, "sourceId");
    const manifest = await this.load(bundleId);
    return manifest.entries.find((entry) => entry.sourceId === sourceId);
  }

  async registerSource(
    bundleId: string,
    registration: SourceRegistration
  ): Promise<SourceManifestEntry> {
    assertIdentifier(bundleId, "bundleId");
    assertIdentifier(registration.sourceId, "sourceId");
    this.assertSourcePath(bundleId, registration.sourcePath);
    const sourceKey = toWindowsPathKey(registration.sourcePath);

    const manifest = await this.mutate(bundleId, (current) => {
      const retirements = parseKnowledgeSourceRetirements(current);
      if (!retirements.ok) {
        throw new SourceManifestValidationError(bundleId, retirements.issues);
      }
      const retired = retirements.value.find(
        (record) =>
          record.source.sourceId === registration.sourceId || record.source.sourceKey === sourceKey
      );
      if (retired) {
        throw new SourceManifestSourceRetiredError(
          bundleId,
          registration.sourceId,
          registration.sourcePath
        );
      }
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
      const retirements = parseKnowledgeSourceRetirements(current);
      if (!retirements.ok) {
        throw new SourceManifestValidationError(bundleId, retirements.issues);
      }
      if (retirements.value.some((record) => record.source.sourceKey === sourceKey)) {
        throw new SourceManifestSourceRetiredError(bundleId, sourceId, sourcePath);
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

  async removeSource(bundleId: string, sourceId: string): Promise<SourceManifest> {
    return this.mutate(bundleId, (current) => {
      requireSource(current, sourceId);
      return {
        ...current,
        entries: current.entries.filter((entry) => entry.sourceId !== sourceId),
      };
    });
  }

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

  private assertSourcePath(bundleId: string, sourcePath: string): void {
    const validation = validateVaultRelativePath(sourcePath, "sourcePath");
    if (!validation.valid) {
      throw new SourceManifestValidationError(bundleId, validation.diagnostics);
    }
  }
}
