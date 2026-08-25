import type { ClaimCitation, SourceCustody } from "@/knowledge/model/types";
import { parseVaultPath, toWindowsPathKey } from "@/knowledge/paths/vaultPath";
import {
  createKnowledgeReviewEvidenceProjection,
  type KnowledgeReviewEvidenceSummary,
} from "@/knowledge/review/KnowledgeReviewEvidence";
import { validateClaimCitation } from "@/knowledge/model/validation";
import {
  snapshotKnowledgeAppliedWikiEffectivePageHead,
  type KnowledgeAppliedWikiEffectivePageHead,
} from "@/knowledge/query/KnowledgeAppliedWikiEffectivePageHead";
import type {
  KnowledgeRuntimeAppliedPageProvenance,
  KnowledgeRuntimeAppliedSourceProvenance,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";
import {
  KNOWLEDGE_APPLIED_WIKI_EVIDENCE_SCOPE,
  KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS,
  getKnowledgeAppliedWikiPageInspectorErrorCode,
  KnowledgeAppliedWikiPageInspectorError,
  type KnowledgeAppliedWikiPageInspectionSession,
  type KnowledgeAppliedWikiSourceSummary,
} from "@/knowledge/wiki/KnowledgeAppliedWikiPageInspectorPort";
import { sha256 } from "@/utils/hash";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PAGE_REF_NAMESPACE = "knowledge-applied-wiki-page-v1";
const SOURCE_REF_NAMESPACE = "knowledge-applied-wiki-source-v1";
const EVIDENCE_REF_NAMESPACE = "knowledge-applied-wiki-evidence-v1";
const MAX_AUTHORITY_SOURCES = 256;
const MAX_AUTHORITY_EVIDENCE_PER_SOURCE = 4_096;
const MAX_TOTAL_AUTHORITY_EVIDENCE = 8_192;
const MAX_AUTHORITY_STRING_CHARACTERS = 2_000_000;
const MAX_TOTAL_AUTHORITY_CHARACTERS = 8_000_000;

/** Stable Runtime authority already obtained through a Runtime/Vault/Runtime reproof. */
export interface KnowledgeAppliedWikiPageProjectionAuthority {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly page: Readonly<KnowledgeRuntimeAppliedPageProvenance>;
}

/** Private exact authority recovered only from an authentic projected session. */
export interface KnowledgeAppliedWikiEvidenceAuthority {
  readonly bundleId: string;
  readonly runtimeRevision: number;
  readonly manifestRevision: number;
  readonly pagePath: string;
  readonly windowsPathKey: string;
  readonly pageContentHash: string;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly custody: SourceCustody;
  readonly sourceContentHash: string;
  readonly pipelineFingerprint: string;
  readonly inputRevision: number;
  readonly changeSetId: string;
  readonly changeSetDigest: string;
  readonly acceptedAt: number;
  readonly citation: Readonly<ClaimCitation>;
}

interface ProjectedSessionBinding {
  readonly evidenceByRef: ReadonlyMap<string, Readonly<KnowledgeAppliedWikiEvidenceAuthority>>;
}

const projectorStates = new WeakMap<object, WeakMap<object, Readonly<ProjectedSessionBinding>>>();

/** Creates one sanitized projector failure. */
function createProjectionError(): KnowledgeAppliedWikiPageInspectorError {
  return new KnowledgeAppliedWikiPageInspectorError("unavailable");
}

/** Reports whether one identifier is canonical and bounded. */
function isIdentifier(value: unknown, maxLength = 1_024): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

/** Reports whether one integer is a safe non-negative revision or time. */
function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Reads an exact plain data record without invoking any property accessors. */
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
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Snapshots one dense bounded array without reading indexed getters. */
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

/** Snapshots one exact locator variant before semantic validation. */
function snapshotLocator(value: unknown): Readonly<ClaimCitation["locator"]> | undefined {
  const kindDescriptor =
    typeof value === "object" && value !== null
      ? Object.getOwnPropertyDescriptor(value, "kind")
      : undefined;
  if (!kindDescriptor || !("value" in kindDescriptor) || !kindDescriptor.enumerable) {
    return undefined;
  }
  const base = ["kind", "sourceId", "artifactId", "artifactContentHash", "excerpt", "quoteHash"];
  const keys =
    kindDescriptor.value === "markdown_lines"
      ? [...base, "startLine", "endLine"]
      : kindDescriptor.value === "heading"
        ? [...base, "heading", "occurrence"]
        : kindDescriptor.value === "pdf_page"
          ? [...base, "page"]
          : kindDescriptor.value === "quote"
            ? base
            : undefined;
  if (!keys) return undefined;
  const optionalKeys =
    kindDescriptor.value === "markdown_lines"
      ? ["heading"]
      : kindDescriptor.value === "quote"
        ? ["prefix", "suffix"]
        : [];
  let record = readExactRecord(value, keys);
  if (!record) {
    for (let mask = 1; mask < 1 << optionalKeys.length; mask += 1) {
      const present = optionalKeys.filter((_key, index) => (mask & (1 << index)) !== 0);
      record = readExactRecord(value, [...keys, ...present]);
      if (record) break;
    }
  }
  if (!record) return undefined;
  if (
    typeof record.kind !== "string" ||
    typeof record.sourceId !== "string" ||
    typeof record.artifactId !== "string" ||
    typeof record.artifactContentHash !== "string" ||
    typeof record.excerpt !== "string" ||
    typeof record.quoteHash !== "string"
  ) {
    return undefined;
  }
  if (
    record.kind === "markdown_lines" &&
    (!Number.isSafeInteger(record.startLine) ||
      (record.startLine as number) < 1 ||
      !Number.isSafeInteger(record.endLine) ||
      (record.endLine as number) < 1 ||
      (record.heading !== undefined && typeof record.heading !== "string"))
  ) {
    return undefined;
  }
  if (
    record.kind === "heading" &&
    (typeof record.heading !== "string" ||
      !Number.isSafeInteger(record.occurrence) ||
      (record.occurrence as number) < 1)
  ) {
    return undefined;
  }
  if (
    record.kind === "pdf_page" &&
    (!Number.isSafeInteger(record.page) || (record.page as number) < 1)
  ) {
    return undefined;
  }
  if (
    record.kind === "quote" &&
    ((record.prefix !== undefined && typeof record.prefix !== "string") ||
      (record.suffix !== undefined && typeof record.suffix !== "string"))
  ) {
    return undefined;
  }
  return Object.freeze({ ...record }) as Readonly<ClaimCitation["locator"]>;
}

/** Snapshots and semantically validates one citation against its exact Source artifact. */
function snapshotCitation(
  value: unknown,
  sourceId: string,
  sourceContentHash: string,
  remainingCharacters: number
): Readonly<{ citation: Readonly<ClaimCitation>; characters: number }> | undefined {
  const record = readExactRecord(value, ["citationId", "claimId", "relation", "locator"]);
  const locator = record ? snapshotLocator(record.locator) : undefined;
  if (
    !record ||
    !locator ||
    typeof record.citationId !== "string" ||
    typeof record.claimId !== "string" ||
    (record.relation !== "supports" &&
      record.relation !== "contradicts" &&
      record.relation !== "context")
  ) {
    return undefined;
  }
  const citation = Object.freeze({
    citationId: record.citationId,
    claimId: record.claimId,
    relation: record.relation,
    locator,
  }) as Readonly<ClaimCitation>;
  if (!citationStringsAreBounded(citation)) return undefined;
  const characters = countCitationCharacters(citation);
  if (
    !Number.isSafeInteger(characters) ||
    characters > remainingCharacters ||
    !validateClaimCitation(citation).valid ||
    citation.locator.sourceId !== sourceId ||
    citation.locator.artifactContentHash !== sourceContentHash
  ) {
    return undefined;
  }
  return Object.freeze({ citation, characters });
}

/** Counts every citation string behind the UI projection within a fixed total budget. */
function countCitationCharacters(citation: Readonly<ClaimCitation>): number {
  const locator = citation.locator;
  let total =
    citation.citationId.length +
    citation.claimId.length +
    citation.relation.length +
    locator.kind.length +
    locator.sourceId.length +
    locator.artifactId.length +
    locator.artifactContentHash.length +
    locator.excerpt.length +
    locator.quoteHash.length;
  if (locator.kind === "markdown_lines") total += locator.heading?.length ?? 0;
  if (locator.kind === "heading") total += locator.heading.length;
  if (locator.kind === "quote")
    total += (locator.prefix?.length ?? 0) + (locator.suffix?.length ?? 0);
  return total;
}

/** Rejects any single hidden citation string that could bypass aggregate resource bounds. */
function citationStringsAreBounded(citation: Readonly<ClaimCitation>): boolean {
  const locator = citation.locator;
  const values = [
    citation.citationId,
    citation.claimId,
    citation.relation,
    locator.kind,
    locator.sourceId,
    locator.artifactId,
    locator.artifactContentHash,
    locator.excerpt,
    locator.quoteHash,
    ...(locator.kind === "markdown_lines" ? [locator.heading ?? ""] : []),
    ...(locator.kind === "heading" ? [locator.heading] : []),
    ...(locator.kind === "quote" ? [locator.prefix ?? "", locator.suffix ?? ""] : []),
  ];
  return values.every((value) => value.length <= MAX_AUTHORITY_STRING_CHARACTERS);
}

/** Snapshots every field of one contributing Source authority. */
function snapshotSource(
  value: unknown,
  remainingEvidence: number,
  remainingCharacters: number
):
  | Readonly<{
      source: Readonly<KnowledgeRuntimeAppliedSourceProvenance>;
      characters: number;
    }>
  | undefined {
  const record = readExactRecord(value, [
    "sourceId",
    "sourcePath",
    "custody",
    "sourceContentHash",
    "pipelineFingerprint",
    "inputRevision",
    "changeSetId",
    "changeSetDigest",
    "acceptedAt",
    "citations",
  ]);
  if (!record) return undefined;
  const parsedSourcePath =
    typeof record.sourcePath === "string" &&
    record.sourcePath.length <= KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength
      ? parseVaultPath(record.sourcePath)
      : undefined;
  const citationValues = snapshotDenseArray(
    record.citations,
    Math.min(MAX_AUTHORITY_EVIDENCE_PER_SOURCE, remainingEvidence)
  );
  if (
    !isIdentifier(record.sourceId) ||
    !parsedSourcePath?.ok ||
    parsedSourcePath.path !== record.sourcePath ||
    parsedSourcePath.path.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength ||
    (record.custody !== "user_managed" && record.custody !== "managed_copy") ||
    typeof record.sourceContentHash !== "string" ||
    !SHA256_PATTERN.test(record.sourceContentHash) ||
    typeof record.pipelineFingerprint !== "string" ||
    !SHA256_PATTERN.test(record.pipelineFingerprint) ||
    !isNonNegativeInteger(record.inputRevision) ||
    !isIdentifier(record.changeSetId) ||
    typeof record.changeSetDigest !== "string" ||
    !SHA256_PATTERN.test(record.changeSetDigest) ||
    !isNonNegativeInteger(record.acceptedAt) ||
    !citationValues
  ) {
    return undefined;
  }
  let characters =
    record.sourceId.length +
    parsedSourcePath.path.length +
    (record.custody as string).length +
    record.sourceContentHash.length +
    record.pipelineFingerprint.length +
    record.changeSetId.length +
    record.changeSetDigest.length;
  if (characters > remainingCharacters) return undefined;
  const citations: Readonly<ClaimCitation>[] = [];
  const citationIds = new Set<string>();
  for (const citationValue of citationValues) {
    const captured = snapshotCitation(
      citationValue,
      record.sourceId,
      record.sourceContentHash,
      remainingCharacters - characters
    );
    if (!captured || citationIds.has(captured.citation.citationId)) return undefined;
    citationIds.add(captured.citation.citationId);
    citations.push(captured.citation);
    characters += captured.characters;
  }
  return Object.freeze({
    source: Object.freeze({
      sourceId: record.sourceId,
      sourcePath: parsedSourcePath.path,
      custody: record.custody,
      sourceContentHash: record.sourceContentHash,
      pipelineFingerprint: record.pipelineFingerprint,
      inputRevision: record.inputRevision,
      changeSetId: record.changeSetId,
      changeSetDigest: record.changeSetDigest,
      acceptedAt: record.acceptedAt,
      citations: Object.freeze(citations),
    }),
    characters,
  });
}

/** Creates a descriptor-safe detached authority snapshot for all Sources and citations. */
export function snapshotKnowledgeAppliedWikiPageProjectionAuthority(
  value: unknown
): Readonly<KnowledgeAppliedWikiPageProjectionAuthority> {
  const authority = readExactRecord(value, [
    "bundleId",
    "runtimeRevision",
    "manifestRevision",
    "page",
  ]);
  const page = authority
    ? readExactRecord(authority.page, [
        "path",
        "windowsPathKey",
        "ownership",
        "sourceAppliedContentHash",
        "effectiveContentHash",
        "contentHash",
        "origin",
        "sources",
      ])
    : undefined;
  const sourceValues = page ? snapshotDenseArray(page.sources, MAX_AUTHORITY_SOURCES) : undefined;
  const parsedPagePath =
    page &&
    typeof page.path === "string" &&
    page.path.length <= KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength
      ? parseVaultPath(page.path)
      : undefined;
  if (
    !authority ||
    !page ||
    !isIdentifier(authority.bundleId) ||
    !isNonNegativeInteger(authority.runtimeRevision) ||
    !isNonNegativeInteger(authority.manifestRevision) ||
    !parsedPagePath?.ok ||
    parsedPagePath.path !== page.path ||
    parsedPagePath.path.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength ||
    typeof page.windowsPathKey !== "string" ||
    page.windowsPathKey.length > KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxDisplayPathLength ||
    page.windowsPathKey !== toWindowsPathKey(parsedPagePath.path) ||
    (page.ownership !== "generated" && page.ownership !== "shared" && page.ownership !== "user") ||
    !sourceValues ||
    sourceValues.length === 0
  ) {
    throw createProjectionError();
  }
  const sources: Readonly<KnowledgeRuntimeAppliedSourceProvenance>[] = [];
  const sourceIds = new Set<string>();
  let totalEvidence = 0;
  let totalCharacters = 0;
  for (const sourceValue of sourceValues) {
    const captured = snapshotSource(
      sourceValue,
      MAX_TOTAL_AUTHORITY_EVIDENCE - totalEvidence,
      MAX_TOTAL_AUTHORITY_CHARACTERS - totalCharacters
    );
    if (!captured) throw createProjectionError();
    const source = captured.source;
    if (sourceIds.has(source.sourceId)) throw createProjectionError();
    sourceIds.add(source.sourceId);
    totalEvidence += source.citations.length;
    totalCharacters += captured.characters;
    if (
      !Number.isSafeInteger(totalCharacters) ||
      totalCharacters > MAX_TOTAL_AUTHORITY_CHARACTERS
    ) {
      throw createProjectionError();
    }
    sources.push(source);
  }
  let head: Readonly<KnowledgeAppliedWikiEffectivePageHead>;
  try {
    head = snapshotKnowledgeAppliedWikiEffectivePageHead(
      {
        sourceAppliedContentHash: page.sourceAppliedContentHash,
        effectiveContentHash: page.effectiveContentHash,
        contentHash: page.contentHash,
        origin: page.origin,
      },
      {
        bundleId: authority.bundleId,
        pagePath: parsedPagePath.path,
        windowsPathKey: page.windowsPathKey,
        ownership: page.ownership,
        sourceIds: sources.map((source) => source.sourceId),
      }
    );
  } catch {
    throw createProjectionError();
  }
  return Object.freeze({
    bundleId: authority.bundleId,
    runtimeRevision: authority.runtimeRevision,
    manifestRevision: authority.manifestRevision,
    page: Object.freeze({
      path: parsedPagePath.path,
      windowsPathKey: page.windowsPathKey,
      ownership: page.ownership,
      ...head,
      sources: Object.freeze(sources),
    }),
  });
}

/** Creates a page-version-bound opaque reference without disclosing its inputs. */
function createPageRef(authority: KnowledgeAppliedWikiPageProjectionAuthority): string {
  return sha256(
    [
      PAGE_REF_NAMESPACE,
      authority.bundleId,
      authority.page.windowsPathKey,
      authority.page.effectiveContentHash,
      String(authority.runtimeRevision),
      String(authority.manifestRevision),
    ].join("\n")
  );
}

/** Creates one page-bound opaque contributing-Source reference. */
function createSourceRef(
  pageRef: string,
  source: Readonly<KnowledgeRuntimeAppliedSourceProvenance>
): string {
  return sha256(
    [
      SOURCE_REF_NAMESPACE,
      pageRef,
      source.sourceId,
      source.sourceContentHash,
      source.changeSetDigest,
      String(source.inputRevision),
    ].join("\n")
  );
}

/** Rebinds a Review evidence ref to one exact page and contributing Source. */
function createEvidenceRef(pageRef: string, sourceRef: string, reviewEvidenceRef: string): string {
  return sha256([EVIDENCE_REF_NAMESPACE, pageRef, sourceRef, reviewEvidenceRef].join("\n"));
}

/** Creates one detached private evidence authority. */
function createEvidenceAuthority(
  authority: KnowledgeAppliedWikiPageProjectionAuthority,
  source: Readonly<KnowledgeRuntimeAppliedSourceProvenance>,
  citation: Readonly<ClaimCitation>
): Readonly<KnowledgeAppliedWikiEvidenceAuthority> {
  return Object.freeze({
    bundleId: authority.bundleId,
    runtimeRevision: authority.runtimeRevision,
    manifestRevision: authority.manifestRevision,
    pagePath: authority.page.path,
    windowsPathKey: authority.page.windowsPathKey,
    pageContentHash: authority.page.effectiveContentHash,
    sourceId: source.sourceId,
    sourcePath: source.sourcePath,
    custody: source.custody,
    sourceContentHash: source.sourceContentHash,
    pipelineFingerprint: source.pipelineFingerprint,
    inputRevision: source.inputRevision,
    changeSetId: source.changeSetId,
    changeSetDigest: source.changeSetDigest,
    acceptedAt: source.acceptedAt,
    citation,
  });
}

/** Returns hidden projector state only for an authentic instance. */
function requireSessionBindings(
  projector: unknown
): WeakMap<object, Readonly<ProjectedSessionBinding>> {
  if (
    typeof projector !== "object" ||
    projector === null ||
    Object.getPrototypeOf(projector) !== KnowledgeAppliedWikiPageInspectionProjector.prototype
  ) {
    throw createProjectionError();
  }
  const bindings = projectorStates.get(projector);
  if (!bindings) throw createProjectionError();
  return bindings;
}

/**
 * Projects stable current-page provenance while retaining actionable evidence in WeakMap state.
 *
 * The class is intentionally not a general-purpose DTO verifier. Only sessions
 * created by this exact projector instance can recover private evidence authority.
 */
export class KnowledgeAppliedWikiPageInspectionProjector {
  /** Creates one empty projector-owned capability namespace. */
  constructor() {
    projectorStates.set(this, new WeakMap());
    Object.freeze(this);
  }

  /** Creates a bounded frozen UI session from one already re-proved page authority. */
  project(
    authorityValue: KnowledgeAppliedWikiPageProjectionAuthority
  ): Readonly<KnowledgeAppliedWikiPageInspectionSession> {
    const sessionBindings = requireSessionBindings(this);
    try {
      const authority = snapshotKnowledgeAppliedWikiPageProjectionAuthority(authorityValue);
      const pageRef = createPageRef(authority);
      const evidenceByRef = new Map<string, Readonly<KnowledgeAppliedWikiEvidenceAuthority>>();
      let evidenceRemaining = KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxEvidence;
      const visibleSources = authority.page.sources.slice(
        0,
        KNOWLEDGE_APPLIED_WIKI_INSPECTION_LIMITS.maxSources
      );
      const sources = visibleSources.map((source): Readonly<KnowledgeAppliedWikiSourceSummary> => {
        const sourceRef = createSourceRef(pageRef, source);
        const reviewProjection = createKnowledgeReviewEvidenceProjection(
          source.citations,
          source.changeSetDigest
        );
        const visibleEvidence = reviewProjection.evidence.slice(0, evidenceRemaining);
        evidenceRemaining -= visibleEvidence.length;
        const evidence = visibleEvidence.map(
          (summary, index): Readonly<KnowledgeReviewEvidenceSummary> => {
            const citation = source.citations[index];
            const evidenceRef = createEvidenceRef(pageRef, sourceRef, summary.evidenceRef);
            if (evidenceByRef.has(evidenceRef) || !citation) throw createProjectionError();
            evidenceByRef.set(evidenceRef, createEvidenceAuthority(authority, source, citation));
            return Object.freeze({
              evidenceRef,
              relation: summary.relation,
              excerpt: summary.excerpt,
              truncated: summary.truncated,
              location: summary.location,
            });
          }
        );
        return Object.freeze({
          sourceRef,
          displaySourcePath: source.sourcePath,
          custody: source.custody,
          acceptedAt: source.acceptedAt,
          evidence: Object.freeze(evidence),
          omittedEvidenceCount: source.citations.length - evidence.length,
        });
      });
      const session = Object.freeze({
        pageRef,
        displayPagePath: authority.page.path,
        ownership: authority.page.ownership,
        sourceAppliedContentHash: authority.page.sourceAppliedContentHash,
        effectiveContentHash: authority.page.effectiveContentHash,
        origin: authority.page.origin,
        evidenceScope: KNOWLEDGE_APPLIED_WIKI_EVIDENCE_SCOPE,
        sources: Object.freeze(sources),
        omittedSourceCount: authority.page.sources.length - sources.length,
      });
      sessionBindings.set(
        session,
        Object.freeze({
          evidenceByRef: evidenceByRef,
        })
      );
      return session;
    } catch (error) {
      const code = getKnowledgeAppliedWikiPageInspectorErrorCode(error);
      throw code === undefined
        ? createProjectionError()
        : new KnowledgeAppliedWikiPageInspectorError(code);
    }
  }

  /** Resolves private authority only from this projector's exact authentic session. */
  resolveEvidence(
    session: Readonly<KnowledgeAppliedWikiPageInspectionSession>,
    evidenceRef: string
  ): Readonly<KnowledgeAppliedWikiEvidenceAuthority> | undefined {
    if (!SHA256_PATTERN.test(evidenceRef)) return undefined;
    try {
      const binding =
        typeof session === "object" && session !== null
          ? requireSessionBindings(this).get(session)
          : undefined;
      return binding?.evidenceByRef.get(evidenceRef);
    } catch {
      return undefined;
    }
  }
}

Object.freeze(KnowledgeAppliedWikiPageInspectionProjector.prototype);
Object.freeze(KnowledgeAppliedWikiPageInspectionProjector);
