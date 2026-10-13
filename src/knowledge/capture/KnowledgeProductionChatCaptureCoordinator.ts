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

export interface KnowledgeVaultSourcePresencePort {
  isFile(sourcePath: string): boolean;
}

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

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function assertCurrent(signal: AbortSignal, assertGenerationCurrent: () => void): void {
  if (signal.aborted) throw createAbortError();
  try {
    assertGenerationCurrent();
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function getPathSuffix(sourcePath: string): string | undefined {
  const fileName = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return undefined;
  return toWindowsPathKey(fileName.slice(dotIndex));
}

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

export class ObsidianKnowledgeVaultSourcePresence implements KnowledgeVaultSourcePresencePort {
  constructor(private readonly vault: Pick<Vault, "getAbstractFileByPath">) {}

  isFile(sourcePath: string): boolean {
    const file = this.vault.getAbstractFileByPath(sourcePath);
    return file instanceof TFile && file.path === sourcePath;
  }
}

export class KnowledgeProductionChatCaptureCoordinator implements KnowledgeChatCapturePort {
  private readonly draftSessions = new WeakSet<object>();

  constructor(private readonly input: KnowledgeProductionChatCaptureCoordinatorInput) {}

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
        // https://github.com/yydspanda/obsidian-copilot/issues/24
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

  private resolveOwner(): ConfiguredProjectKnowledgeBundle {
    if (this.input.owners.length !== 1) {
      throw new KnowledgeChatCaptureError("ambiguous_bundle");
    }
    return this.input.owners[0];
  }

  private resolveSourceRoot(owner: ConfiguredProjectKnowledgeBundle): string {
    if (owner.config.sourceRoots.length !== 1) {
      throw new KnowledgeChatCaptureError("ambiguous_source_root");
    }
    return owner.config.sourceRoots[0];
  }
}
