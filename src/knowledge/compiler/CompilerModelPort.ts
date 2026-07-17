import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type {
  ClaimCitation,
  GeneratedPageOwnership,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeValidationSummary,
  SourceLocator,
} from "@/knowledge/model/types";

/** Current protocol version shared by both knowledge compiler model stages. */
export const KNOWLEDGE_COMPILER_PROTOCOL_VERSION = 1 as const;

/** Exact queue-owned identity of the primary source being compiled. */
export interface CompilerSourceIdentity {
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;
}

/** Immutable schema material supplied by the Bundle adapter. */
export interface CompilerSchemaSnapshot {
  path: string;
  content: string;
  contentHash: string;
}

/** Read-only Wiki page selected as association context before compilation. */
export interface CompilerContextPage {
  path: string;
  content: string;
  contentHash: string;
}

/** Trusted, parser-produced evidence that the model may reference by opaque id. */
export interface CompilerEvidence {
  evidenceId: string;
  locator: SourceLocator;
}

/** Caller-owned manifest authority for reading or changing one known Wiki path. */
export interface CompilerTargetAuthorization {
  path: string;
  allowedIntents: ("write" | "delete")[];
  contentPolicy: "grounded" | "structural";
  ownership: GeneratedPageOwnership;
  sourceRefs: string[];
  expectedContentHash?: string;
}

/** Minimal model-visible projection of caller-owned target authority. */
export interface CompilerModelTargetAuthorization {
  path: string;
  allowedIntents: ("write" | "delete")[];
  contentPolicy: "grounded" | "structural";
}

/**
 * Complete deterministic input to one two-stage compilation attempt.
 *
 * Artifact observations are parser-owned trusted inputs: their declared hash
 * identifies the parser artifact, while the core separately digests the exact
 * parsed material so stale or changed text cannot retain a compile identity.
 */
export interface KnowledgeCompileInput {
  bundle: KnowledgeBundleConfig;
  operation: KnowledgeChangeSet["operation"];
  source: CompilerSourceIdentity;
  schema: CompilerSchemaSnapshot;
  artifacts: SourceArtifactObservation[];
  evidence: CompilerEvidence[];
  contextPages: CompilerContextPage[];
  targetAuthorizations: CompilerTargetAuthorization[];
  createdAt: number;
}

/** Stable normalized concept discovered during analysis. */
export interface CompilerConcept {
  id: string;
  name: string;
  description?: string;
}

/** Stable normalized entity discovered during analysis. */
export interface CompilerEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
}

/** Stable normalized, source-backed claim discovered during analysis. */
export interface CompilerClaim {
  id: string;
  text: string;
}

/** Stable normalized relation between concepts, entities, or claims. */
export interface CompilerRelation {
  id: string;
  fromId: string;
  toId: string;
  type: string;
}

/** Runtime-approved target intent from the first model stage. */
export interface CompilerApprovedTarget {
  targetId: string;
  path: string;
  intent: "write" | "delete";
  reason: string;
  claimIds: string[];
  sourceRefs: string[];
  access: "authorized" | "create_only";
  contentPolicy: "grounded" | "structural";
  ownership: GeneratedPageOwnership | "new";
  expectedContentHash?: string;
}

/** Canonical first-stage result passed to generation and future review UI. */
export interface CompilerAnalysis {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  summary: string;
  concepts: CompilerConcept[];
  entities: CompilerEntity[];
  claims: CompilerClaim[];
  relations: CompilerRelation[];
  citations: ClaimCitation[];
  targets: CompilerApprovedTarget[];
}

/** Provider-neutral request for the discovery and target-planning stage. */
export interface CompilerAnalysisRequest {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  compileContextDigest: string;
  bundle: KnowledgeBundleConfig;
  operation: KnowledgeChangeSet["operation"];
  source: CompilerSourceIdentity;
  schema: CompilerSchemaSnapshot;
  evidence: CompilerEvidence[];
  contextPages: CompilerContextPage[];
  targetAuthorizations: CompilerModelTargetAuthorization[];
}

