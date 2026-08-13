import {
  snapshotKnowledgeForwardRevisionReviewCommand,
  type KnowledgeForwardRevisionReviewCommandV1,
} from "@/knowledge/forwardRevision/KnowledgeForwardRevisionReviewCommand";
import {
  KnowledgeForwardRevisionValidationCoordinatorError,
  KnowledgeProductionForwardRevisionValidationCoordinator,
} from "@/knowledge/forwardRevision/KnowledgeProductionForwardRevisionValidationCoordinator";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  KnowledgeForwardRevisionDecisionPortError,
  KnowledgeRuntimeForwardRevisionDecisionPort,
  type KnowledgeForwardRevisionDecisionResult,
} from "@/knowledge/runtime/KnowledgeRuntimeStore";

const STALE_RESULT = Object.freeze({ kind: "stale" as const });
const UNAVAILABLE_RESULT = Object.freeze({ kind: "unavailable" as const });

/** Scalar-only terminal decision projection that discloses no accepted body or receipt. */
export interface KnowledgeProductionForwardRevisionTerminalDecisionResult {
  readonly kind: "accepted" | "rejected";
  readonly outcome: "decided" | "already_decided";
  readonly proposalId: string;
  readonly commandId: string;
  readonly decisionDigest: string;
  readonly runtimeRevision: number;
  readonly decisionStoreRevision: number;
}

/** Scalar-only result for an edited acceptance already equal to current Wiki bytes. */
export interface KnowledgeProductionForwardRevisionNoChangeResult {
  readonly kind: "no_change";
  readonly proposalId: string;
  readonly commandId: string;
  readonly contentHash: string;
}

/** Closed production decision result with no proposal, body, citation, or receipt material. */
export type KnowledgeProductionForwardRevisionDecisionResult =
  | Readonly<KnowledgeProductionForwardRevisionTerminalDecisionResult>
  | Readonly<KnowledgeProductionForwardRevisionNoChangeResult>
  | Readonly<{ kind: "stale" | "unavailable" }>;

interface CoordinatorState {
  readonly validator: KnowledgeProductionForwardRevisionValidationCoordinator;
  readonly decisions: KnowledgeRuntimeForwardRevisionDecisionPort;
  readonly executionOwner: KnowledgeExecutionOwner;
  readonly assertCurrent: () => void;
}

const coordinatorStates = new WeakMap<object, Readonly<CoordinatorState>>();

/** Creates platform-standard cancellation without retaining a caller reason. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Re-proves the exact production generation and both owner-bound dependencies. */
function assertCoordinatorCurrent(state: Readonly<CoordinatorState>, signal?: AbortSignal): void {
  try {
    if (signal?.aborted) throw createAbortError();
    state.assertCurrent();
    KnowledgeProductionForwardRevisionValidationCoordinator.assertExecutionOwner(
      state.validator,
      state.executionOwner
    );
    KnowledgeRuntimeForwardRevisionDecisionPort.assert(state.decisions);
    if (
      !KnowledgeRuntimeForwardRevisionDecisionPort.matchesExecutionOwner(
        state.decisions,
        state.executionOwner
      )
    ) {
      throw createAbortError();
    }
    if (signal?.aborted) throw createAbortError();
  } catch {
    throw createAbortError();
  }
}

/** Returns hidden state only for one exact module-created coordinator receiver. */
function requireCoordinatorState(value: unknown): Readonly<CoordinatorState> {
  let prototype: object | null;
  try {
    prototype = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : null;
  } catch {
    throw createAbortError();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    prototype !== KnowledgeProductionForwardRevisionDecisionCoordinator.prototype
  ) {
    throw createAbortError();
  }
  const state = coordinatorStates.get(value);
  if (!state) throw createAbortError();
  return state;
}

/** Detaches one genuine terminal Runtime result into the public scalar-only result. */
function projectTerminalResult(
  result: Readonly<KnowledgeForwardRevisionDecisionResult>,
  command: Readonly<KnowledgeForwardRevisionReviewCommandV1>
): Readonly<KnowledgeProductionForwardRevisionTerminalDecisionResult> {
  return Object.freeze({
    kind: result.kind,
    outcome: result.outcome,
    proposalId: command.proposalId,
    commandId: command.commandId,
    decisionDigest: result.decisionDigest,
    runtimeRevision: result.runtimeRevision,
    decisionStoreRevision: result.decisionStoreRevision,
  });
}

/** Maps a genuine validator failure without exposing lower-level causes or caller material. */
function mapValidationFailure(
  state: Readonly<CoordinatorState>,
  error: unknown
): Readonly<KnowledgeProductionForwardRevisionDecisionResult> {
  const code = KnowledgeForwardRevisionValidationCoordinatorError.inspect(error);
  if (code === "aborted") throw createAbortError();
  if (code === "dependency_invalid") {
    try {
      assertCoordinatorCurrent(state);
    } catch {
      throw createAbortError();
    }
  }
  if (
    code === "request_invalid" ||
    code === "authority_unavailable" ||
    code === "authority_changed" ||
    code === "source_stale" ||
    code === "page_stale"
  ) {
    return STALE_RESULT;
  }
  return UNAVAILABLE_RESULT;
}

