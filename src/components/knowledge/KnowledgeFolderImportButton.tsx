import * as React from "react";
import { AlertCircle, CheckCircle2, FolderOpen, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  KnowledgeFolderImportError,
  type KnowledgeFolderImportErrorCode,
  type KnowledgeFolderImportPort,
  type KnowledgeFolderImportReceipt,
} from "@/knowledge/capture/KnowledgeFolderImportPort";

/** Props for the popout-safe Knowledge folder import control. */
export interface KnowledgeFolderImportButtonProps {
  port: KnowledgeFolderImportPort;
}

interface KnowledgeFolderImportFeedback {
  kind: "completed" | "partial" | "error";
  message: string;
}

const ERROR_MESSAGES: Readonly<Record<KnowledgeFolderImportErrorCode, string>> = {
  unavailable: "Folder import is not available yet.",
  ambiguous_bundle: "Folder import requires exactly one active Knowledge Bundle.",
  ambiguous_source_root: "Folder import requires exactly one configured Knowledge source folder.",
  invalid_selection: "Choose one valid folder containing supported knowledge files.",
  selection_too_large: "The selected folder exceeds the bounded import limits.",
  unsupported_runtime: "This Obsidian runtime cannot import a folder.",
  import_failed: "Folder import could not be completed.",
};

/**
 * Converts an aggregate import receipt into path-free user feedback.
 *
 * @param receipt - Aggregate import outcome containing counts only
 * @returns Sanitized status feedback that exposes no selected file identity
 */
function createReceiptFeedback(
  receipt: Readonly<KnowledgeFolderImportReceipt>
): KnowledgeFolderImportFeedback {
  const prefix =
    receipt.status === "completed"
      ? "Folder import completed."
      : "Folder import partially completed.";
  return {
    kind: receipt.status,
    message: `${prefix} ${receipt.importedFiles} imported · ${receipt.reusedFiles} reused · ${receipt.skippedFiles} skipped · ${receipt.conflictFiles} conflicts · ${receipt.failedFiles} failed.`,
  };
}

/**
 * Converts any rejected import into a fixed, path-free error message.
 *
 * @param error - Unknown rejection supplied by the import boundary
 * @returns Sanitized error feedback without echoing the rejection message
 */
function createErrorFeedback(error: unknown): KnowledgeFolderImportFeedback {
  const code =
    error instanceof KnowledgeFolderImportError ? error.code : ("import_failed" as const);
  return { kind: "error", message: ERROR_MESSAGES[code] };
}

/**
 * Renders a folder-only picker backed by the stable Knowledge import port.
 *
 * The picker is created from the button's owning document so selections work
 * in Obsidian popout windows. Selected files are passed as opaque browser File
 * capabilities; no file name or external path is rendered or persisted here.
 *
 * @param props - Stable import capability for the current plugin lifecycle
 * @returns Folder import button and path-free aggregate feedback
 */
export function KnowledgeFolderImportButton({
  port,
}: KnowledgeFolderImportButtonProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const pickerCleanupRef = React.useRef<(() => void) | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);
  const [importing, setImporting] = React.useState(false);
  const [feedback, setFeedback] = React.useState<KnowledgeFolderImportFeedback>();

  /** Removes the current detached picker and its event listeners. */
  const releasePicker = React.useCallback(() => {
    const cleanup = pickerCleanupRef.current;
    pickerCleanupRef.current = null;
    if (cleanup) {
      cleanup();
      return;
    }
    const input = inputRef.current;
    inputRef.current = null;
    input?.remove();
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releasePicker();
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [releasePicker]);

  /** Imports the exact non-empty browser selection through a revocable operation. */
  const importSelection = React.useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (files.length === 0 || !mountedRef.current) return;

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setFeedback(undefined);
      setImporting(true);

      try {
        const receipt = await port.importFolder({ files }, abortController.signal);
        if (!mountedRef.current || abortController.signal.aborted) return;
        setFeedback(createReceiptFeedback(receipt));
      } catch (error) {
        if (!mountedRef.current || abortController.signal.aborted) return;
        setFeedback(createErrorFeedback(error));
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
          if (mountedRef.current) setImporting(false);
        }
      }
    },
    [port]
  );

  /** Opens one folder-only browser picker in the button's current owner document. */
  const openPicker = React.useCallback(() => {
    const button = buttonRef.current;
    if (!button || importing) return;

    releasePicker();
    const input = button.doc.win.createEl("input");
    input.type = "file";
    input.multiple = true;
    input.hidden = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");

    /** Removes this exact picker without consulting the current document. */
    function cleanupPicker(): void {
      input.removeEventListener("change", finishSelection);
      input.removeEventListener("cancel", cancelSelection);
      input.remove();
      if (inputRef.current === input) inputRef.current = null;
      if (pickerCleanupRef.current === cleanupPicker) pickerCleanupRef.current = null;
    }

    /** Snapshots the selected File capabilities before releasing the picker. */
    function finishSelection(): void {
      const files = Array.from(input.files ?? []);
      releasePicker();
      if (files.length > 0) void importSelection(files);
    }

    /** Releases a picker explicitly cancelled by the browser. */
    function cancelSelection(): void {
      releasePicker();
    }

    input.addEventListener("change", finishSelection, { once: true });
    input.addEventListener("cancel", cancelSelection, { once: true });
    inputRef.current = input;
    pickerCleanupRef.current = cleanupPicker;
    button.parentElement?.appendChild(input);
    try {
      input.click();
    } catch {
      releasePicker();
      setFeedback({ kind: "error", message: ERROR_MESSAGES.unsupported_runtime });
    }
  }, [importSelection, importing, releasePicker]);

  const FeedbackIcon = feedback?.kind === "completed" ? CheckCircle2 : AlertCircle;

  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-items-end tw-gap-1">
      <Button
        ref={buttonRef}
        disabled={importing}
        size="sm"
        type="button"
        variant="secondary"
        onClick={openPicker}
      >
        {importing ? (
          <Loader2 aria-hidden="true" className="tw-size-3 tw-animate-spin" />
        ) : (
          <FolderOpen aria-hidden="true" className="tw-size-3" />
        )}
        {importing ? "Importing folder…" : "Import folder"}
      </Button>
      {feedback ? (
        <div
          aria-live="polite"
          className={`tw-flex tw-items-center tw-gap-1 tw-text-xs ${
            feedback.kind === "error" ? "tw-text-error" : "tw-text-muted"
          }`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          <FeedbackIcon aria-hidden="true" className="tw-size-3 tw-shrink-0" />
          <span>{feedback.message}</span>
        </div>
      ) : null}
    </div>
  );
}
