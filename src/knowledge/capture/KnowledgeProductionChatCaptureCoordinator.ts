import {
  isKnowledgeChatCapturePath,
  KnowledgeChatCaptureError,
  type KnowledgeChatCapturePort,
  type KnowledgeChatCaptureReceipt,
  type KnowledgeChatCaptureRequest,
} from "@/knowledge/capture/KnowledgeChatCapturePort";
import { createKnowledgeSourceOriginExtensions } from "@/knowledge/capture/KnowledgeSourceOrigin";
import { KnowledgeSourceRegistrationCore } from "@/knowledge/capture/KnowledgeSourceRegistrationCore";
import type { ConfiguredProjectKnowledgeBundle } from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import type { KnowledgeSourceParserProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { SourceManifestIdentityConflictError } from "@/knowledge/manifest/SourceManifestRepository";
import { isPathWithinRoot, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import { TFile, type Vault } from "obsidian";

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
  assertCurrent: () => void;
  onGenerationRefreshRequired: () => void;
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
 * This adapter can register only an existing Vault text source under one uniquely
 * configured Bundle/root. It never attaches Chat context and never writes Queue
 * state directly; a fresh production generation performs authoritative ingest.
 */
export class KnowledgeProductionChatCaptureCoordinator implements KnowledgeChatCapturePort {
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
