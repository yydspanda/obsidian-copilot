import type { SourceManifestRepository } from "@/knowledge/manifest/SourceManifestRepository";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import {
  KNOWLEDGE_CONTRACT_VERSION,
  type JsonValue,
  type SourceCustody,
  type SourceManifest,
  type SourceManifestEntry,
} from "@/knowledge/model/types";
import { validateSourceManifest } from "@/knowledge/model/validation";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { isPathWithinRoot, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256 } from "@/utils/hash";

const MAX_SNAPSHOT_NODES = 100_000;
const MAX_SNAPSHOT_DEPTH = 64;

/** Minimal durable Manifest authority required by source registration. */
export type KnowledgeSourceRegistrationManifestPort = Pick<
  SourceManifestRepository,
  "load" | "registerSource"
>;

/** One already-authorized source registration request. */
export interface KnowledgeSourceRegistrationRequest {
  bundleId: string;
  sourceRoot: string;
  sourcePath: string;
  custody: SourceCustody;
  extensions?: Record<string, JsonValue>;
  existingPathPolicy: "reuse_path" | "exact";
}

/** Exact durable effect produced by registration. */
export interface KnowledgeSourceRegistrationResult {
  status: "registered" | "already_registered";
  entry: SourceManifestEntry;
}

/** Read-only compatibility result returned before a caller-owned file mutation. */
export interface KnowledgeSourceRegistrationPreflightResult {
  status: "available" | "already_registered";
}

/** Narrow generation proof injected by the owning production adapter. */
export interface KnowledgeSourceRegistrationGenerationPort {
  assertCurrent(): void;
}

interface KnowledgeSourceRegistrationSnapshot {
  readonly bundleId: string;
  readonly sourceRoot: string;
  readonly sourcePath: string;
  readonly custody: SourceCustody;
  readonly extensions?: Readonly<Record<string, JsonValue>>;
  readonly existingPathPolicy: "reuse_path" | "exact";
}

interface JsonSnapshotBudget {
  remainingNodes: number;
}

/** Reports an existing path whose durable registration metadata is not reusable. */
export class KnowledgeSourceRegistrationMetadataConflictError extends Error {
  /** Creates a value-free metadata conflict without retaining source data or paths. */
  constructor() {
    super("The existing knowledge source registration metadata does not match");
    this.name = "KnowledgeSourceRegistrationMetadataConflictError";
  }
}

/** Creates the standard cancellation category for stale registration work. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Proves caller cancellation and the owning production generation together. */
function assertCurrent(
  signal: AbortSignal,
  generation: KnowledgeSourceRegistrationGenerationPort
): void {
  if (signal.aborted) throw createAbortError();
  try {
    generation.assertCurrent();
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

/** Compares strings by code unit without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Reads one enumerable own data property without invoking an accessor. */
function readDataProperty(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new TypeError("Knowledge source registration input is invalid");
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Knowledge source registration input is invalid");
  }
  return descriptor.value;
}

/** Captures one detached, bounded JSON value without evaluating accessors. */
function snapshotJsonValue(
  value: unknown,
  budget: JsonSnapshotBudget = { remainingNodes: MAX_SNAPSHOT_NODES },
  ancestors: Set<object> = new Set<object>(),
  depth = 0
): JsonValue {
  budget.remainingNodes -= 1;
  if (budget.remainingNodes < 0 || depth > MAX_SNAPSHOT_DEPTH) {
    throw new TypeError("Knowledge source registration JSON exceeds its limits");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Knowledge source registration JSON is invalid");
    }
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new TypeError("Knowledge source registration JSON is invalid");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        lengthDescriptor.enumerable ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        throw new TypeError("Knowledge source registration JSON is invalid");
      }
      const length = lengthDescriptor.value as number;
      const keys = Reflect.ownKeys(value);
      if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) {
        throw new TypeError("Knowledge source registration JSON is invalid");
      }
      const result = new Array<JsonValue>(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError("Knowledge source registration JSON is invalid");
        }
        result[index] = snapshotJsonValue(descriptor.value, budget, ancestors, depth + 1);
      }
      return Object.freeze(result) as unknown as JsonValue;
    }

    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      keys.some((key) => typeof key !== "string")
    ) {
      throw new TypeError("Knowledge source registration JSON is invalid");
    }
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of (keys as string[]).sort(compareText)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Knowledge source registration JSON is invalid");
      }
      Object.defineProperty(result, key, {
        value: snapshotJsonValue(descriptor.value, budget, ancestors, depth + 1),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Knowledge source registration JSON is invalid");
  } finally {
    ancestors.delete(value);
  }
}

