import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import type { JsonValue } from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Current protocol version shared by the grounded-answer prompt and validator. */
export const KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION = 1 as const;

/** Stable resource limits for one read-only grounded-answer request and response. */
export const KNOWLEDGE_GROUNDED_ANSWER_LIMITS = Object.freeze({
  maxQuestionCharacters: 1_000,
  maxContextItems: 12,
  maxEvidenceItems: 24,
  maxWikiExcerptCharacters: 4_000,
  maxSourceExcerptCharacters: 4_000,
  maxTotalEvidenceCharacters: 64_000,
  maxPagePathCharacters: 1_024,
  maxHeadingCharacters: 1_024,
  maxHeadingDepth: 32,
  maxModelOutputCharacters: 256_000,
  maxClaims: 64,
  maxClaimCharacters: 4_000,
  maxEvidenceIdsPerClaim: 12,
  maxInsufficientEvidenceItems: 32,
  maxInsufficientEvidenceCharacters: 2_000,
});

/** One exact applied-Wiki chunk supplied only as question context. */
export interface KnowledgeGroundedAnswerContext {
  readonly contextId: string;
  readonly pagePath: string;
  readonly pageContentHash: string;
  readonly heading: string;
  readonly headingPath: readonly string[];
  readonly content: string;
}

/** One exact parser-owned source excerpt that the model may cite by opaque id. */
export interface KnowledgeGroundedAnswerEvidence {
  readonly evidenceId: string;
  readonly contextId: string;
  readonly sourceExcerpt: string;
  readonly sourceRelation: "supports" | "contradicts" | "context";
}

/** Complete immutable input to one grounded-answer model call. */
export interface KnowledgeGroundedAnswerRequest {
  readonly version: typeof KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION;
  readonly contextDigest: string;
  readonly question: string;
  readonly contexts: readonly Readonly<KnowledgeGroundedAnswerContext>[];
  readonly evidence: readonly Readonly<KnowledgeGroundedAnswerEvidence>[];
}

/** Semantic category rendered explicitly beside every supported answer claim. */
export type KnowledgeGroundedAnswerClaimKind = "source_fact" | "inference";

/** One validated answer claim whose evidence ids all belong to the exact request. */
export interface KnowledgeGroundedAnswerClaim {
  readonly claimId: string;
  readonly kind: KnowledgeGroundedAnswerClaimKind;
  readonly text: string;
  readonly evidenceIds: readonly string[];
}

/** Whether the supplied evidence fully, partly, or cannot answer the question. */
export type KnowledgeGroundedAnswerStatus = "answered" | "partial" | "insufficient_evidence";

/** Strict normalized model result with no unchecked citation or free-form summary field. */
export interface KnowledgeGroundedAnswer {
  readonly version: typeof KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION;
  readonly contextDigest: string;
  readonly status: KnowledgeGroundedAnswerStatus;
  readonly claims: readonly Readonly<KnowledgeGroundedAnswerClaim>[];
  readonly insufficientEvidence: readonly string[];
}

/** Provider-neutral model capability retained behind the query generation. */
export interface KnowledgeGroundedAnswerModelPort {
  /** Returns one bounded JSON string; the Core independently validates every field. */
  generate(request: Readonly<KnowledgeGroundedAnswerRequest>, signal: AbortSignal): Promise<string>;
}

/** Sanitized failure that never retains a question, evidence, model output, or cause. */
export class KnowledgeGroundedAnswerError extends Error {
  /** Creates one value-free grounded-answer boundary failure. */
  constructor() {
    super("The grounded knowledge answer is unavailable");
    this.name = "KnowledgeGroundedAnswerError";
  }
}

const groundedAnswerRequests = new WeakSet<object>();

/** Reports whether a value is a plain record without invoking user code. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Requires an exact enumerable own-key set without reading accessors. */
function assertExactKeys(value: unknown, expected: readonly string[]): asserts value is object {
  try {
    if (!isPlainRecord(value)) throw new TypeError("Expected a plain record");
    const actual = Reflect.ownKeys(value);
    const sortedExpected = [...expected].sort();
    if (
      actual.length !== sortedExpected.length ||
      actual.some((key) => typeof key !== "string") ||
      (actual as string[]).sort().some((key, index) => key !== sortedExpected[index])
    ) {
      throw new TypeError("Unexpected record keys");
    }
  } catch {
    throw new KnowledgeGroundedAnswerError();
  }
}

