import {
  validateProductionCandidateCitations,
  validateProductionGeneratedDocuments,
} from "@/knowledge/compiler/KnowledgeProductionCandidateValidator";
import type {
  KnowledgeProjectionValidationInput,
  KnowledgeProjectionValidationResult,
  KnowledgeProjectionValidator,
  SourceArtifactResolver,
} from "@/knowledge/changeset/ChangeSetValidator";
import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type {
  KnowledgeBundleConfig,
  KnowledgeDiagnostic,
  SourceLocator,
} from "@/knowledge/model/types";
import { validateKnowledgeChangeSet } from "@/knowledge/model/validation";
import type {
  KnowledgeReviewCandidateValidationInput,
  KnowledgeReviewCandidateValidationResult,
  KnowledgeReviewCandidateValidator,
} from "@/knowledge/review/ReviewDecision";

/** Creates a collision-free lookup key for one parser-owned artifact identity. */
function createArtifactKey(value: {
  sourceId: string;
  artifactId: string;
  artifactContentHash: string;
}): string {
  return `${value.sourceId.length}:${value.sourceId}${value.artifactId.length}:${value.artifactId}${value.artifactContentHash}`;
}

/** Throws the platform cancellation category without retaining an arbitrary reason. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

/** Prefixes deterministic structural diagnostics for the review validation boundary. */
function appendReviewDiagnostics(
  target: KnowledgeDiagnostic[],
  nested: readonly KnowledgeDiagnostic[]
): void {
  for (const diagnostic of nested) {
    target.push({
      ...diagnostic,
      code: `production_review_${diagnostic.code}`,
      field: diagnostic.field ? `candidate.${diagnostic.field}` : "candidate",
      message: "Selected changes do not satisfy the deterministic knowledge contract",
    });
  }
}

/**
 * Exact parser-artifact resolver scoped to one accepted transaction attempt.
 *
 * The resolver never reads a path and returns material only when a locator's
 * complete source/artifact/hash triple identifies exactly one preparation item.
 */
export class KnowledgeProductionSourceArtifactResolver implements SourceArtifactResolver {
  private readonly artifactsByKey: ReadonlyMap<string, readonly SourceArtifactObservation[]>;

  /** Captures the immutable artifacts returned by one exact workflow-plan preparation. */
  constructor(artifacts: readonly SourceArtifactObservation[]) {
    const byKey = new Map<string, SourceArtifactObservation[]>();
    for (const artifact of artifacts) {
      const key = createArtifactKey(artifact);
      const matches = byKey.get(key) ?? [];
      matches.push(artifact);
      byKey.set(key, matches);
    }
    this.artifactsByKey = new Map(
      [...byKey].map(([key, matches]) => [key, Object.freeze([...matches])])
    );
    Object.freeze(this);
  }

  /** Resolves only one exact parser-owned artifact identity. */
  async resolve(locator: SourceLocator): Promise<SourceArtifactObservation | null> {
    const matches = this.artifactsByKey.get(createArtifactKey(locator)) ?? [];
    return matches.length === 1 ? matches[0] : null;
  }
}

Object.freeze(KnowledgeProductionSourceArtifactResolver.prototype);
Object.freeze(KnowledgeProductionSourceArtifactResolver);

/**
 * First-generation projected OKF/link validator for fresh create/update apply.
 *
 * The compiler already rejects delete and every outbound link syntax. Because
 * create/update cannot invalidate incoming links, revalidating every changed
 * after-state is the complete affected projection for this intentionally
 * linkless generation. Delete remains blocked by the Windows file store before
 * this adapter is called.
 */
export class KnowledgeProductionProjectionValidator implements KnowledgeProjectionValidator {
  /** Recomputes OKF and link validity from the exact transaction change set. */
  async validate(
    input: KnowledgeProjectionValidationInput
  ): Promise<KnowledgeProjectionValidationResult> {
    const diagnostics: KnowledgeDiagnostic[] = [];
    const generated = validateProductionGeneratedDocuments(
      input.bundle.wikiRoot,
      input.changeSet.changes,
      input.changeSet.citations,
      diagnostics
    );
    return {
      okfValid: generated.okfValid,
      linksValid: generated.linksValid,
      diagnostics,
    };
  }
}

Object.freeze(KnowledgeProductionProjectionValidator.prototype);
Object.freeze(KnowledgeProductionProjectionValidator);

/**
 * Deterministic review-time validator over exact parser artifacts and selected files.
 *
 * It performs no Vault writes and trusts neither the proposal's validation flags
 * nor the model's earlier result. The apply transaction repeats both citation
 * and document checks after durable acceptance.
 */
export class KnowledgeProductionReviewCandidateValidator implements KnowledgeReviewCandidateValidator {
  /** Captures one exact parser preparation for the review command. */
  constructor(
    private readonly bundle: KnowledgeBundleConfig,
    private readonly artifacts: readonly SourceArtifactObservation[]
  ) {
    Object.freeze(this);
  }

  /** Revalidates selected content, citations, OKF shape, and linklessness. */
  async validate(
    input: KnowledgeReviewCandidateValidationInput,
    signal: AbortSignal
  ): Promise<KnowledgeReviewCandidateValidationResult> {
    throwIfAborted(signal);
    const diagnostics: KnowledgeDiagnostic[] = [];
    const structural = validateKnowledgeChangeSet(input.candidate, this.bundle);
    appendReviewDiagnostics(diagnostics, structural.diagnostics);
    if (
      !structural.valid ||
      input.proposal.bundleId !== this.bundle.id ||
      input.candidate.bundleId !== this.bundle.id
    ) {
      return {
        validation: { okfValid: false, citationsValid: false, linksValid: false },
        diagnostics,
      };
    }

    const citationsValid = validateProductionCandidateCitations(
      this.artifacts,
      input.candidate.citations,
      diagnostics
    );
    const generated = validateProductionGeneratedDocuments(
      this.bundle.wikiRoot,
      input.candidate.changes,
      input.candidate.citations,
      diagnostics
    );
    throwIfAborted(signal);
    return {
      validation: {
        okfValid: generated.okfValid,
        citationsValid,
        linksValid: generated.linksValid,
      },
      diagnostics,
    };
  }
}

Object.freeze(KnowledgeProductionReviewCandidateValidator.prototype);
Object.freeze(KnowledgeProductionReviewCandidateValidator);
