import { createFileContentHash, createQuoteHash } from "@/knowledge/model/fingerprint";
import {
  parseClaimCitation,
  parseKnowledgeBundleConfig,
  parseKnowledgeChangeSet,
  parseKnowledgeFileChange,
  parseKnowledgeIngestJob,
  parseOkfDocument,
  parseSourceLocator,
  parseSourceManifest,
} from "@/knowledge/model/schemas";
import type {
  KnowledgeBundleConfig,
  KnowledgeDiagnostic,
  KnowledgeValidationResult,
} from "@/knowledge/model/types";
import {
  findWindowsPathCollisions,
  isPathWithinRoot,
  parseVaultPath,
  toWindowsPathKey,
} from "@/knowledge/paths/vaultPath";

/**
 * Appends one deterministic error diagnostic.
 *
 * @param diagnostics - Mutable diagnostic collection for the current validator
 * @param code - Stable machine-readable error code
 * @param field - Field path associated with the error
 * @param message - Human-readable explanation
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
 * Creates an aggregate validation result from collected diagnostics.
 *
 * @param diagnostics - Diagnostics emitted by a deterministic validator
 * @returns Validation result whose valid flag rejects every error
 */
function toResult(diagnostics: KnowledgeDiagnostic[]): KnowledgeValidationResult {
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
  };
}

/**
 * Appends nested diagnostics beneath a field prefix.
 *
 * @param target - Destination diagnostic collection
 * @param prefix - Parent field path
 * @param nested - Nested validation result to append
 */
function appendNested(
  target: KnowledgeDiagnostic[],
  prefix: string,
  nested: KnowledgeValidationResult
): void {
  for (const diagnostic of nested.diagnostics) {
    target.push({
      ...diagnostic,
      field: diagnostic.field ? `${prefix}.${diagnostic.field}` : prefix,
    });
  }
}

/**
 * Checks whether two valid Vault paths overlap as equal or ancestor/descendant paths.
 *
 * @param left - First Vault-relative path
 * @param right - Second Vault-relative path
 * @returns Whether the paths overlap under Windows comparison rules
 */
function pathsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

/**
 * Validates a canonical Vault-relative path for the Windows-only product target.
 *
 * @param value - Runtime path value
 * @param field - Field path used by diagnostics
 * @returns Structured deterministic validation result
 */
export function validateVaultRelativePath(
  value: unknown,
  field = "path"
): KnowledgeValidationResult {
  const parsed = parseVaultPath(value);
  if (parsed.ok) {
    return toResult([]);
  }

  return toResult(
    parsed.issues.map((issue) => ({
      code: issue.code,
      severity: "error" as const,
      field: issue.segmentIndex === undefined ? field : `${field}.segments[${issue.segmentIndex}]`,
      message: issue.message,
    }))
  );
}

/**
 * Validates a knowledge bundle configuration and its non-overlapping write boundary.
 *
 * @param value - Runtime value expected to contain a bundle configuration
 * @returns Structured deterministic validation result
 */
export function validateKnowledgeBundleConfig(value: unknown): KnowledgeValidationResult {
  const parsed = parseKnowledgeBundleConfig(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const bundle = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];
  bundle.sourceRoots.forEach((root, index) => {
    appendNested(diagnostics, `sourceRoots[${index}]`, validateVaultRelativePath(root, ""));
  });
  appendNested(diagnostics, "wikiRoot", validateVaultRelativePath(bundle.wikiRoot, ""));
  appendNested(diagnostics, "schemaRef", validateVaultRelativePath(bundle.schemaRef, ""));

  const seenRoots = new Set<string>();
  bundle.sourceRoots.forEach((root, index) => {
    const sourceKey = toWindowsPathKey(root);
    if (seenRoots.has(sourceKey)) {
      addError(
        diagnostics,
        "source_root_duplicate",
        `sourceRoots[${index}]`,
        "Source roots must be unique on a case-insensitive Windows filesystem"
      );
    }
    seenRoots.add(sourceKey);

    if (pathsOverlap(root, bundle.wikiRoot)) {
      addError(
        diagnostics,
        "source_wiki_overlap",
        `sourceRoots[${index}]`,
        "Source roots and the generated Wiki root must not overlap"
      );
    }
  });

  if (isPathWithinRoot(bundle.schemaRef, bundle.wikiRoot)) {
    addError(
      diagnostics,
      "schema_inside_wiki",
      "schemaRef",
      "The Bundle schema cannot live inside the generated Wiki write boundary"
    );
  }

  return toResult(diagnostics);
}

