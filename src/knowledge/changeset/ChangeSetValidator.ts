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

export type KnowledgeFileObservation =
  | { kind: "missing" }
  | { kind: "file"; content: string }
  | { kind: "directory" };

export type KnowledgeFileCompareAndSwapResult =
  | { kind: "applied" }
  | { kind: "already_after" }
  | { kind: "conflict"; observation: KnowledgeFileObservation };

export interface KnowledgeFileMutationCapabilities {
  create: boolean;
  update: boolean;
  delete: boolean;

  requiresExistingParentForCreate: boolean;
}

export const ALL_KNOWLEDGE_FILE_MUTATIONS: Readonly<KnowledgeFileMutationCapabilities> =
  Object.freeze({
    create: true,
    update: true,
    delete: true,
    requiresExistingParentForCreate: false,
  });

export interface KnowledgeFileStore {
  readonly mutationCapabilities: Readonly<KnowledgeFileMutationCapabilities>;

  observe(path: string): Promise<KnowledgeFileObservation>;

  compareAndSwap(
    path: string,
    before: TransactionFileState,
    after: TransactionFileState
  ): Promise<KnowledgeFileCompareAndSwapResult>;
}

export interface SourceArtifactResolver {
  resolve(locator: SourceLocator): Promise<SourceArtifactObservation | null>;
}

export interface KnowledgeProjectionValidationInput {
  bundle: KnowledgeBundleConfig;
  changeSet: KnowledgeChangeSet;
  targets: readonly TransactionTarget[];
}

export interface KnowledgeProjectionValidationResult {
  okfValid: boolean;
  linksValid: boolean;
  diagnostics: readonly KnowledgeDiagnostic[];
}

export interface KnowledgeProjectionValidator {
  validate(input: KnowledgeProjectionValidationInput): Promise<KnowledgeProjectionValidationResult>;
}

export interface PreparedChangeSet {
  bundle: KnowledgeBundleConfig;
  changeSet: KnowledgeChangeSet;
  changeSetDigest: string;
  targets: readonly TransactionTarget[];
  validation: KnowledgeValidationSummary;
}

export interface ValidatedChangeSetInput {
  bundle: KnowledgeBundleConfig;
  changeSet: KnowledgeChangeSet;
  changeSetDigest: string;
}

export class ChangeSetValidationError extends Error {
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("Knowledge ChangeSet is not safe to apply");
    this.name = "ChangeSetValidationError";
  }
}

export class ChangeSetValidationInfrastructureError extends Error {
  constructor(
    public readonly stage: "file_observation" | "artifact_resolution" | "projection_validation"
  ) {
    super(`ChangeSet validation dependency failed during ${stage}`);
    this.name = "ChangeSetValidationInfrastructureError";
  }
}

function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

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

export function createKnowledgeChangeSetDigest(changeSet: KnowledgeChangeSet): string {
  return createChangeSetTransactionDigest(changeSet);
}

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

function createAfterState(change: KnowledgeFileChange): TransactionFileState {
  if (change.operation === "delete") {
    return { kind: "missing" };
  }
  return { kind: "file", content: change.afterContent, contentHash: change.afterHash };
}

function compareTargets(left: TransactionTarget, right: TransactionTarget): number {
  if (left.windowsPathKey < right.windowsPathKey) {
    return -1;
  }
  if (left.windowsPathKey > right.windowsPathKey) {
    return 1;
  }
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function getTargetParentPath(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex < 1) {
    throw new TypeError("Knowledge target must have a Vault-relative parent");
  }
  return path.slice(0, separatorIndex);
}

function hasAffirmativeDeclaredValidation(summary: KnowledgeValidationSummary): boolean {
  return summary.okfValid && summary.citationsValid && summary.linksValid;
}

export class ChangeSetValidator {
  private readonly mutationCapabilities: Readonly<KnowledgeFileMutationCapabilities>;

