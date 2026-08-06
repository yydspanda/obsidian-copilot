import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, LibraryBig, Loader2, MessageSquarePlus, X } from "lucide-react";
import type { TFile } from "obsidian";
import React from "react";

/** Explicit actions for Vault files intercepted before Chat context mutation. */
export interface ChatAttachmentIntentCardProps {
  files: readonly TFile[];
  addingPath?: string;
  onUseInChat: (file: TFile) => void;
  onAddToKnowledge: (file: TFile) => void;
  onDismiss: (file: TFile) => void;
}

/**
 * Renders the mandatory one-use versus durable-knowledge choice for dropped files.
 *
 * The component is intentionally callback-only: it owns neither Chat context nor
 * Knowledge capture authority, so a render or dismissal cannot create side effects.
 */
export function ChatAttachmentIntentCard({
  files,
  addingPath,
  onUseInChat,
  onAddToKnowledge,
  onDismiss,
}: ChatAttachmentIntentCardProps): React.ReactElement | null {
  if (files.length === 0) return null;

  return (
    <Card className="tw-mx-2 tw-mb-2 tw-border-solid tw-bg-primary tw-shadow-none">
      <CardHeader className="tw-p-3 tw-pb-2">
        <CardTitle className="tw-flex tw-items-center tw-gap-2 tw-text-sm">
          <LibraryBig className="tw-size-4 tw-text-accent" />
          Choose how to use {files.length === 1 ? "this file" : "these files"}
        </CardTitle>
      </CardHeader>
      <CardContent className="tw-flex tw-flex-col tw-gap-2 tw-p-3 tw-pt-0">
        {files.map((file) => {
          const isAdding = addingPath === file.path;
          return (
            <div
              key={file.path}
              className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-bg-secondary tw-p-2"
            >
              <div className="tw-flex tw-items-center tw-gap-2">
                <FileText className="tw-size-4 tw-shrink-0 tw-text-muted" />
                <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm" title={file.path}>
                  {file.name}
                </span>
                <Button
                  type="button"
                  variant="ghost2"
                  size="icon"
                  className="tw-size-6"
                  title="Dismiss"
                  aria-label={`Dismiss ${file.name}`}
                  disabled={isAdding}
                  onClick={() => onDismiss(file)}
                >
                  <X className="tw-size-4" />
                </Button>
              </div>
              <div className="tw-flex tw-flex-wrap tw-gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isAdding}
                  onClick={() => onUseInChat(file)}
                >
                  <MessageSquarePlus className="tw-size-3" />
                  Use in this chat
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isAdding}
                  onClick={() => onAddToKnowledge(file)}
                >
                  {isAdding ? (
                    <Loader2 className="tw-size-3 tw-animate-spin" />
                  ) : (
                    <LibraryBig className="tw-size-3" />
                  )}
                  {isAdding ? "Registering..." : "Add to Knowledge"}
                </Button>
              </div>
            </div>
          );
        })}
        <p className="tw-m-0 tw-text-xs tw-text-muted">
          Chat context is temporary. Knowledge sources are registered durably and processed in the
          background.
        </p>
      </CardContent>
    </Card>
  );
}
