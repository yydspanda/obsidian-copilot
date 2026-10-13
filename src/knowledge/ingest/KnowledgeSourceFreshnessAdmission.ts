import type {
  IngestSourceFreshnessAdmission,
  IngestSourceFreshnessAdmissionPort,
  IngestSourceFreshnessAdmissionRequest,
} from "@/knowledge/ingest/queue/IngestQueue";
import type { KnowledgeOutputObservationReaderPort } from "@/knowledge/ingest/ObsidianKnowledgeOutputObservationReader";
import { decideProvenSourceFreshness } from "@/knowledge/manifest/freshness";
import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { SourceFreshnessDecision, SourceStaleReason } from "@/knowledge/model/types";
import {
  parseKnowledgeRuntimeSourceFreshnessAuthority,
  type KnowledgeRuntimeSourceFreshnessAuthority,
  type KnowledgeRuntimeSourceFreshnessAuthorityPort,
} from "@/knowledge/runtime/KnowledgeRuntimeSourceFreshness";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_AUTHORITY_READ_ATTEMPTS = 3;

export interface KnowledgeSourceFreshnessGenerationPort {
  assertCurrent(): void;
}

export interface KnowledgeSourceFreshnessAdmissionDependencies {
  authority: KnowledgeRuntimeSourceFreshnessAuthorityPort;
  outputs: KnowledgeOutputObservationReaderPort;
  generation: KnowledgeSourceFreshnessGenerationPort;
  maxAuthorityReadAttempts?: number;
}

export type KnowledgeSourceFreshnessAdmissionErrorCode =
  | "dependency_invalid"
  | "request_invalid"
  | "authority_unavailable"
  | "authority_changed"
  | "output_unavailable"
  | "generation_stale";

export class KnowledgeSourceFreshnessAdmissionError extends Error {
  constructor(public readonly code: KnowledgeSourceFreshnessAdmissionErrorCode) {
    super("Knowledge source freshness could not be established");
    this.name = "KnowledgeSourceFreshnessAdmissionError";
    Object.freeze(this);
  }
}

function createAdmissionError(
  code: KnowledgeSourceFreshnessAdmissionErrorCode
): KnowledgeSourceFreshnessAdmissionError {
  return new KnowledgeSourceFreshnessAdmissionError(code);
}

type UnknownDataMethod = (this: unknown, ...args: unknown[]) => unknown;

function findDataMethod(
  value: unknown,
  key: string
): { receiver: object; method: UnknownDataMethod } | null {
  if (typeof value !== "object" || value === null) return null;
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, key);
    } catch {
      return null;
    }
    if (descriptor) {
      const candidate: unknown = "value" in descriptor ? descriptor.value : undefined;
      return typeof candidate === "function"
        ? { receiver: value, method: candidate as UnknownDataMethod }
        : null;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return null;
}

function captureReadPorts(dependencies: KnowledgeSourceFreshnessAdmissionDependencies): {
  readAuthority: (bundleId: string, sourceId: string) => Promise<unknown>;
  observeOutputs: KnowledgeOutputObservationReaderPort["observe"];
  assertCurrent: () => void;
  maxAuthorityReadAttempts: number;
} {
  if (typeof dependencies !== "object" || dependencies === null) {
    throw createAdmissionError("dependency_invalid");
  }
  const authority = findDataMethod(dependencies.authority, "readSourceFreshnessAuthority");
  const outputs = findDataMethod(dependencies.outputs, "observe");
  const generation = findDataMethod(dependencies.generation, "assertCurrent");
  const attempts = dependencies.maxAuthorityReadAttempts ?? DEFAULT_MAX_AUTHORITY_READ_ATTEMPTS;
  if (!authority || !outputs || !generation || !Number.isSafeInteger(attempts) || attempts < 1) {
    throw createAdmissionError("dependency_invalid");
  }
  return Object.freeze({
    readAuthority: async (bundleId, sourceId) =>
      await Promise.resolve(
        Reflect.apply(authority.method, authority.receiver, [bundleId, sourceId])
      ),
    observeOutputs: async (expected, signal) =>
      (await Promise.resolve(
        Reflect.apply(outputs.method, outputs.receiver, [expected, signal])
      )) as Awaited<ReturnType<KnowledgeOutputObservationReaderPort["observe"]>>,
    assertCurrent: () => {
      Reflect.apply(generation.method, generation.receiver, []);
    },
    maxAuthorityReadAttempts: attempts,
  });
}