/** First-stage target passed to the read-only Vault resolver. */
export interface CompilerTargetRequest {
  targetId: string;
  path: string;
  intent: "write" | "delete";
  access: "authorized" | "create_only";
}

/** Exact runtime observation returned for one approved target. */
export type CompilerTargetObservation =
  | { targetId: string; kind: "missing"; windowsPathKey: string }
  | { targetId: string; kind: "occupied"; path: string }
  | { targetId: string; kind: "file"; path: string; content: string }
  | { targetId: string; kind: "directory"; path: string };

/** Target whose create/update/delete semantics are bound to an exact observation. */
export type CompilerBoundTarget = CompilerApprovedTarget &
  (
    | { operation: "create" }
    | { operation: "update"; beforeContent: string; beforeHash: string }
    | { operation: "delete"; beforeContent: string; beforeHash: string }
  );

/** Writable target content that may be exposed to the generation model. */
export type CompilerWritableTarget = Extract<
  CompilerBoundTarget,
  { operation: "create" | "update" }
>;

/** Model-visible analysis projection with target authority removed. */
export interface CompilerGenerationAnalysis {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  summary: string;
  concepts: CompilerConcept[];
  entities: CompilerEntity[];
  claims: CompilerClaim[];
  relations: CompilerRelation[];
  citations: ClaimCitation[];
}

/** Minimal model-visible create or update target. */
export type CompilerGenerationTarget = {
  targetId: string;
  path: string;
  reason: string;
  claimIds: string[];
  contentPolicy: "grounded" | "structural";
} & ({ operation: "create" } | { operation: "update"; currentContent: string });

/** Provider-neutral request for the content generation stage. */
export interface CompilerGenerationRequest {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  compileContextDigest: string;
  analysisDigest: string;
  targetSetDigest: string;
  bundle: KnowledgeBundleConfig;
  operation: KnowledgeChangeSet["operation"];
  source: CompilerSourceIdentity;
  schema: CompilerSchemaSnapshot;
  evidence: CompilerEvidence[];
  contextPages: CompilerContextPage[];
  analysis: CompilerGenerationAnalysis;
  targets: CompilerGenerationTarget[];
}

/** ChangeSet material before deterministic validation flags and status are attached. */
export interface CompilerChangeSetDraft {
  id: string;
  bundleId: string;
  operation: KnowledgeChangeSet["operation"];
  sourceRefs: string[];
  changes: KnowledgeFileChange[];
  citations: ClaimCitation[];
  createdAt: number;
}

/** Input to the deterministic OKF, link, and citation candidate validator. */
export interface CompilerCandidateValidationInput {
  bundle: KnowledgeBundleConfig;
  source: CompilerSourceIdentity;
  schema: CompilerSchemaSnapshot;
  artifacts: SourceArtifactObservation[];
  contextPages: CompilerContextPage[];
  analysis: CompilerAnalysis;
  targetSetDigest: string;
  targets: CompilerBoundTarget[];
  draft: CompilerChangeSetDraft;
}

/** Runtime result required before a proposal may enter user review. */
export interface CompilerCandidateValidationResult {
  validation: KnowledgeValidationSummary;
  diagnostics: KnowledgeDiagnostic[];
}

/** Read-only adapter that resolves exact states for first-stage approved paths. */
export interface CompilerTargetResolver {
  /**
   * Resolves every approved target without mutating the Vault.
   *
   * Successful adapter payloads are still treated as untrusted and parsed by
   * the compiler. Existing files must report their canonical Vault spelling.
   * `create_only` requests MUST use a case-insensitive existence probe and
   * return `occupied` without reading file content when the path already exists.
   * A missing result echoes the exact Windows comparison key that was checked.
   *
   * @param targets - Frozen, deterministic target requests
   * @param signal - Cancellation signal owned by the ingest attempt
   * @returns Unknown adapter payload containing one observation per target
   */
  resolve(targets: readonly CompilerTargetRequest[], signal: AbortSignal): Promise<unknown>;
}

