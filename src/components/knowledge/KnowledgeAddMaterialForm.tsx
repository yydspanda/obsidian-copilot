import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  KnowledgeStudioMaterialSelection,
  KnowledgeStudioMaterialSession,
} from "@/knowledge/capture/KnowledgeStudioMaterialPort";

export interface KnowledgeAddMaterialFormProps {
  session: Readonly<KnowledgeStudioMaterialSession>;
  selection: Readonly<KnowledgeStudioMaterialSelection> | null;
  queueState: "running" | "paused" | "unknown";
  query: string;
  snapshotConfirmed: boolean;
  busy: boolean;
  error: string | null;
  onQueryChange: (query: string) => void;
  onSelect: (path: string) => void;
  onSnapshotConfirmChange: (confirmed: boolean) => void;
  onAdd: () => void;
  onCancel: () => void;
}

/**
 * Displays the exact material and custody choice before an explicit command.
 * @param props Read-only chooser state and explicit user-action callbacks.
 */
export function KnowledgeAddMaterialForm({
  session,
  selection,
  queueState,
  query,
  snapshotConfirmed,
  busy,
  error,
  onQueryChange,
  onSelect,
  onSnapshotConfirmChange,
  onAdd,
  onCancel,
}: KnowledgeAddMaterialFormProps) {
  const id = React.useId();
  const matches = session.choices.filter((choice) =>
    choice.path.toLowerCase().includes(query.trim().toLowerCase())
  );
  // Copy consent is separate from selecting a file: originals do not track the snapshot.
  // https://github.com/yydspanda/obsidian-copilot/issues/13
  const canAdd =
    selection !== null && (selection.mode === "register" || snapshotConfirmed) && !busy;

  return (
    <form
      aria-label="Choose material"
      className="tw-flex tw-min-w-0 tw-flex-col tw-gap-3 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canAdd) onAdd();
      }}
    >
      <label htmlFor={`${id}-search`}>Search Vault files</label>
      <Input
        id={`${id}-search`}
        type="search"
        placeholder="File name or full path"
        value={query}
        disabled={busy}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <fieldset className="tw-m-0 tw-min-w-0 tw-border-0 tw-p-0" disabled={busy}>
        <legend className="tw-mb-2 tw-text-sm tw-text-muted">Choose one material</legend>
        <div className="tw-flex tw-max-h-48 tw-flex-col tw-gap-2 tw-overflow-y-auto">
          {matches.map((choice) => (
            <label key={choice.path} className="tw-flex tw-min-w-0 tw-items-start tw-gap-2">
              <input
                type="radio"
                name={`${id}-material`}
                value={choice.path}
                checked={selection?.sourcePath === choice.path}
                onChange={() => onSelect(choice.path)}
              />
              <span className="tw-min-w-0 tw-break-words tw-text-sm [overflow-wrap:anywhere]">
                {choice.path}
                <span className="tw-block tw-text-xs tw-text-muted">{choice.size} bytes</span>
              </span>
            </label>
          ))}
          {/* An empty result must not imply that an arbitrary typed path is authorized.
              https://github.com/yydspanda/obsidian-copilot/issues/13 */}
          {matches.length === 0 && <p className="tw-m-0 tw-text-muted">No matching materials.</p>}
        </div>
      </fieldset>
      {/* Full paths and custody remain visible before any registration or copy.
          https://github.com/yydspanda/obsidian-copilot/issues/13 */}
      {selection && (
        <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-2 tw-text-sm">
          <dl className="tw-m-0 tw-min-w-0">
            <dt className="tw-text-muted">Original file</dt>
            <dd className="tw-m-0 tw-break-words [overflow-wrap:anywhere]">
              {selection.sourcePath}
            </dd>
            <dt className="tw-mt-2 tw-text-muted">Knowledge source path</dt>
            <dd className="tw-m-0 tw-break-words [overflow-wrap:anywhere]">
              {selection.destinationPath}
            </dd>
            <dt className="tw-mt-2 tw-text-muted">Mode</dt>
            <dd className="tw-m-0">
              {selection.mode === "register" ? "Register existing file" : "Copy snapshot"}
            </dd>
          </dl>
          {selection.mode === "register" ? (
            <p className="tw-m-0 tw-text-muted">
              The original file stays in place. No copy is made.
            </p>
          ) : (
            <label className="tw-flex tw-items-start tw-gap-2">
              <input
                type="checkbox"
                checked={snapshotConfirmed}
                disabled={busy}
                onChange={(event) => onSnapshotConfirmChange(event.currentTarget.checked)}
              />
              <span>
                I understand this copies a snapshot, keeps the original file, and later edits to the
                original do not automatically sync to the copy.
              </span>
            </label>
          )}
        </div>
      )}
      {/* Registration can schedule paid analysis, but it must never imply Resume or Wiki Apply.
          https://github.com/yydspanda/obsidian-copilot/issues/13 */}
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        {queueState === "running"
          ? "Activity is currently running. Adding material may trigger paid model analysis."
          : queueState === "paused"
            ? "Activity is currently paused. Adding materials does not resume paused activity."
            : "Activity status is unavailable. Adding materials does not resume paused activity."}
      </p>
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        Processing can use your configured model and incur charges when activity is running.
      </p>
      <p className="tw-m-0 tw-text-sm tw-text-muted">
        Wiki changes still require Review and Apply.
      </p>
      {error && (
        <p role="alert" className="tw-m-0 tw-text-sm tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        <Button type="submit" disabled={!canAdd}>
          {busy ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