  constructor(
    private readonly fileStore: KnowledgeFileStore,
    private readonly artifactResolver: SourceArtifactResolver,
    private readonly projectionValidator: KnowledgeProjectionValidator
  ) {
    const mutationCapabilities = fileStore.mutationCapabilities;
    if (
      typeof mutationCapabilities !== "object" ||
      mutationCapabilities === null ||
      typeof mutationCapabilities.create !== "boolean" ||
      typeof mutationCapabilities.update !== "boolean" ||
      typeof mutationCapabilities.delete !== "boolean" ||
      typeof mutationCapabilities.requiresExistingParentForCreate !== "boolean"
    ) {
      throw new TypeError("mutationCapabilities must declare every file operation");
    }
    this.mutationCapabilities = Object.freeze({ ...mutationCapabilities });
  }

  validateAcceptedInput(value: unknown, bundleValue: unknown): ValidatedChangeSetInput {
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
    this.validateMutationCapabilities(changeSet, diagnostics);
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new ChangeSetValidationError(diagnostics);
    }

    return {
      bundle,
      changeSet,
      changeSetDigest: createKnowledgeChangeSetDigest(changeSet),
    };
  }

  async prepare(value: unknown, bundleValue: unknown): Promise<PreparedChangeSet> {
    const diagnostics: KnowledgeDiagnostic[] = [];
    const validated = this.validateAcceptedInput(value, bundleValue);
    const { bundle, changeSet } = validated;

    const observations = await this.observeTargets(changeSet);
    const parentObservations = await this.observeCreateParents(changeSet, observations);
    const targets = changeSet.changes
      .map((change, index) => this.createTarget(change, observations[index], index, diagnostics))
      .filter((target): target is TransactionTarget => target !== null)
      .sort(compareTargets);
    this.validateCreateParents(changeSet, parentObservations, diagnostics);

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
      changeSetDigest: validated.changeSetDigest,
      targets,
      validation: {
        okfValid: projection.okfValid,
        citationsValid: citationValid,
        linksValid: projection.linksValid,
      },
    };
  }

  private validateMutationCapabilities(
    changeSet: KnowledgeChangeSet,
    diagnostics: KnowledgeDiagnostic[]
  ): void {
    changeSet.changes.forEach((change, index) => {
      if (this.mutationCapabilities[change.operation]) {
        return;
      }
      addError(
        diagnostics,
        "changeset_operation_unsupported",
        `changeSet.changes[${index}].operation`,
        "The active Vault adapter cannot apply this file operation atomically"
      );
    });
  }

  private async observeTargets(changeSet: KnowledgeChangeSet): Promise<KnowledgeFileObservation[]> {
    try {
      return await Promise.all(
        changeSet.changes.map((change) => this.fileStore.observe(change.path))
      );
    } catch {
      throw new ChangeSetValidationInfrastructureError("file_observation");
    }
  }

  private async observeCreateParents(
    changeSet: KnowledgeChangeSet,
    targetObservations: readonly KnowledgeFileObservation[]
  ): Promise<Array<KnowledgeFileObservation | undefined>> {
    if (!this.mutationCapabilities.requiresExistingParentForCreate) {
      return changeSet.changes.map(() => undefined);
    }
    try {
      return await Promise.all(
        changeSet.changes.map((change, index) =>
          change.operation === "create" && targetObservations[index]?.kind === "missing"
            ? this.fileStore.observe(getTargetParentPath(change.path))
            : Promise.resolve(undefined)
        )
      );
    } catch {
      throw new ChangeSetValidationInfrastructureError("file_observation");
    }
  }

  private validateCreateParents(
    changeSet: KnowledgeChangeSet,
    observations: readonly (KnowledgeFileObservation | undefined)[],
    diagnostics: KnowledgeDiagnostic[]
  ): void {
    changeSet.changes.forEach((change, index) => {
      if (change.operation !== "create") return;
      const observation = observations[index];
      if (!observation || observation.kind === "directory") return;
      const field = `changeSet.changes[${index}].path`;
      if (observation.kind === "missing") {
        addError(
          diagnostics,
          "changeset_create_parent_missing",
          field,
          "Create target requires an existing parent directory"
        );
        return;
      }
      addError(
        diagnostics,
        "changeset_create_parent_not_directory",
        field,
        "Create target parent must be a directory"
      );
    });
  }

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
