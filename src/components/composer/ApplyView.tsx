import { APPLY_VIEW_TYPE } from "@/constants";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getSettings, updateSetting } from "@/settings/model";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { Change } from "diff";
import { Check, X as XIcon } from "lucide-react";
import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { getChangeBlocks } from "@/composerUtils";
import { ApplyViewResult } from "@/types";
import { ensureFolderExists } from "@/utils";
import { SideBySideDiffBlock, SplitDiffBlock } from "@/components/composer/DiffPreview";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export interface ApplyViewState {
  changes: Change[];
  path: string;
  resultCallback?: (result: ApplyViewResult) => void;
  simple?: boolean;
}

interface ExtendedChange extends Change {
  accepted: boolean | null;
}

export class ApplyView extends ItemView {
  private root: ReturnType<typeof createPluginRoot> | null = null;
  private state: ApplyViewState | null = null;
  private result: ApplyViewResult | null = null;
  private windowMigrationDestroy: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return APPLY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Preview Changes";
  }

  async setState(state: ApplyViewState): Promise<void> {
    this.state = state;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.render();
    this.windowMigrationDestroy?.();
    this.windowMigrationDestroy = this.containerEl.onWindowMigrated(() => {
      this.unmountRoot();
      this.render();
    });
  }

  async onClose(): Promise<void> {
    this.windowMigrationDestroy?.();
    this.windowMigrationDestroy = null;
    this.unmountRoot();

    this.state?.resultCallback?.(this.result ? this.result : "aborted");
  }

  private unmountRoot(): void {
    this.root?.unmount();
    this.root = null;
  }

  private ensureRoot(): void {
    if (this.root) return;

    const contentEl = this.containerEl.children[1];
    contentEl.empty();
    const rootEl = contentEl.createDiv();
    this.root = createPluginRoot(rootEl, this.app);
  }

  private render(): void {
    if (!this.state) return;

    this.ensureRoot();

    this.root?.render(
      <ApplyViewRoot
        app={this.app}
        state={this.state}
        close={(result) => {
          this.result = result;
          this.leaf.detach();
        }}
      />
    );
  }
}

interface ApplyViewRootProps {
  app: App;
  state: ApplyViewState;
  close: (result: ApplyViewResult) => void;
}

