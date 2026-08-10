import {
  KNOWLEDGE_FOLDER_IMPORT_SUFFIXES,
  KnowledgeFolderImportError,
  type KnowledgeFolderImportPort,
  type KnowledgeFolderImportReceipt,
  type KnowledgeFolderImportRequest,
} from "@/knowledge/capture/KnowledgeFolderImportPort";
import { createKnowledgeSourceOriginExtensions } from "@/knowledge/capture/KnowledgeSourceOrigin";
import { KnowledgeFolderImportFileStoreError } from "@/knowledge/capture/ObsidianKnowledgeFolderImportFileStore";
import {
  KnowledgeSourceRegistrationCore,
  KnowledgeSourceRegistrationMetadataConflictError,
  type KnowledgeSourceRegistrationPreflightResult,
} from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { SourceManifestIdentityConflictError } from "@/knowledge/manifest/SourceManifestRepository";
import { createSourceContentHash } from "@/knowledge/model/fingerprint";
import {
  findWindowsPathCollisions,
  isPathWithinRoot,
  parseVaultPath,
  toWindowsPathKey,
} from "@/knowledge/paths/vaultPath";

const MAX_FOLDER_IMPORT_FILES = 1_000;
const MAX_FOLDER_IMPORT_FILE_BYTES = 8_388_608;
const MAX_FOLDER_IMPORT_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_FOLDER_IMPORT_RELATIVE_PATH_LENGTH = 1_024;
const MAX_WINDOWS_DESTINATION_PATH_LENGTH = 240;

/** Exact result of publishing one managed source copy into the Vault. */
export interface KnowledgeFolderImportPublishResult {
  status: "created" | "reused" | "conflict";
  contentHash?: string;
}

/** Least-authority binary destination owned by one exact source root. */
export interface KnowledgeFolderImportFileStorePort {
  /** Publishes exact bytes without replacing an existing destination. */
  publish(
    destinationPath: string,
    bytes: Uint8Array,
    signal: AbortSignal
  ): Promise<KnowledgeFolderImportPublishResult>;
}

/** Exact production dependencies retained by one released import generation. */
export interface KnowledgeProductionFolderImportCoordinatorInput {
  owners: readonly ConfiguredProjectKnowledgeBundle[];
  parserProfiles: readonly KnowledgeSourceParserProfile[];
  registration: KnowledgeSourceRegistrationCore;
  createFileStore(sourceRoot: string): KnowledgeFolderImportFileStorePort;
  assertCurrent: () => void;
  onGenerationRefreshRequired: () => void;
}

interface SelectedFolderFile {
  readonly file: File;
  readonly arrayBuffer: File["arrayBuffer"];
  readonly relativePath: string;
  readonly destinationPath: string;
  readonly size: number;
  readonly suffix: string;
}

interface CapturedBrowserFile {
  readonly file: File;
  readonly arrayBuffer: File["arrayBuffer"];
}

interface FolderImportPlan {
  readonly discoveredFiles: number;
  readonly eligibleFiles: readonly SelectedFolderFile[];
  readonly skippedFiles: number;
}

/** Creates the standard cancellation category for stale production import work. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reports whether an error is cancellation from any supported runtime. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Converts a systemic copy-boundary failure into one path-free import error. */
function createStoreImportError(error: unknown): KnowledgeFolderImportError {
  if (
    error instanceof KnowledgeFolderImportFileStoreError &&
    (error.code === "unsupported_adapter" || error.code === "unsupported_runtime")
  ) {
    return new KnowledgeFolderImportError("unsupported_runtime");
  }
  return new KnowledgeFolderImportError("import_failed");
}

