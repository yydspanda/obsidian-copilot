import type { Change } from "diff";
import React, { useMemo, useRef, useState } from "react";

import { SplitDiffBlock } from "@/components/composer/DiffPreview";
import { KnowledgeReviewEvidencePanel } from "@/components/knowledge/KnowledgeReviewEvidencePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isValidKnowledgeReviewManualEditText,
  KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS,
  type KnowledgeReviewBlock,
  type KnowledgeReviewCommand,
  type KnowledgeReviewDiffPart,
  type KnowledgeReviewFile,
  type KnowledgeReviewPlan,
} from "@/knowledge/review/ReviewDecision";
import type {
  KnowledgeReviewActiveEdit,
  KnowledgeReviewDraftState,
  KnowledgeReviewLocalDecision,
} from "@/knowledge/ui/KnowledgeReviewDraftStore";

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
  /** Optional controller-owned decisions retained across React remounts. */
  draft?: KnowledgeReviewDraftState;
  /** Replaces the controller-owned decision snapshot after one explicit choice. */
  onDraftChange?: (draft: KnowledgeReviewDraftState) => boolean;
  /** Optional controller-owned active textarea retained across UI remounts. */
  activeEdit?: Readonly<KnowledgeReviewActiveEdit>;
  /** Saves or closes one bounded active editor; false means fail-closed. */
  onActiveEditChange?: (activeEdit: Readonly<KnowledgeReviewActiveEdit> | undefined) => boolean;
}

type BlockDecision = "accept" | "reject";

type LocalFileDecision = KnowledgeReviewLocalDecision;
type LocalDecisionState = KnowledgeReviewDraftState;
const MAX_SAVED_MANUAL_EDIT_DIFF_PREVIEW_CHARACTERS = 200_000;
const MAX_SAVED_MANUAL_EDIT_DIFF_PREVIEW_LINES = 2_000;

/** Applies the native textarea's deterministic LF line-ending contract. */
function normalizeReviewEditorLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** Counts newline-delimited diff tokens only up to a fail-closed cap. */
function hasAtMostPreviewLines(value: string): boolean {
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x0a) {
      lines += 1;
      if (lines > MAX_SAVED_MANUAL_EDIT_DIFF_PREVIEW_LINES) return false;
    }
  }
  return true;
}

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

/** Keeps immutable proposal diff conversion outside the active-editor render hot path. */
const ProposalDiffBlock = React.memo(function ProposalDiffBlock({
  block,
}: {
  block: KnowledgeReviewBlock;
}): JSX.Element {
  const changes = useMemo(() => toDiffBlock(block), [block]);
  return <SplitDiffBlock block={changes} />;
});

/** Renders bounded full texts without invoking the word-level diff algorithm. */
const SavedManualEditPreview = React.memo(function SavedManualEditPreview({
  beforeContent,
  afterContent,
}: {
  beforeContent: string;
  afterContent: string;
}): JSX.Element {
  const previewAvailable =
    beforeContent.length + afterContent.length <= MAX_SAVED_MANUAL_EDIT_DIFF_PREVIEW_CHARACTERS &&
    hasAtMostPreviewLines(beforeContent) &&
    hasAtMostPreviewLines(afterContent);
  return (
    <div className="tw-flex tw-flex-col tw-gap-2" aria-label="Saved manual edit preview">
      <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
        This exact saved full-file edit replaces the original proposal if applied. It was not
        generated or semantically verified by a model; deterministic validation still runs before
        any Wiki write.
      </p>
      {previewAvailable ? (
        <div className="tw-grid tw-grid-cols-1 tw-gap-2 lg:tw-grid-cols-2">
          <section
            aria-label="Current file content"
            className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2"
          >
            <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Current</div>
            <pre className="tw-m-0 tw-whitespace-pre-wrap tw-font-mono tw-text-sm tw-text-error">
              {beforeContent}
            </pre>
          </section>
          <section
            aria-label="Edited file content"
            className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-2"
          >
            <div className="tw-mb-1 tw-text-xs tw-font-medium tw-text-muted">Edited</div>
            <pre className="tw-m-0 tw-whitespace-pre-wrap tw-font-mono tw-text-sm tw-text-success">
              {afterContent}
            </pre>
          </section>
        </div>
      ) : (
        <p className="tw-m-0 tw-text-xs tw-text-muted" role="note">
          Exact Current/Edited preview omitted because the text is too large for a safe inline
          preview (more than 200,000 total characters or 2,000 lines). Current:{" "}
          {beforeContent.length.toLocaleString()} characters. Edited:{" "}
          {afterContent.length.toLocaleString()} characters. Submission and deterministic validation
          still use the complete edited text without truncation.
        </p>
      )}
    </div>
  );
});

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
  return fileDecision?.kind === "accept_blocks" ? fileDecision.blocks[blockId] : undefined;
}

