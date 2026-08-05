import {
  getKnowledgeStartupNotice,
  KnowledgeStudioStartupAvailabilityAdapter,
} from "@/knowledge/startup/KnowledgeStudioStartupAvailabilityAdapter";
import type { KnowledgePluginStartupState } from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import { UnavailableKnowledgeStudioPort } from "@/knowledge/ui/KnowledgeStudioController";
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

/** Creates one exact read-ready state accepted by the staged-delegate boundary. */
function createReadReadyState(
  bundleIds: readonly string[]
): Extract<KnowledgePluginStartupState, { status: "workflow_read_ready" }> {
  return { generation: 1, status: "workflow_read_ready", bundleIds };
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
      commandCapabilities: {
        pauseBundle: false,
        resumeBundle: false,
        cancelJob: false,
        retryJob: false,
        reviewReject: false,
        reviewAccept: false,
      },
    });
    expect(snapshot.notice).toContain("live workflow adapter is unavailable");
    expect(snapshot.notice).toContain("Activity, Review, Apply, and Query remain disabled");
    expect(snapshot.notice).not.toContain("Background ingest");
    expect(snapshot.notice).not.toContain("Review proposals");
  });

  it("publishes one staged live delegate by selecting its exact Bundle only", () => {
    const calls: string[] = [];
    const port = {
      replaceDelegate: jest.fn(() => calls.push("delegate")),
    };
    const sessions = {
      replaceSelection: jest.fn(() => calls.push("session")),
    };
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);
    const state = createReadReadyState(Object.freeze(["research"]));

    adapter.setReadReady(state);

    expect(calls).toEqual(["session"]);
    expect(port.replaceDelegate).not.toHaveBeenCalled();
    expect(sessions.replaceSelection).toHaveBeenCalledWith(
      "research",
      expect.stringContaining("reviewed create/update apply are available")
    );
    expect(getKnowledgeStartupNotice(state)).toContain(
      "reviewed create/update apply are available"
    );
    expect(getKnowledgeStartupNotice(state)).toContain(
      "delete acceptance and Query remain disabled"
    );
  });

  it("publishes a staged recovery delegate for the exact stopped Bundle", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);
    port.replaceDelegate(new UnavailableKnowledgeStudioPort("Staged recovery delegate."));

    adapter.setRecoveryReady({
      generation: 2,
      status: "recovery_attention_required",
      bundleIds: Object.freeze(["personal", "research"]),
      recoveryBundleId: "research",
      attentionKinds: Object.freeze(["accepted_not_started"]),
    });

    expect(sessions.getState()).toMatchObject({ bundleId: "research" });
    await expect(port.load("research", new AbortController().signal)).resolves.toMatchObject({
      notice: "Staged recovery delegate.",
    });
    expect(sessions.getState().unavailableNotice).toContain("Open Recovery");
    expect(sessions.getState().unavailableNotice).toContain("new ingest work remains stopped");
  });

  it("fails closed when a staged recovery names a Bundle outside its validated set", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);
    port.replaceDelegate(new UnavailableKnowledgeStudioPort("Must be replaced."));

    adapter.setRecoveryReady({
      generation: 3,
      status: "recovery_attention_required",
      bundleIds: Object.freeze(["personal"]),
      recoveryBundleId: "research",
      attentionKinds: Object.freeze(["accepted_not_started"]),
    });

    expect(sessions.getState().bundleId).toBeUndefined();
    expect(sessions.getState().unavailableNotice).toContain("explicit recovery decision");
    const snapshot = await port.load("personal", new AbortController().signal);
    expect(snapshot.availability).toBe("adapter_unavailable");
    expect(snapshot.notice).toContain("explicit recovery decision");
  });

  it("fails closed when read-ready cannot select exactly one Bundle", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);

    adapter.setReadReady(createReadReadyState(Object.freeze(["one", "two"])));

    expect(sessions.getState().bundleId).toBeUndefined();
    expect(sessions.getState().unavailableNotice).toContain("Bundle selection");
    const snapshot = await port.load("one", new AbortController().signal);
    expect(snapshot).toMatchObject({
      availability: "adapter_unavailable",
      commandCapabilities: {
        pauseBundle: false,
        resumeBundle: false,
        cancelJob: false,
        retryJob: false,
        reviewReject: false,
        reviewAccept: false,
      },
    });
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

  it.each([
    {
      state: createState({
        status: "recovery_unavailable",
        bundleIds: Object.freeze(["personal"]),
        diagnosticCodes: Object.freeze(["private-diagnostic-code"]),
      }),
      expectedNotice: "could not be completed safely",
    },
    {
      state: createState({
        status: "recovery_attention_required",
        bundleIds: Object.freeze(["personal"]),
        recoveryBundleId: "personal",
        attentionKinds: Object.freeze(["accepted_not_started"]),
      }),
      expectedNotice: "explicit recovery decision",
    },
    {
      state: createState({
        status: "recovery_blocked",
        bundleIds: Object.freeze(["personal"]),
        recoveryBundleId: "personal",
        attentionKinds: Object.freeze(["queue_recovery_required"]),
      }),
      expectedNotice: "protect existing notes",
    },
  ])("selects an exact unavailable Bundle for $state.status", async ({ state, expectedNotice }) => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);

    adapter.setUnavailable(state);

    const session = sessions.getState();
    expect(session.bundleId).toBe("personal");
    expect(session.unavailableNotice).toContain(expectedNotice);
    expect(JSON.stringify(session)).not.toContain("private-diagnostic-code");
    const snapshot = await port.load("personal", new AbortController().signal);
    expect(snapshot).toMatchObject({ availability: "adapter_unavailable" });
  });

  it("gives blocked recovery only inspect-and-recheck guidance", () => {
    const state = createState({
      status: "recovery_blocked",
      bundleIds: Object.freeze(["personal"]),
      recoveryBundleId: "personal",
      attentionKinds: Object.freeze(["queue_recovery_required"]),
    });

    const notice = getKnowledgeStartupNotice(state);

    expect(notice).toContain("Open Recovery to inspect and recheck it");
    expect(notice).toContain("unsafe actions remain disabled");
    expect(notice).not.toContain("continue eligible work");
    expect(notice).not.toContain("abandon");
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
