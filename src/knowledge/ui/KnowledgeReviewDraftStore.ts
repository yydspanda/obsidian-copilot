import {
  isValidKnowledgeReviewManualEditText,
  KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS,
  type KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";

/** One explicit, session-local decision retained for an exact Review snapshot. */
export type KnowledgeReviewLocalDecision =
  | { kind: "accept_exact" }
  | { kind: "reject" }
  | { kind: "accept_edited"; afterContent: string }
  | {
      kind: "accept_blocks";
      blocks: Readonly<Record<string, "accept" | "reject">>;
    };

/** File decisions retained only for the lifetime of one Studio controller session. */
export type KnowledgeReviewDraftState = Readonly<
  Record<string, Readonly<KnowledgeReviewLocalDecision> | undefined>
>;

/** One bounded active textarea retained across tab and popout-root remounts. */
export interface KnowledgeReviewActiveEdit {
  changeId: string;
  afterContent: string;
}

interface KnowledgeReviewDraftEntry {
  decisions: KnowledgeReviewDraftState;
  activeEdit?: Readonly<KnowledgeReviewActiveEdit>;
}

/** Exact identity that prevents drafts crossing proposal or snapshot generations. */
export interface KnowledgeReviewDraftIdentity {
  bundleId: string;
  changeSetId: string;
  proposalDigest: string;
  snapshotToken: string;
}

const EMPTY_REVIEW_DRAFT: KnowledgeReviewDraftState = Object.freeze({});

/** Creates an unambiguous in-memory key from exact Review identity fields. */
function createDraftKey(identity: Readonly<KnowledgeReviewDraftIdentity>): string {
  return JSON.stringify([
    identity.bundleId,
    identity.changeSetId,
    identity.proposalDigest,
    identity.snapshotToken,
  ]);
}

/** Reads own enumerable data properties without invoking value accessors. */
function readPlainDataRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

/** Reads one record only when it has the exact allowed data keys. */
function readExactDataRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  const record = readPlainDataRecord(value);
  if (!record) return undefined;
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
    ? record
    : undefined;
}

/** Strictly snapshots one file decision against its current plan projection. */
function snapshotDecision(
  file: Readonly<KnowledgeReviewPlan["files"][number]>,
  value: unknown
): Readonly<KnowledgeReviewLocalDecision> {
  const base = readExactDataRecord(value, ["kind"]);
  if (base?.kind === "reject") return Object.freeze({ kind: "reject" });
  if (base?.kind === "accept_exact" && file.capability !== "reject_only") {
    return Object.freeze({ kind: "accept_exact" });
  }

  const edited = readExactDataRecord(value, ["kind", "afterContent"]);
  if (
    edited?.kind === "accept_edited" &&
    typeof edited.afterContent === "string" &&
    file.operation !== "delete" &&
    file.capability !== "reject_only" &&
    typeof file.afterContent === "string" &&
    edited.afterContent.length <= KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile &&
    isValidKnowledgeReviewManualEditText(edited.afterContent)
  ) {
    return Object.freeze({ kind: "accept_edited", afterContent: edited.afterContent });
  }

  const partial = readExactDataRecord(value, ["kind", "blocks"]);
  const blocks = readPlainDataRecord(partial?.blocks);
  const changedBlockIds = new Set(
    file.blocks.filter((block) => block.kind === "change").map((block) => block.blockId)
  );
  if (
    partial?.kind === "accept_blocks" &&
    file.capability === "blocks_allowed" &&
    blocks &&
    Object.keys(blocks).length <= changedBlockIds.size &&
    Object.entries(blocks).every(
      ([blockId, decision]) =>
        changedBlockIds.has(blockId) && (decision === "accept" || decision === "reject")
    )
  ) {
    return Object.freeze({
      kind: "accept_blocks",
      blocks: Object.freeze({ ...(blocks as Record<string, "accept" | "reject">) }),
    });
  }
  throw new TypeError("Knowledge Review draft decision is invalid");
}