/** Returns the number of selected manual-edit characters across one draft. */
function getSelectedEditedCharacterCount(
  decisions: LocalDecisionState,
  replacedChangeId?: string,
  replacementContent?: string
): number {
  let total = replacementContent?.length ?? 0;
  Object.entries(decisions).forEach(([changeId, decision]) => {
    if (changeId !== replacedChangeId && decision?.kind === "accept_edited") {
      total += decision.afterContent.length;
    }
  });
  return total;
}

/** Returns an advisory UI limit message for one complete-file edit. */
function getManualEditLimitError(
  decisions: LocalDecisionState,
  file: KnowledgeReviewFile,
  afterContent: string
): string | undefined {
  if (afterContent.length > KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile) {
    return "This edited file exceeds the 2,000,000-character Review limit.";
  }
  if (
    getSelectedEditedCharacterCount(decisions, file.changeId, afterContent) >
    KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxTotalCharacters
  ) {
    return "Selected edited files exceed the 8,000,000-character Review limit.";
  }
  return undefined;
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

  const editedCharacterCount = getSelectedEditedCharacterCount(decisions);
  if (editedCharacterCount > KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxTotalCharacters) return false;

  return plan.files.every((file) => {
    const decision = decisions[file.changeId];
    if (!decision) return false;
    if (decision.kind === "reject") return true;
    if (decision.kind === "accept_exact") return file.capability !== "reject_only";
    if (decision.kind === "accept_edited") {
      return (
        file.operation !== "delete" &&
        file.capability !== "reject_only" &&
        typeof file.afterContent === "string" &&
        decision.afterContent.length <= KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile
      );
    }
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
      if (decision.kind === "accept_edited") {
        return {
          changeId: file.changeId,
          decision: "accept_edited",
          afterContent: decision.afterContent,
        };
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
  draft,
  onDraftChange,
  activeEdit,
  onActiveEditChange,
}: KnowledgeReviewPanelProps): JSX.Element {
  const [localDecisions, setLocalDecisions] = useState<LocalDecisionState>({});
  const [submitting, setSubmitting] = useState(false);
  const [localActiveEdit, setLocalActiveEdit] = useState<KnowledgeReviewActiveEdit>();
  const [editInputError, setEditInputError] = useState<string>();
  const [editErrorChangeId, setEditErrorChangeId] = useState<string>();
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const decisions = draft ?? localDecisions;
  const currentActiveEdit = onActiveEditChange ? activeEdit : localActiveEdit;
  const editingChangeId = currentActiveEdit?.changeId;
  const editBuffer = currentActiveEdit?.afterContent ?? "";

  const complete = useMemo(
    () => currentActiveEdit === undefined && isReviewComplete(plan, decisions),
    [currentActiveEdit, decisions, plan]
  );
  const wholeProposalRejected = useMemo(
    () => complete && plan.files.every((file) => decisions[file.changeId]?.kind === "reject"),
    [complete, decisions, plan]
  );
  const commandEnabled = wholeProposalRejected ? rejectCommandsEnabled : acceptCommandsEnabled;
  const actionBusy = busy || submitting;
  const hasRejectOnlyFile = plan.files.some((file) => file.capability === "reject_only");
  const submissionLabel = currentActiveEdit
    ? "Finish or cancel edit"
    : getSubmissionLabel({
        acceptCommandsEnabled,
        rejectCommandsEnabled,
        actionBusy,
        complete,
        commandEnabled,
        wholeProposalRejected,
      });

  /** Replaces controlled or component-local decisions after one user action. */
  const replaceDecisions = (
    update: (current: LocalDecisionState) => LocalDecisionState
  ): boolean => {
    const next = update(decisions);
    if (draft === undefined) {
      setLocalDecisions(next);
      onDraftChange?.(next);
      return true;
    }
    return onDraftChange?.(next) === true;
  };

  /** Replaces the controlled or component-local active editor within hard limits. */
  const replaceActiveEdit = (next: KnowledgeReviewActiveEdit | undefined): boolean => {
    if (onActiveEditChange) return onActiveEditChange(next);
    setLocalActiveEdit(next);
    return true;
  };

  /** Discards the active buffer while preserving its previously committed decision. */
  const closeEditor = (): void => {
    const changeId = editingChangeId;
    replaceActiveEdit(undefined);
    setEditInputError(undefined);
    setEditErrorChangeId(undefined);
    if (changeId) {
      queueMicrotask(() => editButtonRefs.current.get(changeId)?.focus());
    }
  };

  /** Applies one exact file-level decision. */
  const decideFile = (changeId: string, decision: LocalFileDecision): void => {
    replaceDecisions((current) => ({ ...current, [changeId]: decision }));
  };

  /** Applies one explicit changed-block decision without carrying file data. */
  const decideBlock = (
    file: KnowledgeReviewFile,
    blockId: string,
    decision: BlockDecision
  ): void => {
    replaceDecisions((current) => {
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
    if (replaceDecisions(() => next)) closeEditor();
  };

  /** Rejects every file without creating any write-bearing payload. */
  const rejectAll = (): void => {
    const next: Record<string, LocalFileDecision> = {};
    plan.files.forEach((file) => {
      next[file.changeId] = { kind: "reject" };
    });
    if (replaceDecisions(() => next)) closeEditor();
  };

  /** Opens a transient whole-file editor from the saved edit or original proposal. */
  const editFile = (file: KnowledgeReviewFile): void => {
    if (
      actionBusy ||
      !acceptCommandsEnabled ||
      file.operation === "delete" ||
      file.capability === "reject_only" ||
      typeof file.afterContent !== "string"
    ) {
      return;
    }
    const saved = decisions[file.changeId];
    const next = {
      changeId: file.changeId,
      afterContent: normalizeReviewEditorLineEndings(
        saved?.kind === "accept_edited" ? saved.afterContent : file.afterContent
      ),
    };
    const limitError = getManualEditLimitError(decisions, file, next.afterContent);
    if (limitError || !replaceActiveEdit(next)) {
      setEditInputError(limitError ?? "This editor could not be opened within Review limits.");
      setEditErrorChangeId(file.changeId);
      return;
    }
    setEditInputError(undefined);
    setEditErrorChangeId(undefined);
  };

  /** Commits one bounded textarea value as a session-local whole-file decision. */
  const commitEditedFile = (file: KnowledgeReviewFile): void => {
    const normalizedEdit = normalizeReviewEditorLineEndings(editBuffer);
    if (getManualEditLimitError(decisions, file, normalizedEdit) !== undefined) return;
    if (!isValidKnowledgeReviewManualEditText(normalizedEdit)) {
      setEditInputError(
        "This edit contains an unsupported control character or an incomplete Unicode character. Remove it and try again."
      );
      setEditErrorChangeId(file.changeId);
      return;
    }
    const saved = replaceDecisions((current) => ({
      ...current,
      [file.changeId]: { kind: "accept_edited", afterContent: normalizedEdit },
    }));
    if (!saved) {
      setEditInputError("This edited file could not be saved within Review session limits.");
      setEditErrorChangeId(file.changeId);
      return;
    }
    closeEditor();
  };

  /** Saves one keystroke only when it stays inside both session memory limits. */
  const updateEditBuffer = (file: KnowledgeReviewFile, afterContent: string): void => {
    const limitError = getManualEditLimitError(decisions, file, afterContent);
    if (limitError) {
      setEditInputError(`${limitError} Extra input was not retained.`);
      setEditErrorChangeId(file.changeId);
      return;
    }
    if (!replaceActiveEdit({ changeId: file.changeId, afterContent })) {
      setEditInputError("This edit could not be retained within Review limits.");
      setEditErrorChangeId(file.changeId);
      return;
    }
    setEditInputError(undefined);
    setEditErrorChangeId(undefined);
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
            disabled={
              actionBusy ||
              currentActiveEdit !== undefined ||
              !acceptCommandsEnabled ||
              hasRejectOnlyFile
            }
            onClick={acceptAll}
          >
            Use all proposed changes
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={actionBusy || currentActiveEdit !== undefined || !rejectCommandsEnabled}
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
          const editing = editingChangeId === file.changeId;
          const editEligible =
            file.operation !== "delete" && !rejectOnly && typeof file.afterContent === "string";
          const editLimitError = editing
            ? (getManualEditLimitError(decisions, file, editBuffer) ?? editInputError)
            : undefined;
          const editedTotal = editing
            ? getSelectedEditedCharacterCount(decisions, file.changeId, editBuffer)
            : getSelectedEditedCharacterCount(decisions);

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
                      disabled={
                        actionBusy ||
                        currentActiveEdit !== undefined ||
                        !acceptCommandsEnabled ||
                        rejectOnly
                      }
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
                      disabled={
                        actionBusy || currentActiveEdit !== undefined || !rejectCommandsEnabled
                      }
                      aria-label={`${getRejectFileLabel(file)} ${file.path}`}
                      aria-pressed={fileDecision?.kind === "reject"}
                      onClick={() => decideFile(file.changeId, { kind: "reject" })}
                    >
                      {getRejectFileLabel(file)}
                    </Button>
                    <Button
                      ref={(element) => {
                        if (element) editButtonRefs.current.set(file.changeId, element);
                        else editButtonRefs.current.delete(file.changeId);
                      }}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={
                        actionBusy ||
                        currentActiveEdit !== undefined ||
                        !acceptCommandsEnabled ||
                        !editEligible
                      }
                      aria-label={`Edit proposed file ${file.path}`}
                      aria-pressed={fileDecision?.kind === "accept_edited"}
                      onClick={() => editFile(file)}
                    >
                      Edit proposed file
                    </Button>
                  </div>
                </div>
                <p className="tw-m-0 tw-text-sm tw-text-muted">{file.reason}</p>
                {file.blockedReason ? (
                  <p className="tw-m-0 tw-text-xs tw-font-medium tw-text-error" role="note">
                    Acceptance blocked: {file.blockedReason}
                  </p>
                ) : null}
                {!editing && editErrorChangeId === file.changeId && editInputError ? (
                  <p className="tw-m-0 tw-text-xs tw-font-medium tw-text-error" role="alert">
                    {editInputError}
                  </p>
                ) : null}
              </CardHeader>

              <CardContent className="tw-flex tw-flex-col tw-gap-3 tw-p-4 tw-pt-0">
                {editing ? (
                  <div className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary-alt tw-p-3">
                    <label
                      className="tw-text-sm tw-font-medium"
                      htmlFor={`knowledge-review-edit-${file.changeId}`}
                    >
                      Edit complete proposed file
                    </label>
                    <p
                      className="tw-m-0 tw-text-xs tw-text-muted"
                      id={`knowledge-review-edit-help-${file.changeId}`}
                    >
                      This is a manual full-file edit. It does not ask a model to revise the text or
                      prove its meaning against sources. This editor stores line breaks as LF. The
                      original proposal preview is hidden while you type to keep editing responsive.
                      After you use the edited file, a bounded Current/Edited preview is shown.
                      Deterministic validation runs again before any Wiki write.
                    </p>
                    <textarea
                      id={`knowledge-review-edit-${file.changeId}`}
                      aria-describedby={`knowledge-review-edit-help-${file.changeId} knowledge-review-edit-count-${file.changeId}`}
                      aria-invalid={editLimitError !== undefined}
                      autoFocus
                      className="tw-min-h-48 tw-w-full tw-resize-y tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-font-mono tw-text-sm tw-text-normal"
                      disabled={actionBusy}
                      maxLength={KNOWLEDGE_REVIEW_MANUAL_EDIT_LIMITS.maxCharactersPerFile}
                      spellCheck={false}
                      value={editBuffer}
                      onChange={(event) => updateEditBuffer(file, event.currentTarget.value)}
                    />
                    <div
                      className="tw-flex tw-flex-wrap tw-justify-between tw-gap-2 tw-text-xs tw-text-muted"
                      id={`knowledge-review-edit-count-${file.changeId}`}
                    >
                      <span>{editBuffer.length.toLocaleString()} / 2,000,000 characters</span>
                      <span>{editedTotal.toLocaleString()} / 8,000,000 selected edited total</span>
                    </div>
                    {editLimitError ? (
                      <p className="tw-m-0 tw-text-xs tw-font-medium tw-text-error" role="alert">
                        {editLimitError}
                      </p>
                    ) : null}
                    <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={actionBusy}
                        onClick={closeEditor}
                      >
                        Cancel edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={actionBusy}
                        onClick={() =>
                          updateEditBuffer(
                            file,
                            normalizeReviewEditorLineEndings(file.afterContent ?? "")
                          )
                        }
                      >
                        Reset to proposed
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={actionBusy || editLimitError !== undefined}
                        onClick={() => commitEditedFile(file)}
                      >
                        Use edited file
                      </Button>
                    </div>
                  </div>
                ) : null}

                {editing ? null : fileDecision?.kind === "accept_edited" ? (
                  <SavedManualEditPreview
                    afterContent={fileDecision.afterContent}
                    beforeContent={file.beforeContent ?? ""}
                  />
                ) : (
                  file.blocks.map((block) => {
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
                                disabled={
                                  actionBusy ||
                                  currentActiveEdit !== undefined ||
                                  !acceptCommandsEnabled
                                }
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
                                disabled={
                                  actionBusy ||
                                  currentActiveEdit !== undefined ||
                                  !acceptCommandsEnabled
                                }
                                aria-label={`Keep current block ${changedIndex + 1} in ${file.path}`}
                                aria-pressed={visibleDecision === "reject"}
                                onClick={() => decideBlock(file, block.blockId, "reject")}
                              >
                                Keep current block
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        <ProposalDiffBlock block={block} />
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <footer className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
        <div>
          {onBack ? (
            <Button disabled={actionBusy} onClick={onBack}>
              Back
            </Button>
          ) : null}
        </div>
        <div className="tw-flex tw-items-center tw-gap-3">
          {currentActiveEdit ? (
            <span className="tw-text-xs tw-text-muted">Use edited file or Cancel edit first.</span>
          ) : !complete ? (
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
  const identity = `${props.plan.changeSetId}:${props.plan.proposalDigest}:${props.plan.snapshotToken}`;
  return <KnowledgeReviewSnapshotPanel key={identity} {...props} />;
}
