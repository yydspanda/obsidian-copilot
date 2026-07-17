import { diffLines, type Change } from "diff";
import { z } from "zod";

import { createKnowledgeChangeSetDigest } from "@/knowledge/changeset/ChangeSetValidator";
import { canonicalizeJson, createFileContentHash } from "@/knowledge/model/fingerprint";
import { parseKnowledgeChangeSet } from "@/knowledge/model/schemas";
import type {
  JsonValue,
  KnowledgeChangeSet,
  KnowledgeDiagnostic,
  KnowledgeFileChange,
  KnowledgeValidationSummary,
} from "@/knowledge/model/types";
import { sha256 } from "@/utils/hash";

const MAX_REVIEW_DIAGNOSTICS = 256;

/** Exact transient observation used to build one review preview. */
export type KnowledgeReviewTargetObservation =
  | { changeId: string; kind: "missing" }
  | { changeId: string; kind: "file"; content: string }
  | { changeId: string; kind: "directory" }
  | { changeId: string; kind: "unavailable" };

/** Exact diff token rendered by the review UI. */
export interface KnowledgeReviewDiffPart {
  kind: "context" | "added" | "removed";
  value: string;
}

/** Stable, opaque diff block whose contents never cross the command boundary. */
export interface KnowledgeReviewBlock {
  blockId: string;
  kind: "context" | "change";
  parts: KnowledgeReviewDiffPart[];
}

/** Integrity of one proposal target when the review snapshot was created. */
export type KnowledgeReviewTargetIntegrity =
  | "current"
  | "stale"
  | "missing"
  | "occupied"
  | "directory"
  | "unavailable";

/** Review operations currently allowed for one exact target snapshot. */
export type KnowledgeReviewCapability = "blocks_allowed" | "exact_only" | "reject_only";

/** Read-only file projection rendered inside Knowledge Studio. */
export interface KnowledgeReviewFile {
  changeId: string;
  path: string;
  operation: KnowledgeFileChange["operation"];
  reason: string;
  sourceRefs: string[];
  integrity: KnowledgeReviewTargetIntegrity;
  capability: KnowledgeReviewCapability;
  blockedReason?: string;
  beforeContent?: string;
  afterContent?: string;
  blocks: KnowledgeReviewBlock[];
}

/** Immutable, content-addressed review snapshot supplied to the UI. */
export interface KnowledgeReviewPlan {
  changeSetId: string;
  bundleId: string;
  proposalDigest: string;
  snapshotToken: string;
  operation: KnowledgeChangeSet["operation"];
  sourceRefs: string[];
  validation: KnowledgeValidationSummary;
  createdAt: number;
  files: KnowledgeReviewFile[];
}

/** Opaque decision for exactly one proposal change. */
export type KnowledgeReviewFileDecision =
  | { changeId: string; decision: "accept_exact" }
  | { changeId: string; decision: "reject" }
  | { changeId: string; decision: "accept_blocks"; acceptedBlockIds: string[] };

/** Command emitted by the UI without paths, content, hashes, or status fields. */
export interface KnowledgeReviewCommand {
  changeSetId: string;
  proposalDigest: string;
  expectedSnapshotToken: string;
  decisions: KnowledgeReviewFileDecision[];
}

/** Candidate supplied to deterministic review-time validation. */
export interface KnowledgeReviewCandidateValidationInput {
  proposal: KnowledgeChangeSet;
  candidate: KnowledgeChangeSet;
  proposalDigest: string;
  snapshotToken: string;
  observations: KnowledgeReviewTargetObservation[];
}

/** Result required from the deterministic review-time validation port. */
export interface KnowledgeReviewCandidateValidationResult {
  validation: KnowledgeValidationSummary;
  diagnostics: KnowledgeDiagnostic[];
}

/** Deterministic validator for a selection-altered ChangeSet. */
export interface KnowledgeReviewCandidateValidator {
  /**
   * Revalidates projected OKF, links, and citations without writing files.
   *
   * @param input - Exact proposal, revised candidate, and preview read-set
   * @param signal - Cancellation signal owned by the review submission
   * @returns Unknown adapter payload for strict runtime parsing
   */
  validate(input: KnowledgeReviewCandidateValidationInput, signal: AbortSignal): Promise<unknown>;
}

