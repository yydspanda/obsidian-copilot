import type { Change } from "diff";
import React, { useMemo, useState } from "react";

import { SplitDiffBlock } from "@/components/composer/DiffPreview";
import { KnowledgeReviewEvidencePanel } from "@/components/knowledge/KnowledgeReviewEvidencePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  KnowledgeReviewBlock,
  KnowledgeReviewCommand,
  KnowledgeReviewDiffPart,
  KnowledgeReviewFile,
  KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";

/** Props for the capability-separated multi-file knowledge review surface. */
export interface KnowledgeReviewPanelProps {
  plan: Readonly<KnowledgeReviewPlan>;
  busy: boolean;
  acceptCommandsEnabled: boolean;
  rejectCommandsEnabled: boolean;
  onSubmit: (command: KnowledgeReviewCommand) => void | Promise<void>;
  onBack?: () => void;
  onOpenEvidence?: (evidenceRef: string) => void | Promise<void>;
  openingEvidenceRef?: string;
  evidenceError?: string;
}

type BlockDecision = "accept" | "reject";

type LocalFileDecision =
  | { kind: "accept_exact" }
  | { kind: "reject" }
  | { kind: "accept_blocks"; blocks: Readonly<Record<string, BlockDecision>> };

type LocalDecisionState = Readonly<Record<string, LocalFileDecision | undefined>>;

/**
 * Converts one review diff part into the reusable renderer's exact chunk shape.
 *
 * @param part - Immutable review diff part
 * @returns Detached diff chunk with explicit flags
 */
function toDiffChange(part: KnowledgeReviewDiffPart): Change {
  return {
    value: part.value,
    added: part.kind === "added",
    removed: part.kind === "removed",
  };
}

/**
 * Converts one opaque review block into renderer-only diff chunks.
 *
 * @param block - Immutable review block
 * @returns Exact chunks suitable for visual rendering
 */
function toDiffBlock(block: KnowledgeReviewBlock): Change[] {
  return block.parts.map(toDiffChange);
}

/**
 * Returns changed blocks in their immutable review-plan order.
 *
 * @param file - Review file projection
 * @returns Changed blocks that require a partial-review decision
 */
function getChangedBlocks(file: KnowledgeReviewFile): KnowledgeReviewBlock[] {
  return file.blocks.filter((block) => block.kind === "change");
}

/**
 * Resolves the visible decision for one changed block.
 *
 * @param fileDecision - Current file-level or partial decision
 * @param blockId - Opaque changed-block id
 * @returns Current explicit decision, if any
 */
function getVisibleBlockDecision(
  fileDecision: LocalFileDecision | undefined,
  blockId: string
): BlockDecision | undefined {
  if (fileDecision?.kind === "accept_exact") return "accept";
  if (fileDecision?.kind === "reject") return "reject";
  return fileDecision?.blocks[blockId];
}

/**
 * Checks whether every file and every partial changed block has an explicit decision.
 *
 * @param plan - Current immutable review snapshot
 * @param decisions - Local UI-only decisions
 * @returns True when an opaque command can be created safely
 */
function isReviewComplete(plan: KnowledgeReviewPlan, decisions: LocalDecisionState): boolean {
  if (plan.files.length === 0) return false;

  return plan.files.every((file) => {
    const decision = decisions[file.changeId];
    if (!decision) return false;
    if (decision.kind === "reject") return true;
    if (decision.kind === "accept_exact") return file.capability !== "reject_only";
    if (file.capability !== "blocks_allowed") return false;
    return getChangedBlocks(file).every((block) => decision.blocks[block.blockId] !== undefined);
  });
}

/**
 * Builds the command boundary using opaque ids from the current plan only.
 *
 * @param plan - Current immutable review snapshot
 * @param decisions - Complete UI-only decisions
 * @returns Opaque review command without paths, content, or hashes
 */
