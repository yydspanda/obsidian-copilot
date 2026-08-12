import {
  createKnowledgeSetupUnloadedProjection,
  projectKnowledgeSetupReadiness,
  type KnowledgeSetupReadinessContext,
  type KnowledgeSetupReadinessProjection,
} from "@/knowledge/setup/KnowledgeSetupReadiness";
import {
  KnowledgeSetupReadinessStore,
  KnowledgeSetupReadinessStoreDisposedError,
  type KnowledgeSetupReadinessSnapshot,
} from "@/knowledge/setup/KnowledgeSetupReadinessStore";
import type { KnowledgePluginStartupState } from "@/knowledge/startup/KnowledgePluginStartupBarrier";

const CONFIGURED_CHAT: KnowledgeSetupReadinessContext = Object.freeze({
  projectCount: 1,
  chatModel: Object.freeze({ reason: "configured" }),
});

/** Creates one immutable projector output for a unique read-ready Bundle. */
function createReadyProjection(): KnowledgeSetupReadinessProjection {
  return projectKnowledgeSetupReadiness(
    { generation: 1, status: "workflow_read_ready", bundleIds: ["personal"] },
    CONFIGURED_CHAT
  );
}

/** Copies public state fields so listener observations do not retain store snapshots by identity. */
function copySnapshot(snapshot: KnowledgeSetupReadinessSnapshot): KnowledgeSetupReadinessSnapshot {
  return {
    revision: snapshot.revision,
    startupStatus: snapshot.startupStatus,
    workspace: { ...snapshot.workspace },
    knowledgeModel: { ...snapshot.knowledgeModel },
    chatModel: { ...snapshot.chatModel },
    networkVerification: snapshot.networkVerification,
  };
}

