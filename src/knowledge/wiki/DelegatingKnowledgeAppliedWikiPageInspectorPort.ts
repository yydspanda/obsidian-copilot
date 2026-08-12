import { parseVaultPath } from "@/knowledge/paths/vaultPath";
import { KNOWLEDGE_REVIEW_EVIDENCE_LIMITS } from "@/knowledge/review/KnowledgeReviewEvidence";
import {
  KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS,
  getKnowledgeAppliedWikiPageInspectorErrorCode,
  KnowledgeAppliedWikiPageInspectorError,
  snapshotKnowledgeAppliedWikiPageInspectionRequest,
  type KnowledgeAppliedWikiEvidenceOpenResult,
  type KnowledgeAppliedWikiPageInspectionRequest,
  type KnowledgeAppliedWikiPageInspectionSession,
  type KnowledgeAppliedWikiPageInspectorPort,
  type KnowledgeAppliedWikiSourceSummary,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STALE_RESULT = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });

interface CapturedInspectorDelegate {
  readonly owner: object;
  inspectPage(
    request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiPageInspectionSession>>;
  openEvidence(
    session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
    evidenceRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>>;
}

interface InspectorGeneration {
  readonly delegate: CapturedInspectorDelegate;
  readonly abortController: AbortController;
}

interface SessionBinding {
  readonly generation: InspectorGeneration;
  readonly delegateSession: Readonly<KnowledgeAppliedWikiPageInspectionSession>;
  readonly evidenceRefs: ReadonlySet<string>;
}

interface LinkedAbortSignal {
  readonly signal: AbortSignal;
  release(): void;
}

interface DelegatingInspectorState {
  readonly unavailable: KnowledgeAppliedWikiPageInspectorPort;
  sessionBindings: WeakMap<object, Readonly<SessionBinding>>;
  generation: InspectorGeneration;
  disposed: boolean;
}

const delegatingInspectorStates = new WeakMap<object, DelegatingInspectorState>();

/** Explicit fail-closed delegate used before and between production generations. */
class UnavailableKnowledgeAppliedWikiPageInspectorPort
  implements KnowledgeAppliedWikiPageInspectorPort
{
  /** Rejects inspection while no released production generation owns it. */
  async inspectPage(): Promise<Readonly<KnowledgeAppliedWikiPageInspectionSession>> {
    throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
  }

  /** Reports a value-free unavailable result when no generation is installed. */
  async openEvidence(): Promise<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>> {
    return UNAVAILABLE_RESULT;
  }
}

/** Creates the platform-standard cancellation category without retaining a reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reads an exact own enumerable data record without invoking accessors. */
function readExactRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      !expectedKeys.every((key) => keys.includes(key))
    ) {
      return undefined;
    }
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      copy[key] = descriptor.value;
    }
    return Object.freeze(copy);
  } catch {
    return undefined;
  }
}

/** Snapshots a dense bounded array without invoking indexed property accessors. */
function snapshotDenseArray(value: unknown, maxLength: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maxLength
    ) {
      return undefined;
    }
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      !keys.includes("length") ||
      keys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
      )
    ) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Reports whether one number is a safe non-negative integer. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Reports whether one number is a safe positive integer. */
function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

/** Captures one display-only Review location summary. */
function snapshotLocation(
  value: unknown
): KnowledgeAppliedWikiSourceSummary["evidence"][number]["location"] | undefined {
  const kindRecord = readExactRecord(value, ["kind"]);
  if (kindRecord?.kind === "quote") return Object.freeze({ kind: "quote" as const });

  const pdf = readExactRecord(value, ["kind", "page"]);
  if (pdf?.kind === "pdf_page" && isPositiveInteger(pdf.page)) {
    return Object.freeze({ kind: "pdf_page" as const, page: pdf.page });
  }

  const heading = readExactRecord(value, ["kind", "heading", "headingTruncated", "occurrence"]);
  if (
    heading?.kind === "heading" &&
    typeof heading.heading === "string" &&
    heading.heading.length <= KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxHeadingLength &&
    typeof heading.headingTruncated === "boolean" &&
    isPositiveInteger(heading.occurrence)
  ) {
    return Object.freeze({
      kind: "heading" as const,
      heading: heading.heading,
      headingTruncated: heading.headingTruncated,
      occurrence: heading.occurrence,
    });
  }

  const lines =
    readExactRecord(value, ["kind", "startLine", "endLine"]) ??
    readExactRecord(value, ["kind", "startLine", "endLine", "heading", "headingTruncated"]);
  if (
    lines?.kind !== "markdown_lines" ||
    !isPositiveInteger(lines.startLine) ||
    !isPositiveInteger(lines.endLine) ||
    lines.endLine < lines.startLine
  ) {
    return undefined;
  }
  if (!("heading" in lines)) {
    return Object.freeze({
      kind: "markdown_lines" as const,
      startLine: lines.startLine,
      endLine: lines.endLine,
    });
  }
  if (
    typeof lines.heading !== "string" ||
    lines.heading.length > KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxHeadingLength ||
    typeof lines.headingTruncated !== "boolean"
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: "markdown_lines" as const,
    startLine: lines.startLine,
    endLine: lines.endLine,
    heading: lines.heading,
    headingTruncated: lines.headingTruncated,
  });
}