function buildReviewCommand(
  plan: KnowledgeReviewPlan,
  decisions: LocalDecisionState
): KnowledgeReviewCommand {
  return {
    changeSetId: plan.changeSetId,
    proposalDigest: plan.proposalDigest,
    expectedSnapshotToken: plan.snapshotToken,
    decisions: plan.files.map((file) => {
      const decision = decisions[file.changeId];
      if (!decision) {
        throw new Error("Cannot submit an incomplete knowledge review");
      }
      if (decision.kind === "accept_blocks") {
        const acceptedBlockIds = getChangedBlocks(file)
          .filter((block) => decision.blocks[block.blockId] === "accept")
          .map((block) => block.blockId);
        return { changeId: file.changeId, decision: "accept_blocks", acceptedBlockIds };
      }
      return { changeId: file.changeId, decision: decision.kind };
    }),
  };
}

/**
 * Converts a file decision into a complete starting point for block-level edits.
 *
 * @param file - File whose changed blocks are being edited
 * @param decision - Existing file-level or partial decision
 * @returns Mutable detached block-decision map
 */
function createBlockDecisionBase(
  file: KnowledgeReviewFile,
  decision: LocalFileDecision | undefined
): Record<string, BlockDecision> {
  if (decision?.kind === "accept_blocks") return { ...decision.blocks };
  if (decision?.kind === "accept_exact") {
    return Object.fromEntries(getChangedBlocks(file).map((block) => [block.blockId, "accept"]));
  }
  if (decision?.kind === "reject") {
    return Object.fromEntries(getChangedBlocks(file).map((block) => [block.blockId, "reject"]));
  }
  return {};
}

/** Returns the consequence-oriented accept label for one file operation. */
function getAcceptFileLabel(file: KnowledgeReviewFile): string {
  switch (file.operation) {
    case "create":
      return "Create proposed file";
    case "update":
      return "Use proposed file";
    case "delete":
      return "Delete file";
  }
}

/** Returns the consequence-oriented reject label for one file operation. */
function getRejectFileLabel(file: KnowledgeReviewFile): string {
  return file.operation === "create" ? "Skip proposed file" : "Keep current file";
}

/** Returns the final action label for the current complete or incomplete decision set. */
function getSubmissionLabel({
  acceptCommandsEnabled,
  rejectCommandsEnabled,
  actionBusy,
  complete,
  commandEnabled,
  wholeProposalRejected,
}: {
  acceptCommandsEnabled: boolean;
  rejectCommandsEnabled: boolean;
  actionBusy: boolean;
  complete: boolean;
  commandEnabled: boolean;
  wholeProposalRejected: boolean;
}): string {
  if (!acceptCommandsEnabled && !rejectCommandsEnabled) return "Review actions unavailable";
  if (actionBusy) {
    return wholeProposalRejected ? "Rejecting proposal…" : "Validating and applying…";
  }
  if (!complete) return "Choose all decisions";
  if (!commandEnabled) {
    return wholeProposalRejected ? "Proposal rejection unavailable" : "Apply unavailable";
  }
  return wholeProposalRejected ? "Reject proposal" : "Validate and apply selection";
}

/**
 * Renders a review plan without exposing any file-write capability to React.
 *
 * Decisions emitted by this component contain only content-addressed snapshot
 * identity plus opaque change and block ids. The review core reconstructs and
 * validates exact content after this boundary.
 */
