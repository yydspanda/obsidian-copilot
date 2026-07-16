/** Current version of the persisted knowledge contracts. */
export const KNOWLEDGE_CONTRACT_VERSION = 1 as const;

/** Current OKF version emitted and accepted by the first knowledge adapter. */
export const SUPPORTED_OKF_VERSION = "0.1" as const;

/** JSON primitive accepted by persisted knowledge metadata. */
export type JsonPrimitive = string | number | boolean | null;

/** Recursive JSON value accepted by persisted knowledge metadata. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Controls when generated knowledge changes require user review. */
export type KnowledgeReviewMode = "always" | "multi_file" | "trusted_generated_only";

/** Identifies a user-configured knowledge bundle and its write boundary. */
export interface KnowledgeBundleConfig {
  version: typeof KNOWLEDGE_CONTRACT_VERSION;
  id: string;
  sourceRoots: string[];
  wikiRoot: string;
  schemaRef: string;
  reviewMode: KnowledgeReviewMode;
}

/** Serializable failure information safe to persist and render. */
export interface KnowledgeFailure {
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: number;
}

/** Describes who owns the lifecycle of a generated page. */
export type GeneratedPageOwnership = "generated" | "shared" | "user";

/** Records one page produced or affected by an ingested source. */
export interface GeneratedPageReference {
  path: string;
  ownership: GeneratedPageOwnership;
  contentHash?: string;
}

/** Last successfully committed compile state of one source. */
export interface SourceCompileSnapshot {
  sourceContentHash: string;
  pipelineFingerprint: string;
  generatedPages: GeneratedPageReference[];
  changeSetId: string;
  completedAt: number;
}

/** Most recent failed compile attempt, kept without replacing a committed snapshot. */
export interface SourceCompileFailure {
  sourceContentHash: string;
  pipelineFingerprint: string;
  failure: KnowledgeFailure;
}

/** Defines whether a source remains user-owned or is copied into managed storage. */
export type SourceCustody = "user_managed" | "managed_copy";

/** Records durable source identity without duplicating transient queue state. */
export interface SourceManifestEntry {
  sourceId: string;
  sourceKey: string;
  sourcePath: string;
  custody: SourceCustody;
  lastSuccessful?: SourceCompileSnapshot;
  lastFailure?: SourceCompileFailure;
  extensions?: Record<string, JsonValue>;
}

/** Versioned manifest for all sources in a knowledge bundle. */
export interface SourceManifest {
  version: typeof KNOWLEDGE_CONTRACT_VERSION;
  bundleId: string;
  revision: number;
  entries: SourceManifestEntry[];
  extensions?: Record<string, JsonValue>;
}

/** Fields shared by every source locator. */
export interface SourceLocatorBase {
  sourceId: string;
  artifactId: string;
  artifactContentHash: string;
  excerpt: string;
  quoteHash: string;
}

/** Precise, source-backed location used by Wiki claims and model answers. */
export type SourceLocator =
  | (SourceLocatorBase & {
      kind: "markdown_lines";
      startLine: number;
      endLine: number;
      heading?: string;
    })
  | (SourceLocatorBase & {
      kind: "heading";
      heading: string;
      occurrence: number;
    })
  | (SourceLocatorBase & { kind: "pdf_page"; page: number })
  | (SourceLocatorBase & { kind: "quote"; prefix?: string; suffix?: string });

/** Expresses how one source location relates to a generated claim. */
export interface ClaimCitation {
  citationId: string;
  claimId: string;
  relation: "supports" | "contradicts" | "context";
  locator: SourceLocator;
}

/** Common fields persisted for every OKF-compatible Markdown document. */
export interface OkfDocumentBase {
  path: string;
  body: string;
}

/** Regular OKF concept document with extensible frontmatter. */
export interface OkfConceptDocument extends OkfDocumentBase {
  kind: "concept";
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  extensions: Record<string, JsonValue>;
  citations: ClaimCitation[];
}

/** Reserved OKF index document. Only the bundle root may declare okfVersion. */
export interface OkfIndexDocument extends OkfDocumentBase {
  kind: "index";
  okfVersion?: typeof SUPPORTED_OKF_VERSION;
}

/** Reserved append-oriented OKF log document. */
export interface OkfLogDocument extends OkfDocumentBase {
  kind: "log";
}