/** Reads one enumerable own data property without invoking an accessor. */
function readDataProperty(value: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected an own data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeGroundedAnswerError();
  }
}

/** Captures one dense array without invoking iterators or element accessors. */
function captureDenseArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value)) throw new TypeError("Expected an array");
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximum ||
      Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
    ) {
      throw new TypeError("Expected a bounded dense array");
    }
    const captured: unknown[] = [];
    for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError("Expected an array data property");
      }
      captured.push(descriptor.value);
    }
    return Object.freeze(captured);
  } catch (error) {
    if (error instanceof KnowledgeGroundedAnswerError) throw error;
    throw new KnowledgeGroundedAnswerError();
  }
}

/** Captures one bounded canonical text value. */
function captureText(value: unknown, maximum: number, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.trim() !== value ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new KnowledgeGroundedAnswerError();
  }
  return value;
}

/** Captures exact evidence bytes represented as text without trimming their locator material. */
function captureMaterialText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0
  ) {
    throw new KnowledgeGroundedAnswerError();
  }
  return value;
}

/** Captures a unique bounded string list. */
function captureTextArray(
  value: unknown,
  maximumItems: number,
  maximumCharacters: number,
  allowEmpty: boolean,
  requireUnique: boolean
): readonly string[] {
  const values = captureDenseArray(value, maximumItems);
  if (!allowEmpty && values.length === 0) throw new KnowledgeGroundedAnswerError();
  const seen = new Set<string>();
  const captured = values.map((item) => {
    const text = captureText(item, maximumCharacters);
    if (requireUnique && seen.has(text)) throw new KnowledgeGroundedAnswerError();
    seen.add(text);
    return text;
  });
  return Object.freeze(captured);
}

