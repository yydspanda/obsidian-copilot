import {
  KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS,
  snapshotKnowledgeAppliedWikiPageInspectionRequest,
  type KnowledgeAppliedWikiPageInspectionRequest,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";

/** Fixed UI disclosure and paging limits for retained applied outputs. */
export const KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS = Object.freeze({
  pageSize: 20,
  maxKnownOutputs: 10_000,
  maxVerifiedApplyRecordsPerOrigin: 10_000,
  maxVerifiedApplyRecords: 20_000,
  maxContentCharacters: 2_000_000,
});

/** Canonical Wiki page request shared with the current-page inspector. */
export type KnowledgeKnownAppliedWikiOutputsRequest = KnowledgeAppliedWikiPageInspectionRequest;

/** Exact relationship between the current Vault file and retained Apply truth. */
export type KnowledgeKnownAppliedWikiCurrentState = "applied" | "drifted" | "missing";

/** Display relationship of one retained output to the current/latest state. */
export type KnowledgeKnownAppliedWikiOutputRelation =
  | "current_applied"
  | "latest_known"
  | "earlier_known";

/** One canonical, metadata-only Apply provenance summary for a retained output. */
export interface KnowledgeKnownAppliedWikiOutputOriginSummary {
  readonly kind: "source_apply" | "forward_revision";
  readonly verifiedApplyCount: number;
  readonly newestAppliedAt: number;
  readonly newestManifestRevision: number;
}

/** Honest per-row availability of the narrow forward-proposal UI action. */
export type KnowledgeKnownAppliedWikiOutputProposalCapability =
  | "available"
  | "current_not_applied"
  | "selected_is_current"
  | "forward_origin_not_supported"
  | "detail_too_large";

/** Metadata-only row for one unique, strictly proven retained output. */
export interface KnowledgeKnownAppliedWikiOutputSummary {
  readonly outputRef: string;
  readonly appliedAt: number;
  readonly verifiedApplyCount: number;
  readonly origins: readonly Readonly<KnowledgeKnownAppliedWikiOutputOriginSummary>[];
  readonly relation: KnowledgeKnownAppliedWikiOutputRelation;
  readonly proposalCapability: KnowledgeKnownAppliedWikiOutputProposalCapability;
}

/** One bounded page of retained output metadata. */
export interface KnowledgeKnownAppliedWikiOutputsPage {
  readonly items: readonly Readonly<KnowledgeKnownAppliedWikiOutputSummary>[];
  readonly nextCursor?: string;
}

/** Opaque exact-generation session returned for one canonical Wiki path. */
export interface KnowledgeKnownAppliedWikiOutputsSession extends KnowledgeKnownAppliedWikiOutputsPage {
  readonly pageRef: string;
  readonly displayPagePath: string;
  readonly currentState: KnowledgeKnownAppliedWikiCurrentState;
  readonly currentMatch: "current_applied" | "earlier_known" | "none";
  readonly knownOutputCount: number;
}

/** Lazy, full retained text for one selected strictly proven output. */
export interface KnowledgeKnownAppliedWikiOutputDetail {
  readonly outputRef: string;
  readonly appliedAt: number;
  readonly verifiedApplyCount: number;
  readonly origins: readonly Readonly<KnowledgeKnownAppliedWikiOutputOriginSummary>[];
  readonly proposalCapability: KnowledgeKnownAppliedWikiOutputProposalCapability;
  readonly content: string;
}

/** Exact current-file comparison payload for one retained output. */
export interface KnowledgeKnownAppliedWikiOutputComparison {
  readonly outputRef: string;
  readonly currentState: KnowledgeKnownAppliedWikiCurrentState;
  readonly knownContent: string;
  readonly currentContent: string;
}

/** Closed metadata-page outcome for a generation-bound cursor. */
export type KnowledgeKnownAppliedWikiOutputsPageResult =
  | Readonly<{ kind: "loaded"; value: Readonly<KnowledgeKnownAppliedWikiOutputsPage> }>
  | Readonly<{ kind: "stale" | "unavailable" }>;

/** Closed lazy-detail outcome without internal identities or errors. */
export type KnowledgeKnownAppliedWikiOutputDetailResult =
  | Readonly<{ kind: "loaded"; value: Readonly<KnowledgeKnownAppliedWikiOutputDetail> }>
  | Readonly<{ kind: "stale" | "unavailable" | "too_large" }>;

/** Closed comparison outcome without paths, hashes, or Runtime identities. */
export type KnowledgeKnownAppliedWikiOutputComparisonResult =
  | Readonly<{ kind: "loaded"; value: Readonly<KnowledgeKnownAppliedWikiOutputComparison> }>
  | Readonly<{ kind: "stale" | "unavailable" | "too_large" }>;

/** Stable sanitized failure categories for the initial history inspection. */
export type KnowledgeKnownAppliedWikiOutputsErrorCode =
  | "invalid_request"
  | "not_known"
  | "unavailable";

const errorCodes = new WeakMap<object, KnowledgeKnownAppliedWikiOutputsErrorCode>();
const OPAQUE_REF_PATTERN = /^known-wiki-(?:page|output|cursor)-[a-f0-9]{64}$/;

/** Sanitized initial-inspection failure that retains no path or durable cause. */
export class KnowledgeKnownAppliedWikiOutputsError extends Error {
  /** Creates one authentic closed failure category. */
  constructor(code: KnowledgeKnownAppliedWikiOutputsErrorCode) {
    if (code !== "invalid_request" && code !== "not_known" && code !== "unavailable") {
      throw new TypeError("The known applied Wiki output error code is invalid");
    }
    super("Known applied Wiki outputs could not be inspected");
    this.name = "KnowledgeKnownAppliedWikiOutputsError";
    errorCodes.set(this, code);
    Object.freeze(this);
  }

  /** Returns the authentic hidden failure category. */
  get code(): KnowledgeKnownAppliedWikiOutputsErrorCode {
    const code = errorCodes.get(this);
    if (!code) throw new TypeError("The known applied Wiki output error is invalid");
    return code;
  }
}

/** Returns a code only for an authentic module-minted error. */
export function getKnowledgeKnownAppliedWikiOutputsErrorCode(
  value: unknown
): KnowledgeKnownAppliedWikiOutputsErrorCode | undefined {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== KnowledgeKnownAppliedWikiOutputsError.prototype
    ) {
      return undefined;
    }
    return errorCodes.get(value);
  } catch {
    return undefined;
  }
}

