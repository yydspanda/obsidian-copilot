import * as React from "react";

import { KnowledgeAddMaterialForm } from "@/components/knowledge/KnowledgeAddMaterialForm";
import { Button } from "@/components/ui/button";
import {
  KnowledgeStudioMaterialError,
  type KnowledgeStudioMaterialErrorCode,
  type KnowledgeStudioMaterialPort,
  type KnowledgeStudioMaterialReceipt,
  type KnowledgeStudioMaterialSelection,
  type KnowledgeStudioMaterialSession,
} from "@/knowledge/capture/KnowledgeStudioMaterialPort";

export interface KnowledgeAddMaterialButtonProps {
  port: KnowledgeStudioMaterialPort;
  bundleId: string;
  queueState: "running" | "paused" | "unknown";
  /** Receives committed receipts after refresh/unmount; the owner checks the current bundle. */
  onReceipt: (receipt: Readonly<KnowledgeStudioMaterialReceipt>) => void;
  disabled?: boolean;
}

const ERROR_MESSAGES: Readonly<Record<KnowledgeStudioMaterialErrorCode, string>> = Object.freeze({
  unavailable: "Adding materials is unavailable. Refresh Knowledge Studio and try again.",
  stale_selection: "This selection has expired. Close and reopen Add materials.",
  source_changed: "The selected file has changed. Close and reopen Add materials.",
  source_too_large: "The selected file exceeds the material size limit.",
  source_not_allowed: "This file cannot be added as a Knowledge material.",
  conflict: "The destination is already occupied. No file was overwritten.",
  add_failed: "The material could not be added. Refresh Knowledge Studio and try again.",
});

function errorMessage(error: unknown): string {
  // Rejected paths, file bytes and credentials must never enter UI diagnostics.
  // https://github.com/yydspanda/obsidian-copilot/issues/13
  return ERROR_MESSAGES[error instanceof KnowledgeStudioMaterialError ? error.code : "add_failed"];
}

/**
 * Owns an explicit, cancelable chooser without direct Vault, Queue or Wiki authority.
 * @param props The released material capability, current bundle and durable receipt callback.
 */
export function KnowledgeAddMaterialButton({
  port,
  bundleId,
  queueState,
  onReceipt,
  disabled = false,
}: KnowledgeAddMaterialButtonProps) {
  const [session, setSession] = React.useState<Readonly<KnowledgeStudioMaterialSession> | null>(
    null
  );
  const [selection, setSelection] =
    React.useState<Readonly<KnowledgeStudioMaterialSelection> | null>(null);
  const [query, setQuery] = React.useState("");
  const [snapshotConfirmed, setSnapshotConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = React.useRef<AbortController | null>(null);

  const close = React.useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setSession(null);
    setSelection(null);
    setQuery("");
    setSnapshotConfirmed(false);
    setBusy(false);
    setError(null);
  }, []);

  React.useEffect(() => {
    close();
    return () => {
      // A new bundle/capability must not retain the prior generation's selection or operation.
      // https://github.com/yydspanda/obsidian-copilot/issues/13
      pending.current?.abort();
      pending.current = null;
    };
  }, [bundleId, port, disabled, close]);

  const open = () => {
    // Opening a chooser must not race or replace a previously authorized addition.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    if (disabled || pending.current !== null) return;
    setError(null);
    try {
      const prepared = port.prepare(bundleId);
      if (prepared === null) {
        setError(ERROR_MESSAGES.unavailable);
        return;
      }
      setSession(prepared);
    } catch (error) {
      setError(errorMessage(error));
    }
  };

  const select = (sourcePath: string) => {
    // A path selection is only a preview; it does not authorize registration or copying.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    if (session === null || pending.current !== null) return;
    setSnapshotConfirmed(false);
    setError(null);
    try {
      setSelection(port.select(session, sourcePath));
    } catch (error) {
      setSelection(null);
      setError(errorMessage(error));
    }
  };

  const add = () => {
    // Synchronous authority checks prevent double clicks and unconfirmed snapshot copies.
    // https://github.com/yydspanda/obsidian-copilot/issues/13
    if (
      disabled ||
      pending.current !== null ||
      selection === null ||
      (selection.mode === "snapshot" && !snapshotConfirmed)
    )
      return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const receipt = await port.add(selection, controller.signal);
        // Registration can refresh/unmount this chooser before resolving. Its owning Studio
        // must still receive the committed receipt, while stale local UI stays untouched.
        // https://github.com/yydspanda/obsidian-copilot/issues/13
        onReceipt(receipt);
        if (pending.current === controller) close();
      } catch (error) {
        if (pending.current === controller) setError(errorMessage(error));
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          setBusy(false);
        }
      }
    })();
  };

  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || session !== null}
        onClick={open}
      >
        Add materials
      </Button>
      {session ? (
        <KnowledgeAddMaterialForm
          session={session}
          selection={selection}
          queueState={queueState}
          query={query}
          snapshotConfirmed={snapshotConfirmed}
          busy={busy}
          error={error}
          onQueryChange={setQuery}
          onSelect={select}
          onSnapshotConfirmChange={setSnapshotConfirmed}
          onAdd={add}
          onCancel={close}
        />
      ) : error ? (
        <p role="alert" className="tw-m-0 tw-text-sm tw-text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
