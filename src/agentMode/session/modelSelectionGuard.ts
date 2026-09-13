import type { BackendDescriptor, BackendId, ModelSelection } from "@/agentMode/session/types";
import type { CopilotSettings } from "@/settings/model";

/**
 * Reject an invalid saved preference or an unconfirmed backend identity before a session sends.
 *
 * @param descriptor - Backend policy for interpreting persisted and reported model identities.
 * @param current - Model confirmed by the live backend, if it reports one.
 * @param settings - Current persisted inventory and per-backend preferences.
 * @param backendId - Backend whose saved preference applies to this session.
 */
export function assertSessionModelSelectionSupported(
  descriptor: Pick<BackendDescriptor, "normalizeSelection"> | undefined,
  current: ModelSelection | undefined,
  settings: CopilotSettings,
  backendId: BackendId
): void {
  if (!descriptor?.normalizeSelection) return;
  const backends = settings.agentMode?.backends as
    | Record<string, { defaultModel?: ModelSelection | null } | undefined>
    | undefined;
  const saved = backends?.[backendId]?.defaultModel;
  // Settings subscriptions apply a changed default asynchronously. Inspect the
  // live preference here so a same-tick prompt cannot use the previous model
  // while a retired or ambiguous default is waiting to be rejected.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  if (saved && descriptor.normalizeSelection(saved, settings) === null) {
    throw new TypeError("The saved model selection is no longer supported; choose another model");
  }
  if (!current) return;
  const normalized = descriptor.normalizeSelection(current, settings);
  // A failed alias confirmation or external model switch must not leave a
  // backend-reported retired/aliased identity available for provider I/O.
  // https://github.com/yydspanda/obsidian-copilot/issues/3
  if (
    !normalized ||
    normalized.baseModelId !== current.baseModelId ||
    normalized.effort !== current.effort
  ) {
    throw new TypeError("The backend selected a model that is no longer supported");
  }
}
