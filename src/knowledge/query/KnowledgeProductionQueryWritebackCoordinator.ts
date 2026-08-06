import {
  createKnowledgeSourceOriginExtensions,
  KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY,
  parseKnowledgeSourceOrigin,
} from "@/knowledge/capture/KnowledgeSourceOrigin";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { KnowledgeFileStore } from "@/knowledge/changeset/ChangeSetValidator";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  assertKnowledgeQueryWritebackCapture,
  KnowledgeQueryWritebackCaptureError,
  type KnowledgeQueryWritebackCapture,
  type KnowledgeQueryWritebackSubmissionPort,
  type KnowledgeStudioQueryWritebackResult,
} from "@/knowledge/query/KnowledgeQueryWritebackCapture";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

const MANAGED_QUERY_SOURCE_PREFIX = "Knowledge Query ";
const SOURCE_ID_PATTERN = /^source-[a-f0-9]{64}$/;

/** Sanitized production capture failure that retains no paths or answer material. */
export class KnowledgeProductionQueryWritebackError extends Error {
  /** Creates one value-free failure for the production persistence boundary. */
  constructor() {
    super("The grounded answer could not be registered for reviewed Wiki writeback");
    this.name = "KnowledgeProductionQueryWritebackError";
  }
}

/** Exact production dependencies retained by one released writeback generation. */
export interface KnowledgeProductionQueryWritebackCoordinatorInput {
  readonly owners: readonly ConfiguredProjectKnowledgeBundle[];
  readonly fileStore: Pick<KnowledgeFileStore, "compareAndSwap">;
  readonly registration: KnowledgeSourceRegistrationCore;
  readonly assertCurrent: () => void;
  readonly onGenerationRefreshRequired: () => void;
  readonly retainDrain?: (drain: Promise<void>) => void;
}

interface KnowledgeProductionQueryWritebackOwner {
  readonly bundleId: string;
  readonly sourceRoots: readonly string[];
}

