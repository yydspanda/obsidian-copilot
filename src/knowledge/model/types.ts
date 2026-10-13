export const KNOWLEDGE_CONTRACT_VERSION = 1 as const;

export const SUPPORTED_OKF_VERSION = "0.1" as const;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type KnowledgeReviewMode = "always" | "multi_file" | "trusted_generated_only";

export interface KnowledgeBundleConfig {
  version: typeof KNOWLEDGE_CONTRACT_VERSION;
  id: string;
  sourceRoots: string[];
  wikiRoot: string;
  schemaRef: string;
  reviewMode: KnowledgeReviewMode;
}

export interface KnowledgeFailure {
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: number;
}

export type GeneratedPageOwnership = "generated" | "shared" | "user";

export interface GeneratedPageReference {
  path: string;
  ownership: GeneratedPageOwnership;
  contentHash?: string;
}

export interface SourceCompileSnapshot {
  sourceContentHash: string;
  pipelineFingerprint: string;
  generatedPages: GeneratedPageReference[];
  changeSetId: string;
  completedAt: number;
}

export interface SourceCompileFailure {
  sourceContentHash: string;
  pipelineFingerprint: string;
  failure: KnowledgeFailure;
}

export type SourceCustody = "user_managed" | "managed_copy";

export interface SourceManifestEntry {
  sourceId: string;
  sourceKey: string;
  sourcePath: string;
  custody: SourceCustody;
  lastSuccessful?: SourceCompileSnapshot;
  lastFailure?: SourceCompileFailure;
  extensions?: Record<string, JsonValue>;
}

export interface SourceManifest {
  version: typeof KNOWLEDGE_CONTRACT_VERSION;
  bundleId: string;
  revision: number;
  entries: SourceManifestEntry[];
  extensions?: Record<string, JsonValue>;
}

export interface SourceLocatorBase {
  sourceId: string;
  artifactId: string;
  artifactContentHash: string;
  excerpt: string;
  quoteHash: string;
}

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

export interface ClaimCitation {
  citationId: string;
  claimId: string;
  relation: "supports" | "contradicts" | "context";
  locator: SourceLocator;
}

export interface OkfDocumentBase {
  path: string;
  body: string;
}

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

export interface OkfIndexDocument extends OkfDocumentBase {
  kind: "index";
  okfVersion?: typeof SUPPORTED_OKF_VERSION;
}

export interface OkfLogDocument extends OkfDocumentBase {
  kind: "log";
}

export type OkfDocument = OkfConceptDocument | OkfIndexDocument | OkfLogDocument;

export type KnowledgeIngestWorkStage =
  | "parsing"
  | "analyzing"
  | "associating"
  | "generating"
  | "validating"
  | "applying";

export interface KnowledgeIngestJobBase {
  id: string;
  bundleId: string;
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;

  inputRevision: number;
  attempt: number;
  rerunRequested: boolean;
  createdAt: number;
  updatedAt: number;
}

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

export interface KnowledgeFileChangeBase {
  id: string;
  path: string;
  sourceRefs: string[];
  reason: string;
}

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

export interface KnowledgeValidationSummary {
  okfValid: boolean;
  citationsValid: boolean;
  linksValid: boolean;
}

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

export type KnowledgeDiagnosticSeverity = "error" | "warning";

export interface KnowledgeDiagnostic {
  code: string;
  severity: KnowledgeDiagnosticSeverity;
  field: string;
  message: string;
}

export interface KnowledgeValidationResult {
  valid: boolean;
  diagnostics: KnowledgeDiagnostic[];
}

export type KnowledgeParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: KnowledgeDiagnostic[] };

export interface PipelineFingerprintInput {
  version: typeof KNOWLEDGE_CONTRACT_VERSION;
  contractVersion: number;
  compilerVersion: string;
  compilerConfiguration: JsonValue;
  bundleConfigDigest: string;
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

export type OutputObservation =
  | { path: string; kind: "file"; contentHash: string }
  | { path: string; kind: "missing" | "directory" };

export type SourceStaleReason =
  | "never_ingested"
  | "source_changed"
  | "pipeline_changed"
  | "output_missing"
  | "output_changed"
  | "output_unverifiable";

export type SourceFreshnessDecision =
  | { kind: "up_to_date" }
  | { kind: "needs_ingest"; reasons: SourceStaleReason[] };
