import React from "react";

interface DesktopOnlySettingsPanelProps {
  /**
   * What is unavailable, phrased for this specific panel. Required rather than
   * defaulted because every caller gates a different feature — one shared
   * sentence would be wrong for all but the panel it was written for.
   */
  message: string;
}

/**
 * Stand-in for a settings panel whose feature needs the desktop (Electron)
 * runtime. It renders nothing but the explanation, so it can be shown on mobile
 * without pulling the gated feature's module graph into the bundle.
 */
export const DesktopOnlySettingsPanel: React.FC<DesktopOnlySettingsPanelProps> = ({ message }) => (
  <section className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-4 tw-text-sm tw-text-muted">
    {message}
  </section>
);
