import type {
  CompilerCandidateValidationInput,
  CompilerGenerationRequest,
  CompilerTargetAuthorization,
  CompilerTargetRequest,
  KnowledgeCompileFailure,
  KnowledgeCompileInput,
  KnowledgeCompileNoChanges,
  KnowledgeCompileProposal,
  KnowledgeCompileResult,
  KnowledgeCompilerDependencyFailureClassifier,
  KnowledgeCompilerLimits,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import type { CompilerGenerationModelOutput } from "@/knowledge/compiler/generationSchema";
import {
  createFileContentHash,
  createQuoteHash,
  createSourceContentHash,
} from "@/knowledge/model/fingerprint";
import type { SourceManifest } from "@/knowledge/model/types";
import { toWindowsPathKey } from "@/knowledge/paths/vaultPath";

export const SOURCE_TEXT = "The source says deterministic compilation is safer.";
export const SOURCE_CONTENT_HASH = createSourceContentHash(SOURCE_TEXT);
export const ARTIFACT_CONTENT_HASH = createFileContentHash(SOURCE_TEXT);
export const PIPELINE_FINGERPRINT = "b".repeat(64);
const SCHEMA_CONTENT = "type: knowledge-schema\n";
const DEFAULT_EXISTING_PAGE_HASH = createFileContentHash("default tracked page");
export const VALIDATION_SUCCESS = {
  validation: { okfValid: true, citationsValid: true, linksValid: true },
  diagnostics: [],
} as const;

export interface CompilerHarnessOptions {
  generate?: (request: CompilerGenerationRequest, signal: AbortSignal) => Promise<unknown>;
  resolve?: (targets: readonly CompilerTargetRequest[], signal: AbortSignal) => Promise<unknown>;
  validate?: (input: CompilerCandidateValidationInput, signal: AbortSignal) => Promise<unknown>;
  limits?: Partial<KnowledgeCompilerLimits>;
  classifyModelFailure?: KnowledgeCompilerDependencyFailureClassifier;
}

export function createTargetAuthorization(
  path: string,
  overrides: Partial<CompilerTargetAuthorization> = {}
): CompilerTargetAuthorization {
  return {
    path,
    allowedIntents: ["write"],
    contentPolicy: "grounded",
    ownership: "generated",
    sourceRefs: ["source-1"],
    expectedContentHash: DEFAULT_EXISTING_PAGE_HASH,
    ...overrides,
  };
}

export function createManifest(
  bundleId: string,
  authorizations: readonly CompilerTargetAuthorization[]
): SourceManifest {
  const sourceIds = new Set(["source-1"]);
  authorizations.forEach((authorization) =>
    authorization.sourceRefs.forEach((sourceId) => sourceIds.add(sourceId))
  );
  return {
    version: 1,
    bundleId,
    revision: 0,
    entries: [...sourceIds].sort().map((sourceId) => {
      const pages = authorizations
        .filter((authorization) => authorization.sourceRefs.includes(sourceId))
        .map((authorization) => ({
          path: authorization.path,
          ownership: authorization.ownership,
          contentHash: authorization.expectedContentHash ?? DEFAULT_EXISTING_PAGE_HASH,
        }))
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
      return {
        sourceId,
        sourceKey: `sources/${sourceId}.md`,
        sourcePath: `Sources/${sourceId}.md`,
        custody: "user_managed" as const,
        ...(pages.length === 0
          ? {}
          : {
              lastSuccessful: {
                sourceContentHash: SOURCE_CONTENT_HASH,
                pipelineFingerprint: PIPELINE_FINGERPRINT,
                generatedPages: pages,
                changeSetId: "previous-changeset",
                completedAt: 1,
              },
            }),
      };
    }),
  };
}

export function createCompileInput(
  overrides: Partial<KnowledgeCompileInput> = {}
): KnowledgeCompileInput {
  const bundle = overrides.bundle ?? {
    version: 1 as const,
    id: "personal",
    sourceRoots: ["Sources"],
    wikiRoot: "Wiki",
    schemaRef: "Config/knowledge-schema.md",
    reviewMode: "always" as const,
  };
  const targetAuthorizations = overrides.targetAuthorizations ?? [];
  return {
    bundle,
    operation: "ingest",
    source: {
      sourceId: "source-1",
      sourceContentHash: SOURCE_CONTENT_HASH,
      pipelineFingerprint: PIPELINE_FINGERPRINT,
      inputRevision: 1,
    },
    manifest: createManifest(bundle.id, targetAuthorizations),
    schema: {
      path: "Config/knowledge-schema.md",
      content: SCHEMA_CONTENT,
      contentHash: createFileContentHash(SCHEMA_CONTENT),
    },
    artifacts: [
      {
        kind: "text",
        sourceId: "source-1",
        artifactId: "artifact-1",
        artifactContentHash: ARTIFACT_CONTENT_HASH,
        text: SOURCE_TEXT,
      },
    ],
    evidence: [
      {
        evidenceId: "evidence-1",
        locator: {
          kind: "quote",
          sourceId: "source-1",
          artifactId: "artifact-1",
          artifactContentHash: ARTIFACT_CONTENT_HASH,
          excerpt: SOURCE_TEXT,
          quoteHash: createQuoteHash(SOURCE_TEXT),
        },
      },
    ],
    contextPages: [],
    targetAuthorizations,
    createdAt: 1_000,
    ...overrides,
  };
}

export function createMissingObservations(targets: readonly CompilerTargetRequest[]) {
  return targets.map((target) => ({
    targetId: target.targetId,
    kind: "missing" as const,
    windowsPathKey: toWindowsPathKey(target.path),
  }));
}

export function createGenerationOutput(
  request: CompilerGenerationRequest
): CompilerGenerationModelOutput {
  return {
    version: 1,
    targetSetDigest: request.targetSetDigest,
    files: request.targets.map((target) => ({
      targetId: target.targetId,
      outcome: "write" as const,
      afterContent: `---\ntype: concept\n---\n\n# ${target.path}\n`,
      claims: [{ text: SOURCE_TEXT, evidenceIds: [request.evidence[0].evidenceId] }],
    })),
  };
}

export function createHarness(options: CompilerHarnessOptions = {}) {
  const model = {
    generationRequests: [] as CompilerGenerationRequest[],
    generationSignals: [] as AbortSignal[],
    modelCallAuthorizations: [] as unknown[],
    authorizationHandler: undefined as ((authorization: unknown) => void) | undefined,
    authorizeModelCall(authorization: unknown) {
      model.modelCallAuthorizations.push(authorization);
      model.authorizationHandler?.(authorization);
    },
    async generate(request: CompilerGenerationRequest, signal: AbortSignal) {
      model.generationRequests.push(request);
      model.generationSignals.push(signal);
      return options.generate ? options.generate(request, signal) : createGenerationOutput(request);
    },
  };
  const resolver = {
    requests: [] as (readonly CompilerTargetRequest[])[],
    signals: [] as AbortSignal[],
    async resolve(targets: readonly CompilerTargetRequest[], signal: AbortSignal) {
      resolver.requests.push(targets);
      resolver.signals.push(signal);
      return options.resolve
        ? options.resolve(targets, signal)
        : createMissingObservations(targets);
    },
  };
  const validator = {
    inputs: [] as CompilerCandidateValidationInput[],
    signals: [] as AbortSignal[],
    async validate(input: CompilerCandidateValidationInput, signal: AbortSignal) {
      validator.inputs.push(input);
      validator.signals.push(signal);
      return options.validate ? options.validate(input, signal) : VALIDATION_SUCCESS;
    },
  };
  return {
    compiler: new KnowledgeCompiler({
      model,
      targetResolver: resolver,
      candidateValidator: validator,
      limits: options.limits,
      classifyModelFailure: options.classifyModelFailure,
    }),
    model,
    resolver,
    validator,
  };
}

export function requireProposal(result: KnowledgeCompileResult): KnowledgeCompileProposal {
  if (result.kind !== "proposed") throw new Error(JSON.stringify(result));
  return result;
}

export function requireFailure(result: KnowledgeCompileResult): KnowledgeCompileFailure {
  if (result.kind !== "failed") throw new Error(`Expected failure, got '${result.kind}'`);
  return result;
}

export function requireNoChanges(result: KnowledgeCompileResult): KnowledgeCompileNoChanges {
  if (result.kind !== "no_changes") throw new Error(JSON.stringify(result));
  return result;
}

export function diagnosticCodes(
  result: KnowledgeCompileFailure | KnowledgeCompileNoChanges
): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}
