import { z } from "zod";

import {
  TransactionStorageRevisionConflictError,
  parseChangeSetTransactionJournal,
  validateChangeSetTransactionJournal,
  type ChangeSetTransactionJournal,
  type TransactionStorage,
  type TransactionStorageToken,
} from "@/knowledge/changeset/TransactionStorage";
import type {
  AllocateSourceInputRevisionRequest,
  SourceInputRevisionAllocation,
  SourceInputRevisionAllocator,
} from "@/knowledge/ingest/InputRevisionAllocator";
import {
  IngestQueueRevisionConflictError,
  parseIngestQueueSnapshot,
  validateIngestQueueSnapshot,
  type IngestQueueSnapshot,
  type QueueStorage,
} from "@/knowledge/ingest/queue/QueueStorage";
import {
  SourceManifestRevisionConflictError,
  type SourceManifestStorage,
} from "@/knowledge/manifest/SourceManifestStorage";
import { parseSourceManifest } from "@/knowledge/model/schemas";
import type { SourceManifest } from "@/knowledge/model/types";
import { validateSourceManifest } from "@/knowledge/model/validation";
import {
  ReviewStorageRevisionConflictError,
  parseChangeSetReviewSnapshot,
  validateChangeSetReviewSnapshot,
  type ChangeSetReviewSnapshot,
  type ReviewStorage,
} from "@/knowledge/review/ReviewStorage";
import type { AtomicRuntimeFile } from "@/knowledge/runtime/AtomicRuntimeFile";

/** Current format of the Vault-private atomic knowledge runtime store. */
export const KNOWLEDGE_RUNTIME_STORE_VERSION = 1 as const;

/** One per-Bundle snapshot stored inside the atomic runtime envelope. */
interface KnowledgeRuntimeBundleSlot {
  bundleId: string;
  value: object;
}

/** Latest monotonic observation revision allocated for one source. */
export interface KnowledgeRuntimeInputRevisionRecord {
  sourceId: string;
  inputRevision: number;
}

/** Per-Bundle input-revision namespace retained across application restarts. */
interface KnowledgeRuntimeInputRevisionBundle {
  bundleId: string;
  sources: KnowledgeRuntimeInputRevisionRecord[];
}

/** Exact successful-commit identity reserved for the manifest ledger adapter. */
export interface KnowledgeApplyCommitLedgerRecord {
  transactionId: string;
  commitRevision: number;
  bundleId: string;
  sourceId: string;
  changeSetId: string;
  changeSetDigest: string;
  journalDigest: string;
  receiptDigest: string;
  recordedAt: number;
}

/** Complete strict state committed through one atomic plaintext file. */
export interface KnowledgeRuntimeStoreSnapshot {
  version: typeof KNOWLEDGE_RUNTIME_STORE_VERSION;
  revision: number;
  queues: KnowledgeRuntimeBundleSlot[];
  reviews: KnowledgeRuntimeBundleSlot[];
  manifests: KnowledgeRuntimeBundleSlot[];
  activeTransaction: object | null;
  inputRevisions: KnowledgeRuntimeInputRevisionBundle[];
  applyCommits: KnowledgeApplyCommitLedgerRecord[];
}

type RuntimeBundleCollection = "queues" | "reviews" | "manifests";