/** Maps a genuine Runtime decision failure into the closed public result vocabulary. */
function mapDecisionFailure(
  error: unknown
): Readonly<KnowledgeProductionForwardRevisionDecisionResult> {
  const code = KnowledgeForwardRevisionDecisionPortError.inspect(error);
  if (code === "aborted") throw createAbortError();
  if (code === "request_invalid" || code === "authority_unavailable" || code === "conflict") {
    return STALE_RESULT;
  }
  return UNAVAILABLE_RESULT;
}

/**
 * Coordinates strict pending admission, genuine validation, and atomic Runtime decision.
 *
 * The coordinator never accepts a validation capability from its caller. Acceptance
 * passes the original process-local capability returned by its retained genuine
 * validator directly into the adjacent genuine Runtime decision call.
 */
export class KnowledgeProductionForwardRevisionDecisionCoordinator {
  /** Captures one exact production workflow generation and its least-authority ports. */
  constructor(
    validator: KnowledgeProductionForwardRevisionValidationCoordinator,
    decisions: KnowledgeRuntimeForwardRevisionDecisionPort,
    executionOwner: KnowledgeExecutionOwner,
    assertCurrent: () => void
  ) {
    try {
      KnowledgeExecutionOwner.assert(executionOwner);
      if (typeof assertCurrent !== "function") throw new TypeError();
      const state = Object.freeze({ validator, decisions, executionOwner, assertCurrent });
      assertCoordinatorCurrent(state);
      coordinatorStates.set(this, state);
      Object.freeze(this);
    } catch {
      throw createAbortError();
    }
  }

  /**
   * Decides one strict command while preserving abort-before-CAS and commit-wins-after-CAS.
   *
   * Rejection enters Runtime directly after strict pending admission. Acceptance first
   * completes the genuine deterministic validator sandwich. A byte-identical edited
   * acceptance returns `no_change` and performs no Runtime mutation. Once the genuine
   * decision port is invoked, it owns ambiguity recovery and the returned durable result
   * is not replaced by a later caller abort or generation closure.
   *
   * @param commandValue - Strict command bound to one exact pending proposal
   * @param signal - Caller cancellation signal honored until the decision CAS boundary
   * @returns Frozen scalar-only terminal, no-change, stale, or unavailable result
   */
  async decide(
    commandValue: unknown,
    signal: AbortSignal
  ): Promise<Readonly<KnowledgeProductionForwardRevisionDecisionResult>> {
    const state = requireCoordinatorState(this);
    assertCoordinatorCurrent(state, signal);
    let command: Readonly<KnowledgeForwardRevisionReviewCommandV1>;
    try {
      command = snapshotKnowledgeForwardRevisionReviewCommand(commandValue);
    } catch {
      return STALE_RESULT;
    }

    try {
      const admission = await state.decisions.readPending(command, signal);
      assertCoordinatorCurrent(state, signal);
      if (!admission) return STALE_RESULT;
      if (admission.kind === "terminal") {
        return projectTerminalResult(admission.result, command);
      }

      if (command.action === "reject") {
        assertCoordinatorCurrent(state, signal);
        try {
          const result = await state.decisions.decide(Object.freeze({ command }), signal);
          return projectTerminalResult(result, command);
        } catch (error) {
          return mapDecisionFailure(error);
        }
      }

      let validation;
      try {
        validation = await state.validator.validate(
          Object.freeze({
            proposal: admission.proposal,
            proposalDigest: admission.proposalDigest,
            command,
          }),
          signal
        );
      } catch (error) {
        return mapValidationFailure(state, error);
      }
      assertCoordinatorCurrent(state, signal);
      if (validation.kind === "no_change") {
        return Object.freeze({
          kind: "no_change" as const,
          proposalId: validation.proposalId,
          commandId: validation.commandId,
          contentHash: validation.contentHash,
        });
      }

      try {
        const result = await state.decisions.decide(
          Object.freeze({ command, validationCapability: validation.capability }),
          signal
        );
        return projectTerminalResult(result, command);
      } catch (error) {
        return mapDecisionFailure(error);
      }
    } catch (error) {
      const decisionCode = KnowledgeForwardRevisionDecisionPortError.inspect(error);
      if (decisionCode) return mapDecisionFailure(error);
      if (error instanceof DOMException && error.name === "AbortError") throw createAbortError();
      return UNAVAILABLE_RESULT;
    }
  }
}

Object.freeze(KnowledgeProductionForwardRevisionDecisionCoordinator.prototype);
Object.freeze(KnowledgeProductionForwardRevisionDecisionCoordinator);
