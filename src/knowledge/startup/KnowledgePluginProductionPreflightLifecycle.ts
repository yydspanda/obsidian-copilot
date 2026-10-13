import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
import type {
  PrepareKnowledgeConfiguredModelPreflightInput,
  PreparedKnowledgeConfiguredModelPreflight,
} from "@/knowledge/compiler/KnowledgeConfiguredModelBridge";
import {
  KnowledgeProductionModelRouteLease,
  KnowledgeProductionModelRouteLeaseOwner,
} from "@/knowledge/compiler/KnowledgeProductionModelRouteLease";
import {
  KnowledgeProductionPreflightComposer,
  type KnowledgeProductionPreflightComposerInput,
  type KnowledgeProductionPreflightResult,
  type KnowledgeProductionPreflightSettingsInput,
} from "@/knowledge/compiler/KnowledgeProductionPreflightComposer";
import {
  ProjectKnowledgeBundleConfigSource,
  type ConfiguredProjectKnowledgeBundle,
  type ProjectKnowledgeBundleConfigInput,
} from "@/knowledge/config/ProjectKnowledgeBundleConfigSource";
import {
  ProjectKnowledgePipelineProfileError,
  ProjectKnowledgePipelineProfileSource,
  type ProjectKnowledgePipelineProfileSourceOptions,
  type ProjectKnowledgePipelineProjectInput,
} from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgeBundlePipelineProfile } from "@/knowledge/ingest/KnowledgeSourceWatchPlan";
import { KnowledgeExecutionOwner } from "@/knowledge/ingest/KnowledgeExecutionOwner";
import {
  consumeKnowledgeProductionWorkflowExecutionPreflightClaim,
  KnowledgeProductionWorkflowExecutionPreflightBinding,
  KnowledgeProductionWorkflowExecutionPreflightClaim,
  KnowledgeProductionWorkflowExecutionLease,
} from "@/knowledge/startup/KnowledgeProductionWorkflowExecutionLease";
import type { KnowledgeByteParser } from "@/knowledge/parser/KnowledgeByteParser";
import type { KnowledgePluginBundleConfigLoadResult } from "@/knowledge/startup/KnowledgePluginStartupBarrier";

export interface KnowledgePluginProductionPreflightProjectRecord {
  project: ProjectKnowledgeBundleConfigInput & ProjectKnowledgePipelineProjectInput;
}

export interface KnowledgePluginProductionPreflightResources {
  parsers: readonly KnowledgeByteParser[];
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
}

export interface KnowledgePluginProductionPreflightPort {
  preflight(): KnowledgeProductionPreflightResult;

  getModelRouteLeaseOwner(): KnowledgeProductionModelRouteLeaseOwner;

  close(): void;
}

export interface KnowledgePluginProductionPreflightLifecycleDependencies {
  executionPreflightClaim: KnowledgeProductionWorkflowExecutionPreflightClaim;

  getProjectRecords(): readonly KnowledgePluginProductionPreflightProjectRecord[];

  getSettings?(): KnowledgeProductionPreflightSettingsInput;

  fetchPort?: KnowledgeDeepSeekFetchPort;

  createResources(): KnowledgePluginProductionPreflightResources;

  createBundleSource?(): Pick<ProjectKnowledgeBundleConfigSource, "load">;

  createPreflight?: (
    input: KnowledgeProductionPreflightComposerInput
  ) => KnowledgePluginProductionPreflightPort;

  prepareConfiguredModelPreflight?: (
    input: Omit<PrepareKnowledgeConfiguredModelPreflightInput, "modelManagement">
  ) => Promise<PreparedKnowledgeConfiguredModelPreflight>;
}

export interface KnowledgePluginProductionPreflightAdmission {
  readonly generation: number;

  readonly owners: readonly ConfiguredProjectKnowledgeBundle[];

  readonly workflowLease: KnowledgePluginProductionWorkflowLease;

  readonly workflowCompositionClaim: KnowledgePluginProductionWorkflowCompositionClaim;

  readonly modelRouteLease: KnowledgeProductionModelRouteLease;
}

export type KnowledgePluginProductionPreflightLoadResult =
  | Exclude<KnowledgePluginBundleConfigLoadResult, { kind: "configured" }>
  | {
      kind: "configured";
      bundleIds: readonly string[];
      admission: KnowledgePluginProductionPreflightAdmission;
    };

