import type { CompilerTargetResolver } from "@/knowledge/compiler/CompilerModelPort";
import type { KnowledgeBundleConfig } from "@/knowledge/model/types";
import { validateKnowledgeBundleConfig } from "@/knowledge/model/validation";
import { isPathWithinRoot, parseVaultPath } from "@/knowledge/paths/vaultPath";
import type {
  ObsidianKnowledgeCitationNavigationRequest,
  ObsidianKnowledgeCitationNavigationResult,
} from "@/knowledge/query/ObsidianKnowledgeCitationNavigator";
import {
  resolveKnowledgeReviewEvidenceCitation,
  snapshotKnowledgeReviewEvidenceOpenRequest,
  type KnowledgeReviewEvidenceOpenRequest,
  type KnowledgeReviewEvidenceOpenResult,
} from "@/knowledge/review/KnowledgeReviewEvidence";
import type { KnowledgeStudioReviewEvidencePort } from "@/knowledge/ui/KnowledgeStudioReviewEvidencePort";
import {
  loadKnowledgeStudioReviewContext,
  type KnowledgeStudioRuntimePort,
} from "@/knowledge/ui/KnowledgeStudioRuntimeReadAdapter";

/** Current workflow-plan authority used to recover one private source path. */
export interface KnowledgeReviewEvidenceSourceAuthorityPort {
  /** Re-proves one registered source and returns only its current canonical Vault path. */
  resolve(
    bundleId: string,
    sourceId: string,
    signal: AbortSignal
  ): Promise<Readonly<{ sourcePath: string }> | undefined>;
}

/** Read-only exact citation navigator accepted by the production coordinator. */
export interface KnowledgeReviewEvidenceNavigationPort {
  /** Opens one fully resolved citation through the captured Obsidian owner. */
  navigate(
    request: ObsidianKnowledgeCitationNavigationRequest,
    signal?: AbortSignal
  ): Promise<ObsidianKnowledgeCitationNavigationResult>;
}

/** Dependencies retained by one released production Review-evidence generation. */
export interface KnowledgeProductionReviewEvidenceCoordinatorInput {
  readonly runtime: KnowledgeStudioRuntimePort;
  readonly bundle: KnowledgeBundleConfig;
  readonly targetResolver: CompilerTargetResolver;
  readonly sourceAuthority: KnowledgeReviewEvidenceSourceAuthorityPort;
  readonly navigator: KnowledgeReviewEvidenceNavigationPort;
  readonly assertCurrent: () => void;
  readonly maxConsistencyAttempts?: number;
}

interface KnowledgeProductionReviewEvidenceCoordinatorState {
  readonly runtime: KnowledgeStudioRuntimePort;
  readonly bundle: Readonly<KnowledgeBundleConfig>;
  readonly targetResolver: CompilerTargetResolver;
  readonly sourceAuthority: KnowledgeReviewEvidenceSourceAuthorityPort;
  readonly navigator: KnowledgeReviewEvidenceNavigationPort;
  readonly assertCurrent: () => void;
  readonly maxConsistencyAttempts?: number;
}

const coordinatorStates = new WeakMap<object, KnowledgeProductionReviewEvidenceCoordinatorState>();
const STALE_RESULT = Object.freeze({ kind: "stale" as const });
const UNSUPPORTED_RESULT = Object.freeze({ kind: "unsupported" as const });
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });

/** Creates the platform-standard cancellation category without retaining a reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reports whether one failure is intentional cancellation. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Stops work at every asynchronous authority boundary. */
function assertInvocation(
  state: KnowledgeProductionReviewEvidenceCoordinatorState,
  signal: AbortSignal
): void {
  if (signal.aborted) throw createAbortError();
  state.assertCurrent();
  if (signal.aborted) throw createAbortError();
}

/** Returns hidden state only for an authentic coordinator instance. */
function requireCoordinatorState(
  value: unknown
): KnowledgeProductionReviewEvidenceCoordinatorState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeProductionReviewEvidenceCoordinator.prototype
  ) {
    throw createAbortError();
  }
  const state = coordinatorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Creates a detached immutable Bundle snapshot for path-confinement checks. */
function snapshotBundle(bundle: KnowledgeBundleConfig): Readonly<KnowledgeBundleConfig> {
  if (!validateKnowledgeBundleConfig(bundle).valid) throw createAbortError();
  return Object.freeze({
    ...bundle,
    sourceRoots: Object.freeze([...bundle.sourceRoots]) as unknown as string[],
  });
}

/** Maps the existing Obsidian navigator's value-free status to the Review result. */
function mapNavigationResult(
  result: ObsidianKnowledgeCitationNavigationResult
): Readonly<KnowledgeReviewEvidenceOpenResult> {
  try {
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      return UNAVAILABLE_RESULT;
    }
    const prototype = Object.getPrototypeOf(result);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(result).length !== 1
    ) {
      return UNAVAILABLE_RESULT;
    }
    const status = Object.getOwnPropertyDescriptor(result, "status");
    if (!status || !("value" in status) || !status.enumerable) return UNAVAILABLE_RESULT;
    switch (status.value) {
      case "opened":
        return Object.freeze({ kind: "opened" as const });
      case "stale":
        return STALE_RESULT;
      case "unsupported":
        return UNSUPPORTED_RESULT;
      case "unavailable":
        return UNAVAILABLE_RESULT;
      default:
        return UNAVAILABLE_RESULT;
    }
  } catch {
    return UNAVAILABLE_RESULT;
  }
}