describe("KnowledgeSetupReadinessStore", () => {
  it("publishes a fail-closed unload projection before permanent disposal", () => {
    const store = new KnowledgeSetupReadinessStore(createReadyProjection());
    const listener = jest.fn();
    store.subscribe(listener);

    store.publish(createKnowledgeSetupUnloadedProjection());
    store.dispose();

    expect(store.getState()).toMatchObject({
      startupStatus: "plugin_unloaded",
      workspace: { level: "blocked", reason: "plugin_unloaded" },
      knowledgeModel: { level: "blocked", reason: "plugin_unloaded" },
      chatModel: { level: "blocked", reason: "plugin_unloaded" },
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("publishes immutable snapshots at monotonic revisions", () => {
    const store = new KnowledgeSetupReadinessStore(createReadyProjection());
    const initial = store.getState();
    const checking = projectKnowledgeSetupReadiness(
      { generation: 2, status: "waiting_for_layout" },
      CONFIGURED_CHAT
    );

    store.publish(checking);
    const second = store.getState();
    store.publish(createReadyProjection());
    const third = store.getState();

    expect([initial.revision, second.revision, third.revision]).toEqual([0, 1, 2]);
    for (const snapshot of [initial, second, third]) {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.workspace)).toBe(true);
      expect(Object.isFrozen(snapshot.knowledgeModel)).toBe(true);
      expect(Object.isFrozen(snapshot.chatModel)).toBe(true);
      expect(snapshot.networkVerification).toBe("not_tested");
    }
  });

  it("subscribes before its immediate notification and supports idempotent unsubscribe", () => {
    const store = new KnowledgeSetupReadinessStore(createReadyProjection());
    const observations: KnowledgeSetupReadinessSnapshot[] = [];
    const unsubscribe = store.subscribe(() => observations.push(copySnapshot(store.getState())));

    store.publishStartup(
      { generation: 2, status: "bundle_unconfigured" },
      { projectCount: 0, chatModel: { reason: "missing" } }
    );
    unsubscribe();
    unsubscribe();
    store.publish(createReadyProjection());

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      revision: 0,
      startupStatus: "workflow_read_ready",
    });
    expect(observations[1]).toMatchObject({
      revision: 1,
      startupStatus: "bundle_unconfigured",
      workspace: { level: "needs_action", reason: "no_project" },
      chatModel: { level: "needs_action", reason: "chat_model_missing" },
    });
    expect(store.getState().revision).toBe(2);
  });

  it("isolates immediate and publication listener failures", () => {
    const store = new KnowledgeSetupReadinessStore(createReadyProjection());
    const observations: number[] = [];

    expect(() =>
      store.subscribe(() => {
        throw new Error("observer failure");
      })
    ).not.toThrow();
    store.subscribe(() => observations.push(store.getState().revision));

    expect(() =>
      store.publishStartup({ generation: 2, status: "waiting_for_layout" }, CONFIGURED_CHAT)
    ).not.toThrow();
    expect(observations).toEqual([0, 1]);
  });

  it("copies caller-owned projections and retains no additional fields", () => {
    const initial = createReadyProjection();
    const store = new KnowledgeSetupReadinessStore(initial);
    const rawSecret = "private-api-key";
    const projection = {
      ...initial,
      workspace: { ...initial.workspace, rawSecret },
      rawSecret,
    } as unknown as KnowledgeSetupReadinessProjection;

    store.publish(projection);

    const snapshot = store.getState();
    expect(Object.keys(snapshot).sort()).toEqual([
      "chatModel",
      "knowledgeModel",
      "networkVerification",
      "revision",
      "startupStatus",
      "workspace",
    ]);
    expect(Object.keys(snapshot.workspace).sort()).toEqual(["level", "reason"]);
    expect(JSON.stringify(snapshot)).not.toContain(rawSecret);
    expect(snapshot).not.toBe(projection);
    expect(snapshot.workspace).not.toBe(projection.workspace);
  });

  it("does not mutate state or revision after rejecting a malformed projection", () => {
    const store = new KnowledgeSetupReadinessStore(createReadyProjection());
    const initial = store.getState();
    const malformed = {
      ...createReadyProjection(),
      workspace: { level: "locally_ready", reason: "private-path" },
    } as unknown as KnowledgeSetupReadinessProjection;

    expect(() => store.publish(malformed)).toThrow("Knowledge setup readiness input is invalid");
    expect(store.getState()).toBe(initial);
    expect(store.getState().revision).toBe(0);
  });

  it("disposes idempotently, releases listeners, and permanently rejects publication", () => {
    const store = new KnowledgeSetupReadinessStore(createReadyProjection());
    const listener = jest.fn();
    store.subscribe(listener);
    const finalState = store.getState();

    store.dispose();
    store.dispose();

    expect(store.getState()).toBe(finalState);
    expect(() => store.publish(createReadyProjection())).toThrow(
      KnowledgeSetupReadinessStoreDisposedError
    );
    expect(() =>
      store.publishStartup({ generation: 2, status: "waiting_for_layout" }, CONFIGURED_CHAT)
    ).toThrow(KnowledgeSetupReadinessStoreDisposedError);
    expect(listener).toHaveBeenCalledTimes(1);

    const lateListener = jest.fn();
    const lateUnsubscribe = store.subscribe(lateListener);
    lateUnsubscribe();
    lateUnsubscribe();
    expect(lateListener).toHaveBeenCalledTimes(1);
  });

  it("accepts every typed startup branch through publishStartup", () => {
    const store = new KnowledgeSetupReadinessStore(createReadyProjection());
    const states: KnowledgePluginStartupState[] = [
      { generation: 2, status: "waiting_for_layout" },
      { generation: 3, status: "runtime_unavailable" },
      { generation: 4, status: "projects_unavailable" },
      { generation: 5, status: "bundle_unconfigured" },
      {
        generation: 6,
        status: "bundle_invalid",
        diagnosticCodes: ["bundle_schema_invalid"],
      },
      {
        generation: 7,
        status: "recovery_unavailable",
        bundleIds: ["personal"],
        diagnosticCodes: ["recovery_failed"],
      },
      {
        generation: 8,
        status: "recovery_attention_required",
        bundleIds: ["personal"],
        recoveryBundleId: "personal",
        attentionKinds: ["accepted_not_started"],
      },
      {
        generation: 9,
        status: "recovery_blocked",
        bundleIds: ["personal"],
        recoveryBundleId: "personal",
        attentionKinds: ["transaction_active"],
      },
      {
        generation: 10,
        status: "source_recovery_required",
        bundleIds: ["personal"],
        sourceRecoveryBundleId: "personal",
        blockerKinds: ["source_observation_pending"],
      },
      {
        generation: 11,
        status: "workflow_adapters_unavailable",
        bundleIds: ["personal"],
      },
      { generation: 12, status: "workflow_read_ready", bundleIds: ["personal"] },
    ];

    for (const state of states) {
      store.publishStartup(state, CONFIGURED_CHAT);
    }

    expect(store.getState()).toMatchObject({
      revision: states.length,
      startupStatus: "workflow_read_ready",
      workspace: { level: "locally_ready" },
      knowledgeModel: { level: "locally_ready" },
    });
  });
});