const ROUTE_DEPENDENCY_DIAGNOSTIC = "production_preflight_route_dependency_invalid";
const MAX_WORKFLOW_PARSERS = 10_000;
const WORKFLOW_LEASE_CONSTRUCTOR_TOKEN = Symbol(
  "KnowledgePluginProductionWorkflowLease.constructor"
);

// eslint-disable-next-line @typescript-eslint/unbound-method -- Capture the frozen base method so a subclass cannot replace WeakMap authority.
const PROJECT_PROFILE_SOURCE_RESOLVE = ProjectKnowledgePipelineProfileSource.prototype.resolve;

interface KnowledgePluginProductionWorkflowLeaseState {
  current: boolean;
  executionOwner?: KnowledgeExecutionOwner;
  executionLease?: KnowledgeProductionWorkflowExecutionLease;
  executionBinding?: KnowledgeProductionWorkflowExecutionPreflightBinding;
  owners?: readonly ConfiguredProjectKnowledgeBundle[];
  parsers?: readonly KnowledgeByteParser[];
  profileSource?: ProjectKnowledgePipelineProfileSource;
  invalidationListeners: Set<() => void>;
}

const preflightExecutionBindings = new WeakMap<
  object,
  KnowledgeProductionWorkflowExecutionPreflightBinding
>();

export class KnowledgePluginProductionWorkflowCompositionClaim {
  constructor(token: symbol) {
    if (token !== WORKFLOW_LEASE_CONSTRUCTOR_TOKEN) throw new TypeError();
    Object.freeze(this);
  }
}

interface WorkflowCompositionClaimState {
  readonly lease: KnowledgePluginProductionWorkflowLease;
  readonly executionOwner: KnowledgeExecutionOwner;
  consumed: boolean;
}

const workflowCompositionClaimStates = new WeakMap<object, WorkflowCompositionClaimState>();

function requirePreflightExecutionBinding(
  lifecycle: KnowledgePluginProductionPreflightLifecycle
): KnowledgeProductionWorkflowExecutionPreflightBinding {
  const binding = preflightExecutionBindings.get(lifecycle);
  if (!binding) throw new TypeError("The production preflight execution binding is invalid");
  return binding;
}

const workflowLeaseStates = new WeakMap<object, KnowledgePluginProductionWorkflowLeaseState>();

function isProjectRecordArray(
  value: unknown
): value is readonly KnowledgePluginProductionPreflightProjectRecord[] {
  return Array.isArray(value);
}

function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function requireWorkflowLeaseState(value: unknown): KnowledgePluginProductionWorkflowLeaseState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("The production workflow lease is invalid");
  }
  const state = workflowLeaseStates.get(value);
  if (!state) {
    throw new TypeError("The production workflow lease is invalid");
  }
  return state;
}

function notifyWorkflowLeaseInvalidation(listener: () => void): void {
  try {
    listener();
  } catch {
    // Revocation observers cannot recover authority or prevent other observers.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

function closeWorkflowLease(lease: KnowledgePluginProductionWorkflowLease): void {
  const state = requireWorkflowLeaseState(lease);
  if (!state.current) return;

  state.current = false;
  const listeners = [...state.invalidationListeners];
  state.invalidationListeners.clear();
  state.owners = undefined;
  state.parsers = undefined;
  state.profileSource = undefined;
  const executionBinding = state.executionBinding;
  const executionLease = state.executionLease;
  state.executionOwner = undefined;
  state.executionBinding = undefined;
  state.executionLease = undefined;
  if (executionBinding && executionLease) {
    executionBinding.revokeWorkflowExecutionLease(executionLease);
  }
  for (const listener of listeners) {
    notifyWorkflowLeaseInvalidation(listener);
  }
}

function closeModelRouteOwnerSafely(
  owner: KnowledgeProductionModelRouteLeaseOwner | undefined
): void {
  if (!owner) return;
  try {
    KnowledgeProductionModelRouteLeaseOwner.assert(owner);
    owner.close();
  } catch {
    // Candidate and workflow cleanup must continue after an invalid or failing owner.
    // https://github.com/yydspanda/obsidian-copilot/issues/24
  }
}

function snapshotOwners(
  owners: readonly ConfiguredProjectKnowledgeBundle[]
): readonly ConfiguredProjectKnowledgeBundle[] {
  const snapshot: ConfiguredProjectKnowledgeBundle[] = owners.map(({ projectId, config }) => {
    const configSnapshot = { ...config, sourceRoots: [...config.sourceRoots] };
    Object.freeze(configSnapshot.sourceRoots);
    Object.freeze(configSnapshot);
    return Object.freeze({ projectId, config: configSnapshot });
  });
  return Object.freeze(snapshot);
}

function snapshotExactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const expectedKeys = [...keys].sort();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some((key) => typeof key !== "string") ||
      (ownKeys as string[]).sort().some((key, index) => key !== expectedKeys[index])
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return undefined;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function snapshotStringArray(value: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(value)) return undefined;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 1 ||
      Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
    ) {
      return undefined;
    }
    const snapshot: string[] = [];
    for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        typeof descriptor.value !== "string"
      ) {
        return undefined;
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}