/** Strictly detaches a complete draft against current file and block identities. */
function snapshotDraft(
  plan: Readonly<KnowledgeReviewPlan>,
  value: unknown
): KnowledgeReviewDraftState {
  const draft = readPlainDataRecord(value);
  if (!draft || Object.keys(draft).length > plan.files.length) {
    throw new TypeError("Knowledge Review draft is invalid");
  }
  const files = new Map(plan.files.map((file) => [file.changeId, file]));
  const detached: Record<string, Readonly<KnowledgeReviewLocalDecision>> = {};
  let totalEditedCharacters = 0;
  Object.entries(draft).forEach(([changeId, value]) => {
    const file = files.get(changeId);
    if (!file) throw new TypeError("Knowledge Review draft change is invalid");
    const decision = snapshotDecision(file, value);
    if (decision.kind === "accept_edited") {
      totalEditedCharacters += decision.afterContent.length;
      if (totalEditedCharacters > KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxTotalCharacters) {
        throw new RangeError("Knowledge Review edits exceed the total session limit");
      }
    }
    detached[changeId] = decision;
  });
  return Object.freeze(detached);
}

/** Strictly snapshots one current eligible active editor without invoking accessors. */
function snapshotActiveEdit(
  plan: Readonly<KnowledgeReviewPlan>,
  value: unknown
): Readonly<KnowledgeReviewActiveEdit> {
  const activeEdit = readExactDataRecord(value, ["changeId", "afterContent"]);
  const file = plan.files.find((candidate) => candidate.changeId === activeEdit?.changeId);
  if (
    activeEdit &&
    typeof activeEdit.afterContent === "string" &&
    activeEdit.afterContent.length > KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile
  ) {
    throw new RangeError("Knowledge Review active edit exceeds the per-file session limit");
  }
  if (
    !activeEdit ||
    !file ||
    typeof activeEdit.changeId !== "string" ||
    typeof activeEdit.afterContent !== "string" ||
    file.operation === "delete" ||
    file.capability === "reject_only" ||
    typeof file.afterContent !== "string" ||
    activeEdit.afterContent.length > KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile
  ) {
    throw new TypeError("Knowledge Review active edit is invalid");
  }
  return Object.freeze({
    changeId: activeEdit.changeId,
    afterContent: activeEdit.afterContent,
  });
}

/** Counts every physically retained content string in one exact draft entry. */
function getEditedCharacterCount(
  draft: KnowledgeReviewDraftState,
  activeEdit?: Readonly<KnowledgeReviewActiveEdit>
): number {
  let total = activeEdit?.afterContent.length ?? 0;
  Object.values(draft).forEach((decision) => {
    if (decision?.kind === "accept_edited") {
      total += decision.afterContent.length;
    }
  });
  return total;
}

/** Counts retained content once for one exact-identity entry. */
function getEntryEditedCharacterCount(entry: Readonly<KnowledgeReviewDraftEntry>): number {
  return getEditedCharacterCount(entry.decisions, entry.activeEdit);
}

/** Returns whether one saved decision exactly commits the retained active buffer. */
function commitsActiveEdit(
  draft: KnowledgeReviewDraftState,
  activeEdit?: Readonly<KnowledgeReviewActiveEdit>
): boolean {
  if (!activeEdit) return false;
  const decision = draft[activeEdit.changeId];
  return decision?.kind === "accept_edited" && decision.afterContent === activeEdit.afterContent;
}

/** Returns whether one exact entry contains any user decision or active text. */
function hasRetainedDraftState(entry: Readonly<KnowledgeReviewDraftEntry>): boolean {
  return entry.activeEdit !== undefined || Object.keys(entry.decisions).length > 0;
}

/** Creates exact controller-session draft identity for one current plan. */
export function createKnowledgeReviewDraftIdentity(
  bundleId: string,
  plan: Readonly<KnowledgeReviewPlan>
): KnowledgeReviewDraftIdentity {
  return Object.freeze({
    bundleId,
    changeSetId: plan.changeSetId,
    proposalDigest: plan.proposalDigest,
    snapshotToken: plan.snapshotToken,
  });
}

/**
 * Data-only session store for saved Review decisions and committed manual edits.
 *
 * Bounded active textarea buffers and committed decisions survive React and tab
 * remounts, but are reconciled against exact durable Review identities.
 */
export class KnowledgeReviewDraftStore {
  private readonly drafts = new Map<string, KnowledgeReviewDraftEntry>();