/** Review compilation outcome before durable persistence or queue mutation. */
export type KnowledgeReviewDecisionResult =
  | { kind: "rejected"; changeSetId: string; proposalDigest: string }
  | {
      kind: "accepted";
      changeSet: KnowledgeChangeSet;
      acceptedDigest: string;
      diagnostics: KnowledgeDiagnostic[];
    }
  | { kind: "blocked"; diagnostics: KnowledgeDiagnostic[] };

/** Reports deterministic review-plan or command defects. */
export class KnowledgeReviewDecisionError extends Error {
  /**
   * Creates a safe structured review error.
   *
   * @param diagnostics - Stable diagnostics without raw adapter errors
   */
  constructor(public readonly diagnostics: readonly KnowledgeDiagnostic[]) {
    super("Knowledge review decision does not satisfy the current snapshot");
    this.name = "KnowledgeReviewDecisionError";
  }
}

/** Reports a sanitized unavailable review validation dependency. */
export class KnowledgeReviewInfrastructureError extends Error {
  /** Creates a safe infrastructure error without retaining the original rejection. */
  constructor() {
    super("Knowledge review validation dependency failed");
    this.name = "KnowledgeReviewInfrastructureError";
  }
}

/** Reports cancellation without retaining an arbitrary abort reason. */
export class KnowledgeReviewAbortError extends Error {
  /** Creates an AbortError compatible with queue and UI cancellation handling. */
  constructor() {
    super("Knowledge review validation was cancelled");
    this.name = "AbortError";
  }
}

const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Expected a non-empty string",
});

const validationResultSchema: z.ZodType<KnowledgeReviewCandidateValidationResult> = z
  .object({
    validation: z
      .object({
        okfValid: z.boolean(),
        citationsValid: z.boolean(),
        linksValid: z.boolean(),
      })
      .strict(),
    diagnostics: z.array(
      z
        .object({
          code: nonEmptyStringSchema,
          severity: z.enum(["error", "warning"]),
          field: z.string(),
          message: nonEmptyStringSchema,
        })
        .strict()
    ),
  })
  .strict();

/**
 * Appends one deterministic review diagnostic.
 *
 * @param diagnostics - Mutable diagnostic collection
 * @param code - Stable machine-readable issue code
 * @param field - Associated review field
 * @param message - Safe human-readable explanation
 */
function addError(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  field: string,
  message: string
): void {
  diagnostics.push({ code, severity: "error", field, message });
}

/**
 * Compares stable text without locale-dependent behavior.
 *
 * @param left - First value
 * @param right - Second value
 * @returns Standard comparator result
 */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Creates a canonical digest for review-only identities.
 *
 * @param namespace - Versioned identity namespace
 * @param value - JSON-compatible semantic material
 * @returns Lowercase SHA-256 digest
 */
function digestReviewJson(namespace: string, value: unknown): string {
  return sha256(`${namespace}\n${canonicalizeJson(value as JsonValue)}`);
}

/**
 * Converts a diff-library token into a detached stable review token.
 *
 * @param change - Exact line-diff token
 * @returns Detached review diff part
 */
function toReviewDiffPart(change: Change): KnowledgeReviewDiffPart {
  return {
    kind: change.added ? "added" : change.removed ? "removed" : "context",
    value: change.value,
  };
}

/**
 * Groups adjacent changed tokens while retaining context as independent blocks.
 *
 * @param changeId - Runtime-owned file change id
 * @param beforeContent - Exact observed pre-state text
 * @param afterContent - Exact proposed post-state text
 * @returns Stable exact diff blocks
 */
function createReviewBlocks(
  changeId: string,
  beforeContent: string,
  afterContent: string
): KnowledgeReviewBlock[] {
  const changes = diffLines(beforeContent, afterContent, { newlineIsToken: true });
  const grouped: KnowledgeReviewDiffPart[][] = [];
  let currentChanges: KnowledgeReviewDiffPart[] = [];
  for (const change of changes) {
    const part = toReviewDiffPart(change);
    if (part.kind === "context") {
      if (currentChanges.length > 0) {
        grouped.push(currentChanges);
        currentChanges = [];
      }
      grouped.push([part]);
    } else {
      currentChanges.push(part);
    }
  }
  if (currentChanges.length > 0) {
    grouped.push(currentChanges);
  }

  return grouped.map((parts, index) => ({
    blockId: `review-block-${digestReviewJson("knowledge-review-block-v1", {
      changeId,
      index,
      parts,
    })}`,
    kind: parts.some((part) => part.kind !== "context") ? "change" : "context",
    parts,
  }));
}

/**
 * Reads the intended exact post-state text for a non-delete change.
 *
 * @param change - Typed file change
 * @returns Proposed content, or undefined for delete
 */
