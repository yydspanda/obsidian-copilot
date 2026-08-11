import type {
  VaultSourceWatcherNotification,
  VaultSourceWatcherNotificationSink,
} from "@/knowledge/ingest/ObsidianVaultSourceWatcher";

/** User-facing message shown after a registered source disappears or moves. */
export const KNOWLEDGE_SOURCE_ISSUE_NOTICE =
  "New observations for one or more registered Knowledge sources are paused. Existing Activity, Review, or Recovery may still complete. Open Knowledge Studio → Sources to restore or remove them safely.";

/** Creates a collision-free identity for one Bundle source without retaining its path. */
function createSourceIssueKey(bundleId: string, sourceId: string): string {
  return `${bundleId.length}:${bundleId}${sourceId.length}:${sourceId}`;
}

/**
 * Creates one plugin-lifetime, path-free source-issue notification sink.
 *
 * Repeated startup scans and duplicate delete/rename hints are coalesced until
 * an exact-path capture settles. The sink is best effort: a UI notification
 * failure never affects watcher authority or durable source state.
 *
 * @param notify - Host callback that presents one fixed, sanitized message
 * @returns Frozen watcher notification capability
 */
export function createKnowledgeSourceIssueNotificationSink(
  notify: (message: string) => void
): VaultSourceWatcherNotificationSink {
  if (typeof notify !== "function") {
    throw new TypeError("The Knowledge source issue notifier is invalid");
  }
  const notifiedSources = new Set<string>();
  let noticeScheduled = false;

  /** Coalesces one synchronous watcher burst into one best-effort host Notice. */
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