function isSameWorkflowOwner(value: unknown, retained: ConfiguredProjectKnowledgeBundle): boolean {
  const owner = snapshotExactRecord(value, ["projectId", "config"]);
  const config = owner
    ? snapshotExactRecord(owner.config, [
        "version",
        "id",
        "sourceRoots",
        "wikiRoot",
        "schemaRef",
        "reviewMode",
      ])
    : undefined;
  const sourceRoots = config ? snapshotStringArray(config.sourceRoots) : undefined;
  if (!owner || !config || !sourceRoots) return false;
  return (
    owner.projectId === retained.projectId &&
    config.version === retained.config.version &&
    config.id === retained.config.id &&
    config.wikiRoot === retained.config.wikiRoot &&
    config.schemaRef === retained.config.schemaRef &&
    config.reviewMode === retained.config.reviewMode &&
    sourceRoots.length === retained.config.sourceRoots.length &&
    sourceRoots.every((root, index) => root === retained.config.sourceRoots[index])
  );
}

function hasDataMethod(value: unknown, key: "getProfile" | "parse"): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return false;
  }
  try {
    let owner: object | null = value;
    const visited = new Set<object>();
    while (owner && !visited.has(owner)) {
      visited.add(owner);
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor) {
        return "value" in descriptor && typeof descriptor.value === "function";
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
  } catch {
    return false;
  }
  return false;
}

function snapshotParsers(value: unknown): readonly KnowledgeByteParser[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Knowledge workflow parsers are unavailable");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > MAX_WORKFLOW_PARSERS ||
    Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
  ) {
    throw new TypeError("Knowledge workflow parsers are unavailable");
  }

  const parsers: KnowledgeByteParser[] = [];
  for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !hasDataMethod(descriptor.value, "getProfile") ||
      !hasDataMethod(descriptor.value, "parse")
    ) {
      throw new TypeError("Knowledge workflow parsers are unavailable");
    }
    parsers.push(descriptor.value as KnowledgeByteParser);
  }
  return Object.freeze(parsers);
}

function createWorkflowLease(
  owners: readonly ConfiguredProjectKnowledgeBundle[],
  parsers: readonly KnowledgeByteParser[],
  profileSource: ProjectKnowledgePipelineProfileSource,
  executionBinding: KnowledgeProductionWorkflowExecutionPreflightBinding
): KnowledgePluginProductionWorkflowLease {
  const lease = new KnowledgePluginProductionWorkflowLease(
    WORKFLOW_LEASE_CONSTRUCTOR_TOKEN,
    owners,
    parsers,
    profileSource
  );
  const execution = executionBinding.issueWorkflowExecutionLease();
  const { executionOwner } = execution;
  KnowledgeExecutionOwner.bindProductionLease(executionOwner, lease);
  requireWorkflowLeaseState(lease).executionOwner = executionOwner;
  requireWorkflowLeaseState(lease).executionLease = execution.lease;
  requireWorkflowLeaseState(lease).executionBinding = executionBinding;
  return lease;
}

function createAdmission(
  generation: number,
  owners: readonly ConfiguredProjectKnowledgeBundle[],
  workflowLease: KnowledgePluginProductionWorkflowLease,
  workflowCompositionClaim: KnowledgePluginProductionWorkflowCompositionClaim,
  modelRouteLease: KnowledgeProductionModelRouteLease
): KnowledgePluginProductionPreflightAdmission {
  return Object.freeze({
    generation,
    owners,
    workflowLease,
    workflowCompositionClaim,
    modelRouteLease,
  });
}

