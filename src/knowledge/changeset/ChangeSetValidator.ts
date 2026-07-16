import { createChangeSetTransactionDigest } from "@/knowledge/changeset/TransactionStorage";
import type {
  TransactionFileState,
  TransactionTarget,
} from "@/knowledge/changeset/TransactionStorage";
import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import { validateSourceLocatorAgainstArtifact } from "@/knowledge/model/locatorMaterialValidation";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { parseKnowledgeBundleConfig, parseKnowledgeChangeSet } from "@/knowledge/model/schemas";
import type {
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeValidationSummary,
  SourceLocator,
} from "@/knowledge/model/types";
import {
  validateKnowledgeBundleConfig,
  validateKnowledgeChangeSet,
} from "@/knowledge/model/validation";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

/** Exact runtime observation of one Vault-relative target path. */
export type KnowledgeFileObservation =
  | { kind: "missing" }
  | { kind: "file"; content: string }
  | { kind: "directory" };

/** Atomic compare-and-swap outcome returned by the Vault file adapter. */
export type KnowledgeFileCompareAndSwapResult =
  | { kind: "applied" }
  | { kind: "already_after" }
  | { kind: "conflict"; observation: KnowledgeFileObservation };

/** File I/O boundary used by preflight validation and transaction application. */
export interface KnowledgeFileStore {
  /**
   * Observes the exact current state of one Vault-relative path.
   *
   * @param path - Validated Vault-relative path
   * @returns Missing, text file, or directory state
   */
  observe(path: string): Promise<KnowledgeFileObservation>;

  /**
   * Atomically compares one exact state and applies its journaled replacement.
   *
   * The adapter MUST perform comparison and create/update/delete as one
   * serialized operation. It MUST NOT implement this as a public read followed
   * by an unconditional write: an Obsidian editor update in between could be
   * overwritten. When current state already equals `after`, return
   * `already_after`; when it equals neither state, return the exact conflicting
   * observation without mutating it. The promise resolves only after an applied
   * replacement is durable and observable through {@link observe}.
   *
   * @param path - Validated Vault-relative path
   * @param before - Exact state authorized for replacement
   * @param after - Exact durable replacement state
   * @returns Applied, already-after, or non-mutating conflict outcome
   */
  compareAndSwap(
    path: string,
    before: TransactionFileState,
    after: TransactionFileState
  ): Promise<KnowledgeFileCompareAndSwapResult>;
}

/** Resolves parser-owned source material needed to re-check one citation. */
export interface SourceArtifactResolver {
  /**
   * Resolves the current parsed artifact referenced by a source locator.
   *
   * @param locator - Structurally valid source locator
   * @returns Matching artifact observation, or null when it is unavailable
   */
  resolve(locator: SourceLocator): Promise<SourceArtifactObservation | null>;
}

/** Input presented to an adapter that validates projected OKF files and links. */
export interface KnowledgeProjectionValidationInput {
  bundle: KnowledgeBundleConfig;
  changeSet: KnowledgeChangeSet;
  targets: readonly TransactionTarget[];
}

/** Recomputed non-citation validation result for the projected post-state. */
export interface KnowledgeProjectionValidationResult {
  okfValid: boolean;
  linksValid: boolean;
  diagnostics: readonly KnowledgeDiagnostic[];
}

/** Adapter boundary for OKF and link validation against the projected Vault view. */
export interface KnowledgeProjectionValidator {
  /**
   * Recomputes OKF and link validity without trusting model-provided booleans.
   *
   * The adapter must validate links against the projected view: current Vault
   * plus create/update after-states minus explicit deletes.
   *
   * @param input - Bundle, accepted ChangeSet, and deterministic target projection
   * @returns Recomputed validation flags and structured diagnostics
   */
  validate(input: KnowledgeProjectionValidationInput): Promise<KnowledgeProjectionValidationResult>;
}