function snapshotRequest(
  value: Readonly<IngestSourceFreshnessAdmissionRequest>
): Readonly<IngestSourceFreshnessAdmissionRequest> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw createAdmissionError("request_invalid");
    }
    const expected = [
      "bundleId",
      "sourceId",
      "sourceContentHash",
      "pipelineFingerprint",
      "inputRevision",
    ];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string") ||
      !expected.every((key) => keys.includes(key))
    ) {
      throw createAdmissionError("request_invalid");
    }
    const read = (key: keyof IngestSourceFreshnessAdmissionRequest): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw createAdmissionError("request_invalid");
      }
      return descriptor.value;
    };
    const bundleId = read("bundleId");
    const sourceId = read("sourceId");
    const sourceContentHash = read("sourceContentHash");
    const pipelineFingerprint = read("pipelineFingerprint");
    const inputRevision = read("inputRevision");
    if (
      typeof bundleId !== "string" ||
      bundleId.length === 0 ||
      bundleId.trim() !== bundleId ||
      typeof sourceId !== "string" ||
      sourceId.length === 0 ||
      sourceId.trim() !== sourceId ||
      typeof sourceContentHash !== "string" ||
      !HASH_PATTERN.test(sourceContentHash) ||
      typeof pipelineFingerprint !== "string" ||
      !HASH_PATTERN.test(pipelineFingerprint) ||
      !Number.isSafeInteger(inputRevision) ||
      (inputRevision as number) < 1
    ) {
      throw createAdmissionError("request_invalid");
    }
    return Object.freeze({
      bundleId,
      sourceId,
      sourceContentHash,
      pipelineFingerprint,
      inputRevision: inputRevision as number,
    });
  } catch (error) {
    if (error instanceof KnowledgeSourceFreshnessAdmissionError) throw error;
    throw createAdmissionError("request_invalid");
  }
}

function freezeDecision(decision: SourceFreshnessDecision): Readonly<SourceFreshnessDecision> {
  if (decision.kind === "up_to_date") return Object.freeze({ kind: "up_to_date" as const });
  return Object.freeze({
    kind: "needs_ingest" as const,
    reasons: Object.freeze([...decision.reasons]) as SourceStaleReason[],
  });
}

function createAdmission(
  request: Readonly<IngestSourceFreshnessAdmissionRequest>,
  decision: SourceFreshnessDecision
): Readonly<IngestSourceFreshnessAdmission> {
  return Object.freeze({
    ...request,
    decision: freezeDecision(decision),
  });
}

function sameSourceAuthority(
  before: KnowledgeRuntimeSourceFreshnessAuthority,
  after: KnowledgeRuntimeSourceFreshnessAuthority
): boolean {
  if (
    before.runtimeId !== after.runtimeId ||
    before.bundleId !== after.bundleId ||
    before.sourceId !== after.sourceId ||
    before.kind !== after.kind ||
    before.sourceContentHash !== after.sourceContentHash ||
    before.pipelineFingerprint !== after.pipelineFingerprint ||
    before.inputRevision !== after.inputRevision ||
    before.manifestRevision !== after.manifestRevision ||
    before.manifestDigest !== after.manifestDigest ||
    before.generatedPages.length !== after.generatedPages.length
  ) {
    return false;
  }
  if (
    before.generatedPages.some((page, index) => {
      const other = after.generatedPages[index];
      return other === undefined || canonicalizeJson(page) !== canonicalizeJson(other);
    })
  ) {
    return false;
  }
  return before.kind === "applied" && after.kind === "applied"
    ? before.transactionId === after.transactionId &&
        before.changeSetId === after.changeSetId &&
        before.changeSetDigest === after.changeSetDigest &&
        before.manifestIntentDigest === after.manifestIntentDigest &&
        before.committedManifestRevision === after.committedManifestRevision &&
        before.committedManifestDigest === after.committedManifestDigest &&
        before.completedAt === after.completedAt
    : before.kind === "no_changes" && after.kind === "no_changes"
      ? before.noChangesId === after.noChangesId &&
        before.reason === after.reason &&
        before.planDigest === after.planDigest &&
        before.jobId === after.jobId &&
        before.attempt === after.attempt &&
        before.committedManifestRevision === after.committedManifestRevision &&
        before.completedAt === after.completedAt
      : false;
}

