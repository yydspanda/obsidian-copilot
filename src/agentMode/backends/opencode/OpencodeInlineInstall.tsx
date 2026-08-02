import {
  detectOpencodeCliPath,
  getOpencodeBinaryManager,
  OpencodeBackendDescriptor,
} from "@/agentMode/backends/opencode/descriptor";
import { phaseLabel, phaseProgress } from "@/agentMode/backends/opencode/installProgress";
import {
  AbortError,
  type ProgressEvent,
} from "@/agentMode/backends/opencode/OpencodeBinaryManager";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Download } from "lucide-react";
import { Notice } from "obsidian";
import React from "react";

/** What the row's action cluster is currently doing. */
type Run =
  | { kind: "idle" }
  | { kind: "detecting" }
  | { kind: "installing"; progress: ProgressEvent | null }
  | { kind: "error"; message: string };

const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const isAbort = (e: unknown): boolean =>
  e instanceof AbortError || (e as Error | undefined)?.name === "AbortError";

/**
 * Inline install actions for opencode, rendered by the generic backend panel
 * while the binary is absent. opencode is the one backend the plugin can
 * install itself, so this owns the whole first-run path — download, progress,
 * cancel, retry, and adopting an existing binary — and the Configure dialog
 * stays reserved for upgrade, uninstall, and custom paths.
 */
export const OpencodeAbsentInstallActions: React.FC<{ plugin: CopilotPlugin }> = ({ plugin }) => {
  const [run, setRun] = React.useState<Run>({ kind: "idle" });
  const abortRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);

  // The install pipeline outlives this row: it unmounts the moment the install
  // succeeds (the panel flips to "ready"), and the whole settings tab unmounts
  // whenever the user closes the dialog mid-download.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const settle = React.useCallback((next: Run) => {
    if (mountedRef.current) setRun(next);
  }, []);

  const startInstall = React.useCallback(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRun({ kind: "installing", progress: null });
    getOpencodeBinaryManager(plugin)
      .install({
        signal: controller.signal,
        onProgress: (e) => settle({ kind: "installing", progress: e }),
      })
      .then(({ version }) => {
        settle({ kind: "idle" });
        new Notice(`opencode v${version} installed.`);
      })
      .catch((err: unknown) => {
        if (isAbort(err)) {
          settle({ kind: "idle" });
          return;
        }
        logError("[AgentMode] inline opencode install failed", err);
        settle({ kind: "error", message: describeError(err) });
      });
  }, [plugin, settle]);

  // Adopting an existing binary is one detect plus the same validation the
  // Configure dialog runs (file exists, executable, answers `--version`), so a
  // binary that can't actually run is rejected here rather than at ACP boot.
  const adoptExisting = React.useCallback(() => {
    setRun({ kind: "detecting" });
    void (async () => {
      try {
        const found = await detectOpencodeCliPath();
        if (!found) {
          settle({
            kind: "error",
            message: "Couldn't find opencode on this device. Use Configure to enter its path.",
          });
          return;
        }
        await getOpencodeBinaryManager(plugin).setCustomBinaryPath(found);
        settle({ kind: "idle" });
        new Notice(`Using the opencode at ${found}.`);
      } catch (e) {
        logError("[AgentMode] adopting an existing opencode failed", e);
        settle({ kind: "error", message: describeError(e) });
      }
    })();
  }, [plugin, settle]);

  if (run.kind === "installing") {
    const label = phaseLabel(run.progress);
    return (
      <div className="tw-flex tw-w-56 tw-shrink-0 tw-items-center tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1">
          <span className="tw-truncate tw-text-xs tw-text-muted" title={label}>
            {label}
          </span>
          <Progress value={phaseProgress(run.progress) ?? 0} />
        </div>
        <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-shrink-0 tw-flex-col tw-items-end tw-gap-1">
      <div className="tw-flex tw-items-center tw-gap-2">
        {/* Both actions write the same backend settings, so they must not race:
            a detect landing mid-download flips the row to ready, which unmounts
            it and aborts the download the user asked for. The download leads —
            it is the one action a first-run user is meant to take. */}
        <Button
          variant="default"
          size="default"
          onClick={startInstall}
          disabled={run.kind === "detecting"}
        >
          <Download className="tw-size-4" />
          {run.kind === "error" ? "Try again" : "Download opencode"}
        </Button>
        {run.kind === "error" ? (
          // Detection only walks the well-known install locations and PATH, so a
          // binary somewhere else can only be reached by typing its path — and
          // the row hides its usual Configure entry point while absent. Without
          // this the failure message would name a button that isn't on screen.
          <Button
            variant="ghost"
            size="default"
            onClick={() => OpencodeBackendDescriptor.openInstallUI(plugin)}
          >
            Configure
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="default"
            onClick={adoptExisting}
            disabled={run.kind === "detecting"}
          >
            {run.kind === "detecting" ? "Looking…" : "I already have it"}
          </Button>
        )}
      </div>
      {run.kind === "error" && (
        <span className="tw-max-w-xs tw-text-right tw-text-xs tw-text-error">{run.message}</span>
      )}
    </div>
  );
};