/** Requires caller cancellation and the owning production generation together. */
function assertCurrent(signal: AbortSignal, assertGenerationCurrent: () => void): void {
  if (signal.aborted) throw createAbortError();
  try {
    assertGenerationCurrent();
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

/** Returns the exact lower-case suffix beginning with its final dot. */
function getPathSuffix(path: string): string | undefined {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return undefined;
  return toWindowsPathKey(fileName.slice(dotIndex));
}

/** Proves that exactly one current production parser owns the candidate suffix. */
function hasSingleParserOwner(
  suffix: string,
  profiles: readonly KnowledgeSourceParserProfile[]
): boolean {
  return (
    profiles.filter((profile) =>
      profile.pathSuffixes.some((candidate) => toWindowsPathKey(candidate) === suffix)
    ).length === 1
  );
}

/** Reads one enumerable own data property without evaluating an accessor. */
function readDataProperty(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  return descriptor.value;
}

/** Reads one browser-selected relative path without retaining an external absolute path. */
function captureWebkitRelativePath(file: File): string {
  let value: unknown;
  try {
    value = file.webkitRelativePath;
  } catch {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_FOLDER_IMPORT_RELATIVE_PATH_LENGTH
  ) {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  return value;
}

/** Reads one exact, bounded browser File size before any byte allocation. */
function captureFileSize(file: File): number {
  let value: unknown;
  try {
    value = file.size;
  } catch {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  if ((value as number) > MAX_FOLDER_IMPORT_FILE_BYTES) {
    throw new KnowledgeFolderImportError("selection_too_large");
  }
  return value as number;
}

/** Snapshots and validates one complete folder selection before the first file read. */
function createFolderImportPlan(
  request: Readonly<KnowledgeFolderImportRequest>,
  sourceRoot: string,
  parserProfiles: readonly KnowledgeSourceParserProfile[]
): FolderImportPlan {
  let keys: PropertyKey[];
  let prototype: object | null;
  try {
    keys = Reflect.ownKeys(request);
    prototype = Object.getPrototypeOf(request);
  } catch {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  if (
    typeof request !== "object" ||
    request === null ||
    Array.isArray(request) ||
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== 1 ||
    keys[0] !== "files"
  ) {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  const selectedFiles = readDataProperty(request, "files");
  if (!Array.isArray(selectedFiles) || selectedFiles.length === 0) {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  if (selectedFiles.length > MAX_FOLDER_IMPORT_FILES) {
    throw new KnowledgeFolderImportError("selection_too_large");
  }
  const parsedRoot = parseVaultPath(sourceRoot);
  if (!parsedRoot.ok || parsedRoot.path !== sourceRoot) {
    throw new KnowledgeFolderImportError("import_failed");
  }

  let totalBytes = 0;
  let selectedRootKey: string | undefined;
  let skippedFiles = 0;
  const eligibleFiles: SelectedFolderFile[] = [];
  const files: CapturedBrowserFile[] = [];
  for (let index = 0; index < selectedFiles.length; index += 1) {
    const file = readDataProperty(selectedFiles, String(index));
    if (typeof file !== "object" || file === null) {
      throw new KnowledgeFolderImportError("invalid_selection");
    }
    let arrayBuffer: unknown;
    try {
      arrayBuffer = Reflect.get(file, "arrayBuffer");
    } catch {
      throw new KnowledgeFolderImportError("invalid_selection");
    }
    if (typeof arrayBuffer !== "function") {
      throw new KnowledgeFolderImportError("invalid_selection");
    }
    files.push(
      Object.freeze({ file: file as File, arrayBuffer: arrayBuffer as File["arrayBuffer"] })
    );
  }
  let selectedKeys: PropertyKey[];
  try {
    selectedKeys = Reflect.ownKeys(selectedFiles);
  } catch {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  if (selectedKeys.length !== files.length + 1) {
    throw new KnowledgeFolderImportError("invalid_selection");
  }

  for (const { file, arrayBuffer } of files) {
    const relativePath = captureWebkitRelativePath(file);
    const parsedRelative = parseVaultPath(relativePath);
    if (!parsedRelative.ok || parsedRelative.segments.length < 2) {
      throw new KnowledgeFolderImportError("invalid_selection");
    }
    const rootKey = toWindowsPathKey(parsedRelative.segments[0]);
    if (selectedRootKey === undefined) selectedRootKey = rootKey;
    if (rootKey !== selectedRootKey) {
      throw new KnowledgeFolderImportError("invalid_selection");
    }
    const destinationPath = `${sourceRoot}/${relativePath}`;
    if (
      destinationPath.length > MAX_WINDOWS_DESTINATION_PATH_LENGTH ||
      !isPathWithinRoot(destinationPath, sourceRoot)
    ) {
      throw new KnowledgeFolderImportError("invalid_selection");
    }
    const suffix = getPathSuffix(relativePath);
    if (
      !suffix ||
      !KNOWLEDGE_FOLDER_IMPORT_SUFFIXES.includes(suffix) ||
      !hasSingleParserOwner(suffix, parserProfiles)
    ) {
      skippedFiles += 1;
      continue;
    }
    const size = captureFileSize(file);
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_FOLDER_IMPORT_TOTAL_BYTES) {
      throw new KnowledgeFolderImportError("selection_too_large");
    }
    eligibleFiles.push(
      Object.freeze({ file, arrayBuffer, relativePath, destinationPath, size, suffix })
    );
  }

  if (
    findWindowsPathCollisions(eligibleFiles.map(({ destinationPath }) => destinationPath)).length
  ) {
    throw new KnowledgeFolderImportError("invalid_selection");
  }
  return Object.freeze({
    discoveredFiles: files.length,
    eligibleFiles: Object.freeze(eligibleFiles),
    skippedFiles,
  });
}

/** Reads and copies one selected File into parser-owned bytes. */
async function readSelectedFile(
  selection: SelectedFolderFile,
  signal: AbortSignal,
  assertGenerationCurrent: () => void
): Promise<Uint8Array> {
  assertCurrent(signal, assertGenerationCurrent);
  const payload: unknown = await Reflect.apply(selection.arrayBuffer, selection.file, []);
  assertCurrent(signal, assertGenerationCurrent);
  let copied: ArrayBuffer;
  try {
    if (
      typeof payload !== "object" ||
      payload === null ||
      Object.prototype.toString.call(payload) !== "[object ArrayBuffer]" ||
      (payload as ArrayBuffer).byteLength !== selection.size
    ) {
      throw new TypeError("invalid buffer");
    }
    copied = (payload as ArrayBuffer).slice(0);
  } catch {
    throw new KnowledgeFolderImportError("import_failed");
  }
  return new Uint8Array(copied);
}

/**
 * Generation-bound production adapter for explicit Knowledge Studio folder import.
 *
 * The coordinator retains no external absolute path. It validates the entire
 * browser selection before reads, then sequentially creates managed Vault copies
 * and registers them. Partial success is durable and exact retries converge.
 */
export class KnowledgeProductionFolderImportCoordinator implements KnowledgeFolderImportPort {
  /** Creates one exact released-generation folder import adapter. */
  constructor(private readonly input: KnowledgeProductionFolderImportCoordinatorInput) {}

  /** Copies and registers one explicit folder selection with one generation refresh. */
  async importFolder(
    request: Readonly<KnowledgeFolderImportRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeFolderImportReceipt> {
    assertCurrent(signal, this.input.assertCurrent);
    const owner = this.resolveOwner();
    const sourceRoot = this.resolveSourceRoot(owner);
    const plan = createFolderImportPlan(request, sourceRoot, this.input.parserProfiles);
    let fileStore: KnowledgeFolderImportFileStorePort;
    try {
      fileStore = this.input.createFileStore(sourceRoot);
    } catch {
      throw new KnowledgeFolderImportError("unsupported_runtime");
    }

    let importedFiles = 0;
    let reusedFiles = 0;
    let conflictFiles = 0;
    let failedFiles = 0;
    let importedBytes = 0;
    let refreshRequired = false;

    try {
      for (const selection of plan.eligibleFiles) {
        assertCurrent(signal, this.input.assertCurrent);
        const registrationRequest = Object.freeze({
          bundleId: owner.config.id,
          sourceRoot,
          sourcePath: selection.destinationPath,
          custody: "managed_copy" as const,
          extensions: createKnowledgeSourceOriginExtensions("folder_import"),
          existingPathPolicy: "exact" as const,
        });

        let registrationPreflight: KnowledgeSourceRegistrationPreflightResult;
        try {
          registrationPreflight = await this.input.registration.preflight(
            registrationRequest,
            signal
          );
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw createAbortError();
          if (
            error instanceof SourceManifestIdentityConflictError ||
            error instanceof KnowledgeSourceRegistrationMetadataConflictError
          ) {
            conflictFiles += 1;
            continue;
          } else {
            throw new KnowledgeFolderImportError("import_failed");
          }
        }

        let bytes: Uint8Array;
        try {
          bytes = await readSelectedFile(selection, signal, this.input.assertCurrent);
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw createAbortError();
          failedFiles += 1;
          continue;
        }
        const expectedHash = createSourceContentHash(bytes);

        let published: KnowledgeFolderImportPublishResult;
        try {
          published = await fileStore.publish(selection.destinationPath, bytes, signal);
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw createAbortError();
          throw createStoreImportError(error);
        }
        assertCurrent(signal, this.input.assertCurrent);
        if (
          !published ||
          (published.status !== "created" &&
            published.status !== "reused" &&
            published.status !== "conflict")
        ) {
          throw new KnowledgeFolderImportError("import_failed");
        }
        if (published.status === "conflict") {
          conflictFiles += 1;
          continue;
        }
        if (published.contentHash !== expectedHash) {
          throw new KnowledgeFolderImportError("import_failed");
        }
        if (published.status === "created" || registrationPreflight.status === "available") {
          refreshRequired = true;
        }

        try {
          const registration = await this.input.registration.register(
            registrationRequest,
            signal,
            () => {
              refreshRequired = true;
            }
          );
          assertCurrent(signal, this.input.assertCurrent);
          const changed = published.status === "created" || registration.status === "registered";
          if (changed) {
            importedFiles += 1;
            if (published.status === "created") importedBytes += selection.size;
          } else {
            reusedFiles += 1;
          }
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw createAbortError();
          if (
            error instanceof SourceManifestIdentityConflictError ||
            error instanceof KnowledgeSourceRegistrationMetadataConflictError
          ) {
            conflictFiles += 1;
            continue;
          }
          throw new KnowledgeFolderImportError("import_failed");
        }
      }
    } finally {
      if (refreshRequired) this.input.onGenerationRefreshRequired();
    }

    assertCurrent(signal, this.input.assertCurrent);
    return Object.freeze({
      status: conflictFiles > 0 || failedFiles > 0 ? "partial" : "completed",
      bundleId: owner.config.id,
      discoveredFiles: plan.discoveredFiles,
      eligibleFiles: plan.eligibleFiles.length,
      importedFiles,
      reusedFiles,
      skippedFiles: plan.skippedFiles,
      conflictFiles,
      failedFiles,
      importedBytes,
    });
  }

  /** Requires exactly one production Bundle for implicit folder import. */
  private resolveOwner(): ConfiguredProjectKnowledgeBundle {
    if (this.input.owners.length !== 1) {
      throw new KnowledgeFolderImportError("ambiguous_bundle");
    }
    return this.input.owners[0];
  }

  /** Requires exactly one source root so import never guesses a durable destination. */
  private resolveSourceRoot(owner: ConfiguredProjectKnowledgeBundle): string {
    if (owner.config.sourceRoots.length !== 1) {
      throw new KnowledgeFolderImportError("ambiguous_source_root");
    }
    return owner.config.sourceRoots[0];
  }
}