function getAfterContent(change: KnowledgeFileChange): string | undefined {
  return change.operation === "delete" ? undefined : change.afterContent;
}

/**
 * Derives integrity and preview material for one exact target observation.
 *
 * @param change - Proposed file operation
 * @param observation - Current transient target state
 * @returns Integrity, content, capability, and optional blocked reason
 */
function inspectTarget(
  change: KnowledgeFileChange,
  observation: KnowledgeReviewTargetObservation
): Pick<KnowledgeReviewFile, "integrity" | "capability" | "blockedReason" | "beforeContent"> {
  if (observation.kind === "unavailable") {
    return {
      integrity: "unavailable",
      capability: "reject_only",
      blockedReason: "review_target_unavailable",
    };
  }
  if (observation.kind === "directory") {
    return {
      integrity: "directory",
      capability: "reject_only",
      blockedReason: "review_target_is_directory",
    };
  }
  if (change.operation === "create") {
    if (observation.kind !== "missing") {
      return {
        integrity: "occupied",
        capability: "reject_only",
        blockedReason: "review_create_target_occupied",
        beforeContent: observation.content,
      };
    }
    return { integrity: "current", capability: "blocks_allowed", beforeContent: "" };
  }
  if (observation.kind === "missing") {
    return {
      integrity: "missing",
      capability: "reject_only",
      blockedReason: "review_existing_target_missing",
    };
  }
  const beforeHash = createFileContentHash(observation.content);
  if (beforeHash !== change.beforeHash) {
    return {
      integrity: "stale",
      capability: "reject_only",
      blockedReason: "review_before_hash_changed",
      beforeContent: observation.content,
    };
  }
  if (change.operation === "delete") {
    return {
      integrity: "current",
      capability: "reject_only",
      blockedReason: "review_delete_read_set_not_journaled",
      beforeContent: observation.content,
    };
  }
  return {
    integrity: "current",
    capability: "blocks_allowed",
    beforeContent: observation.content,
  };
}

/**
 * Creates a fail-closed, content-addressed review plan without Vault writes.
 *
 * The caller supplies exact observations from a read-only adapter. Update and
 * delete hashes are checked immediately; delete remains reject-only until its
 * manifest authorization read-set is journaled and revalidated at apply time.
 *
 * @param value - Unknown proposed ChangeSet
 * @param observations - One exact observation for every proposed change
 * @returns Immutable review plan containing opaque change and block ids
 */
export function createKnowledgeReviewPlan(
  value: unknown,
  observations: readonly KnowledgeReviewTargetObservation[]
): KnowledgeReviewPlan {
  const parsed = parseKnowledgeChangeSet(value);
  const diagnostics: KnowledgeDiagnostic[] = [];
  if (!parsed.ok) {
    throw new KnowledgeReviewDecisionError(parsed.issues);
  }
  const proposal = parsed.value;
  if (proposal.status !== "proposed") {
    addError(
      diagnostics,
      "review_changeset_not_proposed",
      "changeSet.status",
      "Only a proposed ChangeSet may enter review"
    );
  }

  const observationsById = new Map<string, KnowledgeReviewTargetObservation>();
  observations.forEach((observation, index) => {
    if (observationsById.has(observation.changeId)) {
      addError(
        diagnostics,
        "review_observation_duplicate",
        `observations[${index}].changeId`,
        "Review observations must contain each change id exactly once"
      );
    }
    observationsById.set(observation.changeId, observation);
  });
  const knownChangeIds = new Set(proposal.changes.map((change) => change.id));
  observations.forEach((observation, index) => {
    if (!knownChangeIds.has(observation.changeId)) {
      addError(
        diagnostics,
        "review_observation_unknown",
        `observations[${index}].changeId`,
        "Review observation does not belong to the proposed ChangeSet"
      );
    }
  });
  proposal.changes.forEach((change, index) => {
    if (!observationsById.has(change.id)) {
      addError(
        diagnostics,
        "review_observation_missing",
        `changeSet.changes[${index}].id`,
        "Every proposed change requires one exact review observation"
      );
    }
  });
  if (diagnostics.length > 0) {
    throw new KnowledgeReviewDecisionError(diagnostics);
  }

  const files = proposal.changes.map<KnowledgeReviewFile>((change) => {
    const observation = observationsById.get(change.id)!;
    const inspection = inspectTarget(change, observation);
    const beforeContent = inspection.beforeContent;
    const afterContent = getAfterContent(change);
    const blocks = createReviewBlocks(change.id, beforeContent ?? "", afterContent ?? "");
    const hasChangeBlocks = blocks.some((block) => block.kind === "change");
    const capability =
      inspection.capability === "blocks_allowed" && !hasChangeBlocks
        ? "exact_only"
        : inspection.capability;
    return {
      changeId: change.id,
      path: change.path,
      operation: change.operation,
      reason: change.reason,
      sourceRefs: [...change.sourceRefs],
      integrity: inspection.integrity,
      capability,
      ...(inspection.blockedReason === undefined
        ? {}
        : { blockedReason: inspection.blockedReason }),
      ...(beforeContent === undefined ? {} : { beforeContent }),
      ...(afterContent === undefined ? {} : { afterContent }),
      blocks,
    };
  });
  const proposalDigest = createKnowledgeChangeSetDigest(proposal);
  const snapshotObservations = observations
    .map((observation) =>
      observation.kind === "file"
        ? {
            changeId: observation.changeId,
            kind: observation.kind,
            contentHash: createFileContentHash(observation.content),
          }
        : { ...observation }
    )
    .sort((left, right) => compareText(left.changeId, right.changeId));
  const snapshotToken = digestReviewJson("knowledge-review-snapshot-v1", {
    proposalDigest,
    observations: snapshotObservations,
  });
  return {
    changeSetId: proposal.id,
    bundleId: proposal.bundleId,
    proposalDigest,
    snapshotToken,
    operation: proposal.operation,
    sourceRefs: [...proposal.sourceRefs],
    validation: { ...proposal.validation },
    createdAt: proposal.createdAt,
    files: files.map((file) => ({
      ...file,
      sourceRefs: [...file.sourceRefs],
      blocks: file.blocks.map((block) => ({
        ...block,
        parts: block.parts.map((part) => ({ ...part })),
      })),
    })),
  };
}

