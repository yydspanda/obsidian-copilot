import {
  type CompilerCandidateValidator,
  type CompilerTargetResolver,
  type KnowledgeCompileInput,
  type KnowledgeCompileResult,
  type KnowledgeCompilerDependencies,
} from "@/knowledge/compiler/CompilerModelPort";
import { KnowledgeCompiler } from "@/knowledge/compiler/KnowledgeCompiler";
import {
  bindKnowledgeCompilerModelAdapter,
  classifyKnowledgeCompilerModelAdapterFailure,
  type KnowledgeModelStageReporter,
  KnowledgePrivateModelRoute,
} from "@/knowledge/compiler/KnowledgeCompilerModelAdapter";
import { KnowledgeAuthorizedSourcePreparation } from "@/knowledge/ingest/KnowledgeAuthorizedSourcePreparation";
import type { KnowledgeIngestWorkStage } from "@/knowledge/model/types";

const MODEL_ROUTE_LEASE_TOKEN = Symbol("KnowledgeProductionModelRouteLease.constructor");
const MODEL_ROUTE_OWNER_TOKEN = Symbol("KnowledgeProductionModelRouteLeaseOwner.constructor");

/** One Bundle-scoped private route created from the exact production preflight snapshot. */
export interface KnowledgeProductionModelRouteBinding {
  bundleId: string;
  route: KnowledgePrivateModelRoute;
}

/** Non-model dependencies captured for one exact production compile attempt. */
export interface KnowledgeProductionCompileAttemptDependencies {
  targetResolver: CompilerTargetResolver;
  candidateValidator: CompilerCandidateValidator;
  reportStage(stage: KnowledgeIngestWorkStage): Promise<void>;
}

interface CapturedCompileAttemptDependencies {
  resolveTargets: CompilerTargetResolver["resolve"];
  validateCandidate: CompilerCandidateValidator["validate"];
  reportStage: KnowledgeProductionCompileAttemptDependencies["reportStage"];
}

interface KnowledgeProductionModelRouteLeaseState {
  current: boolean;
  routes: Map<string, KnowledgePrivateModelRoute>;
}

interface KnowledgeProductionModelRouteLeaseOwnerState {
  lease: KnowledgeProductionModelRouteLease;
}

const modelRouteLeaseStates = new WeakMap<object, KnowledgeProductionModelRouteLeaseState>();
const modelRouteOwnerStates = new WeakMap<object, KnowledgeProductionModelRouteLeaseOwnerState>();
const reservedModelRoutePreparations = new WeakSet<object>();

/** Stable route-generation failure that retains no Bundle, model, request, or credential value. */
export class KnowledgeProductionModelRouteLeaseError extends Error {
  /** Creates one value-free production route capability failure. */
  constructor() {
    super("The production Knowledge model route generation is unavailable");
    this.name = "KnowledgeProductionModelRouteLeaseError";
  }
}

/** Creates the platform-standard cancellation used after synchronous route revocation. */
function createAbortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

/** Checks one canonical non-empty Bundle identifier without normalizing it. */
function isCanonicalIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

/** Returns hidden state only for an authentic model-route lease. */
function requireLeaseState(value: unknown): KnowledgeProductionModelRouteLeaseState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const state = modelRouteLeaseStates.get(value);
  if (!state) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return state;
}

/** Returns hidden state only for an authentic lifecycle owner. */
function requireOwnerState(value: unknown): KnowledgeProductionModelRouteLeaseOwnerState {
  if (typeof value !== "object" || value === null) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const state = modelRouteOwnerStates.get(value);
  if (!state) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return state;
}

/** Requires one current lease before or after a mutable asynchronous boundary. */
function assertLeaseCurrent(state: KnowledgeProductionModelRouteLeaseState): void {
  if (!state.current) {
    throw createAbortError();
  }
}

