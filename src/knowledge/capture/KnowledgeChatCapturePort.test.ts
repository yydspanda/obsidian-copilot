import { isKnowledgeChatCapturePath } from "@/knowledge/capture/KnowledgeChatCapturePort";

describe("isKnowledgeChatCapturePath", () => {
  it.each(["Sources/Note.md", "Sources/Note.MARKDOWN", "Sources/研究.TxT", "Sources/论文.PDF"])(
    "accepts production source path %s",
    (sourcePath) => {
      expect(isKnowledgeChatCapturePath(sourcePath)).toBe(true);
    }
  );

  it.each(["Sources/Note.docx", "Sources/Note.canvas", "Sources/Note.md.exe", "Sources/Note"])(
    "rejects non-production path %s",
    (sourcePath) => {
      expect(isKnowledgeChatCapturePath(sourcePath)).toBe(false);
    }
  );
});