/** Captures one bounded display-only evidence summary. */
function snapshotEvidence(
  value: unknown
): KnowledgeAppliedWikiSourceSummary["evidence"][number] | undefined {
  const record = readExactRecord(value, [
    "evidenceRef",
    "relation",
    "excerpt",
    "truncated",
    "location",
  ]);
  const location = record ? snapshotLocation(record.location) : undefined;
  if (
    !record ||
    typeof record.evidenceRef !== "string" ||
    !SHA256_PATTERN.test(record.evidenceRef) ||
    (record.relation !== "supports" &&
      record.relation !== "contradicts" &&
      record.relation !== "context") ||
    typeof record.excerpt !== "string" ||
    record.excerpt.length > KNOWLEDGE_REVIEW_EVIDENCE_LIMITS.maxExcerptLength ||
    typeof record.truncated !== "boolean" ||
    !location
  ) {
    return undefined;
  }
  return Object.freeze({
    evidenceRef: record.evidenceRef,
    relation: record.relation,
    excerpt: record.excerpt,
    truncated: record.truncated,
    location,
  });
}

/** Captures one bounded display-only Source summary within the remaining page evidence budget. */
function snapshotSource(
  value: unknown,
  maxEvidence: number
): Readonly<KnowledgeAppliedWikiSourceSummary> | undefined {
  const record = readExactRecord(value, [
    "sourceRef",
    "displaySourcePath",
    "custody",
    "acceptedAt",
    "evidence",
    "omittedEvidenceCount",
  ]);
  if (
    !record ||
    typeof record.sourceRef !== "string" ||
    !SHA256_PATTERN.test(record.sourceRef) ||
    typeof record.displaySourcePath !== "string" ||
    record.displaySourcePath.length >
      KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength ||
    !parseVaultPath(record.displaySourcePath).ok ||
    (record.custody !== "user_managed" && record.custody !== "managed_copy") ||
    !isNonNegativeInteger(record.acceptedAt) ||
    !isNonNegativeInteger(record.omittedEvidenceCount)
  ) {
    return undefined;
  }
  const evidenceValues = snapshotDenseArray(record.evidence, maxEvidence);
  if (!evidenceValues) return undefined;
  const evidence = evidenceValues.map(snapshotEvidence);
  if (evidence.some((item) => item === undefined)) return undefined;
  return Object.freeze({
    sourceRef: record.sourceRef,
    displaySourcePath: record.displaySourcePath,
    custody: record.custody,
    acceptedAt: record.acceptedAt,
    evidence: Object.freeze(evidence as Readonly<KnowledgeAppliedWikiSourceSummary["evidence"]>),
    omittedEvidenceCount: record.omittedEvidenceCount,
  });
}

/** Strictly snapshots a delegate DTO for display; this does not authenticate it for opening. */
function snapshotDelegateSession(
  value: unknown
): Readonly<KnowledgeAppliedWikiPageInspectionSession> | undefined {
  const record = readExactRecord(value, [
    "pageRef",
    "displayPagePath",
    "ownership",
    "sources",
    "omittedSourceCount",
  ]);
  if (
    !record ||
    typeof record.pageRef !== "string" ||
    !SHA256_PATTERN.test(record.pageRef) ||
    typeof record.displayPagePath !== "string" ||
    record.displayPagePath.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength ||
    !parseVaultPath(record.displayPagePath).ok ||
    (record.ownership !== "generated" &&
      record.ownership !== "shared" &&
      record.ownership !== "user") ||
    !isNonNegativeInteger(record.omittedSourceCount)
  ) {
    return undefined;
  }
  const sourceValues = snapshotDenseArray(
    record.sources,
    KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxSources
  );
  if (!sourceValues || sourceValues.length === 0) return undefined;
  const sources: Readonly<KnowledgeAppliedWikiSourceSummary>[] = [];
  const sourceRefs = new Set<string>();
  const evidenceRefs = new Set<string>();
  for (const sourceValue of sourceValues) {
    const source = snapshotSource(
      sourceValue,
      KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxEvidence - evidenceRefs.size
    );
    if (!source) return undefined;
    if (sourceRefs.has(source.sourceRef)) return undefined;
    sourceRefs.add(source.sourceRef);
    for (const evidence of source.evidence) {
      if (evidenceRefs.has(evidence.evidenceRef)) return undefined;
      evidenceRefs.add(evidence.evidenceRef);
    }
    sources.push(source);
  }
  return Object.freeze({
    pageRef: record.pageRef,
    displayPagePath: record.displayPagePath,
    ownership: record.ownership,
    sources: Object.freeze(sources),
    omittedSourceCount: record.omittedSourceCount,
  });
}

