import type {
  VaultSourceWatcherNotification,
  VaultSourceWatcherNotificationSink,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";

export const KNOWLEDGE_SOURCE_ISSUE_NOTICE =
  "New observations for one or more registered Knowledge sources are paused. Existing Activity, Review, or Recovery may still complete. Open Knowledge Studio → Sources to restore or remove them safely.";

function createSourceIssueKey(bundleId: string, sourceId: string): string {
  return `${bundleId.length}:${bundleId}${sourceId.length}:${sourceId}`;
}

export function createKnowledgeSourceIssueNotificationSink(
  notify: (message: string) => void
): VaultSourceWatcherNotificationSink {
  if (typeof notify !== "function") {
    throw new TypeError("The Knowledge source issue notifier is invalid");
  }
  const notifiedSources = new Set<string>();
  let noticeScheduled = false;

  const scheduleNotice = (): void => {
    if (noticeScheduled) return;
    noticeScheduled = true;
    queueMicrotask(() => {
      noticeScheduled = false;
      if (notifiedSources.size === 0) return;
      try {
        notify(KNOWLEDGE_SOURCE_ISSUE_NOTICE);
      } catch {
        // A Notice is diagnostic only and never owns source lifecycle progress.
        // https://github.com/yydspanda/obsidian-copilot/issues/24
      }
    });
  };

  return Object.freeze({
    emit(notification: VaultSourceWatcherNotification): void {
      const sourceKey = createSourceIssueKey(notification.bundleId, notification.sourceId);
      if (notification.kind === "capture_settled") {
        notifiedSources.delete(sourceKey);
        return;
      }
      if (
        notification.kind !== "source_missing" &&
        notification.kind !== "source_change_unsupported"
      ) {
        return;
      }
      if (notifiedSources.has(sourceKey)) {
        return;
      }
      notifiedSources.add(sourceKey);
      scheduleNotice();
    },
  });
}
