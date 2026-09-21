import { KnowledgeSetupError } from "@/knowledge/setup/KnowledgeSetupPort";

describe("KnowledgeSetupPort", () => {
  describe("KnowledgeSetupError", () => {
    describe("constructor()", () => {
      it("exposes a stable code and warns about non-destructive partial setup (https://github.com/yydspanda/obsidian-copilot/issues/13)", () => {
        const error = new KnowledgeSetupError("write_failed");
        expect(error.code).toBe("write_failed");
        expect(error.message).toContain("may remain");
      });
    });
  });
});