/** Captures a value-free navigation result without invoking accessors. */
function snapshotOpenResult(value: unknown): Readonly<KnowledgeAppliedWikiEvidenceOpenResult> {
  const record = readExactRecord(value, ["kind"]);
  switch (record?.kind) {
    case "opened":
      return Object.freeze({ kind: "opened" as const });
    case "stale":
      return STALE_RESULT;
    case "unsupported":
      return Object.freeze({ kind: "unsupported" as const });
    case "unavailable":
    default:
      return UNAVAILABLE_RESULT;
  }
}

/** Finds a data method on one delegate/prototype chain without invoking getters. */
function captureMethod(value: object, name: string): ((...args: unknown[]) => unknown) | undefined {
  try {
    let owner: object | null = value;
    const visited = new Set<object>();
    while (owner !== null && visited.size < 64) {
      if (visited.has(owner)) return undefined;
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (descriptor)
        return "value" in descriptor && typeof descriptor.value === "function"
          ? (descriptor.value as (...args: unknown[]) => unknown)
          : undefined;
      owner = Object.getPrototypeOf(owner) as object | null;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Captures an inspector delegate without retaining accessor-based capabilities. */
function captureDelegate(value: KnowledgeAppliedWikiPageInspectorPort): CapturedInspectorDelegate {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
  }
  const inspectPage = captureMethod(value, "inspectPage");
  const openEvidence = captureMethod(value, "openEvidence");
  if (!inspectPage || !openEvidence) {
    throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
  }
  return Object.freeze({
    owner: value,
    inspectPage: (
      request: Readonly<KnowledgeAppliedWikiPageInspectionRequest>,
      signal: AbortSignal
    ) =>
      Promise.resolve(
        Reflect.apply(inspectPage, value, [request, signal]) as Promise<
          Readonly<KnowledgeAppliedWikiPageInspectionSession>
        >
      ),
    openEvidence: (
      session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
      evidenceRef: string,
      signal: AbortSignal
    ) =>
      Promise.resolve(
        Reflect.apply(openEvidence, value, [session, evidenceRef, signal]) as Promise<
          Readonly<KnowledgeAppliedWikiEvidenceOpenResult>
        >
      ),
  });
}

/** Links caller and generation cancellation with deterministic listener cleanup. */
function linkAbortSignals(signals: readonly AbortSignal[]): LinkedAbortSignal {
  const controller = new AbortController();
  const listeners: Array<Readonly<{ signal: AbortSignal; listener: () => void }>> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    const listener = (): void => controller.abort();
    signal.addEventListener("abort", listener, { once: true });
    listeners.push(Object.freeze({ signal, listener }));
  }
  return Object.freeze({
    signal: controller.signal,
    release: () => {
      for (const { signal, listener } of listeners) signal.removeEventListener("abort", listener);
    },
  });
}

/** Recreates only recognized value-free failures at the stable boundary. */
function sanitizeInspectionError(error: unknown): Error {
  const code = getKnowledgeAppliedWikiPageInspectorErrorCode(error);
  if (code !== undefined) return new KnowledgeAppliedWikiPageInspectorError(code);
  return new KnowledgeAppliedWikiPageInspectorError("unavailable");
}

/** Races one delegate promise against cancellation and always removes its race listener. */
async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw createAbortError();
  let rejectAborted: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = (): void => reject(createAbortError());
    signal.addEventListener("abort", rejectAborted, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (rejectAborted) signal.removeEventListener("abort", rejectAborted);
  }
}

/** Creates one separately cancellable captured delegate generation. */
function createGeneration(delegate: KnowledgeAppliedWikiPageInspectorPort): InspectorGeneration {
  return Object.freeze({
    delegate: captureDelegate(delegate),
    abortController: new AbortController(),
  });
}

/** Returns hidden state only for one authentic stable wrapper instance. */
function requireDelegatingInspectorState(value: unknown): DelegatingInspectorState {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== DelegatingKnowledgeAppliedWikiPageInspectorPort.prototype
  ) {
    throw createAbortError();
  }
  const state = delegatingInspectorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/**
 * Stable Wiki-inspector boundary whose authentic sessions are generation-revocable.
 *
 * Delegate sessions are never exposed. The wrapper snapshots display DTOs and
 * binds their exact identities back to the delegate generation in a WeakMap.
 */
