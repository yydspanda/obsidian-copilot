import { Platform } from "obsidian";

/** Minimal platform capabilities needed by the Windows-only knowledge surface. */
export interface KnowledgeStudioPlatformCapabilities {
  isDesktopApp: boolean;
  isWin: boolean;
}

/**
 * Reports whether Knowledge Studio may be opened on the current platform.
 *
 * The existing Copilot plugin remains available on its current platforms. Only
 * the new personal-knowledge surface is guarded while its filesystem adapters
 * and acceptance tests are intentionally Windows-specific.
 *
 * @param capabilities - Injectable platform flags for deterministic tests
 * @returns Whether this is Obsidian Desktop running on Windows
 */
export function isKnowledgeStudioPlatformSupported(
  capabilities: KnowledgeStudioPlatformCapabilities = {
    isDesktopApp: Platform.isDesktopApp,
    isWin: Platform.isWin,
  }
): boolean {
  return capabilities.isDesktopApp && capabilities.isWin;
}