function toStartupDiagnostic(
  result: Extract<KnowledgeProductionPreflightResult, { kind: "diagnostic" }>
): string {
  return `production_preflight_${result.code}`;
}

export class KnowledgePluginProductionWorkflowLease {
  constructor(
    token: symbol,
    owners: readonly ConfiguredProjectKnowledgeBundle[],
    parsers: readonly KnowledgeByteParser[],
    profileSource: ProjectKnowledgePipelineProfileSource
  ) {
    if (token !== WORKFLOW_LEASE_CONSTRUCTOR_TOKEN) {
      throw new TypeError("The production workflow lease is invalid");
    }
    workflowLeaseStates.set(this, {
      current: true,
      owners,
      parsers,
      profileSource,
      invalidationListeners: new Set(),
    });
    Object.freeze(this);
  }

  static assert(value: unknown): asserts value is KnowledgePluginProductionWorkflowLease {
    requireWorkflowLeaseState(value);
  }

  static matchesExecutionOwner(value: unknown, executionOwner: unknown): boolean {
    try {
      const state = requireWorkflowLeaseState(value);
      KnowledgeExecutionOwner.assert(executionOwner);
      return (
        state.current &&
        state.executionOwner === executionOwner &&
        state.executionLease !== undefined &&
        state.executionBinding?.ownsWorkflowExecutionLease(state.executionLease) === true &&
        KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
          state.executionLease,
          executionOwner
        ) &&
        KnowledgeExecutionOwner.matchesProductionLease(executionOwner, value as object)
      );
    } catch {
      return false;
    }
  }

  static getExecutionLease(
    value: KnowledgePluginProductionWorkflowLease,
    executionOwner: KnowledgeExecutionOwner
  ): KnowledgeProductionWorkflowExecutionLease {
    const state = requireWorkflowLeaseState(value);
    if (
      !state.current ||
      state.executionOwner !== executionOwner ||
      !state.executionLease ||
      !state.executionBinding?.ownsWorkflowExecutionLease(state.executionLease) ||
      !KnowledgeProductionWorkflowExecutionLease.matchesExecutionOwner(
        state.executionLease,
        executionOwner
      )
    ) {
      throw createAbortError();
    }
    return state.executionLease;
  }

  static createCompositionClaim(
    value: KnowledgePluginProductionWorkflowLease
  ): KnowledgePluginProductionWorkflowCompositionClaim {
    const state = requireWorkflowLeaseState(value);
    if (!state.current || !state.executionOwner) throw createAbortError();
    const claim = new KnowledgePluginProductionWorkflowCompositionClaim(
      WORKFLOW_LEASE_CONSTRUCTOR_TOKEN
    );
    KnowledgeExecutionOwner.bindCompositionClaim(state.executionOwner, claim);
    workflowCompositionClaimStates.set(claim, {
      lease: value,
      executionOwner: state.executionOwner,
      consumed: false,
    });
    return claim;
  }

  static consumeCompositionClaim(
    value: KnowledgePluginProductionWorkflowLease,
    claimValue: unknown
  ): KnowledgeExecutionOwner {
    const state = requireWorkflowLeaseState(value);
    const claim = workflowCompositionClaimStates.get(claimValue as object);
    if (
      !state.current ||
      !state.executionOwner ||
      !claim ||
      claim.consumed ||
      claim.lease !== value ||
      claim.executionOwner !== state.executionOwner ||
      !KnowledgeExecutionOwner.matchesCompositionClaim(state.executionOwner, claimValue as object)
    ) {
      throw createAbortError();
    }
    claim.consumed = true;
    return state.executionOwner;
  }

  isCurrent(): boolean {
    return requireWorkflowLeaseState(this).current;
  }

  assertCurrent(): void {
    if (!requireWorkflowLeaseState(this).current) {
      throw createAbortError();
    }
  }

  getOwners(): readonly ConfiguredProjectKnowledgeBundle[] {
    const state = requireWorkflowLeaseState(this);
    if (!state.current || !state.owners) {
      throw createAbortError();
    }
    return state.owners;
  }

  getParsers(): readonly KnowledgeByteParser[] {
    const state = requireWorkflowLeaseState(this);
    if (!state.current || !state.parsers) {
      throw createAbortError();
    }
    return state.parsers;
  }

  resolve(
    owner: ConfiguredProjectKnowledgeBundle,
    signal: AbortSignal
  ): KnowledgeBundlePipelineProfile {
    const state = requireWorkflowLeaseState(this);
    if (signal.aborted || !state.current || !state.owners || !state.profileSource) {
      throw createAbortError();
    }
    const owners = state.owners;
    const profileSource = state.profileSource;
    const matches = owners.filter((candidate) => isSameWorkflowOwner(owner, candidate));
    if (signal.aborted || !state.current) {
      throw createAbortError();
    }
    if (matches.length !== 1) {
      throw new TypeError("The production workflow owner is invalid");
    }
    const profile = Reflect.apply(PROJECT_PROFILE_SOURCE_RESOLVE, profileSource, [matches[0]]);
    if (signal.aborted || !state.current) {
      throw createAbortError();
    }
    return profile;
  }

  subscribeInvalidation(listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("The workflow invalidation listener is invalid");
    }
    const state = requireWorkflowLeaseState(this);
    if (!state.current) {
      notifyWorkflowLeaseInvalidation(listener);
      return () => undefined;
    }

    let subscribed = true;
    const observer = () => listener();
    state.invalidationListeners.add(observer);
    return () => {
      if (!subscribed) return;
      subscribed = false;
      state.invalidationListeners.delete(observer);
    };
  }
}