const ApplyViewRoot: React.FC<ApplyViewRootProps> = ({ app, state, close }) => {
  const simple = state.simple ?? false;
  const [diff, setDiff] = useState<ExtendedChange[]>(() => {
    return state.changes.map((change) => ({
      ...change,
      accepted: null,
    }));
  });

  const [viewMode, setViewMode] = useState<"side-by-side" | "split">(
    () => getSettings().diffViewMode ?? "split"
  );

  const handleViewModeChange = (mode: "side-by-side" | "split") => {
    setViewMode(mode);
    updateSetting("diffViewMode", mode);
  };

  const changeBlocks = getChangeBlocks(diff);

  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);

  if (!state || !state.changes) {
    logError("Invalid state:", state);
    return (
      <div className="tw-flex tw-h-full tw-flex-col tw-items-center tw-justify-center">
        <div className="tw-text-error">Error: Invalid state - missing changes</div>
        <Button onClick={() => close("failed")} className="tw-mt-4">
          Close
        </Button>
      </div>
    );
  }

  const handleAccept = async () => {
    try {
      const updatedDiff = diff.map((change) =>
        change.accepted === null ? { ...change, accepted: true } : change
      );

      const result = await applyDecidedChangesToFile(updatedDiff);
      close(result ? "accepted" : "failed");
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(
        `Error applying changes: ${error instanceof Error ? error.message : String(error)}`
      );
      close("failed");
    }
  };

  const handleReject = async () => {
    try {
      const updatedDiff = diff.map((change) =>
        change.accepted === null ? { ...change, accepted: false } : change
      );

      const result = await applyDecidedChangesToFile(updatedDiff, false);
      close(result ? "rejected" : "failed");
    } catch (error) {
      logError("Error applying changes:", error);
      new Notice(
        `Error applying changes: ${error instanceof Error ? error.message : String(error)}`
      );
      close("failed");
    }
  };

  const getFile = async (file_path: string) => {
    const file = app.vault.getAbstractFileByPath(file_path);
    if (file) {
      return file;
    }
    if (file_path.includes("/")) {
      const folderPath = file_path.split("/").slice(0, -1).join("/");
      await ensureFolderExists(app.vault, folderPath);
    }
    return await app.vault.create(file_path, "");
  };

  const applyDecidedChangesToFile = async (
    updatedDiff: ExtendedChange[],
    showSuccessNotice = true
  ) => {
    const newContent = updatedDiff
      .filter((change) => {
        if (change.added) return change.accepted === true;
        if (change.removed) return change.accepted === false;
        return true;
      })
      .map((change) => change.value)
      .join("");

    const file = await getFile(state.path);
    if (!file || !(file instanceof TFile)) {
      logError("Error in getting file", state.path);
      new Notice("Failed to create file");
      return false;
    }

    await app.vault.modify(file, newContent);
    if (showSuccessNotice) {
      new Notice("Changes applied successfully");
    }
    return true;
  };

  const focusNextChangeBlock = (currentBlockIndex: number) => {
    if (!changeBlocks) return;

    let nextBlockIndex = -1;
    for (let i = currentBlockIndex + 1; i < changeBlocks.length; i++) {
      const block = changeBlocks[i];
      const hasChanges = block.some((change) => change.added || change.removed);
      const isUndecided = block.some(
        (change) => (change.added || change.removed) && (change as ExtendedChange).accepted === null
      );

      if (hasChanges && isUndecided) {
        nextBlockIndex = i;
        break;
      }
    }

    if (nextBlockIndex !== -1 && blockRefs.current[nextBlockIndex]) {
      blockRefs.current[nextBlockIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const scheduleNextBlockFocus = (currentBlockIndex: number) => {
    const currentBlock = blockRefs.current[currentBlockIndex];
    if (!currentBlock) return;

    currentBlock.win.setTimeout(() => focusNextChangeBlock(currentBlockIndex), 0);
  };

  const acceptBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks?.[blockIndex];

      if (!block) return newDiff;

      block.forEach((blockChange) => {
        const index = newDiff.findIndex((change) => change === blockChange);
        if (index !== -1) {
          newDiff[index] = {
            ...newDiff[index],
            accepted: true,
          };
        }
      });

      return newDiff;
    });

    scheduleNextBlockFocus(blockIndex);
  };

  const rejectBlock = (blockIndex: number) => {
    setDiff((prevDiff) => {
      const newDiff = [...prevDiff];
      const block = changeBlocks?.[blockIndex];

      if (!block) return newDiff;

      block.forEach((blockChange) => {
        const index = newDiff.findIndex((change) => change === blockChange);
        if (index !== -1) {
          newDiff[index] = {
            ...newDiff[index],
            accepted: false,
          };
        }
      });

      return newDiff;
    });

    scheduleNextBlockFocus(blockIndex);
  };

  return (
    <div className="tw-relative tw-flex tw-h-full tw-flex-col">
      <div className="tw-fixed tw-bottom-4 tw-left-1/2 tw-z-[9999] tw-flex tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-2 tw-shadow-lg">
        <Button variant="destructive" size="sm" onClick={safeAsyncHandler(handleReject)}>
          <XIcon className="tw-size-4" />
          Reject
        </Button>
        <Button variant="success" size="sm" onClick={safeAsyncHandler(handleAccept)}>
          <Check className="tw-size-4" />
          Accept
        </Button>
      </div>
      <div className="tw-flex tw-items-center tw-justify-between tw-border-b tw-border-solid tw-border-border tw-p-2">
        <div className="tw-text-sm tw-font-medium">{state.path}</div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span
            className={cn(
              "tw-text-xs",
              viewMode === "split" ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            Split
          </span>
          <SettingSwitch
            checked={viewMode === "side-by-side"}
            onCheckedChange={(checked) => handleViewModeChange(checked ? "side-by-side" : "split")}
          />
          <span
            className={cn(
              "tw-text-xs",
              viewMode === "side-by-side" ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            Side-by-side
          </span>
        </div>
      </div>

      <div className="tw-flex-1 tw-overflow-auto tw-p-2">
        {changeBlocks?.map((block, blockIndex) => {
          const hasChanges = block.some((change) => change.added || change.removed);

          const blockStatus = hasChanges
            ? block.every(
                (change) =>
                  (!change.added && !change.removed) || (change as ExtendedChange).accepted === true
              )
              ? "accepted"
              : block.every(
                    (change) =>
                      (!change.added && !change.removed) ||
                      (change as ExtendedChange).accepted === false
                  )
                ? "rejected"
                : "undecided"
            : "unchanged";

          return (
            <div
              // eslint-disable-next-line @eslint-react/no-array-index-key -- changeBlocks is computed once from the diff and not reordered; blockIndex also keys blockRefs
              key={blockIndex}
              ref={(el) => (blockRefs.current[blockIndex] = el)}
              className={cn("tw-mb-4 tw-overflow-hidden tw-rounded-md")}
            >
              {blockStatus === "accepted" ? (
                <div className="tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
                  {block
                    .filter((change) => !change.removed)
                    .map((change, idx) => (
                      // eslint-disable-next-line @eslint-react/no-array-index-key -- block changes are computed once per render and not reordered
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : blockStatus === "rejected" ? (
                <div className="tw-flex-1 tw-whitespace-pre-wrap tw-px-2 tw-py-1 tw-font-mono tw-text-sm tw-text-normal">
                  {block
                    .filter((change) => !change.added)
                    .map((change, idx) => (
                      // eslint-disable-next-line @eslint-react/no-array-index-key -- block changes are computed once per render and not reordered
                      <div key={idx}>{change.value}</div>
                    ))}
                </div>
              ) : viewMode === "side-by-side" ? (
                <SideBySideDiffBlock block={block} />
              ) : (
                <SplitDiffBlock block={block} />
              )}

              {!simple && hasChanges && blockStatus === "undecided" && (
                <div className="tw-flex tw-items-center tw-justify-end tw-border-0 tw-border-t tw-border-solid tw-border-border tw-p-2">
                  <div className="tw-flex tw-items-center tw-gap-2">
                    <Button variant="destructive" size="sm" onClick={() => rejectBlock(blockIndex)}>
                      <XIcon className="tw-size-4" />
                      Reject
                    </Button>
                    <Button variant="success" size="sm" onClick={() => acceptBlock(blockIndex)}>
                      <Check className="tw-size-4" />
                      Accept
                    </Button>
                  </div>
                </div>
              )}

              {!simple &&
                hasChanges &&
                (blockStatus === "accepted" || blockStatus === "rejected") && (
                  <div className="tw-flex tw-items-center tw-justify-end tw-border-0 tw-border-t tw-border-solid tw-border-border tw-p-2">
                    <div className="tw-flex tw-items-center tw-gap-2">
                      <div className="tw-mr-2 tw-text-sm tw-font-medium">
                        {blockStatus === "accepted" ? (
                          <div className="tw-flex tw-items-center tw-gap-1 tw-text-success">
                            <Check className="tw-size-4" />
                            <div>Accepted</div>
                          </div>
                        ) : (
                          <div className="tw-flex tw-items-center tw-gap-1 tw-text-error">
                            <XIcon className="tw-size-4" />
                            <div>Rejected</div>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDiff((prevDiff) => {
                            const newDiff = [...prevDiff];
                            const block = changeBlocks?.[blockIndex];

                            if (!block) return newDiff;

                            block.forEach((blockChange) => {
                              const index = newDiff.findIndex((change) => change === blockChange);
                              if (index !== -1) {
                                newDiff[index] = {
                                  ...newDiff[index],
                                  accepted: null,
                                };
                              }
                            });

                            return newDiff;
                          });
                        }}
                      >
                        Revert
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
