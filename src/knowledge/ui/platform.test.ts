import { isKnowledgeStudioPlatformSupported } from "@/knowledge/ui/platform";

describe("isKnowledgeStudioPlatformSupported", () => {
  it.each([
    [{ isDesktopApp: true, isWin: true }, true],
    [{ isDesktopApp: true, isWin: false }, false],
    [{ isDesktopApp: false, isWin: true }, false],
    [{ isDesktopApp: false, isWin: false }, false],
  ])("guards only Windows desktop", (capabilities, expected) => {
    expect(isKnowledgeStudioPlatformSupported(capabilities)).toBe(expected);
  });
});
