import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  KNOWLEDGE_CHAT_DRAFT_LIMITS,
  type KnowledgeChatDraftRequest,
} from "@/knowledge/capture/KnowledgeChatDraftCapture";
import {
  KnowledgeChatCaptureError,
  type KnowledgeChatCapturePort,
  type KnowledgeChatDraftSession,
} from "@/knowledge/capture/KnowledgeChatCapturePort";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface KnowledgeChatDraftDialogProps {
  readonly open: boolean;
  readonly initialBody: string;
  readonly container: HTMLElement | null;
  readonly capturePort: KnowledgeChatCapturePort;
  readonly session: Readonly<KnowledgeChatDraftSession>;
  readonly onOpenChange: (open: boolean) => void;
}

/** Converts one sanitized command failure into concise, content-free UI guidance. */
function getDraftFailureMessage(error: unknown): string {
  if (error instanceof KnowledgeChatCaptureError) {
    switch (error.code) {
      case "draft_invalid":
        return "Check that the title and Markdown body are non-empty and within the limits.";
      case "draft_conflict":
        return "A conflicting Knowledge draft already exists. Nothing was overwritten.";
      case "ambiguous_bundle":
      case "ambiguous_source_root":
      case "unsupported_source_type":
      case "unavailable":
        return "Knowledge Draft is not available for the current Project configuration.";
      default:
        return "The draft could not be registered. No Wiki page was written.";
    }
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "Draft creation stopped. Check Sources and Activity before retrying; an exact retry will not overwrite files.";
  }
  return "The draft could not be registered. No Wiki page was written.";
}

/**
 * Lets the user edit and verify one AI response before it becomes a registered Source.
 *
 * The dialog never chooses a Vault path and never writes Wiki content. Its only
 * mutation is the stable generation-owned Chat capture command supplied by main.
 */
export const KnowledgeChatDraftDialog: React.FC<KnowledgeChatDraftDialogProps> = ({
  open,
  initialBody,
  container,
  capturePort,
  session,
  onOpenChange,
}) => {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState(initialBody);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open || !container) return;
    const ownerDocument = container.ownerDocument;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (!submitting) onOpenChange(false);
    };
    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => ownerDocument.removeEventListener("keydown", handleKeyDown);
  }, [container, onOpenChange, open, submitting]);

  const canSubmit =
    !submitting &&
    title.length > 0 &&
    title.length <= KNOWLEDGE_CHAT_DRAFT_LIMITS.maxTitleCharacters &&
    title.trim() === title &&
    body.trim().length > 0 &&
    body.length <= KNOWLEDGE_CHAT_DRAFT_LIMITS.maxBodyCharacters &&
    reviewConfirmed;

  /** Submits the exact current editor values through the revocable durable port. */
  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    const request: Readonly<KnowledgeChatDraftRequest> = Object.freeze({
      title,
      body,
      reviewConfirmed: true,
    });
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const receipt = await capturePort.createKnowledgeDraft(session, request, controller.signal);
      new Notice(
        receipt.status === "registered"
          ? `Knowledge draft registered at ${receipt.sourcePath}. Wiki is unchanged; follow it in Activity.`
          : `This Knowledge draft was already registered at ${receipt.sourcePath}. Wiki is unchanged.`
      );
      if (mountedRef.current) onOpenChange(false);
    } catch (error) {
      if (mountedRef.current) setErrorMessage(getDraftFailureMessage(error));
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  /** Requests cancellation without pretending that an in-flight durable boundary rolled back. */
  const cancel = (): void => {
    if (submitting) {
      abortControllerRef.current?.abort();
      new Notice(
        "Stop requested. Check Sources and Activity before retrying; a durable step may already have completed."
      );
    }
    onOpenChange(false);
  };

  if (!open || !container) return null;

  return createPortal(
    <div
      className={cn(
        "tw-fixed tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-bg-overlay/50 tw-p-4"
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-chat-draft-dialog-title"
        aria-describedby="knowledge-chat-draft-dialog-description"
        className={cn(
          "tw-relative tw-grid tw-max-h-[85vh] tw-w-full tw-max-w-lg tw-gap-4 tw-overflow-y-auto tw-rounded-lg tw-border tw-bg-primary tw-p-6 tw-shadow-lg"
        )}
      >
        <Button
          type="button"
          variant="ghost2"
          size="icon"
          aria-label="Close"
          disabled={submitting}
          className={cn("tw-absolute tw-right-4 tw-top-4")}
          onClick={() => onOpenChange(false)}
        >
          <X className={cn("tw-size-4")} />
        </Button>

        <header className={cn("tw-flex tw-flex-col tw-space-y-0.5 tw-text-left")}>
          <h2
            id="knowledge-chat-draft-dialog-title"
            className={cn("tw-m-0 tw-text-lg tw-font-semibold tw-leading-none tw-tracking-tight")}
          >
            Create Knowledge Draft
          </h2>
          <p
            id="knowledge-chat-draft-dialog-description"
            className={cn("tw-m-0 tw-text-sm tw-text-muted")}
          >
            This is AI-generated text. Edit it, verify it against the original material, and add
            book or page references before creating the Source. It will enter Activity, where
            background compilation may finish as no changes or produce a Review. This action does
            not write Wiki pages. Compilation may use your configured model and incur API cost.
          </p>
        </header>

        <div className="tw-rounded-md tw-border tw-p-3 tw-text-sm">
          <div>
            <strong>Bundle:</strong> {session.bundleId}
          </div>
          <div>
            <strong>Source root:</strong> {session.sourceRoot}
          </div>
          <div className="tw-text-muted">
            This destination is locked for this dialog. If the Knowledge generation changes,
            submission stops instead of switching to another Bundle.
          </div>
        </div>

        <div className="tw-flex tw-flex-col tw-gap-2">
          <Label htmlFor="knowledge-chat-draft-title">Title</Label>
          <Input
            id="knowledge-chat-draft-title"
            autoFocus
            value={title}
            maxLength={KNOWLEDGE_CHAT_DRAFT_LIMITS.maxTitleCharacters}
            disabled={submitting}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </div>

        <div className="tw-flex tw-items-start tw-gap-2">
          <Checkbox
            id="knowledge-chat-draft-reviewed"
            checked={reviewConfirmed}
            disabled={submitting}
            onCheckedChange={(checked) => setReviewConfirmed(checked === true)}
          />
          <Label
            htmlFor="knowledge-chat-draft-reviewed"
            className="tw-cursor-pointer tw-text-sm tw-leading-5"
          >
            I reviewed this draft and want to register it as a Knowledge Source.
          </Label>
        </div>

        <div className="tw-flex tw-flex-col tw-gap-2">
          <Label htmlFor="knowledge-chat-draft-body">Markdown draft</Label>
          <Textarea
            id="knowledge-chat-draft-body"
            value={body}
            maxLength={KNOWLEDGE_CHAT_DRAFT_LIMITS.maxBodyCharacters}
            disabled={submitting}
            rows={14}
            className="tw-min-h-56 tw-font-mono"
            onChange={(event) => setBody(event.currentTarget.value)}
          />
        </div>

        {errorMessage && (
          <div role="alert" className="tw-text-sm tw-text-error">
            {errorMessage}
          </div>
        )}

        <div
          className={cn("tw-flex tw-flex-col-reverse sm:tw-flex-row sm:tw-justify-end sm:tw-gap-2")}
        >
          <Button variant="secondary" onClick={cancel}>
            {submitting ? "Stop creation" : "Cancel"}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "Creating source…" : "Create source"}
          </Button>
        </div>
      </div>
    </div>,
    container
  );
};