/** Reads one dense route-binding array after its caller installs a sanitized failure boundary. */
function snapshotRouteBindingsUnsafe(
  value: readonly KnowledgeProductionModelRouteBinding[]
): readonly KnowledgeProductionModelRouteBinding[] {
  if (!Array.isArray(value)) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > 10_000 ||
    Reflect.ownKeys(value).length !== (lengthDescriptor.value as number) + 1
  ) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }

  const bindings: KnowledgeProductionModelRouteBinding[] = [];
  const bundleIds = new Set<string>();
  for (let index = 0; index < (lengthDescriptor.value as number); index += 1) {
    const element = Object.getOwnPropertyDescriptor(value, String(index));
    if (!element || !("value" in element) || !element.enumerable) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const record: unknown = element.value;
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const bundleId = Object.getOwnPropertyDescriptor(record, "bundleId");
    const route = Object.getOwnPropertyDescriptor(record, "route");
    if (
      Reflect.ownKeys(record).length !== 2 ||
      !bundleId ||
      !("value" in bundleId) ||
      !bundleId.enumerable ||
      !isCanonicalIdentifier(bundleId.value) ||
      !route ||
      !("value" in route) ||
      !route.enumerable ||
      bundleIds.has(bundleId.value)
    ) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    KnowledgePrivateModelRoute.assert(route.value);
    bundleIds.add(bundleId.value);
    bindings.push(Object.freeze({ bundleId: bundleId.value, route: route.value }));
  }
  return Object.freeze(bindings);
}

