import { Platform } from "obsidian";

import { isDesktopRuntime } from "@/utils/desktopRuntime";

export interface KnowledgeStudioPlatformCapabilities {
  isDesktopApp: boolean;
  isWin: boolean;
}

export function isKnowledgeStudioPlatformSupported(
  capabilities: KnowledgeStudioPlatformCapabilities = {
    isDesktopApp: isDesktopRuntime(),
    isWin: Platform.isWin,
  }
): boolean {
  return capabilities.isDesktopApp && capabilities.isWin;
}
