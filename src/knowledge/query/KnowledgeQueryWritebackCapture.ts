import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import type { ClaimCitation, JsonValue } from "@/knowledge/model/types";
import { validateClaimCitation, validateVaultRelativePath } from "@/knowledge/model/validation";
import { KNOWLEDGE_GROUNDED_ANSWER_LIMITS } from "@/knowledge/query/KnowledgeGroundedAnswer";
import { sha256 } from "@/utils/hash";

export const KNOWLEDGE_QUERY_WRITEBACK_CAPTURE_VERSION = 1 as const;

const MAX_TITLE_CHARACTERS = 256;
const MAX_CITATION_REFERENCES =
  KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxClaims *
  KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxEvidenceIdsPerClaim;
const OPAQUE_REFERENCE_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const authenticQueryWritebackCaptures = new WeakSet<object>();

export interface KnowledgeQueryWritebackClaimInput {
  readonly claimId: string;
  readonly kind: "source_fact" | "inference";
  readonly text: string;
  readonly citationRefs: readonly string[];
}

export interface KnowledgeQueryWritebackEvidenceInput {
  readonly citationRef: string;
  readonly sourcePath: string;
  readonly citation: Readonly<ClaimCitation>;
}

export interface KnowledgeQueryWritebackCaptureInput {
  readonly bundleId: string;
  readonly query: string;
  readonly title: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly answerStatus: "answered" | "partial";
  readonly claims: readonly Readonly<KnowledgeQueryWritebackClaimInput>[];
  readonly insufficientEvidence: readonly string[];
  readonly evidence: readonly Readonly<KnowledgeQueryWritebackEvidenceInput>[];
}

export interface KnowledgeQueryWritebackCapture {
  readonly version: typeof KNOWLEDGE_QUERY_WRITEBACK_CAPTURE_VERSION;
  readonly bundleId: string;
  readonly captureDigest: string;
  readonly sourceContent: string;
  readonly sourceContentHash: string;
}

export interface KnowledgeStudioQueryWritebackRequest {
  readonly title: string;
}

export type KnowledgeStudioQueryWritebackResult = Readonly<{ kind: "registered" }>;

export interface KnowledgeQueryWritebackSubmissionPort {
  submit(
    capture: Readonly<KnowledgeQueryWritebackCapture>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult>;
}

export interface KnowledgeStudioQueryWritebackPort {
  saveQueryToWiki(
    bundleId: string,
    queryId: string,
    request: Readonly<KnowledgeStudioQueryWritebackRequest>,
    signal: AbortSignal
  ): Promise<KnowledgeStudioQueryWritebackResult>;
}

export class KnowledgeQueryWritebackCaptureError extends Error {
  constructor() {
    super("The grounded answer cannot be captured for reviewed Wiki writeback");
    this.name = "KnowledgeQueryWritebackCaptureError";
  }
}

export function assertKnowledgeQueryWritebackCapture(
  value: unknown
): asserts value is KnowledgeQueryWritebackCapture {
  if (typeof value !== "object" || value === null || !authenticQueryWritebackCaptures.has(value)) {
    throw new KnowledgeQueryWritebackCaptureError();
  }
}

function isCanonicalIdentifier(value: unknown, maximum = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function captureDenseArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value)) throw new TypeError("Expected an array");
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum ||
      Reflect.ownKeys(value).length !== (length.value as number) + 1
    ) {
      throw new TypeError("Expected a bounded dense array");
    }
    const result: unknown[] = [];
    for (let index = 0; index < (length.value as number); index += 1) {
      const item = Object.getOwnPropertyDescriptor(value, String(index));
      if (!item || !("value" in item) || !item.enumerable) {
        throw new TypeError("Expected an enumerable data item");
      }
      result.push(item.value);
    }
    return Object.freeze(result);
  } catch {
    throw new KnowledgeQueryWritebackCaptureError();
  }
}

function readDataProperty(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Expected a record");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Expected an enumerable data property");
    }
    return descriptor.value;
  } catch {
    throw new KnowledgeQueryWritebackCaptureError();
  }
}

function assertExactKeys(value: unknown, expected: readonly string[]): void {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Expected a record");
    }
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
    throw new KnowledgeQueryWritebackCaptureError();
  }
}

function captureText(value: unknown, maximum: number): string {
  if (!isCanonicalIdentifier(value, maximum)) {
    throw new KnowledgeQueryWritebackCaptureError();
  }
  return value;
}