export class KnowledgePluginProductionPreflightLifecycle {
  private readonly dependencies: Omit<
    KnowledgePluginProductionPreflightLifecycleDependencies,
    "executionPreflightClaim"
  >;
  private generation = 0;
  private closed = false;
  private current?: {
    generation: number;
    preflight: KnowledgePluginProductionPreflightPort;
    admission: KnowledgePluginProductionPreflightAdmission;
    modelRouteOwner: KnowledgeProductionModelRouteLeaseOwner;
  };

  constructor(dependencies: KnowledgePluginProductionPreflightLifecycleDependencies) {
    const { executionPreflightClaim, ...retained } = dependencies;
    const executionBinding =
      consumeKnowledgeProductionWorkflowExecutionPreflightClaim(executionPreflightClaim);
    preflightExecutionBindings.set(this, executionBinding);
    this.dependencies = retained;
  }

  async load(signal: AbortSignal): Promise<KnowledgePluginProductionPreflightLoadResult> {
    const generation = this.beginGeneration(signal);
    const projectRecords = this.captureProjectRecords();
    this.assertCurrent(generation, signal);

    const source =
      this.dependencies.createBundleSource?.() ?? new ProjectKnowledgeBundleConfigSource();
    const result = source.load(
      projectRecords.map(({ project }) => ({
        id: project.id,
        knowledgeBundle: project.knowledgeBundle,
      }))
    );
    this.assertCurrent(generation, signal);

    if (result.kind === "unconfigured") {
      return result;
    }
    if (result.kind === "invalid") {
      return {
        kind: "invalid",
        diagnosticCodes: result.diagnostics.map(({ code }) => code),
      };
    }
    if (!this.dependencies.fetchPort) {
      return {
        kind: "invalid",
        diagnosticCodes: [ROUTE_DEPENDENCY_DIAGNOSTIC],
      };
    }

    const prepareConfiguredModelPreflight = this.dependencies.prepareConfiguredModelPreflight;
    let legacySettings: KnowledgeProductionPreflightSettingsInput | undefined;
    if (!prepareConfiguredModelPreflight) {
      const getSettings = this.dependencies.getSettings;
      if (!getSettings) {
        return {
          kind: "invalid",
          diagnosticCodes: ["production_preflight_input_invalid"],
        };
      }
      legacySettings = getSettings();
      this.assertCurrent(generation, signal);
    }

    const resources = this.dependencies.createResources();
    this.assertCurrent(generation, signal);
    const projects = Object.freeze(
      projectRecords.map(({ project }) =>
        Object.freeze({
          id: project.id,
          projectModelKey: project.projectModelKey,
          modelConfigs: project.modelConfigs,
        })
      )
    );
    const configuredProjects = Object.freeze(
      projectRecords.map(({ project }) =>
        Object.freeze({
          id: project.id,
          modelSelection: project.projectModelKey,
          modelConfigs: project.modelConfigs,
        })
      )
    );
    let parsers: readonly KnowledgeByteParser[];
    let owners: readonly ConfiguredProjectKnowledgeBundle[];
    try {
      parsers = snapshotParsers(resources.parsers);
      owners = snapshotOwners(result.bundles);
      this.assertCurrent(generation, signal);
    } catch {
      this.assertCurrent(generation, signal);
      return {
        kind: "invalid",
        diagnosticCodes: ["production_preflight_input_invalid"],
      };
    }

    let profileSource: ProjectKnowledgePipelineProfileSource;
    let candidate: KnowledgePluginProductionPreflightPort;
    if (prepareConfiguredModelPreflight) {
      let prepared: PreparedKnowledgeConfiguredModelPreflight;
      try {
        prepared = await prepareConfiguredModelPreflight({
          owners,
          projects: configuredProjects,
          profileOptions: resources.profileOptions,
          fetchPort: this.dependencies.fetchPort,
          signal,
        });
      } catch {
        this.assertCurrent(generation, signal);
        return {
          kind: "invalid",
          diagnosticCodes: ["production_preflight_input_invalid"],
        };
      }
      try {
        this.assertCurrent(generation, signal);
      } catch (error) {
        if (prepared.kind === "ready") prepared.preflight.close();
        throw error;
      }
      if (prepared.kind === "diagnostic") {
        return {
          kind: "invalid",
          diagnosticCodes: [`production_preflight_${prepared.code}`],
        };
      }
      profileSource = prepared.profileSource;
      candidate = prepared.preflight;
    } else {
      try {
        const settings = legacySettings;
        if (!settings) throw new TypeError("Knowledge preflight settings are unavailable");
        profileSource = new ProjectKnowledgePipelineProfileSource(
          projects,
          settings,
          resources.profileOptions
        );
        const input: KnowledgeProductionPreflightComposerInput = {
          owners,
          projects,
          settings,
          profileOptions: resources.profileOptions,
          profileSource,
          fetchPort: this.dependencies.fetchPort,
        };
        candidate = this.dependencies.createPreflight
          ? this.dependencies.createPreflight(input)
          : new KnowledgeProductionPreflightComposer(input);
      } catch (error) {
        this.assertCurrent(generation, signal);
        const profileCode = ProjectKnowledgePipelineProfileError.inspect(error);
        return {
          kind: "invalid",
          diagnosticCodes: [
            profileCode
              ? `production_preflight_profile_${profileCode}`
              : "production_preflight_input_invalid",
          ],
        };
      }
    }

    let workflowLease: KnowledgePluginProductionWorkflowLease | undefined;
    try {
      workflowLease = createWorkflowLease(
        owners,
        parsers,
        profileSource,
        requirePreflightExecutionBinding(this)
      );
      this.assertCurrent(generation, signal);
    } catch (error) {
      try {
        candidate.close();
      } catch {
        // A failed lease install cannot make a discarded preflight observable.
        // https://github.com/yydspanda/obsidian-copilot/issues/24
      }
      if (workflowLease) closeWorkflowLease(workflowLease);
      this.assertCurrent(generation, signal);
      const profileCode = ProjectKnowledgePipelineProfileError.inspect(error);
      return {
        kind: "invalid",
        diagnosticCodes: [
          profileCode
            ? `production_preflight_profile_${profileCode}`
            : "production_preflight_input_invalid",
        ],
      };
    }

    let preflight: KnowledgeProductionPreflightResult;
    try {
      preflight = candidate.preflight();
    } catch {
      this.closeCandidate(candidate, generation, workflowLease);
      this.assertCurrent(generation, signal);
      return {
        kind: "invalid",
        diagnosticCodes: ["production_preflight_input_invalid"],
      };
    }
    try {
      this.assertCurrent(generation, signal);
    } catch (error) {
      this.closeCandidate(candidate, generation, workflowLease);
      throw error;
    }
    if (preflight.kind === "diagnostic") {
      this.closeCandidate(candidate, generation, workflowLease);
      this.assertCurrent(generation, signal);
      return {
        kind: "invalid",
        diagnosticCodes: [toStartupDiagnostic(preflight)],
      };
    }

    let modelRouteOwner: KnowledgeProductionModelRouteLeaseOwner | undefined;
    let admission: KnowledgePluginProductionPreflightAdmission;
    try {
      const ownerCandidate = candidate.getModelRouteLeaseOwner();
      KnowledgeProductionModelRouteLeaseOwner.assert(ownerCandidate);
      modelRouteOwner = ownerCandidate;
      const modelRouteLease = modelRouteOwner.getLease();
      KnowledgeProductionModelRouteLease.assert(modelRouteLease);
      if (!modelRouteLease.coversBundleIds(owners.map(({ config }) => config.id))) {
        throw new TypeError("The production model route generation does not cover every Bundle");
      }
      const workflowCompositionClaim =
        KnowledgePluginProductionWorkflowLease.createCompositionClaim(workflowLease);
      admission = createAdmission(
        generation,
        owners,
        workflowLease,
        workflowCompositionClaim,
        modelRouteLease
      );
      this.assertCurrent(generation, signal);
    } catch {
      this.closeCandidate(candidate, generation, workflowLease, modelRouteOwner);
      this.assertCurrent(generation, signal);
      return {
        kind: "invalid",
        diagnosticCodes: ["production_preflight_route_invalid"],
      };
    }

    this.current = { generation, preflight: candidate, admission, modelRouteOwner };

    return {
      kind: "configured",
      bundleIds: admission.owners.map(({ config }) => config.id),
      admission,
    };
  }

