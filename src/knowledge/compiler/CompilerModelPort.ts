import type { SourceArtifactObservation } from "@/knowledge/model/locatorMaterialValidation";
import type { ManifestCommitPlan } from "@/knowledge/manifest/ManifestCommitIntent";
import type { NoChangesManifestCommitPlan } from "@/knowledge/manifest/NoChangesManifestCommit";
import type {
  ClaimCitation,
  GeneratedPageOwnership,
  KnowledgeBundleConfig,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeValidationSummary,
  SourceLocator,
  SourceManifest,
} from "@/knowledge/model/types";

export const KNOWLEDGE_COMPILER_PROTOCOL_VERSION = 1 as const;

export interface CompilerSourceIdentity {
  sourceId: string;
  sourceContentHash: string;
  pipelineFingerprint: string;

  inputRevision: number;
}

export interface CompilerSchemaSnapshot {
  path: string;
  content: string;
  contentHash: string;
}

export interface CompilerContextPage {
  path: string;
  content: string;
  contentHash: string;
}

export interface CompilerEvidence {
  evidenceId: string;
  locator: SourceLocator;
}

export interface CompilerTargetAuthorization {
  path: string;
  allowedIntents: ("write" | "delete")[];
  contentPolicy: "grounded" | "structural";
  ownership: GeneratedPageOwnership;
  sourceRefs: string[];
  expectedContentHash?: string;
}

export interface KnowledgeCompileInput {
  bundle: KnowledgeBundleConfig;
  operation: KnowledgeChangeSet["operation"];
  source: CompilerSourceIdentity;

  manifest: SourceManifest;
  schema: CompilerSchemaSnapshot;
  artifacts: SourceArtifactObservation[];
  evidence: CompilerEvidence[];
  contextPages: CompilerContextPage[];
  targetAuthorizations: CompilerTargetAuthorization[];
  createdAt: number;
}

export interface CompilerConcept {
  id: string;
  name: string;
  description?: string;
}

export interface CompilerEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export interface CompilerClaim {
  id: string;
  text: string;
}

export interface CompilerRelation {
  id: string;
  fromId: string;
  toId: string;
  type: string;
}

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

export interface CompilerTargetRequest {
  targetId: string;
  path: string;
  intent: "write" | "delete";
  access: "authorized" | "create_only";
}

export type CompilerTargetObservation =
  | { targetId: string; kind: "missing"; windowsPathKey: string }
  | { targetId: string; kind: "occupied"; path: string }
  | { targetId: string; kind: "file"; path: string; content: string }
  | { targetId: string; kind: "directory"; path: string };

export type CompilerBoundTarget = CompilerApprovedTarget &
  (
    | { operation: "create" }
    | { operation: "update"; beforeContent: string; beforeHash: string }
    | { operation: "delete"; beforeContent: string; beforeHash: string }
  );

export type CompilerWritableTarget = Extract<
  CompilerBoundTarget,
  { operation: "create" | "update" }
>;

export type CompilerGenerationTarget = {
  targetId: string;
  path: string;
  reason: string;
  contentPolicy: "grounded" | "structural";
} & ({ operation: "create" } | { operation: "update"; currentContent: string });

export interface CompilerGenerationRequest {
  version: typeof KNOWLEDGE_COMPILER_PROTOCOL_VERSION;
  compileContextDigest: string;
  targetSetDigest: string;
  bundle: KnowledgeBundleConfig;
  operation: KnowledgeChangeSet["operation"];
  source: CompilerSourceIdentity;
  schema: CompilerSchemaSnapshot;
  evidence: CompilerEvidence[];
  contextPages: CompilerContextPage[];
  targets: CompilerGenerationTarget[];
}

export interface CompilerChangeSetDraft {
  id: string;
  bundleId: string;
  operation: KnowledgeChangeSet["operation"];
  sourceRefs: string[];
  changes: KnowledgeFileChange[];
  citations: ClaimCitation[];
  createdAt: number;
}

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

export interface CompilerCandidateValidationResult {
  validation: KnowledgeValidationSummary;
  diagnostics: KnowledgeDiagnostic[];
}

export interface CompilerTargetResolver {
  resolve(targets: readonly CompilerTargetRequest[], signal: AbortSignal): Promise<unknown>;
}

export interface CompilerCandidateValidator {
  validate(input: CompilerCandidateValidationInput, signal: AbortSignal): Promise<unknown>;
}

export interface CompilerModelPort {
  authorizeModelCall?(authorization: unknown): void;

  generate(request: CompilerGenerationRequest, signal: AbortSignal): Promise<unknown>;
}

export type KnowledgeCompilerInfrastructureFailureCode =
  | "dependency_failed"
  | "model_authority_failed"
  | "model_output_invalid"
  | "provider_request_rejected"
  | "provider_unauthorized"
  | "provider_balance_required"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_network_failed"
  | "provider_http_failed"
  | "provider_response_invalid";

export type KnowledgeCompilerDependencyFailureClassifier = (
  error: unknown
) => KnowledgeCompilerInfrastructureFailureCode | undefined;

export type KnowledgeCompilerStage =
  | "input"
  | "analysis"
  | "target_resolution"
  | "generation"
  | "candidate_validation";

export interface KnowledgeCompileProposal {
  kind: "proposed";
  compileContextDigest: string;
  analysisDigest: string;
  targetSetDigest: string;
  proposalDigest: string;
  manifestCommitPlan: ManifestCommitPlan;
  manifestCommitPlanDigest: string;
  analysis: CompilerAnalysis;
  changeSet: KnowledgeChangeSet;
  diagnostics: KnowledgeDiagnostic[];
}

export interface KnowledgeCompileNoChanges {
  kind: "no_changes";

  noChangesId: string;
  compileContextDigest: string;
  analysisDigest: string;

  manifestCommitPlan: NoChangesManifestCommitPlan;

  manifestCommitPlanDigest: string;
  analysis: CompilerAnalysis;
  diagnostics: KnowledgeDiagnostic[];
}

export interface KnowledgeCompileFailure {
  kind: "failed";
  stage: KnowledgeCompilerStage;
  retryable: false;
  diagnostics: KnowledgeDiagnostic[];
}

export type KnowledgeCompileResult =
  | KnowledgeCompileProposal
  | KnowledgeCompileNoChanges
  | KnowledgeCompileFailure;

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

export const DEFAULT_KNOWLEDGE_COMPILER_LIMITS: Readonly<KnowledgeCompilerLimits> = Object.freeze({
  maxConcepts: 256,
  maxEntities: 256,
  maxClaims: 512,
  maxRelations: 512,
  maxCitations: 1024,
  maxTargets: 128,
  maxEvidenceItems: 2048,
  maxContextPages: 256,
  maxTargetAuthorizations: 256,
  maxModelContextCharacters: 8_000_000,
  maxAnalysisCharacters: 1_000_000,
  maxGeneratedFileCharacters: 2_000_000,
  maxTotalGeneratedCharacters: 8_000_000,
  maxValidationDiagnostics: 1024,
});

export interface KnowledgeCompilerDependencies {
  model: CompilerModelPort;

  classifyModelFailure?: KnowledgeCompilerDependencyFailureClassifier;
  targetResolver: CompilerTargetResolver;
  candidateValidator: CompilerCandidateValidator;
  limits?: Partial<KnowledgeCompilerLimits>;
}