/** Captures one exact Wiki context item before any asynchronous model work. */
function captureContext(value: unknown): Readonly<KnowledgeGroundedAnswerContext> {
  assertExactKeys(value, [
    "contextId",
    "pagePath",
    "pageContentHash",
    "heading",
    "headingPath",
    "content",
  ]);
  const contextId = captureText(readDataProperty(value, "contextId"), 512);
  const pagePath = captureText(
    readDataProperty(value, "pagePath"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxPagePathCharacters
  );
  const pageContentHash = captureText(readDataProperty(value, "pageContentHash"), 64);
  if (!/^[a-f0-9]{64}$/.test(pageContentHash)) throw new KnowledgeGroundedAnswerError();
  const heading = captureText(
    readDataProperty(value, "heading"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxHeadingCharacters,
    true
  );
  const headingPath = captureTextArray(
    readDataProperty(value, "headingPath"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxHeadingDepth,
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxHeadingCharacters,
    true,
    false
  );
  const content = captureMaterialText(
    readDataProperty(value, "content"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxWikiExcerptCharacters
  );
  return Object.freeze({
    contextId,
    pagePath,
    pageContentHash,
    heading,
    headingPath,
    content,
  });
}

/** Captures one exact source evidence item before any asynchronous model work. */
function captureEvidence(value: unknown): Readonly<KnowledgeGroundedAnswerEvidence> {
  assertExactKeys(value, ["evidenceId", "contextId", "sourceExcerpt", "sourceRelation"]);
  const evidenceId = captureText(readDataProperty(value, "evidenceId"), 512);
  const contextId = captureText(readDataProperty(value, "contextId"), 512);
  const sourceExcerpt = captureMaterialText(
    readDataProperty(value, "sourceExcerpt"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxSourceExcerptCharacters
  );
  const sourceRelation = readDataProperty(value, "sourceRelation");
  if (
    sourceRelation !== "supports" &&
    sourceRelation !== "contradicts" &&
    sourceRelation !== "context"
  ) {
    throw new KnowledgeGroundedAnswerError();
  }
  return Object.freeze({
    evidenceId,
    contextId,
    sourceExcerpt,
    sourceRelation,
  });
}

/**
 * Captures one exact source-backed request for a grounded model call.
 *
 * Callers must omit excerpts that lack a current source citation. Consequently,
 * every evidence id visible to the model can later be mapped back to at least one
 * current opaque citation reference.
 */
export function createKnowledgeGroundedAnswerRequest(
  questionValue: unknown,
  contextsValue: unknown,
  evidenceValue: unknown
): Readonly<KnowledgeGroundedAnswerRequest> {
  const question = captureText(
    typeof questionValue === "string" ? questionValue.trim() : questionValue,
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxQuestionCharacters
  );
  const contextValues = captureDenseArray(
    contextsValue,
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxContextItems
  );
  const contextIds = new Set<string>();
  let totalCharacters = 0;
  const contexts = contextValues.map((value) => {
    const captured = captureContext(value);
    if (contextIds.has(captured.contextId)) throw new KnowledgeGroundedAnswerError();
    contextIds.add(captured.contextId);
    totalCharacters += captured.content.length;
    if (totalCharacters > KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxTotalEvidenceCharacters) {
      throw new KnowledgeGroundedAnswerError();
    }
    return captured;
  });
  const evidenceValues = captureDenseArray(
    evidenceValue,
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxEvidenceItems
  );
  const evidenceIds = new Set<string>();
  const evidence = evidenceValues.map((value) => {
    const captured = captureEvidence(value);
    if (evidenceIds.has(captured.evidenceId) || !contextIds.has(captured.contextId)) {
      throw new KnowledgeGroundedAnswerError();
    }
    evidenceIds.add(captured.evidenceId);
    totalCharacters += captured.sourceExcerpt.length;
    if (totalCharacters > KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxTotalEvidenceCharacters) {
      throw new KnowledgeGroundedAnswerError();
    }
    return captured;
  });
  if ((contexts.length === 0) !== (evidence.length === 0)) {
    throw new KnowledgeGroundedAnswerError();
  }
  const referencedContextIds = new Set(evidence.map(({ contextId }) => contextId));
  if (contexts.some(({ contextId }) => !referencedContextIds.has(contextId))) {
    throw new KnowledgeGroundedAnswerError();
  }
  const digestMaterial: JsonValue = {
    version: KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION,
    question,
    contexts: contexts as unknown as JsonValue,
    evidence: evidence as unknown as JsonValue,
  };
  const request = Object.freeze({
    version: KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION,
    contextDigest: sha256(
      `knowledge-grounded-answer-context-v1\n${canonicalizeJson(digestMaterial)}`
    ),
    question,
    contexts: Object.freeze(contexts),
    evidence: Object.freeze(evidence),
  });
  groundedAnswerRequests.add(request);
  return request;
}

/** Rejects copied or forged request records at provider and validator boundaries. */
export function assertKnowledgeGroundedAnswerRequest(
  value: unknown
): asserts value is Readonly<KnowledgeGroundedAnswerRequest> {
  if (typeof value !== "object" || value === null || !groundedAnswerRequests.has(value)) {
    throw new KnowledgeGroundedAnswerError();
  }
}

/** Captures and validates one claim against the exact request evidence allowlist. */
function captureClaim(
  value: unknown,
  allowedEvidenceIds: ReadonlySet<string>,
  claimIds: Set<string>
): Readonly<KnowledgeGroundedAnswerClaim> {
  assertExactKeys(value, ["claimId", "kind", "text", "evidenceIds"]);
  const claimId = captureText(readDataProperty(value, "claimId"), 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(claimId) || claimIds.has(claimId)) {
    throw new KnowledgeGroundedAnswerError();
  }
  claimIds.add(claimId);
  const kind = readDataProperty(value, "kind");
  if (kind !== "source_fact" && kind !== "inference") {
    throw new KnowledgeGroundedAnswerError();
  }
  const text = captureText(
    readDataProperty(value, "text"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxClaimCharacters
  );
  const evidenceIds = captureTextArray(
    readDataProperty(value, "evidenceIds"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxEvidenceIdsPerClaim,
    512,
    false,
    true
  );
  if (evidenceIds.some((evidenceId) => !allowedEvidenceIds.has(evidenceId))) {
    throw new KnowledgeGroundedAnswerError();
  }
  return Object.freeze({ claimId, kind, text, evidenceIds });
}

/** Validates status-to-content semantics so unsupported prose cannot hide in the result. */
function assertAnswerSemantics(
  status: KnowledgeGroundedAnswerStatus,
  claims: readonly Readonly<KnowledgeGroundedAnswerClaim>[],
  insufficientEvidence: readonly string[]
): void {
  if (
    (status === "answered" && (claims.length === 0 || insufficientEvidence.length !== 0)) ||
    (status === "partial" && (claims.length === 0 || insufficientEvidence.length === 0)) ||
    (status === "insufficient_evidence" &&
      (claims.length !== 0 || insufficientEvidence.length === 0))
  ) {
    throw new KnowledgeGroundedAnswerError();
  }
}

/**
 * Parses and independently validates an untrusted JSON model response.
 *
 * The result cannot cite an excerpt that was absent from the exact request, and
 * it has no uncited summary/prose escape hatch: every answer statement is either
 * a source-backed fact or an explicitly labelled inference.
 */
export function parseKnowledgeGroundedAnswerModelOutput(
  rawValue: unknown,
  request: Readonly<KnowledgeGroundedAnswerRequest>
): Readonly<KnowledgeGroundedAnswer> {
  try {
    assertKnowledgeGroundedAnswerRequest(request);
    if (
      typeof rawValue !== "string" ||
      rawValue.length === 0 ||
      rawValue.length > KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxModelOutputCharacters
    ) {
      throw new KnowledgeGroundedAnswerError();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue) as unknown;
    } catch {
      throw new KnowledgeGroundedAnswerError();
    }
    assertExactKeys(parsed, [
      "version",
      "contextDigest",
      "status",
      "claims",
      "insufficientEvidence",
    ]);
    if (readDataProperty(parsed, "version") !== KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION) {
      throw new KnowledgeGroundedAnswerError();
    }
    if (readDataProperty(parsed, "contextDigest") !== request.contextDigest) {
      throw new KnowledgeGroundedAnswerError();
    }
    const status = readDataProperty(parsed, "status");
    if (status !== "answered" && status !== "partial" && status !== "insufficient_evidence") {
      throw new KnowledgeGroundedAnswerError();
    }
    const allowedEvidenceIds = new Set(
      captureDenseArray(request.evidence, KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxEvidenceItems).map(
        (value) => captureEvidence(value).evidenceId
      )
    );
    const claimIds = new Set<string>();
    const claims = captureDenseArray(
      readDataProperty(parsed, "claims"),
      KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxClaims
    ).map((value) => captureClaim(value, allowedEvidenceIds, claimIds));
    const insufficientEvidence = captureTextArray(
      readDataProperty(parsed, "insufficientEvidence"),
      KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxInsufficientEvidenceItems,
      KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxInsufficientEvidenceCharacters,
      true,
      true
    );
    assertAnswerSemantics(status, claims, insufficientEvidence);
    return Object.freeze({
      version: KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION,
      contextDigest: request.contextDigest,
      status,
      claims: Object.freeze(claims),
      insufficientEvidence,
    });
  } catch (error) {
    if (error instanceof KnowledgeGroundedAnswerError) throw error;
    throw new KnowledgeGroundedAnswerError();
  }
}

/** Creates the deterministic no-model result used when no source-backed excerpt matched. */
export function createInsufficientKnowledgeGroundedAnswer(
  contextDigest: string
): Readonly<KnowledgeGroundedAnswer> {
  if (!/^[a-f0-9]{64}$/.test(contextDigest)) throw new KnowledgeGroundedAnswerError();
  return Object.freeze({
    version: KNOWLEDGE_GROUNDED_ANSWER_PROTOCOL_VERSION,
    contextDigest,
    status: "insufficient_evidence",
    claims: Object.freeze([]),
    insufficientEvidence: Object.freeze([
      "No current source-backed applied Wiki excerpt supports an answer.",
    ]),
  });
}