/**
 * Validates an opaque UI command against one immutable review plan.
 *
 * @param plan - Current content-addressed review snapshot
 * @param command - UI-supplied opaque decisions
 */
function validateReviewCommand(plan: KnowledgeReviewPlan, command: KnowledgeReviewCommand): void {
  const diagnostics: KnowledgeDiagnostic[] = [];
  if (command.changeSetId !== plan.changeSetId) {
    addError(
      diagnostics,
      "review_command_changeset_mismatch",
      "changeSetId",
      "Review command belongs to another ChangeSet"
    );
  }
  if (command.proposalDigest !== plan.proposalDigest) {
    addError(
      diagnostics,
      "review_command_proposal_mismatch",
      "proposalDigest",
      "Review proposal changed after this decision was prepared"
    );
  }
  if (command.expectedSnapshotToken !== plan.snapshotToken) {
    addError(
      diagnostics,
      "review_command_snapshot_stale",
      "expectedSnapshotToken",
      "Review target state changed after this decision was prepared"
    );
  }

  const filesById = new Map(plan.files.map((file) => [file.changeId, file]));
  const decisionsById = new Map<string, KnowledgeReviewFileDecision>();
  command.decisions.forEach((decision, index) => {
    if (decisionsById.has(decision.changeId)) {
      addError(
        diagnostics,
        "review_command_decision_duplicate",
        `decisions[${index}].changeId`,
        "Review command must decide each file exactly once"
      );
    }
    decisionsById.set(decision.changeId, decision);
    const file = filesById.get(decision.changeId);
    if (!file) {
      addError(
        diagnostics,
        "review_command_change_unknown",
        `decisions[${index}].changeId`,
        "Review command contains an unknown change id"
      );
      return;
    }
    if (file.capability === "reject_only" && decision.decision !== "reject") {
      addError(
        diagnostics,
        "review_command_accept_blocked",
        `decisions[${index}].decision`,
        "This file is currently available for rejection only"
      );
    }
    if (decision.decision === "accept_blocks") {
      if (file.capability !== "blocks_allowed") {
        addError(
          diagnostics,
          "review_command_blocks_not_allowed",
          `decisions[${index}].decision`,
          "This file cannot be partially accepted"
        );
      }
      const changeBlockIds = new Set(
        file.blocks.filter((block) => block.kind === "change").map((block) => block.blockId)
      );
      const accepted = new Set<string>();
      decision.acceptedBlockIds.forEach((blockId, blockIndex) => {
        if (accepted.has(blockId)) {
          addError(
            diagnostics,
            "review_command_block_duplicate",
            `decisions[${index}].acceptedBlockIds[${blockIndex}]`,
            "Accepted block ids must be unique"
          );
        }
        if (!changeBlockIds.has(blockId)) {
          addError(
            diagnostics,
            "review_command_block_unknown",
            `decisions[${index}].acceptedBlockIds[${blockIndex}]`,
            "Accepted block id is not part of this file snapshot"
          );
        }
        accepted.add(blockId);
      });
    }
  });
  plan.files.forEach((file, index) => {
    if (!decisionsById.has(file.changeId)) {
      addError(
        diagnostics,
        "review_command_decision_missing",
        `files[${index}].changeId`,
        "Review command must decide every proposed file"
      );
    }
  });
  if (diagnostics.length > 0) {
    throw new KnowledgeReviewDecisionError(diagnostics);
  }
}