/** Requires one strict non-empty string without normalizing its identity. */
function captureIdentifier(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError("Knowledge source registration input is invalid");
  }
  return value;
}

/** Snapshots the complete registration request before the first async boundary. */
function captureRegistrationRequest(value: unknown): KnowledgeSourceRegistrationSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Knowledge source registration input is invalid");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Knowledge source registration input is invalid");
  }
  const required = ["bundleId", "sourceRoot", "sourcePath", "custody", "existingPathPolicy"];
  const allowed = new Set([...required, "extensions"]);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
    required.some((key) => !keys.includes(key)) ||
    (keys.length !== required.length && keys.length !== required.length + 1)
  ) {
    throw new TypeError("Knowledge source registration input is invalid");
  }

  const bundleId = captureIdentifier(readDataProperty(value, "bundleId"));
  const sourceRoot = captureIdentifier(readDataProperty(value, "sourceRoot"));
  const sourcePath = captureIdentifier(readDataProperty(value, "sourcePath"));
  const custody = readDataProperty(value, "custody");
  const existingPathPolicy = readDataProperty(value, "existingPathPolicy");
  if (
    (custody !== "user_managed" && custody !== "managed_copy") ||
    (existingPathPolicy !== "reuse_path" && existingPathPolicy !== "exact")
  ) {
    throw new TypeError("Knowledge source registration input is invalid");
  }

  let extensions: Readonly<Record<string, JsonValue>> | undefined;
  if (keys.includes("extensions")) {
    const snapshot = snapshotJsonValue(readDataProperty(value, "extensions"));
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
      throw new TypeError("Knowledge source registration input is invalid");
    }
    extensions = snapshot;
  }
  return Object.freeze({
    bundleId,
    sourceRoot,
    sourcePath,
    custody,
    ...(extensions === undefined ? {} : { extensions }),
    existingPathPolicy,
  });
}

/** Captures and validates one complete Manifest returned by the injected port. */
function captureManifest(value: unknown, bundleId: string): Readonly<SourceManifest> {
  const snapshot = snapshotJsonValue(value);
  const parsed = parseSourceManifest(snapshot);
  if (
    !parsed.ok ||
    parsed.value.bundleId !== bundleId ||
    !validateSourceManifest(parsed.value).valid
  ) {
    throw new TypeError("Knowledge source Manifest is invalid");
  }
  return snapshot as unknown as Readonly<SourceManifest>;
}

/** Captures and validates one registered entry returned after the durable write. */
function captureRegisteredEntry(value: unknown, bundleId: string): SourceManifestEntry {
  const entry = snapshotJsonValue(value);
  const manifest = Object.freeze({
    version: KNOWLEDGE_CONTRACT_VERSION,
    bundleId,
    revision: 0,
    entries: Object.freeze([entry]),
  });
  const parsed = parseSourceManifest(manifest);
  if (!parsed.ok || !validateSourceManifest(parsed.value).valid) {
    throw new KnowledgeSourceRegistrationMetadataConflictError();
  }
  return entry as unknown as SourceManifestEntry;
}

/** Creates one stable opaque source identity from its canonical Windows path identity. */
function createSourceId(bundleId: string, sourcePath: string): string {
  return `source-${sha256(
    `obsidian-copilot-knowledge-source-v1\n${bundleId.length}:${bundleId}\n${toWindowsPathKey(sourcePath)}`
  )}`;
}

/**
 * Compares exact caller-owned registration metadata while tolerating Runtime-owned keys.
 *
 * Runtime commit metadata is added after successful apply, so an exact replay
 * checks every requested extension key but does not require the persisted bag to
 * contain only those keys.
 */