  assertCurrentAdmission(admission: KnowledgePluginProductionPreflightAdmission): void {
    if (
      this.closed ||
      this.current?.generation !== admission.generation ||
      this.current.admission !== admission ||
      !admission.workflowLease.isCurrent() ||
      !admission.modelRouteLease.isCurrent()
    ) {
      throw createAbortError();
    }
  }

  invalidate(): void {
    if (this.closed) {
      return;
    }
    this.generation += 1;
    this.closeCurrent();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.generation += 1;
    this.closeCurrent();
  }

  private beginGeneration(signal: AbortSignal): number {
    if (this.closed || signal.aborted) {
      throw createAbortError();
    }
    this.generation += 1;
    const generation = this.generation;
    this.closeCurrent();
    this.assertCurrent(generation, signal);
    return generation;
  }

  private captureProjectRecords(): readonly KnowledgePluginProductionPreflightProjectRecord[] {
    const records = this.dependencies.getProjectRecords();
    if (!isProjectRecordArray(records)) {
      throw new TypeError("Knowledge project records are unavailable");
    }
    return Object.freeze(
      records.map(({ project }) =>
        Object.freeze({
          project: Object.freeze({
            id: project.id,
            knowledgeBundle: project.knowledgeBundle,
            projectModelKey: project.projectModelKey,
            modelConfigs: project.modelConfigs,
          }),
        })
      )
    );
  }

