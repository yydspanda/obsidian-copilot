import type { CompilerTargetRequest } from "@/knowledge/compiler/CompilerModelPort";
import {
  ObsidianKnowledgeCompilerTargetResolverError,
  type ObsidianKnowledgeCompilerTargetVisitPort,
  type ObsidianKnowledgeCompilerTargetVisitor,
} from "@/knowledge/compiler/ObsidianKnowledgeCompilerTargetResolver";
import type { OutputObservation } from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { sha256Bytes } from "@/utils/hash";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_OUTPUTS = 10_000;
const DEFAULT_MAX_BYTES_PER_OUTPUT = 2_000_000;
const DEFAULT_MAX_CHARACTERS_PER_OUTPUT = 2_000_000;
const DEFAULT_MAX_TOTAL_BYTES = 8_000_000;
const DEFAULT_MAX_TOTAL_CHARACTERS = 8_000_000;

/** One Runtime-authorized generated page whose current bytes must be re-proved. */
export interface KnowledgeExpectedOutputPage {
  path: string;
  contentHash: string;
}

/** Narrow read-only port consumed by source-freshness admission. */
export interface KnowledgeOutputObservationReaderPort {
  /** Reads only the supplied authorized paths and returns exact path/hash observations. */
  observe(
    outputs: readonly KnowledgeExpectedOutputPage[],
    signal: AbortSignal
  ): Promise<readonly OutputObservation[]>;
}

/** Resource limits for one generated-output observation batch. */
export interface ObsidianKnowledgeOutputObservationReaderOptions {
  maxOutputs?: number;
  maxBytesPerOutput?: number;
  maxCharactersPerOutput?: number;
  maxTotalBytes?: number;
  maxTotalCharacters?: number;
}

/** Stable sanitized generated-output reader failures. */
export type KnowledgeOutputObservationReaderErrorCode =
  | "dependency_invalid"
  | "request_invalid"
  | "response_invalid"
  | "output_too_large"
  | "resolver_unavailable"
  | "aborted";

/** Sanitized failure that never retains an output path or file content. */
export class KnowledgeOutputObservationReaderError extends Error {
  /** Creates one stable output-observation failure. */
  constructor(public readonly code: KnowledgeOutputObservationReaderErrorCode) {
    super("The generated knowledge output could not be verified");
    this.name = "KnowledgeOutputObservationReaderError";
    Object.freeze(this);
  }

  /** Returns whether an unknown error belongs to this boundary. */
  static inspect(value: unknown): value is KnowledgeOutputObservationReaderError {
    return value instanceof KnowledgeOutputObservationReaderError;
  }
}

/** Creates one sanitized reader error without retaining its cause. */
function createReaderError(
  code: KnowledgeOutputObservationReaderErrorCode
): KnowledgeOutputObservationReaderError {
  return new KnowledgeOutputObservationReaderError(code);
}

/** Throws the boundary-standard cancellation error. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createReaderError("aborted");
}

/** Validates one positive bounded integer option. */
function requirePositiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw createReaderError("dependency_invalid");
  return value;
}

/** Reads one own enumerable data property without invoking an accessor. */
function readDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) throw createReaderError("response_invalid");
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw createReaderError("response_invalid");
    }
    return descriptor.value;
  } catch (error) {
    if (KnowledgeOutputObservationReaderError.inspect(error)) throw error;
    throw createReaderError("response_invalid");
  }
}

/** Checks an exact own string-key set without reading values. */
function hasExactDataKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const keys = Reflect.ownKeys(value);
    const sortedExpected = [...expected].sort();
    return (
      keys.length === sortedExpected.length &&
      keys.every((key) => typeof key === "string") &&
      keys.sort().every((key, index) => key === sortedExpected[index])
    );
  } catch {
    return false;
  }
}

/** Snapshots a bounded dense array through data descriptors only. */
function snapshotDenseArray(value: unknown, maxLength: number): readonly unknown[] {
  if (!Array.isArray(value)) throw createReaderError("response_invalid");
  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maxLength ||
      Reflect.ownKeys(value).length !== lengthDescriptor.value + 1
    ) {
      throw createReaderError("response_invalid");
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw createReaderError("response_invalid");
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (KnowledgeOutputObservationReaderError.inspect(error)) throw error;
    throw createReaderError("response_invalid");
  }
}