/** Checks that the exact source type can support the citation locator contract. */
function sourceSupportsLocator(sourcePath: string, locatorKind: string): boolean {
  const lowerPath = sourcePath.toLowerCase();
  if (lowerPath.endsWith(".pdf")) return locatorKind === "pdf_page";
  if (lowerPath.endsWith(".md")) return locatorKind !== "pdf_page";
  return false;
}

/** Captures the exact one-field source authority receipt without invoking accessors. */
function snapshotSourcePath(value: unknown): string | undefined {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).length !== 1
    ) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "sourcePath");
    return descriptor && "value" in descriptor && descriptor.enumerable
      ? typeof descriptor.value === "string"
        ? descriptor.value
        : undefined
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reconstructs Review evidence authority at click time and opens only an exact source citation.
 *
 * This coordinator has no model, network, Queue mutation, Review mutation, or Vault-write
 * dependency. Paths and actionable locators remain private behind the opaque Studio port.
 */
export class KnowledgeProductionReviewEvidenceCoordinator
  implements KnowledgeStudioReviewEvidencePort
{
  /** Captures one exact Runtime, workflow authority, and Obsidian navigation generation. */
  constructor(input: KnowledgeProductionReviewEvidenceCoordinatorInput) {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.runtime?.readStudioBundle !== "function" ||
      typeof input.runtime?.subscribeStudioBundle !== "function" ||
      typeof input.targetResolver?.resolve !== "function" ||
      typeof input.sourceAuthority?.resolve !== "function" ||
      typeof input.navigator?.navigate !== "function" ||
      typeof input.assertCurrent !== "function"
    ) {
      throw createAbortError();
    }
    const maxConsistencyAttempts = input.maxConsistencyAttempts;
    if (
      maxConsistencyAttempts !== undefined &&
      (!Number.isSafeInteger(maxConsistencyAttempts) || maxConsistencyAttempts < 1)
    ) {
      throw createAbortError();
    }
    coordinatorStates.set(this, {
      runtime: input.runtime,
      bundle: snapshotBundle(input.bundle),
      targetResolver: input.targetResolver,
      sourceAuthority: input.sourceAuthority,
      navigator: input.navigator,
      assertCurrent: input.assertCurrent,
      ...(maxConsistencyAttempts === undefined ? {} : { maxConsistencyAttempts }),
    });
    Object.freeze(this);
  }

  /** Re-proves an opaque current-plan reference and opens its exact registered source. */
  async openReviewEvidence(
    bundleId: string,
    requestValue: Readonly<KnowledgeReviewEvidenceOpenRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeReviewEvidenceOpenResult>> {
    const state = requireCoordinatorState(this);
    let request: Readonly<KnowledgeReviewEvidenceOpenRequest>;
    try {
      request = snapshotKnowledgeReviewEvidenceOpenRequest(requestValue);
    } catch {
      return UNAVAILABLE_RESULT;
    }
    if (bundleId !== state.bundle.id) return UNAVAILABLE_RESULT;

    try {
      assertInvocation(state, signal);
      const context = await loadKnowledgeStudioReviewContext({
        runtime: state.runtime,
        bundle: state.bundle,
        targetResolver: state.targetResolver,
        changeSetId: request.changeSetId,
        signal,
        assertCurrent: state.assertCurrent,
        ...(state.maxConsistencyAttempts === undefined
          ? {}
          : { maxConsistencyAttempts: state.maxConsistencyAttempts }),
      });
      assertInvocation(state, signal);
      if (
        !context ||
        context.plan.changeSetId !== request.changeSetId ||
        context.plan.proposalDigest !== request.proposalDigest ||
        context.plan.snapshotToken !== request.expectedSnapshotToken ||
        !context.plan.evidence.some((evidence) => evidence.evidenceRef === request.evidenceRef)
      ) {
        return STALE_RESULT;
      }

      const citation = resolveKnowledgeReviewEvidenceCitation(
        context.record.proposal,
        request.proposalDigest,
        request.evidenceRef
      );
      if (!citation) return STALE_RESULT;

      const source = await state.sourceAuthority.resolve(
        bundleId,
        citation.locator.sourceId,
        signal
      );
      assertInvocation(state, signal);
      if (!source) return STALE_RESULT;
      const sourcePath = snapshotSourcePath(source);
      if (!sourcePath) return UNAVAILABLE_RESULT;
      const parsedPath = parseVaultPath(sourcePath);
      if (
        !parsedPath.ok ||
        parsedPath.path !== sourcePath ||
        !state.bundle.sourceRoots.some((root) => isPathWithinRoot(sourcePath, root))
      ) {
        return UNAVAILABLE_RESULT;
      }
      if (!sourceSupportsLocator(sourcePath, citation.locator.kind)) {
        return UNSUPPORTED_RESULT;
      }

      const result = await state.navigator.navigate({ sourcePath, citation }, signal);
      assertInvocation(state, signal);
      return mapNavigationResult(result);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw createAbortError();
      return UNAVAILABLE_RESULT;
    }
  }
}

Object.freeze(KnowledgeProductionReviewEvidenceCoordinator.prototype);
Object.freeze(KnowledgeProductionReviewEvidenceCoordinator);
