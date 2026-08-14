import {
  getKnowledgeStartupNotice,
  KnowledgeStudioStartupAvailabilityAdapter,
} from "@/knowledge/startup/KnowledgeStudioStartupAvailabilityAdapter";
import type { KnowledgePluginStartupState } from "@/knowledge/startup/KnowledgePluginStartupBarrier";
import { KnowledgeStudioReadGenerationLease } from "@/knowledge/startup/KnowledgeStudioReadGenerationLease";
import { DelegatingKnowledgeStudioPort } from "@/knowledge/ui/DelegatingKnowledgeStudioPort";
import {
  KnowledgeStudioAdapterUnavailableError,
  UnavailableKnowledgeStudioPort,
} from "@/knowledge/ui/KnowledgeStudioController";
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
      publishRefreshing: jest.fn(() => calls.push("refreshing")),
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
    expect(sessions.publishRefreshing).not.toHaveBeenCalled();
  });

  it("revokes the delegate before publishing an explicit layout-refresh session", async () => {
    const calls: string[] = [];
    const port = new DelegatingKnowledgeStudioPort();
    const replaceDelegate = jest.spyOn(port, "replaceDelegate").mockImplementation((delegate) => {
      calls.push("delegate");
      Object.getPrototypeOf(port).replaceDelegate.call(port, delegate);
    });
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    sessions.subscribe(() => calls.push(`session:${sessions.getState().status}`));
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);
    calls.length = 0;

    adapter.setUnavailable(createState({ status: "waiting_for_layout" }));

    expect(calls).toEqual(["delegate", "session:refreshing"]);
    expect(replaceDelegate).toHaveBeenCalledTimes(1);
    expect(sessions.getState()).toEqual({ status: "refreshing", revision: 1 });
    expect(Object.keys(sessions.getState()).sort()).toEqual(["revision", "status"]);
    await expect(port.pauseBundle("personal", 1, new AbortController().signal)).rejects.toEqual(
      new KnowledgeStudioAdapterUnavailableError()
    );
  });

  it("keeps durable configuration failures unavailable instead of styling them as refresh", () => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);

    adapter.setUnavailable(
      createState({
        status: "bundle_invalid",
        diagnosticCodes: Object.freeze(["bundle_config_invalid"]),
      })
    );

    expect(sessions.getState().status).toBe("unavailable");
    expect(sessions.getState().unavailableNotice).toContain("configuration is invalid");
  });

  it("supports main-shaped generation turnover without stale or duplicate withdrawal winning", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);
    const firstDelegate = new UnavailableKnowledgeStudioPort("First generation.");
    const firstPause = jest.spyOn(firstDelegate, "pauseBundle").mockResolvedValue();
    let invalidateFirst: (() => void) | undefined;
    const firstLease = new KnowledgeStudioReadGenerationLease({
      delegate: firstDelegate,
      subscribeInvalidation: (listener) => {
        invalidateFirst = listener;
        return jest.fn();
      },
      replaceDelegate: (delegate) => port.replaceDelegate(delegate),
      setUnavailable: () => adapter.setUnavailable({ generation: 2, status: "waiting_for_layout" }),
      assertCurrent: jest.fn(),
    });
    adapter.setReadReady({
      generation: 1,
      status: "workflow_read_ready",
      bundleIds: Object.freeze(["personal"]),
    });

    await expect(
      port.pauseBundle("personal", 1, new AbortController().signal)
    ).resolves.toBeUndefined();
    expect(firstPause).toHaveBeenCalledTimes(1);

    invalidateFirst?.();
    invalidateFirst?.();
    firstLease.close();
    firstLease.close();
    expect(sessions.getState()).toEqual({ status: "refreshing", revision: 2 });
    await expect(
      port.pauseBundle("personal", 2, new AbortController().signal)
    ).rejects.toBeInstanceOf(KnowledgeStudioAdapterUnavailableError);
    expect(firstPause).toHaveBeenCalledTimes(1);

    const secondDelegate = new UnavailableKnowledgeStudioPort("Second generation.");
    const secondLease = new KnowledgeStudioReadGenerationLease({
      delegate: secondDelegate,
      subscribeInvalidation: () => jest.fn(),
      replaceDelegate: (delegate) => port.replaceDelegate(delegate),
      setUnavailable: () => adapter.setUnavailable({ generation: 4, status: "waiting_for_layout" }),
      assertCurrent: jest.fn(),
    });
    adapter.setReadReady({
      generation: 3,
      status: "workflow_read_ready",
      bundleIds: Object.freeze(["personal"]),
    });
    expect(sessions.getState()).toMatchObject({ status: "selected", bundleId: "personal" });

    invalidateFirst?.();
    expect(sessions.getState()).toMatchObject({ status: "selected", bundleId: "personal" });
    sessions.dispose();
    secondLease.close();
    expect(sessions.getState().status).toBe("unavailable");
    expect(sessions.getState().unavailableNotice).toContain("plugin is unloading");
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

  it("publishes a staged source-only delegate for the exact stopped Bundle", async () => {
    const port = new DelegatingKnowledgeStudioPort();
    const sessions = new KnowledgeStudioSessionStore("Waiting.");
    const adapter = new KnowledgeStudioStartupAvailabilityAdapter(port, sessions);
    port.replaceDelegate(new UnavailableKnowledgeStudioPort("Staged source delegate."));

    adapter.setSourceRecoveryReady({
      generation: 2,
      status: "source_recovery_required",
      bundleIds: Object.freeze(["personal"]),
      sourceRecoveryBundleId: "personal",
      blockerKinds: Object.freeze(["source_observation_pending"]),
    });

    expect(sessions.getState()).toMatchObject({ bundleId: "personal" });
    await expect(port.load("personal", new AbortController().signal)).resolves.toMatchObject({
      notice: "Staged source delegate.",
    });
    expect(sessions.getState().unavailableNotice).toContain("Open Sources");
    expect(sessions.getState().unavailableNotice).toContain("model calls");
    expect(sessions.getState().unavailableNotice).toContain("Wiki writes remain stopped");
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
    {
      state: createState({
        status: "recovery_blocked",
        bundleIds: Object.freeze(["personal"]),
        recoveryBundleId: "personal",
        attentionKinds: Object.freeze(["forward_revision_apply_recovery_required"]),
      }),
      expectedNotice: "reviewed Wiki revision",
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

  it("gives a forward Apply conflict content-free blocked guidance", () => {
    const state = createState({
      status: "recovery_blocked",
      bundleIds: Object.freeze(["personal"]),
      recoveryBundleId: "personal",
      attentionKinds: Object.freeze(["forward_revision_apply_recovery_required"]),
    });

    const notice = getKnowledgeStartupNotice(state);

    expect(notice).toContain("reviewed Wiki revision");
    expect(notice).toContain("No new AI or Wiki work will run");
    expect(notice).not.toContain("Open Recovery");
    expect(notice).not.toContain("transaction");
  });

  it("publishes the delegate before session observers receive an exact Bundle", () => {
    const calls: string[] = [];
    const port = {
      replaceDelegate: jest.fn(() => calls.push("delegate")),
    };
    const sessions = {
      publishRefreshing: jest.fn(() => calls.push("refreshing")),
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