/** Snapshots route bindings without allowing Proxy traps or route errors to escape. */
function snapshotRouteBindings(
  value: readonly KnowledgeProductionModelRouteBinding[]
): readonly KnowledgeProductionModelRouteBinding[] {
  try {
    return snapshotRouteBindingsUnsafe(value);
  } catch {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
}

/** Finds and captures one callable data method without evaluating accessors. */
function captureDataMethod<T extends (...args: never[]) => unknown>(
  receiver: object,
  key: string
): T {
  try {
    let current: object | null = receiver;
    const visited = new Set<object>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new TypeError("Expected a callable data method");
        }
        const method = descriptor.value as T;
        return ((...args: never[]) => {
          const result: unknown = Reflect.apply(method, receiver, args);
          return result;
        }) as T;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  throw new KnowledgeProductionModelRouteLeaseError();
}

/** Captures attempt dependencies after its caller installs a sanitized failure boundary. */
function captureAttemptDependenciesUnsafe(
  value: KnowledgeProductionCompileAttemptDependencies
): CapturedCompileAttemptDependencies {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  const targetResolver = Object.getOwnPropertyDescriptor(value, "targetResolver");
  const candidateValidator = Object.getOwnPropertyDescriptor(value, "candidateValidator");
  const reportStage = Object.getOwnPropertyDescriptor(value, "reportStage");
  const targetResolverValue: unknown =
    targetResolver && "value" in targetResolver ? targetResolver.value : undefined;
  const candidateValidatorValue: unknown =
    candidateValidator && "value" in candidateValidator ? candidateValidator.value : undefined;
  const reportStageValue: unknown =
    reportStage && "value" in reportStage ? reportStage.value : undefined;
  if (
    Reflect.ownKeys(value).length !== 3 ||
    !targetResolver ||
    !("value" in targetResolver) ||
    !targetResolver.enumerable ||
    typeof targetResolverValue !== "object" ||
    targetResolverValue === null ||
    !candidateValidator ||
    !("value" in candidateValidator) ||
    !candidateValidator.enumerable ||
    typeof candidateValidatorValue !== "object" ||
    candidateValidatorValue === null ||
    !reportStage ||
    !("value" in reportStage) ||
    !reportStage.enumerable ||
    typeof reportStageValue !== "function"
  ) {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
  return Object.freeze({
    resolveTargets: captureDataMethod<CompilerTargetResolver["resolve"]>(
      targetResolverValue,
      "resolve"
    ),
    validateCandidate: captureDataMethod<CompilerCandidateValidator["validate"]>(
      candidateValidatorValue,
      "validate"
    ),
    reportStage: async (stage: KnowledgeIngestWorkStage): Promise<void> => {
      const result: unknown = Reflect.apply(reportStageValue, value, [stage]);
      await result;
    },
  });
}

/** Captures exact attempt ports without allowing Proxy traps or dependency errors to escape. */
function captureAttemptDependencies(
  value: KnowledgeProductionCompileAttemptDependencies
): CapturedCompileAttemptDependencies {
  try {
    return captureAttemptDependenciesUnsafe(value);
  } catch {
    throw new KnowledgeProductionModelRouteLeaseError();
  }
}

/** Advances the durable Queue stage while guarding the exact route generation and signal. */
async function reportAttemptStage(
  state: KnowledgeProductionModelRouteLeaseState,
  preparation: KnowledgeAuthorizedSourcePreparation,
  captured: CapturedCompileAttemptDependencies,
  stage: KnowledgeIngestWorkStage
): Promise<void> {
  const signal = preparation.getSignal();
  assertLeaseCurrent(state);
  if (signal.aborted) throw createAbortError();
  await Reflect.apply(captured.reportStage, undefined, [stage]);
  assertLeaseCurrent(state);
  if (signal.aborted) throw createAbortError();
}

/** Wraps attempt ports with route-generation, Queue-signal, and Runtime reproof checks. */
function createGuardedCompilerDependencies(
  state: KnowledgeProductionModelRouteLeaseState,
  preparation: KnowledgeAuthorizedSourcePreparation,
  route: KnowledgePrivateModelRoute,
  captured: CapturedCompileAttemptDependencies
): KnowledgeCompilerDependencies {
  const signal = preparation.getSignal();
  const assertSignal = (candidate: AbortSignal): void => {
    assertLeaseCurrent(state);
    if (candidate !== signal || signal.aborted) {
      throw createAbortError();
    }
  };
  const reportStage: KnowledgeModelStageReporter = async (stage) =>
    reportAttemptStage(state, preparation, captured, stage);
  const targetResolver: CompilerTargetResolver = Object.freeze({
    resolve: async (
      targets: Parameters<CompilerTargetResolver["resolve"]>[0],
      candidateSignal: AbortSignal
    ) => {
      assertSignal(candidateSignal);
      await reportAttemptStage(state, preparation, captured, "associating");
      assertSignal(candidateSignal);
      await preparation.reprove("associating");
      assertSignal(candidateSignal);
      const result = await captured.resolveTargets(targets, candidateSignal);
      assertSignal(candidateSignal);
      await preparation.reprove("associating");
      assertSignal(candidateSignal);
      return result;
    },
  });
  const candidateValidator: CompilerCandidateValidator = Object.freeze({
    validate: async (
      input: Parameters<CompilerCandidateValidator["validate"]>[0],
      candidateSignal: AbortSignal
    ) => {
      assertSignal(candidateSignal);
      await reportAttemptStage(state, preparation, captured, "validating");
      assertSignal(candidateSignal);
      await preparation.reprove("validating");
      assertSignal(candidateSignal);
      const result = await captured.validateCandidate(input, candidateSignal);
      assertSignal(candidateSignal);
      await preparation.reprove("validating");
      assertSignal(candidateSignal);
      return result;
    },
  });
  const model = bindKnowledgeCompilerModelAdapter(preparation, route, reportStage);
  return Object.freeze({
    model,
    classifyModelFailure: classifyKnowledgeCompilerModelAdapterFailure,
    targetResolver,
    candidateValidator,
  });
}

/** Opaque preflight-owned route capability that never exposes routes, settings, or credentials. */
export class KnowledgeProductionModelRouteLease {
  /** Rejects direct construction without the module-private owner token. */
  constructor(token: symbol, routes: readonly KnowledgeProductionModelRouteBinding[]) {
    if (token !== MODEL_ROUTE_LEASE_TOKEN) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const bindings = snapshotRouteBindings(routes);
    modelRouteLeaseStates.set(this, {
      current: true,
      routes: new Map(bindings.map(({ bundleId, route }) => [bundleId, route])),
    });
    Object.freeze(this);
  }

  /** Authenticates only a module-minted route lease. */
  static assert(value: unknown): asserts value is KnowledgeProductionModelRouteLease {
    requireLeaseState(value);
  }

  /** Reports whether this exact preflight generation still retains its private routes. */
  isCurrent(): boolean {
    return requireLeaseState(this).current;
  }

  /** Throws synchronously after Settings, Projects, Runtime, or plugin invalidation. */
  assertCurrent(): void {
    assertLeaseCurrent(requireLeaseState(this));
  }

  /** Checks that this generation owns exactly the supplied stable Bundle identities. */
  coversBundleIds(bundleIds: readonly string[]): boolean {
    const state = requireLeaseState(this);
    try {
      if (!state.current || !Array.isArray(bundleIds) || bundleIds.length !== state.routes.size) {
        return false;
      }
      const seen = new Set<string>();
      for (const bundleId of bundleIds) {
        if (!isCanonicalIdentifier(bundleId) || seen.has(bundleId) || !state.routes.has(bundleId)) {
          return false;
        }
        seen.add(bundleId);
      }
      return seen.size === state.routes.size;
    } catch {
      return false;
    }
  }

  /**
   * Creates and immediately runs one Compiler without exposing its model adapter or private route.
   *
   * @param preparation - Authentic exact Queue/Runtime/source preparation
   * @param input - Complete deterministic Compiler input derived from that preparation
   * @param dependencies - Production target, candidate, and Queue-stage ports
   * @returns Controlled Compiler result for this exact attempt
   */
  async compile(
    preparation: KnowledgeAuthorizedSourcePreparation,
    input: KnowledgeCompileInput,
    dependencies: KnowledgeProductionCompileAttemptDependencies
  ): Promise<KnowledgeCompileResult> {
    const state = requireLeaseState(this);
    assertLeaseCurrent(state);
    try {
      KnowledgeAuthorizedSourcePreparation.assert(preparation);
    } catch {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const signal = preparation.getSignal();
    if (signal.aborted) throw createAbortError();
    const foundation = preparation.getPreparation();
    const route = state.routes.get(foundation.bundle.id);
    if (!route) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const captured = captureAttemptDependencies(dependencies);
    assertLeaseCurrent(state);
    if (reservedModelRoutePreparations.has(preparation)) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    reservedModelRoutePreparations.add(preparation);
    await preparation.reprove("parsing");
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    const compiler = new KnowledgeCompiler(
      createGuardedCompilerDependencies(state, preparation, route, captured)
    );
    const result = await compiler.compile(input, signal);
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    await reportAttemptStage(state, preparation, captured, "validating");
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    await preparation.reprove("validating");
    assertLeaseCurrent(state);
    if (signal.aborted) throw createAbortError();
    return result;
  }
}

Object.freeze(KnowledgeProductionModelRouteLease.prototype);
Object.freeze(KnowledgeProductionModelRouteLease);

/** Lifecycle-only close authority kept out of the admission passed to worker composition. */
export class KnowledgeProductionModelRouteLeaseOwner {
  /** Rejects direct construction without the module-private factory token. */
  constructor(token: symbol, bindings: readonly KnowledgeProductionModelRouteBinding[]) {
    if (token !== MODEL_ROUTE_OWNER_TOKEN) {
      throw new KnowledgeProductionModelRouteLeaseError();
    }
    const lease = new KnowledgeProductionModelRouteLease(MODEL_ROUTE_LEASE_TOKEN, bindings);
    modelRouteOwnerStates.set(this, Object.freeze({ lease }));
    Object.freeze(this);
  }

  /** Authenticates only a module-minted lifecycle owner. */
  static assert(value: unknown): asserts value is KnowledgeProductionModelRouteLeaseOwner {
    requireOwnerState(value);
  }

  /** Returns the close-incapable lease admitted to production workflow composition. */
  getLease(): KnowledgeProductionModelRouteLease {
    return requireOwnerState(this).lease;
  }

  /** Synchronously revokes the lease and releases all retained route closures. */
  close(): void {
    const state = requireLeaseState(requireOwnerState(this).lease);
    if (!state.current) return;
    state.current = false;
    state.routes.clear();
  }
}

Object.freeze(KnowledgeProductionModelRouteLeaseOwner.prototype);
Object.freeze(KnowledgeProductionModelRouteLeaseOwner);

/** Creates one lifecycle-owned private route generation from preflight-created bindings. */
export function createKnowledgeProductionModelRouteLeaseOwner(
  bindings: readonly KnowledgeProductionModelRouteBinding[]
): KnowledgeProductionModelRouteLeaseOwner {
  return new KnowledgeProductionModelRouteLeaseOwner(MODEL_ROUTE_OWNER_TOKEN, bindings);
}
