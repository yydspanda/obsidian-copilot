import { isKnowledgeAbortError } from "@/knowledge/errors/abortError";
import {
  createKnowledgeForwardRevisionProposalAuthorityQuery,
  snapshotKnowledgeForwardRevisionProposalAuthority,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposalAuthority";
import {
  snapshotKnowledgeForwardRevisionPublicationReceipt,
  type KnowledgeForwardRevisionPublicationReceiptV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionProposal";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import { createFileContentHash } from "@/knowledge/model/fingerprint";
import { isPathWithinRoot, parseVaultPath } from "@/knowledge/paths/vaultPath";
import { KnowledgeRuntimeForwardRevisionProposalPublicationPort } from "@/knowledge/runtime/KnowledgeRuntimeStore";
import { DelegatingKnowledgeKnownAppliedWikiOutputsPort } from "@/knowledge/wiki/DelegatingKnowledgeKnownAppliedWikiOutputsPort";
import {
  snapshotKnowledgeKnownAppliedWikiOutputComparisonResult,
  snapshotKnowledgeKnownAppliedWikiOutputDetailResult,
  snapshotKnowledgeKnownAppliedWikiOutputsSession,
  type KnowledgeKnownAppliedWikiOutputComparisonResult,
  type KnowledgeKnownAppliedWikiOutputDetailResult,
  type KnowledgeKnownAppliedWikiOutputsPort,
  type KnowledgeKnownAppliedWikiOutputsSession,
} from "@/knowledge/wiki/KnowledgeKnownAppliedWikiOutputsPort";

const MAX_BUNDLES = 256;
const MAX_IDENTIFIER_CHARACTERS = 256;
const MAX_PATH_CHARACTERS = 1_024;
const OPAQUE_OUTPUT_PATTERN = /^known-wiki-output-[a-f0-9]{64}$/;
const STALE_RESULT = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });
const TOO_LARGE_RESULT = Object.freeze({ kind: "too_large" as const });
const CURRENT_NOT_APPLIED_RESULT = Object.freeze({
  kind: "not_eligible" as const,
  reason: "current_not_applied" as const,
});
const SELECTED_IS_CURRENT_RESULT = Object.freeze({
  kind: "not_eligible" as const,
  reason: "selected_is_current" as const,
});
const FORWARD_ORIGIN_NOT_SUPPORTED_RESULT = Object.freeze({
  kind: "not_eligible" as const,
  reason: "forward_origin_not_supported" as const,
});

/** One trusted Bundle root used only to resolve an authentic session page. */
export interface KnowledgeForwardRevisionProposalBundleBinding {
  readonly bundleId: string;
  readonly wikiRoot: string;
}

/** Dependencies captured by one production forward-proposal generation. */
export interface KnowledgeProductionForwardRevisionProposalCoordinatorInput {
  readonly knownOutputs: DelegatingKnowledgeKnownAppliedWikiOutputsPort;
  readonly knownOutputsDelegate: KnowledgeKnownAppliedWikiOutputsPort;
  readonly runtime: KnowledgeRuntimeForwardRevisionProposalPublicationPort;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly bundles: readonly Readonly<KnowledgeForwardRevisionProposalBundleBinding>[];
  readonly assertCurrent: () => void;
}

/** Closed safe reasons why a selected known output is not proposal-eligible. */
export type KnowledgeForwardRevisionProposalIneligibilityReason =
  | "current_not_applied"
  | "selected_is_current"
  | "forward_origin_not_supported";

/** Closed proposal-only result that never represents Wiki write authority. */
export type KnowledgeForwardRevisionProposalResult =
  | Readonly<{
      kind: "published";
      bundleId: string;
      receipt: Readonly<KnowledgeForwardRevisionPublicationReceiptV1>;
    }>
  | Readonly<{
      kind: "not_eligible";
      reason: KnowledgeForwardRevisionProposalIneligibilityReason;
    }>
  | Readonly<{ kind: "stale" | "too_large" | "unavailable" }>;