  private assertCurrent(generation: number, signal: AbortSignal): void {
    if (this.closed || signal.aborted || generation !== this.generation) {
      throw createAbortError();
    }
  }

  private closeCandidate(
    candidate: KnowledgePluginProductionPreflightPort,
    generation: number,
    workflowLease: KnowledgePluginProductionWorkflowLease,
    modelRouteOwner?: KnowledgeProductionModelRouteLeaseOwner
  ): void {
    if (this.current?.generation === generation && this.current.preflight === candidate) {
      this.current = undefined;
    }
    closeModelRouteOwnerSafely(modelRouteOwner);
    try {
      candidate.close();
    } catch {
      // Authority is already synchronously revoked; cleanup failure stays private.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
    closeWorkflowLease(workflowLease);
  }

  private closeCurrent(): void {
    const current = this.current;
    this.current = undefined;
    if (!current) return;
    closeModelRouteOwnerSafely(current.modelRouteOwner);
    try {
      current.preflight.close();
    } catch {
      // Authority is already synchronously revoked; cleanup failure stays private.
      // https://github.com/yydspanda/obsidian-copilot/issues/24
    }
    closeWorkflowLease(current.admission.workflowLease);
  }
}

Object.freeze(KnowledgePluginProductionWorkflowLease.prototype);
Object.freeze(KnowledgePluginProductionWorkflowLease);
Object.freeze(KnowledgePluginProductionWorkflowCompositionClaim.prototype);
Object.freeze(KnowledgePluginProductionWorkflowCompositionClaim);
Object.freeze(KnowledgePluginProductionPreflightLifecycle.prototype);
Object.freeze(KnowledgePluginProductionPreflightLifecycle);