/** Strictly captures one canonical page request without retaining caller objects. */
export function snapshotKnowledgeKnownAppliedWikiOutputsRequest(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputsRequest> {
  try {
    return snapshotKnowledgeAppliedWikiPageInspectionRequest(value);
  } catch {
    throw new KnowledgeKnownAppliedWikiOutputsError("invalid_request");
  }
}

/** Validates one canonical display path inside the R3b error domain. */
function isCanonicalDisplayPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength
  ) {
    return false;
  }
  try {
    return (
      snapshotKnowledgeAppliedWikiPageInspectionRequest({ pagePath: value }).pagePath === value
    );
  } catch {
    return false;
  }
}

/** Reads an exact plain record entirely through own data descriptors. */
function snapshotRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return undefined;
    const permitted = new Set([...requiredKeys, ...optionalKeys]);
    if (
      ownKeys.length < requiredKeys.length ||
      ownKeys.length > requiredKeys.length + optionalKeys.length ||
      requiredKeys.some((key) => !ownKeys.includes(key)) ||
      ownKeys.some((key) => !permitted.has(key as string))
    ) {
      return undefined;
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Captures one dense bounded caller array without invoking element accessors. */
function snapshotArray(value: unknown, maxLength: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maxLength ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Strictly captures canonical per-origin Apply summaries and validates their aggregate. */
function snapshotOrigins(
  value: unknown,
  verifiedApplyCount: number,
  appliedAt: number
): readonly Readonly<KnowledgeKnownAppliedWikiOutputOriginSummary>[] {
  const values = snapshotArray(value, 2);
  if (!values || values.length === 0) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  const origins = values.map((candidate) => {
    const record = snapshotRecord(candidate, [
      "kind",
      "verifiedApplyCount",
      "newestAppliedAt",
      "newestManifestRevision",
    ]);
    if (
      !record ||
      (record.kind !== "source_apply" && record.kind !== "forward_revision") ||
      !Number.isSafeInteger(record.verifiedApplyCount) ||
      Number(record.verifiedApplyCount) < 1 ||
      Number(record.verifiedApplyCount) >
        KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxVerifiedApplyRecordsPerOrigin ||
      !Number.isSafeInteger(record.newestAppliedAt) ||
      Number(record.newestAppliedAt) < 0 ||
      !Number.isSafeInteger(record.newestManifestRevision) ||
      Number(record.newestManifestRevision) < 1
    ) {
      throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
    }
    return Object.freeze({
      kind: record.kind,
      verifiedApplyCount: Number(record.verifiedApplyCount),
      newestAppliedAt: Number(record.newestAppliedAt),
      newestManifestRevision: Number(record.newestManifestRevision),
    });
  });
  const canonicalKinds = origins.map((origin) => origin.kind).join(",");
  if (
    (canonicalKinds !== "source_apply" &&
      canonicalKinds !== "forward_revision" &&
      canonicalKinds !== "source_apply,forward_revision") ||
    origins.reduce((total, origin) => total + origin.verifiedApplyCount, 0) !==
      verifiedApplyCount ||
    Math.max(...origins.map((origin) => origin.newestAppliedAt)) !== appliedAt
  ) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  return Object.freeze(origins);
}

/** Reports whether a capability is coherent with one row relation in isolation. */
function proposalCapabilityMatchesRelation(
  relation: KnowledgeKnownAppliedWikiOutputRelation,
  capability: unknown
): capability is KnowledgeKnownAppliedWikiOutputProposalCapability {
  if (relation === "current_applied") return capability === "selected_is_current";
  if (relation === "latest_known") return capability === "current_not_applied";
  return (
    capability === "available" ||
    capability === "current_not_applied" ||
    capability === "forward_origin_not_supported" ||
    capability === "detail_too_large"
  );
}

/** Strictly captures one metadata row returned by a production delegate. */
function snapshotSummary(value: unknown): Readonly<KnowledgeKnownAppliedWikiOutputSummary> {
  const record = snapshotRecord(value, [
    "outputRef",
    "appliedAt",
    "verifiedApplyCount",
    "origins",
    "relation",
    "proposalCapability",
  ]);
  if (
    !record ||
    typeof record.outputRef !== "string" ||
    !OPAQUE_REF_PATTERN.test(record.outputRef) ||
    !Number.isSafeInteger(record.appliedAt) ||
    (record.appliedAt as number) < 0 ||
    !Number.isSafeInteger(record.verifiedApplyCount) ||
    (record.verifiedApplyCount as number) < 1 ||
    (record.verifiedApplyCount as number) >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxVerifiedApplyRecords ||
    (record.relation !== "current_applied" &&
      record.relation !== "latest_known" &&
      record.relation !== "earlier_known") ||
    !proposalCapabilityMatchesRelation(record.relation, record.proposalCapability)
  ) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  const appliedAt = record.appliedAt as number;
  const verifiedApplyCount = record.verifiedApplyCount as number;
  return Object.freeze({
    outputRef: record.outputRef,
    appliedAt,
    verifiedApplyCount,
    origins: snapshotOrigins(record.origins, verifiedApplyCount, appliedAt),
    relation: record.relation,
    proposalCapability: record.proposalCapability,
  });
}

/** Validates one relation sequence against its explicit page position. */
function pageRelationsAreOrdered(
  items: readonly Readonly<KnowledgeKnownAppliedWikiOutputSummary>[],
  firstPage: boolean
): boolean {
  if (!firstPage) return items.every((item) => item.relation === "earlier_known");
  return items.slice(1).every((item) => item.relation === "earlier_known");
}

/** Strictly captures one bounded metadata page returned by a delegate. */
export function snapshotKnowledgeKnownAppliedWikiOutputsPage(
  value: unknown,
  firstPage = false
): Readonly<KnowledgeKnownAppliedWikiOutputsPage> {
  const record = snapshotRecord(value, ["items"], ["nextCursor"]);
  const values = record
    ? snapshotArray(record.items, KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.pageSize)
    : undefined;
  if (!record || !values) throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  const items = values.map(snapshotSummary);
  const refs = new Set(items.map((item) => item.outputRef));
  if (
    refs.size !== items.length ||
    !pageRelationsAreOrdered(items, firstPage) ||
    (record.nextCursor !== undefined &&
      (typeof record.nextCursor !== "string" || !OPAQUE_REF_PATTERN.test(record.nextCursor)))
  ) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  return Object.freeze({
    items: Object.freeze(items),
    ...(record.nextCursor === undefined ? {} : { nextCursor: record.nextCursor }),
  });
}

/** Strictly captures an exact-generation history session returned by a delegate. */
export function snapshotKnowledgeKnownAppliedWikiOutputsSession(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputsSession> {
  const record = snapshotRecord(
    value,
    ["pageRef", "displayPagePath", "currentState", "currentMatch", "knownOutputCount", "items"],
    ["nextCursor"]
  );
  if (!record) throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  const page = snapshotKnowledgeKnownAppliedWikiOutputsPage(
    Object.freeze({
      items: record.items,
      ...(record.nextCursor === undefined ? {} : { nextCursor: record.nextCursor }),
    }),
    true
  );
  if (
    typeof record.pageRef !== "string" ||
    !OPAQUE_REF_PATTERN.test(record.pageRef) ||
    !isCanonicalDisplayPath(record.displayPagePath) ||
    (record.currentState !== "applied" &&
      record.currentState !== "drifted" &&
      record.currentState !== "missing") ||
    (record.currentMatch !== "current_applied" &&
      record.currentMatch !== "earlier_known" &&
      record.currentMatch !== "none") ||
    (record.currentState === "applied") !== (record.currentMatch === "current_applied") ||
    (record.currentState === "missing" && record.currentMatch !== "none") ||
    !Number.isSafeInteger(record.knownOutputCount) ||
    (record.knownOutputCount as number) < page.items.length ||
    (record.knownOutputCount as number) >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxKnownOutputs ||
    (record.knownOutputCount as number) > page.items.length !== (page.nextCursor !== undefined)
  ) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  const currentAppliedRows = page.items.filter((item) => item.relation === "current_applied");
  const latestKnownRows = page.items.filter((item) => item.relation === "latest_known");
  if (
    currentAppliedRows.length > 1 ||
    latestKnownRows.length > 1 ||
    (record.currentState === "applied" &&
      (page.items.length === 0 || page.items[0]?.relation !== "current_applied")) ||
    (record.currentState !== "applied" && currentAppliedRows.length !== 0) ||
    (record.currentState !== "applied" &&
      page.items.length > 0 &&
      page.items[0]?.relation !== "latest_known") ||
    page.items.some((item) => {
      if (record.currentState !== "applied") {
        return item.proposalCapability !== "current_not_applied";
      }
      if (item.relation === "current_applied") {
        return item.proposalCapability !== "selected_is_current";
      }
      return (
        item.proposalCapability !== "available" &&
        item.proposalCapability !== "forward_origin_not_supported" &&
        item.proposalCapability !== "detail_too_large"
      );
    }) ||
    ((record.knownOutputCount as number) === 0) !== (page.items.length === 0)
  ) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  return Object.freeze({
    pageRef: record.pageRef,
    displayPagePath: record.displayPagePath,
    currentState: record.currentState,
    currentMatch: record.currentMatch,
    knownOutputCount: record.knownOutputCount as number,
    items: page.items,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  });
}

/** Strictly captures one lazy output detail returned by a delegate. */
export function snapshotKnowledgeKnownAppliedWikiOutputDetail(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputDetail> {
  const record = snapshotRecord(value, [
    "outputRef",
    "appliedAt",
    "verifiedApplyCount",
    "origins",
    "proposalCapability",
    "content",
  ]);
  if (
    !record ||
    typeof record.outputRef !== "string" ||
    !OPAQUE_REF_PATTERN.test(record.outputRef) ||
    !Number.isSafeInteger(record.appliedAt) ||
    (record.appliedAt as number) < 0 ||
    !Number.isSafeInteger(record.verifiedApplyCount) ||
    (record.verifiedApplyCount as number) < 1 ||
    (record.verifiedApplyCount as number) >
      KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxVerifiedApplyRecords ||
    (record.proposalCapability !== "available" &&
      record.proposalCapability !== "current_not_applied" &&
      record.proposalCapability !== "selected_is_current" &&
      record.proposalCapability !== "forward_origin_not_supported" &&
      record.proposalCapability !== "detail_too_large") ||
    typeof record.content !== "string" ||
    record.content.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters
  ) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  const appliedAt = record.appliedAt as number;
  const verifiedApplyCount = record.verifiedApplyCount as number;
  return Object.freeze({
    outputRef: record.outputRef,
    appliedAt,
    verifiedApplyCount,
    origins: snapshotOrigins(record.origins, verifiedApplyCount, appliedAt),
    proposalCapability: record.proposalCapability,
    content: record.content,
  });
}

/** Strictly captures one comparison payload returned by a delegate. */
export function snapshotKnowledgeKnownAppliedWikiOutputComparison(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputComparison> {
  const record = snapshotRecord(value, [
    "outputRef",
    "currentState",
    "knownContent",
    "currentContent",
  ]);
  if (
    !record ||
    typeof record.outputRef !== "string" ||
    !OPAQUE_REF_PATTERN.test(record.outputRef) ||
    (record.currentState !== "applied" && record.currentState !== "drifted") ||
    typeof record.knownContent !== "string" ||
    record.knownContent.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters ||
    typeof record.currentContent !== "string" ||
    record.currentContent.length > KNOWLEDGE_KNOWN_APPLIED_WIKI_OUTPUT_LIMITS.maxContentCharacters
  ) {
    throw new KnowledgeKnownAppliedWikiOutputsError("unavailable");
  }
  return Object.freeze({
    outputRef: record.outputRef,
    currentState: record.currentState,
    knownContent: record.knownContent,
    currentContent: record.currentContent,
  });
}

/** Strictly captures one closed metadata-page result. */
export function snapshotKnowledgeKnownAppliedWikiOutputsPageResult(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputsPageResult> {
  const terminal = snapshotRecord(value, ["kind"]);
  if (terminal?.kind === "stale" || terminal?.kind === "unavailable") {
    return Object.freeze({ kind: terminal.kind });
  }
  const loaded = snapshotRecord(value, ["kind", "value"]);
  if (loaded?.kind !== "loaded") {
    return Object.freeze({ kind: "unavailable" as const });
  }
  try {
    return Object.freeze({
      kind: "loaded" as const,
      value: snapshotKnowledgeKnownAppliedWikiOutputsPage(loaded.value),
    });
  } catch {
    return Object.freeze({ kind: "unavailable" as const });
  }
}

/** Strictly captures one closed lazy-detail result. */
export function snapshotKnowledgeKnownAppliedWikiOutputDetailResult(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputDetailResult> {
  const terminal = snapshotRecord(value, ["kind"]);
  if (
    terminal?.kind === "stale" ||
    terminal?.kind === "unavailable" ||
    terminal?.kind === "too_large"
  ) {
    return Object.freeze({ kind: terminal.kind });
  }
  const loaded = snapshotRecord(value, ["kind", "value"]);
  if (loaded?.kind !== "loaded") {
    return Object.freeze({ kind: "unavailable" as const });
  }
  try {
    return Object.freeze({
      kind: "loaded" as const,
      value: snapshotKnowledgeKnownAppliedWikiOutputDetail(loaded.value),
    });
  } catch {
    return Object.freeze({ kind: "unavailable" as const });
  }
}

/** Strictly captures one closed comparison result. */
export function snapshotKnowledgeKnownAppliedWikiOutputComparisonResult(
  value: unknown
): Readonly<KnowledgeKnownAppliedWikiOutputComparisonResult> {
  const terminal = snapshotRecord(value, ["kind"]);
  if (
    terminal?.kind === "stale" ||
    terminal?.kind === "unavailable" ||
    terminal?.kind === "too_large"
  ) {
    return Object.freeze({ kind: terminal.kind });
  }
  const loaded = snapshotRecord(value, ["kind", "value"]);
  if (loaded?.kind !== "loaded") {
    return Object.freeze({ kind: "unavailable" as const });
  }
  try {
    return Object.freeze({
      kind: "loaded" as const,
      value: snapshotKnowledgeKnownAppliedWikiOutputComparison(loaded.value),
    });
  } catch {
    return Object.freeze({ kind: "unavailable" as const });
  }
}

/** Read-only exact-generation port consumed by the Known applied outputs UI. */
export interface KnowledgeKnownAppliedWikiOutputsPort {
  /** Re-proves one path and opens a bounded metadata-only browsing session. */
  inspectKnownOutputs(
    request: Readonly<KnowledgeKnownAppliedWikiOutputsRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsSession>>;

  /** Loads the next metadata page bound to an authentic session and cursor. */
  listMore(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    cursor: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputsPageResult>>;

  /** Lazily re-proves and returns one exact retained output. */
  readOutput(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputDetailResult>>;

  /** Re-proves both sides and returns a read-only current-file comparison payload. */
  compareWithCurrent(
    session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeKnownAppliedWikiOutputComparisonResult>>;
}

Object.freeze(KnowledgeKnownAppliedWikiOutputsError.prototype);
Object.freeze(KnowledgeKnownAppliedWikiOutputsError);