/** Immutable validated material ready to be placed in a durable journal. */
export interface PreparedChangeSet {
  bundle: KnowledgeBundleConfig;
  changeSet: KnowledgeChangeSet;
  changeSetDigest: string;
  targets: readonly TransactionTarget[];
  validation: KnowledgeValidationSummary;
}

/** Reports deterministic ChangeSet defects that must block every file write. */
export class ChangeSetValidationError extends Error {
  /**
   * Creates a validation failure containing only structured safe diagnostics.
   *
   * @param diagnostics - Deterministic validation issues
   */
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("Knowledge ChangeSet is not safe to apply");
    this.name = "ChangeSetValidationError";
  }
}

/** Reports an unavailable validation dependency without retaining raw errors. */
export class ChangeSetValidationInfrastructureError extends Error {
  /**
   * Creates a sanitized infrastructure failure.
   *
   * @param stage - Validation dependency that could not complete
   */
  constructor(
    public readonly stage: "file_observation" | "artifact_resolution" | "projection_validation"
  ) {
    super(`ChangeSet validation dependency failed during ${stage}`);
    this.name = "ChangeSetValidationInfrastructureError";
  }
}

/**
 * Appends one deterministic validation error.
 *
 * @param diagnostics - Mutable validation collection
 * @param code - Stable machine-readable error code
 * @param field - ChangeSet field associated with the error
 * @param message - Safe human-readable explanation
 */
function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

/**
 * Appends nested diagnostics beneath a stable field prefix.
 *
 * @param target - Destination diagnostic collection
 * @param prefix - Parent field path
 * @param nested - Diagnostics emitted by a nested validator
 */
function appendNestedDiagnostics(
  target: KnowledgeDiagnostic[],
  prefix: string,
  nested: readonly KnowledgeDiagnostic[]
): void {
  for (const diagnostic of nested) {
    target.push({
      ...diagnostic,
      field: diagnostic.field ? `${prefix}.${diagnostic.field}` : prefix,
    });
  }
}

/**
 * Computes the stable identity of an exact accepted ChangeSet payload.
 *
 * @param changeSet - Strictly parsed JSON-compatible ChangeSet
 * @returns Namespaced lowercase SHA-256 digest
 */
export function createKnowledgeChangeSetDigest(changeSet: KnowledgeChangeSet): string {
  return createChangeSetTransactionDigest(changeSet);
}

/**
 * Converts one exact file observation into a journal pre-state.
 *
 * @param observation - Current target observation
 * @returns Missing or content-addressed file state
 */
function toTransactionFileState(observation: KnowledgeFileObservation): TransactionFileState {
  if (observation.kind === "missing") {
    return { kind: "missing" };
  }
  if (observation.kind === "directory") {
    throw new TypeError("Directories cannot be journaled as knowledge file states");
  }
  return {
    kind: "file",
    content: observation.content,
    contentHash: createFileContentHash(observation.content),
  };
}

/**
 * Creates the intended post-state for one typed file change.
 *
 * @param change - Strictly parsed ChangeSet file operation
 * @returns Exact post-state persisted for recovery
 */
function createAfterState(change: KnowledgeFileChange): TransactionFileState {
  if (change.operation === "delete") {
    return { kind: "missing" };
  }
  return { kind: "file", content: change.afterContent, contentHash: change.afterHash };
}

/**
 * Compares deterministic Windows path keys without locale-dependent collation.
 *
 * @param left - First transaction target
 * @param right - Second transaction target
 * @returns Standard sort comparator result
 */
