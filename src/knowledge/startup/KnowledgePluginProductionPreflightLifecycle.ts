import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
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

/** Minimal project snapshot consumed by one production preflight generation. */
export interface KnowledgePluginProductionPreflightProjectRecord {
  project: ProjectKnowledgeBundleConfigInput & ProjectKnowledgePipelineProjectInput;
}

/** Static, secret-free resources shared by preflight and the future worker generation. */
export interface KnowledgePluginProductionPreflightResources {
  /** Exact parser capabilities whose profiles participate in this generation. */
  parsers: readonly KnowledgeByteParser[];
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
}

/** Closeable synchronous preflight instance owned by this plugin lifecycle. */
export interface KnowledgePluginProductionPreflightPort {
  /** Returns one already-sanitized synchronous preflight result. */
  preflight(): KnowledgeProductionPreflightResult;
  /** Transfers lifecycle close authority for the exact admitted private route generation. */
  getModelRouteLeaseOwner(): KnowledgeProductionModelRouteLeaseOwner;
  /** Permanently invalidates every capability retained by this preflight generation. */
  close(): void;
}

/** Injected plugin edges used to build one exact preflight generation. */
export interface KnowledgePluginProductionPreflightLifecycleDependencies {
  /** One-shot opaque half of the exact Runtime/preflight execution pairing. */
  executionPreflightClaim: KnowledgeProductionWorkflowExecutionPreflightClaim;
  /** Captures project records once after ordinary Projects initialization. */
  getProjectRecords(): readonly KnowledgePluginProductionPreflightProjectRecord[];
  /** Captures already-hydrated settings once for the same synchronous generation. */
  getSettings(): KnowledgeProductionPreflightSettingsInput;
  /** Stable renderer-native fetch capability captured for this plugin instance. */
  fetchPort?: KnowledgeDeepSeekFetchPort;
  /** Creates the reviewed parser/compiler/profile resources for this generation. */
  createResources(): KnowledgePluginProductionPreflightResources;
  /** Creates the strict aggregate Bundle source without accessing global state. */
  createBundleSource?(): Pick<ProjectKnowledgeBundleConfigSource, "load">;
  /** Eagerly constructs one zero-network private-route preflight. */
  createPreflight?: (
    input: KnowledgeProductionPreflightComposerInput
  ) => KnowledgePluginProductionPreflightPort;
}

/** Configured preflight admission retained only by the current lifecycle generation. */
export interface KnowledgePluginProductionPreflightAdmission {
  /** Opaque in-memory generation checked before production composition may continue. */
  readonly generation: number;
  /** Strict Bundle owners captured from the exact Projects snapshot used by preflight. */
  readonly owners: readonly ConfiguredProjectKnowledgeBundle[];
  /** Unforgeable secret-free capabilities retained for the exact workflow generation. */
  readonly workflowLease: KnowledgePluginProductionWorkflowLease;
  /** One-shot opaque bridge consumed only while composing this exact generation. */
  readonly workflowCompositionClaim: KnowledgePluginProductionWorkflowCompositionClaim;
  /** Close-incapable access to exact preflight-created model routes. */
  readonly modelRouteLease: KnowledgeProductionModelRouteLease;
}

/** Startup result plus an in-process admission used by the next recovery boundary. */
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

// Capturing the frozen base method prevents a subclass override from replacing WeakMap authority.
// eslint-disable-next-line @typescript-eslint/unbound-method
const PROJECT_PROFILE_SOURCE_RESOLVE = ProjectKnowledgePipelineProfileSource.prototype.resolve;

/** Module-private state held only by authentic workflow leases. */
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

