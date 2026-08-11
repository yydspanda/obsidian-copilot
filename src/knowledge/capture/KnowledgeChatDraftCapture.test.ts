import {
  createKnowledgeChatDraftCapture,
  KnowledgeChatDraftCaptureError,
  KNOWLEDGE_CHAT_DRAFT_LIMITS,
} from "@/knowledge/capture/KnowledgeChatDraftCapture";

describe("createKnowledgeChatDraftCapture", () => {
  it("renders one deterministic Markdown source without inventing provenance", () => {
    const first = createKnowledgeChatDraftCapture({
      title: "Social influence",
      body: "My checked explanation.\n\nBook: add page reference before relying on this draft.",
      reviewConfirmed: true,
    });
    const second = createKnowledgeChatDraftCapture({
      title: "Social influence",
      body: "My checked explanation.\n\nBook: add page reference before relying on this draft.",
      reviewConfirmed: true,
    });

    expect(first).toEqual(second);
    expect(first.sourceContent).toBe(
      "# Social influence\n\nMy checked explanation.\n\nBook: add page reference before relying on this draft.\n"
    );
    expect(first.sourceContentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.captureDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).not.toHaveProperty("sourcePath");
    expect(first).not.toHaveProperty("citations");
  });

  it("preserves an existing trailing newline without adding another one", () => {
    const capture = createKnowledgeChatDraftCapture({
      title: "Draft",
      body: "Body\n",
      reviewConfirmed: true,
    });

    expect(capture.sourceContent).toBe("# Draft\n\nBody\n");
  });

  it.each([
    null,
    {},
    { title: "Draft", body: "Body" },
    { title: "Draft", body: "Body", reviewConfirmed: false },
    { title: "Draft", body: "Body", reviewConfirmed: true, extra: true },
    { title: "", body: "Body", reviewConfirmed: true },
    { title: " Draft", body: "Body", reviewConfirmed: true },
    { title: "Draft\nSecond", body: "Body", reviewConfirmed: true },
    { title: "Draft\ud800", body: "Body", reviewConfirmed: true },
    { title: "Draft", body: "   ", reviewConfirmed: true },
    { title: "Draft", body: "Body\udc00", reviewConfirmed: true },
    { title: "Draft", body: "Body\0hidden", reviewConfirmed: true },
  ])("rejects malformed or unsafe input without retaining values", (value) => {
    expect(() => createKnowledgeChatDraftCapture(value)).toThrow(KnowledgeChatDraftCaptureError);
  });

  it("rejects accessors without evaluating them", () => {
    const title = jest.fn(() => "Draft");
    const request = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(request, {
      title: { get: title, enumerable: true },
      body: { value: "Body", enumerable: true },
      reviewConfirmed: { value: true, enumerable: true },
    });

    expect(() => createKnowledgeChatDraftCapture(request)).toThrow(KnowledgeChatDraftCaptureError);
    expect(title).not.toHaveBeenCalled();
  });

  it("enforces character and UTF-8 byte limits", () => {
    expect(() =>
      createKnowledgeChatDraftCapture({
        title: "x".repeat(KNOWLEDGE_CHAT_DRAFT_LIMITS.maxTitleCharacters + 1),
        body: "Body",
        reviewConfirmed: true,
      })
    ).toThrow(KnowledgeChatDraftCaptureError);
    expect(() =>
      createKnowledgeChatDraftCapture({
        title: "Draft",
        body: "😀".repeat(Math.floor(KNOWLEDGE_CHAT_DRAFT_LIMITS.maxBodyCharacters / 2)),
        reviewConfirmed: true,
      })
    ).toThrow(KnowledgeChatDraftCaptureError);
  });
});