function compareTargets(left: TransactionTarget, right: TransactionTarget): number {
  if (left.windowsPathKey < right.windowsPathKey) {
    return -1;
  }
  if (left.windowsPathKey > right.windowsPathKey) {
    return 1;
  }
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

/**
 * Checks whether every persisted review-time validation flag is affirmative.
 *
 * @param summary - Validation flags stored with the accepted ChangeSet
 * @returns Whether the user accepted a fully valid proposal
 */
function hasAffirmativeDeclaredValidation(summary: KnowledgeValidationSummary): boolean {
  return summary.okfValid && summary.citationsValid && summary.linksValid;
}

/** Deterministic preflight validator for recoverable knowledge writes. */
export class ChangeSetValidator {
  /**
   * Creates a validator with all I/O and semantic dependencies injected.
   *
   * @param fileStore - Exact Vault file observation boundary
   * @param artifactResolver - Parser material used to re-check citations
   * @param projectionValidator - Projected OKF and link validator
   */
  constructor(
    private readonly fileStore: KnowledgeFileStore,
    private readonly artifactResolver: SourceArtifactResolver,
    private readonly projectionValidator: KnowledgeProjectionValidator
  ) {}

  /**
   * Validates an accepted ChangeSet and captures every target pre-state.
   *
   * No journal or Vault mutation occurs in this method. Any deterministic
   * defect is returned as {@link ChangeSetValidationError}; unavailable I/O is
   * reported separately so callers never reinterpret it as model output.
   *
   * @param value - Unknown persisted or model-produced ChangeSet
   * @param bundleValue - Bundle whose Wiki boundary authorizes the write
   * @returns Parsed, revalidated, deterministically ordered journal material
   */
  async prepare(value: unknown, bundleValue: unknown): Promise<PreparedChangeSet> {
    const diagnostics: KnowledgeDiagnostic[] = [];
    const bundleValidation = validateKnowledgeBundleConfig(bundleValue);
    appendNestedDiagnostics(diagnostics, "bundle", bundleValidation.diagnostics);
    const parsedBundle = parseKnowledgeBundleConfig(bundleValue);

    const parsedChangeSet = parseKnowledgeChangeSet(value);
    if (!parsedChangeSet.ok) {
      appendNestedDiagnostics(diagnostics, "changeSet", parsedChangeSet.issues);
    }

    if (!parsedBundle.ok || !parsedChangeSet.ok) {
      throw new ChangeSetValidationError(diagnostics);
    }

    const bundle = parsedBundle.value;
    const changeSet = parsedChangeSet.value;
    const changeSetValidation = validateKnowledgeChangeSet(changeSet, bundle);
    appendNestedDiagnostics(diagnostics, "changeSet", changeSetValidation.diagnostics);

    if (changeSet.status !== "accepted") {
      addError(
        diagnostics,
        "changeset_not_accepted",
        "changeSet.status",
        "Only an explicitly accepted ChangeSet may enter the write journal"
      );
    }
    if (!hasAffirmativeDeclaredValidation(changeSet.validation)) {
      addError(
        diagnostics,
        "changeset_declared_validation_failed",
        "changeSet.validation",
        "An accepted ChangeSet must not retain failed review-time validation flags"
      );
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new ChangeSetValidationError(diagnostics);
    }

    const observations = await this.observeTargets(changeSet);
    const targets = changeSet.changes
      .map((change, index) => this.createTarget(change, observations[index], index, diagnostics))
      .filter((target): target is TransactionTarget => target !== null)
      .sort(compareTargets);

    const citationValid = await this.validateCitations(changeSet, diagnostics);
    const projection = await this.validateProjection(bundle, changeSet, targets);
    appendNestedDiagnostics(diagnostics, "projection", projection.diagnostics);
    if (!projection.okfValid) {
      addError(
        diagnostics,
        "projected_okf_invalid",
        "projection",
        "Projected knowledge files do not satisfy the configured OKF contract"
      );
    }
    if (!projection.linksValid) {
      addError(
        diagnostics,
        "projected_links_invalid",
        "projection",
        "Projected knowledge files contain unresolved or unsafe links"
      );
    }

    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new ChangeSetValidationError(diagnostics);
    }

    return {
      bundle,
      changeSet,
      changeSetDigest: createKnowledgeChangeSetDigest(changeSet),
      targets,
      validation: {
        okfValid: projection.okfValid,
        citationsValid: citationValid,
        linksValid: projection.linksValid,
      },
    };
  }

  /**
   * Reads every target before any semantic adapter is invoked.
   *
   * @param changeSet - Strictly parsed ChangeSet
   * @returns Observations retaining ChangeSet order
   */
  private async observeTargets(changeSet: KnowledgeChangeSet): Promise<KnowledgeFileObservation[]> {
    try {
      return await Promise.all(
        changeSet.changes.map((change) => this.fileStore.observe(change.path))
      );
    } catch {
      throw new ChangeSetValidationInfrastructureError("file_observation");
    }
  }

  /**
   * Validates one observed target against create/update/delete CAS semantics.
   *
   * @param change - Typed file change
   * @param observation - Exact current target state
   * @param index - Change index used by diagnostics
   * @param diagnostics - Mutable validation collection
   * @returns Journal target, or null when preflight fails
   */
  private createTarget(
    change: KnowledgeFileChange,
    observation: KnowledgeFileObservation,
    index: number,
    diagnostics: KnowledgeDiagnostic[]
  ): TransactionTarget | null {
    const field = `changeSet.changes[${index}].path`;
    if (observation.kind === "directory") {
      addError(
        diagnostics,
        "changeset_target_is_directory",
        field,
        "A knowledge file operation cannot target a directory"
      );
      return null;
    }

    if (change.operation === "create") {
      if (observation.kind !== "missing") {
        addError(
          diagnostics,
          "changeset_expected_absent_conflict",
          field,
          "Create target already exists"
        );
        return null;
      }
    } else if (observation.kind === "missing") {
      addError(
        diagnostics,
        "changeset_target_missing",
        field,
        "Update and delete targets must exist during preflight"
      );
      return null;
    } else if (createFileContentHash(observation.content) !== change.beforeHash) {
      addError(
        diagnostics,
        "changeset_before_hash_conflict",
        field,
        "Target content changed after the ChangeSet was prepared"
      );
      return null;
    }

    return {
      changeId: change.id,
      path: change.path,
      windowsPathKey: toWindowsPathKey(change.path),
      operation: change.operation,
      before: toTransactionFileState(observation),
      after: createAfterState(change),
    };
  }

  /**
   * Re-resolves every citation against current parser-owned artifact material.
   *
   * @param changeSet - Strictly parsed ChangeSet
   * @param diagnostics - Mutable validation collection
   * @returns Whether every citation resolved materially
   */
  private async validateCitations(
    changeSet: KnowledgeChangeSet,
    diagnostics: KnowledgeDiagnostic[]
  ): Promise<boolean> {
    let artifacts: (SourceArtifactObservation | null)[];
    try {
      artifacts = await Promise.all(
        changeSet.citations.map((citation) => this.artifactResolver.resolve(citation.locator))
      );
    } catch {
      throw new ChangeSetValidationInfrastructureError("artifact_resolution");
    }

    let valid = true;
    changeSet.citations.forEach((citation, index) => {
      const artifact = artifacts[index];
      if (!artifact) {
        valid = false;
        addError(
          diagnostics,
          "citation_artifact_missing",
          `changeSet.citations[${index}].locator`,
          "Citation artifact is unavailable for material validation"
        );
        return;
      }
      const result = validateSourceLocatorAgainstArtifact(citation.locator, artifact);
      if (!result.valid) {
        valid = false;
      }
      appendNestedDiagnostics(
        diagnostics,
        `changeSet.citations[${index}].locator`,
        result.diagnostics
      );
    });
    return valid;
  }

  /**
   * Invokes the projected OKF and link validator with sanitized failure handling.
   *
   * @param bundle - Validated Bundle boundary
   * @param changeSet - Validated accepted ChangeSet
   * @param targets - Deterministically sorted projected file targets
   * @returns Adapter-computed validation result
   */
  private async validateProjection(
    bundle: KnowledgeBundleConfig,
    changeSet: KnowledgeChangeSet,
    targets: readonly TransactionTarget[]
  ): Promise<KnowledgeProjectionValidationResult> {
    try {
      return await this.projectionValidator.validate({ bundle, changeSet, targets });
    } catch {
      throw new ChangeSetValidationInfrastructureError("projection_validation");
    }
  }
}
