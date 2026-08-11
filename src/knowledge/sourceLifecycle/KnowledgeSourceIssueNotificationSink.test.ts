import {
  createKnowledgeSourceIssueNotificationSink,
  KNOWLEDGE_SOURCE_ISSUE_NOTICE,
} from "@/knowledge/sourceLifecycle/KnowledgeSourceIssueNotificationSink";

describe("KnowledgeSourceIssueNotificationSink", () => {
  it("coalesces missing and moved hints until the exact source settles", async () => {
    const notify = jest.fn<void, [string]>();
    const sink = createKnowledgeSourceIssueNotificationSink(notify);

    sink.emit({ kind: "source_missing", bundleId: "bundle-a", sourceId: "source-a" });
    sink.emit({
      kind: "source_change_unsupported",
      change: "delete",
      bundleId: "bundle-a",
      sourceId: "source-a",
    });
    sink.emit({ kind: "source_missing", bundleId: "bundle-a", sourceId: "source-b" });

    expect(notify).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(KNOWLEDGE_SOURCE_ISSUE_NOTICE);

    sink.emit({
      kind: "capture_settled",
      cause: "create",
      bundleId: "bundle-a",
      sourceId: "source-a",
      captureId: "capture-a",
      inputRevision: 2,
      settlement: "committed",
    });
    sink.emit({ kind: "source_missing", bundleId: "bundle-a", sourceId: "source-a" });

    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("bounds a ten-thousand-source event burst to one path-free Notice", async () => {
    const notify = jest.fn<void, [string]>();
    const sink = createKnowledgeSourceIssueNotificationSink(notify);

    for (let index = 0; index < 10_000; index += 1) {
      sink.emit({
        kind: "source_change_unsupported",
        change: "delete",
        bundleId: "bundle-a",
        sourceId: `source-${index}`,
      });
    }

    expect(notify).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(KNOWLEDGE_SOURCE_ISSUE_NOTICE);
    expect(KNOWLEDGE_SOURCE_ISSUE_NOTICE).not.toContain("bundle-a");
    expect(KNOWLEDGE_SOURCE_ISSUE_NOTICE).not.toContain("source-");
  });

  it("ignores unrelated failures and contains host notification errors", async () => {
    const notify = jest.fn<void, [string]>(() => {
      throw new Error("private host failure");
    });
    const sink = createKnowledgeSourceIssueNotificationSink(notify);

    expect(() =>
      sink.emit({
        kind: "source_path_invalid",
        reason: "case_mismatch",
        bundleId: "bundle-a",
        sourceId: "source-a",
      })
    ).not.toThrow();
    expect(notify).not.toHaveBeenCalled();

    expect(() =>
      sink.emit({ kind: "source_missing", bundleId: "bundle-a", sourceId: "source-a" })
    ).not.toThrow();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);

    sink.emit({ kind: "source_missing", bundleId: "bundle-a", sourceId: "source-a" });
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("suppresses a queued Notice when every affected source settles first", async () => {
    const notify = jest.fn<void, [string]>();
    const sink = createKnowledgeSourceIssueNotificationSink(notify);

    sink.emit({ kind: "source_missing", bundleId: "bundle-a", sourceId: "source-a" });
    sink.emit({
      kind: "capture_settled",
      cause: "create",
      bundleId: "bundle-a",
      sourceId: "source-a",
      captureId: "capture-a",
      inputRevision: 2,
      settlement: "committed",
    });
    await Promise.resolve();

    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects an invalid host notifier without retaining it", () => {
    expect(() =>
      createKnowledgeSourceIssueNotificationSink(undefined as unknown as (message: string) => void)
    ).toThrow("The Knowledge source issue notifier is invalid");
  });
});