/** Deterministic validation boundary for generated proposal material. */
export interface CompilerCandidateValidator {
  /**
   * Validates projected OKF, links, and material citations without writing.
   *
   * The compiler rejects false flags, error diagnostics, and malformed success
   * payloads. The apply-time validator will independently repeat these checks.
   *
   * @param input - Frozen candidate and its complete semantic read context
   * @param signal - Cancellation signal owned by the ingest attempt
   * @returns Unknown adapter payload containing recomputed validation flags
   */
  validate(input: CompilerCandidateValidationInput, signal: AbortSignal): Promise<unknown>;
}

/** Provider-neutral structured-output boundary used by the compiler core. */
export interface CompilerModelPort {
  /**
   * Discovers concepts, grounded claims, relations, and candidate target paths.
   *
   * Provider adapters must enforce response byte/token limits before decoding;
   * core collection and character limits remain an independent second gate.
   *
   * @param request - Frozen first-stage request containing no provider settings
   * @param signal - Cancellation signal owned by the ingest attempt
   * @returns Unknown provider output for strict runtime parsing
   */
  analyze(request: CompilerAnalysisRequest, signal: AbortSignal): Promise<unknown>;

  /**
   * Generates content only for the opaque target ids approved by stage one.
   *
   * Provider adapters must enforce response byte/token limits before decoding;
   * core collection and character limits remain an independent second gate.
   *
   * @param request - Frozen plan with exact target observations
   * @param signal - Cancellation signal owned by the ingest attempt
   * @returns Unknown provider output for strict runtime parsing
   */
  generate(request: CompilerGenerationRequest, signal: AbortSignal): Promise<unknown>;
}

/** Compile stages surfaced by controlled failures and infrastructure errors. */
export type KnowledgeCompilerStage =
  | "input"
  | "analysis"
  | "target_resolution"
  | "generation"
  | "candidate_validation";

/** Successful proposal that must still be explicitly reviewed before apply. */
export interface KnowledgeCompileProposal {
  kind: "proposed";
  compileContextDigest: string;
  analysisDigest: string;
  targetSetDigest: string;
  proposalDigest: string;
  analysis: CompilerAnalysis;
  changeSet: KnowledgeChangeSet;
  diagnostics: KnowledgeDiagnostic[];
}

/** Valid analysis that produced no file mutation after exact target binding. */
export interface KnowledgeCompileNoChanges {
  kind: "no_changes";
  compileContextDigest: string;
  analysisDigest: string;
  analysis: CompilerAnalysis;
  diagnostics: KnowledgeDiagnostic[];
}

/** Controlled deterministic failure safe to persist and render. */
export interface KnowledgeCompileFailure {
  kind: "failed";
  stage: KnowledgeCompilerStage;
  retryable: false;
  diagnostics: KnowledgeDiagnostic[];
}

/** Complete result of one provider-neutral compiler run. */
export type KnowledgeCompileResult =
  | KnowledgeCompileProposal
  | KnowledgeCompileNoChanges
  | KnowledgeCompileFailure;

/** Compile-time resource bounds applied after strict structural parsing. */
export interface KnowledgeCompilerLimits {
  maxConcepts: number;
  maxEntities: number;
  maxClaims: number;
  maxRelations: number;
  maxCitations: number;
  maxTargets: number;
  maxEvidenceItems: number;
  maxContextPages: number;
  maxTargetAuthorizations: number;
  maxModelContextCharacters: number;
  maxAnalysisCharacters: number;
  maxGeneratedFileCharacters: number;
  maxTotalGeneratedCharacters: number;
  maxValidationDiagnostics: number;
}

/** Constructor dependencies for deterministic two-stage compilation. */
export interface KnowledgeCompilerDependencies {
  model: CompilerModelPort;
  targetResolver: CompilerTargetResolver;
  candidateValidator: CompilerCandidateValidator;
  limits?: Partial<KnowledgeCompilerLimits>;
}