export class KnowledgeSourceFreshnessAdmission implements IngestSourceFreshnessAdmissionPort {
  private readonly readAuthority: ReturnType<typeof captureReadPorts>["readAuthority"];
  private readonly observeOutputs: ReturnType<typeof captureReadPorts>["observeOutputs"];
  private readonly assertGenerationCurrent: ReturnType<typeof captureReadPorts>["assertCurrent"];
  private readonly maxAuthorityReadAttempts: number;
  private readonly controller = new AbortController();
  private closed = false;

  constructor(dependencies: KnowledgeSourceFreshnessAdmissionDependencies) {
    const captured = captureReadPorts(dependencies);
    this.readAuthority = captured.readAuthority;
    this.observeOutputs = captured.observeOutputs;
    this.assertGenerationCurrent = captured.assertCurrent;
    this.maxAuthorityReadAttempts = captured.maxAuthorityReadAttempts;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
  }

  async evaluate(candidate: Readonly<IngestSourceFreshnessAdmissionRequest>): Promise<unknown> {
    const request = snapshotRequest(candidate);
    for (let attempt = 0; attempt < this.maxAuthorityReadAttempts; attempt += 1) {
      this.requireCurrent();
      const before = await this.readAndParseAuthority(request);
      this.requireCurrent();
      if (before === null) {
        return createAdmission(request, {
          kind: "needs_ingest",
          reasons: ["never_ingested"],
        });
      }
      const identityReasons: SourceStaleReason[] = [];
      if (before.sourceContentHash !== request.sourceContentHash) {
        identityReasons.push("source_changed");
      }
      if (before.pipelineFingerprint !== request.pipelineFingerprint) {
        identityReasons.push("pipeline_changed");
      }
      if (identityReasons.length > 0) {
        return createAdmission(request, { kind: "needs_ingest", reasons: identityReasons });
      }

      let outputs: Awaited<ReturnType<KnowledgeOutputObservationReaderPort["observe"]>>;
      try {
        outputs = await this.observeOutputs(
          Object.freeze(
            before.generatedPages.map((page) =>
              Object.freeze({ path: page.path, contentHash: page.contentHash })
            )
          ),
          this.controller.signal
        );
      } catch {
        if (this.closed || this.controller.signal.aborted) {
          throw createAdmissionError("generation_stale");
        }
        throw createAdmissionError("output_unavailable");
      }
      this.requireCurrent();
      const decision = decideProvenSourceFreshness({
        outcome: before.kind,
        successfulSourceContentHash: before.sourceContentHash,
        successfulPipelineFingerprint: before.pipelineFingerprint,
        generatedPages: before.generatedPages,
        sourceContentHash: request.sourceContentHash,
        pipelineFingerprint: request.pipelineFingerprint,
        outputs,
      });
      if (decision.kind === "needs_ingest") return createAdmission(request, decision);

      const after = await this.readAndParseAuthority(request);
      this.requireCurrent();
      if (after !== null && sameSourceAuthority(before, after)) {
        return createAdmission(request, decision);
      }
    }
    throw createAdmissionError("authority_changed");
  }

  private requireCurrent(): void {
    if (this.closed || this.controller.signal.aborted) {
      throw createAdmissionError("generation_stale");
    }
    try {
      this.assertGenerationCurrent();
    } catch {
      throw createAdmissionError("generation_stale");
    }
    if (this.closed || this.controller.signal.aborted) {
      throw createAdmissionError("generation_stale");
    }
  }

  private async readAndParseAuthority(
    request: Readonly<IngestSourceFreshnessAdmissionRequest>
  ): Promise<KnowledgeRuntimeSourceFreshnessAuthority | null> {
    let raw: unknown;
    try {
      raw = await this.readAuthority(request.bundleId, request.sourceId);
    } catch {
      throw createAdmissionError("authority_unavailable");
    }
    if (raw === null) return null;
    try {
      const authority = parseKnowledgeRuntimeSourceFreshnessAuthority(raw);
      if (authority.bundleId !== request.bundleId || authority.sourceId !== request.sourceId) {
        throw createAdmissionError("authority_unavailable");
      }
      return authority;
    } catch {
      throw createAdmissionError("authority_unavailable");
    }
  }
}

Object.freeze(KnowledgeSourceFreshnessAdmissionError.prototype);
Object.freeze(KnowledgeSourceFreshnessAdmissionError);
Object.freeze(KnowledgeSourceFreshnessAdmission.prototype);
Object.freeze(KnowledgeSourceFreshnessAdmission);
