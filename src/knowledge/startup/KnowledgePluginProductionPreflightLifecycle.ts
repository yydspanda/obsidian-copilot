import type { KnowledgeDeepSeekFetchPort } from "@/knowledge/compiler/KnowledgeDeepSeekPrivateRoute";
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
import type {
  ProjectKnowledgePipelineProfileSourceOptions,
  ProjectKnowledgePipelineProjectInput,
} from "@/knowledge/config/ProjectKnowledgePipelineProfileSource";
import type { KnowledgePluginBundleConfigLoadResult } from "@/knowledge/startup/KnowledgePluginStartupBarrier";

/** Minimal project snapshot consumed by one production preflight generation. */
export interface KnowledgePluginProductionPreflightProjectRecord {
  project: ProjectKnowledgeBundleConfigInput & ProjectKnowledgePipelineProjectInput;
}

/** Static, secret-free resources shared by preflight and the future worker generation. */
export interface KnowledgePluginProductionPreflightResources {
  profileOptions: ProjectKnowledgePipelineProfileSourceOptions;
}

/** Closeable synchronous preflight instance owned by this plugin lifecycle. */
export interface KnowledgePluginProductionPreflightPort {
  /** Returns one already-sanitized synchronous preflight result. */
  preflight(): KnowledgeProductionPreflightResult;
  /** Permanently invalidates every capability retained by this preflight generation. */
  close(): void;
}

/** Injected plugin edges used to build one exact preflight generation. */
export interface KnowledgePluginProductionPreflightLifecycleDependencies {
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

/** Freezes the narrow immutable admission passed to future production composition. */
function createAdmission(
  generation: number,
  owners: readonly ConfiguredProjectKnowledgeBundle[]
): KnowledgePluginProductionPreflightAdmission {
  const snapshot: ConfiguredProjectKnowledgeBundle[] = owners.map(({ projectId, config }) => {
    const configSnapshot = { ...config, sourceRoots: [...config.sourceRoots] };
    Object.freeze(configSnapshot.sourceRoots);
    Object.freeze(configSnapshot);
    return Object.freeze({ projectId, config: configSnapshot });
  });
  return Object.freeze({ generation, owners: Object.freeze(snapshot) });
}

/** Maps an already-sanitized preflight diagnostic into the startup namespace. */
function toStartupDiagnostic(
  result: Extract<KnowledgeProductionPreflightResult, { kind: "diagnostic" }>
): string {
  return `production_preflight_${result.code}`;
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
  private generation = 0;
  private closed = false;
  private current?: {
    generation: number;
    preflight: KnowledgePluginProductionPreflightPort;
    admission: KnowledgePluginProductionPreflightAdmission;
  };

  /** Creates one plugin-owned, initially fail-closed preflight lifecycle. */
  constructor(
    private readonly dependencies: KnowledgePluginProductionPreflightLifecycleDependencies
  ) {}

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
    const createPreflight = this.dependencies.createPreflight;
    const admission = createAdmission(generation, result.bundles);
    let candidate: KnowledgePluginProductionPreflightPort;
    try {
      const input: KnowledgeProductionPreflightComposerInput = {
        owners: admission.owners,
        projects: projectRecords.map(({ project }) => ({
          id: project.id,
          projectModelKey: project.projectModelKey,
          modelConfigs: project.modelConfigs,
        })),
        settings,
        profileOptions: resources.profileOptions,
        fetchPort: this.dependencies.fetchPort,
      };
      candidate = createPreflight
        ? createPreflight(input)
        : new KnowledgeProductionPreflightComposer(input);
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
      candidate.close();
      throw error;
    }

    this.current = { generation, preflight: candidate, admission };
    let preflight: KnowledgeProductionPreflightResult;
    try {
      preflight = candidate.preflight();
    } catch {
      this.closeCandidate(candidate, generation);
      this.assertCurrent(generation, signal);
      return {
        kind: "invalid",
        diagnosticCodes: ["production_preflight_input_invalid"],
      };
    }
    try {
      this.assertCurrent(generation, signal);
    } catch (error) {
      this.closeCandidate(candidate, generation);
      throw error;
    }
    if (preflight.kind === "diagnostic") {
      this.closeCandidate(candidate, generation);
      return {
        kind: "invalid",
        diagnosticCodes: [toStartupDiagnostic(preflight)],
      };
    }

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
      this.current.admission !== admission
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
    this.closeCurrent();
    return this.generation;
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
    generation: number
  ): void {
    candidate.close();
    if (this.current?.generation === generation && this.current.preflight === candidate) {
      this.current = undefined;
    }
  }

  /** Closes the current candidate before clearing its lifecycle reference. */
  private closeCurrent(): void {
    const current = this.current;
    this.current = undefined;
    current?.preflight.close();
  }
}

Object.freeze(KnowledgePluginProductionPreflightLifecycle.prototype);
Object.freeze(KnowledgePluginProductionPreflightLifecycle);