function KnowledgeReviewSnapshotPanel({
  plan,
  busy,
  acceptCommandsEnabled,
  rejectCommandsEnabled,
  onSubmit,
  onBack,
  onOpenEvidence,
  openingEvidenceRef,
  evidenceError,
}: KnowledgeReviewPanelProps): JSX.Element {
  const [decisions, setDecisions] = useState<LocalDecisionState>({});
  const [submitting, setSubmitting] = useState(false);

  const complete = useMemo(() => isReviewComplete(plan, decisions), [decisions, plan]);
  const wholeProposalRejected = useMemo(
    () => complete && plan.files.every((file) => decisions[file.changeId]?.kind === "reject"),
    [complete, decisions, plan]
  );
  const commandEnabled = wholeProposalRejected ? rejectCommandsEnabled : acceptCommandsEnabled;
  const actionBusy = busy || submitting;
  const hasRejectOnlyFile = plan.files.some((file) => file.capability === "reject_only");
  const submissionLabel = getSubmissionLabel({
    acceptCommandsEnabled,
    rejectCommandsEnabled,
    actionBusy,
    complete,
    commandEnabled,
    wholeProposalRejected,
  });

  /** Applies one exact file-level decision. */
  const decideFile = (changeId: string, decision: LocalFileDecision): void => {
    setDecisions((current) => ({ ...current, [changeId]: decision }));
  };

  /** Applies one explicit changed-block decision without carrying file data. */
  const decideBlock = (
    file: KnowledgeReviewFile,
    blockId: string,
    decision: BlockDecision
  ): void => {
    setDecisions((current) => {
      const blocks = createBlockDecisionBase(file, current[file.changeId]);
      blocks[blockId] = decision;
      return {
        ...current,
        [file.changeId]: { kind: "accept_blocks", blocks },
      };
    });
  };

  /** Accepts every file exactly only when the whole proposal is eligible. */
  const acceptAll = (): void => {
    if (hasRejectOnlyFile) return;
    const next: Record<string, LocalFileDecision> = {};
    plan.files.forEach((file) => {
      next[file.changeId] = { kind: "accept_exact" };
    });
    setDecisions(next);
  };

  /** Rejects every file without creating any write-bearing payload. */
  const rejectAll = (): void => {
    const next: Record<string, LocalFileDecision> = {};
    plan.files.forEach((file) => {
      next[file.changeId] = { kind: "reject" };
    });
    setDecisions(next);
  };

  /** Emits one complete opaque command while suppressing duplicate submissions. */
  const submitReview = (): void => {
    if (actionBusy || !complete || !commandEnabled) return;
    const command = buildReviewCommand(plan, decisions);
    setSubmitting(true);
    try {
      const result = onSubmit(command);
      if (result === undefined) {
        setSubmitting(false);
        return;
      }
      void result.then(
        () => setSubmitting(false),
        () => setSubmitting(false)
      );
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <section className="tw-flex tw-flex-col tw-gap-4" aria-label="Knowledge change review">
      <header className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
        <div className="tw-min-w-0">
          <h2 className="tw-m-0 tw-text-lg tw-font-semibold">Review knowledge changes</h2>
          <p className="tw-m-0 tw-mt-1 tw-text-sm tw-text-muted">
            {plan.files.length} {plan.files.length === 1 ? "file" : "files"} in this proposal
          </p>
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-text-muted">
            Sources: {plan.sourceRefs.join(", ") || "None"}
          </p>
          <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-2 tw-text-xs">
            <span>OKF: {plan.validation.okfValid ? "valid" : "needs validation"}</span>
            <span>Citations: {plan.validation.citationsValid ? "valid" : "needs validation"}</span>
            <span>Links: {plan.validation.linksValid ? "valid" : "needs validation"}</span>
          </div>
        </div>
        <div className="tw-flex tw-flex-wrap tw-gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={actionBusy || !acceptCommandsEnabled || hasRejectOnlyFile}
            onClick={acceptAll}
          >
            Use all proposed changes
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={actionBusy || !rejectCommandsEnabled}
            onClick={rejectAll}
          >
            Skip all changes
          </Button>
        </div>
      </header>

      <KnowledgeReviewEvidencePanel
        busy={actionBusy}
        evidence={plan.evidence}
        evidenceError={evidenceError}
        headingId={`knowledge-review-evidence-${plan.changeSetId}-${plan.snapshotToken}`}
        omittedEvidenceCount={plan.omittedEvidenceCount}
        openingEvidenceRef={openingEvidenceRef}
        onOpenEvidence={onOpenEvidence}
      />

      <div className="tw-flex tw-flex-col tw-gap-3">
        {plan.files.map((file) => {
          const fileDecision = decisions[file.changeId];
          const changedBlocks = getChangedBlocks(file);
          const rejectOnly = file.capability === "reject_only";

          return (
            <Card
              key={file.changeId}
              className={rejectOnly ? "tw-bg-error" : undefined}
              data-testid={`review-file-${file.changeId}`}
            >
              <CardHeader className="tw-gap-3 tw-p-4">
                <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-3">
                  <div className="tw-min-w-0 tw-flex-1">
                    <CardTitle className="tw-break-all tw-font-mono tw-text-sm">
                      {file.path}
                    </CardTitle>
                    <div className="tw-mt-1 tw-flex tw-flex-wrap tw-gap-2 tw-text-xs tw-text-muted">
                      <span>{file.operation}</span>
                      <span>{file.integrity}</span>
                      <span>{file.capability}</span>
                    </div>
                    <div className="tw-mt-1 tw-text-xs tw-text-muted">
                      Sources: {file.sourceRefs.join(", ") || "None"}
                    </div>
                  </div>
                  <div className="tw-flex tw-gap-2">
                    <Button
                      type="button"
                      variant="success"
                      size="sm"
                      disabled={actionBusy || !acceptCommandsEnabled || rejectOnly}
                      aria-label={`${getAcceptFileLabel(file)} ${file.path}`}
                      aria-pressed={fileDecision?.kind === "accept_exact"}
                      onClick={() => decideFile(file.changeId, { kind: "accept_exact" })}
                    >
                      {getAcceptFileLabel(file)}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={actionBusy || !rejectCommandsEnabled}
                      aria-label={`${getRejectFileLabel(file)} ${file.path}`}
                      aria-pressed={fileDecision?.kind === "reject"}
                      onClick={() => decideFile(file.changeId, { kind: "reject" })}
                    >
                      {getRejectFileLabel(file)}
                    </Button>
                  </div>
                </div>
                <p className="tw-m-0 tw-text-sm tw-text-muted">{file.reason}</p>
                {file.blockedReason ? (
                  <p className="tw-m-0 tw-text-xs tw-font-medium tw-text-error" role="note">
                    Acceptance blocked: {file.blockedReason}
                  </p>
                ) : null}
              </CardHeader>

              <CardContent className="tw-flex tw-flex-col tw-gap-3 tw-p-4 tw-pt-0">
                {file.blocks.map((block) => {
                  const changedIndex = changedBlocks.findIndex(
                    (candidate) => candidate.blockId === block.blockId
                  );
                  const visibleDecision = getVisibleBlockDecision(fileDecision, block.blockId);

                  return (
                    <div
                      key={block.blockId}
                      className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2"
                    >
                      {block.kind === "change" && file.capability === "blocks_allowed" ? (
                        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
                          <span className="tw-text-xs tw-font-medium">
                            Changed block {changedIndex + 1}
                          </span>
                          <div className="tw-flex tw-gap-2">
                            <Button
                              type="button"
                              variant="success"
                              size="sm"
                              disabled={actionBusy || !acceptCommandsEnabled}
                              aria-label={`Use proposed block ${changedIndex + 1} in ${file.path}`}
                              aria-pressed={visibleDecision === "accept"}
                              onClick={() => decideBlock(file, block.blockId, "accept")}
                            >
                              Use proposed block
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={actionBusy || !acceptCommandsEnabled}
                              aria-label={`Keep current block ${changedIndex + 1} in ${file.path}`}
                              aria-pressed={visibleDecision === "reject"}
                              onClick={() => decideBlock(file, block.blockId, "reject")}
                            >
                              Keep current block
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <SplitDiffBlock block={toDiffBlock(block)} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <footer className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
        <div>{onBack ? <Button onClick={onBack}>Back</Button> : null}</div>
        <div className="tw-flex tw-items-center tw-gap-3">
          {!complete ? (
            <span className="tw-text-xs tw-text-muted">
              Choose what to do with every file and changed block.
            </span>
          ) : wholeProposalRejected ? (
            <span className="tw-text-xs tw-text-muted">Rejecting makes no Wiki file changes.</span>
          ) : null}
          <Button
            type="button"
            disabled={actionBusy || !complete || !commandEnabled}
            onClick={submitReview}
          >
            {submissionLabel}
          </Button>
        </div>
      </footer>
    </section>
  );
}

/**
 * Remounts snapshot-local decisions whenever the content-addressed plan changes.
 *
 * @param props - Read-only plan and callback boundary
 * @returns Snapshot-isolated knowledge review surface
 */
export function KnowledgeReviewPanel(props: KnowledgeReviewPanelProps): JSX.Element {
  return <KnowledgeReviewSnapshotPanel key={props.plan.snapshotToken} {...props} />;
}