/**
 * Reconstructs exact text from block decisions.
 *
 * @param file - Immutable file preview
 * @param acceptedBlockIds - Changed blocks whose proposed side was accepted
 * @returns Exact selected text preserving line endings and trailing whitespace
 */
function composeSelectedContent(
  file: KnowledgeReviewFile,
  acceptedBlockIds: ReadonlySet<string>
): string {
  return file.blocks
    .flatMap((block) => {
      if (block.kind === "context") {
        return block.parts.map((part) => part.value);
      }
      const accept = acceptedBlockIds.has(block.blockId);
      return block.parts
        .filter((part) => (accept ? part.kind !== "removed" : part.kind !== "added"))
        .map((part) => part.value);
    })
    .join("");
}

/**
 * Compiles opaque file and block decisions into a revalidation-only candidate.
 *
 * @param proposal - Exact proposed ChangeSet represented by the plan
 * @param plan - Immutable review snapshot
 * @param command - Opaque UI decisions bound to the plan token
 * @returns Rejected outcome or revised proposed ChangeSet with false validation flags
 */
export function compileKnowledgeReviewSelection(
  proposal: KnowledgeChangeSet,
  plan: KnowledgeReviewPlan,
  command: KnowledgeReviewCommand
): { kind: "rejected" } | { kind: "candidate"; changeSet: KnowledgeChangeSet } {
  validateReviewCommand(plan, command);
  const parsedProposal = parseKnowledgeChangeSet(proposal);
  if (!parsedProposal.ok) {
    throw new KnowledgeReviewDecisionError(parsedProposal.issues);
  }
  if (
    parsedProposal.value.id !== plan.changeSetId ||
    createKnowledgeChangeSetDigest(parsedProposal.value) !== plan.proposalDigest
  ) {
    throw new KnowledgeReviewDecisionError([
      {
        code: "review_proposal_identity_mismatch",
        severity: "error",
        field: "proposal",
        message: "Review plan does not identify the supplied proposal",
      },
    ]);
  }

  const decisionsById = new Map(command.decisions.map((decision) => [decision.changeId, decision]));
  const filesById = new Map(plan.files.map((file) => [file.changeId, file]));
  const selectedChanges: KnowledgeFileChange[] = [];
  parsedProposal.value.changes.forEach((change) => {
    const decision = decisionsById.get(change.id)!;
    if (decision.decision === "reject") {
      return;
    }
    if (decision.decision === "accept_exact") {
      selectedChanges.push({
        ...change,
        sourceRefs: [...change.sourceRefs],
      });
      return;
    }

    const file = filesById.get(change.id)!;
    const afterContent = composeSelectedContent(file, new Set(decision.acceptedBlockIds));
    const beforeContent = file.beforeContent ?? "";
    if (afterContent === beforeContent) {
      return;
    }
    if (change.operation === "delete") {
      throw new KnowledgeReviewDecisionError([
        {
          code: "review_partial_delete_forbidden",
          severity: "error",
          field: change.id,
          message: "Delete operations cannot be partially accepted",
        },
      ]);
    }
    const afterHash = createFileContentHash(afterContent);
    const base = {
      id: change.id,
      path: change.path,
      sourceRefs: [...change.sourceRefs],
      reason: change.reason,
      afterContent,
      afterHash,
    };
    selectedChanges.push(
      change.operation === "create"
        ? { ...base, operation: "create", expectedAbsent: true }
        : { ...base, operation: "update", beforeHash: change.beforeHash }
    );
  });

  if (selectedChanges.length === 0) {
    return { kind: "rejected" };
  }
  return {
    kind: "candidate",
    changeSet: {
      ...parsedProposal.value,
      changes: selectedChanges,
      validation: { okfValid: false, citationsValid: false, linksValid: false },
      status: "proposed",
    },
  };
}