/** Snapshots and validates the complete Runtime-authorized output set. */
function snapshotExpectedOutputs(
  value: readonly KnowledgeExpectedOutputPage[],
  maxOutputs: number
): readonly Readonly<KnowledgeExpectedOutputPage>[] {
  const raw = snapshotDenseArray(value, maxOutputs);
  const pathKeys = new Set<string>();
  const outputs = raw.map((item) => {
    if (!hasExactDataKeys(item, ["path", "contentHash"])) {
      throw createReaderError("request_invalid");
    }
    const path = readDataProperty(item, "path");
    const contentHash = readDataProperty(item, "contentHash");
    const parsed = typeof path === "string" ? parseVaultPath(path) : undefined;
    if (
      !parsed?.ok ||
      parsed.path !== path ||
      typeof contentHash !== "string" ||
      !SHA256_PATTERN.test(contentHash)
    ) {
      throw createReaderError("request_invalid");
    }
    const pathKey = toWindowsPathKey(parsed.path);
    if (pathKeys.has(pathKey)) throw createReaderError("request_invalid");
    pathKeys.add(pathKey);
    return Object.freeze({ path: parsed.path, contentHash });
  });
  return Object.freeze(outputs);
}

/** Captures the sequential visitor method with its exact receiver. */
function captureVisitor(
  resolver: ObsidianKnowledgeCompilerTargetVisitPort
): (
  requests: readonly CompilerTargetRequest[],
  signal: AbortSignal,
  options: Readonly<{ maxFileBytes: number }>,
  visitor: ObsidianKnowledgeCompilerTargetVisitor
) => Promise<void> {
  if (typeof resolver !== "object" || resolver === null) {
    throw createReaderError("dependency_invalid");
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(resolver) ?? resolver,
    "visit"
  );
  const directDescriptor = Object.getOwnPropertyDescriptor(resolver, "visit");
  const candidate: unknown = directDescriptor?.value ?? descriptor?.value;
  if (typeof candidate !== "function") throw createReaderError("dependency_invalid");
  const method = candidate as (this: unknown, ...args: unknown[]) => unknown;
  return async (requests, signal, options, visitor) => {
    const result: unknown = Reflect.apply(method, resolver, [requests, signal, options, visitor]);
    await Promise.resolve(result);
  };
}

/** Creates the strict authorized resolver requests for one output set. */
function createTargetRequests(
  outputs: readonly Readonly<KnowledgeExpectedOutputPage>[]
): readonly Readonly<CompilerTargetRequest>[] {
  return Object.freeze(
    outputs.map((output, index) =>
      Object.freeze({
        targetId: `freshness-output-${index}`,
        path: output.path,
        intent: "write" as const,
        access: "authorized" as const,
      })
    )
  );
}

/** Strictly projects one resolver response without returning file content. */
function projectObservation(
  raw: unknown,
  fileByteSize: number | undefined,
  expected: Readonly<KnowledgeExpectedOutputPage>,
  targetId: string,
  limits: {
    maxBytesPerOutput: number;
    maxCharactersPerOutput: number;
    maxTotalBytes: number;
    maxTotalCharacters: number;
  },
  totals: { bytes: number; characters: number }
): Readonly<OutputObservation> {
  const kind = readDataProperty(raw, "kind");
  if (readDataProperty(raw, "targetId") !== targetId) {
    throw createReaderError("response_invalid");
  }
  if (kind === "missing") {
    if (
      fileByteSize !== undefined ||
      !hasExactDataKeys(raw, ["targetId", "kind", "windowsPathKey"]) ||
      readDataProperty(raw, "windowsPathKey") !== toWindowsPathKey(expected.path)
    ) {
      throw createReaderError("response_invalid");
    }
    return Object.freeze({ path: expected.path, kind: "missing" as const });
  }
  if (kind === "directory") {
    const path = readDataProperty(raw, "path");
    if (
      fileByteSize !== undefined ||
      !hasExactDataKeys(raw, ["targetId", "kind", "path"]) ||
      typeof path !== "string" ||
      toWindowsPathKey(path) !== toWindowsPathKey(expected.path)
    ) {
      throw createReaderError("response_invalid");
    }
    return Object.freeze({ path: expected.path, kind: "directory" as const });
  }
  if (kind !== "file" || !hasExactDataKeys(raw, ["targetId", "kind", "path", "content"])) {
    throw createReaderError("response_invalid");
  }
  const path = readDataProperty(raw, "path");
  const content = readDataProperty(raw, "content");
  if (
    typeof path !== "string" ||
    toWindowsPathKey(path) !== toWindowsPathKey(expected.path) ||
    typeof content !== "string" ||
    !Number.isSafeInteger(fileByteSize) ||
    (fileByteSize as number) < 0
  ) {
    throw createReaderError("response_invalid");
  }
  if ((fileByteSize as number) > limits.maxBytesPerOutput) {
    throw createReaderError("output_too_large");
  }
  if (content.length > limits.maxCharactersPerOutput) {
    throw createReaderError("output_too_large");
  }
  const contentBytes = new TextEncoder().encode(content);
  if (contentBytes.byteLength !== fileByteSize) {
    throw createReaderError("response_invalid");
  }
  totals.bytes += contentBytes.byteLength;
  totals.characters += content.length;
  if (
    !Number.isSafeInteger(totals.bytes) ||
    !Number.isSafeInteger(totals.characters) ||
    totals.bytes > limits.maxTotalBytes ||
    totals.characters > limits.maxTotalCharacters
  ) {
    throw createReaderError("output_too_large");
  }
  return Object.freeze({
    path: expected.path,
    kind: "file" as const,
    contentHash: sha256Bytes(contentBytes),
  });
}

