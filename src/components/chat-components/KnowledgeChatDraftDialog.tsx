import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Notice } from "obsidian";
import React, { useEffect, useRef, useState } from "react";

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

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        container={container}
        className="tw-max-h-[85vh] tw-overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Create Knowledge Draft</DialogTitle>
          <DialogDescription>
            This is AI-generated text. Edit it, verify it against the original material, and add
            book or page references before creating the Source. It will enter Activity, where
            background compilation may finish as no changes or produce a Review. This action does
            not write Wiki pages. Compilation may use your configured model and incur API cost.
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="secondary" onClick={cancel}>
            {submitting ? "Stop creation" : "Cancel"}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "Creating source…" : "Create source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