export class DelegatingKnowledgeAppliedWikiPageInspectorPort
  implements KnowledgeAppliedWikiPageInspectorPort
{
  /** Creates a frozen stable wrapper in an explicit unavailable generation. */
  constructor() {
    const unavailable = Object.freeze(new UnavailableKnowledgeAppliedWikiPageInspectorPort());
    delegatingInspectorStates.set(this, {
      unavailable,
      sessionBindings: new WeakMap(),
      generation: createGeneration(unavailable),
      disposed: false,
    });
    Object.freeze(this);
  }

  /** Atomically installs a new delegate and aborts every old in-flight read. */
  replaceDelegate(delegate: KnowledgeAppliedWikiPageInspectorPort): void {
    const state = requireDelegatingInspectorState(this);
    if (state.disposed) throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
    const replacement = createGeneration(delegate);
    state.generation.abortController.abort();
    state.sessionBindings = new WeakMap();
    state.generation = replacement;
  }

  /** Publishes the explicit unavailable generation without disposing the wrapper. */
  setUnavailable(): void {
    const state = requireDelegatingInspectorState(this);
    if (state.disposed) return;
    this.replaceDelegate(state.unavailable);
  }

  /** Revokes a delegate only if that exact owner is still current. */
  revokeDelegate(delegate: KnowledgeAppliedWikiPageInspectorPort): void {
    const state = requireDelegatingInspectorState(this);
    if (state.disposed || state.generation.delegate.owner !== delegate) return;
    this.setUnavailable();
  }

  /** Permanently revokes the wrapper and all session/open work. */
  dispose(): void {
    const state = requireDelegatingInspectorState(this);
    if (state.disposed) return;
    state.disposed = true;
    state.generation.abortController.abort();
    state.sessionBindings = new WeakMap();
    state.generation = createGeneration(state.unavailable);
  }

  /** Routes one strict page request through exactly one delegate generation. */
  async inspectPage(
    requestValue: Readonly<KnowledgeAppliedWikiPageInspectionRequest>,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiPageInspectionSession>> {
    const state = requireDelegatingInspectorState(this);
    const request = snapshotKnowledgeAppliedWikiPageInspectionRequest(requestValue);
    const generation = state.generation;
    const linked = linkAbortSignals([signal, generation.abortController.signal]);
    try {
      if (state.disposed || linked.signal.aborted) throw createAbortError();
      const delegated = generation.delegate.inspectPage(request, linked.signal);
      const delegateSession = await raceWithAbort(delegated, linked.signal);
      if (state.disposed || generation !== state.generation || linked.signal.aborted) {
        throw createAbortError();
      }
      const session = snapshotDelegateSession(delegateSession);
      if (!session) throw new KnowledgeAppliedWikiPageInspectorError("unavailable");
      const evidenceRefs = new Set(
        session.sources.flatMap((source) => source.evidence.map((item) => item.evidenceRef))
      );
      state.sessionBindings.set(
        session,
        Object.freeze({ generation, delegateSession, evidenceRefs })
      );
      return session;
    } catch (error) {
      if (state.disposed || generation !== state.generation || linked.signal.aborted) {
        throw createAbortError();
      }
      throw sanitizeInspectionError(error);
    } finally {
      linked.release();
    }
  }

  /** Opens only evidence bound to one exact authentic wrapper session. */
  async openEvidence(
    session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
    evidenceRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeAppliedWikiEvidenceOpenResult>> {
    const state = requireDelegatingInspectorState(this);
    const generation = state.generation;
    const binding =
      typeof session === "object" && session !== null
        ? state.sessionBindings.get(session)
        : undefined;
    if (
      !binding ||
      binding.generation !== generation ||
      typeof evidenceRef !== "string" ||
      !SHA256_PATTERN.test(evidenceRef) ||
      !binding.evidenceRefs.has(evidenceRef)
    ) {
      return STALE_RESULT;
    }
    const linked = linkAbortSignals([signal, generation.abortController.signal]);
    try {
      if (state.disposed || linked.signal.aborted) throw createAbortError();
      const delegated = generation.delegate.openEvidence(
        binding.delegateSession,
        evidenceRef,
        linked.signal
      );
      const result = await raceWithAbort(delegated, linked.signal);
      if (state.disposed || generation !== state.generation || linked.signal.aborted) {
        throw createAbortError();
      }
      return snapshotOpenResult(result);
    } catch {
      if (state.disposed || generation !== state.generation || linked.signal.aborted) {
        throw createAbortError();
      }
      return UNAVAILABLE_RESULT;
    } finally {
      linked.release();
    }
  }
}

Object.freeze(DelegatingKnowledgeAppliedWikiPageInspectorPort.prototype);
Object.freeze(DelegatingKnowledgeAppliedWikiPageInspectorPort);
