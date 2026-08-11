import {
  createKnowledgeChatDraftCapture,
  KnowledgeChatDraftCaptureError,
  type KnowledgeChatDraftRequest,
} from "@/knowledge/capture/KnowledgeChatDraftCapture";
import {
  isKnowledgeChatCapturePath,
  KnowledgeChatCaptureError,
  type KnowledgeChatCapturePort,
  type KnowledgeChatCaptureReceipt,
  type KnowledgeChatCaptureRequest,
  type KnowledgeChatDraftReceipt,
  type KnowledgeChatDraftSession,
} from "@/knowledge/capture/KnowledgeChatCapturePort";
import type { KnowledgeFolderImportFileStorePort } from "@/knowledge/capture/KnowledgeProductionFolderImportCoordinator";
import { createKnowledgeSourceOriginExtensions } from "@/knowledge/capture/KnowledgeSourceOrigin";
import {
  KnowledgeSourceRegistrationCore,
  KnowledgeSourceRegistrationMetadataConflictError,
} from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { SourceManifestIdentityConflictError } from "@/knowledge/manifest/SourceManifestRepository";
import { isPathWithinRoot, parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { TFile, type Vault } from "obsidian";

const MANAGED_CHAT_DRAFT_PREFIX = "Knowledge Draft ";
const MAX_WINDOWS_DESTINATION_PATH_LENGTH = 240;

/** Read-only Vault capability used to re-prove a Chat-selected source path. */
export interface KnowledgeVaultSourcePresencePort {
  isFile(sourcePath: string): boolean;
}

/** Exact production dependencies retained by one released capture generation. */
export interface KnowledgeProductionChatCaptureCoordinatorInput {
  owners: readonly ConfiguredProjectKnowledgeBundle[];
  parserProfiles: readonly KnowledgeSourceParserProfile[];
  sourcePresence: KnowledgeVaultSourcePresencePort;
  registration: KnowledgeSourceRegistrationCore;
  createFileStore(sourceRoot: string): KnowledgeFolderImportFileStorePort;
  assertCurrent: () => void;
  onGenerationRefreshRequired: () => void;
  retainDrain?: (drain: Promise<void>) => void;
}

/** Creates the standard cancellation category for stale production capture work. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Requires the owning released production generation around each side-effect boundary. */
function assertCurrent(signal: AbortSignal, assertGenerationCurrent: () => void): void {
  if (signal.aborted) throw createAbortError();
  try {
    assertGenerationCurrent();
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

/** Reports whether an unknown failure is the standard cancellation category. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Returns the exact lower-case path suffix beginning with its final dot. */
function getPathSuffix(sourcePath: string): string | undefined {
  const fileName = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
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

/** Read-only Obsidian adapter that resolves only an exact existing Vault file. */
export class ObsidianKnowledgeVaultSourcePresence implements KnowledgeVaultSourcePresencePort {
  /** Creates a source-presence adapter without exposing file reads. */
  constructor(private readonly vault: Pick<Vault, "getAbstractFileByPath">) {}

  /** Returns whether the exact Vault-relative path still names a file. */
  isFile(sourcePath: string): boolean {
    const file = this.vault.getAbstractFileByPath(sourcePath);
    return file instanceof TFile && file.path === sourcePath;
  }
}

/**
 * Generation-bound production adapter for explicit Chat Add-to-Knowledge choices.
 *
 * This adapter can register only an existing parser-supported Vault source under one uniquely
 * configured Bundle/root. It never attaches Chat context and never writes Queue
 * state directly; a fresh production generation performs authoritative ingest.
 */
export class KnowledgeProductionChatCaptureCoordinator implements KnowledgeChatCapturePort {
  private readonly draftSessions = new WeakSet<object>();

  /** Creates one exact released-generation capture adapter. */
  constructor(private readonly input: KnowledgeProductionChatCaptureCoordinatorInput) {}

  /**
   * Durably registers one explicit Vault source and requests a full workflow rebuild.
   *
   * @param request - Opaque Chat request containing only a Vault-relative path
   * @param signal - Linked caller and delegate-generation cancellation
   * @returns Truthful Manifest registration receipt
   */
  async addVaultSource(
    request: Readonly<KnowledgeChatCaptureRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatCaptureReceipt> {
    assertCurrent(signal, this.input.assertCurrent);
    const owner = this.resolveOwner();
    const sourceRoot = this.resolveSourceRoot(owner);
    const sourcePath = request.sourcePath;
    const suffix = getPathSuffix(sourcePath);

    if (
      !suffix ||
      !isKnowledgeChatCapturePath(sourcePath) ||
      !hasSingleParserOwner(suffix, this.input.parserProfiles)
    ) {
      throw new KnowledgeChatCaptureError("unsupported_source_type");
    }
    if (!isPathWithinRoot(sourcePath, sourceRoot)) {
      throw new KnowledgeChatCaptureError("source_outside_root");
    }
    if (!this.input.sourcePresence.isFile(sourcePath)) {
      throw new KnowledgeChatCaptureError("source_missing");
    }

    try {
      const result = await this.input.registration.register(
        {
          bundleId: owner.config.id,
          sourceRoot,
          sourcePath,
          custody: "user_managed",
          extensions: createKnowledgeSourceOriginExtensions("chat_add_to_knowledge"),
          existingPathPolicy: "reuse_path",
        },
        signal,
        this.input.onGenerationRefreshRequired
      );
      return { status: result.status, bundleId: owner.config.id };
    } catch (error) {
      if (error instanceof KnowledgeChatCaptureError || error instanceof DOMException) throw error;
      if (error instanceof SourceManifestIdentityConflictError) {
        throw new KnowledgeChatCaptureError("source_conflict");
      }
      throw new KnowledgeChatCaptureError("registration_failed");
    }
  }

  /** Captures one exact current draft destination before the user starts editing. */
  prepareKnowledgeDraft(): Readonly<KnowledgeChatDraftSession> | null {
    try {
      this.input.assertCurrent();
      const owner = this.resolveOwner();
      const sourceRoot = this.resolveSourceRoot(owner);
      if (!hasSingleParserOwner(".md", this.input.parserProfiles)) return null;
      const session = Object.freeze({ bundleId: owner.config.id, sourceRoot });
      this.draftSessions.add(session);
      this.input.assertCurrent();
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Persists one edited assistant response as a managed Markdown Source.
   *
   * A successful receipt proves only exclusive file publication and Manifest
   * registration. The replacement generation still owns Activity, compilation,
   * Review, and Apply; this method never writes Wiki files or Queue state.
   */
  createKnowledgeDraft(
    session: Readonly<KnowledgeChatDraftSession>,
    request: Readonly<KnowledgeChatDraftRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatDraftReceipt> {
    const operation = this.performCreateKnowledgeDraft(session, request, signal);
    this.input.retainDrain?.(
      operation.then(
        () => undefined,
        () => undefined
      )
    );
    return operation;
  }

  /** Performs one retained, retry-safe draft publication and registration sequence. */
  private async performCreateKnowledgeDraft(
    session: Readonly<KnowledgeChatDraftSession>,
    request: Readonly<KnowledgeChatDraftRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeChatDraftReceipt> {
    let refreshRequired = false;
    let refreshRequested = false;
    let durableReceipt: KnowledgeChatDraftReceipt | undefined;
    const requestRefresh = (): void => {
      if (refreshRequested) return;
      refreshRequested = true;
      try {
        this.input.onGenerationRefreshRequired();
      } catch {
        // Durable file/Manifest state wins; the next startup or exact replay converges it.
      }
    };

    try {
      if (typeof session !== "object" || session === null || !this.draftSessions.has(session)) {
        throw new KnowledgeChatCaptureError("unavailable");
      }
      const capture = createKnowledgeChatDraftCapture(request);
      assertCurrent(signal, this.input.assertCurrent);
      const owner = this.resolveOwner();
      const sourceRoot = this.resolveSourceRoot(owner);
      if (session.bundleId !== owner.config.id || session.sourceRoot !== sourceRoot) {
        throw new KnowledgeChatCaptureError("unavailable");
      }
      if (!hasSingleParserOwner(".md", this.input.parserProfiles)) {
        throw new KnowledgeChatCaptureError("unsupported_source_type");
      }
      const sourcePath = `${sourceRoot}/${MANAGED_CHAT_DRAFT_PREFIX}${capture.captureDigest}.md`;
      const parsedPath = parseVaultPath(sourcePath);
      if (
        !parsedPath.ok ||
        parsedPath.path !== sourcePath ||
        sourcePath.length > MAX_WINDOWS_DESTINATION_PATH_LENGTH
      ) {
        throw new KnowledgeChatCaptureError("draft_conflict");
      }
      const registrationRequest = Object.freeze({
        bundleId: owner.config.id,
        sourceRoot,
        sourcePath,
        custody: "managed_copy" as const,
        extensions: createKnowledgeSourceOriginExtensions("chat_knowledge_draft", {
          captureDigest: capture.captureDigest,
          captureContentHash: capture.sourceContentHash,
        }),
        existingPathPolicy: "exact" as const,
      });

      await this.input.registration.preflight(registrationRequest, signal);
      assertCurrent(signal, this.input.assertCurrent);
      const published = await this.input
        .createFileStore(sourceRoot)
        .publish(sourcePath, new TextEncoder().encode(capture.sourceContent), signal);
      if (
        (published.status !== "created" && published.status !== "reused") ||
        published.contentHash !== capture.sourceContentHash
      ) {
        throw new KnowledgeChatCaptureError("draft_conflict");
      }
      const registeredReceipt = Object.freeze({
        status: "registered" as const,
        bundleId: owner.config.id,
        sourcePath,
      });
      let registration: Awaited<ReturnType<KnowledgeSourceRegistrationCore["register"]>>;
      try {
        registration = await this.input.registration.register(registrationRequest, signal, () => {
          durableReceipt = registeredReceipt;
          refreshRequired = true;
          requestRefresh();
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        assertCurrent(signal, this.input.assertCurrent);
        const confirmation = await this.input.registration.preflight(registrationRequest, signal);
        if (confirmation.status === "already_registered") {
          refreshRequired = true;
          return Object.freeze({
            status: "already_registered" as const,
            bundleId: owner.config.id,
            sourcePath,
          });
        }
        throw error;
      }
      if (registration.status === "already_registered") {
        refreshRequired = true;
      }
      return Object.freeze({
        status: registration.status,
        bundleId: owner.config.id,
        sourcePath,
      });
    } catch (error) {
      if (durableReceipt) return durableReceipt;
      if (isAbortError(error)) throw createAbortError();
      if (error instanceof KnowledgeChatCaptureError) throw error;
      if (error instanceof KnowledgeChatDraftCaptureError) {
        throw new KnowledgeChatCaptureError("draft_invalid");
      }
      if (
        error instanceof KnowledgeSourceRegistrationMetadataConflictError ||
        error instanceof SourceManifestIdentityConflictError
      ) {
        throw new KnowledgeChatCaptureError("draft_conflict");
      }
      throw new KnowledgeChatCaptureError("draft_persistence_failed");
    } finally {
      if (refreshRequired) requestRefresh();
    }
  }

  /** Requires exactly one production Bundle for implicit Chat capture. */
  private resolveOwner(): ConfiguredProjectKnowledgeBundle {
    if (this.input.owners.length !== 1) {
      throw new KnowledgeChatCaptureError("ambiguous_bundle");
    }
    return this.input.owners[0];
  }

  /** Requires exactly one source root so Chat never guesses a durable destination. */
  private resolveSourceRoot(owner: ConfiguredProjectKnowledgeBundle): string {
    if (owner.config.sourceRoots.length !== 1) {
      throw new KnowledgeChatCaptureError("ambiguous_source_root");
    }
    return owner.config.sourceRoots[0];
  }
}