/**
 * Validates a source manifest and its stable Windows source identities.
 *
 * @param value - Runtime value expected to contain a source manifest
 * @returns Structured deterministic validation result
 */
export function validateSourceManifest(value: unknown): KnowledgeValidationResult {
  const parsed = parseSourceManifest(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const diagnostics: KnowledgeDiagnostic[] = [];
  const sourceIds = new Set<string>();
  const sourceKeys = new Set<string>();
  parsed.value.entries.forEach((entry, index) => {
    const prefix = `entries[${index}]`;
    appendNested(
      diagnostics,
      `${prefix}.sourcePath`,
      validateVaultRelativePath(entry.sourcePath, "")
    );
    const expectedSourceKey = toWindowsPathKey(entry.sourcePath);
    if (entry.sourceKey !== expectedSourceKey) {
      addError(
        diagnostics,
        "source_key_mismatch",
        `${prefix}.sourceKey`,
        "Source key must match the normalized Windows key for sourcePath"
      );
    }
    if (sourceIds.has(entry.sourceId)) {
      addError(
        diagnostics,
        "source_id_duplicate",
        `${prefix}.sourceId`,
        "Source ids must be unique within a manifest"
      );
    }
    if (sourceKeys.has(entry.sourceKey)) {
      addError(
        diagnostics,
        "source_key_duplicate",
        `${prefix}.sourceKey`,
        "Source paths must be unique on a case-insensitive Windows filesystem"
      );
    }
    sourceIds.add(entry.sourceId);
    sourceKeys.add(entry.sourceKey);

    entry.lastSuccessful?.generatedPages.forEach((page, pageIndex) => {
      appendNested(
        diagnostics,
        `${prefix}.lastSuccessful.generatedPages[${pageIndex}].path`,
        validateVaultRelativePath(page.path, "")
      );
    });
  });

  return toResult(diagnostics);
}

/**
 * Validates a source locator, including its excerpt hash and coordinate ordering.
 *
 * @param value - Runtime value expected to contain a source locator
 * @returns Structured deterministic validation result
 */
export function validateSourceLocator(value: unknown): KnowledgeValidationResult {
  const parsed = parseSourceLocator(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const locator = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];
  if (createQuoteHash(locator.excerpt) !== locator.quoteHash) {
    addError(
      diagnostics,
      "quote_hash_mismatch",
      "quoteHash",
      "Quote hash does not match the normalized citation excerpt"
    );
  }
  if (locator.kind === "markdown_lines" && locator.startLine > locator.endLine) {
    addError(
      diagnostics,
      "locator_line_order_invalid",
      "endLine",
      "Markdown end line cannot precede start line"
    );
  }
  return toResult(diagnostics);
}

/**
 * Validates one claim citation and its nested source locator.
 *
 * @param value - Runtime value expected to contain a claim citation
 * @returns Structured deterministic validation result
 */
export function validateClaimCitation(value: unknown): KnowledgeValidationResult {
  const parsed = parseClaimCitation(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const diagnostics: KnowledgeDiagnostic[] = [];
  appendNested(diagnostics, "locator", validateSourceLocator(parsed.value.locator));
  return toResult(diagnostics);
}

/**
 * Validates one create, update, or delete file change and its compare-and-swap hashes.
 *
 * @param value - Runtime value expected to contain a file change
 * @returns Structured deterministic validation result
 */
export function validateKnowledgeFileChange(value: unknown): KnowledgeValidationResult {
  const parsed = parseKnowledgeFileChange(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const change = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];
  appendNested(diagnostics, "path", validateVaultRelativePath(change.path, ""));
  if (
    change.operation !== "delete" &&
    createFileContentHash(change.afterContent) !== change.afterHash
  ) {
    addError(
      diagnostics,
      "after_hash_mismatch",
      "afterHash",
      "After hash does not match proposed file content"
    );
  }
  return toResult(diagnostics);
}

/**
 * Validates a complete user-reviewable knowledge ChangeSet.
 *
 * @param value - Runtime value expected to contain a ChangeSet
 * @param bundle - Optional Bundle boundary for pre-review target enforcement
 * @returns Structured deterministic validation result
 */
export function validateKnowledgeChangeSet(
  value: unknown,
  bundle?: KnowledgeBundleConfig
): KnowledgeValidationResult {
  const parsed = parseKnowledgeChangeSet(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const changeSet = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];
  const sourceRefs = new Set(changeSet.sourceRefs);
  if (sourceRefs.size !== changeSet.sourceRefs.length) {
    addError(
      diagnostics,
      "source_ref_duplicate",
      "sourceRefs",
      "ChangeSet source references must be unique"
    );
  }

  const changeIds = new Set<string>();
  changeSet.changes.forEach((change, index) => {
    appendNested(diagnostics, `changes[${index}]`, validateKnowledgeFileChange(change));
    if (changeIds.has(change.id)) {
      addError(
        diagnostics,
        "change_id_duplicate",
        `changes[${index}].id`,
        "File change ids must be unique within a ChangeSet"
      );
    }
    changeIds.add(change.id);
    change.sourceRefs.forEach((sourceRef, sourceIndex) => {
      if (!sourceRefs.has(sourceRef)) {
        addError(
          diagnostics,
          "change_source_ref_unknown",
          `changes[${index}].sourceRefs[${sourceIndex}]`,
          "File change source reference must be declared by the ChangeSet"
        );
      }
    });

    if (bundle && !isPathWithinRoot(change.path, bundle.wikiRoot)) {
      addError(
        diagnostics,
        "change_path_outside_wiki",
        `changes[${index}].path`,
        "Knowledge changes must remain inside the generated Wiki root"
      );
    }
    if (bundle?.sourceRoots.some((root) => isPathWithinRoot(change.path, root))) {
      addError(
        diagnostics,
        "change_path_inside_source",
        `changes[${index}].path`,
        "Knowledge changes cannot target a raw source root"
      );
    }
  });

  const collisions = findWindowsPathCollisions(changeSet.changes.map((change) => change.path));
  for (const collision of collisions) {
    addError(
      diagnostics,
      "change_path_duplicate",
      "changes",
      `A ChangeSet cannot target Windows path '${collision.key}' more than once`
    );
  }

  const citationIds = new Set<string>();
  changeSet.citations.forEach((citation, index) => {
    appendNested(diagnostics, `citations[${index}]`, validateClaimCitation(citation));
    if (citationIds.has(citation.citationId)) {
      addError(
        diagnostics,
        "citation_id_duplicate",
        `citations[${index}].citationId`,
        "Citation ids must be unique within a ChangeSet"
      );
    }
    citationIds.add(citation.citationId);
    if (!sourceRefs.has(citation.locator.sourceId)) {
      addError(
        diagnostics,
        "citation_source_ref_unknown",
        `citations[${index}].locator.sourceId`,
        "Citation source must be declared by the ChangeSet"
      );
    }
  });

  return toResult(diagnostics);
}

/**
 * Validates a durable ingest job after strict state-shape parsing.
 *
 * @param value - Runtime value expected to contain an ingest job
 * @returns Structured deterministic validation result
 */
export function validateKnowledgeIngestJob(value: unknown): KnowledgeValidationResult {
  const parsed = parseKnowledgeIngestJob(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const job = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];
  if (job.updatedAt < job.createdAt) {
    addError(
      diagnostics,
      "job_timestamp_order_invalid",
      "updatedAt",
      "Job updatedAt cannot precede createdAt"
    );
  }
  const requiresCompletedAttempt =
    job.status === "processing" ||
    job.status === "paused" ||
    job.status === "awaiting_review" ||
    job.status === "failed" ||
    job.status === "completed" ||
    (job.status === "pending" && job.nextAttemptAt !== undefined);
  if (requiresCompletedAttempt && job.attempt === 0) {
    addError(
      diagnostics,
      "job_attempt_invalid",
      "attempt",
      "This durable job state requires at least one claimed execution"
    );
  }
  if (
    job.status === "processing" &&
    (job.startedAt < job.createdAt || job.startedAt > job.updatedAt)
  ) {
    addError(
      diagnostics,
      "job_started_timestamp_invalid",
      "startedAt",
      "Job startedAt must fall between createdAt and updatedAt"
    );
  }
  if (job.status === "paused" && (job.pausedAt < job.createdAt || job.pausedAt > job.updatedAt)) {
    addError(
      diagnostics,
      "job_paused_timestamp_invalid",
      "pausedAt",
      "Job pausedAt must fall between createdAt and updatedAt"
    );
  }
  if (
    job.status === "failed" &&
    (job.failure.occurredAt < job.createdAt || job.failure.occurredAt > job.updatedAt)
  ) {
    addError(
      diagnostics,
      "job_failure_timestamp_invalid",
      "failure.occurredAt",
      "Job failure time must fall between createdAt and updatedAt"
    );
  }
  if (
    job.status === "completed" &&
    (job.completedAt < job.createdAt || job.completedAt > job.updatedAt)
  ) {
    addError(
      diagnostics,
      "job_completed_timestamp_invalid",
      "completedAt",
      "Job completedAt must fall between createdAt and updatedAt"
    );
  }
  if (
    job.status === "cancelled" &&
    (job.cancelledAt < job.createdAt || job.cancelledAt > job.updatedAt)
  ) {
    addError(
      diagnostics,
      "job_cancelled_timestamp_invalid",
      "cancelledAt",
      "Job cancelledAt must fall between createdAt and updatedAt"
    );
  }
  return toResult(diagnostics);
}

/**
 * Validates the semantic contract of an OKF-compatible Markdown document.
 *
 * @param value - Runtime value expected to contain an OKF document
 * @returns Structured deterministic validation result
 */
export function validateOkfDocument(value: unknown): KnowledgeValidationResult {
  const parsed = parseOkfDocument(value);
  if (!parsed.ok) {
    return toResult(parsed.issues);
  }

  const document = parsed.value;
  const diagnostics: KnowledgeDiagnostic[] = [];
  appendNested(diagnostics, "path", validateVaultRelativePath(document.path, ""));
  const pathKey = toWindowsPathKey(document.path);
  const basename = pathKey.split("/").pop();

  if (document.kind === "concept") {
    if (basename === "index.md" || basename === "log.md") {
      addError(
        diagnostics,
        "okf_reserved_path",
        "path",
        "Reserved index.md and log.md paths cannot be concept documents"
      );
    }
    if (!pathKey.endsWith(".md")) {
      addError(diagnostics, "okf_extension_invalid", "path", "OKF concepts must be Markdown files");
    }
    document.citations.forEach((citation, index) => {
      appendNested(diagnostics, `citations[${index}]`, validateClaimCitation(citation));
    });
  } else if (document.kind === "index") {
    if (basename !== "index.md") {
      addError(
        diagnostics,
        "okf_index_path_invalid",
        "path",
        "Index document must be named index.md"
      );
    }
    if (document.okfVersion !== undefined && pathKey !== "index.md") {
      addError(
        diagnostics,
        "okf_version_invalid",
        "okfVersion",
        "Only the Bundle root index.md may declare the OKF version"
      );
    }
  } else if (basename !== "log.md") {
    addError(diagnostics, "okf_log_path_invalid", "path", "Log document must be named log.md");
  }

  return toResult(diagnostics);
}