/**
 * Maps strict validator schema issues to bounded safe diagnostics.
 *
 * @param error - Zod validation error
 * @returns Bounded structural diagnostics
 */
function mapValidationIssues(error: z.ZodError): KnowledgeDiagnostic[] {
  return error.issues.slice(0, MAX_REVIEW_DIAGNOSTICS).map((issue) => ({
    code: `schema_${issue.code}`,
    severity: "error",
    field: issue.path.join("."),
    message:
      issue.code === "unrecognized_keys" ? "Object contains unsupported fields" : issue.message,
  }));
}

/** Deterministic review decision compiler with injected semantic validation. */
export class KnowledgeReviewDecisionService {
  /**
   * Creates the service over a required deterministic validator.
   *
   * @param validator - Projected OKF, link, and citation validation port
   */
  constructor(private readonly validator: KnowledgeReviewCandidateValidator) {}

  /**
   * Produces a rejected decision or exact accepted ChangeSet without writing.
   *
   * @param proposal - Exact durable proposed ChangeSet
   * @param observations - Read-only target observations used by the current UI snapshot
   * @param command - Opaque file and block decisions returned by the UI
   * @param signal - Cancellation signal owned by the submit action
   * @returns Rejected, blocked, or revalidated accepted decision
   */
  async decide(
    proposal: KnowledgeChangeSet,
    observations: readonly KnowledgeReviewTargetObservation[],
    command: KnowledgeReviewCommand,
    signal: AbortSignal
  ): Promise<KnowledgeReviewDecisionResult> {
    const plan = createKnowledgeReviewPlan(proposal, observations);
    const compiled = compileKnowledgeReviewSelection(proposal, plan, command);
    if (compiled.kind === "rejected") {
      return {
        kind: "rejected",
        changeSetId: plan.changeSetId,
        proposalDigest: plan.proposalDigest,
      };
    }
    if (signal.aborted) {
      throw new KnowledgeReviewAbortError();
    }

    let rawValidation: unknown;
    try {
      rawValidation = await this.validator.validate(
        {
          proposal,
          candidate: compiled.changeSet,
          proposalDigest: plan.proposalDigest,
          snapshotToken: plan.snapshotToken,
          observations: observations.map((observation) => ({ ...observation })),
        },
        signal
      );
    } catch {
      if (signal.aborted) {
        throw new KnowledgeReviewAbortError();
      }
      throw new KnowledgeReviewInfrastructureError();
    }
    if (signal.aborted) {
      throw new KnowledgeReviewAbortError();
    }

    const parsed = validationResultSchema.safeParse(rawValidation);
    if (!parsed.success) {
      return { kind: "blocked", diagnostics: mapValidationIssues(parsed.error) };
    }
    if (parsed.data.diagnostics.length > MAX_REVIEW_DIAGNOSTICS) {
      return {
        kind: "blocked",
        diagnostics: [
          {
            code: "review_validation_diagnostic_limit_exceeded",
            severity: "error",
            field: "diagnostics",
            message: "Review validator returned too many diagnostics",
          },
        ],
      };
    }
    const diagnostics = [...parsed.data.diagnostics];
    const validation = parsed.data.validation;
    if (!validation.okfValid) {
      addError(
        diagnostics,
        "review_candidate_okf_invalid",
        "validation.okfValid",
        "Selected files do not satisfy the configured OKF contract"
      );
    }
    if (!validation.citationsValid) {
      addError(
        diagnostics,
        "review_candidate_citations_invalid",
        "validation.citationsValid",
        "Selected files did not pass deterministic citation validation"
      );
    }
    if (!validation.linksValid) {
      addError(
        diagnostics,
        "review_candidate_links_invalid",
        "validation.linksValid",
        "Selected files contain unresolved or unsafe links"
      );
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return { kind: "blocked", diagnostics };
    }

    const accepted: KnowledgeChangeSet = {
      ...compiled.changeSet,
      validation,
      status: "accepted",
    };
    const parsedAccepted = parseKnowledgeChangeSet(accepted);
    if (!parsedAccepted.ok) {
      return { kind: "blocked", diagnostics: parsedAccepted.issues };
    }
    return {
      kind: "accepted",
      changeSet: parsedAccepted.value,
      acceptedDigest: createKnowledgeChangeSetDigest(parsedAccepted.value),
      diagnostics,
    };
  }
}