/** Any Markdown document understood by the OKF adapter. */
export type OkfDocument = OkfConceptDocument | OkfIndexDocument | OkfLogDocument;

/** Work stage that may execute code or invoke a model. */
export type KnowledgeIngestWorkStage =
  | "parsing"
  | "analyzing"
  | "associating"
  | "generating"
  | "validating"
  | "applying";

/** Fields common to every durable ingest job state. */
export interface KnowledgeIngestJobBase {
  id: string;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
  attempt: number;
  rerunRequested: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Durable job state that prevents impossible stage/status combinations. */
export type KnowledgeIngestJob = KnowledgeIngestJobBase &
  (
    | { status: "pending"; stage: "queued"; nextAttemptAt?: number }
    | {
        status: "processing";
        stage: KnowledgeIngestWorkStage;
        startedAt: number;
      }
    | {
        status: "paused";
        stage: Exclude<KnowledgeIngestWorkStage, "applying">;
        pausedAt: number;
        reason?: string;
      }
    | {
        status: "awaiting_review";
        stage: "review";
        changeSetId: string;
      }
    | {
        status: "failed";
        stage: "queued" | KnowledgeIngestWorkStage | "review";
        failure: KnowledgeFailure;
      }
    | {
        status: "completed";
        stage: "completed";
        changeSetId: string;
        completedAt: number;
      }
    | { status: "cancelled"; stage: "cancelled"; cancelledAt: number }
  );

/** Fields shared by all proposed file changes. */
export interface KnowledgeFileChangeBase {
  id: string;
  path: string;
  sourceRefs: string[];
  reason: string;
}

/** File change proposed by a knowledge operation. */
export type KnowledgeFileChange = KnowledgeFileChangeBase &
  (
    | {
        operation: "create";
        expectedAbsent: true;
        afterContent: string;
        afterHash: string;
      }
    | {
        operation: "update";
        beforeHash: string;
        afterContent: string;
        afterHash: string;
      }
    | { operation: "delete"; beforeHash: string }
  );

/** Deterministic validation summary computed before applying a ChangeSet. */
export interface KnowledgeValidationSummary {
  okfValid: boolean;
  citationsValid: boolean;
  linksValid: boolean;
}

/** User-reviewable set of knowledge file changes. */
export interface KnowledgeChangeSet {
  id: string;
  bundleId: string;
  operation: "ingest" | "query_writeback" | "lint_fix";
  sourceRefs: string[];
  changes: KnowledgeFileChange[];
  citations: ClaimCitation[];
  validation: KnowledgeValidationSummary;
  status: "proposed" | "accepted" | "rejected" | "applied" | "failed";
  createdAt: number;
}

/** Severity of a deterministic knowledge validation diagnostic. */
export type KnowledgeDiagnosticSeverity = "error" | "warning";

/** Structured validation issue suitable for tests and future UI rendering. */
export interface KnowledgeDiagnostic {
  code: string;
  severity: KnowledgeDiagnosticSeverity;
  field: string;
  message: string;
}

/** Aggregate result returned by deterministic knowledge validators. */
export interface KnowledgeValidationResult {
  valid: boolean;
  diagnostics: KnowledgeDiagnostic[];
}

/** Public parse result that does not expose the validation library. */
export type KnowledgeParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: KnowledgeDiagnostic[] };

/** Input that fully identifies the behavior of the ingest pipeline. */
export interface PipelineFingerprintInput {
  version: typeof KNOWLEDGE_CONTRACT_VERSION;
  contractVersion: number;
  compilerVersion: string;
  parser: {
    id: string;
    version: string;
    configuration: JsonValue;
  };
  schemaHash: string;
  model: {
    provider: string;
    model: string;
    configuration: JsonValue;
  };
  outputLanguage: string;
  okfVersion: string;
  citationContractVersion: number;
}

/** One observed generated output used to decide whether a source is fresh. */
export interface OutputObservation {
  path: string;
  exists: boolean;
}

/** Stable reasons a source must be ingested again. */
export type SourceStaleReason =
  | "never_ingested"
  | "source_changed"
  | "pipeline_changed"
  | "output_missing";

/** Deterministic freshness result for a source and its generated pages. */
export type SourceFreshnessDecision =
  | { kind: "up_to_date" }
  | { kind: "needs_ingest"; reasons: SourceStaleReason[] };