/** Creates the platform-standard cancellation category for stale generation work. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Proves caller cancellation and the owning production generation together. */
function assertCurrent(signal: AbortSignal, assertGenerationCurrent: () => void): void {
  if (signal.aborted) throw createAbortError();
  try {
    assertGenerationCurrent();
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

/** Builds the visible, content-addressed managed-source path under one exact root. */
function createManagedSourcePath(sourceRoot: string, captureDigest: string): string {
  return `${sourceRoot}/${MANAGED_QUERY_SOURCE_PREFIX}${captureDigest}.md`;
}

/** Reports whether a failure already carries the standard cancellation category. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Reads one enumerable own data property without evaluating an accessor. */
function readDataProperty(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected an enumerable data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeProductionQueryWritebackError();
  }
}

/** Captures one plain data record with an exact enumerable key set. */
function captureExactDataRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Expected a record");
    }
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    const expected = [...expectedKeys].sort();
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string") ||
      (keys as string[]).sort().some((key, index) => key !== expected[index])
    ) {
      throw new TypeError("Expected an exact record");
    }
    const captured = Object.create(null) as Record<string, unknown>;
    for (const key of expected) {
      Object.defineProperty(captured, key, {
        value: readDataProperty(value, key),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(captured);
  } catch (error) {
    if (error instanceof KnowledgeProductionQueryWritebackError) throw error;
    throw new KnowledgeProductionQueryWritebackError();
  }
}

/** Accepts only the two exact durable-success outcomes of file compare-and-swap. */
function assertSuccessfulFileWrite(value: unknown): void {
  const { kind } = captureExactDataRecord(value, ["kind"]);
  if (kind !== "applied" && kind !== "already_after") {
    throw new KnowledgeProductionQueryWritebackError();
  }
}

/** Re-proves the strict query origin retained by a returned Manifest entry. */
function assertRegisteredQuerySource(
  value: unknown,
  sourcePath: string,
  capture: Readonly<KnowledgeQueryWritebackCapture>
): "registered" | "already_registered" {
  const { status, entry } = captureExactDataRecord(value, ["status", "entry"]);
  if (
    (status !== "registered" && status !== "already_registered") ||
    typeof entry !== "object" ||
    entry === null ||
    Array.isArray(entry)
  ) {
    throw new KnowledgeProductionQueryWritebackError();
  }

  const sourceId = readDataProperty(entry, "sourceId");
  const sourceKey = readDataProperty(entry, "sourceKey");
  const registeredPath = readDataProperty(entry, "sourcePath");
  const custody = readDataProperty(entry, "custody");
  const extensions = readDataProperty(entry, "extensions");
  if (
    typeof sourceId !== "string" ||
    !SOURCE_ID_PATTERN.test(sourceId) ||
    sourceKey !== toWindowsPathKey(sourcePath) ||
    registeredPath !== sourcePath ||
    custody !== "managed_copy" ||
    typeof extensions !== "object" ||
    extensions === null ||
    Array.isArray(extensions)
  ) {
    throw new KnowledgeProductionQueryWritebackError();
  }
  const origin = parseKnowledgeSourceOrigin(
    readDataProperty(extensions, KNOWLEDGE_SOURCE_ORIGIN_EXTENSION_KEY)
  );
  if (
    origin.operation !== "query_writeback" ||
    origin.captureDigest !== capture.captureDigest ||
    origin.captureContentHash !== capture.sourceContentHash
  ) {
    throw new KnowledgeProductionQueryWritebackError();
  }
  return status;
}

/**
 * Persists one grounded answer as an immutable managed source, then registers it.
 *
 * The coordinator never writes Wiki files or fabricates Queue state. A successful
 * result means only that an exact content-addressed source exists and its Manifest
 * identity is durable; the replacement generation owns watcher, Queue, Review,
 * and Apply processing. Creating the source before registration makes interruption
 * safe: a retry converges through `already_after` and exact Manifest replay.
 */
export class KnowledgeProductionQueryWritebackCoordinator
  implements KnowledgeQueryWritebackSubmissionPort
{
  private readonly owners: readonly Readonly<KnowledgeProductionQueryWritebackOwner>[];
  private readonly compareAndSwap: Pick<KnowledgeFileStore, "compareAndSwap">["compareAndSwap"];
  private readonly registerSource: KnowledgeSourceRegistrationCore["register"];
  private readonly assertGenerationCurrent: () => void;
  private readonly requestGenerationRefresh: () => void;
  private readonly retainDrain: ((drain: Promise<void>) => void) | undefined;

  /** Captures one exact released-generation persistence boundary. */
  constructor(input: KnowledgeProductionQueryWritebackCoordinatorInput) {
    if (
      !input ||
      !Array.isArray(input.owners) ||
      typeof input.fileStore?.compareAndSwap !== "function" ||
      typeof input.registration?.register !== "function" ||
      typeof input.assertCurrent !== "function" ||
      typeof input.onGenerationRefreshRequired !== "function" ||
      (input.retainDrain !== undefined && typeof input.retainDrain !== "function")
    ) {
      throw new KnowledgeProductionQueryWritebackError();
    }
    this.owners = Object.freeze(
      input.owners.map((owner: ConfiguredProjectKnowledgeBundle) => {
        if (
          typeof owner?.config?.id !== "string" ||
          owner.config.id.length === 0 ||
          !Array.isArray(owner.config.sourceRoots) ||
          owner.config.sourceRoots.some((root: unknown) => typeof root !== "string")
        ) {
          throw new KnowledgeProductionQueryWritebackError();
        }
        return Object.freeze({
          bundleId: owner.config.id,
          sourceRoots: Object.freeze([...owner.config.sourceRoots]),
        });
      })
    );
    this.compareAndSwap = input.fileStore.compareAndSwap.bind(input.fileStore);
    this.registerSource = input.registration.register.bind(input.registration);
    this.assertGenerationCurrent = input.assertCurrent;
    this.requestGenerationRefresh = input.onGenerationRefreshRequired;
    this.retainDrain = input.retainDrain;
    Object.freeze(this);
  }

  /**
   * Persists and registers one authentic deterministic query capture.
   *
   * @param capture - Branded capture minted by the current Query coordinator
   * @param signal - Linked caller and production-generation cancellation
   * @returns Truthful durable-registration receipt
   */
  submit(
    capture: Readonly<KnowledgeQueryWritebackCapture>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    const operation = this.performSubmit(capture, signal);
    this.retainDrain?.(
      operation.then(
        () => undefined,
        () => undefined
      )
    );
    return operation;
  }

  /** Performs the retained create-and-register sequence for one submission. */
  private async performSubmit(
    capture: Readonly<KnowledgeQueryWritebackCapture>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult> {
    try {
      assertKnowledgeQueryWritebackCapture(capture);
      assertCurrent(signal, this.assertGenerationCurrent);
      const owner = this.resolveOwner(capture.bundleId);
      const sourceRoot = this.resolveSourceRoot(owner);
      const sourcePath = createManagedSourcePath(sourceRoot, capture.captureDigest);
      const fileResult = await this.compareAndSwap(
        sourcePath,
        { kind: "missing" },
        {
          kind: "file",
          content: capture.sourceContent,
          contentHash: capture.sourceContentHash,
        }
      );
      assertSuccessfulFileWrite(fileResult);

      assertCurrent(signal, this.assertGenerationCurrent);
      const registration = await this.registerSource(
        {
          bundleId: owner.bundleId,
          sourceRoot,
          sourcePath,
          custody: "managed_copy",
          extensions: createKnowledgeSourceOriginExtensions("query_writeback", {
            captureDigest: capture.captureDigest,
            captureContentHash: capture.sourceContentHash,
          }),
          existingPathPolicy: "exact",
        },
        signal,
        this.requestGenerationRefresh
      );
      const registrationStatus = assertRegisteredQuerySource(registration, sourcePath, capture);

      // New registration schedules recovery at the exact durable boundary. An
      // exact replay schedules it here so a prior process death between commit
      // and invalidation also converges.
      if (registrationStatus === "already_registered") {
        this.requestGenerationRefresh();
      }
      return Object.freeze({ kind: "registered" as const });
    } catch (error) {
      if (isAbortError(error)) throw createAbortError();
      if (error instanceof KnowledgeProductionQueryWritebackError) throw error;
      if (error instanceof KnowledgeQueryWritebackCaptureError) {
        throw new KnowledgeProductionQueryWritebackError();
      }
      throw new KnowledgeProductionQueryWritebackError();
    }
  }

  /** Requires the capture Bundle to name exactly one released production owner. */
  private resolveOwner(bundleId: string): Readonly<KnowledgeProductionQueryWritebackOwner> {
    const matches = this.owners.filter((owner) => owner.bundleId === bundleId);
    if (matches.length !== 1) throw new KnowledgeProductionQueryWritebackError();
    return matches[0];
  }

  /** Requires one source root so writeback never guesses a durable destination. */
  private resolveSourceRoot(owner: Readonly<KnowledgeProductionQueryWritebackOwner>): string {
    if (owner.sourceRoots.length !== 1) {
      throw new KnowledgeProductionQueryWritebackError();
    }
    return owner.sourceRoots[0];
  }
}

Object.freeze(KnowledgeProductionQueryWritebackCoordinator.prototype);
Object.freeze(KnowledgeProductionQueryWritebackCoordinator);