function matchesExactRegistration(
  entry: SourceManifestEntry,
  request: Readonly<KnowledgeSourceRegistrationSnapshot>
): boolean {
  if (entry.sourcePath !== request.sourcePath || entry.custody !== request.custody) return false;
  const requestedExtensions = request.extensions ?? {};
  for (const [key, value] of Object.entries(requestedExtensions)) {
    const existingValue = entry.extensions?.[key];
    if (
      existingValue === undefined ||
      canonicalizeJson(existingValue) !== canonicalizeJson(value)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Reusable, least-authority source registration primitive.
 *
 * Callers must decide parser eligibility and file custody before invoking this
 * class. The core independently enforces the supplied source root, reuses an
 * existing path identity, and performs no Queue, file, model, or UI work.
 */
export class KnowledgeSourceRegistrationCore {
  /** Creates one registration core over an injected Manifest and generation proof. */
  constructor(
    private readonly manifest: KnowledgeSourceRegistrationManifestPort,
    private readonly generation: KnowledgeSourceRegistrationGenerationPort
  ) {}

  /**
   * Proves whether one exact registration can be reused before a file is copied.
   *
   * This is an advisory read-set, not a reservation. {@link register} repeats the
   * same proof after the caller-owned file operation and remains authoritative.
   *
   * @param request - Authorized Bundle, root, path, custody, and provenance
   * @param signal - Caller and generation cancellation
   * @returns Whether the path is absent or already carries compatible metadata
   */
  async preflight(
    request: Readonly<KnowledgeSourceRegistrationRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeSourceRegistrationPreflightResult> {
    const captured = captureRegistrationRequest(request);
    assertCurrent(signal, this.generation);
    if (!isPathWithinRoot(captured.sourcePath, captured.sourceRoot)) {
      throw new TypeError("Knowledge source is outside its authorized root");
    }

    const snapshot = captureManifest(
      await this.manifest.load(captured.bundleId),
      captured.bundleId
    );
    assertCurrent(signal, this.generation);
    const existing = snapshot.entries.find(
      (entry) => entry.sourceKey === toWindowsPathKey(captured.sourcePath)
    );
    if (!existing) return Object.freeze({ status: "available" });
    if (captured.existingPathPolicy === "exact" && !matchesExactRegistration(existing, captured)) {
      throw new KnowledgeSourceRegistrationMetadataConflictError();
    }
    return Object.freeze({ status: "already_registered" });
  }

  /**
   * Registers one source idempotently inside its exact authorized root.
   *
   * @param request - Authorized Bundle, root, path, custody, and provenance
   * @param signal - Caller and generation cancellation
   * @param onDurableRegistration - Recovery hook invoked immediately after a new durable write
   * @returns Exact durable registration result
   */
  async register(
    request: Readonly<KnowledgeSourceRegistrationRequest>,
    signal: AbortSignal,
    onDurableRegistration?: () => void
  ): Promise<KnowledgeSourceRegistrationResult> {
    const captured = captureRegistrationRequest(request);
    assertCurrent(signal, this.generation);
    if (!isPathWithinRoot(captured.sourcePath, captured.sourceRoot)) {
      throw new TypeError("Knowledge source is outside its authorized root");
    }

    const sourceKey = toWindowsPathKey(captured.sourcePath);
    const expectedSourceId = createSourceId(captured.bundleId, captured.sourcePath);
    const snapshot = captureManifest(
      await this.manifest.load(captured.bundleId),
      captured.bundleId
    );
    assertCurrent(signal, this.generation);
    const existing = snapshot.entries.find((entry) => entry.sourceKey === sourceKey);
    if (existing) {
      if (
        captured.existingPathPolicy === "exact" &&
        !matchesExactRegistration(existing, captured)
      ) {
        throw new KnowledgeSourceRegistrationMetadataConflictError();
      }
      return { status: "already_registered", entry: existing };
    }

    const entry = captureRegisteredEntry(
      await this.manifest.registerSource(
        captured.bundleId,
        Object.freeze({
          sourceId: expectedSourceId,
          sourcePath: captured.sourcePath,
          custody: captured.custody,
          ...(captured.extensions === undefined ? {} : { extensions: captured.extensions }),
        })
      ),
      captured.bundleId
    );
    if (
      entry.sourceId !== expectedSourceId ||
      entry.sourceKey !== sourceKey ||
      !matchesExactRegistration(entry, captured)
    ) {
      throw new KnowledgeSourceRegistrationMetadataConflictError();
    }
    // The Manifest write is already durable at this boundary. Notify the owner
    // before post-write reproof so it can schedule recovery even when cancellation
    // or generation replacement wins immediately after commit.
    onDurableRegistration?.();
    assertCurrent(signal, this.generation);
    return { status: "registered", entry };
  }
}