/**
 * Adapts the compiler's exact read-only Vault resolver to hash-only output observations.
 *
 * The adapter never returns file content and has no write capability. Requests
 * are limited to paths supplied by the Runtime freshness authority.
 */
export class ObsidianKnowledgeOutputObservationReader
  implements KnowledgeOutputObservationReaderPort
{
  private readonly visit: ReturnType<typeof captureVisitor>;
  private readonly maxOutputs: number;
  private readonly maxBytesPerOutput: number;
  private readonly maxCharactersPerOutput: number;
  private readonly maxTotalBytes: number;
  private readonly maxTotalCharacters: number;

  /** Captures one exact resolver and immutable resource limits. */
  constructor(
    resolver: ObsidianKnowledgeCompilerTargetVisitPort,
    options: ObsidianKnowledgeOutputObservationReaderOptions = {}
  ) {
    this.visit = captureVisitor(resolver);
    this.maxOutputs = requirePositiveLimit(options.maxOutputs ?? DEFAULT_MAX_OUTPUTS);
    this.maxBytesPerOutput = requirePositiveLimit(
      options.maxBytesPerOutput ?? DEFAULT_MAX_BYTES_PER_OUTPUT
    );
    this.maxCharactersPerOutput = requirePositiveLimit(
      options.maxCharactersPerOutput ?? DEFAULT_MAX_CHARACTERS_PER_OUTPUT
    );
    this.maxTotalBytes = requirePositiveLimit(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES);
    this.maxTotalCharacters = requirePositiveLimit(
      options.maxTotalCharacters ?? DEFAULT_MAX_TOTAL_CHARACTERS
    );
    Object.freeze(this);
  }

  /** Reads only authorized paths and returns detached exact hash observations. */
  async observe(
    outputs: readonly KnowledgeExpectedOutputPage[],
    signal: AbortSignal
  ): Promise<readonly OutputObservation[]> {
    if (typeof signal !== "object" || signal === null) throw createReaderError("request_invalid");
    throwIfAborted(signal);
    const expected = snapshotExpectedOutputs(outputs, this.maxOutputs);
    if (expected.length === 0) return Object.freeze([]);
    const requests = createTargetRequests(expected);
    const totals = { bytes: 0, characters: 0 };
    const projected: Readonly<OutputObservation>[] = [];
    let callbackActive = false;
    let visitActive = true;
    try {
      await this.visit(
        requests,
        signal,
        Object.freeze({
          maxFileBytes: Math.min(this.maxBytesPerOutput, this.maxTotalBytes),
        }),
        async (observation, fileByteSize) => {
          if (!visitActive || callbackActive || projected.length >= expected.length) {
            throw createReaderError("response_invalid");
          }
          callbackActive = true;
          try {
            throwIfAborted(signal);
            const index = projected.length;
            projected.push(
              projectObservation(
                observation,
                fileByteSize,
                expected[index],
                requests[index].targetId,
                {
                  maxBytesPerOutput: this.maxBytesPerOutput,
                  maxCharactersPerOutput: this.maxCharactersPerOutput,
                  maxTotalBytes: this.maxTotalBytes,
                  maxTotalCharacters: this.maxTotalCharacters,
                },
                totals
              )
            );
            throwIfAborted(signal);
          } finally {
            callbackActive = false;
          }
        }
      );
    } catch (error) {
      visitActive = false;
      if (signal.aborted) throw createReaderError("aborted");
      if (KnowledgeOutputObservationReaderError.inspect(error)) throw error;
      const resolverCode = ObsidianKnowledgeCompilerTargetResolverError.inspect(error);
      if (resolverCode === "aborted") throw createReaderError("aborted");
      if (resolverCode === "resource_limit") {
        throw createReaderError("output_too_large");
      }
      throw createReaderError("resolver_unavailable");
    }
    visitActive = false;
    throwIfAborted(signal);
    if (callbackActive || projected.length !== expected.length) {
      throw createReaderError("response_invalid");
    }
    return Object.freeze(projected);
  }
}

Object.freeze(KnowledgeOutputObservationReaderError.prototype);
Object.freeze(KnowledgeOutputObservationReaderError);
Object.freeze(ObsidianKnowledgeOutputObservationReader.prototype);
Object.freeze(ObsidianKnowledgeOutputObservationReader);