/** Module-authentic one-shot bridge for installing the exact production composition owner. */
export class KnowledgePluginProductionWorkflowCompositionClaim {
  /** Construction is accepted only through hidden WeakMap state installed by preflight. */
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

/** Returns the hidden exact preflight binding captured during lifecycle construction. */
function requirePreflightExecutionBinding(
  lifecycle: KnowledgePluginProductionPreflightLifecycle
): KnowledgeProductionWorkflowExecutionPreflightBinding {
  const binding = preflightExecutionBindings.get(lifecycle);
  if (!binding) throw new TypeError("The production preflight execution binding is invalid");
  return binding;
}

const workflowLeaseStates = new WeakMap<object, KnowledgePluginProductionWorkflowLeaseState>();

/** Narrows the injected Projects result without changing its declared element type to `any`. */
function isProjectRecordArray(
  value: unknown
): value is readonly KnowledgePluginProductionPreflightProjectRecord[] {
  return Array.isArray(value);
}

/** Creates the standard cancellation rejection used by startup generation boundaries. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Returns hidden mutable state only for an authentic workflow lease. */
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

/** Calls one invalidation observer without allowing it to block revocation or cleanup. */
function notifyWorkflowLeaseInvalidation(listener: () => void): void {
  try {
    listener();
  } catch {
    // Revocation observers cannot recover authority or prevent other observers.
  }
}

/** Synchronously revokes one authentic lease before notifying a stable observer snapshot. */
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

/** Revokes one authentic model-route owner without allowing cleanup failure to stop teardown. */
function closeModelRouteOwnerSafely(
  owner: KnowledgeProductionModelRouteLeaseOwner | undefined
): void {
  if (!owner) return;
  try {
    KnowledgeProductionModelRouteLeaseOwner.assert(owner);
    owner.close();
  } catch {
    // Candidate and workflow cleanup must continue after an invalid or failing owner.
  }
}

/** Captures strict frozen owner projections used by preflight and its workflow lease. */
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

/** Reads one exact enumerable data-only record without invoking accessors. */
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

/** Reads one dense string array without consulting iterators or element accessors. */
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

/** Compares one detached owner with a retained owner across its complete strict config. */
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

/** Finds one callable data method without invoking getters on a capability or its prototypes. */
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

/** Captures a bounded dense parser capability array without consulting iterator hooks. */
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

/** Mints one module-authentic workflow lease without exposing its construction token. */
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

/** Freezes the narrow immutable admission passed to future production composition. */
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

/** Maps an already-sanitized preflight diagnostic into the startup namespace. */
function toStartupDiagnostic(
  result: Extract<KnowledgeProductionPreflightResult, { kind: "diagnostic" }>
): string {
  return `production_preflight_${result.code}`;
}

/**
 * Opaque, synchronously revocable capability for one exact production workflow generation.
 *
 * Owners, parsers, and the authentic profile source live only in module-private
 * WeakMap state. Closing the owning plugin lifecycle removes those references
 * before a stable snapshot of invalidation observers is called.
 */
export class KnowledgePluginProductionWorkflowLease {
  /** Rejects direct construction without the module-private lifecycle token. */
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

  /** Authenticates a lifecycle-minted lease without granting mint or close authority. */
  static assert(value: unknown): asserts value is KnowledgePluginProductionWorkflowLease {
    requireWorkflowLeaseState(value);
  }

  /** Reports whether this current lease owns the exact opaque execution lifecycle. */
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

  /** Returns the leaf-authentic Runtime decision lease only after exact owner rejoin. */
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

  /** Mints the one-shot composition bridge retained by this preflight admission. */
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

  /** Consumes one exact preflight-minted composition claim once. */
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

  /** Returns whether this exact workflow generation still owns its capabilities. */
  isCurrent(): boolean {
    return requireWorkflowLeaseState(this).current;
  }

  /** Throws the standard cancellation category after synchronous workflow revocation. */
  assertCurrent(): void {
    if (!requireWorkflowLeaseState(this).current) {
      throw createAbortError();
    }
  }

  /** Returns the exact frozen owners used by this generation's production preflight. */
  getOwners(): readonly ConfiguredProjectKnowledgeBundle[] {
    const state = requireWorkflowLeaseState(this);
    if (!state.current || !state.owners) {
      throw createAbortError();
    }
    return state.owners;
  }

  /** Returns the exact frozen parser capability registry captured for this generation. */
  getParsers(): readonly KnowledgeByteParser[] {
    const state = requireWorkflowLeaseState(this);
    if (!state.current || !state.parsers) {
      throw createAbortError();
    }
    return state.parsers;
  }

  /**
   * Resolves one exact owner through the same authentic source used by preflight.
   *
   * @param owner - Retained or strict detached owner matching one exact generation owner
   * @param signal - Caller-owned workflow cancellation signal
   * @returns Frozen, secret-free pipeline profile
   */
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

