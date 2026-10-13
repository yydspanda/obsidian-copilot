export function publishKnowledgeSetupThenStudioAuthority<State>(
  state: State,
  publishSetup: (state: State) => void,
  publishAuthority: (state: State) => void
): void {
  try {
    publishSetup(state);
  } catch {
    // Optional presentation state cannot block the authoritative Studio transition.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
  publishAuthority(state);
}
