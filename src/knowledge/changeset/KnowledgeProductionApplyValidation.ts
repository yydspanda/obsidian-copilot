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

function createArtifactKey(value: {
  sourceId: string;
  artifactId: string;
  artifactContentHash: string;
}): string {
  return `${value.sourceId.length}:${value.sourceId}${value.artifactId.length}:${value.artifactId}${value.artifactContentHash}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

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

export class KnowledgeProductionSourceArtifactResolver implements SourceArtifactResolver {
  private readonly artifactsByKey: ReadonlyMap<string, readonly SourceArtifactObservation[]>;

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

  async resolve(locator: SourceLocator): Promise<SourceArtifactObservation | null> {
    const matches = this.artifactsByKey.get(createArtifactKey(locator)) ?? [];
    return matches.length === 1 ? matches[0] : null;
  }
}

Object.freeze(KnowledgeProductionSourceArtifactResolver.prototype);
Object.freeze(KnowledgeProductionSourceArtifactResolver);

export class KnowledgeProductionProjectionValidator implements KnowledgeProjectionValidator {
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

export class KnowledgeProductionReviewCandidateValidator implements KnowledgeReviewCandidateValidator {
  constructor(
    private readonly bundle: KnowledgeBundleConfig,
    private readonly artifacts: readonly SourceArtifactObservation[]
  ) {
    Object.freeze(this);
  }

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