interface CapturedKnownOutputs {
  readonly owner: DelegatingKnowledgeKnownAppliedWikiOutputsPort;
  readonly delegate: KnowledgeKnownAppliedWikiOutputsPort;
  readonly readOutput: KnowledgeKnownAppliedWikiOutputsPort["readOutput"];
  readonly compareWithCurrent: KnowledgeKnownAppliedWikiOutputsPort["compareWithCurrent"];
}

interface CapturedRuntime {
  readonly owner: KnowledgeRuntimeForwardRevisionProposalPublicationPort;
  readonly readAuthority: KnowledgeRuntimeForwardRevisionProposalPublicationPort["readForwardRevisionProposalAuthority"];
  readonly publish: KnowledgeRuntimeForwardRevisionProposalPublicationPort["publishForwardRevisionProposalAtomically"];
}

interface CapturedBundle {
  readonly bundleId: string;
  readonly wikiRoot: string;
}

interface CoordinatorState {
  readonly knownOutputs: Readonly<CapturedKnownOutputs>;
  readonly runtime: Readonly<CapturedRuntime>;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly bundles: readonly Readonly<CapturedBundle>[];
  readonly assertCurrent: () => void;
}

const coordinatorStates = new WeakMap<object, Readonly<CoordinatorState>>();

/** Creates platform-standard cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Reads one exact plain data record without invoking caller accessors. */
function snapshotRecord(
  value: unknown,
  requiredKeys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== requiredKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      requiredKeys.some((key) => !keys.includes(key))
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

/** Reads one dense bounded caller array entirely through data descriptors. */
function snapshotArray(value: unknown, maximum: number): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !length ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum ||
      Reflect.ownKeys(value).length !== length.value + 1
    ) {
      return undefined;
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    return undefined;
  }
}

/** Reports whether text contains only paired Unicode scalar values. */
function isUnicodeScalarText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Reports whether text contains an unsupported identifier control. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Reports whether a value is one bounded protocol identifier. */
function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_CHARACTERS &&
    value.trim() === value &&
    isUnicodeScalarText(value) &&
    !hasControlCharacter(value)
  );
}

