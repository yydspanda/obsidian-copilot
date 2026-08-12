/**
 * Publishes optional Setup presentation before one authoritative Studio transition.
 *
 * Setup readiness is explanatory state only. A malformed optional Chat catalog,
 * stale presentation store, or observer failure must never prevent Recovery,
 * Sources recovery, or a valid Studio session from receiving its authoritative
 * startup transition. Errors from the authority are intentionally preserved.
 *
 * @param state - Typed startup state shared by both projections
 * @param publishSetup - Best-effort presentation-only publisher
 * @param publishAuthority - Required Studio availability transition
 */
export function publishKnowledgeSetupThenStudioAuthority<State>(
  state: State,
  publishSetup: (state: State) => void,
  publishAuthority: (state: State) => void
): void {
  try {
    publishSetup(state);
  } catch {
    // Optional presentation state cannot block the authoritative Studio transition.
  }
  publishAuthority(state);
}