  /**
   * Observes one future synchronous revocation without receiving close authority.
   *
   * A listener registered after revocation is called synchronously. Unsubscribe is
   * idempotent, and observer failures are isolated from lifecycle cleanup.
   *
   * @param listener - Value-free revocation callback
   * @returns Idempotent unsubscribe function
   */
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

/**
 * Owns production preflight capabilities across Settings, Projects, and plugin invalidation.
 *
 * Candidate construction is generation-checked before installation. This closes
 * the synchronous re-entrancy window where a Settings or Projects callback can
 * invalidate startup while a constructor is still running. The lifecycle has no
 * Queue, watcher, model invocation, source reader, Review, or Wiki mutation port.
 */
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

  /** Creates one plugin-owned, initially fail-closed preflight lifecycle. */
  constructor(dependencies: KnowledgePluginProductionPreflightLifecycleDependencies) {
    const { executionPreflightClaim, ...retained } = dependencies;
    const executionBinding =
      consumeKnowledgeProductionWorkflowExecutionPreflightClaim(executionPreflightClaim);
    preflightExecutionBindings.set(this, executionBinding);
    this.dependencies = retained;
  }

  /**
   * Strictly loads Bundle configuration and installs only a current preflight candidate.
   *
   * @param signal - Startup barrier generation cancellation
   * @returns Sanitized Bundle state and a current in-process production admission
   */
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

    const settings = this.dependencies.getSettings();
    this.assertCurrent(generation, signal);
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
    let profileSource: ProjectKnowledgePipelineProfileSource;
    let parsers: readonly KnowledgeByteParser[];
    let owners: readonly ConfiguredProjectKnowledgeBundle[];
    let workflowLease: KnowledgePluginProductionWorkflowLease | undefined;
    try {
      parsers = snapshotParsers(resources.parsers);
      profileSource = new ProjectKnowledgePipelineProfileSource(
        projects,
        settings,
        resources.profileOptions
      );
      owners = snapshotOwners(result.bundles);
      workflowLease = createWorkflowLease(
        owners,
        parsers,
        profileSource,
        requirePreflightExecutionBinding(this)
      );
      this.assertCurrent(generation, signal);
    } catch (error) {
      if (workflowLease) {
        closeWorkflowLease(workflowLease);
      }
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

    const createPreflight = this.dependencies.createPreflight;
    let candidate: KnowledgePluginProductionPreflightPort;
    try {
      const input: KnowledgeProductionPreflightComposerInput = {
        owners,
        projects,
        settings,
        profileOptions: resources.profileOptions,
        profileSource,
        fetchPort: this.dependencies.fetchPort,
      };
      candidate = createPreflight
        ? createPreflight(input)
        : new KnowledgeProductionPreflightComposer(input);
    } catch {
      closeWorkflowLease(workflowLease);
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

  /**
   * Requires an admission to remain owned by the current installed generation.
   *
   * @param admission - Candidate returned by the most recent successful load
   */
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

  /** Synchronously invalidates the current preflight after Settings or Projects change. */
  invalidate(): void {
    if (this.closed) {
      return;
    }
    this.generation += 1;
    this.closeCurrent();
  }

  /** Permanently closes this plugin lifecycle and every retained private preflight capability. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.generation += 1;
    this.closeCurrent();
  }

  /** Starts a latest-wins generation after closing the previous candidate synchronously. */
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

  /** Captures a dense project snapshot without retaining project-file metadata. */
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

  /** Rejects continuation after cancellation, closure, or synchronous invalidation. */
  private assertCurrent(generation: number, signal: AbortSignal): void {
    if (this.closed || signal.aborted || generation !== this.generation) {
      throw createAbortError();
    }
  }

  /** Closes and removes one candidate only if it is still the installed generation. */
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
    }
    closeWorkflowLease(workflowLease);
  }

  /** Closes the current candidate before clearing its lifecycle reference. */
  private closeCurrent(): void {
    const current = this.current;
    this.current = undefined;
    if (!current) return;
    closeModelRouteOwnerSafely(current.modelRouteOwner);
    try {
      current.preflight.close();
    } catch {
      // Authority is already synchronously revoked; cleanup failure stays private.
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