/** Finds a callable data method through one bounded acyclic prototype chain. */
function captureMethod(value: object, name: string): ((...args: unknown[]) => unknown) | undefined {
  try {
    let owner: object | null = value;
    const visited = new Set<object>();
    while (owner && visited.size < 64 && !visited.has(owner)) {
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function"
          ? (descriptor.value as (...args: unknown[]) => unknown)
          : undefined;
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Captures only the two R3b methods that re-prove an opaque session selection. */
function captureKnownOutputs(
  value: unknown,
  delegate: KnowledgeKnownAppliedWikiOutputsPort
): Readonly<CapturedKnownOutputs> {
  DelegatingKnowledgeKnownAppliedWikiOutputsPort.assertCurrentDelegate(value, delegate);
  const readOutput = captureMethod(value, "readOutput");
  const compareWithCurrent = captureMethod(value, "compareWithCurrent");
  if (!readOutput || !compareWithCurrent) throw createAbortError();
  return Object.freeze({
    owner: value,
    delegate,
    readOutput: ((session, outputRef, signal) =>
      Promise.resolve(
        Reflect.apply(readOutput, value, [session, outputRef, signal])
      )) as KnowledgeKnownAppliedWikiOutputsPort["readOutput"],
    compareWithCurrent: ((session, outputRef, signal) =>
      Promise.resolve(
        Reflect.apply(compareWithCurrent, value, [session, outputRef, signal])
      )) as KnowledgeKnownAppliedWikiOutputsPort["compareWithCurrent"],
  });
}

/** Captures owner-bound Runtime methods only from the exact production execution lifecycle. */
function captureRuntime(
  value: unknown,
  executionOwner: KnowledgeExecutionOwner
): Readonly<CapturedRuntime> {
  KnowledgeRuntimeForwardRevisionProposalPublicationPort.assert(value);
  if (
    !KnowledgeRuntimeForwardRevisionProposalPublicationPort.matchesExecutionOwner(
      value,
      executionOwner
    )
  ) {
    throw createAbortError();
  }
  return Object.freeze({
    owner: value,
    readAuthority: value.readForwardRevisionProposalAuthority.bind(value),
    publish: value.publishForwardRevisionProposalAtomically.bind(value),
  });
}

/** Reports whether two configured roots overlap under Windows Vault semantics. */
function rootsOverlap(left: string, right: string): boolean {
  return isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
}

/** Captures bounded non-overlapping Bundle roots used for unique path resolution. */
function snapshotBundles(value: unknown): readonly Readonly<CapturedBundle>[] {
  const values = snapshotArray(value, MAX_BUNDLES);
  if (!values || values.length === 0) throw createAbortError();
  const bundles = values.map((item) => {
    const record = snapshotRecord(item, ["bundleId", "wikiRoot"]);
    const parsed = record ? parseVaultPath(record.wikiRoot) : undefined;
    if (
      !record ||
      !isIdentifier(record.bundleId) ||
      typeof record.wikiRoot !== "string" ||
      record.wikiRoot.length > MAX_PATH_CHARACTERS ||
      !parsed?.ok ||
      parsed.path !== record.wikiRoot
    ) {
      throw createAbortError();
    }
    return Object.freeze({ bundleId: record.bundleId, wikiRoot: parsed.path });
  });
  const bundleIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < bundles.length; leftIndex += 1) {
    if (bundleIds.has(bundles[leftIndex].bundleId)) throw createAbortError();
    bundleIds.add(bundles[leftIndex].bundleId);
    for (let rightIndex = leftIndex + 1; rightIndex < bundles.length; rightIndex += 1) {
      if (rootsOverlap(bundles[leftIndex].wikiRoot, bundles[rightIndex].wikiRoot)) {
        throw createAbortError();
      }
    }
  }
  return Object.freeze(bundles);
}

/** Captures the constructor surface before evaluating any dependency. */
function snapshotInput(
  value: unknown
): Readonly<KnowledgeProductionForwardRevisionProposalCoordinatorInput> {
  const record = snapshotRecord(value, [
    "knownOutputs",
    "knownOutputsDelegate",
    "runtime",
    "executionOwner",
    "bundles",
    "assertCurrent",
  ]);
  if (!record || typeof record.assertCurrent !== "function") throw createAbortError();
  return Object.freeze({
    knownOutputs: record.knownOutputs as DelegatingKnowledgeKnownAppliedWikiOutputsPort,
    knownOutputsDelegate: record.knownOutputsDelegate as KnowledgeKnownAppliedWikiOutputsPort,
    runtime: record.runtime as KnowledgeRuntimeForwardRevisionProposalPublicationPort,
    executionOwner: record.executionOwner as KnowledgeExecutionOwner,
    bundles: record.bundles as readonly Readonly<KnowledgeForwardRevisionProposalBundleBinding>[],
    assertCurrent: record.assertCurrent as () => void,
  });
}

/** Re-proves the Runtime mutation facade against the captured exact execution owner. */
function assertRuntimeOwner(state: CoordinatorState): void {
  if (
    !KnowledgeRuntimeForwardRevisionProposalPublicationPort.matchesExecutionOwner(
      state.runtime.owner,
      state.executionOwner
    )
  ) {
    throw createAbortError();
  }
}

/** Stops proposal work around every asynchronous pre-commit authority boundary. */
function assertInvocation(state: CoordinatorState, signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
  try {
    assertRuntimeOwner(state);
    DelegatingKnowledgeKnownAppliedWikiOutputsPort.assertCurrentDelegate(
      state.knownOutputs.owner,
      state.knownOutputs.delegate
    );
    state.assertCurrent();
    assertRuntimeOwner(state);
    DelegatingKnowledgeKnownAppliedWikiOutputsPort.assertCurrentDelegate(
      state.knownOutputs.owner,
      state.knownOutputs.delegate
    );
  } catch {
    throw createAbortError();
  }
  if (signal.aborted) throw createAbortError();
}

/** Returns hidden coordinator state only for an authentic module instance. */
function requireState(value: unknown): Readonly<CoordinatorState> {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== KnowledgeProductionForwardRevisionProposalCoordinator.prototype
  ) {
    throw createAbortError();
  }
  const state = coordinatorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Selects exactly one trusted Bundle from the authentic session's exact path. */
function selectBundle(
  state: Readonly<CoordinatorState>,
  pagePath: string
): Readonly<CapturedBundle> | undefined {
  const matches = state.bundles.filter((bundle) => isPathWithinRoot(pagePath, bundle.wikiRoot));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Maps one strict R3b terminal detail result without widening its categories. */
function mapDetailTerminal(
  result: Exclude<KnowledgeKnownAppliedWikiOutputDetailResult, { kind: "loaded" }>
): KnowledgeForwardRevisionProposalResult {
  if (result.kind === "stale") return STALE_RESULT;
  if (result.kind === "too_large") return TOO_LARGE_RESULT;
  return UNAVAILABLE_RESULT;
}

/** Maps one strict R3b terminal comparison result without widening its categories. */
function mapComparisonTerminal(
  result: Exclude<KnowledgeKnownAppliedWikiOutputComparisonResult, { kind: "loaded" }>
): KnowledgeForwardRevisionProposalResult {
  if (result.kind === "stale") return STALE_RESULT;
  if (result.kind === "too_large") return TOO_LARGE_RESULT;
  return UNAVAILABLE_RESULT;
}

/** Production coordinator for authenticated known-output proposal publication only. */
export class KnowledgeProductionForwardRevisionProposalCoordinator {
  /** Captures one exact worker generation without Wiki, model, or network write authority. */
  constructor(inputValue: KnowledgeProductionForwardRevisionProposalCoordinatorInput) {
    const input = snapshotInput(inputValue);
    KnowledgeExecutionOwner.assert(input.executionOwner);
    coordinatorStates.set(
      this,
      Object.freeze({
        knownOutputs: captureKnownOutputs(input.knownOutputs, input.knownOutputsDelegate),
        runtime: captureRuntime(input.runtime, input.executionOwner),
        executionOwner: input.executionOwner,
        bundles: snapshotBundles(input.bundles),
        assertCurrent: input.assertCurrent,
      })
    );
    Object.freeze(this);
  }

  /** Requires one exact process-local production proposal coordinator. */
  static assert(
    value: unknown
  ): asserts value is KnowledgeProductionForwardRevisionProposalCoordinator {
    requireState(value);
  }

  /**
   * Re-proves one authentic R3b selection and publishes only a pending proposal.
   *
   * All caller cancellation and generation checks are abort-wins before the
   * atomic publication call. Once that call resolves to a strict committed
   * receipt, commit-wins: a later caller abort cannot turn durable truth into a
   * reported failure. The returned receipt is not Review or Wiki write authority.
   *
   * @param sessionValue - Original authentic current-generation R3b session object
   * @param outputRef - Opaque output ref disclosed by that exact session
   * @param signal - Caller cancellation signal
   * @returns Closed proposal publication result
   */
  async proposeKnownOutput(
    sessionValue: Readonly<KnowledgeKnownAppliedWikiOutputsSession>,
    outputRef: string,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeForwardRevisionProposalResult>> {
    const state = requireState(this);
    let publicationInvoked = false;
    let session: Readonly<KnowledgeKnownAppliedWikiOutputsSession>;
    assertInvocation(state, signal);
    try {
      session = snapshotKnowledgeKnownAppliedWikiOutputsSession(sessionValue);
    } catch {
      assertInvocation(state, signal);
      return STALE_RESULT;
    }
    assertInvocation(state, signal);
    if (typeof outputRef !== "string" || !OPAQUE_OUTPUT_PATTERN.test(outputRef)) {
      return STALE_RESULT;
    }
    if (session.currentState !== "applied") return CURRENT_NOT_APPLIED_RESULT;
    const bundle = selectBundle(state, session.displayPagePath);
    if (!bundle) return STALE_RESULT;

    try {
      assertInvocation(state, signal);
      const detail = snapshotKnowledgeKnownAppliedWikiOutputDetailResult(
        await state.knownOutputs.readOutput(sessionValue, outputRef, signal)
      );
      assertInvocation(state, signal);
      if (detail.kind !== "loaded") return mapDetailTerminal(detail);
      if (detail.value.outputRef !== outputRef) return UNAVAILABLE_RESULT;
      if (detail.value.proposalCapability === "current_not_applied") {
        return CURRENT_NOT_APPLIED_RESULT;
      }
      if (detail.value.proposalCapability === "selected_is_current") {
        return SELECTED_IS_CURRENT_RESULT;
      }
      if (detail.value.proposalCapability === "forward_origin_not_supported") {
        return FORWARD_ORIGIN_NOT_SUPPORTED_RESULT;
      }
      if (detail.value.proposalCapability === "detail_too_large") return TOO_LARGE_RESULT;
      const sourceOrigin = detail.value.origins.find((origin) => origin.kind === "source_apply");
      if (!sourceOrigin) return FORWARD_ORIGIN_NOT_SUPPORTED_RESULT;

      assertInvocation(state, signal);
      const comparison = snapshotKnowledgeKnownAppliedWikiOutputComparisonResult(
        await state.knownOutputs.compareWithCurrent(sessionValue, outputRef, signal)
      );
      assertInvocation(state, signal);
      if (comparison.kind !== "loaded") return mapComparisonTerminal(comparison);
      if (
        comparison.value.outputRef !== outputRef ||
        comparison.value.knownContent !== detail.value.content
      ) {
        return UNAVAILABLE_RESULT;
      }
      if (comparison.value.currentState !== "applied") return CURRENT_NOT_APPLIED_RESULT;

      const selectedContentHash = createFileContentHash(detail.value.content);
      const vaultObservedBeforeHash = createFileContentHash(comparison.value.currentContent);
      if (selectedContentHash === vaultObservedBeforeHash) return SELECTED_IS_CURRENT_RESULT;

      const query = createKnowledgeForwardRevisionProposalAuthorityQuery({
        bundleId: bundle.bundleId,
        pagePath: session.displayPagePath,
        selectedContentHash,
        selectedAppliedAt: sourceOrigin.newestAppliedAt,
        selectedVerifiedApplyCount: sourceOrigin.verifiedApplyCount,
        vaultObservedBeforeHash,
      });
      assertInvocation(state, signal);
      const rawAuthority = await state.runtime.readAuthority(query);
      assertInvocation(state, signal);
      if (rawAuthority === null) return STALE_RESULT;
      const authority = snapshotKnowledgeForwardRevisionProposalAuthority(
        rawAuthority,
        query,
        detail.value.content
      );
      assertInvocation(state, signal);

      publicationInvoked = true;
      const rawReceipt = await state.runtime.publish({
        intent: authority.intent,
        intentDigest: authority.intentDigest,
        historicalReviewAuthority: authority.historicalReviewAuthority,
        selectedContent: detail.value.content,
        selectedContentHash,
        vaultObservedBeforeHash,
      });
      // The genuine Runtime method confirms uncertain commits before returning.
      // Do not re-enter revocable generation authority after this atomic boundary.
      const receipt = snapshotKnowledgeForwardRevisionPublicationReceipt(rawReceipt);
      if (receipt.runtimeId !== authority.runtimeId) return UNAVAILABLE_RESULT;
      return Object.freeze({ kind: "published" as const, bundleId: bundle.bundleId, receipt });
    } catch (error) {
      if (publicationInvoked) return UNAVAILABLE_RESULT;
      if (isKnowledgeAbortError(error)) throw createAbortError();
      if (signal.aborted) throw createAbortError();
      try {
        assertInvocation(state, signal);
      } catch {
        throw createAbortError();
      }
      return UNAVAILABLE_RESULT;
    }
  }
}

Object.freeze(KnowledgeProductionForwardRevisionProposalCoordinator.prototype);
Object.freeze(KnowledgeProductionForwardRevisionProposalCoordinator);
