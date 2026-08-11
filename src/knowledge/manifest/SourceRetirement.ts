import { z } from "zod";

import { canonicalizeJson } from "@/knowledge/model/fingerprint";
import { sourceManifestEntrySchema } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeDiagnostic,
  KnowledgeParseResult,
  SourceManifest,
  SourceManifestEntry,
} from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

/** Reserved Bundle-level Manifest extension containing durable source tombstones. */
export const KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY =
  "obsidianCopilotKnowledgeSourceRetirements" as const;

/** Current strict source-retirement tombstone format. */
export const KNOWLEDGE_SOURCE_RETIREMENT_VERSION = 1 as const;

/** Why an active source identity was explicitly retired. */
export type KnowledgeSourceRetirementReason = "user_requested" | "source_missing";

/**
 * Immutable historical source state retained after the source leaves the active Manifest set.
 *
 * The complete source entry keeps Apply and no-change proofs auditable while
 * `manifest.entries` remains an active-only operational projection.
 */
export interface KnowledgeSourceRetirementRecord {
  version: typeof KNOWLEDGE_SOURCE_RETIREMENT_VERSION;
  retirementId: string;
  bundleId: string;
  requestToken: string;
  reason: KnowledgeSourceRetirementReason;
  retiredAt: number;
  retiredManifestRevision: number;
  source: SourceManifestEntry;
}

/** Input used to create one content-addressed retirement record. */
export interface CreateKnowledgeSourceRetirementRecordInput {
  bundleId: string;
  requestToken: string;
  reason: KnowledgeSourceRetirementReason;
  retiredAt: number;
  retiredManifestRevision: number;
  source: SourceManifestEntry;
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const retirementIdSchema = z.string().regex(/^knowledge-source-retirement-[a-f0-9]{64}$/);
const nonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();

const sourceRetirementRecordSchema: z.ZodType<KnowledgeSourceRetirementRecord> = z
  .object({
    version: z.literal(KNOWLEDGE_SOURCE_RETIREMENT_VERSION),
    retirementId: retirementIdSchema,
    bundleId: nonEmptyStringSchema,
    requestToken: sha256Schema,
    reason: z.enum(["user_requested", "source_missing"]),
    retiredAt: nonNegativeSafeIntegerSchema,
    retiredManifestRevision: z.number().int().safe().positive(),
    source: sourceManifestEntrySchema,
  })
  .strict();

const sourceRetirementRecordsSchema = z.array(sourceRetirementRecordSchema);

/** Converts one Zod issue path to a stable diagnostic field. */
function formatIssuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    const text = String(segment);
    return result ? `${result}.${text}` : text;
  }, "");
}

/** Maps strict tombstone parse failures without retaining rejected values. */
function mapSchemaIssues(error: z.ZodError): KnowledgeDiagnostic[] {
  return error.issues.map((issue) => ({
    code: `source_retirement_schema_${issue.code}`,
    severity: "error" as const,
    field: formatIssuePath(issue.path),
    message: "Source retirement history does not satisfy the strict contract",
  }));
}

/** Returns a detached JSON clone of one strict JSON-compatible value. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Compares identifiers without locale-dependent ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Creates the canonical record core whose digest forms retirementId. */
function createRetirementIdentityCore(
  input: CreateKnowledgeSourceRetirementRecordInput
): Omit<KnowledgeSourceRetirementRecord, "retirementId"> {
  return {
    version: KNOWLEDGE_SOURCE_RETIREMENT_VERSION,
    bundleId: input.bundleId,
    requestToken: input.requestToken,
    reason: input.reason,
    retiredAt: input.retiredAt,
    retiredManifestRevision: input.retiredManifestRevision,
    source: cloneJson(input.source),
  };
}

/** Computes one content-addressed source-retirement identity. */
function createRetirementId(core: Omit<KnowledgeSourceRetirementRecord, "retirementId">): string {
  return `knowledge-source-retirement-${sha256(
    `knowledge-source-retirement-v1\n${canonicalizeJson(core as unknown as JsonValue)}`
  )}`;
}

/**
 * Strictly parses the reserved tombstone extension from one Source Manifest.
 *
 * @param manifest - Strict outer Manifest whose extension bag is inspected
 * @returns Detached retirement records or stable diagnostics
 */
export function parseKnowledgeSourceRetirements(
  manifest: Readonly<SourceManifest>
): KnowledgeParseResult<KnowledgeSourceRetirementRecord[]> {
  const raw = manifest.extensions?.[KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY];
  if (raw === undefined) return { ok: true, value: [] };
  const parsed = sourceRetirementRecordsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: mapSchemaIssues(parsed.error) };
  const records = parsed.data.map((record) => cloneJson(record));
  const retirementIds = new Set<string>();
  const requestTokens = new Set<string>();
  const sourceIds = new Set<string>();
  const sourceKeys = new Set<string>();
  let previousManifestRevision = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const { retirementId: _retirementId, ...core } = record;
    void _retirementId;
    if (
      record.bundleId !== manifest.bundleId ||
      record.retiredManifestRevision > manifest.revision ||
      record.retiredManifestRevision <= previousManifestRevision ||
      retirementIds.has(record.retirementId) ||
      requestTokens.has(record.requestToken) ||
      sourceIds.has(record.source.sourceId) ||
      sourceKeys.has(record.source.sourceKey) ||
      createRetirementId(core) !== record.retirementId
    ) {
      return {
        ok: false,
        issues: [
          {
            code: "source_retirement_identity_invalid",
            severity: "error",
            field: `${KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY}[${index}]`,
            message: "Source retirement history has an invalid durable identity",
          },
        ],
      };
    }
    previousManifestRevision = record.retiredManifestRevision;
    retirementIds.add(record.retirementId);
    requestTokens.add(record.requestToken);
    sourceIds.add(record.source.sourceId);
    sourceKeys.add(record.source.sourceKey);
  }
  return { ok: true, value: records };
}