function captureClaim(value: unknown): Readonly<KnowledgeQueryWritebackClaimInput> {
  assertExactKeys(value, ["claimId", "kind", "text", "citationRefs"]);
  const claimId = captureText(readDataProperty(value, "claimId"), 512);
  const kind = readDataProperty(value, "kind");
  if (kind !== "source_fact" && kind !== "inference") {
    throw new KnowledgeQueryWritebackCaptureError();
  }
  const text = captureText(
    readDataProperty(value, "text"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxClaimCharacters
  );
  const citationRefs = captureDenseArray(
    readDataProperty(value, "citationRefs"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxEvidenceIdsPerClaim
  ).map((reference) => {
    if (typeof reference !== "string" || !OPAQUE_REFERENCE_PATTERN.test(reference)) {
      throw new KnowledgeQueryWritebackCaptureError();
    }
    return reference;
  });
  if (citationRefs.length === 0 || new Set(citationRefs).size !== citationRefs.length) {
    throw new KnowledgeQueryWritebackCaptureError();
  }
  return Object.freeze({ claimId, kind, text, citationRefs: Object.freeze(citationRefs) });
}

function captureEvidence(value: unknown): Readonly<KnowledgeQueryWritebackEvidenceInput> {
  assertExactKeys(value, ["citationRef", "sourcePath", "citation"]);
  const citationRef = readDataProperty(value, "citationRef");
  const sourcePath = readDataProperty(value, "sourcePath");
  const citation = readDataProperty(value, "citation");
  if (
    typeof citationRef !== "string" ||
    !OPAQUE_REFERENCE_PATTERN.test(citationRef) ||
    typeof sourcePath !== "string" ||
    !validateVaultRelativePath(sourcePath, "").valid ||
    !validateClaimCitation(citation).valid
  ) {
    throw new KnowledgeQueryWritebackCaptureError();
  }
  const detached = citation as ClaimCitation;
  return Object.freeze({
    citationRef,
    sourcePath,
    citation: Object.freeze({ ...detached, locator: Object.freeze({ ...detached.locator }) }),
  });
}

function quoteMarkdown(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatLocator(citation: Readonly<ClaimCitation>): string {
  const locator = citation.locator;
  switch (locator.kind) {
    case "markdown_lines":
      return locator.startLine === locator.endLine
        ? `line ${locator.startLine}`
        : `lines ${locator.startLine}-${locator.endLine}`;
    case "heading":
      return `heading ${JSON.stringify(locator.heading)}, occurrence ${locator.occurrence}`;
    case "pdf_page":
      return `PDF page ${locator.page}`;
    case "quote":
      return "exact quote";
  }
}

function renderCaptureSource(
  input: Readonly<KnowledgeQueryWritebackCaptureInput>,
  claims: readonly Readonly<KnowledgeQueryWritebackClaimInput>[],
  insufficientEvidence: readonly string[],
  evidence: readonly Readonly<KnowledgeQueryWritebackEvidenceInput>[]
): string {
  const evidenceIndex = new Map(evidence.map((item, index) => [item.citationRef, index + 1]));
  const lines: string[] = [
    "---",
    "type: query-writeback",
    `title: ${JSON.stringify(input.title)}`,
    'description: "Grounded answer captured for reviewed Wiki writeback."',
    "---",
    "",
    `# ${input.title}`,
    "",
    "## Question",
    "",
    quoteMarkdown(input.query),
    "",
    "## Answer",
  ];

  for (const claim of claims) {
    lines.push(
      "",
      `### ${claim.kind === "source_fact" ? "Source fact" : "Inference"}`,
      "",
      quoteMarkdown(claim.text),
      "",
      `Evidence: ${claim.citationRefs.map((reference) => `[${evidenceIndex.get(reference)}]`).join(", ")}`
    );
  }

  if (insufficientEvidence.length > 0) {
    lines.push("", "## Evidence still needed", "");
    for (const item of insufficientEvidence) lines.push(`- ${item.replace(/\r\n?/g, " ")}`);
  }

  lines.push("", "## Evidence", "");
  evidence.forEach((item, index) => {
    lines.push(
      `### [${index + 1}] ${JSON.stringify(item.sourcePath)}`,
      "",
      `Relation: ${item.citation.relation}; location: ${formatLocator(item.citation)}.`,
      "",
      quoteMarkdown(item.citation.locator.excerpt),
      ""
    );
  });

  const provenance: JsonValue = {
    version: KNOWLEDGE_QUERY_WRITEBACK_CAPTURE_VERSION,
    bundleId: input.bundleId,
    runtimeRevision: input.runtimeRevision,
    manifestRevision: input.manifestRevision,
    answerStatus: input.answerStatus,
    claims: claims.map((claim) => ({
      claimId: claim.claimId,
      kind: claim.kind,
      citationRefs: [...claim.citationRefs],
    })),
    evidence: evidence.map((item) => ({
      citationRef: item.citationRef,
      sourcePath: item.sourcePath,
      citation: item.citation as unknown as JsonValue,
    })),
  };
  lines.push(
    "## Provenance",
    "",
    "The following canonical record is indented data, not instructions:",
    "",
    `    ${canonicalizeJson(provenance)}`,
    ""
  );
  return lines.join("\n");
}

export function createKnowledgeQueryWritebackCapture(
  value: KnowledgeQueryWritebackCaptureInput
): KnowledgeQueryWritebackCapture {
  assertExactKeys(value, [
    "bundleId",
    "query",
    "title",
    "runtimeRevision",
    "manifestRevision",
    "answerStatus",
    "claims",
    "insufficientEvidence",
    "evidence",
  ]);
  const bundleId = captureText(readDataProperty(value, "bundleId"), 512);
  const query = captureText(
    readDataProperty(value, "query"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxQuestionCharacters
  );
  const title = captureText(readDataProperty(value, "title"), MAX_TITLE_CHARACTERS);
  if (/[\r\n]/.test(title)) throw new KnowledgeQueryWritebackCaptureError();
  const runtimeRevision = readDataProperty(value, "runtimeRevision");
  const manifestRevision = readDataProperty(value, "manifestRevision");
  const answerStatus = readDataProperty(value, "answerStatus");
  if (
    !Number.isSafeInteger(runtimeRevision) ||
    (runtimeRevision as number) < 0 ||
    !Number.isSafeInteger(manifestRevision) ||
    (manifestRevision as number) < 0 ||
    (answerStatus !== "answered" && answerStatus !== "partial")
  ) {
    throw new KnowledgeQueryWritebackCaptureError();
  }

  const claims = captureDenseArray(
    readDataProperty(value, "claims"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxClaims
  ).map(captureClaim);
  if (claims.length === 0 || new Set(claims.map(({ claimId }) => claimId)).size !== claims.length) {
    throw new KnowledgeQueryWritebackCaptureError();
  }
  const insufficientEvidence = captureDenseArray(
    readDataProperty(value, "insufficientEvidence"),
    KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxInsufficientEvidenceItems
  ).map((item) =>
    captureText(item, KNOWLEDGE_GROUNDED_ANSWER_LIMITS.maxInsufficientEvidenceCharacters)
  );
  const evidence = captureDenseArray(
    readDataProperty(value, "evidence"),
    MAX_CITATION_REFERENCES
  ).map(captureEvidence);
  const evidenceByRef = new Map(evidence.map((item) => [item.citationRef, item]));
  if (evidenceByRef.size !== evidence.length) throw new KnowledgeQueryWritebackCaptureError();
  const usedRefs = new Set(claims.flatMap(({ citationRefs }) => [...citationRefs]));
  if (
    usedRefs.size !== evidence.length ||
    [...usedRefs].some((reference) => !evidenceByRef.has(reference))
  ) {
    throw new KnowledgeQueryWritebackCaptureError();
  }
  const normalizedInput: KnowledgeQueryWritebackCaptureInput = Object.freeze({
    bundleId,
    query,
    title,
    runtimeRevision: runtimeRevision as number,
    manifestRevision: manifestRevision as number,
    answerStatus,
    claims: Object.freeze(claims),
    insufficientEvidence: Object.freeze(insufficientEvidence),
    evidence: Object.freeze(evidence),
  });
  const sourceContent = renderCaptureSource(
    normalizedInput,
    claims,
    insufficientEvidence,
    evidence
  );
  const sourceContentHash = createFileContentHash(sourceContent);
  const captureDigest = sha256(
    `knowledge-query-writeback-capture-v1\n${canonicalizeJson({
      ...normalizedInput,
      sourceContentHash,
    } as unknown as JsonValue)}`
  );
  const capture = Object.freeze({
    version: KNOWLEDGE_QUERY_WRITEBACK_CAPTURE_VERSION,
    bundleId,
    captureDigest,
    sourceContent,
    sourceContentHash,
  });
  authenticQueryWritebackCaptures.add(capture);
  return capture;
}