interface RuntimeMutation<T> {
  next?: KnowledgeRuntimeStoreSnapshot;
  value: T;
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeSafeIntegerSchema = z.number().int().safe().nonnegative();

const runtimeBundleSlotSchema: z.ZodType<KnowledgeRuntimeBundleSlot> = z
  .object({
    bundleId: nonEmptyStringSchema,
    value: z.record(z.unknown()),
  })
  .strict();

const runtimeInputRevisionRecordSchema: z.ZodType<KnowledgeRuntimeInputRevisionRecord> = z
  .object({
    sourceId: nonEmptyStringSchema,
    inputRevision: z.number().int().safe().positive(),
  })
  .strict();

const runtimeInputRevisionBundleSchema: z.ZodType<KnowledgeRuntimeInputRevisionBundle> = z
  .object({
    bundleId: nonEmptyStringSchema,
    sources: z.array(runtimeInputRevisionRecordSchema),
  })
  .strict();

const applyCommitLedgerRecordSchema: z.ZodType<KnowledgeApplyCommitLedgerRecord> = z
  .object({
    transactionId: nonEmptyStringSchema,
    commitRevision: nonNegativeSafeIntegerSchema,
    bundleId: nonEmptyStringSchema,
    sourceId: nonEmptyStringSchema,
    changeSetId: nonEmptyStringSchema,
    changeSetDigest: sha256Schema,
    journalDigest: sha256Schema,
    receiptDigest: sha256Schema,
    recordedAt: nonNegativeSafeIntegerSchema,
  })
  .strict();

const knowledgeRuntimeStoreSnapshotSchema: z.ZodType<KnowledgeRuntimeStoreSnapshot> = z
  .object({
    version: z.literal(KNOWLEDGE_RUNTIME_STORE_VERSION),
    revision: nonNegativeSafeIntegerSchema,
    queues: z.array(runtimeBundleSlotSchema),
    reviews: z.array(runtimeBundleSlotSchema),
    manifests: z.array(runtimeBundleSlotSchema),
    activeTransaction: z.union([z.record(z.unknown()), z.null()]),
    inputRevisions: z.array(runtimeInputRevisionBundleSchema),
    applyCommits: z.array(applyCommitLedgerRecordSchema),
  })
  .strict();

/** Reports an unreadable, malformed, or semantically torn runtime envelope. */
export class KnowledgeRuntimeStoreCorruptError extends Error {
  /** Creates a sanitized corruption error without retaining persisted content. */
  constructor() {
    super("The durable knowledge runtime store does not satisfy its strict contract");
    this.name = "KnowledgeRuntimeStoreCorruptError";
  }
}

/** Reports a valid envelope containing one invalid subsystem snapshot. */
export class KnowledgeRuntimeSlotValidationError extends Error {
  /**
   * Creates a sanitized invalid-slot error.
   *
   * @param subsystem - Runtime subsystem whose persisted snapshot is invalid
   * @param bundleId - Bundle key used to locate the snapshot
   */
  constructor(
    public readonly subsystem: "queue" | "review" | "manifest" | "transaction",
    public readonly bundleId?: string
  ) {
    super(
      bundleId
        ? `The durable ${subsystem} snapshot for '${bundleId}' is invalid`
        : `The durable ${subsystem} snapshot is invalid`
    );
    this.name = "KnowledgeRuntimeSlotValidationError";
  }
}

/** Reports an atomic-file implementation that returned an uncommitted payload. */
export class KnowledgeRuntimeAtomicWriteError extends Error {
  /** Creates a stable atomic write verification failure. */
  constructor() {
    super("The knowledge runtime atomic file did not confirm the requested replacement");
    this.name = "KnowledgeRuntimeAtomicWriteError";
  }
}

/** Reports a monotonic source revision that can no longer advance exactly. */
export class SourceInputRevisionOverflowError extends Error {
  /**
   * Creates an exact-integer overflow error.
   *
   * @param bundleId - Bundle containing the source namespace
   * @param sourceId - Source whose revision reached the exact integer limit
   */
  constructor(
    public readonly bundleId: string,
    public readonly sourceId: string
  ) {
    super(`Source '${sourceId}' in Bundle '${bundleId}' cannot allocate another input revision`);
    this.name = "SourceInputRevisionOverflowError";
  }
}

/** Creates the first empty strict runtime envelope. */
export function createEmptyKnowledgeRuntimeStoreSnapshot(): KnowledgeRuntimeStoreSnapshot {
  return {
    version: KNOWLEDGE_RUNTIME_STORE_VERSION,
    revision: 0,
    queues: [],
    reviews: [],
    manifests: [],
    activeTransaction: null,
    inputRevisions: [],
    applyCommits: [],
  };
}

/**
 * Strictly parses and semantically validates one unknown runtime envelope.
 *
 * @param value - Unknown parsed JSON value
 * @returns Detached strict runtime snapshot
 */
export function parseKnowledgeRuntimeStoreSnapshot(value: unknown): KnowledgeRuntimeStoreSnapshot {
  const parsed = knowledgeRuntimeStoreSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  const snapshot = parsed.data;
  assertUniqueBundleSlots(snapshot.queues);
  assertUniqueBundleSlots(snapshot.reviews);
  assertUniqueBundleSlots(snapshot.manifests);
  assertUniqueInputRevisionRecords(snapshot.inputRevisions);
  assertUniqueApplyCommits(snapshot.applyCommits);
  assertRuntimeSlotSemantics(snapshot);
  return cloneJson(snapshot);
}

/**
 * Validates every embedded subsystem before any whole-envelope rewrite.
 *
 * @param snapshot - Structurally strict runtime envelope
 */
function assertRuntimeSlotSemantics(snapshot: KnowledgeRuntimeStoreSnapshot): void {
  for (const slot of snapshot.queues) {
    const parsed = parseIngestQueueSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateIngestQueueSnapshot(slot.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  for (const slot of snapshot.reviews) {
    const parsed = parseChangeSetReviewSnapshot(slot.value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  for (const slot of snapshot.manifests) {
    const parsed = parseSourceManifest(slot.value);
    if (
      !parsed.ok ||
      !validateSourceManifest(slot.value).valid ||
      parsed.value.bundleId !== slot.bundleId
    ) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
  if (snapshot.activeTransaction !== null) {
    const parsed = parseChangeSetTransactionJournal(snapshot.activeTransaction);
    if (!parsed.ok || !validateChangeSetTransactionJournal(snapshot.activeTransaction).valid) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
  }
}

/**
 * Rejects duplicate Bundle keys in one runtime collection.
 *
 * @param slots - Strictly shaped Bundle slots
 */
function assertUniqueBundleSlots(slots: readonly KnowledgeRuntimeBundleSlot[]): void {
  const bundleIds = new Set<string>();
  for (const slot of slots) {
    if (bundleIds.has(slot.bundleId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    bundleIds.add(slot.bundleId);
  }
}

/**
 * Rejects duplicate Bundle/source identities in the input revision namespace.
 *
 * @param bundles - Strictly shaped input revision namespaces
 */
function assertUniqueInputRevisionRecords(
  bundles: readonly KnowledgeRuntimeInputRevisionBundle[]
): void {
  const bundleIds = new Set<string>();
  for (const bundle of bundles) {
    if (bundleIds.has(bundle.bundleId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    bundleIds.add(bundle.bundleId);
    const sourceIds = new Set<string>();
    for (const source of bundle.sources) {
      if (sourceIds.has(source.sourceId)) {
        throw new KnowledgeRuntimeStoreCorruptError();
      }
      sourceIds.add(source.sourceId);
    }
  }
}

/**
 * Rejects reuse of one transaction id inside the apply-commit ledger.
 *
 * @param records - Strictly shaped commit ledger records
 */
function assertUniqueApplyCommits(records: readonly KnowledgeApplyCommitLedgerRecord[]): void {
  const transactionIds = new Set<string>();
  for (const record of records) {
    if (transactionIds.has(record.transactionId)) {
      throw new KnowledgeRuntimeStoreCorruptError();
    }
    transactionIds.add(record.transactionId);
  }
}

/**
 * Produces a detached JSON clone and rejects non-JSON input.
 *
 * @param value - JSON-compatible runtime value
 * @returns Detached value with no shared references
 */
function cloneJson<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
}

/**
 * Parses exact runtime file text without exposing parser details or raw bytes.
 *
 * @param text - Complete atomic runtime file contents
 * @returns Detached strict runtime snapshot
 */
function parseRuntimeText(text: string): KnowledgeRuntimeStoreSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return parseKnowledgeRuntimeStoreSnapshot(value);
}

/**
 * Compares identifiers using deterministic code-unit ordering.
 *
 * @param left - First identifier
 * @param right - Second identifier
 * @returns Negative, zero, or positive ordering result
 */
function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Requires a non-empty runtime identifier. */
function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must contain non-whitespace text`);
  }
}

/**
 * Replaces or appends one Bundle slot in deterministic key order.
 *
 * @param slots - Current detached slots
 * @param bundleId - Bundle to replace
 * @param value - Complete replacement value
 * @returns New sorted slot collection
 */
function replaceBundleSlot(
  slots: readonly KnowledgeRuntimeBundleSlot[],
  bundleId: string,
  value: object
): KnowledgeRuntimeBundleSlot[] {
  const replacement = { bundleId, value: cloneJson(value) };
  const exists = slots.some((slot) => slot.bundleId === bundleId);
  return (
    exists
      ? slots.map((slot) => (slot.bundleId === bundleId ? replacement : slot))
      : [...slots, replacement]
  ).sort((left, right) => compareIdentifiers(left.bundleId, right.bundleId));
}

/**
 * Reads one Bundle slot from a detached runtime snapshot.
 *
 * @param state - Strict runtime state
 * @param collection - Queue, review, or manifest namespace
 * @param bundleId - Bundle key
 * @returns Stored unknown JSON or null
 */
function findBundleSlot(
  state: KnowledgeRuntimeStoreSnapshot,
  collection: RuntimeBundleCollection,
  bundleId: string
): object | null {
  return state[collection].find((slot) => slot.bundleId === bundleId)?.value ?? null;
}

/**
 * Returns the next exact global runtime-envelope revision.
 *
 * @param state - Current strict runtime state
 * @returns Next safe integer revision
 */
function nextStoreRevision(state: KnowledgeRuntimeStoreSnapshot): number {
  if (state.revision === Number.MAX_SAFE_INTEGER) {
    throw new KnowledgeRuntimeStoreCorruptError();
  }
  return state.revision + 1;
}

/**
 * Owns one Vault-private atomic envelope and exposes strict subsystem operations.
 */
export class KnowledgeRuntimeStore {
  /** Creates a runtime store over an atomic plaintext-file implementation. */
  constructor(private readonly file: AtomicRuntimeFile) {}

  /** Initializes and validates the durable runtime file without overwriting it. */
  async initialize(): Promise<void> {
    const initial = JSON.stringify(createEmptyKnowledgeRuntimeStoreSnapshot());
    await this.file.initialize(initial);
    await this.readState();
  }

  /** Reads one detached queue snapshot or null. */
  async readQueue(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("queues", bundleId);
  }

  /** Atomically compares and replaces one complete queue snapshot. */
  async writeQueue(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireQueueSnapshot(bundleId, snapshot);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "queue");
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "queues", bundleId);
      const actualRevision =
        currentRaw === null ? null : this.requireQueueSnapshot(bundleId, currentRaw).revision;
      if (actualRevision !== expectedRevision) {
        throw new IngestQueueRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          queues: replaceBundleSlot(state.queues, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  /** Reads one detached review snapshot or null. */
  async readReview(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("reviews", bundleId);
  }

  /** Atomically compares and replaces one complete review snapshot. */
  async writeReview(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireReviewSnapshot(bundleId, snapshot);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "review");
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "reviews", bundleId);
      const actualRevision =
        currentRaw === null ? null : this.requireReviewSnapshot(bundleId, currentRaw).revision;
      if (actualRevision !== expectedRevision) {
        throw new ReviewStorageRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          reviews: replaceBundleSlot(state.reviews, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  /** Reads one detached Source Manifest or null. */
  async readManifest(bundleId: string): Promise<unknown> {
    return this.readBundleSlot("manifests", bundleId);
  }

  /** Atomically compares and replaces one complete Source Manifest. */
  async writeManifest(
    bundleId: string,
    manifest: SourceManifest,
    expectedRevision: number | null
  ): Promise<void> {
    const candidate = this.requireManifest(bundleId, manifest);
    this.assertNextBundleRevision(candidate.revision, expectedRevision, "manifest");
    await this.updateState((state) => {
      const currentRaw = findBundleSlot(state, "manifests", bundleId);
      const actualRevision =
        currentRaw === null ? null : this.requireManifest(bundleId, currentRaw).revision;
      if (actualRevision !== expectedRevision) {
        throw new SourceManifestRevisionConflictError(bundleId, expectedRevision, actualRevision);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          manifests: replaceBundleSlot(state.manifests, bundleId, candidate),
        },
        value: undefined,
      };
    });
  }

  /** Reads the detached Vault-global active transaction journal or null. */
  async readActiveTransaction(): Promise<unknown> {
    const state = await this.readState();
    return state.activeTransaction === null ? null : cloneJson(state.activeTransaction);
  }

  /** Atomically compares and replaces the Vault-global active transaction slot. */
  async writeActiveTransaction(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    const candidate = this.requireTransaction(journal);
    if (expectedToken === null) {
      if (candidate.revision !== 0) {
        throw new TypeError("A new active transaction must begin at revision zero");
      }
    } else if (
      candidate.transactionId !== expectedToken.transactionId ||
      candidate.revision !== expectedToken.revision + 1
    ) {
      throw new TypeError("An active transaction replacement must advance its exact token once");
    }

    await this.updateState((state) => {
      const current =
        state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
      const actualToken = current
        ? { transactionId: current.transactionId, revision: current.revision }
        : null;
      if (!sameTransactionToken(expectedToken, actualToken)) {
        throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          activeTransaction: cloneJson(candidate),
        },
        value: undefined,
      };
    });
  }

  /** Atomically compares and clears the Vault-global active transaction slot. */
  async clearActiveTransaction(expectedToken: TransactionStorageToken): Promise<void> {
    await this.updateState((state) => {
      const current =
        state.activeTransaction === null ? null : this.requireTransaction(state.activeTransaction);
      const actualToken = current
        ? { transactionId: current.transactionId, revision: current.revision }
        : null;
      if (!sameTransactionToken(expectedToken, actualToken)) {
        throw new TransactionStorageRevisionConflictError(expectedToken, actualToken);
      }
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          activeTransaction: null,
        },
        value: undefined,
      };
    });
  }

  /** Atomically allocates one strictly newer per-source observation revision. */
  async allocateInputRevision(
    request: AllocateSourceInputRevisionRequest
  ): Promise<SourceInputRevisionAllocation> {
    this.assertInputRevisionRequest(request);
    return this.updateState<SourceInputRevisionAllocation>((state) => {
      const bundle = state.inputRevisions.find(
        (candidate) => candidate.bundleId === request.bundleId
      );
      const current = bundle?.sources.find((candidate) => candidate.sourceId === request.sourceId);
      if (current?.inputRevision === Number.MAX_SAFE_INTEGER) {
        throw new SourceInputRevisionOverflowError(request.bundleId, request.sourceId);
      }
      const nextRecord: KnowledgeRuntimeInputRevisionRecord = {
        sourceId: request.sourceId,
        inputRevision: current ? current.inputRevision + 1 : 1,
      };
      const nextBundle: KnowledgeRuntimeInputRevisionBundle = {
        bundleId: request.bundleId,
        sources: (bundle
          ? bundle.sources.some((source) => source.sourceId === request.sourceId)
            ? bundle.sources.map((source) =>
                source.sourceId === request.sourceId ? nextRecord : source
              )
            : [...bundle.sources, nextRecord]
          : [nextRecord]
        ).sort((left, right) => compareIdentifiers(left.sourceId, right.sourceId)),
      };
      const inputRevisions = (
        bundle
          ? state.inputRevisions.map((candidate) =>
              candidate.bundleId === request.bundleId ? nextBundle : candidate
            )
          : [...state.inputRevisions, nextBundle]
      ).sort((left, right) => compareIdentifiers(left.bundleId, right.bundleId));
      return {
        next: {
          ...state,
          revision: nextStoreRevision(state),
          inputRevisions,
        },
        value: { inputRevision: nextRecord.inputRevision },
      };
    });
  }

  /** Reads and clones one subsystem Bundle slot. */
  private async readBundleSlot(
    collection: RuntimeBundleCollection,
    bundleId: string
  ): Promise<unknown> {
    assertIdentifier(bundleId, "bundleId");
    const value = findBundleSlot(await this.readState(), collection, bundleId);
    return value === null ? null : cloneJson(value);
  }

  /** Reads and strictly validates the complete atomic runtime envelope. */
  private async readState(): Promise<KnowledgeRuntimeStoreSnapshot> {
    return parseRuntimeText(await this.file.read());
  }

  /** Runs one synchronous state transform through the atomic file boundary. */
  private async updateState<T>(
    transform: (state: KnowledgeRuntimeStoreSnapshot) => RuntimeMutation<T>
  ): Promise<T> {
    let callbackCalled = false;
    let expectedText: string | undefined;
    let result: T | undefined;
    const committedText = await this.file.process((currentText) => {
      if (callbackCalled) {
        throw new KnowledgeRuntimeAtomicWriteError();
      }
      callbackCalled = true;
      const current = parseRuntimeText(currentText);
      const mutation = transform(current);
      result = mutation.value;
      if (!mutation.next) {
        expectedText = currentText;
        return currentText;
      }
      const next = parseKnowledgeRuntimeStoreSnapshot(mutation.next);
      expectedText = JSON.stringify(next);
      return expectedText;
    });
    if (!callbackCalled || expectedText === undefined || committedText !== expectedText) {
      throw new KnowledgeRuntimeAtomicWriteError();
    }
    parseRuntimeText(committedText);
    return result as T;
  }

  /** Strictly parses and validates one queue slot. */
  private requireQueueSnapshot(bundleId: string, value: unknown): IngestQueueSnapshot {
    const parsed = parseIngestQueueSnapshot(value);
    const validation = validateIngestQueueSnapshot(value);
    if (!parsed.ok || !validation.valid || parsed.value.bundleId !== bundleId) {
      throw new KnowledgeRuntimeSlotValidationError("queue", bundleId);
    }
    return cloneJson(parsed.value);
  }

  /** Strictly parses and validates one review slot. */
  private requireReviewSnapshot(bundleId: string, value: unknown): ChangeSetReviewSnapshot {
    const parsed = parseChangeSetReviewSnapshot(value);
    if (
      !parsed.ok ||
      !validateChangeSetReviewSnapshot(parsed.value).valid ||
      parsed.value.bundleId !== bundleId
    ) {
      throw new KnowledgeRuntimeSlotValidationError("review", bundleId);
    }
    return cloneJson(parsed.value);
  }

  /** Strictly parses and validates one Source Manifest slot. */
  private requireManifest(bundleId: string, value: unknown): SourceManifest {
    const parsed = parseSourceManifest(value);
    const validation = validateSourceManifest(value);
    if (!parsed.ok || !validation.valid || parsed.value.bundleId !== bundleId) {
      throw new KnowledgeRuntimeSlotValidationError("manifest", bundleId);
    }
    return cloneJson(parsed.value);
  }

  /** Strictly parses and validates the active transaction slot. */
  private requireTransaction(value: unknown): ChangeSetTransactionJournal {
    const parsed = parseChangeSetTransactionJournal(value);
    const validation = validateChangeSetTransactionJournal(value);
    if (!parsed.ok || !validation.valid) {
      throw new KnowledgeRuntimeSlotValidationError("transaction");
    }
    return cloneJson(parsed.value);
  }

  /** Requires a Bundle snapshot to advance its observed revision exactly once. */
  private assertNextBundleRevision(
    candidateRevision: number,
    expectedRevision: number | null,
    subsystem: "queue" | "review" | "manifest"
  ): void {
    const nextRevision = expectedRevision === null ? 1 : expectedRevision + 1;
    if (
      expectedRevision === Number.MAX_SAFE_INTEGER ||
      candidateRevision !== nextRevision ||
      !Number.isSafeInteger(candidateRevision)
    ) {
      throw new TypeError(`${subsystem} snapshot must advance its observed revision exactly once`);
    }
  }

  /** Validates one allocation request before touching durable state. */
  private assertInputRevisionRequest(request: AllocateSourceInputRevisionRequest): void {
    assertIdentifier(request.bundleId, "bundleId");
    assertIdentifier(request.sourceId, "sourceId");
  }
}

/** Compares nullable active-transaction tokens field by field. */
function sameTransactionToken(
  left: TransactionStorageToken | null,
  right: TransactionStorageToken | null
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.transactionId === right.transactionId &&
      left.revision === right.revision)
  );
}

/** QueueStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeQueueStorage implements QueueStorage {
  /** Creates a queue facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads one detached queue snapshot. */
  read(bundleId: string): Promise<unknown> {
    return this.runtime.readQueue(bundleId);
  }

  /** Atomically compares and replaces one queue snapshot. */
  write(
    bundleId: string,
    snapshot: IngestQueueSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    return this.runtime.writeQueue(bundleId, snapshot, expectedRevision);
  }
}

/** ReviewStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeReviewStorage implements ReviewStorage {
  /** Creates a review facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads one detached review snapshot. */
  read(bundleId: string): Promise<unknown> {
    return this.runtime.readReview(bundleId);
  }

  /** Atomically compares and replaces one review snapshot. */
  write(
    bundleId: string,
    snapshot: ChangeSetReviewSnapshot,
    expectedRevision: number | null
  ): Promise<void> {
    return this.runtime.writeReview(bundleId, snapshot, expectedRevision);
  }
}

/** SourceManifestStorage facade backed by one shared atomic runtime envelope. */
export class KnowledgeRuntimeManifestStorage implements SourceManifestStorage {
  /** Creates a manifest facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads one detached Source Manifest. */
  read(bundleId: string): Promise<unknown> {
    return this.runtime.readManifest(bundleId);
  }

  /** Atomically compares and replaces one Source Manifest. */
  write(
    bundleId: string,
    manifest: SourceManifest,
    expectedRevision: number | null
  ): Promise<void> {
    return this.runtime.writeManifest(bundleId, manifest, expectedRevision);
  }
}

/** TransactionStorage facade backed by one shared Vault-global atomic slot. */
export class KnowledgeRuntimeTransactionStorage implements TransactionStorage {
  /** Creates a transaction facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Reads the detached active transaction journal. */
  readActive(): Promise<unknown> {
    return this.runtime.readActiveTransaction();
  }

  /** Atomically compares and replaces the active transaction journal. */
  writeActive(
    journal: ChangeSetTransactionJournal,
    expectedToken: TransactionStorageToken | null
  ): Promise<void> {
    return this.runtime.writeActiveTransaction(journal, expectedToken);
  }

  /** Atomically compares and clears the active transaction journal. */
  clearActive(expectedToken: TransactionStorageToken): Promise<void> {
    return this.runtime.clearActiveTransaction(expectedToken);
  }
}

/** Input-revision allocator facade backed by the shared atomic envelope. */
export class KnowledgeRuntimeInputRevisionAllocator implements SourceInputRevisionAllocator {
  /** Creates an allocator facade over the shared runtime store. */
  constructor(private readonly runtime: KnowledgeRuntimeStore) {}

  /** Allocates one strictly newer source observation revision. */
  allocate(request: AllocateSourceInputRevisionRequest): Promise<SourceInputRevisionAllocation> {
    return this.runtime.allocateInputRevision(request);
  }
}