/**
 * Creates one strict content-addressed retirement tombstone.
 *
 * @param input - Exact source state and retirement commit boundary
 * @returns Detached strict tombstone
 */
export function createKnowledgeSourceRetirementRecord(
  input: CreateKnowledgeSourceRetirementRecordInput
): KnowledgeSourceRetirementRecord {
  const core = createRetirementIdentityCore(input);
  const candidate: KnowledgeSourceRetirementRecord = {
    ...core,
    retirementId: createRetirementId(core),
  };
  const parsed = sourceRetirementRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new TypeError("Source retirement input does not satisfy the strict contract");
  }
  return cloneJson(parsed.data);
}

/**
 * Finds one retired source by stable source identity.
 *
 * @param manifest - Strict Manifest containing protected retirement history
 * @param sourceId - Stable source identifier
 * @returns Detached tombstone, undefined, or a strict parse failure
 */
export function findKnowledgeSourceRetirement(
  manifest: Readonly<SourceManifest>,
  sourceId: string
): KnowledgeSourceRetirementRecord | undefined {
  const parsed = parseKnowledgeSourceRetirements(manifest);
  if (!parsed.ok) {
    throw new TypeError("Source retirement history does not satisfy the strict contract");
  }
  return parsed.value.find((record) => record.source.sourceId === sourceId);
}

/**
 * Returns active and retired history for one source without treating a tombstone as active.
 *
 * @param manifest - Strict current Source Manifest
 * @param sourceId - Stable source identifier
 * @returns Active entry first, otherwise the archived tombstone entry
 */
export function findKnowledgeSourceHistoryEntry(
  manifest: Readonly<SourceManifest>,
  sourceId: string
): SourceManifestEntry | undefined {
  return (
    manifest.entries.find((entry) => entry.sourceId === sourceId) ??
    findKnowledgeSourceRetirement(manifest, sourceId)?.source
  );
}

/**
 * Lists every active and retired source history entry.
 *
 * @param manifest - Strict current Source Manifest
 * @returns Detached entries with active identities first
 */
export function listKnowledgeSourceHistoryEntries(
  manifest: Readonly<SourceManifest>
): SourceManifestEntry[] {
  const parsed = parseKnowledgeSourceRetirements(manifest);
  if (!parsed.ok) {
    throw new TypeError("Source retirement history does not satisfy the strict contract");
  }
  return [
    ...manifest.entries.map((entry) => cloneJson(entry)),
    ...parsed.value.map(({ source }) => source),
  ];
}

/**
 * Moves one active source into protected Bundle retirement history.
 *
 * @param manifest - Exact current Manifest
 * @param record - Tombstone whose revision and source must match the transition
 * @returns Next strict Manifest proposal
 */
export function projectKnowledgeSourceRetirement(
  manifest: Readonly<SourceManifest>,
  record: Readonly<KnowledgeSourceRetirementRecord>
): SourceManifest {
  const active = manifest.entries.filter((entry) => entry.sourceId === record.source.sourceId);
  const parsedRetirements = parseKnowledgeSourceRetirements(manifest);
  if (
    active.length !== 1 ||
    !parsedRetirements.ok ||
    parsedRetirements.value.some(
      (candidate) =>
        candidate.source.sourceId === record.source.sourceId ||
        candidate.source.sourceKey === record.source.sourceKey
    ) ||
    canonicalizeJson(active[0] as unknown as JsonValue) !==
      canonicalizeJson(record.source as unknown as JsonValue) ||
    record.bundleId !== manifest.bundleId ||
    record.retiredManifestRevision !== manifest.revision + 1
  ) {
    throw new TypeError("Source retirement no longer matches the active Manifest");
  }
  const retirements = [...parsedRetirements.value, cloneJson(record)].sort(
    (left, right) =>
      left.retiredManifestRevision - right.retiredManifestRevision ||
      compareText(left.source.sourceId, right.source.sourceId)
  );
  return {
    ...cloneJson(manifest),
    revision: record.retiredManifestRevision,
    entries: manifest.entries
      .filter((entry) => entry.sourceId !== record.source.sourceId)
      .map((entry) => cloneJson(entry)),
    extensions: {
      ...cloneJson(manifest.extensions ?? {}),
      [KNOWLEDGE_SOURCE_RETIREMENTS_EXTENSION_KEY]: retirements as unknown as JsonValue,
    },
  };
}
