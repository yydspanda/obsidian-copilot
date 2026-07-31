import {
  getKnowledgeStartupNotice,
  KnowledgeStudioStartupAvailabilityAdapter,
} from "@/knowledge/startup/KnowledgeStudioStartupAvailabilityAdapter";
import type { KnowledgePluginStartupState } from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { KnowledgeStudioSessionStore } from "@/knowledge/ui/KnowledgeStudioSessionStore";

type StartupStateWithoutGeneration<T> = T extends KnowledgePluginStartupState
  ? Omit<T, "generation">
  : never;

/** Creates one safe startup state with an explicit generation. */
function createState(
  state: StartupStateWithoutGeneration<KnowledgePluginStartupState>
): KnowledgePluginStartupState {
  return { generation: 1, ...state };
}

describe("KnowledgeStudioStartupAvailabilityAdapter", () => {
  it("keeps the port identity stable and selects exactly one validated Bundle", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const stablePort = port;
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);

    adapter.setUnavailable(
      createState({
        status: "workflow_adapters_unavailable",
        bundleIds: Object.freeze(["research"]),
      })
    );

    expect(port).toBe(stablePort);
    expect(sessions.getState()).toMatchObject({ bundleId: "research" });
    const snapshot = await port.load("research", new AbortController().signal);
    expect(snapshot).toMatchObject({
      bundleId: "research",
      availability: "adapter_unavailable",
    });
    expect(snapshot.notice).toContain("complete Golden Flow");
  });

  it("clears selection for zero or several Bundles instead of inventing an identity", () => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);

    adapter.setUnavailable(createState({ status: "bundle_unconfigured" }));
    expect(sessions.getState().bundleId).toBeUndefined();

    adapter.setUnavailable(
      createState({
        status: "workflow_adapters_unavailable",
        bundleIds: Object.freeze(["one", "two"]),
      })
    );
    expect(sessions.getState().bundleId).toBeUndefined();
    expect(sessions.getState().unavailableNotice).toContain("Bundle selection");
  });

  it("never renders invalid diagnostic codes or caller data in its notice", () => {
    const secret = "credential-like-project-value";
    const state = createState({
      status: "bundle_invalid",
      diagnosticCodes: Object.freeze([secret]),
    });

    const notice = getKnowledgeStartupNotice(state);

    expect(notice).not.toContain(secret);
    expect(notice).toContain("configuration is invalid");
  });

  it("publishes the delegate before session observers receive an exact Bundle", () => {
    const calls: string[] = [];
    const port = {
      replaceDelegate: jest.fn(() => calls.push("delegate")),
    };
    const sessions = {
      replaceSelection: jest.fn(() => calls.push("session")),
    };
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);

    adapter.setUnavailable(
      createState({
        status: "workflow_adapters_unavailable",
        bundleIds: Object.freeze(["research"]),
      })
    );

    expect(calls).toEqual(["delegate", "session"]);
  });
});