  /** Rejects a replacement whose aggregate controller-session content exceeds 8M. */
  private assertAggregateWithinLimit(key: string, replacement: KnowledgeReviewDraftEntry): void {
    let total = getEntryEditedCharacterCount(replacement);
    for (const [candidateKey, entry] of this.drafts) {
      if (candidateKey !== key) total += getEntryEditedCharacterCount(entry);
      if (total > KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxTotalCharacters) {
        throw new RangeError("Knowledge Review drafts exceed the controller-session limit");
      }
    }
  }

  /** Reads a saved draft for one exact identity, or a shared immutable empty draft. */
  read(identity: Readonly<KnowledgeReviewDraftIdentity>): KnowledgeReviewDraftState {
    return this.drafts.get(createDraftKey(identity))?.decisions ?? EMPTY_REVIEW_DRAFT;
  }

  /** Reads one bounded active edit for the exact Review identity. */
  readActiveEdit(
    identity: Readonly<KnowledgeReviewDraftIdentity>
  ): Readonly<KnowledgeReviewActiveEdit> | undefined {
    return this.drafts.get(createDraftKey(identity))?.activeEdit;
  }

  /** Replaces one exact draft with a detached immutable snapshot. */
  write(
    identity: Readonly<KnowledgeReviewDraftIdentity>,
    plan: Readonly<KnowledgeReviewPlan>,
    draft: unknown
  ): KnowledgeReviewDraftState {
    const snapshot = snapshotDraft(plan, draft);
    const key = createDraftKey(identity);
    const current = this.drafts.get(key);
    const retainedActiveEdit = commitsActiveEdit(snapshot, current?.activeEdit)
      ? undefined
      : current?.activeEdit;
    const replacement = { decisions: snapshot, activeEdit: retainedActiveEdit };
    this.assertAggregateWithinLimit(key, replacement);
    if (hasRetainedDraftState(replacement)) {
      this.drafts.set(key, replacement);
    } else {
      this.drafts.delete(key);
    }
    return snapshot;
  }

  /**
   * Saves or clears one active textarea without retaining over-budget content.
   *
   * @param identity - Exact Review generation identity
   * @param plan - Current exact plan used to prove file eligibility
   * @param activeEdit - Replacement editor state, or undefined to close it
   * @returns Saved immutable editor state
   */
  writeActiveEdit(
    identity: Readonly<KnowledgeReviewDraftIdentity>,
    plan: Readonly<KnowledgeReviewPlan>,
    activeEdit: unknown
  ): Readonly<KnowledgeReviewActiveEdit> | undefined {
    const key = createDraftKey(identity);
    const current = this.drafts.get(key) ?? { decisions: EMPTY_REVIEW_DRAFT };
    if (activeEdit === undefined) {
      const replacement = { decisions: current.decisions };
      if (hasRetainedDraftState(replacement)) {
        this.drafts.set(key, replacement);
      } else {
        this.drafts.delete(key);
      }
      return undefined;
    }
    const snapshot = snapshotActiveEdit(plan, activeEdit);
    if (
      getEditedCharacterCount(current.decisions, snapshot) >
      KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxTotalCharacters
    ) {
      throw new RangeError("Knowledge Review active edit exceeds the session limit");
    }
    const replacement = { decisions: current.decisions, activeEdit: snapshot };
    this.assertAggregateWithinLimit(key, replacement);
    this.drafts.set(key, replacement);
    return snapshot;
  }

  /** Deletes a draft after its exact proposal was durably applied or rejected. */
  delete(identity: Readonly<KnowledgeReviewDraftIdentity>): boolean {
    return this.drafts.delete(createDraftKey(identity));
  }

  /**
   * Drops entries that no longer match a current exact Review in this Bundle.
   *
   * @param bundleId - Current controller Bundle session
   * @param plans - Fresh durable Review projections
   * @returns Whether any retained entry was revoked
   */
  reconcile(bundleId: string, plans: readonly Readonly<KnowledgeReviewPlan>[]): boolean {
    const currentKeys = new Set(
      plans.map((plan) => createDraftKey(createKnowledgeReviewDraftIdentity(bundleId, plan)))
    );
    let changed = false;
    for (const key of this.drafts.keys()) {
      if (!currentKeys.has(key)) {
        this.drafts.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  /** Clears all content-bearing drafts when the controller session ends or changes Bundle. */
  clear(): void {
    this.drafts.clear();
  }
}
